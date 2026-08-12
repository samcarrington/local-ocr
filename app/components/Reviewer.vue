<script setup lang="ts">
import type { ReviewJob } from '../utils/review';

const props = defineProps<{
  job: ReviewJob | null;
  currentPageNumber: number;
  selectedEngine: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  selectEngine: [engine: string];
  rerun: [];
  accept: [];
  commit: [];
  discard: [];
  previous: [];
  next: [];
  selectPage: [pageNumber: number];
}>();

const page = computed(() => props.job?.pages.find((candidate) => candidate.pageNumber === props.currentPageNumber));
const isDocument = computed(() => props.job?.kind === 'document');
const acceptedCount = computed(() => props.job?.pages.filter((candidate) => candidate.accepted).length ?? 0);
const fileName = computed(() => props.job?.sourceFilePath.split(/[\\/]/).pop() ?? '');
const previewUrl = computed(() =>
  page.value && props.job
    ? `/api/jobs/${encodeURIComponent(props.job.id)}/pages/${page.value.pageNumber}/preview?ts=${Date.now()}`
    : '',
);
const warning = computed(() => page.value?.qualityWarnings?.find((candidate) => candidate.type === 'low-native-coverage'));
</script>

<template>
  <div class="panel-header review-header">
    <div>
      <h2 id="review-heading">Review</h2>
      <p class="muted">{{ job ? `${fileName} · job ${job.id}` : 'No job loaded.' }}</p>
    </div>
    <div class="action-row">
      <button type="button" :disabled="!job || !acceptedCount || busy" @click="emit('commit')">Commit accepted</button>
      <button type="button" class="danger" :disabled="!job || busy" @click="emit('discard')">Discard draft</button>
    </div>
  </div>

  <div v-if="!job || !page" class="empty-state"><p>Select PDF from inbox to start review.</p></div>

  <div v-else>
    <div class="progress-row" aria-live="polite">
      <p>{{ acceptedCount }} of {{ job.pages.length }} accepted</p>
      <p class="muted">{{ isDocument ? 'Whole document' : `Page ${page.pageNumber} of ${job.pages.length}` }}</p>
    </div>
    <div class="toolbar">
      <label v-if="!isDocument" class="field" aria-label="Page review controls">
        <span>OCR adapter</span>
        <select :value="selectedEngine" :disabled="busy" @change="emit('selectEngine', ($event.target as HTMLSelectElement).value)">
          <option value="tesseract">tesseract</option>
          <option value="deepseek-ocr">deepseek-ocr</option>
          <option value="glm-ocr">glm-ocr</option>
          <option value="nuextract3-ocr">nuextract3-ocr</option>
        </select>
      </label>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="emit('rerun')">{{ isDocument ? 'Reconvert document' : 'Rerun page' }}</button>
        <button type="button" class="primary" :disabled="busy || page.accepted" @click="emit('accept')">
          {{ isDocument ? 'Accept document' : 'Accept page' }}
        </button>
      </div>
    </div>

    <div class="content-grid" :class="{ 'content-grid--document': isDocument }">
      <section v-if="!isDocument" class="preview-panel" aria-labelledby="preview-heading">
        <div class="section-header">
          <h3 id="preview-heading">Source preview</h3>
          <p class="muted">{{ typeof page.confidence === 'number' ? `Confidence ${Math.round(page.confidence * 100)}%` : '' }}</p>
        </div>
        <img id="page-preview" :src="previewUrl" :alt="`Preview of page ${page.pageNumber} from ${fileName}`">
      </section>
      <section class="markdown-panel" aria-labelledby="markdown-heading">
        <div class="section-header">
          <h3 id="markdown-heading">Current markdown</h3>
          <p class="muted">Engine {{ page.engine }}</p>
        </div>
        <section v-if="warning" class="warning-panel" aria-live="polite">
          <h4>Possibly missing from OCR</h4>
          <p class="warning-message">{{ warning.message }}</p>
          <ul class="warning-snippets"><li v-for="snippet in warning.missingSnippets ?? []" :key="snippet">{{ snippet }}</li></ul>
        </section>
        <SafeMarkdown :markdown="page.markdown" />
        <details><summary>Raw markdown</summary><pre>{{ page.markdown || '(empty markdown)' }}</pre></details>
      </section>
    </div>
    <PageNavigation
      v-if="!isDocument"
      :pages="job.pages"
      :current-page-number="currentPageNumber"
      :busy="busy"
      @previous="emit('previous')"
      @next="emit('next')"
      @select="emit('selectPage', $event)"
    />
  </div>
</template>
