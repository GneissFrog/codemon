# Overworld Pixel Art System — Implementation Plan

A comprehensive plan to transform the treemap visualization into a living 2D pixel art farm.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     OVERWORLD MAP PANEL                          │
├─────────────────────────────────────────────────────────────────┤
│  Game Loop (60fps)                                               │
│  ├─ Input Handler (mouse, hover, click)                         │
│  ├─ Update Phase                                                 │
│  │   ├─ Entity System (characters, animals)                     │
│  │   ├─ Animation System (frame advancement)                    │
│  │   ├─ Particle System (sparkles, effects)                     │
│  │   └─ Day/Night Cycle (lighting) [DEFERRED]                   │
│  └─ Render Phase                                                 │
│      ├─ Layer 0: Sky/Background                                 │
│      ├─ Layer 1: Ground (grass, paths, water)                   │
│      ├─ Layer 2: Terrain (fences, fields, plots)                │
│      ├─ Layer 3: Crops/Objects (file representations)           │
│      ├─ Layer 4: Characters (Claude farmer + animals)           │
│      ├─ Layer 5: Effects (activity glows, particles)            │
│      └─ Layer 6: UI (tooltips, overlays)                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ASSET SYSTEM                                │
├─────────────────────────────────────────────────────────────────┤
│  AssetLoader                                                     │
│  ├─ SpritesheetParser (extract tiles from sheets)               │
│  ├─ SpriteAtlas (texture packing, UV coords)                    │
│  └─ AnimationBank (frame sequences, timings)                    │
│                                                                  │
│  TileConfig (JSON)                                               │
│  ├─ GroundTiles: grass, dirt, path, water                       │
│  ├─ FieldTiles: fence, gate, plot variants                      │
│  ├─ CropTiles: growth stages per file type                      │
│  ├─ CharacterSprites: Claude, animals, NPCs                     │
│  └─ EffectSprites: sparkles, glows, particles                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WORLD STATE                                 │
├─────────────────────────────────────────────────────────────────┤
│  WorldMap                                                        │
│  ├─ TileGrid[x][y] → ground type, elevation                     │
│  ├─ Plots[] → file/directory mappings                           │
│  └─ Camera (pan, zoom, viewport)                                │
│                                                                  │
│  Entities[]                                                      │
│  ├─ ClaudeAgent (position, target, animation state)             │
│  ├─ SubAgents[] (animals with AI behavior)                      │
│  └─ Particles[] (spawned effects)                               │
│                                                                  │
│  ActivityState                                                   │
│  ├─ FileActivity (read/write counts, last access)               │
│  ├─ ActiveHighlights (pulses, glows)                            │
│  └─ SessionStats (total reads, writes, tokens)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── overworld/
│   ├── core/
│   │   ├── AssetLoader.ts          # Load & parse spritesheets
│   │   ├── SpriteAtlas.ts          # Texture atlas management
│   │   ├── AnimationBank.ts        # Frame sequences & timings
│   │   └── GameLoop.ts             # 60fps update/render cycle
│   │
│   ├── config/
│   │   ├── TileConfig.ts           # Type definitions
│   │   └── tile-config.json        # User-editable mappings
│   │
│   ├── world/
│   │   ├── WorldMap.ts             # Tile grid, camera
│   │   ├── WorldGenerator.ts       # Procedural layout from file tree
│   │   └── TerrainBuilder.ts       # Place fences, paths, water
│   │
│   ├── entities/
│   │   ├── Entity.ts               # Base class
│   │   ├── ClaudeAgent.ts          # Main character
│   │   ├── SubAgent.ts             # Animals (subagent swarm)
│   │   └── Particle.ts             # Effect particles
│   │
│   ├── systems/
│   │   ├── RenderSystem.ts         # Layered canvas rendering
│   │   ├── AnimationSystem.ts      # Sprite animation
│   │   ├── MovementSystem.ts       # Pathfinding, smooth movement
│   │   ├── ParticleSystem.ts       # Spawn & update particles
│   │   └── DayNightSystem.ts       # Lighting cycle [DEFERRED]
│   │
│   └── OverworldMapPanel.ts        # VS Code webview integration
│
assets/
├── sprites/
│   ├── characters/
│   │   ├── claude-farmer.png       # Spritesheet: 4 directions × N frames
│   │   ├── chicken.png             # Subagent animal
│   │   ├── pig.png
│   │   └── ...
│   ├── terrain/
│   │   ├── grass.png               # Tileset
│   │   ├── fences.png
│   │   ├── paths.png
│   │   └── water.png
│   ├── crops/
│   │   ├── wheat/                  # Growth stages
│   │   │   ├── stage-0.png         # Planted
│   │   │   ├── stage-1.png         # Sprouting
│   │   │   ├── stage-2.png         # Growing
│   │   │   └── stage-3.png         # Mature
│   │   ├── tomato/
│   │   ├── corn/
│   │   └── ...
│   └── effects/
│       ├── sparkle.png
│       ├── glow.png
│       └── ...
│
└── config/
    └── sprite-manifest.json        # Spritesheet coordinates (variable layouts)
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Rendering** | Canvas 2D | Simpler, sufficient for 2D pixel art |
| **Tile size** | 16px (min) | Classic SNES feel, supports larger sprites |
| **Map layout** | Procedural | Generated from file tree structure |
| **Sprite storage** | Runtime atlas | Pack sprites into one texture at load |
| **Animation timing** | Delta time | Smooth 60fps regardless of frame drops |
| **State sync** | Push | Extension pushes updates on events |
| **Spritesheet layout** | Variable | Config file defines sprite coordinates |

