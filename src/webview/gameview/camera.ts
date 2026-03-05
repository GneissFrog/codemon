/**
 * Camera - Pan and zoom controls for the game view
 *
 * Uses scroll-based coordinates compatible with Phaser's camera model:
 * - scrollX/scrollY: world position at screen origin (0,0)
 * - zoom: zoom level
 *
 * Screen to world: worldX = scrollX + screenX / zoom
 * World to screen: screenX = (worldX - scrollX) * zoom
 */

import { CameraState } from './types';

export class Camera {
  state: CameraState;

  constructor() {
    this.state = {
      panX: 0,
      panY: 0,
      zoom: 1,
      minZoom: 0.5,
      maxZoom: 4,
    };
  }

  pan(dx: number, dy: number): void {
    // Convert screen delta to scroll delta (in world units)
    this.state.panX -= dx / this.state.zoom;
    this.state.panY -= dy / this.state.zoom;
  }

  setPan(x: number, y: number): void {
    this.state.panX = x;
    this.state.panY = y;
  }

  /**
   * Zoom centered on a screen position
   *
   * @param clientX Screen X coordinate (relative to canvas)
   * @param clientY Screen Y coordinate (relative to canvas)
   * @param delta Zoom multiplier (e.g., 1.1 to zoom in, 0.9 to zoom out)
   */
  zoomAt(clientX: number, clientY: number, delta: number): void {
    const oldZoom = this.state.zoom;
    const newZoom = Math.min(
      this.state.maxZoom,
      Math.max(this.state.minZoom, this.state.zoom * delta)
    );

    if (newZoom === oldZoom) return;

    // Calculate world position under cursor before zoom
    // worldX = scrollX + screenX / zoom (where scrollX = panX)
    const worldX = this.state.panX + clientX / oldZoom;
    const worldY = this.state.panY + clientY / oldZoom;

    // Update zoom
    this.state.zoom = newZoom;

    // Adjust scroll so the world position under cursor stays at the same screen position
    // We want: worldX = newScrollX + clientX / newZoom
    // So: newScrollX = worldX - clientX / newZoom
    this.state.panX = worldX - clientX / newZoom;
    this.state.panY = worldY - clientY / newZoom;
  }

  screenToWorld(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    worldWidth: number,
    worldHeight: number,
    tileSize: number
  ): { x: number; y: number } {
    // Direct coordinate conversion without baseScale
    // baseScale is handled by the world size, not the camera
    return {
      x: this.state.panX + screenX / this.state.zoom,
      y: this.state.panY + screenY / this.state.zoom,
    };
  }

  worldToScreen(
    worldX: number,
    worldY: number,
    canvasWidth: number,
    canvasHeight: number,
    worldWidth: number,
    worldHeight: number,
    tileSize: number
  ): { x: number; y: number } {
    return {
      x: (worldX - this.state.panX) * this.state.zoom,
      y: (worldY - this.state.panY) * this.state.zoom,
    };
  }

  reset(): void {
    this.state.panX = 0;
    this.state.panY = 0;
    this.state.zoom = 1;
  }
}
