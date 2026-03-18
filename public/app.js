// ============ State ============
let currentStep = 1;
let pdfFilename = null;
let signatureData = null;
let pdfDoc = null;
let currentPageNum = 1;
let totalPagesCount = 1;
let placedSignatures = [];
let signedFilename = null;
let sigIdCounter = 0;

// Canvas drawing state
let canvas, ctx;
let canvasReady = false;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// ============ DOM Ready ============
document.addEventListener('DOMContentLoaded', function () {
  // --- PDF file input ---
  var pdfInput = document.getElementById('pdfInput');
  pdfInput.addEventListener('change', function () {
    if (pdfInput.files.length > 0) {
      uploadPdf(pdfInput.files[0]);
    }
  });

  // --- PDF select button ---
  document.getElementById('pdfSelectBtn').addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    pdfInput.value = '';
    pdfInput.click();
  });

  // --- PDF drop zone (area click, NOT button) ---
  var pdfDrop = document.getElementById('pdfDropZone');
  pdfDrop.addEventListener('click', function (e) {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    pdfInput.value = '';
    pdfInput.click();
  });
  setupDragDrop(pdfDrop, function (files) {
    var f = findFile(files, 'application/pdf');
    if (f) uploadPdf(f);
    else showToast('Pilih file PDF', 'error');
  });

  // --- Signature file input ---
  var sigInput = document.getElementById('signatureInput');
  sigInput.addEventListener('change', function () {
    if (sigInput.files.length > 0) {
      loadSignatureFile(sigInput.files[0]);
    }
  });

  // --- Signature select button ---
  document.getElementById('sigSelectBtn').addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    sigInput.value = '';
    sigInput.click();
  });

  // --- Signature drop zone ---
  var sigDrop = document.getElementById('sigDropZone');
  sigDrop.addEventListener('click', function (e) {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    sigInput.value = '';
    sigInput.click();
  });
  setupDragDrop(sigDrop, function (files) {
    var f = findFileByPrefix(files, 'image/');
    if (f) loadSignatureFile(f);
    else showToast('Pilih file gambar (PNG/JPG)', 'error');
  });

  // --- Change PDF button ---
  document.getElementById('changePdfBtn').addEventListener('click', removePdf);

  // --- Change signature button ---
  document.getElementById('changeSigBtn').addEventListener('click', removeSignature);

  // --- Tabs ---
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // --- Canvas buttons ---
  document.getElementById('clearCanvasBtn').addEventListener('click', clearCanvas);
  document.getElementById('useDrawnBtn').addEventListener('click', useDrawnSignature);

  // --- Page navigation ---
  document.getElementById('prevPageBtn').addEventListener('click', prevPage);
  document.getElementById('nextPageBtn').addEventListener('click', nextPage);

  // --- Add signature to page ---
  document.getElementById('addSigBtn').addEventListener('click', addSignatureToPage);

  // --- Opacity slider ---
  var opSlider = document.getElementById('globalOpacity');
  var opLabel = document.getElementById('opacityValue');
  opSlider.addEventListener('input', function () {
    var val = parseFloat(opSlider.value);
    opLabel.textContent = Math.round(val * 100) + '%';
    placedSignatures.forEach(function (sig) {
      sig.opacity = val;
      sig.element.style.opacity = val;
    });
  });

  // --- Step navigation ---
  document.getElementById('prevBtn').addEventListener('click', prevStep);
  document.getElementById('nextBtn').addEventListener('click', nextStep);

  // --- Download ---
  document.getElementById('downloadBtn').addEventListener('click', downloadSignedPdf);
  document.getElementById('startOverBtn').addEventListener('click', startOver);

  // --- PDF.js ---
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  console.log('DigitalSign initialized');
});

// ============ Drag & Drop Helper ============
function setupDragDrop(zone, onFiles) {
  zone.addEventListener('dragenter', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files);
    }
  });
}

function findFile(files, type) {
  for (var i = 0; i < files.length; i++) {
    if (files[i].type === type) return files[i];
  }
  return null;
}

function findFileByPrefix(files, prefix) {
  for (var i = 0; i < files.length; i++) {
    if (files[i].type.indexOf(prefix) === 0) return files[i];
  }
  return null;
}

