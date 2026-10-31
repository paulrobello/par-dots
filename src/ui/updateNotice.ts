import './updateNotice.css';

export interface UpdateNotice {
  setVisible(visible: boolean): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
  dispose(): void;
}

/** Create the non-modal notice used when a newer application build is available. */
export function createUpdateNotice(onReload: () => void): UpdateNotice {
  const root = document.createElement('div');
  root.className = 'update-notice';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;

  const message = document.createElement('span');
  message.className = 'update-notice-message';
  message.textContent = 'Update available';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = 'Reload';
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    onReload();
  });
  root.append(message, button);
  document.body.append(root);

  return {
    setVisible(visible) {
      root.hidden = !visible;
      root.setAttribute('aria-hidden', String(!visible));
    },
    setBusy(busy) {
      button.disabled = busy;
      root.setAttribute('aria-busy', String(busy));
      button.textContent = busy ? 'Reloading…' : 'Reload';
    },
    setError(error) {
      root.classList.toggle('update-notice-error', Boolean(error));
      message.textContent = error ?? 'Update available';
    },
    dispose() {
      root.remove();
    },
  };
}
