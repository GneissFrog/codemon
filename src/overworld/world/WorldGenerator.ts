/**
 * WorldGenerator — Transforms file tree into a farm world layout
 *
 * Converts the treemap-style layout into a tile-based farm with:
 * - Grass ground
 * - Fenced plots for directories
 * - Crops for files
 * - Paths between plots
 */

import { WorldMap } from './WorldMap';
import { TileType, Plot } from '../core/types';
import { FileNode, MapLayout, MapTile } from '../../core/codebase-mapper';

interface LayoutNode {
  node: FileNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

interface GeneratorConfig {
  padding: number;        // Tiles between plots
  minPlotWidth: number;   // Minimum plot width in tiles
  minPlotHeight: number;  // Minimum plot height in tiles
  maxPlotWidth: number;   // Maximum plot width in tiles
  maxPlotHeight: number;  // Maximum plot height in tiles
}

const DEFAULT_CONFIG: GeneratorConfig = {
  padding: 2,
  minPlotWidth: 4,
  minPlotHeight: 4,
  maxPlotWidth: 20,
  maxPlotHeight: 15,
};

// Layer constants for render ordering
const LAYER_GROUND = 0;
const LAYER_TERRAIN = 1;
const LAYER_CROPS = 2;

export class WorldGenerator {
  private map: WorldMap;
  private config: GeneratorConfig;
  private fileExtensionToCrop: Map<string, string>;

  constructor(map: WorldMap, config: Partial<GeneratorConfig> = {}) {
    this.map = map;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Map file extensions to crop types
    this.fileExtensionToCrop = new Map([
      // TypeScript/JavaScript → Wheat
      ['.ts', 'wheat'],
      ['.tsx', 'wheat'],
      ['.js', 'wheat'],
      ['.jsx', 'wheat'],
      ['.mjs', 'wheat'],
      ['.cjs', 'wheat'],

      // Python → Pumpkin
      ['.py', 'pumpkin'],

      // Rust → Carrot (using flower for now)
      ['.rs', 'flower'],

      // Go → Corn (using pumpkin)
      ['.go', 'pumpkin'],

      // CSS/Styling → Flower
      ['.css', 'flower'],
      ['.scss', 'flower'],
      ['.less', 'flower'],

      // Config → Herb (using seedling)
      ['.json', 'seedling'],
      ['.yaml', 'seedling'],
      ['.yml', 'seedling'],
      ['.toml', 'seedling'],

      // Docs → Sunflower (using flower)
      ['.md', 'flower'],
      ['.txt', 'seedling'],

      // Shell → Weed (using seedling)
      ['.sh', 'seedling'],
      ['.bash', 'seedling'],
    ]);
  }

  /**
   * Generate world from existing treemap layout
   */
  generateFromLayout(layout: MapLayout): void {
    // Clear existing
    this.map.clearTiles();

    // Fill ground with grass
    this.fillGround(layout.width, layout.height);

    // Convert tiles to plots and render
    const processedDirs = new Set<string>();

    for (const tile of layout.tiles) {
      if (tile.isDir) {
        // Create fenced plot for directory
        this.createDirectoryPlot(tile, processedDirs);
      } else {
        // Create crop for file
        this.createFilePlot(tile);
      }
    }

    // Post-processing
    this.generateWater(layout.width, layout.height);
    this.generatePaths();
    this.autoTileGrassEdges();
    this.placeDecorations(layout.width, layout.height);
  }

  /**
   * Fill the ground layer with grass
   */
  private fillGround(width: number, height: number): void {
    const tileCount = Math.ceil(Math.max(width, height) / 16) + 10;

    for (let y = -5; y < tileCount; y++) {
      for (let x = -5; x < tileCount; x++) {
        // Use varied grass sprites for natural look
        const variant = (x * 7 + y * 13) % 4;
        const spriteId = variant === 0 ? 'grass/grass-center' : `grass/grass-var${variant}`;
        this.map.setTile(x, y, 'grass', spriteId, variant, LAYER_GROUND);
      }
    }
  }

