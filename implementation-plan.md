# CodeMon: RPG Observability Layer for Claude Code

## Implementation Plan — MVP

---

## What We're Building

A VS Code extension that provides a pixel-art RPG skin over real Claude Code agent activity. It is not a game. It is an observability tool that happens to look like one.

**MVP delivers three things:**

1. **Agent Card** — Your active Claude Code agent displayed as a pixel-art character with its real config (model, tools, permissions)
2. **Live Activity Feed** — Each tool invocation visualized as a turn-by-turn animation with real token costs
3. **Budget Bar** — Your token spend draining in real time as a visual energy meter

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   VS Code Extension                  │
│                                                      │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Agent Card   │  │ Activity    │  │  Budget    │ │
│  │  Panel        │  │ Feed Panel  │  │  Bar       │ │
│  └──────┬───────┘  └──────┬──────┘  └─────┬──────┘ │
│         │                 │               │         │
│         └────────┬────────┴───────┬───────┘         │
│                  │                │                  │
│         ┌────────▼────────┐      │                  │
│         │  Event Router   │      │                  │
│         └────────┬────────┘      │                  │
│                  │               │                  │
│         ┌────────▼────────────────▼──────┐          │
│         │     Data Layer / State Store    │          │
│         └────────┬───────────────────────┘          │
│                  │                                   │
└──────────────────┼───────────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │   Claude Agent SDK  │
        │   (Event Stream)    │
        └─────────────────────┘
```

### How data flows in

The extension consumes events from Claude Code. There are two integration paths, and we should support both:

**Path A: Claude Agent SDK (TypeScript) — Primary**

The Claude Agent SDK streams structured messages during agent execution. We hook into these directly. Key message types we consume:

| SDK Message Type | What it tells us |
|---|---|
| `SessionStart` | Agent session began — capture model, config |
| `assistant` (with `message.usage`) | Token usage per step — input, output, cache |
| `tool_use` content blocks | Which tool was invoked and with what input |
| `tool_result` content blocks | What the tool returned |
| `SDKToolProgressMessage` | Tool is still running (elapsed time) |
| `result` | Session complete — `total_cost_usd`, `modelUsage` breakdown |
| `SubagentStart` / `SubagentStop` | Subagent lifecycle |
| `PermissionRequest` | Agent is asking for approval |

**Path B: Claude Code Hooks (shell-based) — Secondary**

For users running Claude Code via CLI rather than the SDK, the extension can also consume events from Claude Code's hook system. A set of hook scripts (installed in the project's `.claude/` directory) POST events to a local HTTP server run by the extension.

This is the same pattern used by the `claude-code-hooks-multi-agent-observability` project. Hook events available:

- `PreToolUse` / `PostToolUse` / `PostToolUseFailure`
- `SessionStart` / `SessionEnd`
- `SubagentStart` / `SubagentStop`
- `Notification` / `Stop`
- `PermissionRequest`

Both paths feed the same internal event router and state store.

---

## Component 1: Agent Card Panel

### What it shows (all real data)

```
┌─────────────────────────────────┐
│  [pixel art sprite]             │
│                                 │
│  agent-name (from config)       │
│  Model: claude-sonnet-4-5       │
│  Context: 128k tokens           │
│                                 │
│  Tools:                         │
│  ⚔ Read    ⚔ Write             │
│  ⚔ Bash    ⚔ MCP: postgres     │
│                                 │
│  Permissions:                   │
│  ✅ File edit (auto)            │
│  ⚠️ Bash (ask)                  │
│  ❌ Network (blocked)           │
│                                 │
│  System prompt: "Backend TS     │
│  specialist, prefers small      │
│  PRs..."                        │
└─────────────────────────────────┘
```

### Data sources

- **Model**: From `SessionStart` event → `model` field, or parsed from `~/.claude/settings.json`
- **Tools**: From the agent's `allowedTools` configuration. Also inferred dynamically from observed `tool_use` events during the session
- **Permissions**: From `~/.claude/settings.json` and project-level `.claude/settings.json` — the `permissions` and `allowedTools` fields
- **System prompt summary**: From `CLAUDE.md` in the project root (the file Claude Code reads for project context). Display first ~100 chars as the agent's "personality"
- **Sprite**: User-selected from a sprite sheet, or auto-assigned based on model (e.g., Opus = heavy knight, Sonnet = ranger, Haiku = rogue)

### Implementation

- VS Code **Webview Panel** in the sidebar (Activity Bar icon)
- Rendered with HTML/CSS/Canvas — pixel art sprites are small PNGs or drawn on a `<canvas>`
- Sprite sheet: ~16x16 or 32x32 pixel characters, bundled with the extension
- Reads config on activation and on `SessionStart` events
- Updates tool list dynamically as new tools are observed

### Key files

```
src/
  panels/
    AgentCardPanel.ts        — VS Code webview provider
  webview/
    agent-card/
      index.html             — Card layout
      styles.css             — Pixel art aesthetic, CRT scanline optional
      sprite-renderer.ts     — Canvas-based sprite drawing
      config-reader.ts       — Reads claude settings + CLAUDE.md
  assets/
    sprites/                 — Sprite sheet PNGs
