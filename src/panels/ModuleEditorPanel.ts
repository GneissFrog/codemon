/**
 * Module Editor Panel - Visual editor for designing tile modules
 *
 * Features:
 * - Sprite palette (browse all spritesheets)
 * - Layer-aware tile canvas (paint/erase on active layer)
 * - Layer visibility toggles and active layer selection
 * - Module properties (category, rarity, placement rules)
 * - Connection point editing on module edges
 * - Save/load to tile-modules.json
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getAssetLoader, WebviewAssetData } from '../overworld/core/AssetLoader';
import { getModuleRegistry } from '../overworld/modules/ModuleRegistry';
import { TileModuleDef, ModuleTilePlacement, ConnectionPoint, PlacementRules, ModuleCategory } from '../overworld/core/types';

export class ModuleEditorPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.moduleEditor';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;

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
          await this._sendEditorData();
          break;
        case 'saveModule':
          await this._saveModule(message.data as TileModuleDef);
          break;
        case 'deleteModule':
          await this._deleteModule((message.data as { id: string }).id);
          break;
      }
    });
  }

  private async _sendEditorData(): Promise<void> {
    if (!this._view) return;

    try {
      const loader = getAssetLoader(this._extensionUri);
      if (!loader.isLoaded()) await loader.load();
      const assets = loader.getWebviewAssets();

      const registry = getModuleRegistry(this._extensionUri);
      if (!registry.isLoaded()) await registry.load();
      const modules = registry.getAll();

      this._view.webview.postMessage({
        type: 'loadEditorData',
        assets,
        modules,
      });
    } catch (error) {
      console.error('[ModuleEditor] Failed to load data:', error);
    }
  }

  private async _saveModule(moduleDef: TileModuleDef): Promise<void> {
    try {
      const registry = getModuleRegistry(this._extensionUri);
      registry.setModule(moduleDef);
      await registry.save();

      this._view?.webview.postMessage({
        type: 'moduleSaved',
        data: { id: moduleDef.id },
      });

      vscode.window.showInformationMessage(`Module "${moduleDef.name}" saved`);
    } catch (error) {
      console.error('[ModuleEditor] Failed to save module:', error);
      vscode.window.showErrorMessage(`Failed to save module: ${error}`);
    }
  }

  private async _deleteModule(id: string): Promise<void> {
    try {
      const registry = getModuleRegistry(this._extensionUri);
      registry.deleteModule(id);
      await registry.save();
      await this._sendEditorData();

      vscode.window.showInformationMessage(`Module "${id}" deleted`);
    } catch (error) {
      console.error('[ModuleEditor] Failed to delete module:', error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
  <title>Module Editor</title>
  <style>
    ${PIXEL_THEME_CSS}

    .module-editor { padding: 4px; font-size: 11px; }

    .toolbar {
      display: flex; gap: 4px; align-items: center;
      margin-bottom: 6px; flex-wrap: wrap;
    }
    .toolbar select, .toolbar input, .toolbar button {
      font-family: inherit; font-size: 11px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 2px 4px;
    }
    .toolbar button { cursor: pointer; }
    .toolbar button:hover { background: var(--pixel-accent); color: #000; }

    .section-label {
      font-size: 9px; color: var(--pixel-accent);
      text-transform: uppercase; letter-spacing: 0.5px;
      margin: 6px 0 3px; padding-bottom: 2px;
      border-bottom: 1px solid var(--pixel-border);
    }

    /* ─── Sprite Palette ─── */
    .palette-container {
      max-height: 120px; overflow-y: auto;
      border: 1px solid var(--pixel-border);
      margin-bottom: 6px; padding: 2px;
    }
    .palette-grid {
      display: flex; flex-wrap: wrap; gap: 1px;
    }
    .palette-sprite {
      width: 24px; height: 24px; cursor: pointer;
      border: 1px solid transparent; image-rendering: pixelated;
    }
    .palette-sprite:hover { border-color: var(--pixel-accent); }
    .palette-sprite.selected { border-color: var(--pixel-success); box-shadow: 0 0 3px var(--pixel-success); }

    /* ─── Tile Canvas ─── */
    .canvas-container {
      border: 1px solid var(--pixel-border);
      margin-bottom: 6px; overflow: auto;
      max-height: 300px; background: #111;
    }
    #module-canvas {
      image-rendering: pixelated; cursor: crosshair;
      display: block;
    }

    /* ─── Layer Panel ─── */
    .layer-row {
      display: flex; align-items: center; gap: 4px;
      padding: 2px 0; font-size: 10px;
    }
    .layer-row input[type="checkbox"] { width: 12px; height: 12px; }
    .layer-row.active { color: var(--pixel-success); font-weight: bold; }
    .layer-row .layer-name { cursor: pointer; flex: 1; }
    .layer-row .layer-name:hover { text-decoration: underline; }

    /* ─── Properties ─── */
    .prop-row {
      display: flex; align-items: center; gap: 4px;
      margin: 2px 0; font-size: 10px;
    }
    .prop-row label { color: var(--pixel-muted); min-width: 60px; }
    .prop-row input, .prop-row select {
      flex: 1; font-family: inherit; font-size: 10px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 3px;
    }

    /* ─── Connection Points ─── */
    .conn-row {
      display: flex; align-items: center; gap: 4px;
      margin: 2px 0; font-size: 10px;
    }
    .conn-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block;
    }
    .conn-dot.path { background: var(--pixel-accent); }
    .conn-dot.grass { background: var(--pixel-success); }
    .conn-dot.water { background: #4488ff; }
    .conn-dot.any { background: var(--pixel-muted); }

    .empty-state {
      text-align: center; color: var(--pixel-muted);
      padding: 20px; font-size: 11px;
    }

    /* ─── Hover Tooltip ─── */
    #hover-info {
      position: fixed; background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border); padding: 4px 6px;
      font-size: 9px; pointer-events: none; display: none;
      z-index: 100; max-width: 200px;
    }
  </style>
