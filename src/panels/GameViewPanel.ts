/**
 * Game View Panel - Consolidated game-style interface for CodeMon
 * Combines agent sprite, overworld map, activity log, and budget tracking
 * into a single immersive main panel experience.
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { MapLayout } from '../core/codebase-mapper';
import { AgentConfig, ActivityEntry } from '../core/event-types';
import { BudgetStatus } from '../core/budget-tracker';
import { getAssetLoader, WebviewAssetData } from '../overworld/core/AssetLoader';
import { SerializedWorldMap } from '../overworld/core/types';

interface AgentPosition {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  filePath: string | null;
}

interface GameState {
  config: AgentConfig | null;
  layout: MapLayout | null;
  world: SerializedWorldMap | null;
  activities: ActivityEntry[];
  budget: { tokens: number; cost: number; percentage: number } | null;
  sessionTokens: number;
  sessionCost: number;
}

export class GameViewPanel {
  public static readonly viewType = 'codemon.gameView';
  private _panel: vscode.WebviewPanel | undefined;
  private _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _state: GameState = {
    config: null,
    layout: null,
    world: null,
    activities: [],
    budget: null,
    sessionTokens: 0,
    sessionCost: 0,
  };

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public show(): void {
    if (this._panel) {
      this._panel.reveal();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      GameViewPanel.viewType,
      'CodeMon Game View',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
      }
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage((data: { type: string; filePath?: string }) => {
      switch (data.type) {
        case 'webviewReady':
          this._replayState();
          break;
        case 'openFile':
          if (data.filePath) {
            vscode.workspace.openTextDocument(data.filePath).then(doc => {
              vscode.window.showTextDocument(doc);
            });
          }
          break;
      }
    }, null, this._disposables);

    this._panel.onDidDispose(() => {
      this._panel = undefined;
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];
    }, null, this._disposables);
  }

  /**
   * Replay current state to webview (used when panel reopens or webview ready)
   */
  private _replayState(): void {
    if (!this._panel) return;

    // Get assets once to use for all messages
    const assets = this._getAssets();

    if (this._state.config) {
      this._panel.webview.postMessage({
        type: 'updateConfig',
        config: this._state.config,
      });
    }

    if (this._state.layout) {
      // Include assets and world data with map update
      this._panel.webview.postMessage({
        type: 'updateMap',
        layout: this._state.layout,
        world: this._state.world,
        assets,
      });
    }

    if (this._state.budget) {
      this._panel.webview.postMessage({
        type: 'updateBudget',
        ...this._state.budget,
      });
    }

    // Send recent activities
    const recentActivities = this._state.activities.slice(-50);
    for (const entry of recentActivities) {
      this._panel.webview.postMessage({
        type: 'addActivity',
        entry,
      });
    }
  }

  /**
   * Update the map layout with world tile grid
   */
  public updateMap(layout: MapLayout, world?: SerializedWorldMap): void {
    this._state.layout = layout;
    this._state.world = world || null;
    if (this._panel) {
      // Send assets with map update
      const assets = this._getAssets();
      this._panel.webview.postMessage({
        type: 'updateMap',
        layout,
        world: world || null,
        assets,
      });
    }
  }

  /**
   * Send assets to webview
   */
  private _sendAssets(): void {
    if (!this._panel) return;
    const assets = this._getAssets();
    if (assets) {
      this._panel.webview.postMessage({
        type: 'loadAssets',
        assets,
      });
    }
  }

  /**
   * Get asset data for webview
   */
  private _getAssets(): WebviewAssetData | null {
    try {
      const loader = getAssetLoader();
      if (loader.isLoaded()) {
        return loader.getWebviewAssets();
      }
    } catch (error) {
      console.warn('[GameViewPanel] Could not get assets:', error);
    }
    return null;
  }

  /**
   * Move agent to a file (triggers walking animation)
   */
  public moveAgentToFile(filePath: string): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'moveAgent',
        filePath,
      });
    }
  }

  /**
   * Add activity entry to the log
   */
  public addActivityEntry(entry: ActivityEntry): void {
    this._state.activities.push(entry);
    // Keep only last 100 entries
    if (this._state.activities.length > 100) {
      this._state.activities = this._state.activities.slice(-100);
    }

    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'addActivity',
        entry,
      });
    }
  }

  /**
   * Update budget display
   */
  public updateBudget(tokens: number, cost: number, percentage: number): void {
    this._state.budget = { tokens, cost, percentage };
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'updateBudget',
        tokens,
        cost,
        percentage,
      });
    }
  }

  /**
   * Set agent animation state
   */
  public setAgentAnimation(animation: string): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'setAnimation',
        animation,
      });
    }
  }

  /**
   * Update agent config
   */
  public updateConfig(config: AgentConfig): void {
    this._state.config = config;
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'updateConfig',
        config,
      });
    }
  }

  /**
   * Reset session state
   */
  public resetSession(): void {
    this._state.activities = [];
    this._state.sessionTokens = 0;
    this._state.sessionCost = 0;

    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'resetSession',
      });
    }
  }

  /**
   * Update session totals
   */
  public updateSessionTotal(tokens: number, cost: number): void {
    this._state.sessionTokens = tokens;
    this._state.sessionCost = cost;

    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'updateSessionTotal',
        tokens,
        cost,
      });
    }
  }

  /**
   * Highlight all instances of a sprite on the worldmap
   * @param spriteId - Sprite ID to highlight (e.g., "grass/grass-center") or null to clear
   */
  public highlightSprite(spriteId: string | null): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'highlightSprite',
        spriteId,
      });
    }
  }

  /**
   * Refresh assets from disk and reload in webview
   */
  public async refreshAssets(): Promise<void> {
    if (!this._panel) return;

    try {
      const loader = getAssetLoader(this._extensionUri);
      await loader.load();
      const assets = loader.getWebviewAssets();

      this._panel.webview.postMessage({
        type: 'loadAssets',
        assets,
      });
    } catch (error) {
      console.error('[GameView] Failed to refresh assets:', error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; img-src data:;">
  <title>CodeMon Game View</title>
  <style>
    ${PIXEL_THEME_CSS}

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--pixel-bg);
    }

    .game-container {
      display: flex;
      height: 100vh;
      width: 100vw;
    }

    /* ─── Left HUD Panel ─────────────────────────────────────────────── */
    .hud-panel {
      width: 200px;
      min-width: 200px;
      display: flex;
      flex-direction: column;
      background: var(--pixel-bg-light);
      border-right: 2px solid var(--pixel-border);
      overflow-y: auto;
    }

    .hud-sprite {
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      border-bottom: 2px solid var(--pixel-border);
    }

    .hud-sprite canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .hud-sprite-name {
      margin-top: 6px;
      font-size: 8px;
      color: var(--pixel-accent);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .hud-model {
      font-size: 7px;
      color: var(--pixel-muted);
      margin-top: 2px;
    }

    .hud-section {
      padding: 10px;
      border-bottom: 1px solid var(--pixel-border);
    }

    .hud-section-title {
      font-size: 7px;
      color: var(--pixel-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

    .stat-bar {
      margin-bottom: 8px;
    }

    .stat-bar-label {
      font-size: 7px;
      color: var(--pixel-muted);
      margin-bottom: 3px;
      display: flex;
      justify-content: space-between;
    }

    .stat-bar-track {
      height: 10px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      box-shadow: inset 1px 1px 0 0 var(--pixel-shadow);
      overflow: hidden;
    }

    .stat-bar-fill {
      height: 100%;
      transition: width 0.3s ease-out;
      background: var(--pixel-accent);
    }

    .stat-bar-fill.warning {
      background: var(--pixel-warning);
    }

    .stat-bar-fill.danger {
      background: var(--pixel-error);
      animation: pulse 0.5s ease-in-out infinite;
    }

    .hud-totals {
      padding: 8px 10px;
      background: var(--pixel-bg);
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 7px;
      margin-bottom: 2px;
    }

    .total-row .label {
      color: var(--pixel-muted);
    }

    .total-row .value {
      color: var(--pixel-fg);
    }

    /* Tools in HUD */
    .tools-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }

    .tool-chip {
      padding: 3px 6px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      font-size: 6px;
      color: var(--pixel-accent);
    }

    /* ─── Main Map Area ───────────────────────────────────────────────── */
    .map-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .map-header {
      padding: 8px 12px;
      background: var(--pixel-bg-light);
      border-bottom: 2px solid var(--pixel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .map-title {
      font-size: 10px;
      color: var(--pixel-accent);
    }

    .map-stats {
      font-size: 8px;
      color: var(--pixel-muted);
    }

    .map-canvas-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
      cursor: grab;
    }

    .map-canvas-wrapper:active {
      cursor: grabbing;
    }

    #map-canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      display: block;
    }

    .map-empty {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: var(--pixel-muted);
    }

    .map-empty-icon {
      font-size: 48px;
      opacity: 0.3;
    }

    .map-empty-text {
      font-size: 10px;
      margin-top: 12px;
    }

    /* Tooltip */
    .tooltip {
      display: none;
      position: absolute;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
      padding: 8px;
      font-size: 8px;
      pointer-events: none;
      z-index: 100;
      max-width: 200px;
    }

    .tooltip-name {
      color: var(--pixel-accent);
      font-weight: bold;
      margin-bottom: 4px;
      word-break: break-all;
    }

    .tooltip-path {
      color: var(--pixel-muted);
      word-break: break-all;
    }

    /* ─── Activity Log Panel ──────────────────────────────────────────── */
    .log-panel {
      width: 240px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      background: var(--pixel-bg-light);
      border-left: 2px solid var(--pixel-border);
    }

    .log-header {
      padding: 8px 12px;
      border-bottom: 2px solid var(--pixel-border);
      font-size: 10px;
      color: var(--pixel-accent);
    }

    .log-feed {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .log-entry {
      padding: 6px 8px;
      margin-bottom: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      font-size: 8px;
      animation: slide-in 0.2s ease-out;
    }

    .log-entry-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .log-entry-icon {
      color: var(--pixel-accent);
    }

    .log-entry-tokens {
      color: var(--pixel-muted);
    }

    .log-entry-detail {
      color: var(--pixel-fg);
      word-break: break-all;
      line-height: 1.4;
    }

    .log-entry.error {
      border-color: var(--pixel-error);
    }

    .log-entry.error .log-entry-icon {
      color: var(--pixel-error);
    }

    /* ─── Animations ──────────────────────────────────────────────────── */
    @keyframes slide-in {
      from { opacity: 0; transform: translateX(8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  </style>
</head>
<body>
  <div class="game-container">
    <!-- Left HUD -->
    <div class="hud-panel">
      <div class="hud-sprite">
        <canvas id="hud-sprite-canvas" width="64" height="64"></canvas>
        <div class="hud-sprite-name" id="sprite-name">RANGER</div>
        <div class="hud-model" id="model-name">Sonnet 4.5</div>
      </div>

      <div class="hud-section">
        <div class="hud-section-title">Budget</div>
        <div class="stat-bar">
          <div class="stat-bar-label">
            <span>Daily</span>
            <span id="budget-percent">0%</span>
          </div>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" id="budget-bar" style="width: 0%"></div>
          </div>
        </div>
        <div class="stat-bar">
          <div class="stat-bar-label">
            <span>Session</span>
            <span id="session-tokens">0</span>
          </div>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" id="session-bar" style="width: 0%; background: var(--pixel-success);"></div>
          </div>
        </div>
        <div class="hud-totals">
          <div class="total-row">
            <span class="label">Total</span>
            <span class="value" id="total-tokens">0</span>
          </div>
          <div class="total-row">
            <span class="label">Cost</span>
            <span class="value" id="total-cost">$0.00</span>
          </div>
        </div>
      </div>

      <div class="hud-section">
        <div class="hud-section-title">Tools</div>
        <div class="tools-grid" id="tools-grid">
          <div class="tool-chip">Loading...</div>
        </div>
      </div>
    </div>

    <!-- Main Map -->
    <div class="map-area">
      <div class="map-header">
        <span class="map-title">CODEBASE</span>
        <span class="map-stats" id="map-stats">0 files</span>
      </div>

      <div class="map-canvas-wrapper" id="map-wrapper">
        <div class="map-empty" id="map-empty">
          <div class="map-empty-icon">🗺</div>
          <div class="map-empty-text">No activity yet</div>
        </div>
        <canvas id="map-canvas" style="display: none;"></canvas>
      </div>

      <div class="tooltip" id="tooltip">
        <div class="tooltip-name" id="tooltip-name"></div>
        <div class="tooltip-path" id="tooltip-path"></div>
      </div>
    </div>

    <!-- Activity Log -->
    <div class="log-panel">
      <div class="log-header">ACTIVITY LOG</div>
      <div class="log-feed" id="log-feed"></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ─── State ──────────────────────────────────────────────────────────
    let tiles = [];
    let worldTiles = [];   // Serialized tile grid from WorldGenerator
    let worldPlots = [];   // Plot metadata (files/directories)
    let layoutWidth = 400;
    let layoutHeight = 300;
    let glowPhase = 0;
    let config = null;

    // Agent state
    let agent = {
      x: 200,
      y: 150,
      targetX: 200,
      targetY: 150,
      isMoving: false,
      filePath: null,
      animation: 'idle',
      frameIndex: 0,
      type: 'ranger',
      direction: 'down'
    };

    // Map interaction state
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;
    let hoveredTile = null;
    let sessionTokens = 0;
    let maxSessionTokens = 100000; // For session bar

    let highlightSpriteId = null; // Sprite highlighting

    // ─── DOM refs ───────────────────────────────────────────────

    // ─── DOM refs ───────────────────────────────────────────────────────
    const mapCanvas = document.getElementById('map-canvas');
    const mapCtx = mapCanvas.getContext('2d');
    const mapWrapper = document.getElementById('map-wrapper');
    const mapEmpty = document.getElementById('map-empty');
    const mapStats = document.getElementById('map-stats');
    const tooltip = document.getElementById('tooltip');
    const tooltipName = document.getElementById('tooltip-name');
    const tooltipPath = document.getElementById('tooltip-path');
    const logFeed = document.getElementById('log-feed');
    const toolsGrid = document.getElementById('tools-grid');
    const hudSpriteCanvas = document.getElementById('hud-sprite-canvas');
    const hudCtx = hudSpriteCanvas.getContext('2d');

    mapCtx.imageSmoothingEnabled = false;
    hudCtx.imageSmoothingEnabled = false;

    // ─── Sprite Colors ──────────────────────────────────────────────────
    const SPRITE_COLORS = {
      knight: { primary: '#ff77a8', secondary: '#83769c', accent: '#ffec27', name: 'KNIGHT' },
      ranger: { primary: '#29adff', secondary: '#1d2b53', accent: '#00e436', name: 'RANGER' },
      rogue: { primary: '#00e436', secondary: '#003d28', accent: '#29adff', name: 'ROGUE' }
    };

    // ─── Animations ─────────────────────────────────────────────────────
    const ANIMATIONS = {
      idle: [
        { bodyY: 0, eyeY: 0, armOffset: 0 },
        { bodyY: -1, eyeY: 0, armOffset: 0 }
      ],
      walk: [
        { bodyY: 0, eyeY: 0, armOffset: 4, legOffset: 2 },
        { bodyY: -1, eyeY: 0, armOffset: -4, legOffset: -2 }
      ],
      investigate: [
        { bodyY: 0, eyeY: 2, armOffset: 4 },
        { bodyY: 0, eyeY: 2, armOffset: 6 }
      ],
      write: [
        { bodyY: 0, eyeY: 0, armOffset: 2 },
        { bodyY: 0, eyeY: 0, armOffset: -2 }
      ],
      bash: [
        { bodyY: 0, eyeY: 0, armOffset: 8 },
        { bodyY: -2, eyeY: 0, armOffset: -4 }
      ]
    };

    // ─── Sprite System ─────────────────────────────────────────────────
    let spritesheets = {};
    let spritesLoaded = false;
    const TILE_SIZE = 16;

    // ─── Animation System ───────────────────────────────────────────────
    // Tracks animated sprite overrides (e.g., water tiles cycling frames)
    const tileAnimations = new Map(); // key -> { frames: string[], fps, currentFrame, timer, loop }
    let lastFrameTime = performance.now();
    let manifest = null;

    function initAnimations(manifestData) {
      manifest = manifestData;
      // Animation definitions will be applied when world tiles are received
    }

    function registerTileAnimations() {
      tileAnimations.clear();
      if (!manifest || !manifest.animations) return;

      // Register water animations for water tiles
      for (const tile of worldTiles) {
        if (tile.type === 'water') {
          const key = tile.x + ',' + tile.y;
          const waterAnim = manifest.animations['water-flow'];
          if (waterAnim) {
            // Offset the start frame based on position for visual variety
            const startFrame = Math.abs((tile.x * 3 + tile.y * 7) % waterAnim.frames.length);
            tileAnimations.set(key, {
              frames: waterAnim.frames.map(f => 'water/' + f),
              fps: waterAnim.fps,
              currentFrame: startFrame,
              timer: 0,
              loop: waterAnim.loop,
            });
          }
        }
      }
    }

    function updateAnimations(deltaTime) {
      for (const [key, anim] of tileAnimations) {
        anim.timer += deltaTime;
        const frameTime = 1000 / anim.fps;
        if (anim.timer >= frameTime) {
          anim.timer -= frameTime;
          if (anim.currentFrame < anim.frames.length - 1) {
            anim.currentFrame++;
          } else if (anim.loop) {
            anim.currentFrame = 0;
          }
        }
      }
    }

    function getAnimatedSpriteId(tile) {
      const key = tile.x + ',' + tile.y;
      const anim = tileAnimations.get(key);
      if (anim) {
        return anim.frames[anim.currentFrame];
      }
      return tile.spriteId;
    }

    async function loadAssets(assetsData) {
      if (!assetsData || !assetsData.spritesheets) {
        console.warn('[GameView] No assets data received');
        return;
      }

      console.log('[GameView] Loading sprites...');

      for (const [name, sheetData] of Object.entries(assetsData.spritesheets)) {
        try {
          const img = new Image();
          img.src = sheetData.imageUrl;

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          spritesheets[name] = {
            image: img,
            sprites: sheetData.sprites,
          };

          console.log('[GameView] Loaded spritesheet:', name);
        } catch (error) {
          console.warn('[GameView] Failed to load spritesheet:', name, error);
        }
      }

      spritesLoaded = Object.keys(spritesheets).length > 0;
      console.log('[GameView] Sprites loaded:', spritesLoaded);

      // Store manifest for animation definitions
      if (assetsData.manifest) {
        initAnimations(assetsData.manifest);
      }
    }

    function drawSprite(spriteId, dx, dy, dw, dh) {
      const [sheetName, spriteName] = spriteId.split('/');
      const sheet = spritesheets[sheetName];

      if (!sheet || !sheet.sprites[spriteName]) {
        return false;
      }

      const sprite = sheet.sprites[spriteName];
      mapCtx.drawImage(
        sheet.image,
        sprite.x, sprite.y, sprite.w, sprite.h,
        dx, dy, dw || sprite.w, dh || sprite.h
      );
      return true;
    }

    // ─── HUD Sprite Rendering ───────────────────────────────────────────
    function drawHudSprite() {
      const colors = SPRITE_COLORS[agent.type];
      const frame = ANIMATIONS[agent.animation][agent.frameIndex];
      const s = 4; // scale

      hudCtx.clearRect(0, 0, 64, 64);
      hudCtx.save();
      hudCtx.translate(32, 32 + frame.bodyY);

      // Body
      hudCtx.fillStyle = colors.primary;
      hudCtx.fillRect(-8*s, -10*s, 16*s, 20*s);

      // Head
      hudCtx.fillRect(-6*s, -18*s, 12*s, 10*s);

      // Eyes
      hudCtx.fillStyle = '#1a1c2c';
      hudCtx.fillRect(-4*s, (-14 + frame.eyeY)*s, 2*s, 2*s);
      hudCtx.fillRect(2*s, (-14 + frame.eyeY)*s, 2*s, 2*s);

      // Arms
      hudCtx.fillStyle = colors.secondary;
      hudCtx.fillRect(-11*s, (-6 + frame.armOffset)*s, 3*s, 8*s);
      hudCtx.fillRect(8*s, (-6 - frame.armOffset)*s, 3*s, 8*s);

      // Legs
      const legOffset = frame.legOffset || 0;
      hudCtx.fillRect(-6*s, (10 + legOffset)*s, 4*s, 6*s);
      hudCtx.fillRect(2*s, (10 - legOffset)*s, 4*s, 6*s);

      // Accessory
      hudCtx.fillStyle = colors.accent;
      if (agent.type === 'ranger') {
        hudCtx.fillStyle = colors.secondary;
        hudCtx.fillRect(-7*s, -20*s, 14*s, 4*s);
        hudCtx.fillStyle = colors.accent;
        hudCtx.fillRect(12*s, -8*s, 2*s, 12*s);
      } else if (agent.type === 'knight') {
        hudCtx.fillRect(-4*s, -16*s, 8*s, 2*s);
        hudCtx.fillRect(-14*s, -4*s, 4*s, 8*s);
      } else if (agent.type === 'rogue') {
        hudCtx.fillStyle = colors.secondary;
        hudCtx.fillRect(-7*s, -19*s, 14*s, 3*s);
        hudCtx.fillStyle = colors.accent;
        hudCtx.fillRect(-13*s, 0, 2*s, 8*s);
      }

      hudCtx.restore();
    }

    // ─── Map Rendering ──────────────────────────────────────────────────
    function renderMap() {
      if (tiles.length === 0 && worldTiles.length === 0) return;

      const w = mapCanvas.width;
      const h = mapCanvas.height;

      // Clear with background
      mapCtx.fillStyle = '#1a1c2c';
      mapCtx.fillRect(0, 0, w, h);

      // Wait for sprites to load
      if (!spritesLoaded) {
        mapCtx.fillStyle = '#5a5d6e';
        mapCtx.font = '12px monospace';
        mapCtx.textAlign = 'center';
        mapCtx.fillText('Loading sprites...', w / 2, h / 2);
        mapCtx.textAlign = 'left';
        return;
      }

      // Compute scale
      const baseScaleX = w / layoutWidth;
      const baseScaleY = h / layoutHeight;
      const baseScale = Math.min(baseScaleX, baseScaleY);

      mapCtx.save();
      mapCtx.translate(panX, panY);
      mapCtx.scale(zoom * baseScale, zoom * baseScale);

      // Use world tile grid if available (unified data path)
      if (worldTiles.length > 0) {
        renderWorldTiles();
      }

      // Draw agent sprite on map (always draw at current position)
      drawMapAgent();

      // Draw active glows and sparkles using MapLayout tiles
      for (const tile of tiles) {
        if (!tile.isDir && tile.node && tile.node.isActive) {
          drawActiveGlow(tile);
        }
        // Sparkle for high activity
        if (!tile.isDir && tile.node && (tile.node.readCount + tile.node.writeCount) >= 5) {
          const sparkleX = tile.x + tile.width * 0.5 + Math.sin(glowPhase * 3 + tile.x) * 2;
          const sparkleY = tile.y + tile.height * 0.5 + Math.cos(glowPhase * 2 + tile.y) * 2;
          mapCtx.fillStyle = 'rgba(255, 255, 255, ' + (0.3 + Math.sin(glowPhase * 4) * 0.3) + ')';
          mapCtx.fillRect(sparkleX - 0.5, sparkleY - 0.5, 1, 1);
        }
      }

      // Hover highlight
      if (hoveredTile) {
        mapCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        mapCtx.fillRect(hoveredTile.x, hoveredTile.y, hoveredTile.width, hoveredTile.height);
      }

      mapCtx.restore();
    }

    /**
     * Render from the unified world tile grid (sorted by layer)
     */
    function renderWorldTiles() {
      // Sort tiles by layer for proper draw order
      const sorted = worldTiles.slice().sort((a, b) => a.layer - b.layer);

      for (const tile of sorted) {
        const spriteId = getAnimatedSpriteId(tile);
        drawSprite(spriteId, tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Highlight matching sprites
        if (highlightSpriteId && spriteId === highlightSpriteId) {
          const glowAlpha = 0.3 + Math.sin(glowPhase * 3) * 0.2;
          mapCtx.strokeStyle = 'rgba(255, 200, 0, ' + glowAlpha + ')';
          mapCtx.lineWidth = 2;
          mapCtx.strokeRect(
            tile.x * TILE_SIZE - 1,
            tile.y * TILE_SIZE - 1,
            TILE_SIZE + 2,
            TILE_SIZE + 2
          );
        }
      }

      // Draw directory labels from plots
      for (const plot of worldPlots) {
        if (plot.isDirectory && plot.filePath) {
          const label = plot.filePath.split('/').pop() || plot.filePath.split('\\\\').pop() || '';
          if (label && plot.width >= 3) {
            mapCtx.fillStyle = '#8a8a8a';
            mapCtx.font = '7px monospace';
            const maxChars = Math.floor((plot.width * TILE_SIZE - 4) / 5);
            const truncLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + '~' : label;
            mapCtx.fillText(truncLabel, plot.x * TILE_SIZE + 3, plot.y * TILE_SIZE + 10);
          }
        }
      }
    }

    function drawActiveGlow(tile) {
      const alpha = 0.3 + Math.sin(glowPhase * 4) * 0.2;
      const size = 2 + Math.sin(glowPhase * 3) * 1;

      mapCtx.fillStyle = 'rgba(41, 173, 255, ' + alpha + ')';
      mapCtx.fillRect(tile.x - size, tile.y - size, tile.width + size * 2, tile.height + size * 2);
    }

    // Helper: Get character sprite ID based on action, direction, and frame
    function getCharacterSpriteId(action, direction, frameIndex) {
      const frame = frameIndex % 6; // 6 frames per animation
      return 'claude-actions/char-' + action + '-' + direction + '-' + frame;
    }

    // Action-to-animation mapping based on tool name
    function getActionForTool(toolName) {
      const actionMap = {
        'Read': 'harvest',
        'Glob': 'walk',
        'Grep': 'walk',
        'Write': 'plant',
        'Edit': 'plant',
        'NotebookEdit': 'plant',
        'Bash': 'water'
      };
      return actionMap[toolName] || 'idle';
    }

    function drawMapAgent() {
      // Try to use spritesheet first
      const action = agent.animation || 'idle';
      const dir = agent.direction || 'down';
      const spriteId = getCharacterSpriteId(action, dir, agent.frameIndex);

      // Draw sprite if available
      if (spritesLoaded) {
        const drawn = drawSprite(spriteId, agent.x - 8, agent.y - 12, 16, 24);
        if (drawn) {
          // Cursor indicator
          const cursorAlpha = 0.5 + Math.sin(glowPhase * 5) * 0.3;
          mapCtx.strokeStyle = 'rgba(255, 236, 39, ' + cursorAlpha + ')';
          mapCtx.lineWidth = 1;
          mapCtx.strokeRect(agent.x - 8, agent.y - 12, 16, 24);
          return;
        }
      }

      // Fallback to programmatic rendering if sprite not found
      const colors = SPRITE_COLORS[agent.type];
      const frame = ANIMATIONS[agent.animation][agent.frameIndex];
      const s = 1.5; // Smaller scale for map

      mapCtx.save();
      mapCtx.translate(agent.x, agent.y);
      mapCtx.translate(0, frame.bodyY);

      // Shadow
      mapCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      mapCtx.beginPath();
      mapCtx.ellipse(0, 12*s, 6*s, 2*s, 0, 0, Math.PI * 2);
      mapCtx.fill();

      // Body
      mapCtx.fillStyle = colors.primary;
      mapCtx.fillRect(-4*s, -6*s, 8*s, 12*s);

      // Head
      mapCtx.fillRect(-3*s, -10*s, 6*s, 5*s);

      // Eyes
      mapCtx.fillStyle = '#1a1c2c';
      mapCtx.fillRect(-2*s, (-8 + (frame.eyeY || 0))*s, 1*s, 1*s);
      mapCtx.fillRect(1*s, (-8 + (frame.eyeY || 0))*s, 1*s, 1*s);

      // Accent
      mapCtx.fillStyle = colors.accent;
      mapCtx.fillRect(5*s, -4*s, 1*s, 6*s);

      mapCtx.restore();

      // Cursor indicator
      const cursorAlpha = 0.5 + Math.sin(glowPhase * 5) * 0.3;
      mapCtx.strokeStyle = 'rgba(255, 236, 39, ' + cursorAlpha + ')';
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(agent.x - 8, agent.y - 12, 16, 24);
    }

    // ─── Agent Movement ─────────────────────────────────────────────────
    function updateAgentPosition() {
      if (!agent.isMoving) return;

      const speed = 0.08;
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) {
        agent.x = agent.targetX;
        agent.y = agent.targetY;
        agent.isMoving = false;
        agent.animation = 'idle';
      } else {
        agent.x += dx * speed;
        agent.y += dy * speed;
        agent.animation = 'walk';

        // Calculate direction based on movement vector
        if (Math.abs(dx) > Math.abs(dy)) {
          agent.direction = dx > 0 ? 'right' : 'left';
        } else {
          agent.direction = dy > 0 ? 'down' : 'up';
        }
      }
    }

    function moveAgentToTile(filePath) {
      const tile = tiles.find(t => !t.isDir && t.node && t.node.path === filePath);
      if (tile) {
        agent.targetX = tile.x + tile.width / 2;
        agent.targetY = tile.y + tile.height / 2;
        agent.filePath = filePath;
        agent.isMoving = true;
      }
    }

    // ─── Animation Loop ─────────────────────────────────────────────────
    let animFrame = 0;

    function animate() {
      const now = performance.now();
      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;

      glowPhase += 0.02;
      animFrame++;

      // Update agent position
      updateAgentPosition();

      // Update sprite animation frame
      if (animFrame % 15 === 0) {
        agent.frameIndex = (agent.frameIndex + 1) % ANIMATIONS[agent.animation].length;
      }

      // Update tile animations (water flow, etc.)
      updateAnimations(deltaTime);

      // Render
      drawHudSprite();
      if (tiles.length > 0 || worldTiles.length > 0) {
        renderMap();
      }

      requestAnimationFrame(animate);
    }

    animate();

    // ─── Canvas Sizing ──────────────────────────────────────────────────
    function resizeMapCanvas() {
      const rect = mapWrapper.getBoundingClientRect();
      mapCanvas.width = Math.max(100, rect.width);
      mapCanvas.height = Math.max(100, rect.height);
      mapCtx.imageSmoothingEnabled = false;
      renderMap();
    }

    const resizeObserver = new ResizeObserver(() => resizeMapCanvas());
    resizeObserver.observe(mapWrapper);

    // ─── Map Interactions ────────────────────────────────────────────────
    function getTileAtPoint(clientX, clientY) {
      const rect = mapCanvas.getBoundingClientRect();
      const baseScaleX = mapCanvas.width / layoutWidth;
      const baseScaleY = mapCanvas.height / layoutHeight;
      const baseScale = Math.min(baseScaleX, baseScaleY);
      const totalScale = zoom * baseScale;
      const mx = (clientX - rect.left - panX) / totalScale;
      const my = (clientY - rect.top - panY) / totalScale;

      for (let i = tiles.length - 1; i >= 0; i--) {
        const t = tiles[i];
        if (t.isDir) continue;
        if (mx >= t.x && mx < t.x + t.width && my >= t.y && my < t.y + t.height) {
          return t;
        }
      }
      return null;
    }

    mapWrapper.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panX = panStartPanX + (e.clientX - panStartX);
        panY = panStartPanY + (e.clientY - panStartY);
        return;
      }

      const tile = getTileAtPoint(e.clientX, e.clientY);

      if (tile && tile !== hoveredTile) {
        hoveredTile = tile;
        const node = tile.node;
        tooltipName.textContent = node.name;
        tooltipPath.textContent = node.path;
        tooltip.style.display = 'block';
      } else if (!tile && hoveredTile) {
        hoveredTile = null;
        tooltip.style.display = 'none';
      }

      if (tile) {
        const rect = mapWrapper.getBoundingClientRect();
        let tx = e.clientX - rect.left + 12;
        let ty = e.clientY - rect.top - 8;
        if (tx + 200 > rect.width) tx = e.clientX - rect.left - 210;
        if (ty + 80 > rect.height) ty = e.clientY - rect.top - 80;
        tooltip.style.left = tx + 'px';
        tooltip.style.top = ty + 'px';
      }
    });

    mapWrapper.addEventListener('mouseleave', () => {
      hoveredTile = null;
      tooltip.style.display = 'none';
    });

    mapWrapper.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartPanX = panX;
        panStartPanY = panY;
      }
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
    });

    mapWrapper.addEventListener('dblclick', (e) => {
      const tile = getTileAtPoint(e.clientX, e.clientY);
      if (tile && tile.node) {
        vscode.postMessage({ type: 'openFile', filePath: tile.node.path });
      }
    });

    mapWrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = mapCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.min(4, Math.max(0.5, zoom * delta));
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
    }, { passive: false });

    // ─── Message Handling ───────────────────────────────────────────────
    window.addEventListener('message', async event => {
      const message = event.data;

      switch (message.type) {
        case 'loadAssets':
          if (message.assets) {
            await loadAssets(message.assets);
          }
          break;
        case 'updateMap':
          // Load assets if provided and not already loaded
          if (message.assets && !spritesLoaded) {
            await loadAssets(message.assets);
          }
          handleMapUpdate(message.layout, message.world);
          break;
        case 'moveAgent':
          moveAgentToTile(message.filePath);
          break;
        case 'addActivity':
          addActivityEntry(message.entry);
          break;
        case 'updateBudget':
          updateBudget(message.tokens, message.cost, message.percentage);
          break;
        case 'setAnimation':
          agent.animation = message.animation;
          break;
        case 'updateConfig':
          handleConfigUpdate(message.config);
          break;
        case 'updateSessionTotal':
          updateSessionTotal(message.tokens, message.cost);
          break;
        case 'resetSession':
          resetSession();
          break;
        case 'highlightSprite':
          highlightSpriteId = message.spriteId || null;
          break;
      }
    });

    function handleMapUpdate(layout, world) {
      tiles = layout.tiles || [];
      layoutWidth = layout.width || 400;
      layoutHeight = layout.height || 300;
      mapStats.textContent = layout.fileCount + ' files';

      // Store world tile grid if provided
      if (world) {
        worldTiles = world.tiles || [];
        worldPlots = world.plots || [];
        // Re-register animations for new world data
        registerTileAnimations();
      }

      // Initialize agent position to first file tile if not yet positioned
      if (!agent.filePath && tiles.length > 0) {
        const firstFile = tiles.find(t => !t.isDir && t.node);
        if (firstFile) {
          agent.x = firstFile.x + firstFile.width / 2;
          agent.y = firstFile.y + firstFile.height / 2;
          agent.filePath = firstFile.node.path;
        }
      }

      if (tiles.length > 0 || worldTiles.length > 0) {
        mapEmpty.style.display = 'none';
        mapCanvas.style.display = 'block';
        resizeMapCanvas();
      }
    }

    function handleConfigUpdate(newConfig) {
      config = newConfig;

      // Update sprite type based on model
      if (config.model) {
        if (config.model.includes('opus')) {
          agent.type = 'knight';
        } else if (config.model.includes('haiku')) {
          agent.type = 'rogue';
        } else {
          agent.type = 'ranger';
        }
        document.getElementById('sprite-name').textContent = SPRITE_COLORS[agent.type].name;
      }

      document.getElementById('model-name').textContent = config.model || 'Unknown';

      // Update tools grid
      if (config.tools && config.tools.length > 0) {
        toolsGrid.innerHTML = config.tools.slice(0, 12).map(tool =>
          '<span class="tool-chip">' + formatToolName(tool) + '</span>'
        ).join('');
      } else {
        toolsGrid.innerHTML = '<div class="tool-chip">No tools</div>';
      }
    }

    function addActivityEntry(entry) {
      const div = document.createElement('div');
      div.className = 'log-entry' + (entry.isError ? ' error' : '');

      const icon = getActivityIcon(entry.icon);
      const tokens = entry.tokens ? '+' + formatTokens(entry.tokens) : '';

      div.innerHTML = \`
        <div class="log-entry-header">
          <span class="log-entry-icon">\${icon} \${entry.label || ''}</span>
          <span class="log-entry-tokens">\${tokens}</span>
        </div>
        <div class="log-entry-detail">\${entry.detail || ''}</div>
      \`;

      logFeed.appendChild(div);
      logFeed.scrollTop = logFeed.scrollHeight;

      // Keep only last 50 entries in DOM
      while (logFeed.children.length > 50) {
        logFeed.removeChild(logFeed.firstChild);
      }
    }

    function updateBudget(tokens, cost, percentage) {
      const bar = document.getElementById('budget-bar');
      bar.style.width = percentage + '%';
      bar.className = 'stat-bar-fill' + (percentage >= 80 ? ' danger' : percentage >= 60 ? ' warning' : '');
      document.getElementById('budget-percent').textContent = percentage.toFixed(1) + '%';
      document.getElementById('total-tokens').textContent = formatTokens(tokens) + ' tokens';
      document.getElementById('total-cost').textContent = '$' + cost.toFixed(4);
    }

    function updateSessionTotal(tokens, cost) {
      sessionTokens = tokens;
      const sessionPercent = Math.min(100, (tokens / maxSessionTokens) * 100);
      document.getElementById('session-bar').style.width = sessionPercent + '%';
      document.getElementById('session-tokens').textContent = formatTokens(tokens);
    }

    function resetSession() {
      logFeed.innerHTML = '';
      sessionTokens = 0;
      document.getElementById('session-bar').style.width = '0%';
      document.getElementById('session-tokens').textContent = '0';
    }

    function getActivityIcon(icon) {
      const icons = {
        read: '📖',
        write: '✏️',
        edit: '✏️',
        bash: '⚡',
        glob: '🔍',
        grep: '🔍',
        websearch: '🌐',
        webfetch: '🌐',
        agent: '🤖',
        success: '✅',
        error: '❌'
      };
      return icons[icon] || '⚔️';
    }

    function formatToolName(tool) {
      return tool.replace(/^(mcp__|MCP)/i, '').substring(0, 8);
    }

    function formatTokens(tokens) {
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
      return tokens.toString();
    }

    // Signal ready
    vscode.postMessage({ type: 'webviewReady' });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    this._panel?.dispose();
    this._panel = undefined;
  }
}

// Singleton
let gameViewPanel: GameViewPanel | undefined;

export function getGameViewPanel(extensionUri: vscode.Uri): GameViewPanel {
  if (!gameViewPanel) {
    gameViewPanel = new GameViewPanel(extensionUri);
  }
  return gameViewPanel;
}
