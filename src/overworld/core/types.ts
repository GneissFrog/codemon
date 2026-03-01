/**
 * Asset System Type Definitions
 */

// ─── Spritesheet Types ─────────────────────────────────────────────────────

export interface SpriteDef {
  x: number;
  y: number;
  w: number;
  h: number;
  grid?: { col: number; row: number };
}

export interface SpritesheetDef {
  image: string;
  dimensions: { width: number; height: number };
  frameSize: { width: number; height: number };
  grid: { cols: number; rows: number };
  sprites: Record<string, SpriteDef | { comment: string }>;
}

export interface AnimationDef {
  frames: string[];
  fps: number;
  loop: boolean;
}

export interface CropDef {
  growthStages: string[];
  growthRate: 'activity' | 'tokens' | 'time';
}

export interface SpriteManifest {
  version: number;
  description: string;
  tileSize: number;
  spritesheets: Record<string, SpritesheetDef>;
  animations: Record<string, AnimationDef>;
  crops: Record<string, CropDef>;
}

// ─── Runtime Types ─────────────────────────────────────────────────────────

export interface LoadedSprite {
  id: string;
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoadedSpritesheet {
  name: string;
  image: unknown | null;  // ImageBitmap in webview, null in extension host
  imageUrl: string;  // Data URL for webview transfer
  sprites: Map<string, LoadedSprite>;
}

export interface AnimationState {
  animationId: string;
  frames: string[];
  currentFrame: number;
  frameTime: number;  // ms per frame
  timeAccumulator: number;
  loop: boolean;
  playing: boolean;
}

// ─── World Types ───────────────────────────────────────────────────────────

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  spriteId: string;
  variant: number;
  layer: number;  // 0=ground, 1=terrain, 2=crops/objects
}

export type TileType =
  | 'grass'
  | 'dirt'
  | 'tilled'
  | 'water'
  | 'path'
  | 'fence'
  | 'fence-gate'
  | 'decoration';

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
  cropSpriteId: string;  // Pre-computed sprite for this plot's crop
}

// ─── Serialization Types ──────────────────────────────────────────────────

export interface SerializedWorldMap {
  tiles: Tile[];
  plots: Plot[];
  width: number;
  height: number;
}

// ─── Entity Types ──────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  type: 'claude' | 'subagent' | 'particle';
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
  spriteId: string;
  animation: AnimationState | null;
  direction: 'up' | 'down' | 'left' | 'right';
  state: 'idle' | 'walking' | 'acting';
}

export interface ClaudeEntity extends Entity {
  type: 'claude';
  currentFile: string | null;
  actionType: 'read' | 'write' | 'search' | null;
}

export interface SubAgentEntity extends Entity {
  type: 'subagent';
  agentType: 'chicken' | 'cow' | 'pig' | 'duck';
  behavior: 'wander' | 'follow' | 'graze';
  parentAgentId: string;
}

// ─── Rendering Types ───────────────────────────────────────────────────────

export interface RenderLayer {
  name: string;
  zIndex: number;
  visible: boolean;
}

export const RENDER_LAYERS: RenderLayer[] = [
  { name: 'background', zIndex: 0, visible: true },
  { name: 'ground', zIndex: 1, visible: true },
  { name: 'terrain', zIndex: 2, visible: true },
  { name: 'crops', zIndex: 3, visible: true },
  { name: 'characters', zIndex: 4, visible: true },
  { name: 'effects', zIndex: 5, visible: true },
  { name: 'ui', zIndex: 6, visible: true },
];

// ─── Config Types ──────────────────────────────────────────────────────────

export interface FileTypeMapping {
  crop: string;
  color: string;
}

export interface DirectoryMapping {
  terrain: string;
  fence: string;
}

export interface TileConfig {
  version: number;
  tileSize: number;
  fileTypeMappings: Record<string, FileTypeMapping> & { _default: FileTypeMapping };
  growthStages: Record<string, { stages: number; growthRate: string }>;
  directoryMappings: Record<string, DirectoryMapping> & { _default: DirectoryMapping };
  characters: Record<string, {
    spritesheet: string;
    animations: Record<string, string[]>;
  }>;
  subAgents: Record<string, { behavior: string; speed: number }>;
}

// ─── Character Action Types ────────────────────────────────────────────────

/** Predefined Claude skills/tools that can be mapped to sprite actions */
export type ClaudeSkill =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'search'
  | 'webSearch'
  | 'webFetch'
  | 'agent'
  | 'custom';

/** Configuration for a single character action */
export interface ActionConfig {
  name: string;              // Action identifier (e.g., "hoe", "read", "walk")
  frames: number;            // Number of animation frames for this action
  skill?: ClaudeSkill;       // Optional: mapped Claude skill
  customSkillName?: string;  // If skill is 'custom', store the custom name
}

/** Character spritesheet configuration with per-action settings */
export interface CharacterConfig {
  directions: string[];      // Available directions: ["down", "up", "left", "right"]
  actions: ActionConfig[];   // Action configurations with per-action frames
  framesPerAction?: number;  // DEPRECATED: kept for migration from legacy format
}

/** Legacy character config format (for migration) */
export interface LegacyCharacterConfig {
  directions: string[];
  actions: string[];         // Old format: array of action names
  framesPerAction: number;   // Old format: global frame count
}
