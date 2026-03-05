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

/**
 * Autotiler class - manages terrain configurations and sprite lookups
 */
export class Autotiler {
  private terrainConfigs: Map<TileType, TerrainConfig> = new Map();
  private transitions: TerrainTransition[] = [];

  constructor(config: AutotilerConfig) {
    // Load terrain configurations
    for (const terrain of config.terrains) {
      this.terrainConfigs.set(terrain.type, terrain);
    }
    this.transitions = config.transitions || [];
  }

  /**
   * Get sprite ID for a tile based on its neighbors
   *
   * @param x - Tile X coordinate
   * @param y - Tile Y coordinate
   * @param terrainType - The terrain type of this tile
   * @param getTileType - Function to get terrain type at any coordinate
   * @returns Full sprite ID (e.g., 'grass/grass-edge-n')
   */
  getSpriteForTile(
    x: number,
    y: number,
    terrainType: TileType,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null
  ): string {
    const config = this.terrainConfigs.get(terrainType);
    if (!config) {
      // Fallback to center sprite
      return `${terrainType}/${terrainType}-center`;
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

  /**
   * Find applicable terrain transition for a tile
   */
  private findTransition(
    x: number,
    y: number,
    currentTerrain: TileType,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null
  ): TerrainTransition | null {
    // Check all 8 neighbors for different terrain
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
        // Find matching transition rule
        const transition = this.transitions.find(
          t => t.fromTerrain === currentTerrain && t.toTerrain === neighborType
        );
        if (transition) return transition;
      }
    }
    return null;
  }

  /**
   * Get sprite for a transition edge tile
   */
  private getTransitionSprite(
    x: number,
    y: number,
    currentTerrain: TileType,
    transition: TerrainTransition,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null,
    config: TerrainConfig
  ): string {
    // Calculate bitmask based on which neighbors are the "to" terrain
    const isTargetTerrain = (cx: number, cy: number) => {
      const type = getTileType(cx, cy, config.layer);
      return type === transition.toTerrain || type === null; // null = outside world
    };

    const bitmask = calculateBitmaskFromPredicate(x, y, isTargetTerrain);
    return this.bitmaskToSprite(bitmask, {
      ...config,
      spritesheet: transition.edgeSpritesheet,
    });
  }

  /**
   * Convert bitmask to sprite ID using terrain config
   */
  private bitmaskToSprite(bitmask: number, config: TerrainConfig): string {
    const spriteName = config.bitmaskMappings[bitmask] ?? config.defaultSprite;
    return `${config.spritesheet}/${spriteName}`;
  }

  /**
   * Batch process all tiles of a given type for autotiling
   */
  autotileTerrain(
    tiles: Array<{ x: number; y: number; type: TileType }>,
    getTileType: (checkX: number, checkY: number, layer?: number) => TileType | null,
    setSprite: (x: number, y: number, spriteId: string) => void
  ): void {
    for (const tile of tiles) {
      const spriteId = this.getSpriteForTile(tile.x, tile.y, tile.type, getTileType);
      setSprite(tile.x, tile.y, spriteId);
    }
  }

  /**
   * Get terrain config for a specific type
   */
  getTerrainConfig(type: TileType): TerrainConfig | undefined {
    return this.terrainConfigs.get(type);
  }
}
