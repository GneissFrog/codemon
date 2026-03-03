/**
 * GameScene - Main game world rendering scene
 *
 * Handles tile rendering, character sprites, effects, and lighting
 * Uses Phaser's built-in features for particles, groups, and input
 */

import Phaser from 'phaser';
import { Tile, Plot, TILE_SIZE, WeatherParticle } from '../types';

// Input callback types
export interface InputCallbacks {
  onPointerMove?: (worldX: number, worldY: number, isDragging: boolean) => void;
  onPointerDown?: (worldX: number, worldY: number) => void;
  onPointerUp?: () => void;
  onWheel?: (deltaY: number, clientX: number, clientY: number) => void;
}

export class GameScene extends Phaser.Scene {
  // Layer containers
  private groundLayer!: Phaser.GameObjects.Container;
  private terrainLayer!: Phaser.GameObjects.Container;
  private cropsLayer!: Phaser.GameObjects.Container;
  private charactersLayer!: Phaser.GameObjects.Container;
  private effectsLayer!: Phaser.GameObjects.Container;

  // Graphics for overlays
  private overlayGraphics!: Phaser.GameObjects.Graphics;
  private lightingOverlay!: Phaser.GameObjects.Graphics;

  // Tile sprites (static, cached)
  private tileSprites: Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.TileSprite> = new Map();
  private animatedSprites: Phaser.GameObjects.Sprite[] = [];

  // Dynamic sprites using Phaser Groups
  private dynamicSpriteGroup!: Phaser.GameObjects.Group;

  // Agent sprite (Phaser-based)
  private agentSprite: Phaser.GameObjects.Sprite | null = null;
  private agentAnimationsCreated = false;
  private currentAgentAnimation = '';

  // Agent animation config (loaded from manifest)
  private agentSheetName = 'claude-actions'; // Default, can be overridden
  private agentActions: string[] = [];
  private agentDirections: string[] = [];
  private agentFramesPerAction: Map<string, number> = new Map(); // action -> frame count

  // Particle emitters using Phaser's particle system
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkleEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private growthEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private weatherEmitter!: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Lighting
  private lightsEnabled = true;
  private agentLight: Phaser.GameObjects.Light | null = null;
  private ambientLight = 0xffffff;
  private ambientIntensity = 0.5;

  // Input handling
  private inputCallbacks: InputCallbacks = {};
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  // Update callback
  private updateCallback: ((time: number, delta: number) => void) | null = null;

  // World bounds
  private worldWidth = 0;
  private worldHeight = 0;

  // Ready state
  private sceneReady = false;
  private pendingTiles: Tile[] | null = null;
  private onReadyCallback: (() => void) | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  /**
   * Check if scene is ready for operations
   */
  isSceneReady(): boolean {
    return this.sceneReady;
  }

  /**
   * Set callback for when scene is ready
   */
  setOnReady(callback: () => void): void {
    this.onReadyCallback = callback;
    if (this.sceneReady) {
      callback();
    }
  }

  create(): void {
    // Create layer containers with depth sorting
    this.groundLayer = this.add.container(0, 0);
    this.terrainLayer = this.add.container(0, 0);
    this.cropsLayer = this.add.container(0, 0);
    this.charactersLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);

    // Set depths for proper z-ordering
    this.groundLayer.setDepth(0);
    this.terrainLayer.setDepth(1);
    this.cropsLayer.setDepth(2);
    this.charactersLayer.setDepth(3);
    this.effectsLayer.setDepth(4);

    // Create overlay graphics (for highlights, rectangles)
    this.overlayGraphics = this.add.graphics();
    this.overlayGraphics.setDepth(5);

    // Create lighting overlay
    this.lightingOverlay = this.add.graphics();
    this.lightingOverlay.setDepth(6);

    // Enable lights if available
    if (this.lights) {
      this.lights.enable();
      this.lights.setAmbientColor(this.ambientLight);

      // Create agent torch light
      this.agentLight = this.lights.addLight(0, 0, 80, 0xffaa44, 0.8);
      console.log('[GameScene] Lights system enabled, ambient:', this.ambientLight.toString(16));
    } else {
      console.warn('[GameScene] Lights system not available - Light2D pipeline may not work');
      this.lightsEnabled = false;
    }

