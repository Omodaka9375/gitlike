// ---------------------------------------------------------------------------
// GitLike User Profile View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, friendlyError, shortAddr } from './dom.js';
import type { Route } from './router.js';
import {
  listRepos,
  hasSession,
  getFollowers,
  getFollowing as fetchServerFollowing,
  getStarredRepos,
  followUser,
  unfollowUser,
  fetchContributions,
  fetchProfile,
  setAlias,
  setPfp,
  setBio,
  invalidateProfile,
} from '../api.js';
import { connectedAddress, authenticateWithSiwe } from '../wallet.js';
import { addressToColor } from './user-identity.js';
import { toggleFollow } from './shared.js';
import { repoCards } from './home.js';
import { showAlert } from './dialogs.js';
import { renderContributionGraph } from './contribution-graph.js';

// ---------------------------------------------------------------------------
// User Profile View
// ---------------------------------------------------------------------------

export async function renderUserProfile(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading profile...'));

  const addr = route.address;
  if (!addr) {
    render(root, errorBox('No address.'));
    return;
  }

  try {
    const [{ repos }, followersData, followingData, starredIds, contributions] = await Promise.all([
      listRepos(100),
      getFollowers(addr).catch(() => ({ addresses: [] as string[], count: 0 })),
      fetchServerFollowing(addr).catch(() => ({ addresses: [] as string[], count: 0 })),
      getStarredRepos(addr).catch(() => [] as string[]),
      fetchContributions(addr),
    ]);
    const owned = repos.filter((r) =>
      r.manifest?.acl.owners.some((a) => a.toLowerCase() === addr.toLowerCase()),
    );

    const profile = await fetchProfile(addr);
    const isSelf = connectedAddress()?.toLowerCase() === addr.toLowerCase();
    const children: (HTMLElement | string)[] = [];

    // --- Profile card ---
    const avatar = buildProfileAvatar(addr, profile.pfp, 80);
    const displayName = profile.alias || shortAddr(addr);

    const infoChildren: HTMLElement[] = [
      el('div', { cls: 'profile-display-name', text: displayName }),
      el('div', { cls: 'profile-address', text: addr }),
    ];

    if (profile.bio) {
      infoChildren.push(el('p', { cls: 'profile-bio', text: profile.bio }));
    }

    // Stats row
    const followerStat = el('span', {
      cls: 'profile-stat',
      children: [
        el('strong', { text: String(followersData.count) }),
        document.createTextNode(' followers') as unknown as HTMLElement,
      ],
    });
    const statsRow = el('div', {
      cls: 'profile-stats',
      children: [
        followerStat,
        el('span', {
          cls: 'profile-stat',
          children: [
            el('strong', { text: String(followingData.count) }),
            document.createTextNode(' following') as unknown as HTMLElement,
          ],
        }),
        el('a', {
          cls: 'profile-stat',
          attrs: { href: `/user/${addr}/stars` },
          children: [
            el('strong', { text: String(starredIds.length) }),
            document.createTextNode(' starred') as unknown as HTMLElement,
          ],
        }),
      ],
    });
    infoChildren.push(statsRow);

    // Follow button (inline with stats for non-self)
    if (!isSelf) {
      const isCurrentlyFollowing = followersData.addresses.some(
        (a) => a.toLowerCase() === connectedAddress()?.toLowerCase(),
      );
      const followBtn = el('button', {
        cls: isCurrentlyFollowing ? 'wallet-btn' : 'wallet-btn create-repo-btn',
        text: isCurrentlyFollowing ? 'Unfollow' : 'Follow',
        onclick: async () => {
          if (!hasSession()) {
            await showAlert('Connect your wallet and sign in to follow users.');
            return;
          }
          followBtn.disabled = true;
          try {
            const wasFollowing = followBtn.textContent === 'Unfollow';
            if (wasFollowing) {
              await unfollowUser(addr);
              toggleFollow(addr);
              followBtn.textContent = 'Follow';
              followBtn.className = 'wallet-btn create-repo-btn';
              followersData.count--;
            } else {
              await followUser(addr);
              toggleFollow(addr);
              followBtn.textContent = 'Unfollow';
              followBtn.className = 'wallet-btn';
              followersData.count++;
            }
            const strong = followerStat.querySelector('strong');
            if (strong) strong.textContent = String(followersData.count);
          } catch {
            await showAlert('Failed to update follow status.');
          } finally {
            followBtn.disabled = false;
          }
        },
      });
      infoChildren.push(
        el('div', { attrs: { style: 'margin-top: 0.75rem;' }, children: [followBtn] }),
      );
    }

    const profileCard = el('div', {
      cls: 'profile-card',
      children: [
        el('div', {
          cls: 'profile-card-top',
          children: [avatar, el('div', { cls: 'profile-info', children: infoChildren })],
        }),
      ],
    });

    // Editable section (own profile only) — inside the card
    if (isSelf && hasSession()) {
      profileCard.appendChild(buildEditProfileSection(addr, profile));
    }

    children.push(profileCard);

    // Contribution graph
    children.push(renderContributionGraph(contributions));

    // RSS feed link
    children.push(
      el('a', {
        cls: 'topbar-link',
        text: '\uD83D\uDCE1 Atom Feed',
        attrs: { href: `/api/user/${addr}/feed`, target: '_blank' },
      }),
    );

    if (owned.length > 0) {
      children.push(el('h2', { cls: 'section-title', text: `Repositories (${owned.length})` }));
      children.push(el('div', { cls: 'repo-list', children: repoCards(owned) }));
    } else {
      children.push(
        el('p', { cls: 'empty-state', text: 'No repositories found for this address.' }),
      );
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a profile avatar element (image or gradient dot fallback). */
function buildProfileAvatar(address: string, pfp: string | null, size: number): HTMLElement {
  if (pfp) {
    const img = el('img', {
      cls: size >= 60 ? 'profile-avatar' : 'profile-edit-pfp-thumb',
      attrs: {
        src: `/api/avatar/${address.toLowerCase()}`,
        alt: 'Avatar',
        width: String(size),
        height: String(size),
      },
    }) as HTMLImageElement;
    img.onerror = () => {
      const dot = buildAvatarDot(address, size);
      img.replaceWith(dot);
    };
    return img;
  }
  return buildAvatarDot(address, size);
}

/** Gradient dot fallback for addresses without PFP. */
function buildAvatarDot(address: string, size: number): HTMLElement {
  const dot = el('span', {
    cls: size >= 60 ? 'profile-avatar-dot' : 'profile-edit-pfp-dot',
  });
  dot.style.background = addressToColor(address);
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  return dot;
}

// ---------------------------------------------------------------------------
// Inline profile editor (own profile)
// ---------------------------------------------------------------------------

/** Build the collapsible edit section for display name, PFP, and bio. */
function buildEditProfileSection(
  address: string,
  profile: { alias: string | null; pfp: string | null; bio: string | null },
): HTMLElement {
  const MAX_BIO = 160;
  const status = el('p', { cls: 'profile-edit-status' });

  function showStatus(msg: string, isError = false): void {
    status.textContent = msg;
    status.className = isError ? 'profile-edit-status error' : 'profile-edit-status success';
    if (!isError) setTimeout(() => (status.textContent = ''), 2500);
  }

  async function ensureAuth(): Promise<boolean> {
    if (!hasSession()) {
      try {
        await authenticateWithSiwe();
      } catch {
        showStatus('Authentication required.', true);
        return false;
      }
    }
    return true;
  }

  // --- Display Name ---
  const nameInput = el('input', {
    attrs: {
      type: 'text',
      value: profile.alias ?? '',
      placeholder: 'Enter a display name',
      maxlength: '32',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const nameSaveBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Save',
    onclick: async () => {
      if (!(await ensureAuth())) return;
      nameSaveBtn.textContent = 'Saving\u2026';
      (nameSaveBtn as HTMLButtonElement).disabled = true;
      try {
        await setAlias(nameInput.value.trim());
        invalidateProfile(address);
        showStatus('Display name updated.');
        refreshWalletBar();
      } catch (err) {
        showStatus(`Failed: ${friendlyError(err)}`, true);
      } finally {
        nameSaveBtn.textContent = 'Save';
        (nameSaveBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  // --- Bio ---
  const bioInput = el('textarea', {
    attrs: {
      rows: '3',
      maxlength: String(MAX_BIO),
      placeholder: 'Tell others a bit about yourself\u2026',
      spellcheck: 'false',
    },
  }) as HTMLTextAreaElement;
  bioInput.value = profile.bio ?? '';

  const charCount = el('div', { cls: 'bio-char-count' });
  function updateCharCount(): void {
    const len = bioInput.value.length;
    charCount.textContent = `${len}/${MAX_BIO}`;
    charCount.className =
      len >= MAX_BIO
        ? 'bio-char-count at-limit'
        : len >= 140
          ? 'bio-char-count near-limit'
          : 'bio-char-count';
  }
  updateCharCount();
  bioInput.addEventListener('input', updateCharCount);

  const bioSaveBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Save',
    onclick: async () => {
      if (!(await ensureAuth())) return;
      bioSaveBtn.textContent = 'Saving\u2026';
      (bioSaveBtn as HTMLButtonElement).disabled = true;
      try {
        await setBio(bioInput.value.trim());
        invalidateProfile(address);
        showStatus('Bio updated.');
      } catch (err) {
        showStatus(`Failed: ${friendlyError(err)}`, true);
      } finally {
        bioSaveBtn.textContent = 'Save';
        (bioSaveBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  // --- Profile Picture ---
  const pfpPreview = buildProfileAvatar(address, profile.pfp, 48);
  const pfpHint = el('div', {
    cls: 'profile-edit-pfp-hint',
    text: profile.pfp ? 'Current avatar shown.' : 'No custom avatar set.',
  });

  const pfpInput = el('input', {
    attrs: {
      type: 'text',
      value: '',
      placeholder: 'https://example.com/avatar.png',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const pfpSaveBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Save URL',
    onclick: async () => {
      if (!(await ensureAuth())) return;
      pfpSaveBtn.textContent = 'Saving\u2026';
      (pfpSaveBtn as HTMLButtonElement).disabled = true;
      try {
        await setPfp({ url: pfpInput.value.trim() });
        invalidateProfile(address);
        showStatus('Profile picture updated.');
        refreshWalletBar();
      } catch (err) {
        showStatus(`Failed: ${friendlyError(err)}`, true);
      } finally {
        pfpSaveBtn.textContent = 'Save URL';
        (pfpSaveBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  const ensBtn = el('button', {
    cls: 'wallet-btn',
    text: '\uD83C\uDF10 ENS Avatar',
    onclick: async () => {
      if (!(await ensureAuth())) return;
      ensBtn.textContent = 'Setting\u2026';
      (ensBtn as HTMLButtonElement).disabled = true;
      try {
        await setPfp({ ens: true });
        invalidateProfile(address);
        showStatus('ENS avatar set.');
        refreshWalletBar();
      } catch (err) {
        showStatus(`Failed: ${friendlyError(err)}`, true);
      } finally {
        ensBtn.textContent = '\uD83C\uDF10 ENS Avatar';
        (ensBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  const clearPfpBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Remove',
    onclick: async () => {
      if (!(await ensureAuth())) return;
      clearPfpBtn.textContent = '\u2026';
      (clearPfpBtn as HTMLButtonElement).disabled = true;
      try {
        await setPfp({});
        invalidateProfile(address);
        showStatus('Profile picture removed.');
        refreshWalletBar();
      } catch (err) {
        showStatus(`Failed: ${friendlyError(err)}`, true);
      } finally {
        clearPfpBtn.textContent = 'Remove';
        (clearPfpBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  // --- Collapsible container ---
  const header = el('div', {
    cls: 'profile-edit-header',
    children: [
      el('h3', {
        children: [el('span', { text: '\u270F\uFE0F' }), el('span', { text: 'Edit Profile' })],
      }),
      el('span', { cls: 'profile-edit-chevron', text: '\u25BE' }),
    ],
  });

  const body = el('div', {
    cls: 'profile-edit-body',
    children: [
      el('div', {
        cls: 'profile-edit-grid',
        children: [
          // Display Name field
          el('div', {
            cls: 'profile-edit-field',
            children: [
              el('label', { text: 'Display Name' }),
              el('div', {
                cls: 'profile-edit-input-row',
                children: [nameInput, nameSaveBtn],
              }),
              el('p', {
                cls: 'field-hint',
                text: '1\u201332 characters, letters, digits, or hyphens.',
              }),
            ],
          }),
          // Profile Picture field
          el('div', {
            cls: 'profile-edit-field',
            children: [
              el('label', { text: 'Avatar' }),
              el('div', {
                cls: 'profile-edit-pfp-preview',
                children: [pfpPreview, pfpHint],
              }),
              el('div', {
                cls: 'profile-edit-input-row',
                children: [pfpInput, pfpSaveBtn],
              }),
              el('div', {
                cls: 'profile-edit-pfp-options',
                children: [ensBtn, clearPfpBtn],
              }),
            ],
          }),
          // Bio field — full width
          el('div', {
            cls: 'profile-edit-field full-width',
            children: [
              el('label', { text: 'Bio' }),
              el('div', {
                cls: 'profile-edit-input-row',
                children: [bioInput, bioSaveBtn],
              }),
              charCount,
            ],
          }),
        ],
      }),
      status,
    ],
  });

  const section = el('div', {
    cls: 'profile-edit-section open',
    children: [header, body],
  });

  header.addEventListener('click', () => section.classList.toggle('open'));

  return section;
}

/** Refresh the wallet bar without full page reload. */
async function refreshWalletBar(): Promise<void> {
  const existing = document.querySelector('.wallet-bar');
  if (!existing?.parentElement) return;
  const { renderWalletBar } = await import('./wallet-bar.js');
  existing.parentElement.replaceChild(renderWalletBar(), existing);
}