```

---

## Component 2: Live Activity Feed

### What it shows

Each Claude Code tool invocation appears as a line item with a micro-animation. The feed scrolls in real time.

```
┌─────────────────────────────────────────┐
│  ACTIVITY                               │
│                                         │
│  🔍 Read File                           │
│     src/auth/session.ts                 │
│     1,247 tokens                        │
│     [sprite does "investigate" anim]    │
│                                         │
│  🔍 Read File                           │
│     src/auth/types.ts                   │
│     832 tokens                          │
│                                         │
│  💭 Thinking...                         │
│     Planning approach                   │
│     2,100 tokens                        │
│                                         │
│  ✏️ Write File                          │
│     src/auth/session.ts                 │
│     3,400 tokens                        │
│                                         │
│  ⚡ Bash                                │
│     npm test -- --grep "session"        │
│     150 tokens                          │
│  ❌ 2 tests failed                      │
│                                         │
│  ✏️ Write File                          │
│     src/auth/session.ts                 │
│     1,800 tokens                        │
│                                         │
│  ⚡ Bash                                │
│     npm test -- --grep "session"        │
│     150 tokens                          │
│  ✅ All passing                         │
│                                         │
│  Session total: 9,679 tokens ($0.12)    │
└─────────────────────────────────────────┘
```

### Event-to-display mapping

| Claude Code Event | Display |
|---|---|
| `tool_use` where `name = "Read"` | 🔍 **Read File** + file path + token cost |
| `tool_use` where `name = "Write"` or `"Edit"` | ✏️ **Write File** / **Edit File** + file path + token cost |
| `tool_use` where `name = "Bash"` | ⚡ **Bash** + command (truncated) + token cost |
| `tool_use` where `name = "Glob"` or `"Grep"` | 🔎 **Search** + pattern + token cost |
| `tool_use` where `name = "MCP:*"` | 🔌 **MCP: [server]** + tool name + token cost |
| `tool_result` with error | ❌ Error message (brief) |
| `tool_result` with success | ✅ (on Bash results with exit code 0) |
| `assistant` text content (thinking) | 💭 **Thinking...** + brief excerpt |
| `PermissionRequest` | ⚠️ **Awaiting permission** + tool + input |
| `SubagentStart` | 🤖 **Subagent spawned** + description |

### Token cost per action

The Agent SDK provides `message.usage` on each `assistant` message with `input_tokens` and `output_tokens`. We compute cost using known model pricing:

```typescript
interface ModelPricing {
  inputPer1M: number;   // $ per 1M input tokens
  outputPer1M: number;  // $ per 1M output tokens
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":    { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  "claude-sonnet-4-5":  { inputPer1M: 3,  outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  "claude-haiku-4-5":   { inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
};
// These prices should be configurable and fetched/updated
```

For Max/Pro subscribers where dollar cost isn't relevant, show token counts only.

### Animations

Keep it minimal and performant. The sprite in the Agent Card panel does a small animation corresponding to the current action type:

| Action Type | Animation |
|---|---|
| Read / Search | Sprite looks through magnifying glass (2-3 frames) |
| Write / Edit | Sprite holds quill, scribbles (2-3 frames) |
| Bash | Sprite raises wand/staff, spark effect (2-3 frames) |
| Thinking | Sprite idle with thought bubble (looping) |
| Error | Sprite flinches, brief red flash |
| Success | Sprite does small victory pose |
| Idle | Sprite breathes / blinks (looping) |

Animations are sprite sheet frames, not JS animations. Lightweight, no performance impact.

### Implementation

- Second **Webview Panel**, can be in the same sidebar or a separate tab
- Events streamed via `postMessage` from extension host to webview
- Feed is a scrolling `<div>` with CSS transitions for new entries
- Each entry fades in, briefly highlights, then settles
- Auto-scroll to bottom, with scroll-lock if user scrolls up

### Key files

```
src/
  panels/
    ActivityFeedPanel.ts     — VS Code webview provider
  webview/
    activity-feed/
      index.html
      styles.css
      feed-renderer.ts       — Appends entries, manages scroll
      event-mapper.ts        — Maps SDK events to display format
  core/
    event-router.ts          — Receives SDK/hook events, dispatches to panels
    token-calculator.ts      — Computes cost from usage data
