/**
 * TerrainConfigPanel - Visual terrain bitmask configuration editor
 *
 * Workflow:
 * 1. Define grid zones on sprite artwork (drag to create zones)
 * 2. For each cell, toggle connection indicators (N/E/S/W)
 * 3. System maps terrain neighbor patterns to sprites
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getAssetLoader, WebviewAssetData } from '../overworld/core/AssetLoader';
import { AutotilerConfig, TerrainConfig, TerrainTransition } from '../overworld/core/types';

/** Connection pattern for a cell */
export interface ConnectionPattern {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
  // Diagonal connections
  northeast: boolean;
  southeast: boolean;
  southwest: boolean;
  northwest: boolean;
  /** Optional: special variant (e.g., "pond-center") */
  variant?: string;
}

/** A single cell in a grid zone */
export interface GridCell {
  /** Pixel X position in spritesheet */
  x: number;
  /** Pixel Y position in spritesheet */
  y: number;
  /** Connection pattern this cell represents */
  connections: ConnectionPattern;
  /** Sprite name (auto-detected or manual) */
  spriteName: string;
}

/** A user-defined grid zone on the spritesheet */
export interface GridZone {
  id: string;
  name: string;
  /** Pixel X position in spritesheet */
  x: number;
  /** Pixel Y position in spritesheet */
  y: number;
  /** Number of columns */
  cols: number;
  /** Number of rows */
  rows: number;
  /** Cell size in pixels */
  cellSize: number;
  /** Cells with their connection patterns */
  cells: GridCell[];
}

/** Terrain sprite mapping config (stored alongside terrain-bitmask.json) */
export interface TerrainSpriteMapping {
  terrainType: string;
  spritesheet: string;
  zones: GridZone[];
}

