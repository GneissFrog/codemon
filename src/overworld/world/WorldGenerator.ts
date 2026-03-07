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

/** Module-level seed — set by WorldGenerator before each generation pass */
let _seed = 0;

/** Deterministic hash for 2D integer coordinates, incorporating global seed */
function hash2d(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263 + _seed) >>> 0;
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

/** Deterministic integer hash for a single value, incorporating global seed */
function intHash(n: number): number {
  let h = (((n ^ _seed) * 2654435761) >>> 0);
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
  private seed: number;
  private subIslandSeeds: Array<{ cx: number; cy: number; radius: number }> | null = null;

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
    this.seed = Date.now();

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
  /** Set the seed for procedural generation. Call before generateFromLayout. */
  setSeed(seed: number): void {
    this.seed = seed;
  }

  /** Get the current seed */
  getSeed(): number {
    return this.seed;
  }

  generateFromLayout(layout: MapLayout): void {
    // Set module-level seed for all noise/hash functions
    _seed = this.seed;

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

    // 4. Update map dimensions to match world (tile count, not max coordinate)
    //    Tiles span [0..maxX] inclusive, so width = maxX + 1
    this.map.setDimensions(bounds.maxX + 1, bounds.maxY + 1);

    // ── PHASE 1: TERRAIN FOUNDATION ──
    // All terrain tiles placed with default sprites, then autotiled.

    // 4.5 Pre-compute sub-island seed positions for archipelago generation
    this.computeSubIslandSeeds(bounds, plotRects);

    // 5. Fill water base + archipelago island-shaped grass
    this.fillGround(bounds, plotRects);

    // 5.5 Inland ponds on larger islands
    this.generateWater(bounds, plotRects);

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
        seed: this.seed,
      };
      this.placedModules = placeModules(this.moduleRegistry, placerCtx);
    }

    // 8. Path network with water-crossing bridges
    this.generatePaths(plotRects);

    // 9. Unified autotile pass — resolves sprites for ALL terrain types
    this.autoTileAllTerrain();

    // Clean up generation state
    this.subIslandSeeds = null;

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
      minX = Math.min(minX, rect.x - 3); // -3 for fence + island margin
      minY = Math.min(minY, rect.y - 3);
      maxX = Math.max(maxX, rect.x + rect.width + 3);
      maxY = Math.max(maxY, rect.y + rect.height + 3);
    }

    // Generous margin for archipelago water border + sub-islands
    const margin = 10;
    return {
      minX: minX - margin,
      minY: minY - margin,
      maxX: maxX + margin,
      maxY: maxY + margin,
    };
  }

  // ─── Ground Generation ────────────────────────────────────────────────────

  /**
   * Fill terrain in two layers:
   * - LAYER_GROUND (0): water everywhere (base)
   * - LAYER_TERRAIN (1): grass on the island shape (autotiled edges show water beneath)
   */
  private fillGround(bounds: WorldBounds, plotRects: PlotRect[]): void {
    const waterConfig = this.autotiler.getTerrainConfig('water');
    const waterTile = waterConfig?.defaultTile || 't_0_0';
    const waterSheet = waterConfig?.spritesheet || 'water';
    const waterSprite = `${waterSheet}/${waterTile}`;

    const grassConfig = this.autotiler.getTerrainConfig('grass');
    const defaultTile = grassConfig?.defaultTile || 't_1_1';
    const variants = grassConfig?.variants || [];
    const sheet = grassConfig?.spritesheet || 'grass';

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        // Layer 0: water everywhere
        this.map.setTile(x, y, 'water', waterSprite, 0, LAYER_GROUND);

        // Layer 1: grass only on island
        if (!this.isLandTile(x, y, bounds, plotRects)) continue;

        let variant: number;
        let spriteId: string;

        if (variants.length > 0) {
          const n = fbmNoise(x * 0.15, y * 0.15, 2);
          if (n < 0.5) {
            variant = 0;
            spriteId = `${sheet}/${defaultTile}`;
          } else {
            const vi = Math.min(variants.length - 1, Math.floor((n - 0.5) * 2 * variants.length));
            variant = vi + 1;
            spriteId = `${sheet}/${variants[vi]}`;
          }
        } else {
          variant = 0;
          spriteId = `${sheet}/${defaultTile}`;
        }

        this.map.setTile(x, y, 'grass', spriteId, variant, LAYER_TERRAIN);
      }
    }
  }

  /**
   * Determine if a tile is part of the island landmass.
   *
   * Multi-source archipelago field:
   *  1. Plot buffer — tiles near any plot are always land
   *  2. Plot island blobs — each plot radiates influence; nearby plots merge
   *  3. Domain-warped noise field — creates broad land/water zones
   *  4. Decorative sub-islands — small islands in open water
   */
  private isLandTile(x: number, y: number, bounds: WorldBounds, plotRects: PlotRect[]): boolean {
    // ── Source 1: Plot buffer zones (guaranteed land) ──
    for (const plot of plotRects) {
      if (x >= plot.x - 3 && x <= plot.x + plot.width + 2 &&
          y >= plot.y - 3 && y <= plot.y + plot.height + 2) {
        return true;
      }
    }

    // ── Source 2: Per-plot island blobs ──
    // Each plot radiates an island shape; nearby plots accumulate influence
    // so clusters naturally merge into larger islands.
    let plotInfluence = 0;
    for (const plot of plotRects) {
      const pcx = plot.x + plot.width / 2;
      const pcy = plot.y + plot.height / 2;
      const plotRadius = Math.sqrt(plot.width * plot.width + plot.height * plot.height) / 2 + 5;
      const dx = x - pcx;
      const dy = y - pcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < plotRadius) {
        const t = dist / plotRadius;
        plotInfluence += (1 - t * t); // quadratic falloff, accumulates
      }
    }
    const coastNoise = noise2d(x * 0.15 + 50, y * 0.15 + 50) * 0.4;
    if (plotInfluence > 0.3 + coastNoise) {
      return true;
    }

    // ── Source 3: Domain-warped noise field ──
    // Low-frequency noise with domain warping for organic land/water zones
    const warpX = noise2d(x * 0.04 + 100, y * 0.04 + 200) * 6;
    const warpY = noise2d(x * 0.04 + 300, y * 0.04 + 400) * 6;
    const landNoise = fbmNoise((x + warpX) * 0.06, (y + warpY) * 0.06, 3);

    // Threshold scales with world size: larger worlds get more water channels
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    const worldArea = worldW * worldH;
    const baseThreshold = worldArea > 2000 ? 0.52 : worldArea > 800 ? 0.48 : 0.45;

    if (landNoise > baseThreshold) {
      // Edge falloff — prevent land at world bounds
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const hw = Math.max(1, (bounds.maxX - bounds.minX) / 2);
      const hh = Math.max(1, (bounds.maxY - bounds.minY) / 2);
      const edgeDx = (x - cx) / hw;
      const edgeDy = (y - cy) / hh;
      const edgeDist = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      if (edgeDist < 0.92) {
        return true;
      }
    }

    // ── Source 4: Decorative sub-islands ──
    return this.isSubIsland(x, y);
  }

  // ─── Sub-Island System ──────────────────────────────────────────────────

  /**
   * Pre-compute sub-island seed positions for decorative mini-islands.
   * Seeds are placed far from plots in open water areas.
   */
  private computeSubIslandSeeds(bounds: WorldBounds, plotRects: PlotRect[]): void {
    this.subIslandSeeds = [];
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    const worldArea = worldW * worldH;

    // Number of sub-islands scales with world size (2-6)
    const count = Math.min(6, Math.max(2, Math.floor(worldArea / 500)));

    for (let i = 0; i < count * 3; i++) {
      if (this.subIslandSeeds.length >= count) break;

      // Deterministic positions from hash
      const hx = hash2d(i * 7 + 1000, i * 13 + 2000);
      const hy = hash2d(i * 13 + 3000, i * 7 + 4000);
      const cx = bounds.minX + 4 + hx * (worldW - 8);
      const cy = bounds.minY + 4 + hy * (worldH - 8);

      // Must be far enough from all plots (at least 10 tiles)
      let tooClose = false;
      for (const plot of plotRects) {
        const dx = cx - (plot.x + plot.width / 2);
        const dy = cy - (plot.y + plot.height / 2);
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Small radius: 2-4 tiles
      const radius = 2 + hash2d(i * 17, i * 23) * 2;
      this.subIslandSeeds.push({ cx, cy, radius });
    }
  }

  /** Check if a tile falls within a decorative sub-island */
  private isSubIsland(x: number, y: number): boolean {
    if (!this.subIslandSeeds) return false;
    for (const seed of this.subIslandSeeds) {
      const dx = x - seed.cx;
      const dy = y - seed.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noiseOffset = noise2d(x * 0.3 + 500, y * 0.3 + 500) * 1.2;
      if (dist < seed.radius + noiseOffset) {
        return true;
      }
    }
    return false;
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
        this.map.setTile(startX + x, startY + y, 'tilled', spriteId, 0, LAYER_TERRAIN);
      }
    }
  }

  /**
   * Create fence around a plot.
   * Places grass on LAYER_GROUND beneath each fence so grass shows
   * through fence sprite transparency instead of water.
   */
  private createFence(startX: number, startY: number, width: number, height: number): void {
    const grassConfig = this.autotiler.getTerrainConfig('grass');
    const grassSprite = `${grassConfig?.spritesheet || 'grass'}/${grassConfig?.defaultTile || 't_1_1'}`;

    const placeFence = (x: number, y: number, spriteId: string) => {
      // Ensure grass underneath on LAYER_GROUND (replaces water)
      this.map.setTile(x, y, 'grass', grassSprite, 0, LAYER_GROUND);
      this.map.setTile(x, y, 'fence', spriteId, 0, LAYER_TERRAIN);
    };

    // Top and bottom fences
    for (let x = 0; x < width; x++) {
      placeFence(startX + x, startY - 1, 'fences/fence-horizontal');
      placeFence(startX + x, startY + height, 'fences/fence-horizontal');
    }

    // Left and right fences (excluding corners)
    for (let y = 0; y < height; y++) {
      placeFence(startX - 1, startY + y, 'fences/fence-vertical');
      placeFence(startX + width, startY + y, 'fences/fence-vertical');
    }

    // Corner posts
    placeFence(startX - 1, startY - 1, 'fences/fence-corner-tl');
    placeFence(startX + width, startY - 1, 'fences/fence-corner-tr');
    placeFence(startX - 1, startY + height, 'fences/fence-corner-bl');
    placeFence(startX + width, startY + height, 'fences/fence-corner-br');
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
   * Generate 1-3 organic water features (ponds) in open grass areas on islands.
   * Uses plotRects for distance scoring since Plot records aren't created yet.
   */
  private generateWater(bounds: WorldBounds, plotRects: PlotRect[]): void {
    const maxTileX = bounds.maxX;
    const maxTileY = bounds.maxY;
    const minTileX = bounds.minX;
    const minTileY = bounds.minY;

    // Score macro cells to find open areas far from plots
    const cellSize = 6;
    const plots = plotRects;

    interface PondCandidate {
      cx: number;
      cy: number;
      score: number;
    }

    const candidates: PondCandidate[] = [];

    for (let cy = minTileY + 2; cy < maxTileY - 2; cy += cellSize) {
      for (let cx = minTileX + 2; cx < maxTileX - 2; cx += cellSize) {
        // Only consider positions on land (grass on terrain layer)
        const terrainTile = this.map.getTile(cx, cy, LAYER_TERRAIN);
        if (!terrainTile || terrainTile.type !== 'grass') continue;

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

    // No fallback needed — in archipelago layout, water already exists between islands
  }

  /**
   * Place a single pond with noise-modulated organic shape.
   * Removes grass tiles on LAYER_TERRAIN to reveal water base on LAYER_GROUND.
   */
  private placeOrganicPond(centerX: number, centerY: number, baseRadius: number): void {
    const scanRadius = baseRadius + 2;

    for (let y = centerY - scanRadius; y <= centerY + scanRadius; y++) {
      for (let x = centerX - scanRadius; x <= centerX + scanRadius; x++) {
        const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        const threshold = baseRadius + noise2d(x * 0.5, y * 0.5) * 1.5 - 0.5;

        if (dist <= threshold) {
          // Only carve ponds out of grass tiles (not tilled, fences, etc.)
          const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
          if (!terrainTile || terrainTile.type !== 'grass') continue;

          // Remove grass to expose water base beneath
          this.map.removeTile(x, y, LAYER_TERRAIN);
        }
      }
    }
  }

  // ─── Path Generation (MST) ──────────────────────────────────────────────

  /**
   * Generate paths connecting all directory plots using MST.
   * Paths crossing water get bridge tiles; module-driven crossings when available.
   */
  private generatePaths(plotRects: PlotRect[]): void {
    if (plotRects.length < 2) return;

    // Build edges between all pairs
    interface Edge {
      i: number;
      j: number;
      dist: number;
    }

    const edges: Edge[] = [];
    for (let i = 0; i < plotRects.length; i++) {
      for (let j = i + 1; j < plotRects.length; j++) {
        const a = plotRects[i];
        const b = plotRects[j];
        const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
        const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
        const dist = Math.abs(dx) + Math.abs(dy);
        edges.push({ i, j, dist });
      }
    }

    // Sort by distance for Kruskal's
    edges.sort((a, b) => a.dist - b.dist);

    // MST using Union-Find
    const uf = new UnionFind(plotRects.length);
    const mstEdges: Edge[] = [];
    const extraEdges: Edge[] = [];

    for (const edge of edges) {
      if (uf.union(edge.i, edge.j)) {
        mstEdges.push(edge);
      } else if (extraEdges.length < 2 && edge.dist < edges[0].dist * 3) {
        extraEdges.push(edge);
      }
    }

    const allPathEdges = [...mstEdges, ...extraEdges];

    // Collect water crossing gaps for module-driven bridge placement
    const waterGaps: Array<{
      tiles: Array<{ x: number; y: number }>;
      direction: 'horizontal' | 'vertical';
    }> = [];

    // Place Manhattan paths for each edge, detecting water gaps
    for (const edge of allPathEdges) {
      const plotA = plotRects[edge.i];
      const plotB = plotRects[edge.j];

      const startX = Math.floor(plotA.x + plotA.width / 2);
      const startY = plotA.y + plotA.height;
      const endX = Math.floor(plotB.x + plotB.width / 2);
      const endY = plotB.y - 1;

      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);

      // Horizontal segment — walk tile by tile, detect water gaps
      // Only record gaps bounded by land on BOTH sides (no floating bridges)
      const MAX_BRIDGE_LENGTH = 8;
      let currentGap: Array<{ x: number; y: number }> | null = null;
      let hasLandBefore = false;
      for (let x = minX; x <= maxX; x++) {
        if (this.isWaterAt(x, startY)) {
          if (!currentGap) currentGap = [];
          currentGap.push({ x, y: startY });
        } else {
          if (currentGap && currentGap.length > 0
              && hasLandBefore
              && currentGap.length <= MAX_BRIDGE_LENGTH) {
            waterGaps.push({ tiles: currentGap, direction: 'horizontal' });
          }
          currentGap = null;
          hasLandBefore = true;
          this.placePath(x, startY);
        }
      }
      // Trailing gaps intentionally NOT recorded — no land on the far side

      // Vertical segment — same gap detection
      currentGap = null;
      hasLandBefore = false;
      for (let y = minY; y <= maxY; y++) {
        if (this.isWaterAt(endX, y)) {
          if (!currentGap) currentGap = [];
          currentGap.push({ x: endX, y });
        } else {
          if (currentGap && currentGap.length > 0
              && hasLandBefore
              && currentGap.length <= MAX_BRIDGE_LENGTH) {
            waterGaps.push({ tiles: currentGap, direction: 'vertical' });
          }
          currentGap = null;
          hasLandBefore = true;
          this.placePath(endX, y);
        }
      }
      // Trailing gaps intentionally NOT recorded — no land on the far side
    }

    // Place water crossings for detected gaps
    for (const gap of waterGaps) {
      this.placeWaterCrossing(gap);
    }
  }

  /** Check if a position is water (no terrain on layer 1, water on layer 0) */
  private isWaterAt(x: number, y: number): boolean {
    const terrain = this.map.getTile(x, y, LAYER_TERRAIN);
    if (terrain) return false; // has terrain — not open water
    const ground = this.map.getTile(x, y, LAYER_GROUND);
    return ground !== null && ground.type === 'water';
  }

  /**
   * Place a water crossing (bridge) for a detected gap.
   * Queries module registry for water-crossing modules; falls back to simple bridge tiles.
   */
  private placeWaterCrossing(gap: {
    tiles: Array<{ x: number; y: number }>;
    direction: 'horizontal' | 'vertical';
  }): void {
    if (gap.tiles.length === 0) return;

    const dirTag = gap.direction === 'vertical' ? 'north-south' : 'east-west';
    let moduleUsed = false;

    // Try module-driven crossing
    if (this.moduleRegistry && this.moduleRegistry.size > 0) {
      const crossingModules = this.moduleRegistry.getByTags(['water-crossing'])
        .filter(m => m.tags.includes(dirTag));

      if (crossingModules.length > 0) {
        // Pick a module using deterministic random weighted by rarity
        const firstTile = gap.tiles[0];
        const h = hash2d(firstTile.x * 31 + 500, firstTile.y * 17 + 700);

        // Filter by size fit: module's spanning dimension should match gap length
        const spanDim = gap.direction === 'vertical' ? 'height' : 'width';
        const fitting = crossingModules.filter(m => m[spanDim] <= gap.tiles.length + 2);

        if (fitting.length > 0) {
          // Rarity-weighted selection
          const totalWeight = fitting.reduce((sum, m) => sum + m.rarity, 0);
          let target = h * totalWeight;
          let selected = fitting[0];
          for (const mod of fitting) {
            target -= mod.rarity;
            if (target <= 0) { selected = mod; break; }
          }

          // Stamp module centered on the gap
          const midIdx = Math.floor(gap.tiles.length / 2);
          const midTile = gap.tiles[midIdx];
          const originX = midTile.x - Math.floor(selected.width / 2);
          const originY = midTile.y - Math.floor(selected.height / 2);

          for (const tile of selected.tiles) {
            this.map.setTile(
              originX + tile.x, originY + tile.y,
              tile.type, tile.spriteId, 0, tile.layer
            );
          }
          moduleUsed = true;
        }
      }
    }

    // Fallback: place simple bridge tiles
    if (!moduleUsed) {
      for (const pos of gap.tiles) {
        const spriteId = gap.direction === 'vertical'
          ? 'bridges/bridge-v-mid-a'
          : 'bridges/bridge-h-mid-a';
        this.map.setTile(pos.x, pos.y, 'bridge', spriteId, 0, LAYER_TERRAIN);
      }
    }
  }

  /**
   * Place a single path tile on grass
   */
  private placePath(x: number, y: number): void {
    const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
    if (!terrainTile || terrainTile.type !== 'grass') return;

    const cropTile = this.map.getTile(x, y, LAYER_CROPS);
    if (cropTile) return;

    const pathConfig = this.autotiler.getTerrainConfig('path');
    const pathTile = pathConfig?.defaultTile || 't_0_0';
    const pathSheet = pathConfig?.spritesheet || 'paths';
    this.map.setTile(x, y, 'path', `${pathSheet}/${pathTile}`, 0, LAYER_TERRAIN);
  }


  /**
   * Replace fence tiles with gates where paths are adjacent
   */
  private placeFenceGates(): void {
    const allTiles = this.map.getAllTiles();
    const pathPositions = new Set<string>();

    // Build set of path positions
    for (const tile of allTiles) {
      if (tile.type === 'path' && tile.layer === LAYER_TERRAIN) {
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
    'grass', 'tilled', 'water', 'path', 'bridge',
  ]);

  /**
   * Unified autotile pass for all terrain types on the terrain layer.
   * Resolves sprites based on neighbor bitmask configuration.
   * Tiles with "" bitmask entries (e.g., interior grass) keep their existing sprites.
   */
  private autoTileAllTerrain(): void {
    const terrainTiles = this.map.getAllTiles()
      .filter(t => t.layer === LAYER_TERRAIN && WorldGenerator.TERRAIN_TYPES.has(t.type));

    const getTileType = (x: number, y: number, layer?: number): TileType | null => {
      const tile = this.map.getTile(x, y, layer ?? LAYER_TERRAIN);
      return tile?.type ?? null;
    };

    const setSprite = (x: number, y: number, spriteId: string): void => {
      const tile = this.map.getTile(x, y, LAYER_TERRAIN);
      if (tile) {
        this.map.setTile(x, y, tile.type, spriteId, tile.variant, LAYER_TERRAIN);
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
   * Place ground-level decorations (grass tufts, flowers, butterflies).
   * Mushrooms, stones, and bush clusters are handled by the module system.
   */
  private placeDecorations(bounds: WorldBounds): void {
    const pathPositions = new Set<string>();

    for (const tile of this.map.getAllTiles()) {
      if (tile.type === 'path') pathPositions.add(`${tile.x},${tile.y}`);
    }

    // Pre-compute flower seed points near paths and island edges
    const flowerSeeds: { x: number; y: number }[] = [];
    for (const pos of pathPositions) {
      const [px, py] = pos.split(',').map(Number);
      const h = intHash(px * 31 + py * 17);
      if ((h % 4) === 0) {
        flowerSeeds.push({ x: px + ((h >> 4) % 5) - 2, y: py + ((h >> 8) % 5) - 2 });
      }
      if (flowerSeeds.length >= 8) break;
    }

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        // Only place on open grass tiles (grass is on LAYER_TERRAIN)
        const terrainTile = this.map.getTile(x, y, LAYER_TERRAIN);
        const cropTile = this.map.getTile(x, y, LAYER_CROPS);

        if (!terrainTile || terrainTile.type !== 'grass') continue;
        if (cropTile) continue;

        const hash = ((x * 31 + y * 17) * 2654435761) >>> 0;
        const n = fbmNoise(x * 0.2, y * 0.2);

        // ── Pass 1: Grass tufts (most common, noise-based) ──
        if (n > 0.55 && (hash % 100) < 14) {
          const spriteId = (hash % 2 === 0) ? 'biome/grass-tuft-1' : 'biome/grass-tuft-2';
          this.map.setTile(x, y, 'decoration', spriteId, 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 2: Flowers (clustered near paths and flower seeds) ──
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
        if (nearPath && (hash % 100) < 7) {
          this.map.setTile(x, y, 'decoration', 'biome/flower-small', 0, LAYER_CROPS);
          continue;
        }

        // ── Pass 3: Butterflies (near flower clusters) ──
        if (nearFlowerSeed && (hash % 1000) < 12) {
          this.map.setTile(x, y, 'decoration', 'biome/butterfly-1', 0, LAYER_CROPS);
          continue;
        }
      }
    }
  }
}
