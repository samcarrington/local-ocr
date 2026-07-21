const state = {
  pdfs: [],
  selectedPdf: '',
  job: null,
  currentPageNumber: 1,
  loading: false,
  selectedEngines: new Map()
};

const elements = {
  statusBanner: document.querySelector('#status-banner'),
  pdfList: document.querySelector('#pdf-list'),
  pdfListEmpty: document.querySelector('#pdf-list-empty'),
  refreshPdfs: document.querySelector('#refresh-pdfs'),
  emptyState: document.querySelector('#empty-state'),
  reviewState: document.querySelector('#review-state'),
  jobMeta: document.querySelector('#job-meta'),
  progressText: document.querySelector('#progress-text'),
  pagePosition: document.querySelector('#page-position'),
  adapterSelect: document.querySelector('#adapter-select'),
  rerunPage: document.querySelector('#rerun-page'),
  acceptPage: document.querySelector('#accept-page'),
  commitJob: document.querySelector('#commit-job'),
  discardJob: document.querySelector('#discard-job'),
  pagePreview: document.querySelector('#page-preview'),
  confidenceText: document.querySelector('#confidence-text'),
  engineText: document.querySelector('#engine-text'),
  warningPanel: document.querySelector('#warning-panel'),
  warningMessage: document.querySelector('#warning-message'),
  warningSnippets: document.querySelector('#warning-snippets'),
  markdownRender: document.querySelector('#markdown-render'),
  markdownRaw: document.querySelector('#markdown-raw'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageList: document.querySelector('#page-list')
};

elements.refreshPdfs.addEventListener('click', () => loadPdfs());
elements.rerunPage.addEventListener('click', () => rerunCurrentPage());
elements.adapterSelect.addEventListener('change', () => {
  const page = getCurrentPage();
  if (!state.job || !page) return;
  state.selectedEngines.set(pageEngineKey(state.job.id, page.pageNumber), elements.adapterSelect.value);
});
elements.acceptPage.addEventListener('click', () => acceptCurrentPage());
elements.commitJob.addEventListener('click', () => commitCurrentJob());
elements.discardJob.addEventListener('click', () => discardCurrentJob());
elements.previousPage.addEventListener('click', () => movePage(-1));
elements.nextPage.addEventListener('click', () => movePage(1));

void loadPdfs();

async function loadPdfs() {
  setStatus('Loading PDFs…');
  try {
    const response = await fetchJson('/api/pdfs');
    state.pdfs = Array.isArray(response.pdfs) ? response.pdfs : [];
    renderPdfList();
    setStatus(state.pdfs.length ? 'Select PDF to start review.' : 'No PDFs found in inbox.');
  } catch (error) {
    setStatus(readError(error));
  }
}

function renderPdfList() {
  elements.pdfList.innerHTML = '';
  elements.pdfListEmpty.hidden = state.pdfs.length > 0;

  for (const pdf of state.pdfs) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = pdf;
    button.className = pdf === state.selectedPdf ? 'active' : '';
    button.setAttribute('aria-pressed', String(pdf === state.selectedPdf));
    button.addEventListener('click', () => startJob(pdf));
    item.append(button);
    elements.pdfList.append(item);
  }
}

