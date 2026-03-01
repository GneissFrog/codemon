/**
 * Agent Card Panel - VS Code webview showing agent configuration
 * With pixel art sprite and animations
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS, getSpriteCss } from '../webview/shared/pixel-theme';
import { AgentConfig } from '../core/event-types';
import { getConfigReader } from '../core/config-reader';

export class AgentCardPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.agentCard';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _config: AgentConfig | undefined;

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

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case 'refresh':
          this.refresh();
          break;
      }
    });

    // Load initial config
    this.refresh();
  }

  /**
   * Update the agent card with new config
   */
  public updateConfig(config: AgentConfig): void {
    this._config = config;
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateConfig',
        config,
      });
    }
  }

  /**
   * Refresh the config from source
   */
  public async refresh(): Promise<void> {
    const configReader = getConfigReader();
    const config = await configReader.readConfig();
    this.updateConfig(config);
  }

  /**
   * Update animation state
   */
  public setAnimation(animation: string): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'setAnimation',
        animation,
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';">
  <title>Agent Card</title>
  <style>
    ${PIXEL_THEME_CSS}
    ${getSpriteCss('ranger')}

    .agent-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sprite-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
      margin-bottom: 4px;
    }

    .sprite-name {
      margin-top: 8px;
      font-size: 8px;
      color: var(--pixel-accent);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    #sprite-canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .info-section {
      padding: 8px;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
    }

    .info-section h3 {
      font-size: 8px;
      color: var(--pixel-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--pixel-border);
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }

    .tools-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }

    .tool-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: var(--pixel-bg);
      font-size: 8px;
      border: 1px solid var(--pixel-border);
    }

    .tool-icon {
      color: var(--pixel-accent);
    }

    .permission-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 8px;
    }

    .permission-icon {
      width: 12px;
      text-align: center;
    }

    .system-prompt {
      font-size: 8px;
      color: var(--pixel-muted);
      font-style: italic;
      padding: 8px;
      background: var(--pixel-bg);
      border-left: 3px solid var(--pixel-accent);
      line-height: 1.4;
    }

    .refresh-btn {
      width: 100%;
      padding: 8px;
      margin-top: 4px;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
      color: var(--pixel-fg);
      cursor: pointer;
      font-family: 'Press Start 2P', monospace;
      font-size: 8px;
      box-shadow:
        inset -2px -2px 0 0 var(--pixel-shadow),
        inset 2px 2px 0 0 var(--pixel-bg-lighter);
    }

    .refresh-btn:hover {
      background: var(--pixel-bg-lighter);
    }

    .refresh-btn:active {
      box-shadow:
        inset 2px 2px 0 0 var(--pixel-shadow),
        inset -2px -2px 0 0 var(--pixel-bg-lighter);
      transform: translate(1px, 1px);
    }
  </style>
