import { removeBackground } from '@imgly/background-removal';

// ══════════════════════════════════════
//  State
// ══════════════════════════════════════
let originalImage = null;   // HTMLImageElement — original upload
let processedImage = null;  // HTMLImageElement — background removed
let bgColor = '#ffffff';
let targetW = 295;
let targetH = 413;
let zoom = 1;
let panX = 0;              // target-space pixels
let panY = 0;              // target-space pixels
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let displayScale = 1;      // computed during render

// ══════════════════════════════════════
//  DOM Refs
// ══════════════════════════════════════
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const fileInput      = $('#file-input');
const uploadZone     = $('#upload-zone');
const uploadContent  = $('#upload-content');
const previewThumb   = $('#preview-thumb');
const targetWInput   = $('#target-width');
const targetHInput   = $('#target-height');
const processBtn     = $('#process-btn');
const exportBtn      = $('#export-btn');
const zoomSlider     = $('#zoom-slider');
const zoomValue      = $('#zoom-value');
const zoomInBtn      = $('#zoom-in');
const zoomOutBtn     = $('#zoom-out');
const resetPosBtn    = $('#reset-pos-btn');
const canvas         = $('#editor-canvas');
const ctx            = canvas.getContext('2d');
const loadingOverlay = $('#loading-overlay');
const loadingText    = $('#loading-text');
const loadingProgress = $('#loading-progress');
const emptyState     = $('#empty-state');
const editorControls = $('#editor-controls');
const canvasContainer = $('#canvas-container');

// ══════════════════════════════════════
//  Upload
// ══════════════════════════════════════
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      previewThumb.src = ev.target.result;
      previewThumb.style.display = 'block';
      uploadContent.style.display = 'none';
      processBtn.disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ══════════════════════════════════════
//  Presets
// ══════════════════════════════════════
$$('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    targetWInput.value = btn.dataset.w;
    targetHInput.value = btn.dataset.h;
    $$('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ══════════════════════════════════════
//  Background Color
// ══════════════════════════════════════
$$('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    bgColor = btn.dataset.color;
    $$('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (processedImage) render();
  });
});

// ══════════════════════════════════════
//  Process (Background Removal)
// ══════════════════════════════════════
processBtn.addEventListener('click', async () => {
  if (!originalImage) return;

  targetW = parseInt(targetWInput.value) || 295;
  targetH = parseInt(targetHInput.value) || 413;

  showLoading('正在初始化 AI 模型...');

  try {
    // Convert image to blob (PNG to preserve quality)
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = originalImage.naturalWidth;
    tmpCanvas.height = originalImage.naturalHeight;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(originalImage, 0, 0);
    const blob = await new Promise(r => tmpCanvas.toBlob(r, 'image/png'));

    const resultBlob = await removeBackground(blob, {
      progress: (key, current, total) => {
        if (key.includes('fetch') || key.includes('download')) {
          updateLoading('正在下载 AI 模型...', total > 0 ? current / total : undefined);
        } else if (key.includes('compute') || key.includes('inference')) {
          updateLoading('正在智能抠图...', total > 0 ? current / total : undefined);
        }
      },
    });

    updateLoading('正在加载结果...');

    const url = URL.createObjectURL(resultBlob);
    const img = new Image();
    img.onload = () => {
      processedImage = img;
      initEditor();
      hideLoading();
    };
    img.onerror = () => {
      hideLoading();
      alert('结果图片加载失败');
    };
    img.src = url;
  } catch (err) {
    console.error('Background removal error:', err);
    hideLoading();
    alert('抠图处理失败: ' + err.message);
  }
});

// ══════════════════════════════════════
//  Editor Init
// ══════════════════════════════════════
function initEditor() {
  emptyState.style.display = 'none';
  canvas.style.display = 'block';
  editorControls.style.display = 'flex';
  exportBtn.style.display = 'flex';

  // Calculate zoom so image covers the target frame
  const scaleX = targetW / processedImage.naturalWidth;
  const scaleY = targetH / processedImage.naturalHeight;
  zoom = Math.max(scaleX, scaleY) * 1.05;

  // Configure slider range
  const minZoom = Math.max(10, Math.round(Math.min(scaleX, scaleY) * 40));
  const maxZoom = Math.round(Math.max(scaleX, scaleY) * 500);
  zoomSlider.min = minZoom;
  zoomSlider.max = Math.max(maxZoom, 500);
  updateZoomUI();

  // Reset pan
  panX = 0;
  panY = 0;

  resizeCanvas();
  render();
}

