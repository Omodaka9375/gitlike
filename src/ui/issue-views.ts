// ---------------------------------------------------------------------------
// GitLike Issue Views
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, shortAddr, timeAgo, friendlyError } from './dom.js';
import type { Route } from './router.js';
import { refreshRoute } from './router.js';
import {
  fetchManifest,
  fetchJSON,
  hasSession,
  listIssues,
  createIssue,
  updateIssue,
  fetchAlias,
} from '../api.js';
import { renderMarkdown } from './markdown.js';
import { renderBackToRepos } from './shared.js';
import { renderRepoHeader } from './repo-view.js';
import { showAlert } from './dialogs.js';
import type { Issue } from '../types.js';

// ---------------------------------------------------------------------------
// Issue List View
// ---------------------------------------------------------------------------

export async function renderIssueList(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading issues...'));

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const { issues } = await listIssues(route.groupId);

    let filter: 'open' | 'closed' = 'open';

    const buildList = (): HTMLElement[] => {
      const filtered = issues.filter(({ issue }) => issue.status === filter);

      if (filtered.length === 0) {
        return [el('p', { cls: 'empty-state', text: `No ${filter} issues.` })];
      }

      const items = filtered.map(({ cid, issue }) =>
        el('a', {
          cls: 'commit-item',
          attrs: { href: `/${route.groupId}/issue/${cid}` },
          children: [
            el('div', {
              cls: 'commit-item-header',
              children: [
                el('span', { cls: 'commit-message', text: `#${issue.number} ${issue.title}` }),
                el('span', {
                  cls: `badge ${issue.status === 'open' ? 'issue-open' : 'issue-closed'}`,
                  text: issue.status,
                }),
                ...issue.labels.map((l) => el('span', { cls: 'badge', text: l })),
              ],
            }),
            el('div', {
              cls: 'commit-item-meta',
              children: [
                (() => {
                  const s = el('span', {
                    text: `${shortAddr(issue.author)} · ${timeAgo(issue.createdAt)}`,
                  });
                  fetchAlias(issue.author).then((a) => {
                    if (a) s.textContent = `${a} · ${timeAgo(issue.createdAt)}`;
                  });
                  return s;
                })(),
                ...(issue.comments.length > 0
                  ? [
                      el('span', {
                        text: ` · ${issue.comments.length} comment${issue.comments.length !== 1 ? 's' : ''}`,
                      }),
                    ]
                  : []),
              ],
            }),
          ],
        }),
      );
      return [el('div', { cls: 'commit-list', children: items })];
    };

    const listContainer = el('div', { children: buildList() });

    const openCount = issues.filter(({ issue }) => issue.status === 'open').length;
    const closedCount = issues.filter(({ issue }) => issue.status === 'closed').length;

    const openBtn = el('button', {
      cls: 'wallet-btn' + (filter === 'open' ? ' create-repo-btn' : ''),
      text: `Open (${openCount})`,
      onclick: () => {
        filter = 'open';
        openBtn.className = 'wallet-btn create-repo-btn';
        closedBtn.className = 'wallet-btn';
        render(listContainer, ...buildList());
      },
    });

    const closedBtn = el('button', {
      cls: 'wallet-btn',
      text: `Closed (${closedCount})`,
      onclick: () => {
        filter = 'closed';
        closedBtn.className = 'wallet-btn create-repo-btn';
        openBtn.className = 'wallet-btn';
        render(listContainer, ...buildList());
      },
    });

    const children: (HTMLElement | string)[] = [
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('h2', { cls: 'section-title', text: 'Issues' }),
      el('div', {
        cls: 'modal-actions',
        children: [
          openBtn,
          closedBtn,
          ...(hasSession()
            ? [
                el('button', {
                  cls: 'wallet-btn create-repo-btn',
                  text: '+ New Issue',
                  onclick: () => showCreateIssueModal(route),
                }),
              ]
            : []),
        ],
      }),
      listContainer,
    ];

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

/** Modal to create a new issue. */
function showCreateIssueModal(route: Route): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'New Issue' }),
      el('label', { text: 'Title', attrs: { for: 'issue-title' } }),
      el('input', { attrs: { id: 'issue-title', type: 'text', placeholder: 'Issue title' } }),
      el('label', { text: 'Description (markdown)', attrs: { for: 'issue-body' } }),
      el('textarea', {
        attrs: { id: 'issue-body', rows: '6', placeholder: 'Describe the issue...' },
      }),
      el('label', { text: 'Labels (comma-separated)', attrs: { for: 'issue-labels' } }),
      el('input', {
        attrs: { id: 'issue-labels', type: 'text', placeholder: 'bug, enhancement' },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create Issue',
            attrs: { id: 'issue-submit' },
            onclick: async () => {
              const title = (
                document.getElementById('issue-title') as HTMLInputElement
              )?.value.trim();
              if (!title) return;
              const body = (
                document.getElementById('issue-body') as HTMLTextAreaElement
              )?.value.trim();
              const labelsRaw = (
                document.getElementById('issue-labels') as HTMLInputElement
              )?.value.trim();
              const labels = labelsRaw
                ? labelsRaw
                    .split(',')
                    .map((l) => l.trim())
                    .filter(Boolean)
                : [];
              const btn = document.getElementById('issue-submit') as HTMLButtonElement;
              const status = document.getElementById('modal-status');
              if (btn) btn.disabled = true;
              if (status) status.textContent = 'Creating...';
              try {
                await createIssue(
                  route.groupId,
                  title,
                  body || undefined,
                  labels.length ? labels : undefined,
                );
                if (status) {
                  status.textContent = '\u2713 Issue created!';
                  status.className = 'modal-status success';
                }
                setTimeout(() => {
                  overlay.remove();
                  refreshRoute();
                }, 1000);
              } catch (err) {
                if (status) {
                  status.textContent = `Error: ${friendlyError(err)}`;
                  status.className = 'modal-status error';
                }
                if (btn) btn.disabled = false;
              }
            },
          }),
        ],
      }),
      el('div', { cls: 'modal-status', attrs: { id: 'modal-status' } }),
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Issue Detail View
// ---------------------------------------------------------------------------

