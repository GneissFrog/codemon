# Overworld Map — Codebase Visualization for CodeMon

## Context

CodeMon's MVP is complete (agent card, activity feed, budget tracking). The next major feature is an **Overworld Map** — a pixel-art visualization of the project's file structure that lights up in real-time as Claude interacts with files. This transforms abstract file paths from the activity feed into a spatial, visual map of the codebase, making it immediately obvious *where* Claude is working.

**Goal**: Add a new sidebar panel that renders the workspace as a treemap of colored tiles, with real-time activity overlays showing Claude's current focus.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/core/codebase-mapper.ts` | Data layer: file tree, activity tracking, treemap layout |
| `src/panels/OverworldMapPanel.ts` | Canvas-based webview rendering the map |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `codemon.overworldMap` view to sidebar |
| `src/extension.ts` | Register panel, wire to event router |
| `src/core/event-types.ts` | Add `FileActivityEvent` interface |

---

## Phase 1: Data Layer (`src/core/codebase-mapper.ts`)

### File Tree + Activity Tracking

Incrementally builds a tree from file paths seen in tool events. No upfront workspace scan required (but supports optional scan for a fuller picture).

```typescript
interface FileNode {
  name: string;           // filename or directory name
  path: string;           // workspace-relative path
  isDir: boolean;
  children: FileNode[];   // populated for directories
  // Activity tracking
  readCount: number;
  writeCount: number;
  lastAccessed: number;   // timestamp
  totalTokens: number;
  isActive: boolean;      // currently being accessed (decays after 3s)
}

interface MapTile {
  node: FileNode;
  x: number;             // pixel position in map space
  y: number;
  width: number;
  height: number;
  color: string;          // base color from file type
  brightness: number;     // 0.0-1.0 from activity level
}
```

### Treemap Layout Algorithm

Uses a **squarified treemap** to allocate rectangular regions to directories proportional to their file count, then arranges files as a grid within each region.

```
1. INPUT: root FileNode, canvas bounds {x, y, w, h}
2. Sort top-level children by weight (file count) descending
3. For each directory child:
   a. Allocate rectangle proportional to weight using squarified strip packing
   b. Recursively lay out children within that rectangle
   c. Reserve 12px header for directory label
4. For leaf files:
   a. Fill remaining space as grid of TILE_SIZE (10x10) tiles
   b. Each tile = one file, colored by extension
5. OUTPUT: flat array of MapTile[]
```

### File Path Extraction from Events

Listen to `TOOL_USE` events and extract file paths:
- `Read` / `Write` / `Edit` → `toolInput.file_path`
- `Glob` → `toolInput.path` (directory being searched)
- `Grep` → `toolInput.path` (directory being searched)
- `Bash` → parse common patterns (`cd`, file args) — best-effort

Convert absolute paths to workspace-relative using `vscode.workspace.workspaceFolders[0]`.

### Biome Colors (PICO-8 Palette)

Map file extensions to terrain colors — reuse existing palette from `pixel-theme.ts`:

| Extension | Biome | Color |
|-----------|-------|-------|
| `.ts`, `.tsx` | Water (blue) | `#29adff` |
| `.js`, `.jsx` | Shallow water | `#1d6daf` |
| `.py` | Forest (green) | `#00e436` |
| `.rs` | Desert (orange) | `#ff77a8` |
| `.go` | Mountains (teal) | `#00b543` |
| `.css`, `.scss` | Town (purple) | `#83769c` |
| `.html` | Castle (warm) | `#ab5236` |
| `.json`, `.yaml`, `.toml` | Stone (gray) | `#5a5d6e` |
| `.md` | Path (brown) | `#7e5539` |
| Unknown | Dark stone | `#3a3d4e` |

---

## Phase 2: Map Panel (`src/panels/OverworldMapPanel.ts`)

### WebviewViewProvider

