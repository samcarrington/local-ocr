import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { markdownSanitiseConfig, renderMarkdown } from './markdown';

function render(source: string) {
  const window = new JSDOM('').window;
  const purifier = createDOMPurify(window);
  return renderMarkdown(
    source,
    (html) => purifier.sanitize(html, markdownSanitiseConfig),
    window.document,
  );
}

describe('renderMarkdown', () => {
  it('renders the supported GFM preview syntax', () => {
    expect(render('# Heading\n\n**strong** and *emphasis*\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```'))
      .toContain('<h1>Heading</h1>');
    expect(render('**strong** and *emphasis*')).toContain('<strong>strong</strong>');
    expect(render('**strong** and *emphasis*')).toContain('<em>emphasis</em>');
    expect(render('| A | B |\n| - | - |\n| 1 | 2 |')).toContain('<table>');
    expect(render('```ts\nconst x = 1;\n```')).toContain('<pre><code>const x = 1;\n</code></pre>');
  });

  it('removes hostile HTML and unsafe URLs', () => {
    const html = render(
      '<script>alert(1)</script><img src=x onerror=alert(1)>\n\n' +
      '[bad](javascript:alert(1)) [remote](https://example.com)\n\n' +
      '![remote](https://example.com/image.png) ![local](images/page.png)',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('https://example.com');
    expect(html).toContain('<a>bad</a>');
    expect(html).toContain('<a>remote</a>');
    expect(html).toContain('<img src="images/page.png" alt="local">');
  });

  it('retains local-relative links and fragment links', () => {
    const html = render('[figure](images/page.png) [section](#review)');

    expect(html).toContain('<a href="images/page.png">figure</a>');
    expect(html).toContain('<a href="#review">section</a>');
  });
});
