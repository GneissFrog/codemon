/**
 * SpritePool - Object pooling for PixiJS sprites
 *
 * Avoids GC pressure by reusing sprite objects instead of creating
 * new ones every frame.
 */

import { Sprite, Texture, Container } from 'pixi.js';

export interface PooledSprite {
  sprite: Sprite;
  inUse: boolean;
}

export class SpritePool {
  private pool: Sprite[] = [];
  private activeSprites: Sprite[] = [];
  private container: Container | null = null;

  /**
   * Set the container that pooled sprites will be added to
   */
  setContainer(container: Container): void {
    this.container = container;
  }

  /**
   * Acquire a sprite from the pool, creating one if necessary
   */
  acquire(texture: Texture, x: number, y: number, w?: number, h?: number): Sprite {
    let sprite: Sprite;

    if (this.pool.length > 0) {
      sprite = this.pool.pop()!;
      sprite.texture = texture;
    } else {
      sprite = new Sprite(texture);
    }

    sprite.x = x;
    sprite.y = y;
    if (w !== undefined) sprite.width = w;
    if (h !== undefined) sprite.height = h;
    sprite.visible = true;

    this.activeSprites.push(sprite);

    if (this.container && sprite.parent !== this.container) {
      this.container.addChild(sprite);
    }

    return sprite;
  }

  /**
   * Release all active sprites back to the pool
   */
  releaseAll(): void {
    for (const sprite of this.activeSprites) {
      sprite.visible = false;
      if (sprite.parent) {
        sprite.parent.removeChild(sprite);
      }
    }
    this.pool.push(...this.activeSprites);
    this.activeSprites.length = 0;
  }

  /**
   * Get count of active sprites
   */
  get activeCount(): number {
    return this.activeSprites.length;
  }

  /**
   * Get count of pooled (available) sprites
   */
  get pooledCount(): number {
    return this.pool.length;
  }

  /**
   * Pre-allocate sprites to avoid runtime allocation
   */
  preAllocate(count: number, texture?: Texture): void {
    for (let i = 0; i < count; i++) {
      const sprite = texture ? new Sprite(texture) : new Sprite();
      sprite.visible = false;
      this.pool.push(sprite);
    }
  }

  /**
   * Clear pool and release all resources
   */
  destroy(): void {
    for (const sprite of this.pool) {
      sprite.destroy();
    }
    for (const sprite of this.activeSprites) {
      sprite.destroy();
    }
    this.pool.length = 0;
    this.activeSprites.length = 0;
    this.container = null;
  }
}

/**
 * Specialized pool for tile sprites with spatial tracking
 */
export class TileSpritePool {
  private tiles: Map<string, Sprite> = new Map();
  private container: Container | null = null;
  private textureCache: Map<string, Texture> | null = null;

  setContainer(container: Container): void {
    this.container = container;
  }

  setTextureCache(cache: Map<string, Texture>): void {
    this.textureCache = cache;
  }

  /**
   * Update or create a tile sprite at the given position
   */
  setTile(key: string, textureId: string, x: number, y: number): Sprite | null {
    if (!this.container || !this.textureCache) return null;

    const texture = this.textureCache.get(textureId);
    if (!texture) return null;

    let sprite = this.tiles.get(key);

    if (!sprite) {
      sprite = new Sprite(texture);
      sprite.x = x;
      sprite.y = y;
      this.container.addChild(sprite);
      this.tiles.set(key, sprite);
    } else {
      // Only update texture if changed
      if (sprite.texture !== texture) {
        sprite.texture = texture;
      }
    }

    return sprite;
  }

  /**
   * Remove a tile sprite
   */
  removeTile(key: string): void {
    const sprite = this.tiles.get(key);
    if (sprite) {
      if (sprite.parent) {
        sprite.parent.removeChild(sprite);
      }
      sprite.destroy();
      this.tiles.delete(key);
    }
  }

  /**
   * Set visibility for tiles outside viewport bounds
   */
  cullTiles(visibleBounds: { minX: number; maxX: number; minY: number; maxY: number }, tileSize: number): void {
    for (const [key, sprite] of this.tiles) {
      const tileX = Math.floor(sprite.x / tileSize);
      const tileY = Math.floor(sprite.y / tileSize);

      const isVisible =
        tileX >= visibleBounds.minX &&
        tileX <= visibleBounds.maxX &&
        tileY >= visibleBounds.minY &&
        tileY <= visibleBounds.maxY;

      sprite.visible = isVisible;
    }
  }

  /**
   * Get all tile sprites
   */
  getTiles(): Map<string, Sprite> {
    return this.tiles;
  }

  /**
   * Clear all tiles
   */
  clear(): void {
    for (const sprite of this.tiles.values()) {
      if (sprite.parent) {
        sprite.parent.removeChild(sprite);
      }
      sprite.destroy();
    }
    this.tiles.clear();
  }

  /**
   * Get tile count
   */
  get size(): number {
    return this.tiles.size;
  }

  /**
   * Destroy pool and all sprites
   */
  destroy(): void {
    this.clear();
    this.container = null;
    this.textureCache = null;
  }
}
