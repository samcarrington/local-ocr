import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('application error panel', () => {
  it('renders a distinct, acknowledged alert for client request failures', () => {
    const component = readFileSync(path.resolve('app/components/AppShell.vue'), 'utf8');
    const stylesheet = readFileSync(path.resolve('app/assets/css/workbench.css'), 'utf8');

    expect(component).toContain('class="error-panel" role="alert" aria-atomic="true"');
    expect(component).toContain("@click=\"emit('dismissError')\"");
    expect(component).toContain('Acknowledge error');
    expect(stylesheet).toContain('.error-panel {');
    expect(stylesheet).toContain('border-left-width: 4px;');
  });
});