```

---

## Component 3: Budget Bar

### What it shows

A horizontal energy bar, always visible, showing token spend against budget.

```
┌──────────────────────────────────────────────┐
│  ⚡ 6,321 / 50,000 tokens   $0.12 / $5.00   │
│  ████████████░░░░░░░░░░░░░░░░░░░░░  12.6%   │
└──────────────────────────────────────────────┘
```

### Behavior

- **Color**: Green (>60%), Yellow (20-60%), Red (<20%), Pulsing red (<5%)
- **Budget source**: User-configured in extension settings (daily token limit or dollar limit). For API users, can also read from workspace spend limits if available
- **Drain animation**: Bar smoothly decreases on each token usage update, not jumpy
- **Segments**: Subtle tick marks showing how much each task/session consumed — hover to see breakdown
- **Tooltip on hover**: Detailed breakdown — input vs output tokens, cache hits, cost by model

### For Max/Pro subscribers

Dollar cost is hidden (subscription covers it). Instead show:

```
⚡ 6,321 tokens this session │ ██████████░░░░░░░░░░░ │ 45 min remaining (est.)
```

Estimated time remaining based on the 5-hour token window and current burn rate.

### Implementation

- **VS Code Status Bar Item** (bottom bar) for the compact view — always visible
- Click to expand into a small **Webview Panel** with the detailed segmented bar
- Updates on every `assistant` message with usage data
- Stores cumulative session data in extension state

### Key files

```
src/
  panels/
    BudgetBarPanel.ts        — Expanded view webview
  statusbar/
    BudgetStatusBar.ts       — Compact status bar item
  core/
    budget-tracker.ts        — Accumulates usage, computes remaining
    settings.ts              — User-configured budget limits
