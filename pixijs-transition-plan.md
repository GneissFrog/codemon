# PixiJS Renderer Transition Plan

## Executive Summary

The transition to PixiJS has begun but is incomplete. The current implementation in `src/webview/gameview/pixi-renderer.ts` has basic functionality but suffers from performance issues due to inefficient patterns:

1. **Creates new objects every frame** - Sprites, Graphics, Text created fresh each render call
2. **No sprite pooling** - Causes GC pressure and stuttering
3. **No viewport culling** - Renders thousands of off-screen tiles
4. **Manual game loop** - Doesn't leverage PixiJS Ticker
5. **No batched rendering** - Doesn't use ParticleContainer for tiles

This plan outlines a phased approach to complete the transition with proper PixiJS v8 patterns.

---

## Current State Analysis

### What's Working
- [x] Basic PixiJS Application initialization
- [x] Layer containers for z-ordering (ground, terrain, crops, characters, effects)
- [x] Texture loading from data URLs (via ImageSource)
- [x] Camera transform via worldContainer
- [x] Basic sprite drawing

### What Needs Work
- [ ] Sprite pooling / object reuse
- [ ] Viewport culling for large maps
- [ ] AnimatedSprite for water, effects
- [ ] ParticleContainer for static tiles
- [ ] Proper Ticker integration
- [ ] Graphics object pooling
- [ ] Text caching

### Key Files
```
src/webview/gameview/
├── index.ts           # Entry point, game loop, message handling
├── engine.ts          # Game logic (pathfinding, movement, particles)
├── camera.ts          # Pan/zoom state
├── types.ts           # Renderer interface, game types
└── pixi-renderer.ts   # PixiJS implementation (needs overhaul)
```

---

## Phase 1: Foundation Fixes (High Priority)

### 1.1 Implement Sprite Pooling

**Problem:** `drawSprite()` creates new Sprite objects every frame.

**Solution:** Pre-allocate sprite pools and reuse them.

```typescript
class SpritePool {
  private pool: Sprite[] = [];
  private active: Sprite[] = [];

  acquire(texture: Texture): Sprite {
    let sprite = this.pool.pop();
    if (!sprite) sprite = new Sprite(texture);
    else sprite.texture = texture;
    this.active.push(sprite);
    return sprite;
  }

  releaseAll(): void {
    for (const sprite of this.active) {
      sprite.removeFromParent();
      this.pool.push(sprite);
    }
    this.active.length = 0;
  }
}
```

### 1.2 Implement Tile Culling

**Problem:** All tiles rendered regardless of viewport visibility.

**Solution:** Only render tiles within camera bounds.

```typescript
function getVisibleTileBounds(): { minX: number, maxX: number, minY: number, maxY: number } {
  const { panX, panY, zoom } = camera;
  const viewW = canvas.width;
  const viewH = canvas.height;

  // Convert screen bounds to tile coordinates
  const left = -panX / (TILE_SIZE * zoom);
  const top = -panY / (TILE_SIZE * zoom);
  const right = (viewW - panX) / (TILE_SIZE * zoom);
  const bottom = (viewH - panY) / (TILE_SIZE * zoom);

  return {
    minX: Math.floor(left) - 1,
    maxX: Math.ceil(right) + 1,
    minY: Math.floor(top) - 1,
    maxY: Math.ceil(bottom) + 1
  };
}
```

### 1.3 Static Tile Layer Optimization

**Problem:** Tiles are redrawn every frame even though they don't change.

**Solution:** Separate static tiles from dynamic objects.

```typescript
// One-time tile rendering (only when map changes)
function renderStaticTiles(): void {
  groundContainer.removeChildren();

  for (const tile of visibleTiles) {
    const sprite = new Sprite(textures.get(tile.spriteId));
    sprite.x = tile.x * TILE_SIZE;
    sprite.y = tile.y * TILE_SIZE;
    groundContainer.addChild(sprite);
  }

  // Mark as render group for GPU batching
  groundContainer.isRenderGroup = true;
}
```

---

## Phase 2: PixiJS Native Features

### 2.1 Use PixiJS Ticker

**Current:** Manual `requestAnimationFrame` loop in `index.ts`.

**Better:** Use PixiJS Application ticker.

```typescript
// In PixiRenderer.init()
this.app.ticker.add((ticker) => {
  const deltaTime = ticker.deltaTime;
  engine.update(deltaTime);
  // No need to call render() - PixiJS handles it
});
```

### 2.2 AnimatedSprite for Water/Effects

**Current:** Manual animation frame tracking in engine.ts.

**Better:** Use PixiJS AnimatedSprite.

```typescript
import { AnimatedSprite } from 'pixi.js';

// Create animated water
const waterFrames = ['water-0', 'water-1', 'water-2'].map(id => textures.get(id));
const waterSprite = new AnimatedSprite(waterFrames);
waterSprite.animationSpeed = 0.1;
waterSprite.play();
```

### 2.3 ParticleContainer for Tiles

**Problem:** Regular Container has overhead for thousands of tiles.

**Solution:** Use ParticleContainer (now just Container with optimizations in v8).

```typescript
// In v8, Container is already optimized, but we can use renderGroup
const tileContainer = new Container({
  isRenderGroup: true,  // Batches children for GPU
  sortableChildren: false  // Disable if not needed
});
```

### 2.4 Graphics Pooling

**Problem:** Overlay Graphics created fresh each frame.

**Solution:** Reuse a single Graphics object.

