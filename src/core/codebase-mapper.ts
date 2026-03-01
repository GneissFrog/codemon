/**
 * Codebase Mapper — Data layer for the Overworld Map
 * Builds a file tree incrementally from tool events, tracks per-file activity,
 * and computes treemap layouts for canvas rendering.
 */

import * as path from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;           // workspace-relative path
  isDir: boolean;
  children: FileNode[];
  // Activity tracking
  readCount: number;
  writeCount: number;
  lastAccessed: number;   // timestamp (0 = never)
  totalTokens: number;
  isActive: boolean;      // currently being accessed (decays after 3s)
}

export interface MapTile {
  node: FileNode;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  brightness: number;     // 0.0–1.0
  isDir: boolean;
  label?: string;         // directory name label
  depth: number;          // nesting depth for visual styling
}

export interface MapLayout {
  tiles: MapTile[];
  width: number;
  height: number;
  fileCount: number;
  dirCount: number;
  activeFile: string | null;
}

export type FileAction = 'read' | 'write' | 'search';

// ─── Biome Colors (PICO-8 Palette) ─────────────────────────────────────────

const BIOME_COLORS: Record<string, string> = {
  '.ts':    '#29adff',  // Water (blue)
  '.tsx':   '#29adff',
  '.js':    '#1d6daf',  // Shallow water
  '.jsx':   '#1d6daf',
  '.mjs':   '#1d6daf',
  '.cjs':   '#1d6daf',
  '.py':    '#00e436',  // Forest (green)
  '.rs':    '#ff77a8',  // Desert (pink-orange)
  '.go':    '#00b543',  // Mountains (teal-green)
  '.css':   '#83769c',  // Town (purple)
  '.scss':  '#83769c',
  '.less':  '#83769c',
  '.html':  '#ab5236',  // Castle (warm brown)
  '.vue':   '#00e436',
  '.svelte':'#ff6c24',
  '.json':  '#5a5d6e',  // Stone (gray)
  '.yaml':  '#5a5d6e',
  '.yml':   '#5a5d6e',
  '.toml':  '#5a5d6e',
  '.md':    '#7e5539',  // Path (brown)
  '.txt':   '#7e5539',
  '.sh':    '#ffec27',  // Lightning (yellow)
  '.bash':  '#ffec27',
  '.sql':   '#29adff',
};

const DEFAULT_COLOR = '#3a3d4e'; // Dark stone

// ─── Active Decay Duration ──────────────────────────────────────────────────

const ACTIVE_DECAY_MS = 3000;

// ─── Tile sizing ────────────────────────────────────────────────────────────

const TILE_SIZE = 10;
const TILE_GAP = 1;
const DIR_HEADER_HEIGHT = 14;
const DIR_PADDING = 2;
const MAX_TILES = 200;

// ─── Codebase Mapper ────────────────────────────────────────────────────────

export class CodebaseMapper {
  private root: FileNode;
  private activeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private activeFile: string | null = null;
  private workspaceRoot: string = '';

  constructor() {
    this.root = this.createDirNode('');
  }

  /**
   * Set the workspace root for path normalization
   */
  setWorkspaceRoot(rootPath: string): void {
    this.workspaceRoot = rootPath;
  }

  /**
   * Add a file to the tree without recording any activity.
   * Used for workspace scanning to pre-populate the map.
   */
  addFile(absolutePath: string): void {
    const relPath = this.toRelativePath(absolutePath);
    if (!relPath) return;
    this.ensureFile(relPath);
  }

  /**
   * Record a file activity event
   */
  recordActivity(absolutePath: string, action: FileAction): void {
    const relPath = this.toRelativePath(absolutePath);
    if (!relPath) return;

    // Ensure file exists in tree
    const node = this.ensureFile(relPath);

    // Update activity counts
    if (action === 'read' || action === 'search') {
      node.readCount++;
    } else if (action === 'write') {
      node.writeCount++;
    }
    node.lastAccessed = Date.now();
    node.isActive = true;
    this.activeFile = relPath;

    // Clear previous decay timer for this file
    const existing = this.activeTimers.get(relPath);
    if (existing) clearTimeout(existing);

    // Set decay timer
    this.activeTimers.set(relPath, setTimeout(() => {
      node.isActive = false;
      this.activeTimers.delete(relPath);
      if (this.activeFile === relPath) {
        this.activeFile = null;
      }
    }, ACTIVE_DECAY_MS));
  }

  /**
   * Clear activity counts but keep the tree structure
   */
  clearActivity(): void {
    this.clearNodeActivity(this.root);
    this.activeTimers.forEach((timer) => clearTimeout(timer));
    this.activeTimers.clear();
    this.activeFile = null;
  }

