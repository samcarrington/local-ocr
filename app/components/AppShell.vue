<script setup lang="ts">
import type { ReviewError } from '../composables/useOcrReview';

defineProps<{
  status: string;
  error: ReviewError | null;
}>();

const emit = defineEmits<{
  dismissError: [];
}>();
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

    <section v-if="error" class="error-panel" role="alert" aria-atomic="true">
      <div>
        <h2>Could not complete {{ error.operation }}</h2>
        <p>{{ error.message }}</p>
        <p class="muted">{{ error.recoveryAction }}</p>
      </div>
      <button type="button" @click="emit('dismissError')">Acknowledge error</button>
    </section>

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
