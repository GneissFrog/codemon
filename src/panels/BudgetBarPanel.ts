/**
 * Budget Bar Panel - Expanded view with segmented bar and details
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getBudgetTracker, BudgetStatus } from '../core/budget-tracker';
import { getSettings } from '../core/settings';

export class BudgetBarPanel {
  public static readonly viewType = 'codemon.budgetBar';
  private _panel: vscode.WebviewPanel | undefined;
  private _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public show(): void {
    if (this._panel) {
      this._panel.reveal();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      BudgetBarPanel.viewType,
      'CodeMon Budget',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
      }
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => {
      this._panel = undefined;
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];
    }, null, this._disposables);

    // Update with current data
    this.updateDisplay();
  }

  public updateDisplay(): void {
    if (!this._panel) return;

    const budgetTracker = getBudgetTracker();
    const status = budgetTracker.getStatus();
    const session = budgetTracker.getSessionUsage();

    this._panel.webview.postMessage({
      type: 'update',
      status,
      session: {
        tokens: session.tokens.inputTokens + session.tokens.outputTokens,
        cost: session.cost,
      },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';">
  <title>Budget</title>
  <style>
    ${PIXEL_THEME_CSS}

    .budget-panel {
      padding: 16px;
    }

    .budget-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .budget-header h1 {
      font-size: 12px;
      color: var(--pixel-accent);
      margin-bottom: 8px;
    }

    .budget-total {
      font-size: 16px;
      color: var(--pixel-fg);
    }

    .budget-section {
      margin-bottom: 24px;
      padding: 12px;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
    }

    .budget-section h2 {
      font-size: 8px;
      color: var(--pixel-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }

    .budget-bar-container {
      margin-bottom: 12px;
    }

    .budget-bar {
      height: 24px;
      background: var(--pixel-bg);
      border: 2px solid var(--pixel-border);
      box-shadow: inset 2px 2px 0 0 var(--pixel-shadow);
      position: relative;
      overflow: hidden;
    }

    .budget-bar-fill {
      height: 100%;
      transition: width 0.3s ease-out;
      position: relative;
    }

    .budget-bar-fill.green { background: var(--pixel-success); }
    .budget-bar-fill.yellow { background: var(--pixel-warning); }
    .budget-bar-fill.red { background: var(--pixel-error); }
    .budget-bar-fill.critical {
      background: var(--pixel-error);
      animation: pulse 0.25s ease-in-out infinite;
    }

    .budget-bar-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 8px;
      color: var(--pixel-bg);
      text-shadow: 1px 1px 0 var(--pixel-fg);
      z-index: 1;
    }

    .budget-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .stat-item {
      padding: 8px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
    }

    .stat-label {
      font-size: 8px;
      color: var(--pixel-muted);
      margin-bottom: 4px;
    }

    .stat-value {
      font-size: 12px;
      color: var(--pixel-accent);
    }

    .stat-value.warning { color: var(--pixel-warning); }
    .stat-value.danger { color: var(--pixel-error); }

    .segment-bar {
      display: flex;
      height: 16px;
      background: var(--pixel-bg);
      border: 2px solid var(--pixel-border);
      overflow: hidden;
    }

    .segment {
      height: 100%;
      transition: width 0.3s ease-out;
    }

    .segment.input { background: var(--pixel-accent); }
    .segment.output { background: var(--pixel-purple); }
    .segment.cache { background: var(--pixel-success); }

    .legend {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      font-size: 8px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-color {
      width: 12px;
      height: 12px;
      border: 1px solid var(--pixel-border);
    }
  </style>
</head>
<body>
  <div class="budget-panel">
    <div class="budget-header">
      <h1>⚡ TOKEN BUDGET ⚡</h1>
      <div class="budget-total" id="budget-total">0 / 500K tokens</div>
    </div>

    <div class="budget-section">
      <h2>Daily Usage</h2>
      <div class="budget-bar-container">
        <div class="budget-bar">
          <div class="budget-bar-fill green" id="daily-bar" style="width: 0%"></div>
          <div class="budget-bar-text" id="daily-percent">0%</div>
        </div>
      </div>
      <div class="budget-stats">
        <div class="stat-item">
          <div class="stat-label">Used</div>
          <div class="stat-value" id="used-tokens">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Remaining</div>
          <div class="stat-value" id="remaining-tokens">500K</div>
        </div>
      </div>
    </div>

    <div class="budget-section">
      <h2>Session Breakdown</h2>
      <div class="segment-bar" id="segment-bar">
        <div class="segment input" style="width: 33%"></div>
        <div class="segment output" style="width: 33%"></div>
        <div class="segment cache" style="width: 34%"></div>
      </div>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color" style="background: var(--pixel-accent)"></div>
          <span>Input</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: var(--pixel-purple)"></div>
          <span>Output</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: var(--pixel-success)"></div>
          <span>Cache</span>
        </div>
      </div>
      <div class="budget-stats" style="margin-top: 12px;">
        <div class="stat-item">
          <div class="stat-label">Session Tokens</div>
          <div class="stat-value" id="session-tokens">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Session Cost</div>
          <div class="stat-value" id="session-cost">$0.00</div>
        </div>
      </div>
    </div>

    <div class="budget-section">
      <h2>Mode</h2>
      <div class="stat-value" id="budget-mode">Subscription</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        updateDisplay(message.status, message.session);
      }
    });

    function updateDisplay(status, session) {
      // Update total
      document.getElementById('budget-total').textContent = status.displayText;

      // Update daily bar
      const bar = document.getElementById('daily-bar');
      const percent = Math.min(status.percentage, 100);
      bar.style.width = percent + '%';
      bar.className = 'budget-bar-fill ' + status.colorClass;

      document.getElementById('daily-percent').textContent = percent.toFixed(1) + '%';

      // Update stats
      document.getElementById('used-tokens').textContent = formatTokens(status.used);
      document.getElementById('remaining-tokens').textContent = formatTokens(status.limit - status.used);

      // Update session
      document.getElementById('session-tokens').textContent = formatTokens(session.tokens);
      document.getElementById('session-cost').textContent = '$' + session.cost.toFixed(4);

      // Update mode
      document.getElementById('budget-mode').textContent =
        status.mode.charAt(0).toUpperCase() + status.mode.slice(1);

      // Color warnings for remaining
      const remaining = document.getElementById('remaining-tokens');
      if (status.percentage >= 80) {
        remaining.className = 'stat-value danger';
      } else if (status.percentage >= 60) {
        remaining.className = 'stat-value warning';
      } else {
        remaining.className = 'stat-value';
      }
    }

    function formatTokens(tokens) {
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
      return tokens.toString();
    }
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
let budgetBarPanel: BudgetBarPanel | undefined;

export function getBudgetBarPanel(extensionUri: vscode.Uri): BudgetBarPanel {
  if (!budgetBarPanel) {
    budgetBarPanel = new BudgetBarPanel(extensionUri);
  }
  return budgetBarPanel;
}
