// ============ State ============
let currentStep = 1;
let pdfFile = null;
let pdfFilename = null;
let signatureData = null; // base64 image data
let signatureFile = null;
let pdfDoc = null; // pdf.js document
let currentPageNum = 1;
let totalPagesCount = 1;
let placedSignatures = []; // {id, page, x, y, width, height, element}
let signedFilename = null;
let sigIdCounter = 0;

// Canvas drawing
let canvas, ctx;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// ============ Init ============
document.addEventListener('DOMContentLoaded', () => {
  // Init core UI first — these must not fail
  initDropZones();
  initTabs();
  initOpacitySlider();
  initFileInputs();

  // PDF.js setup — deferred, non-blocking
  initPdfJs();
});

function initPdfJs() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  } else {
    console.warn('PDF.js belum dimuat, akan dicoba lagi saat dibutuhkan');
  }
}

// ============ File Inputs ============
function initFileInputs() {
  document.getElementById('pdfInput').addEventListener('change', handlePdfSelect);
  document.getElementById('signatureInput').addEventListener('change', handleSignatureSelect);

  // Dedicated button click handlers (prevent event bubbling to drop zone)
  document.getElementById('pdfSelectBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('pdfInput').click();
  });
  document.getElementById('sigSelectBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('signatureInput').click();
  });
}

// ============ Drop Zones ============
function initDropZones() {
  setupDropZone('pdfDropZone', handlePdfDrop);
  setupDropZone('sigDropZone', handleSigDrop);
}

function setupDropZone(id, handler) {
  const zone = document.getElementById(id);
  if (!zone) return;

  ['dragenter', 'dragover'].forEach(evt => {
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.remove('dragover');
    });
  });

  zone.addEventListener('drop', e => handler(e.dataTransfer.files));
  zone.addEventListener('click', e => {
    // Don't trigger if clicking on the file input itself (prevents double open)
    if (e.target.tagName === 'INPUT') return;
    // Check if click is on a button or inside a button (SVG children)
    if (e.target.closest('button')) return;
    const input = zone.querySelector('input[type="file"]');
    if (input) input.click();
  });
}

// ============ PDF Upload ============
function handlePdfSelect(e) {
  if (e.target.files.length > 0) uploadPdf(e.target.files[0]);
}

function handlePdfDrop(files) {
  const pdf = Array.from(files).find(f => f.type === 'application/pdf');
  if (pdf) uploadPdf(pdf);
  else showToast('Pilih file PDF', 'error');
}

async function uploadPdf(file) {
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran file melebihi 50MB', 'error');
    return;
  }

  showLoading('Mengupload PDF...');
  const formData = new FormData();
  formData.append('pdf', file);

  try {
    const res = await fetch('/api/upload-pdf', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    pdfFile = file;
    pdfFilename = data.filename;

    document.getElementById('pdfFileName').textContent = data.originalName;
    document.getElementById('pdfFileSize').textContent = formatSize(data.size);
    document.getElementById('pdfFileInfo').classList.remove('hidden');
    document.getElementById('pdfDropZone').classList.add('hidden');

    showToast('PDF berhasil diupload', 'success');
    updateNavButtons();
  } catch (err) {
    showToast(err.message || 'Gagal mengupload PDF', 'error');
  } finally {
    hideLoading();
  }
}

function removePdf() {
  pdfFile = null;
  pdfFilename = null;
  document.getElementById('pdfFileInfo').classList.add('hidden');
  document.getElementById('pdfDropZone').classList.remove('hidden');
  document.getElementById('pdfInput').value = '';
  updateNavButtons();
}

// ============ Signature Upload ============
function handleSignatureSelect(e) {
  if (e.target.files.length > 0) loadSignatureFile(e.target.files[0]);
}

function handleSigDrop(files) {
  const img = Array.from(files).find(f => f.type.startsWith('image/'));
  if (img) loadSignatureFile(img);
  else showToast('Pilih file gambar (PNG/JPG)', 'error');
}

function loadSignatureFile(file) {
  signatureFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    signatureData = e.target.result;
    showSignaturePreview(signatureData);
    showToast('Tanda tangan berhasil dimuat', 'success');
    updateNavButtons();
  };
  reader.readAsDataURL(file);
}

function showSignaturePreview(src) {
  const preview = document.getElementById('signaturePreview');
  document.getElementById('sigPreviewImg').src = src;
  preview.classList.remove('hidden');
}