async function startJob(pdf) {
  if (state.job && state.job.status === 'pending_review' && readFileName(state.job.sourcePdfPath) === pdf) {
    state.selectedPdf = pdf;
    state.currentPageNumber = nextReviewPageNumber(state.job) ?? state.currentPageNumber;
    renderPdfList();
    render();
    setStatus(`Resumed existing review for ${pdf}.`);
    return;
  }

  state.selectedPdf = pdf;
  renderPdfList();
  setBusy(true, `Creating draft for ${pdf}…`);

  try {
    const response = await fetchJson('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdf })
    });

    state.job = response.job;
    state.currentPageNumber = nextReviewPageNumber(state.job) ?? 1;
    render();
    setStatus(response.resumed ? `Resumed existing review for ${pdf}.` : `Draft ready for ${pdf}.`);
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

async function rerunCurrentPage() {
  const page = getCurrentPage();
  if (!state.job || !page) return;
  const selectedEngine = readSelectedEngine(state.job.id, page);

  setBusy(true, `Rerunning page ${page.pageNumber}…`);
  try {
    const response = await fetchJson(`/api/jobs/${encodeURIComponent(state.job.id)}/pages/${page.pageNumber}/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine: selectedEngine })
    });

    state.job = response.job;
    state.selectedEngines.set(pageEngineKey(state.job.id, page.pageNumber), selectedEngine);
    render();
    setStatus(`Reran page ${page.pageNumber} with ${selectedEngine}.`);
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

async function acceptCurrentPage() {
  const page = getCurrentPage();
  if (!state.job || !page) return;

  setBusy(true, `Accepting page ${page.pageNumber}…`);
  try {
    const response = await fetchJson(`/api/jobs/${encodeURIComponent(state.job.id)}/pages/${page.pageNumber}/accept`, {
      method: 'POST'
    });

    state.job = response.job;
    state.currentPageNumber = nextReviewPageNumber(state.job) ?? page.pageNumber;
    render();
    setStatus(`Accepted page ${page.pageNumber}.`);
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

async function commitCurrentJob() {
  if (!state.job) return;

  setBusy(true, 'Committing accepted pages…');
  try {
    const response = await fetchJson(`/api/jobs/${encodeURIComponent(state.job.id)}/commit`, {
      method: 'POST'
    });

    state.job = response.job;
    render();
    setStatus(`Committed accepted pages to ${response.outputPath}.`);
    await loadPdfs();
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

async function discardCurrentJob() {
  if (!state.job) return;

  const jobId = state.job.id;
  setBusy(true, 'Discarding draft…');
  try {
    await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    state.job = null;
    state.currentPageNumber = 1;
    render();
    setStatus('Draft discarded.');
    await loadPdfs();
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

function movePage(delta) {
  if (!state.job) return;
  const index = state.job.pages.findIndex((page) => page.pageNumber === state.currentPageNumber);
  const nextPage = state.job.pages[index + delta];
  if (!nextPage) return;
  state.currentPageNumber = nextPage.pageNumber;
  render();
}

function render() {
  const job = state.job;
  const page = getCurrentPage();
  const acceptedCount = job ? job.pages.filter((candidate) => candidate.accepted).length : 0;

  elements.emptyState.hidden = Boolean(job);
  elements.reviewState.hidden = !job;
  elements.commitJob.disabled = !job || acceptedCount < 1 || state.loading;
  elements.discardJob.disabled = !job || state.loading;

  if (!job || !page) {
    elements.jobMeta.textContent = 'No job loaded.';
    return;
  }

  elements.jobMeta.textContent = `${readFileName(job.sourcePdfPath)} · job ${job.id}`;
  elements.progressText.textContent = `${acceptedCount} of ${job.pages.length} accepted`;
  elements.pagePosition.textContent = `Page ${page.pageNumber} of ${job.pages.length}`;
  elements.previousPage.disabled = state.loading || page.pageNumber === job.pages[0]?.pageNumber;
  elements.nextPage.disabled = state.loading || page.pageNumber === job.pages[job.pages.length - 1]?.pageNumber;
  elements.rerunPage.disabled = state.loading;
  elements.acceptPage.disabled = state.loading || page.accepted;

  elements.pagePreview.src = previewUrl(job.id, page.pageNumber);
  elements.pagePreview.alt = `Preview of page ${page.pageNumber} from ${readFileName(job.sourcePdfPath)}`;
  elements.confidenceText.textContent = typeof page.confidence === 'number'
    ? `Confidence ${Math.round(page.confidence * 100)}%`
    : '';
  elements.engineText.textContent = `Engine ${page.engine}`;
  renderWarnings(page);
  elements.markdownRaw.textContent = page.markdown || '(empty markdown)';
  elements.markdownRender.replaceChildren(renderMarkdown(page.markdown));
  elements.adapterSelect.value = readSelectedEngine(job.id, page);

  renderPageList(job, page.pageNumber);
}

function renderWarnings(page) {
  const warning = Array.isArray(page.qualityWarnings)
    ? page.qualityWarnings.find((candidate) => candidate.type === 'low-native-coverage')
    : null;

  elements.warningSnippets.replaceChildren();

  if (!warning) {
    elements.warningPanel.hidden = true;
    elements.warningMessage.textContent = '';
    return;
  }

  elements.warningPanel.hidden = false;
  elements.warningMessage.textContent = warning.message;

  for (const snippet of warning.missingSnippets || []) {
    const item = document.createElement('li');
    item.textContent = snippet;
    elements.warningSnippets.append(item);
  }
}

function renderPageList(job, activePageNumber) {
  elements.pageList.innerHTML = '';

  for (const page of job.pages) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(page.pageNumber);
    button.className = [
      page.pageNumber === activePageNumber ? 'active' : '',
      page.accepted ? 'accepted' : page.status === 'pending' ? 'pending' : ''
    ].filter(Boolean).join(' ');
    button.setAttribute('aria-current', page.pageNumber === activePageNumber ? 'page' : 'false');
    button.addEventListener('click', () => {
      state.currentPageNumber = page.pageNumber;
      render();
    });
    item.append(button);
    elements.pageList.append(item);
  }
}

function getCurrentPage() {
  return state.job?.pages.find((page) => page.pageNumber === state.currentPageNumber) ?? null;
}

function nextReviewPageNumber(job) {
  return job.pages.find((page) => !page.accepted)?.pageNumber ?? job.pages[0]?.pageNumber ?? null;
}

function previewUrl(jobId, pageNumber) {
  return `/api/jobs/${encodeURIComponent(jobId)}/pages/${pageNumber}/preview?ts=${Date.now()}`;
}

function readSelectedEngine(jobId, page) {
  const key = pageEngineKey(jobId, page.pageNumber);
  const storedEngine = state.selectedEngines.get(key);
  if (storedEngine) return storedEngine;
  return page.engine === 'native' ? 'tesseract' : page.engine;
}

function pageEngineKey(jobId, pageNumber) {
  return `${jobId}:${pageNumber}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

function setStatus(message) {
  elements.statusBanner.textContent = message;
}

function setBusy(value, message) {
  state.loading = value;
  if (message) {
    setStatus(message);
  }
  render();
}

function readError(error) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function readFileName(filePath) {
  return String(filePath).split(/[\\/]/).pop() || filePath;
}

function renderMarkdown(markdown) {
  const container = document.createElement('div');
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  let paragraph = [];
  let list = null;
  let codeBlock = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const node = document.createElement('p');
    node.textContent = paragraph.join(' ');
    container.append(node);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    container.append(list);
    list = null;
  };

  const flushCodeBlock = () => {
    if (!codeBlock) return;
    const pre = document.createElement('pre');
    pre.textContent = codeBlock.join('\n');
    container.append(pre);
    codeBlock = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      if (codeBlock) {
        flushCodeBlock();
      } else {
        codeBlock = [];
      }
      continue;
    }

    if (codeBlock) {
      codeBlock.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length, 4);
      const heading = document.createElement(`h${level}`);
      heading.textContent = headingMatch[2];
      container.append(heading);
      continue;
    }

    const listMatch = /^[-*]\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      if (!list) {
        list = document.createElement('ul');
      }
      const item = document.createElement('li');
      item.textContent = listMatch[1];
      list.append(item);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  if (!container.childNodes.length) {
    const empty = document.createElement('p');
    empty.textContent = '(empty markdown)';
    container.append(empty);
  }

  return container;
}
