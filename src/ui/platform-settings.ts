// ---------------------------------------------------------------------------
// GitLike — Platform Settings Modal (Admin Only)
// Toggle open repo creation and manage platform developers.
// ---------------------------------------------------------------------------

import { el, friendlyError } from './dom.js';
import {
  fetchPlatformSettings,
  updatePlatformSettings,
  invalidatePlatformSettings,
  fetchPlatformUsage,
  fetchFederatedPeers,
  registerPeer,
  removePeer,
  syncPeers,
} from '../api.js';
import { refreshRoute } from './router.js';

/** Open the platform settings modal. */
export function showPlatformSettingsModal(): void {
  document.getElementById('platform-settings-modal')?.remove();

  const overlay = el('div', {
    cls: 'modal-overlay',
    attrs: { id: 'platform-settings-modal' },
  });

  const status = el('div', { cls: 'modal-status', attrs: { id: 'platform-status' } });

  const openToggle = el('input', {
    attrs: { id: 'platform-open-creation', type: 'checkbox' },
  }) as HTMLInputElement;

  const writersArea = el('textarea', {
    attrs: {
      id: 'platform-writers',
      rows: '3',
      placeholder: '0xABC...\n0xDEF...',
      spellcheck: 'false',
    },
  }) as HTMLTextAreaElement;

  const nameInput = el('input', {
    attrs: {
      id: 'platform-name',
      type: 'text',
      placeholder: 'My GitLike Instance',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const descInput = el('input', {
    attrs: {
      id: 'platform-desc',
      type: 'text',
      placeholder: 'A short description...',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const retentionInput = el('input', {
    attrs: {
      id: 'platform-retention',
      type: 'number',
      min: '0',
      step: '1',
      placeholder: '50',
    },
  }) as HTMLInputElement;

  const pinnedInput = el('input', {
    attrs: {
      id: 'platform-pinned',
      type: 'text',
      placeholder: 'Group ID of repo to pin',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const saveBtn = el('button', {
    cls: 'wallet-btn create-repo-btn',
    text: 'Save Changes',
    attrs: { id: 'platform-save' },
    onclick: handleSave,
  });

  // Storage usage stat row
  const usageValue = el('div', {
    cls: 'settings-stat-value',
    attrs: { id: 'platform-usage-value' },
    text: 'Loading...',
  });
  const usageSection = el('div', {
    cls: 'settings-stat-row',
    attrs: { id: 'platform-usage-section' },
    children: [
      el('span', { cls: 'settings-stat-icon', text: '\uD83D\uDCE6' }),
      el('div', {
        cls: 'settings-stat-content',
        children: [el('div', { cls: 'settings-stat-label', text: 'Storage Usage' }), usageValue],
      }),
    ],
  });

  // Storage provider stat row
  const providerValue = el('div', {
    cls: 'settings-stat-value',
    attrs: { id: 'storage-provider-status' },
    text: 'Checking...',
  });
  const storageProviderSection = el('div', {
    cls: 'settings-stat-row',
    children: [
      el('span', { cls: 'settings-stat-icon', text: '\u2601\uFE0F' }),
      el('div', {
        cls: 'settings-stat-content',
        children: [
          el('div', { cls: 'settings-stat-label', text: 'Storage Provider' }),
          providerValue,
        ],
      }),
    ],
  });

  const modal = el('div', {
    cls: 'modal modal-wide',
    children: [
      // Header with icon
      el('div', {
        cls: 'settings-modal-header',
        children: [
          el('div', { cls: 'settings-modal-icon', text: '\u2699\uFE0F' }),
          el('div', {
            children: [
              el('h2', { text: 'Platform Settings' }),
              el('div', {
                cls: 'settings-modal-subtitle',
                text: 'Manage your instance configuration',
              }),
            ],
          }),
        ],
      }),
      el('div', {
        cls: 'settings-columns',
        children: [
          // Status row — two cards side by side
          el('div', {
            cls: 'settings-two-col',
            children: [usageSection, storageProviderSection],
          }),

          // Instance identity section
          el('div', {
            cls: 'settings-col',
            children: [
              el('div', {
                cls: 'settings-col-header',
                children: [el('h3', { text: 'Instance' })],
              }),
              el('div', {
                cls: 'settings-card',
                children: [
                  el('div', {
                    cls: 'settings-two-col',
                    children: [
                      el('div', {
                        cls: 'settings-field',
                        children: [
                          el('label', {
                            text: 'Platform name',
                            attrs: { for: 'platform-name' },
                          }),
                          nameInput,
                        ],
                      }),
                      el('div', {
                        cls: 'settings-field',
                        children: [
                          el('label', {
                            text: 'Deep retention (commits)',
                            attrs: { for: 'platform-retention' },
                          }),
                          retentionInput,
                        ],
                      }),
                    ],
                  }),
                  el('div', {
                    cls: 'settings-field',
                    children: [
                      el('label', { text: 'Description', attrs: { for: 'platform-desc' } }),
                      descInput,
                    ],
                  }),
                  el('div', {
                    cls: 'settings-field',
                    children: [
                      el('label', { text: 'Pinned repo', attrs: { for: 'platform-pinned' } }),
                      el('p', {
                        cls: 'field-hint',
                        text: 'Group ID of a repo to pin at the top of the homepage. Leave empty for none.',
                      }),
                      pinnedInput,
                    ],
                  }),
                ],
              }),
            ],
          }),

          // Access control section
          el('div', {
            cls: 'settings-col',
            children: [
              el('div', {
                cls: 'settings-col-header',
                children: [el('h3', { text: 'Access Control' })],
              }),
              el('div', {
                cls: 'settings-card',
                children: [
                  el('label', {
                    cls: 'toggle-switch',
                    children: [
                      openToggle,
                      el('span', { cls: 'toggle-track' }),
                      el('div', {
                        children: [
                          el('span', {
                            cls: 'toggle-label-text',
                            text: 'Allow anyone to create repos',
                          }),
                          el('div', {
                            cls: 'toggle-hint',
                            text: 'When off, only admins and listed developers can create repos.',
                          }),
                        ],
                      }),
                    ],
                  }),
                  el('div', {
                    cls: 'settings-field',
                    children: [
                      el('label', {
                        text: 'Platform developers',
                        attrs: { for: 'platform-writers' },
                      }),
                      el('p', {
                        cls: 'field-hint',
                        text: 'One Ethereum address per line.',
                      }),
                      writersArea,
                    ],
                  }),
                ],
              }),
            ],
          }),

          // Federation section
          el('div', {
            cls: 'settings-col',
            children: [
              el('div', {
                cls: 'settings-col-header',
                children: [el('h3', { text: 'Federation' })],
              }),
              el('div', { cls: 'settings-card', children: [buildFederationSection()] }),
            ],
          }),
        ],
      }),
      el('div', {
        cls: 'settings-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          saveBtn,
        ],
      }),
      status,
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  // Load current settings
  loadSettings(openToggle, writersArea, nameInput, descInput, retentionInput, pinnedInput, status);
  loadUsage(usageSection);
  loadStorageProviderStatus();
}

/** Check storage provider status via deep health check. */
async function loadStorageProviderStatus(): Promise<void> {
  const statusEl = document.getElementById('storage-provider-status');
  if (!statusEl) return;
  const row = statusEl.closest('.settings-stat-row');
  try {
    const res = await fetch('/api/health/deep');
    const data = (await res.json()) as { checks: Record<string, boolean> };
    if (data.checks.storage) {
      statusEl.textContent = 'Reachable';
      row?.classList.add('settings-stat-ok');
    } else {
      statusEl.textContent = 'Unreachable';
      row?.classList.add('settings-stat-warn');
    }
  } catch {
    statusEl.textContent = 'Could not check status.';
    row?.classList.add('settings-stat-muted');
  }
}

async function loadSettings(
  toggle: HTMLInputElement,
  writers: HTMLTextAreaElement,
  name: HTMLInputElement,
  desc: HTMLInputElement,
  retention: HTMLInputElement,
  pinned: HTMLInputElement,
  status: HTMLElement,
): Promise<void> {
  try {
    status.textContent = 'Loading...';
    status.className = 'modal-status';
    invalidatePlatformSettings();
    const { settings } = await fetchPlatformSettings();
    toggle.checked = settings.openCreation;
    writers.value = settings.writers.join('\n');
    name.value = settings.platformName;
    desc.value = settings.platformDescription;
    retention.value = String(settings.retentionDepth ?? 50);
    pinned.value = settings.pinnedRepo ?? '';
    status.textContent = '';
  } catch (err) {
    status.textContent = `Failed to load: ${friendlyError(err)}`;
    status.className = 'modal-status error';
  }
}

/** Format bytes into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Load storage usage into the usage section. */
async function loadUsage(container: HTMLElement): Promise<void> {
  try {
    const { storageBytes, fileCount } = await fetchPlatformUsage();
    const valueEl = document.getElementById('platform-usage-value');
    if (valueEl) {
      valueEl.textContent = `${formatBytes(storageBytes)} used across ${fileCount.toLocaleString()} pinned files`;
    }
  } catch {
    const valueEl = document.getElementById('platform-usage-value');
    if (valueEl) valueEl.textContent = 'Could not load usage data.';
    container.classList.add('settings-stat-muted');
  }
}

async function handleSave(): Promise<void> {
  const status = document.getElementById('platform-status');
  const saveBtn = document.getElementById('platform-save') as HTMLButtonElement;
  const toggle = document.getElementById('platform-open-creation') as HTMLInputElement;
  const writersArea = document.getElementById('platform-writers') as HTMLTextAreaElement;
  const nameInput = document.getElementById('platform-name') as HTMLInputElement;
  const descInput = document.getElementById('platform-desc') as HTMLInputElement;
  const retentionInput = document.getElementById('platform-retention') as HTMLInputElement;
  const pinnedInput = document.getElementById('platform-pinned') as HTMLInputElement;

  if (!toggle || !writersArea) return;

  try {
    if (saveBtn) saveBtn.disabled = true;
    if (status) {
      status.textContent = 'Saving...';
      status.className = 'modal-status';
    }

    const writers = writersArea.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const depth = parseInt(retentionInput?.value ?? '50', 10);

    await updatePlatformSettings({
      openCreation: toggle.checked,
      writers,
      platformName: nameInput?.value.trim() ?? '',
      platformDescription: descInput?.value.trim() ?? '',
      retentionDepth: Number.isFinite(depth) && depth >= 0 ? depth : 50,
      pinnedRepo: pinnedInput?.value.trim() ?? '',
    });

    if (status) {
      status.textContent = '\u2713 Saved!';
      status.className = 'modal-status success';
    }

    // Refresh wallet bar + current page to reflect changes
    setTimeout(() => {
      document.getElementById('platform-settings-modal')?.remove();
      window.dispatchEvent(new CustomEvent('platform-settings-changed'));
      refreshRoute();
    }, 800);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Federation management
// ---------------------------------------------------------------------------

/** Build the federation admin section for the settings modal. */
function buildFederationSection(): HTMLElement {
  const container = el('div', { cls: 'platform-field federation-section' });

  const peerList = el('div', { cls: 'federation-peer-list' });
  const statusMsg = el('p', { cls: 'field-hint', text: 'Loading peers...' });

  const domainInput = el('input', {
    attrs: {
      type: 'text',
      placeholder: 'code.example.com',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const addBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Add Peer',
    onclick: async () => {
      const domain = domainInput.value.trim();
      if (!domain) return;
      addBtn.textContent = 'Registering...';
      (addBtn as HTMLButtonElement).disabled = true;
      try {
        await registerPeer(domain);
        domainInput.value = '';
        statusMsg.textContent = '';
        await refreshPeerList(peerList, statusMsg);
      } catch (err) {
        statusMsg.textContent = `Error: ${friendlyError(err)}`;
      } finally {
        addBtn.textContent = 'Add Peer';
        (addBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  const syncBtn = el('button', {
    cls: 'wallet-btn',
    text: '\u21BB Sync Now',
    onclick: async () => {
      syncBtn.textContent = 'Syncing...';
      (syncBtn as HTMLButtonElement).disabled = true;
      try {
        const { synced } = await syncPeers();
        statusMsg.textContent = `Synced ${synced} peer(s).`;
        await refreshPeerList(peerList, statusMsg);
      } catch (err) {
        statusMsg.textContent = `Sync failed: ${friendlyError(err)}`;
      } finally {
        syncBtn.textContent = '\u21BB Sync Now';
        (syncBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  const addRow = el('div', {
    cls: 'federation-add-row',
    children: [domainInput, addBtn],
  });

  container.appendChild(el('label', { text: 'Federated peers' }));
  container.appendChild(addRow);
  container.appendChild(syncBtn);
  container.appendChild(peerList);
  container.appendChild(statusMsg);

  // Load peers on mount
  refreshPeerList(peerList, statusMsg);

  return container;
}

/** Refresh the peer list UI. */
async function refreshPeerList(listEl: HTMLElement, statusEl: HTMLElement): Promise<void> {
  try {
    const peers = await fetchFederatedPeers();
    listEl.innerHTML = '';

    if (peers.length === 0) {
      statusEl.textContent = 'No federated peers yet.';
      return;
    }

    statusEl.textContent = `${peers.length} peer(s) registered`;

    for (const peer of peers) {
      const statusDot = el('span', {
        cls: `network-status network-status-${peer.status === 'online' ? 'online' : 'offline'}`,
      });

      const removeBtn = el('button', {
        cls: 'wallet-btn federation-remove-btn',
        text: '\u2715',
        attrs: { title: 'Remove peer' },
        onclick: async () => {
          removeBtn.textContent = '...';
          (removeBtn as HTMLButtonElement).disabled = true;
          try {
            await removePeer(peer.domain);
            await refreshPeerList(listEl, statusEl);
          } catch (err) {
            statusEl.textContent = `Remove failed: ${friendlyError(err)}`;
            removeBtn.textContent = '\u2715';
            (removeBtn as HTMLButtonElement).disabled = false;
          }
        },
      });

      const row = el('div', {
        cls: 'federation-peer-row',
        children: [
          el('div', {
            cls: 'federation-peer-info',
            children: [
              statusDot,
              el('strong', { text: peer.name }),
              el('span', { cls: 'network-card-domain', text: peer.domain }),
              el('span', {
                cls: 'field-hint',
                text: `${peer.repoCount} repos \u00B7 v${peer.version}`,
              }),
            ],
          }),
          removeBtn,
        ],
      });

      listEl.appendChild(row);
    }
  } catch (err) {
    statusEl.textContent = `Failed to load peers: ${friendlyError(err)}`;
  }
}
