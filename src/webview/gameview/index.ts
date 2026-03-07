/**
 * GameView Webview Entry Point
 *
 * This module is the entry point for the webview game rendering.
 * It initializes the game engine, renderer, and handles message passing
 * with the extension host.
 */

import { GameEngine, SPRITE_COLORS, ANIMATIONS } from './engine';
import { Camera } from './camera';
import { PhaserRenderer } from './phaser-renderer';
import {
  Renderer,
  WebviewAssetData,
  GameState,
  Tile,
  Plot,
  AgentState,
  Particle,
  GrowthEffect,
  TILE_SIZE,
  ActivityEntry,
} from './types';
import { StateMachine } from '../../state-machine/StateMachine';
import type { StateMachineConfig, AgentTypeConfig } from '../../state-machine/types';

// ─── Configuration ────────────────────────────────────────────────────────

const GROWTH_EFFECT_DURATION = 1000;

// ─── Global State ──────────────────────────────────────────────────────────

let engine: GameEngine;
let camera: Camera;
let renderer: Renderer;
let canvas: HTMLCanvasElement;
let hudCanvas: HTMLCanvasElement;
let hudCtx: CanvasRenderingContext2D | null;

// Animation state
let animFrame = 0;
let glowPhase = 0;

// UI elements
let mapWrapper: HTMLElement;
let mapEmpty: HTMLElement;
let mapStats: HTMLElement;
let tooltip: HTMLElement;
let tooltipName: HTMLElement;
let tooltipPath: HTMLElement;
let logFeed: HTMLElement;
let toolsGrid: HTMLElement;
let rendererBadge: HTMLElement;

// Interaction state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;
let hoveredPlot: Plot | null = null;

// Highlight state
let highlightSpriteId: string | null = null;

// ─── Initialization ────────────────────────────────────────────────────────

