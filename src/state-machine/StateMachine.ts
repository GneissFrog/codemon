/**
 * Config-driven finite state machine.
 * Pure TypeScript — works in both extension host and webview contexts.
 */

import {
  StateConfig,
  StateMachineConfig,
  TransitionConfig,
  TransitionEvent,
} from './types';

export class StateMachine {
  private config: StateMachineConfig;
  private currentState: StateConfig;
  private stateElapsed: number = 0;
  private sortedTransitions: TransitionConfig[];

  private callbacks = new Map<string, (...args: unknown[]) => void>();
  private guards = new Map<string, () => boolean>();
  private transitionListeners: ((event: TransitionEvent) => void)[] = [];

  constructor(config: StateMachineConfig) {
    this.config = config;

    const initial = config.states.find(s => s.id === config.initialState);
    if (!initial) {
      throw new Error(
        `StateMachine "${config.id}": initial state "${config.initialState}" not found`
      );
    }
    this.currentState = initial;

    // Pre-sort transitions by priority descending for deterministic evaluation
    this.sortedTransitions = [...config.transitions].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
  }

  /** Register a named callback for onEnter/onExit hooks */
  registerCallback(name: string, fn: (...args: unknown[]) => void): void {
    this.callbacks.set(name, fn);
  }

  /** Register a named guard function */
  registerGuard(name: string, fn: () => boolean): void {
    this.guards.set(name, fn);
  }

  /** Listen for state transitions */
  onTransition(listener: (event: TransitionEvent) => void): void {
    this.transitionListeners.push(listener);
  }

  /** Remove a transition listener */
  offTransition(listener: (event: TransitionEvent) => void): void {
    const idx = this.transitionListeners.indexOf(listener);
    if (idx !== -1) this.transitionListeners.splice(idx, 1);
  }

  /**
   * Send an event to the state machine.
   * Evaluates all matching event-triggered transitions in priority order.
   * Returns true if a transition occurred.
   */
  send(eventName: string): boolean {
    for (const t of this.sortedTransitions) {
      if (t.trigger.type !== 'event') continue;
      if (t.trigger.event !== eventName) continue;
      if (!this.matchesFrom(t)) continue;
      if (!this.passesGuard(t)) continue;

      this.transitionTo(t.to, `event:${eventName}`);
      return true;
    }
    return false;
  }

  /**
   * Advance timers and check auto-transitions.
   * Call this every frame/tick with the time elapsed since last update.
   */
  update(deltaMs: number): void {
    this.stateElapsed += deltaMs;

    // Check timer-based transitions (state duration expired)
    const duration = this.currentState.duration;
    if (duration != null && duration > 0 && this.stateElapsed >= duration) {
      for (const t of this.sortedTransitions) {
        if (t.trigger.type !== 'timer') continue;
        if (!this.matchesFrom(t)) continue;
        if (!this.passesGuard(t)) continue;

        this.transitionTo(t.to, 'timer');
        return;
      }
    }

    // Check condition-based transitions
    for (const t of this.sortedTransitions) {
      if (t.trigger.type !== 'condition') continue;
      if (!this.matchesFrom(t)) continue;

      const conditionFn = this.guards.get(t.trigger.condition);
      if (conditionFn && conditionFn()) {
        if (!this.passesGuard(t)) continue;
        this.transitionTo(t.to, `condition:${t.trigger.condition}`);
        return;
      }
    }
  }

  /** Current state */
  getCurrentState(): StateConfig {
    return this.currentState;
  }

  /** Current state id */
  getCurrentStateId(): string {
    return this.currentState.id;
  }

  /** Current animation (convenience) */
  getAnimation(): string | undefined {
    return this.currentState.animation;
  }

  /** Time spent in current state (ms) */
  getStateElapsed(): number {
    return this.stateElapsed;
  }

  /** The full config this machine was created from */
  getConfig(): StateMachineConfig {
    return this.config;
  }

  /** Force transition to a specific state (for external control) */
  forceState(stateId: string): void {
    this.transitionTo(stateId, 'forced');
  }

  /** Get a state config by id */
  getState(stateId: string): StateConfig | undefined {
    return this.config.states.find(s => s.id === stateId);
  }

  /** Reset to initial state */
  reset(): void {
    const initial = this.config.states.find(s => s.id === this.config.initialState);
    if (initial) {
      this.currentState = initial;
      this.stateElapsed = 0;
    }
  }

  // --- Internal ---

  private matchesFrom(t: TransitionConfig): boolean {
    return t.from === '*' || t.from === this.currentState.id;
  }

  private passesGuard(t: TransitionConfig): boolean {
    if (!t.guard) return true;
    const guardFn = this.guards.get(t.guard);
    return guardFn ? guardFn() : true; // No registered guard = pass
  }

  private transitionTo(targetId: string, triggerDesc: string): void {
    const target = this.config.states.find(s => s.id === targetId);
    if (!target) return;

    const from = this.currentState;

    // Exit callback
    if (from.onExit) {
      const cb = this.callbacks.get(from.onExit);
      if (cb) cb(from);
    }

    // Transition
    this.currentState = target;
    this.stateElapsed = 0;

    // Enter callback
    if (target.onEnter) {
      const cb = this.callbacks.get(target.onEnter);
      if (cb) cb(target);
    }

    // Notify listeners
    const event: TransitionEvent = { from, to: target, trigger: triggerDesc };
    for (const listener of this.transitionListeners) {
      listener(event);
    }
  }
}
