const state = {
  pdfs: [],
  documents: [],
  selectedPdf: '',
  job: null,
  currentPageNumber: 1,
  loading: false,
  selectedEngines: new Map(),
};

const elements = {
  statusBanner: document.querySelector('#status-banner'),
  pdfList: document.querySelector('#pdf-list'),
  pdfListEmpty: document.querySelector('#pdf-list-empty'),
  documentList: document.querySelector('#document-list'),
  documentListEmpty: document.querySelector('#document-list-empty'),
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
  previewPanel: document.querySelector('#preview-panel'),
  confidenceText: document.querySelector('#confidence-text'),
  engineText: document.querySelector('#engine-text'),
  warningPanel: document.querySelector('#warning-panel'),
  warningMessage: document.querySelector('#warning-message'),
  warningSnippets: document.querySelector('#warning-snippets'),
  markdownRender: document.querySelector('#markdown-render'),
  markdownRaw: document.querySelector('#markdown-raw'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageList: document.querySelector('#page-list'),
  pageNav: document.querySelector('#page-nav'),
};

elements.refreshPdfs.addEventListener('click', () => loadInbox());
elements.rerunPage.addEventListener('click', () => rerunCurrentPage());
elements.adapterSelect.addEventListener('change', () => {
  const page = getCurrentPage();
  if (!state.job || !page) return;
  state.selectedEngines.set(
    pageEngineKey(state.job.id, page.pageNumber),
    elements.adapterSelect.value,
  );
});
elements.acceptPage.addEventListener('click', () => acceptCurrentPage());
elements.commitJob.addEventListener('click', () => commitCurrentJob());
elements.discardJob.addEventListener('click', () => discardCurrentJob());
elements.previousPage.addEventListener('click', () => movePage(-1));
elements.nextPage.addEventListener('click', () => movePage(1));

void loadInbox();

async function loadInbox() {
  setStatus('Loading inbox…');
  try {
    const [pdfResponse, documentResponse] = await Promise.all([
      fetchJson('/api/pdfs'),
      fetchJson('/api/documents'),
    ]);
    state.pdfs = Array.isArray(pdfResponse.pdfs) ? pdfResponse.pdfs : [];
    state.documents = Array.isArray(documentResponse.documents)
      ? documentResponse.documents
      : [];
    renderPdfList();
    renderDocumentList();
    setStatus(
      state.pdfs.length || state.documents.length
        ? 'Select an inbox file to start.'
        : 'No files found in inbox.',
    );
  } catch (error) {
    setStatus(readError(error));
  }
}

function renderPdfList() {
  elements.pdfList.innerHTML = '';
  elements.pdfListEmpty.hidden = state.pdfs.length > 0;

  for (const pdf of state.pdfs) {
    const item = document.createElement('li');
    item.className = 'inbox-file';
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = pdf;
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const reviewButton = document.createElement('button');
    reviewButton.type = 'button';
    reviewButton.className = `file-action file-action-pages${pdf === state.selectedPdf ? ' active' : ''}`;
    reviewButton.setAttribute('aria-label', `Review pages from ${pdf}`);
    reviewButton.setAttribute(
      'aria-pressed',
      String(pdf === state.selectedPdf),
    );
    reviewButton.addEventListener('click', () => startJob(pdf, 'pages'));
    const reviewIcon = document.createElement('span');
    reviewIcon.className = 'file-action-icon';
    reviewIcon.setAttribute('aria-hidden', 'true');
    const reviewText = document.createElement('span');
    reviewText.textContent = 'Review pages';
    reviewButton.append(reviewIcon, reviewText);
    const quickButton = document.createElement('button');
    quickButton.type = 'button';
    quickButton.className = 'file-action file-action-convert';
    quickButton.setAttribute(
      'aria-label',
      `Quickly convert ${pdf} with native document text`,
    );
    quickButton.addEventListener('click', () => startJob(pdf, 'document'));
    const quickIcon = document.createElement('span');
    quickIcon.className = 'file-action-icon';
    quickIcon.setAttribute('aria-hidden', 'true');
    const quickText = document.createElement('span');
    quickText.textContent = 'Quick convert';
    quickButton.append(quickIcon, quickText);
    actions.append(reviewButton, quickButton);
    item.append(label, actions);
    elements.pdfList.append(item);
  }
}

function renderDocumentList() {
  elements.documentList.innerHTML = '';
  elements.documentListEmpty.hidden = state.documents.length > 0;

  for (const file of state.documents) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `document-file${file === state.selectedPdf ? ' active' : ''}`;
    button.textContent = file;
    button.addEventListener('click', () => startJob(file, 'document'));
    item.append(button);
    elements.documentList.append(item);
  }
}

