import { marked } from 'marked';

export const markdownSanitiseConfig = {
  ALLOWED_TAGS: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'hr', 'img', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td',
    'th', 'thead', 'tr', 'ul',
  ],
  ALLOWED_ATTR: ['alt', 'href', 'src', 'title'],
} as const;

export function renderMarkdown(
  markdown: string | null | undefined,
  sanitise: (html: string) => string,
  document: Document,
): string {
  const source = String(markdown ?? '').trim();
  const rendered = source
    ? marked.parse(source, { async: false, gfm: true, breaks: false })
    : '<p>(empty markdown)</p>';
  const template = document.createElement('template');
  template.innerHTML = sanitise(rendered);

  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!isLocalRelativeUrl(anchor.getAttribute('href'), true)) {
      anchor.removeAttribute('href');
    }
  }

  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (!isLocalRelativeUrl(image.getAttribute('src'), false)) {
      image.remove();
    }
  }

  return template.innerHTML;
}

function isLocalRelativeUrl(value: string | null, allowFragment: boolean): boolean {
  if (!value) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value).trim();
  } catch {
    return false;
  }

  if (allowFragment && decoded.startsWith('#')) return true;

  return !/^(?:[a-z][a-z\d+.-]*:|[\\/]|\/\/)/i.test(decoded) &&
    !/[\r\n]/.test(decoded);
}