function removeSignature() {
  signatureData = null;
  signatureFile = null;
  document.getElementById('signaturePreview').classList.add('hidden');
  document.getElementById('signatureInput').value = '';
  updateNavButtons();
}

// ============ Canvas Drawing ============
let canvasInitialized = false;

function initCanvas() {
  if (canvasInitialized) return;

  canvas = document.getElementById('signatureCanvas');
  ctx = canvas.getContext('2d');

  // Only init when canvas is visible (has dimensions)
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return; // Will retry when step 2 is shown

  canvasInitialized = true;
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Mouse events
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // Touch events
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    startDrawing({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
  });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    draw({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
  });
  canvas.addEventListener('touchend', stopDrawing);
}

function startDrawing(e) {
  isDrawing = true;
  [lastX, lastY] = [e.offsetX, e.offsetY];
}

function draw(e) {
  if (!isDrawing) return;
  ctx.strokeStyle = document.getElementById('penColor').value;
  ctx.lineWidth = document.getElementById('penSize').value;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
  [lastX, lastY] = [e.offsetX, e.offsetY];
}

function stopDrawing() {
  isDrawing = false;
}

function clearCanvas() {
  if (!canvasInitialized || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function useDrawnSignature() {
  // Check if canvas has any drawing
  const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasDrawing = false;
  for (let i = 3; i < pixelData.length; i += 4) {
    if (pixelData[i] > 0) { hasDrawing = true; break; }
  }
  if (!hasDrawing) {
    showToast('Gambar tanda tangan terlebih dahulu', 'error');
    return;
  }

  signatureData = canvas.toDataURL('image/png');
  signatureFile = null;
  showSignaturePreview(signatureData);
  showToast('Tanda tangan berhasil dibuat', 'success');
  updateNavButtons();
}

// ============ Tabs ============
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

// ============ PDF Viewer (Step 3) ============
async function loadPdfPreview() {
  showLoading('Memuat preview PDF...');
  try {
    // Ensure PDF.js is ready
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library belum dimuat. Periksa koneksi internet.');
    }
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const url = `/api/pdf/${pdfFilename}`;
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    totalPagesCount = pdfDoc.numPages;
    currentPageNum = 1;
    document.getElementById('totalPages').textContent = totalPagesCount;
    updatePageButtons();
    await renderPage(currentPageNum);

    // Restore placed signatures visibility
    placedSignatures.forEach(sig => {
      sig.element.style.display = sig.page === (currentPageNum - 1) ? 'block' : 'none';
    });
  } catch (err) {
    showToast('Gagal memuat PDF', 'error');
    console.error(err);
  } finally {
    hideLoading();
  }
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const pdfCanvas = document.getElementById('pdfCanvas');
  const context = pdfCanvas.getContext('2d');

  const containerWidth = document.getElementById('pdfViewer').clientWidth - 4;
  const viewport = page.getViewport({ scale: 1 });
  const scale = containerWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  pdfCanvas.width = scaledViewport.width;
  pdfCanvas.height = scaledViewport.height;

  // Set overlay size to match canvas
  const overlay = document.getElementById('signaturesOverlay');
  overlay.style.width = pdfCanvas.width + 'px';
  overlay.style.height = pdfCanvas.height + 'px';

  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

  document.getElementById('currentPage').textContent = num;
  updatePageButtons();

  // Show/hide signatures based on current page
  placedSignatures.forEach(sig => {
    sig.element.style.display = sig.page === (num - 1) ? 'block' : 'none';
  });
}

function prevPage() {
  if (currentPageNum <= 1) return;
  currentPageNum--;
  renderPage(currentPageNum);
}

function nextPage() {
  if (currentPageNum >= totalPagesCount) return;
  currentPageNum++;
  renderPage(currentPageNum);
}

function updatePageButtons() {
  document.getElementById('prevPageBtn').disabled = currentPageNum <= 1;
  document.getElementById('nextPageBtn').disabled = currentPageNum >= totalPagesCount;
}

// ============ Signature Placement ============
function addSignatureToPage() {
  if (!signatureData) {
    showToast('Upload tanda tangan terlebih dahulu', 'error');
    return;
  }

  const overlay = document.getElementById('signaturesOverlay');
  const pdfCanvas = document.getElementById('pdfCanvas');
  const id = ++sigIdCounter;

  const sigEl = document.createElement('div');
  sigEl.className = 'sig-draggable';
  sigEl.dataset.id = id;

  const img = document.createElement('img');
  img.src = signatureData;
  img.draggable = false;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'sig-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.onclick = (e) => { e.stopPropagation(); removeSignaturePlacement(id); };

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sig-resize';

  sigEl.appendChild(img);
  sigEl.appendChild(deleteBtn);
  sigEl.appendChild(resizeHandle);

  // Default size & position
  const defaultWidth = Math.min(150, pdfCanvas.width * 0.25);
  const defaultHeight = defaultWidth * 0.5;
  const centerX = (pdfCanvas.width - defaultWidth) / 2;
  const centerY = (pdfCanvas.height - defaultHeight) / 2;

  sigEl.style.left = centerX + 'px';
  sigEl.style.top = centerY + 'px';
  sigEl.style.width = defaultWidth + 'px';
  sigEl.style.height = defaultHeight + 'px';

  const opacity = parseFloat(document.getElementById('globalOpacity').value);
  sigEl.style.opacity = opacity;

  overlay.appendChild(sigEl);

  const sigData = {
    id,
    page: currentPageNum - 1,
    x: centerX,
    y: centerY,
    width: defaultWidth,
    height: defaultHeight,
    opacity,
    element: sigEl
  };

  placedSignatures.push(sigData);
  makeDraggable(sigEl, sigData);
  makeResizable(resizeHandle, sigEl, sigData);
  updateSignaturesList();
  showToast(`Tanda tangan ditambahkan di halaman ${currentPageNum}`, 'success');
}

function makeDraggable(el, sigData) {
  let startX, startY, origLeft, origTop;

  const onMouseDown = (e) => {
    if (e.target.classList.contains('sig-delete') || e.target.classList.contains('sig-resize')) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    origLeft = el.offsetLeft;
    origTop = el.offsetTop;

    document.querySelectorAll('.sig-draggable').forEach(s => s.classList.remove('active'));
    el.classList.add('active');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onMouseMove, { passive: false });
    document.addEventListener('touchend', onMouseUp);
  };

  const onMouseMove = (e) => {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;

    const overlay = document.getElementById('signaturesOverlay');
    const maxX = overlay.clientWidth - el.offsetWidth;
    const maxY = overlay.clientHeight - el.offsetHeight;

    const newLeft = Math.max(0, Math.min(maxX, origLeft + dx));
    const newTop = Math.max(0, Math.min(maxY, origTop + dy));

    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';

    sigData.x = newLeft;
    sigData.y = newTop;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('touchmove', onMouseMove);
    document.removeEventListener('touchend', onMouseUp);
  };

  el.addEventListener('mousedown', onMouseDown);
  el.addEventListener('touchstart', onMouseDown, { passive: false });
}

