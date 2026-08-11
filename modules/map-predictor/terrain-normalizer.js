import {normalizeTerrainKind} from './matcher.js';

const TERRAIN_NAME_CACHE = new WeakMap();

// WebTiles exposes dungeon tile enum names, which are shorter than several
// BRANCH_ENTRANCE/BRANCH_EXIT vault names used by DES (enter_orc versus
// enter_orcish_mines, for example). These are stairs in feature-data.h. Keep
// them ahead of the generic enter_/exit_ portal rule; Vaults and Zot are
// intentionally absent because Crawl defines those entrances as MF_PORTAL.
const BRANCH_STAIR_TILES = new Set([
    'exit_dungeon',
    'enter',
    'return',
    'enter_temple',
    'exit_temple',
    'enter_orc',
    'exit_orc',
    'enter_elf',
    'exit_elf',
    'enter_lair',
    'exit_lair',
    'enter_snake',
    'exit_snake',
    'enter_swamp',
    'exit_swamp',
    'enter_spider',
    'exit_spider',
    'enter_shoals',
    'exit_shoals',
    'enter_slime',
    'exit_slime',
    'enter_depths',
    'return_depths',
    'enter_crypt',
    'exit_crypt',
    'enter_tomb',
    'exit_tomb'
]);

function numericTileValue(bg) {
    if (typeof bg === 'number') {
        return bg & 0xffff;
    }
    if (Array.isArray(bg)) {
        return Number.isFinite(bg.value) ? bg.value : (bg[0] & 0xffff);
    }
    if (bg && Number.isFinite(bg.value)) {
        return bg.value;
    }
    return null;
}

function tileNameCandidate(name) {
    if (name.endsWith('_MAX') || name.includes('_FILLER_')) {
        return null;
    }

    if (name.startsWith('DNGN_')) {
        return {name: name.slice(5).toLowerCase(), priority: 3};
    }
    if (name.startsWith('WALL_')) {
        return {name: name.toLowerCase(), priority: 2};
    }
    if (name.startsWith('FLOOR_')) {
        return {name: name.toLowerCase(), priority: 1};
    }
    return null;
}

function terrainNameIndex(dngn) {
    if ((!dngn || typeof dngn !== 'object') && typeof dngn !== 'function') {
        return null;
    }

    let index = TERRAIN_NAME_CACHE.get(dngn);
    if (index) {
        return index;
    }

    index = new Map();
    for (const [name, value] of Object.entries(dngn)) {
        if (!Number.isFinite(value)) {
            continue;
        }
        const candidate = tileNameCandidate(name);
        if (!candidate) {
            continue;
        }
        const previous = index.get(value);
        if (!previous || candidate.priority > previous.priority) {
            index.set(value, candidate);
        }
    }
    TERRAIN_NAME_CACHE.set(dngn, index);
    return index;
}

function terrainNameFromTile(tile, dngn) {
    if (!Number.isFinite(tile)) {
        return null;
    }
    return terrainNameIndex(dngn)?.get(tile)?.name || null;
}

function kindFromTile(cell, binding) {
    const dngn = binding?.dngn;
    const tile = numericTileValue(cell?.t?.bg);
    if (!Number.isFinite(tile)) {
        return null;
    }
    const base = typeof dngn?.basetile === 'function' ? dngn.basetile(tile) : tile;
    const name = terrainNameFromTile(base, dngn);
    if (name) {
        if (name.includes('lava')) {
            return 'lava';
        }
        if (name.includes('deep_water') || name.includes('open_sea')) {
            return 'deep_water';
        }
        if (name.includes('shallow_water')) {
            return 'shallow_water';
        }
        if (name.includes('door')) {
            return name.includes('open_door') ? 'floor' : 'door';
        }
        if (BRANCH_STAIR_TILES.has(name)
            || name.includes('stair') || name.includes('hatch')) {
            return 'stair';
        }
        if (name.includes('portal') || name.includes('transporter')
            || name.includes('passage_of_golubria')
            || name.startsWith('enter_') || name.startsWith('exit_')) {
            return 'portal';
        }
        if (name.includes('altar')) {
            return 'altar';
        }
        if (name.includes('statue') || name.includes('idol')) {
            return 'statue';
        }
        if (name.includes('wall') || name.includes('tree')) {
            return 'wall';
        }
        if (name.includes('floor') || name.includes('arch')
            || name.includes('fountain') || name.includes('trap')) {
            return 'floor';
        }
    }

    // tileinfo-dngn lays out floor textures first and wall textures second.
    // The first wall is exactly FLOOR_MAX and the first feature is exactly
    // WALL_MAX; *_MAX is a shared boundary alias, not the preceding range's
    // final tile.
    if (dngn && Number.isFinite(dngn.FLOOR_MAX)
        && Number.isFinite(dngn.WALL_MAX)) {
        const firstTile = Number.isFinite(dngn.DNGN_UNSEEN)
            ? dngn.DNGN_UNSEEN
            : 0;
        if (base >= firstTile && base < dngn.FLOOR_MAX) {
            return 'floor';
        }
        if (base >= dngn.FLOOR_MAX && base < dngn.WALL_MAX) {
            return 'wall';
        }
    }
    return null;
}

