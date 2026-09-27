/**
 * GA4 analytics: lazy-loads gtag.js, suppresses its automatic page view, and lets main.ts
 * report one page view per hash route render instead. Absent a CSP nonce this is done from
 * TypeScript because the stock snippet's inline init script would violate the production CSP.
 */

const MEASUREMENT_ID = 'G-C4YDPPY021';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export interface PageView {
  page_path: string;
}

/** GA page path for a hash route, e.g. `#/play/abc/2` → `/play/abc/2`; no hash → `/`. */
export function routePageView(hash: string): PageView {
  return { page_path: `/${hash.replace(/^#\/?/, '')}` };
}

let started = false;

/** Sets up gtag and injects the measurement script; a no-op after the first call. */
export function initAnalytics(): void {
  if (started) return;
  started = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag('js', new Date());
  // main.ts reports one page_view per route render, including the first.
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
}

/** Reports the current route as a page view; call after each route render. */
export function trackPageView(): void {
  if (!started) return;
  window.gtag?.('event', 'page_view', routePageView(location.hash));
}
