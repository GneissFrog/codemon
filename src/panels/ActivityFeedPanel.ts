/**
 * Activity Feed Panel - Shows live tool invocations with animations
 */

import * as vscode from 'vscode';
import { getNonce, getPixelThemeCss } from './panel-utils';
import { ActivityEntry } from '../core/event-types';
import { getTokenCalculator } from '../core/token-calculator';

export class ActivityFeedPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.activityFeed';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _entries: ActivityEntry[] = [];
  private _maxEntries = 100;

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

    // Replay existing entries
    if (this._entries.length > 0) {
      for (const entry of this._entries) {
        webviewView.webview.postMessage({
          type: 'addEntry',
          entry,
        });
      }
    }
  }

  /**
   * Add a new activity entry
   */
  public addEntry(entry: ActivityEntry): void {
    // Keep only recent entries
    this._entries.push(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries.shift();
    }

    if (this._view) {
      this._view.webview.postMessage({
        type: 'addEntry',
        entry,
      });
    }
  }

  /**
   * Clear all entries
   */
  public clear(): void {
    this._entries = [];
    if (this._view) {
      this._view.webview.postMessage({
        type: 'clear',
      });
    }
  }

  /**
   * Update session total
   */
  public updateTotal(tokens: number, cost: number): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateTotal',
        tokens,
        cost,
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Activity</title>
  <style>
    ${getPixelThemeCss()}

    .activity-feed {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .feed-header {
      padding: 8px;
      background: var(--pixel-bg-light);
      border-bottom: 2px solid var(--pixel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .feed-header h2 {
      font-size: 12px;
      color: var(--pixel-accent);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .feed-content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .entry {
      padding: 8px;
      margin-bottom: 8px;
      background: var(--pixel-bg-light);
      border-left: 3px solid var(--pixel-border);
      animation: slideIn 0.3s ease-out;
    }

    .entry.highlight {
      border-left-color: var(--pixel-accent);
    }

    .entry.error {
      border-left-color: var(--pixel-error);
      background: rgba(255, 0, 77, 0.1);
    }

    .entry.success {
      border-left-color: var(--pixel-success);
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .entry-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .entry-icon {
      font-size: 14px;
    }

    .entry-label {
      font-weight: bold;
      font-size: 11px;
    }

    .entry-detail {
      font-size: 10px;
      color: var(--pixel-muted);
      word-break: break-all;
      padding-left: 22px;
    }

    .entry-meta {
      display: flex;
      justify-content: space-between;
      padding-left: 22px;
      margin-top: 4px;
      font-size: 10px;
      color: var(--pixel-muted);
    }

    .entry-tokens {
      color: var(--pixel-accent);
    }

    .entry-cost {
      color: var(--pixel-warning);
    }

    .entry-error {
      color: var(--pixel-error);
      font-size: 10px;
      padding-left: 22px;
      margin-top: 4px;
    }

    .session-total {
      padding: 12px 8px;
      background: var(--pixel-bg-light);
      border-top: 2px solid var(--pixel-border);
      text-align: center;
      font-size: 11px;
    }

    .session-total .tokens {
      color: var(--pixel-accent);
      font-weight: bold;
    }

    .session-total .cost {
      color: var(--pixel-warning);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--pixel-muted);
      text-align: center;
      padding: 20px;
    }

    .empty-state-icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="activity-feed">
    <div class="feed-header">
      <h2>Activity</h2>
    </div>

    <div class="feed-content" id="feed-content">
      <div class="empty-state" id="empty-state">
        <div class="empty-state-icon">🎮</div>
        <div>Waiting for Claude Code activity...</div>
        <div style="font-size: 10px; margin-top: 8px;">
          Start a session to see tool invocations
        </div>
      </div>
    </div>

    <div class="session-total" id="session-total" style="display: none;">
      Session: <span class="tokens" id="total-tokens">0</span> tokens
      (<span class="cost" id="total-cost">$0.00</span>)
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const feedContent = document.getElementById('feed-content');
    const emptyState = document.getElementById('empty-state');
    const sessionTotal = document.getElementById('session-total');
    const totalTokens = document.getElementById('total-tokens');
    const totalCost = document.getElementById('total-cost');

    let entryCount = 0;
    let sessionTokens = 0;
    let sessionCostValue = 0;

    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'addEntry':
          addEntry(message.entry);
          break;
        case 'clear':
          clearFeed();
          break;
        case 'updateTotal':
          updateTotal(message.tokens, message.cost);
          break;
      }
    });

    function addEntry(entry) {
      // Hide empty state
      if (emptyState) {
        emptyState.style.display = 'none';
      }

      // Create entry element
      const el = document.createElement('div');
      el.className = 'entry highlight';

      if (entry.isError) {
        el.classList.add('error');
      } else if (entry.label === 'Success') {
        el.classList.add('success');
      }

      // Build entry HTML
      let html =
        '<div class="entry-header">' +
        '<span class="entry-icon">' + escapeHtml(entry.icon) + '</span>' +
        '<span class="entry-label">' + escapeHtml(entry.label) + '</span>' +
        '</div>';

      if (entry.detail) {
        html += '<div class="entry-detail">' + escapeHtml(entry.detail) + '</div>';
      }

      if (entry.errorMessage) {
        html += '<div class="entry-error">❌ ' + escapeHtml(entry.errorMessage) + '</div>';
      }

      if (entry.tokens || entry.cost) {
        html += '<div class="entry-meta">';
        if (entry.tokens) {
          html += '<span class="entry-tokens">' + formatTokens(entry.tokens) + '</span>';
        }
        if (entry.cost) {
          html += '<span class="entry-cost">$' + entry.cost.toFixed(4) + '</span>';
        }
        html += '</div>';
      }

      el.innerHTML = html;

      // Add to feed
      feedContent.appendChild(el);

      // Remove highlight after animation
      setTimeout(() => {
        el.classList.remove('highlight');
      }, 1000);

      // Auto-scroll to bottom
      feedContent.scrollTop = feedContent.scrollHeight;

      // Track entry count
      entryCount++;
    }

    function clearFeed() {
      feedContent.innerHTML = '';
      if (emptyState) {
        const newEmpty = document.createElement('div');
        newEmpty.className = 'empty-state';
        newEmpty.id = 'empty-state';
        newEmpty.innerHTML =
          '<div class="empty-state-icon">🎮</div>' +
          '<div>Waiting for Claude Code activity...</div>';
        feedContent.appendChild(newEmpty);
      }
      entryCount = 0;
      sessionTokens = 0;
      sessionCostValue = 0;
      sessionTotal.style.display = 'none';
    }

    function updateTotal(tokens, cost) {
      sessionTokens = tokens;
      sessionCostValue = cost;
      totalTokens.textContent = formatTokens(tokens);
      totalCost.textContent = '$' + cost.toFixed(2);
      sessionTotal.style.display = 'block';
    }

    function formatTokens(tokens) {
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
      return tokens.toString();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}
