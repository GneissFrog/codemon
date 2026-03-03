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
  BitmapText,
  Assets,
} from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { Renderer, WebviewAssetData, Tile, ViewportBounds, TILE_SIZE, LightingState, PointLight } from './types';
import { TileSpritePool, SpritePool } from './SpritePool';
import { LightingManager } from './LightingManager';

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
  private uiContainer: Container | null = null; // UI layer - always on top, unaffected by camera

  // Sprite pools
  private tilePool: TileSpritePool = new TileSpritePool();
  private dynamicSpritePool: SpritePool = new SpritePool();

  // Texture storage
  private textures: Map<string, Texture> = new Map();
  private baseTextures: Map<string, Texture> = new Map();
  private normalMapTextures: Map<string, Texture> = new Map();  // Normal map textures by spritesheet name

  // Single Graphics object for overlays (reused each frame)
  private overlayGraphics: Graphics | null = null;

  // Cached text objects
  private textCache: Map<string, Text> = new Map();
  private bitmapTextCache: Map<string, BitmapText> = new Map();

  // Bitmap font settings
  private bitmapFontLoaded = false;
  private bitmapFontName = 'PixelFont';

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

  // Glow filter for active file highlighting (shared instance)
  private activeGlowFilter: GlowFilter | null = null;

  // Day/night cycle
  private lightingOverlay: Graphics | null = null;
  private dayNightEnabled = true;
  private lastLightingUpdate = 0;
  private lastAmbientValue = -1; // Track last ambient to avoid unnecessary redraws

  // Lighting system (using graphics overlay due to PixiJS v8 filter bug)
  private lightingManager: LightingManager | null = null;
  private normalMapEnabled = true;

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

      // Create layer containers (removed isRenderGroup due to filter compatibility issue)
      this.groundContainer = new Container();
      this.terrainContainer = new Container();
      this.cropsContainer = new Container();
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

      // Create UI container - added to stage (not worldContainer) so it's
      // always on top and unaffected by camera transforms
      this.uiContainer = new Container();
      stage.addChild(this.uiContainer);

      // Create shared glow filter for active file highlighting
      this.activeGlowFilter = new GlowFilter({
        distance: 4,
        color: 0xffec27,
        quality: 0.5,
        outerStrength: 2,
        innerStrength: 0,
      });

      // Create lighting manager ( lightweight, no GL resources )
      this.lightingManager = new LightingManager({
        enabled: this.normalMapEnabled,
        dayNightCycle: true,
        agentLight: true,
        agentLightRadius: 80,
        agentLightIntensity: 0.8,
        agentLightColor: 0xffaa44,
      });

      // Note: NormalMapFilter is created lazily when normal maps are loaded

      // Create lighting overlay for day/night cycle
      this.lightingOverlay = new Graphics();
      this.worldContainer.addChild(this.lightingOverlay);

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

        // Load normal map if available
        if (sheetData.normalMapUrl) {
          const normalTexture = await this.loadImageFromDataURL(sheetData.normalMapUrl, `${name}_normal`);
          if (normalTexture) {
            this.normalMapTextures.set(name, normalTexture);
            console.log('[PixiRenderer] Loaded normal map for:', name);
          }
        }

        console.log('[PixiRenderer] Loaded spritesheet:', name, 'sprites:', Object.keys(sheetData.sprites).length);
      } catch (error) {
        console.warn('[PixiRenderer] Failed to load spritesheet:', name, error);
      }
    }

    // Update texture cache reference for tile pool
    this.tilePool.setTextureCache(this.textures);
    console.log('[PixiRenderer] Total textures loaded:', this.textures.size, 'normal maps:', this.normalMapTextures.size);

    // NOTE: PixiJS v8 has a bug with filters causing "Cannot read properties of undefined (reading 'push')"
    // in collectRenderablesWithEffects. Using graphics overlay for lighting instead.
    // See: https://github.com/pixijs/pixijs/issues/XXXXX
    console.log('[PixiRenderer] Using graphics overlay for day/night cycle (filters disabled due to PixiJS v8 bug)');
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
        this.tilePool.setTile(key, tile.spriteId, x, y, TILE_SIZE);
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
      this.tilePool.setTile(key, spriteId, x, y, TILE_SIZE);
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

    this.tilePool.setTile(key, tile.spriteId, x, y, TILE_SIZE);
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
    // Culling is now handled automatically by PixiJS via sprite.cullable = true
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
    this.tilePool.setTile(key, id, x, y, TILE_SIZE);
    return true;
  }

  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    if (!this.overlayGraphics) return;

    const colorNum = this.parseColor(color);
    this.overlayGraphics.rect(x, y, w, h);
    this.overlayGraphics.fill({ color: colorNum, alpha });
  }

  /**
   * Draw a glow effect around a rectangle (for active file highlighting)
   * Uses multiple layered rects with decreasing alpha for glow effect
   */
  drawGlowRect(x: number, y: number, w: number, h: number, color: string = '#ffec27'): void {
    if (!this.overlayGraphics) return;

    const colorNum = this.parseColor(color);

    // Draw multiple rects with decreasing alpha for glow effect
    const glowLayers = [
      { offset: 4, alpha: 0.1 },
      { offset: 3, alpha: 0.15 },
      { offset: 2, alpha: 0.2 },
      { offset: 1, alpha: 0.3 },
    ];

    for (const layer of glowLayers) {
      this.overlayGraphics.rect(
        x - layer.offset,
        y - layer.offset,
        w + layer.offset * 2,
        h + layer.offset * 2
      );
      this.overlayGraphics.fill({ color: colorNum, alpha: layer.alpha });
    }
  }

  drawText(text: string, x: number, y: number, color: string, fontSize: number = 7): void {
    if (!this.effectsContainer) return;

    // Use BitmapText if font is loaded, otherwise fall back to Text
    if (this.bitmapFontLoaded) {
      const cacheKey = `bmp-${text}-${fontSize}`;
      let bitmapText = this.bitmapTextCache.get(cacheKey);

      if (!bitmapText) {
        bitmapText = new BitmapText({
          text,
          style: {
            fontName: this.bitmapFontName,
            fontSize,
          },
        });
        this.bitmapTextCache.set(cacheKey, bitmapText);
      }

      bitmapText.x = x;
      bitmapText.y = y;
      // Apply color tint
      const colorNum = this.parseColor(color);
      bitmapText.tint = colorNum;
      this.effectsContainer.addChild(bitmapText);
    } else {
      // Fallback to cached Text objects
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

      textObj.x = x;
      textObj.y = y;
      this.effectsContainer.addChild(textObj);
    }
  }

  /**
   * Load a bitmap font for use with BitmapText
   * Call this during initialization if a font is available
   */
  async loadBitmapFont(fontUrl: string, fontName: string = 'PixelFont'): Promise<boolean> {
    try {
      await Assets.load(fontUrl);
      this.bitmapFontName = fontName;
      this.bitmapFontLoaded = true;
      console.log(`[PixiRenderer] Loaded bitmap font: ${fontName}`);
      return true;
    } catch (error) {
      console.warn(`[PixiRenderer] Failed to load bitmap font: ${error}`);
      return false;
    }
  }

  /**
   * Draw weather particles (rain/snow)
   */
  drawWeatherParticles(particles: { x: number; y: number; type: 'rain' | 'snow'; size: number; alpha: number }[]): void {
    if (!this.overlayGraphics) return;

    for (const p of particles) {
      if (p.type === 'rain') {
        // Rain is a short vertical line
        this.overlayGraphics.moveTo(p.x, p.y);
        this.overlayGraphics.lineTo(p.x, p.y + p.size * 4);
        this.overlayGraphics.stroke({ color: 0x8899bb, alpha: p.alpha, width: 1 });
      } else {
        // Snow is a small circle
        this.overlayGraphics.circle(p.x, p.y, p.size);
        this.overlayGraphics.fill({ color: 0xffffff, alpha: p.alpha });
      }
    }
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

    // Culling is now handled automatically by PixiJS via sprite.cullable = true
  }

  resize(width: number, height: number): void {
    if (this.app && this.app.renderer) {
      this.app.renderer.resize(width, height);
      this.updateViewportBounds();
    }
  }

  // ─── Day/Night Cycle ─────────────────────────────────────────────────────

  /**
   * Update lighting overlay based on current time
   * Creates a smooth day/night transition
   */
  updateDayNightCycle(worldWidth: number, worldHeight: number, force: boolean = false): void {
    if (!this.lightingOverlay || !this.dayNightEnabled) return;

    const now = Date.now();
    // Only update every 5 seconds unless forced
    if (!force && now - this.lastLightingUpdate < 5000) return;
    this.lastLightingUpdate = now;

    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    const timeOfDay = hour + minute / 60;

    // Calculate lighting alpha based on time
    // Night: 0-6 and 20-24, Day: 6-20
    let alpha = 0;
    let color = 0x000033; // Dark blue for night

    if (timeOfDay < 5) {
      // Deep night (0:00 - 5:00)
      alpha = 0.4;
    } else if (timeOfDay < 7) {
      // Dawn transition (5:00 - 7:00)
      const t = (timeOfDay - 5) / 2;
      alpha = 0.4 * (1 - t);
      // Warm orange tint during dawn
      color = this.lerpColor(0x000033, 0x331100, t);
    } else if (timeOfDay < 18) {
      // Day (7:00 - 18:00)
      alpha = 0;
    } else if (timeOfDay < 20) {
      // Dusk transition (18:00 - 20:00)
      const t = (timeOfDay - 18) / 2;
      alpha = 0.4 * t;
      // Warm orange tint during dusk
      color = this.lerpColor(0x331100, 0x000033, t);
    } else {
      // Night (20:00 - 24:00)
      alpha = 0.4;
    }

    // Clear and redraw the overlay
    this.lightingOverlay.clear();
    this.lightingOverlay.rect(0, 0, worldWidth * TILE_SIZE, worldHeight * TILE_SIZE);
    this.lightingOverlay.fill({ color, alpha });
  }

  /**
   * Enable or disable day/night cycle
   */
  setDayNightEnabled(enabled: boolean): void {
    this.dayNightEnabled = enabled;
    if (!enabled && this.lightingOverlay) {
      this.lightingOverlay.clear();
    }
  }

  /**
   * Linear interpolation between two colors
   */
  private lerpColor(color1: number, color2: number, t: number): number {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;

    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }

  // ─── Normal Map Lighting ─────────────────────────────────────────────────

  /**
   * Get the lighting manager for controlling light sources
   */
  getLightingManager(): LightingManager | null {
    return this.lightingManager;
  }

  /**
   * Update lighting from the lighting manager
   * Call this once per frame
   */
  updateLighting(): void {
    if (!this.lightingManager) {
      return;
    }

    // Update day/night cycle in lighting manager
    this.lightingManager.updateDayNightCycle();

    // Get current lighting state
    const state = this.lightingManager.getState();

    // Only redraw if ambient value changed significantly
    if (Math.abs(state.ambient - this.lastAmbientValue) < 0.01 && this.lastAmbientValue >= 0) {
      return;
    }
    this.lastAmbientValue = state.ambient;

    // Update the lighting overlay based on ambient light level
    if (this.lightingOverlay && state.enabled) {
      // Use a large fixed size to cover the viewport
      const overlaySize = 2000;

      this.lightingOverlay.clear();

      // Calculate overlay alpha based on ambient (lower ambient = darker)
      const alpha = Math.max(0, (1 - state.ambient) * 0.5);

      if (alpha > 0.01) {
        // Apply color tint through overlay
        const ambientRgb = this.hexToRgb(state.ambientColor);
        const colorR = Math.round(ambientRgb.r * 50); // Dark blue-purple for night
        const colorG = Math.round(ambientRgb.g * 50);
        const colorB = Math.round(ambientRgb.b * 100 + 50);
        const overlayColor = (colorR << 16) | (colorG << 8) | colorB;

        this.lightingOverlay.rect(-overlaySize, -overlaySize, overlaySize * 2, overlaySize * 2);
        this.lightingOverlay.fill({ color: overlayColor, alpha });
      }
    }
  }

  /**
   * Set agent position for torch light effect
   */
  setAgentLightPosition(x: number, y: number): void {
    if (this.lightingManager) {
      this.lightingManager.setAgentPosition(x, y);
    }
  }

  /**
   * Add a point light at a specific position
   */
  addPointLight(light: PointLight): void {
    if (this.lightingManager) {
      this.lightingManager.addPointLight(light);
    }
  }

  /**
   * Remove a point light by ID
   */
  removePointLight(id: string): void {
    if (this.lightingManager) {
      this.lightingManager.removeLight(id);
    }
  }

  /**
   * Enable or disable normal map lighting
   */
  setNormalMapEnabled(enabled: boolean): void {
    this.normalMapEnabled = enabled;
    if (this.lightingManager) {
      this.lightingManager.setEnabled(enabled);
    }
    // Clear overlay when disabled
    if (!enabled && this.lightingOverlay) {
      this.lightingOverlay.clear();
    }
  }

  /**
   * Check if normal map lighting is enabled
   */
  isNormalMapEnabled(): boolean {
    return this.normalMapEnabled;
  }

  /**
   * Check if any normal maps are loaded
   */
  hasNormalMaps(): boolean {
    return this.normalMapTextures.size > 0;
  }

  /**
   * Update lighting configuration from UI
   */
  updateLightingConfig(config: {
    enabled?: boolean;
    dayNightCycle?: boolean;
    agentLight?: boolean;
    agentLightRadius?: number;
    agentLightIntensity?: number;
    agentLightColor?: number;
  }): void {
    if (!this.lightingManager) return;

    if (config.enabled !== undefined) {
      this.normalMapEnabled = config.enabled;
      this.lightingManager.setEnabled(config.enabled);
      // Clear overlay when disabled
      if (!config.enabled && this.lightingOverlay) {
        this.lightingOverlay.clear();
      }
    }

    this.lightingManager.setConfig({
      dayNightCycle: config.dayNightCycle,
      agentLight: config.agentLight,
      agentLightRadius: config.agentLightRadius,
      agentLightIntensity: config.agentLightIntensity,
      agentLightColor: config.agentLightColor,
    });
  }

  /**
   * Get current lighting configuration
   */
  getLightingConfig(): {
    enabled: boolean;
    dayNightCycle: boolean;
    agentLight: boolean;
    agentLightRadius: number;
    agentLightIntensity: number;
    agentLightColor: number;
  } | null {
    if (!this.lightingManager) return null;

    const config = this.lightingManager.getConfig();
    return {
      enabled: this.normalMapEnabled,
      dayNightCycle: config.dayNightCycle,
      agentLight: config.agentLight,
      agentLightRadius: config.agentLightRadius,
      agentLightIntensity: config.agentLightIntensity,
      agentLightColor: config.agentLightColor,
    };
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

    // Clean up normal map textures
    for (const texture of this.normalMapTextures.values()) {
      texture.destroy(true);
    }
    this.normalMapTextures.clear();

    this.lightingManager = null;

    // Clean up text cache
    for (const textObj of this.textCache.values()) {
      textObj.destroy(true);
    }
    this.textCache.clear();

    // Clean up bitmap text cache
    for (const bitmapText of this.bitmapTextCache.values()) {
      bitmapText.destroy(true);
    }
    this.bitmapTextCache.clear();

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
    this.uiContainer = null;
    this.overlayGraphics = null;
    this.lightingOverlay = null;
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
   * Get the UI container for overlay elements (health bars, tooltips, etc.)
   * UI elements added here are not affected by camera transforms
   */
  getUIContainer(): Container | null {
    return this.uiContainer;
  }

  /**
   * Get the shared glow filter for active file highlighting
   * Can be applied to sprites: sprite.filters = [renderer.getGlowFilter()]
   */
  getGlowFilter(): GlowFilter | null {
    return this.activeGlowFilter;
  }

  /**
   * Convert hex color to RGB (0-1 range)
   */
  private hexToRgb(hex: number): { r: number; g: number; b: number } {
    return {
      r: ((hex >> 16) & 0xff) / 255,
      g: ((hex >> 8) & 0xff) / 255,
      b: (hex & 0xff) / 255,
    };
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
