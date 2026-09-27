/**
 * PWA install flow: captures the browser's install prompt where supported, falls back to
 * Add to Home Screen steps, and nudges mobile players once on their first panel.
 */

import { h, openSheet, toast } from './dom';

const DISMISSED_KEY = 'par-dots:install-prompt-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

/** Capture the browser's install prompt (Chromium/Android) so a button can trigger it later. */
export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
  });
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isMobile(): boolean {
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOs;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable: the prompt may show again next visit.
  }
}

/** Run the install flow: native prompt where available, else Add to Home Screen steps. */
export async function installApp(): Promise<void> {
  if (isStandalone()) {
    toast('par-dots is already installed');
    return;
  }
  if (deferred) {
    const ev = deferred;
    deferred = null;
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
    return;
  }
  openSheet(
    'Install par-dots',
    h(
      'div',
      { class: 'install-steps' },
      isIos()
        ? h(
            'ol',
            {},
            h('li', {}, 'Tap the ', h('strong', {}, 'Share'), ' button in Safari.'),
            h('li', {}, 'Choose ', h('strong', {}, 'Add to Home Screen'), '.'),
            h('li', {}, 'Open par-dots from your home screen.'),
          )
        : h(
            'ol',
            {},
            h('li', {}, 'Open your browser menu.'),
            h(
              'li',
              {},
              'Choose ',
              h('strong', {}, 'Install app'),
              ' or ',
              h('strong', {}, 'Add to Home screen'),
              '.',
            ),
            h('li', {}, 'Open par-dots from your home screen.'),
          ),
    ),
  );
}

/** Whether the app can still be installed (not already running installed). */
export function canOfferInstall(): boolean {
  return !isStandalone();
}

/** One-time nudge on first play: mobile browsers only, not when installed or already dismissed. */
export function maybePromptInstall(): void {
  if (!isMobile() || isStandalone() || readDismissed()) return;
  writeDismissed();
  const install = h('button', { type: 'button', class: 'btn primary' }, 'Install');
  const later = h('button', { type: 'button', class: 'btn ghost' }, 'Maybe later');
  const s = openSheet(
    'Better as an app',
    h(
      'div',
      { class: 'confirm' },
      h(
        'p',
        {},
        'par-dots looks and plays better when installed: full screen, no browser bars, and it works offline.',
      ),
      h('div', { class: 'row' }, later, install),
    ),
  );
  later.addEventListener('click', () => s.close());
  install.addEventListener('click', () => {
    s.close();
    void installApp();
  });
}
