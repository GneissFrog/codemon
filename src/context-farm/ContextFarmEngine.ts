/**
 * Context Farm Engine
 *
 * State machine that tracks files in the agent's context window.
 * Builds state from EventRouter events and emits updates for visualization.
 *
 * Design: Event-sourced state machine for future two-way interaction support.
 */

import { EventEmitter } from 'events';
import {
  FarmPlot,
  ContextFarmState,
  ContextFarmEvent,
  SerializedContextFarmState,
  SerializedFarmPlot,
  BugInstance,
  CropType,
  WeatherType,
  PlotState,
  getCropType,
  estimateTokens,
  calculateFillPercentage,
  isInExitZone,
} from './types';
import { EventRouter, ROUTER_EVENTS } from '../core/event-router';
import { ToolUseEvent, ToolResultEvent, UsageEvent } from '../core/event-types';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 200000;  // Claude Opus context window
const DEFAULT_EXIT_THRESHOLD = 80;  // Warn at 80% capacity

// ─── Engine Class ────────────────────────────────────────────────────────────

export class ContextFarmEngine extends EventEmitter {
  private state: ContextFarmState;
  private eventRouter: EventRouter | null = null;
  /** Store tool inputs by messageId so we can access them in tool_result */
  private pendingToolInputs: Map<string, Record<string, unknown>> = new Map();

  constructor(options?: { maxTokens?: number; exitThreshold?: number }) {
    super();
    this.state = this.createInitialState(options);
  }

