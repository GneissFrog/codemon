# Design Brief: ContextFarm (VS Code Extension)
**Visualizing Agentic Coding and Context Management through Pixel Art**

---

## 1. Executive Overview

**ContextFarm** transforms the invisible, abstract processes of AI coding agents into a tangible, delightful 2D pixel-art farm.

**The Pivot**: Instead of visualizing the entire static codebase (which fails at scale), this extension visualizes **the Agent's Context Window** — the LLM's working memory. By representing context as a finite plot of land, developers instantly understand:
- *What* files the AI is actively considering
- *How much* token space is being consumed
- *What* will be "forgotten" next when context fills

**Philosophy**: "Context Farming" vs "Prompt Engineering" — treating the context window as an ecosystem to be observed, monitored, and eventually managed, not just a buffer to fill.

---

## 2. Core Metaphor: The Context Farm

| Concept | Farm Metaphor | Visual |
|---------|---------------|--------|
| Context Window | Farm Field | Finite grid with visible boundaries |
| Files in Context | Crops | Size correlates to token weight |
| Queue Order | Conveyor Belt | Left = fresh, Right = exit zone |
| AI Agent | Farmer | Animated character performing actions |
| Token Budget | Water Tower | Fills based on cumulative tokens |
| Errors/Failed Tests | Bugs | Caterpillars/beetles on affected crops |
| Test Health | Weather | Sunny → Overcast → Thunderstorm |

---

## 3. Visual Mechanics

### A. Crop Sizing (Token-Based)
When the agent reads a file, a crop is planted. Size correlates to **estimated tokens**:

| Token Estimate | Crop Type | Grid Size |
|----------------|-----------|-----------|
| <500 | Radish | 1x1 tile |
| 500-2000 | Corn | 2x2 tiles |
| 2000-8000 | Pumpkin | 3x3 tiles |
| >8000 | Giant Pumpkin | 4x4 tiles (context bloat warning) |

Token estimation: `Math.ceil(contentLength / 4)` (approx 4 chars per token)

### B. Queue Visualization
Context windows operate as FIFO queues — when full, oldest entries are evicted. Queue position is shown via:

| Position | Visual | Meaning |
|----------|--------|---------|
| Low (0-20%) | Fresh green tint | Recently accessed, safe |
| Middle (20-80%) | Normal colors | Active in context |
| High (80%+) | Red outline | Exit zone — will be evicted next |

**Exit Zone**: Plots in the top 20% of queue position (when context >80% full) get a pulsing red outline warning.

### C. Farmer Animations (Tool Actions)
| Tool | Farmer Action | Animation |
|------|---------------|-----------|
| `Glob`/`Grep` | Scouting | Safari hat, magnifying glass |
| `Read` | Planting | Place seed, inspect with notebook |
| `Write`/`Edit` | Tending | Water/hoe action, crop flashes |
| `Bash` | Machinery | Pull lever on steam-powered tractor |
| `Agent` (subagent) | Helper | Second farmer enters field |

### D. Diagnostics
- **Bugs**: Spawn on crops when `Bash` fails. Farmer swats them when tests pass.
- **Weather**: 0 errors = Sunny, failing tests = Overcast, crashes = Thunderstorm.
- **Water Tower**: Shows `totalTokens / maxTokens` percentage. Fills as context grows.

---

## 4. Technical Architecture

### Implemented Components

**1. Types** (`src/context-farm/types.ts`)
```typescript
interface FarmPlot {
  filePath: string;
  addedAt: number;            // Turn when added
  lastTouchedAt: number;      // Most recent access
  tokenEstimate: number;      // ~chars/4
  queuePosition: number;      // 0 = newest
  state: 'idle' | 'reading' | 'editing' | 'error';
  cropType: 'radish' | 'corn' | 'pumpkin' | 'giant-pumpkin';
  gridPosition: { x: number; y: number };
  accessCount: number;
}

interface ContextFarmState {
  plots: Map<string, FarmPlot>;
  queueOrder: string[];          // [0] = newest, last = oldest
  totalTokens: number;
  maxTokens: number;             // 200k for Opus
  tokensRemaining: number;
  fillPercentage: number;
  weather: 'sunny' | 'overcast' | 'storm';
  bugs: BugInstance[];
  turnCount: number;
  exitZoneThreshold: number;     // 80% default
}
```

