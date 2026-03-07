/**
 * ModulePlacer — Scored placement algorithm for tile modules.
 *
 * Evaluates candidate positions for each eligible module, scores them
 * based on collision, distance, affinity, and connection factors,
 * then stamps the best-scoring modules onto the world map.
 */

import { WorldMap } from '../world/WorldMap';
import {
  TileModuleDef,
  PlacedModuleInfo,
  PlacementAffinity,
  ModuleCategory,
  ConnectionType,
  CategoryBudgetConfig,
} from '../core/types';
import { OccupancyGrid } from './OccupancyGrid';
import { ModuleRegistry } from './ModuleRegistry';

// ─── Budget Calculation ────────────────────────────────────────────────────

interface ModuleBudget {
  landmark: number;
  environment: number;
  connector: number;
  decorative: number;
  vegetation: number;
}

/** Default budget rules: { base: divisor for worldArea, perPath: divisor for pathCount } */
const DEFAULT_BUDGET_CONFIG: Record<string, CategoryBudgetConfig> = {
  landmark:    { base: 3000, max: 2 },
  environment: { base: 500 },
  connector:   { perPath: 3 },
  decorative:  { base: 200 },
  vegetation:  { base: 50 },
};

function computeBudget(
  worldArea: number,
  pathCount: number,
  overrides?: Record<string, CategoryBudgetConfig>
): ModuleBudget {
  if (worldArea < 400) {
    // Very small worlds - minimal modules
    return { landmark: 0, environment: 0, connector: 0, decorative: 1, vegetation: 3 };
  }

  const configs = { ...DEFAULT_BUDGET_CONFIG, ...overrides };
  const result: Record<string, number> = {};

  for (const [cat, cfg] of Object.entries(configs)) {
    let count = 0;
    if (cfg.perPath !== undefined) {
      count = Math.floor(pathCount / cfg.perPath);
    } else if (cfg.base !== undefined) {
      count = Math.floor(worldArea / cfg.base);
    }
    if (cfg.max !== undefined) count = Math.min(count, cfg.max);
    if (cfg.min !== undefined) count = Math.max(count, cfg.min);
    result[cat] = count;
  }

  return {
    landmark:    result.landmark ?? 0,
    environment: result.environment ?? 0,
    connector:   result.connector ?? 0,
    decorative:  result.decorative ?? 0,
    vegetation:  result.vegetation ?? 0,
  };
}

// ─── Deterministic Hash ────────────────────────────────────────────────────

/** Module-level seed — set by placeModules before placement */
let _placerSeed = 0;

function hash2d(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + _placerSeed) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  h = (h ^ (h >> 16)) >>> 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

// ─── Scoring ───────────────────────────────────────────────────────────────

interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CandidateScore {
  x: number;
  y: number;
  score: number;
}

function distToRect(px: number, py: number, rect: PlotRect): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return Math.abs(px - cx) + Math.abs(py - cy); // Manhattan distance
}

function distToNearestPlot(px: number, py: number, plots: PlotRect[]): number {
  let min = Infinity;
  for (const p of plots) {
    const d = distToRect(px, py, p);
    if (d < min) min = d;
  }
  return min;
}

