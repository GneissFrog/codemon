/**
 * PixiRenderer - Optimized PixiJS-based renderer for WebGL acceleration
 *
 * Uses PixiJS v8 with:
 * - Sprite pooling to avoid GC pressure
 * - Viewport culling for large maps
 * - Static tile caching (render once, not every frame)
 * - Single Graphics object for overlays
 */

// Import unsafe-eval support for environments like VS Code webviews
import 'pixi.js/unsafe-eval';

import {
  Application,
  Container,
  Sprite,
  Texture,
  Rectangle,
  Graphics,
  Text,
  TextStyle,
  ImageSource,
  AnimatedSprite,
} from 'pixi.js';
import { Renderer, WebviewAssetData, Tile, ViewportBounds, TILE_SIZE } from './types';
import { TileSpritePool, SpritePool } from './SpritePool';

export class PixiRenderer implements Renderer {
  private app: Application | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Layer containers for proper z-ordering
  private worldContainer: Container | null = null;
  private groundContainer: Container | null = null;
  private terrainContainer: Container | null = null;
  private cropsContainer: Container | null = null;
  private charactersContainer: Container | null = null;
  private effectsContainer: Container | null = null;

  // Sprite pools
  private tilePool: TileSpritePool = new TileSpritePool();
  private dynamicSpritePool: SpritePool = new SpritePool();

  // Texture storage
  private textures: Map<string, Texture> = new Map();
  private baseTextures: Map<string, Texture> = new Map();

  // Single Graphics object for overlays (reused each frame)
  private overlayGraphics: Graphics | null = null;

  // Cached text objects
  private textCache: Map<string, Text> = new Map();

