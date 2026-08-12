import { describe, expect, it } from 'vitest';
import { markdownBlocks } from './markdown';

describe('markdownBlocks', () => {
  it('renders supported markdown as inert text blocks', () => {
    expect(markdownBlocks('# Heading\n\n- <img src=x>\n- item\n\n```js\n<script>x</script>\n```')).toEqual([
      { type: 'heading', level: 1, text: 'Heading' },
      { type: 'list', items: ['<img src=x>', 'item'] },
      { type: 'code', text: '<script>x</script>' },
    ]);
  });

  it('shows a safe empty state for blank markdown', () => {
    expect(markdownBlocks('')).toEqual([{ type: 'paragraph', text: '(empty markdown)' }]);
  });
});
