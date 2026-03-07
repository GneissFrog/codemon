/**
 * Normalized event types for CodeMon
 * These represent the abstracted events that flow through the system
 */

// Tool types that Claude Code can invoke
export type ToolType =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Glob'
  | 'Grep'
  | 'Agent'
  | 'TaskOutput'
  | 'TaskStop'
  | 'WebSearch'
  | 'WebFetch'
  | 'NotebookEdit'
  | 'AskUserQuestion'
  | 'ExitPlanMode'
  | 'EnterPlanMode'
  | 'Skill'
  | 'MCP';

// Permission levels
export type PermissionLevel = 'auto' | 'ask' | 'blocked';

// Claude model identifiers
export type ClaudeModel =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-sonnet-4-5'
  | 'claude-haiku-4-5'
  | string;

// Token usage data
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// Cost breakdown
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  totalCost: number;
}

// Base event interface
export interface BaseEvent {
  id: string;
  timestamp: number;
  sessionId: string;
}

// Session started event
export interface SessionStartEvent extends BaseEvent {
  type: 'session_start';
  model: ClaudeModel;
  config: AgentConfig;
}

// Session ended event
export interface SessionEndEvent extends BaseEvent {
  type: 'session_end';
  totalTokens: TokenUsage;
  totalCost: number;
  modelUsage?: Record<string, TokenUsage>;
}

// Tool use event
export interface ToolUseEvent extends BaseEvent {
  type: 'tool_use';
  toolName: ToolType | string;
  toolInput: Record<string, unknown>;
  messageId: string;
}

// Tool result event
export interface ToolResultEvent extends BaseEvent {
  type: 'tool_result';
  toolName: ToolType | string;
  result: unknown;
  isError: boolean;
  errorMessage?: string;
  messageId: string;
}

// Usage update event (from assistant messages)
export interface UsageEvent extends BaseEvent {
  type: 'usage';
  usage: TokenUsage;
  cost: CostBreakdown;
  cumulativeTokens: TokenUsage;
  cumulativeCost: number;
}

// Thinking event
export interface ThinkingEvent extends BaseEvent {
  type: 'thinking';
  excerpt: string;
}

// Subagent events
export interface SubagentStartEvent extends BaseEvent {
  type: 'subagent_start';
  subagentId: string;
  description: string;
  /** Agent type from tool_use Agent input, e.g. "bug-analyzer", "code-reviewer" */
  subagentType?: string;
}

export interface SubagentStopEvent extends BaseEvent {
  type: 'subagent_stop';
  subagentId: string;
}

// Permission request event
export interface PermissionRequestEvent extends BaseEvent {
  type: 'permission_request';
  toolName: string;
  toolInput: Record<string, unknown>;
}

// Agent configuration
export interface AgentConfig {
  model: ClaudeModel;
  contextWindow: number;
  tools: string[];
  permissions: Record<string, PermissionLevel>;
  systemPrompt?: string;
}

// Activity feed entry (derived from events)
export interface ActivityEntry {
  id: string;
  timestamp: number;
  icon: string;
  label: string;
  detail: string;
  tokens?: number;
  cost?: number;
  isError?: boolean;
  errorMessage?: string;
  animation: 'investigate' | 'write' | 'bash' | 'think' | 'error' | 'success' | 'idle';
}

// File activity update (for overworld map)
export interface FileActivityUpdate {
  path: string;
  action: 'read' | 'write' | 'search';
  timestamp: number;
}

// Union type for all events
export type CodeMonEvent =
  | SessionStartEvent
  | SessionEndEvent
  | ToolUseEvent
  | ToolResultEvent
  | UsageEvent
  | ThinkingEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | PermissionRequestEvent;

// Event type guard helpers
export function isSessionStart(event: CodeMonEvent): event is SessionStartEvent {
  return event.type === 'session_start';
}

export function isSessionEnd(event: CodeMonEvent): event is SessionEndEvent {
  return event.type === 'session_end';
}

export function isToolUse(event: CodeMonEvent): event is ToolUseEvent {
  return event.type === 'tool_use';
}

export function isToolResult(event: CodeMonEvent): event is ToolResultEvent {
  return event.type === 'tool_result';
}

export function isUsage(event: CodeMonEvent): event is UsageEvent {
  return event.type === 'usage';
}

export function isThinking(event: CodeMonEvent): event is ThinkingEvent {
  return event.type === 'thinking';
}

export function isSubagentStart(event: CodeMonEvent): event is SubagentStartEvent {
  return event.type === 'subagent_start';
}

export function isSubagentStop(event: CodeMonEvent): event is SubagentStopEvent {
  return event.type === 'subagent_stop';
}

export function isPermissionRequest(event: CodeMonEvent): event is PermissionRequestEvent {
  return event.type === 'permission_request';
}
