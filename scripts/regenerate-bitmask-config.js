#!/usr/bin/env node
/**
 * Regenerate terrain-bitmask.json from terrain-sprite-mappings.json
 * using diagonal masking (irrelevant diagonals cleared before indexing).
 *
 * This ensures the bitmask lookup table matches the masked bitmask
 * calculations used at runtime.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'assets', 'config');
const MAPPINGS_PATH = path.join(CONFIG_DIR, 'terrain-sprite-mappings.json');
const BITMASK_PATH = path.join(CONFIG_DIR, 'terrain-bitmask.json');

const DIR = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 };

/**
 * Mask out diagonal bits where one or both adjacent cardinals are absent.
 */
function maskIrrelevantDiagonals(mask) {
  if (!(mask & DIR.N) || !(mask & DIR.E)) mask &= ~DIR.NE;
  if (!(mask & DIR.E) || !(mask & DIR.S)) mask &= ~DIR.SE;
  if (!(mask & DIR.S) || !(mask & DIR.W)) mask &= ~DIR.SW;
  if (!(mask & DIR.W) || !(mask & DIR.N)) mask &= ~DIR.NW;
  return mask;
}

const mappingsData = JSON.parse(fs.readFileSync(MAPPINGS_PATH, 'utf-8'));
const bitmaskData = JSON.parse(fs.readFileSync(BITMASK_PATH, 'utf-8'));

for (const terrain of bitmaskData.terrains) {
  const mapping = mappingsData.mappings[terrain.type];
  if (!mapping) {
    console.log(`  [${terrain.type}] No mapping found, skipping`);
    continue;
  }

  // Start with all entries as defaultSprite
  const newMappings = Array(256).fill(terrain.defaultSprite);
  let cellCount = 0;

  for (const zone of mapping.zones) {
    for (const cell of zone.cells) {
      let bitmask = 0;
      if (cell.connections.north) bitmask |= DIR.N;
      if (cell.connections.northeast) bitmask |= DIR.NE;
      if (cell.connections.east) bitmask |= DIR.E;
      if (cell.connections.southeast) bitmask |= DIR.SE;
      if (cell.connections.south) bitmask |= DIR.S;
      if (cell.connections.southwest) bitmask |= DIR.SW;
      if (cell.connections.west) bitmask |= DIR.W;
      if (cell.connections.northwest) bitmask |= DIR.NW;

      // Apply diagonal masking — same as runtime lookup
      bitmask = maskIrrelevantDiagonals(bitmask);
      newMappings[bitmask] = cell.spriteName;
      cellCount++;
    }
  }

  terrain.bitmaskMappings = newMappings;

  // Count unique non-default entries
  const unique = new Set(newMappings.filter(n => n !== terrain.defaultSprite));
  console.log(`  [${terrain.type}] ${cellCount} cells → ${unique.size} unique sprites (+ default ${terrain.defaultSprite})`);
}

fs.writeFileSync(BITMASK_PATH, JSON.stringify(bitmaskData, null, 2) + '\n');
console.log('\nRegenerated terrain-bitmask.json with diagonal masking.');
