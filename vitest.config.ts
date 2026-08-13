import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    environment: 'node',
    include: ['app/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage/app',
      include: ['app/**/*.ts'],
      exclude: ['app/**/*.test.ts'],
    },
  },
});
