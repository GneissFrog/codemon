# Visual Overhaul Plan: Game-Quality Map Generation

## Goal
Transform the generated world from a flat visualization into something that reads as
a game world — organic island shapes, layered terrain with natural shorelines,
dense environmental detail, and proper depth for tall objects like trees.

---

## Phase 1: Seed-Based Generation System

**Why first:** Every subsequent phase involves tweaking generation. A seed system lets
us rapidly regenerate maps to evaluate changes without needing a different codebase state.

### Changes

**`src/overworld/world/WorldGenerator.ts`**

1. Add a `seed: number` field to the `WorldGenerator` class (or `GeneratorConfig`).
   Default to `Date.now()`. Accept optional seed in constructor.

2. Modify all noise/hash functions to incorporate the seed:
   ```
   hash2d(ix, iy)       → hash2d(ix, iy, seed)
   noise2d(x, y)        → unchanged (calls hash2d)
   fbmNoise(x, y, ...)  → unchanged (calls noise2d)
   intHash(n)            → intHash(n, seed)  (or n ^ seed)
   stringHash(s)         → add seed XOR to final value
   ```
   The simplest approach: XOR the seed into the initial hash computation in `hash2d`
   (line 63). Since all other noise functions chain through `hash2d`, a single change
   propagates everywhere. Similarly XOR seed into `intHash` (line 113).

3. Expose `seed` on the `WorldMap` or return it from `generateFromLayout` so the UI
   can display it.

**`src/extension.ts`** (or wherever generation is triggered, ~line 325)

4. Add a "Regenerate Map" command (VS Code command palette) that:
   - Generates a new random seed
   - Calls `generateFromLayout` with the new seed
   - Pushes the updated map to GameViewPanel

5. Optionally add a "Set Seed" command that accepts a numeric seed input.

**`src/panels/GameViewPanel.ts`**

6. Add a small UI element (button or keybind) in the webview that sends a
   `regenerateMap` message back to the extension host.

### Validation
- Generate a map with seed X, regenerate with seed X again → same result.
- Generate with different seeds → visually different layouts.

---

## Phase 2: Layered Terrain — Island Generation

**The core architectural change.** Currently all terrain lives on LAYER_GROUND (0) as
mutually exclusive tiles. We shift to a stacked model:

```
LAYER_GROUND (0) — Water base (fills entire world bounds)
LAYER_TERRAIN (1) — Grass island (autotiled edges with transparency → water shows through)
LAYER_CROPS (2)  — Objects (fences, crops, decorations, trees)
```

This matches how the Sprout Lands tilesets were designed (see TILE LAYER EXAMPLE.png).

### Step 2A: Tileset Swap — Grass → Grass Hills

The current `Grass.png` is a flat tileset (edges are just lighter grass).
`Grass_Hill_Tiles_v2.png` has brown cliff edges with transparent pixels designed to
overlay water/sand. Both are 176x112 (11 cols x 7 rows), same grid layout.

**`assets/config/sprite-manifest.json`**

- Change the `"grass"` spritesheet image path:
  ```
  "grass": {
    "image": "assets/sprites/tilesets/ground tiles/New tiles/Grass_Hill_Tiles_v2.png",
    ...
  }
  ```
- Dimensions, frameSize, grid stay the same (176x112, 16x16, 11x7).

**`assets/config/terrain-bitmask.json`**

- The grass bitmask mappings (t_col_row references) may need verification against the
  hill tileset grid. Since both sheets share the same layout from the same asset pack,
  the mappings likely work as-is. **Verify visually** by checking that:
  - `t_1_1` (center) is a solid grass fill
  - `t_3_0` / `t_3_2` etc. (edges) have brown cliff sides
  - `t_0_0` (NW corner) shows the outer corner with transparency
- If any sprites don't align, remap the affected bitmask entries.

### Step 2B: Water as Base Layer

**`src/overworld/world/WorldGenerator.ts` — `fillGround` method (lines 374-406)**

Replace the current flat-grass fill with a two-phase fill:

