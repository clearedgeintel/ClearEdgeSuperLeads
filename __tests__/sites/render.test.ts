// The renderer is ported unchanged from Instant Site; these snapshots pin its
// output so the Phase 3 renderer changes (demo/live mode) show up as diffs.

import { renderSite } from '../../server/sites/template/render';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import { THEMES_LIST } from '../../shared/sites';

describe('renderSite (ported unchanged)', () => {
  test.each(THEMES_LIST)('sample data, %s theme', (theme) => {
    expect(renderSite(SAMPLE_BUSINESS, theme)).toMatchSnapshot();
  });

  test('with form, page URL and pixel', () => {
    expect(
      renderSite(SAMPLE_BUSINESS, 'slate', {
        submitUrl: '/s/sample/contact',
        pageUrl: 'https://sites.example.com/s/sample',
        pixelUrl: 'https://sites.example.com/s/sample/pixel.gif',
      })
    ).toMatchSnapshot();
  });

  test('escapes HTML in business data', () => {
    const html = renderSite(
      { ...SAMPLE_BUSINESS, name: '<script>alert(1)</script>', tagline: '"quoted" & <b>' },
      'clean'
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
  });

  test('no phone: no tel: links', () => {
    expect(renderSite({ ...SAMPLE_BUSINESS, phone: null }, 'warm')).not.toContain('href="tel:');
  });
});
