/**
 * Animation Editor Panel - Sidebar panel for creating and editing animation sets
 *
 * Features:
 * - Animation set management (create, edit, delete)
 * - Embedded sprite palette for frame selection (no pick mode)
 * - Clip editor with directional support, aliases, FPS, loop
 * - Animation preview
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getAssetLoader, WebviewAssetData } from '../overworld/core/AssetLoader';
import { AnimationSetDef } from '../overworld/core/types';
import { getAnimationRegistry } from '../animation/AnimationRegistry';

export class AnimationEditorPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.animationEditor';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _onSaveCallbacks: (() => void)[] = [];

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public onDidSave(callback: () => void): void {
    this._onSaveCallbacks.push(callback);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case 'webviewReady':
          await this._sendEditorData();
          break;
        case 'loadAnimationSets':
          await this._sendAnimationSets();
          break;
        case 'saveAnimationSet':
          await this._saveAnimationSet(message.data as { id: string; set: AnimationSetDef });
          break;
        case 'deleteAnimationSet':
          await this._deleteAnimationSet((message.data as { id: string }).id);
          break;
        case 'createAnimationSet':
          await this._createAnimationSet(message.data as { id: string; spritesheet: string });
          break;
      }
    });
  }

  private async _sendEditorData(): Promise<void> {
    if (!this._view) return;
    try {
      const loader = getAssetLoader(this._extensionUri);
      const assets = loader.getWebviewAssets();
      const registry = getAnimationRegistry(this._extensionUri);
      if (!registry.getAllSets().size) await registry.load();

      this._view.webview.postMessage({
        type: 'initData',
        spritesheets: assets.spritesheets,
        animSets: registry.getSerializableConfig(),
      });
    } catch (e) {
      console.warn('[AnimationEditor] Failed to send editor data:', e);
    }
  }

  private async _sendAnimationSets(): Promise<void> {
    if (!this._view) return;
    try {
      const registry = getAnimationRegistry(this._extensionUri);
      if (!registry.getAllSets().size) await registry.load();
      this._view.webview.postMessage({
        type: 'loadAnimationSets',
        sets: registry.getSerializableConfig(),
      });
    } catch (e) {
      console.warn('[AnimationEditor] Failed to send animation sets:', e);
    }
  }

  private async _saveAnimationSet(data: { id: string; set: AnimationSetDef }): Promise<void> {
    const registry = getAnimationRegistry(this._extensionUri);
    registry.setAnimationSet(data.id, data.set);
    await registry.save();
    await this._sendAnimationSets();
    this._notifySaved();
  }

  private async _deleteAnimationSet(id: string): Promise<void> {
    const registry = getAnimationRegistry(this._extensionUri);
    registry.deleteAnimationSet(id);
    await registry.save();
    await this._sendAnimationSets();
    this._notifySaved();
  }

  private async _createAnimationSet(data: { id: string; spritesheet: string }): Promise<void> {
    const registry = getAnimationRegistry(this._extensionUri);
    registry.setAnimationSet(data.id, {
      spritesheet: data.spritesheet,
      animations: { idle: { frames: [], fps: 4, loop: true } },
    });
    await registry.save();
    await this._sendAnimationSets();
    this._notifySaved();
  }

  private _notifySaved(): void {
    for (const cb of this._onSaveCallbacks) {
      cb();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    ${PIXEL_THEME_CSS}

    /* ─── Set Controls ─── */
    .anim-set-controls { display: flex; gap: 4px; margin-bottom: 8px; }
    .anim-set-controls select { flex: 1; font-size: 9px; background: var(--pixel-bg); border: 1px solid var(--pixel-border); color: var(--pixel-fg); padding: 3px 4px; }

    .action-btn {
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      cursor: pointer;
      font-family: inherit;
      font-size: 9px;
      padding: 3px 8px;
    }
    .action-btn:hover { background: var(--pixel-bg-light); }
    .action-btn.primary {
      background: var(--pixel-accent);
      color: #000;
      border-color: var(--pixel-accent);
    }
    .action-btn.primary:hover { opacity: 0.9; }

    /* ─── Sprite Palette ─── */
    .palette-section { margin-bottom: 8px; }
    .palette-header {
      display: flex; align-items: center; gap: 4px;
      margin-bottom: 4px;
    }
    .palette-header select {
      flex: 1; font-size: 9px; background: var(--pixel-bg);
      border: 1px solid var(--pixel-border); color: var(--pixel-fg); padding: 3px 4px;
    }
    .palette-zoom-btn {
      background: var(--pixel-bg); border: 1px solid var(--pixel-border);
      color: var(--pixel-fg); cursor: pointer; font-size: 10px;
      width: 20px; height: 20px; padding: 0; line-height: 18px; text-align: center;
    }
    .palette-zoom-btn:hover { background: var(--pixel-bg-light); }
    .palette-filter {
      width: 100%; font-size: 9px; padding: 3px 6px; margin-bottom: 4px;
      background: var(--pixel-bg); border: 1px solid var(--pixel-border);
      color: var(--pixel-fg); font-family: inherit;
    }
    .palette-container {
      max-height: 280px; overflow: auto;
      border: 1px solid var(--pixel-border);
      background: repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 50% / 16px 16px;
    }
    .palette-canvas {
      image-rendering: pixelated;
      cursor: crosshair;
      display: block;
    }
    .palette-info { font-size: 8px; color: var(--pixel-muted); margin-top: 2px; display: flex; justify-content: space-between; }
    .palette-hint { font-size: 8px; color: var(--pixel-muted); margin-top: 2px; font-style: italic; }

    /* ─── Animation List ─── */
    .anim-list-container { max-height: 160px; overflow-y: auto; margin-bottom: 8px; }
    .anim-item { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-bottom: 1px solid var(--pixel-border); cursor: pointer; font-size: 9px; }
    .anim-item:hover { background: var(--pixel-bg-light); }
    .anim-item.selected { background: var(--pixel-bg-light); border-left: 3px solid var(--pixel-accent); }
    .anim-alias-badge { color: #b877db; font-size: 8px; }
    .anim-meta-info { color: var(--pixel-muted); font-size: 8px; }

    /* ─── Frame Strip ─── */
    .frame-strip { display: flex; flex-wrap: wrap; gap: 3px; padding: 4px; background: var(--pixel-bg); border: 1px solid var(--pixel-border); min-height: 30px; max-height: 90px; overflow-y: auto; }
    .frame-strip-item { position: relative; width: 28px; height: 28px; border: 1px solid var(--pixel-border); }
    .frame-strip-item canvas { width: 28px; height: 28px; image-rendering: pixelated; }
    .frame-strip-item .frame-index { position: absolute; bottom: 0; right: 0; font-size: 6px; background: rgba(0,0,0,0.7); color: var(--pixel-fg); padding: 0 2px; line-height: 1.2; }
    .frame-strip-item .frame-remove { position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; background: #e74c3c; color: #fff; border: none; font-size: 7px; cursor: pointer; display: none; line-height: 12px; text-align: center; border-radius: 50%; }
    .frame-strip-item:hover .frame-remove { display: block; }
    .frame-strip-empty { color: var(--pixel-muted); font-size: 8px; padding: 8px; text-align: center; width: 100%; }

    /* ─── Direction Tabs ─── */
    .dir-tabs { display: flex; gap: 2px; margin-bottom: 6px; }
    .dir-tab { flex: 1; padding: 3px; background: var(--pixel-bg); border: 1px solid var(--pixel-border); color: var(--pixel-muted); cursor: pointer; font-size: 8px; text-align: center; font-family: inherit; }
    .dir-tab.active { background: var(--pixel-bg-light); border-color: var(--pixel-accent); color: var(--pixel-accent); }

    /* ─── Preview ─── */
    .anim-preview-box { display: flex; justify-content: center; padding: 6px; background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px; border: 1px solid var(--pixel-border); margin-top: 6px; }
    .anim-preview-box canvas { image-rendering: pixelated; }

    /* ─── Edit Row ─── */
    .edit-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .edit-label { font-size: 8px; color: var(--pixel-muted); min-width: 40px; }
    .edit-input { flex: 1; font-size: 9px; padding: 3px 6px; background: var(--pixel-bg); border: 1px solid var(--pixel-border); color: var(--pixel-fg); font-family: inherit; }

    .btn-row { display: flex; gap: 4px; }

    input[type="range"] {
      width: 100%; height: 4px; background: var(--pixel-bg);
      border: 1px solid var(--pixel-border); border-radius: 0;
      outline: none; -webkit-appearance: none; cursor: pointer;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; width: 12px; height: 12px;
      background: var(--pixel-accent); border: 1px solid var(--pixel-border); cursor: pointer;
    }
    input[type="range"]::-webkit-slider-thumb:hover { background: var(--pixel-fg); }

    .section-label {
      font-size: 8px; color: var(--pixel-muted); text-transform: uppercase;
      letter-spacing: 0.5px; margin: 6px 0 3px; padding-bottom: 2px;
      border-bottom: 1px solid var(--pixel-border);
    }
  </style>
</head>
<body>
  <!-- Set selector -->
  <div style="margin-bottom:8px;">
    <div class="anim-set-controls">
      <select id="anim-set-select"><option value="">-- select set --</option></select>
      <button class="action-btn" style="flex:none;font-size:8px;" id="btn-new-anim-set">+</button>
      <button class="action-btn" style="flex:none;font-size:8px;color:#e74c3c;" id="btn-delete-anim-set">x</button>
    </div>
    <div style="font-size:8px;color:var(--pixel-muted);margin-bottom:4px;" id="anim-set-sheet-info"></div>
  </div>

  <!-- Embedded Sprite Palette -->
  <div class="palette-section" id="palette-section" style="display:none;">
    <div class="section-label">Sprite Palette</div>
    <div class="palette-header">
      <select id="palette-sheet-select"></select>
      <button class="palette-zoom-btn" id="palette-zoom-out">-</button>
      <button class="palette-zoom-btn" id="palette-zoom-in">+</button>
    </div>
    <input type="text" class="palette-filter" id="palette-filter" placeholder="Filter sprites...">
    <div class="palette-container" id="palette-container">
      <canvas class="palette-canvas" id="palette-canvas"></canvas>
    </div>
    <div class="palette-info"><span id="palette-count"></span><span id="palette-clicked"></span></div>
    <div class="palette-hint" id="palette-hint" style="display:none;">Click a sprite to add it as a frame</div>
  </div>

  <!-- Animation list -->
  <div class="anim-list-container" id="anim-set-list">
    <div style="color:var(--pixel-muted);font-size:8px;text-align:center;padding:12px;">Select a set above</div>
  </div>
  <button class="action-btn" style="width:100%;font-size:8px;margin-bottom:8px;" id="btn-add-anim-clip">+ Add Animation</button>

  <!-- Clip editor -->
  <div id="anim-clip-editor" style="display:none;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <span style="font-size:9px;color:var(--pixel-accent);" id="clip-editor-title">Edit Animation</span>
      <button class="action-btn" style="font-size:7px;padding:2px 6px;color:#e74c3c;" id="btn-delete-clip">Delete</button>
    </div>

    <div class="edit-row">
      <span class="edit-label">Name:</span>
      <input type="text" class="edit-input" id="clip-name-input">
    </div>

    <label style="display:flex;align-items:center;gap:6px;margin:6px 0;font-size:8px;cursor:pointer;">
      <input type="checkbox" id="clip-is-alias" style="width:14px;height:14px;">
      Alias (reuse another animation)
    </label>

    <!-- Alias section -->
    <div id="clip-alias-section" style="display:none;">
      <div class="edit-row">
        <span class="edit-label">Target:</span>
        <select class="edit-input" id="clip-alias-target" style="flex:1;"><option value="">-- select --</option></select>
      </div>
    </div>

    <!-- Frames section -->
    <div id="clip-frames-section">
      <label style="display:flex;align-items:center;gap:6px;margin:6px 0;font-size:8px;cursor:pointer;">
        <input type="checkbox" id="clip-is-directional" style="width:14px;height:14px;">
        Directional (per-direction frames)
      </label>

      <div class="dir-tabs" id="clip-dir-tabs" style="display:none;">
        <button class="dir-tab active" data-dir="down">Down</button>
        <button class="dir-tab" data-dir="up">Up</button>
        <button class="dir-tab" data-dir="left">Left</button>
        <button class="dir-tab" data-dir="right">Right</button>
      </div>

      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
          <span style="font-size:8px;color:var(--pixel-muted);">FRAMES</span>
        </div>
        <div class="frame-strip" id="clip-frame-strip">
          <div class="frame-strip-empty">No frames. Select a sprite from the palette above.</div>
        </div>
      </div>

      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--pixel-muted);margin-bottom:2px;">
          <span>FPS</span>
          <span style="color:var(--pixel-accent);" id="clip-fps-val">10</span>
        </div>
        <input type="range" id="clip-fps" min="1" max="30" value="10" style="width:100%;">
      </div>

      <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:8px;cursor:pointer;">
        <input type="checkbox" id="clip-loop" checked style="width:14px;height:14px;">
        Loop
      </label>
    </div>

    <div class="anim-preview-box" id="clip-preview-box" style="display:none;">
      <canvas id="clip-preview-canvas" width="64" height="64"></canvas>
    </div>

    <div class="btn-row" style="margin-top:6px;">
      <button class="action-btn primary" id="btn-save-clip">Save Animation</button>
    </div>
  </div>

  <div class="btn-row" style="margin-top:8px;">
    <button class="action-btn primary" style="width:100%;" id="btn-save-anim-set">Save All Changes</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // State
    let spritesheets = {};
    let animSets = {};
    let currentAnimSetId = null;
    let currentClipName = null;
    let editingClipOriginalName = null;
    let currentDirection = 'down';
    let clipDirectionalFrames = {};
    let clipFlatFrames = [];
    let animPreviewTimer = null;
    let animPreviewFrame = 0;
    const imageCache = new Map();

    // DOM refs
    const animSetSelect = document.getElementById('anim-set-select');
    const animSetList = document.getElementById('anim-set-list');
    const animClipEditor = document.getElementById('anim-clip-editor');
    const animSetSheetInfo = document.getElementById('anim-set-sheet-info');
    const paletteSection = document.getElementById('palette-section');
    const paletteSheetSelect = document.getElementById('palette-sheet-select');
    const paletteCanvas = document.getElementById('palette-canvas');
    const paletteCtx = paletteCanvas.getContext('2d');
    paletteCtx.imageSmoothingEnabled = false;
    const paletteContainer = document.getElementById('palette-container');
    const paletteFilter = document.getElementById('palette-filter');
    const paletteCount = document.getElementById('palette-count');
    const paletteClicked = document.getElementById('palette-clicked');
    const paletteHint = document.getElementById('palette-hint');
    let paletteZoom = 2;
    let paletteGridW = 16;
    let paletteGridH = 16;
    const clipNameInput = document.getElementById('clip-name-input');
    const clipIsAlias = document.getElementById('clip-is-alias');
    const clipAliasSection = document.getElementById('clip-alias-section');
    const clipAliasTarget = document.getElementById('clip-alias-target');
    const clipFramesSection = document.getElementById('clip-frames-section');
    const clipIsDirectional = document.getElementById('clip-is-directional');
    const clipDirTabs = document.getElementById('clip-dir-tabs');
    const clipFrameStrip = document.getElementById('clip-frame-strip');
    const clipFpsSlider = document.getElementById('clip-fps');
    const clipFpsVal = document.getElementById('clip-fps-val');
    const clipLoop = document.getElementById('clip-loop');
    const clipPreviewBox = document.getElementById('clip-preview-box');
    const clipPreviewCanvas = document.getElementById('clip-preview-canvas');
    const clipPreviewCtx = clipPreviewCanvas ? clipPreviewCanvas.getContext('2d') : null;
    if (clipPreviewCtx) clipPreviewCtx.imageSmoothingEnabled = false;

    // ─── Sprite Palette ─────────────────────────────────────────────────

    function getCurrentSheetName() {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) return null;
      return animSets[currentAnimSetId].spritesheet || null;
    }

    function initPalette() {
      paletteSheetSelect.innerHTML = '';
      for (const name of Object.keys(spritesheets)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        paletteSheetSelect.appendChild(opt);
      }
      // Auto-select the current set's spritesheet
      const setSheet = getCurrentSheetName();
      if (setSheet && spritesheets[setSheet]) {
        paletteSheetSelect.value = setSheet;
      }
      updatePaletteGridSize();
      renderPaletteViewer();
    }

    function updatePaletteGridSize() {
      const sheetName = paletteSheetSelect.value;
      const sheet = spritesheets[sheetName];
      if (sheet && sheet.frameSize) {
        paletteGridW = sheet.frameSize.width || 16;
        paletteGridH = sheet.frameSize.height || 16;
      } else {
        paletteGridW = 16;
        paletteGridH = 16;
      }
    }

    function renderPaletteViewer() {
      const sheetName = paletteSheetSelect.value;
      const sheet = spritesheets[sheetName];
      if (!sheet) {
        paletteCanvas.width = 1;
        paletteCanvas.height = 1;
        paletteCount.textContent = '';
        return;
      }

      const filterText = (paletteFilter.value || '').toLowerCase();
      const spriteCount = Object.keys(sheet.sprites).length;
      paletteCount.textContent = spriteCount + ' sprites';

      // Use cached image or load fresh
      const cachedImg = imageCache.get(sheet.imageUrl);
      if (cachedImg && cachedImg.complete) {
        drawPaletteCanvas(cachedImg, sheet, filterText);
      } else {
        const img = new Image();
        img.onload = () => {
          imageCache.set(sheet.imageUrl, img);
          drawPaletteCanvas(img, sheet, filterText);
        };
        img.onerror = () => {
          paletteCount.textContent = 'Failed to load sheet';
        };
        img.src = sheet.imageUrl;
      }
    }

    function drawPaletteCanvas(img, sheet, filterText) {
      paletteCanvas.width = img.width;
      paletteCanvas.height = img.height;
      paletteCanvas.style.width = (img.width * paletteZoom) + 'px';
      paletteCanvas.style.height = (img.height * paletteZoom) + 'px';

      paletteCtx.clearRect(0, 0, img.width, img.height);
      paletteCtx.drawImage(img, 0, 0);

      // Draw grid overlay
      paletteCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      paletteCtx.lineWidth = 1;
      for (let x = paletteGridW; x < img.width; x += paletteGridW) {
        paletteCtx.beginPath();
        paletteCtx.moveTo(x + 0.5, 0);
        paletteCtx.lineTo(x + 0.5, img.height);
        paletteCtx.stroke();
      }
      for (let y = paletteGridH; y < img.height; y += paletteGridH) {
        paletteCtx.beginPath();
        paletteCtx.moveTo(0, y + 0.5);
        paletteCtx.lineTo(img.width, y + 0.5);
        paletteCtx.stroke();
      }

      // Highlight named sprites
      for (const [name, sprite] of Object.entries(sheet.sprites)) {
        const matchesFilter = !filterText || name.toLowerCase().includes(filterText);

        if (filterText && !matchesFilter) {
          // Dim non-matching sprites
          paletteCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          paletteCtx.fillRect(sprite.x, sprite.y, sprite.w, sprite.h);
        } else if (filterText && matchesFilter) {
          // Highlight matching sprites
          paletteCtx.strokeStyle = 'rgba(255, 220, 40, 0.9)';
          paletteCtx.lineWidth = 2;
          paletteCtx.strokeRect(sprite.x + 1, sprite.y + 1, sprite.w - 2, sprite.h - 2);
        }
      }
    }

    // Palette canvas click → add frame
    paletteCanvas.addEventListener('click', (e) => {
      const sheetName = paletteSheetSelect.value;
      const sheet = spritesheets[sheetName];
      if (!sheet || !currentClipName) return;

      const rect = paletteCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / paletteZoom);
      const y = Math.floor((e.clientY - rect.top) / paletteZoom);

      // Snap to grid
      const snapX = Math.floor(x / paletteGridW) * paletteGridW;
      const snapY = Math.floor(y / paletteGridH) * paletteGridH;

      // Find named sprite at this position
      let foundName = null;
      for (const [name, sp] of Object.entries(sheet.sprites)) {
        if (sp.x === snapX && sp.y === snapY) { foundName = name; break; }
      }

      if (foundName) {
        addFrameToCurrentClip(foundName);
        paletteClicked.textContent = '+ ' + foundName;

        // Brief visual feedback — highlight the clicked cell
        const img = imageCache.get(sheet.imageUrl);
        if (img) {
          drawPaletteCanvas(img, sheet, (paletteFilter.value || '').toLowerCase());
          paletteCtx.fillStyle = 'rgba(255, 220, 40, 0.35)';
          paletteCtx.fillRect(snapX, snapY, paletteGridW, paletteGridH);
          paletteCtx.strokeStyle = 'rgba(255, 220, 40, 1)';
          paletteCtx.lineWidth = 2;
          paletteCtx.strokeRect(snapX + 1, snapY + 1, paletteGridW - 2, paletteGridH - 2);
        }
      } else {
        paletteClicked.textContent = \`(\${snapX}, \${snapY}) — no sprite\`;
      }
    });

    // Zoom controls
    document.getElementById('palette-zoom-in').onclick = () => {
      paletteZoom = Math.min(6, paletteZoom + 1);
      renderPaletteViewer();
    };
    document.getElementById('palette-zoom-out').onclick = () => {
      paletteZoom = Math.max(1, paletteZoom - 1);
      renderPaletteViewer();
    };

    paletteSheetSelect.addEventListener('change', () => {
      paletteFilter.value = '';
      updatePaletteGridSize();
      renderPaletteViewer();
    });

    paletteFilter.addEventListener('input', () => {
      renderPaletteViewer();
    });

    function updatePaletteVisibility() {
      if (currentAnimSetId && animSets[currentAnimSetId]) {
        paletteSection.style.display = 'block';
        // Auto-select the set's spritesheet in the palette dropdown
        const setSheet = getCurrentSheetName();
        if (setSheet && spritesheets[setSheet] && paletteSheetSelect.value !== setSheet) {
          paletteSheetSelect.value = setSheet;
          updatePaletteGridSize();
          renderPaletteViewer();
        }
      } else {
        paletteSection.style.display = 'none';
      }
      // Show hint when editing a clip
      paletteHint.style.display = currentClipName && !clipIsAlias.checked ? 'block' : 'none';
    }

    // ─── Animation Core Functions ───────────────────────────────────────

    function addFrameToCurrentClip(spriteName) {
      if (!currentClipName) return;
      if (clipIsDirectional.checked) {
        if (!clipDirectionalFrames[currentDirection]) {
          clipDirectionalFrames[currentDirection] = [];
        }
        clipDirectionalFrames[currentDirection].push(spriteName);
      } else {
        clipFlatFrames.push(spriteName);
      }
      renderFrameStrip();
      updateAnimPreview();
    }

    function renderAnimSetSelect() {
      animSetSelect.innerHTML = '<option value="">-- select set --</option>';
      for (const id of Object.keys(animSets)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        if (id === currentAnimSetId) opt.selected = true;
        animSetSelect.appendChild(opt);
      }
    }

    function renderAnimClipList() {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) {
        animSetList.innerHTML = '<div style="color:var(--pixel-muted);font-size:8px;text-align:center;padding:12px;">Select a set above</div>';
        animClipEditor.style.display = 'none';
        return;
      }
      const set = animSets[currentAnimSetId];
      animSetSheetInfo.textContent = 'Sheet: ' + (set.spritesheet || '\\u2014');
      const anims = set.animations || {};
      animSetList.innerHTML = '';
      for (const [name, clip] of Object.entries(anims)) {
        const item = document.createElement('div');
        item.className = 'anim-item' + (name === currentClipName ? ' selected' : '');

        const left = document.createElement('span');
        left.textContent = name;
        item.appendChild(left);

        const right = document.createElement('span');
        if (clip.alias) {
          right.className = 'anim-alias-badge';
          right.textContent = '\\u2192 ' + clip.alias;
        } else {
          right.className = 'anim-meta-info';
          const frameCount = clip.directions
            ? Object.values(clip.directions).reduce((sum, d) => sum + (d.frames ? d.frames.length : 0), 0)
            : (clip.frames ? clip.frames.length : 0);
          right.textContent = frameCount + 'f @' + (clip.fps || 10) + 'fps';
        }
        item.appendChild(right);

        item.addEventListener('click', () => loadClipEditor(name));
        animSetList.appendChild(item);
      }
    }

    function loadClipEditor(name) {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) return;
      const set = animSets[currentAnimSetId];
      const clip = set.animations[name];
      if (!clip) return;

      currentClipName = name;
      editingClipOriginalName = name;
      animClipEditor.style.display = 'block';
      document.getElementById('clip-editor-title').textContent = 'Edit: ' + name;
      clipNameInput.value = name;

      // Alias
      if (clip.alias) {
        clipIsAlias.checked = true;
        clipAliasSection.style.display = 'block';
        clipFramesSection.style.display = 'none';
        populateClipAliasTargets();
        clipAliasTarget.value = clip.alias;
      } else {
        clipIsAlias.checked = false;
        clipAliasSection.style.display = 'none';
        clipFramesSection.style.display = 'block';
      }

      // Directional
      if (clip.directions) {
        clipIsDirectional.checked = true;
        clipDirTabs.style.display = 'flex';
        clipDirectionalFrames = {};
        for (const [dir, d] of Object.entries(clip.directions)) {
          clipDirectionalFrames[dir] = [...(d.frames || [])];
        }
        clipFlatFrames = [];
      } else {
        clipIsDirectional.checked = false;
        clipDirTabs.style.display = 'none';
        clipDirectionalFrames = {};
        clipFlatFrames = clip.frames ? [...clip.frames] : [];
      }

      // FPS + loop
      clipFpsSlider.value = clip.fps || 10;
      clipFpsVal.textContent = clip.fps || 10;
      clipLoop.checked = clip.loop !== false;

      currentDirection = 'down';
      updateDirTabActive();
      renderFrameStrip();
      updateAnimPreview();
      renderAnimClipList();
      updatePaletteVisibility();
    }

    function updateDirTabActive() {
      document.querySelectorAll('#clip-dir-tabs .dir-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.dir === currentDirection);
      });
    }

    function renderFrameStrip() {
      const sheetName = getCurrentSheetName();
      if (!sheetName) return;
      const sheet = spritesheets[sheetName];
      if (!sheet) return;

      const frames = clipIsDirectional.checked
        ? (clipDirectionalFrames[currentDirection] || [])
        : clipFlatFrames;

      clipFrameStrip.innerHTML = '';

      if (frames.length === 0) {
        clipFrameStrip.innerHTML = '<div class="frame-strip-empty">No frames. Select a sprite from the palette above.</div>';
        return;
      }

      const drawFrame = (img, frameName, index) => {
        const sprite = sheet.sprites[frameName];
        if (!sprite) return;

        const item = document.createElement('div');
        item.className = 'frame-strip-item';

        const c = document.createElement('canvas');
        c.width = 28; c.height = 28;
        const fCtx = c.getContext('2d');
        fCtx.imageSmoothingEnabled = false;
        fCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 28, 28);

        const idx = document.createElement('div');
        idx.className = 'frame-index';
        idx.textContent = index;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'frame-remove';
        removeBtn.textContent = '\\u00d7';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (clipIsDirectional.checked) {
            const arr = clipDirectionalFrames[currentDirection];
            if (arr) arr.splice(index, 1);
          } else {
            clipFlatFrames.splice(index, 1);
          }
          renderFrameStrip();
          updateAnimPreview();
        });

        item.appendChild(c);
        item.appendChild(idx);
        item.appendChild(removeBtn);
        clipFrameStrip.appendChild(item);
      };

      const cachedImg = imageCache.get(sheet.imageUrl);
      if (cachedImg && cachedImg.complete) {
        frames.forEach((f, i) => drawFrame(cachedImg, f, i));
      } else {
        const img = new Image();
        img.onload = () => {
          imageCache.set(sheet.imageUrl, img);
          frames.forEach((f, i) => drawFrame(img, f, i));
        };
        img.src = sheet.imageUrl;
      }
    }

    function updateAnimPreview() {
      if (animPreviewTimer) {
        clearInterval(animPreviewTimer);
        animPreviewTimer = null;
      }
      animPreviewFrame = 0;

      const sheetName = getCurrentSheetName();
      if (!sheetName || !clipPreviewCtx) return;
      const sheet = spritesheets[sheetName];
      if (!sheet) return;

      const frames = clipIsDirectional.checked
        ? (clipDirectionalFrames[currentDirection] || [])
        : clipFlatFrames;

      if (frames.length === 0) {
        clipPreviewBox.style.display = 'none';
        return;
      }
      clipPreviewBox.style.display = 'flex';

      const fps = parseInt(clipFpsSlider.value) || 10;
      const loop = clipLoop.checked;

      const drawPreviewFrame = (img) => {
        const frameName = frames[animPreviewFrame];
        const sprite = sheet.sprites[frameName];
        clipPreviewCtx.clearRect(0, 0, 64, 64);
        if (sprite) {
          clipPreviewCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 64, 64);
        }
      };

      const startPreview = (img) => {
        drawPreviewFrame(img);
        if (frames.length > 1) {
          animPreviewTimer = setInterval(() => {
            animPreviewFrame++;
            if (animPreviewFrame >= frames.length) {
              if (loop) {
                animPreviewFrame = 0;
              } else {
                animPreviewFrame = frames.length - 1;
                clearInterval(animPreviewTimer);
                animPreviewTimer = null;
                return;
              }
            }
            drawPreviewFrame(img);
          }, 1000 / fps);
        }
      };

      const cachedImg = imageCache.get(sheet.imageUrl);
      if (cachedImg && cachedImg.complete) {
        startPreview(cachedImg);
      } else {
        const img = new Image();
        img.onload = () => {
          imageCache.set(sheet.imageUrl, img);
          startPreview(img);
        };
        img.src = sheet.imageUrl;
      }
    }

    function populateClipAliasTargets() {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) return;
      const anims = animSets[currentAnimSetId].animations || {};
      clipAliasTarget.innerHTML = '<option value="">-- select --</option>';
      for (const name of Object.keys(anims)) {
        if (name === currentClipName) continue;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        clipAliasTarget.appendChild(opt);
      }
    }

    function saveCurrentClip() {
      if (!currentAnimSetId || !currentClipName) return;
      const set = animSets[currentAnimSetId];
      if (!set) return;

      const newName = clipNameInput.value.trim();
      if (!newName) return;

      let clipDef = {};
      if (clipIsAlias.checked) {
        const target = clipAliasTarget.value;
        if (target) clipDef.alias = target;
      } else {
        if (clipIsDirectional.checked) {
          clipDef.directions = {};
          for (const dir of ['down', 'up', 'left', 'right']) {
            clipDef.directions[dir] = { frames: clipDirectionalFrames[dir] || [] };
          }
        } else {
          clipDef.frames = [...clipFlatFrames];
        }
        clipDef.fps = parseInt(clipFpsSlider.value) || 10;
        clipDef.loop = clipLoop.checked;
      }

      // Handle rename
      if (editingClipOriginalName && editingClipOriginalName !== newName) {
        delete set.animations[editingClipOriginalName];
      }
      set.animations[newName] = clipDef;

      currentClipName = newName;
      editingClipOriginalName = newName;
      renderAnimClipList();
    }

    // ─── Event Handlers ─────────────────────────────────────────────────

    // Set selector change
    animSetSelect.addEventListener('change', () => {
      const id = animSetSelect.value;
      if (!id) {
        currentAnimSetId = null;
        currentClipName = null;
        animClipEditor.style.display = 'none';
        renderAnimClipList();
        updatePaletteVisibility();
        return;
      }
      currentAnimSetId = id;
      currentClipName = null;
      animClipEditor.style.display = 'none';
      renderAnimClipList();
      updatePaletteVisibility();
    });

    // New set button
    document.getElementById('btn-new-anim-set').addEventListener('click', () => {
      const id = prompt('Animation set ID (e.g., chicken, main-agent):');
      if (!id || !id.trim()) return;
      const setId = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      // Use the currently selected palette sheet or first available
      const sheet = paletteSheetSelect.value || Object.keys(spritesheets)[0] || '';
      vscode.postMessage({
        type: 'createAnimationSet',
        data: { id: setId, spritesheet: sheet }
      });
    });

    // Delete set button
    document.getElementById('btn-delete-anim-set').addEventListener('click', () => {
      if (!currentAnimSetId) return;
      if (!confirm('Delete animation set "' + currentAnimSetId + '"?')) return;
      vscode.postMessage({
        type: 'deleteAnimationSet',
        data: { id: currentAnimSetId }
      });
      currentAnimSetId = null;
      currentClipName = null;
      animClipEditor.style.display = 'none';
      updatePaletteVisibility();
    });

    // Add clip button
    document.getElementById('btn-add-anim-clip').addEventListener('click', () => {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) return;
      const name = prompt('Animation name (e.g., idle, walk, attack):');
      if (!name || !name.trim()) return;
      const clipName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const set = animSets[currentAnimSetId];
      if (set.animations[clipName]) {
        alert('Animation "' + clipName + '" already exists.');
        return;
      }
      set.animations[clipName] = { frames: [], fps: 10, loop: true };
      renderAnimClipList();
      loadClipEditor(clipName);
    });

    // Delete clip button
    document.getElementById('btn-delete-clip').addEventListener('click', () => {
      if (!currentAnimSetId || !currentClipName) return;
      const set = animSets[currentAnimSetId];
      if (!set) return;
      if (!confirm('Delete animation "' + currentClipName + '"?')) return;
      delete set.animations[currentClipName];
      currentClipName = null;
      animClipEditor.style.display = 'none';
      renderAnimClipList();
      updatePaletteVisibility();
    });

    // Alias checkbox toggle
    clipIsAlias.addEventListener('change', () => {
      if (clipIsAlias.checked) {
        clipAliasSection.style.display = 'block';
        clipFramesSection.style.display = 'none';
        populateClipAliasTargets();
      } else {
        clipAliasSection.style.display = 'none';
        clipFramesSection.style.display = 'block';
      }
      updatePaletteVisibility();
    });

    // Directional checkbox toggle
    clipIsDirectional.addEventListener('change', () => {
      if (clipIsDirectional.checked) {
        clipDirTabs.style.display = 'flex';
        if (clipFlatFrames.length > 0 && (!clipDirectionalFrames[currentDirection] || clipDirectionalFrames[currentDirection].length === 0)) {
          clipDirectionalFrames[currentDirection] = [...clipFlatFrames];
        }
      } else {
        clipDirTabs.style.display = 'none';
        if (clipDirectionalFrames[currentDirection] && clipDirectionalFrames[currentDirection].length > 0 && clipFlatFrames.length === 0) {
          clipFlatFrames = [...clipDirectionalFrames[currentDirection]];
        }
      }
      renderFrameStrip();
      updateAnimPreview();
    });

    // Direction tabs
    document.querySelectorAll('#clip-dir-tabs .dir-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentDirection = tab.dataset.dir;
        updateDirTabActive();
        renderFrameStrip();
        updateAnimPreview();
      });
    });

    // FPS slider
    clipFpsSlider.addEventListener('input', () => {
      clipFpsVal.textContent = clipFpsSlider.value;
      updateAnimPreview();
    });

    // Loop checkbox
    clipLoop.addEventListener('change', () => {
      updateAnimPreview();
    });

    // Save clip button
    document.getElementById('btn-save-clip').addEventListener('click', () => {
      saveCurrentClip();
    });

    // Save all changes button
    document.getElementById('btn-save-anim-set').addEventListener('click', () => {
      if (!currentAnimSetId || !animSets[currentAnimSetId]) return;
      if (currentClipName) saveCurrentClip();
      vscode.postMessage({
        type: 'saveAnimationSet',
        data: { id: currentAnimSetId, set: animSets[currentAnimSetId] }
      });
    });

    // ─── Message Handling ─────────────────────────────────────────────────

    window.addEventListener('message', event => {
      const message = event.data;

      if (message.type === 'initData') {
        spritesheets = message.spritesheets || {};
        animSets = message.animSets || {};
        initPalette();
        renderAnimSetSelect();
        if (Object.keys(animSets).length > 0) {
          // Auto-select first set
          const firstId = Object.keys(animSets)[0];
          currentAnimSetId = firstId;
          animSetSelect.value = firstId;
          renderAnimClipList();
          updatePaletteVisibility();
        }
      }

      if (message.type === 'loadAnimationSets' && message.sets) {
        animSets = message.sets;
        renderAnimSetSelect();
        renderAnimClipList();
        updatePaletteVisibility();
      }
    });

    // Signal ready
    vscode.postMessage({ type: 'webviewReady' });
  </script>
</body>
</html>`;
  }
}

// Singleton
let instance: AnimationEditorPanel | undefined;

export function getAnimationEditorPanel(extensionUri: vscode.Uri): AnimationEditorPanel {
  if (!instance) {
    instance = new AnimationEditorPanel(extensionUri);
  }
  return instance;
}
