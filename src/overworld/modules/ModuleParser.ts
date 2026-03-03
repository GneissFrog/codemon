import {
  TileModuleDef,
  ModuleTilePlacement,
  AsciiModuleFormat,
  MultiLayerAsciiModuleFormat,
  AsciiLegendEntry,
  PlacementRules,
  ModuleCategory,
  ConnectionPoint,
} from '../core/types';

const DEFAULT_PLACEMENT: PlacementRules = {
  minDistFromPlots: 3,
  minDistFromSame: 10,
  minDistFromAny: 4,
  affinity: 'any',
  allowOverlapWater: false,
  allowOverlapDecorations: true,
  requiresGrass: true,
};

/** Check if a module definition uses multi-layer ASCII format */
function isMultiLayer(
  def: AsciiModuleFormat | MultiLayerAsciiModuleFormat
): def is MultiLayerAsciiModuleFormat {
  return 'layers' in def && Array.isArray((def as MultiLayerAsciiModuleFormat).layers);
}

/** Parse a single ASCII map + legend into tile placements */
function parseAsciiLayer(
  asciiMap: string[],
  legend: Record<string, AsciiLegendEntry>,
  defaultLayer: number
): ModuleTilePlacement[] {
  const tiles: ModuleTilePlacement[] = [];
  for (let y = 0; y < asciiMap.length; y++) {
    const row = asciiMap[y];
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char === '.' || char === ' ') continue;
      const entry = legend[char];
      if (!entry) continue;
      tiles.push({
        x,
        y,
        layer: entry.layer ?? defaultLayer,
        type: entry.type,
        spriteId: entry.spriteId,
      });
    }
  }
  return tiles;
}

/** Compute bounding dimensions from an ASCII map */
function computeDimensions(asciiMap: string[]): { width: number; height: number } {
  const height = asciiMap.length;
  let width = 0;
  for (const row of asciiMap) {
    if (row.length > width) width = row.length;
  }
  return { width, height };
}

/** Parse a single-layer ASCII module into a full TileModuleDef */
function parseSingleLayerAscii(def: AsciiModuleFormat): TileModuleDef {
  const tiles = parseAsciiLayer(def.asciiMap, def.legend, 2);
  const { width, height } = computeDimensions(def.asciiMap);

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    width,
    height,
    tiles,
    connectionPoints: def.connectionPoints ?? [],
    placement: { ...DEFAULT_PLACEMENT, ...def.placement },
    tags: def.tags ?? [],
    rarity: def.rarity ?? 0.5,
    minWorldArea: def.minWorldArea ?? 0,
    maxInstances: def.maxInstances ?? -1,
  };
}

/** Parse a multi-layer ASCII module into a full TileModuleDef */
function parseMultiLayerAscii(def: MultiLayerAsciiModuleFormat): TileModuleDef {
  const allTiles: ModuleTilePlacement[] = [];
  let maxWidth = 0;
  let maxHeight = 0;

  for (const layerDef of def.layers) {
    const tiles = parseAsciiLayer(layerDef.asciiMap, layerDef.legend, layerDef.layer);
    allTiles.push(...tiles);
    const { width, height } = computeDimensions(layerDef.asciiMap);
    if (width > maxWidth) maxWidth = width;
    if (height > maxHeight) maxHeight = height;
  }

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    width: maxWidth,
    height: maxHeight,
    tiles: allTiles,
    connectionPoints: def.connectionPoints ?? [],
    placement: { ...DEFAULT_PLACEMENT, ...def.placement },
    tags: def.tags ?? [],
    rarity: def.rarity ?? 0.5,
    minWorldArea: def.minWorldArea ?? 0,
    maxInstances: def.maxInstances ?? -1,
  };
}

/** Check if a raw JSON object is an ASCII format (single or multi-layer) */
export function isAsciiFormat(
  raw: Record<string, unknown>
): boolean {
  return 'asciiMap' in raw || 'layers' in raw;
}

/** Parse any ASCII module format (single or multi-layer) into a TileModuleDef */
export function parseAsciiModule(
  raw: AsciiModuleFormat | MultiLayerAsciiModuleFormat
): TileModuleDef {
  if (isMultiLayer(raw)) {
    return parseMultiLayerAscii(raw);
  }
  return parseSingleLayerAscii(raw);
}

/**
 * Normalize a raw module definition from JSON.
 * Accepts either a full TileModuleDef or an ASCII shorthand format.
 */
export function normalizeModuleDef(raw: Record<string, unknown>): TileModuleDef {
  if (isAsciiFormat(raw)) {
    return parseAsciiModule(raw as unknown as AsciiModuleFormat | MultiLayerAsciiModuleFormat);
  }

  // Already in full TileModuleDef format - apply defaults for optional fields
  const def = raw as unknown as Partial<TileModuleDef>;
  return {
    id: def.id ?? 'unknown',
    name: def.name ?? def.id ?? 'Unknown Module',
    category: def.category ?? 'decorative' as ModuleCategory,
    width: def.width ?? 0,
    height: def.height ?? 0,
    tiles: (def.tiles ?? []) as ModuleTilePlacement[],
    connectionPoints: (def.connectionPoints ?? []) as ConnectionPoint[],
    placement: { ...DEFAULT_PLACEMENT, ...def.placement },
    tags: (def.tags ?? []) as string[],
    rarity: def.rarity ?? 0.5,
    minWorldArea: def.minWorldArea ?? 0,
    maxInstances: def.maxInstances ?? -1,
  };
}
