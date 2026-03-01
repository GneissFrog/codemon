/**
 * Budget tracking for token spend
 */

import {
  TokenUsage,
} from './event-types';
import { getSettings, BudgetMode } from './settings';

export interface BudgetStatus {
  used: number;
  limit: number;
  percentage: number;
  mode: BudgetMode;
  displayText: string;
  colorClass: 'green' | 'yellow' | 'red' | 'critical';
}

export class BudgetTracker {
  private dailyUsage: TokenUsage;
  private sessionUsage: TokenUsage;
  private sessionCost: number;
  private dayStartTime: number;
  private settings = getSettings();

  constructor() {
    this.dailyUsage = { inputTokens: 0, outputTokens: 0 };
    this.sessionUsage = { inputTokens: 0, outputTokens: 0 };
    this.sessionCost = 0;
    this.dayStartTime = this.getStartOfDay();
  }

  /**
   * Add usage to the tracker
   */
  addUsage(usage: TokenUsage, cost: number): void {
    this.dailyUsage.inputTokens += usage.inputTokens;
    this.dailyUsage.outputTokens += usage.outputTokens;
    if (usage.cacheReadTokens) {
      this.dailyUsage.cacheReadTokens =
        (this.dailyUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheWriteTokens) {
      this.dailyUsage.cacheWriteTokens =
        (this.dailyUsage.cacheWriteTokens || 0) + usage.cacheWriteTokens;
    }

    this.sessionUsage.inputTokens += usage.inputTokens;
    this.sessionUsage.outputTokens += usage.outputTokens;
    if (usage.cacheReadTokens) {
      this.sessionUsage.cacheReadTokens =
        (this.sessionUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheWriteTokens) {
      this.sessionUsage.cacheWriteTokens =
        (this.sessionUsage.cacheWriteTokens || 0) + usage.cacheWriteTokens;
    }

    this.sessionCost += cost;
  }

  /**
   * Get current budget status
   */
  getStatus(): BudgetStatus {
    const mode = this.settings.budget.mode;
    let used: number;
    let limit: number;
    let displayText: string;

    const totalTokens = this.dailyUsage.inputTokens + this.dailyUsage.outputTokens;

    switch (mode) {
      case 'tokens':
        used = totalTokens;
        limit = this.settings.budget.dailyTokenLimit;
        displayText = `${this.formatTokens(used)} / ${this.formatTokens(limit)} tokens`;
        break;

      case 'dollars':
        used = this.sessionCost;
        limit = this.settings.budget.dailyDollarLimit;
        displayText = `$${used.toFixed(2)} / $${limit.toFixed(2)}`;
        break;

      case 'subscription':
      default:
        used = totalTokens;
        // For subscription, show session usage with estimated time remaining
        limit = 450000; // Approximate 5-hour window token limit
        displayText = `${this.formatTokens(used)} tokens this session`;
        break;
    }

    const percentage = (used / limit) * 100;
    const colorClass = this.getColorClass(percentage);

    return {
      used,
      limit,
      percentage,
      mode,
      displayText,
      colorClass,
    };
  }

  /**
   * Get color class based on percentage
   */
  private getColorClass(percentage: number): BudgetStatus['colorClass'] {
    if (percentage >= 95) return 'critical';
    if (percentage >= 80) return 'red';
    if (percentage >= 60) return 'yellow';
    return 'green';
  }

  /**
   * Reset session usage
   */
  resetSession(): void {
    this.sessionUsage = { inputTokens: 0, outputTokens: 0 };
    this.sessionCost = 0;
  }

  /**
   * Reset daily usage (called at midnight)
   */
  resetDaily(): void {
    this.dailyUsage = { inputTokens: 0, outputTokens: 0 };
    this.dayStartTime = this.getStartOfDay();
  }

  /**
   * Get start of current day (midnight)
   */
  private getStartOfDay(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
   * Get session usage
   */
  getSessionUsage(): { tokens: TokenUsage; cost: number } {
    return {
      tokens: { ...this.sessionUsage },
      cost: this.sessionCost,
    };
  }

  /**
   * Update settings reference
   */
  updateSettings(): void {
    this.settings = getSettings();
  }
}

// Singleton instance
let budgetTracker: BudgetTracker | undefined;

export function getBudgetTracker(): BudgetTracker {
  if (!budgetTracker) {
    budgetTracker = new BudgetTracker();
  }
  return budgetTracker;
}