Follows the exact pattern from `AgentCardPanel.ts`:
- Implements `vscode.WebviewViewProvider`
- Static `viewType = 'codemon.overworldMap'`
- Inline HTML/CSS/JS in `_getHtmlForWebview()`
- CSP with nonce, Google Fonts import
- Uses `PIXEL_THEME_CSS` for base styling

### Canvas Rendering

- Canvas size: **400x300** base (scales with panel width)
- Tile size: **10x10 pixels** (each file is one tile)
- Directory regions have **1px borders** and a **12px label header**
- Rendering loop:
  1. Clear canvas → fill with `--pixel-bg`
  2. Draw directory regions (filled rects with border)
  3. Draw file tiles within regions (colored by type)
  4. Draw activity overlays (glow/pulse on active tiles)
  5. Draw agent cursor (blinking crosshair on most recently accessed file)
  6. Draw directory labels (abbreviated, pixel font)

### Activity Overlays

| State | Visual |
|-------|--------|
| Never accessed | Dim tile (50% opacity) |
| Previously read | Normal brightness |
| Previously written | Normal + subtle border |
| Active right now | Bright + pulsing glow (3s decay) |
| High activity (5+ touches) | Bright + particle sparkle |

### Tooltip (CSS overlay, not canvas)

On `mousemove` over canvas, hit-test against tile positions. If hovering a tile, show a positioned `<div>` tooltip with:
- File name
- Directory path
- Read/write counts
- Last accessed time

### Viewport / Navigation

For large codebases (>100 files), implement:
- **Scroll to zoom**: scale factor 1x–4x
- **Click + drag to pan**: viewport offset tracking
- **Double-click directory**: zoom to fit that directory
- **Breadcrumb bar**: shows current zoom path, clickable to zoom out

---

## Phase 3: Integration

### package.json Changes

Add new view to the `codemon` container:

```json
"views": {
  "codemon": [
    { "type": "webview", "id": "codemon.agentCard", "name": "Agent" },
    { "type": "webview", "id": "codemon.overworldMap", "name": "Map" },
    { "type": "webview", "id": "codemon.activityFeed", "name": "Activity" }
  ]
}
```

Map goes between Agent and Activity — it's the natural "overview" panel.

### extension.ts Changes

1. Import `OverworldMapPanel` and `getCodebaseMapper`
2. Create panel instance + register WebviewViewProvider
3. Wire event routing:

```typescript
// Route tool events to map
eventRouter.on(ROUTER_EVENTS.TOOL_USE, (event: ToolUseEvent) => {
  const filePath = extractFilePath(event);
  if (filePath) {
    codebaseMapper.recordActivity(filePath, event.toolName);
    overworldMapPanel?.updateMap(codebaseMapper.getLayout());
  }
});

// Clear map on session start
eventRouter.on(ROUTER_EVENTS.SESSION_START, () => {
  codebaseMapper.clearActivity(); // keep tree, reset counts
  overworldMapPanel?.updateMap(codebaseMapper.getLayout());
});
```

### event-types.ts Addition

Add a small helper type (optional, keeps types clean):

```typescript
export interface FileActivityUpdate {
  path: string;
  action: 'read' | 'write' | 'search';
  timestamp: number;
}
```

---

## Implementation Order

### Step 1: Skeleton + Basic Rendering (get something on screen)
- Create `codebase-mapper.ts` with simple grid layout (no treemap yet)
- Create `OverworldMapPanel.ts` with canvas rendering colored tile grid
- Register in `package.json` and `extension.ts`
- Hard-code a few test file paths to verify rendering

### Step 2: Event Wiring + Live Data
- Wire to `TOOL_USE` events via event router
- Extract file paths from tool events
- Build file tree incrementally
- Update map on each event

### Step 3: Treemap Layout
- Replace simple grid with squarified treemap algorithm
- Add directory regions with labels
- Handle deep directory nesting (collapse after 3 levels)

### Step 4: Activity Overlays + Agent Cursor
- Implement brightness scaling from activity counts
- Add pulse animation for active tiles (CSS animation on overlay div)
- Add agent cursor crosshair on most recent file
- Add 3-second active decay timer

