/**
 * Autotiler - Bitmask-based tile sprite selection
 *
 * Uses 8-bit neighbor encoding:
 * - N  (North)     = 1
 * - NE (Northeast) = 2
 * - E  (East)      = 4
 * - SE (Southeast) = 8
 * - S  (South)     = 16
 * - SW (Southwest) = 32
 * - W  (West)      = 64
 * - NW (Northwest) = 128
 *
 * Values 0-255 represent all possible neighbor configurations.
 */

import {
  DirectionBit,
  TerrainConfig,
  TerrainTransition,
  AutotilerConfig,
  TileType,
} from './types';

/** Neighbor lookup result for 8-direction bitmask calculation */
export interface NeighborLookup {
  hasNorth: boolean;
  hasNortheast: boolean;
  hasEast: boolean;
  hasSoutheast: boolean;
  hasSouth: boolean;
  hasSouthwest: boolean;
  hasWest: boolean;
  hasNorthwest: boolean;
}

/**
 * Calculate 8-bit bitmask from neighbor presence
 */
export function calculateBitmask(neighbors: NeighborLookup): number {
  let mask = 0;
  if (neighbors.hasNorth) mask |= DirectionBit.NORTH;
  if (neighbors.hasNortheast) mask |= DirectionBit.NORTHEAST;
  if (neighbors.hasEast) mask |= DirectionBit.EAST;
  if (neighbors.hasSoutheast) mask |= DirectionBit.SOUTHEAST;
  if (neighbors.hasSouth) mask |= DirectionBit.SOUTH;
  if (neighbors.hasSouthwest) mask |= DirectionBit.SOUTHWEST;
  if (neighbors.hasWest) mask |= DirectionBit.WEST;
  if (neighbors.hasNorthwest) mask |= DirectionBit.NORTHWEST;
  return maskIrrelevantDiagonals(mask);
}

/**
 * Mask out diagonal bits where one or both adjacent cardinals are absent.
 * A diagonal is only visually relevant when both flanking cardinals are present —
 * otherwise the edge/corner sprite already covers that visual and the diagonal
 * neighbor doesn't change the tile's appearance.
 *
 * This ensures that the same visual pattern always produces the same bitmask,
 * regardless of what happens to sit at an irrelevant diagonal position.
 */
export function maskIrrelevantDiagonals(mask: number): number {
  if (!(mask & DirectionBit.NORTH) || !(mask & DirectionBit.EAST))  mask &= ~DirectionBit.NORTHEAST;
  if (!(mask & DirectionBit.EAST)  || !(mask & DirectionBit.SOUTH)) mask &= ~DirectionBit.SOUTHEAST;
  if (!(mask & DirectionBit.SOUTH) || !(mask & DirectionBit.WEST))  mask &= ~DirectionBit.SOUTHWEST;
  if (!(mask & DirectionBit.WEST)  || !(mask & DirectionBit.NORTH)) mask &= ~DirectionBit.NORTHWEST;
  return mask;
}

/**
 * Calculate 8-bit bitmask from a predicate function checking coordinates
 */
export function calculateBitmaskFromPredicate(
  x: number,
  y: number,
  isSameTerrain: (checkX: number, checkY: number) => boolean
): number {
  return calculateBitmask({
    hasNorth: isSameTerrain(x, y - 1),
    hasNortheast: isSameTerrain(x + 1, y - 1),
    hasEast: isSameTerrain(x + 1, y),
    hasSoutheast: isSameTerrain(x + 1, y + 1),
    hasSouth: isSameTerrain(x, y + 1),
    hasSouthwest: isSameTerrain(x - 1, y + 1),
    hasWest: isSameTerrain(x - 1, y),
    hasNorthwest: isSameTerrain(x - 1, y - 1),
  });
}

// ─── Bitmask Mapping Generator ───────────────────────────────────────────────

/** Sprite rule set for edge-mode terrains (grass, tilled-dirt) */
export interface EdgeSpriteRules {
  mode: 'edge';
  /** Sprite for fully interior tiles, or "" to preserve existing sprite */
  center: string;
  /** Edge sprites (exposed side) */
  edgeN: string;
  edgeS: string;
  edgeE: string;
  edgeW: string;
  /** Outer corner sprites (two adjacent exposed sides) */
  cornerNW: string;
  cornerNE: string;
  cornerSW: string;
  cornerSE: string;
  /** Inner corner sprites (diagonal gap while both cardinals present). Optional. */
  innerCornerNW?: string;
  innerCornerNE?: string;
  innerCornerSW?: string;
  innerCornerSE?: string;
}