  // Current viewport for culling
  private viewportBounds: ViewportBounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };

  // Current transform
  private currentPanX = 0;
  private currentPanY = 0;
  private currentZoom = 1;

  // Animation frames for water
  private animatedSprites: AnimatedSprite[] = [];
  private animationData: Map<string, string[]> = new Map();

  // Ready state
  private ready = false;

  // Track if tiles need rebuild
  private tilesDirty = true;
  private lastTileCount = 0;

  // Ticker callback
  private updateCallback: ((deltaTime: number) => void) | null = null;
  private useTickerRendering = false;

  // Event callbacks
  private onPlotHover: ((tileX: number, tileY: number) => void) | null = null;
  private onPlotClick: ((tileX: number, tileY: number) => void) | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    try {
      // Create PixiJS application
      this.app = new Application();
      await this.app.init({
        view: canvas,
        width: canvas.width || 800,
        height: canvas.height || 600,
        backgroundColor: 0x1a1c2c,
        antialias: false, // Pixel art - no antialiasing
        resolution: 1, // Fixed resolution for pixel art
        autoDensity: false,
        manageImports: false, // Disable auto-importing extensions
      });

      const stage = this.app.stage;

      // Create world container for camera transform
      this.worldContainer = new Container();
      stage.addChild(this.worldContainer);

      // Create layer containers with render group optimization
      this.groundContainer = new Container({ isRenderGroup: true });
      this.terrainContainer = new Container({ isRenderGroup: true });
      this.cropsContainer = new Container({ isRenderGroup: true });
      this.charactersContainer = new Container();
      this.effectsContainer = new Container();

      this.worldContainer.addChild(this.groundContainer);
      this.worldContainer.addChild(this.terrainContainer);
      this.worldContainer.addChild(this.cropsContainer);
      this.worldContainer.addChild(this.charactersContainer);
      this.worldContainer.addChild(this.effectsContainer);

      // Set up sprite pools
      this.tilePool.setContainer(this.groundContainer);
      this.tilePool.setTextureCache(this.textures);
      this.dynamicSpritePool.setContainer(this.charactersContainer);

      // Pre-allocate some sprites
      this.dynamicSpritePool.preAllocate(50);

      // Create single overlay graphics (reused each frame)
      this.overlayGraphics = new Graphics();
      this.worldContainer.addChild(this.overlayGraphics);

      this.ready = true;
      console.log('[PixiRenderer] Initialized successfully with sprite pooling');
    } catch (error) {
      console.error('[PixiRenderer] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Set up the update callback to be called each frame by PixiJS Ticker
   * This replaces manual requestAnimationFrame loops
   */
  setUpdatesPerFrame(callback: (deltaTime: number) => void): void {
    this.updateCallback = callback;
    this.useTickerRendering = true;

    if (this.app && this.app.ticker) {
      // Remove any existing listener
      this.app.ticker.remove(this.handleTickerUpdate, this);

      // Add new listener
      this.app.ticker.add(this.handleTickerUpdate, this);
    }
  }

  /**
   * Handle ticker update - called by PixiJS each frame
   */
  private handleTickerUpdate = (ticker: { deltaTime: number }): void => {
    if (this.updateCallback) {
      this.updateCallback(ticker.deltaTime);
    }
  };

  /**
   * Start the PixiJS ticker (begins rendering loop)
   */
  startTicker(): void {
    if (this.app && this.app.ticker) {
      this.app.ticker.start();
    }
  }

  /**
   * Stop the PixiJS ticker (pauses rendering)
   */
  stopTicker(): void {
    if (this.app && this.app.ticker) {
      this.app.ticker.stop();
    }
  }

  /**
   * Set up event callbacks for hover and click
   */
  setEventCallbacks(
    onHover: ((tileX: number, tileY: number) => void) | null,
    onClick: ((tileX: number, tileY: number) => void) | null
  ): void {
    this.onPlotHover = onHover;
    this.onPlotClick = onClick;
  }

  /**
   * Enable PixiJS event system on world container
   */
  enableInteractivity(): void {
    if (!this.worldContainer || !this.app) return;

    // Make world container interactive
    this.worldContainer.eventMode = 'static';
    this.worldContainer.hitArea = this.app.screen;

    // Set up pointer events
    this.worldContainer.on('pointermove', this.handlePointerMove, this);
    this.worldContainer.on('pointerdown', this.handlePointerDown, this);

    console.log('[PixiRenderer] Interactivity enabled');
  }

  /**
   * Disable PixiJS event system
   */
  disableInteractivity(): void {
    if (!this.worldContainer) return;

    this.worldContainer.eventMode = 'passive';
    this.worldContainer.off('pointermove', this.handlePointerMove, this);
    this.worldContainer.off('pointerdown', this.handlePointerDown, this);
  }

  /**
   * Handle pointer move events
   */
  private handlePointerMove = (event: any): void => {
    if (!this.onPlotHover || !this.worldContainer) return;

    const localPos = event.data.global;
    // Transform to world coordinates
    const worldX = (localPos.x - this.currentPanX) / this.currentZoom;
    const worldY = (localPos.y - this.currentPanY) / this.currentZoom;

    // Convert to tile coordinates
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);

    this.onPlotHover(tileX, tileY);
  };

  /**
   * Handle pointer down events
   */
  private handlePointerDown = (event: any): void => {
    if (!this.onPlotClick || !this.worldContainer) return;

    const localPos = event.data.global;
    // Transform to world coordinates
    const worldX = (localPos.x - this.currentPanX) / this.currentZoom;
    const worldY = (localPos.y - this.currentPanY) / this.currentZoom;

    // Convert to tile coordinates
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);

    this.onPlotClick(tileX, tileY);
  };

  /**
   * Convert screen coordinates to world tile coordinates
   */
  screenToTile(screenX: number, screenY: number): { tileX: number; tileY: number } {
    const worldX = (screenX - this.currentPanX) / this.currentZoom;
    const worldY = (screenY - this.currentPanY) / this.currentZoom;
    return {
      tileX: Math.floor(worldX / TILE_SIZE),
      tileY: Math.floor(worldY / TILE_SIZE),
    };
  }

  async loadSpritesheets(assets: WebviewAssetData): Promise<void> {
    if (!assets || !assets.spritesheets) {
      console.warn('[PixiRenderer] No assets data received');
      return;
    }

    console.log('[PixiRenderer] Loading sprites...');

    for (const [name, sheetData] of Object.entries(assets.spritesheets)) {
      try {
        // Load the base texture from data URL using ImageSource
        const baseTexture = await this.loadImageFromDataURL(sheetData.imageUrl, name);

        if (!baseTexture) {
          console.warn('[PixiRenderer] Failed to load texture for:', name);
          continue;
        }

        this.baseTextures.set(name, baseTexture);

        // Create sub-textures for each sprite
        for (const [spriteName, def] of Object.entries(sheetData.sprites)) {
          const spriteId = `${name}/${spriteName}`;
          const subTexture = new Texture({
            source: baseTexture.source,
            frame: new Rectangle(def.x, def.y, def.w, def.h),
          });
          this.textures.set(spriteId, subTexture);
        }

        console.log('[PixiRenderer] Loaded spritesheet:', name, 'sprites:', Object.keys(sheetData.sprites).length);
      } catch (error) {
        console.warn('[PixiRenderer] Failed to load spritesheet:', name, error);
      }
    }

    // Update texture cache reference for tile pool
    this.tilePool.setTextureCache(this.textures);
    console.log('[PixiRenderer] Total textures loaded:', this.textures.size);
  }

  /**
   * Load an image from a data URL and create a Texture
   */
  private loadImageFromDataURL(dataUrl: string, name: string): Promise<Texture | null> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const source = new ImageSource({
            resource: image,
          });
          const texture = new Texture({ source });
          resolve(texture);
        } catch (error) {
          console.warn('[PixiRenderer] Failed to create texture for:', name, error);
          resolve(null);
        }
      };
      image.onerror = () => {
        console.warn('[PixiRenderer] Failed to load image for:', name);
        resolve(null);
      };
      image.src = dataUrl;
    });
  }

  /**
   * Set all tiles at once - creates static tile layer with animated water
   */
  setTiles(tiles: Tile[]): void {
    if (!this.ready) return;

    // Clear existing tiles
    this.tilePool.clear();
    this.clearAnimatedSprites();

    // Add tiles to pool, detect animated tiles (water)
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y},${tile.layer}`;
      const x = tile.x * TILE_SIZE;
      const y = tile.y * TILE_SIZE;

      // Check if this is an animated water tile
      if (tile.type === 'water' && this.hasAnimationFrames(tile.spriteId)) {
        this.createAnimatedWaterTile(key, tile.spriteId, x, y, tile);
      } else {
        // Static tile
        this.tilePool.setTile(key, tile.spriteId, x, y);
      }
    }

    this.lastTileCount = tiles.length;
    this.tilesDirty = false;

    console.log('[PixiRenderer] Set', tiles.length, 'tiles,', this.animatedSprites.length, 'animated');
  }

  /**
   * Check if a sprite has animation frames (e.g., water-0, water-1, water-2)
   */
  private hasAnimationFrames(spriteId: string): boolean {
    // Extract base name and check for frame variants
    const match = spriteId.match(/^(.+)-(\d+)$/);
    if (!match) return false;

    const baseId = match[1];
    // Check if we have at least 2 frames
    for (let i = 0; i < 4; i++) {
      if (!this.textures.has(`${baseId}-${i}`)) {
        return i >= 2; // Need at least 2 frames for animation
      }
    }
    return true;
  }

  /**
   * Get animation frame IDs for a sprite
   */
  private getAnimationFrameIds(spriteId: string): string[] {
    const match = spriteId.match(/^(.+)-(\d+)$/);
    if (!match) return [spriteId];

    const baseId = match[1];
    const frames: string[] = [];

    for (let i = 0; i < 8; i++) {
      const frameId = `${baseId}-${i}`;
      if (this.textures.has(frameId)) {
        frames.push(frameId);
      } else {
        break;
      }
    }

    return frames.length >= 2 ? frames : [spriteId];
  }

  /**
   * Create an animated water tile using AnimatedSprite
   */
  private createAnimatedWaterTile(key: string, spriteId: string, x: number, y: number, tile: Tile): void {
    const frameIds = this.getAnimationFrameIds(spriteId);
    const textures: Texture[] = [];

    for (const id of frameIds) {
      const tex = this.textures.get(id);
      if (tex) textures.push(tex);
    }

    if (textures.length < 2) {
      // Not enough frames, use static
      this.tilePool.setTile(key, spriteId, x, y);
      return;
    }

    const animatedSprite = new AnimatedSprite(textures);
    animatedSprite.x = x;
    animatedSprite.y = y;
    animatedSprite.width = TILE_SIZE;
    animatedSprite.height = TILE_SIZE;

    // Randomize start frame and speed for natural look
    const startFrame = Math.abs((tile.x * 3 + tile.y * 7) % textures.length);
    animatedSprite.currentFrame = startFrame;
    animatedSprite.animationSpeed = 0.05 + Math.random() * 0.03;
    animatedSprite.play();

    // Add to appropriate container based on layer
    switch (tile.layer) {
      case 0:
        this.groundContainer?.addChild(animatedSprite);
        break;
      case 1:
        this.terrainContainer?.addChild(animatedSprite);
        break;
      default:
        this.cropsContainer?.addChild(animatedSprite);
    }

    this.animatedSprites.push(animatedSprite);
  }

  /**
   * Update a single tile
   */
  updateTile(tile: Tile): void {
    if (!this.ready) return;

    const key = `${tile.x},${tile.y},${tile.layer}`;
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;

    this.tilePool.setTile(key, tile.spriteId, x, y);
  }

  /**
   * Clear dynamic objects (agents, particles, effects)
   */
  clearDynamicObjects(): void {
    this.dynamicSpritePool.releaseAll();
    this.effectsContainer?.removeChildren();
  }

  /**
   * Set viewport bounds for culling
   */
  setViewportBounds(bounds: ViewportBounds): void {
    this.viewportBounds = bounds;
    this.tilePool.cullTiles(bounds, TILE_SIZE);
  }

  /**
   * Check if renderer is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get current viewport bounds
   */
  getViewportBounds(): ViewportBounds {
    return { ...this.viewportBounds };
  }

  clear(): void {
    // Clear dynamic objects, keep static tiles
    this.clearDynamicObjects();
    this.overlayGraphics?.clear();
  }

  beginFrame(): void {
    // Clear dynamic sprites and overlay graphics
    this.dynamicSpritePool.releaseAll();
    this.effectsContainer?.removeChildren();
    this.overlayGraphics?.clear();
  }

  endFrame(): void {
    // When using PixiJS ticker, rendering is automatic
    // Only call render() for manual game loops
    if (!this.useTickerRendering && this.app) {
      this.app.render();
    }
  }

  drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean {
    const texture = this.textures.get(id);
    if (!texture) {
      // Fallback: draw a colored rectangle for missing sprites
      if (id.includes('char-')) {
        this.drawRect(x, y, w || 16, h || 24, '#5fcf5f', 1);
      }
      return false;
    }

    // Use dynamic sprite pool for non-tile sprites
    this.dynamicSpritePool.acquire(texture, x, y, w, h);
    return true;
  }

  /**
   * Draw a tile sprite - uses tile pool for efficiency
   */
  drawTileSprite(id: string, x: number, y: number, layer: number): boolean {
    const texture = this.textures.get(id);
    if (!texture) return false;

    const key = `${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)},${layer}`;
    this.tilePool.setTile(key, id, x, y);
    return true;
  }

  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    if (!this.overlayGraphics) return;

    const colorNum = this.parseColor(color);
    this.overlayGraphics.rect(x, y, w, h);
    this.overlayGraphics.fill({ color: colorNum, alpha });
  }

  drawText(text: string, x: number, y: number, color: string, fontSize: number = 7): void {
    if (!this.effectsContainer) return;

    // Use cached text object if available
    const cacheKey = `${text}-${color}-${fontSize}`;
    let textObj = this.textCache.get(cacheKey);

    if (!textObj) {
      const colorNum = this.parseColor(color);
      const textStyle = new TextStyle({
        fontFamily: 'monospace',
        fontSize,
        fill: colorNum,
      });
      textObj = new Text({ text, style: textStyle });
      this.textCache.set(cacheKey, textObj);
    }

    // Clone position for this frame
    textObj.x = x;
    textObj.y = y;
    this.effectsContainer.addChild(textObj);
  }

  setTransform(panX: number, panY: number, zoom: number): void {
    this.currentPanX = panX;
    this.currentPanY = panY;
    this.currentZoom = zoom;

    if (this.worldContainer) {
      this.worldContainer.position.set(panX, panY);
      this.worldContainer.scale.set(zoom);
    }

    // Update viewport bounds for culling
    this.updateViewportBounds();
  }

  /**
   * Calculate and update viewport bounds based on camera and canvas
   */
  private updateViewportBounds(): void {
    if (!this.canvas) return;

    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    const zoom = this.currentZoom;
    const panX = this.currentPanX;
    const panY = this.currentPanY;

    // Convert screen bounds to tile coordinates
    const left = -panX / (TILE_SIZE * zoom);
    const top = -panY / (TILE_SIZE * zoom);
    const right = (viewW - panX) / (TILE_SIZE * zoom);
    const bottom = (viewH - panY) / (TILE_SIZE * zoom);

    this.viewportBounds = {
      minX: Math.floor(left) - 1,
      maxX: Math.ceil(right) + 1,
      minY: Math.floor(top) - 1,
      maxY: Math.ceil(bottom) + 1,
    };

    // Apply culling
    this.tilePool.cullTiles(this.viewportBounds, TILE_SIZE);
  }

  resize(width: number, height: number): void {
    if (this.app && this.app.renderer) {
      this.app.renderer.resize(width, height);
      this.updateViewportBounds();
    }
  }

  dispose(): void {
    // Stop ticker and clear callback
    this.updateCallback = null;
    if (this.app?.ticker) {
      this.app.ticker.remove(this.handleTickerUpdate, this);
      this.app.ticker.stop();
    }

    // Clear animated sprites
    this.clearAnimatedSprites();

    // Clean up sprite pools
    this.tilePool.destroy();
    this.dynamicSpritePool.destroy();

    // Clean up textures
    for (const texture of this.textures.values()) {
      texture.destroy(true);
    }
    this.textures.clear();

    for (const baseTexture of this.baseTextures.values()) {
      baseTexture.destroy(true);
    }
    this.baseTextures.clear();

    // Clean up text cache
    for (const textObj of this.textCache.values()) {
      textObj.destroy(true);
    }
    this.textCache.clear();

    // Destroy application with children
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }

    // Clear container references
    this.worldContainer = null;
    this.groundContainer = null;
    this.terrainContainer = null;
    this.cropsContainer = null;
    this.charactersContainer = null;
    this.effectsContainer = null;
    this.overlayGraphics = null;
    this.canvas = null;
    this.ready = false;
    this.useTickerRendering = false;
  }

  // ─── PixiJS-specific helpers ────────────────────────────────────────

  /**
   * Create an animated sprite for water or other animations
   */
  createAnimatedSprite(frameIds: string[], x: number, y: number, speed: number = 0.1): AnimatedSprite | null {
    const frames: Texture[] = [];

    for (const id of frameIds) {
      const texture = this.textures.get(id);
      if (texture) frames.push(texture);
    }

    if (frames.length === 0) return null;

    const animatedSprite = new AnimatedSprite(frames);
    animatedSprite.animationSpeed = speed;
    animatedSprite.x = x;
    animatedSprite.y = y;
    animatedSprite.play();

    this.animatedSprites.push(animatedSprite);
    return animatedSprite;
  }

  /**
   * Clear all animated sprites
   */
  private clearAnimatedSprites(): void {
    for (const sprite of this.animatedSprites) {
      sprite.stop();
      if (sprite.parent) {
        sprite.parent.removeChild(sprite);
      }
      sprite.destroy();
    }
    this.animatedSprites.length = 0;
  }

  /**
   * Get the stage for advanced operations
   */
  getStage(): Container | null {
    return this.app?.stage || null;
  }

  /**
   * Get the world container for camera operations
   */
  getWorldContainer(): Container | null {
    return this.worldContainer;
  }

  /**
   * Parse CSS color string to number
   */
  private parseColor(color: string): number {
    if (color.startsWith('#')) {
      return parseInt(color.slice(1), 16);
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/(\d+)/g);
      if (match && match.length >= 3) {
        return (parseInt(match[0]) << 16) | (parseInt(match[1]) << 8) | parseInt(match[2]);
      }
    }
    return 0xffffff;
  }
}
