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

/** Configuration for loading Aseprite-exported animations */
export interface AsepriteConfig {
  jsonFile: string;        // Path to exported JSON (relative to extension root)
  tags?: string[];         // Optional: only load specific tags (all if omitted)
}

export interface SpritesheetDef {
  image: string;
  dimensions: { width: number; height: number };
  frameSize: { width: number; height: number };
  grid: { cols: number; rows: number };
  sprites: Record<string, SpriteDef | { comment: string }>;
  normalMap?: string;      // Optional: path to normal map image (auto-detected via _n suffix)
  aseprite?: AsepriteConfig;  // Optional: Aseprite JSON export for auto-animation
  isCharacter?: boolean;   // Optional: mark as character spritesheet
  characterConfig?: CharacterConfig | LegacyCharacterConfig;  // Character animation config
  /** Mark as terrain tileset — sprites auto-generated from grid as t_col_row */
  terrainTileset?: boolean;
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

// Sprite purpose types - what a spritesheet can be used for
export type SpritePurpose =
  | 'character'      // Player character
  | 'chicken'        // Chicken NPC
  | 'cow'            // Cow NPC
  | 'grass'          // Grass tiles
  | 'tilled-dirt'    // Tilled dirt tiles
  | 'fences'         // Fence objects
  | 'water'          // Water tiles
  | 'plants'         // Plant/crop objects
  | 'biome'          // Biome decorations
  | 'paths'          // Path tiles
  | 'custom';        // Custom purpose

export interface SpriteManifest {
  version: number;
  description: string;
  tileSize: number;
  spriteMappings: Record<string, string>;  // purpose -> sheetName
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

/** Aseprite JSON export structure (simplified for what we need) */
export interface AsepriteFrameData {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;  // ms per frame
}

export interface AsepriteTagData {
  name: string;
  from: number;
  to: number;
  direction: 'forward' | 'reverse' | 'pingpong';
}

export interface AsepriteExportData {
  frames: Record<string, AsepriteFrameData>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: number;
    frameTags: AsepriteTagData[];
    slices?: unknown[];
  };
}

export interface LoadedSpritesheet {
  name: string;
  image: unknown | null;  // ImageBitmap in webview, null in extension host
  imageUrl: string;  // Data URL for webview transfer
  normalMapUrl?: string;  // Data URL for normal map (if exists)
  sprites: Map<string, LoadedSprite>;
  asepriteData?: AsepriteExportData;  // Parsed Aseprite JSON (if available)
  asepriteTags?: string[];  // Tags to filter (if using Aseprite)
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

/**
 * Tile type identifier. Config-driven — new terrain types can be added
 * via the TerrainConfigPanel without code changes.
 *
 * Common values: 'grass', 'tilled', 'water', 'path', 'fence', 'fence-gate', 'decoration'
 */
export type TileType = string;

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
  isActive: boolean;     // Currently being accessed (decays after 3s)
  cropSpriteId: string;  // Pre-computed sprite for this plot's crop
}

// ─── Tile Module Types ────────────────────────────────────────────────────

export type ModuleCategory =
  | 'environment'    // Ponds, clearings, groves
  | 'connector'      // Bridges, crossroads, path features
  | 'decorative'     // Vignettes, arrangements
  | 'landmark';      // Points of interest, unique features

export type ConnectionType = 'path' | 'grass' | 'water' | 'fence' | 'any';

export type PlacementAffinity =
  | 'any'            // No preference
  | 'edge'           // Prefers world edges
  | 'center'         // Prefers world center
  | 'near-water'     // Prefers proximity to water
  | 'near-path'      // Prefers proximity to paths
  | 'corner'         // Prefers world corners
  | 'between-plots'; // Prefers gaps between directory plots

export interface ModuleTilePlacement {
  x: number;          // Offset from module origin (0,0)
  y: number;
  layer: number;      // 0=ground, 1=terrain, 2=objects/crops
  type: TileType;
  spriteId: string;
}

export interface ConnectionPoint {
  x: number;          // Position on module edge
  y: number;
  edge: 'north' | 'south' | 'east' | 'west';
  type: ConnectionType;
  required: boolean;  // Must this connection be satisfied?
}

export interface PlacementRules {
  minDistFromPlots: number;    // Minimum tiles from any directory plot
  minDistFromSame: number;     // Minimum tiles from same module type
  minDistFromAny: number;      // Minimum tiles from any other module
  affinity: PlacementAffinity;
  allowOverlapWater: boolean;
  allowOverlapDecorations: boolean;
  requiresGrass: boolean;      // Must footprint be entirely on grass?
}

/** A pre-designed, modular tile arrangement placed by the generator */
export interface TileModuleDef {
  id: string;
  name: string;
  category: ModuleCategory;
  width: number;
  height: number;
  tiles: ModuleTilePlacement[];
  connectionPoints: ConnectionPoint[];
  placement: PlacementRules;
  tags: string[];
  rarity: number;          // 0.0-1.0, probability weight
  minWorldArea: number;    // Minimum world area (tiles^2) to appear
  maxInstances: number;    // Maximum copies per world (-1 = unlimited)
}

/** ASCII shorthand legend entry for module authoring */
export interface AsciiLegendEntry {
  type: TileType;
  spriteId: string;
  layer?: number;          // Default: 2 (objects) for single-layer maps
}

/** Single-layer ASCII module format */
export interface AsciiModuleFormat {
  id: string;
  name: string;
  category: ModuleCategory;
  asciiMap: string[];
  legend: Record<string, AsciiLegendEntry>;
  connectionPoints?: ConnectionPoint[];
  placement?: Partial<PlacementRules>;
  tags?: string[];
  rarity?: number;
  minWorldArea?: number;
  maxInstances?: number;
}

/** Multi-layer ASCII module format */
export interface AsciiLayerDef {
  layer: number;
  asciiMap: string[];
  legend: Record<string, AsciiLegendEntry>;
}

export interface MultiLayerAsciiModuleFormat {
  id: string;
  name: string;
  category: ModuleCategory;
  layers: AsciiLayerDef[];
  connectionPoints?: ConnectionPoint[];
  placement?: Partial<PlacementRules>;
  tags?: string[];
  rarity?: number;
  minWorldArea?: number;
  maxInstances?: number;
}

/** Record of a module that was placed in the world */
export interface PlacedModuleInfo {
  moduleId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Serialization Types ──────────────────────────────────────────────────

export interface SerializedWorldMap {
  tiles: Tile[];
  plots: Plot[];
  width: number;
  height: number;
  modules?: PlacedModuleInfo[];  // Placed module metadata for debug/hover
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

// ─── Bitmask Autotile Types ────────────────────────────────────────────────

/** Bitwise flags for 8-direction bitmask autotiling */
export const enum DirectionBit {
  NORTH     = 1,    // 00000001
  NORTHEAST = 2,    // 00000010
  EAST      = 4,    // 00000100
  SOUTHEAST = 8,    // 00001000
  SOUTH     = 16,   // 00010000
  SOUTHWEST = 32,   // 00100000
  WEST      = 64,   // 01000000
  NORTHWEST = 128,  // 10000000
}

/** Configuration for a single terrain type's autotiling behavior */
export interface TerrainConfig {
  /** The terrain type this config applies to */
  type: TileType;
  /** Spritesheet name (e.g., 'grass', 'tilled-dirt') */
  spritesheet: string;
  /** Layer to render this terrain on (0=ground, 1=terrain, 2=objects) */
  layer: number;
  /** Default sprite name when no mapping found */
  defaultSprite: string;
  /** Maps 8-bit bitmask value (0-255) to sprite name suffix */
  bitmaskMappings: string[];
  /** Default tile grid name for initial placement (e.g., 't_1_1') */
  defaultTile?: string;
  /** Grid names of variant tiles for noise-based interior variation */
  variants?: string[];
}

/** Defines a transition between two terrain types */
export interface TerrainTransition {
  /** Source terrain type */
  fromTerrain: TileType;
  /** Target terrain type */
  toTerrain: TileType;
  /** Which spritesheet to use for edge sprites */
  edgeSpritesheet: string;
  /** Higher priority = rendered on top */
  priority: number;
}

/** Full autotiler configuration */
export interface AutotilerConfig {
  version: number;
  terrains: TerrainConfig[];
  transitions: TerrainTransition[];
}

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
