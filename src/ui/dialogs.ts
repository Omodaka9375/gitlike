// ---------------------------------------------------------------------------
// GitLike — Custom Modal Dialogs
// Drop-in replacements for alert(), prompt(), confirm().
// ---------------------------------------------------------------------------

import { el } from './dom.js';

/** Unique ID for the dialog overlay so only one is open at a time. */
const DIALOG_ID = 'gitlike-dialog';

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

type DialogResult<T> = { resolve: (v: T) => void; overlay: HTMLElement };

function createDialogShell<T>(title: string): DialogResult<T> & { modal: HTMLElement } {
  document.getElementById(DIALOG_ID)?.remove();

  let resolveFn!: (v: T) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  new Promise<T>((r) => {
    resolveFn = r;
  });

  const overlay = el('div', {
    cls: 'modal-overlay',
    attrs: { id: DIALOG_ID },
  });

  const modal = el('div', { cls: 'modal dialog-modal' });
  if (title) modal.appendChild(el('h2', { text: title }));

  overlay.appendChild(modal);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.remove();
  });

  return { resolve: resolveFn, overlay, modal };
}

function show(overlay: HTMLElement): void {
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// showAlert — replaces alert()
// ---------------------------------------------------------------------------

/** Show a styled alert with a message and OK button. */
export function showAlert(message: string, title = ''): Promise<void> {
  return new Promise<void>((resolve) => {
    const { overlay, modal } = createDialogShell<void>(title);

    modal.appendChild(el('p', { cls: 'dialog-message', text: message }));
    modal.appendChild(
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'OK',
            onclick: () => {
              overlay.remove();
              resolve();
            },
          }),
        ],
      }),
    );

    show(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve();
      }
    });
    (modal.querySelector('button') as HTMLElement)?.focus();
  });
}

// ---------------------------------------------------------------------------
// showConfirm — replaces confirm()
// ---------------------------------------------------------------------------

/** Show a styled confirm dialog. Resolves true (OK) or false (Cancel). */
export function showConfirm(message: string, title = ''): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { overlay, modal } = createDialogShell<boolean>(title);

    modal.appendChild(el('p', { cls: 'dialog-message', text: message }));
    modal.appendChild(
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: 'Cancel',
            onclick: () => {
              overlay.remove();
              resolve(false);
            },
          }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'OK',
            onclick: () => {
              overlay.remove();
              resolve(true);
            },
          }),
        ],
      }),
    );

    show(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
    // Focus the OK button
    (modal.querySelectorAll('button')[1] as HTMLElement)?.focus();
  });
}

// ---------------------------------------------------------------------------
// showPrompt — replaces prompt()
// ---------------------------------------------------------------------------

/** Show a styled prompt with an input field. Resolves the value or null. */
export function showPrompt(message: string, defaultValue = '', title = ''): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const { overlay, modal } = createDialogShell<string | null>(title);

    modal.appendChild(el('p', { cls: 'dialog-message', text: message }));

    const input = el('input', {
      attrs: {
        type: 'text',
        value: defaultValue,
        spellcheck: 'false',
        autofocus: 'true',
      },
    }) as HTMLInputElement;
    modal.appendChild(input);

    modal.appendChild(
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: 'Cancel',
            onclick: () => {
              overlay.remove();
              resolve(null);
            },
          }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'OK',
            onclick: () => {
              overlay.remove();
              resolve(input.value);
            },
          }),
        ],
      }),
    );

    show(overlay);
    input.focus();
    input.select();

    // Enter submits, Escape cancels
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(input.value);
      } else if (e.key === 'Escape') {
        overlay.remove();
        resolve(null);
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// showSelect — replaces multi-option prompt (e.g. PFP picker)
// ---------------------------------------------------------------------------

/** Option for a select dialog. */
export type SelectOption = { label: string; value: string };

/** Show a dialog with labeled options and an optional text input. */
export function showSelect(
  message: string,
  options: SelectOption[],
  placeholder = '',
  title = '',
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const { overlay, modal } = createDialogShell<string | null>(title);

    modal.appendChild(el('p', { cls: 'dialog-message', text: message }));

    const btnGroup = el('div', { cls: 'dialog-options' });
    for (const opt of options) {
      btnGroup.appendChild(
        el('button', {
          cls: 'wallet-btn dialog-option-btn',
          text: opt.label,
          onclick: () => {
            overlay.remove();
            resolve(opt.value);
          },
        }),
      );
    }
    modal.appendChild(btnGroup);

    if (placeholder) {
      const input = el('input', {
        attrs: { type: 'text', placeholder, spellcheck: 'false' },
      }) as HTMLInputElement;
      modal.appendChild(input);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          overlay.remove();
          resolve(input.value.trim());
        } else if (e.key === 'Escape') {
          overlay.remove();
          resolve(null);
        }
      });

      // Submit custom URL button
      modal.appendChild(
        el('div', {
          cls: 'modal-actions',
          children: [
            el('button', {
              cls: 'wallet-btn',
              text: 'Cancel',
              onclick: () => {
                overlay.remove();
                resolve(null);
              },
            }),
            el('button', {
              cls: 'wallet-btn create-repo-btn',
              text: 'Use URL',
              onclick: () => {
                overlay.remove();
                resolve(input.value.trim() || null);
              },
            }),
          ],
        }),
      );
    } else {
      modal.appendChild(
        el('div', {
          cls: 'modal-actions',
          children: [
            el('button', {
              cls: 'wallet-btn',
              text: 'Cancel',
              onclick: () => {
                overlay.remove();
                resolve(null);
              },
            }),
          ],
        }),
      );
    }

    show(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
  });
}