/** Sprite rule set for connectivity-mode terrains (paths) */
export interface ConnectivitySpriteRules {
  mode: 'connectivity';
  /** Default/crossroads/isolated sprite */
  center: string;
  vertical: string;
  horizontal: string;
  /** Corner connections (two adjacent cardinals present) */
  cornerNW: string;
  cornerNE: string;
  cornerSW: string;
  cornerSE: string;
  /** T-junctions (three cardinals present, named by missing side) */
  edgeN: string;
  edgeS: string;
  edgeE: string;
  edgeW: string;
  /** Endpoints (single connection) */
  endN: string;
  endS: string;
  endE: string;
  endW: string;
}

export type SpriteRules = EdgeSpriteRules | ConnectivitySpriteRules;

/**
 * Generate a full 256-entry bitmask mapping array from a sprite rule set.
 *
 * Bitmask encoding: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
 * A set bit means the neighbor IS the same terrain type.
 */
export function generateBitmaskMappings(rules: SpriteRules): string[] {
  const mappings: string[] = new Array(256);

  for (let mask = 0; mask < 256; mask++) {
    const hasN = (mask & DirectionBit.NORTH) !== 0;
    const hasNE = (mask & DirectionBit.NORTHEAST) !== 0;
    const hasE = (mask & DirectionBit.EAST) !== 0;
    const hasSE = (mask & DirectionBit.SOUTHEAST) !== 0;
    const hasS = (mask & DirectionBit.SOUTH) !== 0;
    const hasSW = (mask & DirectionBit.SOUTHWEST) !== 0;
    const hasW = (mask & DirectionBit.WEST) !== 0;
    const hasNW = (mask & DirectionBit.NORTHWEST) !== 0;

    if (rules.mode === 'edge') {
      mappings[mask] = resolveEdgeSprite(rules, hasN, hasE, hasS, hasW, hasNE, hasSE, hasSW, hasNW);
    } else {
      mappings[mask] = resolveConnectivitySprite(rules, hasN, hasE, hasS, hasW);
    }
  }

  return mappings;
}

/**
 * Edge mode: missing cardinal neighbor = exposed edge.
 * Used for grass, tilled-dirt, water.
 */
function resolveEdgeSprite(
  rules: EdgeSpriteRules,
  hasN: boolean, hasE: boolean, hasS: boolean, hasW: boolean,
  hasNE: boolean, hasSE: boolean, hasSW: boolean, hasNW: boolean
): string {
  const missingN = !hasN;
  const missingE = !hasE;
  const missingS = !hasS;
  const missingW = !hasW;
  const missingCount = +missingN + +missingE + +missingS + +missingW;

  // Two adjacent cardinals missing → outer corner
  if (missingN && missingW && !missingE && !missingS) return rules.cornerNW;
  if (missingN && missingE && !missingW && !missingS) return rules.cornerNE;
  if (missingS && missingW && !missingE && !missingN) return rules.cornerSW;
  if (missingS && missingE && !missingW && !missingN) return rules.cornerSE;

  // Exactly one cardinal missing → edge
  if (missingCount === 1) {
    if (missingN) return rules.edgeN;
    if (missingS) return rules.edgeS;
    if (missingE) return rules.edgeE;
    if (missingW) return rules.edgeW;
  }

  // All cardinals present → check diagonals for inner corners
  if (missingCount === 0) {
    if (!hasNW && rules.innerCornerNW) return rules.innerCornerNW;
    if (!hasNE && rules.innerCornerNE) return rules.innerCornerNE;
    if (!hasSW && rules.innerCornerSW) return rules.innerCornerSW;
    if (!hasSE && rules.innerCornerSE) return rules.innerCornerSE;
    // Fully interior
    return rules.center;
  }

  // Unusual geometry (opposite pair missing, 3+ missing) → center
  return rules.center;
}

/**
 * Connectivity mode: present cardinal neighbor = connection direction.
 * Used for paths.
 */
function resolveConnectivitySprite(
  rules: ConnectivitySpriteRules,
  hasN: boolean, hasE: boolean, hasS: boolean, hasW: boolean
): string {
  const count = +hasN + +hasE + +hasS + +hasW;

  if (count === 0 || count === 4) return rules.center;

  if (count === 1) {
    if (hasN) return rules.endN;
    if (hasS) return rules.endS;
    if (hasE) return rules.endE;
    return rules.endW;
  }

  if (count === 2) {
    // Straight lines
    if (hasN && hasS) return rules.vertical;
    if (hasE && hasW) return rules.horizontal;
    // Corners (named by the inner corner of the turn)
    if (hasS && hasE) return rules.cornerNW;
    if (hasS && hasW) return rules.cornerNE;
    if (hasN && hasE) return rules.cornerSW;
    if (hasN && hasW) return rules.cornerSE;
  }

  // count === 3: T-junctions (named by missing side)
  if (!hasN) return rules.edgeN;
  if (!hasS) return rules.edgeS;
  if (!hasE) return rules.edgeE;
  return rules.edgeW;
}