function kindFromMapFeature(cell, enums) {
    if (!enums || !Number.isFinite(cell?.mf)) {
        return null;
    }
    const direct = new Map([
        [enums.MF_FLOOR, 'floor'],
        [enums.MF_WALL, 'wall'],
        [enums.MF_MAP_FLOOR, 'floor'],
        [enums.MF_MAP_WALL, 'wall'],
        [enums.MF_DOOR, 'door'],
        [enums.MF_STAIR_UP, 'stair'],
        [enums.MF_STAIR_DOWN, 'stair'],
        [enums.MF_STAIR_BRANCH, 'stair'],
        [enums.MF_WATER, 'shallow_water'],
        [enums.MF_DEEP_WATER, 'deep_water'],
        [enums.MF_LAVA, 'lava'],
        [enums.MF_PORTAL, 'portal'],
        [enums.MF_TRANSPORTER, 'portal'],
        [enums.MF_TRANSPORTER_LANDING, 'portal']
    ]);
    return direct.get(cell.mf) || null;
}

export function normalizeWebtilesCell(cell, binding = {}) {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
        return null;
    }
    // f=0 is DNGN_UNSEEN. It can be sent for the explore horizon and must not
    // become evidence merely because a minimap colour is present.
    if (cell.f === 0 || cell.f == null) {
        return null;
    }

    const tileKind = kindFromTile(cell, binding);
    const featureKind = kindFromMapFeature(cell, binding.enums);
    const kind = normalizeTerrainKind(tileKind || featureKind);
    if (!kind) {
        return null;
    }
    return {x: cell.x, y: cell.y, kind};
}

export function normalizeWebtilesCells(cells, binding = {}) {
    return (cells || []).map(cell => normalizeWebtilesCell(cell, binding)).filter(Boolean);
}

/**
 * Normalize an adapter onKnowledge entry without losing unseen-cell removals.
 * Upserts carry removed:false; tombstones carry kind:null and removed:true.
 */
export function normalizeWebtilesKnowledgeUpdate(entry, binding = {}) {
    if (!entry || !Number.isInteger(entry.x) || !Number.isInteger(entry.y)) {
        return null;
    }
    // The adapter may borrow a predicted background tile solely to repair a
    // sparse native LOS redraw. It remains useful for rendering, but must not
    // feed the prediction back into matcher observations.
    if (entry.terrainReliable === false) {
        return null;
    }

    const isEnvelope = Object.prototype.hasOwnProperty.call(entry, 'cell');
    const cell = isEnvelope
        ? (entry.cell && typeof entry.cell === 'object'
            ? {...entry.cell, x: entry.x, y: entry.y}
            : null)
        : entry;
    const removed = entry.removed === true
        || (cell && (cell.f === 0 || cell.f == null));
    if (removed) {
        return {x: entry.x, y: entry.y, kind: null, removed: true};
    }

    // removed:false with no cell means the adapter could not read the
    // map-knowledge binding. That is not evidence and must not erase evidence.
    if (!cell) {
        return null;
    }
    const normalized = normalizeWebtilesCell(cell, binding);
    return normalized ? {...normalized, removed: false} : null;
}

export function normalizeWebtilesKnowledgeUpdates(entries, binding = {}) {
    return (entries || [])
        .map(entry => normalizeWebtilesKnowledgeUpdate(entry, binding))
        .filter(Boolean);
}

export default normalizeWebtilesCell;