---

## Sprite Manifest Schema

Since spritesheets have variable layouts, we use a manifest to describe sprite positions:

```json
{
  "spritesheets": {
    "claude-farmer": {
      "image": "assets/sprites/characters/claude-farmer.png",
      "sprites": {
        "idle-down-0":  { "x": 0,   "y": 0,   "w": 16, "h": 24 },
        "idle-down-1":  { "x": 16,  "y": 0,   "w": 16, "h": 24 },
        "walk-down-0":  { "x": 64,  "y": 0,   "w": 16, "h": 24 },
        ...
      }
    },
    "terrain-grass": {
      "image": "assets/sprites/terrain/grass.png",
      "sprites": {
        "grass-center": { "x": 0,  "y": 0,  "w": 16, "h": 16 },
        "grass-edge-n": { "x": 16, "y": 0,  "w": 16, "h": 16 },
        ...
      }
    }
  },

  "animations": {
    "claude-idle-down": {
      "frames": ["idle-down-0", "idle-down-1", "idle-down-2", "idle-down-3"],
      "fps": 4,
      "loop": true
    },
    "claude-walk-down": {
      "frames": ["walk-down-0", "walk-down-1", "walk-down-2", "walk-down-3"],
      "fps": 8,
      "loop": true
    }
  }
}
```

---

## Tile Configuration Schema

Maps codebase concepts to visual elements:

