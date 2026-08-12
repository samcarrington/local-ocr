<script setup lang="ts">
import { markdownBlocks } from '../utils/markdown';

const props = defineProps<{ markdown: string }>();
const blocks = computed(() => markdownBlocks(props.markdown));
</script>

<template>
  <div class="markdown-render" aria-live="polite">
    <template v-for="(block, index) in blocks" :key="index">
      <component :is="`h${block.level}`" v-if="block.type === 'heading'">{{ block.text }}</component>
      <ul v-else-if="block.type === 'list'">
        <li v-for="item in block.items" :key="item">{{ item }}</li>
      </ul>
      <pre v-else-if="block.type === 'code'">{{ block.text }}</pre>
      <p v-else>{{ block.text }}</p>
    </template>
  </div>
</template>
