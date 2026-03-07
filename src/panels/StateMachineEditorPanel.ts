/**
 * State Machine Editor Panel - Visual editor for state machines and agent types
 *
 * Features:
 * - Machine selector (create/edit/delete)
 * - States table with inline editing (id, animation, duration, metadata)
 * - Transitions table (from, to, trigger, priority)
 * - Agent type mappings (sprite, tint, stateMachine)
 * - Live test: send events and watch state transitions
 * - Save/load to state-machines.json
 */

import * as vscode from 'vscode';
import { getNonce } from './panel-utils';
import { PIXEL_THEME_CSS } from '../webview/shared/pixel-theme';
import { getStateMachineRegistry } from '../state-machine/StateMachineRegistry';
import { getAnimationRegistry } from '../animation/AnimationRegistry';
import {
  StateMachineConfig,
  AgentTypeConfig,
  StateConfig,
  TransitionConfig,
} from '../state-machine/types';

export class StateMachineEditorPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemon.stateMachineEditor';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case 'webviewReady':
          await this._sendEditorData();
          break;
        case 'saveMachine':
          await this._saveMachine(message.data as { id: string; config: StateMachineConfig });
          break;
        case 'deleteMachine':
          await this._deleteMachine((message.data as { id: string }).id);
          break;
        case 'saveAgentType':
          await this._saveAgentType(message.data as { id: string; config: AgentTypeConfig });
          break;
        case 'deleteAgentType':
          await this._deleteAgentType((message.data as { id: string }).id);
          break;
      }
    });
  }

  private async _sendEditorData(): Promise<void> {
    if (!this._view) return;

    try {
      const registry = getStateMachineRegistry(this._extensionUri);
      if (!registry.getAllMachines().size) await registry.load();
      const data = registry.getSerializableConfig();

      // Collect animation names from animation registry
      const animNames = this._getAnimationNames();

      this._view.webview.postMessage({
        type: 'loadEditorData',
        machines: data.machines,
        agentTypes: data.agentTypes,
        animationNames: animNames,
      });
    } catch (error) {
      console.error('[StateMachineEditor] Failed to load data:', error);
    }
  }

  private _getAnimationNames(): string[] {
    try {
      const animRegistry = getAnimationRegistry(this._extensionUri);
      const names = new Set<string>();
      for (const [, set] of animRegistry.getAllSets()) {
        if (set.animations) {
          for (const name of Object.keys(set.animations)) {
            names.add(name);
          }
        }
      }
      return [...names].sort();
    } catch {
      return [];
    }
  }

  public refreshAnimationNames(): void {
    if (!this._view) return;
    this._view.webview.postMessage({
      type: 'updateAnimationNames',
      animationNames: this._getAnimationNames(),
    });
  }

  private async _saveMachine(data: { id: string; config: StateMachineConfig }): Promise<void> {
    try {
      const registry = getStateMachineRegistry(this._extensionUri);
      registry.setMachine(data.id, data.config);
      await registry.save();

      this._view?.webview.postMessage({ type: 'saved', data: { id: data.id } });
      vscode.window.showInformationMessage(`State machine "${data.id}" saved`);
    } catch (error) {
      console.error('[StateMachineEditor] Failed to save machine:', error);
      vscode.window.showErrorMessage(`Failed to save: ${error}`);
    }
  }

  private async _deleteMachine(id: string): Promise<void> {
    try {
      const registry = getStateMachineRegistry(this._extensionUri);
      registry.deleteMachine(id);
      await registry.save();
      await this._sendEditorData();
      vscode.window.showInformationMessage(`State machine "${id}" deleted`);
    } catch (error) {
      console.error('[StateMachineEditor] Failed to delete machine:', error);
    }
  }

  private async _saveAgentType(data: { id: string; config: AgentTypeConfig }): Promise<void> {
    try {
      const registry = getStateMachineRegistry(this._extensionUri);
      registry.setAgentType(data.id, data.config);
      await registry.save();

      this._view?.webview.postMessage({ type: 'saved', data: { id: data.id } });
      vscode.window.showInformationMessage(`Agent type "${data.id}" saved`);
    } catch (error) {
      console.error('[StateMachineEditor] Failed to save agent type:', error);
      vscode.window.showErrorMessage(`Failed to save: ${error}`);
    }
  }

  private async _deleteAgentType(id: string): Promise<void> {
    try {
      const registry = getStateMachineRegistry(this._extensionUri);
      registry.deleteAgentType(id);
      await registry.save();
      await this._sendEditorData();
      vscode.window.showInformationMessage(`Agent type "${id}" deleted`);
    } catch (error) {
      console.error('[StateMachineEditor] Failed to delete agent type:', error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>State Machine Editor</title>
  <style>
    ${PIXEL_THEME_CSS}

    .sm-editor { padding: 4px; font-size: 11px; }

    /* ─── Tabs ─── */
    .tabs {
      display: flex; gap: 0; margin-bottom: 6px;
      border-bottom: 2px solid var(--pixel-border);
    }
    .tab {
      padding: 4px 8px; cursor: pointer; font-size: 9px;
      color: var(--pixel-muted); border: 1px solid transparent;
      border-bottom: none; font-family: inherit;
      background: none;
    }
    .tab:hover { color: var(--pixel-fg); }
    .tab.active {
      color: var(--pixel-accent); background: var(--pixel-bg-light);
      border-color: var(--pixel-border); border-bottom-color: var(--pixel-bg-light);
      margin-bottom: -2px;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .toolbar {
      display: flex; gap: 4px; align-items: center;
      margin-bottom: 6px; flex-wrap: wrap;
    }
    .toolbar select, .toolbar input, .toolbar button {
      font-family: inherit; font-size: 11px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 2px 4px;
    }
    .toolbar button { cursor: pointer; }
    .toolbar button:hover { background: var(--pixel-accent); color: #000; }

    .section-label {
      font-size: 9px; color: var(--pixel-accent);
      text-transform: uppercase; letter-spacing: 0.5px;
      margin: 6px 0 3px; padding-bottom: 2px;
      border-bottom: 1px solid var(--pixel-border);
    }

    /* ─── Tables ─── */
    .data-table {
      width: 100%; border-collapse: collapse;
      font-size: 10px; margin-bottom: 6px;
    }
    .data-table th {
      text-align: left; color: var(--pixel-muted);
      font-size: 8px; text-transform: uppercase;
      padding: 2px 3px; border-bottom: 1px solid var(--pixel-border);
    }
    .data-table td {
      padding: 2px 3px; border-bottom: 1px solid var(--pixel-bg-light);
      vertical-align: top;
    }
    .data-table tr:hover { background: var(--pixel-bg-light); }
    .data-table input, .data-table select {
      font-family: inherit; font-size: 10px;
      background: var(--pixel-bg); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 2px;
      width: 100%;
    }
    .data-table input:focus, .data-table select:focus {
      border-color: var(--pixel-accent); outline: none;
    }
    .data-table .row-del {
      background: none; border: none; color: var(--pixel-error);
      cursor: pointer; font-size: 10px; padding: 0 2px; opacity: 0.6;
    }
    .data-table .row-del:hover { opacity: 1; }

    .add-row-btn {
      font-family: inherit; font-size: 9px;
      background: var(--pixel-bg-light); color: var(--pixel-accent);
      border: 1px dashed var(--pixel-border); padding: 3px 8px;
      cursor: pointer; width: 100%; margin-bottom: 6px;
    }
    .add-row-btn:hover { border-color: var(--pixel-accent); }

    /* ─── Properties ─── */
    .prop-row {
      display: flex; align-items: center; gap: 4px;
      margin: 2px 0; font-size: 10px;
    }
    .prop-row label { color: var(--pixel-muted); min-width: 60px; }
    .prop-row input, .prop-row select {
      flex: 1; font-family: inherit; font-size: 10px;
      background: var(--pixel-bg-light); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 1px 3px;
    }

    /* ─── Test Panel ─── */
    .test-panel {
      border: 1px solid var(--pixel-border);
      padding: 4px; margin-bottom: 6px;
      background: var(--pixel-bg-light);
    }
    .test-state {
      font-size: 12px; font-weight: bold;
      color: var(--pixel-success); padding: 4px 0;
      text-align: center;
    }
    .test-buttons {
      display: flex; flex-wrap: wrap; gap: 3px;
      margin: 4px 0;
    }
    .test-btn {
      font-family: inherit; font-size: 8px;
      background: var(--pixel-bg); color: var(--pixel-fg);
      border: 1px solid var(--pixel-border); padding: 2px 6px;
      cursor: pointer;
    }
    .test-btn:hover { background: var(--pixel-accent); color: #000; }
    .test-btn.active { border-color: var(--pixel-success); color: var(--pixel-success); }
    .test-log {
      max-height: 120px; overflow-y: auto;
      font-size: 9px; color: var(--pixel-muted);
      border-top: 1px solid var(--pixel-border);
      padding-top: 3px; margin-top: 3px;
    }
    .test-log-entry { padding: 1px 0; }
    .test-log-entry .from { color: var(--pixel-muted); }
    .test-log-entry .arrow { color: var(--pixel-border); }
    .test-log-entry .to { color: var(--pixel-success); }
    .test-log-entry .trigger { color: var(--pixel-accent); font-size: 8px; }

    /* ─── Agent type card ─── */
    .agent-type-card {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 6px; margin: 2px 0;
      border: 1px solid var(--pixel-border);
      background: var(--pixel-bg-light);
      cursor: pointer;
    }
    .agent-type-card:hover { border-color: var(--pixel-accent); }
    .agent-type-card.selected { border-color: var(--pixel-success); }
    .agent-type-swatch {
      width: 12px; height: 12px; border: 1px solid var(--pixel-border);
    }
    .agent-type-info {
      flex: 1; overflow: hidden;
    }
    .agent-type-name { font-size: 10px; }
    .agent-type-detail { font-size: 8px; color: var(--pixel-muted); }

    .empty-state {
      text-align: center; color: var(--pixel-muted);
      padding: 12px; font-size: 10px;
    }
  </style>
</head>
<body>
  <datalist id="anim-names"></datalist>
  <div class="sm-editor">
    <!-- Tabs -->
    <div class="tabs">
      <button class="tab active" data-tab="machines">Machines</button>
      <button class="tab" data-tab="agents">Agent Types</button>
      <button class="tab" data-tab="test">Test</button>
    </div>

    <!-- ═══ Machines Tab ═══ -->
    <div class="tab-content active" id="tab-machines">
      <div class="toolbar">
        <select id="machine-select"><option value="">-- Select --</option></select>
        <button id="btn-new-machine" title="New Machine">+</button>
        <button id="btn-del-machine" title="Delete Machine">x</button>
        <button id="btn-save-machine" title="Save Machine">Save</button>
      </div>

      <div class="prop-row">
        <label>ID:</label>
        <input id="machine-id" type="text" placeholder="my-machine">
      </div>
      <div class="prop-row">
        <label>Desc:</label>
        <input id="machine-desc" type="text" placeholder="Description">
      </div>
      <div class="prop-row">
        <label>Initial:</label>
        <input id="machine-initial" type="text" placeholder="idle">
      </div>

      <!-- States Table -->
      <div class="section-label">States</div>
      <table class="data-table" id="states-table">
        <thead>
          <tr><th>ID</th><th>Anim</th><th>Dur</th><th></th></tr>
        </thead>
        <tbody id="states-body"></tbody>
      </table>
      <button class="add-row-btn" id="btn-add-state">+ Add State</button>

      <!-- Transitions Table -->
      <div class="section-label">Transitions</div>
      <table class="data-table" id="trans-table">
        <thead>
          <tr><th>From</th><th>To</th><th>Trigger</th><th>Pri</th><th></th></tr>
        </thead>
        <tbody id="trans-body"></tbody>
      </table>
      <button class="add-row-btn" id="btn-add-trans">+ Add Transition</button>
    </div>

    <!-- ═══ Agent Types Tab ═══ -->
    <div class="tab-content" id="tab-agents">
      <div class="toolbar">
        <button id="btn-new-agent" title="New Agent Type">+ New</button>
        <button id="btn-save-agent" title="Save Agent Type">Save</button>
        <button id="btn-del-agent" title="Delete Agent Type">x</button>
      </div>

      <div id="agent-type-list"></div>

      <div class="section-label" style="margin-top:8px;">Edit Agent Type</div>
      <div class="prop-row">
        <label>ID:</label>
        <input id="at-id" type="text" placeholder="bug-analyzer">
      </div>
      <div class="prop-row">
        <label>Name:</label>
        <input id="at-name" type="text" placeholder="Bug Analyzer">
      </div>
      <div class="prop-row">
        <label>Sprite:</label>
        <select id="at-sprite">
          <option value="chicken">chicken</option>
          <option value="cow">cow</option>
          <option value="pig">pig</option>
          <option value="duck">duck</option>
        </select>
      </div>
      <div class="prop-row">
        <label>SM:</label>
        <select id="at-sm"></select>
      </div>
      <div class="prop-row">
        <label>Tint:</label>
        <input id="at-tint" type="text" placeholder="#ff4444" style="width:70px">
        <input id="at-tint-color" type="color" value="#ff4444" style="width:24px;height:20px;padding:0;border:1px solid var(--pixel-border);">
      </div>
      <div class="prop-row">
        <label style="min-width:auto;"><input type="checkbox" id="at-label" checked> Name label</label>
      </div>
      <div class="prop-row">
        <label>Tiles:</label>
        <input id="at-tiles" type="text" placeholder="grass, water" style="flex:1;">
      </div>
    </div>

    <!-- ═══ Test Tab ═══ -->
    <div class="tab-content" id="tab-test">
      <div class="prop-row">
        <label>Machine:</label>
        <select id="test-machine-select"></select>
      </div>

      <div class="test-panel">
        <div style="font-size:8px;color:var(--pixel-muted);text-transform:uppercase;">Current State</div>
        <div class="test-state" id="test-current-state">--</div>
        <div style="font-size:8px;color:var(--pixel-muted);margin-top:4px;">Send Event</div>
        <div class="test-buttons" id="test-event-buttons"></div>
        <div class="prop-row" style="margin-top:4px;">
          <input id="test-custom-event" type="text" placeholder="custom event name" style="flex:1;">
          <button class="test-btn" id="btn-test-send">Send</button>
          <button class="test-btn" id="btn-test-tick">Tick</button>
          <button class="test-btn" id="btn-test-reset">Reset</button>
        </div>
        <div class="test-log" id="test-log"></div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ─── State ─────────────────────────────────────────────────────────
    let allMachines = {};   // Record<string, StateMachineConfig>
    let allAgentTypes = {}; // Record<string, AgentTypeConfig>
    let currentMachineId = null;
    let currentAgentTypeId = null;

    // Working copies
    let editStates = [];
    let editTransitions = [];

    // Test state machine (simple simulation)
    let testSM = null; // { config, currentState, elapsed }

    // ─── Message Handling ──────────────────────────────────────────────
    function populateAnimDatalist(names) {
      const dl = document.getElementById('anim-names');
      if (!dl) return;
      dl.innerHTML = '';
      (names || []).forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        dl.appendChild(opt);
      });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadEditorData':
          allMachines = msg.machines || {};
          allAgentTypes = msg.agentTypes || {};
          populateAnimDatalist(msg.animationNames);
          initMachineSelect();
          initAgentTypeList();
          initTestMachineSelect();
          break;
        case 'updateAnimationNames':
          populateAnimDatalist(msg.animationNames);
          break;
        case 'saved':
          break;
      }
    });

    vscode.postMessage({ type: 'webviewReady' });

    // ─── Tabs ──────────────────────────────────────────────────────────
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });

    // ─── Machine Select ────────────────────────────────────────────────
    const machineSelect = document.getElementById('machine-select');

    function initMachineSelect() {
      machineSelect.innerHTML = '<option value="">-- New Machine --</option>';
      for (const id of Object.keys(allMachines)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        machineSelect.appendChild(opt);
      }

      // Populate SM dropdown in agent types tab
      const atSm = document.getElementById('at-sm');
      atSm.innerHTML = '';
      for (const id of Object.keys(allMachines)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        atSm.appendChild(opt);
      }
    }

    machineSelect.addEventListener('change', () => {
      const id = machineSelect.value;
      if (!id) { newMachine(); return; }
      loadMachine(id, allMachines[id]);
    });

    function loadMachine(id, config) {
      currentMachineId = id;
      document.getElementById('machine-id').value = id;
      document.getElementById('machine-desc').value = config.description || '';
      document.getElementById('machine-initial').value = config.initialState || 'idle';

      editStates = (config.states || []).map(s => ({ ...s, metadata: s.metadata ? JSON.parse(JSON.stringify(s.metadata)) : undefined }));
      editTransitions = (config.transitions || []).map(t => ({ ...t, trigger: { ...t.trigger } }));

      renderStatesTable();
      renderTransitionsTable();
    }

    function newMachine() {
      currentMachineId = null;
      document.getElementById('machine-id').value = '';
      document.getElementById('machine-desc').value = '';
      document.getElementById('machine-initial').value = 'idle';
      editStates = [{ id: 'idle', animation: 'idle' }];
      editTransitions = [];
      renderStatesTable();
      renderTransitionsTable();
    }

    // ─── States Table ──────────────────────────────────────────────────
    function renderStatesTable() {
      const tbody = document.getElementById('states-body');
      tbody.innerHTML = '';

      editStates.forEach((state, i) => {
        const tr = document.createElement('tr');
        const metaStr = state.metadata ? JSON.stringify(state.metadata) : '';
        tr.innerHTML =
          '<td><input value="' + esc(state.id) + '" data-field="id" data-idx="' + i + '" style="width:60px"></td>' +
          '<td><input value="' + esc(state.animation || '') + '" data-field="animation" data-idx="' + i + '" list="anim-names" style="width:55px"></td>' +
          '<td><input value="' + (state.duration != null ? state.duration : '') + '" data-field="duration" data-idx="' + i + '" type="number" style="width:45px" placeholder="-"></td>' +
          '<td><button class="row-del" data-del-state="' + i + '" title="' + esc(metaStr || 'Delete') + '">x</button></td>';
        tbody.appendChild(tr);
      });

      // Wire inputs
      tbody.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          const field = e.target.dataset.field;
          if (field === 'duration') {
            editStates[idx].duration = e.target.value ? parseInt(e.target.value) : undefined;
          } else {
            editStates[idx][field] = e.target.value;
          }
        });
      });

      tbody.querySelectorAll('[data-del-state]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          editStates.splice(parseInt(e.target.dataset.delState), 1);
          renderStatesTable();
        });
      });
    }

    document.getElementById('btn-add-state').addEventListener('click', () => {
      editStates.push({ id: 'new-state', animation: 'idle' });
      renderStatesTable();
    });

    // ─── Transitions Table ─────────────────────────────────────────────
    function renderTransitionsTable() {
      const tbody = document.getElementById('trans-body');
      tbody.innerHTML = '';

      editTransitions.forEach((trans, i) => {
        const tr = document.createElement('tr');
        const triggerType = trans.trigger?.type || 'event';
        const triggerEvent = trans.trigger?.event || '';
        const triggerLabel = triggerType === 'event' ? triggerEvent : triggerType;

        tr.innerHTML =
          '<td><input value="' + esc(trans.from) + '" data-field="from" data-idx="' + i + '" style="width:40px"></td>' +
          '<td><input value="' + esc(trans.to) + '" data-field="to" data-idx="' + i + '" style="width:55px"></td>' +
          '<td><select data-field="triggerType" data-idx="' + i + '" style="width:40px;font-size:9px">' +
            '<option value="event"' + (triggerType === 'event' ? ' selected' : '') + '>evt</option>' +
            '<option value="timer"' + (triggerType === 'timer' ? ' selected' : '') + '>tmr</option>' +
          '</select>' +
          '<input value="' + esc(triggerType === 'event' ? triggerEvent : '') + '" data-field="triggerEvent" data-idx="' + i + '" placeholder="event" style="width:60px;font-size:9px;' + (triggerType !== 'event' ? 'display:none' : '') + '"></td>' +
          '<td><input value="' + (trans.priority ?? 0) + '" data-field="priority" data-idx="' + i + '" type="number" style="width:30px"></td>' +
          '<td><button class="row-del" data-del-trans="' + i + '">x</button></td>';
        tbody.appendChild(tr);
      });

      // Wire inputs
      tbody.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          const field = e.target.dataset.field;
          if (field === 'from') editTransitions[idx].from = e.target.value;
          else if (field === 'to') editTransitions[idx].to = e.target.value;
          else if (field === 'priority') editTransitions[idx].priority = parseInt(e.target.value) || 0;
          else if (field === 'triggerEvent') {
            editTransitions[idx].trigger = { type: 'event', event: e.target.value };
          }
        });
      });

      tbody.querySelectorAll('select[data-field="triggerType"]').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          const type = e.target.value;
          if (type === 'timer') {
            editTransitions[idx].trigger = { type: 'timer' };
          } else {
            editTransitions[idx].trigger = { type: 'event', event: '' };
          }
          renderTransitionsTable();
        });
      });

      tbody.querySelectorAll('[data-del-trans]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          editTransitions.splice(parseInt(e.target.dataset.delTrans), 1);
          renderTransitionsTable();
        });
      });
    }

    document.getElementById('btn-add-trans').addEventListener('click', () => {
      editTransitions.push({ from: '*', to: 'idle', trigger: { type: 'event', event: '' }, priority: 0 });
      renderTransitionsTable();
    });

    // ─── Save / New / Delete Machine ───────────────────────────────────
    document.getElementById('btn-save-machine').addEventListener('click', () => {
      const id = document.getElementById('machine-id').value.trim();
      if (!id) { alert('Machine ID is required'); return; }

      const config = {
        id: id,
        description: document.getElementById('machine-desc').value.trim(),
        initialState: document.getElementById('machine-initial').value.trim() || 'idle',
        states: editStates.map(s => {
          const out = { id: s.id, animation: s.animation || undefined };
          if (s.duration != null) out.duration = s.duration;
          if (s.metadata) out.metadata = s.metadata;
          return out;
        }),
        transitions: editTransitions.map(t => {
          const out = { from: t.from, to: t.to, trigger: { ...t.trigger } };
          if (t.priority) out.priority = t.priority;
          return out;
        }),
      };

      vscode.postMessage({ type: 'saveMachine', data: { id, config } });
      allMachines[id] = config;
      initMachineSelect();
      machineSelect.value = id;
      initTestMachineSelect();
    });

    document.getElementById('btn-new-machine').addEventListener('click', () => {
      machineSelect.value = '';
      newMachine();
    });

    document.getElementById('btn-del-machine').addEventListener('click', () => {
      const id = document.getElementById('machine-id').value.trim();
      if (!id) return;
      vscode.postMessage({ type: 'deleteMachine', data: { id } });
      delete allMachines[id];
      initMachineSelect();
      newMachine();
      initTestMachineSelect();
    });

    // ─── Agent Types ───────────────────────────────────────────────────
    function initAgentTypeList() {
      const list = document.getElementById('agent-type-list');
      list.innerHTML = '';

      for (const [id, config] of Object.entries(allAgentTypes)) {
        const card = document.createElement('div');
        card.className = 'agent-type-card' + (id === currentAgentTypeId ? ' selected' : '');
        card.dataset.atId = id;
        const tintColor = config.tint || '#888';
        card.innerHTML =
          '<div class="agent-type-swatch" style="background:' + esc(tintColor) + '"></div>' +
          '<div class="agent-type-info">' +
            '<div class="agent-type-name">' + esc(id) + '</div>' +
            '<div class="agent-type-detail">' + esc(config.sprite) + ' / ' + esc(config.stateMachine) + '</div>' +
          '</div>';
        card.addEventListener('click', () => selectAgentType(id));
        list.appendChild(card);
      }
    }

    function selectAgentType(id) {
      currentAgentTypeId = id;
      const config = allAgentTypes[id];
      if (!config) return;

      document.getElementById('at-id').value = id;
      document.getElementById('at-name').value = config.displayName || '';
      document.getElementById('at-sprite').value = config.sprite || 'chicken';
      document.getElementById('at-sm').value = config.stateMachine || 'chicken';
      document.getElementById('at-tint').value = config.tint || '';
      if (config.tint) {
        document.getElementById('at-tint-color').value = config.tint;
      }
      document.getElementById('at-label').checked = config.nameLabel !== false;
      document.getElementById('at-tiles').value = (config.preferredTiles || []).join(', ');

      // Highlight selected card
      document.querySelectorAll('.agent-type-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.atId === id);
      });
    }

    // Sync color picker with text input
    document.getElementById('at-tint-color').addEventListener('input', (e) => {
      document.getElementById('at-tint').value = e.target.value;
    });
    document.getElementById('at-tint').addEventListener('change', (e) => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
        document.getElementById('at-tint-color').value = e.target.value;
      }
    });

    document.getElementById('btn-save-agent').addEventListener('click', () => {
      const id = document.getElementById('at-id').value.trim();
      if (!id) { alert('Agent type ID is required'); return; }

      const tilesRaw = document.getElementById('at-tiles').value;
      const tiles = tilesRaw ? tilesRaw.split(',').map(t => t.trim()).filter(t => t) : undefined;
      const tintVal = document.getElementById('at-tint').value.trim();

      const config = {
        displayName: document.getElementById('at-name').value.trim() || id,
        sprite: document.getElementById('at-sprite').value,
        stateMachine: document.getElementById('at-sm').value,
        tint: tintVal || null,
        nameLabel: document.getElementById('at-label').checked,
      };
      if (tiles && tiles.length > 0) config.preferredTiles = tiles;

      vscode.postMessage({ type: 'saveAgentType', data: { id, config } });
      allAgentTypes[id] = config;
      initAgentTypeList();
      selectAgentType(id);
    });

    document.getElementById('btn-new-agent').addEventListener('click', () => {
      currentAgentTypeId = null;
      document.getElementById('at-id').value = '';
      document.getElementById('at-name').value = '';
      document.getElementById('at-sprite').value = 'chicken';
      document.getElementById('at-tint').value = '';
      document.getElementById('at-label').checked = true;
      document.getElementById('at-tiles').value = '';
      document.querySelectorAll('.agent-type-card').forEach(c => c.classList.remove('selected'));
    });

    document.getElementById('btn-del-agent').addEventListener('click', () => {
      const id = document.getElementById('at-id').value.trim();
      if (!id) return;
      vscode.postMessage({ type: 'deleteAgentType', data: { id } });
      delete allAgentTypes[id];
      initAgentTypeList();
      document.getElementById('at-id').value = '';
    });

    // ─── Test Panel ────────────────────────────────────────────────────
    function initTestMachineSelect() {
      const sel = document.getElementById('test-machine-select');
      sel.innerHTML = '';
      for (const id of Object.keys(allMachines)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        sel.appendChild(opt);
      }
    }

    document.getElementById('test-machine-select').addEventListener('change', () => {
      resetTestSM();
    });

    function resetTestSM() {
      const id = document.getElementById('test-machine-select').value;
      const config = allMachines[id];
      if (!config) {
        testSM = null;
        updateTestDisplay();
        return;
      }

      testSM = {
        config: config,
        currentStateId: config.initialState,
        elapsed: 0,
      };

      // Build event buttons from transitions
      const events = new Set();
      for (const t of config.transitions) {
        if (t.trigger && t.trigger.type === 'event' && t.trigger.event) {
          events.add(t.trigger.event);
        }
      }

      const btnContainer = document.getElementById('test-event-buttons');
      btnContainer.innerHTML = '';
      for (const evt of events) {
        const btn = document.createElement('button');
        btn.className = 'test-btn';
        btn.textContent = evt;
        btn.addEventListener('click', () => sendTestEvent(evt));
        btnContainer.appendChild(btn);
      }

      document.getElementById('test-log').innerHTML = '';
      updateTestDisplay();
    }

    function sendTestEvent(eventName) {
      if (!testSM) return;

      // Find matching transition
      const config = testSM.config;
      const current = testSM.currentStateId;

      // Sort transitions by priority (descending)
      const candidates = config.transitions
        .filter(t => (t.from === current || t.from === '*') && t.trigger.type === 'event' && t.trigger.event === eventName)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      if (candidates.length > 0) {
        const trans = candidates[0];
        const fromId = testSM.currentStateId;
        testSM.currentStateId = trans.to;
        testSM.elapsed = 0;
        addTestLog(fromId, trans.to, 'evt:' + eventName);
      } else {
        addTestLog(current, current, eventName + ' (no match)');
      }

      updateTestDisplay();
    }

    document.getElementById('btn-test-send').addEventListener('click', () => {
      const evt = document.getElementById('test-custom-event').value.trim();
      if (evt) sendTestEvent(evt);
    });

    document.getElementById('btn-test-tick').addEventListener('click', () => {
      if (!testSM) return;

      const config = testSM.config;
      const current = testSM.currentStateId;
      const stateConfig = config.states.find(s => s.id === current);
      const dur = stateConfig?.duration;

      if (dur) {
        // Simulate timer expiry
        const timerTrans = config.transitions
          .filter(t => (t.from === current || t.from === '*') && t.trigger.type === 'timer')
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        if (timerTrans.length > 0) {
          const fromId = testSM.currentStateId;
          testSM.currentStateId = timerTrans[0].to;
          testSM.elapsed = 0;
          addTestLog(fromId, timerTrans[0].to, 'timer (' + dur + 'ms)');
        } else {
          addTestLog(current, current, 'timer (no transition)');
        }
      } else {
        addTestLog(current, current, 'tick (no duration)');
      }

      updateTestDisplay();
    });

    document.getElementById('btn-test-reset').addEventListener('click', resetTestSM);

    function updateTestDisplay() {
      const el = document.getElementById('test-current-state');
      if (!testSM) {
        el.textContent = '--';
        return;
      }

      const stateConfig = testSM.config.states.find(s => s.id === testSM.currentStateId);
      el.textContent = testSM.currentStateId;
      if (stateConfig?.animation) {
        el.textContent += ' [' + stateConfig.animation + ']';
      }
      if (stateConfig?.duration) {
        el.textContent += ' (' + stateConfig.duration + 'ms)';
      }

      // Highlight matching event buttons
      document.querySelectorAll('#test-event-buttons .test-btn').forEach(btn => {
        const evtName = btn.textContent;
        const hasMatch = testSM.config.transitions.some(t =>
          (t.from === testSM.currentStateId || t.from === '*') &&
          t.trigger.type === 'event' && t.trigger.event === evtName
        );
        btn.classList.toggle('active', hasMatch);
      });
    }

    function addTestLog(from, to, trigger) {
      const logEl = document.getElementById('test-log');
      const entry = document.createElement('div');
      entry.className = 'test-log-entry';
      entry.innerHTML =
        '<span class="from">' + esc(from) + '</span> ' +
        '<span class="arrow">&rarr;</span> ' +
        '<span class="to">' + esc(to) + '</span> ' +
        '<span class="trigger">[' + esc(trigger) + ']</span>';
      logEl.prepend(entry);

      // Keep max 50 entries
      while (logEl.children.length > 50) {
        logEl.removeChild(logEl.lastChild);
      }
    }

    // ─── Helpers ───────────────────────────────────────────────────────
    function esc(s) {
      if (s == null) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Init
    newMachine();
  </script>
</body>
</html>`;
  }
}

// Singleton
let instance: StateMachineEditorPanel | undefined;

export function getStateMachineEditorPanel(extensionUri: vscode.Uri): StateMachineEditorPanel {
  if (!instance) {
    instance = new StateMachineEditorPanel(extensionUri);
  }
  return instance;
}