export async function initGameView(options: {
  canvas: HTMLCanvasElement;
  hudCanvas: HTMLCanvasElement;
  mapWrapper: HTMLElement;
  mapEmpty: HTMLElement;
  mapStats: HTMLElement;
  tooltip: HTMLElement;
  tooltipName: HTMLElement;
  tooltipPath: HTMLElement;
  logFeed: HTMLElement;
  toolsGrid: HTMLElement;
  rendererBadge: HTMLElement;
}): Promise<void> {
  canvas = options.canvas;
  hudCanvas = options.hudCanvas;
  mapWrapper = options.mapWrapper;
  mapEmpty = options.mapEmpty;
  mapStats = options.mapStats;
  tooltip = options.tooltip;
  tooltipName = options.tooltipName;
  tooltipPath = options.tooltipPath;
  logFeed = options.logFeed;
  toolsGrid = options.toolsGrid;
  rendererBadge = options.rendererBadge;

  // Only get 2D context for HUD canvas - main canvas is used by PixiJS
  hudCtx = hudCanvas.getContext('2d');
  if (hudCtx) hudCtx.imageSmoothingEnabled = false;

  // Initialize engine and camera
  engine = new GameEngine();
  camera = new Camera();

  // Initialize Phaser renderer
  renderer = new PhaserRenderer();
  await renderer.init(canvas);
  console.log('[GameView] Using Phaser 3 renderer');
  rendererBadge.textContent = 'Phaser';
  rendererBadge.classList.add('phaser');

  // Set up the update callback for Phaser game loop
  (renderer as PhaserRenderer).setUpdatesPerFrame((deltaTime: number) => {
    // Update game state
    const now = performance.now();
    engine.update(deltaTime * 16.67, now, animFrame, engine.state.worldWidth, engine.state.worldHeight); // Convert to ms equivalent

    // Update agent animation frame
    if (animFrame % 15 === 0) {
      const agent = engine.state.agent;
      const animDef = ANIMATIONS[agent.animation as keyof typeof ANIMATIONS];
      if (animDef) {
        agent.frameIndex = (agent.frameIndex + 1) % animDef.length;
      }
    }

    // Emit dust while walking using Phaser particles
    if (engine.state.agent.isMoving && animFrame % 10 === 0) {
      (renderer as PhaserRenderer).emitDust(engine.state.agent.x, engine.state.agent.y + 6);
    }

    // Update normal map lighting (agent torch + day/night)
    const agent = engine.state.agent;
    (renderer as PhaserRenderer).setAgentLightPosition(agent.x, agent.y);
    (renderer as PhaserRenderer).updateLighting();

    // Render HUD (separate from PixiJS)
    drawHudSprite();

    // Render game world (dynamic objects only - tiles are cached)
    if (engine.state.tiles.length > 0) {
      renderMap();
    }

    animFrame++;
    glowPhase += 0.02;
  });

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => resizeMapCanvas());
  resizeObserver.observe(mapWrapper);

  // Set up input handlers
  setupInputHandlers();

  // Set up message handler
  setupMessageHandler();

  // Start the Phaser game loop
  (renderer as PhaserRenderer).startTicker();

  console.log('[GameView] Initialized with Phaser 3');
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function renderMap(): void {
  const worldWidth = engine.state.worldWidth;
  const worldHeight = engine.state.worldHeight;
  const worldPixelW = worldWidth > 0 ? worldWidth * TILE_SIZE : 400;
  const worldPixelH = worldHeight > 0 ? worldHeight * TILE_SIZE : 300;
  const baseScale = Math.min(canvas.width / worldPixelW, canvas.height / worldPixelH);
  const totalScale = camera.state.zoom * baseScale;

  // Begin frame - clears dynamic objects only, static tiles remain
  renderer.beginFrame();

  // Apply camera transform
  renderer.setTransform(camera.state.panX, camera.state.panY, camera.state.zoom);

  // Update day/night cycle lighting
  (renderer as PhaserRenderer).updateDayNightCycle(worldWidth, worldHeight);

  // Draw highlight overlays for matching sprites (on static tiles)
  if (highlightSpriteId) {
    for (const tile of engine.state.tiles) {
      const spriteId = engine.getAnimatedSpriteId(tile);
      if (spriteId === highlightSpriteId) {
        const glowAlpha = 0.3 + Math.sin(glowPhase * 3) * 0.2;
        renderer.drawRect(
          tile.x * TILE_SIZE - 1,
          tile.y * TILE_SIZE - 1,
          TILE_SIZE + 2,
          TILE_SIZE + 2,
          '#ffc800',
          glowAlpha
        );
      }
    }
  }

  // Draw directory labels (dynamic, not cached)
  for (const plot of engine.state.plots) {
    if (plot.isDirectory && plot.filePath) {
      const label = plot.filePath.split('/').pop() || '';
      if (label && plot.width >= 3) {
        const maxChars = Math.floor((plot.width * TILE_SIZE - 4) / 5);
        const truncLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + '~' : label;
        renderer.drawText(truncLabel, plot.x * TILE_SIZE + 3, plot.y * TILE_SIZE + 10, '#8a8a8a', 7);
      }
    }
  }

  // Draw agent
  drawAgent();

  // Draw subagents (with optional tint and name labels)
  const animResolver = engine.getAnimationResolver();
  for (const sa of engine.state.subagents) {
    // Resolve sprite ID through animation sets if available
    let spriteId: string;
    const animSetId = sa.animationSet || sa.type;
    const animName = sa.currentAnimation || (sa.isMoving ? 'walk' : 'idle');

    if (animResolver && animResolver.hasSet(animSetId)) {
      const frames = animResolver.getFrames(animSetId, animName);
      const frameIdx = sa.frameIndex % (frames.length || 1);
      const sheet = animResolver.getSpritesheet(animSetId) || sa.type;
      spriteId = `${sheet}/${frames[frameIdx] || `${sa.type}-0`}`;
    } else {
      spriteId = `${sa.type}/${sa.type}-${sa.frameIndex}`;
    }

    // Apply tint if available
    if (sa.tint) {
      (renderer as PhaserRenderer).drawSpriteTinted?.(spriteId, sa.x - 8, sa.y - 8, 16, 16, sa.tint);
    } else {
      renderer.drawSprite(spriteId, sa.x - 8, sa.y - 8, 16, 16);
    }

    // Draw name label above sprite
    if (sa.displayName) {
      renderer.drawText(sa.displayName, sa.x, sa.y - 14, sa.tint || '#ffffff', 7);
    }
  }

  // Draw growth effects using Phaser particles
  for (const effect of engine.state.growthEffects) {
    const cx = (effect.x + 0.5) * TILE_SIZE;
    const cy = (effect.y + 0.5) * TILE_SIZE;
    (renderer as PhaserRenderer).emitGrowth(cx, cy);
  }

  // Particles and weather are now handled by Phaser's particle system
  // No need to manually draw them here

  // Draw hover highlight
  if (hoveredPlot) {
    renderer.drawRect(
      hoveredPlot.x * TILE_SIZE,
      hoveredPlot.y * TILE_SIZE,
      hoveredPlot.width * TILE_SIZE,
      hoveredPlot.height * TILE_SIZE,
      '#ffffff',
      0.15
    );
  }

  renderer.endFrame();
}