```typescript
class PixiRenderer {
  private overlayGraphics: Graphics;

  beginFrame(): void {
    this.overlayGraphics.clear();  // Reuse same object
  }

  // No need to create new Graphics for each rect
}
```

---

## Phase 3: Advanced Optimizations

### 3.1 RenderTexture for Static Layers

Cache the tile layer to a RenderTexture when map doesn't change.

```typescript
const tileTexture = renderer.generateTexture(tileContainer);
const tileSprite = new Sprite(tileTexture);
// Now render single sprite instead of thousands
```

### 3.2 Spatial Hash for Hit Testing

**Current:** Linear search through all plots for hover detection.

**Better:** Spatial hash for O(1) lookups.

```typescript
class SpatialHash<T> {
  private cells: Map<string, T[]> = new Map();
  private cellSize: number;

  insert(x: number, y: number, item: T): void {
    const key = `${Math.floor(x/this.cellSize)},${Math.floor(y/this.cellSize)}`;
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key)!.push(item);
  }

  query(x: number, y: number): T[] {
    const key = `${Math.floor(x/this.cellSize)},${Math.floor(y/this.cellSize)}`;
    return this.cells.get(key) || [];
  }
}
```

### 3.3 Texture Atlas Generation

**Current:** Multiple spritesheets loaded separately.

**Better:** Generate a single texture atlas at runtime.

---

## Phase 4: Architectural Improvements

### 4.1 Scene Graph Reorganization

```
stage
├── worldContainer (camera transform applied)
│   ├── tileLayer (isRenderGroup: true, static)
│   ├── decorationLayer
│   ├── characterLayer
│   │   ├── agentSprite
│   │   └── subagentSprites[]
│   └── effectsLayer
│       └── particleContainer
└── uiLayer (no transform)
    ├── overlayGraphics
    └── textLabels
```

### 4.2 Event System Integration

Use PixiJS event system for interactions instead of manual hit testing.

```typescript
// Make sprites interactive
sprite.eventMode = 'static';
sprite.on('pointerover', () => showTooltip());
sprite.on('pointerout', () => hideTooltip());
sprite.cursor = 'pointer';
```

### 4.3 Proper Disposal

Implement disposal for all PixiJS resources.

```typescript
dispose(): void {
  // Destroy textures
  for (const texture of this.textures.values()) {
    texture.destroy(true);
  }

  // Pools
  this.spritePool.destroy();

  // Application
  this.app.destroy(true, { children: true, texture: true });
}
```

---

## Implementation Order

### Sprint 1 (Week 1): Performance Basics ✅ COMPLETED
1. [x] Implement SpritePool class
2. [x] Add viewport culling to renderMap()
3. [x] Fix Graphics recreation (use single overlayGraphics)
4. [x] Test with large maps (100+ tiles)

### Sprint 2 (Week 2): PixiJS Integration ✅ COMPLETED
1. [x] Convert to PixiJS Ticker
2. [x] Implement AnimatedSprite for water tiles
3. [x] Static tile layer caching (render once, not every frame)
4. [x] Update text rendering (cache Text objects)

### Sprint 3 (Week 3): Polish ✅ COMPLETED
1. [x] Implement PixiJS event system for hover/click
2. [x] Spatial hash for plot lookup
3. [x] Proper disposal/cleanup
4. [x] Performance profiling and optimization

---

## API Changes

### Renderer Interface Updates

```typescript
export interface Renderer {
  // Existing
  init(canvas: HTMLCanvasElement): Promise<void>;
  loadSpritesheets(assets: WebviewAssetData): Promise<void>;
  clear(): void;
  beginFrame(): void;
  endFrame(): void;
  drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean;
  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void;
  drawText(text: string, x: number, y: number, color: string, fontSize?: number): void;
  setTransform(panX: number, panY: number, zoom: number): void;
  resize(width: number, height: number): void;
  dispose(): void;

  // New methods for optimized rendering
  setTiles(tiles: Tile[]): void;        // One-time tile setup
  updateTile(tile: Tile): void;          // Update single tile
  clearDynamicObjects(): void;           // Clear agents, particles
  setViewport(bounds: ViewportBounds): void;  // For culling
}
```

### New Types

```typescript
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PooledSprite {
  sprite: Sprite;
  inUse: boolean;
}
```

---

## Testing Strategy

1. **Performance benchmarks**
   - Frame time with 100 tiles (target: <16ms)
   - Frame time with 1000 tiles (target: <16ms)
   - Memory usage over time (no leaks)

2. **Visual regression**
   - Compare Canvas2D vs PixiJS output
   - Verify all sprites render correctly
   - Check camera pan/zoom behavior

3. **Edge cases**
   - Empty map
   - Single tile
   - Very large maps (100x100+)
   - Rapid camera movements

---

## Rollback Plan

Keep the Renderer interface abstraction. If PixiJS issues arise:

1. Create `Canvas2DRenderer` implementing same interface
2. Add config option: `codemon.gameView.renderer: "auto" | "pixi" | "canvas"`
3. Auto-detect WebGL support and fallback

```typescript
const renderer = config.renderer === 'canvas' || !hasWebGL()
  ? new Canvas2DRenderer()
  : new PixiRenderer();
```

---

## Resources

- [PixiJS v8 Documentation](https://pixijs.com/8.x/guides/)
- [PixiJS v8 Migration Guide](docs/llms-full.txt) (local copy)
- [Sprite Batching Best Practices](https://pixijs.com/8.x/guides/basics/sprites)
- [Performance Optimization](https://pixijs.com/8.x/guides/basics/performance-tips)