```json
{
  "version": 1,
  "tileSize": 16,

  "fileTypeMappings": {
    ".ts":   { "crop": "wheat",   "color": "#29adff" },
    ".tsx":  { "crop": "wheat",   "color": "#29adff" },
    ".js":   { "crop": "corn",    "color": "#1d6daf" },
    ".jsx":  { "crop": "corn",    "color": "#1d6daf" },
    ".py":   { "crop": "tomato",  "color": "#00e436" },
    ".rs":   { "crop": "carrot",  "color": "#ff77a8" },
    ".go":   { "crop": "pumpkin", "color": "#00b543" },
    ".css":  { "crop": "flower",  "color": "#83769c" },
    ".json": { "crop": "herb",    "color": "#5a5d6e" },
    ".md":   { "crop": "sunflower","color": "#7e5539" },
    "_default": { "crop": "weed", "color": "#3a3d4e" }
  },

  "growthStages": {
    "wheat":   { "stages": 4, "growthRate": "activity" },
    "corn":    { "stages": 5, "growthRate": "activity" },
    "tomato":  { "stages": 6, "growthRate": "activity" },
    "flower":  { "stages": 4, "growthRate": "tokens" }
  },

  "directoryMappings": {
    "src":     { "terrain": "tilled-field", "fence": "wood" },
    "lib":     { "terrain": "grass-field",  "fence": "stone" },
    "test":    { "terrain": "sand-field",   "fence": "none" },
    "config":  { "terrain": "cobblestone",  "fence": "hedge" },
    "_default": { "terrain": "grass",       "fence": "wood" }
  },

  "characters": {
    "claude": {
      "spritesheet": "claude-farmer",
      "animations": {
        "idle": ["idle-down", "idle-up", "idle-left", "idle-right"],
        "walk": ["walk-down", "walk-up", "walk-left", "walk-right"],
        "action": ["action-0", "action-1", "action-2"]
      }
    }
  },

  "subAgents": {
    "chicken": { "behavior": "wander", "speed": 0.5 },
    "pig":     { "behavior": "forage", "speed": 0.3 },
    "cow":     { "behavior": "graze",  "speed": 0.2 },
    "duck":    { "behavior": "swim",   "speed": 0.4 }
  }
}
```

---

## Implementation Phases

### Phase 1: Asset Pipeline Foundation
**Goal**: Load and render sprites from spritesheets in the Game View

| Step | Deliverable | Status |
|------|-------------|--------|
| 1.1 | `AssetLoader.ts` — Load PNGs, convert to data URLs | ✅ Completed |
| 1.2 | `types.ts` — Type definitions for sprites, animations, entities | ✅ Completed |
| 1.3 | `sprite-manifest.json` — Sprout Lands sprite coordinates | ✅ Completed |
| 1.4 | Pass image data URIs to webview via postMessage | ✅ Completed |
| 1.5 | Integrate sprite rendering into GameViewPanel | ✅ Completed |

**Implementation Notes:**
- Assets are loaded in extension host, converted to base64 data URLs
- Webview creates `Image` objects from data URLs
- Grass ground layer renders behind everything
- Directories show tilled dirt with fence borders
- Files show crop sprites based on extension and activity level
- Falls back to colored rectangles if sprites fail to load
- **Tested 2026-03-02**: Sprites rendering correctly!

### Phase 2: World Generation
**Goal**: Transform file tree into a farm layout

| Step | Deliverable | Status |
|------|-------------|--------|
| 2.1 | `WorldMap.ts` — Tile grid data structure | ✅ Completed |
| 2.2 | `WorldGenerator.ts` — Convert file tree → farm plots | ✅ Completed |
| 2.3 | Fix sprite rendering (typo, fence positioning) | ✅ Completed |
| 2.4 | `SpriteConfigPanel` — Sidebar for viewing/configuring sprites | ✅ Completed |
| 2.5 | Test: Verify correct sprites render | 🔄 In Progress |

**Implementation Notes:**
- Created WorldMap class for tile grid management
- Created WorldGenerator to convert treemap layout to tile-based farm
- Fixed `tilted-dirt` → `tilled-dirt` typo in sprite ID
- Fixed fence positioning (now draws outside tilled area, not overlapping)
- Added proper corner/edge sprite selection for tilled dirt
- Created SpriteConfigPanel as VS Code sidebar for debugging sprite coordinates

### Phase 3: Crop System (File Visualization)
**Goal**: Files appear as crops with growth stages