// ══════════════════════════════════════
//  Canvas Sizing
// ══════════════════════════════════════
function resizeCanvas() {
  const rect = canvasContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ══════════════════════════════════════
//  Render
// ══════════════════════════════════════
function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  // Clear entire canvas
  ctx.clearRect(0, 0, w, h);

  // Calculate display scale to fit the target frame in the viewport
  const pad = 60;
  displayScale = Math.min((w - pad * 2) / targetW, (h - pad * 2) / targetH);

  const fw = targetW * displayScale;
  const fh = targetH * displayScale;
  const fx = (w - fw) / 2;
  const fy = (h - fh) / 2;

  // ── Draw clipped content ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();

  // Background fill
  ctx.fillStyle = bgColor;
  ctx.fillRect(fx, fy, fw, fh);

  // Image
  if (processedImage) {
    const iw = processedImage.naturalWidth * zoom * displayScale;
    const ih = processedImage.naturalHeight * zoom * displayScale;
    const ix = fx + (fw - iw) / 2 + panX * displayScale;
    const iy = fy + (fh - ih) / 2 + panY * displayScale;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(processedImage, ix, iy, iw, ih);
  }
  ctx.restore();

  // ── Dim area outside frame ──
  ctx.fillStyle = 'rgba(8, 8, 15, 0.75)';
  // Top
  ctx.fillRect(0, 0, w, fy);
  // Bottom
  ctx.fillRect(0, fy + fh, w, h - fy - fh);
  // Left
  ctx.fillRect(0, fy, fx, fh);
  // Right
  ctx.fillRect(fx + fw, fy, w - fx - fw, fh);

  // ── Corner markers ──
  const cornerLen = Math.min(16, fw * 0.1, fh * 0.1);
  const cornerWidth = 2.5;
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.8)';
  ctx.lineWidth = cornerWidth;
  ctx.setLineDash([]);

  // Top-left
  ctx.beginPath();
  ctx.moveTo(fx, fy + cornerLen);
  ctx.lineTo(fx, fy);
  ctx.lineTo(fx + cornerLen, fy);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(fx + fw - cornerLen, fy);
  ctx.lineTo(fx + fw, fy);
  ctx.lineTo(fx + fw, fy + cornerLen);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(fx, fy + fh - cornerLen);
  ctx.lineTo(fx, fy + fh);
  ctx.lineTo(fx + cornerLen, fy + fh);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(fx + fw - cornerLen, fy + fh);
  ctx.lineTo(fx + fw, fy + fh);
  ctx.lineTo(fx + fw, fy + fh - cornerLen);
  ctx.stroke();

  // ── Dashed border ──
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
  ctx.setLineDash([]);

  // ── Size label ──
  const labelText = `${targetW} × ${targetH} px`;
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const labelW = ctx.measureText(labelText).width + 16;
  const labelH = 20;
  const labelX = fx + fw / 2 - labelW / 2;
  const labelY = fy - 8 - labelH;

  ctx.fillStyle = 'rgba(129, 140, 248, 0.15)';
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, labelW, labelH, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(129, 140, 248, 0.8)';
  ctx.fillText(labelText, fx + fw / 2, fy - 12);
}

// ══════════════════════════════════════
//  Mouse Interaction
// ══════════════════════════════════════
canvas.addEventListener('mousedown', (e) => {
  if (!processedImage) return;
  isDragging = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = (e.clientX - lastMouseX) / displayScale;
  const dy = (e.clientY - lastMouseY) / displayScale;
  panX += dx;
  panY += dy;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  render();
});

window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    canvas.style.cursor = 'grab';
  }
});

canvas.addEventListener('wheel', (e) => {
  if (!processedImage) return;
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.95 : 1.05;
  zoom = Math.max(0.02, Math.min(10, zoom * factor));
  updateZoomUI();
  render();
}, { passive: false });

// ══════════════════════════════════════
//  Touch Interaction
// ══════════════════════════════════════
let lastTouchX = 0, lastTouchY = 0;
let lastPinchDist = 0;

