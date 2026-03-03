/**
 * OccupancyGrid - Tracks which tile positions are claimed in the world.
 * Used during module placement to prevent overlaps with plots, fences, and other modules.
 * Uses the same Set<string> pattern as pathPositions/waterPositions in WorldGenerator.
 */
export class OccupancyGrid {
  private occupied = new Set<string>();

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** Mark a single position as occupied */
  mark(x: number, y: number): void {
    this.occupied.add(this.key(x, y));
  }

  /** Mark a rectangular area (with optional margin around it) as occupied */
  markRect(x: number, y: number, w: number, h: number, margin = 0): void {
    for (let dy = -margin; dy < h + margin; dy++) {
      for (let dx = -margin; dx < w + margin; dx++) {
        this.occupied.add(this.key(x + dx, y + dy));
      }
    }
  }

  /** Check if a single position is occupied */
  isOccupied(x: number, y: number): boolean {
    return this.occupied.has(this.key(x, y));
  }

  /** Check if an entire rectangular area is free (no occupied tiles) */
  isRectFree(x: number, y: number, w: number, h: number): boolean {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.occupied.has(this.key(x + dx, y + dy))) {
          return false;
        }
      }
    }
    return true;
  }

  /** Get the number of occupied positions */
  get size(): number {
    return this.occupied.size;
  }

  /** Clear all occupied positions */
  clear(): void {
    this.occupied.clear();
  }
}