// ============ PDF Upload ============
async function uploadPdf(file) {
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran file melebihi 50MB', 'error');
    return;
  }

  showLoading('Mengupload PDF...');

  try {
    var formData = new FormData();
    formData.append('pdf', file);

    var res = await fetch('/api/upload-pdf', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      throw new Error(errData.error || 'Upload gagal (status ' + res.status + ')');
    }

    var data = await res.json();

    pdfFilename = data.filename;
    document.getElementById('pdfFileName').textContent = data.originalName;
    document.getElementById('pdfFileSize').textContent = formatSize(data.size);
    document.getElementById('pdfFileInfo').classList.remove('hidden');
    document.getElementById('pdfDropZone').classList.add('hidden');

    showToast('PDF berhasil diupload', 'success');
  } catch (err) {
    console.error('Upload error:', err);
    showToast(err.message || 'Gagal mengupload PDF', 'error');
  } finally {
    hideLoading();
    updateNavButtons();
  }
}

function removePdf() {
  pdfFilename = null;
  pdfDoc = null;
  document.getElementById('pdfFileInfo').classList.add('hidden');
  document.getElementById('pdfDropZone').classList.remove('hidden');
  document.getElementById('pdfInput').value = '';
  updateNavButtons();
}

// ============ Signature Upload ============
function loadSignatureFile(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    signatureData = e.target.result;
    document.getElementById('sigPreviewImg').src = signatureData;
    document.getElementById('signaturePreview').classList.remove('hidden');
    showToast('Tanda tangan berhasil dimuat', 'success');
    updateNavButtons();
  };
  reader.onerror = function () {
    showToast('Gagal membaca file gambar', 'error');
  };
  reader.readAsDataURL(file);
}

function removeSignature() {
  signatureData = null;
  document.getElementById('signaturePreview').classList.add('hidden');
  document.getElementById('signatureInput').value = '';
  updateNavButtons();
}

