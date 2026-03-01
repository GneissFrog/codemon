# World Generation Improvement Plan

## Context

The sprite-based world generation system has its foundations in place (asset pipeline, WorldGenerator, WorldMap, and the GameViewPanel webview renderer), but there is a critical architectural disconnect: **WorldGenerator builds a tile grid into WorldMap, but the GameViewPanel webview never reads from it.** The webview renders directly from the raw `MapLayout.tiles[]` array with inline rendering logic. Every visual improvement currently has to work around this disconnect.

Note: `OverworldMapPanel.ts` exists as a file but is **dead code** — it's never imported in `extension.ts` and not registered in `package.json`. All rendering happens inside **GameViewPanel** only. The plan treats OverworldMapPanel as deletable and focuses exclusively on GameViewPanel.

Additionally, the world looks flat — monotonous grass, no water/paths, no sprite animations, no character entity, and no decorative objects despite having assets for all of these.

---

## Step 1: Unify the Rendering Data Path

**Goal**: WorldMap becomes the single source of truth. The webview renders from a serialized tile grid, not the raw MapLayout.

**Changes**:
- **`src/overworld/core/types.ts`** — Add `layer: number` to `Tile`, add `cropSpriteId: string` to `Plot`, add `SerializedWorldMap` interface
- **`src/overworld/world/WorldMap.ts`** — Add `serialize(): SerializedWorldMap` method that exports all tiles + plots
- **`src/overworld/world/WorldGenerator.ts`** — Pre-compute `cropSpriteId` on each Plot during generation
- **`src/extension.ts`** — Instantiate WorldMap + WorldGenerator; in `sendMapUpdate()`, run layout through WorldGenerator, then send `worldMap.serialize()` to GameViewPanel
- **`src/panels/GameViewPanel.ts`** — Refactor webview `render()` to iterate serialized tiles by layer, drawing `tile.spriteId` directly. This replaces the inline `drawGroundLayer()`, `drawDirTile()`, `getCropSprite()`, and `drawFence()` functions with a single tile-grid loop.

**Data flow after**:
```
CodebaseMapper.getLayout() → WorldGenerator.generateFromLayout() → WorldMap
  → worldMap.serialize() → postMessage → GameViewPanel renders from tile grid
```

**Test**: Visual output should be identical but grass now shows 4 variants (from WorldGenerator.fillGround) instead of all-center.

---

## Step 2: Clean Up Dead Code

**Goal**: Remove unused OverworldMapPanel and consolidate.

**Changes**:
- **Delete `src/panels/OverworldMapPanel.ts`** — Dead code, never imported or registered
- **GameViewPanel** — Confirm all rendering logic uses the unified tile grid from Step 1; remove any remaining duplicated helper functions that were factored into the tile grid approach

**Test**: `npm run compile` succeeds. GameViewPanel still renders correctly.

---

## Step 3: Visual Quality — Grass Edges, Autotiling, Decorations

**Goal**: Natural terrain transitions and scattered environmental decorations.

**Changes**:
- **`src/overworld/world/WorldGenerator.ts`** — Add `autoTileGrassEdges()`: after placing tilled dirt, scan boundary tiles and set adjacent grass tiles to edge/corner sprites based on neighbor bitmask. Add `placeDecorations()`: scatter objects from `Basic_Grass_Biom_things.png` on ~5% of open grass tiles (avoiding paths, water, plots)
- **`assets/config/sprite-manifest.json`** — Add sprite coordinates for biome decoration sprites (flowers, rocks, grass tufts from `Basic_Grass_Biom_things.png`)

**Test**: Grass-to-dirt transitions show smooth edges. Random decorative objects appear on grass tiles.

---

## Step 4: Water Features and Paths

**Goal**: Ponds/streams and connecting paths make the world feel like a real farm.

**Changes**:
- **`src/overworld/world/WorldGenerator.ts`** — Add `generateWater()`: place a small pond using circular fill with water tiles (using `water/water-0`). Add `generatePaths()`: for adjacent plots, create Manhattan paths using path sprites with neighbor-aware edge selection. Place `fence-gate` tiles where paths meet fences.
- **`src/overworld/core/types.ts`** — Ensure `'water'` and `'path'` are in `TileType` (already defined but unused)

**Test**: Water pond visible at world edges. Paths connect nearby directory plots. Gates appear in fences.

---

## Step 5: Sprite Animation System

**Goal**: Water flows, crops animate growth transitions.

**Changes**:
- **`src/panels/GameViewPanel.ts`** (webview script section) — Add animation system:
  - `initAnimations(manifest)` — Create animation state map from manifest definitions
  - `updateAnimations(deltaTime)` — Advance frame timers
  - `getAnimatedSpriteId(spriteId)` — If a tile's sprite has a registered animation, return current frame's sprite
  - Water tiles auto-register for `water-flow` animation (4 frames, 4fps, looping)
  - Crop growth: when plot activity changes, play a brief scale-bounce (1.0 → 1.2 → 1.0 over 300ms)

**Test**: Water tiles cycle through 4 frames. Trigger a file write and observe crop bounce.

---

## Step 6: Character Entity and Action Animations

**Goal**: Replace the programmatic pixel agent with a sprite-based farmer character that walks between files.

**Changes**:
- **`assets/config/sprite-manifest.json`** — Expand `claude-actions` entries to define individual walk frames per direction (`walk-down-0` through `walk-down-5`, etc.) by measuring the PNG spritesheet grid
- **`src/panels/GameViewPanel.ts`** — Replace programmatic `drawMapAgent()` with spritesheet-based character. On `moveAgent` message, set target tile; entity walks there smoothly. Select direction sprite based on movement vector.
- **`src/overworld/world/WorldGenerator.ts`** — Add organic spacing: 1-2 tile padding jitter between adjacent plots to break the grid alignment

**Action-to-animation mapping**:
- Read → harvest sprite | Write/Edit → hoe/plant sprite | Bash → water sprite | Grep/Glob → walk sprite | Idle → idle sprite

**Test**: Trigger tool events. Farmer walks to the file's plot. Correct action animation plays.

---

## Verification

After each step:
1. `npm run compile` — TypeScript compiles without errors
2. Press F5 in VS Code to launch extension development host
3. Open a workspace with multiple directories/files
4. Run `CodeMon: Open Game View` command
5. Trigger Claude Code activity (or simulate via hook server) and verify the map updates

---

## Files Modified Summary

| File | Steps |
|------|-------|
| `src/overworld/core/types.ts` | 1, 4 |
| `src/overworld/world/WorldMap.ts` | 1 |
| `src/overworld/world/WorldGenerator.ts` | 1, 3, 4, 6 |
| `src/extension.ts` | 1 |
| `src/panels/GameViewPanel.ts` | 1, 2, 5, 6 |
| `src/panels/OverworldMapPanel.ts` | 2 (delete) |
| `assets/config/sprite-manifest.json` | 3, 6 |
