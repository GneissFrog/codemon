/**
 * GameEngine - Engine-agnostic game logic for the webview
 *
 * This module contains all game state and logic that is independent
 * of the rendering backend (Canvas 2D or PixiJS).
 */

import {
  GameState,
  AgentState,
  SubagentState,
  Particle,
  GrowthEffect,
  Tile,
  Plot,
  TileAnimation,
  WanderState,
  TILE_SIZE,
  Direction,
  ANIMAL_BEHAVIORS,
  AnimalBehaviorConfig,
  TileType,
  WeatherState,
  WeatherParticle,
  WeatherType,
} from './types';
import { SpatialHash } from './SpatialHash';
import { StateMachine } from '../../state-machine/StateMachine';
import type { StateMachineConfig, AgentTypeConfig } from '../../state-machine/types';
import { AnimationResolver } from '../../animation/AnimationResolver';
import type { AnimationSetDef } from '../../overworld/core/types';

// ─── Constants ────────────────────────────────────────────────────────────

const GROWTH_EFFECT_DURATION = 1000; // ms

// Sprite colors for fallback rendering
export const SPRITE_COLORS = {
  knight: { primary: '#ff77a8', secondary: '#83769c', accent: '#ffec27', name: 'KNIGHT' },
  ranger: { primary: '#29adff', secondary: '#1d2b53', accent: '#00e436', name: 'RANGER' },
  rogue: { primary: '#00e436', secondary: '#003d28', accent: '#29adff', name: 'ROGUE' }
};

// Animation frame definitions
export const ANIMATIONS = {
  idle: [
    { bodyY: 0, eyeY: 0, armOffset: 0 },
    { bodyY: -1, eyeY: 0, armOffset: 0 }
  ],
  walk: [
    { bodyY: 0, eyeY: 0, armOffset: 4, legOffset: 2 },
    { bodyY: -1, eyeY: 0, armOffset: -4, legOffset: -2 }
  ],
  investigate: [
    { bodyY: 0, eyeY: 2, armOffset: 4 },
    { bodyY: 0, eyeY: 2, armOffset: 6 }
  ],
  write: [
    { bodyY: 0, eyeY: 0, armOffset: 2 },
    { bodyY: 0, eyeY: 0, armOffset: -2 }
  ],
  bash: [
    { bodyY: 0, eyeY: 0, armOffset: 8 },
    { bodyY: -2, eyeY: 0, armOffset: -4 }
  ]
};

// ─── Game Engine Class ─────────────────────────────────────────────────────

export class GameEngine {
  // Core state
  state: GameState;

  // Navigation
  walkableTiles = new Set<string>();
  agentPath: { x: number; y: number }[] = [];

  // Animation system
  tileAnimations = new Map<string, TileAnimation>();
  previousPlotStages = new Map<string, number>();

  // Spatial hash for O(1) plot lookups
  plotSpatialHash = new SpatialHash<Plot>(10);

  // Wander AI (legacy — used as fallback when no state machine config loaded)
  wander: WanderState = {
    enabled: true,
    idleTimeout: 5000,
    pauseMin: 1500,
    pauseMax: 4000,
    radius: 8,
    lastActivityTime: 0,
    isPaused: false,
    pauseUntil: 0,
    isWandering: false,
  };

  // Config-driven state machines
  private smConfigs: Record<string, StateMachineConfig> = {};
  private agentTypeConfigs: Record<string, AgentTypeConfig> = {};
  private wanderSM: StateMachine | null = null;
  private subagentSMs = new Map<string, StateMachine>();
  private lastUpdateTime = 0;

  // Tile state machines — keyed by "x,y,layer"
  private tileSMs = new Map<string, StateMachine>();
  private tileSMDirty = new Map<string, string>();  // key → new spriteId for tiles that transitioned this frame

  // Manifest data for animations
  manifest: { animations?: Record<string, { frames: string[]; fps: number; loop: boolean }> } | null = null;

  // Animation resolver for animation set lookups
  private animResolver: AnimationResolver | null = null;

