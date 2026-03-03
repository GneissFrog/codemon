# Overworld Pixel Art System — Implementation Plan

A comprehensive plan to transform the treemap visualization into a living 2D pixel art farm.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS CODE EXTENSION HOST                      │
├─────────────────────────────────────────────────────────────────┤
│  Extension Entry (extension.ts)                                 │
│  ├─ Asset Loader (load PNGs → base64 data URLs)                │
│  ├─ Codebase Mapper (workspace → file tree)                    │
│  ├─ World Generator (file tree → tile-based farm)              │
│  ├─ Event Router (central event bus)                           │
│  │   ├─ Session Log Reader (tails ~/.claude/*.jsonl)           │
│  │   └─ Hook Server (HTTP on port 22140)                       │
│  ├─ Budget Tracker (tokens/dollars/subscription)               │
│  └─ Config Reader (Claude .claude/settings.json)               │
├─────────────────────────────────────────────────────────────────┤
│                        WEBVIEW PANELS                           │
├─────────────────────────────────────────────────────────────────┤
│  GameViewPanel (main canvas)                                    │
│  ├─ Tile Renderer (layered canvas drawing)                     │
│  │   ├─ Layer 0: Ground (noise-based grass variation)          │
│  │   ├─ Layer 1: Terrain (tilled dirt, fences, paths, water)   │
│  │   └─ Layer 2: Crops/Objects (file representations, decor)   │
│  ├─ Agent Sprite (animated character, walks to files)          │
│  ├─ Activity Feed (last 50 tool invocations)                   │
│  ├─ Budget Display (token/cost counters)                       │
│  └─ Camera System (zoom, follow agent)                         │
│                                                                 │
│  SpriteConfigPanel (sidebar — sprite coord editor)             │
│  AgentCardPanel (model info, sprite preview)                   │
│  ActivityFeedPanel (scrollable action log)                     │
│  BudgetBarPanel (detailed budget breakdown)                    │
│                                                                 │
│  BudgetStatusBar (always-visible token counter)                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ASSET SYSTEM                               │
├─────────────────────────────────────────────────────────────────┤
│  AssetLoader                                                    │
│  ├─ Loads PNG spritesheets from assets/sprites/                │
│  ├─ Converts to base64 data URLs for webview transfer          │
│  └─ Indexes sprites by manifest coordinates                    │
│                                                                 │
│  Sprite Manifest (JSON)                                         │
│  ├─ Spritesheets: image path, dimensions, grid, sprite coords  │
│  ├─ Animations: frame sequences, fps, loop                     │
│  └─ Crops: growth stage sprite IDs                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT FLOW                                    │
├─────────────────────────────────────────────────────────────────┤
│  Claude Code (JSONL session logs or HTTP hooks)                 │
│           ↓                                                     │
│  SessionLogReader / HookServer                                  │
│           ↓                                                     │
│  EventRouter (central bus)                                      │
│           ↓                                                     │
│  ┌─────────┬───────────┬──────────┬─────────────┐              │
│  ↓         ↓           ↓          ↓             ↓              │
│  GameView  Budget      Status     Codebase      Activity       │
│  Panel     Tracker     Bar        Mapper        Feed           │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── extension.ts                    # Entry point: init, commands, event wiring
│
├── core/
│   ├── event-types.ts              # Event interfaces (ToolType, TokenUsage, etc.)
│   ├── event-router.ts             # Central event bus (EventEmitter)
│   ├── session-log-reader.ts       # Tails ~/.claude/*.jsonl files
│   ├── hook-server.ts              # HTTP server for CLI hooks (port 22140)
│   ├── config-reader.ts            # Reads .claude/settings.json
│   ├── budget-tracker.ts           # Token spend tracking (3 modes)
│   ├── token-calculator.ts         # Cost computation per model
│   ├── codebase-mapper.ts          # Workspace → FileNode tree + treemap layout
│   └── settings.ts                 # Extension settings accessor
│
├── panels/
│   ├── GameViewPanel.ts            # Main game webview (canvas, agent, feed, budget)
│   ├── SpriteConfigPanel.ts        # Sidebar: sprite coord editor
│   ├── AgentCardPanel.ts           # Agent info + sprite preview
│   ├── ActivityFeedPanel.ts        # Scrollable action log
│   ├── BudgetBarPanel.ts           # Detailed budget breakdown
│   └── panel-utils.ts              # Shared webview utilities
│
├── overworld/
│   ├── core/
│   │   ├── types.ts                # Tile, Plot, Entity, Animation types
│   │   ├── AssetLoader.ts          # Load PNGs → base64, index by manifest
│   │   └── index.ts
│   └── world/
│       ├── WorldMap.ts             # Tile grid + camera system
│       ├── WorldGenerator.ts       # Procedural world from file tree
│       └── index.ts
│
├── statusbar/
│   └── BudgetStatusBar.ts          # Status bar token counter
│
└── webview/
    └── shared/
        └── pixel-theme.ts          # Shared pixel-art CSS theme

assets/
├── config/
│   └── sprite-manifest.json        # Sprite coordinates & animation defs
├── icons/
│   └── codemon-icon.svg
└── sprites/
    ├── characters/                 # Character spritesheets (actions, idle)
    ├── tilesets/                   # Grass, water, dirt, fences, hills, houses
    ├── objects/                    # Furniture, plants, paths, tools, bridges
    └── effects/                    # Particles (planned)
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Rendering** | Canvas 2D (in webview) | Simpler, sufficient for 2D pixel art |
| **Tile size** | 16px (min) | Classic SNES feel, supports larger sprites |
| **Map layout** | Procedural from file tree | Squarified treemap → tile grid with relaxation |
| **Sprite storage** | Data URLs via postMessage | Webview can't access extension files directly |
| **Animation timing** | Delta time | Smooth 60fps regardless of frame drops |
| **State sync** | Push (extension → webview) | Extension pushes updates on events |
| **Spritesheet layout** | Variable with JSON manifest | Assets have non-standard layouts |
| **Event ingestion** | Session logs (default) + HTTP hooks | Supports both VS Code and CLI Claude Code |
| **Budget tracking** | 3 modes: tokens/dollars/subscription | Flexible for different usage patterns |
| **Asset pack** | Sprout Lands Basic Pack | Farm-themed, includes characters, crops, terrain |

---

## Sprite Manifest Schema

Since spritesheets have variable layouts, we use a manifest to describe sprite positions:

```json
{
  "version": 1,
  "description": "Sprout Lands sprite coordinates",
  "tileSize": 16,
  "spritesheets": {
    "grass": {
      "image": "assets/sprites/tilesets/Grass.png",
      "dimensions": { "width": 256, "height": 256 },
      "frameSize": { "width": 16, "height": 16 },
      "grid": { "cols": 16, "rows": 16 },
      "sprites": {
        "grass-center":     { "x": 16,  "y": 16,  "w": 16, "h": 16 },
        "grass-edge-n":     { "x": 16,  "y": 0,   "w": 16, "h": 16 },
        ...
      }
    },
    "character-actions": {
      "image": "assets/sprites/characters/Basic Charakter Actions.png",
      "dimensions": { "width": 288, "height": 160 },
      "frameSize": { "width": 48, "height": 48 },
      "sprites": {
        "action-hoe-down-0": { "x": 0, "y": 0, "w": 48, "h": 48 },
        ...
      }
    }
  },
  "animations": {
    "claude-idle-down": {
      "frames": ["idle-down-0", "idle-down-1"],
      "fps": 4,
      "loop": true
    },
    "claude-walk-down": {
      "frames": ["walk-down-0", "walk-down-1", "walk-down-2", "walk-down-3"],
      "fps": 8,
      "loop": true
    }
  },
  "crops": {
    "wheat": {
      "growthStages": ["plants/wheat-1", "plants/wheat-2", "plants/wheat-3", "plants/wheat-4"],
      "growthRate": "activity"
    }
  }
}
```

---

## Tile Configuration Schema

Maps codebase concepts to visual elements (defined in types.ts / WorldGenerator.ts):

```json
{
  "version": 1,
  "tileSize": 16,

  "fileTypeMappings": {
    ".ts":   { "crop": "wheat",   "color": "#29adff" },
    ".tsx":  { "crop": "wheat",   "color": "#29adff" },
    ".js":   { "crop": "wheat",   "color": "#1d6daf" },
    ".jsx":  { "crop": "wheat",   "color": "#1d6daf" },
    ".py":   { "crop": "pumpkin", "color": "#00e436" },
    ".rs":   { "crop": "flower",  "color": "#ff77a8" },
    ".go":   { "crop": "pumpkin", "color": "#00b543" },
    ".css":  { "crop": "flower",  "color": "#83769c" },
    ".json": { "crop": "seedling","color": "#5a5d6e" },
    ".md":   { "crop": "flower",  "color": "#7e5539" },
    ".sh":   { "crop": "seedling","color": "#6daa2c" },
    "_default": { "crop": "seedling", "color": "#3a3d4e" }
  },

  "characters": {
    "claude": {
      "spritesheet": "character-actions",
      "directions": ["down", "up", "left", "right"],
      "actions": [
        { "name": "hoe",    "frames": 4, "skill": "write" },
        { "name": "water",  "frames": 4, "skill": "edit" },
        { "name": "walk",   "frames": 6 },
        { "name": "idle",   "frames": 2 }
      ]
    }
  },

  "subAgents": {
    "chicken": { "behavior": "wander", "speed": 0.5 },
    "cow":     { "behavior": "graze",  "speed": 0.2 },
    "pig":     { "behavior": "forage", "speed": 0.3 },
    "duck":    { "behavior": "swim",   "speed": 0.4 }
  }
}
```

---

## Implementation Phases

### Phase 1: Asset Pipeline Foundation ✅ Complete
**Goal**: Load and render sprites from spritesheets in the Game View

| Step | Deliverable | Status |
|------|-------------|--------|
| 1.1 | `AssetLoader.ts` — Load PNGs, convert to data URLs | ✅ Done |
| 1.2 | `types.ts` — Type definitions for sprites, animations, entities | ✅ Done |
| 1.3 | `sprite-manifest.json` — Sprout Lands sprite coordinates | ✅ Done |
| 1.4 | Pass image data URIs to webview via postMessage | ✅ Done |
| 1.5 | Integrate sprite rendering into GameViewPanel | ✅ Done |

**Implementation Notes:**
- Assets loaded in extension host, converted to base64 data URLs
- Webview creates `Image` objects from data URLs
- Falls back to colored rectangles if sprites fail to load
- Sprite manifest supports variable-layout spritesheets with per-sprite coordinates

---

### Phase 2: World Generation ✅ Complete
**Goal**: Transform file tree into a farm layout

| Step | Deliverable | Status |
|------|-------------|--------|
| 2.1 | `WorldMap.ts` — Tile grid + camera system | ✅ Done |
| 2.2 | `WorldGenerator.ts` — Convert file tree → tile-based farm | ✅ Done |
| 2.3 | Noise-based ground generation (FBM, 2-octave) | ✅ Done |
| 2.4 | Fenced directory plots with constraint relaxation | ✅ Done |
| 2.5 | MST-connected path network with auto-tiling | ✅ Done |
| 2.6 | Organic water features (1-3 noise-modulated ponds) | ✅ Done |
| 2.7 | Clustered decorations (grass, flowers, mushrooms, stones, butterflies) | ✅ Done |
| 2.8 | Fence gates where paths meet fences | ✅ Done |
| 2.9 | Auto-tiling for grass edges, paths, fences | ✅ Done |
| 2.10 | `SpriteConfigPanel` — Sidebar for sprite coordinate editing | ✅ Done |

**Implementation Notes:**
- WorldGenerator has 8 procedural phases with bounds-aware generation
- Uses hash-based deterministic noise (FBM with smoothstep interpolation)
- Union-Find implements Kruskal's MST algorithm for path network
- Constraint relaxation (5 iterations) resolves overlapping plots
- Plot sizes clamped to min 4×4, max 20×15 tiles
- Ground generation happens AFTER plot relaxation, using computed world bounds
  (ensures grass always covers all content — no void gaps)
- File type → crop sprite mapping (wheat, pumpkin, flower, seedling)
- Decorations use noise-based clustering for natural placement
- Treemap uses proper squarified algorithm (Bruls/Huizing/van Wijk) for balanced plot shapes
- World coordinates normalized to 0-based after bounds computation
  (all tile positions are non-negative, simplifying webview transform)
- Webview uses world tile dimensions (width×16, height×16) for canvas scaling
  instead of layout pixel dimensions (fixes scale mismatch)

---

### Phase 3: Crop System (File Visualization) ✅ Complete
**Goal**: Files appear as crops with growth stages

| Step | Deliverable | Status |
|------|-------------|--------|
| 3.1 | Map file types → crop sprites in WorldGenerator | ✅ Done |
| 3.2 | Files placed INSIDE parent directory plots (grid layout) | ✅ Done |
| 3.3 | Parent directory lookup (walks path hierarchy) | ✅ Done |
| 3.4 | Growth stages defined in sprite manifest | ✅ Done |
| 3.5 | Growth stage driven by file activity count | ✅ Done |
| 3.6 | Crop tooltip on hover showing file path | ✅ Done |
| 3.7 | Visual distinction for recently-active files | ✅ Done |

**Implementation Notes:**
- FileNode tracks readCount, writeCount, lastAccessed, isActive (decays after 3s)
- Crop type selected by file extension (.ts→wheat, .py→pumpkin, etc.)
- Files are grouped by parent directory and laid out in a grid within the plot interior
  (1-tile inset from edges to preserve tilled dirt border sprites)
- Path hierarchy walk finds deepest matching directory for each file
  (e.g. "src/core/types.ts" → tries "src/core" first, then "src")
- Root-level files (no parent directory plot) placed as standalone crops
- Growth formula: `Math.min(3, floor(sqrt(readCount + writeCount * 3)))` — writes weigh 3×
  - Stage 0 (seed): no activity, Stage 1 (sprout): 1 interaction
  - Stage 2 (growing): ~4 weighted, Stage 3 (mature): ~9 weighted
- Plot carries `isActive: boolean` directly (no cross-reference to layout tiles needed)
- Active files show blue pulsing glow; 5+ activity files show white sparkle
- Growth transition effects: green/gold expanding sparkle burst on stage advancement (1.5s fade)
- `previousPlotStages` Map tracks per-file growth for change detection

---

### Phase 4: Character System ✅ Complete
**Goal**: Claude walks around the farm reacting to tool invocations

| Step | Deliverable | Status |
|------|-------------|--------|
| 4.1 | Agent sprite with directional facing (up/down/left/right) | ✅ Done |
| 4.2 | Walking animation between tiles | ✅ Done |
| 4.3 | Tool-use animations (hoe, water, plant, harvest, investigate, write, bash) | ✅ Done |
| 4.4 | Move agent to file location on tool invocation | ✅ Done |
| 4.5 | Model-based sprite selection (auto/knight/ranger/rogue) | ✅ Done |
| 4.6 | Configurable walking speed (0.05-0.5) | ✅ Done |
| 4.7 | A* pathfinding on tile grid | ✅ Done |
| 4.8 | Smooth path-following with tile collision avoidance | ✅ Done |
| 4.9 | Idle wander behavior when no activity | ✅ Done |

**Implementation Notes:**
- Agent sprite assignment: auto mode picks sprite based on Claude model name
- Per-action frame counts (migrated from legacy global framesPerAction)
- CharacterConfig supports custom skill→action mapping
- Camera follows agent with configurable zoom
- Idle wander: after 5s idle, agent picks random walkable tiles within 8-tile radius
  - Prefers path tiles for natural movement
  - Pauses 1.5-4s at each destination before walking again
  - Immediately interrupted by real tool invocations (moveAgent/setAnimation)
  - Walkability map built from worldTiles on map load (O(1) tile lookups via Set)

---

### Phase 5: Activity & Effects ✅ Complete
**Goal**: Visual feedback for all code operations

| Step | Deliverable | Status |
|------|-------------|--------|
| 5.1 | Activity feed in GameView (last 50 tool invocations) | ✅ Done |
| 5.2 | Tool type icons and token cost per action | ✅ Done |
| 5.3 | Agent animation reacts to tool type (read→investigate, write→hoe, bash→bash) | ✅ Done |
| 5.4 | Particle effects on write (sparkles) and walk (dust) | ✅ Done |
| 5.5 | Activity pulse/glow on recently-accessed plots | ✅ Done |
| 5.6 | Decay animations (pulse fades after timeout) | ✅ Done |

**Implementation Notes:**
- Particle system: array of `{ x, y, vx, vy, startTime, duration, color, size }` objects
- Write sparkles: 8 gold particles burst outward on 'write' animation (800-1200ms lifetime)
- Walk dust: 3 brown particles emitted every 10 frames at agent feet (400-600ms, drift upward)
- Particles rendered in world space after growth effects, with alpha fade based on elapsed/duration
- Growth burst effects (green/gold sparkle ring) for crop stage advancement (1.5s fade)

---

### Phase 6: Budget & Observability ✅ Complete
**Goal**: Track and display token/cost budget

| Step | Deliverable | Status |
|------|-------------|--------|
| 6.1 | `BudgetTracker` — 3 modes: tokens, dollars, subscription | ✅ Done |
| 6.2 | `TokenCalculator` — Per-model cost computation | ✅ Done |
| 6.3 | `BudgetStatusBar` — Always-visible status bar counter | ✅ Done |
| 6.4 | `BudgetBarPanel` — Detailed breakdown webview | ✅ Done |
| 6.5 | Color-coded warnings (green→yellow→red→critical) | ✅ Done |
| 6.6 | Cache token tracking (reads/writes) | ✅ Done |
| 6.7 | Budget display in GameViewPanel | ✅ Done |

---

### Phase 7: Event Integration ✅ Complete
**Goal**: Ingest real Claude Code activity

| Step | Deliverable | Status |
|------|-------------|--------|
| 7.1 | `EventRouter` — Central event bus (Node EventEmitter) | ✅ Done |
| 7.2 | `SessionLogReader` — Tail ~/.claude/*.jsonl files | ✅ Done |
| 7.3 | `HookServer` — HTTP endpoint on port 22140 | ✅ Done |
| 7.4 | Auto-adopt in-progress sessions at startup | ✅ Done |
| 7.5 | Hook installer command (`codemon.installHooks`) | ✅ Done |
| 7.6 | Integration mode setting (auto/session-logs/hooks) | ✅ Done |

**Implementation Notes:**
- Session log reader watches for new JSONL files and tails active ones
- Hook server receives PreToolUse, PostToolUse, SessionStart, SessionEnd
- Auto mode prefers session logs, falls back to hooks

---

### Phase 8: Subagent Animals ✅ Complete
**Goal**: Animals appear for concurrent subagent invocations

| Step | Deliverable | Status |
|------|-------------|--------|
| 8.1 | `SubAgent` entity — Animal with wander behavior | ✅ Done |
| 8.2 | Spawn/despawn on concurrent tool calls (Agent/Task events) | ✅ Done |
| 8.3 | Simple AI (wander) | ✅ Done |
| 8.4 | Animal types: chicken, cow, pig, duck (cycle assignment) | ✅ Done |
| 8.5 | Each animal type has unique behavior | 🔄 Basic (all wander; unique behaviors deferred) |

**Implementation Notes:**
- `ROUTER_EVENTS.SUBAGENT_START/STOP` emit from event-router on subagent lifecycle
- extension.ts listens and calls `gameViewPanel.spawnSubagent(id, type)` / `despawnSubagent(id)`
- Animal type cycles: chicken → cow → pig → duck based on `activeSubagentCount % 4`
- Webview `subagents[]` array: each has position, target, movement state, animation frame
- Wander AI: 5-tile radius random walkable targets, 2-5s pause between moves, speed 0.04 (half agent speed)
- Rendering: tries `drawSprite("chicken/chicken-0")` etc., falls back to colored circle
- Chicken sprites fully defined in manifest (8 frames, `chicken-idle` animation)
- Cow sprites have placeholder; pig/duck not yet in manifest (will render fallback circles)

---

## Deferred Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Day/night cycle | Lighting overlay tied to local time | Low |
| Weather | Rain particles, snow, etc. | Low |
| Sound effects | 8-bit SFX (setting exists, not implemented) | Low |
| ~~A* pathfinding~~ | ~~Agent follows walkable paths, avoids water/fences~~ | ✅ Done |
| World persistence | Save/load generated worlds | Low |
| Unique animal behaviors | Each animal type has distinct AI (follow, graze, swim) | Low |
| Cow/pig/duck sprites | Full sprite definitions in manifest | Low |

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-02 | Sprite size: 16px minimum, larger supported | Assets are mixed sizes, 16px is smallest |
| 2026-03-02 | Spritesheet layout: variable with manifest | User's assets have non-standard layouts |
| 2026-03-02 | Character movement: walk with animations | More visually interesting than teleport |
| 2026-03-02 | Subagent spawn: one per concurrent invocation | Represents parallel work accurately |
| 2026-03-02 | Day/night: deferred | Focus on core visualization first |
| 2026-03-02 | Sound: deferred | Adds complexity, not essential |
| 2026-03-02 | Asset pack: Sprout Lands Basic Pack | Farm-themed, includes characters, crops, terrain |
| 2026-03-02 | Asset transfer: data URLs via postMessage | Webview can't access extension files directly |
| 2026-03-02 | Event ingestion: session logs + HTTP hooks | Covers both VS Code extension and CLI usage |
| 2026-03-02 | Budget tracking: 3 modes | Different users have different billing models |
| 2026-03-02 | World generation: 8-phase procedural | Organic feel: noise terrain, MST paths, decorations |
| 2026-03-02 | Per-action frame counts | Different actions have different animation lengths |
| 2026-03-02 | Squarified treemap algorithm | Proper Bruls/Huizing/van Wijk instead of simple strip layout |
| 2026-03-02 | Files placed inside parent directory plots | Crops must be inside their owning fence, not at raw treemap coords |
| 2026-03-02 | Ground fills after plot relaxation | World bounds computed from final positions to prevent void gaps |
| 2026-03-02 | Plot size capped at 20×15 tiles | Prevents enormous empty fields from dominating the map |
| 2026-03-02 | 0-based world coordinate normalization | After computing world bounds (which include negative margin), shift all coordinates so minX/minY = 0; simplifies webview canvas transform |
| 2026-03-02 | World tile dimensions for canvas scaling | Webview uses `worldWidth * 16` / `worldHeight * 16` instead of layout pixel dimensions (800×600) to correctly scale the tile-rendered world |
| 2026-03-02 | Agent uses worldPlots for positioning | Agent target coordinates come from serialized Plot objects (post-normalization tile coords × 16) instead of layout pixel coords, ensuring alignment with rendered tiles |
| 2026-03-02 | Hover detection uses worldPlots | Tooltip/highlight detection converts screen coords to world tile coords via worldPlots, matching the rendered world grid |

---

## Next Actions

1. ~~**A* pathfinding** — Agent follows walkable tiles instead of direct movement~~ ✅ Done
2. **Cow/pig/duck sprites** — Full sprite definitions in manifest (currently only chicken works)
3. **Unique animal behaviors** — Per-type AI: chicken wander, cow graze, duck swim near water
4. **Day/night cycle** — Phase 6: Time progression, ambient lighting changes
5. **Weather effects** — Phase 6: Rain, seasons tied to session state

---

## Notes

- This is a living document — update status as work progresses
- Add new decisions to the log as they're made
- Move deferred features into phases when ready to implement
- Project name: **CodeMon** (package: `codemon`, repo: SprocketMonsters)
