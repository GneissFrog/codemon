/**
 * BootScene - Asset loading and initialization scene
 *
 * Handles loading base64 textures and transitioning to GameScene
 */

import Phaser from 'phaser';
import { WebviewAssetData, TILE_SIZE } from '../types';

export class BootScene extends Phaser.Scene {
  private assets: WebviewAssetData | null = null;
  private onReadyCallback: (() => void) | null = null;

  constructor() {
    super({ key: 'BootScene' });
  }

  /**
   * Set assets to load (called before scene starts)
   */
  setAssets(assets: WebviewAssetData): void {
    this.assets = assets;
  }

  /**
   * Set callback for when assets are loaded
   */
  setOnReady(callback: () => void): void {
    this.onReadyCallback = callback;
  }

  preload(): void {
    // Show loading text
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const loadingText = this.add.text(width / 2, height / 2, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5, 0.5);

    if (!this.assets) {
      console.warn('[BootScene] No assets to load');
      return;
    }

    // Load spritesheets from base64 data URLs
    for (const [name, sheetData] of Object.entries(this.assets.spritesheets)) {
      // Phaser can load base64 directly
      this.load.image(name, sheetData.imageUrl);

      // Load normal map if available
      if (sheetData.normalMapUrl) {
        this.load.image(`${name}_normal`, sheetData.normalMapUrl);
      }
    }
  }

  create(): void {
    if (!this.assets) {
      console.warn('[BootScene] No assets loaded');
      this.scene.start('GameScene');
      return;
    }

    // Create frame definitions for each spritesheet
    for (const [name, sheetData] of Object.entries(this.assets.spritesheets)) {
      const texture = this.textures.get(name);
      if (!texture) continue;

      // Add frame definitions for each sprite in the sheet
      for (const [spriteName, def] of Object.entries(sheetData.sprites)) {
        texture.add(spriteName, 0, def.x, def.y, def.w, def.h);
      }

      console.log(`[BootScene] Loaded spritesheet: ${name} with ${Object.keys(sheetData.sprites).length} sprites`);
    }

    console.log('[BootScene] All assets loaded');

    // Notify callback
    if (this.onReadyCallback) {
      this.onReadyCallback();
    }

    // Transition to game scene
    this.scene.start('GameScene');
  }
}
