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
        case 'saveWeights':
          await this._saveWeights(message.data as Record<string, number>);
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

  private async _saveWeights(updates: Record<string, number>): Promise<void> {
    try {
      const registry = getModuleRegistry(this._extensionUri);
      let changed = 0;
      for (const [moduleId, weight] of Object.entries(updates)) {
        const mod = registry.get(moduleId);
        if (mod) {
          mod.weight = weight;
          changed++;
        }
      }
      if (changed > 0) {
        await registry.save();
        vscode.window.showInformationMessage(`Updated weights for ${changed} module(s)`);
      }
    } catch (error) {
      console.error('[ModuleEditor] Failed to save weights:', error);
      vscode.window.showErrorMessage(`Failed to save weights: ${error}`);
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
      max-height: 280px; overflow-y: auto;
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
    .clear-layer-btn {
      background: none; border: none; color: var(--pixel-error);
      cursor: pointer; font-size: 9px; padding: 0 2px;
      opacity: 0.5; margin-left: auto;
    }
    .clear-layer-btn:hover { opacity: 1; }

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

    /* ─── Category Weights ─── */
    .cat-weight-row {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 4px; font-size: 9px;
      border-bottom: 1px solid var(--pixel-border);
    }
    .cat-weight-row:last-child { border-bottom: none; }
    .cat-weight-row.current { background: var(--pixel-bg-light); }
    .cat-weight-row .cw-name {
      flex: 1; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; cursor: pointer;
    }
    .cat-weight-row .cw-name:hover { color: var(--pixel-accent); }
    .cat-weight-row.current .cw-name { color: var(--pixel-success); font-weight: bold; }
    .cat-weight-row input[type="number"] {
      width: 38px; font-family: inherit; font-size: 9px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 2px;
      text-align: right;
    }
    .cat-weight-row .cw-pct {
      min-width: 30px; text-align: right; color: var(--pixel-accent);
    }
    .cat-weight-row .cw-bar {
      width: 40px; height: 6px; background: var(--pixel-bg);
      border: 1px solid var(--pixel-border); position: relative;
    }
    .cat-weight-row .cw-bar-fill {
      height: 100%; background: var(--pixel-accent);
    }

    /* ─── Placed Tiles List ─── */
    .tile-list-container {
      max-height: 200px; overflow-y: auto;
      border: 1px solid var(--pixel-border);
      margin-bottom: 6px; background: var(--pixel-bg);
    }
    #tile-list { padding: 2px; }
    .tile-layer-group {
      margin-bottom: 4px;
    }
    .tile-layer-header {
      font-size: 9px; color: var(--pixel-accent);
      padding: 2px 4px; background: var(--pixel-bg-light);
      border-bottom: 1px solid var(--pixel-border);
      display: flex; justify-content: space-between;
    }
    .tile-entry {
      display: flex; align-items: center; gap: 4px;
      padding: 2px 4px; font-size: 9px;
      border-bottom: 1px solid var(--pixel-border);
    }
    .tile-entry:last-child { border-bottom: none; }
    .tile-entry:hover { background: var(--pixel-bg-light); }
    .tile-entry canvas {
      width: 16px; height: 16px; image-rendering: pixelated;
      border: 1px solid var(--pixel-border);
    }
    .tile-entry .tile-pos {
      color: var(--pixel-muted); min-width: 28px;
    }
    .tile-entry .tile-name {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .tile-entry .tile-remove {
      background: none; border: none; color: var(--pixel-error);
      cursor: pointer; font-size: 10px; padding: 0 2px;
      opacity: 0.6;
    }
    .tile-entry .tile-remove:hover { opacity: 1; }
    .tile-empty {
      text-align: center; color: var(--pixel-muted);
      padding: 8px; font-size: 9px;
    }

    /* ─── Content Shuffling ─── */
    .shuffle-summary {
      font-size: 9px; padding: 4px 6px;
      color: var(--pixel-muted); line-height: 1.6;
    }
    .shuffle-summary strong { color: var(--pixel-fg); }
    .swap-group-tag {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 6px; margin: 1px 2px;
      background: var(--pixel-bg-light); border: 1px solid var(--pixel-border);
      border-radius: 2px; font-size: 8px; cursor: pointer;
    }
    .swap-group-tag:hover { border-color: var(--pixel-accent); }
    .swap-group-tag .sg-count { color: var(--pixel-accent); }
    .shuffle-bulk-row {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 0; font-size: 9px;
    }
    .shuffle-bulk-row input, .shuffle-bulk-row select {
      font-family: inherit; font-size: 9px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 3px;
    }
    .shuffle-bulk-row button {
      font-family: inherit; font-size: 9px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 6px;
      cursor: pointer;
    }
    .shuffle-bulk-row button:hover { background: var(--pixel-accent); color: #000; }
    .variant-tile-entry {
      display: flex; align-items: center; gap: 4px;
      padding: 2px 4px; font-size: 8px;
      border-bottom: 1px solid var(--pixel-border);
      cursor: pointer;
    }
    .variant-tile-entry:hover { background: var(--pixel-bg-light); }
    .variant-tile-entry:last-child { border-bottom: none; }
    .variant-tile-entry .vt-pos { color: var(--pixel-muted); min-width: 28px; }
    .variant-tile-entry .vt-sprites { flex: 1; color: var(--pixel-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
    <div id="palette-count" style="font-size:9px;color:var(--pixel-muted);margin-bottom:4px;"></div>
    <div id="selected-sprite-indicator" style="display:flex;align-items:center;gap:6px;padding:4px;margin-bottom:4px;border:1px solid var(--pixel-border);background:var(--pixel-bg-light);min-height:28px;">
      <canvas id="selected-sprite-preview" width="24" height="24" style="image-rendering:pixelated;border:1px solid var(--pixel-border);"></canvas>
      <span id="selected-sprite-name" style="font-size:9px;color:var(--pixel-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">No sprite selected</span>
    </div>

    <!-- Layer Panel -->
    <div class="section-label">Layers</div>
    <div id="layer-panel">
      <div class="layer-row active" data-layer="0">
        <input type="checkbox" checked data-vis="0">
        <span class="layer-name" data-set="0">0 Ground</span>
        <button class="clear-layer-btn" data-clear="0" title="Clear layer">x</button>
      </div>
      <div class="layer-row" data-layer="1">
        <input type="checkbox" checked data-vis="1">
        <span class="layer-name" data-set="1">1 Terrain</span>
        <button class="clear-layer-btn" data-clear="1" title="Clear layer">x</button>
      </div>
      <div class="layer-row" data-layer="2">
        <input type="checkbox" checked data-vis="2">
        <span class="layer-name" data-set="2">2 Objects</span>
        <button class="clear-layer-btn" data-clear="2" title="Clear layer">x</button>
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

    <!-- Placed Tiles List -->
    <div class="section-label">Placed Tiles <span id="tile-count">(0)</span></div>
    <div class="tile-list-container">
      <div id="tile-list"></div>
    </div>

    <!-- Content Shuffling -->
    <div class="section-label">Content Shuffling</div>
    <div id="shuffle-section">
      <div id="shuffle-summary" class="shuffle-summary">No tiles placed</div>
      <div id="swap-groups-display" style="margin:3px 0;"></div>
      <div id="variant-tiles-display" style="max-height:100px;overflow-y:auto;border:1px solid var(--pixel-border);margin:3px 0;display:none;"></div>
      <div class="shuffle-bulk-row">
        <input id="bulk-swap-group" type="text" placeholder="group name" style="flex:1;">
        <button id="btn-assign-swap" title="Assign swap group to all object-layer tiles">Apply L2</button>
        <button id="btn-clear-swap" title="Clear all swap groups">Clear</button>
      </div>
    </div>

    <!-- Tile Properties (shown when a tile is selected) -->
    <div id="tile-props" style="display:none;">
      <div class="section-label">Tile Properties <span id="tile-props-pos" style="color:var(--pixel-muted);"></span></div>
      <div class="prop-row">
        <label>Variants:</label>
        <input id="tile-variants" type="text" placeholder="sheet/sprite1, sheet/sprite2" style="flex:1;font-size:9px;">
      </div>
      <div style="font-size:8px;color:var(--pixel-muted);margin:0 0 2px 64px;">Comma-separated sprite IDs (includes default)</div>
      <div class="prop-row">
        <label>Swap Group:</label>
        <input id="tile-swap-group" type="text" placeholder="e.g. ring, cluster" style="flex:1;font-size:9px;">
      </div>
      <div class="prop-row">
        <button id="tile-props-apply" style="font-size:9px;padding:2px 8px;">Apply</button>
        <button id="tile-props-close" style="font-size:9px;padding:2px 8px;">Close</button>
      </div>
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
        <option value="vegetation">Vegetation</option>
      </select>
    </div>
    <div class="prop-row">
      <label>Tags:</label>
      <input id="prop-tags" type="text" placeholder="water-crossing, north-south" style="flex:1;">
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

    <!-- Placement Rules -->
    <div class="section-label">Placement Rules</div>
    <div class="prop-row">
      <label style="min-width:auto;"><input type="checkbox" id="prop-overlap-water"> Allow over water</label>
    </div>
    <div class="prop-row">
      <label style="min-width:auto;"><input type="checkbox" id="prop-requires-grass" checked> Requires grass</label>
    </div>
    <div class="prop-row">
      <label style="min-width:auto;"><input type="checkbox" id="prop-overlap-deco" checked> Allow over decorations</label>
    </div>
    <div class="prop-row">
      <label>Plot dist:</label>
      <input id="prop-dist-plots" type="number" min="0" max="20" value="3" style="width:36px">
      <label>Same dist:</label>
      <input id="prop-dist-same" type="number" min="0" max="50" value="10" style="width:36px">
    </div>
    <div class="prop-row">
      <label>Any dist:</label>
      <input id="prop-dist-any" type="number" min="0" max="20" value="4" style="width:36px">
    </div>

    <!-- Connection Points -->
    <div class="section-label">Connection Points</div>
    <div id="conn-list">
      <div class="empty-state" style="font-size:9px; padding:4px;">Click edge tiles on the canvas to add connection points</div>
    </div>

    <!-- Category Weights -->
    <div class="section-label">Category Weights <span id="cat-weight-category" style="color:var(--pixel-muted);"></span></div>
    <div id="cat-weights-list" style="border:1px solid var(--pixel-border);margin-bottom:6px;max-height:180px;overflow-y:auto;"></div>
    <div style="display:flex;gap:4px;">
      <button id="btn-save-weights" style="font-size:9px;padding:2px 8px;font-family:inherit;background:var(--pixel-bg-light);color:var(--pixel-fg);border:1px solid var(--pixel-border);cursor:pointer;">Save Weights</button>
      <button id="btn-normalize-weights" style="font-size:9px;padding:2px 8px;font-family:inherit;background:var(--pixel-bg-light);color:var(--pixel-fg);border:1px solid var(--pixel-border);cursor:pointer;">Normalize to 1.0</button>
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

    // Module tile data: Map<"x,y,layer" -> {type, spriteId, variants?, swapGroup?}>
    let moduleTiles = new Map();
    let connectionPoints = [];

    // Category weight edits: moduleId -> weight (pending save)
    const weightEdits = new Map();

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
          renderTileList();
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

      const spriteCount = Object.keys(sheet.sprites).length;
      console.log('[ModuleEditor] Loading palette for:', sheetName, 'sprite count:', spriteCount);

      // Load sheet image
      const img = new Image();
      img.src = sheet.imageUrl;
      img.onerror = () => {
        console.error('[ModuleEditor] Failed to load image for:', sheetName);
        paletteGrid.innerHTML = '<div style="color:red;font-size:10px;">Failed to load sheet image</div>';
      };
      img.onload = () => {
        console.log('[ModuleEditor] Image loaded, rendering', spriteCount, 'sprites');
        let rendered = 0;
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
              fences: 'fence', paths: 'path', bridges: 'bridge',
              plants: 'decoration', biome: 'decoration',
            };
            selectedTileType = typeMap[sheetName] || 'decoration';

            // Update selected sprite indicator
            const pCtx = document.getElementById('selected-sprite-preview').getContext('2d');
            pCtx.clearRect(0, 0, 24, 24);
            pCtx.imageSmoothingEnabled = false;
            pCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 24, 24);
            document.getElementById('selected-sprite-name').textContent = selectedSpriteId;
          });

          paletteGrid.appendChild(spriteCanvas);
          rendered++;
        }
        document.getElementById('palette-count').textContent = rendered + ' sprites';
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
      document.getElementById('prop-tags').value = (mod.tags || []).join(', ');

      // Placement rules
      const pl = mod.placement || {};
      document.getElementById('prop-overlap-water').checked = pl.allowOverlapWater || false;
      document.getElementById('prop-requires-grass').checked = pl.requiresGrass !== false; // default true
      document.getElementById('prop-overlap-deco').checked = pl.allowOverlapDecorations !== false; // default true
      document.getElementById('prop-dist-plots').value = pl.minDistFromPlots ?? 3;
      document.getElementById('prop-dist-same').value = pl.minDistFromSame ?? 10;
      document.getElementById('prop-dist-any').value = pl.minDistFromAny ?? 4;

      // Load tiles
      moduleTiles.clear();
      gridWidth = mod.width || 5;
      gridHeight = mod.height || 5;
      document.getElementById('grid-width').value = gridWidth;
      document.getElementById('grid-height').value = gridHeight;

      for (const t of (mod.tiles || [])) {
        const tileData = { type: t.type, spriteId: t.spriteId };
        if (t.variants && t.variants.length > 0) tileData.variants = t.variants;
        if (t.swapGroup) tileData.swapGroup = t.swapGroup;
        moduleTiles.set(t.x + ',' + t.y + ',' + t.layer, tileData);
      }

      connectionPoints = (mod.connectionPoints || []).slice();
      weightEdits.clear();
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
      renderTileList();
      renderConnectionList();
      renderCategoryWeights();
      renderShuffleSection();
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
      document.getElementById('prop-tags').value = '';
      document.getElementById('prop-overlap-water').checked = false;
      document.getElementById('prop-requires-grass').checked = true;
      document.getElementById('prop-overlap-deco').checked = true;
      document.getElementById('prop-dist-plots').value = 3;
      document.getElementById('prop-dist-same').value = 10;
      document.getElementById('prop-dist-any').value = 4;
      moduleTiles.clear();
      connectionPoints = [];
      gridWidth = 5;
      gridHeight = 5;
      document.getElementById('grid-width').value = 5;
      document.getElementById('grid-height').value = 5;
      weightEdits.clear();
      updateSizeLabel();
      resizeCanvas();
      renderCanvas();
      renderTileList();
      renderConnectionList();
      renderCategoryWeights();
      renderShuffleSection();
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

    // Clear layer buttons
    document.querySelectorAll('.clear-layer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = parseInt(e.target.dataset.clear);
        // Delete all tiles on this layer
        const keysToDelete = [];
        for (const key of moduleTiles.keys()) {
          const [, , l] = key.split(',').map(Number);
          if (l === layer) keysToDelete.push(key);
        }
        keysToDelete.forEach(k => moduleTiles.delete(k));
        renderCanvas();
        renderTileList();
        renderShuffleSection();
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
      renderTileList();
      renderShuffleSection();
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { x, y } = canvasTilePos(e);
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

      const key = x + ',' + y + ',' + activeLayer;
      moduleTiles.delete(key);
      renderCanvas();
      renderTileList();
      renderShuffleSection();
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

    // ─── Placed Tiles List ──────────────────────────────────────────────
    async function renderTileList() {
      const listEl = document.getElementById('tile-list');
      const countEl = document.getElementById('tile-count');

      // Group tiles by layer
      const byLayer = { 0: [], 1: [], 2: [] };
      for (const [key, tile] of moduleTiles) {
        const [x, y, layer] = key.split(',').map(Number);
        if (byLayer[layer]) {
          byLayer[layer].push({ x, y, layer, key, ...tile });
        }
      }

      // Sort each layer by position
      for (let l = 0; l <= 2; l++) {
        byLayer[l].sort((a, b) => (a.y * 100 + a.x) - (b.y * 100 + b.x));
      }

      const totalTiles = Object.values(byLayer).flat().length;
      countEl.textContent = '(' + totalTiles + ')';

      if (totalTiles === 0) {
        listEl.innerHTML = '<div class="tile-empty">No tiles placed yet</div>';
        return;
      }

      const layerNames = ['Ground', 'Terrain', 'Objects'];
      let html = '';

      for (let l = 0; l <= 2; l++) {
        if (byLayer[l].length === 0) continue;

        html += '<div class="tile-layer-group">';
        html += '<div class="tile-layer-header"><span>L' + l + ' ' + layerNames[l] + '</span><span>' + byLayer[l].length + '</span></div>';

        for (const tile of byLayer[l]) {
          const badges = [];
          if (tile.variants && tile.variants.length > 0) badges.push('<span style="color:var(--pixel-accent);font-size:8px;" title="Has ' + tile.variants.length + ' variants">V' + tile.variants.length + '</span>');
          if (tile.swapGroup) badges.push('<span style="color:#ff77a8;font-size:8px;" title="Swap group: ' + tile.swapGroup + '">S</span>');

          html += '<div class="tile-entry" data-key="' + tile.key + '">';
          html += '<canvas width="16" height="16" data-sprite="' + tile.spriteId + '"></canvas>';
          html += '<span class="tile-pos">(' + tile.x + ',' + tile.y + ')</span>';
          html += '<span class="tile-name">' + tile.spriteId + '</span>';
          html += badges.join(' ');
          html += '<button class="tile-remove" data-key="' + tile.key + '" title="Remove tile">x</button>';
          html += '</div>';
        }
        html += '</div>';
      }

      listEl.innerHTML = html;

      // Render sprite previews
      for (const entry of listEl.querySelectorAll('.tile-entry canvas')) {
        const spriteId = entry.dataset.sprite;
        const [sheetName, spriteName] = spriteId.split('/');
        const sheet = spritesheets[sheetName];
        if (!sheet) continue;
        const sprite = sheet.sprites[spriteName];
        if (!sprite) continue;

        const img = await getSheetImage(sheetName);
        if (!img) continue;

        const sctx = entry.getContext('2d');
        sctx.imageSmoothingEnabled = false;
        sctx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 16, 16);
      }

      // Wire up remove buttons
      listEl.querySelectorAll('.tile-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = e.target.dataset.key;
          moduleTiles.delete(key);
          renderCanvas();
          renderTileList();
          renderShuffleSection();
        });
      });

      // Click on entry to select, highlight on canvas, and show tile props
      listEl.querySelectorAll('.tile-entry').forEach(entry => {
        entry.addEventListener('click', (e) => {
          if (e.target.classList.contains('tile-remove')) return;
          const key = entry.dataset.key;
          const [x, y, layer] = key.split(',').map(Number);

          // Set active layer
          activeLayer = layer;
          document.querySelectorAll('.layer-row').forEach(r => {
            r.classList.toggle('active', parseInt(r.dataset.layer) === layer);
          });

          // Show tile properties panel
          showTileProps(key);

          // Flash the tile on canvas
          flashTile(x, y);
        });
      });
    }

    // Flash animation to highlight a tile
    function flashTile(fx, fy) {
      const s = TILE_SIZE * SCALE;
      let flashCount = 0;
      const flashInterval = setInterval(() => {
        renderCanvas().then(() => {
          if (flashCount % 2 === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(fx * s, fy * s, s, s);
          }
          flashCount++;
          if (flashCount >= 6) {
            clearInterval(flashInterval);
            renderCanvas();
          }
        });
      }, 100);
    }

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
        list.innerHTML = '<div style="font-size:9px;color:var(--pixel-muted);padding:6px;line-height:1.5;">' +
          '<strong style="color:var(--pixel-accent);">No connection points</strong><br>' +
          'Shift+click edge tiles on the canvas to define where this module ' +
          'connects to adjacent terrain (paths, grass, water, fences).' +
          '</div>';
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
            '<option value="fence"' + (cp.type === 'fence' ? ' selected' : '') + '>fence</option>' +
            '<option value="any"' + (cp.type === 'any' ? ' selected' : '') + '>any</option>' +
          '</select>' +
          '<label style="font-size:9px;display:flex;align-items:center;gap:2px;">' +
            '<input type="checkbox" data-conn-req="' + i + '"' + (cp.required ? ' checked' : '') + ' style="width:10px;height:10px;">' +
            'req' +
          '</label>' +
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
      list.querySelectorAll('[data-conn-req]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.connReq);
          connectionPoints[idx].required = e.target.checked;
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

    // ─── Rarity Slider ──────────────────────────────────────────────────
    document.getElementById('prop-rarity').addEventListener('input', (e) => {
      document.getElementById('prop-rarity-val').textContent = (parseInt(e.target.value) / 100).toFixed(1);
    });

    // ─── Category Weights ───────────────────────────────────────────────

    function getEffectiveWeight(mod) {
      if (weightEdits.has(mod.id)) return weightEdits.get(mod.id);
      return mod.weight ?? 1.0;
    }

    function getCategoryWeightForModule(moduleId) {
      if (weightEdits.has(moduleId)) return weightEdits.get(moduleId);
      const mod = allModules.find(m => m.id === moduleId);
      return mod ? (mod.weight ?? 1.0) : 1.0;
    }

    function renderCategoryWeights() {
      const category = document.getElementById('prop-category').value;
      const currentId = document.getElementById('module-id').value.trim();
      document.getElementById('cat-weight-category').textContent = '(' + category + ')';

      const peers = allModules.filter(m => m.category === category);

      if (peers.length === 0) {
        document.getElementById('cat-weights-list').innerHTML =
          '<div style="padding:6px;font-size:9px;color:var(--pixel-muted);">No modules in this category</div>';
        return;
      }

      const totalWeight = peers.reduce((sum, m) => sum + getEffectiveWeight(m), 0);

      let html = '';
      for (const mod of peers) {
        const w = getEffectiveWeight(mod);
        const pct = totalWeight > 0 ? (w / totalWeight * 100) : 0;
        const isCurrent = mod.id === currentId;

        html += '<div class="cat-weight-row' + (isCurrent ? ' current' : '') + '" data-mod-id="' + mod.id + '">';
        html += '<span class="cw-name" title="' + mod.id + '">' + (mod.name || mod.id) + '</span>';
        html += '<input type="number" class="cw-input" data-mod-id="' + mod.id + '" value="' + w.toFixed(1) + '" min="0.1" max="10" step="0.1">';
        html += '<span class="cw-pct">' + pct.toFixed(0) + '%</span>';
        html += '<div class="cw-bar"><div class="cw-bar-fill" style="width:' + Math.min(pct, 100) + '%"></div></div>';
        html += '</div>';
      }

      document.getElementById('cat-weights-list').innerHTML = html;

      // Wire weight input changes
      document.querySelectorAll('.cw-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const modId = e.target.dataset.modId;
          const val = parseFloat(e.target.value);
          if (isNaN(val) || val < 0) return;
          weightEdits.set(modId, val);
          // Update percentages without full re-render (avoids losing focus)
          updateCategoryPercentages();
        });
      });

      // Wire name clicks to jump to that module
      document.querySelectorAll('.cw-name').forEach(el => {
        el.addEventListener('click', () => {
          const modId = el.closest('.cat-weight-row').dataset.modId;
          if (modId === currentId) return;
          moduleSelect.value = modId;
          const mod = allModules.find(m => m.id === modId);
          if (mod) loadModule(mod);
        });
      });
    }

    function updateCategoryPercentages() {
      const category = document.getElementById('prop-category').value;
      const peers = allModules.filter(m => m.category === category);
      const totalWeight = peers.reduce((sum, m) => sum + getEffectiveWeight(m), 0);

      document.querySelectorAll('.cat-weight-row').forEach(row => {
        const modId = row.dataset.modId;
        const w = getEffectiveWeight(allModules.find(m => m.id === modId) || { id: modId });
        const pct = totalWeight > 0 ? (w / totalWeight * 100) : 0;
        row.querySelector('.cw-pct').textContent = pct.toFixed(0) + '%';
        row.querySelector('.cw-bar-fill').style.width = Math.min(pct, 100) + '%';
      });
    }

    // Save all weight edits to backend
    document.getElementById('btn-save-weights').addEventListener('click', () => {
      if (weightEdits.size === 0) return;
      const updates = {};
      for (const [modId, weight] of weightEdits) {
        updates[modId] = weight;
        // Also update in-memory
        const mod = allModules.find(m => m.id === modId);
        if (mod) mod.weight = weight;
      }
      vscode.postMessage({ type: 'saveWeights', data: updates });
      weightEdits.clear();
    });

    // Normalize weights so they sum to 1.0
    document.getElementById('btn-normalize-weights').addEventListener('click', () => {
      const category = document.getElementById('prop-category').value;
      const peers = allModules.filter(m => m.category === category);
      const totalWeight = peers.reduce((sum, m) => sum + getEffectiveWeight(m), 0);
      if (totalWeight <= 0 || peers.length === 0) return;

      for (const mod of peers) {
        const normalized = getEffectiveWeight(mod) / totalWeight;
        weightEdits.set(mod.id, parseFloat(normalized.toFixed(2)));
      }
      renderCategoryWeights();
    });

    // Re-render category weights when category changes
    document.getElementById('prop-category').addEventListener('change', renderCategoryWeights);

    // ─── Tile Properties (variants / swap group) ────────────────────────
    let selectedTileKey = null; // "x,y,layer" of currently selected tile

    function showTileProps(key) {
      selectedTileKey = key;
      const tile = moduleTiles.get(key);
      if (!tile) return;
      const [x, y, layer] = key.split(',').map(Number);
      document.getElementById('tile-props-pos').textContent = '(' + x + ',' + y + ' L' + layer + ')';
      document.getElementById('tile-variants').value = (tile.variants || []).join(', ');
      document.getElementById('tile-swap-group').value = tile.swapGroup || '';
      document.getElementById('tile-props').style.display = 'block';
    }

    function hideTileProps() {
      selectedTileKey = null;
      document.getElementById('tile-props').style.display = 'none';
    }

    document.getElementById('tile-props-apply').addEventListener('click', () => {
      if (!selectedTileKey) return;
      const tile = moduleTiles.get(selectedTileKey);
      if (!tile) return;

      const variantsRaw = document.getElementById('tile-variants').value.trim();
      if (variantsRaw) {
        tile.variants = variantsRaw.split(',').map(v => v.trim()).filter(v => v.length > 0);
      } else {
        delete tile.variants;
      }

      const swapGroup = document.getElementById('tile-swap-group').value.trim();
      if (swapGroup) {
        tile.swapGroup = swapGroup;
      } else {
        delete tile.swapGroup;
      }

      renderTileList();
      renderShuffleSection();
    });

    document.getElementById('tile-props-close').addEventListener('click', hideTileProps);

    // ─── Content Shuffling ──────────────────────────────────────────────
    function renderShuffleSection() {
      const tiles = Array.from(moduleTiles.entries());
      const totalTiles = tiles.length;

      // Collect swap groups
      const swapGroups = new Map(); // groupName -> [{key, tile}]
      const variantTiles = []; // [{key, tile}]

      for (const [key, tile] of tiles) {
        if (tile.swapGroup) {
          if (!swapGroups.has(tile.swapGroup)) swapGroups.set(tile.swapGroup, []);
          swapGroups.get(tile.swapGroup).push({ key, tile });
        }
        if (tile.variants && tile.variants.length > 0) {
          variantTiles.push({ key, tile });
        }
      }

      // Summary
      const summaryEl = document.getElementById('shuffle-summary');
      if (totalTiles === 0) {
        summaryEl.innerHTML = 'No tiles placed';
      } else {
        const parts = [];
        if (variantTiles.length > 0) {
          parts.push('<strong>' + variantTiles.length + '</strong> tile(s) with variants');
        }
        if (swapGroups.size > 0) {
          const groupCount = swapGroups.size;
          const tileCount = Array.from(swapGroups.values()).reduce((s, g) => s + g.length, 0);
          parts.push('<strong>' + tileCount + '</strong> tile(s) in <strong>' + groupCount + '</strong> swap group(s)');
        }
        if (parts.length === 0) {
          summaryEl.innerHTML = totalTiles + ' tiles, no shuffling configured';
        } else {
          summaryEl.innerHTML = parts.join(' · ');
        }
      }

      // Swap groups display
      const groupsEl = document.getElementById('swap-groups-display');
      if (swapGroups.size === 0) {
        groupsEl.innerHTML = '';
      } else {
        let html = '';
        for (const [name, members] of swapGroups) {
          html += '<span class="swap-group-tag" data-sg="' + name + '" title="Click to select group tiles">';
          html += name + ' <span class="sg-count">(' + members.length + ')</span>';
          html += '</span>';
        }
        groupsEl.innerHTML = html;

        // Click group tag to highlight those tiles on canvas
        groupsEl.querySelectorAll('.swap-group-tag').forEach(tag => {
          tag.addEventListener('click', () => {
            const groupName = tag.dataset.sg;
            const members = swapGroups.get(groupName);
            if (!members) return;
            // Flash all tiles in the group
            for (const m of members) {
              const [x, y] = m.key.split(',').map(Number);
              flashTile(x, y);
            }
          });
        });
      }

      // Variant tiles display
      const variantsEl = document.getElementById('variant-tiles-display');
      if (variantTiles.length === 0) {
        variantsEl.style.display = 'none';
      } else {
        variantsEl.style.display = 'block';
        let html = '';
        for (const { key, tile } of variantTiles) {
          const [x, y, layer] = key.split(',').map(Number);
          html += '<div class="variant-tile-entry" data-key="' + key + '">';
          html += '<span class="vt-pos">(' + x + ',' + y + ' L' + layer + ')</span>';
          html += '<span class="vt-sprites">' + tile.variants.join(', ') + '</span>';
          html += '</div>';
        }
        variantsEl.innerHTML = html;

        // Click to show tile props
        variantsEl.querySelectorAll('.variant-tile-entry').forEach(entry => {
          entry.addEventListener('click', () => {
            const key = entry.dataset.key;
            const [x, y] = key.split(',').map(Number);
            showTileProps(key);
            flashTile(x, y);
          });
        });
      }
    }

    // Bulk assign swap group to all layer 2 tiles
    document.getElementById('btn-assign-swap').addEventListener('click', () => {
      const groupName = document.getElementById('bulk-swap-group').value.trim();
      if (!groupName) return;

      let count = 0;
      for (const [key, tile] of moduleTiles) {
        const [, , layer] = key.split(',').map(Number);
        if (layer >= 2) {
          tile.swapGroup = groupName;
          count++;
        }
      }
      if (count > 0) {
        renderTileList();
        renderShuffleSection();
      }
    });

    // Clear all swap groups
    document.getElementById('btn-clear-swap').addEventListener('click', () => {
      let count = 0;
      for (const [, tile] of moduleTiles) {
        if (tile.swapGroup) {
          delete tile.swapGroup;
          count++;
        }
      }
      if (count > 0) {
        renderTileList();
        renderShuffleSection();
      }
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
        const entry = { x, y, layer, type: tile.type, spriteId: tile.spriteId };
        if (tile.variants && tile.variants.length > 0) entry.variants = tile.variants;
        if (tile.swapGroup) entry.swapGroup = tile.swapGroup;
        tiles.push(entry);
      }

      // Parse tags from comma-separated input
      const tagsRaw = document.getElementById('prop-tags').value;
      const tags = tagsRaw
        ? tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

      const moduleDef = {
        id,
        name: name || id,
        category: document.getElementById('prop-category').value,
        width: gridWidth,
        height: gridHeight,
        tiles,
        connectionPoints: connectionPoints.slice(),
        placement: {
          minDistFromPlots: parseInt(document.getElementById('prop-dist-plots').value) || 0,
          minDistFromSame: parseInt(document.getElementById('prop-dist-same').value) || 0,
          minDistFromAny: parseInt(document.getElementById('prop-dist-any').value) || 0,
          affinity: document.getElementById('prop-affinity').value,
          allowOverlapWater: document.getElementById('prop-overlap-water').checked,
          allowOverlapDecorations: document.getElementById('prop-overlap-deco').checked,
          requiresGrass: document.getElementById('prop-requires-grass').checked,
        },
        tags,
        rarity: parseInt(document.getElementById('prop-rarity').value) / 100,
        weight: getCategoryWeightForModule(id),
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
    renderShuffleSection();
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
