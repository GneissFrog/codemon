/**
 * Camera - Pan and zoom controls for the game view
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
    this.state.panX += dx;
    this.state.panY += dy;
  }

  setPan(x: number, y: number): void {
    this.state.panX = x;
    this.state.panY = y;
  }

  zoomAt(clientX: number, clientY: number, delta: number): void {
    const oldZoom = this.state.zoom;
    this.state.zoom = Math.min(
      this.state.maxZoom,
      Math.max(this.state.minZoom, this.state.zoom * delta)
    );

    // Zoom toward cursor position
    this.state.panX = clientX - (clientX - this.state.panX) * (this.state.zoom / oldZoom);
    this.state.panY = clientY - (clientY - this.state.panY) * (this.state.zoom / oldZoom);
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
    const worldPixelW = worldWidth > 0 ? worldWidth * tileSize : 400;
    const worldPixelH = worldHeight > 0 ? worldHeight * tileSize : 300;
    const baseScale = Math.min(canvasWidth / worldPixelW, canvasHeight / worldPixelH);
    const totalScale = this.state.zoom * baseScale;

    return {
      x: (screenX - this.state.panX) / totalScale,
      y: (screenY - this.state.panY) / totalScale,
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
    const worldPixelW = worldWidth > 0 ? worldWidth * tileSize : 400;
    const worldPixelH = worldHeight > 0 ? worldHeight * tileSize : 300;
    const baseScale = Math.min(canvasWidth / worldPixelW, canvasHeight / worldPixelH);
    const totalScale = this.state.zoom * baseScale;

    return {
      x: worldX * totalScale + this.state.panX,
      y: worldY * totalScale + this.state.panY,
    };
  }

  reset(): void {
    this.state.panX = 0;
    this.state.panY = 0;
    this.state.zoom = 1;
  }
}
