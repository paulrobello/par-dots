// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateNotice } from '../src/ui/updateNotice';

afterEach(() => document.body.replaceChildren());

describe('update notice', () => {
  it('starts hidden and toggles visibility through its API', () => {
    const notice = createUpdateNotice(vi.fn());
    const root = document.querySelector('.update-notice') as HTMLElement;
    expect(root.hidden).toBe(true);
    expect(root.textContent).toContain('Update available');
    notice.setVisible(true);
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    notice.setVisible(false);
    expect(root.hidden).toBe(true);
    notice.dispose();
    expect(document.querySelector('.update-notice')).toBeNull();
  });

  it('sets a busy state and invokes reload at most once', () => {
    const onReload = vi.fn();
    const notice = createUpdateNotice(onReload);
    const root = document.querySelector('.update-notice') as HTMLElement;
    const button = root.querySelector('button') as HTMLButtonElement;
    notice.setVisible(true);
    notice.setBusy(true);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Reloading…');
    notice.setBusy(false);
    button.click();
    button.click();
    expect(onReload).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
  });

  it('supports an optional error message', () => {
    const notice = createUpdateNotice(vi.fn());
    const root = document.querySelector('.update-notice') as HTMLElement;
    notice.setError('Reload failed');
    expect(root.textContent).toContain('Reload failed');
    expect(root.classList.contains('update-notice-error')).toBe(true);
    notice.setError(null);
    expect(root.textContent).toContain('Update available');
    expect(root.classList.contains('update-notice-error')).toBe(false);
  });
});
