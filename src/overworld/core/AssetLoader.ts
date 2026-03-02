/**
 * Asset Loader — Loads spritesheets and prepares sprite data for the webview
 *
 * Since webviews can't directly access extension files, we need to:
 * 1. Load PNGs in the extension host
 * 2. Convert to data URLs for transfer to webview
 * 3. Webview then creates ImageBitmaps from data URLs
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SpriteManifest, SpritesheetDef, LoadedSpritesheet, LoadedSprite, CharacterConfig, LegacyCharacterConfig, ActionConfig } from './types';

// ─── Migration Helpers ───────────────────────────────────────────────────────

/**
 * Migrate legacy character config format to new format with per-action frames
 */
export function migrateCharacterConfig(config: LegacyCharacterConfig | CharacterConfig): CharacterConfig {
  if (!config) {
    return { directions: ['down', 'up', 'left', 'right'], actions: [] };
  }

  // Check if already migrated (actions is array of objects with 'name' property)
  if (config.actions && config.actions.length > 0 && typeof config.actions[0] === 'object') {
    return config as CharacterConfig;
  }

  // Migrate from legacy format
  const legacy = config as LegacyCharacterConfig;
  const globalFrames = legacy.framesPerAction || 6;

  return {
    directions: legacy.directions || ['down', 'up', 'left', 'right'],
    actions: (legacy.actions as string[]).map((name: string): ActionConfig => ({
      name,
      frames: globalFrames,
      skill: undefined,
      customSkillName: undefined,
    })),
    // Keep framesPerAction temporarily for any legacy code that might need it
    framesPerAction: globalFrames,
  };
}

// ─── Asset Loader ──────────────────────────────────────────────────────────

export class AssetLoader {
  private extensionUri: vscode.Uri;
  private manifest: SpriteManifest | null = null;
  private spritesheets: Map<string, LoadedSpritesheet> = new Map();
  private loaded: boolean = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Load the sprite manifest and all spritesheets
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      // Load manifest
      const manifestPath = vscode.Uri.joinPath(
        this.extensionUri,
        'assets',
        'config',
        'sprite-manifest.json'
      );

      const manifestData = await vscode.workspace.fs.readFile(manifestPath);
      this.manifest = JSON.parse(manifestData.toString());

      // Load each spritesheet
      for (const [name, def] of Object.entries(this.manifest!.spritesheets)) {
        await this.loadSpritesheet(name, def);
      }

      this.loaded = true;
      console.log(`[AssetLoader] Loaded ${this.spritesheets.size} spritesheets`);
    } catch (error) {
      console.error('[AssetLoader] Failed to load assets:', error);
      throw error;
    }
  }

  /**
   * Load a single spritesheet and convert to data URL
   */
  private async loadSpritesheet(name: string, def: SpritesheetDef): Promise<void> {
    const imagePath = vscode.Uri.joinPath(this.extensionUri, def.image);
    console.log(`[AssetLoader] Loading spritesheet "${name}" from: ${imagePath.fsPath}`);

    try {
      // Read the image file
      const imageData = await vscode.workspace.fs.readFile(imagePath);
      console.log(`[AssetLoader] Read ${imageData.length} bytes for "${name}"`);

      // Convert to base64 data URL
      const base64 = Buffer.from(imageData).toString('base64');
      const mimeType = 'image/png';
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Parse sprite definitions
      const sprites = new Map<string, LoadedSprite>();

      for (const [spriteName, spriteDef] of Object.entries(def.sprites)) {
        // Skip comment entries or non-object values
        if (typeof spriteDef !== 'object' || spriteDef === null) continue;
        if ('comment' in spriteDef) continue;

        sprites.set(spriteName, {
          id: `${name}/${spriteName}`,
          spritesheet: name,
          x: spriteDef.x,
          y: spriteDef.y,
          width: spriteDef.w,
          height: spriteDef.h,
        });
      }

      this.spritesheets.set(name, {
        name,
        image: null,  // Will be created in webview
        imageUrl: dataUrl,
        sprites,
      });

      console.log(`[AssetLoader] Loaded spritesheet "${name}": ${sprites.size} sprites`);
    } catch (error) {
      console.warn(`[AssetLoader] Failed to load spritesheet "${name}":`, error);
    }
  }

  /**
   * Get the loaded manifest
   */
  getManifest(): SpriteManifest | null {
    return this.manifest;
  }

  /**
   * Get all loaded spritesheets (for webview transfer)
   */
  getSpritesheets(): Map<string, LoadedSpritesheet> {
    return this.spritesheets;
  }

  /**
   * Get a specific sprite by ID (e.g., "grass/grass-center")
   */
  getSprite(spriteId: string): LoadedSprite | null {
    const [sheetName, spriteName] = spriteId.split('/');
    const sheet = this.spritesheets.get(sheetName);
    if (!sheet) return null;
    return sheet.sprites.get(spriteName) || null;
  }

  /**
   * Get all sprite IDs
   */
  getAllSpriteIds(): string[] {
    const ids: string[] = [];
    for (const [sheetName, sheet] of this.spritesheets) {
      for (const spriteName of sheet.sprites.keys()) {
        ids.push(`${sheetName}/${spriteName}`);
      }
    }
    return ids;
  }

  /**
   * Get asset data for webview (serializable)
   */
  getWebviewAssets(): WebviewAssetData {
    if (!this.manifest) {
      throw new Error('Assets not loaded');
    }

    const spritesheets: Record<string, {
      imageUrl: string;
      sprites: Record<string, { x: number; y: number; w: number; h: number }>;
      isCharacter?: boolean;
      characterConfig?: CharacterConfig;
    }> = {};

    for (const [name, sheet] of this.spritesheets) {
      const sprites: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const [spriteName, sprite] of sheet.sprites) {
        sprites[spriteName] = {
          x: sprite.x,
          y: sprite.y,
          w: sprite.width,
          h: sprite.height,
        };
      }

      // Get metadata from manifest
      const manifestSheet = this.manifest!.spritesheets[name] as {
        isCharacter?: boolean;
        characterConfig?: LegacyCharacterConfig | CharacterConfig;
      };

      // Migrate character config if needed
      let characterConfig: CharacterConfig | undefined;
      if (manifestSheet?.characterConfig) {
        characterConfig = migrateCharacterConfig(manifestSheet.characterConfig);
      }

      spritesheets[name] = {
        imageUrl: sheet.imageUrl,
        sprites,
        isCharacter: manifestSheet?.isCharacter,
        characterConfig,
      };
    }

    return {
      manifest: this.manifest,
      spriteMappings: this.manifest.spriteMappings || {},
      spritesheets,
    };
  }

  /**
   * Check if assets are loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.spritesheets.clear();
    this.loaded = false;
  }
}

// ─── Webview Data Types ─────────────────────────────────────────────────────

export interface WebviewAssetData {
  manifest: SpriteManifest;
  spriteMappings: Record<string, string>;  // purpose -> sheetName
  spritesheets: Record<string, {
    imageUrl: string;
    sprites: Record<string, { x: number; y: number; w: number; h: number }>;
    isCharacter?: boolean;
    characterConfig?: CharacterConfig;
  }>;
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: AssetLoader | undefined;

export function getAssetLoader(extensionUri?: vscode.Uri): AssetLoader {
  if (!instance && extensionUri) {
    instance = new AssetLoader(extensionUri);
  }
  if (!instance) {
    throw new Error('AssetLoader not initialized - provide extensionUri');
  }
  return instance;
}