function affinityScore(
  x: number,
  y: number,
  width: number,
  height: number,
  worldW: number,
  worldH: number,
  affinity: PlacementAffinity,
  plots: PlotRect[],
  waterPositions: Set<string>,
  pathPositions: Set<string>
): number {
  const cx = x + width / 2;
  const cy = y + height / 2;

  switch (affinity) {
    case 'any':
      return 0.5;

    case 'edge': {
      const distToEdge = Math.min(cx, cy, worldW - cx, worldH - cy);
      const maxDist = Math.min(worldW, worldH) / 2;
      return 1.0 - Math.min(distToEdge / maxDist, 1.0);
    }

    case 'center': {
      const dx = Math.abs(cx - worldW / 2);
      const dy = Math.abs(cy - worldH / 2);
      const maxDist = Math.sqrt(worldW * worldW + worldH * worldH) / 2;
      return 1.0 - Math.min((dx + dy) / maxDist, 1.0);
    }

    case 'corner': {
      const corners = [
        [0, 0], [worldW, 0], [0, worldH], [worldW, worldH]
      ];
      let minDist = Infinity;
      for (const [cornerX, cornerY] of corners) {
        const d = Math.abs(cx - cornerX) + Math.abs(cy - cornerY);
        if (d < minDist) minDist = d;
      }
      const maxDist = worldW + worldH;
      return 1.0 - Math.min(minDist / maxDist, 1.0);
    }

    case 'near-water': {
      let minDist = Infinity;
      for (const pos of waterPositions) {
        const [wx, wy] = pos.split(',').map(Number);
        const d = Math.abs(cx - wx) + Math.abs(cy - wy);
        if (d < minDist) minDist = d;
      }
      if (minDist === Infinity) return 0.2; // No water in world
      return 1.0 - Math.min(minDist / 20, 1.0);
    }

    case 'near-path': {
      let minDist = Infinity;
      for (const pos of pathPositions) {
        const [px, py] = pos.split(',').map(Number);
        const d = Math.abs(cx - px) + Math.abs(cy - py);
        if (d < minDist) minDist = d;
      }
      if (minDist === Infinity) return 0.3; // No paths yet
      return 1.0 - Math.min(minDist / 15, 1.0);
    }

    case 'between-plots': {
      if (plots.length < 2) return 0.3;
      // Score based on being roughly equidistant from the two nearest plots
      const dists = plots.map(p => distToRect(cx, cy, p)).sort((a, b) => a - b);
      const d1 = dists[0];
      const d2 = dists[1];
      if (d1 + d2 === 0) return 0;
      const balance = 1.0 - Math.abs(d1 - d2) / (d1 + d2);
      return balance;
    }

    default:
      return 0.5;
  }
}

// ─── Connection Scoring ───────────────────────────────────────────────────────

/**
 * Check if the tile at (x,y) matches the expected connection type.
 * Checks terrain layer first, then ground layer.
 */
function checkConnectionMatch(
  connectionType: ConnectionType,
  x: number,
  y: number,
  map: WorldMap
): boolean {
  if (connectionType === 'any') return true;

  for (const layer of [1, 0]) {
    const tile = map.getTile(x, y, layer);
    if (!tile) continue;

    switch (connectionType) {
      case 'path':
        if (tile.type === 'path' || tile.type === 'bridge') return true;
        break;
      case 'grass':
        if (tile.type === 'grass') return true;
        break;
      case 'water':
        if (tile.type === 'water') return true;
        break;
      case 'fence':
        if (tile.type === 'fence' || tile.type === 'fence-gate') return true;
        break;
    }
  }
  return false;
}

/**
 * Score a module's connection points at a candidate position.
 * Returns null if any required connection is unsatisfied (hard reject).
 * Returns a ratio [0, 1] of matched optional connections otherwise.
 */
function connectionScore(
  moduleDef: TileModuleDef,
  originX: number,
  originY: number,
  map: WorldMap
): number | null {
  if (moduleDef.connectionPoints.length === 0) return 0;

  let matched = 0;
  let total = 0;

  for (const cp of moduleDef.connectionPoints) {
    // Compute adjacent tile position outside the module
    let adjX = originX + cp.x;
    let adjY = originY + cp.y;

    switch (cp.edge) {
      case 'north': adjY -= 1; break;
      case 'south': adjY += 1; break;
      case 'west':  adjX -= 1; break;
      case 'east':  adjX += 1; break;
    }

    const isMatch = checkConnectionMatch(cp.type, adjX, adjY, map);

    if (cp.required && !isMatch) {
      return null; // Hard reject
    }

    total++;
    if (isMatch) matched++;
  }

  return total === 0 ? 0 : matched / total;
}

// ─── Main Placer ───────────────────────────────────────────────────────────

export interface PlacerContext {
  map: WorldMap;
  worldWidth: number;
  worldHeight: number;
  plots: PlotRect[];
  pathCount: number;
  seed?: number;
}

