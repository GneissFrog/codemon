/**
 * Type definitions for the webview game rendering layer
 */

// ─── Core Types ──────────────────────────────────────────────────────────

export const TILE_SIZE = 8;

export type TileType = 'grass' | 'dirt' | 'tilled' | 'water' | 'path' | 'fence' | 'fence-gate' | 'decoration';

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  spriteId: string;
  variant: number;
  layer: number;
}

export interface Plot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  filePath: string;
  isDirectory: boolean;
  cropType: string;
  growthStage: number;
  activity: number;
  isActive: boolean;
  cropSpriteId: string;
}

// ─── Agent Types ──────────────────────────────────────────────────────────

export type AgentAnimation = 'idle' | 'walk' | 'hoe' | 'water' | 'plant' | 'harvest';
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface AgentState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  filePath: string | null;
  animation: AgentAnimation;
  frameIndex: number;
  type: string;
  direction: Direction;
}

export interface SubagentState {
  id: string;
  type: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  frameIndex: number;
  direction: Direction;
  pauseUntil: number;
  path: { x: number; y: number }[];
}

// ─── Particle & Effect Types ──────────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  startTime: number;
  duration: number;
  color: [number, number, number];
  size: number;
}

export interface GrowthEffect {
  x: number;
  y: number;
  startTime: number;
  stage: number;
}

// ─── Animation System Types ───────────────────────────────────────────────

export interface TileAnimation {
  frames: string[];
  fps: number;
  currentFrame: number;
  timer: number;
  loop: boolean;
}

// ─── Asset Types ───────────────────────────────────────────────────────────

export interface SpriteDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpritesheetData {
  imageUrl: string;
  sprites: Record<string, SpriteDef>;
}

export interface WebviewAssetData {
  spriteMappings: Record<string, string>;
  spritesheets: Record<string, SpritesheetData>;
}

// ─── Game State ────────────────────────────────────────────────────────────

export interface GameState {
  tiles: Tile[];
  plots: Plot[];
  worldWidth: number;
  worldHeight: number;
  agent: AgentState;
  subagents: SubagentState[];
  particles: Particle[];
  growthEffects: GrowthEffect[];
  config: {
    agentType: string;
    modelName: string;
  } | null;
  budget: {
    tokens: number;
    cost: number;
    percentage: number;
  } | null;
  sessionTokens: number;
  sessionCost: number;
  activities: ActivityEntry[];
}

export interface ActivityEntry {
  type: string;
  detail: string;
  tokens?: number;
  timestamp?: number;
}

// ─── Renderer Interface ────────────────────────────────────────────────────

/**
 * Abstract renderer interface for swapping rendering backends
 */
export interface Renderer {
  /** Initialize the renderer with a canvas element */
  init(canvas: HTMLCanvasElement): Promise<void>;

  /** Load spritesheets from asset data */
  loadSpritesheets(assets: WebviewAssetData): Promise<void>;

  /** Clear the render surface */
  clear(): void;

  /** Begin a new frame */
  beginFrame(): void;

  /** End the current frame */
  endFrame(): void;

  /** Draw a sprite by ID at position */
  drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean;

  /** Draw a rectangle (for overlays, highlights) */
  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void;

  /** Draw text label */
  drawText(text: string, x: number, y: number, color: string, fontSize?: number): void;

  /** Set camera transform for world rendering */
  setTransform(panX: number, panY: number, zoom: number): void;

  /** Handle resize */
  resize(width: number, height: number): void;

  /** Clean up resources */
  dispose(): void;
}

// ─── Camera Types ──────────────────────────────────────────────────────────

export interface CameraState {
  panX: number;
  panY: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

// ─── Wander AI Types ───────────────────────────────────────────────────────

export interface WanderState {
  enabled: boolean;
  idleTimeout: number;
  pauseMin: number;
  pauseMax: number;
  radius: number;
  lastActivityTime: number;
  isPaused: boolean;
  pauseUntil: number;
  isWandering: boolean;
}

// ─── Initialization Options ────────────────────────────────────────────────

export interface InitOptions {
  canvas: HTMLCanvasElement;
  hudCanvas: HTMLCanvasElement;
  assets: WebviewAssetData;
  initialState?: Partial<GameState>;
}

// ─── Viewport Types ─────────────────────────────────────────────────────────

export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ─── Renderer Interface (Extended) ──────────────────────────────────────────

/**
 * Extended renderer interface with optimized tile rendering
 */
export interface OptimizedRenderer extends Renderer {
  /** Set all tiles at once (for static layer caching) */
  setTiles(tiles: Tile[]): void;

  /** Update a single tile */
  updateTile(tile: Tile): void;

  /** Clear dynamic objects (agents, particles, effects) */
  clearDynamicObjects(): void;

  /** Set viewport bounds for culling */
  setViewportBounds(bounds: ViewportBounds): void;

  /** Check if renderer is ready */
  isReady(): boolean;

  /** Get current viewport bounds */
  getViewportBounds(): ViewportBounds;
}
