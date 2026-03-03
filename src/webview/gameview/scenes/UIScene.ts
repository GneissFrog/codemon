/**
 * UIScene - Fixed UI overlay scene
 *
 * Handles UI elements that should not be affected by camera transforms
 */

import Phaser from 'phaser';

export class UIScene extends Phaser.Scene {
  private uiContainer!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // Create UI container (fixed to camera)
    this.uiContainer = this.add.container(0, 0);
    this.uiContainer.setScrollFactor(0, 0);
    this.uiContainer.setDepth(100);

    console.log('[UIScene] Created');
  }

  /**
   * Add UI element
   */
  addElement(element: Phaser.GameObjects.GameObject): void {
    this.uiContainer.add(element);
  }

  /**
   * Clear all UI elements
   */
  clearElements(): void {
    this.uiContainer.removeAll(true);
  }

  /**
   * Get UI container
   */
  getContainer(): Phaser.GameObjects.Container {
    return this.uiContainer;
  }
}
