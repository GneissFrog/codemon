/**
 * Game View Settings Panel - Sidebar panel for lighting and rendering configuration
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getGameViewPanel } from './GameViewPanel';

export class GameViewSettingsPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.gameViewSettings';
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
      if (message.type === 'updateLighting') {
        getGameViewPanel(this._extensionUri).updateLighting(message.data as {
          enabled?: boolean;
          dayNightCycle?: boolean;
          agentLight?: boolean;
          agentLightRadius?: number;
          agentLightIntensity?: number;
          agentLightColor?: number;
        });
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    ${PIXEL_THEME_CSS}

    .toggle-switch {
      position: relative;
      width: 32px;
      height: 16px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
    }

    .toggle-switch.active {
      background: var(--pixel-accent);
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      background: var(--pixel-fg);
      top: 1px;
      left: 1px;
      transition: left 0.15s;
    }

    .toggle-switch.active::after {
      left: 17px;
    }

    .lighting-section {
      padding: 4px 0;
    }

    .lighting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .lighting-label {
      font-size: 9px;
      color: var(--pixel-fg);
    }

    .lighting-slider-row {
      margin-bottom: 8px;
    }

    .lighting-slider-label {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--pixel-fg);
      margin-bottom: 2px;
    }

    .lighting-slider-value {
      color: var(--pixel-accent);
      font-family: monospace;
    }

    input[type="range"] {
      width: 100%;
      height: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      border-radius: 0;
      outline: none;
      -webkit-appearance: none;
      cursor: pointer;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--pixel-accent);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      background: var(--pixel-fg);
    }

    .color-picker-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .color-picker-row input[type="color"] {
      width: 32px;
      height: 20px;
      border: 1px solid var(--pixel-border);
      background: var(--pixel-bg);
      cursor: pointer;
      padding: 0;
    }

    .color-hex {
      font-size: 9px;
      font-family: monospace;
      color: var(--pixel-muted);
    }

    .lighting-help {
      font-size: 8px;
      color: var(--pixel-muted);
      margin-top: 8px;
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
    }
  </style>
</head>
<body>
  <div class="lighting-section">
    <div class="lighting-row">
      <span class="lighting-label">Enable Lighting</span>
      <div class="toggle-switch active" id="lighting-enabled"></div>
    </div>

    <div class="lighting-row">
      <span class="lighting-label">Day/Night Cycle</span>
      <div class="toggle-switch active" id="lighting-daynight"></div>
    </div>

    <div class="lighting-row">
      <span class="lighting-label">Agent Torch</span>
      <div class="toggle-switch active" id="lighting-agent-torch"></div>
    </div>

    <div class="lighting-slider-row">
      <div class="lighting-slider-label">
        <span>Torch Radius</span>
        <span class="lighting-slider-value" id="torch-radius-value">80</span>
      </div>
      <input type="range" id="torch-radius" min="20" max="200" value="80">
    </div>

    <div class="lighting-slider-row">
      <div class="lighting-slider-label">
        <span>Torch Intensity</span>
        <span class="lighting-slider-value" id="torch-intensity-value">0.8</span>
      </div>
      <input type="range" id="torch-intensity" min="0" max="100" value="80">
    </div>

    <div class="color-picker-row">
      <span class="lighting-label">Torch Color</span>
      <input type="color" id="torch-color" value="#ffaa44">
      <span class="color-hex" id="torch-color-hex">#ffaa44</span>
    </div>

    <div class="lighting-help">
      Normal maps require spritesheets with _n.png suffix (e.g., tiles_n.png). Without normal maps, only point light falloff is visible.
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function hexToNumber(hex) {
      return parseInt(hex.replace('#', ''), 16);
    }

    function setupToggle(toggleId, configKey, defaultValue) {
      const toggle = document.getElementById(toggleId);
      if (!toggle) return;

      if (defaultValue) {
        toggle.classList.add('active');
      } else {
        toggle.classList.remove('active');
      }

      toggle.addEventListener('click', () => {
        const isActive = toggle.classList.toggle('active');
        vscode.postMessage({
          type: 'updateLighting',
          data: { [configKey]: isActive }
        });
      });
    }

    setupToggle('lighting-enabled', 'enabled', true);
    setupToggle('lighting-daynight', 'dayNightCycle', true);
    setupToggle('lighting-agent-torch', 'agentLight', true);

    const torchRadiusSlider = document.getElementById('torch-radius');
    const torchRadiusValue = document.getElementById('torch-radius-value');
    if (torchRadiusSlider) {
      torchRadiusSlider.addEventListener('input', () => {
        const value = parseInt(torchRadiusSlider.value);
        torchRadiusValue.textContent = value;
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightRadius: value }
        });
      });
    }

    const torchIntensitySlider = document.getElementById('torch-intensity');
    const torchIntensityValue = document.getElementById('torch-intensity-value');
    if (torchIntensitySlider) {
      torchIntensitySlider.addEventListener('input', () => {
        const value = parseInt(torchIntensitySlider.value) / 100;
        torchIntensityValue.textContent = value.toFixed(2);
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightIntensity: value }
        });
      });
    }

    const torchColorPicker = document.getElementById('torch-color');
    const torchColorHex = document.getElementById('torch-color-hex');
    if (torchColorPicker) {
      torchColorPicker.addEventListener('input', () => {
        const hex = torchColorPicker.value;
        torchColorHex.textContent = hex;
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightColor: hexToNumber(hex) }
        });
      });
    }
  </script>
</body>
</html>`;
  }
}

// Singleton
let instance: GameViewSettingsPanel | undefined;

export function getGameViewSettingsPanel(extensionUri: vscode.Uri): GameViewSettingsPanel {
  if (!instance) {
    instance = new GameViewSettingsPanel(extensionUri);
  }
  return instance;
}
