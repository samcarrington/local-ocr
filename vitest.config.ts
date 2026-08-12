import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'src',
    environment: 'node',
    include: ['src/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