    // Create dynamic sprite group (Phaser's object pooling)
    this.dynamicSpriteGroup = this.add.group({
      defaultKey: '__DEFAULT',
      maxSize: 100,
      runChildUpdate: false,
    });

    // Create particle emitters
    this.createParticleEmitters();

    // Setup Phaser input system
    this.setupInput();

    this.sceneReady = true;
    console.log('[GameScene] Created with Phaser particles and input');

    // Process any pending tiles
    if (this.pendingTiles) {
      this.setTilesInternal(this.pendingTiles);
      this.pendingTiles = null;
    }

    // Call ready callback
    if (this.onReadyCallback) {
      this.onReadyCallback();
    }
  }

  /**
   * Create Phaser particle emitters for effects
   */
  private createParticleEmitters(): void {
    // Dust emitter for walking
    this.dustEmitter = this.add.particles(0, 0, '__DEFAULT', {
      speed: { min: 10, max: 30 },
      angle: { min: 230, max: 310 },
      scale: { start: 0.8, end: 0 },
      lifespan: 400,
      quantity: 3,
      alpha: { start: 0.6, end: 0 },
      emitting: false,
    });
    this.dustEmitter.setDepth(4);

    // Sparkle emitter for write effects
    this.sparkleEmitter = this.add.particles(0, 0, '__DEFAULT', {
      speed: { min: 40, max: 80 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: 800,
      quantity: 8,
      tint: 0xffec27,
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.sparkleEmitter.setDepth(4);

    // Growth emitter for crop growth
    this.growthEmitter = this.add.particles(0, 0, '__DEFAULT', {
      speed: { min: 20, max: 50 },
      angle: { min: 240, max: 300 },
      scale: { start: 0.6, end: 0 },
      lifespan: 600,
      quantity: 5,
      tint: 0x00e436,
      alpha: { start: 0.8, end: 0 },
      emitting: false,
    });
    this.growthEmitter.setDepth(4);
  }

  // ─── Agent Animation System ──────────────────────────────────────────────

  /**
   * Set the agent animation configuration from manifest
   */
  setAgentConfig(
    sheetName: string,
    directions: string[],
    actions: { name: string; frames: number }[]
  ): void {
    this.agentSheetName = sheetName;
    this.agentDirections = directions;
    this.agentActions = actions.map(a => a.name);
    this.agentFramesPerAction.clear();
    for (const action of actions) {
      this.agentFramesPerAction.set(action.name, action.frames);
    }

    // Reset animation state so animations get recreated with new config
    this.agentAnimationsCreated = false;
    this.currentAgentAnimation = '';

    console.log(`[GameScene] Agent config set: ${sheetName}, ${actions.length} actions, ${directions.length} directions`);
  }

  /**
   * Create agent animations from the spritesheet using loaded config
   */
  createAgentAnimations(): void {
    if (this.agentAnimationsCreated) return;

    // Check if the texture exists
    if (!this.textures.exists(this.agentSheetName)) {
      console.warn(`[GameScene] ${this.agentSheetName} texture not loaded yet`);
      return;
    }

    // Must have config set first
    if (this.agentActions.length === 0 || this.agentDirections.length === 0) {
      console.warn('[GameScene] Agent config not set, using defaults');
      // Use defaults if config not set
      this.agentActions = ['idle', 'walk', 'hoe', 'water', 'plant', 'harvest'];
      this.agentDirections = ['down', 'up', 'left', 'right'];
      for (const action of this.agentActions) {
        this.agentFramesPerAction.set(action, 6);
      }
    }

    // Create animations for each action/direction combination
    for (const action of this.agentActions) {
      const frameCount = this.agentFramesPerAction.get(action) || 6;

      for (const direction of this.agentDirections) {
        const animKey = `agent_${action}_${direction}`;

        // Skip if animation already exists
        if (this.anims.exists(animKey)) continue;

        const frames: { key: string; frame: string }[] = [];

        for (let i = 0; i < frameCount; i++) {
          const frameName = `char-${action}-${direction}-${i}`;
          frames.push({ key: this.agentSheetName, frame: frameName });
        }

        // Only create if we have valid frames
        if (frames.length > 0) {
          this.anims.create({
            key: animKey,
            frames: frames,
            frameRate: 10,
            repeat: -1,
          });
        }
      }
    }

    // Create the agent sprite with a default frame
    const defaultFrame = `char-${this.agentActions[0] || 'idle'}-${this.agentDirections[0] || 'down'}-0`;
    this.agentSprite = this.add.sprite(0, 0, this.agentSheetName, defaultFrame);
    this.agentSprite.setOrigin(0.5, 0.75); // Center-bottom origin for better positioning
    this.agentSprite.setDepth(10); // Above other characters

    // Enable Light2D pipeline with normal map if available and lighting is enabled
    if (this.lightsEnabled && this.textures.exists(`${this.agentSheetName}_normal`)) {
      try {
        this.agentSprite.setPipeline('Light2D');
        this.agentSprite.normalMap = this.textures.get(`${this.agentSheetName}_normal`);
        console.log(`[GameScene] Agent sprite using Light2D pipeline with normal map`);
      } catch (e) {
        console.warn(`[GameScene] Failed to set Light2D pipeline on agent: ${e}`);
      }
    }

    this.charactersLayer.add(this.agentSprite);

    this.agentAnimationsCreated = true;
    console.log(`[GameScene] Agent animations created for ${this.agentSheetName}`);
  }

  /**
   * Update agent sprite position and animation
   */
  updateAgentSprite(x: number, y: number, action: string, direction: string): void {
    // Ensure animations are created
    if (!this.agentAnimationsCreated) {
      this.createAgentAnimations();
    }

    if (!this.agentSprite) return;

    // Update position
    this.agentSprite.setPosition(x, y);

    // Normalize action and direction using configured values
    const normalizedAction = this.agentActions.includes(action) ? action : (this.agentActions[0] || 'idle');
    const normalizedDirection = this.agentDirections.includes(direction) ? direction : (this.agentDirections[0] || 'down');

    // Build animation key
    const animKey = `agent_${normalizedAction}_${normalizedDirection}`;

    // Only switch animation if it changed
    if (this.currentAgentAnimation !== animKey && this.anims.exists(animKey)) {
      this.agentSprite.play(animKey);
      this.currentAgentAnimation = animKey;
    }
  }

  /**
   * Get the agent sprite for external manipulation
   */
  getAgentSprite(): Phaser.GameObjects.Sprite | null {
    return this.agentSprite;
  }

  /**
   * Setup Phaser input system
   */
  private setupInput(): void {
    // Pointer move
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;

      if (this.isDragging) {
        this.inputCallbacks.onPointerMove?.(worldX, worldY, true);
      } else {
        this.inputCallbacks.onPointerMove?.(worldX, worldY, false);
      }
    });

    // Pointer down
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.inputCallbacks.onPointerDown?.(pointer.worldX, pointer.worldY);
    });

    // Pointer up
    this.input.on('pointerup', () => {
      this.isDragging = false;
      this.inputCallbacks.onPointerUp?.();
    });

    // Wheel zoom
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number) => {
      this.inputCallbacks.onWheel?.(deltaY, pointer.x, pointer.y);
    });
  }

  /**
   * Set input callbacks
   */
  setInputCallbacks(callbacks: InputCallbacks): void {
    this.inputCallbacks = callbacks;
  }

  // ─── Particle Effects ─────────────────────────────────────────────────────

  /**
   * Emit dust particles at position
   */
  emitDust(x: number, y: number): void {
    this.dustEmitter.emitParticleAt(x, y, 3);
  }

  /**
   * Emit sparkle particles at position
   */
  emitSparkles(x: number, y: number): void {
    this.sparkleEmitter.emitParticleAt(x, y, 8);
  }

  /**
   * Emit growth particles at position
   */
  emitGrowth(x: number, y: number): void {
    this.growthEmitter.emitParticleAt(x, y, 5);
  }

  /**
   * Set weather using Phaser particle emitter
   */
  setWeather(type: 'rain' | 'snow' | 'clear', intensity: number = 0.5): void {
    // Clean up existing weather emitter
    if (this.weatherEmitter) {
      this.weatherEmitter.destroy();
      this.weatherEmitter = null;
    }

    if (type === 'clear') return;

    const maxParticles = Math.floor(100 * intensity);

    if (type === 'rain') {
      this.weatherEmitter = this.add.particles(0, -10, '__DEFAULT', {
        x: { min: 0, max: this.cameras.main.width },
        speed: { min: 300, max: 500 },
        angle: 90,
        scale: { start: 0.5, end: 0.3 },
        lifespan: 2000,
        quantity: Math.floor(2 * intensity),
        tint: 0x8899bb,
        alpha: { start: 0.4, end: 0.2 },
        frequency: 50,
        maxParticles: maxParticles,
      });
    } else if (type === 'snow') {
      this.weatherEmitter = this.add.particles(0, -10, '__DEFAULT', {
        x: { min: 0, max: this.cameras.main.width },
        speed: { min: 30, max: 60 },
        angle: { min: 80, max: 100 },
        scale: { start: 1, end: 0.5 },
        lifespan: 4000,
        quantity: Math.floor(1 * intensity),
        tint: 0xffffff,
        alpha: { start: 0.6, end: 0.2 },
        frequency: 100,
        maxParticles: maxParticles,
        moveToX: { min: -10, max: 10 },
      });
    }

    if (this.weatherEmitter) {
      this.weatherEmitter.setScrollFactor(0, 0); // Fixed to camera
      this.weatherEmitter.setDepth(7);
    }
  }

  // ─── Update Callback ──────────────────────────────────────────────────────

  /**
   * Set update callback for game loop
   */
  setUpdateCallback(callback: (time: number, delta: number) => void): void {
    this.updateCallback = callback;
  }

  /**
   * Main update loop
   */
  update(time: number, delta: number): void {
    if (this.updateCallback) {
      this.updateCallback(time, delta);
    }
  }

  // ─── Tile Management ─────────────────────────────────────────────────────

  /**
   * Set all tiles at once (static layer caching)
   */
  setTiles(tiles: Tile[]): void {
    if (!this.sceneReady) {
      // Queue tiles for when scene is ready
      this.pendingTiles = tiles;
      return;
    }
    this.setTilesInternal(tiles);
  }

  /**
   * Internal method to set tiles
   */
  private setTilesInternal(tiles: Tile[]): void {
    // Clear existing tiles
    this.clearTiles();

    for (const tile of tiles) {
      this.addTile(tile);
    }

    console.log(`[GameScene] Set ${tiles.length} tiles`);
  }

  /**
   * Add a single tile
   */
  addTile(tile: Tile): void {
    const key = `${tile.x},${tile.y},${tile.layer}`;
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;

    // Split spriteId into sheet and frame (format: "sheetName/frameName")
    const parts = tile.spriteId.split('/');
    if (parts.length < 2) {
      console.warn(`[GameScene] Invalid spriteId format: ${tile.spriteId}`);
      return;
    }
    const [sheet, frame] = parts;

    // Check if texture exists
    if (!this.textures.exists(sheet)) {
      console.warn(`[GameScene] Texture not found: ${sheet}`);
      return;
    }

    const texture = this.textures.get(sheet);
    if (!texture.has(frame)) {
      console.warn(`[GameScene] Frame not found: ${frame} in ${sheet}`);
      return;
    }

    // Check if animated (water tiles)
    const frameIds = this.getAnimationFrameIds(tile.spriteId);
    if (frameIds.length >= 2) {
      this.createAnimatedTile(tile, frameIds);
      return;
    }

    // Static tile - use sheet as texture key, frame as frame name
    const sprite = this.add.sprite(x, y, sheet, frame);
    sprite.setOrigin(0, 0);

    // Enable Light2D pipeline with normal map if available and lighting is enabled
    if (this.lightsEnabled && this.textures.exists(`${sheet}_normal`)) {
      try {
        sprite.setPipeline('Light2D');
        sprite.normalMap = this.textures.get(`${sheet}_normal`);
      } catch (e) {
        console.warn(`[GameScene] Failed to set Light2D pipeline: ${e}`);
      }
    }

    // Add to appropriate layer
    switch (tile.layer) {
      case 0:
        this.groundLayer.add(sprite);
        break;
      case 1:
        this.terrainLayer.add(sprite);
        break;
      default:
        this.cropsLayer.add(sprite);
    }

    this.tileSprites.set(key, sprite);
  }

  /**
   * Get animation frame IDs for a sprite
   * spriteId format: "sheetName/frameName-N" where N is the frame number
   */
  private getAnimationFrameIds(spriteId: string): string[] {
    const parts = spriteId.split('/');
    if (parts.length < 2) return [];

    const sheet = parts[0];
    const frameWithNumber = parts.slice(1).join('/'); // Handle frame names with slashes

    // Check if frame ends with a number (e.g., "water-0")
    const match = frameWithNumber.match(/^(.+)-(\d+)$/);
    if (!match) return [];

    const baseFrame = match[1];
    const frames: string[] = [];

    // Check for consecutive frames (water-0, water-1, water-2, etc.)
    const texture = this.textures.get(sheet);
    if (!texture) return [];

    for (let i = 0; i < 8; i++) {
      const frameName = `${baseFrame}-${i}`;
      if (texture.has(frameName)) {
        frames.push(`${sheet}/${frameName}`);
      } else {
        break;
      }
    }

    return frames.length >= 2 ? frames : [];
  }

  /**
   * Create animated tile (water)
   */
  private createAnimatedTile(tile: Tile, frameIds: string[]): void {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    const key = `${tile.x},${tile.y},${tile.layer}`;

    // Create animation with a unique key
    const animKey = `anim_${key}`;
    const [sheet, firstFrame] = frameIds[0].split('/');

    // Create animation if it doesn't exist
    if (!this.anims.exists(animKey)) {
      const frames = frameIds.map(f => {
        const [s, frame] = f.split('/');
        return { key: s, frame: frame };
      });

      this.anims.create({
        key: animKey,
        frames: frames,
        frameRate: 3 + Math.random() * 2,
        repeat: -1,
      });
    }

    // Create sprite and play animation
    const sprite = this.add.sprite(x, y, sheet, firstFrame);
    sprite.setOrigin(0, 0);
    sprite.play(animKey);

    // Enable Light2D pipeline with normal map if available and lighting is enabled
    if (this.lightsEnabled && this.textures.exists(`${sheet}_normal`)) {
      try {
        sprite.setPipeline('Light2D');
        sprite.normalMap = this.textures.get(`${sheet}_normal`);
      } catch (e) {
        console.warn(`[GameScene] Failed to set Light2D pipeline: ${e}`);
      }
    }

    // Randomize start frame by setting the frame directly
    const startFrame = Math.abs((tile.x * 3 + tile.y * 7) % frameIds.length);
    const anim = this.anims.get(animKey);
    if (anim && anim.frames[startFrame]) {
      sprite.setFrame(anim.frames[startFrame].textureFrame);
    }

    // Add to appropriate layer
    switch (tile.layer) {
      case 0:
        this.groundLayer.add(sprite);
        break;
      case 1:
        this.terrainLayer.add(sprite);
        break;
      default:
        this.cropsLayer.add(sprite);
    }

    this.tileSprites.set(key, sprite);
    this.animatedSprites.push(sprite);
  }

  /**
   * Clear all tiles
   */
  clearTiles(): void {
    if (!this.sceneReady) return;

    for (const sprite of this.tileSprites.values()) {
      if (sprite && sprite.active) {
        sprite.destroy();
      }
    }
    this.tileSprites.clear();

    for (const sprite of this.animatedSprites) {
      if (sprite && sprite.active) {
        sprite.destroy();
      }
    }
    this.animatedSprites = [];
  }

  // ─── Dynamic Sprites using Groups ────────────────────────────────────────

  /**
   * Begin frame - reset dynamic sprite pool
   */
  beginFrame(): void {
    if (!this.sceneReady) return;

    // Hide and deactivate all sprites in the group (return to pool)
    const children = this.dynamicSpriteGroup.getChildren();
    for (const child of children) {
      if (child instanceof Phaser.GameObjects.Sprite) {
        child.setActive(false);
        child.setVisible(false);
      }
    }

    // Clear effects layer
    this.effectsLayer.removeAll(true);
    this.overlayGraphics.clear();
  }

  /**
   * Draw a sprite at position using Phaser Groups
   */
  drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean {
    const [sheet, frame] = id.split('/');

    // Check if texture exists
    if (!this.textures.exists(sheet)) {
      return false;
    }

    const texture = this.textures.get(sheet);
    if (frame && !texture.has(frame)) {
      return false;
    }

    // Get sprite from pool
    let sprite = this.dynamicSpriteGroup.getFirstDead(false) as Phaser.GameObjects.Sprite | null;
    if (!sprite) {
      // Create new sprite if pool exhausted
      sprite = this.add.sprite(0, 0, sheet, frame);
      this.dynamicSpriteGroup.add(sprite);
    } else {
      sprite.setTexture(sheet, frame);
    }

    sprite.setPosition(x, y);
    sprite.setOrigin(0, 0);
    sprite.setVisible(true);
    sprite.setActive(true);

    // Enable Light2D pipeline with normal map if available and lighting is enabled
    if (this.lightsEnabled && this.textures.exists(`${sheet}_normal`)) {
      try {
        sprite.setPipeline('Light2D');
        sprite.normalMap = this.textures.get(`${sheet}_normal`);
      } catch (e) {
        console.warn(`[GameScene] Failed to set Light2D pipeline: ${e}`);
      }
    }

    if (w !== undefined) sprite.setDisplaySize(w, h || w);
    if (h !== undefined) sprite.setDisplaySize(w || 16, h);

    this.charactersLayer.add(sprite);
    return true;
  }

  // ─── Graphics ────────────────────────────────────────────────────────────

  /**
   * Draw a rectangle overlay
   */
  drawRect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    const colorNum = this.parseColor(color);
    this.overlayGraphics.fillStyle(colorNum, alpha);
    this.overlayGraphics.fillRect(x, y, w, h);
  }

  /**
   * Draw text label
   */
  drawText(text: string, x: number, y: number, color: string, fontSize: number = 7): void {
    // Create fresh text each frame (effectsLayer is cleared in beginFrame)
    const textObj = this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: `${fontSize}px`,
      color: color,
    });
    textObj.setOrigin(0, 0);
    this.effectsLayer.add(textObj);
  }

  /**
   * Draw weather particles (legacy - now using Phaser particles)
   */
  drawWeatherParticles(particles: WeatherParticle[]): void {
    // This is now handled by setWeather() and Phaser's particle system
    // Keep for backwards compatibility but do nothing
  }

  // ─── Camera ──────────────────────────────────────────────────────────────

  /**
   * Set camera transform
   */
  setTransform(panX: number, panY: number, zoom: number): void {
    const camera = this.cameras.main;
    camera.setScroll(-panX / zoom, -panY / zoom);
    camera.setZoom(zoom);
  }

  /**
   * Resize camera viewport
   */
  resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
  }

  // ─── Lighting ────────────────────────────────────────────────────────────

  /**
   * Enable/disable lighting
   */
  setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    console.log(`[GameScene] Lights enabled: ${enabled}`);

    if (this.lights) {
      if (enabled) {
        this.lights.enable();
        // Re-enable ambient light
        this.lights.setAmbientColor(this.ambientLight);
      } else {
        // Instead of disabling, set ambient to full brightness
        this.lights.setAmbientColor(0xffffff);
      }
    }

    // Update all sprites to use or not use Light2D pipeline
    this.updateAllSpritePipelines(enabled);
  }

  /**
   * Update pipeline on all sprites
   */
  private updateAllSpritePipelines(enabled: boolean): void {
    // Update static tiles
    for (const sprite of this.tileSprites.values()) {
      if (sprite && sprite.active) {
        if (enabled) {
          sprite.setPipeline('Light2D');
        } else {
          sprite.resetPipeline();
        }
      }
    }

    // Update animated tiles
    for (const sprite of this.animatedSprites) {
      if (sprite && sprite.active) {
        if (enabled) {
          sprite.setPipeline('Light2D');
        } else {
          sprite.resetPipeline();
        }
      }
    }

    // Update agent sprite
    if (this.agentSprite && this.agentSprite.active) {
      if (enabled) {
        this.agentSprite.setPipeline('Light2D');
      } else {
        this.agentSprite.resetPipeline();
      }
    }
  }

  /**
   * Set agent light position
   */
  setAgentLightPosition(x: number, y: number): void {
    if (this.agentLight) {
      this.agentLight.setPosition(x, y);
    }
  }

  /**
   * Update day/night cycle
   */
  updateDayNightCycle(worldWidth: number, worldHeight: number): void {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    const hour = new Date().getHours();
    let ambientIntensity = 1.0;
    let ambientColor = 0xffffff;
    let overlayAlpha = 0;

    if (hour < 5 || hour >= 20) {
      // Night
      ambientIntensity = 0.3;
      ambientColor = 0x4466aa; // Blue-ish moonlight
      overlayAlpha = 0.3;
    } else if (hour < 7) {
      // Dawn
      const t = (hour - 5) / 2;
      ambientIntensity = 0.3 + t * 0.5;
      ambientColor = this.lerpColor(0x4466aa, 0xffaa66, t);
      overlayAlpha = 0.3 * (1 - t);
    } else if (hour < 12) {
      // Morning
      const t = (hour - 7) / 5;
      ambientIntensity = 0.8 + t * 0.2;
      ambientColor = this.lerpColor(0xffaa66, 0xffffff, t);
    } else if (hour < 17) {
      // Midday
      ambientIntensity = 1.0;
      ambientColor = 0xffffff;
    } else if (hour < 20) {
      // Dusk
      const t = (hour - 17) / 3;
      ambientIntensity = 1.0 - t * 0.5;
      ambientColor = this.lerpColor(0xffffff, 0xff6644, t);
      overlayAlpha = 0.2 * t;
    }

    // Update Phaser's ambient light
    if (this.lights && this.lightsEnabled) {
      this.lights.setAmbientColor(ambientColor);
    }

    // Also draw overlay for additional darkening effect
    this.lightingOverlay.clear();
    if (overlayAlpha > 0.01) {
      this.lightingOverlay.fillStyle(0x000022, overlayAlpha);
      this.lightingOverlay.fillRect(0, 0, worldWidth * TILE_SIZE, worldHeight * TILE_SIZE);
    }
  }

  /**
   * Update lighting from state
   */
  updateLighting(ambient: number, ambientColor: number): void {
    if (this.lights && this.lightsEnabled) {
      this.lights.setAmbientColor(ambientColor);
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

  // ─── Utility ──────────────────────────────────────────────────────────────

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

  /**
   * Get world container for camera operations
   */
  getWorldContainer(): Phaser.GameObjects.Container {
    return this.groundLayer;
  }

  /**
   * Clean up
   */
  cleanup(): void {
    this.clearTiles();

    // Destroy particle emitters
    if (this.dustEmitter) this.dustEmitter.destroy();
    if (this.sparkleEmitter) this.sparkleEmitter.destroy();
    if (this.growthEmitter) this.growthEmitter.destroy();
    if (this.weatherEmitter) this.weatherEmitter.destroy();

    // Clear group
    this.dynamicSpriteGroup.clear(true, true);
  }
}