</head>
<body>
  <div class="agent-card">
    <div class="sprite-container">
      <canvas id="sprite-canvas" width="64" height="64"></canvas>
      <div class="sprite-name" id="sprite-name">RANGER</div>
    </div>

    <div class="info-section">
      <h3>Model</h3>
      <div class="info-row">
        <span class="label">Name</span>
        <span class="value" id="model-name">Loading...</span>
      </div>
      <div class="info-row">
        <span class="label">Context</span>
        <span class="value" id="context-window">--</span>
      </div>
    </div>

    <div class="info-section">
      <h3>Tools</h3>
      <div class="tools-grid" id="tools-grid">
        <div class="tool-item"><span class="tool-icon">⚔</span>Loading...</div>
      </div>
    </div>

    <div class="info-section">
      <h3>Permissions</h3>
      <div id="permissions-list">
        <div class="permission-item">Loading...</div>
      </div>
    </div>

    <div class="info-section" id="system-prompt-section" style="display: none;">
      <h3>Personality</h3>
      <div class="system-prompt" id="system-prompt"></div>
    </div>

    <button class="refresh-btn" id="refresh-btn">↻ REFRESH</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Sprite colors by type (PICO-8 palette)
    const SPRITE_COLORS = {
      knight: { primary: '#ff77a8', secondary: '#83769c', accent: '#ffec27', name: 'KNIGHT' },
      ranger: { primary: '#29adff', secondary: '#1d2b53', accent: '#00e436', name: 'RANGER' },
      rogue: { primary: '#00e436', secondary: '#003d28', accent: '#29adff', name: 'ROGUE' }
    };

    // Animation state
    let currentSpriteType = 'ranger';
    let currentAnimation = 'idle';
    let frameIndex = 0;
    let animationInterval = null;

    // Canvas setup
    const canvas = document.getElementById('sprite-canvas');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Animation definitions
    const ANIMATIONS = {
      idle: [
        { bodyY: 0, eyeY: 0, armOffset: 0 },
        { bodyY: -1, eyeY: 0, armOffset: 0 }
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
      ],
      think: [
        { bodyY: 0, eyeY: -1, armOffset: 0 },
        { bodyY: -1, eyeY: -1, armOffset: 0 }
      ],
      error: [
        { bodyY: 0, eyeY: 2, armOffset: 0 },
        { bodyY: 2, eyeY: 2, armOffset: 0 }
      ],
      success: [
        { bodyY: -4, eyeY: 0, armOffset: 6 },
        { bodyY: -2, eyeY: 0, armOffset: 8 }
      ]
    };

    function drawSprite() {
      const colors = SPRITE_COLORS[currentSpriteType];
      const frame = ANIMATIONS[currentAnimation][frameIndex];
      const s = 4; // scale

      ctx.clearRect(0, 0, 64, 64);
      ctx.save();
      ctx.translate(32, 32 + frame.bodyY);

      // Body
      ctx.fillStyle = colors.primary;
      ctx.fillRect(-8*s, -10*s, 16*s, 20*s);

      // Head
      ctx.fillRect(-6*s, -18*s, 12*s, 10*s);

      // Eyes
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(-4*s, (-14 + frame.eyeY)*s, 2*s, 2*s);
      ctx.fillRect(2*s, (-14 + frame.eyeY)*s, 2*s, 2*s);

      // Arms
      ctx.fillStyle = colors.secondary;
      ctx.fillRect(-11*s, (-6 + frame.armOffset)*s, 3*s, 8*s);
      ctx.fillRect(8*s, (-6 - frame.armOffset)*s, 3*s, 8*s);

      // Legs
      ctx.fillRect(-6*s, 10*s, 4*s, 6*s);
      ctx.fillRect(2*s, 10*s, 4*s, 6*s);

      // Accessory based on type
      ctx.fillStyle = colors.accent;
      if (currentSpriteType === 'knight') {
        ctx.fillRect(-4*s, -16*s, 8*s, 2*s);
        ctx.fillRect(-14*s, -4*s, 4*s, 8*s);
      } else if (currentSpriteType === 'ranger') {
        ctx.fillStyle = colors.secondary;
        ctx.fillRect(-7*s, -20*s, 14*s, 4*s);
        ctx.fillStyle = colors.accent;
        ctx.fillRect(12*s, -8*s, 2*s, 12*s);
      } else if (currentSpriteType === 'rogue') {
        ctx.fillStyle = colors.secondary;
        ctx.fillRect(-7*s, -19*s, 14*s, 3*s);
        ctx.fillStyle = colors.accent;
        ctx.fillRect(-13*s, 0, 2*s, 8*s);
      }

      // Think bubble
      if (currentAnimation === 'think') {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(8*s, -20*s, 3*s, 3*s);
        ctx.fillRect(12*s, -24*s, 4*s, 4*s);
        ctx.fillRect(18*s, -28*s, 6*s, 6*s);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    function startAnimation(animation) {
      currentAnimation = animation;
      frameIndex = 0;

      if (animationInterval) clearInterval(animationInterval);
      animationInterval = setInterval(() => {
        frameIndex = (frameIndex + 1) % ANIMATIONS[currentAnimation].length;
        drawSprite();
      }, 500);

      drawSprite();
    }

    function setSpriteType(type) {
      currentSpriteType = type;
      document.getElementById('sprite-name').textContent = SPRITE_COLORS[type].name;
      drawSprite();
    }

    // Initialize
    startAnimation('idle');

    // Handle refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'updateConfig':
          updateConfig(message.config);
          break;
        case 'setAnimation':
          startAnimation(message.animation);
          break;
      }
    });

    function updateConfig(config) {
      // Update sprite type based on model
      const spriteType = getSpriteType(config.model);
      setSpriteType(spriteType);

      // Update model info
      document.getElementById('model-name').textContent = config.model || 'Unknown';
      document.getElementById('context-window').textContent = formatContextWindow(config.contextWindow);

      // Update tools
      const toolsGrid = document.getElementById('tools-grid');
      if (config.tools && config.tools.length > 0) {
        toolsGrid.innerHTML = config.tools.map(tool =>
          '<div class="tool-item"><span class="tool-icon">⚔</span>' +
          formatToolName(tool) + '</div>'
        ).join('');
      } else {
        toolsGrid.innerHTML = '<div class="tool-item">No tools</div>';
      }

      // Update permissions
      const permissionsList = document.getElementById('permissions-list');
      if (config.permissions && Object.keys(config.permissions).length > 0) {
        permissionsList.innerHTML = Object.entries(config.permissions)
          .slice(0, 4)
          .map(([key, value]) =>
            '<div class="permission-item">' +
            '<span class="permission-icon">' + getPermissionIcon(value) + '</span>' +
            '<span>' + formatPermissionKey(key) + '</span>' +
            '</div>'
          ).join('');
      } else {
        permissionsList.innerHTML = '<div class="permission-item">Default permissions</div>';
      }

      // Update system prompt
      const promptSection = document.getElementById('system-prompt-section');
      const promptEl = document.getElementById('system-prompt');
      if (config.systemPrompt) {
        promptSection.style.display = 'block';
        promptEl.textContent = config.systemPrompt;
      } else {
        promptSection.style.display = 'none';
      }
    }

    function getSpriteType(model) {
      if (!model) return 'ranger';
      if (model.includes('opus')) return 'knight';
      if (model.includes('haiku')) return 'rogue';
      return 'ranger';
    }

    function formatContextWindow(tokens) {
      if (!tokens) return '--';
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(0) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(0) + 'K';
      return tokens.toString();
    }

    function formatToolName(tool) {
      return tool.replace(/^(mcp__|MCP)/i, '').substring(0, 10);
    }

    function formatPermissionKey(key) {
      return key.replace(/([A-Z])/g, ' $1').trim();
    }

    function getPermissionIcon(level) {
      switch (level) {
        case 'auto': return '✅';
        case 'ask': return '⚠️';
        case 'blocked': return '❌';
        default: return '❓';
      }
    }
  </script>
</body>
</html>`;
  }
}
