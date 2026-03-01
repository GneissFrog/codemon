/**
 * Reads Claude Code configuration from various sources
 * - ~/.claude/settings.json (global settings)
 * - .claude/settings.json (project settings)
 * - CLAUDE.md (project context/system prompt)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentConfig, ClaudeModel, PermissionLevel } from './event-types';

// Claude settings structure (partial)
interface ClaudeSettings {
  model?: ClaudeModel;
  permissions?: Record<string, PermissionLevel>;
  allowedTools?: string[];
  hooks?: Record<string, unknown>;
}

// Context window sizes by model
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-haiku-4-5': 200000,
};

// Default model if not specified
const DEFAULT_MODEL: ClaudeModel = 'claude-sonnet-4-5';

// Default Claude Code tools (shown when allowedTools is not explicitly set)
const DEFAULT_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Agent',
  'TaskOutput',
];

export class ConfigReader {
  private globalSettingsPath: string;
  private workspaceRoot: vscode.Uri | undefined;
  private observedTools: Set<string> = new Set();

  constructor() {
    // Global Claude settings location
    this.globalSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  }

  /**
   * Update workspace root when workspace changes
   */
  setWorkspace(uri: vscode.Uri | undefined): void {
    this.workspaceRoot = uri;
  }

  /**
   * Record a tool that was observed from events
   */
  recordObservedTool(toolName: string): void {
    this.observedTools.add(toolName);
  }

  /**
   * Read the complete agent configuration
   */
  async readConfig(): Promise<AgentConfig> {
    const globalSettings = await this.readGlobalSettings();
    const projectSettings = await this.readProjectSettings();
    const systemPrompt = await this.readSystemPrompt();

    // Merge settings (project overrides global)
    const model = projectSettings?.model || globalSettings?.model || DEFAULT_MODEL;
    const permissions = {
      ...globalSettings?.permissions,
      ...projectSettings?.permissions,
    };

    // Get tools: explicit settings > observed tools > defaults
    let tools = this.mergeTools(globalSettings?.allowedTools, projectSettings?.allowedTools);

    // If no explicit tools, use defaults + observed
    if (tools.length === 0) {
      tools = [...DEFAULT_TOOLS];
      // Add observed tools that aren't in defaults
      for (const tool of this.observedTools) {
        if (!tools.includes(tool)) {
          tools.push(tool);
        }
      }
    }

    return {
      model,
      contextWindow: CONTEXT_WINDOWS[model] || 200000,
      tools,
      permissions,
      systemPrompt,
    };
  }

  /**
   * Read global Claude settings
   */
  private async readGlobalSettings(): Promise<ClaudeSettings | null> {
    try {
      const content = await this.readFile(this.globalSettingsPath);
      return JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
  }

  /**
   * Read project-level Claude settings
   */
  private async readProjectSettings(): Promise<ClaudeSettings | null> {
    if (!this.workspaceRoot) {
      return null;
    }

    const projectSettingsPath = path.join(this.workspaceRoot.fsPath, '.claude', 'settings.json');

    try {
      const content = await this.readFile(projectSettingsPath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Read CLAUDE.md for system prompt context
   */
  private async readSystemPrompt(): Promise<string | undefined> {
    if (!this.workspaceRoot) {
      return undefined;
    }

    const claudeMdPath = path.join(this.workspaceRoot.fsPath, 'CLAUDE.md');

    try {
      const content = await this.readFile(claudeMdPath);
      // Return first ~200 chars as the "personality" summary
      const trimmed = content.trim().slice(0, 200);
      return trimmed.length < content.trim().length ? trimmed + '...' : trimmed;
    } catch {
      return undefined;
    }
  }

  /**
   * Merge global and project tool lists
   */
  private mergeTools(
    globalTools?: string[],
    projectTools?: string[]
  ): string[] {
    const toolSet = new Set<string>();

    if (globalTools) {
      globalTools.forEach((t) => toolSet.add(t));
    }

    if (projectTools) {
      projectTools.forEach((t) => toolSet.add(t));
    }

    return Array.from(toolSet);
  }

  /**
   * Read file with error handling
   */
  private async readFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf-8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
   * Watch for config changes
   */
  watchConfig(callback: (config: AgentConfig) => void): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    // Watch global settings
    const globalWatcher = vscode.workspace.createFileSystemWatcher(
      this.globalSettingsPath
    );

    disposables.push(
      globalWatcher.onDidChange(() => this.readConfig().then(callback)),
      globalWatcher.onDidCreate(() => this.readConfig().then(callback))
    );

    // Watch project settings if workspace exists
    if (this.workspaceRoot) {
      const projectSettingsPath = path.join(
        this.workspaceRoot.fsPath,
        '.claude',
        'settings.json'
      );
      const projectWatcher = vscode.workspace.createFileSystemWatcher(
        projectSettingsPath
      );

      disposables.push(
        projectWatcher.onDidChange(() => this.readConfig().then(callback)),
        projectWatcher.onDidCreate(() => this.readConfig().then(callback))
      );

      // Watch CLAUDE.md
      const claudeMdPath = path.join(this.workspaceRoot.fsPath, 'CLAUDE.md');
      const claudeMdWatcher = vscode.workspace.createFileSystemWatcher(claudeMdPath);

      disposables.push(
        claudeMdWatcher.onDidChange(() => this.readConfig().then(callback)),
        claudeMdWatcher.onDidCreate(() => this.readConfig().then(callback))
      );
    }

    return {
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }
}

// Singleton instance
let configReader: ConfigReader | undefined;

export function getConfigReader(): ConfigReader {
  if (!configReader) {
    configReader = new ConfigReader();
  }
  return configReader;
}
