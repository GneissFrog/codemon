/**
 * StateMachineRegistry - Loads state machine definitions and agent type
 * mappings from assets/config/state-machines.json.
 * Singleton via getStateMachineRegistry().
 */

import * as vscode from 'vscode';
import {
  StateMachineConfig,
  AgentTypeConfig,
  StateMachineFileConfig,
} from './types';
import { StateMachine } from './StateMachine';

export class StateMachineRegistry {
  private extensionUri: vscode.Uri;
  private machines = new Map<string, StateMachineConfig>();
  private agentTypes = new Map<string, AgentTypeConfig>();
  private loaded = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /** Load state-machines.json */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const filePath = vscode.Uri.joinPath(
        this.extensionUri,
        'assets',
        'config',
        'state-machines.json'
      );

      const data = await vscode.workspace.fs.readFile(filePath);
      const raw: StateMachineFileConfig = JSON.parse(data.toString());

      // Index machines
      for (const [id, config] of Object.entries(raw.machines)) {
        config.id = id; // Ensure id matches key
        this.machines.set(id, config);
      }

      // Index agent types
      for (const [id, config] of Object.entries(raw.agentTypes)) {
        this.agentTypes.set(id, config);
      }

      this.loaded = true;
      console.log(
        `[StateMachineRegistry] Loaded ${this.machines.size} machines, ${this.agentTypes.size} agent types`
      );
    } catch (error) {
      console.warn('[StateMachineRegistry] Could not load state-machines.json:', error);
      this.loaded = true;
    }
  }

  /** Get a state machine config by id */
  getMachineConfig(id: string): StateMachineConfig | undefined {
    return this.machines.get(id);
  }

  /** Create a new StateMachine instance from a config id */
  createMachine(id: string): StateMachine | undefined {
    const config = this.machines.get(id);
    if (!config) return undefined;
    return new StateMachine(config);
  }

  /** Get agent type config by subagent_type string */
  getAgentType(subagentType: string): AgentTypeConfig | undefined {
    return this.agentTypes.get(subagentType);
  }

  /**
   * Resolve a subagent type to its full config.
   * Falls back to _default if type is unknown.
   */
  resolveAgentType(subagentType?: string): AgentTypeConfig {
    if (subagentType) {
      const config = this.agentTypes.get(subagentType);
      if (config) return config;
    }
    return this.agentTypes.get('_default') ?? {
      displayName: 'Agent',
      sprite: 'chicken',
      stateMachine: 'chicken',
      tint: null,
      nameLabel: true,
    };
  }

  /** Get all machine configs (for editor panel) */
  getAllMachines(): Map<string, StateMachineConfig> {
    return this.machines;
  }

  /** Get all agent type configs (for editor panel) */
  getAllAgentTypes(): Map<string, AgentTypeConfig> {
    return this.agentTypes;
  }

  /** Set or update a machine config (from editor panel) */
  setMachine(id: string, config: StateMachineConfig): void {
    config.id = id;
    this.machines.set(id, config);
  }

  /** Set or update an agent type config (from editor panel) */
  setAgentType(id: string, config: AgentTypeConfig): void {
    this.agentTypes.set(id, config);
  }

  /** Delete a machine config */
  deleteMachine(id: string): void {
    this.machines.delete(id);
  }

  /** Delete an agent type config */
  deleteAgentType(id: string): void {
    this.agentTypes.delete(id);
  }

  /** Save current state back to JSON */
  async save(): Promise<void> {
    const fileConfig: StateMachineFileConfig = {
      version: 1,
      machines: Object.fromEntries(this.machines),
      agentTypes: Object.fromEntries(this.agentTypes),
    };

    const filePath = vscode.Uri.joinPath(
      this.extensionUri,
      'assets',
      'config',
      'state-machines.json'
    );

    const content = JSON.stringify(fileConfig, null, 2);
    await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf-8'));
    console.log('[StateMachineRegistry] Saved state-machines.json');
  }

  /**
   * Get the serializable config data for sending to webview.
   * The webview needs machine configs to instantiate StateMachine locally.
   */
  getSerializableConfig(): {
    machines: Record<string, StateMachineConfig>;
    agentTypes: Record<string, AgentTypeConfig>;
  } {
    return {
      machines: Object.fromEntries(this.machines),
      agentTypes: Object.fromEntries(this.agentTypes),
    };
  }
}

// Singleton
let _instance: StateMachineRegistry | undefined;

export function getStateMachineRegistry(extensionUri?: vscode.Uri): StateMachineRegistry {
  if (!_instance) {
    if (!extensionUri) throw new Error('StateMachineRegistry: extensionUri required for first init');
    _instance = new StateMachineRegistry(extensionUri);
  }
  return _instance;
}
