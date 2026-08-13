<script setup lang="ts">
defineProps<{
  pdfs: string[];
  documents: string[];
  selectedFile: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  start: [file: string, mode: 'pages' | 'document'];
}>();
</script>

<template>
  <section class="inbox-list-panel" aria-labelledby="pdf-list-heading">
    <div class="panel-header">
      <h2 id="pdf-list-heading">Inbox PDFs</h2>
      <button type="button" :disabled="busy" @click="emit('refresh')">Refresh</button>
    </div>
    <ul id="pdf-list" class="pdf-list">
      <li v-for="pdf in pdfs" :key="pdf" class="inbox-file">
        <span class="file-name">{{ pdf }}</span>
        <div class="file-actions">
          <button
            type="button"
            class="file-action file-action-pages"
            :class="{ active: pdf === selectedFile }"
            :aria-label="`Review pages from ${pdf}`"
            :aria-pressed="pdf === selectedFile"
            :disabled="busy"
            @click="emit('start', pdf, 'pages')"
          >
            <span class="file-action-icon" aria-hidden="true" />
            <span>Review pages</span>
          </button>
          <button
            type="button"
            class="file-action file-action-convert"
            :aria-label="`Quickly convert ${pdf} with native document text`"
            :disabled="busy"
            @click="emit('start', pdf, 'document')"
          >
            <span class="file-action-icon" aria-hidden="true" />
            <span>Quick convert</span>
          </button>
        </div>
      </li>
    </ul>
    <p v-if="!pdfs.length" id="pdf-list-empty" class="muted">No PDFs found.</p>
  </section>

  <section class="inbox-list-panel" aria-labelledby="document-list-heading">
    <div class="panel-header">
      <h2 id="document-list-heading">Inbox Documents</h2>
    </div>
    <ul id="document-list" class="pdf-list">
      <li v-for="file in documents" :key="file">
        <button
          type="button"
          class="document-file"
          :class="{ active: file === selectedFile }"
          :disabled="busy"
          @click="emit('start', file, 'document')"
        >
          {{ file }}
        </button>
      </li>
    </ul>
    <p v-if="!documents.length" id="document-list-empty" class="muted">No documents found.</p>
  </section>
</template>