</head>
<body>
  <div class="module-editor">
    <!-- Module selector toolbar -->
    <div class="toolbar">
      <select id="module-select"><option value="">-- New Module --</option></select>
      <button id="btn-new" title="New Module">+</button>
      <button id="btn-delete" title="Delete Module">x</button>
      <button id="btn-save" title="Save Module">Save</button>
    </div>

    <!-- Module name and ID -->
    <div class="prop-row">
      <label>ID:</label>
      <input id="module-id" type="text" placeholder="my-module">
    </div>
    <div class="prop-row">
      <label>Name:</label>
      <input id="module-name" type="text" placeholder="My Module">
    </div>

    <!-- Sprite Palette -->
    <div class="section-label">Sprite Palette</div>
    <div class="toolbar">
      <select id="sheet-select"></select>
    </div>
    <div class="palette-container">
      <div class="palette-grid" id="palette-grid"></div>
    </div>

    <!-- Layer Panel -->
    <div class="section-label">Layers</div>
    <div id="layer-panel">
      <div class="layer-row active" data-layer="0">
        <input type="checkbox" checked data-vis="0">
        <span class="layer-name" data-set="0">0 Ground</span>
      </div>
      <div class="layer-row" data-layer="1">
        <input type="checkbox" checked data-vis="1">
        <span class="layer-name" data-set="1">1 Terrain</span>
      </div>
      <div class="layer-row" data-layer="2">
        <input type="checkbox" checked data-vis="2">
        <span class="layer-name" data-set="2">2 Objects</span>
      </div>
    </div>

    <!-- Tile Canvas -->
    <div class="section-label">Canvas (<span id="canvas-size">5 x 5</span>)</div>
    <div class="prop-row">
      <label>Width:</label>
      <input id="grid-width" type="number" min="2" max="20" value="5" style="width:40px">
      <label>Height:</label>
      <input id="grid-height" type="number" min="2" max="20" value="5" style="width:40px">
    </div>
    <div class="canvas-container">
      <canvas id="module-canvas" width="160" height="160"></canvas>
    </div>

    <!-- Properties -->
    <div class="section-label">Properties</div>
    <div class="prop-row">
      <label>Category:</label>
      <select id="prop-category">
        <option value="decorative">Decorative</option>
        <option value="environment">Environment</option>
        <option value="connector">Connector</option>
        <option value="landmark">Landmark</option>
      </select>
    </div>
    <div class="prop-row">
      <label>Rarity:</label>
      <input id="prop-rarity" type="range" min="0" max="100" value="50">
      <span id="prop-rarity-val">0.5</span>
    </div>
    <div class="prop-row">
      <label>Max #:</label>
      <input id="prop-max" type="number" min="-1" max="10" value="-1" style="width:40px">
    </div>
    <div class="prop-row">
      <label>Min Area:</label>
      <input id="prop-min-area" type="number" min="0" max="10000" value="300" style="width:60px">
    </div>
    <div class="prop-row">
      <label>Affinity:</label>
      <select id="prop-affinity">
        <option value="any">Any</option>
        <option value="edge">Edge</option>
        <option value="center">Center</option>
        <option value="near-water">Near Water</option>
        <option value="near-path">Near Path</option>
        <option value="corner">Corner</option>
        <option value="between-plots">Between Plots</option>
      </select>
    </div>

    <!-- Connection Points -->
    <div class="section-label">Connection Points</div>
    <div id="conn-list">
      <div class="empty-state" style="font-size:9px; padding:4px;">Click edge tiles on the canvas to add connection points</div>
    </div>
  </div>

  <div id="hover-info"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ─── State ─────────────────────────────────────────────────────────
    let spritesheets = {};
    let allModules = [];
    let currentModule = null; // TileModuleDef being edited

    let gridWidth = 5;
    let gridHeight = 5;
    const TILE_SIZE = 16;
    const SCALE = 2; // Canvas scale factor for crisp rendering

    let activeLayer = 0;
    const layerVisible = [true, true, true];
    let selectedSpriteId = null; // e.g. "biome/mushroom-red"
    let selectedTileType = 'decoration';

    // Module tile data: Map<"x,y,layer" -> {type, spriteId}>
    let moduleTiles = new Map();
    let connectionPoints = [];

    const canvas = document.getElementById('module-canvas');
    const ctx = canvas.getContext('2d');

    // ─── Message Handling ──────────────────────────────────────────────
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadEditorData':
          spritesheets = msg.assets.spritesheets;
          allModules = msg.modules || [];
          initPalette();
          initModuleSelect();
          renderCanvas();
          break;
        case 'moduleSaved':
          break;
      }
    });

    vscode.postMessage({ type: 'webviewReady' });

    // ─── Palette ───────────────────────────────────────────────────────
    const sheetSelect = document.getElementById('sheet-select');
    const paletteGrid = document.getElementById('palette-grid');

    function initPalette() {
      sheetSelect.innerHTML = '';
      for (const name of Object.keys(spritesheets)) {
        if (spritesheets[name].isCharacter) continue; // Skip character sheets
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sheetSelect.appendChild(opt);
      }
      populatePalette();
    }

    function populatePalette() {
      paletteGrid.innerHTML = '';
      const sheetName = sheetSelect.value;
      const sheet = spritesheets[sheetName];
      if (!sheet) return;

      // Load sheet image
      const img = new Image();
      img.src = sheet.imageUrl;
      img.onload = () => {
        for (const [spriteName, sprite] of Object.entries(sheet.sprites)) {
          const spriteCanvas = document.createElement('canvas');
          spriteCanvas.width = 24;
          spriteCanvas.height = 24;
          spriteCanvas.className = 'palette-sprite';
          spriteCanvas.title = sheetName + '/' + spriteName;
          spriteCanvas.dataset.spriteId = sheetName + '/' + spriteName;

          const sctx = spriteCanvas.getContext('2d');
          sctx.imageSmoothingEnabled = false;
          sctx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 24, 24);

          spriteCanvas.addEventListener('click', () => {
            document.querySelectorAll('.palette-sprite.selected').forEach(el => el.classList.remove('selected'));
            spriteCanvas.classList.add('selected');
            selectedSpriteId = spriteCanvas.dataset.spriteId;
            // Infer tile type from sheet name
            const typeMap = {
              grass: 'grass', water: 'water', 'tilled-dirt': 'tilled',
              fences: 'fence', paths: 'path', plants: 'decoration', biome: 'decoration',
            };
            selectedTileType = typeMap[sheetName] || 'decoration';
          });

          paletteGrid.appendChild(spriteCanvas);
        }
      };
    }

    sheetSelect.addEventListener('change', populatePalette);

    // ─── Module Select ─────────────────────────────────────────────────
    const moduleSelect = document.getElementById('module-select');

    function initModuleSelect() {
      moduleSelect.innerHTML = '<option value="">-- New Module --</option>';
      for (const mod of allModules) {
        const opt = document.createElement('option');
        opt.value = mod.id;
        opt.textContent = mod.name || mod.id;
        moduleSelect.appendChild(opt);
      }
    }

    moduleSelect.addEventListener('change', () => {
      const id = moduleSelect.value;
      if (!id) {
        newModule();
        return;
      }
      const mod = allModules.find(m => m.id === id);
      if (mod) loadModule(mod);
    });

    function loadModule(mod) {
      currentModule = mod;
      document.getElementById('module-id').value = mod.id;
      document.getElementById('module-name').value = mod.name;
      document.getElementById('prop-category').value = mod.category;
      document.getElementById('prop-rarity').value = Math.round(mod.rarity * 100);
      document.getElementById('prop-rarity-val').textContent = mod.rarity.toFixed(1);
      document.getElementById('prop-max').value = mod.maxInstances;
      document.getElementById('prop-min-area').value = mod.minWorldArea;
      document.getElementById('prop-affinity').value = mod.placement?.affinity || 'any';

      // Load tiles
      moduleTiles.clear();
      gridWidth = mod.width || 5;
      gridHeight = mod.height || 5;
      document.getElementById('grid-width').value = gridWidth;
      document.getElementById('grid-height').value = gridHeight;

      for (const t of (mod.tiles || [])) {
        moduleTiles.set(t.x + ',' + t.y + ',' + t.layer, { type: t.type, spriteId: t.spriteId });
      }

      connectionPoints = (mod.connectionPoints || []).slice();
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
      renderConnectionList();
    }

    function newModule() {
      currentModule = null;
      document.getElementById('module-id').value = '';
      document.getElementById('module-name').value = '';
      document.getElementById('prop-category').value = 'decorative';
      document.getElementById('prop-rarity').value = 50;
      document.getElementById('prop-rarity-val').textContent = '0.5';
      document.getElementById('prop-max').value = -1;
      document.getElementById('prop-min-area').value = 300;
      document.getElementById('prop-affinity').value = 'any';
      moduleTiles.clear();
      connectionPoints = [];
      gridWidth = 5;
      gridHeight = 5;
      document.getElementById('grid-width').value = 5;
      document.getElementById('grid-height').value = 5;
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
      renderConnectionList();
    }

    // ─── Grid Size ─────────────────────────────────────────────────────
    function updateSizeLabel() {
      document.getElementById('canvas-size').textContent = gridWidth + ' x ' + gridHeight;
    }

    function resizeCanvas() {
      canvas.width = gridWidth * TILE_SIZE * SCALE;
      canvas.height = gridHeight * TILE_SIZE * SCALE;
    }

    document.getElementById('grid-width').addEventListener('change', (e) => {
      gridWidth = Math.max(2, Math.min(20, parseInt(e.target.value) || 5));
      e.target.value = gridWidth;
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
    });

    document.getElementById('grid-height').addEventListener('change', (e) => {
      gridHeight = Math.max(2, Math.min(20, parseInt(e.target.value) || 5));
      e.target.value = gridHeight;
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
    });

    // ─── Layer Management ──────────────────────────────────────────────
    document.querySelectorAll('[data-vis]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const layer = parseInt(e.target.dataset.vis);
        layerVisible[layer] = e.target.checked;
        renderCanvas();
      });
    });

    document.querySelectorAll('[data-set]').forEach(el => {
      el.addEventListener('click', () => {
        activeLayer = parseInt(el.dataset.set);
        document.querySelectorAll('.layer-row').forEach(r => r.classList.remove('active'));
        el.closest('.layer-row').classList.add('active');
      });
    });

    // ─── Canvas Rendering ──────────────────────────────────────────────
    const sheetImages = {}; // Cache loaded sheet images

    function getSheetImage(sheetName) {
      if (sheetImages[sheetName]) return Promise.resolve(sheetImages[sheetName]);
      const sheet = spritesheets[sheetName];
      if (!sheet) return Promise.resolve(null);
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { sheetImages[sheetName] = img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = sheet.imageUrl;
      });
    }

    async function renderCanvas() {
      ctx.imageSmoothingEnabled = false;
      const s = TILE_SIZE * SCALE;

      // Clear
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid lines
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (let x = 0; x <= gridWidth; x++) {
        ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, gridHeight * s); ctx.stroke();
      }
      for (let y = 0; y <= gridHeight; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(gridWidth * s, y * s); ctx.stroke();
      }

      // Draw tiles layer by layer
      for (let layer = 0; layer <= 2; layer++) {
        if (!layerVisible[layer]) continue;

        // Dim non-active layers slightly
        const dimAlpha = (layer === activeLayer) ? 1.0 : 0.6;
        ctx.globalAlpha = dimAlpha;

        for (const [key, tile] of moduleTiles) {
          const [tx, ty, tl] = key.split(',').map(Number);
          if (tl !== layer) continue;

          const [sheetName, spriteName] = tile.spriteId.split('/');
          const sheet = spritesheets[sheetName];
          if (!sheet) continue;

          const sprite = sheet.sprites[spriteName];
          if (!sprite) continue;

          const img = await getSheetImage(sheetName);
          if (!img) continue;

          ctx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, tx * s, ty * s, s, s);
        }
      }
      ctx.globalAlpha = 1.0;

      // Draw connection points
      for (const cp of connectionPoints) {
        const colors = { path: '#29adff', grass: '#00e436', water: '#4488ff', fence: '#ffec27', any: '#8a8a8a' };
        ctx.fillStyle = colors[cp.type] || '#fff';
        const cx = cp.x * s + s / 2;
        const cy = cp.y * s + s / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 4 * SCALE, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Highlight active layer border
      ctx.strokeStyle = '#00e436';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }

    // ─── Canvas Interaction ────────────────────────────────────────────
    function canvasTilePos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const s = TILE_SIZE * SCALE;
      return { x: Math.floor(sx / s), y: Math.floor(sy / s) };
    }

    canvas.addEventListener('click', (e) => {
      const { x, y } = canvasTilePos(e);
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

      // Check if this is an edge tile (for connection points)
      const isEdge = (x === 0 || x === gridWidth - 1 || y === 0 || y === gridHeight - 1);

      if (e.shiftKey && isEdge) {
        // Toggle connection point
        toggleConnectionPoint(x, y);
        return;
      }

      if (!selectedSpriteId) return;

      const key = x + ',' + y + ',' + activeLayer;
      moduleTiles.set(key, { type: selectedTileType, spriteId: selectedSpriteId });
      renderCanvas();
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { x, y } = canvasTilePos(e);
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

      const key = x + ',' + y + ',' + activeLayer;
      moduleTiles.delete(key);
      renderCanvas();
    });

    // Hover info
    const hoverInfo = document.getElementById('hover-info');
    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = canvasTilePos(e);
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) {
        hoverInfo.style.display = 'none';
        return;
      }

      const lines = ['(' + x + ', ' + y + ')'];
      for (let l = 0; l <= 2; l++) {
        const tile = moduleTiles.get(x + ',' + y + ',' + l);
        if (tile) lines.push('L' + l + ': ' + tile.spriteId);
      }

      hoverInfo.innerHTML = lines.join('<br>');
      hoverInfo.style.display = 'block';
      hoverInfo.style.left = (e.clientX + 12) + 'px';
      hoverInfo.style.top = (e.clientY + 12) + 'px';
    });

    canvas.addEventListener('mouseleave', () => {
      hoverInfo.style.display = 'none';
    });

    // ─── Connection Points ─────────────────────────────────────────────
    function toggleConnectionPoint(x, y) {
      const idx = connectionPoints.findIndex(cp => cp.x === x && cp.y === y);
      if (idx !== -1) {
        connectionPoints.splice(idx, 1);
      } else {
        let edge = 'north';
        if (y === gridHeight - 1) edge = 'south';
        else if (x === 0) edge = 'west';
        else if (x === gridWidth - 1) edge = 'east';
        connectionPoints.push({ x, y, edge, type: 'path', required: false });
      }
      renderCanvas();
      renderConnectionList();
    }

    function renderConnectionList() {
      const list = document.getElementById('conn-list');
      if (connectionPoints.length === 0) {
        list.innerHTML = '<div style="font-size:9px;color:var(--pixel-muted);padding:4px;">Shift+click edge tiles to add connection points</div>';
        return;
      }

      list.innerHTML = connectionPoints.map((cp, i) => {
        return '<div class="conn-row">' +
          '<span class="conn-dot ' + cp.type + '"></span>' +
          '<span>(' + cp.x + ',' + cp.y + ') ' + cp.edge + '</span>' +
          '<select data-conn-idx="' + i + '" style="font-size:9px;background:var(--pixel-bg-light);color:var(--pixel-fg);border:1px solid var(--pixel-border);padding:0 2px;">' +
            '<option value="path"' + (cp.type === 'path' ? ' selected' : '') + '>path</option>' +
            '<option value="grass"' + (cp.type === 'grass' ? ' selected' : '') + '>grass</option>' +
            '<option value="water"' + (cp.type === 'water' ? ' selected' : '') + '>water</option>' +
            '<option value="any"' + (cp.type === 'any' ? ' selected' : '') + '>any</option>' +
          '</select>' +
          '<button data-conn-del="' + i + '" style="font-size:9px;background:var(--pixel-bg-light);color:var(--pixel-error);border:1px solid var(--pixel-border);cursor:pointer;padding:0 3px;">x</button>' +
          '</div>';
      }).join('');

      // Wire up events
      list.querySelectorAll('[data-conn-idx]').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.connIdx);
          connectionPoints[idx].type = e.target.value;
          renderCanvas();
        });
      });
      list.querySelectorAll('[data-conn-del]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.connDel);
          connectionPoints.splice(idx, 1);
          renderCanvas();
          renderConnectionList();
        });
      });
    }

    // ─── Rarity Slider ─────────────────────────────────────────────────
    document.getElementById('prop-rarity').addEventListener('input', (e) => {
      document.getElementById('prop-rarity-val').textContent = (parseInt(e.target.value) / 100).toFixed(1);
    });

    // ─── Save / New / Delete ───────────────────────────────────────────
    document.getElementById('btn-save').addEventListener('click', () => {
      const id = document.getElementById('module-id').value.trim();
      const name = document.getElementById('module-name').value.trim();
      if (!id) { alert('Module ID is required'); return; }

      // Convert moduleTiles Map to array
      const tiles = [];
      for (const [key, tile] of moduleTiles) {
        const [x, y, layer] = key.split(',').map(Number);
        tiles.push({ x, y, layer, type: tile.type, spriteId: tile.spriteId });
      }

      const moduleDef = {
        id,
        name: name || id,
        category: document.getElementById('prop-category').value,
        width: gridWidth,
        height: gridHeight,
        tiles,
        connectionPoints: connectionPoints.slice(),
        placement: {
          minDistFromPlots: 3,
          minDistFromSame: 10,
          minDistFromAny: 4,
          affinity: document.getElementById('prop-affinity').value,
          allowOverlapWater: false,
          allowOverlapDecorations: true,
          requiresGrass: true,
        },
        tags: [],
        rarity: parseInt(document.getElementById('prop-rarity').value) / 100,
        minWorldArea: parseInt(document.getElementById('prop-min-area').value) || 0,
        maxInstances: parseInt(document.getElementById('prop-max').value),
      };

      vscode.postMessage({ type: 'saveModule', data: moduleDef });

      // Update local list
      const existingIdx = allModules.findIndex(m => m.id === id);
      if (existingIdx >= 0) allModules[existingIdx] = moduleDef;
      else allModules.push(moduleDef);
      initModuleSelect();
      moduleSelect.value = id;
    });

    document.getElementById('btn-new').addEventListener('click', () => {
      moduleSelect.value = '';
      newModule();
    });

    document.getElementById('btn-delete').addEventListener('click', () => {
      const id = document.getElementById('module-id').value.trim();
      if (!id) return;
      vscode.postMessage({ type: 'deleteModule', data: { id } });
      allModules = allModules.filter(m => m.id !== id);
      initModuleSelect();
      newModule();
    });

    // Initial render
    resizeCanvas();
    renderCanvas();
  </script>
</body>
</html>`;
  }
}

// Singleton
let instance: ModuleEditorPanel | undefined;

export function getModuleEditorPanel(extensionUri: vscode.Uri): ModuleEditorPanel {
  if (!instance) {
    instance = new ModuleEditorPanel(extensionUri);
  }
  return instance;
}
