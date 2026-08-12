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
  srcDir: '.',
  compatibilityDate: '2026-08-12',
  typescript: {
    strict: true,
  },
});
