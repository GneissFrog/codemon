#!/usr/bin/env node
/**
 * Normalize sprite naming across terrain config files.
 * Converts all sprite names to consistent t_col_row format
 * based on pixel position in the spritesheet.
 *
 * Fixes three naming conventions:
 *   grass-edge-n  (pre-refactor semantic)  -> t_1_0
 *   tile_3_0      (old TerrainConfigPanel) -> t_3_0
 *   t_1_1         (already correct)        -> t_1_1
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'assets', 'config');
const MAPPINGS_PATH = path.join(CONFIG_DIR, 'terrain-sprite-mappings.json');
const BITMASK_PATH = path.join(CONFIG_DIR, 'terrain-bitmask.json');

// ─── Step 1: Normalize terrain-sprite-mappings.json ──────────────────────

const mappingsData = JSON.parse(fs.readFileSync(MAPPINGS_PATH, 'utf-8'));

// Build a lookup from old name → new t_X_Y name
const oldToNew = new Map();
let cellsFixed = 0;

for (const [terrainType, mapping] of Object.entries(mappingsData.mappings)) {
  for (const zone of mapping.zones) {
    const cellSize = zone.cellSize || 16;
    for (const cell of zone.cells) {
      const col = Math.floor(cell.x / cellSize);
      const row = Math.floor(cell.y / cellSize);
      const correctName = `t_${col}_${row}`;

      if (cell.spriteName !== correctName) {
        console.log(`  [${terrainType}] ${cell.spriteName} -> ${correctName}`);
        oldToNew.set(cell.spriteName, correctName);
        cell.spriteName = correctName;
        cellsFixed++;
      }
    }
  }
}

fs.writeFileSync(MAPPINGS_PATH, JSON.stringify(mappingsData, null, 2) + '\n');
console.log(`\nFixed ${cellsFixed} cell names in terrain-sprite-mappings.json`);
console.log(`Name mapping table (${oldToNew.size} entries):`);
for (const [old, n] of oldToNew) {
  console.log(`  ${old} -> ${n}`);
}

// ─── Step 2: Normalize terrain-bitmask.json ──────────────────────────────

const bitmaskData = JSON.parse(fs.readFileSync(BITMASK_PATH, 'utf-8'));

let bitmaskFixed = 0;

for (const terrain of bitmaskData.terrains) {
  if (!terrain.bitmaskMappings) continue;

  for (let i = 0; i < terrain.bitmaskMappings.length; i++) {
    const name = terrain.bitmaskMappings[i];
    if (!name) continue; // skip empty strings

    // Check if it needs fixing
    if (oldToNew.has(name)) {
      // Direct match from our mapping table
      terrain.bitmaskMappings[i] = oldToNew.get(name);
      bitmaskFixed++;
    } else if (name.startsWith('tile_')) {
      // Convert tile_X_Y -> t_X_Y
      const newName = 't_' + name.substring(5);
      terrain.bitmaskMappings[i] = newName;
      bitmaskFixed++;
    }
    // t_X_Y entries and empty strings stay as-is
  }

  // Also fix defaultSprite if needed
  if (terrain.defaultSprite && oldToNew.has(terrain.defaultSprite)) {
    terrain.defaultSprite = oldToNew.get(terrain.defaultSprite);
  } else if (terrain.defaultSprite && terrain.defaultSprite.startsWith('tile_')) {
    terrain.defaultSprite = 't_' + terrain.defaultSprite.substring(5);
  }
}

fs.writeFileSync(BITMASK_PATH, JSON.stringify(bitmaskData, null, 2) + '\n');
console.log(`\nFixed ${bitmaskFixed} bitmask entries in terrain-bitmask.json`);

// ─── Step 3: Verify ──────────────────────────────────────────────────────

// Count remaining non-t_ entries
let remaining = 0;
for (const terrain of bitmaskData.terrains) {
  if (!terrain.bitmaskMappings) continue;
  for (const name of terrain.bitmaskMappings) {
    if (name && !name.startsWith('t_') && name !== '') {
      console.log(`  WARNING: non-t_ entry remaining: "${name}" in ${terrain.type}`);
      remaining++;
    }
  }
}

if (remaining === 0) {
  console.log('\nAll sprite names are now in t_X_Y format.');
} else {
  console.log(`\nWARNING: ${remaining} non-standard entries remain.`);
}
