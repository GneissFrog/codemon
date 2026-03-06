/**
 * WorldGenerator — Transforms file tree into a farm world layout
 *
 * Converts the treemap-style layout into a tile-based farm with:
 * - Noise-based grass ground with organic variation
 * - Fenced plots for directories with spacing and jitter
 * - Crops for files placed INSIDE their parent directory plots
 * - MST-connected path network with auto-tiling and gates
 * - Clustered contextual decorations
 * - Multiple organic water features
 */

import { WorldMap } from './WorldMap';
import { TileType, Plot, PlacedModuleInfo, AutotilerConfig } from '../core/types';
import { FileNode, MapLayout, MapTile } from '../../core/codebase-mapper';
import { ModuleRegistry } from '../modules/ModuleRegistry';
import { placeModules, PlacerContext } from '../modules/ModulePlacer';
import { Autotiler } from '../core/Autotiler';

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

// ─── World Bounds ─────────────────────────────────────────────────────────────

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ─── Noise Utilities ──────────────────────────────────────────────────────────

/** Deterministic hash for 2D integer coordinates */
function hash2d(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  h = (h ^ (h >> 16)) >>> 0;
  return (h & 0x7fffffff) / 0x7fffffff; // [0, 1]
}

/** Smoothstep interpolation */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 2D value noise at continuous coordinates, returns [0, 1] */
function noise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const h00 = hash2d(ix, iy);
  const h10 = hash2d(ix + 1, iy);
  const h01 = hash2d(ix, iy + 1);
  const h11 = hash2d(ix + 1, iy + 1);

  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
}

/** Multi-octave noise for richer variation */
function fbmNoise(x: number, y: number, octaves: number = 2): number {
  let value = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let frequency = 1;

  for (let i = 0; i < octaves; i++) {
    value += noise2d(x * frequency, y * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / totalAmplitude;
}

/** Deterministic integer hash for a single value */
function intHash(n: number): number {
  let h = ((n * 2654435761) >>> 0);
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return (h ^ (h >> 16)) >>> 0;
}

/** Deterministic string hash */
function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0);
}

// ─── Plot Rectangle for spacing ───────────────────────────────────────────────

interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
  tile: MapTile;
  depth: number;
}

// ─── Union-Find for Kruskal's MST ────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;

    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return true;
  }
}

export class WorldGenerator {
  private map: WorldMap;
  private config: GeneratorConfig;
  private fileExtensionToCrop: Map<string, string>;
  private moduleRegistry: ModuleRegistry | null;
  private placedModules: PlacedModuleInfo[] = [];
  private autotiler: Autotiler;

