import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('document reviewer layout', () => {
  it('marks document review content for a single full-width grid column', () => {
    const component = readFileSync(path.resolve('app/components/Reviewer.vue'), 'utf8');
    const stylesheet = readFileSync(path.resolve('app/assets/css/workbench.css'), 'utf8');

    expect(component).toContain(`'content-grid--document': isDocument`);
    expect(component).toContain('Only formats supported by this engine can be selected.');
    expect(stylesheet).toContain('.content-grid--document {\n  grid-template-columns: minmax(0, 1fr);');
  });
});
