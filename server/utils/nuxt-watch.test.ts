import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isDevelopmentWatchPathIgnored } from './nuxt-watch.js';

const rootDir = path.resolve('/workspace/local-ocr');

describe('Nuxt development watch paths', () => {
  it.each(['app', 'server', 'shared'])('watches the %s source tree', (directory) => {
    expect(isDevelopmentWatchPathIgnored(path.join(rootDir, directory, 'example.ts'), rootDir)).toBe(false);
  });

  it.each([
    '.build-cache/uv/state.json',
    '.ocrtool/jobs/job.json',
    '.nuxt/nuxt.d.ts',
    '.output/server/index.mjs',
    'coverage/index.html',
    'docs/plan.md',
    'public/app.js',
  ])('ignores non-source path %s', (file) => {
    expect(isDevelopmentWatchPathIgnored(path.join(rootDir, file), rootDir)).toBe(true);
  });

  it('ignores paths outside the project root', () => {
    expect(isDevelopmentWatchPathIgnored('/workspace/elsewhere/file.ts', rootDir)).toBe(true);
  });
});