  /**
   * Create a fenced plot for a directory
   */
  private createDirectoryPlot(tile: MapTile, processed: Set<string>): void {
    const key = `${tile.x},${tile.y}`;
    if (processed.has(key)) return;
    processed.add(key);

    // Convert pixel coordinates to tile coordinates
    const startX = Math.floor(tile.x / 16);
    const startY = Math.floor(tile.y / 16);
    const width = Math.max(this.config.minPlotWidth, Math.ceil(tile.width / 16));
    const height = Math.max(this.config.minPlotHeight, Math.ceil(tile.height / 16));

    // Create tilled dirt inside
    this.fillTilledDirt(startX, startY, width, height);

    // Create fence around
    this.createFence(startX, startY, width, height);

    // Create plot record
    const plot: Plot = {
      id: tile.node?.path || key,
      x: startX,
      y: startY,
      width,
      height,
      filePath: tile.node?.path || '',
      isDirectory: true,
      cropType: 'directory',
      growthStage: 0,
      activity: 0,
      cropSpriteId: '',
    };
    this.map.addPlot(plot);
  }

  /**
   * Create a crop plot for a file
   */
  private createFilePlot(tile: MapTile): void {
    const x = Math.floor(tile.x / 16);
    const y = Math.floor(tile.y / 16);

    const cropType = this.getCropType(tile.node?.name || '');
    const activity = (tile.node?.readCount || 0) + (tile.node?.writeCount || 0);
    const growthStage = Math.min(3, Math.floor(activity / 2));

    // Create plot record with pre-computed crop sprite
    const plot: Plot = {
      id: tile.node?.path || `${x},${y}`,
      x,
      y,
      width: 1,
      height: 1,
      filePath: tile.node?.path || '',
      isDirectory: false,
      cropType,
      growthStage,
      activity,
      cropSpriteId: '',
    };
    plot.cropSpriteId = this.getCropSprite(plot);
    this.map.addPlot(plot);

    // Place crop tile on the map
    this.map.setTile(x, y, 'tilled', plot.cropSpriteId, 0, LAYER_CROPS);
  }

  /**
   * Fill area with tilled dirt
   */
  private fillTilledDirt(startX: number, startY: number, width: number, height: number): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tx = startX + x;
        const ty = startY + y;

        // Determine sprite based on position
        let spriteId = 'tilled-dirt/dirt-center';

        if (y === 0) spriteId = 'tilled-dirt/dirt-edge-n';
        else if (y === height - 1) spriteId = 'tilled-dirt/dirt-edge-s';
        else if (x === 0) spriteId = 'tilled-dirt/dirt-edge-w';
        else if (x === width - 1) spriteId = 'tilled-dirt/dirt-edge-e';

        // Corners
        if (x === 0 && y === 0) spriteId = 'tilled-dirt/dirt-corner-nw';
        else if (x === width - 1 && y === 0) spriteId = 'tilled-dirt/dirt-corner-ne';
        else if (x === 0 && y === height - 1) spriteId = 'tilled-dirt/dirt-corner-sw';
        else if (x === width - 1 && y === height - 1) spriteId = 'tilled-dirt/dirt-corner-se';