function makeResizable(handle, el, sigData) {
  let startX, startY, origW, origH;

  const onMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    origW = el.offsetWidth;
    origH = el.offsetHeight;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onMouseMove, { passive: false });
    document.addEventListener('touchend', onMouseUp);
  };

  const onMouseMove = (e) => {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;
    const newW = Math.max(40, origW + dx);
    const newH = Math.max(20, origH + dy);
    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
    sigData.width = newW;
    sigData.height = newH;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('touchmove', onMouseMove);
    document.removeEventListener('touchend', onMouseUp);
  };

  handle.addEventListener('mousedown', onMouseDown);
  handle.addEventListener('touchstart', onMouseDown, { passive: false });
}

function removeSignaturePlacement(id) {
  const idx = placedSignatures.findIndex(s => s.id === id);
  if (idx >= 0) {
    placedSignatures[idx].element.remove();
    placedSignatures.splice(idx, 1);
    updateSignaturesList();
  }
}

function updateSignaturesList() {
  const list = document.getElementById('signaturesList');
  if (placedSignatures.length === 0) {
    list.innerHTML = '<p class="empty-message">Belum ada tanda tangan. Klik "Tambah Tanda Tangan" untuk menambahkan.</p>';
    return;
  }

  list.innerHTML = placedSignatures.map(sig => `
    <div class="sig-list-item" onclick="goToSignature(${sig.id})">
      <img src="${signatureData}" class="sig-thumb" alt="sig">
      <span class="sig-info">Halaman ${sig.page + 1}</span>
      <button class="sig-remove" onclick="event.stopPropagation(); removeSignaturePlacement(${sig.id})">&times;</button>
    </div>
  `).join('');

  updateNavButtons();
}