function drawAgent(): void {
  const agent = engine.state.agent;
  const action = agent.animation || 'idle';
  const dir = agent.direction || 'down';

  // Use Phaser-based agent sprite with animations
  (renderer as PhaserRenderer).updateAgentSprite(agent.x, agent.y, action, dir);

  // Draw cursor indicator (glow effect around agent)
  const cursorAlpha = 0.5 + Math.sin(glowPhase * 5) * 0.3;
  renderer.drawRect(agent.x - 8, agent.y - 12, 16, 24, '#ffec27', cursorAlpha);
}

function drawHudSprite(): void {
  if (!hudCtx) return;

  const agent = engine.state.agent;
  const colors = SPRITE_COLORS[agent.type] || SPRITE_COLORS.ranger;
  const animDef = ANIMATIONS[agent.animation as keyof typeof ANIMATIONS];
  const frame = animDef ? animDef[agent.frameIndex % animDef.length] : { bodyY: 0, eyeY: 0 };
  const s = 4;

  hudCtx.clearRect(0, 0, 64, 64);
  hudCtx.save();
  hudCtx.translate(32, 32 + frame.bodyY);

  // Body
  hudCtx.fillStyle = colors.primary;
  hudCtx.fillRect(-8 * s, -10 * s, 16 * s, 20 * s);

  // Head
  hudCtx.fillRect(-6 * s, -18 * s, 12 * s, 10 * s);

  // Eyes
  hudCtx.fillStyle = '#1a1c2c';
  hudCtx.fillRect(-4 * s, (-14 + (frame.eyeY || 0)) * s, 2 * s, 2 * s);
  hudCtx.fillRect(2 * s, (-14 + (frame.eyeY || 0)) * s, 2 * s, 2 * s);

  // Accent
  hudCtx.fillStyle = colors.accent;
  hudCtx.fillRect(8 * s, -6 * s, 2 * s, 10 * s);

  hudCtx.restore();
}

function resizeMapCanvas(): void {
  const rect = mapWrapper.getBoundingClientRect();
  canvas.width = Math.max(100, rect.width);
  canvas.height = Math.max(100, rect.height);

  renderer.resize(canvas.width, canvas.height);
}

// ─── Input Handling ────────────────────────────────────────────────────────

function setupInputHandlers(): void {
  mapWrapper.addEventListener('mousemove', (e) => {
    if (isPanning) {
      camera.pan(e.clientX - panStartX, e.clientY - panStartY);
      panStartX = e.clientX;
      panStartY = e.clientY;
      return;
    }

    const plot = getPlotAtPoint(e.clientX, e.clientY);
    if (plot && plot !== hoveredPlot) {
      hoveredPlot = plot;
      const name = plot.filePath ? plot.filePath.split('/').pop() || '' : '';
      tooltipName.textContent = name;
      tooltipPath.textContent = plot.filePath || '';
      tooltip.style.display = 'block';
    } else if (!plot && hoveredPlot) {
      hoveredPlot = null;
      tooltip.style.display = 'none';
    }

    if (plot) {
      const rect = mapWrapper.getBoundingClientRect();
      // Offset by a full tile to ensure hovered tile remains visible
      const offset = TILE_SIZE * camera.state.zoom;
      let tx = e.clientX - rect.left + offset;
      let ty = e.clientY - rect.top + offset;
      // Flip to left if too close to right edge
      if (tx + 200 > rect.width) tx = e.clientX - rect.left - 210;
      // Flip above if too close to bottom edge
      if (ty + 80 > rect.height) ty = e.clientY - rect.top - 80 - offset;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    }
  });

  mapWrapper.addEventListener('mouseleave', () => {
    hoveredPlot = null;
    tooltip.style.display = 'none';
  });

  mapWrapper.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartPanX = camera.state.panX;
      panStartPanY = camera.state.panY;
    }
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
  });

  mapWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    camera.zoomAt(mx, my, delta);
  }, { passive: false });
}

function getPlotAtPoint(clientX: number, clientY: number): Plot | null {
  const rect = canvas.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;

  // Use Phaser's built-in coordinate conversion for accuracy
  const worldPos = (renderer as PhaserRenderer).screenToWorld(screenX, screenY);
  if (!worldPos) return null;

  // Convert to tile coords for spatial hash lookup
  const tileX = Math.floor(worldPos.x / TILE_SIZE);
  const tileY = Math.floor(worldPos.y / TILE_SIZE);

  // Use spatial hash for O(1) lookup (prefers files over directories)
  return engine.getPlotAtTile(tileX, tileY, true);
}

