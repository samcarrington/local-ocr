import { computed, ref } from 'vue';
import { nextReviewPageNumber, rerunRequest, reviewEngine, type ReviewJob } from '../utils/review';

type StartMode = 'pages' | 'document';
type ReviewOperation =
  | 'loading the inbox'
  | 'creating a draft'
  | 'rerunning the review'
  | 'accepting the review'
  | 'committing accepted pages'
  | 'discarding the draft';

export interface ReviewError {
  operation: ReviewOperation;
  message: string;
  recoveryAction: string;
}

export function useOcrReview() {
  const pdfs = ref<string[]>([]);
  const documents = ref<string[]>([]);
  const selectedFile = ref('');
  const job = ref<ReviewJob | null>(null);
  const currentPageNumber = ref(1);
  const loading = ref(false);
  const status = ref('Loading PDFs…');
  const error = ref<ReviewError | null>(null);
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
      setSuccessStatus(pdfs.value.length || documents.value.length ? 'Select an inbox file to start.' : 'No files found in inbox.');
    } catch (caught) {
      setError('loading the inbox', caught, 'Refresh inbox');
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
      setSuccessStatus(`Resumed existing review for ${file}.`);
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
      setSuccessStatus(response.resumed ? `Resumed existing review for ${file}.` : `Draft ready for ${file}.`);
    } catch (caught) {
      setError('creating a draft', caught, 'Try creating draft again');
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
      setSuccessStatus(isDocument ? 'Document reconverted.' : `Reran page ${page.pageNumber} with ${engine}.`);
    } catch (caught) {
      setError('rerunning the review', caught, 'Try the rerun again');
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
      setSuccessStatus(`Accepted page ${page.pageNumber}.`);
    } catch (caught) {
      setError('accepting the review', caught, 'Try accepting the page again');
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
      setSuccessStatus(`Committed accepted pages to ${response.outputPath}.`);
      await loadInbox();
    } catch (caught) {
      setError('committing accepted pages', caught, 'Try committing again');
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
      setSuccessStatus('Draft discarded.');
      await loadInbox();
    } catch (caught) {
      setError('discarding the draft', caught, 'Try discarding again');
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

  function setSuccessStatus(message: string) {
    error.value = null;
    setStatus(message);
  }

  function setError(
    operation: ReviewOperation,
    caught: unknown,
    recoveryAction: string,
  ) {
    error.value = {
      operation,
      message: readError(caught),
      recoveryAction,
    };
  }

  function dismissError() {
    error.value = null;
  }

  function setBusy(value: boolean, message?: string) {
    loading.value = value;
    if (message) setStatus(message);
  }

  return {
    pdfs, documents, selectedFile, job, currentPageNumber, loading, status, error, selectedEngine,
    loadInbox, startJob, selectEngine, rerunCurrentPage, acceptCurrentPage,
    commitCurrentJob, discardCurrentJob, movePage, selectPage, dismissError,
  };
}

function pageEngineKey(jobId: string, pageNumber: number) {
  return `${jobId}:${pageNumber}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new Error(safeServerMessage(data, response.status));
  }
  return data as T;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function safeServerMessage(data: unknown, status: number): string {
  const message =
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
      ? data.error.trim()
      : '';

  if (
    message &&
    message.length <= 240 &&
    !/[\r\n]|(?:file:|[a-z]:[\\/]|[\\/])/i.test(message)
  ) {
    return message;
  }

  return `Request failed with status ${status}.`;
}

function readFileName(filePath: string) {
  return String(filePath).split(/[\\/]/).pop() || filePath;
}