export async function renderIssueDetail(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading issue...'));

  const cid = route.issueCid;
  if (!cid) {
    render(root, errorBox('No issue identifier.'));
    return;
  }

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const issue = await fetchJSON<Issue>(String(cid));

    const children: (HTMLElement | string)[] = [
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('div', {
        cls: 'commit-detail-meta',
        children: [
          el('h2', { text: `#${issue.number} ${issue.title}` }),
          el('div', {
            cls: 'commit-item-meta',
            children: [
              el('span', {
                cls: `badge ${issue.status === 'open' ? 'issue-open' : 'issue-closed'}`,
                text: issue.status,
              }),
              ...issue.labels.map((l) => el('span', { cls: 'badge', text: l })),
              (() => {
                const s = el('span', {
                  text: ` · ${shortAddr(issue.author)} · ${timeAgo(issue.createdAt)}`,
                });
                fetchAlias(issue.author).then((a) => {
                  if (a) s.textContent = ` · ${a} · ${timeAgo(issue.createdAt)}`;
                });
                return s;
              })(),
            ],
          }),
        ],
      }),
    ];

    // Render markdown body
    if (issue.body) {
      children.push(
        el('div', {
          cls: 'issue-body markdown-body',
          html: renderMarkdown(issue.body),
        }),
      );
    }

    // Comment thread
    if (issue.comments.length > 0) {
      const commentEls = issue.comments.map((c) =>
        el('div', {
          cls: 'issue-comment',
          children: [
            el('div', {
              cls: 'commit-item-meta',
              children: [
                (() => {
                  const s = el('span', {
                    text: `${shortAddr(c.author)} · ${timeAgo(c.createdAt)}`,
                  });
                  fetchAlias(c.author).then((a) => {
                    if (a) s.textContent = `${a} · ${timeAgo(c.createdAt)}`;
                  });
                  return s;
                })(),
              ],
            }),
            el('div', { cls: 'markdown-body', html: renderMarkdown(c.body) }),
          ],
        }),
      );
      children.push(
        el('div', {
          cls: 'issue-comments',
          children: [
            el('h3', {
              text: `${issue.comments.length} comment${issue.comments.length !== 1 ? 's' : ''}`,
            }),
            ...commentEls,
          ],
        }),
      );
    }

    // Add comment + close/reopen actions
    if (hasSession()) {
      const textarea = el('textarea', {
        attrs: { rows: '4', placeholder: 'Leave a comment (markdown)...' },
      }) as HTMLTextAreaElement;

      const statusEl = el('div', { cls: 'modal-status' });

      const submitComment = async (): Promise<void> => {
        const text = textarea.value.trim();
        if (!text) return;
        statusEl.textContent = 'Posting...';
        statusEl.className = 'modal-status';
        try {
          await updateIssue(route.groupId, String(cid), { comment: text });
          statusEl.textContent = '\u2713 Comment added!';
          statusEl.className = 'modal-status success';
          setTimeout(refreshRoute, 800);
        } catch (err) {
          statusEl.textContent = `Error: ${friendlyError(err)}`;
          statusEl.className = 'modal-status error';
        }
      };

      const toggleStatus = async (): Promise<void> => {
        const newStatus = issue.status === 'open' ? 'closed' : 'open';
        try {
          await updateIssue(route.groupId, String(cid), { status: newStatus });
          refreshRoute();
        } catch (err) {
          await showAlert(`Failed: ${friendlyError(err)}`);
        }
      };

      children.push(
        el('div', {
          cls: 'issue-actions',
          children: [
            textarea,
            el('div', {
              cls: 'modal-actions',
              children: [
                el('button', {
                  cls: 'wallet-btn create-repo-btn',
                  text: 'Comment',
                  onclick: submitComment,
                }),
                el('button', {
                  cls: `wallet-btn${issue.status === 'open' ? '' : ' create-repo-btn'}`,
                  text: issue.status === 'open' ? 'Close Issue' : 'Reopen Issue',
                  onclick: toggleStatus,
                }),
              ],
            }),
            statusEl,
          ],
        }),
      );
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}
