/**
 * Type definitions for the webview game rendering layer
 */

// ─── Core Types ──────────────────────────────────────────────────────────

export const TILE_SIZE = 16; // Base tile size in pixels
export const RENDER_SCALE = 1; // Optional downscaling for performance
export const SCALED_TILE = TILE_SIZE * RENDER_SCALE;

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

// ─── Animal Behavior Types ────────────────────────────────────────────────

export type AnimalBehavior = 'wander' | 'graze' | 'forage' | 'swim';

export interface AnimalBehaviorConfig {
  type: string;
  behavior: AnimalBehavior;
  speed: number;           // Movement speed multiplier
  pauseMin: number;        // Minimum pause duration (ms)
  pauseMax: number;        // Maximum pause duration (ms)
  wanderRadius: number;    // How far from current position to wander
  directionChangeChance: number; // 0-1, chance to change direction randomly
  preferredTiles?: TileType[];   // Tiles this animal prefers to stay near
}

export const ANIMAL_BEHAVIORS: Record<string, AnimalBehaviorConfig> = {
  chicken: {
    type: 'chicken',
    behavior: 'wander',
    speed: 1.2,
    pauseMin: 1000,
    pauseMax: 2500,
    wanderRadius: 6,
    directionChangeChance: 0.3,
  },
  cow: {
    type: 'cow',
    behavior: 'graze',
    speed: 0.6,
    pauseMin: 3000,
    pauseMax: 6000,
    wanderRadius: 4,
    directionChangeChance: 0.1,
    preferredTiles: ['grass'],
  },
  pig: {
    type: 'pig',
    behavior: 'forage',
    speed: 0.9,
    pauseMin: 2000,
    pauseMax: 4000,
    wanderRadius: 5,
    directionChangeChance: 0.2,
    preferredTiles: ['tilled', 'dirt'],
  },
  duck: {
    type: 'duck',
    behavior: 'swim',
    speed: 0.8,
    pauseMin: 1500,
    pauseMax: 3500,
    wanderRadius: 5,
    directionChangeChance: 0.15,
    preferredTiles: ['water'],
  },
};

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

// ─── Weather Types ────────────────────────────────────────────────────────

export type WeatherType = 'clear' | 'rain' | 'snow' | 'storm';

export interface WeatherParticle {
  x: number;
  y: number;
  speed: number;
  type: 'rain' | 'snow';
  size: number;
  alpha: number;
  drift?: number; // Horizontal drift for snow
}

export interface WeatherState {
  current: WeatherType;
  particles: WeatherParticle[];
  intensity: number; // 0-1, controls particle count
  windDirection: number; // -1 to 1, affects horizontal movement
  enabled: boolean;
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
