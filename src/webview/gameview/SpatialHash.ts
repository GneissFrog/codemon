/**
 * SpatialHash - O(1) spatial lookups for game objects
 *
 * Divides the world into a grid of cells. Each cell stores
 * references to objects that overlap it. This allows for
 * efficient range queries and point lookups.
 */

export interface SpatialItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SpatialHash<T extends SpatialItem> {
  private cells: Map<string, T[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number = 10) {
    this.cellSize = cellSize;
  }

  /**
   * Clear all items from the hash
   */
  clear(): void {
    this.cells.clear();
  }

  /**
   * Get cell key for a position
   */
  private getKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  /**
   * Get all cell keys that an item overlaps
   */
  private getKeysForItem(item: T): string[] {
    const keys: string[] = [];
    const startX = Math.floor(item.x / this.cellSize);
    const endX = Math.floor((item.x + item.width) / this.cellSize);
    const startY = Math.floor(item.y / this.cellSize);
    const endY = Math.floor((item.y + item.height) / this.cellSize);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        keys.push(`${x},${y}`);
      }
    }

    return keys;
  }

  /**
   * Insert an item into the hash
   */
  insert(item: T): void {
    const keys = this.getKeysForItem(item);

    for (const key of keys) {
      if (!this.cells.has(key)) {
        this.cells.set(key, []);
      }
      this.cells.get(key)!.push(item);
    }
  }

  /**
   * Remove an item from the hash
   */
  remove(item: T): void {
    const keys = this.getKeysForItem(item);

    for (const key of keys) {
      const cell = this.cells.get(key);
      if (cell) {
        const index = cell.indexOf(item);
        if (index !== -1) {
          cell.splice(index, 1);
        }
        if (cell.length === 0) {
          this.cells.delete(key);
        }
      }
    }
  }

  /**
   * Query for items at a specific point
   */
  queryPoint(x: number, y: number): T[] {
    const key = this.getKey(x, y);
    const cell = this.cells.get(key);

    if (!cell) return [];

    // Filter to items that actually contain the point
    return cell.filter(item =>
      x >= item.x &&
      x < item.x + item.width &&
      y >= item.y &&
      y < item.y + item.height
    );
  }

  /**
   * Query for items within a rectangular area
   */
  queryRect(x: number, y: number, width: number, height: number): T[] {
    const results = new Set<T>();

    const startX = Math.floor(x / this.cellSize);
    const endX = Math.floor((x + width) / this.cellSize);
    const startY = Math.floor(y / this.cellSize);
    const endY = Math.floor((y + height) / this.cellSize);

    for (let cx = startX; cx <= endX; cx++) {
      for (let cy = startY; cy <= endY; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const item of cell) {
            // Check actual overlap
            if (this.rectsOverlap(
              x, y, width, height,
              item.x, item.y, item.width, item.height
            )) {
              results.add(item);
            }
          }
        }
      }
    }

    return Array.from(results);
  }

  /**
   * Check if two rectangles overlap
   */
  private rectsOverlap(
    x1: number, y1: number, w1: number, h1: number,
    x2: number, y2: number, w2: number, h2: number
  ): boolean {
    return x1 < x2 + w2 &&
           x1 + w1 > x2 &&
           y1 < y2 + h2 &&
           y1 + h1 > y2;
  }

  /**
   * Get the total number of items in the hash
   */
  get size(): number {
    const uniqueItems = new Set<T>();
    for (const cell of this.cells.values()) {
      for (const item of cell) {
        uniqueItems.add(item);
      }
    }
    return uniqueItems.size;
  }

  /**
   * Get the number of cells
   */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Rebuild the hash with new items
   */
  rebuild(items: T[]): void {
    this.clear();
    for (const item of items) {
      this.insert(item);
    }
  }
}
