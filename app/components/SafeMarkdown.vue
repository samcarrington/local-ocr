<script setup lang="ts">
import createDOMPurify from 'dompurify';
import { markdownSanitiseConfig, renderMarkdown } from '../utils/markdown';

const props = defineProps<{ markdown: string }>();
const purifier = createDOMPurify(window);
const html = computed(() =>
  renderMarkdown(
    props.markdown,
    (dirtyHtml) => purifier.sanitize(dirtyHtml, markdownSanitiseConfig),
    document,
  ),
);
</script>

<template>
  <div class="markdown-render" aria-live="polite" v-html="html" />
</template>
