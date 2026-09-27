import { describe, expect, it } from 'vitest';

import { routePageView } from '../src/analytics';

describe('routePageView', () => {
  it('maps hash routes to GA page paths', () => {
    expect(routePageView('#/play/abc/2')).toEqual({ page_path: '/play/abc/2' });
    expect(routePageView('#/')).toEqual({ page_path: '/' });
    expect(routePageView('')).toEqual({ page_path: '/' });
  });
});
