/**
 * Context Farm Types
 *
 * Types for visualizing the agent's context window as a farm ecosystem.
 * Files in context are crops, sized by token impact, ordered by queue position.
 */

// ─── Crop Types ─────────────────────────────────────────────────────────────

/** Crop types based on token size */
export type CropType = 'radish' | 'corn' | 'pumpkin' | 'giant-pumpkin';

/** Token thresholds for crop sizing */
export const CROP_THRESHOLDS: Record<CropType, { minTokens: number; maxTokens: number; gridSize: number }> = {
  'radish': { minTokens: 0, maxTokens: 500, gridSize: 1 },
  'corn': { minTokens: 500, maxTokens: 2000, gridSize: 2 },
  'pumpkin': { minTokens: 2000, maxTokens: 8000, gridSize: 3 },
  'giant-pumpkin': { minTokens: 8000, maxTokens: Infinity, gridSize: 4 },
};

/** Determine crop type from token estimate */
export function getCropType(tokenEstimate: number): CropType {
  if (tokenEstimate < 500) return 'radish';
  if (tokenEstimate < 2000) return 'corn';
  if (tokenEstimate < 8000) return 'pumpkin';
  return 'giant-pumpkin';
}

// ─── Plot Types ──────────────────────────────────────────────────────────────

/** State of a file in the context window */
export type PlotState = 'idle' | 'reading' | 'editing' | 'error';

/** A single file represented as a farm plot */
export interface FarmPlot {
  /** Full file path (key) */
  filePath: string;
  /** Turn number when added to context */
  addedAt: number;
  /** Turn number of most recent Read/Edit */
  lastTouchedAt: number;
  /** Estimated token count (~chars/4) */
  tokenEstimate: number;
  /** Position in queue (0 = newest, higher = closer to eviction) */
  queuePosition: number;
  /** Current activity state */
  state: PlotState;
  /** Crop type based on token estimate */
  cropType: CropType;
  /** Grid position for rendering */
  gridPosition: { x: number; y: number };
  /** Number of times this file has been accessed */
  accessCount: number;
}

// ─── Bug Types ───────────────────────────────────────────────────────────────

/** Bug types for error visualization */
export type BugType = 'caterpillar' | 'beetle' | 'aphid';

/** A bug representing an error on a plot */
export interface BugInstance {
  /** Unique bug ID */
  id: string;
  /** File path where bug is spawned */
  filePath: string;
  /** Bug visual type */
  type: BugType;
  /** Timestamp when spawned */
  spawnTime: number;
  /** Error message (for tooltip) */
  errorMessage?: string;
}

// ─── Weather Types ───────────────────────────────────────────────────────────

export type WeatherType = 'sunny' | 'overcast' | 'storm';

// ─── State Types ─────────────────────────────────────────────────────────────

/** Complete state of the context farm */
export interface ContextFarmState {
  /** All plots currently in context, keyed by filePath */
  plots: Map<string, FarmPlot>;
  /** Ordered file paths, [0] = newest, last = oldest (next to evict) */
  queueOrder: string[];
  /** Total estimated tokens in context */
  totalTokens: number;
  /** Maximum context window size (200k for Opus, etc.) */
  maxTokens: number;
  /** Tokens remaining until eviction pressure */
  tokensRemaining: number;
  /** Percentage of context used (0-100) */
  fillPercentage: number;
  /** Current weather based on test health */
  weather: WeatherType;
  /** Active bugs on plots */
  bugs: BugInstance[];
  /** Current turn number (increments per tool use) */
  turnCount: number;
  /** Threshold percentage for exit zone warning */
  exitZoneThreshold: number;
}

/** Event emitted when state changes */
export interface ContextFarmEvent {
  type: 'plotAdded' | 'plotUpdated' | 'plotRemoved' | 'tokensUpdated' | 'bugSpawned' | 'bugRemoved' | 'weatherChanged';
  payload: unknown;
  state: ContextFarmState;
}

// ─── Serialized State (for webview transfer) ─────────────────────────────────

/** Serializable state for sending to webview */
export interface SerializedContextFarmState {
  plots: SerializedFarmPlot[];
  queueOrder: string[];
  totalTokens: number;
  maxTokens: number;
  tokensRemaining: number;
  fillPercentage: number;
  weather: WeatherType;
  bugs: BugInstance[];
  turnCount: number;
  exitZoneThreshold: number;
}

/** Serializable plot for webview transfer */
export interface SerializedFarmPlot {
  filePath: string;
  addedAt: number;
  lastTouchedAt: number;
  tokenEstimate: number;
  queuePosition: number;
  state: PlotState;
  cropType: CropType;
  gridPosition: { x: number; y: number };
  accessCount: number;
  /** Whether this plot is in the exit zone (will be evicted next) */
  inExitZone: boolean;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/** Estimate tokens from content length */
export function estimateTokens(contentLength: number): number {
  // Approximate: 1 token ≈ 4 characters
  return Math.ceil(contentLength / 4);
}

/** Calculate fill percentage */
export function calculateFillPercentage(totalTokens: number, maxTokens: number): number {
  return Math.min(100, Math.round((totalTokens / maxTokens) * 100));
}

/** Check if a plot is in the exit zone */
export function isInExitZone(queuePosition: number, queueLength: number, fillPercentage: number, threshold: number): boolean {
  // Exit zone is the last 20% of the queue when above threshold
  if (fillPercentage < threshold) return false;
  const exitZoneSize = Math.ceil(queueLength * 0.2);
  return queuePosition >= queueLength - exitZoneSize;
}