| Step | Deliverable | Status |
|------|-------------|--------|
| 3.1 | `Crop.ts` entity — Sprite, growth stage, position | ⬜ Not started |
| 3.2 | Map file types → crop types via config | ⬜ Not started |
| 3.3 | Growth stage based on activity count | ⬜ Not started |
| 3.4 | Render crops in field plots | ⬜ Not started |
| 3.5 | Test: Read a file, watch its crop grow | ⬜ Not started |

### Phase 4: Character System
**Goal**: Claude walks around the farm

| Step | Deliverable | Status |
|------|-------------|--------|
| 4.1 | `Entity.ts` base class — position, velocity, sprite | ⬜ Not started |
| 4.2 | `ClaudeAgent.ts` — Directional sprites, animation states | ⬜ Not started |
| 4.3 | `AnimationSystem.ts` — Frame advancement at configured FPS | ⬜ Not started |
| 4.4 | `MovementSystem.ts` — Smooth tile-to-tile movement | ⬜ Not started |
| 4.5 | Pathfinding (A* on tile grid) | ⬜ Not started |
| 4.6 | Test: Claude walks to file when activity occurs | ⬜ Not started |

### Phase 5: Activity & Effects
**Goal**: Visual feedback for all code operations

| Step | Deliverable | Status |
|------|-------------|--------|
| 5.1 | Activity highlighting (watered/glowing crops) | ⬜ Not started |
| 5.2 | `ParticleSystem.ts` — Sparkles on write, dust on walk | ⬜ Not started |
| 5.3 | Decay animations (pulse fades after 3s) | ⬜ Not started |
| 5.4 | Action animation when Claude "works" a file | ⬜ Not started |
| 5.5 | Test: Write a file, see sparkle burst and action anim | ⬜ Not started |

### Phase 6: Subagent Animals
**Goal**: Animals appear for concurrent subagent invocations

| Step | Deliverable | Status |
|------|-------------|--------|
| 6.1 | `SubAgent.ts` — Animal entity with wander behavior | ⬜ Not started |
| 6.2 | Spawn/despawn based on concurrent tool calls | ⬜ Not started |
| 6.3 | Simple AI (wander, follow Claude, or graze) | ⬜ Not started |
| 6.4 | Each animal type has unique sprite/behavior | ⬜ Not started |
| 6.5 | Test: Trigger parallel agents, see animals appear | ⬜ Not started |

---

## Deferred Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Day/night cycle | Lighting overlay tied to local time | Low |
| Weather | Rain particles, snow, etc. | Low |
| Sound effects | Footsteps, crop sounds, ambient | Low |
| Decorations | Trees, rocks, flowers based on file age/size | Medium |

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-02 | Sprite size: 16px minimum, larger supported | Assets are mixed sizes, 16px is smallest |
| 2026-03-02 | Spritesheet layout: variable with manifest | User's assets have non-standard layouts |
| 2026-03-02 | Character movement: walk with pathfinding | More visually interesting than teleport |
| 2026-03-02 | Subagent spawn: one per concurrent invocation | Represents parallel work accurately |
| 2026-03-02 | Day/night: deferred | Focus on core visualization first |
| 2026-03-02 | Sound: deferred | Adds complexity, not essential |
| 2026-03-02 | Asset pack: Sprout Lands Basic Pack | Farm-themed, includes characters, crops, terrain |
| 2026-03-02 | Asset transfer: data URLs via postMessage | Webview can't access extension files directly |

---

## Next Actions

1. ~~**Get sample spritesheets** — Copy farm asset pack into `assets/sprites/`~~ ✅
2. ~~**Create sprite manifest** — Document coordinates for each sprite~~ ✅
3. ~~**Complete Phase 1** — Asset loader and sprite rendering in GameViewPanel~~ ✅
4. **Test Phase 1** — Press F5, verify sprites render in Game View
5. **Begin Phase 2** — World generation from file tree

---

## Notes

- This is a living document — update status as work progresses
- Add new decisions to the log as they're made
- Move deferred features into phases when ready to implement
