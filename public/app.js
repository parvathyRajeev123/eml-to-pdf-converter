const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const chooseBtn = document.getElementById('chooseBtn');
const fileQueueContainer = document.getElementById('fileQueueContainer');
const fileListEl = document.getElementById('fileList');
const queueCountEl = document.getElementById('queueCount');
const clearAllBtn = document.getElementById('clearAllBtn');
const convertAllBtn = document.getElementById('convertAllBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');

let queue = []; // { id, file, status, blob, downloadUrl, pdfName, errorMsg }

chooseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

function handleFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.eml')) {
      alert(`Skipped "${file.name}": Only .eml files are allowed.`);
      continue;
    }
    queue.push({
      id: crypto.randomUUID(),
      file,
      status: 'ready',
      blob: null,
      downloadUrl: null,
      pdfName: file.name.replace(/\.eml$/i, '.pdf'),
      errorMsg: null
    });
  }
  renderQueue();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderQueue() {
  if (queue.length === 0) {
    fileQueueContainer.classList.add('hidden');
    downloadAllBtn.classList.add('hidden');
    return;
  }

  fileQueueContainer.classList.remove('hidden');
  queueCountEl.textContent = `${queue.length} File${queue.length > 1 ? 's' : ''} in Queue`;
  fileListEl.innerHTML = '';

  // Show "Download All (ZIP)" button whenever at least 1 file is converted
  const completedItems = queue.filter((item) => item.status === 'done' && item.blob);
  if (completedItems.length > 0) {
    downloadAllBtn.classList.remove('hidden');
    downloadAllBtn.textContent = `⬇ Download All (${completedItems.length} PDF${completedItems.length > 1 ? 's' : ''} as ZIP)`;
  } else {
    downloadAllBtn.classList.add('hidden');
  }

  queue.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'file-item';

    let badgeHtml = '';
    if (item.status === 'ready') badgeHtml = `<span class="status-badge status-ready">Ready</span>`;
    if (item.status === 'converting') badgeHtml = `<span class="status-badge status-converting">Converting...</span>`;
    if (item.status === 'done') badgeHtml = `<span class="status-badge status-done">Completed</span>`;
    if (item.status === 'error') badgeHtml = `<span class="status-badge status-error" title="${escapeHtml(item.errorMsg || 'Failed')}">Failed</span>`;

    const downloadBtnHtml = item.downloadUrl
      ? `<a href="${item.downloadUrl}" download="${item.pdfName}" class="btn-download">Download PDF</a>`
      : '';

    li.innerHTML = `
      <div class="file-info">
        <span class="file-name">${escapeHtml(item.file.name)}</span>
        <span class="file-size">${formatBytes(item.file.size)}</span>
      </div>
      <div class="file-actions">
        ${badgeHtml}
        ${downloadBtnHtml}
        <button class="btn-remove" data-id="${item.id}" title="Remove">✕</button>
      </div>
    `;

    fileListEl.appendChild(li);
  });

  document.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const target = queue.find((q) => q.id === id);
      if (target?.downloadUrl) URL.revokeObjectURL(target.downloadUrl);
      queue = queue.filter((q) => q.id !== id);
      renderQueue();
    });
  });
}

clearAllBtn.addEventListener('click', () => {
  queue.forEach((item) => {
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
  });
  queue = [];
  renderQueue();
});