### Step 5: Interactivity
- Tooltip on hover
- Zoom on scroll wheel
- Pan on click-drag
- Double-click to zoom into directory
- Breadcrumb navigation bar

### Step 6: Polish
- Handle panel resize (recalculate layout)
- Replay state when panel re-opens (like ActivityFeedPanel pattern)
- Empty state when no activity yet
- Optional workspace scan button for pre-populating the tree
- Limit display to 200 tiles max (group small directories into "..." tile)

---

## Key Patterns to Reuse

| Pattern | Source File | How to Reuse |
|---------|------------|-------------|
| WebviewViewProvider pattern | `AgentCardPanel.ts` | Copy class structure, resolve/postMessage pattern |
| Canvas pixel rendering | `AgentCardPanel.ts` | `fillRect`-based drawing, `imageSmoothingEnabled = false` |
| Pixel theme CSS | `pixel-theme.ts` | Import `PIXEL_THEME_CSS`, use CSS variables |
| Event subscription | `extension.ts:setupEventRouting()` | Subscribe to `ROUTER_EVENTS.TOOL_USE` |
| Entry replay on view resolve | `ActivityFeedPanel.ts:resolveWebviewView()` | Cache layout state, replay on panel open |
| Singleton module pattern | `event-router.ts` | `getCodebaseMapper()` singleton |
| File path extraction | `event-router.ts:getToolDisplayInfo()` | Already extracts `file_path` and `pattern` |

---

---

## Bugfix: Map Panel Not Showing Tiles

### Root Cause Analysis

Traced the full data flow from events → map panel. Found **3 bugs** preventing tiles from appearing:

### Bug 1: Windows case-insensitive path comparison (CRITICAL)

**File**: `src/core/codebase-mapper.ts` → `toRelativePath()`

`toRelativePath` uses `startsWith()` to strip the workspace root from absolute paths. On Windows, this is **case-sensitive** but Windows paths are case-insensitive. If VS Code reports `C:\Users\...` and Claude Code reports `c:\Users\...` (or vice versa), `startsWith` fails and `toRelativePath` returns `null` — silently dropping every file path.

**Fix**: Lowercase both sides before comparison on Windows:
```typescript
private toRelativePath(absolutePath: string): string | null {
  if (!absolutePath) return null;
  const normalized = absolutePath.replace(/\\/g, '/');
  const root = this.workspaceRoot.replace(/\\/g, '/');

  if (root) {
    // Case-insensitive comparison for Windows
    const normalizedLower = normalized.toLowerCase();
    const rootLower = root.toLowerCase();
    if (normalizedLower.startsWith(rootLower)) {
      let rel = normalized.slice(root.length); // use original case for the relative part
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel || null;
    }
  }

  if (!path.isAbsolute(absolutePath)) {
    return normalized;
  }
  return null;
}
```

### Bug 2: Glob/Grep `path` is optional — most events return null

**File**: `src/extension.ts` → `extractFilePathFromToolEvent()`

For Glob, `path` is optional (defaults to CWD). For Grep, `path` is also optional. Most Glob/Grep events won't have an explicit `path` field, so `extractFilePathFromToolEvent` returns null for these tools most of the time.

**Fix**: Fall back to `pattern` for Glob (extract directory from pattern), and for both tools, fall back to workspace root if no explicit path:
```typescript
case 'Glob':
  return (input.path as string) || null;  // keep as-is, but at least it won't crash
case 'Grep':
  return (input.path as string) || null;  // same
```
Actually, the better fix is to make Glob/Grep more useful by extracting directory from pattern. But the critical path is Read/Write/Edit — these are the main file interactions and they DO provide `file_path`. So this bug matters less.

### Bug 3: Layout computed at fixed 400×300 but canvas is dynamically sized

