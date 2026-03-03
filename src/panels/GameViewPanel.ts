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
   * Spawn a subagent animal on the map
   */
  public spawnSubagent(id: string, agentType: string): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'spawnSubagent',
        id,
        agentType,
      });
    }
  }

  /**
   * Remove a subagent animal from the map
   */
  public despawnSubagent(id: string): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'despawnSubagent',
        id,
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview-gameview.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src data:;">
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

    .renderer-badge {
      font-size: 7px;
      padding: 2px 6px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-muted);
      margin-left: 8px;
    }

    .renderer-badge.pixi {
      color: #e94560;
      border-color: #e94560;
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
        <div style="display: flex; align-items: center;">
          <span class="map-title">CODEBASE</span>
          <span class="renderer-badge" id="renderer-badge">Loading...</span>
        </div>
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

  <!-- Load the bundled game view script -->
  <script src="${scriptUri}"></script>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Initialize the game view when the bundle is loaded
    async function init() {
      // Wait for the bundle to load
      if (typeof window.initGameView !== 'function') {
        console.error('[GameView] Bundle not loaded, window.initGameView not found');
        return;
      }

      const canvas = document.getElementById('map-canvas');
      const hudCanvas = document.getElementById('hud-sprite-canvas');
      const mapWrapper = document.getElementById('map-wrapper');
      const mapEmpty = document.getElementById('map-empty');
      const mapStats = document.getElementById('map-stats');
      const tooltip = document.getElementById('tooltip');
      const tooltipName = document.getElementById('tooltip-name');
      const tooltipPath = document.getElementById('tooltip-path');
      const logFeed = document.getElementById('log-feed');
      const toolsGrid = document.getElementById('tools-grid');
      const rendererBadge = document.getElementById('renderer-badge');

      try {
        await window.initGameView({
          canvas,
          hudCanvas,
          mapWrapper,
          mapEmpty,
          mapStats,
          tooltip,
          tooltipName,
          tooltipPath,
          logFeed,
          toolsGrid,
          rendererBadge,
        });

        // Signal ready to extension
        vscode.postMessage({ type: 'webviewReady' });
        console.log('[GameView] Initialized successfully');
      } catch (error) {
        console.error('[GameView] Failed to initialize:', error);
      }
    }

    // Start initialization
    init();

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