// ============ Canvas Drawing ============
function initCanvas() {
  if (canvasReady) return;

  canvas = document.getElementById('signatureCanvas');
  var rect = canvas.getBoundingClientRect();

  // Canvas must be visible to get dimensions
  if (rect.width < 10) return;

  canvasReady = true;
  ctx = canvas.getContext('2d');
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  canvas.addEventListener('mousedown', canvasMouseDown);
  canvas.addEventListener('mousemove', canvasMouseMove);
  canvas.addEventListener('mouseup', canvasStop);
  canvas.addEventListener('mouseleave', canvasStop);
  canvas.addEventListener('touchstart', canvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove', canvasTouchMove, { passive: false });
  canvas.addEventListener('touchend', canvasStop);
}

function canvasMouseDown(e) {
  isDrawing = true;
  lastX = e.offsetX;
  lastY = e.offsetY;
}

function canvasMouseMove(e) {
  if (!isDrawing) return;
  drawLine(lastX, lastY, e.offsetX, e.offsetY);
  lastX = e.offsetX;
  lastY = e.offsetY;
}

function canvasTouchStart(e) {
  e.preventDefault();
  var t = e.touches[0];
  var r = canvas.getBoundingClientRect();
  isDrawing = true;
  lastX = t.clientX - r.left;
  lastY = t.clientY - r.top;
}

function canvasTouchMove(e) {
  e.preventDefault();
  if (!isDrawing) return;
  var t = e.touches[0];
  var r = canvas.getBoundingClientRect();
  var x = t.clientX - r.left;
  var y = t.clientY - r.top;
  drawLine(lastX, lastY, x, y);
  lastX = x;
  lastY = y;
}

function canvasStop() {
  isDrawing = false;
}

function drawLine(x1, y1, x2, y2) {
  ctx.strokeStyle = document.getElementById('penColor').value;
  ctx.lineWidth = parseInt(document.getElementById('penSize').value);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function clearCanvas() {
  if (!canvasReady) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function useDrawnSignature() {
  if (!canvasReady) {
    showToast('Canvas belum siap', 'error');
    return;
  }

  var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var hasContent = false;
  for (var i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 0) { hasContent = true; break; }
  }

  if (!hasContent) {
    showToast('Gambar tanda tangan terlebih dahulu', 'error');
    return;
  }

  signatureData = canvas.toDataURL('image/png');
  document.getElementById('sigPreviewImg').src = signatureData;
  document.getElementById('signaturePreview').classList.remove('hidden');
  showToast('Tanda tangan berhasil dibuat', 'success');
  updateNavButtons();
}

// ============ PDF Viewer ============
async function loadPdfPreview() {
  if (typeof pdfjsLib === 'undefined') {
    showToast('Library PDF belum dimuat. Refresh halaman.', 'error');
    return;
  }

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  showLoading('Memuat preview PDF...');

  try {
    pdfDoc = await pdfjsLib.getDocument('/api/pdf/' + pdfFilename).promise;
    totalPagesCount = pdfDoc.numPages;
    currentPageNum = 1;
    document.getElementById('totalPages').textContent = totalPagesCount;
    await renderPage(currentPageNum);
  } catch (err) {
    console.error('PDF preview error:', err);
    showToast('Gagal memuat PDF: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

async function renderPage(num) {
  var page = await pdfDoc.getPage(num);
  var pdfCanvas = document.getElementById('pdfCanvas');
  var context = pdfCanvas.getContext('2d');
  var viewer = document.getElementById('pdfViewer');

  var containerWidth = viewer.clientWidth - 4;
  var viewport = page.getViewport({ scale: 1 });
  var scale = containerWidth / viewport.width;
  var sv = page.getViewport({ scale: scale });

  pdfCanvas.width = sv.width;
  pdfCanvas.height = sv.height;

  var overlay = document.getElementById('signaturesOverlay');
  overlay.style.width = sv.width + 'px';
  overlay.style.height = sv.height + 'px';

  await page.render({ canvasContext: context, viewport: sv }).promise;

  document.getElementById('currentPage').textContent = num;
  updatePageButtons();

  // Show/hide signatures per page
  placedSignatures.forEach(function (sig) {
    sig.element.style.display = sig.page === (num - 1) ? 'block' : 'none';
  });
}

function prevPage() {
  if (currentPageNum > 1) { currentPageNum--; renderPage(currentPageNum); }
}

function nextPage() {
  if (currentPageNum < totalPagesCount) { currentPageNum++; renderPage(currentPageNum); }
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

  var overlay = document.getElementById('signaturesOverlay');
  var pdfCanvas = document.getElementById('pdfCanvas');
  var id = ++sigIdCounter;

  var el = document.createElement('div');
  el.className = 'sig-draggable';

  var img = document.createElement('img');
  img.src = signatureData;
  img.draggable = false;

  var delBtn = document.createElement('button');
  delBtn.className = 'sig-delete';
  delBtn.innerHTML = '&times;';
  delBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    removeSignaturePlacement(id);
  });

  var resize = document.createElement('div');
  resize.className = 'sig-resize';

  el.appendChild(img);
  el.appendChild(delBtn);
  el.appendChild(resize);

  var w = Math.min(150, pdfCanvas.width * 0.25);
  var h = w * 0.5;
  var x = (pdfCanvas.width - w) / 2;
  var y = (pdfCanvas.height - h) / 2;

  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';

  var opacity = parseFloat(document.getElementById('globalOpacity').value);
  el.style.opacity = opacity;

  overlay.appendChild(el);

  var sigData = { id: id, page: currentPageNum - 1, x: x, y: y, width: w, height: h, opacity: opacity, element: el };
  placedSignatures.push(sigData);

  setupDrag(el, sigData);
  setupResize(resize, el, sigData);
  updateSignaturesList();
  updateNavButtons();

  showToast('Tanda tangan ditambahkan di halaman ' + currentPageNum, 'success');
}

function setupDrag(el, sigData) {
  var startX, startY, origLeft, origTop;

  function onDown(e) {
    if (e.target.classList.contains('sig-delete') || e.target.classList.contains('sig-resize')) return;
    e.preventDefault();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    startX = cx; startY = cy;
    origLeft = el.offsetLeft; origTop = el.offsetTop;

    document.querySelectorAll('.sig-draggable').forEach(function (s) { s.classList.remove('active'); });
    el.classList.add('active');

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  function onMove(e) {
    e.preventDefault();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;

    var overlay = document.getElementById('signaturesOverlay');
    var maxX = overlay.clientWidth - el.offsetWidth;
    var maxY = overlay.clientHeight - el.offsetHeight;

    var nx = Math.max(0, Math.min(maxX, origLeft + cx - startX));
    var ny = Math.max(0, Math.min(maxY, origTop + cy - startY));

    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
    sigData.x = nx;
    sigData.y = ny;
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  }

  el.addEventListener('mousedown', onDown);
  el.addEventListener('touchstart', onDown, { passive: false });
}

function setupResize(handle, el, sigData) {
  var startX, startY, origW, origH;

  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    startX = cx; startY = cy;
    origW = el.offsetWidth; origH = el.offsetHeight;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  function onMove(e) {
    e.preventDefault();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    var nw = Math.max(40, origW + cx - startX);
    var nh = Math.max(20, origH + cy - startY);
    el.style.width = nw + 'px';
    el.style.height = nh + 'px';
    sigData.width = nw;
    sigData.height = nh;
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  }

  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: false });
}

function removeSignaturePlacement(id) {
  var idx = placedSignatures.findIndex(function (s) { return s.id === id; });
  if (idx >= 0) {
    placedSignatures[idx].element.remove();
    placedSignatures.splice(idx, 1);
    updateSignaturesList();
    updateNavButtons();
  }
}

function updateSignaturesList() {
  var list = document.getElementById('signaturesList');

  if (placedSignatures.length === 0) {
    list.innerHTML = '<p class="empty-message">Belum ada tanda tangan. Klik "Tambah Tanda Tangan" untuk menambahkan.</p>';
    return;
  }

  list.innerHTML = '';
  placedSignatures.forEach(function (sig) {
    var item = document.createElement('div');
    item.className = 'sig-list-item';

    var thumb = document.createElement('img');
    thumb.src = signatureData;
    thumb.className = 'sig-thumb';

    var info = document.createElement('span');
    info.className = 'sig-info';
    info.textContent = 'Halaman ' + (sig.page + 1);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'sig-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeSignaturePlacement(sig.id);
    });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(removeBtn);

    item.addEventListener('click', function () {
      if ((sig.page + 1) !== currentPageNum) {
        currentPageNum = sig.page + 1;
        renderPage(currentPageNum);
      }
      document.querySelectorAll('.sig-draggable').forEach(function (s) { s.classList.remove('active'); });
      sig.element.classList.add('active');
    });

    list.appendChild(item);
  });
}

