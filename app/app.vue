<script setup lang="ts">
import { useOcrReview } from './composables/useOcrReview';

const {
  pdfs,
  documents,
  selectedFile,
  job,
  currentPageNumber,
  loading,
  status,
  error,
  selectedEngine,
  loadInbox,
  startJob,
  selectEngine,
  rerunCurrentPage,
  acceptCurrentPage,
  commitCurrentJob,
  discardCurrentJob,
  movePage,
  selectPage,
  dismissError,
} = useOcrReview();

onMounted(() => {
  void loadInbox();
});
</script>

<template>
  <AppShell :status="status" :error="error" @dismiss-error="dismissError">
    <template #inbox>
      <InboxList :pdfs="pdfs" :documents="documents" :selected-file="selectedFile" :busy="loading" @refresh="loadInbox"
        @start="startJob" />
    </template>

    <Reviewer :job="job" :current-page-number="currentPageNumber" :selected-engine="selectedEngine" :busy="loading"
      @select-engine="selectEngine" @rerun="rerunCurrentPage" @accept="acceptCurrentPage" @commit="commitCurrentJob"
      @discard="discardCurrentJob" @previous="movePage(-1)" @next="movePage(1)" @select-page="selectPage" />
  </AppShell>
</template>