  constructor(
    map: WorldMap,
    config: Partial<GeneratorConfig> = {},
    moduleRegistry?: ModuleRegistry,
    autotilerConfig?: AutotilerConfig
  ) {
    this.map = map;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.moduleRegistry = moduleRegistry ?? null;
    this.autotiler = new Autotiler(autotilerConfig ?? { version: 3, terrains: [], transitions: [] });

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
   * Generate world from existing treemap layout.
   *
   * Key fix: files are placed INSIDE their parent directory's plot (after
   * jitter + constraint relaxation), and ground is filled AFTER plot positions
   * are finalized so grass always covers the entire world.
   */
  generateFromLayout(layout: MapLayout): void {
    // Clear existing
    this.map.clearTiles();

    // Separate directory and file tiles (skip root directory at depth 0)
    const dirTiles = layout.tiles.filter(t => t.isDir && t.depth > 0);
    const fileTiles = layout.tiles.filter(t => !t.isDir);

    // 1. Compute directory plot rects (jitter + relax + normalize)
    const plotRects = this.computePlotRects(dirTiles);

    // 2. Compute raw world bounds, then normalize to 0-based coordinates
    //    This ensures all tile positions are non-negative, which simplifies
    //    the webview rendering transform.
    const rawBounds = this.computeWorldBounds(plotRects);
    const offsetX = -rawBounds.minX;
    const offsetY = -rawBounds.minY;

    // Shift all plot rects so the world starts at (0, 0)
    for (const rect of plotRects) {
      rect.x += offsetX;
      rect.y += offsetY;
    }

    const bounds: WorldBounds = {
      minX: 0,
      minY: 0,
      maxX: rawBounds.maxX + offsetX,
      maxY: rawBounds.maxY + offsetY,
    };

    // 3. Build lookup: directory path → PlotRect
    const dirLookup = new Map<string, PlotRect>();
    for (const rect of plotRects) {
      const dirPath = rect.tile.node?.path || '';
      dirLookup.set(dirPath, rect);
    }

    // 4. Update map dimensions to match world (tile units)
    this.map.setDimensions(bounds.maxX, bounds.maxY);

    // ── PHASE 1: TERRAIN FOUNDATION ──
    // All terrain tiles placed with default sprites, then autotiled.

    // 5. Fill ground with noise-based grass variants
    this.fillGround(bounds);

    // 6. Place tilled dirt inside directory plot areas
    for (const rect of plotRects) {
      this.fillTilledDirt(rect.x, rect.y, rect.width, rect.height);
    }

    // 7. Place pre-designed tile modules (may contain terrain tiles like water)
    if (this.moduleRegistry && this.moduleRegistry.size > 0) {
      const placerCtx: PlacerContext = {
        map: this.map,
        worldWidth: bounds.maxX - bounds.minX,
        worldHeight: bounds.maxY - bounds.minY,
        plots: plotRects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
        pathCount: plotRects.length,
      };
      this.placedModules = placeModules(this.moduleRegistry, placerCtx);
    }

    // 8. Water features
    this.generateWater(bounds);

    // 9. Path network (tiles placed with default sprites)
    this.generatePaths();

    // 10. Unified autotile pass — resolves sprites for ALL terrain types
    this.autoTileAllTerrain();

    // ── PHASE 2: WORLD OBJECTS ──
    // Props, structures, and decorations placed on top of terrain.

    // 11. Fences around directory plots
    for (const rect of plotRects) {
      this.createFence(rect.x, rect.y, rect.width, rect.height);
    }

    // 12. Create plot records for directories
    for (const rect of plotRects) {
      this.createDirectoryPlotRecord(rect);
    }

    // 13. Gates where paths meet fences
    this.placeFenceGates();

    // 14. File crops inside directory plots
    this.placeFileCropsInDirectories(fileTiles, dirLookup, bounds);

    // 15. Environmental decorations
    this.placeDecorations(bounds);
  }

  /** Get modules placed during the last generation */
  getPlacedModules(): PlacedModuleInfo[] {
    return this.placedModules;
  }

  // ─── World Bounds ──────────────────────────────────────────────────────────

  /**
   * Compute actual tile extents from all plot rects, with generous grass margin.
   */
  private computeWorldBounds(plotRects: PlotRect[]): WorldBounds {
    if (plotRects.length === 0) {
      return { minX: -5, minY: -5, maxX: 35, maxY: 35 };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rect of plotRects) {
      minX = Math.min(minX, rect.x - 2); // -2 for fence + margin
      minY = Math.min(minY, rect.y - 2);
      maxX = Math.max(maxX, rect.x + rect.width + 2);
      maxY = Math.max(maxY, rect.y + rect.height + 2);
    }

    // Add generous grass margin around all plots
    const margin = 6;
    return {
      minX: minX - margin,
      minY: minY - margin,
      maxX: maxX + margin,
      maxY: maxY + margin,
    };
  }

  // ─── Ground Generation ────────────────────────────────────────────────────