  private createInitialState(options?: { maxTokens?: number; exitThreshold?: number }): ContextFarmState {
    return {
      plots: new Map(),
      queueOrder: [],
      totalTokens: 0,
      maxTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      tokensRemaining: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      fillPercentage: 0,
      weather: 'sunny',
      bugs: [],
      turnCount: 0,
      exitZoneThreshold: options?.exitThreshold ?? DEFAULT_EXIT_THRESHOLD,
    };
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  /**
   * Initialize and subscribe to EventRouter
   */
  initialize(eventRouter: EventRouter): void {
    this.eventRouter = eventRouter;

    // Subscribe to relevant events
    eventRouter.on(ROUTER_EVENTS.TOOL_USE, (event: ToolUseEvent) => {
      this.handleToolUse(event);
    });

    eventRouter.on(ROUTER_EVENTS.TOOL_RESULT, (event: ToolResultEvent) => {
      this.handleToolResult(event);
    });

    eventRouter.on(ROUTER_EVENTS.USAGE, (event: UsageEvent) => {
      this.handleUsage(event);
    });
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  /**
   * Handle tool use event - track file access
   */
  private handleToolUse(event: ToolUseEvent): void {
    const { toolName, toolInput, messageId } = event;
    this.state.turnCount++;

    // Store tool input for later use in tool_result
    this.pendingToolInputs.set(messageId, toolInput);

    switch (toolName) {
      case 'Read':
        this.handleReadStart(toolInput.file_path as string, toolInput.offset as number, toolInput.limit as number);
        break;
      case 'Write':
      case 'Edit':
        this.handleWriteStart(toolInput.file_path as string);
        break;
      case 'Bash':
        // Bash doesn't directly touch files, but results might indicate errors
        break;
      case 'Glob':
      case 'Grep':
        // Search operations - could track search patterns
        break;
    }

    // Update plot states to 'idle' for non-active plots
    this.updatePlotStates();
  }

  /**
   * Handle tool result event - update content sizes, track errors
   */
  private handleToolResult(event: ToolResultEvent): void {
    const { toolName, result, isError, messageId } = event;

    // Get stored tool input
    const toolInput = this.pendingToolInputs.get(messageId);
    this.pendingToolInputs.delete(messageId); // Clean up

    switch (toolName) {
      case 'Read':
        this.handleReadResult(result, toolInput, isError);
        break;
      case 'Write':
      case 'Edit':
        this.handleWriteResult(toolInput, isError, event.errorMessage);
        break;
      case 'Bash':
        if (isError) {
          this.handleBashError(result, event.errorMessage);
        } else {
          this.clearBugs();
        }
        break;
    }
  }

  /**
   * Handle usage event - update token totals
   */
  private handleUsage(event: UsageEvent): void {
    // Use cumulative tokens for accurate tracking
    this.state.totalTokens = event.cumulativeTokens.inputTokens;
    this.state.tokensRemaining = Math.max(0, this.state.maxTokens - this.state.totalTokens);
    this.state.fillPercentage = calculateFillPercentage(this.state.totalTokens, this.state.maxTokens);

    this.emitStateUpdate('tokensUpdated', { tokens: this.state.totalTokens });
  }

  // ─── File Tracking ─────────────────────────────────────────────────────────

  /**
   * Handle Read tool start - mark plot as reading
   */
  private handleReadStart(filePath: string, offset?: number, limit?: number): void {
    if (!filePath) return;

    const existing = this.state.plots.get(filePath);
    if (existing) {
      // Re-access: move to front of queue
      existing.state = 'reading';
      existing.lastTouchedAt = this.state.turnCount;
      existing.accessCount++;
      this.moveToFront(filePath);
    }
    // New file will be added when result comes in with content size
  }

  /**
   * Handle Read result - add/update plot with token estimate
   */
  private handleReadResult(result: unknown, toolInput: Record<string, unknown> | undefined, isError: boolean): void {
    const filePath = toolInput?.file_path as string;
    if (!filePath || isError) return;

    // Estimate tokens from result content length
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    const tokenEstimate = estimateTokens(content.length);

    this.addOrUpdatePlot(filePath, tokenEstimate, 'reading');
  }

  /**
   * Handle Write/Edit start - mark plot as editing
   */
  private handleWriteStart(filePath: string): void {
    if (!filePath) return;

    const existing = this.state.plots.get(filePath);
    if (existing) {
      existing.state = 'editing';
      existing.lastTouchedAt = this.state.turnCount;
      existing.accessCount++;
      this.moveToFront(filePath);
    }
  }

  /**
   * Handle Write/Edit result
   */
  private handleWriteResult(toolInput: Record<string, unknown> | undefined, isError: boolean, errorMessage?: string): void {
    const filePath = toolInput?.file_path as string;
    if (!filePath) return;

    if (isError) {
      this.spawnBug(filePath, errorMessage || 'Write failed');
    } else {
      // Estimate tokens from the new content
      const newContent = toolInput?.new_string as string || toolInput?.content as string;
      if (newContent) {
        const tokenEstimate = estimateTokens(newContent.length);
        this.addOrUpdatePlot(filePath, tokenEstimate, 'editing');
      }
    }
  }

  // ─── Plot Management ───────────────────────────────────────────────────────

  /**
   * Add or update a plot in the context
   */
  private addOrUpdatePlot(filePath: string, tokenEstimate: number, state: PlotState): void {
    const existing = this.state.plots.get(filePath);
    const cropType = getCropType(tokenEstimate);

    if (existing) {
      // Update existing plot
      existing.tokenEstimate = tokenEstimate;
      existing.cropType = cropType;
      existing.state = state;
      existing.lastTouchedAt = this.state.turnCount;
      this.moveToFront(filePath);
    } else {
      // Add new plot
      const plot: FarmPlot = {
        filePath,
        addedAt: this.state.turnCount,
        lastTouchedAt: this.state.turnCount,
        tokenEstimate,
        queuePosition: 0,
        state,
        cropType,
        gridPosition: { x: 0, y: 0 }, // Will be calculated during layout
        accessCount: 1,
      };

      this.state.plots.set(filePath, plot);
      this.state.queueOrder.unshift(filePath); // Add to front
      this.recalculateQueuePositions();

      this.emitStateUpdate('plotAdded', { plot });
    }

    // Recalculate total tokens from all plots
    this.recalculateTotalTokens();
  }

  /**
   * Move a file to the front of the queue (re-accessed)
   */
  private moveToFront(filePath: string): void {
    const index = this.state.queueOrder.indexOf(filePath);
    if (index > 0) {
      this.state.queueOrder.splice(index, 1);
      this.state.queueOrder.unshift(filePath);
      this.recalculateQueuePositions();
    }
  }

  /**
   * Recalculate queue positions after order change
   */
  private recalculateQueuePositions(): void {
    this.state.queueOrder.forEach((filePath, index) => {
      const plot = this.state.plots.get(filePath);
      if (plot) {
        plot.queuePosition = index;
      }
    });
  }

  /**
   * Recalculate total tokens from all plots
   */
  private recalculateTotalTokens(): void {
    let total = 0;
    for (const plot of this.state.plots.values()) {
      total += plot.tokenEstimate;
    }
    // Note: This is an estimate. Actual tokens come from USAGE events.
    // We use USAGE events for the authoritative total, but this helps
    // attribute tokens to specific files.
  }

  /**
   * Update all plot states to idle except recently touched
   */
  private updatePlotStates(): void {
    const recentThreshold = this.state.turnCount - 1;
    for (const plot of this.state.plots.values()) {
      if (plot.lastTouchedAt < recentThreshold && plot.state !== 'error') {
        plot.state = 'idle';
      }
    }
  }

  // ─── Bug Management ────────────────────────────────────────────────────────

  /**
   * Spawn a bug on a plot
   */
  private spawnBug(filePath: string, errorMessage: string): void {
    const bug: BugInstance = {
      id: `bug-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      filePath,
      type: 'caterpillar',
      spawnTime: Date.now(),
      errorMessage,
    };

    this.state.bugs.push(bug);

    // Mark plot as error state
    const plot = this.state.plots.get(filePath);
    if (plot) {
      plot.state = 'error';
    }

    this.emitStateUpdate('bugSpawned', { bug });
  }

  /**
   * Handle Bash error - try to parse affected files
   */
  private handleBashError(result: unknown, errorMessage?: string): void {
    const error = errorMessage || '';
    const resultStr = typeof result === 'string' ? result : '';

    // Try to find file paths in the error message
    const filePaths = this.extractFilePaths(error + ' ' + resultStr);

    for (const filePath of filePaths) {
      // Only spawn bug if file is in context
      if (this.state.plots.has(filePath)) {
        this.spawnBug(filePath, error.slice(0, 100));
      }
    }

    // Update weather based on error severity
    this.updateWeather('overcast');
  }

  /**
   * Clear bugs (after successful Bash)
   */
  private clearBugs(): void {
    const hadBugs = this.state.bugs.length > 0;
    this.state.bugs = [];

    // Clear error states from plots
    for (const plot of this.state.plots.values()) {
      if (plot.state === 'error') {
        plot.state = 'idle';
      }
    }

    if (hadBugs) {
      this.updateWeather('sunny');
      this.emitStateUpdate('bugRemoved', { cleared: true });
    }
  }

  /**
   * Extract file paths from error text (simple heuristic)
   */
  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    // Match common file path patterns
    const patterns = [
      /(?:^|\s|["'])(\/[\w\-./]+\.\w+)(?:\s|["']|$)/g,  // Unix paths
      /(?:^|\s|["'])([A-Z]:\\[\w\-./\\]+\.\w+)(?:\s|["']|$)/gi,  // Windows paths
      /(?:^|\s|["'])(\.?\/?[\w\-./]+\.\w+)(?:\s|["']|$)/g,  // Relative paths
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && !paths.includes(match[1])) {
          paths.push(match[1]);
        }
      }
    }

    return paths;
  }

  // ─── Weather Management ────────────────────────────────────────────────────

  /**
   * Update weather state
   */
  private updateWeather(weather: WeatherType): void {
    if (this.state.weather !== weather) {
      this.state.weather = weather;
      this.emitStateUpdate('weatherChanged', { weather });
    }
  }

  // ─── State Serialization ───────────────────────────────────────────────────

  /**
   * Get current state (for external access)
   */
  getState(): ContextFarmState {
    return this.state;
  }

  /**
   * Get serialized state for webview transfer
   */
  getSerializedState(): SerializedContextFarmState {
    const plots: SerializedFarmPlot[] = [];

    for (const plot of this.state.plots.values()) {
      plots.push({
        ...plot,
        inExitZone: isInExitZone(
          plot.queuePosition,
          this.state.queueOrder.length,
          this.state.fillPercentage,
          this.state.exitZoneThreshold
        ),
      });
    }

    return {
      plots,
      queueOrder: this.state.queueOrder,
      totalTokens: this.state.totalTokens,
      maxTokens: this.state.maxTokens,
      tokensRemaining: this.state.tokensRemaining,
      fillPercentage: this.state.fillPercentage,
      weather: this.state.weather,
      bugs: this.state.bugs,
      turnCount: this.state.turnCount,
      exitZoneThreshold: this.state.exitZoneThreshold,
    };
  }

  // ─── Event Emission ────────────────────────────────────────────────────────

  /**
   * Emit state update event
   */
  private emitStateUpdate(type: ContextFarmEvent['type'], payload: unknown): void {
    const event: ContextFarmEvent = {
      type,
      payload,
      state: this.state,
    };
    this.emit('stateUpdate', event);
    this.emit(type, event);
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────

  /**
   * Reset state for new session
   */
  reset(options?: { maxTokens?: number; exitThreshold?: number }): void {
    this.state = this.createInitialState(options);
    this.emitStateUpdate('plotRemoved', { reset: true });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let contextFarmEngine: ContextFarmEngine | undefined;

export function getContextFarmEngine(options?: { maxTokens?: number; exitThreshold?: number }): ContextFarmEngine {
  if (!contextFarmEngine) {
    contextFarmEngine = new ContextFarmEngine(options);
  }
  return contextFarmEngine;
}
