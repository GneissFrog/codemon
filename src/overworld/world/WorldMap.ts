/**
 * WorldMap — Tile-based representation of the farm world
 *
 * Handles:
 * - Tile storage and lookup
 * - Camera positioning and viewport
 * - Coordinate conversions (world ↔ screen)
 */

import { Tile, TileType, Plot, SerializedWorldMap } from '../core/types';

export interface Camera {
  x: number;      // World coordinates
  y: number;
  zoom: number;
  targetX: number; // For smooth camera follow
  targetY: number;
}

export interface Viewport {
  width: number;
  height: number;
  tileWidth: number;  // Pixels per tile (usually 16)
  tileHeight: number;
}

export class WorldMap {
  private tiles: Map<string, Tile> = new Map();
  private plots: Map<string, Plot> = new Map();
  private width: number;  // In tiles
  private height: number; // In tiles
  private camera: Camera;
  private viewport: Viewport;

  constructor(width: number, height: number, tileSize: number = 16) {
    this.width = width;
    this.height = height;
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1,
      targetX: 0,
      targetY: 0,
    };
    this.viewport = {
      width: 800,
      height: 600,
      tileWidth: tileSize,
      tileHeight: tileSize,
      };
  }

  // ─── Tile Management ──────────────────────────────────────────────────

  /**
   * Set a tile at world coordinates
   */
  setTile(x: number, y: number, type: TileType, spriteId: string, variant: number = 0, layer: number = 0): void {
    const key = `${x},${y},${layer}`;
    this.tiles.set(key, {
      x,
      y,
      type,
      spriteId,
      variant,
      layer,
    });
  }

  /**
   * Get tile at world coordinates
   */
  getTile(x: number, y: number, layer: number = 0): Tile | null {
    const key = `${x},${y},${layer}`;
    return this.tiles.get(key) || null;
  }

  /**
   * Get all tiles
   */
  getAllTiles(): Tile[] {
    return Array.from(this.tiles.values());
  }

  /**
   * Remove a tile at world coordinates
   */
  removeTile(x: number, y: number, layer: number = 0): boolean {
    const key = `${x},${y},${layer}`;
    return this.tiles.delete(key);
  }

  /**
   * Clear all tiles and plots
   */
  clearTiles(): void {
    this.tiles.clear();
    this.plots.clear();
  }

  // ─── Plot Management ───────────────────────────────────────────────────

  /**
   * Add a plot (file/directory representation)
   */
  addPlot(plot: Plot): void {
    this.plots.set(plot.id, plot);
  }

  /**
   * Get plot by ID
   */
  getPlot(id: string): Plot | undefined {
    return this.plots.get(id);
  }

  /**
   * Get all plots
   */
  getAllPlots(): Plot[] {
    return Array.from(this.plots.values());
  }

  /**
   * Get plot at world coordinates
   */
  getPlotAt(x: number, y: number): Plot | undefined {
    for (const plot of this.plots.values()) {
      if (x >= plot.x && x < plot.x + plot.width &&
          y >= plot.y && y < plot.y + plot.height) {
        return plot;
      }
    }
    return undefined;
  }

  // ─── Camera ──────────────────────────────────────────────────────────────

  /**
   * Set camera position
   */
  setCameraPosition(x: number, y: number, smooth: boolean = false): void {
    if (smooth) {
      this.camera.targetX = x;
      this.camera.targetY = y;
    } else {
      this.camera.x = x;
      this.camera.y = y;
      this.camera.targetX = x;
      this.camera.targetY = y;
    }
  }

  /**
   * Set camera zoom
   */
  setCameraZoom(zoom: number): void {
    this.camera.zoom = Math.max(0.5, Math.min(4, zoom));
  }

  /**
   * Update camera (call each frame for smooth movement)
   */
  updateCamera(deltaTime: number): void {
    const speed = 5; // Tiles per second
    const dx = this.camera.targetX - this.camera.x;
    const dy = this.camera.targetY - this.camera.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {
      const move = speed * deltaTime;
      this.camera.x += (dx / dist) * Math.min(move, dist);
      this.camera.y += (dy / dist) * Math.min(move, dist);
    } else {
      this.camera.x = this.camera.targetX;
      this.camera.y = this.camera.targetY;
    }
  }

  /**
   * Get camera
   */
  getCamera(): Camera {
    return { ...this.camera };
  }

  // ─── Viewport ────────────────────────────────────────────────────────────

  /**
   * Set viewport size
   */
  setViewportSize(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  /**
   * Get viewport
   */
  getViewport(): Viewport {
    return { ...this.viewport };
  }

  // ─── Coordinate Conversions ─────────────────────────────────────────────

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const tileWidth = this.viewport.tileWidth;
    const tileHeight = this.viewport.tileHeight;
    const zoom = this.camera.zoom;

    return {
      x: (worldX - this.camera.x) * tileWidth * zoom + this.viewport.width / 2,
      y: (worldY - this.camera.y) * tileHeight * zoom + this.viewport.height / 2,
    };
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const tileWidth = this.viewport.tileWidth;
    const tileHeight = this.viewport.tileHeight;
    const zoom = this.camera.zoom;

    return {
      x: (screenX - this.viewport.width / 2) / (tileWidth * zoom) + this.camera.x,
      y: (screenY - this.viewport.height / 2) / (tileHeight * zoom) + this.camera.y,
    };
  }

  /**
   * Get visible tile bounds
   */
  getVisibleBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.viewport.width, this.viewport.height);

    return {
      minX: Math.max(0, Math.floor(topLeft.x) - 1),
      maxX: Math.min(this.width, Math.ceil(bottomRight.x) + 1),
      minY: Math.max(0, Math.floor(topLeft.y) - 1),
      maxY: Math.min(this.height, Math.ceil(bottomRight.y) + 1),
    };
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  /**
   * Serialize the world map for transfer to the webview
   */
  serialize(): SerializedWorldMap {
    return {
      tiles: this.getAllTiles(),
      plots: this.getAllPlots(),
      width: this.width,
      height: this.height,
    };
  }

  // ─── World Info ──────────────────────────────────────────────────────────

  /**
   * Set world dimensions (call after world generation)
   */
  setDimensions(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /**
   * Get world dimensions
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Get spawn position for new entities
   */
  getSpawnPosition(): { x: number; y: number } {
    // Spawn near center or near a random plot
    const plots = this.getAllPlots();
    if (plots.length > 0) {
      const randomPlot = plots[Math.floor(Math.random() * plots.length)];
      return {
        x: randomPlot.x + randomPlot.width / 2,
        y: randomPlot.y + randomPlot.height / 2,
      };
    }
    return { x: this.width / 2, y: this.height / 2 };
  }
}
