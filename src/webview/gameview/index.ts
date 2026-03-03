/**
 * GameView Webview Entry Point
 *
 * This module is the entry point for the webview game rendering.
 * It initializes the game engine, renderer, and handles message passing
 * with the extension host.
 */

import { GameEngine, SPRITE_COLORS, ANIMATIONS } from './engine';
import { Camera } from './camera';
import { PixiRenderer } from './pixi-renderer';
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

  // Initialize PixiJS renderer
  renderer = new PixiRenderer();
  await renderer.init(canvas);
  console.log('[GameView] Using PixiJS renderer');
  rendererBadge.textContent = 'WebGL';
  rendererBadge.classList.add('pixi');

  // Set up the update callback for PixiJS Ticker
  // This replaces manual requestAnimationFrame
  (renderer as PixiRenderer).setUpdatesPerFrame((deltaTime: number) => {
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

    // Emit dust while walking
    if (engine.state.agent.isMoving && animFrame % 10 === 0) {
      engine.emitDustPuff(engine.state.agent.x, engine.state.agent.y);
    }

    // Update normal map lighting (agent torch + day/night)
    const agent = engine.state.agent;
    (renderer as PixiRenderer).setAgentLightPosition(agent.x, agent.y);
    (renderer as PixiRenderer).updateLighting();

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

  // Start the PixiJS ticker (begins rendering loop)
  (renderer as PixiRenderer).startTicker();

  console.log('[GameView] Initialized with PixiJS Ticker');
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
  (renderer as PixiRenderer).updateDayNightCycle(worldWidth, worldHeight);

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

  // Draw subagents
  for (const sa of engine.state.subagents) {
    const spriteId = `${sa.type}/${sa.type}-${sa.frameIndex}`;
    renderer.drawSprite(spriteId, sa.x - 8, sa.y - 8, 16, 16);
  }

  // Draw growth effects
  for (const effect of engine.state.growthEffects) {
    const elapsed = performance.now() - effect.startTime;
    if (elapsed < GROWTH_EFFECT_DURATION) {
      const progress = elapsed / GROWTH_EFFECT_DURATION;
      const alpha = 1 - progress;
      const cx = (effect.x + 0.5) * TILE_SIZE;
      const cy = (effect.y + 0.5) * TILE_SIZE;

      // Sparkle ring
      for (let p = 0; p < 6; p++) {
        const angle = (p / 6) * Math.PI * 2 + progress * 2;
        const radius = 2 + progress * 6;
        const sx = cx + Math.cos(angle) * radius;
        const sy = cy + Math.sin(angle) * radius;
        renderer.drawRect(sx - 0.5, sy - 0.5, 1, 1, '#64dc3c', alpha * 0.8);
      }

      // Center glow
      renderer.drawRect(cx - 3, cy - 3, 6, 6, '#ffff64', alpha * 0.4);
    }
  }

  // Draw particles
  for (const p of engine.state.particles) {
    const elapsed = performance.now() - p.startTime;
    const alpha = 1 - (elapsed / p.duration);
    const color = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
    renderer.drawRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, color, alpha * 0.8);
  }

  // Draw weather particles
  (renderer as PixiRenderer).drawWeatherParticles(engine.weather.particles);

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

  // Try spritesheet first
  const sheet = 'claude-actions';
  const spriteId = `${sheet}/char-${action}-${dir}-${agent.frameIndex % 6}`;

  renderer.drawSprite(spriteId, agent.x - 8, agent.y - 12, 16, 24);

  // Draw cursor indicator
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
      let tx = e.clientX - rect.left + 12;
      let ty = e.clientY - rect.top - 8;
      if (tx + 200 > rect.width) tx = e.clientX - rect.left - 210;
      if (ty + 80 > rect.height) ty = e.clientY - rect.top - 80;
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
  const worldWidth = engine.state.worldWidth;
  const worldHeight = engine.state.worldHeight;
  const worldPixelW = worldWidth > 0 ? worldWidth * TILE_SIZE : 400;
  const worldPixelH = worldHeight > 0 ? worldHeight * TILE_SIZE : 300;
  const baseScale = Math.min(canvas.width / worldPixelW, canvas.height / worldPixelH);
  const totalScale = camera.state.zoom * baseScale;

  // Convert screen coords to pixel coords
  const mx = (clientX - rect.left - camera.state.panX) / totalScale;
  const my = (clientY - rect.top - camera.state.panY) / totalScale;

  // Convert to tile coords for spatial hash lookup
  const tileX = Math.floor(mx / TILE_SIZE);
  const tileY = Math.floor(my / TILE_SIZE);

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
          engine.emitWriteSparkles(engine.state.agent.x, engine.state.agent.y - 4);
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
        engine.spawnSubagent(message.id, message.agentType);
        break;

      case 'despawnSubagent':
        engine.despawnSubagent(message.id);
        break;

      case 'updateLighting':
        if ((renderer as any).updateLightingConfig) {
          (renderer as any).updateLightingConfig(message.config);
        }
        break;
    }
  });
}

async function loadAssets(assets: WebviewAssetData): Promise<void> {
  await renderer.loadSpritesheets(assets);

  if ((assets as any).manifest) {
    engine.setManifest((assets as any).manifest);
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
