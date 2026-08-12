<script setup lang="ts">
defineProps<{ status: string }>();
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="app-mark">LOCAL / OCR BENCH</p>
        <h1>Local OCR Review</h1>
        <p class="subtitle">Review one page at time. Accept good pages. Commit when ready.</p>
      </div>
      <p id="status-banner" class="status-banner" role="status" aria-live="polite">{{ status }}</p>
    </header>

    <main class="layout">
      <aside class="panel sidebar">
        <slot name="inbox" />
      </aside>
      <section class="panel reviewer" aria-labelledby="review-heading">
        <slot />
      </section>
    </main>

    <footer class="app-footer">
      <p>Local review workspace</p>
      <p>Files remain on this machine</p>
    </footer>
  </div>
</template>