  /**
   * Get the current map layout as a flat array of tiles
   */
  getLayout(canvasWidth: number, canvasHeight: number): MapLayout {
    const fileCount = this.countFiles(this.root);
    const dirCount = this.countDirs(this.root);

    if (fileCount === 0) {
      return {
        tiles: [],
        width: canvasWidth,
        height: canvasHeight,
        fileCount: 0,
        dirCount: 0,
        activeFile: this.activeFile,
      };
    }

    const tiles = this.computeTreemap(
      this.root,
      0, 0, canvasWidth, canvasHeight,
      0
    );

    return {
      tiles,
      width: canvasWidth,
      height: canvasHeight,
      fileCount,
      dirCount,
      activeFile: this.activeFile,
    };
  }

  /**
   * Get the file tree root (for debugging / inspection)
   */
  getTree(): FileNode {
    return this.root;
  }

  // ─── Internal: Tree Construction ────────────────────────────────────────

  private ensureFile(relPath: string): FileNode {
    const parts = relPath.split('/').filter(Boolean);
    let current = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = isLast
          ? this.createFileNode(part, relPath)
          : this.createDirNode(parts.slice(0, i + 1).join('/'));
        current.children.push(child);
      }

      current = child;
    }

    return current;
  }

  private createFileNode(name: string, filePath: string): FileNode {
    return {
      name,
      path: filePath,
      isDir: false,
      children: [],
      readCount: 0,
      writeCount: 0,
      lastAccessed: 0,
      totalTokens: 0,
      isActive: false,
    };
  }

  private createDirNode(dirPath: string): FileNode {
    const name = dirPath.split('/').pop() || '(root)';
    return {
      name,
      path: dirPath,
      isDir: true,
      children: [],
      readCount: 0,
      writeCount: 0,
      lastAccessed: 0,
      totalTokens: 0,
      isActive: false,
    };
  }

  // ─── Internal: Treemap Layout ───────────────────────────────────────────

  private computeTreemap(
    node: FileNode,
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number
  ): MapTile[] {
    const tiles: MapTile[] = [];

    if (!node.isDir || node.children.length === 0) {
      // Leaf file — single tile
      if (!node.isDir) {
        tiles.push(this.createTile(node, x, y, w, h, depth));
      }
      return tiles;
    }

    // Directory — add directory tile first (for background/label)
    tiles.push({
      node,
      x,
      y,
      width: w,
      height: h,
      color: '#2a2d3e',
      brightness: 0.3,
      isDir: true,
      label: node.name,
      depth,
    });

    // Separate children into dirs and files
    const dirs = node.children.filter((c) => c.isDir && this.countFiles(c) > 0);
    const files = node.children.filter((c) => !c.isDir);

    // All children weighted by file count
    const children = [...dirs, ...files];
    const weights = children.map((c) =>
      c.isDir ? this.countFiles(c) : 1
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (totalWeight === 0) return tiles;

    // Content area (inside directory padding + header)
    const cx = x + DIR_PADDING;
    const cy = y + DIR_HEADER_HEIGHT;
    const cw = w - DIR_PADDING * 2;
    const ch = h - DIR_HEADER_HEIGHT - DIR_PADDING;

    if (cw <= 0 || ch <= 0) return tiles;

    // If only files (no subdirs), use grid layout
    if (dirs.length === 0) {
      tiles.push(...this.layoutFilesAsGrid(files, cx, cy, cw, ch, depth + 1));
      return tiles;
    }

    // Squarified treemap for mixed content
    const rects = this.squarify(children, weights, cx, cy, cw, ch);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const rect = rects[i];

      if (child.isDir) {
        // Recurse into directory (limit depth to 3)
        if (depth < 3) {
          tiles.push(
            ...this.computeTreemap(
              child,
              rect.x, rect.y, rect.w, rect.h,
              depth + 1
            )
          );
        } else {
          // Collapsed directory — show as single tile
          tiles.push({
            node: child,
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
            color: '#3a3d4e',
            brightness: 0.5,
            isDir: true,
            label: `${child.name}/...`,
            depth: depth + 1,
          });
        }
      } else {
        // File tile
        tiles.push(this.createTile(child, rect.x, rect.y, rect.w, rect.h, depth + 1));
      }
    }

    return tiles.slice(0, MAX_TILES);
  }

  /**
   * Layout files as a simple grid within a bounding rectangle
   */
  private layoutFilesAsGrid(
    files: FileNode[],
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number
  ): MapTile[] {
    const tiles: MapTile[] = [];
    const cols = Math.max(1, Math.floor(w / (TILE_SIZE + TILE_GAP)));
    const rows = Math.max(1, Math.floor(h / (TILE_SIZE + TILE_GAP)));
    const maxFiles = Math.min(files.length, cols * rows, MAX_TILES);

    for (let i = 0; i < maxFiles; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (row >= rows) break;

      const tx = x + col * (TILE_SIZE + TILE_GAP);
      const ty = y + row * (TILE_SIZE + TILE_GAP);

      tiles.push(this.createTile(files[i], tx, ty, TILE_SIZE, TILE_SIZE, depth));
    }

    return tiles;
  }

  /**
   * Squarified treemap algorithm
   * Returns rectangles allocated to each item proportional to its weight
   */
  private squarify(
    items: FileNode[],
    weights: number[],
    x: number,
    y: number,
    w: number,
    h: number
  ): Array<{ x: number; y: number; w: number; h: number }> {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

    if (totalWeight === 0 || items.length === 0) return rects;

    // Simple strip-based layout (horizontal or vertical based on aspect ratio)
    let remainX = x;
    let remainY = y;
    let remainW = w;
    let remainH = h;
    let remainWeight = totalWeight;

    for (let i = 0; i < items.length; i++) {
      const fraction = weights[i] / remainWeight;

      if (remainW >= remainH) {
        // Vertical split
        const sliceW = Math.max(TILE_SIZE, Math.round(remainW * fraction));
        rects.push({ x: remainX, y: remainY, w: sliceW, h: remainH });
        remainX += sliceW;
        remainW -= sliceW;
      } else {
        // Horizontal split
        const sliceH = Math.max(TILE_SIZE, Math.round(remainH * fraction));
        rects.push({ x: remainX, y: remainY, w: remainW, h: sliceH });
        remainY += sliceH;
        remainH -= sliceH;
      }

      remainWeight -= weights[i];
      if (remainWeight <= 0) remainWeight = 1; // prevent division by zero
    }

    return rects;
  }

  // ─── Internal: Tile Creation ────────────────────────────────────────────

  private createTile(
    node: FileNode,
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number
  ): MapTile {
    const ext = path.extname(node.name).toLowerCase();
    const color = BIOME_COLORS[ext] || DEFAULT_COLOR;
    const brightness = this.computeBrightness(node);

    return {
      node,
      x,
      y,
      width: w,
      height: h,
      color,
      brightness,
      isDir: false,
      depth,
    };
  }

  private computeBrightness(node: FileNode): number {
    if (node.isActive) return 1.0;

    const totalActivity = node.readCount + node.writeCount;
    if (totalActivity === 0) return 0.35; // dim = never accessed

    // Scale from 0.5 (1 access) to 0.9 (5+ accesses)
    const capped = Math.min(totalActivity, 10);
    return 0.5 + (capped / 10) * 0.4;
  }

  // ─── Internal: Path Handling ────────────────────────────────────────────

  private toRelativePath(absolutePath: string): string | null {
    if (!absolutePath) return null;

    // Normalize slashes (Windows backslashes → forward slashes)
    const normalized = absolutePath.replace(/\\/g, '/');
    const root = this.workspaceRoot.replace(/\\/g, '/');

    if (root) {
      // Case-insensitive comparison for Windows path matching
      const normalizedLower = normalized.toLowerCase();
      const rootLower = root.toLowerCase();

      if (normalizedLower.startsWith(rootLower)) {
        // Use the original-case path for the relative portion
        let rel = normalized.slice(root.length);
        if (rel.startsWith('/')) rel = rel.slice(1);
        return rel || null;
      }
    }

    // If no workspace root or path is already relative, use as-is
    if (!path.isAbsolute(absolutePath)) {
      return normalized;
    }

    return null;
  }

  // ─── Internal: Utility ──────────────────────────────────────────────────

  private countFiles(node: FileNode): number {
    if (!node.isDir) return 1;
    return node.children.reduce((sum, c) => sum + this.countFiles(c), 0);
  }

  private countDirs(node: FileNode): number {
    if (!node.isDir) return 0;
    return 1 + node.children.reduce((sum, c) => sum + this.countDirs(c), 0);
  }

  private clearNodeActivity(node: FileNode): void {
    node.readCount = 0;
    node.writeCount = 0;
    node.lastAccessed = 0;
    node.isActive = false;
    node.totalTokens = 0;
    for (const child of node.children) {
      this.clearNodeActivity(child);
    }
  }

  /**
   * Dispose timers
   */
  dispose(): void {
    this.activeTimers.forEach((timer) => clearTimeout(timer));
    this.activeTimers.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: CodebaseMapper | undefined;

export function getCodebaseMapper(): CodebaseMapper {
  if (!instance) {
    instance = new CodebaseMapper();
  }
  return instance;
}
