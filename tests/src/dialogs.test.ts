/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { showAlert, showConfirm, showPrompt, showSelect } from '../../src/ui/dialogs.js';

// Clean up after each test
afterEach(() => {
  document.getElementById('gitlike-dialog')?.remove();
});

// ---------------------------------------------------------------------------
// showAlert
// ---------------------------------------------------------------------------

describe('showAlert', () => {
  it('creates a dialog overlay in the DOM', () => {
    showAlert('Hello');
    const overlay = document.getElementById('gitlike-dialog');
    expect(overlay).not.toBeNull();
  });

  it('displays the message', () => {
    showAlert('Test message');
    const msg = document.querySelector('.dialog-message');
    expect(msg?.textContent).toBe('Test message');
  });

  it('resolves when OK is clicked', async () => {
    const p = showAlert('Click OK');
    const btn = document.querySelector('.modal-actions button') as HTMLButtonElement;
    expect(btn.textContent).toBe('OK');
    btn.click();
    await expect(p).resolves.toBeUndefined();
  });

  it('removes overlay on OK click', async () => {
    const p = showAlert('Click OK');
    const btn = document.querySelector('.modal-actions button') as HTMLButtonElement;
    btn.click();
    await p;
    expect(document.getElementById('gitlike-dialog')).toBeNull();
  });

  it('shows a custom title when provided', () => {
    showAlert('msg', 'Warning');
    const h2 = document.querySelector('.dialog-modal h2');
    expect(h2?.textContent).toBe('Warning');
  });
});

// ---------------------------------------------------------------------------
// showConfirm
// ---------------------------------------------------------------------------

describe('showConfirm', () => {
  it('resolves true when OK is clicked', async () => {
    const p = showConfirm('Continue?');
    const buttons = document.querySelectorAll('.modal-actions button');
    const okBtn = buttons[1] as HTMLButtonElement; // OK is second
    okBtn.click();
    expect(await p).toBe(true);
  });

  it('resolves false when Cancel is clicked', async () => {
    const p = showConfirm('Continue?');
    const buttons = document.querySelectorAll('.modal-actions button');
    const cancelBtn = buttons[0] as HTMLButtonElement; // Cancel is first
    cancelBtn.click();
    expect(await p).toBe(false);
  });

  it('displays the message', () => {
    showConfirm('Are you sure?');
    const msg = document.querySelector('.dialog-message');
    expect(msg?.textContent).toBe('Are you sure?');
  });

  it('has Cancel and OK buttons', () => {
    showConfirm('Test');
    const buttons = document.querySelectorAll('.modal-actions button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Cancel');
    expect(buttons[1].textContent).toBe('OK');
  });
});

// ---------------------------------------------------------------------------
// showPrompt
// ---------------------------------------------------------------------------

describe('showPrompt', () => {
  it('resolves with input value on OK click', async () => {
    const p = showPrompt('Name:', 'default');
    const input = document.querySelector('.dialog-modal input') as HTMLInputElement;
    input.value = 'Alice';
    const buttons = document.querySelectorAll('.modal-actions button');
    const okBtn = buttons[1] as HTMLButtonElement;
    okBtn.click();
    expect(await p).toBe('Alice');
  });

  it('resolves null on Cancel click', async () => {
    const p = showPrompt('Name:');
    const buttons = document.querySelectorAll('.modal-actions button');
    const cancelBtn = buttons[0] as HTMLButtonElement;
    cancelBtn.click();
    expect(await p).toBeNull();
  });

  it('pre-fills the default value', () => {
    showPrompt('Commit message:', 'Edit file.ts');
    const input = document.querySelector('.dialog-modal input') as HTMLInputElement;
    expect(input.getAttribute('value')).toBe('Edit file.ts');
  });

  it('displays the message', () => {
    showPrompt('Enter something');
    const msg = document.querySelector('.dialog-message');
    expect(msg?.textContent).toBe('Enter something');
  });
});

// ---------------------------------------------------------------------------
// showSelect
// ---------------------------------------------------------------------------

describe('showSelect', () => {
  it('resolves with selected option value', async () => {
    const p = showSelect('Pick one', [
      { label: 'Option A', value: 'a' },
      { label: 'Option B', value: 'b' },
    ]);
    const optionBtns = document.querySelectorAll('.dialog-option-btn');
    expect(optionBtns.length).toBe(2);
    (optionBtns[1] as HTMLButtonElement).click();
    expect(await p).toBe('b');
  });

  it('resolves null on Cancel click', async () => {
    const p = showSelect('Pick one', [{ label: 'Option A', value: 'a' }]);
    const cancelBtn = document.querySelector('.modal-actions button') as HTMLButtonElement;
    cancelBtn.click();
    expect(await p).toBeNull();
  });

  it('shows option labels', () => {
    showSelect('Pick', [
      { label: 'Alpha', value: '1' },
      { label: 'Beta', value: '2' },
    ]);
    const btns = document.querySelectorAll('.dialog-option-btn');
    expect(btns[0].textContent).toBe('Alpha');
    expect(btns[1].textContent).toBe('Beta');
  });

  it('shows input field when placeholder is provided', () => {
    showSelect('Pick', [{ label: 'A', value: 'a' }], 'Enter custom...');
    const input = document.querySelector('.dialog-modal input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Enter custom...');
  });

  it('does not show input field when no placeholder', () => {
    showSelect('Pick', [{ label: 'A', value: 'a' }]);
    const input = document.querySelector('.dialog-modal input');
    expect(input).toBeNull();
  });
});