// ─── Message Handling ───────────────────────────────────────────────────────

function setupMessageHandler(): void {
  window.addEventListener('message', async (event) => {
    const message = event.data;

    switch (message.type) {
      case 'loadAssets':
        if (message.assets) {
          await loadAssets(message.assets);
        }
        break;

      case 'refreshAssets':
        // Force reload all assets (from SpriteConfigPanel updates)
        if (message.assets) {
          await (renderer as PhaserRenderer).refreshAssets(message.assets);
          // Re-set tiles to pick up new sprite definitions
          if (engine.state.tiles.length > 0) {
            (renderer as any).setTiles(engine.state.tiles);
          }
        }
        break;

      case 'updateMap':
        if (message.assets) {
          await loadAssets(message.assets);
        }
        handleMapUpdate(message.layout, message.world);
        break;

      case 'moveAgent':
        engine.moveAgentTo(message.filePath);
        break;

      case 'addActivity':
        addActivityEntry(message.entry);
        break;

      case 'updateBudget':
        updateBudget(message.tokens, message.cost, message.percentage);
        break;

      case 'setAnimation':
        engine.state.agent.animation = message.animation;
        engine.wander.lastActivityTime = performance.now();
        engine.wander.isWandering = false;
        engine.wander.isPaused = false;
        engine.agentPath = [];
        if (message.animation === 'write') {
          (renderer as PhaserRenderer).emitSparkles(engine.state.agent.x, engine.state.agent.y - 4);
        }
        break;

      case 'updateConfig':
        handleConfigUpdate(message.config);
        break;

      case 'updateSessionTotal':
        engine.state.sessionTokens = message.tokens;
        engine.state.sessionCost = message.cost;
        updateSessionDisplay();
        break;

      case 'resetSession':
        engine.state.sessionTokens = 0;
        engine.state.sessionCost = 0;
        updateSessionDisplay();
        break;

      case 'highlightSprite':
        highlightSpriteId = message.spriteId || null;
        break;

      case 'spawnSubagent':
        engine.spawnSubagent(message.id, message.agentType, {
          agentType: message.agentType,
          displayName: message.displayName,
          tint: message.tint,
          stateMachineId: message.stateMachineId,
        });
        break;

      case 'despawnSubagent':
        engine.despawnSubagent(message.id);
        break;

      case 'updateLighting':
        if ((renderer as any).updateLightingConfig) {
          (renderer as any).updateLightingConfig(message.config);
        }
        break;

      case 'updateContextFarm':
        handleContextFarmUpdate(message.state);
        break;

      case 'updateStateMachines':
        engine.loadStateMachineConfigs(
          message.machines as Record<string, StateMachineConfig>,
          message.agentTypes as Record<string, AgentTypeConfig>
        );
        break;

      case 'updateAnimationSets':
        engine.loadAnimationSets(message.sets);
        break;
    }
  });
}

async function loadAssets(assets: WebviewAssetData): Promise<void> {
  await renderer.loadSpritesheets(assets);

  if ((assets as any).manifest) {
    engine.setManifest((assets as any).manifest);
  }

  if (assets.animationSets) {
    engine.loadAnimationSets(assets.animationSets);
  }
}

function handleMapUpdate(layout: any, world: any): void {
  if (world) {
    engine.state.tiles = world.tiles || [];
    engine.state.plots = world.plots || [];
    engine.state.worldWidth = world.width || 0;
    engine.state.worldHeight = world.height || 0;

    engine.buildWalkabilityMap();
    engine.rebuildPlotSpatialHash(); // O(1) lookups
    engine.registerTileAnimations();
    engine.detectGrowthChanges(performance.now());

    // Set static tiles once (optimized - not every frame)
    if (renderer && 'setTiles' in renderer) {
      (renderer as any).setTiles(engine.state.tiles);
      console.log('[GameView] Static tiles cached:', engine.state.tiles.length);
    }
  }

  mapStats.textContent = (layout?.fileCount || engine.state.plots.length) + ' files';

  // Initialize agent position
  if (!engine.state.agent.filePath && engine.state.plots.length > 0) {
    const firstFile = engine.state.plots.find(p => !p.isDirectory);
    if (firstFile) {
      engine.state.agent.x = (firstFile.x + firstFile.width / 2) * TILE_SIZE;
      engine.state.agent.y = (firstFile.y + firstFile.height / 2) * TILE_SIZE;
      engine.state.agent.filePath = firstFile.filePath;
    }
  }

  if (engine.state.tiles.length > 0) {
    mapEmpty.style.display = 'none';
    canvas.style.display = 'block';
    resizeMapCanvas();
  }
}

