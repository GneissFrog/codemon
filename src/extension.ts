/**
 * CodeMon - RPG Observability Layer for Claude Code
 * VS Code Extension Entry Point
 */

import * as vscode from 'vscode';
import { getGameViewPanel, GameViewPanel } from './panels/GameViewPanel';
import { getBudgetBarPanel } from './panels/BudgetBarPanel';
import { getBudgetStatusBar, BudgetStatusBar } from './statusbar/BudgetStatusBar';
import { getEventRouter, ROUTER_EVENTS } from './core/event-router';
import { getConfigReader } from './core/config-reader';
import { getSessionLogReader } from './core/session-log-reader';
import { getBudgetTracker } from './core/budget-tracker';
import { getCodebaseMapper } from './core/codebase-mapper';
import { getHookServer } from './core/hook-server';
import { getAssetLoader } from './overworld/core/AssetLoader';
import { SpriteConfigPanel, getSpriteConfigPanel } from './panels/SpriteConfigPanel';
import { onSettingsChanged, getSettings } from './core/settings';
import { ActivityEntry, ToolUseEvent } from './core/event-types';
import { FileAction } from './core/codebase-mapper';
import { WorldMap } from './overworld/world/WorldMap';
import { WorldGenerator } from './overworld/world/WorldGenerator';

let gameViewPanel: GameViewPanel | undefined;
let budgetBarPanel: ReturnType<typeof getBudgetBarPanel> | undefined;
let budgetStatusBar: BudgetStatusBar | undefined;
let worldMap: WorldMap | undefined;
let worldGenerator: WorldGenerator | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('CodeMon is activating...');

  const extensionUri = context.extensionUri;

  // Initialize core components
  const eventRouter = getEventRouter();
  const configReader = getConfigReader();
  const budgetTracker = getBudgetTracker();
  const codebaseMapper = getCodebaseMapper();

  // Initialize asset loader for overworld sprites (must complete before map updates)
  const assetLoader = getAssetLoader(extensionUri);
  assetLoader.load().then(() => {
    console.log('[CodeMon] Assets loaded successfully');
    // Now that assets are loaded, populate the map
    populateMapFromWorkspace();
  }).catch((err) => {
    console.error('[CodeMon] Failed to load assets:', err);
    // Still populate map even if assets fail (will use fallback colors)
    populateMapFromWorkspace();
  });

  // Initialize game view panel
  gameViewPanel = getGameViewPanel(extensionUri);

  // Register sprite config panel
  const spriteConfigPanel = getSpriteConfigPanel(extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SpriteConfigPanel.viewType,
      spriteConfigPanel
    )
  );

  // Set workspace for config reader and codebase mapper
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    configReader.setWorkspace(vscode.workspace.workspaceFolders[0].uri);
    codebaseMapper.setWorkspaceRoot(vscode.workspace.workspaceFolders[0].uri.fsPath);
  }

  // Listen for workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      if (e.added.length > 0) {
        configReader.setWorkspace(e.added[0].uri);
        codebaseMapper.setWorkspaceRoot(e.added[0].uri.fsPath);
      } else if (e.removed.length > 0 && vscode.workspace.workspaceFolders) {
        configReader.setWorkspace(vscode.workspace.workspaceFolders[0]?.uri);
        if (vscode.workspace.workspaceFolders[0]) {
          codebaseMapper.setWorkspaceRoot(vscode.workspace.workspaceFolders[0].uri.fsPath);
        }
      }
    })
  );

  // Create status bar
  budgetStatusBar = getBudgetStatusBar();
  context.subscriptions.push(budgetStatusBar);

  // Register commands
  registerCommands(context);

  // Wire up event router to panels
  setupEventRouting(context, eventRouter);

  // Watch for config changes
  context.subscriptions.push(
    configReader.watchConfig(async (config) => {
      gameViewPanel?.updateConfig(config);
    })
  );

  // Watch for settings changes
  context.subscriptions.push(
    onSettingsChanged(() => {
      budgetTracker.updateSettings();
      budgetStatusBar?.updateDisplay();
    })
  );

  // Start the event router
  eventRouter.initialize();

  // Start hook server if in hooks mode or auto mode
  const settings = getSettings();
  if (settings.integration.mode === 'hooks' || settings.integration.mode === 'auto') {
    startHookServer(context);
  }

  // Load initial config
  configReader.readConfig().then((config) => {
    gameViewPanel?.updateConfig(config);
  });

  // Note: populateMapFromWorkspace() is called after assets load (see above)

  // Auto-open the Game View
  gameViewPanel?.show();

  console.log('CodeMon activated successfully!');
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Show game view command
  context.subscriptions.push(
    vscode.commands.registerCommand('codemon.showGameView', () => {
      gameViewPanel?.show();
    })
  );

  // Show budget details command
  context.subscriptions.push(
    vscode.commands.registerCommand('codemon.showBudgetDetails', () => {
      if (!budgetBarPanel) {
        budgetBarPanel = getBudgetBarPanel(context.extensionUri);
      }
      budgetBarPanel.show();
    })
  );

  // Install hooks command
  context.subscriptions.push(
    vscode.commands.registerCommand('codemon.installHooks', async () => {
      const result = await installHooks();
      if (result) {
        vscode.window.showInformationMessage('CodeMon hooks installed successfully!');
      } else {
        vscode.window.showErrorMessage('Failed to install CodeMon hooks.');
      }
    })
  );
}

