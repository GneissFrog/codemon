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
import { SpriteManifest, SpritesheetDef, LoadedSpritesheet, LoadedSprite, AsepriteConfig } from './types';

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

      // Try to load normal map (auto-detect via _n suffix)
      let normalMapUrl: string | undefined;
      const normalMapPath = def.image.replace('.png', '_n.png');
      try {
        const normalMapFullPath = vscode.Uri.joinPath(this.extensionUri, normalMapPath);
        const normalMapData = await vscode.workspace.fs.readFile(normalMapFullPath);
        const normalMapBase64 = Buffer.from(normalMapData).toString('base64');
        normalMapUrl = `data:${mimeType};base64,${normalMapBase64}`;
        console.log(`[AssetLoader] Found normal map for "${name}": ${normalMapPath}`);
      } catch {
        // Normal map doesn't exist - this is fine, not all spritesheets need them
      }

      // Load Aseprite JSON if configured
      let asepriteData: import('./types').AsepriteExportData | undefined;
      let asepriteTags: string[] | undefined;
      if (def.aseprite) {
        try {
          asepriteData = await this.loadAsepriteJson(def.aseprite);
          asepriteTags = def.aseprite.tags;
          console.log(`[AssetLoader] Loaded Aseprite data for "${name}": ${Object.keys(asepriteData.frames).length} frames, ${asepriteData.meta.frameTags?.length || 0} tags`);
        } catch (error) {
          console.warn(`[AssetLoader] Failed to load Aseprite JSON for "${name}":`, error);
        }
      }

      // Parse sprite definitions
      const sprites = new Map<string, LoadedSprite>();

      // If we have Aseprite data, extract frames from it
      if (asepriteData) {
        for (const [frameName, frameData] of Object.entries(asepriteData.frames)) {
          sprites.set(frameName, {
            id: `${name}/${frameName}`,
            spritesheet: name,
            x: frameData.frame.x,
            y: frameData.frame.y,
            width: frameData.frame.w,
            height: frameData.frame.h,
          });
        }
      }

      // For terrain tilesets, auto-generate grid-position sprites (t_col_row)
      if (def.terrainTileset) {
        const tileSize = def.frameSize.width;
        for (let row = 0; row < def.grid.rows; row++) {
          for (let col = 0; col < def.grid.cols; col++) {
            const spriteName = `t_${col}_${row}`;
            sprites.set(spriteName, {
              id: `${name}/${spriteName}`,
              spritesheet: name,
              x: col * tileSize,
              y: row * tileSize,
              width: tileSize,
              height: tileSize,
            });
          }
        }
      }

      // Also load manually defined sprites (can coexist with Aseprite and terrain grids)
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
        normalMapUrl,
        sprites,
        asepriteData,
        asepriteTags,
      });

      console.log(`[AssetLoader] Loaded spritesheet "${name}": ${sprites.size} sprites${normalMapUrl ? ' (+normal map)' : ''}${asepriteData ? ' (+Aseprite)' : ''}`);
    } catch (error) {
      console.warn(`[AssetLoader] Failed to load spritesheet "${name}":`, error);
    }
  }

  /**
   * Load and parse an Aseprite JSON export file
   */
  private async loadAsepriteJson(config: AsepriteConfig): Promise<import('./types').AsepriteExportData> {
    const jsonPath = vscode.Uri.joinPath(this.extensionUri, config.jsonFile);
    const jsonData = await vscode.workspace.fs.readFile(jsonPath);
    return JSON.parse(jsonData.toString());
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
      normalMapUrl?: string;
      sprites: Record<string, { x: number; y: number; w: number; h: number }>;
      asepriteData?: import('./types').AsepriteExportData;
      asepriteTags?: string[];
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

      spritesheets[name] = {
        imageUrl: sheet.imageUrl,
        normalMapUrl: sheet.normalMapUrl,
        sprites,
        asepriteData: sheet.asepriteData,
        asepriteTags: sheet.asepriteTags,
      };
    }

    return {
      manifest: this.manifest,
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
  spritesheets: Record<string, {
    imageUrl: string;
    normalMapUrl?: string;
    sprites: Record<string, { x: number; y: number; w: number; h: number }>;
    asepriteData?: import('./types').AsepriteExportData;  // Parsed Aseprite JSON
    asepriteTags?: string[];  // Tags to filter
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