```

---

## Integration Layer

### Option A: Agent SDK integration (primary)

For users who run Claude Code through the VS Code extension or programmatically via the TypeScript SDK.

```typescript
// Pseudocode — wrapping the Agent SDK stream
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt, options })) {
  switch (message.type) {
    case "assistant":
      // Extract tool_use blocks from message.message.content
      // Extract usage from message.message.usage
      eventRouter.emit("tool_use", { ... });
      eventRouter.emit("usage", { ... });
      break;
    case "result":
      eventRouter.emit("session_end", {
        totalCost: message.total_cost_usd,
        modelUsage: message.modelUsage,
      });
      break;
  }
}
```

**Challenge**: The official Claude Code VS Code extension controls the agent session. Our extension needs to observe without interfering.

**Approach**: Read Claude Code's local JSONL session logs. Claude Code writes conversation data to `~/.claude/` as JSONL files. We tail these files for events. This is the same approach `ccusage` and `Claude-Code-Usage-Monitor` use. No SDK wrapper needed — pure observation.

```typescript
// Watch for new JSONL entries
const watcher = fs.watch(claudeSessionDir, (eventType, filename) => {
  if (filename?.endsWith('.jsonl')) {
    // Read new lines, parse, route to panels
  }
});
```

### Option B: Hook-based integration (CLI users)

For users who run `claude` in the terminal.

The extension starts a lightweight local HTTP server (e.g., port 22140). Hook scripts in `.claude/settings.json` POST events to this server.

```json
// .claude/settings.json hook configuration
{
  "hooks": {
    "PreToolUse": [{ "type": "command", "command": "curl -s -X POST http://localhost:22140/events -d @-" }],
    "PostToolUse": [{ "type": "command", "command": "curl -s -X POST http://localhost:22140/events -d @-" }],
    "SessionStart": [{ "type": "command", "command": "curl -s -X POST http://localhost:22140/events -d @-" }],
    "SessionEnd": [{ "type": "command", "command": "curl -s -X POST http://localhost:22140/events -d @-" }]
  }
}
```

The extension provides a command to auto-install these hooks.

---

## Project Structure

```
codemon/
├── package.json                    — Extension manifest
├── tsconfig.json
├── webpack.config.js               — Bundle extension + webviews
│
├── src/
│   ├── extension.ts                — Activation, register panels + commands
│   │
│   ├── core/
│   │   ├── event-router.ts         — Central event bus
│   │   ├── event-types.ts          — Normalized event interfaces
│   │   ├── session-log-reader.ts   — Tails Claude JSONL session logs
│   │   ├── hook-server.ts          — Local HTTP server for hook events
│   │   ├── token-calculator.ts     — Usage → cost computation
│   │   ├── budget-tracker.ts       — Cumulative spend tracking
│   │   ├── config-reader.ts        — Reads claude settings + CLAUDE.md
│   │   └── settings.ts             — Extension settings (budget, sprite, etc.)
│   │
│   ├── panels/
│   │   ├── AgentCardPanel.ts       — Sidebar agent card webview
│   │   ├── ActivityFeedPanel.ts    — Activity log webview
│   │   └── BudgetBarPanel.ts       — Expanded budget view
│   │
│   ├── statusbar/
│   │   └── BudgetStatusBar.ts      — Compact budget in status bar
│   │
│   └── webview/
│       ├── shared/
│       │   ├── pixel-theme.css     — Shared pixel art aesthetic
│       │   └── sprite-sheet.ts     — Sprite loading + frame selection
│       │
│       ├── agent-card/
│       │   ├── index.html
│       │   ├── card.ts
│       │   └── sprite-renderer.ts  — Canvas sprite with animations
│       │
│       ├── activity-feed/
│       │   ├── index.html
│       │   ├── feed.ts
│       │   └── event-mapper.ts     — SDK event → display entry
│       │
│       └── budget-bar/
│           ├── index.html
│           └── bar.ts              — Animated drain bar
│
├── assets/
│   ├── sprites/
│   │   ├── opus-knight.png         — 32x32 sprite sheet, 6 frames
│   │   ├── sonnet-ranger.png
│   │   ├── haiku-rogue.png
│   │   └── custom/                 — User-importable sprites
│   ├── icons/
│   │   ├── codemon-icon.png        — Activity bar icon
│   │   └── tool-icons.png          — Small icons for tool types
│   └── sounds/                     — Optional: tiny 8-bit sfx (off by default)
│
└── test/
    ├── core/
    │   ├── event-router.test.ts
    │   ├── token-calculator.test.ts
    │   └── session-log-reader.test.ts
    └── panels/
        └── ...
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2) ✅ COMPLETE

**Goal**: Extension scaffolding, event pipeline, one panel rendering real data.

- [x] Scaffold VS Code extension with `yo code` generator
- [x] Implement `config-reader.ts` — parse `~/.claude/settings.json`, project `.claude/settings.json`, and `CLAUDE.md`
- [x] Implement `session-log-reader.ts` — find and tail Claude's JSONL session logs
- [x] Implement `event-router.ts` — normalize JSONL log entries into typed events
- [x] Implement `event-types.ts` — define `ToolUseEvent`, `UsageEvent`, `SessionEvent` interfaces
- [x] Create `AgentCardPanel` — static webview showing real config data, no sprite yet
- [x] Verify end-to-end: launch extension → start Claude Code session → see config appear in card

### Phase 2: Activity Feed (Week 3-4) ✅ COMPLETE

**Goal**: Live tool invocation feed with token costs.

- [x] Implement `event-mapper.ts` — map raw events to display entries (icon, label, detail, cost)
- [x] Implement `token-calculator.ts` — compute per-action and cumulative costs from usage data
- [x] Create `ActivityFeedPanel` — scrolling webview with entry rendering
- [x] Wire event router → activity feed via `postMessage`
- [x] Add entry animations (CSS fade-in, highlight)
- [x] Handle edge cases: parallel tool use (dedup by message ID), subagent events, permission requests
- [x] Verify: run a real Claude Code task, see each action appear in the feed with correct token counts