// ─── Autotiler Class ─────────────────────────────────────────────────────────

/**
 * Autotiler class - manages terrain configurations and sprite lookups
 */
export class Autotiler {
  private terrainConfigs: Map<TileType, TerrainConfig> = new Map();
  private transitions: TerrainTransition[] = [];

  constructor(config: AutotilerConfig) {
    for (const terrain of config.terrains) {
      this.terrainConfigs.set(terrain.type, terrain);
    }
    this.transitions = config.transitions || [];
  }

  /**
   * Get sprite ID for a tile based on its neighbors.
   * Returns null when the existing sprite should be preserved
   * (bitmask maps to empty string "").
   */
  getSpriteForTile(
    x: number,
    y: number,
    terrainType: TileType,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null
  ): string | null {
    const config = this.terrainConfigs.get(terrainType);
    if (!config) {
      return null; // No config for this terrain type — preserve existing sprite
    }

    // Check if this tile borders a different terrain (transition case)
    const transition = this.findTransition(x, y, terrainType, getTileType);
    if (transition) {
      return this.getTransitionSprite(x, y, terrainType, transition, getTileType, config);
    }

    // Same-terrain bitmask calculation
    const isSameTerrain = (cx: number, cy: number) => {
      const neighborType = getTileType(cx, cy, config.layer);
      return neighborType === terrainType;
    };

    const bitmask = calculateBitmaskFromPredicate(x, y, isSameTerrain);
    return this.bitmaskToSprite(bitmask, config);
  }

  private findTransition(
    x: number,
    y: number,
    currentTerrain: TileType,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null
  ): TerrainTransition | null {
    const neighbors = [
      getTileType(x, y - 1, 0),       // N
      getTileType(x + 1, y - 1, 0),   // NE
      getTileType(x + 1, y, 0),       // E
      getTileType(x + 1, y + 1, 0),   // SE
      getTileType(x, y + 1, 0),       // S
      getTileType(x - 1, y + 1, 0),   // SW
      getTileType(x - 1, y, 0),       // W
      getTileType(x - 1, y - 1, 0),   // NW
    ];

    for (const neighborType of neighbors) {
      if (neighborType && neighborType !== currentTerrain) {
        const transition = this.transitions.find(
          t => t.fromTerrain === currentTerrain && t.toTerrain === neighborType
        );
        if (transition) return transition;
      }
    }
    return null;
  }

  private getTransitionSprite(
    x: number,
    y: number,
    currentTerrain: TileType,
    transition: TerrainTransition,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null,
    config: TerrainConfig
  ): string | null {
    const isTargetTerrain = (cx: number, cy: number) => {
      const type = getTileType(cx, cy, config.layer);
      return type === transition.toTerrain || type === null;
    };

    const bitmask = calculateBitmaskFromPredicate(x, y, isTargetTerrain);
    return this.bitmaskToSprite(bitmask, {
      ...config,
      spritesheet: transition.edgeSpritesheet,
    });
  }

  /**
   * Convert bitmask to sprite ID. Returns null for empty-string mappings
   * (signals "preserve existing sprite").
   */
  private bitmaskToSprite(bitmask: number, config: TerrainConfig): string | null {
    const spriteName = config.bitmaskMappings[bitmask];
    if (!spriteName) return null; // empty string or undefined = preserve existing
    return `${config.spritesheet}/${spriteName}`;
  }

  /**
   * Batch process all tiles for autotiling.
   * Skips tiles where bitmask maps to "" (preserve existing sprite).
   */
  autotileTerrain(
    tiles: Array<{ x: number; y: number; type: TileType }>,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null,
    setSprite: (x: number, y: number, spriteId: string) => void
  ): void {
    for (const tile of tiles) {
      const spriteId = this.getSpriteForTile(tile.x, tile.y, tile.type, getTileType);
      if (spriteId !== null) {
        setSprite(tile.x, tile.y, spriteId);
      }
    }
  }

  getTerrainConfig(type: TileType): TerrainConfig | undefined {
    return this.terrainConfigs.get(type);
  }
}
