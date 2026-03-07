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

function computeBudget(worldArea: number, pathCount: number): ModuleBudget {
  if (worldArea < 400) {
    // Very small worlds - minimal modules
    return { landmark: 0, environment: 0, connector: 0, decorative: 1, vegetation: 3 };
  }
  return {
    landmark: Math.min(2, Math.floor(worldArea / 3000)),
    environment: Math.floor(worldArea / 500),
    connector: Math.floor(pathCount / 3),
    decorative: Math.floor(worldArea / 200),
    vegetation: Math.floor(worldArea / 50),  // ~40 for a 2000-tile world
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

  const budget = computeBudget(worldArea, pathCount);
  const placed: PlacedModuleInfo[] = [];
  const placedByType = new Map<string, number>();
  const placedByCategory = new Map<ModuleCategory, number>();

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

  // Get eligible modules sorted by priority: landmarks first, then env, connectors, vegetation, decorative
  const categoryPriority: Record<ModuleCategory, number> = {
    landmark: 0,
    environment: 1,
    connector: 2,
    vegetation: 3,
    decorative: 4,
  };

  const eligible = registry.getEligible(worldArea)
    .sort((a, b) => categoryPriority[a.category] - categoryPriority[b.category]);

  for (const moduleDef of eligible) {
    // Check category budget
    const catBudgetKey = moduleDef.category as keyof ModuleBudget;
    const catCount = placedByCategory.get(moduleDef.category) ?? 0;
    if (catCount >= budget[catBudgetKey]) continue;

    // Check per-module instance cap
    if (moduleDef.maxInstances >= 0) {
      const typeCount = placedByType.get(moduleDef.id) ?? 0;
      if (typeCount >= moduleDef.maxInstances) continue;
    }

    // Rarity check - probabilistic skip
    const rarityHash = hash2d(moduleDef.id.length * 37, catCount * 13 + placed.length);
    if (rarityHash > moduleDef.rarity) continue;

    // Try to place this module
    const result = findBestPosition(
      moduleDef,
      occupancy,
      ctx,
      placed,
      waterPositions,
      pathPositions
    );

    if (result) {
      // Stamp module tiles onto the map
      stampModule(map, moduleDef, result.x, result.y);

      // Mark occupancy (with 1-tile margin to prevent crowding)
      occupancy.markRect(result.x, result.y, moduleDef.width, moduleDef.height, 1);

      const info: PlacedModuleInfo = {
        moduleId: moduleDef.id,
        x: result.x,
        y: result.y,
        width: moduleDef.width,
        height: moduleDef.height,
      };
      placed.push(info);
      placedByType.set(moduleDef.id, (placedByType.get(moduleDef.id) ?? 0) + 1);
      placedByCategory.set(moduleDef.category, catCount + 1);
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

      // Compute score
      const aScore = affinityScore(
        x, y, moduleDef.width, moduleDef.height,
        worldWidth, worldHeight,
        placement.affinity,
        plots, waterPositions, pathPositions
      );

      // Deterministic noise for tiebreaking
      const noise = hash2d(x * 31 + moduleDef.id.length, y * 17 + placed.length) * 0.1;

      const score = aScore + noise;

      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  return best;
}

function stampModule(map: WorldMap, moduleDef: TileModuleDef, originX: number, originY: number): void {
  for (const tile of moduleDef.tiles) {
    map.setTile(
      originX + tile.x,
      originY + tile.y,
      tile.type,
      tile.spriteId,
      0,
      tile.layer
    );
  }
}