export class TerrainConfigPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.terrainConfig';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _config: AutotilerConfig | null = null;
  private _assets: WebviewAssetData | null = null;
  private _mappings: Map<string, TerrainSpriteMapping> = new Map();

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
          await this._sendMappings();
          break;
        case 'saveConfig':
          await this._saveConfig(message.data as AutotilerConfig);
          break;
        case 'saveMappings':
          await this._saveMappings(message.data as { terrainType: string; mapping: TerrainSpriteMapping });
          break;
        case 'generateBitmaskConfig':
          await this._generateBitmaskConfig(message.data as string);
          break;
        case 'addTerrain':
          await this._addTerrain(message.data as TerrainConfig);
          break;
        case 'deleteTerrain':
          await this._deleteTerrain(message.data as number);
          break;
        case 'addTransition':
          await this._addTransition(message.data as TerrainTransition);
          break;
        case 'deleteTransition':
          await this._deleteTransition(message.data as number);
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
      console.error('[TerrainConfigPanel] Failed to load assets:', error);
    }
  }

  private async _loadConfig(): Promise<void> {
    const configPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'terrain-bitmask.json'
    );
    try {
      const content = await vscode.workspace.fs.readFile(configPath);
      this._config = JSON.parse(content.toString());
    } catch (e) {
      console.warn('[TerrainConfigPanel] Failed to load config:', e);
      this._config = {
        version: 1,
        terrains: [],
        transitions: [],
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

  private async _loadMappings(): Promise<void> {
    const mappingsPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'terrain-sprite-mappings.json'
    );
    try {
      const content = await vscode.workspace.fs.readFile(mappingsPath);
      const data = JSON.parse(content.toString());
      this._mappings = new Map(Object.entries(data.mappings || {}));
    } catch (e) {
      console.warn('[TerrainConfigPanel] No sprite mappings found, starting fresh');
      this._mappings = new Map();
    }
  }

  private async _sendMappings(): Promise<void> {
    if (!this._view) return;
    if (this._mappings.size === 0) {
      await this._loadMappings();
    }
    this._view.webview.postMessage({
      type: 'loadMappings',
      mappings: Object.fromEntries(this._mappings),
    });
  }

  private async _saveConfig(config: AutotilerConfig): Promise<void> {
    const configPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'terrain-bitmask.json'
    );
    try {
      const content = JSON.stringify(config, null, 2);
      await vscode.workspace.fs.writeFile(configPath, Buffer.from(content, 'utf-8'));
      this._config = config;
      this._view?.webview.postMessage({ type: 'saveSuccess' });
    } catch (e) {
      console.error('[TerrainConfigPanel] Failed to save config:', e);
      this._view?.webview.postMessage({ type: 'saveError', error: String(e) });
    }
  }

  private async _saveMappings(data: { terrainType: string; mapping: TerrainSpriteMapping }): Promise<void> {
    this._mappings.set(data.terrainType, data.mapping);

    const mappingsPath = vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'terrain-sprite-mappings.json'
    );
    try {
      const content = JSON.stringify({
        version: 1,
        mappings: Object.fromEntries(this._mappings)
      }, null, 2);
      await vscode.workspace.fs.writeFile(mappingsPath, Buffer.from(content, 'utf-8'));

      // Auto-generate bitmask config so test canvas sees changes immediately
      await this._generateBitmaskConfig(data.terrainType);

      // Send updated config back to webview so test canvas refreshes
      this._view?.webview.postMessage({ type: 'saveSuccess' });
      this._view?.webview.postMessage({ type: 'loadConfig', config: this._config });
    } catch (e) {
      console.error('[TerrainConfigPanel] Failed to save mappings:', e);
      this._view?.webview.postMessage({ type: 'saveError', error: String(e) });
    }
  }

  /**
   * Mask out diagonal bits where one or both adjacent cardinals are absent.
   * A diagonal is only visually relevant when both flanking cardinals are present
   * (otherwise the edge/corner already covers that visual).
   */
  private _maskIrrelevantDiagonals(mask: number): number {
    const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
    if (!(mask & N) || !(mask & E)) mask &= ~NE;
    if (!(mask & E) || !(mask & S)) mask &= ~SE;
    if (!(mask & S) || !(mask & W)) mask &= ~SW;
    if (!(mask & W) || !(mask & N)) mask &= ~NW;
    return mask;
  }

  private async _generateBitmaskConfig(terrainType: string): Promise<void> {
    const mapping = this._mappings.get(terrainType);
    if (!mapping || !this._config) return;

    const terrain = this._config.terrains.find(t => t.type === terrainType);
    if (!terrain) return;

    // Build 8-bit bitmask mappings from zone cells (256 possible values)
    const newMappings = Array(256).fill(terrain.defaultSprite);

    // Direction bits for 8-direction bitmask
    const DIR = {
      N: 1, NE: 2, E: 4, SE: 8,
      S: 16, SW: 32, W: 64, NW: 128
    };

    for (const zone of mapping.zones) {
      for (const cell of zone.cells) {
        // Calculate 8-bit bitmask from connections
        let bitmask = 0;
        if (cell.connections.north) bitmask |= DIR.N;
        if (cell.connections.northeast) bitmask |= DIR.NE;
        if (cell.connections.east) bitmask |= DIR.E;
        if (cell.connections.southeast) bitmask |= DIR.SE;
        if (cell.connections.south) bitmask |= DIR.S;
        if (cell.connections.southwest) bitmask |= DIR.SW;
        if (cell.connections.west) bitmask |= DIR.W;
        if (cell.connections.northwest) bitmask |= DIR.NW;

        // Mask irrelevant diagonals so the canonical bitmask matches lookups
        bitmask = this._maskIrrelevantDiagonals(bitmask);
        newMappings[bitmask] = cell.spriteName;
      }
    }

    terrain.bitmaskMappings = newMappings;
    await this._saveConfig(this._config);
  }

  private async _addTerrain(terrain: TerrainConfig): Promise<void> {
    if (!this._config) return;
    this._config.terrains.push(terrain);
    await this._saveConfig(this._config);
  }

  private async _deleteTerrain(index: number): Promise<void> {
    if (!this._config) return;
    this._config.terrains.splice(index, 1);
    await this._saveConfig(this._config);
  }

  private async _addTransition(transition: TerrainTransition): Promise<void> {
    if (!this._config) return;
    this._config.transitions.push(transition);
    await this._saveConfig(this._config);
  }

  private async _deleteTransition(index: number): Promise<void> {
    if (!this._config) return;
    this._config.transitions.splice(index, 1);
    await this._saveConfig(this._config);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
  <title>Terrain Config</title>
  <style>
    ${PIXEL_THEME_CSS}

    * { box-sizing: border-box; }

    body {
      padding: 6px;
      font-size: 11px;
      overflow-x: hidden;
    }

    .section-label {
      font-size: 9px;
      color: var(--pixel-accent);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 8px 0 4px;
      padding-bottom: 2px;
      border-bottom: 1px solid var(--pixel-border);
    }

    .toolbar {
      display: flex;
      gap: 4px;
      margin-bottom: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    select, input, button {
      font-family: inherit;
      font-size: 10px;
      background: var(--pixel-bg-light);
      color: var(--pixel-fg);
      border: 1px solid var(--pixel-border);
      padding: 2px 6px;
    }

    button:hover { background: var(--pixel-accent); color: #000; }
    button.active { background: var(--pixel-success); color: #000; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Terrain list */
    .terrain-list {
      max-height: 80px;
      overflow-y: auto;
      border: 1px solid var(--pixel-border);
      margin-bottom: 6px;
    }

    .terrain-item {
      padding: 3px 6px;
      border-bottom: 1px solid var(--pixel-border);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .terrain-item:hover { background: var(--pixel-bg-light); }
    .terrain-item.active { background: var(--pixel-accent); color: #000; }

    /* Main layout */
    .editor-layout {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Spritesheet viewer */
    .spritesheet-container {
      border: 2px solid var(--pixel-border);
      background: #1a1a1a;
      position: relative;
      overflow: auto;
      max-height: 500px;
      min-height: 300px;
    }

    .spritesheet-canvas {
      display: block;
      image-rendering: pixelated;
    }

    #canvas-wrapper {
      display: inline-block;
      position: relative;
    }

    /* Zone overlay */
    .zone-overlay {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: auto;
      cursor: crosshair;
    }

    .zone-rect {
      position: absolute;
      border: 2px solid var(--pixel-accent);
      background: rgba(255, 200, 0, 0.1);
    }

    .zone-rect.selected {
      border-color: var(--pixel-success);
      background: rgba(100, 255, 100, 0.15);
    }

    .zone-label {
      position: absolute;
      top: -14px;
      left: 0;
      font-size: 8px;
      background: var(--pixel-accent);
      color: #000;
      padding: 1px 4px;
      white-space: nowrap;
    }

    .zone-rect.selected .zone-label {
      background: var(--pixel-success);
    }

    /* Cell grid overlay */
    .cell-grid {
      position: absolute;
      pointer-events: auto;
    }

    .cell {
      position: absolute;
      border: 1px solid rgba(255, 200, 0, 0.5);
      cursor: pointer;
      transition: background 0.1s;
    }

    .cell:hover {
      background: rgba(255, 200, 0, 0.3);
    }

    .cell.selected {
      background: rgba(100, 255, 100, 0.4);
      border-color: var(--pixel-success);
    }

    /* Connection indicators on cell */
    .cell-indicator {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 1px;
    }

    .cell-indicator.n { top: 1px; left: 50%; transform: translateX(-50%); }
    .cell-indicator.e { right: 1px; top: 50%; transform: translateY(-50%); }
    .cell-indicator.s { bottom: 1px; left: 50%; transform: translateX(-50%); }
    .cell-indicator.w { left: 1px; top: 50%; transform: translateY(-50%); }

    .cell-indicator.active {
      background: var(--pixel-success);
    }

    .cell-indicator.inactive {
      background: var(--pixel-border);
    }

    /* Zone controls */
    .zone-controls {
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      padding: 6px;
      margin-bottom: 6px;
    }

    .zone-list {
      max-height: 60px;
      overflow-y: auto;
      margin-bottom: 4px;
    }

    .zone-item {
      padding: 2px 4px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      border-bottom: 1px solid var(--pixel-border);
    }

    .zone-item:hover { background: var(--pixel-bg); }
    .zone-item.active { background: var(--pixel-accent); color: #000; }

    /* Cell editor */
    .cell-editor {
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      padding: 6px;
      margin-bottom: 6px;
    }

    .cell-editor.empty {
      text-align: center;
      color: var(--pixel-fg);
      opacity: 0.6;
      padding: 12px;
    }

    .connection-toggles {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin: 6px 0;
      max-width: 150px;
      margin-left: auto;
      margin-right: auto;
    }

    .connection-toggle {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 9px;
      padding: 0;
    }

    .connection-toggle.active {
      background: var(--pixel-success);
      color: #000;
    }

    .connection-toggle.diag {
      font-size: 8px;
      opacity: 0.8;
    }

    .connection-toggle.diag.active {
      opacity: 1;
    }

    .preset-buttons {
      display: flex;
      gap: 3px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .preset-btn {
      width: 22px;
      height: 22px;
      font-size: 10px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .preset-btn:hover {
      background: var(--pixel-accent);
      color: #000;
    }

    /* Connection diagram */
    .connection-diagram {
      display: inline-grid;
      grid-template-columns: repeat(3, 14px);
      grid-template-rows: repeat(3, 14px);
      gap: 1px;
      background: var(--pixel-border);
      vertical-align: middle;
      margin-right: 8px;
    }

    .diagram-cell {
      background: var(--pixel-bg);
      font-size: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .diagram-cell.has-conn { background: var(--pixel-success); color: #000; }
    .diagram-cell.center { background: var(--pixel-accent); }

    /* Transitions */
    .transition-list {
      max-height: 50px;
      overflow-y: auto;
      border: 1px solid var(--pixel-border);
      margin-bottom: 6px;
    }

    .transition-item {
      padding: 2px 4px;
      border-bottom: 1px solid var(--pixel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
    }

    /* Test Canvas */
    .test-container { margin: 8px 0; }
    .test-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
    .test-hint { font-size: 9px; color: var(--pixel-dim); margin-left: auto; }
    .test-canvas-wrapper {
      border: 1px solid var(--pixel-border);
      background: #1a1a1a;
      overflow: auto;
      max-height: 340px;
    }
    #test-canvas {
      display: block;
      cursor: crosshair;
      image-rendering: pixelated;
    }

    .status {
      font-size: 10px;
      padding: 4px;
      margin-top: 6px;
      border-radius: 2px;
      text-align: center;
    }

    .status.success { background: var(--pixel-success); color: #000; }
    .status.error { background: var(--pixel-error); color: #fff; }
    .status.info { background: var(--pixel-accent); color: #000; }

    /* Input fields */
    input[type="number"] {
      width: 50px;
      text-align: center;
    }

    input[type="text"] {
      width: 100%;
    }

    .inline-fields {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
    }

    .inline-fields label {
      font-size: 9px;
      color: var(--pixel-fg);
    }

    .unsaved-indicator {
      font-size: 9px;
      color: var(--pixel-accent);
      margin-left: 8px;
      animation: pulse 1.5s infinite;
    }

    #btn-toggle-overlay {
      min-width: 60px;
    }

    #btn-toggle-overlay:active, #btn-toggle-overlay:focus {
      outline: 2px solid var(--pixel-accent);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="section-label">Terrain Types</div>
  <div class="toolbar">
    <select id="terrain-select"><option value="">Select terrain...</option></select>
    <button id="btn-add-terrain" title="Add terrain">+</button>
    <button id="btn-delete-terrain" title="Delete terrain">-</button>
  </div>
  <div id="terrain-list" class="terrain-list"></div>

  <div class="section-label">Spritesheet</div>
  <div class="toolbar">
    <select id="sheet-select"></select>
    <button id="btn-add-zone" title="Add grid zone">+ Zone</button>
    <button id="btn-toggle-overlay" title="Toggle zone overlays">👁 Zones</button>
    <span style="flex:1"></span>
    <button id="btn-zoom-out" title="Zoom out">−</button>
    <span id="zoom-level" style="min-width:36px;text-align:center">2x</span>
    <button id="btn-zoom-in" title="Zoom in">+</button>
    <button id="btn-zoom-reset" title="Reset zoom">⟲</button>
  </div>

  <div class="spritesheet-container" id="spritesheet-container">
    <div id="canvas-wrapper" style="transform-origin:top left">
      <canvas id="spritesheet-canvas" class="spritesheet-canvas"></canvas>
      <canvas id="overlay-canvas" class="zone-overlay"></canvas>
    </div>
  </div>

  <div class="zone-controls" id="zone-controls" style="display:none;">
    <div class="section-label" style="margin-top:0">Grid Zones</div>
    <div id="zone-list" class="zone-list"></div>
    <div class="inline-fields">
      <label>X:</label><input type="number" id="zone-x" value="0" min="0" step="16">
      <label>Y:</label><input type="number" id="zone-y" value="0" min="0" step="16">
      <label>Cols:</label><input type="number" id="zone-cols" value="4" min="1" max="16">
      <label>Rows:</label><input type="number" id="zone-rows" value="4" min="1" max="16">
      <label>Size:</label><input type="number" id="zone-cell-size" value="16" min="8" max="64">
    </div>
    <div class="toolbar" style="margin-top:4px">
      <button id="btn-update-zone">Update</button>
      <button id="btn-delete-zone">Delete</button>
    </div>
  </div>

  <div class="cell-editor" id="cell-editor">
    <div class="section-label" style="margin-top:0">Cell Connections</div>
    <div id="cell-info" class="empty">Click a cell in the grid to edit connections</div>
    <div id="cell-controls" style="display:none;">
      <div style="margin-bottom:6px;">
        <span id="cell-diagram"></span>
        <span id="cell-bitmask"></span>
        <span id="cell-sprite" style="font-size:9px;color:var(--pixel-fg)"></span>
      </div>
      <div class="connection-toggles">
        <!-- Row 1: NW, N, NE -->
        <button class="connection-toggle diag" id="toggle-nw" title="Northwest">NW</button>
        <button class="connection-toggle" id="toggle-n" title="North">N</button>
        <button class="connection-toggle diag" id="toggle-ne" title="Northeast">NE</button>
        <!-- Row 2: W, center, E -->
        <button class="connection-toggle" id="toggle-w" title="West">W</button>
        <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:10px;">●</div>
        <button class="connection-toggle" id="toggle-e" title="East">E</button>
        <!-- Row 3: SW, S, SE -->
        <button class="connection-toggle diag" id="toggle-sw" title="Southwest">SW</button>
        <button class="connection-toggle" id="toggle-s" title="South">S</button>
        <button class="connection-toggle diag" id="toggle-se" title="Southeast">SE</button>
      </div>
      <div class="preset-buttons" style="margin-top:6px;">
        <button class="preset-btn" data-preset="none" title="No connections">●</button>
        <button class="preset-btn" data-preset="all" title="All connections">✦</button>
        <button class="preset-btn" data-preset="cardinal" title="Cardinal only">+</button>
        <button class="preset-btn" data-preset="diag" title="Diagonal only">×</button>
        <button class="preset-btn" data-preset="nw" title="NW corner (N+W)">┘</button>
        <button class="preset-btn" data-preset="ne" title="NE corner (N+E)">└</button>
        <button class="preset-btn" data-preset="sw" title="SW corner (S+W)">┐</button>
        <button class="preset-btn" data-preset="se" title="SE corner (S+E)">┌</button>
        <button class="preset-btn" data-preset="h" title="Horizontal">─</button>
        <button class="preset-btn" data-preset="v" title="Vertical">│</button>
        <button class="preset-btn" data-preset="nw-full" title="NW full (N+W+NW)">◤</button>
        <button class="preset-btn" data-preset="ne-full" title="NE full (N+E+NE)">◥</button>
        <button class="preset-btn" data-preset="sw-full" title="SW full (S+W+SW)">◣</button>
        <button class="preset-btn" data-preset="se-full" title="SE full (S+E+SE)">◢</button>
      </div>
      <div class="toolbar">
        <input type="text" id="cell-variant" placeholder="Variant (optional)">
        <button id="btn-apply-cell">Apply</button>
      </div>
    </div>
  </div>

  <div class="toolbar">
    <span id="unsaved-indicator" class="unsaved-indicator" style="display:none;">● Unsaved changes</span>
    <button id="btn-generate" title="Generate bitmask config from zones">Generate Config</button>
    <button id="btn-save-mapping">Save Mapping</button>
  </div>

  <div class="section-label">Transitions</div>
  <div class="toolbar">
    <select id="from-terrain"></select>
    <span>→</span>
    <select id="to-terrain"></select>
    <button id="btn-add-trans">+</button>
  </div>
  <div id="transition-list" class="transition-list"></div>

  <div class="section-label" style="margin-top:12px">Test Canvas</div>
  <div class="test-container">
    <div class="test-toolbar">
      <label>Brush:</label>
      <select id="paint-terrain"></select>
      <button id="btn-clear-test">Clear</button>
      <span class="test-hint">Click to paint, right-click to erase, double-click to inspect</span>
    </div>
    <div class="test-canvas-wrapper">
      <canvas id="test-canvas" width="320" height="320"></canvas>
      <div id="test-tooltip" class="test-tooltip" style="display:none;"></div>
    </div>
  </div>

  <div id="status"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let config = null;
    let assets = null;
    let mappings = {};
    let selectedTerrainIndex = -1;
    let selectedZoneIndex = -1;
    let selectedCellIndex = -1;
    let selectedCellCol = -1;  // Track column explicitly
    let selectedCellRow = -1;  // Track row explicitly
    let hasUnsavedChanges = false;  // Track unsaved modifications

    // Current mapping being edited
    let currentMapping = null;

    // Canvas elements
    let spritesheetCanvas, spritesheetCtx;
    let overlayCanvas, overlayCtx;
    let currentSheetImage = null;
    let zoomLevel = 2; // Default 2x zoom
    let showOverlays = true; // Toggle for zone overlay visibility
    const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8];

    // Direction bits
    // 8-bit bitmask: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
    const DIR = {
      N: 1, NE: 2, E: 4, SE: 8,
      S: 16, SW: 32, W: 64, NW: 128
    };

    // Test canvas state
    const TEST_SIZE = 20;
    const TILE_SIZE = 16;
    let testGrid = new Array(TEST_SIZE * TEST_SIZE).fill(null);
    let paintTerrain = 'grass';
    let testCanvas, testCtx;
    let cachedSpritesheetImages = {};
    let isPainting = false;

    // Highlight state for inspecting painted cells
    let highlightedZoneIndex = -1;
    let highlightedCellCol = -1;
    let highlightedCellRow = -1;

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadAssets':
          assets = msg.assets;
          populateSheetSelect();
          if (config) setupTestCanvas();
          break;
        case 'loadConfig':
          config = msg.config;
          renderTerrainList();
          renderTransitionList();
          if (assets) setupTestCanvas();
          break;
        case 'loadMappings':
          mappings = msg.mappings || {};
          loadTerrainMapping();
          break;
        case 'saveSuccess':
          clearUnsaved();
          showStatus('Saved!', 'success', 1000);
          break;
        case 'saveError':
          showStatus('Error: ' + msg.error, 'error', 3000);
          break;
      }
    });

    vscode.postMessage({ type: 'webviewReady' });

    // === Terrain List ===
    function renderTerrainList() {
      const list = document.getElementById('terrain-list');
      const select = document.getElementById('terrain-select');

      list.innerHTML = '';
      select.innerHTML = '<option value="">Select terrain...</option>';

      if (!config) return;

      config.terrains.forEach((t, i) => {
        const item = document.createElement('div');
        item.className = 'terrain-item' + (i === selectedTerrainIndex ? ' active' : '');
        item.innerHTML = '<span>' + t.type + '</span><small>' + t.spritesheet + '</small>';
        item.addEventListener('click', () => selectTerrain(i));
        list.appendChild(item);

        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = t.type;
        select.appendChild(opt);
      });

      updateTransitionSelects();
    }

    function selectTerrain(index) {
      selectedTerrainIndex = index;
      selectedZoneIndex = -1;
      selectedCellIndex = -1;
      selectedCellCol = -1;
      selectedCellRow = -1;
      renderTerrainList();
      loadTerrainMapping();
      updateCellEditor();

      // Auto-select spritesheet
      if (config && config.terrains[index]) {
        document.getElementById('sheet-select').value = config.terrains[index].spritesheet;
        renderSpritesheet();
      }
    }

    function loadTerrainMapping() {
      if (selectedTerrainIndex < 0 || !config) {
        currentMapping = null;
        document.getElementById('zone-controls').style.display = 'none';
        return;
      }

      const terrainType = config.terrains[selectedTerrainIndex].type;

      if (mappings[terrainType]) {
        currentMapping = JSON.parse(JSON.stringify(mappings[terrainType]));
      } else {
        // Create new mapping
        currentMapping = {
          terrainType: terrainType,
          spritesheet: config.terrains[selectedTerrainIndex].spritesheet,
          zones: []
        };
      }

      document.getElementById('zone-controls').style.display = 'block';
      renderZoneList();
      renderOverlay();
    }

    // === Spritesheet Canvas ===
    function populateSheetSelect() {
      const select = document.getElementById('sheet-select');
      select.innerHTML = '';

      if (!assets) return;

      for (const name of Object.keys(assets.spritesheets)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      }

      // Auto-select current terrain's sheet
      if (selectedTerrainIndex >= 0 && config) {
        select.value = config.terrains[selectedTerrainIndex].spritesheet;
      }

      renderSpritesheet();
    }

    function renderSpritesheet() {
      spritesheetCanvas = document.getElementById('spritesheet-canvas');
      spritesheetCtx = spritesheetCanvas.getContext('2d');
      spritesheetCtx.imageSmoothingEnabled = false;

      overlayCanvas = document.getElementById('overlay-canvas');
      overlayCtx = overlayCanvas.getContext('2d');
      overlayCtx.imageSmoothingEnabled = false;

      if (!assets) return;

      const sheetName = document.getElementById('sheet-select').value;
      const sheet = assets.spritesheets[sheetName];
      if (!sheet || !sheet.imageUrl) {
        spritesheetCanvas.width = 200;
        spritesheetCanvas.height = 100;
        spritesheetCtx.fillStyle = '#333';
        spritesheetCtx.fillRect(0, 0, 200, 100);
        spritesheetCtx.fillStyle = '#888';
        spritesheetCtx.font = '10px monospace';
        spritesheetCtx.fillText('No spritesheet', 60, 50);
        return;
      }

      const img = new Image();
      img.src = sheet.imageUrl;
      img.onload = () => {
        currentSheetImage = img;
        spritesheetCanvas.width = img.width;
        spritesheetCanvas.height = img.height;
        spritesheetCtx.drawImage(img, 0, 0);

        overlayCanvas.width = img.width;
        overlayCanvas.height = img.height;

        applyZoom();
        renderOverlay();
      };
    }

    function applyZoom() {
      const wrapper = document.getElementById('canvas-wrapper');
      if (wrapper) {
        wrapper.style.transform = 'scale(' + zoomLevel + ')';
        document.getElementById('zoom-level').textContent = zoomLevel + 'x';
      }
    }

    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      const idx = ZOOM_LEVELS.indexOf(zoomLevel);
      if (idx < ZOOM_LEVELS.length - 1) {
        zoomLevel = ZOOM_LEVELS[idx + 1];
        applyZoom();
      }
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      const idx = ZOOM_LEVELS.indexOf(zoomLevel);
      if (idx > 0) {
        zoomLevel = ZOOM_LEVELS[idx - 1];
        applyZoom();
      }
    });

    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      zoomLevel = 2;
      applyZoom();
    });

    document.getElementById('btn-toggle-overlay').addEventListener('click', () => {
      showOverlays = !showOverlays;
      const btn = document.getElementById('btn-toggle-overlay');
      btn.style.opacity = showOverlays ? '1' : '0.5';
      renderOverlay();
    });

    function renderOverlay() {
      if (!overlayCtx || !currentMapping) return;

      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      // Skip drawing overlays if hidden
      if (!showOverlays) return;

      // Draw zones
      currentMapping.zones.forEach((zone, zi) => {
        const isSelected = zi === selectedZoneIndex;
        const cellSize = zone.cellSize || 16;

        // Zone border
        overlayCtx.strokeStyle = isSelected ? '#64ff64' : '#ffc800';
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash(isSelected ? [] : [4, 2]);
        overlayCtx.strokeRect(zone.x, zone.y, zone.cols * cellSize, zone.rows * cellSize);

        // Zone label
        overlayCtx.fillStyle = isSelected ? '#64ff64' : '#ffc800';
        overlayCtx.font = 'bold 9px monospace';
        overlayCtx.fillText(zone.name, zone.x, zone.y - 3);

        // Draw cells
        overlayCtx.setLineDash([]);
        for (let row = 0; row < zone.rows; row++) {
          for (let col = 0; col < zone.cols; col++) {
            const cellIdx = row * zone.cols + col;
            const cell = zone.cells[cellIdx];
            const cx = zone.x + col * cellSize;
            const cy = zone.y + row * cellSize;

            // Use explicit col/row for selection check to avoid index calculation issues
            const isThisCellSelected = isSelected && col === selectedCellCol && row === selectedCellRow;
            const isThisCellHighlighted = zi === highlightedZoneIndex && col === highlightedCellCol && row === highlightedCellRow;

            // Cell border
            if (isThisCellHighlighted) {
              // Highlighted cell from test canvas inspection - cyan pulsing border
              overlayCtx.strokeStyle = '#00ffff';
              overlayCtx.lineWidth = 3;
            } else if (isThisCellSelected) {
              overlayCtx.strokeStyle = '#64ff64';
              overlayCtx.lineWidth = 1;
            } else {
              overlayCtx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
              overlayCtx.lineWidth = 1;
            }
            overlayCtx.strokeRect(cx, cy, cellSize, cellSize);

            // Extra highlight fill for inspected cell
            if (isThisCellHighlighted) {
              overlayCtx.fillStyle = 'rgba(0, 255, 255, 0.2)';
              overlayCtx.fillRect(cx, cy, cellSize, cellSize);
            }

            // Connection indicators (8 directions)
            if (cell && cell.connections) {
              // Cardinal directions
              drawConnectionIndicator(cx, cy, cellSize, 'n', cell.connections.north, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 'e', cell.connections.east, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 's', cell.connections.south, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 'w', cell.connections.west, isThisCellSelected);
              // Diagonal directions
              drawConnectionIndicator(cx, cy, cellSize, 'ne', cell.connections.northeast, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 'se', cell.connections.southeast, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 'sw', cell.connections.southwest, isThisCellSelected);
              drawConnectionIndicator(cx, cy, cellSize, 'nw', cell.connections.northwest, isThisCellSelected);
            }
          }
        }
      });
    }

    // Highlight a sprite in the zones by name (from test canvas inspection)
    function highlightSpriteInZones(spriteName) {
      if (!currentMapping || !spriteName) return;

      // Clear previous highlight
      highlightedZoneIndex = -1;
      highlightedCellCol = -1;
      highlightedCellRow = -1;

      // Search all zones for the sprite
      for (let zi = 0; zi < currentMapping.zones.length; zi++) {
        const zone = currentMapping.zones[zi];
        for (let row = 0; row < zone.rows; row++) {
          for (let col = 0; col < zone.cols; col++) {
            const cellIdx = row * zone.cols + col;
            const cell = zone.cells[cellIdx];
            if (cell && cell.spriteName === spriteName) {
              // Found it! Set highlight state
              highlightedZoneIndex = zi;
              highlightedCellCol = col;
              highlightedCellRow = row;

              // Scroll the spritesheet to show this zone
              const cellSize = zone.cellSize || 16;
              const cellX = zone.x + col * cellSize;
              const cellY = zone.y + row * cellSize;
              const container = document.getElementById('spritesheet-container');
              if (container) {
                // Account for zoom
                container.scrollTop = (cellY * zoomLevel) - (container.clientHeight / 2) + (cellSize * zoomLevel / 2);
                container.scrollLeft = (cellX * zoomLevel) - (container.clientWidth / 2) + (cellSize * zoomLevel / 2);
              }

              renderOverlay();
              showStatus('Highlighted: ' + spriteName, 'info', 2000);
              return;
            }
          }
        }
      }

      showStatus('Sprite not found: ' + spriteName, 'info', 2000);
      renderOverlay();
    }

    function drawConnectionIndicator(cx, cy, cellSize, dir, active, isSelected) {
      const size = 5;
      let x, y;
      const labelMap = { 'n': 'N', 'ne': '1', 'e': 'E', 'se': '2', 's': 'S', 'sw': '3', 'w': 'W', 'nw': '4' };
      let label = labelMap[dir] || dir.toUpperCase();

      switch (dir) {
        case 'n': x = cx + cellSize/2 - size/2; y = cy + 1; break;
        case 'ne': x = cx + cellSize - size - 1; y = cy + 1; break;
        case 'e': x = cx + cellSize - size - 1; y = cy + cellSize/2 - size/2; break;
        case 'se': x = cx + cellSize - size - 1; y = cy + cellSize - size - 1; break;
        case 's': x = cx + cellSize/2 - size/2; y = cy + cellSize - size - 1; break;
        case 'sw': x = cx + 1; y = cy + cellSize - size - 1; break;
        case 'w': x = cx + 1; y = cy + cellSize/2 - size/2; break;
        case 'nw': x = cx + 1; y = cy + 1; break;
      }

      // Draw indicator box
      const isDiag = ['ne', 'se', 'sw', 'nw'].includes(dir);
      if (active) {
        overlayCtx.fillStyle = isSelected ? '#64ff64' : (isDiag ? '#3a7a3a' : '#4a8f4a');
      } else {
        overlayCtx.fillStyle = isDiag ? 'rgba(60, 60, 60, 0.6)' : 'rgba(80, 80, 80, 0.7)';
      }
      overlayCtx.fillRect(x, y, size, size);

      // Draw label
      overlayCtx.fillStyle = active ? '#000' : (isDiag ? '#555' : '#666');
      overlayCtx.font = 'bold 4px monospace';
      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
      overlayCtx.fillText(label, x + size/2, y + size/2);
    }

    // === Zone Management ===
    function renderZoneList() {
      const list = document.getElementById('zone-list');
      list.innerHTML = '';

      if (!currentMapping) return;

      currentMapping.zones.forEach((zone, i) => {
        const item = document.createElement('div');
        item.className = 'zone-item' + (i === selectedZoneIndex ? ' active' : '');
        item.innerHTML = '<span>' + zone.name + '</span><small>' + zone.cols + 'x' + zone.rows + '</small>';
        item.addEventListener('click', () => selectZone(i));
        list.appendChild(item);
      });

      updateZoneFields();
    }

    function selectZone(index) {
      selectedZoneIndex = index;
      selectedCellIndex = -1;
      selectedCellCol = -1;
      selectedCellRow = -1;
      renderZoneList();
      renderOverlay();
      updateCellEditor();
    }

    function updateZoneStepValues() {
      const cellSize = parseInt(document.getElementById('zone-cell-size').value) || 16;
      document.getElementById('zone-x').step = cellSize;
      document.getElementById('zone-y').step = cellSize;
    }

    function updateZoneFields() {
      if (selectedZoneIndex < 0 || !currentMapping) return;

      const zone = currentMapping.zones[selectedZoneIndex];
      document.getElementById('zone-x').value = zone.x;
      document.getElementById('zone-y').value = zone.y;
      document.getElementById('zone-cols').value = zone.cols;
      document.getElementById('zone-rows').value = zone.rows;
      document.getElementById('zone-cell-size').value = zone.cellSize || 16;
      updateZoneStepValues();
    }

    // Update step values when cell size changes
    document.getElementById('zone-cell-size').addEventListener('input', updateZoneStepValues);

    document.getElementById('btn-add-zone').addEventListener('click', () => {
      if (!currentMapping) {
        showStatus('Select a terrain first', 'info', 2000);
        return;
      }

      const zoneNum = currentMapping.zones.length + 1;
      const cellSize = 16;

      // Create zone with pre-initialized cells
      const newZone = {
        id: 'zone-' + Date.now(),
        name: 'Zone ' + zoneNum,
        x: 0,
        y: (zoneNum - 1) * cellSize * 4,
        cols: 4,
        rows: 4,
        cellSize: cellSize,
        cells: []
      };

      // Pre-initialize all cells
      for (let row = 0; row < newZone.rows; row++) {
        for (let col = 0; col < newZone.cols; col++) {
          newZone.cells.push({
            x: newZone.x + col * newZone.cellSize,
            y: newZone.y + row * newZone.cellSize,
            connections: {
              north: false, northeast: false, east: false, southeast: false,
              south: false, southwest: false, west: false, northwest: false
            },
            spriteName: 't_' + col + '_' + row
          });
        }
      }

      currentMapping.zones.push(newZone);

      selectedZoneIndex = currentMapping.zones.length - 1;
      selectedCellIndex = -1;
      selectedCellCol = -1;
      selectedCellRow = -1;
      markUnsaved();
      renderZoneList();
      renderOverlay();
      updateCellEditor();
      showStatus('Zone ' + zoneNum + ' created - click cells to configure', 'info', 2000);
    });

    document.getElementById('btn-update-zone').addEventListener('click', () => {
      if (selectedZoneIndex < 0 || !currentMapping) return;

      const zone = currentMapping.zones[selectedZoneIndex];
      zone.x = parseInt(document.getElementById('zone-x').value) || 0;
      zone.y = parseInt(document.getElementById('zone-y').value) || 0;
      zone.cols = parseInt(document.getElementById('zone-cols').value) || 4;
      zone.rows = parseInt(document.getElementById('zone-rows').value) || 4;
      zone.cellSize = parseInt(document.getElementById('zone-cell-size').value) || 16;

      // Re-initialize all cells with new dimensions
      zone.cells = [];
      for (let row = 0; row < zone.rows; row++) {
        for (let col = 0; col < zone.cols; col++) {
          zone.cells.push({
            x: zone.x + col * zone.cellSize,
            y: zone.y + row * zone.cellSize,
            connections: {
              north: false, northeast: false, east: false, southeast: false,
              south: false, southwest: false, west: false, northwest: false
            },
            spriteName: 't_' + col + '_' + row
          });
        }
      }

      selectedCellIndex = -1;
      selectedCellCol = -1;
      selectedCellRow = -1;
      markUnsaved();
      renderZoneList();
      renderOverlay();
      updateCellEditor();
      showStatus('Zone updated', 'success', 1000);
    });

    document.getElementById('btn-delete-zone').addEventListener('click', () => {
      if (selectedZoneIndex < 0 || !currentMapping) return;

      currentMapping.zones.splice(selectedZoneIndex, 1);
      markUnsaved();
      selectedZoneIndex = -1;
      selectedCellIndex = -1;
      selectedCellCol = -1;
      selectedCellRow = -1;
      renderZoneList();
      renderOverlay();
      updateCellEditor();
    });

    // === Cell Editor ===
    function updateCellEditor() {
      const info = document.getElementById('cell-info');
      const controls = document.getElementById('cell-controls');

      if (selectedZoneIndex < 0 || selectedCellIndex < 0 || !currentMapping) {
        info.style.display = 'block';
        info.className = 'empty';
        info.textContent = 'Click a cell in the grid to edit connections';
        controls.style.display = 'none';
        return;
      }

      info.style.display = 'none';
      controls.style.display = 'block';

      const zone = currentMapping.zones[selectedZoneIndex];

      // Ensure cells array exists and has enough entries
      if (!zone.cells) {
        zone.cells = [];
      }

      // Initialize missing cells
      const totalCells = zone.cols * zone.rows;
      while (zone.cells.length < totalCells) {
        const idx = zone.cells.length;
        const col = idx % zone.cols;
        const row = Math.floor(idx / zone.cols);
        zone.cells.push({
          x: zone.x + col * (zone.cellSize || 16),
          y: zone.y + row * (zone.cellSize || 16),
          connections: {
            north: false, northeast: false, east: false, southeast: false,
            south: false, southwest: false, west: false, northwest: false
          },
          spriteName: 't_' + col + '_' + row
        });
      }

      const cell = zone.cells[selectedCellIndex];
      if (!cell) {
        console.error('[TerrainConfig] Cell not found at index', selectedCellIndex);
        return;
      }

      // Ensure cell has all 8 connection properties
      if (!cell.connections) {
        cell.connections = {
          north: false, northeast: false, east: false, southeast: false,
          south: false, southwest: false, west: false, northwest: false
        };
      }

      updateCellDisplay();
    }

    function updateCellDisplay() {
      if (!currentMapping || selectedZoneIndex < 0 || selectedCellIndex < 0) return;

      const zone = currentMapping.zones[selectedZoneIndex];
      const cell = zone.cells[selectedCellIndex];
      const conn = cell.connections;

      // Ensure all connection properties exist
      if (conn.northeast === undefined) conn.northeast = false;
      if (conn.southeast === undefined) conn.southeast = false;
      if (conn.southwest === undefined) conn.southwest = false;
      if (conn.northwest === undefined) conn.northwest = false;

      // Update toggle buttons for all 8 directions
      const toggles = [
        { id: 'toggle-nw', key: 'northwest', diag: true },
        { id: 'toggle-n', key: 'north', diag: false },
        { id: 'toggle-ne', key: 'northeast', diag: true },
        { id: 'toggle-w', key: 'west', diag: false },
        { id: 'toggle-e', key: 'east', diag: false },
        { id: 'toggle-sw', key: 'southwest', diag: true },
        { id: 'toggle-s', key: 'south', diag: false },
        { id: 'toggle-se', key: 'southeast', diag: true }
      ];
      toggles.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
          btn.className = 'connection-toggle' + (conn[t.key] ? ' active' : '') + (t.diag ? ' diag' : '');
        }
      });

      // Calculate 8-bit bitmask
      let bitmask = 0;
      if (conn.north) bitmask |= DIR.N;
      if (conn.northeast) bitmask |= DIR.NE;
      if (conn.east) bitmask |= DIR.E;
      if (conn.southeast) bitmask |= DIR.SE;
      if (conn.south) bitmask |= DIR.S;
      if (conn.southwest) bitmask |= DIR.SW;
      if (conn.west) bitmask |= DIR.W;
      if (conn.northwest) bitmask |= DIR.NW;

      // Draw connection diagram (full 3x3 grid with all 8 directions)
      // [NW] [N] [NE]
      // [W ] [C] [E ]
      // [SW] [S] [SE]
      const diagram = document.getElementById('cell-diagram');
      let html = '<div class="connection-diagram">';
      html += '<div class="diagram-cell' + (conn.northwest ? ' has-conn' : '') + '">NW</div>';
      html += '<div class="diagram-cell' + (conn.north ? ' has-conn' : '') + '">N</div>';
      html += '<div class="diagram-cell' + (conn.northeast ? ' has-conn' : '') + '">NE</div>';
      html += '<div class="diagram-cell' + (conn.west ? ' has-conn' : '') + '">W</div>';
      html += '<div class="diagram-cell center">●</div>';
      html += '<div class="diagram-cell' + (conn.east ? ' has-conn' : '') + '">E</div>';
      html += '<div class="diagram-cell' + (conn.southwest ? ' has-conn' : '') + '">SW</div>';
      html += '<div class="diagram-cell' + (conn.south ? ' has-conn' : '') + '">S</div>';
      html += '<div class="diagram-cell' + (conn.southeast ? ' has-conn' : '') + '">SE</div>';
      html += '</div>';

      html += '<strong style="margin-left:8px">Bitmask: ' + bitmask + '</strong>';

      diagram.innerHTML = html;

      // Show sprite name
      document.getElementById('cell-sprite').textContent = cell.spriteName ? 'Sprite: ' + cell.spriteName : '';
      document.getElementById('cell-variant').value = cell.variant || '';
    }

    // Toggle buttons
    // Toggle buttons for all 8 directions
    const DIRECTION_MAP = {
      'n': 'north', 'ne': 'northeast', 'e': 'east', 'se': 'southeast',
      's': 'south', 'sw': 'southwest', 'w': 'west', 'nw': 'northwest'
    };

    ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].forEach(dir => {
      document.getElementById('toggle-' + dir).addEventListener('click', () => {
        if (selectedZoneIndex < 0 || selectedCellIndex < 0 || !currentMapping) return;

        const cell = currentMapping.zones[selectedZoneIndex].cells[selectedCellIndex];
        const key = DIRECTION_MAP[dir];
        if (!cell.connections) {
          cell.connections = {
            north: false, northeast: false, east: false, southeast: false,
            south: false, southwest: false, west: false, northwest: false
          };
        }
        cell.connections[key] = !cell.connections[key];

        markUnsaved();
        updateCellDisplay();
        renderOverlay();
      });
    });

    // Preset buttons for common patterns (8-direction)
    const PRESETS = {
      'none': {
        north: false, northeast: false, east: false, southeast: false,
        south: false, southwest: false, west: false, northwest: false
      },
      'all': {
        north: true, northeast: true, east: true, southeast: true,
        south: true, southwest: true, west: true, northwest: true
      },
      'cardinal': {
        north: true, northeast: false, east: true, southeast: false,
        south: true, southwest: false, west: true, northwest: false
      },
      'diag': {
        north: false, northeast: true, east: false, southeast: true,
        south: false, southwest: true, west: false, northwest: true
      },
      // Cardinal corners (no diagonals)
      'nw':   { north: true, northeast: false, east: false, southeast: false, south: false, southwest: false, west: true, northwest: false },
      'ne':   { north: true, northeast: false, east: true, southeast: false, south: false, southwest: false, west: false, northwest: false },
      'sw':   { north: false, northeast: false, east: false, southeast: false, south: true, southwest: false, west: true, northwest: false },
      'se':   { north: false, northeast: false, east: true, southeast: false, south: true, southwest: false, west: false, northwest: false },
      'h':    { north: false, northeast: false, east: true, southeast: false, south: false, southwest: false, west: true, northwest: false },
      'v':    { north: true, northeast: false, east: false, southeast: false, south: true, southwest: false, west: false, northwest: false },
      // Full corners (with diagonals) - like Godot 3x3 minimal
      'nw-full': { north: true, northeast: false, east: false, southeast: false, south: false, southwest: false, west: true, northwest: true },
      'ne-full': { north: true, northeast: true, east: true, southeast: false, south: false, southwest: false, west: false, northwest: false },
      'sw-full': { north: false, northeast: false, east: false, southeast: false, south: true, southwest: true, west: true, northwest: false },
      'se-full': { north: false, northeast: false, east: true, southeast: true, south: true, southwest: false, west: false, northwest: false }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (selectedZoneIndex < 0 || selectedCellIndex < 0 || !currentMapping) return;

        const preset = btn.dataset.preset;
        const pattern = PRESETS[preset];
        if (!pattern) return;

        const cell = currentMapping.zones[selectedZoneIndex].cells[selectedCellIndex];
        cell.connections = { ...pattern };

        markUnsaved();
        updateCellDisplay();
        renderOverlay();
        showStatus('Applied ' + preset.toUpperCase() + ' pattern', 'success', 1000);
      });
    });

    document.getElementById('btn-apply-cell').addEventListener('click', () => {
      if (selectedZoneIndex < 0 || selectedCellIndex < 0 || !currentMapping) return;

      const cell = currentMapping.zones[selectedZoneIndex].cells[selectedCellIndex];
      cell.variant = document.getElementById('cell-variant').value || undefined;

      // Auto-detect sprite name from position
      const sheetName = document.getElementById('sheet-select').value;
      const sheet = assets?.spritesheets[sheetName];
      if (sheet) {
        cell.spriteName = findSpriteAtPosition(sheet, cell.x, cell.y, currentMapping.zones[selectedZoneIndex].cellSize);
      }

      markUnsaved();
      updateCellDisplay();
      renderOverlay();
      showStatus('Cell updated', 'success', 1000);
    });

    function findSpriteAtPosition(sheet, x, y, cellSize) {
      // Grid-position naming for terrain tilesets
      return 't_' + Math.floor(x / cellSize) + '_' + Math.floor(y / cellSize);
    }

    // === Canvas Click Handler ===
    document.getElementById('overlay-canvas').addEventListener('click', (e) => {
      if (!currentMapping || currentMapping.zones.length === 0) {
        showStatus('Add a zone first', 'info', 2000);
        return;
      }

      const rect = overlayCanvas.getBoundingClientRect();
      const scaleX = overlayCanvas.width / rect.width;
      const scaleY = overlayCanvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      console.log('[TerrainConfig] Click at', clickX, clickY, 'canvas size:', overlayCanvas.width, overlayCanvas.height);

      // Find all zones that contain this click (may overlap due to stroke borders)
      // Pick the one where the click is most "interior" (furthest from edges)
      let bestMatch = null;
      let bestDistance = -1;

      for (let zi = 0; zi < currentMapping.zones.length; zi++) {
        const zone = currentMapping.zones[zi];
        const cellSize = zone.cellSize || 16;

        const zoneRight = zone.x + zone.cols * cellSize;
        const zoneBottom = zone.y + zone.rows * cellSize;

        // Check if click is within zone bounds
        if (clickX >= zone.x && clickX < zoneRight &&
            clickY >= zone.y && clickY < zoneBottom) {

          // Calculate minimum distance from any edge (interior score)
          const distFromLeft = clickX - zone.x;
          const distFromRight = zoneRight - clickX;
          const distFromTop = clickY - zone.y;
          const distFromBottom = zoneBottom - clickY;
          const minDist = Math.min(distFromLeft, distFromRight, distFromTop, distFromBottom);

          // Prefer the zone where click is most interior
          if (minDist > bestDistance) {
            bestDistance = minDist;
            const col = Math.floor((clickX - zone.x) / cellSize);
            const row = Math.floor((clickY - zone.y) / cellSize);
            const cellIdx = row * zone.cols + col;

            bestMatch = {
              zoneIndex: zi,
              cellIndex: cellIdx,
              col: col,
              row: row
            };
          }
        }
      }

      if (bestMatch) {
        console.log('[TerrainConfig] Found cell in zone', bestMatch.zoneIndex, 'at col', bestMatch.col, 'row', bestMatch.row);

        selectedZoneIndex = bestMatch.zoneIndex;
        selectedCellIndex = bestMatch.cellIndex;
        selectedCellCol = bestMatch.col;
        selectedCellRow = bestMatch.row;
        renderZoneList();
        renderOverlay();
        updateCellEditor();
        showStatus('Cell [' + bestMatch.col + ',' + bestMatch.row + '] selected', 'info', 1000);
      } else {
        console.log('[TerrainConfig] No zone found at click position');
        showStatus('Click within a zone to select a cell', 'info', 2000);
      }
    });

    // === Generate Config ===
    document.getElementById('btn-generate').addEventListener('click', () => {
      if (selectedTerrainIndex < 0) {
        showStatus('Select a terrain first', 'info', 2000);
        return;
      }

      vscode.postMessage({
        type: 'generateBitmaskConfig',
        data: config.terrains[selectedTerrainIndex].type
      });
    });

    document.getElementById('btn-save-mapping').addEventListener('click', () => {
      if (selectedTerrainIndex < 0 || !currentMapping) {
        showStatus('Select a terrain first', 'info', 2000);
        return;
      }

      currentMapping.spritesheet = document.getElementById('sheet-select').value;

      vscode.postMessage({
        type: 'saveMappings',
        data: {
          terrainType: config.terrains[selectedTerrainIndex].type,
          mapping: currentMapping
        }
      });
    });

    // === Transitions ===
    function updateTransitionSelects() {
      if (!config) return;
      const fromSelect = document.getElementById('from-terrain');
      const toSelect = document.getElementById('to-terrain');

      fromSelect.innerHTML = '<option value="">From...</option>';
      toSelect.innerHTML = '<option value="">To...</option>';

      config.terrains.forEach(t => {
        fromSelect.innerHTML += '<option value="' + t.type + '">' + t.type + '</option>';
        toSelect.innerHTML += '<option value="' + t.type + '">' + t.type + '</option>';
      });
    }

    function renderTransitionList() {
      if (!config) return;
      const list = document.getElementById('transition-list');
      list.innerHTML = '';

      config.transitions.forEach((t, i) => {
        const item = document.createElement('div');
        item.className = 'transition-item';
        item.innerHTML = '<span>' + t.fromTerrain + ' → ' + t.toTerrain + '</span>';
        item.innerHTML += '<button data-idx="' + i + '" style="font-size:8px;padding:1px 4px;">×</button>';
        item.querySelector('button').addEventListener('click', () => {
          vscode.postMessage({ type: 'deleteTransition', data: i });
        });
        list.appendChild(item);
      });
    }

    // === Terrain Buttons ===
    document.getElementById('btn-add-terrain').addEventListener('click', () => {
      const type = prompt('Terrain type name (e.g., grass, dirt):');
      if (type && config) {
        config.terrains.push({
          type: type,
          spritesheet: 'grass',
          layer: 0,
          defaultSprite: 't_1_1',
          bitmaskMappings: Array(256).fill('t_1_1')
        });
        vscode.postMessage({ type: 'saveConfig', data: config });
      }
    });

    document.getElementById('btn-delete-terrain').addEventListener('click', () => {
      if (selectedTerrainIndex >= 0 && config) {
        config.terrains.splice(selectedTerrainIndex, 1);
        selectedTerrainIndex = -1;
        vscode.postMessage({ type: 'saveConfig', data: config });
      }
    });

    document.getElementById('btn-add-trans').addEventListener('click', () => {
      const from = document.getElementById('from-terrain').value;
      const to = document.getElementById('to-terrain').value;
      if (from && to && from !== to && config) {
        config.transitions.push({
          fromTerrain: from,
          toTerrain: to,
          edgeSpritesheet: from,
          priority: 1
        });
        vscode.postMessage({ type: 'saveConfig', data: config });
      }
    });

    document.getElementById('sheet-select').addEventListener('change', renderSpritesheet);

    // === Test Canvas ===
    function updatePaintTerrainSelect() {
      const select = document.getElementById('paint-terrain');
      if (!select || !config) return;
      select.innerHTML = '';
      config.terrains.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.type;
        opt.textContent = t.type;
        select.appendChild(opt);
      });
      paintTerrain = config.terrains[0]?.type || 'grass';
    }

    /**
     * Mask out diagonal bits that are irrelevant because one or both
     * adjacent cardinal neighbors are absent. This ensures that the same
     * visual pattern (edge, corner) always produces the same bitmask
     * regardless of what happens to sit at an irrelevant diagonal.
     */
    function maskIrrelevantDiagonals(mask) {
      const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
      if (!(mask & N) || !(mask & E)) mask &= ~NE;  // NE needs N and E
      if (!(mask & E) || !(mask & S)) mask &= ~SE;  // SE needs E and S
      if (!(mask & S) || !(mask & W)) mask &= ~SW;  // SW needs S and W
      if (!(mask & W) || !(mask & N)) mask &= ~NW;  // NW needs W and N
      return mask;
    }

    function calculateBitmask(x, y, terrainType) {
      const dirs = [
        { dx: 0, dy: -1, bit: 1 },    // N
        { dx: 1, dy: -1, bit: 2 },    // NE
        { dx: 1, dy: 0, bit: 4 },     // E
        { dx: 1, dy: 1, bit: 8 },     // SE
        { dx: 0, dy: 1, bit: 16 },    // S
        { dx: -1, dy: 1, bit: 32 },   // SW
        { dx: -1, dy: 0, bit: 64 },   // W
        { dx: -1, dy: -1, bit: 128 }  // NW
      ];

      let mask = 0;
      for (const dir of dirs) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx >= 0 && nx < TEST_SIZE && ny >= 0 && ny < TEST_SIZE) {
          const neighbor = testGrid[ny * TEST_SIZE + nx];
          if (neighbor === terrainType) {
            mask |= dir.bit;
          }
        }
      }
      return maskIrrelevantDiagonals(mask);
    }

    function getSpriteForTestTile(x, y) {
      const terrainType = testGrid[y * TEST_SIZE + x];
      if (!terrainType) return null;

      const terrainConfig = config.terrains.find(t => t.type === terrainType);
      if (!terrainConfig) return null;

      const mask = calculateBitmask(x, y, terrainType);
      const spriteName = terrainConfig.bitmaskMappings[mask] || terrainConfig.defaultSprite;

      return {
        sheet: terrainConfig.spritesheet,
        sprite: spriteName
      };
    }

    async function loadSpritesheetImage(sheetName) {
      if (cachedSpritesheetImages[sheetName]) {
        return cachedSpritesheetImages[sheetName];
      }

      const sheet = assets?.spritesheets?.[sheetName];
      if (!sheet) return null;

      return new Promise((resolve) => {
        const img = new Image();
        img.src = sheet.imageUrl;
        img.onload = () => {
          cachedSpritesheetImages[sheetName] = img;
          resolve(img);
        };
        img.onerror = () => resolve(null);
      });
    }

    async function renderTestCanvas() {
      if (!testCtx || !assets || !config) return;

      testCtx.fillStyle = '#1a1a1a';
      testCtx.fillRect(0, 0, testCanvas.width, testCanvas.height);

      // Draw grid lines
      testCtx.strokeStyle = '#333';
      testCtx.lineWidth = 1;
      for (let i = 0; i <= TEST_SIZE; i++) {
        testCtx.beginPath();
        testCtx.moveTo(i * TILE_SIZE, 0);
        testCtx.lineTo(i * TILE_SIZE, TEST_SIZE * TILE_SIZE);
        testCtx.stroke();
        testCtx.beginPath();
        testCtx.moveTo(0, i * TILE_SIZE);
        testCtx.lineTo(TEST_SIZE * TILE_SIZE, i * TILE_SIZE);
        testCtx.stroke();
      }

      // Collect all spritesheets needed
      const sheetsNeeded = new Set();
      for (let y = 0; y < TEST_SIZE; y++) {
        for (let x = 0; x < TEST_SIZE; x++) {
          const spriteInfo = getSpriteForTestTile(x, y);
          if (spriteInfo) {
            sheetsNeeded.add(spriteInfo.sheet);
          }
        }
      }

      // Preload all needed spritesheets
      for (const sheetName of sheetsNeeded) {
        await loadSpritesheetImage(sheetName);
      }

      // Draw tiles
      for (let y = 0; y < TEST_SIZE; y++) {
        for (let x = 0; x < TEST_SIZE; x++) {
          const spriteInfo = getSpriteForTestTile(x, y);
          if (!spriteInfo) continue;

          const img = cachedSpritesheetImages[spriteInfo.sheet];
          if (!img) continue;

          const sheet = assets.spritesheets[spriteInfo.sheet];
          if (!sheet) continue;

          let sprite = sheet.sprites[spriteInfo.sprite];
          // Fallback: parse t_col_row name to compute sprite position directly
          if (!sprite && spriteInfo.sprite.startsWith('t_')) {
            const parts = spriteInfo.sprite.split('_');
            if (parts.length === 3) {
              const sc = parseInt(parts[1]);
              const sr = parseInt(parts[2]);
              if (!isNaN(sc) && !isNaN(sr)) {
                sprite = { x: sc * TILE_SIZE, y: sr * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
              }
            }
          }
          if (!sprite) continue;

          testCtx.drawImage(
            img,
            sprite.x, sprite.y, sprite.w || TILE_SIZE, sprite.h || TILE_SIZE,
            x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE
          );
        }
      }
    }

    let testCanvasInitialized = false;
    function setupTestCanvas() {
      if (!config || !assets) return;

      testCanvas = document.getElementById('test-canvas');
      if (!testCanvas) return;

      // Only set up event listeners once
      if (!testCanvasInitialized) {
        testCanvasInitialized = true;
        testCtx = testCanvas.getContext('2d');
        testCtx.imageSmoothingEnabled = false;

        testCanvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const rect = testCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);

        if (x >= 0 && x < TEST_SIZE && y >= 0 && y < TEST_SIZE) {
          isPainting = true;
          if (e.button === 2) {
            testGrid[y * TEST_SIZE + x] = null;
          } else {
            testGrid[y * TEST_SIZE + x] = paintTerrain;
          }
          renderTestCanvas();
        }
      });

      testCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('mouseup', () => {
        isPainting = false;
      });

      const tooltip = document.getElementById('test-tooltip');

      testCanvas.addEventListener('mousemove', (e) => {
        const rect = testCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);

        // Update tooltip position and show info
        if (x >= 0 && x < TEST_SIZE && y >= 0 && y < TEST_SIZE) {
          const terrainType = testGrid[y * TEST_SIZE + x];
          if (terrainType) {
            const mask = calculateBitmask(x, y, terrainType);
            const terrainConfig = config.terrains.find(t => t.type === terrainType);
            const spriteName = terrainConfig?.bitmaskMappings[mask] || terrainConfig?.defaultSprite || 'unknown';

            tooltip.innerHTML =
              '<div class="row"><span class="label">Pos:</span><span class="value">[' + x + ',' + y + ']</span></div>' +
              '<div class="row"><span class="label">Terrain:</span><span class="value">' + terrainType + '</span></div>' +
              '<div class="row"><span class="label">Bitmask:</span><span class="value">' + mask + '</span></div>' +
              '<div class="row"><span class="label">Sprite:</span><span class="value">' + spriteName + '</span></div>';
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 10) + 'px';
          } else {
            tooltip.style.display = 'none';
          }
        } else {
          tooltip.style.display = 'none';
        }

        // Handle painting
        if (!isPainting) return;
        if (x >= 0 && x < TEST_SIZE && y >= 0 && y < TEST_SIZE) {
          if (testGrid[y * TEST_SIZE + x] !== paintTerrain) {
            testGrid[y * TEST_SIZE + x] = paintTerrain;
            renderTestCanvas();
          }
        }
      });

      testCanvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });

      // Double-click to inspect cell and highlight in spritesheet
      testCanvas.addEventListener('dblclick', (e) => {
        const rect = testCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);

        if (x >= 0 && x < TEST_SIZE && y >= 0 && y < TEST_SIZE) {
          const terrainType = testGrid[y * TEST_SIZE + x];
          if (terrainType && currentMapping) {
            const mask = calculateBitmask(x, y, terrainType);
            const terrainConfig = config.terrains.find(t => t.type === terrainType);
            const spriteName = terrainConfig?.bitmaskMappings[mask] || terrainConfig?.defaultSprite;

            if (spriteName) {
              highlightSpriteInZones(spriteName);
            }
          }
        }
      });

      document.getElementById('paint-terrain').addEventListener('change', (e) => {
        paintTerrain = e.target.value;
      });

      document.getElementById('btn-clear-test').addEventListener('click', () => {
        testGrid.fill(null);
        renderTestCanvas();
      });

      } // End of one-time initialization

      updatePaintTerrainSelect();
      renderTestCanvas();
    }

    // === Status ===
    function showStatus(msg, type, duration) {
      const status = document.getElementById('status');
      status.textContent = msg;
      status.className = 'status ' + type;
      setTimeout(() => {
        status.textContent = '';
        status.className = '';
      }, duration);
    }

    function updateUnsavedIndicator() {
      const indicator = document.getElementById('unsaved-indicator');
      if (indicator) {
        indicator.style.display = hasUnsavedChanges ? 'inline-block' : 'none';
      }
    }

    function markUnsaved() {
      hasUnsavedChanges = true;
      updateUnsavedIndicator();
    }

    function clearUnsaved() {
      hasUnsavedChanges = false;
      updateUnsavedIndicator();
    }
  </script>
</body>
</html>`;
  }
}

let instance: TerrainConfigPanel | undefined;

export function getTerrainConfigPanel(extensionUri: vscode.Uri): TerrainConfigPanel {
  if (!instance) {
    instance = new TerrainConfigPanel(extensionUri);
  }
  return instance;
}