// ============ Sign & Download ============
async function signPdf() {
  if (placedSignatures.length === 0) {
    showToast('Tambahkan minimal satu tanda tangan', 'error');
    return;
  }

  showLoading('Menandatangani PDF...');

  var pdfCanvas = document.getElementById('pdfCanvas');

  var payload = placedSignatures.map(function (sig) {
    return {
      page: sig.page,
      x: sig.x,
      y: sig.y,
      width: sig.width,
      height: sig.height,
      previewWidth: pdfCanvas.width,
      previewHeight: pdfCanvas.height,
      opacity: sig.opacity
    };
  });

  try {
    var formData = new FormData();
    formData.append('pdfFilename', pdfFilename);
    formData.append('signatures', JSON.stringify(payload));
    formData.append('signatureData', signatureData);

    var res = await fetch('/api/sign-pdf', { method: 'POST', body: formData });

    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      throw new Error(errData.error || 'Gagal menandatangani');
    }

    var data = await res.json();
    signedFilename = data.filename;
    showToast('PDF berhasil ditandatangani!', 'success');
    goToStep(4);
  } catch (err) {
    console.error('Sign error:', err);
    showToast(err.message || 'Gagal menandatangani PDF', 'error');
  } finally {
    hideLoading();
  }
}

function downloadSignedPdf() {
  if (signedFilename) {
    window.location.href = '/api/download/' + signedFilename;
  }
}

function startOver() {
  pdfFilename = null;
  signatureData = null;
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

  document.querySelectorAll('.step-content').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById('step' + step).classList.add('active');

  document.querySelectorAll('.steps-indicator .step').forEach(function (el) {
    var s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('completed');
  });

  document.getElementById('navButtons').style.display = step === 4 ? 'none' : 'flex';
  updateNavButtons();

  // Init canvas when step 2 is visible
  if (step === 2) {
    setTimeout(initCanvas, 50);
  }

  // Load PDF preview when step 3
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
  document.getElementById('prevBtn').disabled = currentStep === 1;

  var nextBtn = document.getElementById('nextBtn');
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
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (type || 'info');
  void toast.offsetHeight;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
}
