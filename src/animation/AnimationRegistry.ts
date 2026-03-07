/**
 * AnimationRegistry — Loads animation set definitions from
 * assets/config/animation-sets.json. Singleton via getAnimationRegistry().
 */

import * as vscode from 'vscode';
import { AnimationSetDef, AnimationSetsConfig } from '../overworld/core/types';

export class AnimationRegistry {
  private extensionUri: vscode.Uri;
  private sets = new Map<string, AnimationSetDef>();
  private loaded = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /** Load animation-sets.json */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const filePath = vscode.Uri.joinPath(
        this.extensionUri,
        'assets',
        'config',
        'animation-sets.json'
      );

      const data = await vscode.workspace.fs.readFile(filePath);
      const raw: AnimationSetsConfig = JSON.parse(data.toString());

      for (const [id, set] of Object.entries(raw.sets)) {
        this.sets.set(id, set);
      }

      this.loaded = true;
      console.log(`[AnimationRegistry] Loaded ${this.sets.size} animation sets`);
    } catch (error) {
      console.warn('[AnimationRegistry] Could not load animation-sets.json:', error);
      this.loaded = true;
    }
  }

  /** Get an animation set by entity type */
  getSet(entityType: string): AnimationSetDef | undefined {
    return this.sets.get(entityType);
  }

  /** Get all sets */
  getAllSets(): Map<string, AnimationSetDef> {
    return this.sets;
  }

  /** Set or update a set (from editor panel) */
  setAnimationSet(id: string, set: AnimationSetDef): void {
    this.sets.set(id, set);
  }

  /** Delete a set */
  deleteAnimationSet(id: string): void {
    this.sets.delete(id);
  }

  /** Save current state back to JSON */
  async save(): Promise<void> {
    const config: AnimationSetsConfig = {
      version: 1,
      sets: Object.fromEntries(this.sets),
    };

    const filePath = vscode.Uri.joinPath(
      this.extensionUri,
      'assets',
      'config',
      'animation-sets.json'
    );

    const content = JSON.stringify(config, null, 2);
    await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf-8'));
    console.log('[AnimationRegistry] Saved animation-sets.json');
  }

  /** Get serializable config for sending to webview */
  getSerializableConfig(): Record<string, AnimationSetDef> {
    return Object.fromEntries(this.sets);
  }
}

// Singleton
let _instance: AnimationRegistry | undefined;

export function getAnimationRegistry(extensionUri?: vscode.Uri): AnimationRegistry {
  if (!_instance) {
    if (!extensionUri) throw new Error('AnimationRegistry: extensionUri required for first init');
    _instance = new AnimationRegistry(extensionUri);
  }
  return _instance;
}
