/**
 * PhaserRenderer - Phaser 3-based renderer for WebGL acceleration
 *
 * Uses Phaser 3 with:
 * - Scene-based rendering with proper layer separation
 * - Built-in sprite pooling via scene game objects
 * - Working Light2D pipeline for lighting effects
 * - Day/night cycle with ambient light control
 */

import Phaser from 'phaser';
import { Renderer, WebviewAssetData, Tile, ViewportBounds, TILE_SIZE, PointLight, LightingState, AsepriteExportData, AsepriteTagData } from './types';
import { BootScene, GameScene, UIScene } from './scenes';
import { LightingManager } from './LightingManager';
import type { AnimationSetDef } from '../../overworld/core/types';

export class PhaserRenderer implements Renderer {
  private game: Phaser.Game | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gameScene: GameScene | null = null;
  private bootScene: BootScene | null = null;

  // Texture storage
  private textures: Map<string, Phaser.Textures.Texture> = new Map();

  // Current viewport for culling
  private viewportBounds: ViewportBounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };

  // Current transform
  private currentPanX = 0;
  private currentPanY = 0;
  private currentZoom = 1;

  // Ready state
  private ready = false;

  // Lighting system
  private lightingManager: LightingManager | null = null;
  private normalMapEnabled = true;
  private lastLightingUpdate = 0;
  private lastAmbientValue = -1;

  // Update callback
  private updateCallback: ((deltaTime: number) => void) | null = null;

  // World dimensions
  private worldWidth = 0;
  private worldHeight = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    try {
      // Create Phaser game configuration
      // Use explicit WEBGL render type for VS Code webview environment
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.WEBGL,
        canvas: canvas,
        width: canvas.width || 800,
        height: canvas.height || 600,
        backgroundColor: '#1a1c2c',
        antialias: false, // Pixel art - no antialiasing
        resolution: 1,
        pixelArt: true,
        scene: [BootScene, GameScene, UIScene],
        physics: {
          default: 'arcade',
          arcade: {
            debug: false,
          },
        },
        render: {
          pixelArt: true,
          antialias: false,
          powerPreference: 'high-performance',
        },
        audio: {
          noAudio: true, // Disable audio for VS Code webview
        },
      };

      this.game = new Phaser.Game(config);

      // Wait for game to be ready
      await new Promise<void>((resolve) => {
        if (this.game!.isReady) {
          resolve();
        } else {
          this.game!.events.once('ready', () => resolve());
        }
      });

      // Get scene references
      this.bootScene = this.game.scene.getScene('BootScene') as BootScene;
      this.gameScene = this.game.scene.getScene('GameScene') as GameScene;

      // Wait for GameScene to be fully created
      await new Promise<void>((resolve) => {
        if (this.gameScene && this.gameScene.isSceneReady()) {
          resolve();
        } else if (this.gameScene) {
          this.gameScene.setOnReady(() => resolve());
        } else {
          // Fallback timeout
          setTimeout(resolve, 100);
        }
      });

      // Create lighting manager
      this.lightingManager = new LightingManager({
        enabled: this.normalMapEnabled,
        dayNightCycle: true,
        agentLight: true,
        agentLightRadius: 80,
        agentLightIntensity: 0.8,
        agentLightColor: 0xffaa44,
      });

      this.ready = true;
      console.log('[PhaserRenderer] Initialized successfully');
    } catch (error) {
      console.error('[PhaserRenderer] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Set up the update callback to be called each frame
   */
  setUpdatesPerFrame(callback: (deltaTime: number) => void): void {
    this.updateCallback = callback;

    if (this.gameScene) {
      this.gameScene.setUpdateCallback((time, delta) => {
        if (callback) {
          callback(delta);
        }
      });
    }
  }

  /**
   * Start the game loop
   */
  startTicker(): void {
    // Phaser's game loop starts automatically
    console.log('[PhaserRenderer] Game loop started');
  }

  /**
   * Stop the game loop
   */
  stopTicker(): void {
    if (this.game) {
      this.game.loop.sleep();
    }
  }

  async loadSpritesheets(assets: WebviewAssetData, forceReload: boolean = false): Promise<void> {
    if (!assets || !assets.spritesheets) {
      console.warn('[PhaserRenderer] No assets data received');
      return;
    }

    console.log(`[PhaserRenderer] Loading sprites (forceReload: ${forceReload})...`);

    if (!this.game) {
      console.warn('[PhaserRenderer] Game not ready for asset loading');
      return;
    }

    // Load textures directly into Phaser's texture manager
    const textureManager = this.game.textures;

    // If force reload, remove existing textures first
    if (forceReload) {
      for (const name of Object.keys(assets.spritesheets)) {
        if (textureManager.exists(name)) {
          textureManager.remove(name);
          console.log(`[PhaserRenderer] Removed texture: ${name}`);
        }
        // Also remove normal map if exists
        if (textureManager.exists(`${name}_normal`)) {
          textureManager.remove(`${name}_normal`);
        }
      }
      // Clear our internal tracking
      this.textures.clear();
    }

    for (const [name, sheetData] of Object.entries(assets.spritesheets)) {
      try {
        // Skip if texture already exists (and not force reloading)
        if (!forceReload && textureManager.exists(name)) {
          console.log(`[PhaserRenderer] Texture already exists: ${name}, skipping`);
          continue;
        }

        // Create image from base64
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Failed to load image: ${name}`));
          image.src = sheetData.imageUrl;
        });

        // Add to Phaser texture manager (guard against stale registry entries)
        if (textureManager.exists(name)) {
          console.warn(`[PhaserRenderer] Texture ${name} still in registry, forcing removal`);
          textureManager.remove(name);
        }
        textureManager.addImage(name, image);

        // Create frame definitions
        const texture = textureManager.get(name);
        if (texture) {
          for (const [spriteName, def] of Object.entries(sheetData.sprites)) {
            texture.add(spriteName, 0, def.x, def.y, def.w, def.h);
          }

          // Create sprite ID references (sheetName/spriteName)
          for (const [spriteName, def] of Object.entries(sheetData.sprites)) {
            const spriteId = `${name}/${spriteName}`;
            // Create a reference frame with the full ID
            texture.add(spriteId, 0, def.x, def.y, def.w, def.h);
          }

          this.textures.set(name, texture);
          console.log(`[PhaserRenderer] Loaded spritesheet: ${name} with ${Object.keys(sheetData.sprites).length} sprites`);
        }

        // Create animations from Aseprite data if available
        if (sheetData.asepriteData && this.gameScene) {
          this.createAsepriteAnimations(name, sheetData.asepriteData, sheetData.asepriteTags);
        }

        // Load normal map if available
        if (sheetData.normalMapUrl) {
          const normalImage = new Image();
          await new Promise<void>((resolve, reject) => {
            normalImage.onload = () => resolve();
            normalImage.onerror = () => reject(new Error(`Failed to load normal map: ${name}`));
            normalImage.src = sheetData.normalMapUrl;
          });

          // Guard against stale registry entries for normal maps
          if (textureManager.exists(`${name}_normal`)) {
            textureManager.remove(`${name}_normal`);
          }
          textureManager.addImage(`${name}_normal`, normalImage);
          console.log(`[PhaserRenderer] Loaded normal map for: ${name}`);
        }
      } catch (error) {
        console.warn(`[PhaserRenderer] Failed to load spritesheet: ${name}`, error);
      }
    }

    console.log(`[PhaserRenderer] Total spritesheets loaded: ${this.textures.size}`);

    // Load animation sets if provided
    if (this.gameScene && assets.animationSets) {
      this.gameScene.setAnimationSets(assets.animationSets);
    }
  }

  /**
   * Set animation sets on the game scene
   */
  setAnimationSets(sets: Record<string, AnimationSetDef>): void {
    if (this.gameScene) {
      this.gameScene.setAnimationSets(sets);
    }
  }

  /**
   * Create Phaser animations from Aseprite tag data
   */
  private createAsepriteAnimations(
    sheetName: string,
    asepriteData: AsepriteExportData,
    filterTags?: string[]
  ): void {
    if (!this.game) return;

    const anims = this.game.anims;
    const frameTags = asepriteData.meta.frameTags || [];
    const frames = asepriteData.frames;

    // Filter tags if specified
    const tagsToCreate = filterTags
      ? frameTags.filter(tag => filterTags.includes(tag.name))
      : frameTags;

    for (const tag of tagsToCreate) {
      const animKey = `${sheetName}_${tag.name}`;

      // Check if animation already exists
      if (anims.exists(animKey)) {
        continue;
      }

      // Build frame array from tag range
      const frameNames = Object.keys(frames).sort((a, b) => {
        const aNum = parseInt(a.match(/\d+/)?.[0] || '0');
        const bNum = parseInt(b.match(/\d+/)?.[0] || '0');
        return aNum - bNum;
      });

      // Get frames for this tag
      const tagFrames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = tag.from; i <= tag.to; i++) {
        const frameName = frameNames[i] || `${i}`;
        const frameData = frames[frameName];
        if (frameData) {
          tagFrames.push({
            key: sheetName,
            frame: frameName,
            duration: frameData.duration,
          });
        }
      }

      if (tagFrames.length === 0) continue;

      // Create animation with Aseprite frame durations
      anims.create({
        key: animKey,
        frames: tagFrames,
        repeat: tag.direction === 'pingpong' ? -1 : (tag.name.toLowerCase().includes('idle') ? -1 : 0),
        yoyo: tag.direction === 'pingpong',
      });

      console.log(`[PhaserRenderer] Created Aseprite animation: ${animKey} (${tagFrames.length} frames)`);
    }
  }

  /**
   * Refresh all assets (force reload from updated manifest)
   * Called when SpriteConfigPanel updates sprites
   */
  async refreshAssets(assets: WebviewAssetData): Promise<void> {
    console.log('[PhaserRenderer] Refreshing all assets...');

    // CRITICAL: Destroy all scene sprites BEFORE removing textures.
    // Sprites hold direct references to Texture objects; if the textures
    // are removed/destroyed first, the render loop crashes on null
    // glTexture / sourceSize when trying to draw stale sprites.
    if (this.gameScene) {
      this.gameScene.prepareForTextureRefresh();
    }

    // Force reload all textures (safe now — no sprites reference them)
    await this.loadSpritesheets(assets, true);

    // Reload animation sets (recreates agent sprite with new textures)
    if (this.gameScene && assets.animationSets) {
      this.gameScene.setAnimationSets(assets.animationSets);
    }

    console.log('[PhaserRenderer] Assets refreshed');
  }

  /**
   * Set all tiles at once (static layer caching)
   */
  setTiles(tiles: Tile[]): void {
    if (!this.ready || !this.gameScene) return;

    this.gameScene.setTiles(tiles);
    console.log(`[PhaserRenderer] Set ${tiles.length} tiles`);
  }

  /**
   * Update a single tile
   */
  updateTile(tile: Tile): void {
    if (!this.ready || !this.gameScene) return;
    // For now, just re-add the tile
    this.gameScene.addTile(tile);
  }

  /**
   * Update a tile's sprite at runtime (for state-machine-driven tiles).
   */
  updateTileSprite(tileKey: string, newSpriteId: string): void {
    if (!this.ready || !this.gameScene) return;
    this.gameScene.updateTileSprite(tileKey, newSpriteId);
  }

  /**
   * Clear dynamic objects (agents, particles, effects)
   */
  clearDynamicObjects(): void {
    if (this.gameScene) {
      this.gameScene.beginFrame();
    }
  }

  /**
   * Set viewport bounds for culling
   */
  setViewportBounds(bounds: ViewportBounds): void {
    this.viewportBounds = bounds;
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
    this.clearDynamicObjects();
  }

  beginFrame(): void {
    if (this.gameScene) {
      this.gameScene.beginFrame();
    }
  }

  endFrame(): void {
    // Phaser renders automatically
  }

  drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean {
    if (!this.gameScene) return false;
    return this.gameScene.drawSprite(id, x, y, w, h);
  }

  drawSpriteTinted(id: string, x: number, y: number, w?: number, h?: number, tint?: string): boolean {
    if (!this.gameScene) return false;
    return this.gameScene.drawSpriteTinted(id, x, y, w, h, tint);
  }

  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    if (this.gameScene) {
      this.gameScene.drawRect(x, y, w, h, color, alpha);
    }
  }

  drawText(text: string, x: number, y: number, color: string, fontSize: number = 7): void {
    if (this.gameScene) {
      this.gameScene.drawText(text, x, y, color, fontSize);
    }
  }

  /**
   * Draw weather particles (legacy - now uses Phaser particle system)
   */
  drawWeatherParticles(particles: { x: number; y: number; type: 'rain' | 'snow'; size: number; alpha: number }[]): void {
    if (this.gameScene) {
      this.gameScene.drawWeatherParticles(particles);
    }
  }

  /**
   * Emit dust particles at position (walking effect)
   */
  emitDust(x: number, y: number): void {
    if (this.gameScene) {
      this.gameScene.emitDust(x, y);
    }
  }

  /**
   * Emit sparkle particles at position (write effect)
   */
  emitSparkles(x: number, y: number): void {
    if (this.gameScene) {
      this.gameScene.emitSparkles(x, y);
    }
  }

  /**
   * Emit growth particles at position (crop growth effect)
   */
  emitGrowth(x: number, y: number): void {
    if (this.gameScene) {
      this.gameScene.emitGrowth(x, y);
    }
  }

  /**
   * Set weather using Phaser particle system
   */
  setWeather(type: 'rain' | 'snow' | 'clear', intensity: number = 0.5): void {
    if (this.gameScene) {
      this.gameScene.setWeather(type, intensity);
    }
  }

  /**
   * Update agent sprite with Phaser animations
   */
  updateAgentSprite(x: number, y: number, action: string, direction: string): void {
    if (this.gameScene) {
      this.gameScene.updateAgentSprite(x, y, action, direction);
    }
  }

  setTransform(panX: number, panY: number, zoom: number, baseScale?: number): void {
    this.currentPanX = panX;
    this.currentPanY = panY;
    this.currentZoom = zoom;

    if (this.gameScene) {
      this.gameScene.setTransform(panX, panY, zoom);
    }

    this.updateViewportBounds();
  }

  /**
   * Calculate and update viewport bounds based on camera and canvas
   *
   * With scroll-based coordinates:
   * - panX/panY = scrollX/scrollY = world position at screen origin
   * - At screenX=0: worldX = panX
   * - At screenX=viewW: worldX = panX + viewW / zoom
   */
  private updateViewportBounds(): void {
    if (!this.canvas) return;

    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    const zoom = this.currentZoom;
    const scrollX = this.currentPanX;
    const scrollY = this.currentPanY;

    const left = scrollX / TILE_SIZE;
    const top = scrollY / TILE_SIZE;
    const right = (scrollX + viewW / zoom) / TILE_SIZE;
    const bottom = (scrollY + viewH / zoom) / TILE_SIZE;

    this.viewportBounds = {
      minX: Math.floor(left) - 1,
      maxX: Math.ceil(right) + 1,
      minY: Math.floor(top) - 1,
      maxY: Math.ceil(bottom) + 1,
    };
  }

  resize(width: number, height: number): void {
    if (this.game) {
      this.game.scale.resize(width, height);
      if (this.gameScene) {
        this.gameScene.resize(width, height);
      }
    }
  }

  /**
   * Convert screen coordinates to world coordinates using Phaser's camera
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null {
    if (!this.gameScene) return null;
    return this.gameScene.screenToWorld(screenX, screenY);
  }

  // ─── Lighting System ─────────────────────────────────────────────────────

  /**
   * Get the lighting manager
   */
  getLightingManager(): LightingManager | null {
    return this.lightingManager;
  }

  /**
   * Update lighting from the lighting manager
   */
  updateLighting(): void {
    if (!this.lightingManager || !this.gameScene) return;

    this.lightingManager.updateDayNightCycle();
    const state = this.lightingManager.getState();

    if (Math.abs(state.ambient - this.lastAmbientValue) < 0.01 && this.lastAmbientValue >= 0) {
      return;
    }
    this.lastAmbientValue = state.ambient;

    this.gameScene.updateLighting(state.ambient, state.ambientColor);
  }

  /**
   * Set agent position for torch light effect
   */
  setAgentLightPosition(x: number, y: number): void {
    if (this.lightingManager) {
      this.lightingManager.setAgentPosition(x, y);
    }
    if (this.gameScene) {
      this.gameScene.setAgentLightPosition(x, y);
    }
  }

  /**
   * Update day/night cycle
   */
  updateDayNightCycle(worldWidth: number, worldHeight: number): void {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    if (this.gameScene) {
      this.gameScene.updateDayNightCycle(worldWidth, worldHeight);
    }
  }

  /**
   * Add a point light
   */
  addPointLight(light: PointLight): void {
    if (this.lightingManager) {
      this.lightingManager.addPointLight(light.id, light.x, light.y, light.color);
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
    if (this.gameScene) {
      this.gameScene.setLightsEnabled(enabled);
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
    if (!this.game) return false;
    // Check if any textures have _normal suffix
    const textureKeys = this.game.textures.getTextureKeys();
    return textureKeys.some(key => key.endsWith('_normal'));
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
      if (this.gameScene) {
        this.gameScene.setLightsEnabled(config.enabled);
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
    this.updateCallback = null;

    if (this.gameScene) {
      this.gameScene.cleanup();
    }

    if (this.game) {
      this.game.destroy(true);
      this.game = null;
    }

    this.textures.clear();
    this.lightingManager = null;
    this.gameScene = null;
    this.bootScene = null;
    this.canvas = null;
    this.ready = false;
  }
}