### Phase 3: Budget Bar (Week 5) ✅ COMPLETE

**Goal**: Real-time spend visualization.

- [x] Implement `budget-tracker.ts` — accumulate usage across session, persist across reloads
- [x] Implement `settings.ts` — extension settings for budget (daily token limit, dollar limit, or subscription mode)
- [x] Create `BudgetStatusBar` — compact status bar item with color-coded spend
- [x] Create `BudgetBarPanel` — expanded view with segmented bar and hover tooltips
- [x] Add drain animation (smooth CSS transitions on width change)
- [x] Handle subscription vs API mode display

### Phase 4: Pixel Art Layer (Week 6-7) ✅ COMPLETE

**Goal**: Make it look like a game.

- [x] Design sprite sheets — 3 base characters (Opus/Sonnet/Haiku), canvas-based sprites
- [x] Implement sprite rendering — canvas-based sprite drawing with frame animation (inline in webview)
- [x] Create `pixel-theme.ts` — pixel art font (Press Start 2P), CRT-style borders, dark color palette
- [x] Add sprite to Agent Card — animated idle loop
- [x] Add action-triggered animations — sprite reacts to tool use events in the activity feed
- [x] Add tool icons as small pixel art elements
- [x] Extension icon and branding

### Phase 5: Hook Server + Polish (Week 8) ✅ COMPLETE

**Goal**: Support CLI users, polish UX.

- [x] Implement `hook-server.ts` — local HTTP server receiving hook POSTs
- [x] Add command: "CodeMon: Install Hooks" — writes hook config to `.claude/settings.json`
- [x] Auto-detect integration mode (SDK logs vs hooks)
- [x] Settings UI: configure budget, choose sprite, toggle sounds (via VS Code settings)
- [ ] Sound effects (optional, off by default): tiny 8-bit blips on tool use (deferred)
- [x] Performance testing — ensure no perceptible impact on VS Code
- [x] Write README

---

## Extension Settings

```jsonc
// package.json contributes.configuration
{
  "codemon.budget.mode": {
    "type": "string",
    "enum": ["tokens", "dollars", "subscription"],
    "default": "subscription",
    "description": "How to track your budget"
  },
  "codemon.budget.dailyTokenLimit": {
    "type": "number",
    "default": 500000,
    "description": "Daily token budget (when mode is 'tokens')"
  },
  "codemon.budget.dailyDollarLimit": {
    "type": "number",
    "default": 10,
    "description": "Daily dollar budget (when mode is 'dollars')"
  },
  "codemon.sprite": {
    "type": "string",
    "enum": ["auto", "knight", "ranger", "rogue", "custom"],
    "default": "auto",
    "description": "Agent sprite (auto assigns based on model)"
  },
  "codemon.sounds.enabled": {
    "type": "boolean",
    "default": false,
    "description": "8-bit sound effects on agent actions"
  },
  "codemon.integration.mode": {
    "type": "string",
    "enum": ["auto", "session-logs", "hooks"],
    "default": "auto",
    "description": "How to receive Claude Code events"
  }
}
```

---

## Technical Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude JSONL log format changes between versions | Breaks session-log-reader | Version-detect Claude Code, abstract log parsing behind interface, add fallback to hook mode |
| JSONL logs don't contain per-tool token breakdowns | Budget bar shows session totals only, not per-action | Use message-level usage (available) and attribute proportionally to tool calls within that step |
| Official Claude Code extension conflicts | Two extensions fighting over the same agent session | Our extension is read-only — it only observes, never writes or controls the agent |
| Webview performance with long sessions | Feed becomes sluggish after 1000+ entries | Virtual scrolling (render only visible entries), auto-archive old entries |
| Token pricing changes | Cost calculations become inaccurate | Make pricing configurable, add a "last updated" indicator, fetch from a config URL |

---

## What This Is Not (Yet)

This plan deliberately excludes:

- **The overworld / codebase map** — Future phase, after MVP validates the concept
- **Wild encounters / task visualization** — Future phase
- **Battle system / turn-based UI** — Future phase
- **Agent marketplace / community** — Future phase
- **Multi-agent party management** — Future phase, but the architecture supports it (event router already handles subagent events)

The MVP proves that the RPG observability concept is viable, useful, and fun. Everything else builds on this foundation.