        this.map.setTile(tx, ty, 'tilled', spriteId, 0, LAYER_GROUND);
      }
    }
  }

  /**
   * Create fence around a plot
   */
  private createFence(startX: number, startY: number, width: number, height: number): void {
    // Top and bottom fences
    for (let x = 0; x < width; x++) {
      this.map.setTile(startX + x, startY - 1, 'fence', 'fences/fence-horizontal', 0, LAYER_TERRAIN);
      this.map.setTile(startX + x, startY + height, 'fence', 'fences/fence-horizontal', 0, LAYER_TERRAIN);
    }

    // Left and right fences (excluding corners)
    for (let y = 0; y < height; y++) {
      this.map.setTile(startX - 1, startY + y, 'fence', 'fences/fence-vertical', 0, LAYER_TERRAIN);
      this.map.setTile(startX + width, startY + y, 'fence', 'fences/fence-vertical', 0, LAYER_TERRAIN);
    }

    // Corner posts
    this.map.setTile(startX - 1, startY - 1, 'fence', 'fences/fence-corner-tl', 0, LAYER_TERRAIN);
    this.map.setTile(startX + width, startY - 1, 'fence', 'fences/fence-corner-tr', 0, LAYER_TERRAIN);
    this.map.setTile(startX - 1, startY + height, 'fence', 'fences/fence-corner-bl', 0, LAYER_TERRAIN);
    this.map.setTile(startX + width, startY + height, 'fence', 'fences/fence-corner-br', 0, LAYER_TERRAIN);
  }

  /**
   * Get crop type for a file
   */
  private getCropType(filename: string): string {
    const ext = this.getFileExtension(filename);
    return this.fileExtensionToCrop.get(ext) || 'seedling';
  }

  /**
   * Get file extension
   */
  private getFileExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
  }

  /**
   * Get crop sprite for a plot
   */
  getCropSprite(plot: Plot): string {
    const stage = plot.growthStage;

    switch (plot.cropType) {
      case 'wheat':
        return `plants/wheat-${Math.min(4, stage + 1)}`;
      case 'pumpkin':
        return stage < 2 ? `plants/seedling-${stage + 1}` : `plants/pumpkin-${stage - 1}`;
      case 'flower':
        return stage < 2 ? `plants/seedling-${stage + 1}` : 'plants/flower';
      case 'carrot':
        return stage < 2 ? `plants/seedling-${stage + 1}` : 'plants/flower';
      default:
        return `plants/seedling-${Math.min(2, stage + 1)}`;
    }
  }

  /**
   * Generate a small pond in an open area of the world
   */
  private generateWater(width: number, height: number): void {
    const maxTileX = Math.ceil(width / 16) + 4;
    const maxTileY = Math.ceil(height / 16) + 4;

    // Place pond in bottom-right area, offset from plots
    const pondCenterX = Math.floor(maxTileX * 0.85);
    const pondCenterY = Math.floor(maxTileY * 0.8);
    const pondRadius = 2;

    for (let y = pondCenterY - pondRadius; y <= pondCenterY + pondRadius; y++) {
      for (let x = pondCenterX - pondRadius; x <= pondCenterX + pondRadius; x++) {
        const dist = Math.sqrt((x - pondCenterX) ** 2 + (y - pondCenterY) ** 2);
        if (dist <= pondRadius + 0.3) {
          // Don't overwrite tilled dirt, fences, or crops
          const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
          const cropTile = this.map.getTile(x, y, LAYER_CROPS);
          if (terrainTile || cropTile) continue;

          const groundTile = this.map.getTile(x, y, LAYER_GROUND);
          if (groundTile && groundTile.type === 'tilled') continue;

          this.map.setTile(x, y, 'water', 'water/water-0', 0, LAYER_GROUND);
        }
      }
    }
  }

  /**
   * Generate paths between adjacent directory plots.
   * Connects each plot to the nearest neighbor with a Manhattan path.
   */
  private generatePaths(): void {
    const plots = this.map.getAllPlots().filter(p => p.isDirectory);
    if (plots.length < 2) return;

    // Sort by position for consistent pairing
    plots.sort((a, b) => a.x - b.x || a.y - b.y);

    const connected = new Set<string>();

    for (let i = 0; i < plots.length; i++) {
      const plotA = plots[i];
      let nearestDist = Infinity;
      let nearestPlot: Plot | null = null;

      // Find nearest unconnected neighbor
      for (let j = 0; j < plots.length; j++) {
        if (i === j) continue;
        const plotB = plots[j];
        const pairKey = [plotA.id, plotB.id].sort().join('|');
        if (connected.has(pairKey)) continue;

        const dx = (plotB.x + plotB.width / 2) - (plotA.x + plotA.width / 2);
        const dy = (plotB.y + plotB.height / 2) - (plotA.y + plotA.height / 2);
        const dist = Math.abs(dx) + Math.abs(dy);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlot = plotB;
        }
      }

      if (!nearestPlot) continue;

      const pairKey = [plotA.id, nearestPlot.id].sort().join('|');
      connected.add(pairKey);

      // Create Manhattan path from bottom of plotA to top of nearestPlot
      const startX = Math.floor(plotA.x + plotA.width / 2);
      const startY = plotA.y + plotA.height;
      const endX = Math.floor(nearestPlot.x + nearestPlot.width / 2);
      const endY = nearestPlot.y - 1;

      // Walk horizontally first, then vertically
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);

      // Horizontal segment
      for (let x = minX; x <= maxX; x++) {
        this.placePath(x, startY);
      }

      // Vertical segment
      for (let y = minY; y <= maxY; y++) {
        this.placePath(endX, y);
      }
    }
  }

  /**
   * Place a single path tile if the location is open grass
   */
  private placePath(x: number, y: number): void {
    const groundTile = this.map.getTile(x, y, LAYER_GROUND);
    // Only place on grass, not on tilled dirt or water
    if (!groundTile || groundTile.type !== 'grass') return;

    // Don't place on fence or crop locations
    const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
    if (terrainTile) return;

    this.map.setTile(x, y, 'path', 'paths/path-center', 0, LAYER_GROUND);
  }

  /**
   * Auto-tile grass edges where grass meets tilled dirt or fences.
   * Scans all non-grass tiles and updates adjacent grass to use edge/corner sprites.
   */
  private autoTileGrassEdges(): void {
    const allTiles = this.map.getAllTiles();
    const nonGrass = new Set<string>();

    // Build a set of tiles that are not grass (on the ground layer)
    for (const tile of allTiles) {
      if (tile.type !== 'grass') {
        nonGrass.add(`${tile.x},${tile.y}`);
      }
    }

    // For each grass tile, check if it borders a non-grass tile
    for (const tile of allTiles) {
      if (tile.type !== 'grass' || tile.layer !== LAYER_GROUND) continue;

      const { x, y } = tile;
      const n = nonGrass.has(`${x},${y - 1}`);
      const s = nonGrass.has(`${x},${y + 1}`);
      const e = nonGrass.has(`${x + 1},${y}`);
      const w = nonGrass.has(`${x - 1},${y}`);

      // Select edge sprite based on neighbors
      let spriteId: string | null = null;

      if (n && w) spriteId = 'grass/grass-corner-nw';
      else if (n && e) spriteId = 'grass/grass-corner-ne';
      else if (s && w) spriteId = 'grass/grass-corner-sw';
      else if (s && e) spriteId = 'grass/grass-corner-se';
      else if (n) spriteId = 'grass/grass-edge-n';
      else if (s) spriteId = 'grass/grass-edge-s';
      else if (e) spriteId = 'grass/grass-edge-e';
      else if (w) spriteId = 'grass/grass-edge-w';

      if (spriteId) {
        this.map.setTile(x, y, 'grass', spriteId, 0, LAYER_GROUND);
      }
    }
  }

  /**
   * Scatter decorative objects on open grass tiles.
   */
  private placeDecorations(width: number, height: number): void {
    const decorationSprites = [
      'biome/grass-tuft-1',
      'biome/grass-tuft-2',
      'biome/flower-small',
      'biome/stone-small',
      'biome/mushroom-red',
      'biome/mushroom-brown',
      'biome/butterfly-1',
    ];

    const tileCount = Math.ceil(Math.max(width, height) / 16) + 5;

    for (let y = -3; y < tileCount; y++) {
      for (let x = -3; x < tileCount; x++) {
        // Only place on grass tiles (check that no non-ground tile exists here)
        const groundTile = this.map.getTile(x, y, LAYER_GROUND);
        const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
        const cropTile = this.map.getTile(x, y, LAYER_CROPS);

        if (!groundTile || groundTile.type !== 'grass') continue;
        if (terrainTile || cropTile) continue;

        // Deterministic pseudo-random using tile position
        const hash = ((x * 31 + y * 17) * 2654435761) >>> 0;
        const chance = (hash % 100);

        // ~5% chance of decoration
        if (chance < 5) {
          const spriteIdx = hash % decorationSprites.length;
          const spriteId = decorationSprites[spriteIdx];
          this.map.setTile(x, y, 'decoration', spriteId, 0, LAYER_CROPS);
        }
      }
    }
  }
}
