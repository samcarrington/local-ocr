import { isDevelopmentWatchPathIgnored } from './src/nuxt-watch.js';

export default defineNuxtConfig({
  ssr: false,
  nitro: {
    preset: 'node-server',
    externals: {
      traceInclude: [
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      ],
    },
  },
  srcDir: './app',
  css: [
    '~/assets/css/tokens.css',
    '~/assets/css/workbench.css',
  ],
  experimental: {
    watcher: 'builder',
  },
  vite: {
    server: {
      watch: {
        ignored: (watchPath) => isDevelopmentWatchPathIgnored(watchPath),
      },
    },
  },
  compatibilityDate: '2026-08-12',
  typescript: {
    tsConfig: {
      compilerOptions: {
        // Nuxt Content currently generates .nuxt/content/components.ts with
        // untyped helper params, which strict typecheck flags as TS7006.
        // noImplicitAny: false,
      },
    },
  },
});