```
Phase 1: Fill entire world bounds with water on LAYER_GROUND (0)
  - Simple loop: setTile(x, y, 'water', waterSpriteId, 0, LAYER_GROUND)
  - Use animated water sprite if supported, or static center tile

Phase 2: Fill island shape with grass on LAYER_TERRAIN (1)
  - Use noise-based island contour (see Step 2C)
  - setTile(x, y, 'grass', grassSpriteId, variant, LAYER_TERRAIN)
  - Apply same FBM noise variation for grass variants as today
```

**Layer constant usage changes throughout WorldGenerator:**
- Grass tiles: `LAYER_GROUND` → `LAYER_TERRAIN`
- Water tiles: stays `LAYER_GROUND` (but now it's the base, not ponds)
- Tilled dirt: `LAYER_GROUND` → `LAYER_TERRAIN` (it's on the land surface)
- Paths: `LAYER_GROUND` → `LAYER_TERRAIN`
- Fences: stay `LAYER_TERRAIN` (already correct, but verify no conflicts)
- Crops/decorations: stay `LAYER_CROPS` (already correct)

**Critical:** Every `setTile` call with `LAYER_GROUND` for grass/tilled/path must
become `LAYER_TERRAIN`. Search for all `LAYER_GROUND` usages:
- Line 403 (fillGround grass) → LAYER_TERRAIN
- Line 693 (fillTilledDirt) → LAYER_TERRAIN
- Line 858 (generateWater) → stays LAYER_GROUND (or remove, see below)
- Line 958 (path placement) → LAYER_TERRAIN
- Line 1009 (autotile filter) → LAYER_TERRAIN
- Line 1017 (autotile getTile) → LAYER_TERRAIN
- Line 1019 (autotile setTile) → LAYER_TERRAIN

### Step 2C: Island Shape Algorithm

Add a new method `isLandTile(x, y, bounds, plotRects)` that determines whether a
coordinate is land or water:

```typescript
private isLandTile(x: number, y: number, bounds: WorldBounds, plotRects: PlotRect[]): boolean {
  // 1. Any tile within/adjacent to a plot rect is always land
  for (const plot of plotRects) {
    // Include 2-tile margin for fences + 1 tile grass buffer
    if (x >= plot.x - 3 && x <= plot.x + plot.w + 2 &&
        y >= plot.y - 3 && y <= plot.y + plot.h + 2) {
      return true;
    }
  }

  // 2. Distance from world center (normalized 0-1)
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const hw = (bounds.maxX - bounds.minX) / 2;
  const hh = (bounds.maxY - bounds.minY) / 2;
  const dx = (x - cx) / hw;  // -1 to 1
  const dy = (y - cy) / hh;
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);

  // 3. Noise-modulated falloff at edges
  const noiseVal = noise2d(x * 0.12, y * 0.12);  // organic edge
  const threshold = 0.85 + noiseVal * 0.25;       // ~0.6 to 1.1

  return distFromCenter < threshold;
}
```

The result: an organic island shape that always includes all plots, with noisy
coastline edges. The 6-tile margin from `computeWorldBounds` becomes the coastal
falloff zone.

### Step 2D: Remove Water Ponds & Grass→Water Transition

- **`generateWater` method (lines 764-832)**: Remove or significantly simplify.
  Water is now the base layer everywhere. Internal water features (ponds, streams)
  become a separate concern — holes in the grass layer where water shows through.
  For v1, remove `generateWater` entirely. Later, we can add internal water features
  by simply NOT placing grass at certain interior positions.

- **`terrain-bitmask.json` transitions**: Remove the `grass→water` transition entry
  (lines 1075-1080). It's no longer needed because grass and water live on different
  layers. Grass autotiles against itself on LAYER_TERRAIN. Water just sits below.

- **Water bitmask config**: Can be simplified to a single entry or removed. Water
  doesn't need autotiling — it's a flat fill on LAYER_GROUND.

### Step 2E: Autotiler Layer Adjustment

**`autoTileAllTerrain` method (lines 1007-1028)**

Change the tile filter from LAYER_GROUND to LAYER_TERRAIN:
```typescript
const terrainTiles = this.map.getAllTiles()
  .filter(t => t.layer === LAYER_TERRAIN && WorldGenerator.TERRAIN_TYPES.has(t.type));
```

The `getTileType` helper must also query LAYER_TERRAIN:
```typescript
const getTileType = (x: number, y: number) => {
  const tile = this.map.getTile(x, y, LAYER_TERRAIN);
  return tile ? tile.type : null;
};
```

When a grass edge tile has no grass neighbor (edge of island), the autotiler returns
the edge/corner sprite from the hill tileset. That sprite has transparent pixels where
the cliff side is, and the water on LAYER_GROUND shows through. This is how the
shoreline renders automatically.

### Validation
- Generate map → island shape visible, water surrounds it.
- Grass edges have brown cliff sprites from hill tileset.
- Water visible through transparent cliff edges.
- Tilled dirt still autotiles correctly within plots.
- Paths still render on the land surface.
- All plots are fully on land.

---

## Phase 3: Module System & Decoration Code Changes

Sprite manifest entries, module JSON definitions, and sprite coordinate mapping are
handled manually via the Module Configurator tool. This phase covers only the **code
changes** needed to support dense module-based vegetation and simplify the decoration
pipeline.

### Step 3A: Add `vegetation` Module Category

**`src/overworld/core/types.ts`**

The current `ModuleCategory` type allows: `landmark`, `environment`, `connector`,
`decorative`. Add `vegetation` as a new category for high-volume natural objects
(trees, bushes, stumps) that need a separate, much larger budget than curated
decorative modules like mushroom rings or stone circles.

### Step 3B: Vegetation Budget in Module Placer

**`src/overworld/modules/ModulePlacer.ts` — `computeBudget` (lines 28-39)**

Current decorative budget: `Math.floor(worldArea / 200)` → ~10 for a medium world.
That's fine for curated arrangements but far too few for forest-density trees.

Add `vegetation` to `ModuleBudget` interface and `computeBudget`:
```typescript
interface ModuleBudget {
  landmark: number;
  environment: number;
  connector: number;
  decorative: number;
  vegetation: number;
}

function computeBudget(worldArea: number, pathCount: number): ModuleBudget {
  if (worldArea < 400) {
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
```

Also add `'vegetation'` to the `categoryPriority` sort map (line ~207) so vegetation
modules are placed after landmarks/environment but before decoratives.

### Step 3C: Fix `requiresGrass` Layer Check

**`src/overworld/modules/ModulePlacer.ts` — grass check (line 290)**

Currently hardcodes layer 0:
```typescript
const tile = map.getTile(x + dx, y + dy, 0);  // ← layer 0
```

After Phase 2, grass lives on LAYER_TERRAIN (1). Change to check both layers, or
accept a layer parameter from the caller:
```typescript
// Check layer 1 first (grass in new layered system), fall back to layer 0
const tile = map.getTile(x + dx, y + dy, 1) ?? map.getTile(x + dx, y + dy, 0);
```

This maintains backward compatibility: if grass is on layer 0 (old system) OR
layer 1 (new system), the check works.

### Step 3D: Seed Propagation to Module Placer

**`src/overworld/modules/ModulePlacer.ts` — `hash2d` (line 43)**

The placer has its own `hash2d` function (duplicate of WorldGenerator's). It needs
the same seed integration from Phase 1 so that module placement varies with the
world seed. Either:
- Pass the seed into `placeModules` and thread it to the local `hash2d`, or
- Import a shared seeded hash function (preferred — eliminates duplication).

### Step 3E: Simplify placeDecorations

**`src/overworld/world/WorldGenerator.ts` — `placeDecorations` (lines 1035-1153)**

With mushrooms, stones, and bush clusters handled as modules, reduce the decoration
method to ground-level scatter only:

1. **Keep:** Grass tufts (pass 1) — increase rate from `(hash % 100) < 8` to `< 14`
2. **Keep:** Small flowers near paths (pass 2) — increase from `< 3` to `< 7`
3. **Keep:** Butterflies (pass 5) — increase from `(hash % 1000) < 5` to `< 12`, raise max from 5 to 8
4. **Remove:** Mushroom pass (pass 3) — now a module
5. **Remove:** Stone pass (pass 4) — now a module
6. **Remove:** Fallback random decoration pass — unnecessary with denser scatter

Also update the `isLand` check: decorations should only scatter on grass tiles,
which are now on LAYER_TERRAIN (1) instead of LAYER_GROUND (0). Update the
`groundTile` lookup at line 1076 accordingly.

### Step 3F: Module Placement on Island Only

**`src/overworld/modules/ModulePlacer.ts`**

Modules with `requiresGrass: true` already won't place on water. But after
Phase 2, the occupancy grid and scoring should be aware that the world has an
island shape — modules shouldn't try to place outside the land contour. The
`requiresGrass` check (Step 3C fix) handles this implicitly: if there's no grass
tile at a position, the module won't place there.

### Validation
- `vegetation` category modules place in high volume (30-50 per medium world).
- Decorative modules (mushroom ring, stone circle) still place at normal rates.
- Module placement varies with seed.
- Ground scatter (tufts, flowers, butterflies) fills gaps at increased density.
- No modules placed on water tiles outside the island.

---

## Phase 4: Depth Sorting for Tall Objects

### The Problem

The Phaser renderer uses 3 static tile layers (GameScene.ts lines 106-126):
- `groundLayer` (depth 0)
- `terrainLayer` (depth 1)
- `cropsLayer` (depth 2)

There is **no Y-based sorting** within layers. All sprites in `cropsLayer` render at
the same depth regardless of Y position. This means:
- A tree canopy at y=5 renders at the same depth as a crop at y=10
- No front-to-back occlusion for tall objects

### Solution: Y-Sorted Object Layer

**`src/webview/gameview/scenes/GameScene.ts` — `addTile` method**

For tiles on LAYER_CROPS (2), set per-sprite depth based on Y position:

```typescript
case 2:
default:
  this.cropsLayer.add(sprite);
  // Y-sort: objects further down the screen render on top
  sprite.setDepth(tile.y * 0.01);
  break;
```

Since cropsLayer itself has depth 2, and Phaser resolves ties by per-sprite depth,
this gives us Y-sorting within the object layer. Objects at higher Y (lower on screen)
render on top of objects at lower Y (higher on screen).

For a 1x2 tree:
- Canopy at y=4 → depth 0.04
- Trunk at y=5 → depth 0.05
- Trunk renders on top of canopy (correct — trunk is in front)
- A crop at y=6 → depth 0.06 (renders in front of both, correct)

**Alternative approach if per-sprite depth within containers doesn't work in Phaser:**
Replace the fixed `cropsLayer` container with a Phaser Group that has `sortByDepth`
enabled, and set each child's depth to its Y coordinate.

### Agent Depth

The agent sprite is currently hardcoded to depth 10 (GameScene.ts line 340).
For proper occlusion with trees, the agent should also use Y-based depth:

```typescript
this.agentSprite.setDepth(agentTileY * 0.01);
```

This allows the agent to walk behind tree canopies (agent Y < canopy Y) and in front
of trunks (agent Y > trunk Y).

**However**, this is a nice-to-have. For v1, keeping the agent at depth 10 (always on
top) is simpler and avoids the agent disappearing behind trees.

### Validation
- Place two trees at different Y positions → one correctly occludes the other.
- Crops between trees render at correct depth.
- Agent walks in front of all objects (v1) or behind tall objects (v2).

---

## Implementation Order & Dependencies

```
Phase 1: Seed System
  └─ No dependencies, can be done independently.
     Enables rapid iteration for all subsequent phases.

Phase 2: Layered Terrain
  ├─ Step 2A: Tileset swap (manifest config change)
  ├─ Step 2B: Water base + grass island (WorldGenerator rewrite of fillGround)
  ├─ Step 2C: Island shape algorithm (new method)
  ├─ Step 2D: Remove water ponds + transitions (deletion)
  └─ Step 2E: Autotiler layer adjustment (filter change)

  All steps in Phase 2 are tightly coupled — do them together as one changeset.

Phase 3: Module System & Decoration Code Changes
  ├─ Step 3A: Add vegetation category to types (tiny)
  ├─ Step 3B: Vegetation budget in ModulePlacer (small code tweak)
  ├─ Step 3C: Fix requiresGrass layer check (one-line fix)
  ├─ Step 3D: Seed propagation to ModulePlacer (small code tweak)
  ├─ Step 3E: Simplify placeDecorations (code reduction + rate tuning)
  └─ Step 3F: Island-awareness (implicit via 3C, no extra code)

  All steps are small code changes. Depends on Phase 2 (grass layer move).
  Module definitions (trees, bushes) are created manually via configurator.

Phase 4: Depth Sorting
  └─ Single change in GameScene.ts addTile method.
     Depends on Phase 3 (needs multi-tile objects to test against).
```

## Files Modified (Summary)

| File | Phases | Change Type |
|------|--------|-------------|
| `src/overworld/world/WorldGenerator.ts` | 1, 2, 3 | Seed param, layer constants, fillGround rewrite, island shape, simplify decorations |
| `src/overworld/modules/ModulePlacer.ts` | 3 | Vegetation budget, requiresGrass layer fix, seed propagation |
| `src/overworld/core/types.ts` | 3 | Add `vegetation` to ModuleCategory |
| `src/webview/gameview/scenes/GameScene.ts` | 4 | Y-based depth sorting in addTile |
| `src/extension.ts` | 1 | Regenerate command, seed passing |
| `src/panels/GameViewPanel.ts` | 1 | Regenerate UI button/message |
| `assets/config/sprite-manifest.json` | 2 | Grass tileset swap to hill variant |
| `assets/config/terrain-bitmask.json` | 2 | Remove grass→water transition, verify grass mappings |

**Not modified by code changes (handled manually via configurator):**
- `assets/config/tile-modules.json` — tree/bush module definitions
- `assets/config/sprite-manifest.json` — tree spritesheet sprite coordinates

## Open Questions

1. **Internal water features**: After removing `generateWater`, do we want ponds/streams
   as holes in the grass layer? Could be done by excluding certain interior positions
   from the island fill using noise. Defer to post-v1.

2. **Darker grass variant**: The `Darker_Grass_Hills_Tiles_v2.png` could serve as an
   additional elevation layer (grass on top of grass). The TILE LAYER EXAMPLE shows
   three-layer stacking. Defer to post-v1 — one grass layer over water is enough.

3. **Animated water tiles**: Water.png has 4 frames. Do we want water animation? The
   renderer already supports animated tiles (`createAnimatedTile` in GameScene). Worth
   enabling but not blocking.

4. **Path rendering on island edges**: If a path runs near the coast, does it look right
   on the hill tileset? Paths are autotiled separately on LAYER_TERRAIN. Should be fine
   but verify visually.

5. **Shared hash function**: Both WorldGenerator and ModulePlacer have independent
   `hash2d` implementations. Phase 1 (seed) and Phase 3D (seed propagation) both touch
   these. Consider extracting a shared seeded-noise utility to avoid drift.

6. **Config-driven crop-plot system**: The file/directory visualization (tilled dirt
   fill, fence perimeter, crop grid layout, file-extension→crop-type mapping, growth
   stage formula, fence gate logic) is entirely hardcoded in WorldGenerator methods:
   `fillTilledDirt`, `createFence`, `placeFilesInPlotGrid`, `createFilePlotAt`,
   `getCropType`, `getCropSprite`, `placeFenceGates`. None of this uses the module or
   bitmask systems (except tilled dirt autotiling). For this overhaul the plot system
   works as-is — the only interaction is updating `fillTilledDirt` from LAYER_GROUND
   to LAYER_TERRAIN (already covered in Phase 2B). Future work: make crop types,
   growth formulas, fence styles, and plot layout rules config-driven rather than
   hardcoded, so they can be customized without code changes.