/**
 * Setup event routing from router to panels
 */
function setupEventRouting(
  context: vscode.ExtensionContext,
  eventRouter: ReturnType<typeof getEventRouter>
): void {
  const budgetTracker = getBudgetTracker();
  const budgetStatusBar = getBudgetStatusBar();
  const codebaseMapper = getCodebaseMapper();

  // Route activity entries to game view
  eventRouter.on(ROUTER_EVENTS.ACTIVITY_ENTRY, (entry: ActivityEntry) => {
    gameViewPanel?.addActivityEntry(entry);
    gameViewPanel?.setAgentAnimation(entry.animation);
  });

  // Route usage updates to budget tracker and status bar
  eventRouter.on(ROUTER_EVENTS.USAGE, (event: { usage: { inputTokens: number; outputTokens: number }; cost: { totalCost: number }; cumulativeTokens: { inputTokens: number; outputTokens: number }; cumulativeCost: number }) => {
    budgetTracker.addUsage(event.usage, event.cost.totalCost);
    budgetStatusBar.updateDisplay();
    budgetBarPanel?.updateDisplay();

    // Update game view budget
    const status = budgetTracker.getStatus();
    const totalTokens = event.cumulativeTokens.inputTokens + event.cumulativeTokens.outputTokens;
    gameViewPanel?.updateBudget(status.used, status.used * 0.003, status.percentage);
    gameViewPanel?.updateSessionTotal(totalTokens, event.cumulativeCost);
  });

  // Route session start to reset state
  eventRouter.on(ROUTER_EVENTS.SESSION_START, (event: { config: import('./core/event-types').AgentConfig }) => {
    gameViewPanel?.updateConfig(event.config);
    gameViewPanel?.resetSession();
    budgetTracker.resetSession();

    // Reset map activity (keep tree structure)
    codebaseMapper.clearActivity();
    sendMapUpdate();
  });

  // Route tool use events to trigger animations AND update map
  eventRouter.on(ROUTER_EVENTS.TOOL_USE, (event: ToolUseEvent) => {
    const animation = getAnimationForTool(event.toolName);
    gameViewPanel?.setAgentAnimation(animation);

    // Track observed tool and update config
    const configReader = getConfigReader();
    configReader.recordObservedTool(event.toolName);
    configReader.readConfig().then((config) => {
      gameViewPanel?.updateConfig(config);
    });

    // Update overworld map with file activity
    const filePath = extractFilePathFromToolEvent(event);
    console.log(`[CodeMon Map] TOOL_USE: ${event.toolName} → path: ${filePath || '(none)'}`);
    if (filePath) {
      const action = getFileActionForTool(event.toolName);
      codebaseMapper.recordActivity(filePath, action);
      sendMapUpdate();

      // Move agent to the file
      gameViewPanel?.moveAgentToFile(filePath);
    }
  });
}

/**
 * Send updated map layout to the game view panel
 */
function sendMapUpdate(): void {
  const codebaseMapper = getCodebaseMapper();
  // Use a reasonable default canvas size — the panel will resize
  const layout = codebaseMapper.getLayout(800, 600);
  console.log(`[CodeMon Map] Sending layout: ${layout.fileCount} files, ${layout.tiles.length} tiles, active: ${layout.activeFile || 'none'}`);

  // Generate world tile grid from treemap layout
  if (!worldMap) {
    worldMap = new WorldMap(100, 100);
  }
  if (!worldGenerator) {
    worldGenerator = new WorldGenerator(worldMap);
  }

  worldGenerator.generateFromLayout(layout);
  const serializedWorld = worldMap.serialize();

  gameViewPanel?.updateMap(layout, serializedWorld);
}

/**
 * Pre-populate the overworld map with files from the workspace.
 * This gives the map immediate content without waiting for Claude events.
 */