**2. Engine** (`src/context-farm/ContextFarmEngine.ts`)
- Subscribes to `EventRouter` events (TOOL_USE, TOOL_RESULT, USAGE)
- Maintains queue order and plot state
- Calculates exit zone based on fill percentage
- Emits state updates for visualization

**3. Integration** (`src/extension.ts`)
```typescript
const contextFarm = getContextFarmEngine({ maxTokens: 200000 });
contextFarm.initialize(eventRouter);
contextFarm.on('stateUpdate', () => {
  gameViewPanel?.updateContextFarm(contextFarm.getSerializedState());
});
```

### Data Flow
```
.jsonl Logs → SessionLogReader → EventRouter → ContextFarmEngine
                                                        ↓
                                              GameViewPanel (webview)
                                                        ↓
                                              PhaserRenderer
```

---

## 5. Development Status

### Phase 1: Core State Machine ✅ COMPLETE
- [x] Create `src/context-farm/types.ts`
- [x] Create `src/context-farm/ContextFarmEngine.ts`
- [x] Wire to EventRouter in `extension.ts`
- [x] Add `updateContextFarm()` to GameViewPanel
- [x] Add `handleContextFarmUpdate()` in webview index.ts

### Phase 2: Crop Visualization (NEXT)
- [ ] Extend `Plot` type with queue position
- [ ] Add exit zone highlighting (red outline on at-risk crops)
- [ ] Add re-access visual feedback

### Phase 3: Farmer Actions
- [x] Leverage existing animation system (already works)
- [ ] Add scouting overlay for search tools

### Phase 4: Diagnostics ✅ WIRED
- [x] Bug tracking in state (Bash failures spawn bugs on affected plots)
- [x] Weather system linked to test health (sunny → clear, overcast → rain, storm)
- [x] Water tower gauge (HUD bar shows token fill %)

### Phase 5: Polish & Hybrid Mode
- [ ] Toggle between Context Farm and Codebase World
- [ ] Hover tooltips with token estimates
- [ ] Click-to-open-file

---

## 6. Future: Two-Way Interaction

The observability layer builds the foundation for future interaction:

| Farming Action | Context Command | Implementation |
|----------------|-----------------|----------------|
| **Prune** | Remove file from context | Send `compact` with exclusion |
| **Water** | Keep file fresh | Force re-read to reset queue |
| **Fertilize** | Add related context | Suggest companion files |
| **Rotate** | Manage turnover | Suggest focus area switches |
| **Fallow** | Clear context | Trigger full reset |

Architecture note: The `ContextFarmEngine` is event-sourced, making it replayable and queryable — prerequisites for future command injection.

---

## 7. Asset Requirements

### Needed
| Asset | Frames | Purpose |
|-------|--------|---------|
| Crops (4 types) | 4 static each | Radish, corn, pumpkin, giant-pumpkin |
| Bugs | 4-8 animated | Caterpillar, beetle crawling |
| Water Tower | 10 frames | Fill levels 0-100% |
| Exit zone overlay | 1 | Red tint gradient |

### Existing (Reusable)
- Farmer character (directional sprites)
- Weather particles (rain, snow)
- Ground tiles (dirt, grass)

---

## 8. Success Metrics

- **Clarity**: See top 5 token consumers at a glance
- **Prediction**: Know what will be evicted next
- **Awareness**: Understand why agent "forgets" earlier instructions
- **Performance**: <16ms frame time with 100 crops
