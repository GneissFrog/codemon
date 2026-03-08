/**
 * CropConfigPanel - Visual editor for crop-config.json
 *
 * Manages extension→crop mappings, crop type growth stages,
 * growth formula parameters, and fence sprite IDs.
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getAssetLoader, WebviewAssetData } from '../overworld/core/AssetLoader';
import { CropConfig } from '../overworld/core/types';

export class CropConfigPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.cropConfig';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _config: CropConfig | null = null;
  private _assets: WebviewAssetData | null = null;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
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
          await this._sendAssets();
          await this._sendConfig();
          break;
        case 'saveConfig':
          await this._saveConfig(message.data as CropConfig);
          break;
      }
    });
  }

  private async _sendAssets(): Promise<void> {
    if (!this._view) return;
    try {
      const loader = getAssetLoader(this._extensionUri);
      if (!loader.isLoaded()) {
        await loader.load();
      }
      this._assets = loader.getWebviewAssets();
      this._view.webview.postMessage({
        type: 'loadAssets',
        assets: this._assets,
      });
    } catch (error) {
      console.error('[CropConfigPanel] Failed to load assets:', error);
    }
  }

  private async _loadConfig(): Promise<void> {
    const configPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'crop-config.json'
    );
    try {
      const content = await vscode.workspace.fs.readFile(configPath);
      this._config = JSON.parse(content.toString());
    } catch (e) {
      console.warn('[CropConfigPanel] Failed to load config:', e);
      this._config = {
        extensionMap: {},
        defaultCropType: 'seedling',
        spritesheet: 'plants',
        cropTypes: { seedling: { growthStages: ['seedling-1', 'seedling-2'] } },
        growth: { maxStage: 3, writeWeight: 3, formula: 'sqrt' },
        fences: {
          horizontal: 'fences/fence-horizontal',
          vertical: 'fences/fence-vertical',
          cornerTL: 'fences/fence-corner-tl',
          cornerTR: 'fences/fence-corner-tr',
          cornerBL: 'fences/fence-corner-bl',
          cornerBR: 'fences/fence-corner-br',
          gate: 'fences/fence-gate',
        },
      };
    }
  }

  private async _sendConfig(): Promise<void> {
    if (!this._view) return;
    if (!this._config) {
      await this._loadConfig();
    }
    this._view.webview.postMessage({
      type: 'loadConfig',
      config: this._config,
    });
  }

  private async _saveConfig(config: CropConfig): Promise<void> {
    const configPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'crop-config.json'
    );
    try {
      const content = JSON.stringify(config, null, 2) + '\n';
      await vscode.workspace.fs.writeFile(configPath, Buffer.from(content, 'utf-8'));
      this._config = config;
      this._view?.webview.postMessage({ type: 'saveSuccess' });
    } catch (e) {
      console.error('[CropConfigPanel] Failed to save config:', e);
      this._view?.webview.postMessage({ type: 'saveError', error: String(e) });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    ${PIXEL_THEME_CSS}

    body { padding: 8px; }

    .section {
      margin-bottom: 12px;
      border: 1px solid var(--pixel-border);
      padding: 8px;
    }

    .section-label {
      color: var(--pixel-accent);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      font-weight: bold;
    }

    .crop-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }

    .crop-item {
      padding: 4px 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
      font-size: 11px;
      color: var(--pixel-fg);
    }

    .crop-item.selected {
      border-color: var(--pixel-accent);
      background: var(--pixel-bg-lighter);
      color: var(--pixel-accent);
    }

    .crop-item.default-crop::after {
      content: ' *';
      color: var(--pixel-warning);
    }

    .growth-stages {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 6px 0;
      flex-wrap: wrap;
    }

    .stage-sprite {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
      border: 1px solid var(--pixel-border);
      background: var(--pixel-bg-light);
      position: relative;
    }

    .stage-sprite canvas {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
    }

    .stage-number {
      position: absolute;
      bottom: 0;
      right: 1px;
      font-size: 8px;
      color: var(--pixel-muted);
    }

    .ext-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .ext-table th {
      text-align: left;
      color: var(--pixel-muted);
      font-size: 10px;
      padding: 2px 4px;
      border-bottom: 1px solid var(--pixel-border);
    }

    .ext-table td {
      padding: 2px 4px;
      border-bottom: 1px solid var(--pixel-bg-lighter);
    }

    .ext-table .ext-col {
      color: var(--pixel-accent);
      font-family: monospace;
    }

    .btn {
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 10px;
      font-family: inherit;
    }

    .btn:hover { border-color: var(--pixel-accent); }
    .btn.danger:hover { border-color: var(--pixel-error); color: var(--pixel-error); }
    .btn.primary { border-color: var(--pixel-accent); color: var(--pixel-accent); }

    .btn-row {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }

    .inline-form {
      display: flex;
      gap: 4px;
      align-items: center;
      margin-top: 6px;
    }

    input[type="text"], input[type="number"], select {
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 3px 6px;
      font-family: inherit;
      font-size: 11px;
    }

    input[type="text"]:focus, input[type="number"]:focus, select:focus {
      border-color: var(--pixel-accent);
      outline: none;
    }

    input[type="number"] { width: 60px; }
    input[type="text"].ext-input { width: 60px; }

    .field-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .field-label {
      color: var(--pixel-muted);
      font-size: 10px;
      min-width: 80px;
    }

    .field-value {
      flex: 1;
    }

    .field-value input[type="text"] {
      width: 100%;
    }

    .fence-preview {
      width: 16px;
      height: 16px;
      image-rendering: pixelated;
      border: 1px solid var(--pixel-border);
      flex-shrink: 0;
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      min-height: 20px;
    }

    .status-msg {
      font-size: 10px;
      transition: opacity 0.3s;
    }

    .status-msg.success { color: var(--pixel-success); }
    .status-msg.error { color: var(--pixel-error); }
    .status-msg.unsaved { color: var(--pixel-warning); }

    .scroll-list {
      max-height: 150px;
      overflow-y: auto;
    }

    .sprite-select {
      max-width: 160px;
    }

    .delete-btn {
      background: none;
      border: none;
      color: var(--pixel-muted);
      cursor: pointer;
      padding: 0 2px;
      font-size: 12px;
    }

    .delete-btn:hover { color: var(--pixel-error); }
  </style>
</head>
<body>
  <div class="status-bar">
    <button class="btn primary" id="saveBtn" onclick="saveConfig()">Save</button>
    <span class="status-msg" id="statusMsg"></span>
  </div>

  <!-- Crop Types -->
  <div class="section">
    <div class="section-label">Crop Types</div>
    <div class="crop-list" id="cropList"></div>
    <div id="cropDetail"></div>
    <div class="btn-row">
      <button class="btn" onclick="addCropType()">+ Add Crop</button>
      <button class="btn danger" onclick="deleteCropType()">- Delete</button>
    </div>
    <div class="field-row" style="margin-top: 8px;">
      <span class="field-label">Default type</span>
      <select id="defaultCropSelect" class="field-value" onchange="setDefaultCrop(this.value)"></select>
    </div>
    <div class="field-row">
      <span class="field-label">Spritesheet</span>
      <input type="text" id="spritesheetInput" class="field-value" onchange="setSpritesheet(this.value)">
    </div>
  </div>

  <!-- Extension Mappings -->
  <div class="section">
    <div class="section-label">Extension Mappings</div>
    <div class="scroll-list">
      <table class="ext-table">
        <thead><tr><th>Extension</th><th>Crop Type</th><th></th></tr></thead>
        <tbody id="extTableBody"></tbody>
      </table>
    </div>
    <div class="inline-form">
      <input type="text" class="ext-input" id="newExtInput" placeholder=".ext">
      <select id="newExtCropSelect"></select>
      <button class="btn" onclick="addExtMapping()">+ Add</button>
    </div>
  </div>

  <!-- Growth Settings -->
  <div class="section">
    <div class="section-label">Growth Settings</div>
    <div class="field-row">
      <span class="field-label">Max stage</span>
      <input type="number" id="maxStageInput" min="1" max="10" onchange="updateGrowth()">
    </div>
    <div class="field-row">
      <span class="field-label">Write weight</span>
      <input type="number" id="writeWeightInput" min="1" max="20" onchange="updateGrowth()">
    </div>
    <div class="field-row">
      <span class="field-label">Formula</span>
      <select id="formulaSelect" onchange="updateGrowth()">
        <option value="sqrt">sqrt</option>
        <option value="log">log</option>
        <option value="linear">linear</option>
      </select>
    </div>
  </div>

  <!-- Fence Sprites -->
  <div class="section">
    <div class="section-label">Fence Sprites</div>
    <div id="fenceFields"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let config = null;
    let assets = null;
    let selectedCrop = null;
    let hasUnsaved = false;
    let spriteImages = {};

    // ── Message handling ──────────────────────────────────────────────

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadConfig':
          config = msg.config;
          selectedCrop = Object.keys(config.cropTypes)[0] || null;
          renderAll();
          break;
        case 'loadAssets':
          assets = msg.assets;
          loadSpriteImages();
          break;
        case 'saveSuccess':
          hasUnsaved = false;
          showStatus('Saved!', 'success');
          break;
        case 'saveError':
          showStatus('Error: ' + msg.error, 'error');
          break;
      }
    });

    vscode.postMessage({ type: 'webviewReady' });

    // ── Sprite image loading ──────────────────────────────────────────

    function loadSpriteImages() {
      if (!assets || !assets.spritesheets) return;
      for (const [name, sheet] of Object.entries(assets.spritesheets)) {
        if (sheet.imageUrl) {
          const img = new Image();
          img.src = sheet.imageUrl;
          img.onload = () => {
            spriteImages[name] = img;
            if (config) renderCropDetail();
            renderFenceFields();
          };
        }
      }
    }

    function drawSprite(canvas, spriteId) {
      if (!assets || !spriteId) return;
      const [sheetName, spriteName] = spriteId.split('/');
      const sheet = assets.spritesheets[sheetName];
      const img = spriteImages[sheetName];
      if (!sheet || !img || !sheet.sprites[spriteName]) return;

      const spriteDef = sheet.sprites[spriteName];
      if (spriteDef.comment) return;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      canvas.width = spriteDef.w || sheet.frameSize.width;
      canvas.height = spriteDef.h || sheet.frameSize.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img,
        spriteDef.x, spriteDef.y,
        canvas.width, canvas.height,
        0, 0,
        canvas.width, canvas.height
      );
    }

    // ── Rendering ─────────────────────────────────────────────────────

    function renderAll() {
      if (!config) return;
      renderCropList();
      renderCropDetail();
      renderExtTable();
      renderGrowthSettings();
      renderFenceFields();
      renderDefaultCropSelect();
      document.getElementById('spritesheetInput').value = config.spritesheet;
    }

    function renderCropList() {
      const el = document.getElementById('cropList');
      el.innerHTML = '';
      for (const name of Object.keys(config.cropTypes)) {
        const item = document.createElement('div');
        item.className = 'crop-item' + (name === selectedCrop ? ' selected' : '') + (name === config.defaultCropType ? ' default-crop' : '');
        item.textContent = name;
        item.onclick = () => { selectedCrop = name; renderCropList(); renderCropDetail(); };
        el.appendChild(item);
      }
    }

    function renderCropDetail() {
      const el = document.getElementById('cropDetail');
      if (!selectedCrop || !config.cropTypes[selectedCrop]) {
        el.innerHTML = '<div style="color:var(--pixel-muted);font-size:10px;">Select a crop type</div>';
        return;
      }

      const crop = config.cropTypes[selectedCrop];
      let html = '<div class="section-label" style="font-size:9px;margin-bottom:4px;">Growth Stages</div>';
      html += '<div class="growth-stages">';
      crop.growthStages.forEach((stage, i) => {
        html += '<div class="stage-sprite">';
        html += '<canvas id="stage-canvas-' + i + '" width="16" height="16"></canvas>';
        html += '<span class="stage-number">' + i + '</span>';
        html += '</div>';
      });
      html += '</div>';

      // Add/remove stage controls
      html += '<div class="inline-form">';
      html += '<select id="addStageSelect" class="sprite-select">';
      html += getPlantSpriteOptions();
      html += '</select>';
      html += '<button class="btn" onclick="addGrowthStage()">+ Stage</button>';
      if (crop.growthStages.length > 1) {
        html += '<button class="btn danger" onclick="removeLastStage()">- Last</button>';
      }
      html += '</div>';

      el.innerHTML = html;

      // Draw stage sprites
      requestAnimationFrame(() => {
        crop.growthStages.forEach((stage, i) => {
          const canvas = document.getElementById('stage-canvas-' + i);
          if (canvas) drawSprite(canvas, config.spritesheet + '/' + stage);
        });
      });
    }

    function getPlantSpriteOptions() {
      if (!assets || !config) return '<option>Loading...</option>';
      const sheet = assets.spritesheets[config.spritesheet];
      if (!sheet) return '<option>No sheet</option>';
      let html = '';
      for (const name of Object.keys(sheet.sprites)) {
        if (sheet.sprites[name].comment) continue;
        html += '<option value="' + name + '">' + name + '</option>';
      }
      return html;
    }

    function renderExtTable() {
      const tbody = document.getElementById('extTableBody');
      const cropOptions = Object.keys(config.cropTypes).map(c =>
        '<option value="' + c + '">' + c + '</option>'
      ).join('');

      let html = '';
      const sorted = Object.entries(config.extensionMap).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [ext, crop] of sorted) {
        html += '<tr>';
        html += '<td class="ext-col">' + ext + '</td>';
        html += '<td><select onchange="changeExtMapping(\\'' + ext + '\\', this.value)">';
        for (const c of Object.keys(config.cropTypes)) {
          html += '<option value="' + c + '"' + (c === crop ? ' selected' : '') + '>' + c + '</option>';
        }
        html += '</select></td>';
        html += '<td><button class="delete-btn" onclick="deleteExtMapping(\\'' + ext + '\\')">x</button></td>';
        html += '</tr>';
      }
      tbody.innerHTML = html;

      // Update the new-ext crop select
      const newSelect = document.getElementById('newExtCropSelect');
      newSelect.innerHTML = cropOptions;
    }

    function renderDefaultCropSelect() {
      const select = document.getElementById('defaultCropSelect');
      select.innerHTML = Object.keys(config.cropTypes).map(c =>
        '<option value="' + c + '"' + (c === config.defaultCropType ? ' selected' : '') + '>' + c + '</option>'
      ).join('');
    }

    function renderGrowthSettings() {
      document.getElementById('maxStageInput').value = config.growth.maxStage;
      document.getElementById('writeWeightInput').value = config.growth.writeWeight;
      document.getElementById('formulaSelect').value = config.growth.formula;
    }

    function renderFenceFields() {
      const el = document.getElementById('fenceFields');
      const fenceKeys = [
        ['horizontal', 'Horizontal'],
        ['vertical', 'Vertical'],
        ['cornerTL', 'Corner TL'],
        ['cornerTR', 'Corner TR'],
        ['cornerBL', 'Corner BL'],
        ['cornerBR', 'Corner BR'],
        ['gate', 'Gate'],
      ];

      let html = '';
      for (const [key, label] of fenceKeys) {
        const val = config.fences[key] || '';
        html += '<div class="field-row">';
        html += '<canvas class="fence-preview" id="fence-canvas-' + key + '" width="16" height="16"></canvas>';
        html += '<span class="field-label" style="min-width:60px;">' + label + '</span>';
        html += '<input type="text" class="field-value" value="' + val + '" onchange="updateFence(\\'' + key + '\\', this.value)">';
        html += '</div>';
      }
      el.innerHTML = html;

      // Draw fence previews
      requestAnimationFrame(() => {
        for (const [key] of fenceKeys) {
          const canvas = document.getElementById('fence-canvas-' + key);
          if (canvas && config.fences[key]) {
            drawSprite(canvas, config.fences[key]);
          }
        }
      });
    }

    // ── Actions ───────────────────────────────────────────────────────

    function markUnsaved() {
      hasUnsaved = true;
      showStatus('Unsaved changes', 'unsaved');
    }

    function showStatus(text, cls) {
      const el = document.getElementById('statusMsg');
      el.textContent = text;
      el.className = 'status-msg ' + cls;
      if (cls === 'success') {
        setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 1500);
      }
    }

    function saveConfig() {
      if (!config) return;
      vscode.postMessage({ type: 'saveConfig', data: config });
    }

    function addCropType() {
      const name = prompt('Crop type name:');
      if (!name || config.cropTypes[name]) return;
      config.cropTypes[name] = { growthStages: ['seedling-1'] };
      selectedCrop = name;
      markUnsaved();
      renderAll();
    }

    function deleteCropType() {
      if (!selectedCrop) return;
      if (selectedCrop === config.defaultCropType) {
        showStatus('Cannot delete default crop type', 'error');
        return;
      }
      if (!confirm('Delete crop type "' + selectedCrop + '"?')) return;

      // Remove extension mappings pointing to this crop
      for (const [ext, crop] of Object.entries(config.extensionMap)) {
        if (crop === selectedCrop) {
          config.extensionMap[ext] = config.defaultCropType;
        }
      }

      delete config.cropTypes[selectedCrop];
      selectedCrop = Object.keys(config.cropTypes)[0] || null;
      markUnsaved();
      renderAll();
    }

    function addGrowthStage() {
      if (!selectedCrop) return;
      const select = document.getElementById('addStageSelect');
      const spriteName = select.value;
      if (!spriteName) return;
      config.cropTypes[selectedCrop].growthStages.push(spriteName);
      markUnsaved();
      renderCropDetail();
    }

    function removeLastStage() {
      if (!selectedCrop) return;
      const stages = config.cropTypes[selectedCrop].growthStages;
      if (stages.length <= 1) return;
      stages.pop();
      markUnsaved();
      renderCropDetail();
    }

    function setDefaultCrop(value) {
      config.defaultCropType = value;
      markUnsaved();
      renderCropList();
    }

    function setSpritesheet(value) {
      config.spritesheet = value;
      markUnsaved();
    }

    function addExtMapping() {
      const extInput = document.getElementById('newExtInput');
      const cropSelect = document.getElementById('newExtCropSelect');
      let ext = extInput.value.trim();
      if (!ext) return;
      if (!ext.startsWith('.')) ext = '.' + ext;
      config.extensionMap[ext] = cropSelect.value;
      extInput.value = '';
      markUnsaved();
      renderExtTable();
    }

    function changeExtMapping(ext, value) {
      config.extensionMap[ext] = value;
      markUnsaved();
    }

    function deleteExtMapping(ext) {
      delete config.extensionMap[ext];
      markUnsaved();
      renderExtTable();
    }

    function updateGrowth() {
      config.growth.maxStage = parseInt(document.getElementById('maxStageInput').value) || 3;
      config.growth.writeWeight = parseInt(document.getElementById('writeWeightInput').value) || 3;
      config.growth.formula = document.getElementById('formulaSelect').value;
      markUnsaved();
    }

    function updateFence(key, value) {
      config.fences[key] = value;
      markUnsaved();
      renderFenceFields();
    }
  </script>
</body>
</html>`;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let instance: CropConfigPanel | undefined;

export function getCropConfigPanel(extensionUri: vscode.Uri): CropConfigPanel {
  if (!instance) {
    instance = new CropConfigPanel(extensionUri);
  }
  return instance;
}