**File**: `src/extension.ts` → `sendMapUpdate()` uses `getLayout(400, 300)` hardcoded. The webview canvas auto-sizes to the panel, so tiles computed for 400×300 may be cut off or leave empty space.

**Fix**: Have the webview request layout at its actual size by sending its dimensions to the extension, OR compute the layout at a reference size and let the canvas scale. The simplest fix: use a standard size and let the canvas scaling handle it. This is cosmetic, not a show-stopper.

### Bug 4 (potential): Hook server emits TOOL_USE directly, bypassing the event-router chain

**File**: `src/core/hook-server.ts` line 169

When using hooks mode, the hook server calls `router.emit(ROUTER_EVENTS.TOOL_USE, ...)` directly. The extension's `setupEventRouting` subscribes to `ROUTER_EVENTS.TOOL_USE` on the same router, so this DOES work. But the event router's own `handleToolUse` method would ALSO fire if a log entry arrives, causing **double events**. Not a blocking issue but something to be aware of.

### Files to Modify

| File | Change |
|------|--------|
| `src/core/codebase-mapper.ts` | Fix `toRelativePath()` for Windows case-insensitive paths |
| `src/extension.ts` | Add console.log debugging to trace events through the pipeline |

### Implementation Steps

1. **Fix `toRelativePath` in `codebase-mapper.ts`** — use `.toLowerCase()` on both sides of the `startsWith` check
2. **Add temporary debug logging** in `extension.ts` to confirm events flow:
   - Log when TOOL_USE event arrives (tool name)
   - Log when file path is extracted (or null)
   - Log when `recordActivity` is called
   - Log the tile count from `getLayout`
3. **Build and test** — `npm run compile`, then run Claude Code in the workspace to generate events

### Verification

1. `npm run compile` — no errors
2. Open VS Code Extension Development Host (F5)
3. Start a Claude Code session that reads/writes files in the workspace
4. Check VS Code Developer Console (Help > Toggle Developer Tools) for log messages:
   - `[CodeMon Map] TOOL_USE: Read` — event arrived
   - `[CodeMon Map] File path: src/extension.ts` — path extracted
   - `[CodeMon Map] Layout: 5 tiles` — layout computed
5. Map panel should show colored tiles appearing as Claude works

---

## Bugfix: Pre-existing Session Adoption

### Problem

The extension only worked with the VS Code Claude Code extension if:
1. Claude Code starts a new session AFTER CodeMon loads
2. AND the terminal happens to be focused during the scan

The issue: scanning project files seeds all existing JSONL files as "known" at startup, so any Claude Code session that's already running (from the VS Code extension or a pre-existing terminal) gets ignored.

### Solution

Added a **startup session adoption** mechanism in `session-log-reader.ts`:

1. **Detect recently-active files** - At startup, check which JSONL files were modified in the last 30 seconds
2. **Read recent content** - For active sessions, read the last 64KB of the file
3. **Process events** - Emit the last 100 events from each adopted session
4. **Continue tailing** - After adoption, set position to end and tail as normal

This allows pre-existing sessions to be automatically adopted, including:
- VS Code extension sessions already running
- CLI sessions started before CodeMon loaded
- Any session with recent activity

### Code Changes

**File**: `src/core/session-log-reader.ts`

```typescript
// How recent a file must be modified to be considered "active" (in ms)
const RECENT_ACTIVITY_THRESHOLD = 30 * 1000; // 30 seconds

// Maximum bytes to read from recently-active files at startup
const MAX_STARTUP_READ = 64 * 1024; // 64KB

// In scanExistingLogs():
// - Check mtime of each JSONL file
// - If modified within threshold, add to recentlyActiveFiles list
// - Call adoptRecentSessions() to read and process recent events
```

### Verification

1. Start a Claude Code session (VS Code extension or CLI)
2. Load CodeMon extension (F5)
3. Check console for: `[CodeMon] Found N recently-active session(s), adopting...`
4. Activity Feed and Map should immediately show recent Claude activity
5. New events should continue to appear as Claude works