async function populateMapFromWorkspace(): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    console.log('[CodeMon Map] No workspace folder — skipping scan');
    return;
  }

  const codebaseMapper = getCodebaseMapper();

  try {
    // Find source files — exclude common non-source directories
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,css,scss,less,html,vue,svelte,json,yaml,yml,toml,md,txt,sh,bash,sql}',
      '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/out/**,**/.next/**,**/target/**,**/__pycache__/**,**/venv/**,**/.venv/**}',
      500 // limit to 500 files for performance
    );

    console.log(`[CodeMon Map] Workspace scan found ${files.length} files`);

    for (const file of files) {
      codebaseMapper.addFile(file.fsPath);
    }

    // Send the initial layout to the map panel
    if (files.length > 0) {
      sendMapUpdate();
      console.log(`[CodeMon Map] Initial map populated with ${files.length} files`);
    }
  } catch (err) {
    console.error('[CodeMon Map] Workspace scan failed:', err);
  }
}

/**
 * Extract a file path from a tool use event
 */
function extractFilePathFromToolEvent(event: ToolUseEvent): string | null {
  const input = event.toolInput;

  switch (event.toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) || null;

    case 'Glob':
    case 'Grep':
      return (input.path as string) || null;

    case 'NotebookEdit':
      return (input.notebook_path as string) || null;

    default:
      return null;
  }
}

/**
 * Map tool name to file action type
 */
function getFileActionForTool(toolName: string): FileAction {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return 'write';
    case 'Glob':
    case 'Grep':
      return 'search';
    default:
      return 'read';
  }
}

/**
 * Get animation type based on tool name
 */
function getAnimationForTool(toolName: string): string {
  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return 'investigate';
    case 'Write':
    case 'Edit':
      return 'write';
    case 'Bash':
      return 'bash';
    default:
      return 'idle';
  }
}

/**
 * Start the hook server for CLI integration
 */
function startHookServer(context: vscode.ExtensionContext): void {
  const hookServer = getHookServer();

  hookServer.start().then((port) => {
    console.log(`CodeMon hook server started on port ${port}`);

    // Show notification
    vscode.window.showInformationMessage(
      `CodeMon hook server running on port ${port}`
    );
  }).catch((err) => {
    console.error('Failed to start hook server:', err);
  });

  // Clean up on deactivate
  context.subscriptions.push({
    dispose: () => hookServer.stop(),
  });
}

/**
 * Install Claude Code hooks
 */
async function installHooks(): Promise<boolean> {
  const fs = await import('fs');
  const path = await import('path');

  // Check if workspace exists
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Please open a workspace first.');
    return false;
  }

  // Ensure hook server is running
  const hookServer = getHookServer();
  if (!hookServer.isActive()) {
    try {
      await hookServer.start();
    } catch (err) {
      vscode.window.showErrorMessage('Failed to start hook server.');
      return false;
    }
  }

  const port = hookServer.getPort();
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const claudeDir = path.join(workspaceRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  try {
    // Create .claude directory if it doesn't exist
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Read existing settings or create new ones
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }

    // Add hooks configuration with correct port
    const hookUrl = `http://localhost:${port}/events`;
    const existingHooks = settings.hooks as Record<string, unknown[]> || {};

    // Helper to add hook without duplicates
    const addHook = (
      existing: unknown[] | undefined,
      command: string
    ): unknown[] => {
      const hook = { type: 'command', command };
      if (!existing) return [hook];
      // Remove existing CodeMon hooks
      const filtered = existing.filter(
        (h) => !(typeof h === 'object' && h && 'command' in h &&
          (h as { command: string }).command.includes('localhost:') &&
          (h as { command: string }).command.includes('/events'))
      );
      return [...filtered, hook];
    };

    settings = {
      ...settings,
      hooks: {
        ...existingHooks,
        PreToolUse: addHook(existingHooks.PreToolUse as unknown[] | undefined, `curl -s -X POST ${hookUrl} -d @-`),
        PostToolUse: addHook(existingHooks.PostToolUse as unknown[] | undefined, `curl -s -X POST ${hookUrl} -d @-`),
        PostToolUseFailure: addHook(existingHooks.PostToolUseFailure as unknown[] | undefined, `curl -s -X POST ${hookUrl} -d @-`),
        SessionStart: addHook(existingHooks.SessionStart as unknown[] | undefined, `curl -s -X POST ${hookUrl} -d @-`),
        SessionEnd: addHook(existingHooks.SessionEnd as unknown[] | undefined, `curl -s -X POST ${hookUrl} -d @-`),
      },
    };

    // Write settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to install hooks:', error);
    return false;
  }
}

/**
 * Format tokens for display
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function deactivate(): void {
  const sessionLogReader = getSessionLogReader();
  sessionLogReader.stop();

  const codebaseMapper = getCodebaseMapper();
  codebaseMapper.dispose();

  console.log('CodeMon deactivated');
}
