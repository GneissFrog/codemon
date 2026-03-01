/**
 * Utility functions for webview panels
 */

import * as vscode from 'vscode';

/**
 * Get the URI for a webview resource
 */
export function getUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pathList: string[]
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, ...pathList)
  );
}

/**
 * Get nonce for CSP
 */
export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Common CSS styles for pixel art theme
 */
export function getPixelThemeCss(): string {
  return `
    :root {
      --pixel-bg: #1a1c2c;
      --pixel-bg-light: #2a2d3e;
      --pixel-fg: #f4f4f4;
      --pixel-muted: #8a8a8a;
      --pixel-accent: #29adff;
      --pixel-success: #00e436;
      --pixel-warning: #ffec27;
      --pixel-error: #ff004d;
      --pixel-border: #5a5d6e;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      background: var(--pixel-bg);
      color: var(--pixel-fg);
      padding: 8px;
      line-height: 1.4;
    }

    .pixel-border {
      border: 2px solid var(--pixel-border);
      border-radius: 0;
      box-shadow:
        inset -2px -2px 0 0 #0a0c14,
        inset 2px 2px 0 0 #3a3d4e;
    }

    .label {
      color: var(--pixel-muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .value {
      color: var(--pixel-fg);
      font-weight: bold;
    }

    .accent {
      color: var(--pixel-accent);
    }

    .success {
      color: var(--pixel-success);
    }

    .warning {
      color: var(--pixel-warning);
    }

    .error {
      color: var(--pixel-error);
    }
  `;
}