  // Weather system
  weather: WeatherState = {
    current: 'clear',
    particles: [],
    intensity: 0.5,
    windDirection: 0,
    enabled: true,
  };

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): GameState {
    return {
      tiles: [],
      plots: [],
      worldWidth: 0,
      worldHeight: 0,
      agent: {
        x: 200,
        y: 150,
        targetX: 200,
        targetY: 150,
        isMoving: false,
        filePath: null,
        animation: 'idle',
        frameIndex: 0,
        type: 'ranger',
        direction: 'down',
      },
      subagents: [],
      particles: [],
      growthEffects: [],
      config: null,
      budget: null,
      sessionTokens: 0,
      sessionCost: 0,
      activities: [],
    };
  }

  // ─── State Machine Config ──────────────────────────────────────────────

  loadStateMachineConfigs(
    machines: Record<string, StateMachineConfig>,
    agentTypes: Record<string, AgentTypeConfig>
  ): void {
    this.smConfigs = machines;
    this.agentTypeConfigs = agentTypes;

    // Create wander state machine from main-agent config
    const mainAgentConfig = machines['main-agent'];
    if (mainAgentConfig) {
      this.wanderSM = new StateMachine(mainAgentConfig);
      console.log('[Engine] Wander state machine loaded:', mainAgentConfig.id);
    }

    // Create state machines for existing subagents
    for (const sa of this.state.subagents) {
      this.ensureSubagentSM(sa);
    }
  }

  private ensureSubagentSM(sa: SubagentState): StateMachine | null {
    if (this.subagentSMs.has(sa.id)) {
      return this.subagentSMs.get(sa.id)!;
    }
    const smId = sa.stateMachineId || sa.type;
    const config = this.smConfigs[smId];
    if (config) {
      const sm = new StateMachine(config);
      this.subagentSMs.set(sa.id, sm);
      return sm;
    }
    return null;
  }

  // ─── Walkability Map ─────────────────────────────────────────────────────

  buildWalkabilityMap(): void {
    this.walkableTiles.clear();
    const blocked = new Set<string>();

    for (const t of this.state.tiles) {
      if (t.layer === 1 && (t.type === 'fence' || t.type === 'water')) {
        blocked.add(`${t.x},${t.y}`);
      }
      if (t.layer === 0 && t.type === 'water') {
        blocked.add(`${t.x},${t.y}`);
      }
      if (t.layer === 0) {
        this.walkableTiles.add(`${t.x},${t.y}`);
      }
    }

    for (const key of blocked) {
      this.walkableTiles.delete(key);
    }
  }

  /**
   * Rebuild spatial hash for plot lookups
   * Call this when plots change
   */
  rebuildPlotSpatialHash(): void {
    // Convert plots to spatial items (using tile coordinates)
    const plotItems = this.state.plots.map(p => ({
      ...p,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    }));

    this.plotSpatialHash.rebuild(plotItems as Plot[]);
  }

  /**
   * Get plot at tile coordinates using spatial hash (O(1))
   */
  getPlotAtTile(tileX: number, tileY: number, preferFiles: boolean = true): Plot | null {
    const results = this.plotSpatialHash.queryPoint(tileX, tileY);

    if (results.length === 0) return null;
    if (results.length === 1) return results[0];

    // If multiple plots overlap, prefer files over directories
    if (preferFiles) {
      const file = results.find(p => !p.isDirectory);
      if (file) return file;
    }

    // Return first match
    return results[0];
  }

  // ─── A* Pathfinding ──────────────────────────────────────────────────────

  findPath(sx: number, sy: number, ex: number, ey: number): { x: number; y: number }[] | null {
    const startKey = `${sx},${sy}`;
    const endKey = `${ex},${ey}`;

    if (startKey === endKey) return [];
    if (!this.walkableTiles.has(endKey)) return null;

    const open: Array<{ x: number; y: number; g: number; h: number; f: number }> = [
      { x: sx, y: sy, g: 0, h: 0, f: 0 }
    ];
    const closed = new Set<string>();
    const gScores = new Map<string, number>();
    const cameFrom = new Map<string, { x: number; y: number }>();
    gScores.set(startKey, 0);
    let iterations = 0;

    while (open.length > 0 && iterations < 2000) {
      iterations++;
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0];
      const key = `${current.x},${current.y}`;

      if (key === endKey) {
        // Reconstruct path by walking parent chain
        const path: { x: number; y: number }[] = [];
        let curr: { x: number; y: number } | null = { x: current.x, y: current.y };

        while (curr) {
          path.unshift(curr);
          const currKey = `${curr.x},${curr.y}`;
          curr = cameFrom.get(currKey) || null;
        }

        // Remove start position, return rest
        return path.slice(1);
      }

      closed.add(key);

      for (const [ndx, ndy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nx = current.x + ndx;
        const ny = current.y + ndy;
        const nKey = `${nx},${ny}`;
        if (closed.has(nKey) || !this.walkableTiles.has(nKey)) continue;
        const g = current.g + 1;
        if (gScores.has(nKey) && g >= gScores.get(nKey)!) continue;
        gScores.set(nKey, g);
        // Store parent reference for path reconstruction
        cameFrom.set(nKey, { x: current.x, y: current.y });

        const h = Math.abs(nx - ex) + Math.abs(ny - ey);
        open.push({ x: nx, y: ny, g, h, f: g + h });
      }
    }
    return null;
  }

  // ─── Agent Movement ───────────────────────────────────────────────────────

  updateAgentPosition(deltaTime: number): void {
    const agent = this.state.agent;
    if (!agent.isMoving) return;

    const speed = 0.08;
    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      agent.x = agent.targetX;
      agent.y = agent.targetY;

      if (this.agentPath.length > 0) {
        this.agentPath.shift();
        if (this.agentPath.length > 0) {
          agent.targetX = this.agentPath[0].x;
          agent.targetY = this.agentPath[0].y;
        } else {
          agent.isMoving = false;
          agent.animation = 'idle';
        }
      } else {
        agent.isMoving = false;
        agent.animation = 'idle';
      }
    } else {
      agent.x += dx * speed;
      agent.y += dy * speed;
      agent.animation = 'walk';

      if (Math.abs(dx) > Math.abs(dy)) {
        agent.direction = dx > 0 ? 'right' : 'left';
      } else {
        agent.direction = dy > 0 ? 'down' : 'up';
      }
    }
  }

  moveAgentTo(filePath: string): void {
    const agent = this.state.agent;

    // Cancel wandering
    this.wander.isWandering = false;
    this.wander.isPaused = false;
    this.wander.lastActivityTime = performance.now();

    // Transition wander SM to walking state
    if (this.wanderSM) {
      this.wanderSM.send('move_to_file');
    }

    // Find target plot
    let targetPlot = this.state.plots.find(p => !p.isDirectory && p.filePath === filePath);
    if (!targetPlot) {
      const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
      targetPlot = this.state.plots.find(p => p.isDirectory && p.filePath === dirPath);
    }
    if (!targetPlot) return;

    const destTileX = Math.floor(targetPlot.x + targetPlot.width / 2);
    const destTileY = Math.floor(targetPlot.y + targetPlot.height / 2);
    const startTileX = Math.floor(agent.x / TILE_SIZE);
    const startTileY = Math.floor(agent.y / TILE_SIZE);

    const path = this.findPath(startTileX, startTileY, destTileX, destTileY);
    if (path && path.length > 0) {
      this.agentPath = path.map(p => ({ x: (p.x + 0.5) * TILE_SIZE, y: (p.y + 0.5) * TILE_SIZE }));
      agent.targetX = this.agentPath[0].x;
      agent.targetY = this.agentPath[0].y;
      agent.isMoving = true;
    } else {
      this.agentPath = [];
      agent.targetX = (targetPlot.x + targetPlot.width / 2) * TILE_SIZE;
      agent.targetY = (targetPlot.y + targetPlot.height / 2) * TILE_SIZE;
      agent.isMoving = true;
    }
    agent.filePath = filePath;
  }

  // ─── Wander AI ────────────────────────────────────────────────────────────

  pickWanderTarget(): { x: number; y: number } | null {
    const agent = this.state.agent;
    const agentTileX = Math.floor(agent.x / TILE_SIZE);
    const agentTileY = Math.floor(agent.y / TILE_SIZE);
    const candidates: { tx: number; ty: number }[] = [];

    for (let dx = -this.wander.radius; dx <= this.wander.radius; dx++) {
      for (let dy = -this.wander.radius; dy <= this.wander.radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tx = agentTileX + dx;
        const ty = agentTileY + dy;
        if (this.walkableTiles.has(`${tx},${ty}`)) {
          candidates.push({ tx, ty });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Prefer path tiles
    const pathTiles = candidates.filter(c =>
      this.state.tiles.some(t => t.x === c.tx && t.y === c.ty && t.type === 'path')
    );
    const pool = pathTiles.length > 3 ? pathTiles : candidates;
    const choice = pool[Math.floor(Math.random() * pool.length)];

    return {
      x: (choice.tx + 0.5) * TILE_SIZE,
      y: (choice.ty + 0.5) * TILE_SIZE
    };
  }

  startWanderPath(target: { x: number; y: number } | null): boolean {
    if (!target) return false;
    const agent = this.state.agent;
    const startTX = Math.floor(agent.x / TILE_SIZE);
    const startTY = Math.floor(agent.y / TILE_SIZE);
    const endTX = Math.floor(target.x / TILE_SIZE);
    const endTY = Math.floor(target.y / TILE_SIZE);
    const path = this.findPath(startTX, startTY, endTX, endTY);

    if (path && path.length > 0) {
      this.agentPath = path.map(p => ({ x: (p.x + 0.5) * TILE_SIZE, y: (p.y + 0.5) * TILE_SIZE }));
      agent.targetX = this.agentPath[0].x;
      agent.targetY = this.agentPath[0].y;
      agent.isMoving = true;
      this.wander.isWandering = true;
      return true;
    }
    return false;
  }

  updateWander(now: number): void {
    const agent = this.state.agent;

    if (!this.wander.enabled || this.state.tiles.length === 0) return;

    // Use state machine if loaded
    if (this.wanderSM) {
      this.updateWanderSM(now);
      return;
    }

    // Legacy fallback: boolean flag wander
    if (agent.isMoving && !this.wander.isWandering) {
      this.wander.lastActivityTime = now;
      return;
    }

    if (this.wander.isPaused) {
      if (now >= this.wander.pauseUntil) {
        this.wander.isPaused = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (this.startWanderPath(this.pickWanderTarget())) break;
        }
      }
      return;
    }

    if (this.wander.isWandering && !agent.isMoving) {
      this.wander.isPaused = true;
      const pause = this.wander.pauseMin + Math.random() * (this.wander.pauseMax - this.wander.pauseMin);
      this.wander.pauseUntil = now + pause;
      agent.animation = 'idle';
      return;
    }

    if (!agent.isMoving && !this.wander.isWandering) {
      if (this.wander.lastActivityTime === 0) this.wander.lastActivityTime = now;
      if (now - this.wander.lastActivityTime >= this.wander.idleTimeout) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (this.startWanderPath(this.pickWanderTarget())) break;
        }
      }
    }
  }

  /**
   * State-machine-driven wander behavior
   */
  private updateWanderSM(now: number): void {
    const sm = this.wanderSM!;
    const agent = this.state.agent;
    const deltaMs = this.lastUpdateTime > 0 ? now - this.lastUpdateTime : 16;

    // If agent is doing directed movement (not wander), keep SM in a non-wander state
    if (agent.isMoving && sm.getCurrentStateId() === 'walking') {
      return;
    }

    // If agent was externally moved (tool event set state to investigating/writing/etc),
    // skip wander — the extension host SM handles those states
    const state = sm.getCurrentStateId();
    if (['investigating', 'writing', 'bashing', 'thinking', 'waiting', 'error', 'success'].includes(state)) {
      return;
    }

    // Send movement_complete event when agent stops moving
    if (!agent.isMoving && (state === 'wander-walking' || state === 'walking')) {
      sm.send('movement_complete');
    }

    // Advance timers for auto-transitions (idle→wander-walking, wander-paused→wander-walking)
    sm.update(deltaMs);

    const currentState = sm.getCurrentStateId();

    // Handle wander-walking: start a path if not already moving
    if (currentState === 'wander-walking' && !agent.isMoving) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.startWanderPath(this.pickWanderTarget())) break;
      }
      if (!agent.isMoving) {
        // Couldn't find a path, go back to paused
        sm.send('movement_complete');
      }
    }

    // Set animation from current state
    const animation = sm.getAnimation();
    if (animation) {
      agent.animation = animation as any;
    }
  }

  // ─── Subagent AI ──────────────────────────────────────────────────────────

  updateSubagents(now: number, animFrame: number): void {
    const deltaMs = this.lastUpdateTime > 0 ? now - this.lastUpdateTime : 16;

    for (const sa of this.state.subagents) {
      if (!sa.path) sa.path = [];

      if (animFrame % 20 === 0) {
        // Use animation resolver for frame count if available
        const animSetId = sa.animationSet || sa.type;
        const animName = sa.currentAnimation || (sa.isMoving ? 'walk' : 'idle');
        if (this.animResolver && this.animResolver.hasSet(animSetId)) {
          const frames = this.animResolver.getFrames(animSetId, animName);
          sa.frameIndex = (sa.frameIndex + 1) % (frames.length || 4);
        } else {
          sa.frameIndex = (sa.frameIndex + 1) % 4;
        }
      }

      // Try state-machine-driven behavior first
      const sm = this.ensureSubagentSM(sa);
      if (sm) {
        this.updateSubagentSM(sa, sm, now, deltaMs);
        continue;
      }

      // Legacy fallback: use ANIMAL_BEHAVIORS constant
      const behavior = ANIMAL_BEHAVIORS[sa.type] || ANIMAL_BEHAVIORS.chicken;
      this.updateSubagentLegacy(sa, behavior, now);
    }
  }

  /**
   * State-machine-driven subagent behavior
   */
  private updateSubagentSM(sa: SubagentState, sm: StateMachine, now: number, deltaMs: number): void {
    const state = sm.getCurrentState();
    const meta = state.metadata || {};

    // Movement update (same physics regardless of SM vs legacy)
    if (sa.isMoving) {
      const speed = 0.04 * ((meta.speed as number) || 1.0);
      this.moveSubagent(sa, speed);

      // Check if movement complete
      if (!sa.isMoving) {
        sm.send('movement_complete');
      }
    } else {
      // Advance SM timer when paused
      sm.update(deltaMs);

      // If state is "wandering" and we're not moving, start a path
      if (sm.getCurrentStateId() === 'wandering' && !sa.isMoving) {
        const wanderMeta = sm.getCurrentState().metadata || {};
        const radius = (wanderMeta.wanderRadius as number) || 5;
        const preferredTiles = (wanderMeta.preferredTiles as string[]) || undefined;

        const behaviorConfig: AnimalBehaviorConfig = {
          type: sa.type,
          behavior: 'wander',
          speed: (wanderMeta.speed as number) || 1.0,
          pauseMin: 1000,
          pauseMax: 3000,
          wanderRadius: radius,
          directionChangeChance: (wanderMeta.directionChangeChance as number) || 0.1,
          preferredTiles,
        };

        const tileX = Math.floor(sa.x / TILE_SIZE);
        const tileY = Math.floor(sa.y / TILE_SIZE);
        const candidates = this.findBehaviorTargetTiles(tileX, tileY, behaviorConfig);

        for (let attempt = 0; attempt < 3 && candidates.length > 0; attempt++) {
          const idx = Math.floor(Math.random() * candidates.length);
          const c = candidates[idx];
          const path = this.findPath(tileX, tileY, c.tx, c.ty);
          if (path && path.length > 0) {
            sa.path = path.map(p => ({ x: (p.x + 0.5) * TILE_SIZE, y: (p.y + 0.5) * TILE_SIZE }));
            sa.targetX = sa.path[0].x;
            sa.targetY = sa.path[0].y;
            sa.isMoving = true;
            break;
          }
          candidates.splice(idx, 1);
        }
      }
    }
  }

  /**
   * Legacy subagent behavior (used when no state machine config available)
   */
  private updateSubagentLegacy(sa: SubagentState, behavior: AnimalBehaviorConfig, now: number): void {
    if (sa.isMoving) {
      const speed = 0.04 * behavior.speed;
      this.moveSubagent(sa, speed);

      if (!sa.isMoving) {
        const pauseDuration = behavior.pauseMin + Math.random() * (behavior.pauseMax - behavior.pauseMin);
        sa.pauseUntil = now + pauseDuration;
      }
    } else if (now >= sa.pauseUntil) {
      const tileX = Math.floor(sa.x / TILE_SIZE);
      const tileY = Math.floor(sa.y / TILE_SIZE);
      const candidates = this.findBehaviorTargetTiles(tileX, tileY, behavior);

      for (let attempt = 0; attempt < 3 && candidates.length > 0; attempt++) {
        const idx = Math.floor(Math.random() * candidates.length);
        const c = candidates[idx];
        const path = this.findPath(tileX, tileY, c.tx, c.ty);
        if (path && path.length > 0) {
          sa.path = path.map(p => ({ x: (p.x + 0.5) * TILE_SIZE, y: (p.y + 0.5) * TILE_SIZE }));
          sa.targetX = sa.path[0].x;
          sa.targetY = sa.path[0].y;
          sa.isMoving = true;
          break;
        }
        candidates.splice(idx, 1);
      }
    }
  }

  /**
   * Shared subagent movement physics
   */
  private moveSubagent(sa: SubagentState, speed: number): void {
    const dx = sa.targetX - sa.x;
    const dy = sa.targetY - sa.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      sa.x = sa.targetX;
      sa.y = sa.targetY;

      if (sa.path.length > 0) {
        sa.path.shift();
        if (sa.path.length > 0) {
          sa.targetX = sa.path[0].x;
          sa.targetY = sa.path[0].y;
        } else {
          sa.isMoving = false;
        }
      } else {
        sa.isMoving = false;
      }
    } else {
      sa.x += (dx / dist) * speed;
      sa.y += (dy / dist) * speed;

      if (Math.abs(dx) > Math.abs(dy)) {
        sa.direction = dx > 0 ? 'right' : 'left';
      } else {
        sa.direction = dy > 0 ? 'down' : 'up';
      }
    }
  }

  /**
   * Find candidate tiles based on animal behavior preferences
   */
  private findBehaviorTargetTiles(tileX: number, tileY: number, behavior: AnimalBehaviorConfig): { tx: number; ty: number }[] {
    const candidates: { tx: number; ty: number; priority: number }[] = [];
    const radius = behavior.wanderRadius;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        const key = `${tx},${ty}`;

        if (!this.walkableTiles.has(key)) continue;

        let priority = 1;

        // Check if this tile matches preferred tiles
        if (behavior.preferredTiles && behavior.preferredTiles.length > 0) {
          const tile = this.state.tiles.find(t => t.x === tx && t.y === ty && t.layer === 0);
          if (tile && behavior.preferredTiles.includes(tile.type)) {
            priority = 3; // Higher priority for preferred tiles
          }
        }

        candidates.push({ tx, ty, priority });
      }
    }

    // Sort by priority (higher first) and shuffle within same priority
    candidates.sort((a, b) => b.priority - a.priority);

    // Return top candidates with some randomization
    const highPriority = candidates.filter(c => c.priority > 1);
    const normalPriority = candidates.filter(c => c.priority === 1);

    // Shuffle both arrays
    this.shuffleArray(highPriority);
    this.shuffleArray(normalPriority);

    // Prefer high priority tiles (70% chance to pick from high priority if available)
    if (highPriority.length > 0 && (normalPriority.length === 0 || Math.random() < 0.7)) {
      return highPriority;
    }
    return normalPriority;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // ─── Particle System ──────────────────────────────────────────────────────

  emitWriteSparkles(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 0.3 + Math.random() * 0.5;
      this.state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        startTime: performance.now(),
        duration: 800 + Math.random() * 400,
        color: [255, 236, 39],
        size: 1 + Math.random(),
      });
    }
  }

  emitDustPuff(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const spread = (Math.random() - 0.5) * 0.4;
      this.state.particles.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + 6,
        vx: spread,
        vy: -0.1 - Math.random() * 0.2,
        startTime: performance.now(),
        duration: 400 + Math.random() * 200,
        color: [180, 160, 120],
        size: 1 + Math.random() * 0.5,
      });
    }
  }

  updateParticles(now: number): void {
    for (let i = this.state.particles.length - 1; i >= 0; i--) {
      const p = this.state.particles[i];
      const elapsed = now - p.startTime;
      if (elapsed > p.duration) {
        this.state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  // ─── Weather System ────────────────────────────────────────────────────────

  setWeather(type: WeatherType, intensity: number = 0.5): void {
    this.weather.current = type;
    this.weather.intensity = Math.max(0, Math.min(1, intensity));
    this.weather.particles = []; // Clear existing particles
  }

  updateWeather(deltaTime: number, worldWidth: number, worldHeight: number): void {
    if (!this.weather.enabled || this.weather.current === 'clear') {
      this.weather.particles = [];
      return;
    }

    const maxParticles = Math.floor(100 * this.weather.intensity);
    const pixelW = worldWidth * TILE_SIZE;
    const pixelH = worldHeight * TILE_SIZE;

    // Spawn new particles
    while (this.weather.particles.length < maxParticles) {
      const isRain = this.weather.current === 'rain' || this.weather.current === 'storm';
      const isSnow = this.weather.current === 'snow';

      this.weather.particles.push({
        x: Math.random() * pixelW,
        y: -10,
        speed: isRain ? 3 + Math.random() * 2 : isSnow ? 0.5 + Math.random() * 0.5 : 1,
        type: isRain ? 'rain' : 'snow',
        size: isRain ? 1 : 2 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.4,
        drift: isSnow ? (Math.random() - 0.5) * 0.5 : 0,
      });
    }

    // Update existing particles
    for (let i = this.weather.particles.length - 1; i >= 0; i--) {
      const p = this.weather.particles[i];

      // Move particle
      p.y += p.speed;
      p.x += this.weather.windDirection * 0.5 + (p.drift || 0);

      // Snow drifts side to side
      if (p.type === 'snow') {
        p.x += Math.sin(p.y * 0.05) * 0.3;
      }

      // Remove particles that are off screen
      if (p.y > pixelH || p.x < -10 || p.x > pixelW + 10) {
        this.weather.particles.splice(i, 1);
      }
    }
  }

  // ─── Tile Animations ──────────────────────────────────────────────────────

  registerTileAnimations(): void {
    this.tileAnimations.clear();
    if (!this.manifest || !this.manifest.animations) return;

    for (const tile of this.state.tiles) {
      if (tile.type === 'water') {
        const key = `${tile.x},${tile.y}`;
        const waterAnim = this.manifest.animations['water-flow'];
        if (waterAnim) {
          const startFrame = Math.abs((tile.x * 3 + tile.y * 7) % waterAnim.frames.length);
          this.tileAnimations.set(key, {
            frames: waterAnim.frames.map(f => 'water/' + f),
            fps: waterAnim.fps,
            currentFrame: startFrame,
            timer: 0,
            loop: waterAnim.loop,
          });
        }
      }
    }
  }

  updateAnimations(deltaTime: number): void {
    for (const anim of this.tileAnimations.values()) {
      anim.timer += deltaTime;
      const frameTime = 1000 / anim.fps;
      if (anim.timer >= frameTime) {
        anim.timer -= frameTime;
        if (anim.currentFrame < anim.frames.length - 1) {
          anim.currentFrame++;
        } else if (anim.loop) {
          anim.currentFrame = 0;
        }
      }
    }
  }

  getAnimatedSpriteId(tile: Tile): string {
    const key = `${tile.x},${tile.y}`;
    const anim = this.tileAnimations.get(key);
    if (anim) {
      return anim.frames[anim.currentFrame];
    }
    return tile.spriteId;
  }

  // ─── Growth Effects ───────────────────────────────────────────────────────

  detectGrowthChanges(now: number): void {
    for (const plot of this.state.plots) {
      if (plot.isDirectory) continue;
      const prevStage = this.previousPlotStages.get(plot.filePath);
      if (prevStage !== undefined && plot.growthStage > prevStage) {
        this.state.growthEffects.push({
          x: plot.x,
          y: plot.y,
          startTime: now,
          stage: plot.growthStage
        });
      }
      this.previousPlotStages.set(plot.filePath, plot.growthStage);
    }
  }

  updateGrowthEffects(now: number): void {
    for (let i = this.state.growthEffects.length - 1; i >= 0; i--) {
      const effect = this.state.growthEffects[i];
      if (now - effect.startTime > GROWTH_EFFECT_DURATION) {
        this.state.growthEffects.splice(i, 1);
      }
    }
  }

  // ─── Main Update ──────────────────────────────────────────────────────────

  update(deltaTime: number, now: number, animFrame: number, worldWidth?: number, worldHeight?: number): void {
    this.updateAgentPosition(deltaTime);
    this.updateWander(now);
    this.updateSubagents(now, animFrame);
    this.updateParticles(now);
    this.updateAnimations(deltaTime);
    this.updateGrowthEffects(now);
    this.updateTileStateMachines(deltaTime);
    this.lastUpdateTime = now;

    // Update weather if world dimensions are provided
    if (worldWidth !== undefined && worldHeight !== undefined) {
      this.updateWeather(deltaTime, worldWidth, worldHeight);
    }
  }

  // ─── State Updates ────────────────────────────────────────────────────────

  setTiles(tiles: Tile[]): void {
    this.state.tiles = tiles;
    this.buildWalkabilityMap();
    this.registerTileAnimations();
    this.initTileStateMachines();
  }

  // ─── Tile State Machines ─────────────────────────────────────────────────

  /**
   * Initialize state machines for tiles that have a stateMachineId.
   * Called when tiles are loaded/reloaded.
   */
  private initTileStateMachines(): void {
    this.tileSMs.clear();
    this.tileSMDirty.clear();

    for (const tile of this.state.tiles) {
      if (!tile.stateMachineId) continue;

      const config = this.smConfigs[tile.stateMachineId];
      if (!config) {
        console.warn(`[Engine] Tile SM config not found: ${tile.stateMachineId}`);
        continue;
      }

      const key = `${tile.x},${tile.y},${tile.layer}`;
      const sm = new StateMachine(config);

      // Desynchronize timers: use position-based hash so identical SMs
      // don't all transition at the same instant
      const initialDuration = config.states.find(s => s.id === config.initialState)?.duration;
      if (initialDuration && initialDuration > 0) {
        const hash = ((tile.x * 37 + tile.y * 59) & 0x7fffffff) / 0x7fffffff;
        const offsetMs = hash * initialDuration;
        sm.update(offsetMs);
      }

      // Track transitions to mark dirty sprites
      const transitionHandler = (event: { to: { spriteOverride?: string } }) => {
        const newSprite = event.to.spriteOverride;
        if (newSprite) {
          this.tileSMDirty.set(key, newSprite);
        }
      };
      sm.onTransition(transitionHandler);

      this.tileSMs.set(key, sm);
    }

    if (this.tileSMs.size > 0) {
      console.log(`[Engine] Initialized ${this.tileSMs.size} tile state machines`);
    }
  }

  /**
   * Advance all tile state machines. Called every frame from update().
   */
  private updateTileStateMachines(deltaMs: number): void {
    if (this.tileSMs.size === 0) return;
    this.tileSMDirty.clear();
    for (const sm of this.tileSMs.values()) {
      sm.update(deltaMs);
    }
  }

  /**
   * Get tiles whose sprite changed this frame due to state machine transitions.
   * Returns a map of "x,y,layer" → new spriteId.
   */
  getDirtyTileSMs(): Map<string, string> {
    return this.tileSMDirty;
  }

  /**
   * Send an event to a specific tile's state machine (for future use: doors, etc.)
   */
  sendTileEvent(x: number, y: number, layer: number, event: string): boolean {
    const key = `${x},${y},${layer}`;
    const sm = this.tileSMs.get(key);
    if (!sm) return false;
    return sm.send(event);
  }

  setPlots(plots: Plot[]): void {
    this.state.plots = plots;
    this.detectGrowthChanges(performance.now());
  }

  setManifest(manifest: { animations?: Record<string, { frames: string[]; fps: number; loop: boolean }> }): void {
    this.manifest = manifest;
  }

  loadAnimationSets(sets: Record<string, AnimationSetDef>): void {
    this.animResolver = new AnimationResolver(sets);
    console.log(`[Engine] Animation sets loaded: ${Object.keys(sets).join(', ')}`);
  }

  getAnimationResolver(): AnimationResolver | null {
    return this.animResolver;
  }

  spawnSubagent(
    id: string,
    type: string,
    config?: {
      agentType?: string;
      displayName?: string;
      tint?: string | null;
      stateMachineId?: string;
    }
  ): void {
    const target = this.pickWanderTarget() || { x: this.state.agent.x, y: this.state.agent.y };
    this.state.subagents.push({
      id,
      type: type || 'chicken',
      x: target.x,
      y: target.y,
      targetX: target.x,
      targetY: target.y,
      isMoving: false,
      frameIndex: 0,
      direction: 'down',
      pauseUntil: performance.now() + 1000,
      path: [],
      agentType: config?.agentType,
      displayName: config?.displayName,
      tint: config?.tint,
      stateMachineId: config?.stateMachineId,
    });
  }

  despawnSubagent(id: string): void {
    this.state.subagents = this.state.subagents.filter(s => s.id !== id);
    this.subagentSMs.delete(id);
  }
}
