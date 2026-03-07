# World Generation Pipeline Reference

Complete reference for how SprocketMonsters transforms a file tree into a tile-based farm world.

---

## Overview

The pipeline converts a `MapLayout` (from CodebaseMapper's file tree scan) into a populated `WorldMap`. Generation happens in two phases:

**Phase 1 - Terrain Foundation**: ground fill, tilled dirt, modules, paths, autotiling
**Phase 2 - World Objects**: fences, plot records, gates, crops, decorations

Entry point: `WorldGenerator.generateFromLayout(layout: MapLayout)`

---

## Layer Model

```
LAYER_GROUND  (0)  Water base — fills entire world bounds
LAYER_TERRAIN (1)  Grass island, tilled dirt, paths, fences
LAYER_CROPS   (2)  Crops, decorations, module objects
```

Matches the Sprout Lands art design: water background, grass with transparent cliff edges on layer above, objects on top.

---

## Generation Steps (in order)

### 1. Seed & Clear

```
_seed = this.seed
map.clearTiles()
```

Module-level `_seed` variable flows into all `hash2d()` and `intHash()` calls. Same seed = same world.

### 2. Separate Directory & File Tiles

```typescript
const dirTiles = layout.tiles.filter(t => t.isDir && t.depth > 0);  // skip root
const fileTiles = layout.tiles.filter(t => !t.isDir);
```

### 3. Compute Plot Rectangles — `computePlotRects(dirTiles)`

Converts pixel coordinates to tile positions, then enforces layout constraints:

1. **Pixel to tile**: `x = floor(px / 16)`, clamped to `[minPlotWidth..maxPlotWidth]`
2. **Deterministic jitter**: -1, 0, or +1 tile offset per plot (based on path hash)
3. **Constraint relaxation** (15 iterations): push overlapping plots apart until minimum gap of 3 tiles is satisfied on both axes
4. **Normalize**: shift all plots into positive coordinate space

**Config defaults**: min 4x4, max 20x15, padding 2

### 4. Compute World Bounds — `computeWorldBounds(plotRects)`

Finds the bounding box of all plots, adds 6-tile margin on all sides. This margin becomes the coastal falloff zone for the island shape. Result is then normalized to 0-based coordinates.

### 5. Fill Ground — `fillGround(bounds, plotRects)`

Two-layer fill over entire world bounds:

- **LAYER_GROUND (0)**: Water tile at every position
- **LAYER_TERRAIN (1)**: Grass tile only where `isLandTile()` returns true

**`isLandTile(x, y, bounds, plotRects)`** determines the island shape:
1. Always land within 3 tiles of any plot (fence + buffer)
2. Otherwise: normalized distance from world center, with noise-modulated threshold

```
threshold = 0.85 + noise2d(x * 0.12, y * 0.12) * 0.25
isLand = distFromCenter < threshold
```

Grass variants are selected via FBM noise for visual variety.

### 6. Fill Tilled Dirt — `fillTilledDirt(x, y, w, h)` per plot

Overwrites grass on LAYER_TERRAIN with `'tilled'` type inside each directory plot's bounds. Default sprite from autotiler config; edges resolved later by autotile pass.

### 7. Place Modules — `placeModules(registry, ctx)` (if registry loaded)

See [Module Placement](#module-placement) section below. Stamps pre-designed tile arrangements onto the map. Operates on all layers depending on module definition.

### 8. Generate Paths — `generatePaths()`

Connects all directory plots via Minimum Spanning Tree:

1. Build edges between all plot pairs (Manhattan distance)
2. Kruskal's MST via Union-Find
3. Add up to 2 short extra edges for path loops
4. For each edge: Manhattan route (horizontal first, then vertical)
5. `placePath(x, y)`: only places on grass tiles on LAYER_TERRAIN

### 9. Autotile All Terrain — `autoTileAllTerrain()`

Single pass over all tiles on LAYER_TERRAIN with types in `{grass, tilled, water, path}`:

1. For each tile, Autotiler checks 8 neighbors
2. Computes 8-bit bitmask (which neighbors are same type)
3. Looks up sprite from 256-entry mapping table
4. If mapping is `""` (empty string), preserves existing sprite
5. Also handles transitions between different terrain types (e.g., grass edges next to tilled)

### 10. Create Fences — `createFence(x, y, w, h)` per plot

Places named fence sprites around each directory plot on LAYER_TERRAIN:
- Top/bottom: `fences/fence-horizontal`
- Left/right: `fences/fence-vertical`
- Corners: `fences/fence-corner-{tl,tr,bl,br}`

### 11. Create Plot Records — `createDirectoryPlotRecord(rect)`

Adds `Plot` metadata objects to `map.plots`. These don't place tiles; they store directory info (path, dimensions, crop type).

### 12. Place Fence Gates — `placeFenceGates()`

Scans all fence tiles. If a non-corner fence is adjacent to a path tile, replaces it with `fences/fence-gate`.

### 13. Place File Crops — `placeFileCropsInDirectories(fileTiles, dirLookup, bounds)`

1. Groups files by parent directory (walks path hierarchy to find deepest matching plot)
2. Lays out files in a grid inside each plot's interior (1-tile inset from edges)
3. Each file gets a crop tile on LAYER_CROPS with sprite based on extension + activity
4. Orphan files (no parent plot) placed in a row at top-left

**Crop type mapping**: TS/JS -> wheat, Python -> pumpkin, CSS -> flower, JSON -> seedling, etc.
**Growth stages**: `min(3, floor(sqrt(reads + writes * 3)))` — writes count 3x

### 14. Place Decorations — `placeDecorations(bounds)`

Ground-level scatter on open grass tiles (LAYER_TERRAIN grass, no LAYER_CROPS occupant):

1. **Grass tufts**: FBM noise > 0.55 && 14% chance
2. **Flowers**: clustered near paths (seed points from path positions, 15% near seeds, 7% adjacent to paths)
3. **Butterflies**: 1.2% near flower clusters

Mushrooms, stones, and bush clusters are handled by the module system instead.

---

## Module Placement

### Budget System

Each category has a budget based on world area:

| Category | Formula | ~2000-tile world |
|----------|---------|------------------|
| landmark | `min(2, worldArea / 3000)` | 0 |
| environment | `worldArea / 500` | 4 |
| connector | `pathCount / 3` | varies |
| decorative | `worldArea / 200` | 10 |
| vegetation | `worldArea / 50` | 40 |

Worlds < 400 tiles get minimal budgets. Worlds < 200 tiles skip modules entirely.

### Placement Priority

Modules are sorted and placed in this order:
1. Landmark (0)
2. Environment (1)
3. Connector (2)
4. Vegetation (3)
5. Decorative (4)

### Candidate Scoring

For each module, candidates are evaluated on a coarse grid (step = half module size):

1. **Occupancy check**: OccupancyGrid collision (plots pre-marked with 1-tile margin)
2. **Grass requirement**: checks LAYER_TERRAIN (1) first, falls back to LAYER_GROUND (0)
3. **Distance constraints**: minDistFromPlots, minDistFromSame, minDistFromAny
4. **Affinity score** (0-1): `any`, `edge`, `center`, `corner`, `near-water`, `near-path`, `between-plots`
5. **Rarity filter**: probabilistic skip based on `hash2d > rarity`
6. **Tiebreaker**: deterministic noise added to score

Best candidate is stamped onto the map. Occupancy grid updated with 1-tile margin.

### Module Definition Formats

**Full format**: explicit tile array with `{x, y, layer, type, spriteId}` per tile

**ASCII shorthand**: character grid + legend mapping characters to tile definitions

**Multi-layer ASCII**: array of `{layer, asciiMap, legend}` for stacked layers

---

## Autotiler

### Bitmask Encoding

8 neighbors encoded as 8 bits:

```
NW(128)  N(1)   NE(2)
W(64)    tile   E(4)
SW(32)   S(16)  SE(8)
```

Diagonal masking: diagonal bit zeroed if either adjacent cardinal is missing (e.g., NE requires both N and E to be same type).

### Sprite Resolution Modes

**Edge mode** (grass, tilled, water): missing cardinal = exposed edge
- Center, 4 edges, 4 outer corners, 4 inner corners

**Connectivity mode** (paths): present cardinal = connection
- Isolated, 4 endpoints, 2 straights, 4 corners, 4 T-junctions, crossroads

### Transitions

When terrain A borders terrain B, the transition config determines which spritesheet provides the edge sprite. Example: grass next to tilled uses grass spritesheet for the visible edge (grass side of boundary).

Current transitions:
- grass -> tilled (grass sprites, priority 2)
- grass -> path (grass sprites, priority 3)
- tilled -> grass (tilled-dirt sprites, priority 2)

---

## Noise Functions

All incorporate module-level `_seed`:

| Function | Input | Output | Used For |
|----------|-------|--------|----------|
| `hash2d(ix, iy)` | integer coords | [0, 1] | Base hash for all noise |
| `noise2d(x, y)` | continuous coords | [0, 1] | Smooth value noise (4-point interpolation + smoothstep) |
| `fbmNoise(x, y, octaves)` | continuous coords | [0, 1] | Multi-octave noise (default 2 octaves) |
| `intHash(n)` | single integer | uint32 | Decoration seed points, deterministic choices |
| `stringHash(s)` | string | uint32 | Plot jitter from file paths |

---

## Key Types

### Tile

```typescript
interface Tile {
  x: number;           // Tile coordinates
  y: number;
  type: TileType;      // String: 'grass', 'water', 'tilled', 'path', 'fence', 'decoration', etc.
  spriteId: string;    // "sheetName/spriteName" e.g. "grass/t_1_1"
  variant: number;     // For multi-variant sprites
  layer: number;       // 0=ground, 1=terrain, 2=crops
}
```

### Plot

```typescript
interface Plot {
  id: string;              // File path or "x,y"
  x, y, width, height: number;
  filePath: string;
  isDirectory: boolean;
  cropType: string;        // 'wheat', 'pumpkin', 'flower', 'seedling'
  growthStage: number;     // 0-3
  activity: number;        // reads + writes
  isActive: boolean;       // Currently accessed
  cropSpriteId: string;   // Pre-computed
}
```

### TileModuleDef

```typescript
interface TileModuleDef {
  id: string;
  name: string;
  category: ModuleCategory;   // landmark | environment | connector | decorative | vegetation
  width, height: number;
  tiles: ModuleTilePlacement[];
  connectionPoints: ConnectionPoint[];
  placement: PlacementRules;   // distances, affinity, overlap rules
  tags: string[];
  rarity: number;              // 0-1
  minWorldArea: number;
  maxInstances: number;        // -1 = unlimited
}
```

---

## Storage

**WorldMap** stores tiles in `Map<"x,y,layer", Tile>` and plots in `Map<id, Plot>`.

Key methods:
- `setTile(x, y, type, spriteId, variant, layer)` — creates/overwrites
- `getTile(x, y, layer)` — single lookup
- `getAllTiles()` — full iteration
- `getPlotAt(x, y)` — spatial plot lookup

---

## Rendering

**GameScene.ts** (Phaser 3) creates 5 depth-sorted containers:
- `groundLayer` (depth 0)
- `terrainLayer` (depth 1)
- `cropsLayer` (depth 2) — Y-sorted after all tiles loaded
- `charactersLayer` (depth 3)
- `effectsLayer` (depth 4)

Tiles are added to containers based on their layer value. The crops layer is Y-sorted (`cropsLayer.sort('y')`) so objects further down the screen render on top.

---

## Trigger Flow

```
CodebaseMapper.scan()
  -> MapLayout (pixel-based tile rects)
    -> WorldGenerator.generateFromLayout(layout)
      -> WorldMap (tiles + plots)
        -> serialize() -> postMessage to webview
          -> GameScene.setTiles(tiles)
            -> Phaser renders
```

Regeneration: `codemon.regenerateMap` command calls `setSeed(Date.now())` then re-triggers `sendMapUpdate()`.

---

## Config Files

| File | Purpose |
|------|---------|
| `assets/config/terrain-bitmask.json` | Terrain types, 256-entry bitmask mappings, transitions |
| `assets/config/tile-modules.json` | Pre-designed module definitions (5 starter modules) |
| `assets/config/sprite-manifest.json` | Spritesheet definitions, frame coordinates |

---

## Extension Points

**New terrain type**: Add TerrainConfig to terrain-bitmask.json with 256-entry bitmask mappings. Add to `TERRAIN_TYPES` set in WorldGenerator if it should be autotiled.

**New crop type**: Add extension mapping in WorldGenerator constructor, add case in `getCropSprite()`.

**New module**: Add definition to tile-modules.json (full or ASCII format). Automatically loaded and eligible for placement.

**New module category**: Add to `ModuleCategory` type, `ModuleBudget` interface, `computeBudget()`, and `categoryPriority` map.
