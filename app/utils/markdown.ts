export type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string; level: 1 | 2 | 3 | 4 }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string };

export function markdownBlocks(markdown: string | null | undefined): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = String(markdown ?? '').replace(/\r/g, '').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };
  const flushCode = () => {
    if (code) blocks.push({ type: 'code', text: code.join('\n') });
    code = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      code ? flushCode() : (code = []);
    } else if (code) {
      code.push(rawLine);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const item = /^[-*]\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, text: heading[2] });
      } else if (item) {
        flushParagraph();
        list.push(item[1]);
      } else {
        paragraph.push(line);
      }
    }
  }
  flushParagraph();
  flushList();
  flushCode();
  return blocks.length ? blocks : [{ type: 'paragraph', text: '(empty markdown)' }];
}