export function placeModules(
  registry: ModuleRegistry,
  ctx: PlacerContext
): PlacedModuleInfo[] {
  const { map, worldWidth, worldHeight, plots, pathCount } = ctx;
  _placerSeed = ctx.seed ?? 0;
  const worldArea = worldWidth * worldHeight;

  // Skip modules for very small worlds
  if (worldArea < 200) return [];

  const budget = computeBudget(worldArea, pathCount, registry.getCategoryBudgets());
  const placed: PlacedModuleInfo[] = [];
  const placedByType = new Map<string, number>();

  // Build occupancy grid from existing plots (with 1-tile fence margin)
  const occupancy = new OccupancyGrid();
  for (const plot of plots) {
    occupancy.markRect(plot.x - 1, plot.y - 1, plot.width + 2, plot.height + 2, 0);
  }

  // Collect water and path positions for affinity scoring
  const waterPositions = new Set<string>();
  const pathPositions = new Set<string>();
  for (const tile of map.getAllTiles()) {
    if (tile.type === 'water') waterPositions.add(`${tile.x},${tile.y}`);
    if (tile.type === 'path') pathPositions.add(`${tile.x},${tile.y}`);
  }

  // Process categories in priority order, filling budget slots via weighted selection
  const categoryOrder: ModuleCategory[] = [
    'landmark', 'environment', 'connector', 'vegetation', 'decorative',
  ];

  const eligible = registry.getEligible(worldArea);
  // Group eligible modules by category
  const byCategory = new Map<ModuleCategory, TileModuleDef[]>();
  for (const mod of eligible) {
    const list = byCategory.get(mod.category) ?? [];
    list.push(mod);
    byCategory.set(mod.category, list);
  }

  for (const category of categoryOrder) {
    const catBudget = budget[category as keyof ModuleBudget];
    const candidates = byCategory.get(category);
    if (!candidates || candidates.length === 0 || catBudget <= 0) continue;

    for (let slot = 0; slot < catBudget; slot++) {
      // Filter candidates with remaining instance allowance
      const available = candidates.filter(m => {
        if (m.maxInstances >= 0) {
          const count = placedByType.get(m.id) ?? 0;
          if (count >= m.maxInstances) return false;
        }
        return true;
      });
      if (available.length === 0) break;

      // Weighted lottery among available candidates
      const totalWeight = available.reduce((sum, m) => sum + m.weight, 0);
      if (totalWeight <= 0) break;

      const roll = hash2d(category.length * 53 + slot * 97, placed.length * 31 + slot) * totalWeight;
      let cumulative = 0;
      let selected: TileModuleDef | null = null;
      for (const m of available) {
        cumulative += m.weight;
        if (roll < cumulative) {
          selected = m;
          break;
        }
      }
      if (!selected) selected = available[available.length - 1];

      // Rarity gate — probabilistic skip
      const rarityHash = hash2d(selected.id.length * 37, slot * 13 + placed.length);
      if (rarityHash > selected.rarity) continue;

      // Try to place this module
      const result = findBestPosition(
        selected,
        occupancy,
        ctx,
        placed,
        waterPositions,
        pathPositions
      );

      if (result) {
        const instanceIndex = placedByType.get(selected.id) ?? 0;
        stampModule(map, selected, result.x, result.y, instanceIndex);

        occupancy.markRect(result.x, result.y, selected.width, selected.height, 1);

        const info: PlacedModuleInfo = {
          moduleId: selected.id,
          x: result.x,
          y: result.y,
          width: selected.width,
          height: selected.height,
        };
        placed.push(info);
        placedByType.set(selected.id, instanceIndex + 1);
      }
    }
  }

  console.log(`[ModulePlacer] Placed ${placed.length} modules in ${worldWidth}x${worldHeight} world`);
  return placed;
}

