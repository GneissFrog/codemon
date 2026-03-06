/**
 * Sprite Configuration Panel - Sidebar panel for viewing and configuring sprites
 *
 * Features:
 * - View all loaded spritesheets
 * - Click to select sprite regions
 * - Adjust coordinates in manifest
 * - Preview sprites
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getAssetLoader, WebviewAssetData, migrateCharacterConfig } from '../overworld/core/AssetLoader';
import { getGameViewPanel } from './GameViewPanel';
import { CharacterConfig, ActionConfig } from '../overworld/core/types';

export class SpriteConfigPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.spriteConfig';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case 'webviewReady':
          await this._sendAssets();
          break;
        case 'openManifest':
          // Open the sprite manifest file
          const manifestPath = vscode.Uri.joinPath(
            this._extensionUri,
            'assets',
            'config',
            'sprite-manifest.json'
          );
          const doc = await vscode.workspace.openTextDocument(manifestPath);
          vscode.window.showTextDocument(doc);
          break;
        case 'updateSprite':
          await this._updateSprite(message.data as { sheetName: string; spriteName: string; sprite: { x: number; y: number; w: number; h: number } });
          break;
        case 'addSprite':
          await this._addSprite(message.data as { sheetName: string; spriteName: string; sprite: { x: number; y: number; w: number; h: number } });
          break;
        case 'deleteSprite':
          await this._deleteSprite(message.data as { sheetName: string; spriteName: string });
          break;
        case 'updateCharacterConfig':
          await this._updateCharacterConfig(message.data as { sheetName: string; characterConfig: CharacterConfig });
          break;
        case 'highlightSprite':
          // Forward highlight request to GameViewPanel
          const spriteId = (message.data as { spriteId: string | null }).spriteId;
          getGameViewPanel(this._extensionUri).highlightSprite(spriteId);
          break;
        case 'setActiveCharacterSheet':
          await this._updateSpriteMapping({ purpose: 'character', sheetName: (message.data as { sheetName: string }).sheetName });
          break;
        case 'updateSpriteMapping':
          await this._updateSpriteMapping(message.data as { purpose: string; sheetName: string });
          break;
        case 'browseImage':
          await this._browseForImage();
          break;
        case 'replaceImage':
          await this._replaceSpritesheetImage(message.data as { sheetName: string });
          break;
        case 'addSpritesheet':
          await this._addSpritesheet(message.data as {
            name: string;
            imagePath: string;
            frameW: number;
            frameH: number;
            autoGen: boolean;
            isCharacter: boolean;
            directions?: string;
            actions?: string;
          });
          break;
        case 'updateLighting':
          // Forward lighting config to GameViewPanel
          getGameViewPanel(this._extensionUri).updateLighting(message.data as {
            enabled?: boolean;
            dayNightCycle?: boolean;
            agentLight?: boolean;
            agentLightRadius?: number;
            agentLightIntensity?: number;
            agentLightColor?: number;
          });
          break;
        case 'browseAsepriteJson':
          await this._browseForAsepriteJson();
          break;
        case 'updateAsepriteConfig':
          await this._updateAsepriteConfig(message.data as { sheetName: string; asepriteConfig: { jsonFile: string; tags?: string[] } | null });
          break;
      }
    });
  }

  /**
   * Send asset data to webview
   */
  private async _sendAssets(): Promise<void> {
    if (!this._view) return;

    try {
      const loader = getAssetLoader(this._extensionUri);
      if (!loader.isLoaded()) {
        await loader.load();
      }
      const assets = loader.getWebviewAssets();
      this._view.webview.postMessage({
        type: 'loadAssets',
        assets,
      });
    } catch (error) {
      console.error('[SpriteConfig] Failed to load assets:', error);
    }
  }

  /**
   * Get path to sprite manifest
   */
  private _getManifestPath(): vscode.Uri {
    return vscode.Uri.joinPath(
      this._extensionUri,
      'assets',
      'config',
      'sprite-manifest.json'
    );
  }

  /**
   * Read manifest JSON
   */
  private async _readManifest(): Promise<Record<string, unknown>> {
    const manifestPath = this._getManifestPath();
    const content = await vscode.workspace.fs.readFile(manifestPath);
    return JSON.parse(content.toString());
  }

  /**
   * Write manifest JSON
   */
  private async _writeManifest(manifest: Record<string, unknown>): Promise<void> {
    const manifestPath = this._getManifestPath();
    const content = JSON.stringify(manifest, null, 2);
    await vscode.workspace.fs.writeFile(manifestPath, Buffer.from(content));
  }

  /**
   * Update an existing sprite's coordinates
   */
  private async _updateSprite(data: { sheetName: string; spriteName: string; sprite: { x: number; y: number; w: number; h: number } }): Promise<void> {
    try {
      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, { sprites: Record<string, { x: number; y: number; w: number; h: number }> }>;

      if (sheets[data.sheetName]?.sprites?.[data.spriteName]) {
        sheets[data.sheetName].sprites[data.spriteName] = {
          ...sheets[data.sheetName].sprites[data.spriteName],
          ...data.sprite
        };

        await this._writeManifest(manifest);

        // Reload assets and notify both webviews
        const loader = getAssetLoader(this._extensionUri);
        await loader.load();
        await this._sendAssets();
        await getGameViewPanel(this._extensionUri).refreshAssets();

        vscode.window.showInformationMessage(`Updated sprite "${data.spriteName}" in ${data.sheetName}`);
      } else {
        vscode.window.showErrorMessage(`Sprite "${data.spriteName}" not found in ${data.sheetName}`);
      }
    } catch (error) {
      console.error('[SpriteConfig] Failed to update sprite:', error);
      vscode.window.showErrorMessage(`Failed to update sprite: ${error}`);
    }
  }

  /**
   * Add a new sprite to a spritesheet
   */
  private async _addSprite(data: { sheetName: string; spriteName: string; sprite: { x: number; y: number; w: number; h: number } }): Promise<void> {
    try {
      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, { sprites: Record<string, { x: number; y: number; w: number; h: number }> }>;

      if (sheets[data.sheetName]) {
        if (sheets[data.sheetName].sprites[data.spriteName]) {
          vscode.window.showWarningMessage(`Sprite "${data.spriteName}" already exists. Use update instead.`);
          return;
        }

        sheets[data.sheetName].sprites[data.spriteName] = data.sprite;

        await this._writeManifest(manifest);

        // Reload assets and notify both webviews
        const loader = getAssetLoader(this._extensionUri);
        await loader.load();
        await this._sendAssets();
        await getGameViewPanel(this._extensionUri).refreshAssets();

        vscode.window.showInformationMessage(`Added sprite "${data.spriteName}" to ${data.sheetName}`);
      } else {
        vscode.window.showErrorMessage(`Spritesheet "${data.sheetName}" not found`);
      }
    } catch (error) {
      console.error('[SpriteConfig] Failed to add sprite:', error);
      vscode.window.showErrorMessage(`Failed to add sprite: ${error}`);
    }
  }

  /**
   * Delete a sprite from a spritesheet
   */
  private async _deleteSprite(data: { sheetName: string; spriteName: string }): Promise<void> {
    try {
      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, { sprites: Record<string, { x: number; y: number; w: number; h: number }> }>;

      if (sheets[data.sheetName]?.sprites?.[data.spriteName]) {
        delete sheets[data.sheetName].sprites[data.spriteName];

        await this._writeManifest(manifest);

        // Reload assets and notify both webviews
        const loader = getAssetLoader(this._extensionUri);
        await loader.load();
        await this._sendAssets();
        await getGameViewPanel(this._extensionUri).refreshAssets();

        vscode.window.showInformationMessage(`Deleted sprite "${data.spriteName}" from ${data.sheetName}`);
      } else {
        vscode.window.showErrorMessage(`Sprite "${data.spriteName}" not found in ${data.sheetName}`);
      }
    } catch (error) {
      console.error('[SpriteConfig] Failed to delete sprite:', error);
      vscode.window.showErrorMessage(`Failed to delete sprite: ${error}`);
    }
  }

  /**
   * Update character config for a spritesheet
   */
  private async _updateCharacterConfig(data: { sheetName: string; characterConfig: CharacterConfig }): Promise<void> {
    try {
      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, {
        characterConfig?: CharacterConfig;
      }>;

      if (sheets[data.sheetName]) {
        // Update the character config
        sheets[data.sheetName].characterConfig = data.characterConfig;

        await this._writeManifest(manifest);

        // Reload assets and notify both webviews
        const loader = getAssetLoader(this._extensionUri);
        loader.dispose(); // Clear cache to force reload
        await loader.load();
        await this._sendAssets();
        await getGameViewPanel(this._extensionUri).refreshAssets();

        vscode.window.showInformationMessage(
          `Updated action configuration for ${data.sheetName}`
        );
      } else {
        vscode.window.showErrorMessage(`Spritesheet "${data.sheetName}" not found`);
      }
    } catch (error) {
      console.error('[SpriteConfig] Failed to update character config:', error);
      vscode.window.showErrorMessage(`Failed to update config: ${error}`);
    }
  }

  /**
   * Update a sprite mapping (assign a spritesheet to a purpose)
   */
  private async _updateSpriteMapping(data: { purpose: string; sheetName: string }): Promise<void> {
    try {
      const manifest = await this._readManifest();

      // Initialize spriteMappings if it doesn't exist
      if (!manifest.spriteMappings) {
        manifest.spriteMappings = {};
      }

      const mappings = manifest.spriteMappings as Record<string, string>;
      mappings[data.purpose] = data.sheetName;

      await this._writeManifest(manifest);

      // Reload assets and notify both webviews
      const loader = getAssetLoader(this._extensionUri);
      loader.dispose(); // Clear cache to force reload
      await loader.load();
      await this._sendAssets();
      await getGameViewPanel(this._extensionUri).refreshAssets();

      vscode.window.showInformationMessage(
        `Set "${data.sheetName}" as the spritesheet for "${data.purpose}"`
      );
    } catch (error) {
      console.error('[SpriteConfig] Failed to update sprite mapping:', error);
      vscode.window.showErrorMessage(`Failed to update sprite mapping: ${error}`);
    }
  }

  /**
   * Browse for an image file and return the relative path
   */
  private async _browseForImage(): Promise<void> {
    if (!this._view) return;

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Image Files': ['png', 'jpg', 'jpeg', 'gif'] },
      defaultUri: vscode.Uri.joinPath(this._extensionUri, 'assets', 'sprites'),
    });

    if (result && result[0]) {
      // Convert absolute path to relative path from extension root
      const absolutePath = result[0].fsPath;
      const extensionPath = this._extensionUri.fsPath;
      let relativePath = absolutePath.replace(extensionPath, '');
      // Normalize path separators and remove leading slash
      relativePath = relativePath.replace(/^[\/\\]/, '').replace(/\\/g, '/');

      this._view.webview.postMessage({
        type: 'selectedImagePath',
        path: relativePath,
      });
    }
  }

  /**
   * Add a new spritesheet to the manifest
   */
  private async _addSpritesheet(data: {
    name: string;
    imagePath: string;
    frameW: number;
    frameH: number;
    autoGen: boolean;
    isCharacter: boolean;
    directions?: string;
    actions?: string;
  }): Promise<void> {
    if (!this._view) return;

    try {
      // Validate name
      if (!data.name || !data.name.match(/^[a-zA-Z0-9_-]+$/)) {
        this._view.webview.postMessage({
          type: 'addSheetError',
          error: 'Name must contain only letters, numbers, hyphens, and underscores',
        });
        return;
      }

      // Validate image path
      if (!data.imagePath) {
        this._view.webview.postMessage({
          type: 'addSheetError',
          error: 'Image path is required',
        });
        return;
      }

      // Check if file exists
      const imageUri = vscode.Uri.joinPath(this._extensionUri, data.imagePath);
      try {
        await vscode.workspace.fs.stat(imageUri);
      } catch {
        this._view.webview.postMessage({
          type: 'addSheetError',
          error: `Image file not found: ${data.imagePath}`,
        });
        return;
      }

      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, unknown>;

      // Check for duplicate name
      if (sheets[data.name]) {
        this._view.webview.postMessage({
          type: 'addSheetError',
          error: `Spritesheet "${data.name}" already exists`,
        });
        return;
      }

      // Get image dimensions by reading the file
      const imageData = await vscode.workspace.fs.readFile(imageUri);
      // For PNG files, we can extract dimensions from the header
      // PNG dimensions are at bytes 16-24 (width) and 20-24 (height)
      let imageWidth = 128;
      let imageHeight = 128;

      if (imageData.length > 24 && imageData[0] === 0x89 && imageData[1] === 0x50) {
        // It's a PNG - extract dimensions from IHDR chunk
        imageWidth = (imageData[16] << 24) | (imageData[17] << 16) | (imageData[18] << 8) | imageData[19];
        imageHeight = (imageData[20] << 24) | (imageData[21] << 16) | (imageData[22] << 8) | imageData[23];
      }

      const frameW = data.frameW || 16;
      const frameH = data.frameH || 16;
      const cols = Math.floor(imageWidth / frameW);
      const rows = Math.floor(imageHeight / frameH);

      // Build sprites object
      const sprites: Record<string, { x: number; y: number; w: number; h: number }> = {};

      if (data.autoGen) {
        if (data.isCharacter && data.actions && data.directions) {
          // Generate character sprites based on actions and directions
          const directions = data.directions.split(',').map(d => d.trim());
          const actionDefs = data.actions.split(',').map(a => {
            const [name, frames] = a.trim().split(':');
            return { name, frames: parseInt(frames) || 4 };
          });

          let row = 0;
          for (const actionDef of actionDefs) {
            for (const dir of directions) {
              for (let f = 0; f < actionDef.frames; f++) {
                const spriteName = `char-${actionDef.name}-${dir}-${f}`;
                sprites[spriteName] = {
                  x: f * frameW,
                  y: row * frameH,
                  w: frameW,
                  h: frameH,
                };
              }
              row++;
            }
          }
        } else {
          // Generate grid-based sprites
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const spriteName = `sprite-${c}-${r}`;
              sprites[spriteName] = {
                x: c * frameW,
                y: r * frameH,
                w: frameW,
                h: frameH,
              };
            }
          }
        }
      }

      // Build the spritesheet definition
      const sheetDef: Record<string, unknown> = {
        image: data.imagePath,
        dimensions: { width: imageWidth, height: imageHeight },
        frameSize: { width: frameW, height: frameH },
        grid: { cols, rows },
        sprites,
      };

      // Add character config if needed
      if (data.isCharacter) {
        sheetDef.isCharacter = true;
        const directions = (data.directions || 'down,up,left,right').split(',').map(d => d.trim());
        const actionDefs = (data.actions || 'idle:4,walk:6').split(',').map(a => {
          const [name, frames] = a.trim().split(':');
          return { name, frames: parseInt(frames) || 4 };
        });

        sheetDef.characterConfig = {
          directions,
          actions: actionDefs.map(a => ({
            name: a.name,
            frames: a.frames,
            skill: undefined,
            customSkillName: undefined,
          })),
        };
      }

      // Add to manifest
      sheets[data.name] = sheetDef;
      await this._writeManifest(manifest);

      // Reload assets and refresh
      const loader = getAssetLoader(this._extensionUri);
      loader.dispose();
      await loader.load();
      await this._sendAssets();
      await getGameViewPanel(this._extensionUri).refreshAssets();

      // Notify success
      this._view.webview.postMessage({ type: 'addSheetSuccess' });
      vscode.window.showInformationMessage(`Created spritesheet "${data.name}" with ${Object.keys(sprites).length} sprites`);

    } catch (error) {
      console.error('[SpriteConfig] Failed to add spritesheet:', error);
      this._view.webview.postMessage({
        type: 'addSheetError',
        error: `Failed to create spritesheet: ${error}`,
      });
    }
  }

  /**
   * Replace the image for an existing spritesheet
   */
  private async _replaceSpritesheetImage(data: { sheetName: string }): Promise<void> {
    if (!this._view) return;

    try {
      // Open file picker to select new image
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Image Files': ['png', 'jpg', 'jpeg', 'gif'] },
        defaultUri: vscode.Uri.joinPath(this._extensionUri, 'assets', 'sprites'),
      });

      if (!result || !result[0]) {
        return; // User cancelled
      }

      // Convert absolute path to relative path from extension root
      const absolutePath = result[0].fsPath;
      const extensionPath = this._extensionUri.fsPath;
      let relativePath = absolutePath.replace(extensionPath, '');
      // Normalize path separators and remove leading slash
      relativePath = relativePath.replace(/^[\/\\]/, '').replace(/\\/g, '/');

      // Check if file exists
      const imageUri = vscode.Uri.joinPath(this._extensionUri, relativePath);
      try {
        await vscode.workspace.fs.stat(imageUri);
      } catch {
        vscode.window.showErrorMessage(`Image file not found: ${relativePath}`);
        return;
      }

      // Get image dimensions
      const imageData = await vscode.workspace.fs.readFile(imageUri);
      let imageWidth = 128;
      let imageHeight = 128;

      if (imageData.length > 24 && imageData[0] === 0x89 && imageData[1] === 0x50) {
        imageWidth = (imageData[16] << 24) | (imageData[17] << 16) | (imageData[18] << 8) | imageData[19];
        imageHeight = (imageData[20] << 24) | (imageData[21] << 16) | (imageData[22] << 8) | imageData[23];
      }

      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, Record<string, unknown>>;

      if (!sheets[data.sheetName]) {
        vscode.window.showErrorMessage(`Spritesheet "${data.sheetName}" not found`);
        return;
      }

      // Update the image path and dimensions
      sheets[data.sheetName].image = relativePath;
      sheets[data.sheetName].dimensions = { width: imageWidth, height: imageHeight };

      // Update grid based on new dimensions and existing frame size
      const frameSize = sheets[data.sheetName].frameSize as { width: number; height: number } || { width: 16, height: 16 };
      sheets[data.sheetName].grid = {
        cols: Math.floor(imageWidth / frameSize.width),
        rows: Math.floor(imageHeight / frameSize.height),
      };

      await this._writeManifest(manifest);

      // Reload assets and refresh
      const loader = getAssetLoader(this._extensionUri);
      loader.dispose();
      await loader.load();
      await this._sendAssets();
      await getGameViewPanel(this._extensionUri).refreshAssets();

      vscode.window.showInformationMessage(`Updated image for "${data.sheetName}"`);

    } catch (error) {
      console.error('[SpriteConfig] Failed to replace image:', error);
      vscode.window.showErrorMessage(`Failed to replace image: ${error}`);
    }
  }

  /**
   * Browse for an Aseprite JSON file and return the relative path
   */
  private async _browseForAsepriteJson(): Promise<void> {
    if (!this._view) return;

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Aseprite JSON': ['json'], 'All Files': ['*'] },
      defaultUri: vscode.Uri.joinPath(this._extensionUri, 'assets', 'sprites'),
    });

    if (result && result[0]) {
      // Convert absolute path to relative path from extension root
      const absolutePath = result[0].fsPath;
      const extensionPath = this._extensionUri.fsPath;
      let relativePath = absolutePath.replace(extensionPath, '');
      // Normalize path separators and remove leading slash
      relativePath = relativePath.replace(/^[\/\\]/, '').replace(/\\/g, '/');

      this._view.webview.postMessage({
        type: 'selectedAsepriteJson',
        path: relativePath,
      });
    }
  }

  /**
   * Update the Aseprite config for a spritesheet
   */
  private async _updateAsepriteConfig(data: { sheetName: string; asepriteConfig: { jsonFile: string; tags?: string[] } | null }): Promise<void> {
    if (!this._view) return;

    try {
      const manifest = await this._readManifest();
      const sheets = manifest.spritesheets as Record<string, Record<string, unknown>>;

      if (!sheets[data.sheetName]) {
        vscode.window.showErrorMessage(`Spritesheet "${data.sheetName}" not found`);
        return;
      }

      if (data.asepriteConfig) {
        // Check if the JSON file exists
        const jsonUri = vscode.Uri.joinPath(this._extensionUri, data.asepriteConfig.jsonFile);
        try {
          await vscode.workspace.fs.stat(jsonUri);
        } catch {
          vscode.window.showErrorMessage(`Aseprite JSON file not found: ${data.asepriteConfig.jsonFile}`);
          return;
        }

        sheets[data.sheetName].aseprite = data.asepriteConfig;
        vscode.window.showInformationMessage(`Linked Aseprite data to "${data.sheetName}"`);
      } else {
        // Remove Aseprite config
        delete sheets[data.sheetName].aseprite;
        vscode.window.showInformationMessage(`Removed Aseprite data from "${data.sheetName}"`);
      }

      await this._writeManifest(manifest);

      // Reload assets and refresh
      const loader = getAssetLoader(this._extensionUri);
      loader.dispose();
      await loader.load();
      await this._sendAssets();
      await getGameViewPanel(this._extensionUri).refreshAssets();

    } catch (error) {
      console.error('[SpriteConfig] Failed to update Aseprite config:', error);
      vscode.window.showErrorMessage(`Failed to update Aseprite config: ${error}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; img-src data:; connect-src ${webview.cspSource};">
  <title>Sprite Configuration</title>
  <style>
    ${PIXEL_THEME_CSS}

    .sprite-config {
      padding: 8px;
      font-size: 11px;
    }

    .section-title {
      font-size: 10px;
      color: var(--pixel-accent);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 8px 0 4px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--pixel-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }

    .section-title:hover {
      background: var(--pixel-bg-light);
    }

    .section-title::before {
      content: '▼';
      font-size: 8px;
      transition: transform 0.15s;
    }

    .section-title.collapsed::before {
      transform: rotate(-90deg);
    }

    .section-content {
      overflow: hidden;
      transition: max-height 0.2s ease-out;
    }

    .section-content.collapsed {
      max-height: 0 !important;
      padding: 0 8px;
    }

    /* Temporarily visible for height measurement */
    .section-content.measuring {
      visibility: hidden;
      max-height: none !important;
      padding: 8px;
    }

    .spritesheet-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }

    .spritesheet-item {
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      padding: 6px 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .spritesheet-item:hover {
      background: var(--pixel-bg-lighter);
      border-color: var(--pixel-accent);
    }

    .spritesheet-item.selected {
      border-color: var(--pixel-accent);
      box-shadow: 0 0 0 1px var(--pixel-accent);
    }

    .spritesheet-preview {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
      object-fit: contain;
      background: var(--pixel-bg);
    }

    .spritesheet-info {
      flex: 1;
      min-width: 0;
    }

    .spritesheet-name {
      color: var(--pixel-fg);
      font-weight: bold;
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .spritesheet-count {
      color: var(--pixel-muted);
      font-size: 9px;
    }

    .spritesheet-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border-radius: 2px;
    }

    .spritesheet-badge.aseprite {
      background: #7d9f5a;  /* Aseprite green */
      color: #fff;
    }
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .spritesheet-actions {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-left: auto;
    }

    .use-character-btn {
      font-size: 8px;
      padding: 2px 6px;
      background: transparent;
      color: var(--pixel-muted);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
      white-space: nowrap;
    }

    .use-character-btn:hover {
      background: var(--pixel-bg-lighter);
      color: var(--pixel-fg);
      border-color: var(--pixel-accent);
    }

    .use-character-btn.active {
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border-color: var(--pixel-accent);
    }

    .sprite-viewer {
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      margin-top: 8px;
      position: relative;
    }

    .sprite-viewer-header {
      background: var(--pixel-bg-light);
      padding: 4px 8px;
      border-bottom: 1px solid var(--pixel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sprite-viewer-title {
      font-size: 10px;
      color: var(--pixel-accent);
    }

    .sprite-viewer-zoom {
      display: flex;
      gap: 4px;
    }

    .zoom-btn {
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      width: 20px;
      height: 20px;
      cursor: pointer;
      font-size: 10px;
    }

    .zoom-btn:hover {
      background: var(--pixel-bg-lighter);
    }

    .replace-image-btn {
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 2px 8px;
      cursor: pointer;
      font-size: 9px;
      margin-right: 8px;
    }

    .replace-image-btn:hover {
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border-color: var(--pixel-accent);
    }

    .sprite-canvas-container {
      overflow: auto;
      max-height: 200px;
    }

    #sprite-canvas {
      image-rendering: pixelated;
      cursor: crosshair;
    }

    .sprite-info-panel {
      background: var(--pixel-bg-light);
      border-top: 1px solid var(--pixel-border);
      padding: 8px;
    }

    .sprite-info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 9px;
    }

    .sprite-info-label {
      color: var(--pixel-muted);
    }

    .sprite-info-value {
      color: var(--pixel-fg);
      font-family: monospace;
    }

    .sprite-grid-overlay {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }

    .selected-sprite-preview {
      margin-top: 8px;
      padding: 8px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
    }

    /* Aseprite Config Panel */
    .aseprite-config-panel {
      padding: 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
    }

    .aseprite-status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .aseprite-status .status-label {
      font-size: 9px;
      color: var(--pixel-muted);
    }

    .aseprite-status .status-value {
      font-size: 9px;
      color: var(--pixel-fg);
    }

    .aseprite-status .status-value.linked {
      color: #7d9f5a;  /* Aseprite green */
    }

    .aseprite-json-path {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 9px;
    }

    .aseprite-json-path .path-label {
      color: var(--pixel-muted);
      flex-shrink: 0;
    }

    .aseprite-json-path .path-value {
      color: var(--pixel-fg);
      word-break: break-all;
      font-family: monospace;
    }

    .aseprite-tags {
      margin-bottom: 8px;
    }

    .aseprite-tags .tags-label {
      font-size: 9px;
      color: var(--pixel-muted);
      display: block;
      margin-bottom: 4px;
    }

    .aseprite-tags .tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .aseprite-tag {
      font-size: 8px;
      padding: 2px 6px;
      background: #7d9f5a;  /* Aseprite green */
      color: #fff;
      border-radius: 2px;
    }

    .aseprite-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }

    .aseprite-help {
      font-size: 8px;
      color: var(--pixel-muted);
      padding: 6px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      line-height: 1.4;
    }

    .selected-sprite-title {
      font-size: 10px;
      color: var(--pixel-accent);
      margin-bottom: 4px;
    }

    .selected-sprite-canvas {
      image-rendering: pixelated;
      background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px;
    }

    .sprite-list {
      max-height: 150px;
      overflow-y: auto;
      margin-top: 8px;
    }

    .sprite-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .sprite-item:hover {
      background: var(--pixel-bg-light);
    }

    .sprite-item.selected {
      border-color: var(--pixel-accent);
      background: var(--pixel-bg-light);
    }

    .sprite-thumb {
      width: 24px;
      height: 24px;
      image-rendering: pixelated;
      background: var(--pixel-bg);
    }

    .sprite-name {
      flex: 1;
      font-size: 9px;
      color: var(--pixel-fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .open-manifest-btn {
      width: 100%;
      margin-top: 8px;
      padding: 6px;
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border: none;
      cursor: pointer;
      font-size: 10px;
    }

    .open-manifest-btn:hover {
      opacity: 0.9;
    }

    .header-buttons {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .header-buttons .open-manifest-btn {
      flex: 1;
      margin-top: 0;
    }

    .add-sheet-btn {
      flex: 1;
      padding: 6px;
      background: var(--pixel-bg-light);
      color: var(--pixel-accent);
      border: 1px solid var(--pixel-accent);
      cursor: pointer;
      font-size: 10px;
    }

    .add-sheet-btn:hover {
      background: var(--pixel-accent);
      color: var(--pixel-bg);
    }

    /* Add Spritesheet Form */
    .add-sheet-form {
      margin-top: 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
      padding: 8px;
      display: none;
    }

    .add-sheet-form.visible {
      display: block;
    }

    .form-row {
      margin-bottom: 6px;
    }

    .form-row label {
      display: block;
      font-size: 9px;
      color: var(--pixel-muted);
      margin-bottom: 2px;
    }

    .form-row input[type="text"],
    .form-row input[type="number"] {
      width: 100%;
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      font-size: 10px;
      box-sizing: border-box;
    }

    .form-row input[type="text"]:focus,
    .form-row input[type="number"]:focus {
      border-color: var(--pixel-accent);
      outline: none;
    }

    .form-row-inline {
      display: flex;
      gap: 8px;
    }

    .form-row-inline .form-field {
      flex: 1;
    }

    .browse-row {
      display: flex;
      gap: 4px;
    }

    .browse-row input {
      flex: 1;
    }

    .browse-btn {
      padding: 4px 8px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      cursor: pointer;
      font-size: 9px;
    }

    .browse-btn:hover {
      border-color: var(--pixel-accent);
    }

    .form-checkbox {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: var(--pixel-fg);
    }

    .form-checkbox input {
      margin: 0;
    }

    .form-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .form-actions button {
      flex: 1;
      padding: 6px;
      font-size: 10px;
      cursor: pointer;
    }

    .btn-create {
      background: var(--pixel-success);
      color: var(--pixel-bg);
      border: none;
    }

    .btn-create:hover {
      opacity: 0.9;
    }

    .btn-cancel {
      background: var(--pixel-bg);
      color: var(--pixel-fg);
      border: 1px solid var(--pixel-border);
    }

    .btn-cancel:hover {
      border-color: var(--pixel-accent);
    }

    .char-config-section {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--pixel-border);
    }

    .char-config-section.hidden {
      display: none;
    }

    .error-msg {
      color: var(--pixel-error);
      font-size: 9px;
      margin-top: 4px;
    }

    .help-text {
      font-size: 9px;
      color: var(--pixel-muted);
      margin-top: 8px;
      line-height: 1.4;
    }

    .grid-size-input {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
    }

    .grid-size-input label {
      font-size: 9px;
      color: var(--pixel-muted);
    }

    .grid-size-input input {
      width: 40px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 2px 4px;
      font-size: 10px;
    }

    .edit-section {
      margin-top: 8px;
      padding: 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
    }

    .edit-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .edit-label {
      font-size: 9px;
      color: var(--pixel-muted);
      width: 50px;
      flex-shrink: 0;
    }

    .edit-input {
      flex: 1;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 3px 6px;
      font-size: 10px;
      font-family: monospace;
    }

    .edit-input.small {
      width: 35px;
      flex: none;
    }

    .btn-row {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .action-btn {
      flex: 1;
      padding: 5px;
      border: 1px solid var(--pixel-border);
      background: var(--pixel-bg);
      color: var(--pixel-fg);
      cursor: pointer;
      font-size: 9px;
    }

    .action-btn:hover {
      background: var(--pixel-bg-lighter);
    }

    .action-btn.primary {
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border-color: var(--pixel-accent);
    }

    .action-btn.danger {
      border-color: #ff4444;
      color: #ff4444;
    }

    .action-btn.danger:hover {
      background: #ff4444;
      color: var(--pixel-bg);
    }

    .sprite-selected-info {
      font-size: 9px;
      color: var(--pixel-fg);
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-accent);
      margin-bottom: 6px;
    }

    .mode-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 8px;
    }

    .mode-tab {
      flex: 1;
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-muted);
      cursor: pointer;
      font-size: 9px;
      text-align: center;
    }

    .mode-tab.active {
      background: var(--pixel-bg-light);
      border-color: var(--pixel-accent);
      color: var(--pixel-accent);
    }

    /* Character Preview Section */
    .character-preview {
      margin-top: 8px;
      padding: 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-accent);
    }

    .character-preview-title {
      font-size: 10px;
      color: var(--pixel-accent);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .character-preview-title::before {
      content: '👤';
    }

    .character-canvas-container {
      display: flex;
      justify-content: center;
      margin-bottom: 8px;
      background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px;
      border: 1px solid var(--pixel-border);
      padding: 8px;
    }

    #character-canvas {
      image-rendering: pixelated;
    }

    .character-controls {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .control-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .control-label {
      font-size: 9px;
      color: var(--pixel-muted);
      width: 50px;
      flex-shrink: 0;
    }

    .control-btns {
      display: flex;
      gap: 2px;
      flex: 1;
    }

    .dir-btn, .action-btn-char {
      flex: 1;
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      cursor: pointer;
      font-size: 9px;
    }

    .dir-btn:hover, .action-btn-char:hover {
      background: var(--pixel-bg-lighter);
    }

    .dir-btn.active, .action-btn-char.active {
      border-color: var(--pixel-accent);
      background: var(--pixel-bg-light);
      color: var(--pixel-accent);
    }

    .animation-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .toggle-switch {
      position: relative;
      width: 32px;
      height: 16px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
    }

    .toggle-switch.active {
      background: var(--pixel-accent);
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      background: var(--pixel-fg);
      top: 1px;
      left: 1px;
      transition: left 0.15s;
    }

    .toggle-switch.active::after {
      left: 17px;
    }

    .toggle-label {
      font-size: 9px;
      color: var(--pixel-fg);
    }

    .character-sprite-name {
      font-size: 9px;
      color: var(--pixel-muted);
      text-align: center;
      margin-top: 4px;
      font-family: monospace;
    }

    /* Action Editor Section */
    .action-editor-section {
      margin-top: 8px;
      padding: 8px;
      background: var(--pixel-bg-light);
      border: 1px solid var(--pixel-border);
    }

    .actions-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 8px;
      max-height: 200px;
      overflow-y: auto;
    }

    .action-item {
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      padding: 6px;
    }

    .action-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .action-name-display {
      font-weight: bold;
      color: var(--pixel-accent);
      font-size: 10px;
    }

    .btn-icon {
      background: transparent;
      border: none;
      color: var(--pixel-error, #f44);
      cursor: pointer;
      font-size: 10px;
      padding: 2px 4px;
    }

    .btn-icon:hover {
      color: var(--pixel-fg);
    }

    .action-config-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }

    .config-label {
      font-size: 9px;
      color: var(--pixel-muted);
      min-width: 40px;
    }

    .skill-select {
      flex: 1;
      font-size: 9px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      color: var(--pixel-fg);
      padding: 2px 4px;
    }

    .custom-skill-input {
      flex: 1;
      min-width: 0;
    }

    .add-action-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .add-action-row .edit-input {
      flex: 1;
    }

    .btn-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .action-btn.primary {
      background: var(--pixel-accent);
      color: var(--pixel-bg);
      border-color: var(--pixel-accent);
    }

    .action-btn.primary:hover {
      opacity: 0.9;
    }

    /* Lighting Section */
    .lighting-section {
      padding: 8px;
    }

    .lighting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .lighting-label {
      font-size: 9px;
      color: var(--pixel-fg);
    }

    .lighting-slider-row {
      margin-bottom: 8px;
    }

    .lighting-slider-label {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--pixel-fg);
      margin-bottom: 2px;
    }

    .lighting-slider-value {
      color: var(--pixel-accent);
      font-family: monospace;
    }

    input[type="range"] {
      width: 100%;
      height: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
      border-radius: 0;
      outline: none;
      -webkit-appearance: none;
      cursor: pointer;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--pixel-accent);
      border: 1px solid var(--pixel-border);
      cursor: pointer;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      background: var(--pixel-fg);
    }

    .color-picker-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .color-picker-row input[type="color"] {
      width: 32px;
      height: 20px;
      border: 1px solid var(--pixel-border);
      background: var(--pixel-bg);
      cursor: pointer;
      padding: 0;
    }

    .color-hex {
      font-size: 9px;
      font-family: monospace;
      color: var(--pixel-muted);
    }

    .lighting-help {
      font-size: 8px;
      color: var(--pixel-muted);
      margin-top: 8px;
      padding: 4px;
      background: var(--pixel-bg);
      border: 1px solid var(--pixel-border);
    }
  </style>
</head>
<body>
  <div class="sprite-config">
    <div class="section-title" data-section="spritesheets">Spritesheets</div>
    <div class="section-content" data-section="spritesheets">
      <div class="spritesheet-list" id="spritesheet-list">
        <div style="color: var(--pixel-muted); font-size: 9px;">Loading...</div>
      </div>
    </div>

    <div class="section-title" data-section="lighting">Lighting</div>
    <div class="section-content" data-section="lighting">
      <div class="lighting-section">
        <div class="lighting-row">
          <span class="lighting-label">Enable Lighting</span>
          <div class="toggle-switch active" id="lighting-enabled"></div>
        </div>

        <div class="lighting-row">
          <span class="lighting-label">Day/Night Cycle</span>
          <div class="toggle-switch active" id="lighting-daynight"></div>
        </div>

        <div class="lighting-row">
          <span class="lighting-label">Agent Torch</span>
          <div class="toggle-switch active" id="lighting-agent-torch"></div>
        </div>

        <div class="lighting-slider-row">
          <div class="lighting-slider-label">
            <span>Torch Radius</span>
            <span class="lighting-slider-value" id="torch-radius-value">80</span>
          </div>
          <input type="range" id="torch-radius" min="20" max="200" value="80">
        </div>

        <div class="lighting-slider-row">
          <div class="lighting-slider-label">
            <span>Torch Intensity</span>
            <span class="lighting-slider-value" id="torch-intensity-value">0.8</span>
          </div>
          <input type="range" id="torch-intensity" min="0" max="100" value="80">
        </div>

        <div class="color-picker-row">
          <span class="lighting-label">Torch Color</span>
          <input type="color" id="torch-color" value="#ffaa44">
          <span class="color-hex" id="torch-color-hex">#ffaa44</span>
        </div>

        <div class="lighting-help">
          Normal maps require spritesheets with _n.png suffix (e.g., tiles_n.png). Without normal maps, only point light falloff is visible.
        </div>
      </div>
    </div>

    <div class="section-title" data-section="sprite-viewer">Sprite Viewer</div>
    <div class="section-content" data-section="sprite-viewer">
      <div class="sprite-viewer">
      <div class="sprite-viewer-header">
        <span class="sprite-viewer-title" id="viewer-title">Select a spritesheet</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="replace-image-btn" id="replace-image" style="display: none;">Replace Image</button>
          <div class="sprite-viewer-zoom">
            <button class="zoom-btn" id="zoom-out">-</button>
            <button class="zoom-btn" id="zoom-in">+</button>
          </div>
        </div>
      </div>
      <div class="grid-size-input">
        <label>Grid:</label>
        <input type="number" id="grid-width" value="16" min="1" max="64">
        <span style="color: var(--pixel-muted)">×</span>
        <input type="number" id="grid-height" value="16" min="1" max="64">
      </div>
      <div class="sprite-canvas-container" id="canvas-container">
        <canvas id="sprite-canvas"></canvas>
      </div>
      <div class="sprite-info-panel">
        <div class="sprite-info-row">
          <span class="sprite-info-label">Position:</span>
          <span class="sprite-info-value" id="info-pos">-</span>
        </div>
        <div class="sprite-info-row">
          <span class="sprite-info-label">Grid:</span>
          <span class="sprite-info-value" id="info-grid">-</span>
        </div>
        <div class="sprite-info-row">
          <span class="sprite-info-label">Size:</span>
          <span class="sprite-info-value" id="info-size">-</span>
        </div>
      </div>
    </div>
    </div>

    <div class="section-title" data-section="selected-sprite">Selected Sprite</div>
    <div class="section-content" data-section="selected-sprite">
      <div class="selected-sprite-preview">
        <div class="selected-sprite-title" id="selected-title">None</div>
        <canvas id="selected-canvas" class="selected-sprite-canvas" width="64" height="64"></canvas>
      </div>
    </div>

    <!-- Aseprite Config Section -->
    <div id="aseprite-section" style="display: none;">
      <div class="section-title" data-section="aseprite-config">Aseprite Animation</div>
      <div class="section-content" data-section="aseprite-config">
        <div class="aseprite-config-panel">
          <div class="aseprite-status" id="aseprite-status">
            <span class="status-label">Status:</span>
            <span class="status-value" id="aseprite-status-value">Not configured</span>
          </div>
          <div class="aseprite-json-path" id="aseprite-json-path" style="display: none;">
            <span class="path-label">JSON:</span>
            <span class="path-value" id="aseprite-json-value">-</span>
          </div>
          <div class="aseprite-tags" id="aseprite-tags-section" style="display: none;">
            <span class="tags-label">Tags:</span>
            <div class="tags-list" id="aseprite-tags-list">-</div>
          </div>
          <div class="aseprite-actions">
            <button class="action-btn" id="browse-aseprite">Link JSON File</button>
            <button class="action-btn danger" id="unlink-aseprite" style="display: none;">Unlink</button>
          </div>
          <div class="aseprite-help">
            Link an Aseprite-exported JSON file to automatically create animations from tags. Export from Aseprite: File → Export Sprite Sheet → JSON Data (with Tags checked)
          </div>
        </div>
      </div>
    </div>

    <!-- Character Preview Section (shown for character spritesheets) -->
    <div id="character-section" style="display: none;">
      <div class="section-title" data-section="character-preview">Character Preview</div>
      <div class="section-content" data-section="character-preview">
        <div class="character-preview">
          <div class="character-preview-title">Live Preview</div>
          <div class="character-canvas-container">
            <canvas id="character-canvas" width="96" height="96"></canvas>
          </div>
          <div class="character-controls">
            <div class="control-row">
              <span class="control-label">Direction:</span>
              <div class="control-btns">
                <button class="dir-btn" data-dir="left">←</button>
                <button class="dir-btn" data-dir="up">↑</button>
                <button class="dir-btn active" data-dir="down">↓</button>
                <button class="dir-btn" data-dir="right">→</button>
              </div>
            </div>
            <div class="control-row">
              <span class="control-label">Action:</span>
              <div class="control-btns" id="action-btns">
                <!-- Dynamically populated based on characterConfig -->
              </div>
            </div>
            <div class="control-row">
              <span class="control-label">Frame:</span>
              <div class="control-btns" id="frame-btns">
                <!-- Dynamically populated based on framesPerAction -->
              </div>
            </div>
            <div class="animation-toggle">
              <div class="toggle-switch" id="animation-toggle"></div>
              <span class="toggle-label">Animate frames</span>
            </div>
          </div>
          <div class="character-sprite-name" id="character-sprite-name">-</div>
        </div>
      </div>
    </div>

    <!-- Action Editor Section (shown for character spritesheets) -->
    <div id="action-editor-section" style="display: none;">
      <div class="section-title" data-section="action-editor">Action Editor</div>
      <div class="section-content" data-section="action-editor">
        <div class="action-editor-section">
          <div class="actions-list" id="actions-list">
            <!-- Dynamically populated -->
          </div>
          <div class="add-action-row">
            <input type="text" class="edit-input" id="new-action-name" placeholder="New action name">
            <button class="action-btn" id="btn-add-action">+ Add</button>
          </div>
          <div class="btn-row">
            <button class="action-btn primary" id="btn-save-actions">Save to Manifest</button>
            <button class="action-btn" id="btn-reset-actions">Reset</button>
          </div>
        </div>
      </div>
    </div>

    <div class="section-title" data-section="edit-sprite">Edit Sprite</div>
    <div class="section-content" data-section="edit-sprite">
      <div class="edit-section">
        <div class="mode-tabs">
          <button class="mode-tab active" id="tab-update">Update</button>
          <button class="mode-tab" id="tab-add">Add New</button>
        </div>

        <div id="edit-panel-update">
          <div class="sprite-selected-info" id="editing-sprite-name">Select a sprite from the list below</div>
          <div class="edit-row">
            <span class="edit-label">X:</span>
            <input type="number" class="edit-input small" id="edit-x" value="0">
            <span class="edit-label">Y:</span>
            <input type="number" class="edit-input small" id="edit-y" value="0">
          </div>
          <div class="edit-row">
            <span class="edit-label">Width:</span>
            <input type="number" class="edit-input small" id="edit-w" value="16">
            <span class="edit-label">Height:</span>
            <input type="number" class="edit-input small" id="edit-h" value="16">
          </div>
          <div class="btn-row">
            <button class="action-btn primary" id="btn-update">Update Sprite</button>
            <button class="action-btn danger" id="btn-delete">Delete</button>
          </div>
        </div>

        <div id="edit-panel-add" style="display: none;">
          <div class="edit-row">
            <span class="edit-label">Name:</span>
            <input type="text" class="edit-input" id="add-name" placeholder="sprite-name">
          </div>
          <div class="edit-row">
            <span class="edit-label">X:</span>
            <input type="number" class="edit-input small" id="add-x" value="0">
            <span class="edit-label">Y:</span>
            <input type="number" class="edit-input small" id="add-y" value="0">
          </div>
          <div class="edit-row">
            <span class="edit-label">Width:</span>
            <input type="number" class="edit-input small" id="add-w" value="16">
            <span class="edit-label">Height:</span>
            <input type="number" class="edit-input small" id="add-h" value="16">
          </div>
          <div class="btn-row">
            <button class="action-btn primary" id="btn-add">Add Sprite</button>
          </div>
          <div class="help-text" style="margin-top: 4px;">
            Click on the spritesheet viewer above to set coordinates.
          </div>
        </div>
      </div>
    </div>

    <div class="section-title" data-section="sprites-in-sheet">Sprites in Sheet</div>
    <div class="section-content" data-section="sprites-in-sheet">
      <div class="sprite-list" id="sprite-list"></div>
    </div>

    <div class="header-buttons">
      <button class="add-sheet-btn" id="add-sheet-toggle">+ Add Spritesheet</button>
      <button class="open-manifest-btn" id="open-manifest">Edit JSON</button>
    </div>

    <div class="add-sheet-form" id="add-sheet-form">
      <div class="form-row">
        <label>Name (unique identifier)</label>
        <input type="text" id="new-sheet-name" placeholder="e.g., my-sprites">
      </div>
      <div class="form-row">
        <label>Image Path (relative to extension)</label>
        <div class="browse-row">
          <input type="text" id="new-sheet-path" placeholder="assets/sprites/my-sheet.png">
          <button class="browse-btn" id="browse-image">Browse</button>
        </div>
      </div>
      <div class="form-row form-row-inline">
        <div class="form-field">
          <label>Frame Width</label>
          <input type="number" id="new-sheet-frame-w" value="16" min="1">
        </div>
        <div class="form-field">
          <label>Frame Height</label>
          <input type="number" id="new-sheet-frame-h" value="16" min="1">
        </div>
      </div>
      <div class="form-row">
        <label class="form-checkbox">
          <input type="checkbox" id="new-sheet-auto-gen" checked>
          Auto-generate sprites from grid
        </label>
      </div>
      <div class="form-row">
        <label class="form-checkbox">
          <input type="checkbox" id="new-sheet-is-char">
          Is Character Spritesheet
        </label>
      </div>
      <div class="char-config-section hidden" id="char-config-section">
        <div class="form-row">
          <label>Directions (comma-separated)</label>
          <input type="text" id="new-sheet-directions" value="down,up,left,right">
        </div>
        <div class="form-row">
          <label>Actions (name:frames, e.g., walk:6,idle:4)</label>
          <input type="text" id="new-sheet-actions" value="idle:4,walk:6">
        </div>
      </div>
      <div class="error-msg" id="add-sheet-error"></div>
      <div class="form-actions">
        <button class="btn-create" id="create-sheet">Create</button>
        <button class="btn-cancel" id="cancel-sheet">Cancel</button>
      </div>
    </div>

    <div class="help-text">
      Click on the spritesheet viewer to select a sprite region.
      The grid overlay helps identify sprite boundaries.
      Adjust grid size to match your sprites.
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // State
    let spritesheets = {};
    let currentSheet = null;
    let spriteMappings = {};  // purpose -> sheetName
    let zoom = 2;
    let gridW = 16;
    let gridH = 16;
    let selectedSprite = null;

    // Character preview state
    let charDirection = 'down';
    let charAction = 'walk';
    let charFrame = 0;
    let charAnimating = false;
    let charAnimationTimer = null;
    let charActions = ['walk']; // Default, updated from characterConfig
    let charFramesPerAction = 4; // Default, updated from characterConfig

    // Action editor state
    let editingActions = [];
    let isEditingActions = false;

    // DOM
    const sheetList = document.getElementById('spritesheet-list');
    const canvas = document.getElementById('sprite-canvas');
    const ctx = canvas.getContext('2d');
    const canvasContainer = document.getElementById('canvas-container');
    const viewerTitle = document.getElementById('viewer-title');
    const infoPos = document.getElementById('info-pos');
    const infoGrid = document.getElementById('info-grid');
    const infoSize = document.getElementById('info-size');
    const selectedCanvas = document.getElementById('selected-canvas');
    const selectedCtx = selectedCanvas.getContext('2d');
    const selectedTitle = document.getElementById('selected-title');
    const spriteList = document.getElementById('sprite-list');
    const gridWInput = document.getElementById('grid-width');
    const gridHInput = document.getElementById('grid-height');

    // Character preview DOM
    const characterSection = document.getElementById('character-section');
    const characterCanvas = document.getElementById('character-canvas');
    const characterCtx = characterCanvas.getContext('2d');
    const characterSpriteName = document.getElementById('character-sprite-name');
    const animationToggle = document.getElementById('animation-toggle');

    ctx.imageSmoothingEnabled = false;
    selectedCtx.imageSmoothingEnabled = false;
    characterCtx.imageSmoothingEnabled = false;

    // ─── Collapsible Sections ──────────────────────────────────────────────

    // Track collapsed state for each section
    const collapsedSections = new Set();

    // Helper to measure actual content height
    function measureContentHeight(content) {
      // Temporarily make visible to get accurate scrollHeight
      content.classList.add('measuring');
      const height = content.scrollHeight;
      content.classList.remove('measuring');
      return height;
    }

    // Helper to update maxHeight for a section (call after content changes)
    function updateSectionHeight(sectionName) {
      const content = document.querySelector(\`.section-content[data-section="\${sectionName}"]\`);
      if (content && !collapsedSections.has(sectionName)) {
        content.style.maxHeight = measureContentHeight(content) + 'px';
      }
    }

    // Add click handlers to all section titles
    document.querySelectorAll('.section-title[data-section]').forEach(title => {
      title.addEventListener('click', () => {
        const sectionName = title.dataset.section;
        const content = document.querySelector(\`.section-content[data-section="\${sectionName}"]\`);
        if (!content) return;

        const isCollapsed = collapsedSections.has(sectionName);

        if (isCollapsed) {
          // Expand - measure first, then animate
          const height = measureContentHeight(content);
          title.classList.remove('collapsed');
          content.classList.remove('collapsed');
          content.style.maxHeight = height + 'px';
          collapsedSections.delete(sectionName);
        } else {
          // Collapse - set height first for smooth transition, then collapse
          content.style.maxHeight = content.scrollHeight + 'px';
          // Force reflow to apply the current height
          content.offsetHeight;
          title.classList.add('collapsed');
          content.classList.add('collapsed');
          content.style.maxHeight = '0';
          collapsedSections.add(sectionName);
        }
      });

      // Set initial max-height for animation
      const sectionName = title.dataset.section;
      const content = document.querySelector(\`.section-content[data-section="\${sectionName}"]\`);
      if (content) {
        content.style.maxHeight = measureContentHeight(content) + 'px';
      }
    });

    // ─── Spritesheet List ──────────────────────────────────────────────

    // Purpose options for sprite assignment
    const PURPOSES = [
      { value: '', label: '-- None --' },
      { value: 'character', label: 'Player Character' },
      { value: 'chicken', label: 'Chicken NPC' },
      { value: 'cow', label: 'Cow NPC' },
      { value: 'grass', label: 'Grass Tiles' },
      { value: 'tilled-dirt', label: 'Tilled Dirt' },
      { value: 'fences', label: 'Fences' },
      { value: 'water', label: 'Water' },
      { value: 'plants', label: 'Plants/Crops' },
      { value: 'biome', label: 'Biome Decorations' },
      { value: 'paths', label: 'Paths' },
      { value: 'custom', label: 'Custom...' }
    ];

    // Get what purpose this sheet is assigned to
    function getSheetPurpose(sheetName) {
      for (const [purpose, mapped] of Object.entries(spriteMappings)) {
        if (mapped === sheetName) return purpose;
      }
      return '';
    }

    function renderSpritesheetList() {
      sheetList.innerHTML = '';

      for (const [name, sheet] of Object.entries(spritesheets)) {
        const item = document.createElement('div');
        item.className = 'spritesheet-item' + (currentSheet === name ? ' selected' : '');
        item.onclick = (e) => {
          // Don't select if clicking the purpose dropdown
          if (e.target.classList.contains('purpose-select')) return;
          selectSpritesheet(name);
        };

        const img = document.createElement('img');
        img.className = 'spritesheet-preview';
        img.src = sheet.imageUrl;

        const info = document.createElement('div');
        info.className = 'spritesheet-info';

        const assignedPurpose = getSheetPurpose(name);
        const isCharacter = sheet.isCharacter === true;

        let nameHtml = \`<div class="spritesheet-name">\${name}\`;
        if (assignedPurpose) {
          const purposeLabel = PURPOSES.find(p => p.value === assignedPurpose)?.label || assignedPurpose;
          nameHtml += \` <span class="spritesheet-badge">\${purposeLabel}</span>\`;
        }
        // Add Aseprite badge if this sheet has Aseprite data
        if (sheet.asepriteData) {
          nameHtml += \` <span class="spritesheet-badge aseprite">Aseprite</span>\`;
        }
        nameHtml += \`</div>\`;

        // Build info HTML with Aseprite tag count
        let infoHtml = nameHtml;
        const spriteCount = Object.keys(sheet.sprites).length;
        infoHtml += \`<div class="spritesheet-count">\${spriteCount} sprites\`;

        // Show Aseprite tag info
        if (sheet.asepriteData && sheet.asepriteData.meta && sheet.asepriteData.meta.frameTags) {
          const tagCount = sheet.asepriteData.meta.frameTags.length;
          infoHtml += \` · \${tagCount} animation tags\`;
        }
        infoHtml += \`</div>\`;

        info.innerHTML = infoHtml;

        item.appendChild(img);
        item.appendChild(info);

        // Add purpose dropdown for all sheets
        const actions = document.createElement('div');
        actions.className = 'spritesheet-actions';

        const purposeSelect = document.createElement('select');
        purposeSelect.className = 'purpose-select';
        purposeSelect.innerHTML = PURPOSES.map(p =>
          \`<option value="\${p.value}" \${assignedPurpose === p.value ? 'selected' : ''}>\${p.label}</option>\`
        ).join('');

        purposeSelect.onchange = (e) => {
          e.stopPropagation();
          const newPurpose = e.target.value;
          updateSpriteMapping(name, newPurpose);
        };

        actions.appendChild(purposeSelect);
        item.appendChild(actions);

        sheetList.appendChild(item);
      }

      // Update section height after content changes
      updateSectionHeight('spritesheets');
    }

    function updateSpriteMapping(sheetName, purpose) {
      vscode.postMessage({ type: 'updateSpriteMapping', data: { purpose, sheetName } });
    }

    function selectSpritesheet(name) {
      currentSheet = name;
      renderSpritesheetList();
      renderSpriteViewer();
      renderSpriteList();
      viewerTitle.textContent = name;

      // Show/hide replace image button
      const replaceBtn = document.getElementById('replace-image');
      if (replaceBtn) {
        replaceBtn.style.display = name ? 'block' : 'none';
      }

      // Clear worldmap highlight when switching sheets
      vscode.postMessage({ type: 'highlightSprite', data: { spriteId: null } });

      // Show/hide character preview section
      updateCharacterSection();

      // Show/hide Aseprite config section
      updateAsepriteSection();
    }

    // ─── Aseprite Config Section ───────────────────────────────────────────

    function updateAsepriteSection() {
      const asepriteSection = document.getElementById('aseprite-section');
      if (!asepriteSection || !currentSheet) {
        if (asepriteSection) asepriteSection.style.display = 'none';
        return;
      }

      const sheet = spritesheets[currentSheet];
      if (!sheet) {
        asepriteSection.style.display = 'none';
        return;
      }

      // Show the section for all sheets
      asepriteSection.style.display = 'block';

      const statusValue = document.getElementById('aseprite-status-value');
      const jsonPathSection = document.getElementById('aseprite-json-path');
      const jsonValue = document.getElementById('aseprite-json-value');
      const tagsSection = document.getElementById('aseprite-tags-section');
      const tagsList = document.getElementById('aseprite-tags-list');
      const unlinkBtn = document.getElementById('unlink-aseprite');

      if (sheet.asepriteData) {
        // Aseprite is configured
        if (statusValue) {
          statusValue.textContent = 'Linked';
          statusValue.classList.add('linked');
        }
        if (jsonPathSection) jsonPathSection.style.display = 'flex';
        if (jsonValue) jsonValue.textContent = sheet.aseprite?.jsonFile || 'Unknown';

        // Show tags from Aseprite data
        if (tagsSection && sheet.asepriteData.meta?.frameTags) {
          tagsSection.style.display = 'block';
          const tags = sheet.asepriteData.meta.frameTags;
          if (tagsList) {
            tagsList.innerHTML = tags.map(tag =>
              \`<span class="aseprite-tag" title="Frames \${tag.from}-\${tag.to}">\${tag.name}</span>\`
            ).join('');
          }
        } else if (tagsSection) {
          tagsSection.style.display = 'none';
        }

        if (unlinkBtn) unlinkBtn.style.display = 'inline-block';
      } else {
        // Aseprite not configured
        if (statusValue) {
          statusValue.textContent = 'Not configured';
          statusValue.classList.remove('linked');
        }
        if (jsonPathSection) jsonPathSection.style.display = 'none';
        if (tagsSection) tagsSection.style.display = 'none';
        if (unlinkBtn) unlinkBtn.style.display = 'none';
      }
    }

    // ─── Character Preview ───────────────────────────────────────────────

    function isCharacterSheet(sheetName) {
      const sheet = spritesheets[sheetName];
      return sheet && sheet.isCharacter === true;
    }

    function updateCharacterSection() {
      const actionEditorSection = document.getElementById('action-editor-section');

      if (isCharacterSheet(currentSheet)) {
        const sheet = spritesheets[currentSheet];
        const config = sheet.characterConfig || {};

        // Handle both old (string[]) and new (ActionConfig[]) format
        const rawActions = config.actions || ['walk'];
        const isNewFormat = rawActions.length > 0 && typeof rawActions[0] === 'object';

        // Extract action names for preview
        charActions = isNewFormat
          ? rawActions.map(a => a.name)
          : rawActions;
        charFramesPerAction = config.framesPerAction || 4;
        charAction = charActions[0] || 'walk';
        charFrame = 0;

        // Initialize action editor state
        if (isNewFormat) {
          editingActions = JSON.parse(JSON.stringify(rawActions));
        } else {
          // Migrate to new format for editing
          editingActions = rawActions.map(name => ({
            name,
            frames: charFramesPerAction,
            skill: undefined,
            customSkillName: undefined
          }));
        }
        isEditingActions = false;

        // Populate action buttons
        const actionBtns = document.getElementById('action-btns');
        actionBtns.innerHTML = '';
        charActions.forEach((action, i) => {
          const btn = document.createElement('button');
          btn.className = 'action-btn-char' + (i === 0 ? ' active' : '');
          btn.dataset.action = action;
          btn.textContent = action.charAt(0).toUpperCase() + action.slice(1);
          btn.onclick = () => {
            stopCharacterAnimation();
            document.querySelectorAll('.action-btn-char').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            charAction = action;
            charFrame = 0;
            updateFrameButtons();
            renderCharacterPreview();
          };
          actionBtns.appendChild(btn);
        });

        // Populate frame buttons
        updateFrameButtons();

        characterSection.style.display = 'block';
        actionEditorSection.style.display = 'block';
        renderActionsEditor();
        renderCharacterPreview();
      } else {
        characterSection.style.display = 'none';
        actionEditorSection.style.display = 'none';
        stopCharacterAnimation();
      }
    }

    // ─── Aseprite Config Section ───────────────────────────────────────────

    function updateAsepriteSection() {
      const asepriteSection = document.getElementById('aseprite-section');
      const asepriteStatusValue = document.getElementById('aseprite-status-value');
      const asepriteJsonPath = document.getElementById('aseprite-json-path');
      const asepriteJsonValue = document.getElementById('aseprite-json-value');
      const asepriteTagsSection = document.getElementById('aseprite-tags-section');
      const asepriteTagsList = document.getElementById('aseprite-tags-list');
      const unlinkBtn = document.getElementById('unlink-aseprite');
      const linkBtn = document.getElementById('browse-aseprite');

      if (!currentSheet) {
        asepriteSection.style.display = 'none';
        return;
      }

      const sheet = spritesheets[currentSheet];
      asepriteSection.style.display = 'block';

      if (sheet.asepriteData) {
        // Aseprite is linked
        asepriteStatusValue.textContent = 'Linked';
        asepriteStatusValue.classList.add('linked');

        // Show JSON path
        asepriteJsonPath.style.display = 'flex';
        asepriteJsonValue.textContent = sheet.asepriteData.meta?.image || 'Unknown';

        // Show tags
        asepriteTagsSection.style.display = 'block';
        const tags = sheet.asepriteData.meta?.frameTags || [];
        asepriteTagsList.innerHTML = tags.map(tag =>
          \`<span class="aseprite-tag" title="\${tag.direction}">\${tag.name}</span>\`
        ).join('');

        // Show unlink button, update link button text
        unlinkBtn.style.display = 'inline-block';
        linkBtn.textContent = 'Change JSON File';
      } else {
        // No Aseprite linked
        asepriteStatusValue.textContent = 'Not configured';
        asepriteStatusValue.classList.remove('linked');

        // Hide JSON path
        asepriteJsonPath.style.display = 'none';

        // Hide tags
        asepriteTagsSection.style.display = 'none';

        // Hide unlink button, update link button text
        unlinkBtn.style.display = 'none';
        linkBtn.textContent = 'Link JSON File';
      }
    }

    // Browse Aseprite JSON button
    document.getElementById('browse-aseprite').onclick = () => {
      vscode.postMessage({ type: 'browseAsepriteJson' });
    };

    // Unlink Aseprite button
    document.getElementById('unlink-aseprite').onclick = () => {
      if (confirm('Unlink Aseprite JSON? Animations will revert to manual configuration.')) {
        vscode.postMessage({
          type: 'updateAsepriteConfig',
          data: { sheetName: currentSheet, asepriteConfig: null }
        });
      }
    };

    // Handle selected Aseprite JSON path from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'selectedAsepriteJsonPath' || message.type === 'selectedAsepriteJson') {
        // Update the Aseprite config for current sheet
        vscode.postMessage({
          type: 'updateAsepriteConfig',
          data: {
            sheetName: currentSheet,
            asepriteConfig: { jsonFile: message.path }
          }
        });
      }
    });

    function updateFrameButtons() {
      const frameBtns = document.getElementById('frame-btns');
      frameBtns.innerHTML = '';

      // Get frame count for current action from editingActions
      const currentActionConfig = editingActions.find(a => a.name === charAction);
      const frameCount = currentActionConfig?.frames || charFramesPerAction || 6;

      for (let i = 0; i < frameCount; i++) {
        const btn = document.createElement('button');
        btn.className = 'action-btn-char' + (i === charFrame ? ' active' : '');
        btn.dataset.frame = i;
        btn.textContent = i;
        btn.onclick = () => {
          stopCharacterAnimation();
          document.querySelectorAll('#frame-btns .action-btn-char').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          charFrame = i;
          renderCharacterPreview();
        };
        frameBtns.appendChild(btn);
      }
    }

    // ─── Action Editor ───────────────────────────────────────────────────

    const SKILL_OPTIONS = [
      { value: '', label: '-- None --' },
      { value: 'read', label: 'Read' },
      { value: 'write', label: 'Write' },
      { value: 'edit', label: 'Edit' },
      { value: 'bash', label: 'Bash' },
      { value: 'grep', label: 'Grep' },
      { value: 'glob', label: 'Glob' },
      { value: 'search', label: 'Search' },
      { value: 'webSearch', label: 'Web Search' },
      { value: 'webFetch', label: 'Web Fetch' },
      { value: 'agent', label: 'Agent' },
      { value: 'custom', label: 'Custom...' }
    ];

    function renderActionsEditor() {
      const listEl = document.getElementById('actions-list');
      listEl.innerHTML = '';

      editingActions.forEach((action, index) => {
        const item = createActionItem(action, index);
        listEl.appendChild(item);
      });

      // Update section height after content changes
      updateSectionHeight('action-editor');
    }

    function createActionItem(action, index) {
      const div = document.createElement('div');
      div.className = 'action-item';
      div.dataset.actionIndex = index;

      const skillOptionsHtml = SKILL_OPTIONS.map(opt =>
        \`<option value="\${opt.value}" \${action.skill === opt.value ? 'selected' : ''}>\${opt.label}</option>\`
      ).join('');

      div.innerHTML = \`
        <div class="action-header">
          <span class="action-name-display">\${action.name}</span>
          <button class="btn-icon delete-action" title="Remove">X</button>
        </div>
        <div class="action-config-row">
          <label class="config-label">Frames:</label>
          <input type="number" class="edit-input small frames-input"
                 value="\${action.frames}" min="1" max="12" style="width: 50px;">
        </div>
        <div class="action-config-row">
          <label class="config-label">Skill:</label>
          <select class="skill-select">\${skillOptionsHtml}</select>
          <input type="text" class="edit-input custom-skill-input"
                 value="\${action.customSkillName || ''}"
                 placeholder="Custom name"
                 style="display: \${action.skill === 'custom' ? 'block' : 'none'}; max-width: 80px;">
        </div>
      \`;

      // Delete button handler
      div.querySelector('.delete-action').onclick = () => {
        editingActions.splice(index, 1);
        isEditingActions = true;
        renderActionsEditor();
      };

      // Frames input handler
      div.querySelector('.frames-input').onchange = (e) => {
        editingActions[index].frames = parseInt(e.target.value) || 6;
        isEditingActions = true;
        // Update frame buttons if this is the current action
        if (action.name === charAction) {
          updateFrameButtons();
        }
      };

      // Skill select handler
      div.querySelector('.skill-select').onchange = (e) => {
        editingActions[index].skill = e.target.value || undefined;
        const customInput = div.querySelector('.custom-skill-input');
        customInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
        isEditingActions = true;
      };

      // Custom skill input handler
      div.querySelector('.custom-skill-input').onchange = (e) => {
        editingActions[index].customSkillName = e.target.value;
        isEditingActions = true;
      };

      return div;
    }

    // Add action button
    document.getElementById('btn-add-action').onclick = () => {
      const nameInput = document.getElementById('new-action-name');
      const name = nameInput.value.trim();

      if (!name) {
        nameInput.style.borderColor = 'var(--pixel-error, #f44)';
        setTimeout(() => nameInput.style.borderColor = '', 500);
        return;
      }

      if (editingActions.some(a => a.name === name)) {
        nameInput.style.borderColor = 'var(--pixel-error, #f44)';
        setTimeout(() => nameInput.style.borderColor = '', 500);
        return;
      }

      editingActions.push({
        name,
        frames: 6,
        skill: undefined,
        customSkillName: undefined
      });

      nameInput.value = '';
      isEditingActions = true;
      renderActionsEditor();
    };

    // Save button
    document.getElementById('btn-save-actions').onclick = () => {
      const sheet = spritesheets[currentSheet];
      const config = sheet.characterConfig || {};

      const newConfig = {
        directions: config.directions || ['down', 'up', 'left', 'right'],
        actions: editingActions
      };

      vscode.postMessage({
        type: 'updateCharacterConfig',
        data: {
          sheetName: currentSheet,
          characterConfig: newConfig
        }
      });

      isEditingActions = false;
    };

    // Reset button
    document.getElementById('btn-reset-actions').onclick = () => {
      const sheet = spritesheets[currentSheet];
      const config = sheet.characterConfig || {};
      const rawActions = config.actions || ['walk'];
      const isNewFormat = rawActions.length > 0 && typeof rawActions[0] === 'object';

      if (isNewFormat) {
        editingActions = JSON.parse(JSON.stringify(rawActions));
      } else {
        editingActions = rawActions.map(name => ({
          name,
          frames: config.framesPerAction || 6,
          skill: undefined,
          customSkillName: undefined
        }));
      }
      isEditingActions = false;
      renderActionsEditor();
    };

    function renderCharacterPreview() {
      if (!currentSheet || !isCharacterSheet(currentSheet)) return;

      const sheet = spritesheets[currentSheet];
      const spriteName = 'char-' + charAction + '-' + charDirection + '-' + charFrame;
      const sprite = sheet.sprites[spriteName];

      if (!sprite) {
        characterSpriteName.textContent = 'Sprite not found: ' + spriteName;
        return;
      }

      characterSpriteName.textContent = spriteName;

      const img = new Image();
      img.src = sheet.imageUrl;

      img.onload = () => {
        characterCtx.clearRect(0, 0, 96, 96);
        // Draw scaled up (48x48 -> 96x96)
        characterCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 96, 96);
      };

      if (img.complete) {
        characterCtx.clearRect(0, 0, 96, 96);
        characterCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 96, 96);
      }
    }

    function startCharacterAnimation() {
      if (charAnimationTimer) return;
      charAnimating = true;
      animationToggle.classList.add('active');

      charAnimationTimer = setInterval(() => {
        // Get frame count for current action
        const currentActionConfig = editingActions.find(a => a.name === charAction);
        const frameCount = currentActionConfig?.frames || charFramesPerAction || 6;

        charFrame = (charFrame + 1) % frameCount;

        // Update frame button UI
        document.querySelectorAll('#frame-btns .action-btn-char').forEach(btn => {
          btn.classList.toggle('active', parseInt(btn.dataset.frame) === charFrame);
        });

        renderCharacterPreview();
      }, 150); // Frame change every 150ms (approx 6-7 fps for walk)
    }

    function stopCharacterAnimation() {
      charAnimating = false;
      animationToggle.classList.remove('active');
      if (charAnimationTimer) {
        clearInterval(charAnimationTimer);
        charAnimationTimer = null;
      }
    }

    // Direction button handlers
    document.querySelectorAll('.dir-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        charDirection = btn.dataset.dir;
        renderCharacterPreview();
      };
    });

    // Animation toggle handler
    animationToggle.onclick = () => {
      if (charAnimating) {
        stopCharacterAnimation();
      } else {
        startCharacterAnimation();
      }
    };

    // ─── Sprite Viewer ──────────────────────────────────────────────────

    function renderSpriteViewer() {
      if (!currentSheet || !spritesheets[currentSheet]) return;

      const sheet = spritesheets[currentSheet];
      const img = new Image();
      img.src = sheet.imageUrl;

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.style.width = (img.width * zoom) + 'px';
        canvas.style.height = (img.height * zoom) + 'px';

        ctx.drawImage(img, 0, 0);
        drawGridOverlay();
        highlightSprites();
      };
    }

    function drawGridOverlay() {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;

      // Vertical lines
      for (let x = gridW; x < canvas.width; x += gridW) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, canvas.height);
        ctx.stroke();
      }

      // Horizontal lines
      for (let y = gridH; y < canvas.height; y += gridH) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(canvas.width, y + 0.5);
        ctx.stroke();
      }
    }

    function highlightSprites() {
      if (!currentSheet) return;
      const sheet = spritesheets[currentSheet];

      ctx.strokeStyle = 'rgba(41, 173, 255, 0.8)';
      ctx.lineWidth = 1;

      for (const [name, sprite] of Object.entries(sheet.sprites)) {
        ctx.strokeRect(sprite.x + 0.5, sprite.y + 0.5, sprite.w - 1, sprite.h - 1);
      }
    }

    // ─── Canvas Click Handler ───────────────────────────────────────────

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / zoom);
      const y = Math.floor((e.clientY - rect.top) / zoom);

      // Calculate grid position
      const gridX = Math.floor(x / gridW);
      const gridY = Math.floor(y / gridH);

      // Snap to grid
      const snapX = gridX * gridW;
      const snapY = gridY * gridH;

      infoPos.textContent = \`\${x}, \${y}\`;
      infoGrid.textContent = \`\${gridX}, \${gridY}\`;
      infoSize.textContent = \`\${gridW}×\${gridH}\`;

      // Update selected sprite preview
      updateSelectedPreview(x, y);

      // Populate add fields with snapped coordinates
      document.getElementById('add-x').value = snapX;
      document.getElementById('add-y').value = snapY;
      document.getElementById('add-w').value = gridW;
      document.getElementById('add-h').value = gridH;
    });

    function updateSelectedPreview(x, y) {
      if (!currentSheet) return;

      const sheet = spritesheets[currentSheet];
      const img = new Image();

      // Snap to grid
      const snapX = Math.floor(x / gridW) * gridW;
      const snapY = Math.floor(y / gridH) * gridH;

      selectedCtx.clearRect(0, 0, 64, 64);

      img.onload = () => {
        selectedCtx.drawImage(img, snapX, snapY, gridW, gridH, 0, 0, 64, 64);
      };
      img.src = sheet.imageUrl;
      if (img.complete) {
        selectedCtx.drawImage(img, snapX, snapY, gridW, gridH, 0, 0, 64, 64);
      }

      selectedTitle.textContent = \`\${currentSheet}: (\${snapX}, \${snapY})\`;
      selectedSprite = { x: snapX, y: snapY, w: gridW, h: gridH };
    }

    // ─── Sprite List ─────────────────────────────────────────────────────

    // Cache of loaded images by URL
    const imageCache = new Map();

    function renderSpriteList() {
      if (!currentSheet) {
        spriteList.innerHTML = '<div style="color: var(--pixel-muted); font-size: 9px;">Select a spritesheet</div>';
        return;
      }

      const sheet = spritesheets[currentSheet];
      spriteList.innerHTML = '';

      // Use cached image or load new one
      const drawThumbnails = (img) => {
        for (const [name, sprite] of Object.entries(sheet.sprites)) {
          const item = document.createElement('div');
          item.className = 'sprite-item';

          const thumb = document.createElement('canvas');
          thumb.className = 'sprite-thumb';
          thumb.width = 24;
          thumb.height = 24;
          const thumbCtx = thumb.getContext('2d');
          thumbCtx.imageSmoothingEnabled = false;
          thumbCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 24, 24);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'sprite-name';
          nameSpan.textContent = name;

          item.appendChild(thumb);
          item.appendChild(nameSpan);

          // Capture sprite data for click handler
          const spriteData = { ...sprite, name: name };
          item.onclick = () => {
            // Highlight this sprite in viewer
            selectedSprite = spriteData;
            selectedTitle.textContent = name;

            // Draw to selected canvas using cached image
            selectedCtx.clearRect(0, 0, 64, 64);
            selectedCtx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, 64, 64);

            infoPos.textContent = \`\${sprite.x}, \${sprite.y}\`;
            infoSize.textContent = \`\${sprite.w}×\${sprite.h}\`;

            // Highlight on worldmap
            vscode.postMessage({ type: 'highlightSprite', data: { spriteId: currentSheet + '/' + name } });

            // Populate edit fields
            document.getElementById('editing-sprite-name').textContent = name;
            document.getElementById('edit-x').value = sprite.x;
            document.getElementById('edit-y').value = sprite.y;
            document.getElementById('edit-w').value = sprite.w;
            document.getElementById('edit-h').value = sprite.h;

            // Highlight in list
            document.querySelectorAll('.sprite-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
          };

          spriteList.appendChild(item);
        }
      };

      // Check if image is already cached
      const cachedImg = imageCache.get(sheet.imageUrl);
      if (cachedImg && cachedImg.complete) {
        drawThumbnails(cachedImg);
        updateSectionHeight('sprites-in-sheet');
      } else {
        // Load the image
        const img = new Image();
        img.onload = () => {
          imageCache.set(sheet.imageUrl, img);
          drawThumbnails(img);
          updateSectionHeight('sprites-in-sheet');
        };
        img.src = sheet.imageUrl;
        if (img.complete) {
          imageCache.set(sheet.imageUrl, img);
          drawThumbnails(img);
          updateSectionHeight('sprites-in-sheet');
        }
      }
    }

    // ─── Zoom Controls ────────────────────────────────────────────────────

    document.getElementById('zoom-in').onclick = () => {
      zoom = Math.min(8, zoom + 1);
      renderSpriteViewer();
    };

    document.getElementById('zoom-out').onclick = () => {
      zoom = Math.max(1, zoom - 1);
      renderSpriteViewer();
    };

    // ─── Grid Size ────────────────────────────────────────────────────────

    gridWInput.onchange = () => {
      gridW = parseInt(gridWInput.value) || 16;
      renderSpriteViewer();
    };

    gridHInput.onchange = () => {
      gridH = parseInt(gridHInput.value) || 16;
      renderSpriteViewer();
    };

    // ─── Open Manifest ────────────────────────────────────────────────────

    document.getElementById('open-manifest').onclick = () => {
      vscode.postMessage({ type: 'openManifest' });
    };

    // ─── Replace Image Button ─────────────────────────────────────────────

    document.getElementById('replace-image').onclick = () => {
      if (!currentSheet) {
        return;
      }
      vscode.postMessage({
        type: 'replaceImage',
        data: { sheetName: currentSheet }
      });
    };

    // ─── Add Spritesheet Form ─────────────────────────────────────────────

    const addSheetForm = document.getElementById('add-sheet-form');
    const addSheetToggle = document.getElementById('add-sheet-toggle');
    const charConfigSection = document.getElementById('char-config-section');
    const isCharCheckbox = document.getElementById('new-sheet-is-char');
    const addSheetError = document.getElementById('add-sheet-error');

    // Toggle form visibility
    addSheetToggle.onclick = () => {
      addSheetForm.classList.toggle('visible');
      addSheetError.textContent = '';
    };

    // Toggle character config section
    isCharCheckbox.onchange = () => {
      if (isCharCheckbox.checked) {
        charConfigSection.classList.remove('hidden');
      } else {
        charConfigSection.classList.add('hidden');
      }
    };

    // Browse for image
    document.getElementById('browse-image').onclick = () => {
      vscode.postMessage({ type: 'browseImage' });
    };

    // Handle selected image path from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'selectedImagePath') {
        document.getElementById('new-sheet-path').value = message.path;
      } else if (message.type === 'addSheetError') {
        addSheetError.textContent = message.error;
      } else if (message.type === 'addSheetSuccess') {
        // Hide form and clear fields
        addSheetForm.classList.remove('visible');
        document.getElementById('new-sheet-name').value = '';
        document.getElementById('new-sheet-path').value = '';
        document.getElementById('new-sheet-frame-w').value = '16';
        document.getElementById('new-sheet-frame-h').value = '16';
        document.getElementById('new-sheet-auto-gen').checked = true;
        document.getElementById('new-sheet-is-char').checked = false;
        charConfigSection.classList.add('hidden');
        addSheetError.textContent = '';
      }
    });

    // Cancel button
    document.getElementById('cancel-sheet').onclick = () => {
      addSheetForm.classList.remove('visible');
      addSheetError.textContent = '';
    };

    // Create button
    document.getElementById('create-sheet').onclick = () => {
      const name = document.getElementById('new-sheet-name').value.trim();
      const imagePath = document.getElementById('new-sheet-path').value.trim();
      const frameW = parseInt(document.getElementById('new-sheet-frame-w').value) || 16;
      const frameH = parseInt(document.getElementById('new-sheet-frame-h').value) || 16;
      const autoGen = document.getElementById('new-sheet-auto-gen').checked;
      const isCharacter = document.getElementById('new-sheet-is-char').checked;
      const directions = document.getElementById('new-sheet-directions').value.trim();
      const actions = document.getElementById('new-sheet-actions').value.trim();

      if (!name) {
        addSheetError.textContent = 'Name is required';
        return;
      }
      if (!imagePath) {
        addSheetError.textContent = 'Image path is required';
        return;
      }

      addSheetError.textContent = '';

      vscode.postMessage({
        type: 'addSpritesheet',
        data: {
          name,
          imagePath,
          frameW,
          frameH,
          autoGen,
          isCharacter,
          directions,
          actions,
        },
      });
    };

    // ─── Tab Switching ────────────────────────────────────────────────────

    document.getElementById('tab-update').onclick = () => {
      document.getElementById('tab-update').classList.add('active');
      document.getElementById('tab-add').classList.remove('active');
      document.getElementById('edit-panel-update').style.display = 'block';
      document.getElementById('edit-panel-add').style.display = 'none';
    };

    document.getElementById('tab-add').onclick = () => {
      document.getElementById('tab-add').classList.add('active');
      document.getElementById('tab-update').classList.remove('active');
      document.getElementById('edit-panel-add').style.display = 'block';
      document.getElementById('edit-panel-update').style.display = 'none';
    };

    // ─── Update Sprite Button ─────────────────────────────────────────────

    document.getElementById('btn-update').onclick = () => {
      const spriteName = document.getElementById('editing-sprite-name').textContent;
      if (!currentSheet || spriteName === 'Select a sprite from the list below') {
        alert('Please select a sprite from the list first');
        return;
      }

      const sprite = {
        x: parseInt(document.getElementById('edit-x').value) || 0,
        y: parseInt(document.getElementById('edit-y').value) || 0,
        w: parseInt(document.getElementById('edit-w').value) || 16,
        h: parseInt(document.getElementById('edit-h').value) || 16
      };

      vscode.postMessage({
        type: 'updateSprite',
        data: {
          sheetName: currentSheet,
          spriteName: spriteName,
          sprite: sprite
        }
      });
    };

    // ─── Add Sprite Button ────────────────────────────────────────────────

    document.getElementById('btn-add').onclick = () => {
      const spriteName = document.getElementById('add-name').value.trim();
      if (!currentSheet) {
        alert('Please select a spritesheet first');
        return;
      }
      if (!spriteName) {
        alert('Please enter a sprite name');
        return;
      }

      const sprite = {
        x: parseInt(document.getElementById('add-x').value) || 0,
        y: parseInt(document.getElementById('add-y').value) || 0,
        w: parseInt(document.getElementById('add-w').value) || 16,
        h: parseInt(document.getElementById('add-h').value) || 16
      };

      vscode.postMessage({
        type: 'addSprite',
        data: {
          sheetName: currentSheet,
          spriteName: spriteName,
          sprite: sprite
        }
      });

      // Clear the name field after adding
      document.getElementById('add-name').value = '';
    };

    // ─── Delete Sprite Button ─────────────────────────────────────────────

    document.getElementById('btn-delete').onclick = () => {
      const spriteName = document.getElementById('editing-sprite-name').textContent;
      if (!currentSheet || spriteName === 'Select a sprite from the list below') {
        alert('Please select a sprite from the list first');
        return;
      }

      if (confirm(\`Delete sprite "\${spriteName}" from \${currentSheet}?\`)) {
        vscode.postMessage({
          type: 'deleteSprite',
          data: {
            sheetName: currentSheet,
            spriteName: spriteName
          }
        });

        // Reset the edit fields
        document.getElementById('editing-sprite-name').textContent = 'Select a sprite from the list below';
      }
    };

    // ─── Lighting Controls ─────────────────────────────────────────────────

    // Helper to convert hex to number
    function hexToNumber(hex) {
      return parseInt(hex.replace('#', ''), 16);
    }

    // Helper to convert number to hex
    function numberToHex(num) {
      return '#' + num.toString(16).padStart(6, '0');
    }

    // Toggle handlers
    function setupLightingToggle(toggleId, configKey, defaultValue) {
      const toggle = document.getElementById(toggleId);
      if (!toggle) return;

      // Set initial state
      if (defaultValue) {
        toggle.classList.add('active');
      } else {
        toggle.classList.remove('active');
      }

      toggle.addEventListener('click', () => {
        const isActive = toggle.classList.toggle('active');
        vscode.postMessage({
          type: 'updateLighting',
          data: { [configKey]: isActive }
        });
      });
    }

    setupLightingToggle('lighting-enabled', 'enabled', true);
    setupLightingToggle('lighting-daynight', 'dayNightCycle', true);
    setupLightingToggle('lighting-agent-torch', 'agentLight', true);

    // Torch radius slider
    const torchRadiusSlider = document.getElementById('torch-radius');
    const torchRadiusValue = document.getElementById('torch-radius-value');
    if (torchRadiusSlider) {
      torchRadiusSlider.addEventListener('input', () => {
        const value = parseInt(torchRadiusSlider.value);
        torchRadiusValue.textContent = value;
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightRadius: value }
        });
      });
    }

    // Torch intensity slider
    const torchIntensitySlider = document.getElementById('torch-intensity');
    const torchIntensityValue = document.getElementById('torch-intensity-value');
    if (torchIntensitySlider) {
      torchIntensitySlider.addEventListener('input', () => {
        const value = parseInt(torchIntensitySlider.value) / 100;
        torchIntensityValue.textContent = value.toFixed(2);
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightIntensity: value }
        });
      });
    }

    // Torch color picker
    const torchColorPicker = document.getElementById('torch-color');
    const torchColorHex = document.getElementById('torch-color-hex');
    if (torchColorPicker) {
      torchColorPicker.addEventListener('input', () => {
        const hex = torchColorPicker.value;
        torchColorHex.textContent = hex;
        vscode.postMessage({
          type: 'updateLighting',
          data: { agentLightColor: hexToNumber(hex) }
        });
      });
    }

    // ─── Message Handling ─────────────────────────────────────────────────

    window.addEventListener('message', async event => {
      const message = event.data;

      if (message.type === 'loadAssets' && message.assets) {
        // Remember current selection
        const previousSheet = currentSheet;

        spritesheets = message.assets.spritesheets;
        spriteMappings = message.assets.spriteMappings || {};
        renderSpritesheetList();

        // Re-select the previous sheet if it exists, otherwise select first
        if (previousSheet && spritesheets[previousSheet]) {
          selectSpritesheet(previousSheet);
        } else {
          const firstSheet = Object.keys(spritesheets)[0];
          if (firstSheet) {
            selectSpritesheet(firstSheet);
          }
        }
      }
    });

    // Signal ready
    vscode.postMessage({ type: 'webviewReady' });
  </script>
</body>
</html>`;
  }
}

// Singleton
let instance: SpriteConfigPanel | undefined;

export function getSpriteConfigPanel(extensionUri: vscode.Uri): SpriteConfigPanel {
  if (!instance) {
    instance = new SpriteConfigPanel(extensionUri);
  }
  return instance;
}
