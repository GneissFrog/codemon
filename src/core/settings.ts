/**
 * Extension settings management
 */

import * as vscode from 'vscode';

export type BudgetMode = 'tokens' | 'dollars' | 'subscription';
export type IntegrationMode = 'auto' | 'session-logs' | 'hooks';
export type SpriteChoice = 'auto' | 'knight' | 'ranger' | 'rogue' | 'custom';

export interface CodeMonSettings {
  budget: {
    mode: BudgetMode;
    dailyTokenLimit: number;
    dailyDollarLimit: number;
  };
  sprite: SpriteChoice;
  sounds: {
    enabled: boolean;
  };
  integration: {
    mode: IntegrationMode;
  };
}

const CONFIG_SECTION = 'codemon';

export function getSettings(): CodeMonSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  return {
    budget: {
      mode: config.get<BudgetMode>('budget.mode') || 'subscription',
      dailyTokenLimit: config.get<number>('budget.dailyTokenLimit') || 500000,
      dailyDollarLimit: config.get<number>('budget.dailyDollarLimit') || 10,
    },
    sprite: config.get<SpriteChoice>('sprite') || 'auto',
    sounds: {
      enabled: config.get<boolean>('sounds.enabled') || false,
    },
    integration: {
      mode: config.get<IntegrationMode>('integration.mode') || 'auto',
    },
  };
}

/**
 * Get sprite based on model when set to 'auto'
 */
export function getSpriteForModel(model: string): 'knight' | 'ranger' | 'rogue' {
  if (model.includes('opus')) {
    return 'knight';
  } else if (model.includes('haiku')) {
    return 'rogue';
  }
  return 'ranger';
}

/**
 * Watch for settings changes
 */
export function onSettingsChanged(
  callback: (settings: CodeMonSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CONFIG_SECTION)) {
      callback(getSettings());
    }
  });
}
