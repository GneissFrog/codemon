/**
 * Token cost calculator
 * Computes costs from usage data using model pricing
 */

import { TokenUsage, CostBreakdown, ClaudeModel } from './event-types';

// Pricing per 1M tokens (in USD)
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

// Known model pricing (as of early 2025)
const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  'claude-sonnet-4-6': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-sonnet-4-5': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-haiku-4-5': {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1,
  },
};

// Default pricing for unknown models (use Sonnet as baseline)
const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 3,
  outputPer1M: 15,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
};

export class TokenCalculator {
  private customPricing: Record<string, ModelPricing> = {};

  /**
   * Set custom pricing for a model (overrides defaults)
   */
  setPricing(model: string, pricing: Partial<ModelPricing>): void {
    this.customPricing[model] = {
      ...this.getPricing(model),
      ...pricing,
    };
  }

  /**
   * Get pricing for a model
   */
  private getPricing(model: string): ModelPricing {
    return (
      this.customPricing[model] ||
      PRICING[model] ||
      DEFAULT_PRICING
    );
  }

  /**
   * Calculate cost from token usage
   */
  calculateCost(usage: TokenUsage, model: ClaudeModel): CostBreakdown {
    const pricing = this.getPricing(model);

    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
    const cacheReadCost = usage.cacheReadTokens
      ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M
      : 0;
    const cacheWriteCost = usage.cacheWriteTokens
      ? (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M
      : 0;

    const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

    return {
      inputCost,
      outputCost,
      cacheReadCost: cacheReadCost > 0 ? cacheReadCost : undefined,
      cacheWriteCost: cacheWriteCost > 0 ? cacheWriteCost : undefined,
      totalCost,
    };
  }

  /**
   * Format cost for display
   */
  formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    } else if (cost < 1) {
      return `$${cost.toFixed(3)}`;
    } else {
      return `$${cost.toFixed(2)}`;
    }
  }

  /**
   * Format token count for display
   */
  formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  }

  /**
   * Add two token usages together
   */
  addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
      cacheWriteTokens: (a.cacheWriteTokens || 0) + (b.cacheWriteTokens || 0),
    };
  }

  /**
   * Get available models with pricing
   */
  getAvailableModels(): string[] {
    return Object.keys(PRICING);
  }
}

// Singleton instance
let tokenCalculator: TokenCalculator | undefined;

export function getTokenCalculator(): TokenCalculator {
  if (!tokenCalculator) {
    tokenCalculator = new TokenCalculator();
  }
  return tokenCalculator;
}
