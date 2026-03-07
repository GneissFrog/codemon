/**
 * AnimationResolver — Webview-safe frame lookup for animation sets.
 * Pure TypeScript, no VS Code or DOM dependencies.
 *
 * Resolves animation names (from state machines) to sprite frame sequences
 * for a given entity type and direction.
 */

import { AnimationSetDef, AnimationClipDef } from '../overworld/core/types';

export interface ResolvedAnimation {
  spritesheet: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

export class AnimationResolver {
  private sets: Record<string, AnimationSetDef>;

  constructor(sets: Record<string, AnimationSetDef>) {
    this.sets = sets;
  }

  /** Update with new config (e.g., after editor save) */
  updateSets(sets: Record<string, AnimationSetDef>): void {
    this.sets = sets;
  }

  /** Get the full resolved animation for an entity type + animation name */
  resolve(entityType: string, animation: string, direction?: string): ResolvedAnimation | undefined {
    const set = this.sets[entityType];
    if (!set) return undefined;

    const clip = this.resolveClip(set, animation);
    if (!clip) return undefined;

    const frames = this.getClipFrames(clip, direction);
    if (!frames || frames.length === 0) return undefined;

    return {
      spritesheet: set.spritesheet,
      frames,
      fps: clip.fps ?? 10,
      loop: clip.loop !== false,
    };
  }

  /** Get just the frame IDs for an entity + animation + direction */
  getFrames(entityType: string, animation: string, direction?: string): string[] {
    const resolved = this.resolve(entityType, animation, direction);
    return resolved?.frames ?? [];
  }

  /** Get FPS for an animation */
  getFps(entityType: string, animation: string): number {
    const set = this.sets[entityType];
    if (!set) return 10;
    const clip = this.resolveClip(set, animation);
    return clip?.fps ?? 10;
  }

  /** Check if an animation loops */
  isLooping(entityType: string, animation: string): boolean {
    const set = this.sets[entityType];
    if (!set) return true;
    const clip = this.resolveClip(set, animation);
    return clip?.loop !== false;
  }

  /** Get the spritesheet name for an entity type */
  getSpritesheet(entityType: string): string | undefined {
    return this.sets[entityType]?.spritesheet;
  }

  /** Get all animation names defined for an entity type */
  getAnimationNames(entityType: string): string[] {
    const set = this.sets[entityType];
    if (!set) return [];
    return Object.keys(set.animations);
  }

  /** Check if an entity type has animation sets loaded */
  hasSet(entityType: string): boolean {
    return entityType in this.sets;
  }

  /**
   * Resolve a clip by following aliases (with cycle detection).
   * Returns the final non-alias clip, or undefined if not found.
   */
  private resolveClip(set: AnimationSetDef, animation: string, visited?: Set<string>): AnimationClipDef | undefined {
    const clip = set.animations[animation];
    if (!clip) {
      // Fallback: try "idle", then first animation
      if (animation !== 'idle') {
        return this.resolveClip(set, 'idle', visited);
      }
      const first = Object.keys(set.animations)[0];
      return first ? set.animations[first] : undefined;
    }

    if (clip.alias) {
      const seen = visited ?? new Set<string>();
      if (seen.has(animation)) return undefined; // cycle
      seen.add(animation);
      return this.resolveClip(set, clip.alias, seen);
    }

    return clip;
  }

  /** Extract frame list from a clip, considering direction */
  private getClipFrames(clip: AnimationClipDef, direction?: string): string[] | undefined {
    // Try directional first
    if (clip.directions && direction) {
      const dirFrames = clip.directions[direction];
      if (dirFrames) return dirFrames.frames;
      // Fall back to first direction
      const firstDir = Object.keys(clip.directions)[0];
      if (firstDir) return clip.directions[firstDir].frames;
    }

    // Try directional even without direction arg (use first direction)
    if (clip.directions) {
      const firstDir = Object.keys(clip.directions)[0];
      if (firstDir) return clip.directions[firstDir].frames;
    }

    // Use flat frames
    return clip.frames;
  }
}
