// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllOverlays } from '../src/ui/dom';
import { transferGuide } from '../src/ui/gallery';

afterEach(() => {
  closeAllOverlays();
  document.body.replaceChildren();
});

describe('transfer guide', () => {
  it('describes exporting, moving, and importing a backup without implying replacement', () => {
    const guide = transferGuide();
    document.body.append(guide);

    expect(guide.querySelectorAll('ol > li')).toHaveLength(3);
    expect(guide.textContent).toContain('Export projects');
    expect(guide.textContent).toContain('.pardots');
    expect(guide.textContent).toContain('Import projects');
    expect(guide.textContent).toContain('never replaces projects already on the device');
  });
});
