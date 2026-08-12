import { computed, ref } from 'vue';
import { nextReviewPageNumber, rerunRequest, reviewEngine, type ReviewJob } from '../utils/review';

type StartMode = 'pages' | 'document';

export function useOcrReview() {
  const pdfs = ref<string[]>([]);
  const documents = ref<string[]>([]);
  const selectedFile = ref('');
  const job = ref<ReviewJob | null>(null);
  const currentPageNumber = ref(1);
  const loading = ref(false);
  const status = ref('Loading PDFs…');
  const selectedEngines = ref<Record<string, string>>({});

  const currentPage = computed(() =>
    job.value?.pages.find((page) => page.pageNumber === currentPageNumber.value) ?? null,
  );
  const selectedEngine = computed(() =>
    reviewEngine(job.value, currentPage.value, job.value && currentPage.value
      ? selectedEngines.value[pageEngineKey(job.value.id, currentPage.value.pageNumber)]
      : undefined),
  );

  async function loadInbox() {
    setStatus('Loading inbox…');
    try {
      const [pdfResponse, documentResponse] = await Promise.all([
        fetchJson<{ pdfs?: string[] }>('/api/pdfs'),
        fetchJson<{ documents?: string[] }>('/api/documents'),
      ]);
      pdfs.value = Array.isArray(pdfResponse.pdfs) ? pdfResponse.pdfs : [];
      documents.value = Array.isArray(documentResponse.documents) ? documentResponse.documents : [];
      setStatus(pdfs.value.length || documents.value.length ? 'Select an inbox file to start.' : 'No files found in inbox.');
    } catch (error) {
      setStatus(readError(error));
    }
  }

  async function startJob(file: string, mode: StartMode) {
    if (
      job.value?.status === 'pending_review' &&
      job.value.kind === (mode === 'pages' ? 'pdf-pages' : 'document') &&
      readFileName(job.value.sourceFilePath) === file
    ) {
      selectedFile.value = file;
      currentPageNumber.value = nextReviewPageNumber(job.value) ?? currentPageNumber.value;
      setStatus(`Resumed existing review for ${file}.`);
      return;
    }

    selectedFile.value = file;
    setBusy(true, `Creating draft for ${file}…`);
    try {
      const response = await fetchJson<{ job: ReviewJob; resumed?: boolean }>('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, mode }),
      });
      job.value = response.job;
      currentPageNumber.value = nextReviewPageNumber(response.job) ?? 1;
      setStatus(response.resumed ? `Resumed existing review for ${file}.` : `Draft ready for ${file}.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  function selectEngine(engine: string) {
    if (job.value && currentPage.value) {
      selectedEngines.value = {
        ...selectedEngines.value,
        [pageEngineKey(job.value.id, currentPage.value.pageNumber)]: engine,
      };
    }
  }

  async function rerunCurrentPage() {
    if (!job.value || !currentPage.value) return;
    const activeJob = job.value;
    const page = currentPage.value;
    const engine = selectedEngine.value;
    const isDocument = activeJob.kind === 'document';
    setBusy(true, isDocument ? 'Reconvert document…' : `Rerunning page ${page.pageNumber}…`);
    try {
      const [url, request] = rerunRequest(activeJob, page, engine);
      const response = await fetchJson<{ job: ReviewJob }>(url, request);
      job.value = response.job;
      if (!isDocument) {
        selectedEngines.value = {
          ...selectedEngines.value,
          [pageEngineKey(activeJob.id, page.pageNumber)]: engine,
        };
      }
      setStatus(isDocument ? 'Document reconverted.' : `Reran page ${page.pageNumber} with ${engine}.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function acceptCurrentPage() {
    if (!job.value || !currentPage.value) return;
    const activeJob = job.value;
    const page = currentPage.value;
    setBusy(true, `Accepting page ${page.pageNumber}…`);
    try {
      const response = await fetchJson<{ job: ReviewJob }>(
        `/api/jobs/${encodeURIComponent(activeJob.id)}/pages/${page.pageNumber}/accept`,
        { method: 'POST' },
      );
      job.value = response.job;
      currentPageNumber.value = nextReviewPageNumber(response.job) ?? page.pageNumber;
      setStatus(`Accepted page ${page.pageNumber}.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function commitCurrentJob() {
    if (!job.value) return;
    setBusy(true, 'Committing accepted pages…');
    try {
      const response = await fetchJson<{ job: ReviewJob; outputPath: string }>(
        `/api/jobs/${encodeURIComponent(job.value.id)}/commit`,
        { method: 'POST' },
      );
      job.value = response.job;
      setStatus(`Committed accepted pages to ${response.outputPath}.`);
      await loadInbox();
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function discardCurrentJob() {
    if (!job.value) return;
    const jobId = job.value.id;
    setBusy(true, 'Discarding draft…');
    try {
      await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      job.value = null;
      currentPageNumber.value = 1;
      setStatus('Draft discarded.');
      await loadInbox();
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  function movePage(delta: number) {
    if (!job.value) return;
    const index = job.value.pages.findIndex((page) => page.pageNumber === currentPageNumber.value);
    const nextPage = job.value.pages[index + delta];
    if (nextPage) currentPageNumber.value = nextPage.pageNumber;
  }

  function selectPage(pageNumber: number) {
    if (job.value?.pages.some((page) => page.pageNumber === pageNumber)) currentPageNumber.value = pageNumber;
  }

  function setStatus(message: string) {
    status.value = message;
  }

  function setBusy(value: boolean, message?: string) {
    loading.value = value;
    if (message) setStatus(message);
  }

  return {
    pdfs, documents, selectedFile, job, currentPageNumber, loading, status, selectedEngine,
    loadInbox, startJob, selectEngine, rerunCurrentPage, acceptCurrentPage,
    commitCurrentJob, discardCurrentJob, movePage, selectPage,
  };
}

function pageEngineKey(jobId: string, pageNumber: number) {
  return `${jobId}:${pageNumber}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Request failed with status ${response.status}`);
  return data as T;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function readFileName(filePath: string) {
  return String(filePath).split(/[\\/]/).pop() || filePath;
}