  /**
   * Fill the ground layer with noise-based grass variation.
   * Reads defaultTile and variants from terrain config.
   */
  private fillGround(bounds: WorldBounds): void {
    const grassConfig = this.autotiler.getTerrainConfig('grass');
    const defaultTile = grassConfig?.defaultTile || 't_1_1';
    const variants = grassConfig?.variants || [];
    const sheet = grassConfig?.spritesheet || 'grass';

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        let variant: number;
        let spriteId: string;

        if (variants.length > 0) {
          // Two-octave noise for organic grass variation
          const n = fbmNoise(x * 0.15, y * 0.15, 2);

          if (n < 0.5) {
            variant = 0;
            spriteId = `${sheet}/${defaultTile}`;
          } else {
            // Distribute noise across available variants
            const vi = Math.min(variants.length - 1, Math.floor((n - 0.5) * 2 * variants.length));
            variant = vi + 1;
            spriteId = `${sheet}/${variants[vi]}`;
          }
        } else {
          variant = 0;
          spriteId = `${sheet}/${defaultTile}`;
        }

        this.map.setTile(x, y, 'grass', spriteId, variant, LAYER_GROUND);
      }
    }
  }

  // ─── Plot Spacing & Jitter ──────────────────────────────────────────────

  /**
   * Convert MapTiles to plot rectangles with spacing enforcement and jitter.
   * Enforces both min AND max plot dimensions.
   */
  private computePlotRects(dirTiles: MapTile[]): PlotRect[] {
    if (dirTiles.length === 0) return [];

    // Convert pixel coordinates to tile rectangles, clamping to min/max
    const rects: PlotRect[] = dirTiles.map(tile => {
      const x = Math.floor(tile.x / 16);
      const y = Math.floor(tile.y / 16);
      const width = Math.min(
        this.config.maxPlotWidth,
        Math.max(this.config.minPlotWidth, Math.ceil(tile.width / 16))
      );
      const height = Math.min(
        this.config.maxPlotHeight,
        Math.max(this.config.minPlotHeight, Math.ceil(tile.height / 16))
      );

      return { x, y, width, height, tile, depth: tile.depth };
    });

    // Apply deterministic jitter (0 or 1 tile offset based on path hash)
    for (const rect of rects) {
      const pathStr = rect.tile.node?.path || `${rect.x},${rect.y}`;
      const h = stringHash(pathStr);
      rect.x += (h % 3) - 1;          // -1, 0, or 1
      rect.y += ((h >> 8) % 3) - 1;   // -1, 0, or 1
    }

    // Constraint relaxation: push overlapping/too-close plots apart
    // Minimum gap between plot interiors = 3 tiles
    // (1 tile fence-A + 1 tile grass/path + 1 tile fence-B)
    const minGap = 3;

    for (let iter = 0; iter < 15; iter++) {
      let anyMoved = false;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];

          // Compute the gap between plot edges on each axis
          // Positive = separated, negative = overlapping
          const hGap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
          const vGap = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));

          // If separated on either axis by >= minGap, no conflict
          if (hGap >= minGap || vGap >= minGap) continue;

          // Both axes within minGap — push apart on the axis with least overlap
          const aCenterX = a.x + a.width / 2;
          const aCenterY = a.y + a.height / 2;
          const bCenterX = b.x + b.width / 2;
          const bCenterY = b.y + b.height / 2;
          const dx = bCenterX - aCenterX;
          const dy = bCenterY - aCenterY;

          if (Math.abs(dx) >= Math.abs(dy)) {
            // Push horizontally — proportional to the deficit
            const neededPush = Math.max(1, Math.ceil((minGap - hGap) / 2));
            const dir = dx >= 0 ? 1 : -1;
            a.x -= dir * neededPush;
            b.x += dir * neededPush;
          } else {
            // Push vertically — proportional to the deficit
            const neededPush = Math.max(1, Math.ceil((minGap - vGap) / 2));
            const dir = dy >= 0 ? 1 : -1;
            a.y -= dir * neededPush;
            b.y += dir * neededPush;
          }
          anyMoved = true;
        }
      }
      if (!anyMoved) break;
    }

    // Ensure no plot has negative coordinates (push all into positive space)
    let minX = 0;
    let minY = 0;
    for (const rect of rects) {
      if (rect.x - 1 < minX) minX = rect.x - 1; // -1 for fence
      if (rect.y - 1 < minY) minY = rect.y - 1;
    }
    if (minX < 0 || minY < 0) {
      for (const rect of rects) {
        rect.x -= minX;
        rect.y -= minY;
      }
    }

    return rects;
  }

  /**
   * Create a plot record for a directory (no tile placement — that's done in terrain phase)
   */
  private createDirectoryPlotRecord(rect: PlotRect): void {
    const { x: startX, y: startY, width, height, tile } = rect;
    const plot: Plot = {
      id: tile.node?.path || `${startX},${startY}`,
      x: startX,
      y: startY,
      width,
      height,
      filePath: tile.node?.path || '',
      isDirectory: true,
      cropType: 'directory',
      growthStage: 0,
      activity: 0,
      isActive: false,
      cropSpriteId: '',
    };
    this.map.addPlot(plot);
  }

  // ─── File → Directory Crop Placement ───────────────────────────────────────

  /**
   * Place file crops inside their parent directory plots.
   * Groups files by parent directory and lays them out in a grid
   * within the fenced area.
   */
  private placeFileCropsInDirectories(
    fileTiles: MapTile[],
    dirLookup: Map<string, PlotRect>,
    bounds: WorldBounds
  ): void {
    // Group files by their parent directory
    const filesByDir = new Map<string, MapTile[]>();
    const orphanFiles: MapTile[] = [];

    for (const tile of fileTiles) {
      const filePath = tile.node?.path || '';
      const parentDir = this.getParentDirectory(filePath);
      const dirRect = this.findParentPlotRect(parentDir, dirLookup);

      if (dirRect) {
        const dirPath = dirRect.tile.node?.path || '';
        if (!filesByDir.has(dirPath)) {
          filesByDir.set(dirPath, []);
        }
        filesByDir.get(dirPath)!.push(tile);
      } else {
        // No parent directory found — orphan (root-level file)
        orphanFiles.push(tile);
      }
    }

    // For each directory, lay out its files in a grid inside the plot
    for (const [dirPath, files] of filesByDir) {
      const rect = dirLookup.get(dirPath);
      if (!rect) continue;
      this.placeFilesInPlotGrid(files, rect);
    }

    // Place orphan files (root-level) as standalone crops on the grass
    this.placeOrphanFiles(orphanFiles, bounds);
  }

  /**
   * Get the parent directory path from a file path.
   * "src/core/types.ts" → "src/core"
   * "package.json" → ""
   */
  private getParentDirectory(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
  }

  /**
   * Walk up the path hierarchy to find the deepest matching PlotRect.
   * "src/core/utils" tries: "src/core/utils" → "src/core" → "src"
   */
  private findParentPlotRect(dirPath: string, lookup: Map<string, PlotRect>): PlotRect | null {
    let current = dirPath;
    while (current) {
      if (lookup.has(current)) {
        return lookup.get(current)!;
      }
      const lastSlash = current.lastIndexOf('/');
      current = lastSlash > 0 ? current.substring(0, lastSlash) : '';
    }
    // Try root
    if (lookup.has('')) {
      return lookup.get('')!;
    }
    return null;
  }

  /**
   * Lay out files as crop tiles in a grid inside a directory plot.
   * Uses interior tiles (1 tile inset from edges for tilled dirt borders).
   */
  private placeFilesInPlotGrid(files: MapTile[], rect: PlotRect): void {
    const { x: startX, y: startY, width, height } = rect;

    // Interior area for crops (leave 1 tile border for tilled dirt edge sprites)
    const interiorX = startX + 1;
    const interiorY = startY + 1;
    const interiorW = Math.max(1, width - 2);
    const interiorH = Math.max(1, height - 2);

    const maxSlots = interiorW * interiorH;
    const filesToPlace = files.slice(0, maxSlots);

    for (let i = 0; i < filesToPlace.length; i++) {
      const col = i % interiorW;
      const row = Math.floor(i / interiorW);
      if (row >= interiorH) break;

      const tileX = interiorX + col;
      const tileY = interiorY + row;

      this.createFilePlotAt(filesToPlace[i], tileX, tileY);
    }
  }

  /**
   * Place orphan files (no parent directory plot) on the grass.
   * Creates a row of crops along the bottom of the world.
   */
  private placeOrphanFiles(files: MapTile[], bounds: WorldBounds): void {
    if (files.length === 0) return;

    // Place in a row at the top-left area of the world
    const startX = bounds.minX + 2;
    const startY = bounds.minY + 2;
    const maxCols = Math.min(files.length, bounds.maxX - bounds.minX - 4);

    for (let i = 0; i < files.length && i < maxCols; i++) {
      this.createFilePlotAt(files[i], startX + i, startY);
    }
  }

  /**
   * Create a crop plot for a file at a specific tile coordinate.
   */
  private createFilePlotAt(tile: MapTile, x: number, y: number): void {
    const cropType = this.getCropType(tile.node?.name || '');
    const readCount = tile.node?.readCount || 0;
    const writeCount = tile.node?.writeCount || 0;
    const activity = readCount + writeCount;
    // Writes count 3× more — actively-edited files grow faster
    const weightedActivity = readCount + writeCount * 3;
    const growthStage = Math.min(3, Math.floor(Math.sqrt(weightedActivity)));

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
      isActive: tile.node?.isActive || false,
      cropSpriteId: '',
    };
    plot.cropSpriteId = this.getCropSprite(plot);
    this.map.addPlot(plot);

    // Place crop tile on the map
    this.map.setTile(x, y, 'tilled', plot.cropSpriteId, 0, LAYER_CROPS);
  }

  // ─── Tile Placement Helpers ──────────────────────────────────────────────

  /**
   * Fill area with tilled dirt (default sprite — autotiler handles edges/corners)
   */
  private fillTilledDirt(startX: number, startY: number, width: number, height: number): void {
    const tilledConfig = this.autotiler.getTerrainConfig('tilled');
    const defaultTile = tilledConfig?.defaultTile || 't_1_1';
    const sheet = tilledConfig?.spritesheet || 'tilled-dirt';
    const spriteId = `${sheet}/${defaultTile}`;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.map.setTile(startX + x, startY + y, 'tilled', spriteId, 0, LAYER_GROUND);
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

  // ─── Crop Helpers ─────────────────────────────────────────────────────────

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

  // ─── Water Generation ─────────────────────────────────────────────────────

  /**
   * Generate 1-3 organic water features in open areas
   */
  private generateWater(bounds: WorldBounds): void {
    const maxTileX = bounds.maxX;
    const maxTileY = bounds.maxY;
    const minTileX = bounds.minX;
    const minTileY = bounds.minY;

    // Score macro cells to find open areas far from plots
    const cellSize = 6;
    const plots = this.map.getAllPlots().filter(p => p.isDirectory);

    interface PondCandidate {
      cx: number;
      cy: number;
      score: number;
    }

    const candidates: PondCandidate[] = [];

    for (let cy = minTileY + 2; cy < maxTileY - 2; cy += cellSize) {
      for (let cx = minTileX + 2; cx < maxTileX - 2; cx += cellSize) {
        // Score = minimum distance to any plot
        let minDist = Infinity;
        for (const plot of plots) {
          const dx = (cx - (plot.x + plot.width / 2));
          const dy = (cy - (plot.y + plot.height / 2));
          const dist = Math.sqrt(dx * dx + dy * dy);
          minDist = Math.min(minDist, dist);
        }
        candidates.push({ cx, cy, score: minDist });
      }
    }

    // Sort by score (furthest from plots first)
    candidates.sort((a, b) => b.score - a.score);

    // Place 1-3 ponds depending on world size
    const worldWidth = maxTileX - minTileX;
    const worldHeight = maxTileY - minTileY;
    const worldArea = worldWidth * worldHeight;
    const pondCount = worldArea > 1500 ? 3 : worldArea > 600 ? 2 : 1;
    const pondMinSeparation = 8;

    const placedPonds: { cx: number; cy: number }[] = [];

    for (const candidate of candidates) {
      if (placedPonds.length >= pondCount) break;
      if (candidate.score < 4) continue; // Too close to a plot

      // Check separation from other ponds
      let tooClose = false;
      for (const placed of placedPonds) {
        const dist = Math.sqrt((candidate.cx - placed.cx) ** 2 + (candidate.cy - placed.cy) ** 2);
        if (dist < pondMinSeparation) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Place pond with noise-modulated shape
      const radius = placedPonds.length === 0 ? 3 : 2; // Primary is bigger
      this.placeOrganicPond(candidate.cx, candidate.cy, radius);
      placedPonds.push({ cx: candidate.cx, cy: candidate.cy });
    }

    // Fallback: if no good candidates, place one near the edge
    if (placedPonds.length === 0) {
      const pondCenterX = Math.floor(minTileX + worldWidth * 0.85);
      const pondCenterY = Math.floor(minTileY + worldHeight * 0.8);
      this.placeOrganicPond(pondCenterX, pondCenterY, 2);
    }
  }

  /**
   * Place a single pond with noise-modulated organic shape
   */
  private placeOrganicPond(centerX: number, centerY: number, baseRadius: number): void {
    const scanRadius = baseRadius + 2;

    for (let y = centerY - scanRadius; y <= centerY + scanRadius; y++) {
      for (let x = centerX - scanRadius; x <= centerX + scanRadius; x++) {
        const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        // Noise-modulated threshold for irregular edges
        const threshold = baseRadius + noise2d(x * 0.5, y * 0.5) * 1.5 - 0.5;

        if (dist <= threshold) {
          // Don't overwrite tilled dirt, fences, or crops
          const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
          const cropTile = this.map.getTile(x, y, LAYER_CROPS);
          if (terrainTile || cropTile) continue;

          const groundTile = this.map.getTile(x, y, LAYER_GROUND);
          if (groundTile && groundTile.type === 'tilled') continue;

          const waterConfig = this.autotiler.getTerrainConfig('water');
          const waterTile = waterConfig?.defaultTile || 't_0_0';
          const waterSheet = waterConfig?.spritesheet || 'water';
          this.map.setTile(x, y, 'water', `${waterSheet}/${waterTile}`, 0, LAYER_GROUND);
        }
      }
    }
  }

  // ─── Path Generation (MST) ──────────────────────────────────────────────

  /**
   * Generate paths connecting all directory plots using MST.
   * All plots are guaranteed to be connected.
   */
  private generatePaths(): void {
    const plots = this.map.getAllPlots().filter(p => p.isDirectory);
    if (plots.length < 2) return;

    // Build edges between all pairs
    interface Edge {
      i: number;
      j: number;
      dist: number;
    }

    const edges: Edge[] = [];
    for (let i = 0; i < plots.length; i++) {
      for (let j = i + 1; j < plots.length; j++) {
        const a = plots[i];
        const b = plots[j];
        const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
        const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
        const dist = Math.abs(dx) + Math.abs(dy);
        edges.push({ i, j, dist });
      }
    }

    // Sort by distance for Kruskal's
    edges.sort((a, b) => a.dist - b.dist);

    // MST using Union-Find
    const uf = new UnionFind(plots.length);
    const mstEdges: Edge[] = [];
    const extraEdges: Edge[] = [];

    for (const edge of edges) {
      if (uf.union(edge.i, edge.j)) {
        mstEdges.push(edge);
      } else if (extraEdges.length < 2 && edge.dist < edges[0].dist * 3) {
        // Add up to 2 short extra edges for loops
        extraEdges.push(edge);
      }
    }

    const allPathEdges = [...mstEdges, ...extraEdges];

    // Place Manhattan paths for each edge
    for (const edge of allPathEdges) {
      const plotA = plots[edge.i];
      const plotB = plots[edge.j];

      // Path from center-bottom of one to center-top of other
      const startX = Math.floor(plotA.x + plotA.width / 2);
      const startY = plotA.y + plotA.height;
      const endX = Math.floor(plotB.x + plotB.width / 2);
      const endY = plotB.y - 1;

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

    // Path sprites are resolved by the unified autoTileAllTerrain() pass
  }

  /**
   * Place a single path tile if the location is open (grass or water-adjacent)
   */
  private placePath(x: number, y: number): void {
    const groundTile = this.map.getTile(x, y, LAYER_GROUND);
    // Only place on grass, not on tilled dirt or water
    if (!groundTile || groundTile.type !== 'grass') return;

    // Don't place on fence or crop locations
    const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
    if (terrainTile) return;

    const pathConfig = this.autotiler.getTerrainConfig('path');
    const pathTile = pathConfig?.defaultTile || 't_0_0';
    const pathSheet = pathConfig?.spritesheet || 'paths';
    this.map.setTile(x, y, 'path', `${pathSheet}/${pathTile}`, 0, LAYER_GROUND);
  }


  /**
   * Replace fence tiles with gates where paths are adjacent
   */
  private placeFenceGates(): void {
    const allTiles = this.map.getAllTiles();
    const pathPositions = new Set<string>();

    // Build set of path positions
    for (const tile of allTiles) {
      if (tile.type === 'path' && tile.layer === LAYER_GROUND) {
        pathPositions.add(`${tile.x},${tile.y}`);
      }
    }

    // Check each fence tile for adjacent paths
    for (const tile of allTiles) {
      if (tile.type !== 'fence' || tile.layer !== LAYER_TERRAIN) continue;

      const { x, y } = tile;
      const hasAdjacentPath =
        pathPositions.has(`${x},${y - 1}`) ||
        pathPositions.has(`${x},${y + 1}`) ||
        pathPositions.has(`${x + 1},${y}`) ||
        pathPositions.has(`${x - 1},${y}`);

      if (hasAdjacentPath) {
        // Don't replace corner fences (they look wrong as gates)
        if (tile.spriteId.includes('corner')) continue;
        this.map.setTile(x, y, 'fence-gate', 'fences/fence-gate', 0, LAYER_TERRAIN);
      }
    }
  }

  // ─── Unified Terrain Autotiling ──────────────────────────────────────────

  /** Terrain types processed by the autotiler */
  private static readonly TERRAIN_TYPES: ReadonlySet<TileType> = new Set([
    'grass', 'tilled', 'water', 'path',
  ]);

  /**
   * Unified autotile pass for all terrain types on the ground layer.
   * Resolves sprites based on neighbor bitmask configuration.
   * Tiles with "" bitmask entries (e.g., interior grass) keep their existing sprites.
   */
  private autoTileAllTerrain(): void {
    const terrainTiles = this.map.getAllTiles()
      .filter(t => t.layer === LAYER_GROUND && WorldGenerator.TERRAIN_TYPES.has(t.type));

    const getTileType = (x: number, y: number, layer?: number): TileType | null => {
      const tile = this.map.getTile(x, y, layer ?? 0);
      return tile?.type ?? null;
    };

    const setSprite = (x: number, y: number, spriteId: string): void => {
      const tile = this.map.getTile(x, y, LAYER_GROUND);
      if (tile) {
        this.map.setTile(x, y, tile.type, spriteId, tile.variant, LAYER_GROUND);
      }
    };

    this.autotiler.autotileTerrain(
      terrainTiles.map(t => ({ x: t.x, y: t.y, type: t.type })),
      getTileType,
      setSprite
    );
  }

  // ─── Clustered Decoration System ──────────────────────────────────────────

  /**
   * Place decorations with contextual clustering.
   */
  private placeDecorations(bounds: WorldBounds): void {
    // Collect contextual info for clustering
    const waterPositions = new Set<string>();
    const pathPositions = new Set<string>();

    for (const tile of this.map.getAllTiles()) {
      if (tile.type === 'water') waterPositions.add(`${tile.x},${tile.y}`);
      if (tile.type === 'path') pathPositions.add(`${tile.x},${tile.y}`);
    }

    // Pre-compute flower seed points near water and paths
    const flowerSeeds: { x: number; y: number }[] = [];
    const mushroomSeeds: { x: number; y: number }[] = [];

    // Find 3-5 flower seed points near water
    for (const pos of waterPositions) {
      const [wx, wy] = pos.split(',').map(Number);
      const h = intHash(wx * 31 + wy * 17);
      if ((h % 3) === 0) { // ~33% of water tiles become seeds
        flowerSeeds.push({ x: wx + ((h >> 4) % 5) - 2, y: wy + ((h >> 8) % 5) - 2 });
      }
      if (flowerSeeds.length >= 5) break;
    }

    // Find 2-3 mushroom clusters near world borders
    const worldWidth = bounds.maxX - bounds.minX;
    const worldHeight = bounds.maxY - bounds.minY;
    for (let i = 0; i < 3; i++) {
      const h = intHash(i * 7919 + 42);
      const edgeX = (h % 2 === 0)
        ? bounds.minX + ((h >> 4) % 4)
        : bounds.maxX - 3 + ((h >> 4) % 3);
      const edgeY = (h % 3 === 0)
        ? bounds.minY + ((h >> 8) % 4)
        : bounds.maxY - 3 + ((h >> 8) % 3);
      mushroomSeeds.push({ x: edgeX, y: edgeY });
    }

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        // Only place on open grass tiles
        const groundTile = this.map.getTile(x, y, LAYER_GROUND);
        const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
        const cropTile = this.map.getTile(x, y, LAYER_CROPS);

        if (!groundTile || groundTile.type !== 'grass') continue;
        if (terrainTile || cropTile) continue;

        const hash = ((x * 31 + y * 17) * 2654435761) >>> 0;
        const n = fbmNoise(x * 0.2, y * 0.2);

        // ── Pass 1: Grass tufts (most common, noise-based) ──
        if (n > 0.55 && (hash % 100) < 8) {
          const spriteId = (hash % 2 === 0) ? 'biome/grass-tuft-1' : 'biome/grass-tuft-2';
          this.map.setTile(x, y, 'decoration', spriteId, 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 2: Flowers (clustered near water/paths) ──
        let nearFlowerSeed = false;
        for (const seed of flowerSeeds) {
          const dist = Math.abs(x - seed.x) + Math.abs(y - seed.y);
          if (dist <= 4) { nearFlowerSeed = true; break; }
        }

        let nearPath = false;
        for (const dir of [[-1,0],[1,0],[0,-1],[0,1]]) {
          if (pathPositions.has(`${x + dir[0]},${y + dir[1]}`)) { nearPath = true; break; }
        }

        if (nearFlowerSeed && (hash % 100) < 15) {
          this.map.setTile(x, y, 'decoration', 'biome/flower-small', 0, LAYER_CROPS);
          continue;
        }
        if (nearPath && (hash % 100) < 3) {
          this.map.setTile(x, y, 'decoration', 'biome/flower-small', 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 3: Mushrooms (clustered near borders) ──
        let nearMushroomSeed = false;
        for (const seed of mushroomSeeds) {
          const dist = Math.abs(x - seed.x) + Math.abs(y - seed.y);
          if (dist <= 3) { nearMushroomSeed = true; break; }
        }

        if (nearMushroomSeed && (hash % 100) < 20) {
          const spriteId = (hash % 2 === 0) ? 'biome/mushroom-red' : 'biome/mushroom-brown';
          this.map.setTile(x, y, 'decoration', spriteId, 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 4: Stones (near water edges) ──
        let nearWater = false;
        for (const dir of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          if (waterPositions.has(`${x + dir[0]},${y + dir[1]}`)) { nearWater = true; break; }
        }

        if (nearWater && (hash % 100) < 25) {
          this.map.setTile(x, y, 'decoration', 'biome/stone-small', 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 5: Butterflies (only near existing flower decorations, max 5) ──
        // Check if we already placed a flower nearby (simple: check if any flower seed is close)
        if (nearFlowerSeed && (hash % 1000) < 5) {
          this.map.setTile(x, y, 'decoration', 'biome/butterfly-1', 0, LAYER_CROPS);
          continue;
        }

        // ── Sparse fallback: occasional decoration anywhere ──
        if ((hash % 100) < 1) {
          const idx = hash % 3;
          const sprites = ['biome/grass-tuft-1', 'biome/stone-small', 'biome/flower-small'];
          this.map.setTile(x, y, 'decoration', sprites[idx], 0, LAYER_CROPS);
        }
      }
    }
  }
}
