# CodeMon - RPG Observability Layer for Claude Code

A VS Code extension that provides a pixel-art RPG visualization over real Claude Code agent activity. It is not a game. It is an observability tool that happens to look like one.

## Features

### Game View Panel (Main Interface)
A consolidated pixel-art interface showing:
- **Agent sprite** - Animated character with directional movement and action animations
- **Overworld map** - Your codebase visualized as a 2D tile-based world
- **Activity feed** - Real-time log of tool invocations
- **Budget tracking** - Live token/cost visualization

### Overworld Map
Your file system visualized as a pixel-art farm/world:
- **Files as crops/plots** - Different file types shown as different tile types
- **Directories as fields** - Fenced areas containing related files
- **Agent movement** - Watch the agent walk between files as it works
- **Treemap layout** - Spatial organization based on file structure
- **Color-coded** - File types distinguished by PICO-8 palette colors

### Live Activity Feed
Each tool invocation visualized in real-time:
- **Tool icons** - Visual indicators for Read, Write, Bash, Search, etc.
- **Token costs** - See token usage per action
- **Animations** - Sprite reacts to tool use (investigate, write, bash, walk)
- **Session totals** - Cumulative token and cost tracking

### Budget Tracking
Real-time spend visualization:
- **Status bar** - Always-visible token counter with color warnings
- **Expanded panel** - Detailed breakdown with input/output/cache segments
- **Multiple modes** - Track by tokens, dollars, or subscription

## Installation

### From Source

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run compile
   ```
4. Press F5 in VS Code to launch the Extension Development Host

### Packaging

To create a VSIX package:
```bash
npx vsce package
```

## Usage

Once installed, CodeMon automatically activates on startup. Open the Game View:
- Press `Ctrl+Shift+G` (or `Cmd+Shift+G` on Mac)
- Or run "CodeMon: Open Game View" from the command palette

The status bar shows your current token usage with color-coded warnings.

## Integration Modes

CodeMon supports two ways to receive Claude Code events:

### Session Logs (Default)
Automatically watches `~/.claude/` for JSONL session files. No configuration needed - just start using Claude Code and CodeMon picks up the activity.

### Hooks (CLI Users)
For CLI-based Claude Code usage:

1. Run `Ctrl+Shift+P` → "CodeMon: Install Claude Code Hooks"
2. This adds hook configuration to `.claude/settings.json`
3. A local HTTP server (port 22140) receives events

## Commands

| Command | Description |
|---------|-------------|
| `CodeMon: Open Game View` | Open the main pixel-art interface |
| `CodeMon: Show Budget Details` | Open expanded budget panel |
| `CodeMon: Install Claude Code Hooks` | Set up CLI integration |
| `CodeMon: Open Sprite Configuration` | Configure character sprites |

## Settings

Configure via VS Code settings (`Ctrl+,` → search "CodeMon"):

| Setting | Description | Default |
|---------|-------------|---------|
| `codemon.budget.mode` | Track by tokens, dollars, or subscription | `subscription` |
| `codemon.budget.dailyTokenLimit` | Daily token budget | `500000` |
| `codemon.budget.dailyDollarLimit` | Daily dollar budget | `10` |
| `codemon.sprite` | Agent sprite (auto assigns by model) | `auto` |
| `codemon.sounds.enabled` | 8-bit sound effects | `false` |
| `codemon.integration.mode` | Event source: auto, session-logs, or hooks | `auto` |
| `codemon.gameView.animations.enabled` | Walking and idle animations | `true` |
| `codemon.gameView.agentWalkingSpeed` | Agent movement speed (0.05-0.5) | `0.08` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   Game View Panel                       │ │
│  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  │ │
│  │  │  Overworld   │  │  Activity   │  │   Budget     │  │ │
│  │  │    Map       │  │   Feed      │  │   Display    │  │ │
│  │  └──────────────┘  └─────────────┘  └──────────────┘  │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           │                                  │
│                  ┌────────▼────────┐                        │
│                  │  Event Router   │◄──── Hook Server       │
│                  └────────┬────────┘     (port 22140)       │
│                           │                                  │
│                  ┌────────▼───────────────────────┐         │
│                  │   Session Log Reader (JSONL)   │         │
│                  └────────┬───────────────────────┘         │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
                 ┌──────────▼──────────┐
                 │  ~/.claude/*.jsonl  │
                 └─────────────────────┘
```

## Project Structure

```
codemon/
├── src/
│   ├── extension.ts              # Entry point
│   ├── core/
│   │   ├── event-types.ts        # Event interfaces
│   │   ├── event-router.ts       # Central event bus
│   │   ├── session-log-reader.ts # JSONL tailing
│   │   ├── hook-server.ts        # HTTP server for hooks
│   │   ├── config-reader.ts      # Claude settings parser
│   │   ├── token-calculator.ts   # Cost computation
│   │   ├── budget-tracker.ts     # Spend tracking
│   │   ├── codebase-mapper.ts    # File tree for map
│   │   └── settings.ts           # Extension settings
│   ├── panels/
│   │   ├── GameViewPanel.ts      # Main game interface
│   │   ├── SpriteConfigPanel.ts  # Sprite configuration
│   │   ├── ActivityFeedPanel.ts  # Activity log
│   │   └── BudgetBarPanel.ts     # Budget details
│   ├── overworld/
│   │   ├── core/
│   │   │   ├── types.ts          # Overworld types
│   │   │   └── AssetLoader.ts    # Spritesheet loader
│   │   └── world/
│   │       ├── WorldMap.ts       # Tile grid & camera
│   │       └── WorldGenerator.ts # Procedural layout
│   ├── statusbar/
│   │   └── BudgetStatusBar.ts    # Status bar item
│   └── webview/
│       └── shared/
│           └── pixel-theme.ts    # CSS + animations
├── assets/
│   ├── config/
│   │   └── sprite-manifest.json  # Sprite definitions
│   ├── icons/
│   │   └── codemon-icon.svg
│   └── sprites/
│       ├── characters/           # Character spritesheets
│       ├── objects/              # Objects & furniture
│       ├── tilesets/             # Ground tiles
│       └── effects/              # Visual effects
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## Development

### Build
```bash
npm run compile
```

### Watch Mode
```bash
npm run watch
```

### Test
Press F5 in VS Code to launch Extension Development Host.

## Credits

- Pixel art sprites from [Sprout Lands](https://cupnooble.itch.io/sprout-lands-asset-pack) asset pack
- Built with VS Code Extension API

## License

MIT