function goToSignature(id) {
  const sig = placedSignatures.find(s => s.id === id);
  if (sig && (sig.page + 1) !== currentPageNum) {
    currentPageNum = sig.page + 1;
    renderPage(currentPageNum);
  }
  // Highlight
  document.querySelectorAll('.sig-draggable').forEach(s => s.classList.remove('active'));
  sig.element.classList.add('active');
}

// ============ Opacity Slider ============
function initOpacitySlider() {
  const slider = document.getElementById('globalOpacity');
  const label = document.getElementById('opacityValue');
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    label.textContent = Math.round(val * 100) + '%';
    placedSignatures.forEach(sig => {
      sig.opacity = val;
      sig.element.style.opacity = val;
    });
  });
}

// ============ Sign & Download ============
async function signPdf() {
  if (placedSignatures.length === 0) {
    showToast('Tambahkan minimal satu tanda tangan', 'error');
    return;
  }

  showLoading('Menandatangani PDF...');

  const pdfCanvas = document.getElementById('pdfCanvas');

  const signaturesPayload = placedSignatures.map(sig => ({
    page: sig.page,
    x: sig.x,
    y: sig.y,
    width: sig.width,
    height: sig.height,
    previewWidth: pdfCanvas.width,
    previewHeight: pdfCanvas.height,
    opacity: sig.opacity
  }));

  const formData = new FormData();
  formData.append('pdfFilename', pdfFilename);
  formData.append('signatures', JSON.stringify(signaturesPayload));
  formData.append('signatureData', signatureData);

  try {
    const res = await fetch('/api/sign-pdf', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    signedFilename = data.filename;
    showToast('PDF berhasil ditandatangani!', 'success');
    goToStep(4);
  } catch (err) {
    showToast(err.message || 'Gagal menandatangani PDF', 'error');
  } finally {
    hideLoading();
  }
}

function downloadSignedPdf() {
  if (!signedFilename) return;
  window.location.href = `/api/download/${signedFilename}`;
}

function startOver() {
  pdfFile = null;
  pdfFilename = null;
  signatureData = null;
  signatureFile = null;
  pdfDoc = null;
  placedSignatures = [];
  signedFilename = null;
  sigIdCounter = 0;

  document.getElementById('pdfFileInfo').classList.add('hidden');
  document.getElementById('pdfDropZone').classList.remove('hidden');
  document.getElementById('pdfInput').value = '';
  document.getElementById('signaturePreview').classList.add('hidden');
  document.getElementById('signatureInput').value = '';
  document.getElementById('signaturesOverlay').innerHTML = '';
  clearCanvas();

  goToStep(1);
}

// ============ Step Navigation ============
function goToStep(step) {
  currentStep = step;

  // Update step content
  document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`step${step}`).classList.add('active');

  // Update step indicators
  document.querySelectorAll('.steps-indicator .step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('completed');
  });

  // Show/hide nav buttons on step 4
  document.getElementById('navButtons').style.display = step === 4 ? 'none' : 'flex';

  updateNavButtons();

  // Init canvas when entering step 2 (needs to be visible for sizing)
  if (step === 2) {
    initCanvas();
  }

  // Load PDF preview when entering step 3
  if (step === 3 && pdfDoc === null) {
    loadPdfPreview();
  }
}

function nextStep() {
  if (currentStep === 1 && !pdfFilename) {
    showToast('Upload file PDF terlebih dahulu', 'error');
    return;
  }
  if (currentStep === 2 && !signatureData) {
    showToast('Pilih atau gambar tanda tangan terlebih dahulu', 'error');
    return;
  }
  if (currentStep === 3) {
    signPdf();
    return;
  }
  if (currentStep < 4) goToStep(currentStep + 1);
}

function prevStep() {
  if (currentStep > 1) goToStep(currentStep - 1);
}

function updateNavButtons() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  prevBtn.disabled = currentStep === 1;

  if (currentStep === 3) {
    nextBtn.textContent = 'Tanda Tangani PDF';
    nextBtn.disabled = placedSignatures.length === 0;
  } else {
    nextBtn.textContent = 'Lanjut';
    if (currentStep === 1) nextBtn.disabled = !pdfFilename;
    else if (currentStep === 2) nextBtn.disabled = !signatureData;
    else nextBtn.disabled = false;
  }
}

// ============ Utilities ============
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || 'Memproses...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type || 'info'}`;
  // Force reflow
  toast.offsetHeight;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