function handleConfigUpdate(config: any): void {
  engine.state.config = config;

  if (config.model) {
    if (config.model.includes('opus')) {
      engine.state.agent.type = 'knight';
    } else if (config.model.includes('haiku')) {
      engine.state.agent.type = 'rogue';
    } else {
      engine.state.agent.type = 'ranger';
    }
    document.getElementById('sprite-name')!.textContent = SPRITE_COLORS[engine.state.agent.type].name;
  }

  document.getElementById('model-name')!.textContent = config.model || 'Unknown';

  if (config.tools && config.tools.length > 0) {
    toolsGrid.innerHTML = config.tools.slice(0, 12).map((tool: string) =>
      `<span class="tool-chip">${formatToolName(tool)}</span>`
    ).join('');
  } else {
    toolsGrid.innerHTML = '<div class="tool-chip">No tools</div>';
  }
}

function addActivityEntry(entry: ActivityEntry): void {
  const div = document.createElement('div');
  div.className = 'log-entry' + ((entry as any).isError ? ' error' : '');

  const icon = getActivityIcon((entry as any).icon);
  const tokens = entry.tokens ? '+' + formatTokens(entry.tokens) : '';

  div.innerHTML = `
    <div class="log-entry-header">
      <span class="log-entry-icon">${icon} ${entry.type || ''}</span>
      <span class="log-entry-tokens">${tokens}</span>
    </div>
    <div class="log-entry-detail">${entry.detail || ''}</div>
  `;

  logFeed.appendChild(div);
  logFeed.scrollTop = logFeed.scrollHeight;

  while (logFeed.children.length > 50) {
    logFeed.removeChild(logFeed.firstChild!);
  }
}

function updateBudget(tokens: number, cost: number, percentage: number): void {
  engine.state.budget = { tokens, cost, percentage };

  const bar = document.getElementById('budget-bar') as HTMLElement;
  bar.style.width = percentage + '%';
  bar.className = 'stat-bar-fill' + (percentage >= 80 ? ' danger' : percentage >= 60 ? ' warning' : '');
  document.getElementById('budget-percent')!.textContent = percentage.toFixed(1) + '%';
  document.getElementById('total-tokens')!.textContent = formatTokens(tokens) + ' tokens';
  document.getElementById('total-cost')!.textContent = '$' + cost.toFixed(4);
}

function updateSessionDisplay(): void {
  document.getElementById('session-tokens')!.textContent = formatTokens(engine.state.sessionTokens);
  (document.getElementById('session-bar') as HTMLElement).style.width =
    Math.min(100, (engine.state.sessionTokens / 100000) * 100) + '%';
}

function handleContextFarmUpdate(state: any): void {
  // Update water tower gauge
  const fillPercentage = state.fillPercentage || 0;
  const waterTowerBar = document.getElementById('session-bar') as HTMLElement;
  if (waterTowerBar) {
    waterTowerBar.style.width = fillPercentage + '%';
    waterTowerBar.className = 'stat-bar-fill' +
      (fillPercentage >= 90 ? ' danger' : fillPercentage >= 70 ? ' warning' : '');
  }

  // Update session tokens display with context farm tokens
  const tokensDisplay = document.getElementById('session-tokens');
  if (tokensDisplay) {
    tokensDisplay.textContent = formatTokens(state.totalTokens || 0);
  }

  // Update weather based on state
  if (state.weather && renderer) {
    const weatherType = state.weather === 'sunny' ? 'clear' :
                        state.weather === 'overcast' ? 'rain' : 'storm';
    engine.setWeather(weatherType, fillPercentage / 100);
    (renderer as PhaserRenderer).setWeather(weatherType, fillPercentage / 100);
  }

  // TODO: Update bug overlays on plots when visualization is implemented
  // state.bugs contains BugInstance[] with filePath, type, errorMessage
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function formatToolName(tool: string): string {
  return tool.replace(/([A-Z])/g, ' $1').trim();
}

function getActivityIcon(icon: string | undefined): string {
  const icons: Record<string, string> = {
    read: '📖',
    write: '✏️',
    edit: '✏️',
    bash: '💻',
    glob: '🔍',
    grep: '🔍',
    default: '⚡'
  };
  return icons[icon || ''] || icons.default;
}

// Export for webpack UMD
(window as any).initGameView = initGameView;
