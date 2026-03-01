/**
 * Budget Status Bar - Shows token spend in VS Code status bar
 */

import * as vscode from 'vscode';
import { getBudgetTracker, BudgetStatus } from '../core/budget-tracker';
import { getSettings, onSettingsChanged } from '../core/settings';

export class BudgetStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private budgetTracker = getBudgetTracker();

  constructor() {
    // Create status bar item on the right side
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.statusBarItem.command = 'codemon.showBudgetDetails';
    this.updateDisplay();
    this.statusBarItem.show();
  }

  /**
   * Update the status bar display
   */
  updateDisplay(): void {
    const status = this.budgetTracker.getStatus();
    this.statusBarItem.text = this.formatText(status);
    this.statusBarItem.tooltip = this.formatTooltip(status);
    this.statusBarItem.backgroundColor = this.getBackgroundColor(status);
  }

  /**
   * Format the status bar text
   */
  private formatText(status: BudgetStatus): string {
    const icon = this.getIcon(status);

    switch (status.mode) {
      case 'tokens':
        return `${icon} ${this.formatTokens(status.used)} / ${this.formatTokens(status.limit)}`;

      case 'dollars':
        return `${icon} $${status.used.toFixed(2)} / $${status.limit.toFixed(0)}`;

      case 'subscription':
      default:
        return `${icon} ${this.formatTokens(status.used)} tokens`;
    }
  }

  /**
   * Format the tooltip
   */
  private formatTooltip(status: BudgetStatus): string {
    const session = this.budgetTracker.getSessionUsage();
    const totalTokens = session.tokens.inputTokens + session.tokens.outputTokens;

    let tooltip = `Session: ${this.formatTokens(totalTokens)} tokens ($${session.cost.toFixed(4)})\n`;
    tooltip += `Daily: ${status.displayText}\n`;
    tooltip += `Mode: ${status.mode}\n\n`;
    tooltip += `Click for details`;

    return tooltip;
  }

  /**
   * Get the appropriate icon
   */
  private getIcon(status: BudgetStatus): string {
    if (status.percentage >= 95) return '🔴';
    if (status.percentage >= 80) return '🟠';
    if (status.percentage >= 60) return '🟡';
    return '⚡';
  }

  /**
   * Get background color for warnings
   */
  private getBackgroundColor(status: BudgetStatus): vscode.ThemeColor | undefined {
    if (status.percentage >= 95) {
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    if (status.percentage >= 80) {
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    return undefined;
  }

  /**
   * Format tokens for display
   */
  private formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  }

  /**
   * Dispose the status bar item
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}

// Singleton instance
let budgetStatusBar: BudgetStatusBar | undefined;

export function getBudgetStatusBar(): BudgetStatusBar {
  if (!budgetStatusBar) {
    budgetStatusBar = new BudgetStatusBar();
  }
  return budgetStatusBar;
}
