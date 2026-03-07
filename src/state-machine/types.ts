/**
 * Config-driven state machine types.
 * Pure TypeScript — no VS Code or DOM dependencies so these work in both
 * the extension host and the webview.
 */

/** What causes a transition between states */
export type TransitionTrigger =
  | { type: 'event'; event: string }        // External event, e.g. "tool:Read", "movement_complete"
  | { type: 'timer' }                        // Current state's `duration` expired
  | { type: 'condition'; condition: string } // Named guard function evaluated each update()

/** A single state within a state machine */
export interface StateConfig {
  /** Unique state identifier, e.g. "idle", "walking", "investigating" */
  id: string;
  /** Animation to play when entering this state */
  animation?: string;
  /** Optional sprite override (e.g. different character sheet) */
  spriteOverride?: string;
  /** Auto-transition after this many ms. Null/undefined = stay until event */
  duration?: number | null;
  /** Named callback to invoke on state entry */
  onEnter?: string;
  /** Named callback to invoke on state exit */
  onExit?: string;
  /** Arbitrary data for behavior code (speed, wanderRadius, pauseMin, etc.) */
  metadata?: Record<string, unknown>;
}

/** A transition between states */
export interface TransitionConfig {
  /** Source state id. Use "*" for "any current state" */
  from: string;
  /** Target state id */
  to: string;
  /** What triggers this transition */
  trigger: TransitionTrigger;
  /** Named guard function — transition only fires if guard returns true */
  guard?: string;
  /** Higher priority transitions are evaluated first (default: 0) */
  priority?: number;
}

/** Complete state machine definition */
export interface StateMachineConfig {
  id: string;
  description?: string;
  initialState: string;
  states: StateConfig[];
  transitions: TransitionConfig[];
}

/** Agent type visual configuration */
export interface AgentTypeConfig {
  displayName: string;
  /** Spritesheet to use (e.g. "chicken", "cow") */
  sprite: string;
  /** Which state machine config to use */
  stateMachine: string;
  /** Color tint hex (e.g. "#ff4444"), null for no tint */
  tint: string | null;
  /** Show name label above sprite */
  nameLabel?: boolean;
  /** Preferred tile types for movement targeting */
  preferredTiles?: string[];
  /** Which animation set to use (defaults to sprite value) */
  animationSet?: string;
}

/** Top-level config file schema */
export interface StateMachineFileConfig {
  version: number;
  machines: Record<string, StateMachineConfig>;
  agentTypes: Record<string, AgentTypeConfig>;
}

/** Fired when a state machine transitions */
export interface TransitionEvent {
  from: StateConfig;
  to: StateConfig;
  trigger: string; // "event:tool:Read", "timer", "condition:xxx"
}
