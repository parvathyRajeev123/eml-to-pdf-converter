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
    if (item.status === 'error') badgeHtml = `<span class="status-badge status-error" title="${item.errorMsg}">Failed</span>`;

    const downloadBtnHtml = item.downloadUrl
      ? `<a href="${item.downloadUrl}" download="${item.pdfName}" class="btn-download">Download PDF</a>`
      : '';

    li.innerHTML = `
      <div class="file-info">
        <span class="file-name">${item.file.name}</span>
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

convertAllBtn.addEventListener('click', async () => {
  const format = document.getElementById('pageFormat').value;
  const orientation = document.getElementById('orientation').value;
  const includeHeaders = document.getElementById('includeHeaders').checked;

  convertAllBtn.disabled = true;
  convertAllBtn.textContent = 'Converting...';

  for (const item of queue) {
    if (item.status === 'done') continue;

    item.status = 'converting';
    renderQueue();

    const formData = new FormData();
    formData.append('emlFile', item.file);
    formData.append('format', format);
    formData.append('orientation', orientation);
    formData.append('includeHeaders', String(includeHeaders));

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Conversion failed');
      }

      const blob = await response.blob();
      item.blob = blob;
      item.downloadUrl = URL.createObjectURL(blob);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.errorMsg = err.message;
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