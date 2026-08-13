<script setup lang="ts">
import type { ReviewPage } from '../utils/review';

defineProps<{
  pages: ReviewPage[];
  currentPageNumber: number;
  busy: boolean;
}>();

const emit = defineEmits<{
  previous: [];
  next: [];
  select: [pageNumber: number];
}>();
</script>

<template>
  <nav class="page-nav" aria-label="Pages">
    <button type="button" :disabled="busy || currentPageNumber === pages[0]?.pageNumber" @click="emit('previous')">
      Previous
    </button>
    <ol class="page-list">
      <li v-for="page in pages" :key="page.pageNumber">
        <button
          type="button"
          :class="{
            active: page.pageNumber === currentPageNumber,
            accepted: page.accepted,
            pending: !page.accepted && page.status === 'pending',
          }"
          :aria-current="page.pageNumber === currentPageNumber ? 'page' : undefined"
          :disabled="busy"
          @click="emit('select', page.pageNumber)"
        >
          {{ page.pageNumber }}
        </button>
      </li>
    </ol>
    <button type="button" :disabled="busy || currentPageNumber === pages[pages.length - 1]?.pageNumber" @click="emit('next')">
      Next
    </button>
  </nav>
</template>