canvas.addEventListener('touchstart', (e) => {
  if (!processedImage) return;
  e.preventDefault();
  if (e.touches.length === 1) {
    isDragging = true;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    isDragging = false;
    lastPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!processedImage) return;
  e.preventDefault();
  if (e.touches.length === 1 && isDragging) {
    const dx = (e.touches[0].clientX - lastTouchX) / displayScale;
    const dy = (e.touches[0].clientY - lastTouchY) / displayScale;
    panX += dx;
    panY += dy;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
    render();
  } else if (e.touches.length === 2) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const scale = dist / lastPinchDist;
    zoom = Math.max(0.02, Math.min(10, zoom * scale));
    lastPinchDist = dist;
    updateZoomUI();
    render();
  }
}, { passive: false });

canvas.addEventListener('touchend', () => {
  isDragging = false;
});

// ══════════════════════════════════════
//  Zoom Controls
// ══════════════════════════════════════
zoomSlider.addEventListener('input', () => {
  zoom = parseInt(zoomSlider.value) / 100;
  zoomValue.textContent = zoomSlider.value + '%';
  render();
});

zoomInBtn.addEventListener('click', () => {
  zoom = Math.min(10, zoom * 1.15);
  updateZoomUI();
  render();
});

zoomOutBtn.addEventListener('click', () => {
  zoom = Math.max(0.02, zoom * 0.85);
  updateZoomUI();
  render();
});

function updateZoomUI() {
  const pct = Math.round(zoom * 100);
  zoomSlider.value = pct;
  zoomValue.textContent = pct + '%';
}

// Reset position
resetPosBtn.addEventListener('click', () => {
  if (!processedImage) return;
  panX = 0;
  panY = 0;
  const scaleX = targetW / processedImage.naturalWidth;
  const scaleY = targetH / processedImage.naturalHeight;
  zoom = Math.max(scaleX, scaleY) * 1.05;
  updateZoomUI();
  render();
});

// ══════════════════════════════════════
//  Export
// ══════════════════════════════════════
exportBtn.addEventListener('click', async () => {
  if (!processedImage) return;

  // Build the export canvas at exact target resolution
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = targetW;
  exportCanvas.height = targetH;
  const ectx = exportCanvas.getContext('2d');

  // Background fill
  ectx.fillStyle = bgColor;
  ectx.fillRect(0, 0, targetW, targetH);

  // Draw image — position/zoom matches what is shown on screen
  ectx.imageSmoothingEnabled = true;
  ectx.imageSmoothingQuality = 'high';

  const iw = processedImage.naturalWidth * zoom;
  const ih = processedImage.naturalHeight * zoom;
  const ix = (targetW - iw) / 2 + panX;
  const iy = (targetH - ih) / 2 + panY;

  ectx.drawImage(processedImage, ix, iy, iw, ih);

  // Get PNG blob (lossless)
  const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));

  const suggestedName = `证件照_${targetW}x${targetH}.png`;

  // ── Try File System Access API (native save dialog) ──
  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'PNG 图像 (无损)',
            accept: { 'image/png': ['.png'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast('✅ 证件照已保存！');
      return;
    } catch (err) {
      // User cancelled the dialog — don't fall through to auto-download
      if (err.name === 'AbortError') return;
      // Other error — fall through to anchor download
      console.warn('showSaveFilePicker failed, falling back:', err);
    }
  }

  // ── Fallback: anchor download with explicit .png filename ──
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;   // filename including .png extension
  a.type = 'image/png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('✅ 证件照已下载到默认下载目录');
});

// ══════════════════════════════════════
//  Loading
// ══════════════════════════════════════
function showLoading(text) {
  loadingText.textContent = text;
  loadingProgress.style.width = '0%';
  loadingOverlay.style.display = 'flex';
}

function updateLoading(text, progress) {
  loadingText.textContent = text;
  if (progress !== undefined && !isNaN(progress)) {
    loadingProgress.style.width = Math.round(progress * 100) + '%';
  }
}

function hideLoading() {
  loadingProgress.style.width = '100%';
  setTimeout(() => {
    loadingOverlay.style.display = 'none';
  }, 300);
}

// ══════════════════════════════════════
//  Resize Observer
// ══════════════════════════════════════
let resizeTimer;
const resizeObserver = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (processedImage) {
      resizeCanvas();
      render();
    }
  }, 50);
});
resizeObserver.observe(canvasContainer);