function parseEmlContent(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const splitIndex = normalized.indexOf('\n\n');
  const headerBlock = splitIndex >= 0 ? normalized.slice(0, splitIndex) : normalized;
  let body = splitIndex >= 0 ? normalized.slice(splitIndex + 2) : '';

  // Unfold multi-line headers
  const unfolded = headerBlock.replace(/\n[ \t]+/g, ' ');
  const getHeader = (name) => {
    const match = unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'));
    return match ? match[1].trim() : '';
  };

  // Decode simple quoted-printable soft line breaks & hex escapes if present
  const isQuotedPrintable = /Content-Transfer-Encoding:\s*quoted-printable/i.test(unfolded);
  if (isQuotedPrintable) {
    body = body
      .replace(/=\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  return {
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject') || '(No Subject)',
    date: getHeader('Date'),
    body
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function convertEmlFileToPdfBlob(file, options = {}) {
  const {
    pageFormat = 'a4',
    orientation = 'portrait',
    includeHeaders = true
  } = options;

  const rawText = await file.text();
  const parsed = parseEmlContent(rawText);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = orientation === 'landscape' ? '1050px' : '760px';
  container.style.padding = '28px';
  container.style.background = '#ffffff';
  container.style.color = '#111827';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.fontSize = '14px';
  container.style.lineHeight = '1.5';

  const headersHtml = includeHeaders
    ? `
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">${escapeHtml(parsed.subject)}</div>
        ${parsed.from ? `<div style="font-size:12px;margin:2px 0;"><strong>From:</strong> ${escapeHtml(parsed.from)}</div>` : ''}
        ${parsed.to ? `<div style="font-size:12px;margin:2px 0;"><strong>To:</strong> ${escapeHtml(parsed.to)}</div>` : ''}
        ${parsed.date ? `<div style="font-size:12px;margin:2px 0;"><strong>Date:</strong> ${escapeHtml(parsed.date)}</div>` : ''}
      </div>
    `
    : '';

  const hasHtmlBody = /<html|<body|<div|<p|<br|<table/i.test(parsed.body);
  const bodyHtml = hasHtmlBody
    ? parsed.body
    : `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;">${escapeHtml(parsed.body)}</pre>`;

  container.innerHTML = `${headersHtml}<div>${bodyHtml}</div>`;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation, unit: 'pt', format: pageFormat });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      pdf.addPage();
      position = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    return pdf.output('blob');
  } finally {
    container.remove();
  }
}

convertAllBtn.addEventListener('click', async () => {
  const pageFormat = document.getElementById('pageFormat').value;
  const orientation = document.getElementById('orientation').value;
  const includeHeaders = document.getElementById('includeHeaders').checked;

  convertAllBtn.disabled = true;
  convertAllBtn.textContent = 'Converting...';

  for (const item of queue) {
    if (item.status === 'done') continue;

    item.status = 'converting';
    item.errorMsg = null;
    renderQueue();

    try {
      const blob = await convertEmlFileToPdfBlob(item.file, {
        pageFormat,
        orientation,
        includeHeaders
      });

      item.blob = blob;
      item.downloadUrl = URL.createObjectURL(blob);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.errorMsg = err.message || 'Conversion failed';
    }

    renderQueue();
  }

  convertAllBtn.disabled = false;
  convertAllBtn.textContent = 'Convert to PDF ➔';
});

// Bundle all completed PDFs into one .zip file and trigger download
downloadAllBtn.addEventListener('click', async () => {
  const completedItems = queue.filter((item) => item.status === 'done' && item.blob);
  if (completedItems.length === 0) return;

  downloadAllBtn.disabled = true;
  const originalText = downloadAllBtn.textContent;
  downloadAllBtn.textContent = 'Creating ZIP...';

  try {
    const zip = new JSZip();
    const usedNames = new Map();

    completedItems.forEach((item) => {
      let fileName = item.pdfName;
      // Prevent overwriting if two uploaded EML files share the same name
      if (usedNames.has(fileName)) {
        const count = usedNames.get(fileName) + 1;
        usedNames.set(fileName, count);
        fileName = fileName.replace(/\.pdf$/i, ` (${count}).pdf`);
      } else {
        usedNames.set(fileName, 1);
      }
      zip.file(fileName, item.blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = 'converted-emails.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
  } catch (err) {
    alert('Failed to create ZIP file: ' + err.message);
  } finally {
    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = originalText;
  }
});