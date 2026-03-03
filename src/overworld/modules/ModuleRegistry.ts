/**
 * ModuleRegistry - Loads tile module definitions from tile-modules.json
 * and provides indexed access by ID, category, and tags.
 */

import * as vscode from 'vscode';
import { TileModuleDef, ModuleCategory } from '../core/types';
import { normalizeModuleDef } from './ModuleParser';

export interface TileModulesFile {
  version: number;
  modules: Record<string, unknown>[];
}

export class ModuleRegistry {
  private extensionUri: vscode.Uri;
  private modules = new Map<string, TileModuleDef>();
  private byCategory = new Map<ModuleCategory, TileModuleDef[]>();
  private loaded = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /** Load tile-modules.json and index all modules */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const filePath = vscode.Uri.joinPath(
        this.extensionUri,
        'assets',
        'config',
        'tile-modules.json'
      );

      const data = await vscode.workspace.fs.readFile(filePath);
      const raw: TileModulesFile = JSON.parse(data.toString());

      for (const rawModule of raw.modules) {
        const moduleDef = normalizeModuleDef(rawModule);
        this.modules.set(moduleDef.id, moduleDef);

        const catList = this.byCategory.get(moduleDef.category) ?? [];
        catList.push(moduleDef);
        this.byCategory.set(moduleDef.category, catList);
      }

      this.loaded = true;
      console.log(`[ModuleRegistry] Loaded ${this.modules.size} tile modules`);
    } catch (error) {
      // tile-modules.json might not exist yet - that's fine
      console.warn('[ModuleRegistry] Could not load tile-modules.json:', error);
      this.loaded = true;
    }
  }

  /** Get a module by ID */
  get(id: string): TileModuleDef | undefined {
    return this.modules.get(id);
  }

  /** Get all modules in a category */
  getByCategory(category: ModuleCategory): TileModuleDef[] {
    return this.byCategory.get(category) ?? [];
  }

  /** Get all modules that match any of the given tags */
  getByTags(tags: string[]): TileModuleDef[] {
    const tagSet = new Set(tags);
    const results: TileModuleDef[] = [];
    for (const mod of this.modules.values()) {
      if (mod.tags.some(t => tagSet.has(t))) {
        results.push(mod);
      }
    }
    return results;
  }

  /** Get all modules eligible for a given world area */
  getEligible(worldArea: number): TileModuleDef[] {
    const results: TileModuleDef[] = [];
    for (const mod of this.modules.values()) {
      if (mod.minWorldArea <= worldArea) {
        results.push(mod);
      }
    }
    return results;
  }

  /** Get all loaded modules */
  getAll(): TileModuleDef[] {
    return Array.from(this.modules.values());
  }

  /** Get the count of loaded modules */
  get size(): number {
    return this.modules.size;
  }

  /** Check if the registry is loaded */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Force reload from disk */
  async reload(): Promise<void> {
    this.modules.clear();
    this.byCategory.clear();
    this.loaded = false;
    await this.load();
  }

  /** Save the current modules back to tile-modules.json */
  async save(): Promise<void> {
    const filePath = vscode.Uri.joinPath(
      this.extensionUri,
      'assets',
      'config',
      'tile-modules.json'
    );

    const data = {
      version: 1,
      modules: this.getAll(),
    };

    const content = JSON.stringify(data, null, 2);
    await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf-8'));
    console.log(`[ModuleRegistry] Saved ${this.modules.size} modules to tile-modules.json`);
  }

  /** Add or update a module definition */
  setModule(moduleDef: TileModuleDef): void {
    // Remove from old category list if exists
    const existing = this.modules.get(moduleDef.id);
    if (existing) {
      const catList = this.byCategory.get(existing.category);
      if (catList) {
        const idx = catList.findIndex(m => m.id === existing.id);
        if (idx !== -1) catList.splice(idx, 1);
      }
    }

    this.modules.set(moduleDef.id, moduleDef);

    const catList = this.byCategory.get(moduleDef.category) ?? [];
    catList.push(moduleDef);
    this.byCategory.set(moduleDef.category, catList);
  }

  /** Delete a module by ID */
  deleteModule(id: string): boolean {
    const existing = this.modules.get(id);
    if (!existing) return false;

    this.modules.delete(id);
    const catList = this.byCategory.get(existing.category);
    if (catList) {
      const idx = catList.findIndex(m => m.id === id);
      if (idx !== -1) catList.splice(idx, 1);
    }
    return true;
  }

  dispose(): void {
    this.modules.clear();
    this.byCategory.clear();
    this.loaded = false;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: ModuleRegistry | undefined;

export function getModuleRegistry(extensionUri?: vscode.Uri): ModuleRegistry {
  if (!instance && extensionUri) {
    instance = new ModuleRegistry(extensionUri);
  }
  if (!instance) {
    throw new Error('ModuleRegistry not initialized - provide extensionUri');
  }
  return instance;
}