async function startJob(file, mode) {
  if (
    state.job &&
    state.job.status === 'pending_review' &&
    state.job.kind === (mode === 'pages' ? 'pdf-pages' : 'document') &&
    readFileName(state.job.sourceFilePath) === file
  ) {
    state.selectedPdf = file;
    state.currentPageNumber =
      nextReviewPageNumber(state.job) ?? state.currentPageNumber;
    renderPdfList();
    render();
    setStatus(`Resumed existing review for ${file}.`);
    return;
  }

  state.selectedPdf = file;
  renderPdfList();
  setBusy(true, `Creating draft for ${file}…`);

  try {
    const response = await fetchJson('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, mode }),
    });

    state.job = response.job;
    state.currentPageNumber = nextReviewPageNumber(state.job) ?? 1;
    render();
    setStatus(
      response.resumed
        ? `Resumed existing review for ${file}.`
        : `Draft ready for ${file}.`,
    );
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

async function rerunCurrentPage() {
  const page = getCurrentPage();
  if (!state.job || !page) return;
  const selectedEngine =
    state.job.kind === 'document'
      ? null
      : readSelectedEngine(state.job.id, page);

  setBusy(
    true,
    state.job.kind === 'document'
      ? 'Reconvert document…'
      : `Rerunning page ${page.pageNumber}…`,
  );
  try {
    const response = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.job.id)}/pages/${page.pageNumber}/rerun`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body:
          state.job.kind === 'document'
            ? undefined
            : JSON.stringify({ engine: selectedEngine }),
      },
    );

    state.job = response.job;
    if (selectedEngine)
      state.selectedEngines.set(
        pageEngineKey(state.job.id, page.pageNumber),
        selectedEngine,
      );
    render();
    setStatus(
      state.job.kind === 'document'
        ? 'Document reconverted.'
        : `Reran page ${page.pageNumber} with ${selectedEngine}.`,
    );
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
    const response = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.job.id)}/pages/${page.pageNumber}/accept`,
      {
        method: 'POST',
      },
    );

    state.job = response.job;
    state.currentPageNumber =
      nextReviewPageNumber(state.job) ?? page.pageNumber;
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
    const response = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.job.id)}/commit`,
      {
        method: 'POST',
      },
    );

    state.job = response.job;
    render();
    setStatus(`Committed accepted pages to ${response.outputPath}.`);
    await loadInbox();
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
    await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    state.job = null;
    state.currentPageNumber = 1;
    render();
    setStatus('Draft discarded.');
    await loadInbox();
  } catch (error) {
    setStatus(readError(error));
  } finally {
    setBusy(false);
  }
}

function movePage(delta) {
  if (!state.job) return;
  const index = state.job.pages.findIndex(
    (page) => page.pageNumber === state.currentPageNumber,
  );
  const nextPage = state.job.pages[index + delta];
  if (!nextPage) return;
  state.currentPageNumber = nextPage.pageNumber;
  render();
}

function render() {
  const job = state.job;
  const page = getCurrentPage();
  const acceptedCount = job
    ? job.pages.filter((candidate) => candidate.accepted).length
    : 0;

  elements.emptyState.hidden = Boolean(job);
  elements.reviewState.hidden = !job;
  elements.commitJob.disabled = !job || acceptedCount < 1 || state.loading;
  elements.discardJob.disabled = !job || state.loading;

  if (!job || !page) {
    elements.jobMeta.textContent = 'No job loaded.';
    return;
  }

  const isDocument = job.kind === 'document';
  elements.jobMeta.textContent = `${readFileName(job.sourceFilePath)} · job ${job.id}`;
  elements.progressText.textContent = `${acceptedCount} of ${job.pages.length} accepted`;
  elements.pagePosition.textContent = isDocument
    ? 'Whole document'
    : `Page ${page.pageNumber} of ${job.pages.length}`;
  elements.previousPage.disabled =
    state.loading || page.pageNumber === job.pages[0]?.pageNumber;
  elements.nextPage.disabled =
    state.loading ||
    page.pageNumber === job.pages[job.pages.length - 1]?.pageNumber;
  elements.rerunPage.disabled = state.loading;
  elements.acceptPage.disabled = state.loading || page.accepted;
  elements.previewPanel.hidden = isDocument;
  elements.pageNav.hidden = isDocument;
  elements.adapterSelect.closest('.field').hidden = isDocument;
  elements.rerunPage.textContent = isDocument
    ? 'Reconvert document'
    : 'Rerun page';
  elements.acceptPage.textContent = isDocument
    ? 'Accept document'
    : 'Accept page';

  if (!isDocument) {
    elements.pagePreview.src = previewUrl(job.id, page.pageNumber);
    elements.pagePreview.alt = `Preview of page ${page.pageNumber} from ${readFileName(job.sourceFilePath)}`;
  } else {
    elements.pagePreview.removeAttribute('src');
  }
  elements.confidenceText.textContent =
    typeof page.confidence === 'number'
      ? `Confidence ${Math.round(page.confidence * 100)}%`
      : '';
  elements.engineText.textContent = `Engine ${page.engine}`;
  renderWarnings(page);
  elements.markdownRaw.textContent = page.markdown || '(empty markdown)';
  elements.markdownRender.replaceChildren(renderMarkdown(page.markdown));
  if (!isDocument)
    elements.adapterSelect.value = readSelectedEngine(job.id, page);

  renderPageList(job, page.pageNumber);
}

function renderWarnings(page) {
  const warning = Array.isArray(page.qualityWarnings)
    ? page.qualityWarnings.find(
        (candidate) => candidate.type === 'low-native-coverage',
      )
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
      page.accepted ? 'accepted' : page.status === 'pending' ? 'pending' : '',
    ]
      .filter(Boolean)
      .join(' ');
    button.setAttribute(
      'aria-current',
      page.pageNumber === activePageNumber ? 'page' : 'false',
    );
    button.addEventListener('click', () => {
      state.currentPageNumber = page.pageNumber;
      render();
    });
    item.append(button);
    elements.pageList.append(item);
  }
}

function getCurrentPage() {
  return (
    state.job?.pages.find(
      (page) => page.pageNumber === state.currentPageNumber,
    ) ?? null
  );
}

function nextReviewPageNumber(job) {
  return (
    job.pages.find((page) => !page.accepted)?.pageNumber ??
    job.pages[0]?.pageNumber ??
    null
  );
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
  const data = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(
      data?.error || `Request failed with status ${response.status}`,
    );
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
  const lines = String(markdown || '')
    .replace(/\r/g, '')
    .split('\n');
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
