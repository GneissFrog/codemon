/**
 * Hook Server - Local HTTP server for Claude Code CLI integration
 * Receives POST requests from Claude Code hooks and routes them to the event system
 */

import * as http from 'http';
import { EventEmitter } from 'events';
import { getEventRouter, ROUTER_EVENTS } from './event-router';

export interface HookEvent {
  hook_event_name: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  error?: string;
  model?: string;
  message?: unknown;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  [key: string]: unknown;
}

export class HookServer extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private isRunning = false;

  constructor(port: number = 22140) {
    super();
    this.port = port;
  }

  /**
   * Start the hook server
   */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        resolve(this.port);
        return;
      }

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try next port
          this.port++;
          this.tryStart(resolve, reject);
        } else {
          reject(err);
        }
      });

      this.tryStart(resolve, reject);
    });
  }

  private tryStart(
    resolve: (port: number) => void,
    reject: (err: Error) => void
  ): void {
    if (!this.server) return;

    this.server.listen(this.port, 'localhost', () => {
      this.isRunning = true;
      console.log(`CodeMon hook server listening on port ${this.port}`);
      this.emit('started', this.port);
      resolve(this.port);
    });
  }

  /**
   * Stop the hook server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.isRunning = false;
      console.log('CodeMon hook server stopped');
      this.emit('stopped');
    }
  }

  /**
   * Get the current port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Handle incoming HTTP request
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const event: HookEvent = JSON.parse(body);
        this.processHookEvent(event);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        console.error('Failed to parse hook event:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  /**
   * Process a hook event and route it to the event system
   */
  private processHookEvent(event: HookEvent): void {
    const router = getEventRouter();
    const sessionId = event.session_id || 'unknown';

    // Emit raw event for debugging
    this.emit('event', event);

    switch (event.hook_event_name) {
      case 'SessionStart':
        router.emit(ROUTER_EVENTS.SESSION_START, {
          id: this.generateId(),
          timestamp: Date.now(),
          sessionId,
          type: 'session_start',
          model: event.model || 'claude-sonnet-4-5',
          config: {
            model: event.model || 'claude-sonnet-4-5',
            contextWindow: 200000,
            tools: [],
            permissions: {},
          },
        });
        break;

      case 'PreToolUse':
        // Tool is about to be used
        this.emit('preToolUse', event);
        break;

      case 'PostToolUse':
        // Tool has been used
        if (event.tool_name) {
          router.emit(ROUTER_EVENTS.TOOL_USE, {
            id: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            type: 'tool_use',
            toolName: event.tool_name,
            toolInput: event.tool_input || {},
            messageId: this.generateId(),
          });

          // Also emit activity entry
          const activity = this.toolUseToActivity(
            event.tool_name,
            event.tool_input || {}
          );
          router.emit(ROUTER_EVENTS.ACTIVITY_ENTRY, activity);
        }
        break;

      case 'PostToolUseFailure':
        // Tool use failed
        if (event.tool_name) {
          router.emit(ROUTER_EVENTS.TOOL_USE, {
            id: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            type: 'tool_result',
            toolName: event.tool_name,
            result: event.tool_result,
            isError: true,
            errorMessage: event.error,
            messageId: this.generateId(),
          });
        }
        break;

      case 'SessionEnd':
        router.emit(ROUTER_EVENTS.SESSION_END, {
          id: this.generateId(),
          timestamp: Date.now(),
          sessionId,
          type: 'session_end',
          totalTokens: { inputTokens: 0, outputTokens: 0 },
          totalCost: 0,
        });
        break;

      case 'SubagentStart':
        router.emit(ROUTER_EVENTS.SUBAGENT_START, {
          id: this.generateId(),
          timestamp: Date.now(),
          sessionId,
          type: 'subagent_start',
          subagentId: event.subagent_id || this.generateId(),
          description: event.description || 'Subagent spawned',
          subagentType: event.subagent_type || undefined,
        });
        break;

      case 'SubagentStop':
        router.emit(ROUTER_EVENTS.SUBAGENT_STOP, {
          id: this.generateId(),
          timestamp: Date.now(),
          sessionId,
          type: 'subagent_stop',
          subagentId: event.subagent_id || '',
        });
        break;

      case 'PermissionRequest':
        router.emit(ROUTER_EVENTS.EVENT, {
          id: this.generateId(),
          timestamp: Date.now(),
          sessionId,
          type: 'permission_request',
          toolName: event.tool_name || 'Unknown',
          toolInput: event.tool_input || {},
        });
        break;
    }
  }

  /**
   * Convert tool use to activity entry
   */
  private toolUseToActivity(
    toolName: string,
    toolInput: Record<string, unknown>
  ): {
    id: string;
    timestamp: number;
    icon: string;
    label: string;
    detail: string;
    animation: string;
  } {
    const { icon, label, detail, animation } = this.getToolDisplayInfo(
      toolName,
      toolInput
    );

    return {
      id: this.generateId(),
      timestamp: Date.now(),
      icon,
      label,
      detail,
      animation,
    };
  }

  /**
   * Get display info for a tool
   */
  private getToolDisplayInfo(
    toolName: string,
    toolInput: Record<string, unknown>
  ): { icon: string; label: string; detail: string; animation: string } {
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
      default:
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

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
let hookServer: HookServer | undefined;

export function getHookServer(): HookServer {
  if (!hookServer) {
    hookServer = new HookServer();
  }
  return hookServer;
}
