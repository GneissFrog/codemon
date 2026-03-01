/**
 * Reads Claude Code session logs (JSONL files)
 * Tails the ~/.claude/ directory for session data
 *
 * IMPORTANT: Handles pre-existing sessions by detecting recently-active
 * JSONL files at startup and reading their recent content to "adopt"
 * ongoing Claude Code sessions (including VS Code extension sessions).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';

// Raw JSONL entry types (from Claude Code logs)
interface JsonlEntry {
  type: string;
  timestamp?: number;
  sessionId?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  error?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  model?: string;
  [key: string]: unknown;
}

export interface SessionLogEvent {
  type: string;
  data: JsonlEntry;
  raw: string;
}

// How recent a file must be modified to be considered "active" (in ms)
const RECENT_ACTIVITY_THRESHOLD = 30 * 1000; // 30 seconds

// Maximum bytes to read from recently-active files at startup
const MAX_STARTUP_READ = 64 * 1024; // 64KB

export class SessionLogReader extends EventEmitter {
  private claudeDir: string;
  private watchers: fs.FSWatcher[] = [];
  private filePositions: Map<string, number> = new Map();
  private isRunning = false;
  private currentSessionId: string | undefined;

  constructor() {
    super();
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Start watching for session logs
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Watch the entire .claude directory for new files
    const watcher = fs.watch(
      this.claudeDir,
      { persistent: false, recursive: false },
      (eventType, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          this.handleLogFileChange(path.join(this.claudeDir, filename));
        }
      }
    );

    this.watchers.push(watcher);

    // Scan for existing JSONL files, adopting recent sessions
    this.scanExistingLogs();

    // Watch for projects subdirectory too
    const projectsDir = path.join(this.claudeDir, 'projects');
    if (fs.existsSync(projectsDir)) {
      const projectsWatcher = fs.watch(
        projectsDir,
        { persistent: false, recursive: true },
        (eventType, filename) => {
          if (filename && filename.endsWith('.jsonl')) {
            this.handleLogFileChange(path.join(projectsDir, filename));
          }
        }
      );
      this.watchers.push(projectsWatcher);
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.isRunning = false;
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    this.filePositions.clear();
  }

  /**
   * Scan for existing log files
   * For recently-active files, read recent content to adopt pre-existing sessions
   */
  private scanExistingLogs(): void {
    const now = Date.now();
    const recentlyActiveFiles: { path: string; stat: fs.Stats }[] = [];

    try {
      // Check root level
      const files = fs.readdirSync(this.claudeDir);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(this.claudeDir, file);
          try {
            const stat = fs.statSync(filePath);

            // Check if file was modified recently (active session)
            const mtimeAge = now - stat.mtimeMs;
            if (mtimeAge < RECENT_ACTIVITY_THRESHOLD && stat.size > 0) {
              recentlyActiveFiles.push({ path: filePath, stat });
            } else {
              // Old/inactive file - start from end
              this.filePositions.set(filePath, stat.size);
            }
          } catch {
            // File might have been deleted
          }
        }
      }

      // Check projects subdirectory
      const projectsDir = path.join(this.claudeDir, 'projects');
      if (fs.existsSync(projectsDir)) {
        this.scanProjectsDir(projectsDir, recentlyActiveFiles, now);
      }

      // Adopt recently-active sessions by reading their recent content
      this.adoptRecentSessions(recentlyActiveFiles);

    } catch (err) {
      // Directory might not exist yet
      console.log('[CodeMon] Session log directory not found or empty');
    }
  }

  /**
   * Recursively scan projects directory
   */
  private scanProjectsDir(
    dir: string,
    recentlyActiveFiles: { path: string; stat: fs.Stats }[],
    now: number
  ): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.scanProjectsDir(fullPath, recentlyActiveFiles, now);
        } else if (entry.name.endsWith('.jsonl')) {
          try {
            const stat = fs.statSync(fullPath);
            const mtimeAge = now - stat.mtimeMs;

            if (mtimeAge < RECENT_ACTIVITY_THRESHOLD && stat.size > 0) {
              recentlyActiveFiles.push({ path: fullPath, stat });
            } else {
              // Old/inactive file - start from end
              this.filePositions.set(fullPath, stat.size);
            }
          } catch {
            // File might have been deleted
          }
        }
      }
    } catch {
      // Directory might not be accessible
    }
  }

  /**
   * Adopt recently-active sessions by reading their recent content
   * This allows pre-existing Claude Code sessions (like VS Code extension)
   * to be picked up without requiring a new session to start.
   */
  private adoptRecentSessions(
    recentlyActiveFiles: { path: string; stat: fs.Stats }[]
  ): void {
    if (recentlyActiveFiles.length === 0) {
      return;
    }

    console.log(`[CodeMon] Found ${recentlyActiveFiles.length} recently-active session(s), adopting...`);

    for (const { path: filePath, stat } of recentlyActiveFiles) {
      try {
        // Read the last N bytes of the file to catch recent activity
        const readSize = Math.min(stat.size, MAX_STARTUP_READ);
        const startPosition = stat.size - readSize;

        console.log(`[CodeMon] Reading recent activity from ${path.basename(filePath)} (${readSize} bytes)`);

        // Read and process recent lines
        this.readAndProcessRecentLines(filePath, startPosition, stat.size);

        // Set position to end after reading
        this.filePositions.set(filePath, stat.size);
      } catch (err) {
        console.error(`[CodeMon] Failed to adopt session ${path.basename(filePath)}:`, err);
        // Still set position to end so we don't re-read on error
        this.filePositions.set(filePath, stat.size);
      }
    }
  }

  /**
   * Read and process recent lines from a file
   */
  private readAndProcessRecentLines(
    filePath: string,
    startPosition: number,
    endPosition: number
  ): void {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(65536);
      let position = startPosition;
      let leftover = '';
      const lines: string[] = [];

      // Read all data from start to end
      while (position < endPosition) {
        const bytesToRead = Math.min(buffer.length, endPosition - position);
        const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, position);
        if (bytesRead === 0) break;

        position += bytesRead;
        const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
        const chunkLines = chunk.split('\n');

        // Keep the last incomplete line
        leftover = chunkLines.pop() || '';

        for (const line of chunkLines) {
          if (line.trim()) {
            lines.push(line);
          }
        }
      }

      fs.closeSync(fd);

      // Process lines (limit to last 100 to avoid overwhelming)
      const linesToProcess = lines.slice(-100);
      for (const line of linesToProcess) {
        this.processLine(line, filePath);
      }

      console.log(`[CodeMon] Adopted ${linesToProcess.length} recent events from ${path.basename(filePath)}`);
    } catch (err) {
      console.error('[CodeMon] Error reading recent lines:', err);
    }
  }

  /**
   * Handle changes to a log file
   */
  private handleLogFileChange(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const lastPosition = this.filePositions.get(filePath) || 0;

      // Only read if file has grown
      if (stat.size > lastPosition) {
        this.readNewLines(filePath, lastPosition);
      }
    } catch {
      // File might have been deleted
    }
  }

  /**
   * Read new lines from a file
   */
  private readNewLines(filePath: string, startPosition: number): void {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(65536); // 64KB buffer
      let position = startPosition;
      let leftover = '';

      while (true) {
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;

        position += bytesRead;
        const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
        const lines = chunk.split('\n');

        // Keep the last incomplete line
        leftover = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.processLine(line, filePath);
          }
        }
      }

      fs.closeSync(fd);
      this.filePositions.set(filePath, position + leftover.length);
    } catch (err) {
      console.error('Error reading log file:', err);
    }
  }

  /**
   * Process a single JSONL line
   */
  private processLine(line: string, filePath: string): void {
    try {
      const entry: JsonlEntry = JSON.parse(line);

      // Extract session ID from file path if not in entry
      if (!entry.sessionId) {
        entry.sessionId = this.extractSessionId(filePath);
      }

      // Track current session
      if (entry.sessionId) {
        this.currentSessionId = entry.sessionId;
      }

      this.emit('entry', {
        type: entry.type,
        data: entry,
        raw: line,
      } as SessionLogEvent);
    } catch {
      // Invalid JSON, skip
    }
  }

  /**
   * Extract session ID from file path
   */
  private extractSessionId(filePath: string): string {
    const basename = path.basename(filePath, '.jsonl');
    // Session IDs are typically in the filename
    return basename;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }
}

// Singleton instance
let sessionLogReader: SessionLogReader | undefined;

export function getSessionLogReader(): SessionLogReader {
  if (!sessionLogReader) {
    sessionLogReader = new SessionLogReader();
  }
  return sessionLogReader;
}