function findBestPosition(
  moduleDef: TileModuleDef,
  occupancy: OccupancyGrid,
  ctx: PlacerContext,
  placed: PlacedModuleInfo[],
  waterPositions: Set<string>,
  pathPositions: Set<string>
): CandidateScore | null {
  const { map, worldWidth, worldHeight, plots } = ctx;
  const { placement } = moduleDef;

  // Scan candidates on a coarse grid (step = half module size for overlap coverage)
  const stepX = Math.max(2, Math.floor(moduleDef.width / 2));
  const stepY = Math.max(2, Math.floor(moduleDef.height / 2));

  let best: CandidateScore | null = null;

  for (let y = 1; y <= worldHeight - moduleDef.height - 1; y += stepY) {
    for (let x = 1; x <= worldWidth - moduleDef.width - 1; x += stepX) {
      // Quick rejection: occupancy collision
      if (!occupancy.isRectFree(x, y, moduleDef.width, moduleDef.height)) continue;

      // Check grass requirement
      if (placement.requiresGrass) {
        let allGrass = true;
        for (let dy = 0; dy < moduleDef.height && allGrass; dy++) {
          for (let dx = 0; dx < moduleDef.width && allGrass; dx++) {
            const tile = map.getTile(x + dx, y + dy, 1) ?? map.getTile(x + dx, y + dy, 0);
            if (!tile || tile.type !== 'grass') {
              // Allow overlap with water/decorations if the module permits
              if (tile?.type === 'water' && placement.allowOverlapWater) continue;
              if (tile?.type === 'decoration' && placement.allowOverlapDecorations) continue;
              allGrass = false;
            }
          }
        }
        if (!allGrass) continue;
      }

      // Distance checks
      const cx = x + moduleDef.width / 2;
      const cy = y + moduleDef.height / 2;

      const distPlot = distToNearestPlot(cx, cy, plots);
      if (distPlot < placement.minDistFromPlots) continue;

      // Distance from same module type
      let tooCloseSame = false;
      let tooCloseAny = false;
      for (const p of placed) {
        const d = Math.abs(cx - (p.x + p.width / 2)) + Math.abs(cy - (p.y + p.height / 2));
        if (p.moduleId === moduleDef.id && d < placement.minDistFromSame) {
          tooCloseSame = true;
          break;
        }
        if (d < placement.minDistFromAny) {
          tooCloseAny = true;
          break;
        }
      }
      if (tooCloseSame || tooCloseAny) continue;

      // Connection point validation
      const connScore = connectionScore(moduleDef, x, y, map);
      if (connScore === null) continue; // required connection unsatisfied

      // Compute score
      const aScore = affinityScore(
        x, y, moduleDef.width, moduleDef.height,
        worldWidth, worldHeight,
        placement.affinity,
        plots, waterPositions, pathPositions
      );

      // Deterministic noise for tiebreaking
      const noise = hash2d(x * 31 + moduleDef.id.length, y * 17 + placed.length) * 0.1;

      // Connection bonus: 0.0–0.3 based on matched connections
      const score = aScore + connScore * 0.3 + noise;

      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  return best;
}

function stampModule(
  map: WorldMap,
  moduleDef: TileModuleDef,
  originX: number,
  originY: number,
  instanceIndex: number
): void {
  const tiles = moduleDef.tiles;

  // Phase 1: Resolve sprite variants per tile
  const resolvedSprites = tiles.map((tile, i) => {
    if (tile.variants && tile.variants.length > 1) {
      const h = hash2d(
        originX * 7 + originY * 13 + i,
        instanceIndex * 31 + tile.x * 41 + tile.y * 59
      );
      const idx = Math.min(
        Math.floor(h * tile.variants.length),
        tile.variants.length - 1
      );
      return tile.variants[idx];
    }
    return tile.spriteId;
  });

  // Phase 2: Shuffle positions within swap groups (layer >= 2 only)
  const shuffledPos = new Map<number, { x: number; y: number }>();

  // Collect swap groups
  const groups = new Map<string, number[]>();
  for (let i = 0; i < tiles.length; i++) {
    const sg = tiles[i].swapGroup;
    if (sg && tiles[i].layer >= 2) {
      const list = groups.get(sg) ?? [];
      list.push(i);
      groups.set(sg, list);
    }
  }

  // Fisher-Yates shuffle each group's positions deterministically
  for (const [groupName, indices] of groups) {
    if (indices.length < 2) continue;

    const positions = indices.map(i => ({ x: tiles[i].x, y: tiles[i].y }));
    const shuffled = [...positions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const h = hash2d(
        originX * 11 + originY * 23 + groupName.length * 37,
        instanceIndex * 43 + i * 67
      );
      const j = Math.floor(h * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let k = 0; k < indices.length; k++) {
      shuffledPos.set(indices[k], shuffled[k]);
    }
  }

  // Phase 3: Stamp tiles
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const pos = shuffledPos.get(i) ?? { x: tile.x, y: tile.y };
    map.setTile(
      originX + pos.x,
      originY + pos.y,
      tile.type,
      resolvedSprites[i],
      0,
      tile.layer,
      tile.stateMachineId
    );
  }
}
