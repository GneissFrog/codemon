/**
 * Central event router for CodeMon
 * Receives events from various sources and dispatches to panels
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import {
  CodeMonEvent,
  SessionStartEvent,
  SessionEndEvent,
  ToolUseEvent,
  ToolResultEvent,
  UsageEvent,
  ThinkingEvent,
  SubagentStartEvent,
  SubagentStopEvent,
  PermissionRequestEvent,
  TokenUsage,
  ActivityEntry,
} from './event-types';
import { SessionLogEvent, getSessionLogReader } from './session-log-reader';
import { getConfigReader } from './config-reader';
import { getTokenCalculator } from './token-calculator';
import { getSettings } from './settings';

// Event name constants
export const ROUTER_EVENTS = {
  EVENT: 'event',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
  USAGE: 'usage',
  ACTIVITY_ENTRY: 'activity_entry',
  SUBAGENT_START: 'subagent_start',
  SUBAGENT_STOP: 'subagent_stop',
} as const;

export class EventRouter extends EventEmitter {
  private sessionId: string;
  private cumulativeTokens: TokenUsage;
  private cumulativeCost: number;
  private model: string;
  private pendingToolUse: Map<string, ToolUseEvent>;
  /** Queue of subagent_type strings from Agent tool_use events, awaiting subagent_start */
  private pendingSubagentTypes: string[] = [];

  constructor() {
    super();
    this.sessionId = this.generateSessionId();
    this.cumulativeTokens = {
      inputTokens: 0,
      outputTokens: 0,
    };
    this.cumulativeCost = 0;
    this.model = 'claude-sonnet-4-5';
    this.pendingToolUse = new Map();
  }

  /**
   * Initialize the router and connect to log reader
   */
  initialize(): void {
    const logReader = getSessionLogReader();

    logReader.on('entry', (event: SessionLogEvent) => {
      this.processLogEntry(event);
    });

    logReader.start();
  }

  /**
   * Process a log entry from the session log reader
   */
  private async processLogEntry(event: SessionLogEvent): Promise<void> {
    const { data } = event;

    switch (data.type) {
      case 'session_start':
        await this.handleSessionStart(data);
        break;

      case 'session_end':
      case 'result':
        this.handleSessionEnd(data);
        break;

      case 'assistant':
        this.handleAssistantMessage(data);
        break;

      case 'tool_use':
        this.handleToolUse(data);
        break;

      case 'tool_result':
        this.handleToolResult(data);
        break;

      case 'thinking':
        this.handleThinking(data);
        break;

      case 'subagent_start':
        this.handleSubagentStart(data);
        break;

      case 'subagent_stop':
        this.handleSubagentStop(data);
        break;

      case 'permission_request':
        this.handlePermissionRequest(data);
        break;
    }
  }

  /**
   * Handle session start
   */
  private async handleSessionStart(data: Record<string, unknown>): Promise<void> {
    this.sessionId = (data.sessionId as string) || this.generateSessionId();
    this.model = (data.model as string) || 'claude-sonnet-4-5';
    this.cumulativeTokens = { inputTokens: 0, outputTokens: 0 };
    this.cumulativeCost = 0;

    const configReader = getConfigReader();
    const config = await configReader.readConfig();

    const event: SessionStartEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'session_start',
      model: this.model as SessionStartEvent['model'],
      config,
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.SESSION_START, event);
  }

  /**
   * Handle session end
   */
  private handleSessionEnd(data: Record<string, unknown>): void {
    const event: SessionEndEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'session_end',
      totalTokens: this.cumulativeTokens,
      totalCost: data.total_cost_usd as number || this.cumulativeCost,
      modelUsage: data.modelUsage as Record<string, TokenUsage>,
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.SESSION_END, event);
  }

  /**
   * Handle assistant message (contains usage data)
   */
  private handleAssistantMessage(data: Record<string, unknown>): void {
    const message = data.message as {
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    } | undefined;

    const usage = message?.usage;

    if (!usage) return;

    const tokenUsage: TokenUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
    };

    const calculator = getTokenCalculator();
    const cost = calculator.calculateCost(tokenUsage, this.model);

    // Update cumulative totals
    this.cumulativeTokens.inputTokens += tokenUsage.inputTokens;
    this.cumulativeTokens.outputTokens += tokenUsage.outputTokens;
    if (tokenUsage.cacheReadTokens) {
      this.cumulativeTokens.cacheReadTokens =
        (this.cumulativeTokens.cacheReadTokens || 0) + tokenUsage.cacheReadTokens;
    }
    if (tokenUsage.cacheWriteTokens) {
      this.cumulativeTokens.cacheWriteTokens =
        (this.cumulativeTokens.cacheWriteTokens || 0) + tokenUsage.cacheWriteTokens;
    }
    this.cumulativeCost += cost.totalCost;

    const event: UsageEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'usage',
      usage: tokenUsage,
      cost,
      cumulativeTokens: { ...this.cumulativeTokens },
      cumulativeCost: this.cumulativeCost,
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.USAGE, event);
  }

  /**
   * Handle tool use event
   */
  private handleToolUse(data: Record<string, unknown>): void {
    const messageId = data.messageId as string || this.generateId();
    const toolName = data.toolName as string || 'Unknown';

    const event: ToolUseEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'tool_use',
      toolName,
      toolInput: (data.toolInput as Record<string, unknown>) || {},
      messageId,
    };

    this.pendingToolUse.set(messageId, event);

    // Stash subagent_type from Agent tool_use for later subagent_start correlation
    if (toolName === 'Agent' && event.toolInput.subagent_type) {
      this.pendingSubagentTypes.push(event.toolInput.subagent_type as string);
    }

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.TOOL_USE, event);

    // Also emit as activity entry
    const activity = this.toolUseToActivity(event);
    this.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
  }

  /**
   * Handle tool result event
   */
  private handleToolResult(data: Record<string, unknown>): void {
    const messageId = data.messageId as string || '';
    const toolName = data.toolName as string || 'Unknown';
    const isError = !!data.error;
    const result = data.toolResult;

    const event: ToolResultEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'tool_result',
      toolName,
      result,
      isError,
      errorMessage: data.error as string,
      messageId,
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.TOOL_RESULT, event);

    // Update activity entry with result
    const activity = this.toolResultToActivity(event);
    this.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
  }

  /**
   * Handle thinking event
   */
  private handleThinking(data: Record<string, unknown>): void {
    const event: ThinkingEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'thinking',
      excerpt: (data.excerpt as string) || 'Thinking...',
    };

    this.emit(ROUTER_EVENTS.EVENT, event);

    const activity: ActivityEntry = {
      id: event.id,
      timestamp: event.timestamp,
      icon: '💭',
      label: 'Thinking...',
      detail: event.excerpt,
      animation: 'think',
    };

    this.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
  }

  /**
   * Handle subagent start
   */
  private handleSubagentStart(data: Record<string, unknown>): void {
    // Resolve subagent type: try direct field first, then pending queue from Agent tool_use
    const subagentType =
      (data.subagent_type as string) ||
      (data.subagentType as string) ||
      this.pendingSubagentTypes.shift() ||
      undefined;

    const event: SubagentStartEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'subagent_start',
      subagentId: data.subagentId as string || this.generateId(),
      description: (data.description as string) || 'Subagent spawned',
      subagentType,
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.SUBAGENT_START, event);

    const typeLabel = subagentType ? ` (${subagentType})` : '';
    const activity: ActivityEntry = {
      id: event.id,
      timestamp: event.timestamp,
      icon: '🤖',
      label: `Subagent spawned${typeLabel}`,
      detail: event.description,
      animation: 'idle',
    };

    this.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
  }

  /**
   * Handle subagent stop
   */
  private handleSubagentStop(data: Record<string, unknown>): void {
    const event: SubagentStopEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'subagent_stop',
      subagentId: data.subagentId as string || '',
    };

    this.emit(ROUTER_EVENTS.EVENT, event);
    this.emit(ROUTER_EVENTS.SUBAGENT_STOP, event);
  }

  /**
   * Handle permission request
   */
  private handlePermissionRequest(data: Record<string, unknown>): void {
    const event: PermissionRequestEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type: 'permission_request',
      toolName: data.toolName as string || 'Unknown',
      toolInput: (data.toolInput as Record<string, unknown>) || {},
    };

    this.emit(ROUTER_EVENTS.EVENT, event);

    const activity: ActivityEntry = {
      id: event.id,
      timestamp: event.timestamp,
      icon: '⚠️',
      label: 'Awaiting permission',
      detail: `${event.toolName}`,
      animation: 'idle',
    };

    this.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
  }

  /**
   * Convert tool use to activity entry
   */
  private toolUseToActivity(event: ToolUseEvent): ActivityEntry {
    const { icon, label, detail, animation } = this.getToolDisplayInfo(
      event.toolName,
      event.toolInput
    );

    return {
      id: event.id,
      timestamp: event.timestamp,
      icon,
      label,
      detail,
      animation,
    };
  }

  /**
   * Convert tool result to activity entry
   */
  private toolResultToActivity(event: ToolResultEvent): ActivityEntry {
    const { icon, label } = this.getToolDisplayInfo(event.toolName, {});

    return {
      id: `${event.id}-result`,
      timestamp: event.timestamp,
      icon: event.isError ? '❌' : '✅',
      label: event.isError ? 'Error' : 'Success',
      detail: event.errorMessage || '',
      isError: event.isError,
      errorMessage: event.errorMessage,
      animation: event.isError ? 'error' : 'success',
    };
  }

  /**
   * Get display info for a tool
   */
  private getToolDisplayInfo(
    toolName: string,
    toolInput: Record<string, unknown>
  ): { icon: string; label: string; detail: string; animation: ActivityEntry['animation'] } {
    switch (toolName) {
      case 'Read':
        return {
          icon: '🔍',
          label: 'Read File',
          detail: (toolInput.file_path as string) || '',
          animation: 'investigate',
        };

      case 'Write':
        return {
          icon: '✏️',
          label: 'Write File',
          detail: (toolInput.file_path as string) || '',
          animation: 'write',
        };

      case 'Edit':
        return {
          icon: '✏️',
          label: 'Edit File',
          detail: (toolInput.file_path as string) || '',
          animation: 'write',
        };

      case 'Bash':
        return {
          icon: '⚡',
          label: 'Bash',
          detail: this.truncate((toolInput.command as string) || '', 50),
          animation: 'bash',
        };

      case 'Glob':
        return {
          icon: '🔎',
          label: 'Search Files',
          detail: (toolInput.pattern as string) || '',
          animation: 'investigate',
        };

      case 'Grep':
        return {
          icon: '🔎',
          label: 'Search Content',
          detail: (toolInput.pattern as string) || '',
          animation: 'investigate',
        };

      case 'WebSearch':
        return {
          icon: '🌐',
          label: 'Web Search',
          detail: this.truncate((toolInput.query as string) || '', 50),
          animation: 'investigate',
        };

      case 'WebFetch':
        return {
          icon: '🌐',
          label: 'Web Fetch',
          detail: this.truncate((toolInput.url as string) || '', 50),
          animation: 'investigate',
        };

      default:
        // Handle MCP tools
        if (toolName.startsWith('mcp__')) {
          return {
            icon: '🔌',
            label: 'MCP',
            detail: toolName,
            animation: 'bash',
          };
        }

        return {
          icon: '⚙️',
          label: toolName,
          detail: '',
          animation: 'idle',
        };
    }
  }

  /**
   * Truncate a string
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}`;
  }

  /**
   * Get current cumulative usage
   */
  getCumulativeUsage(): { tokens: TokenUsage; cost: number } {
    return {
      tokens: { ...this.cumulativeTokens },
      cost: this.cumulativeCost,
    };
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Singleton instance
let eventRouter: EventRouter | undefined;

export function getEventRouter(): EventRouter {
  if (!eventRouter) {
    eventRouter = new EventRouter();
  }
  return eventRouter;
}
