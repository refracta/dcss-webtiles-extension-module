import {parseDes} from './des-parser.js';
import {materializeAuditedEncompassWallFill} from './encompass-fill.js';

const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';

const REVEAL_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    // A noisy observation must not discard the true entry/transform before
    // world-space consensus. Keep acceptance strict while retaining nearby
    // source-closed alternatives solely as prediction vetoes.
    plausibleMinScore: 0.965,
    plausibleSlack: 0.08,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.25,
    requiredKinds: ['wall', 'floor']
});

const DETECTION_MATCH_POLICY = Object.freeze({
    ...REVEAL_MATCH_POLICY,
    revealDisabled: true,
    forceRevealDisabled: true
});

const FORCE_ONLY_MATCH_POLICY = Object.freeze({
    ...REVEAL_MATCH_POLICY,
    revealDisabled: true
});

/**
 * Portal destination inventories are selected from the source itself. The
 * selector intentionally contains no map names: a newly-added encompass map
 * is therefore retained as a detection-only candidate on the first daily
 * source refresh instead of silently falling outside the closed set.
 */
// `entryGlyphs` are the stone arches Crawl uses as destination arrival
// points. `portalGlyphs` are the separate exit features restored from Lua
// helpers for terrain matching.
export const PORTAL_DESTINATION_SPECS = Object.freeze({
    arena: Object.freeze({
        suffix: '/portals/arena.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        revealable: true
    }),
    bailey: Object.freeze({
        suffix: '/portals/bailey.des',
        entryGlyphs: ['A'],
        // A lone Bailey map defines `>` as another exit with an explicit,
        // parseable KFEAT. Only the Lua-provided common exit needs restoring.
        portalGlyphs: ['<'],
        revealable: true
    }),
    bazaar: Object.freeze({
        suffix: '/portals/bazaar.des',
        entryGlyphs: ['<'],
        portalGlyphs: ['>'],
        floorGlyphs: ['<'],
        revealable: true
    }),
    crucible: Object.freeze({
        suffix: '/portals/crucible.des',
        entryGlyphs: []
    }),
    desolation: Object.freeze({
        suffix: '/portals/desolation.des',
        entryGlyphs: ['H'],
        portalGlyphs: ['<'],
        forceable: true
    }),
    gauntlet: Object.freeze({
        suffix: '/portals/gauntlet.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<']
    }),
    gulch: Object.freeze({
        suffix: '/portals/gulch.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        floorGlyphs: ['}', ']']
    }),
    icecave: Object.freeze({
        suffix: '/portals/icecave.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        revealable: true
    }),
    necropolis: Object.freeze({
        suffix: '/portals/necropolis.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<', '>']
    }),
    ossuary: Object.freeze({
        suffix: '/portals/ossuary.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        revealable: true
    }),
    sewer: Object.freeze({
        suffix: '/portals/sewer.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        revealable: true
    }),
    trove: Object.freeze({
        suffix: '/portals/trove.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        forceable: true
    }),
    volcano: Object.freeze({
        suffix: '/portals/volcano.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<', 'I'],
        revealable: true
    }),
    wizlab: Object.freeze({
        suffix: '/portals/wizlab.des',
        entryGlyphs: ['A'],
        portalGlyphs: ['<'],
        externalAudit: true
    }),
    ziggurat: Object.freeze({
        suffix: '/portals/ziggurat.des',
        entryGlyphs: []
    })
});

function templateTags(template) {
    const value = template?.metadata?.tags ?? template?.tags ?? [];
    return new Set(Array.isArray(value)
        ? value
        : String(value || '').split(/\s+/u).filter(Boolean));
}

function specEntry(path) {
    const normalized = String(path || '').replaceAll('\\', '/');
    return Object.entries(PORTAL_DESTINATION_SPECS)
        .find(([, spec]) => normalized.endsWith(spec.suffix)) || null;
}

export function naturalPortalDestinationTemplates(parsed, path) {
    const entry = specEntry(path);
    if (!entry) {
        return [];
    }
    return (parsed || []).filter(template => {
        const tags = templateTags(template);
        return Number.isInteger(template?.width) && template.width > 0
            && Number.isInteger(template?.height) && template.height > 0
            && template?.metadata?.encompass === true
            && !tags.has('unrand')
            && !tags.has('removed')
            && !tags.has('overwritable');
    });
}

function luaFunctionRegion(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)function\\s+${escaped}\\s*\\(`,
        'u'
    ).exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const remainder = String(source).slice(start);
    const closing = /^end\s*$/gmu.exec(remainder);
    return closing
        ? remainder.slice(0, closing.index + closing[0].length)
        : null;
}

function calledEntryMethods(region) {
    return [...scrubLuaForCalls(region).matchAll(
        /\be\s*[.:]\s*([A-Za-z_]\w*)\s*\(/gu
    )]
        .map(match => match[1]);
}

function exactMethods(region, expected) {
    const actual = calledEntryMethods(region);
    const expectedEntries = Object.entries(expected);
    const expectedTotal = expectedEntries.reduce(
        (total, [, count]) => total + count,
        0
    );
    if (actual.length !== expectedTotal) {
        return false;
    }
    const counts = new Map();
    for (const method of actual) {
        counts.set(method, (counts.get(method) || 0) + 1);
    }
    return counts.size === expectedEntries.length
        && expectedEntries.every(([method, count]) => counts.get(method) === count);
}

function exactCallCounts(actual, expected) {
    const expectedEntries = Object.entries(expected);
    const expectedTotal = expectedEntries.reduce(
        (total, [, count]) => total + count,
        0
    );
    if (actual.length !== expectedTotal) {
        return false;
    }
    const counts = new Map();
    for (const name of actual) {
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts.size === expectedEntries.length
        && expectedEntries.every(([name, count]) => counts.get(name) === count);
}

function scrubLuaForCalls(region) {
    return String(region || '')
        .replace(/--\[\[[\s\S]*?\]\]/gu, ' ')
        .replace(/--[^\n]*/gu, ' ')
        .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gsu, '""');
}

function calledBareFunctions(region, currentName) {
    const ignored = new Set([
        'function',
        'if',
        'elseif',
        'for',
        'while',
        'until',
        'return',
        'and',
        'or',
        'not',
        currentName
    ]);
    return [...scrubLuaForCalls(region).matchAll(
        /(?<![:.\w])([A-Za-z_]\w*)\s*\(/gu
    )].map(match => match[1]).filter(name => !ignored.has(name));
}

function exactBareCalls(region, currentName, expected) {
    return exactCallCounts(
        calledBareFunctions(region, currentName),
        expected
    );
}

function calledReceiverMethods(region, receiver) {
    const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return [...String(region || '').matchAll(new RegExp(
        `\\b${escaped}\\.([A-Za-z_]\\w*)\\s*\\(`,
        'gu'
    ))].map(match => match[1]);
}

function exactReceiverMethods(region, receiver, expected) {
    return exactCallCounts(calledReceiverMethods(region, receiver), expected);
}

function onlyReceiverMethods(region, receiver, allowed) {
    const names = new Set(allowed);
    return calledReceiverMethods(region, receiver)
        .every(method => names.has(method));
}

function literalKfeat(region, assignment) {
    const escaped = assignment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`\\be\\.kfeat\\(\\s*["']${escaped}["']\\s*\\)`, 'u')
        .test(String(region || ''));
}

function metalStatueHelperIsSafe(dependencies) {
    const region = luaFunctionRegion(
        dependencies?.[VAULT_LUA_PATH],
        'vault_metal_statue_setup'
    );
    return Boolean(region
        && exactMethods(region, {
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
        && /e\.kfeat\(glyph\s*\.\.\s*["']\s*=\s*metal_statue["']\)/u
            .test(region));
}

function dependencyFeatureHelperIsSafe(dependencies, name, feature) {
    const region = luaFunctionRegion(dependencies?.[VAULT_LUA_PATH], name);
    const escaped = feature.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return Boolean(region
        && exactMethods(region, {
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
        && new RegExp(
            `e\\.kfeat\\(glyph\\s*\\.\\.\\s*["']\\s*=\\s*${escaped}["']\\)`,
            'u'
        ).test(region)
        && calledBareFunctions(region, name)
            .every(call => call === 'pairs'));
}

function graniteStatueHelperIsSafe(dependencies) {
    return dependencyFeatureHelperIsSafe(
        dependencies,
        'vault_granite_statue_setup',
        'granite_statue'
    );
}

function decorativeFloorHelperIsSafe(dependencies) {
    return dependencyFeatureHelperIsSafe(
        dependencies,
        'decorative_floor',
        'decorative_floor'
    );
}

const ICE_NON_TERRAIN_HELPERS = Object.freeze({
    ice_cave_natural_monster_set: Object.freeze({
        methods: Object.freeze({kmons: 16, set_random_mon_list: 2}),
        bare: Object.freeze({}),
        receivers: Object.freeze({dgn: Object.freeze({random_item_def: 1})})
    }),
    ice_cave_undead_demon_monster_set: Object.freeze({
        methods: Object.freeze({kmons: 17, set_random_mon_list: 2}),
        bare: Object.freeze({simulacrum_monsters: 1, scythe: 1}),
        receivers: Object.freeze({dgn: Object.freeze({random_entry_arg: 4})})
    }),
    ice_cave_armour_loot: Object.freeze({
        methods: Object.freeze({kitem: 3}),
        bare: Object.freeze({}),
        receivers: Object.freeze({})
    }),
    ice_cave_weapon_loot: Object.freeze({
        methods: Object.freeze({kitem: 3}),
        bare: Object.freeze({}),
        receivers: Object.freeze({dgn: Object.freeze({random_item_def: 1})})
    }),
    ice_cave_magic_loot: Object.freeze({
        methods: Object.freeze({kitem: 1}),
        bare: Object.freeze({}),
        receivers: Object.freeze({})
    }),
    ice_cave_necro_loot: Object.freeze({
        methods: Object.freeze({kitem: 1}),
        bare: Object.freeze({}),
        receivers: Object.freeze({})
    }),
    place_freezing_vapour_machine: Object.freeze({
        methods: Object.freeze({lua_marker: 1}),
        bare: Object.freeze({}),
        receivers: Object.freeze({})
    })
});

function iceHelpersAreSafe(source, dependencies) {
    const appearance = luaFunctionRegion(source, 'ice_cave_appearance');
    const commonLoot = luaFunctionRegion(source, 'ice_cave_common_loot');
    if (!appearance
        || !exactMethods(appearance, {kfeat: 1, set_feature_name: 4})
        || !literalKfeat(appearance, '< = exit_ice_cave')
        || !commonLoot
        || calledEntryMethods(commonLoot).length !== 0
        || !exactBareCalls(commonLoot, 'ice_cave_common_loot', {
            ice_cave_armour_loot: 1,
            ice_cave_weapon_loot: 1,
            ice_cave_magic_loot: 1
        })) {
        return false;
    }
    for (const [name, audit] of Object.entries(ICE_NON_TERRAIN_HELPERS)) {
        const region = luaFunctionRegion(source, name);
        if (!region
            || !exactMethods(region, audit.methods)
            || !exactBareCalls(region, name, audit.bare)
            || !Object.entries(audit.receivers).every(([receiver, methods]) =>
                exactReceiverMethods(region, receiver, methods))) {
            return false;
        }
    }
    const simulacrum = luaFunctionRegion(source, 'simulacrum_monsters');
    if (!simulacrum
        || !exactMethods(simulacrum, {})
        || !exactBareCalls(simulacrum, 'simulacrum_monsters', {})) {
        return false;
    }
    return metalStatueHelperIsSafe(dependencies);
}

const VOLCANO_MARKER_HELPERS = Object.freeze([
    'place_large_volcano',
    'place_chained_volcano',
    'place_small_volcano',
    'place_tiny_volcano'
]);

function volcanoLootHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'setup_loot');
    const armour = luaFunctionRegion(source, 'make_fiery_armour');
    const weapon = luaFunctionRegion(source, 'make_fiery_weapon');
    return Boolean(setup
        && exactMethods(setup, {item: 4})
        && exactBareCalls(setup, 'setup_loot', {
            make_fiery_armour: 1,
            make_fiery_weapon: 1
        })
        && exactReceiverMethods(setup, 'dgn', {})
        && /make_fiery_armour\s*\(\s*e\s*,\s*\{/u.test(setup)
        && /make_fiery_weapon\s*\(\s*e\s*,\s*\{/u.test(setup)
        && armour
        && exactMethods(armour, {})
        && exactBareCalls(armour, 'make_fiery_armour', {ipairs: 1})
        && exactReceiverMethods(armour, 'string', {gsub: 1})
        && exactReceiverMethods(armour, 'dgn', {})
        && weapon
        && exactMethods(weapon, {item: 1})
        && exactBareCalls(weapon, 'make_fiery_weapon', {ipairs: 1})
        && exactReceiverMethods(weapon, 'string', {gsub: 1})
        && exactReceiverMethods(weapon, 'dgn', {}));
}

function arenaHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'arena_setup');
    return Boolean(setup
        && exactMethods(setup, {
            tags: 1,
            orient: 1,
            kfeat: 1,
            kprop: 1,
            kmask: 1,
            mons: 1,
            lua_marker: 1
        })
        && exactBareCalls(setup, 'arena_setup', {})
        && literalKfeat(setup, '< = exit_arena')
        && /e\.tags\(\s*["']no_dump no_item_gen allow_dup["']\s*\)/u
            .test(setup)
        && /e\.orient\(\s*["']encompass["']\s*\)/u.test(setup)
        && /e\.kprop\(\s*["']1'<\s*=\s*no_tele_into["']\s*\)/u
            .test(setup)
        && /e\.kmask\(\s*["']1'<\s*=\s*no_monster_gen["']\s*\)/u
            .test(setup)
        && /e\.mons\(\s*["']generate_awake spectator["']\s*\)/u
            .test(setup)
        && /e\.lua_marker\(\s*["']v["']\s*,\s*props_marker\s*\{/u
            .test(setup));
}

function sewerHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'sewer_setup');
    return Boolean(setup
        && exactMethods(setup, {kfeat: 1, colour: 2})
        && exactBareCalls(setup, 'sewer_setup', {})
        && literalKfeat(setup, '< = exit_sewer'));
}

function ossuaryHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'ossuary_setup_features');
    const talisman = luaFunctionRegion(source, 'inkwell_talisman_chance');
    return Boolean(setup
        && exactMethods(setup, {tags: 2, tile: 1, kfeat: 1})
        && exactBareCalls(setup, 'ossuary_setup_features', {})
        && literalKfeat(setup, '< = exit_ossuary')
        && talisman
        && exactMethods(talisman, {kitem: 1, nsubst: 1, subst: 1})
        && exactBareCalls(talisman, 'inkwell_talisman_chance', {})
        && /e\.kitem\(iglyph\s*\.\.\s*["']\s*=\s*inkwell talisman["']\)/u
            .test(talisman)
        && /e\.nsubst\(nglyph\s*\.\.\s*["']\s*=\s*1:["']\s*\.\.\s*iglyph\s*\.\.\s*["']:3\s*["']\s*\.\.\s*nglyph\s*\.\.\s*["']:17\s*\/\s*\*:["']\s*\.\.\s*nglyph\)/u
            .test(talisman)
        && /e\.subst\(iglyph\s*\.\.\s*["']\s*=\s*["']\s*\.\.\s*iglyph\s*\.\.\s*["']:3\s+\.:17["']\)/u
            .test(talisman));
}

const BAILEY_MONSTER_HELPERS = Object.freeze({
    kobold_axe_returning: Object.freeze({kmons: 1}),
    easy_axe_fighter: Object.freeze({kmons: 1}),
    hard_axe_fighter: Object.freeze({kmons: 2}),
    orc_warlord_with_axe: Object.freeze({kmons: 1}),
    orc_with_polearm: Object.freeze({kmons: 1}),
    orc_warrior_with_polearm: Object.freeze({kmons: 1}),
    orc_knight_with_polearm: Object.freeze({kmons: 1}),
    orc_warlord_with_polearm: Object.freeze({kmons: 1})
});

function baileyHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'bailey_setup');
    const talisman = luaFunctionRegion(source, 'bailey_talisman_chance');
    if (!setup
        || !exactMethods(setup, {kfeat: 1, lrocktile: 1})
        || !exactBareCalls(setup, 'bailey_setup', {})
        || !literalKfeat(setup, '< = exit_bailey')
        || !talisman
        || !exactMethods(talisman, {kitem: 1, subst: 1})
        || !exactBareCalls(talisman, 'bailey_talisman_chance', {})
        || !/e\.kitem\(glyph\s*\.\.\s*["']\s*=\s*fortress talisman\s*\/\s*blade talisman w:5["']\)/u
            .test(talisman)
        || !/e\.subst\(glyph\s*\.\.\s*["']\s*=\s*["']\s*\.\.\s*glyph\s*\.\.\s*["']:15\s+\.:85["']\)/u
            .test(talisman)) {
        return false;
    }
    return Object.entries(BAILEY_MONSTER_HELPERS).every(([name, methods]) => {
        const region = luaFunctionRegion(source, name);
        return Boolean(region
            && exactMethods(region, methods)
            && exactBareCalls(region, name, {}));
    });
}

function bazaarHelpersAreSafe(source) {
    const setup = luaFunctionRegion(source, 'bazaar_setup');
    const tileset = luaFunctionRegion(source, 'random_bazaar_tileset');
    const tiles = luaFunctionRegion(source, 'randomise_bazaar_tiles');
    const halos = luaFunctionRegion(source, 'create_shop_halos');
    return Boolean(setup
        && exactMethods(setup, {
            tags: 2,
            kmons: 2,
            kfeat: 2,
            nsubst: 2
        })
        && exactBareCalls(setup, 'bazaar_setup', {
            randomise_bazaar_tiles: 2
        })
        && exactReceiverMethods(setup, 'dgn', {set_branch_epilogue: 3})
        && exactReceiverMethods(setup, 'crawl', {mpr: 5})
        && exactReceiverMethods(setup, 'you', {
            god: 6,
            get_base_mutation_level: 1,
            silenced: 2
        })
        && literalKfeat(setup, '< = stone_arch')
        && literalKfeat(setup, '> = exit_bazaar')
        && /e\.nsubst\(["']\.\s*=\s*2:K\s*\/\s*4\s*=\s*K\.\s*\/\s*6\s*:\s*K\s+\.:260\s*\/\s*\*:\.["']\)/u
            .test(setup)
        && /e\.nsubst\(["']\.\s*=\s*1:K\s*\/\s*2\s*=\s*K\.\s*\/\s*3\s*:\s*K\s+\.:260\s*\/\s*\*:\.["']\)/u
            .test(setup)
        && tileset
        && exactMethods(tileset, {})
        && exactBareCalls(tileset, 'random_bazaar_tileset', {})
        && exactReceiverMethods(tileset, 'util', {keys: 1})
        && exactReceiverMethods(tileset, 'crawl', {random2: 1})
        && tiles
        && exactMethods(tiles, {})
        && exactBareCalls(tiles, 'randomise_bazaar_tiles', {
            random_bazaar_tileset: 1
        })
        && exactReceiverMethods(tiles, 'dgn', {
            change_floor_colour: 1,
            change_floor_tile: 1,
            change_rock_tile: 1
        })
        && halos
        && exactMethods(halos, {})
        && exactBareCalls(halos, 'create_shop_halos', {})
        && exactReceiverMethods(halos, 'dgn', {
            get_floor_colour: 1,
            floor_halo: 1
        }));
}

const TROVE_LOCAL_HELPERS = new Set([
    'trove_weapon_skills',
    'trove_spell_skills',
    'trove_milestone',
    'trove_setup',
    'species_is_undead',
    'species_has_size_limits',
    'wants_barding',
    'no_body_armour_species',
    'no_friendlies',
    'no_evil',
    'trove_weap_brand',
    'trove_other_weapon_specialty',
    'trove_book',
    'trove_standard_magic',
    'trove_ego_gen_armour',
    'trove_ego_shield',
    'trove_good_talisman',
    'trove_jewel_type',
    'trove_cons',
    'trove_offense',
    'trove_defense',
    'trove_unrand_chances'
]);

const TROVE_EXTERNAL_CALLS = new Set([
    'kitem',
    'subst',
    'nsubst',
    'vault_metal_statue_setup',
    'decorative_floor',
    'set_border_fill_type'
]);

const TROVE_BUILTIN_CALLS = new Set(['ipairs', 'pairs']);

const TROVE_RECEIVER_CALLS = new Set([
    'math.max',
    'you.base_skill',
    'you.race',
    'you.species',
    'you.genus',
    'you.mutation',
    'you.god',
    'you.get_base_mutation_level',
    'you.unrands',
    'crawl.game_started',
    'crawl.random_range',
    'crawl.x_chance_in_y',
    'crawl.one_chance_in',
    'crawl.mark_milestone',
    'crawl.take_note',
    'crawl.mpr',
    'table.insert',
    'table.concat',
    'items.pickable',
    'school.lower',
    'sc.lower'
]);

function luaFunctionUntilNextDefinition(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)function\\s+${escaped}\\s*\\(`,
        'u'
    ).exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const remainder = String(source).slice(start);
    const nextFunction = /\nfunction\s+/u.exec(remainder.slice(1));
    const luaEnd = /\n\}\}/u.exec(remainder.slice(1));
    const ends = [nextFunction, luaEnd]
        .filter(Boolean)
        .map(value => value.index + 1);
    return remainder.slice(0, ends.length ? Math.min(...ends) : undefined);
}

function luaReceiverCalls(region) {
    return [...scrubLuaForCalls(region).matchAll(
        /\b([A-Za-z_]\w*)\s*[.:]\s*([A-Za-z_]\w*)\s*\(/gu
    )].map(match => `${match[1]}.${match[2]}`);
}

function troveLuaText(block) {
    const source = String(block || '');
    const embedded = [...source.matchAll(/\{\{([\s\S]*?)\}\}/gu)]
        .map(match => match[1]);
    const colon = source.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith(':'))
        .map(line => line.slice(1));
    return [...embedded, ...colon].join('\n');
}

function allLiteralAssignmentTargets(region, method, expectedGlyphs) {
    const calls = calledEntryMethods(region).filter(name => name === method);
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const literals = [...String(region || '').matchAll(new RegExp(
        `\\be\\s*[.:]\\s*${escaped}\\s*\\(\\s*["']([^"']*)["']`,
        'gu'
    ))].map(match => match[1]);
    return calls.length === literals.length && literals.every(value => {
        const left = value.split(/[=:]/u, 1)[0].replace(/\s+/gu, '');
        return left.length > 0
            && [...left].every(glyph => expectedGlyphs.has(glyph));
    });
}

function troveHelperIsSafe(source, name, visiting = new Set()) {
    if (!TROVE_LOCAL_HELPERS.has(name)) {
        return false;
    }
    if (visiting.has(name)) {
        return true;
    }
    const region = luaFunctionUntilNextDefinition(source, name);
    if (!region) {
        return false;
    }
    const expectedMethods = {
        trove_setup: {tags: 2, orient: 1, kfeat: 1},
        trove_offense: {kitem: 3, subst: 1, nsubst: 10},
        trove_defense: {kitem: 3, nsubst: 3},
        trove_unrand_chances: {kitem: 1, nsubst: 1}
    }[name] || {};
    if (!exactMethods(region, expectedMethods)
        || (name === 'trove_setup'
            && (!literalKfeat(region, '< = exit_trove')
                || !/e\.tags\(\s*["']no_monster_gen["']\s*\)/u.test(region)
                || !/e\.tags\(\s*["']no_item_gen["']\s*\)/u.test(region)
                || !/e\.orient\(\s*["']encompass["']\s*\)/u.test(region)))
        || (name === 'trove_offense'
            && (!allLiteralAssignmentTargets(
                region,
                'subst',
                new Set(['d'])
            ) || !allLiteralAssignmentTargets(
                region,
                'nsubst',
                new Set(['d'])
            )))
        || (name === 'trove_defense'
            && !allLiteralAssignmentTargets(
                region,
                'nsubst',
                new Set(['g'])
            ))) {
        return false;
    }
    const bare = calledBareFunctions(region, name);
    if (bare.some(call => !TROVE_LOCAL_HELPERS.has(call)
        && !TROVE_BUILTIN_CALLS.has(call))) {
        return false;
    }
    if (luaReceiverCalls(region).some(call => !call.startsWith('e.')
        && !TROVE_RECEIVER_CALLS.has(call))) {
        return false;
    }
    const next = new Set(visiting).add(name);
    return bare.filter(call => TROVE_LOCAL_HELPERS.has(call))
        .every(call => troveHelperIsSafe(source, call, next));
}

function countBareCall(region, name) {
    return calledBareFunctions(region, '').filter(call => call === name).length;
}

function simpleTroveCallsAreLiteral(lua, name, pattern) {
    const count = countBareCall(lua, name);
    return count === [...String(lua || '').matchAll(pattern)].length;
}

function troveCandidateIsTerrainSafe(source, block, dependencies) {
    if (!block) {
        return false;
    }
    const lua = troveLuaText(block);
    const bare = calledBareFunctions(lua, '');
    if (bare.some(call => !TROVE_LOCAL_HELPERS.has(call)
        && !TROVE_EXTERNAL_CALLS.has(call))) {
        return false;
    }
    if (luaReceiverCalls(lua).some(call => !TROVE_RECEIVER_CALLS.has(call))) {
        return false;
    }
    if (countBareCall(lua, 'trove_setup') !== 1
        || !simpleTroveCallsAreLiteral(
            lua,
            'trove_setup',
            /\btrove_setup\s*\(\s*_G\s*\)/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'subst',
            /(?<![.\w])subst\s*\(\s*["'][^"']+["']\s*\)/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'nsubst',
            /(?<![.\w])nsubst\s*\(\s*["'][^"']+["']\s*\)/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'trove_unrand_chances',
            /\btrove_unrand_chances\s*\(\s*_G\s*,\s*["'][^"']+["']/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'vault_metal_statue_setup',
            /\bvault_metal_statue_setup\s*\(\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']*["']\s*\)/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'decorative_floor',
            /\bdecorative_floor\s*\(\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*\)/gu
        )
        || !simpleTroveCallsAreLiteral(
            lua,
            'set_border_fill_type',
            /\bset_border_fill_type\s*\(\s*["'][^"']+["']\s*\)/gu
        )) {
        return false;
    }
    if (countBareCall(lua, 'vault_metal_statue_setup')
        && !metalStatueHelperIsSafe(dependencies)) {
        return false;
    }
    if (countBareCall(lua, 'decorative_floor')
        && !decorativeFloorHelperIsSafe(dependencies)) {
        return false;
    }
    return [...new Set(bare.filter(call => TROVE_LOCAL_HELPERS.has(call)))]
        .every(call => troveHelperIsSafe(source, call));
}

function troveDynamicTerrainGlyphs(block) {
    const lua = troveLuaText(block);
    const glyphs = new Set();
    if (countBareCall(lua, 'trove_offense')) {
        glyphs.add('d');
    }
    if (countBareCall(lua, 'trove_defense')) {
        glyphs.add('g');
    }
    for (const match of lua.matchAll(
        /(?<![.\w])n?subst\s*\(\s*["']([^"']+)["']/gu
    )) {
        const left = match[1].split(/[=:]/u, 1)[0].replace(/\s+/gu, '');
        for (const glyph of left) {
            glyphs.add(glyph);
        }
    }
    for (const match of lua.matchAll(
        /\btrove_unrand_chances\s*\(\s*_G\s*,\s*["']([^"']+)["']/gu
    )) {
        for (const glyph of match[1].replace(/\s+/gu, '')) {
            glyphs.add(glyph);
        }
    }
    return glyphs;
}

const SAFE_MAP_CALLS = Object.freeze({
    arena: new Set([
        'arena_setup'
    ]),
    sewer: new Set([
        'item',
        'kitem',
        'set_feature_name',
        'sewer_setup',
        'single_cloud'
    ]),
    ossuary: new Set([
        'inkwell_talisman_chance',
        'item',
        'lrockcol',
        'ossuary_setup_features',
        'vault_granite_statue_setup'
    ]),
    bailey: new Set([
        'bailey_setup',
        'bailey_talisman_chance',
        'decorative_floor',
        'easy_axe_fighter',
        'hard_axe_fighter',
        'item',
        'kitem',
        'kmons',
        'kobold_axe_returning',
        'orc_knight_with_polearm',
        'orc_warlord_with_axe',
        'orc_warrior_with_polearm',
        'orc_with_polearm',
        'set_feature_name',
        'vault_granite_statue_setup'
    ]),
    bazaar: new Set([
        'bazaar_setup',
        'decorative_floor',
        'set_border_fill_type',
        'vault_granite_statue_setup',
        'vault_metal_statue_setup'
    ]),
    desolation: new Set([
        'set_border_fill_type',
        'set_feature_name'
    ]),
    icecave: new Set([
        'ice_cave_common_loot',
        'ice_cave_natural_monster_set',
        'ice_cave_necro_loot',
        'ice_cave_undead_demon_monster_set',
        'place_freezing_vapour_machine',
        'vault_metal_statue_setup',
        'kitem',
        'kmons',
        'set_feature_name',
        'set_random_mon_list',
        'ice_cave_appearance'
    ]),
    volcano: new Set([
        'fiery_guardians',
        'place_chained_volcano',
        'place_lake_volcanoes',
        'place_tiny_volcano',
        'vault_metal_statue_setup',
        'lua_marker',
        'set_feature_name',
        'volcano_setup'
    ])
});

function volcanoHelpersAreSafe(source, dependencies) {
    const setup = luaFunctionRegion(source, 'volcano_setup');
    const guardians = luaFunctionRegion(source, 'fiery_guardians');
    const lakeMany = luaFunctionRegion(source, 'place_lake_volcanoes');
    const lakeOne = luaFunctionRegion(source, 'place_lake_volcano');
    if (!setup
        || !exactMethods(setup, {
            kfeat: 3,
            subst: 4,
            colour: 1,
            set_feature_name: 1
        })
        || !literalKfeat(setup, '< = exit_volcano')
        || !literalKfeat(setup, 'I = exit_volcano')
        || !literalKfeat(setup, '^ = trap_alarm')
        || !exactBareCalls(setup, 'volcano_setup', {setup_loot: 1})
        || !volcanoLootHelpersAreSafe(source)
        || !/e\.subst\(["']L\s*:\s*LLL\.l["']\)/u.test(setup)
        || !/e\.subst\(["']L\s*=\s*lll\.["']\)/u.test(setup)
        || !/e\.subst\(["']y\s*:\s*yyy\.x["']\)/u.test(setup)
        || !/e\.subst\(["']y\s*=\s*xxx\.["']\)/u.test(setup)
        || !guardians
        || !exactMethods(guardians, {mons: 19})
        || !exactBareCalls(guardians, 'fiery_guardians', {})
        || !exactReceiverMethods(guardians, 'crawl', {
            x_chance_in_y: 1,
            random2: 2
        })
        || !lakeMany
        || calledEntryMethods(lakeMany).length !== 0
        || !exactBareCalls(lakeMany, 'place_lake_volcanoes', {
            ipairs: 1,
            place_lake_volcano: 1
        })
        || !/for\s+_,\s*glyph\s+in\s+ipairs\(glyphs\)/u.test(lakeMany)
        || !/place_lake_volcano\(e,\s*glyph\)/u.test(lakeMany)
        || !lakeOne
        || !exactMethods(lakeOne, {kfeat: 1, lua_marker: 1})
        || !exactBareCalls(lakeOne, 'place_lake_volcano', {})
        || !/e\.kfeat\(glyph\s*\.\.\s*["']\s*=\s*l["']\)/u.test(lakeOne)) {
        return false;
    }
    for (const name of VOLCANO_MARKER_HELPERS) {
        const region = luaFunctionRegion(source, name);
        if (!region
            || !exactMethods(region, {kfeat: 1, lua_marker: 1})
            || !exactBareCalls(region, name, {})
            || !literalKfeat(region, 'V = l')) {
            return false;
        }
    }
    return metalStatueHelperIsSafe(dependencies);
}

function portalMapCallsAreSafe(family, block, dependencies) {
    const allowlist = SAFE_MAP_CALLS[family];
    if (!allowlist || !block) {
        return false;
    }
    if (['sewer', 'ossuary', 'bailey', 'bazaar'].includes(family)
        && /\{\{/u.test(block)) {
        // Map-level Lua can rewrite mapgrd or install terrain-changing
        // callbacks. Keep those candidates in the closed set, but do not
        // reveal from a static approximation.
        return false;
    }
    if (/^\s*:\s*(?:e|_G)\s*[.:]\s*[A-Za-z_]\w*\s*\(/mu.test(block)) {
        // Direct entry-method calls are not represented by the DES parser
        // after embedded Lua is stripped. Even a currently benign method is
        // outside the audited helper contract, so fail closed.
        return false;
    }
    const calls = [...String(block).matchAll(
        /^\s*:\s*([A-Za-z_]\w*)\s*\(([^\n]*)$/gmu
    )].map(match => ({name: match[1], arguments: match[2]}));
    if (calls.some(call => !allowlist.has(call.name))) {
        return false;
    }
    const setupName = {
        arena: 'arena_setup',
        sewer: 'sewer_setup',
        ossuary: 'ossuary_setup_features',
        bailey: 'bailey_setup',
        bazaar: 'bazaar_setup',
        icecave: 'ice_cave_appearance',
        volcano: 'volcano_setup'
    }[family];
    if (setupName) {
        const setupCalls = calls.filter(call => call.name === setupName);
        const setupCounts = family === 'ossuary'
            ? new Set([1, 2])
            : new Set([1]);
        if (!setupCounts.has(setupCalls.length)) {
            return false;
        }
        const simpleSetup = family !== 'bazaar';
        if (setupCalls.some(call => simpleSetup
            ? !/^\s*_G\s*\)\s*(?:--.*)?$/u.test(call.arguments)
            : !/^\s*_G\s*(?:,\s*false\s*,\s*false(?:\s*,\s*true)?)?\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
            return false;
        }
    }
    if (family === 'desolation'
        && (calls.filter(call => call.name === 'set_border_fill_type').length !== 1
            || calls.filter(call => call.name === 'set_feature_name').length !== 1
            || calls.some(call => call.name === 'set_border_fill_type'
                && !/^\s*["']endless_salt["']\s*\)\s*$/u
                    .test(call.arguments))
            || calls.some(call => call.name === 'set_feature_name'
                && !/^\s*["']granite_statue["']\s*,\s*["']ruined idol["']\s*\)\s*$/u
                    .test(call.arguments)))) {
        return false;
    }
    if (calls.some(call => call.name === 'vault_metal_statue_setup'
        && !/^\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']*["']\s*\)\s*(?:--.*)?$/u
            .test(call.arguments))) {
        return false;
    }
    if (calls.some(call => call.name === 'vault_metal_statue_setup')
        && !metalStatueHelperIsSafe(dependencies)) {
        return false;
    }
    if (calls.some(call => call.name === 'vault_granite_statue_setup'
        && !/^\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']*["']\s*\)\s*(?:--.*)?$/u
            .test(call.arguments))) {
        return false;
    }
    if (calls.some(call => call.name === 'vault_granite_statue_setup')
        && !graniteStatueHelperIsSafe(dependencies)) {
        return false;
    }
    if (calls.some(call => call.name === 'decorative_floor'
        && !/^\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*\)\s*(?:--.*)?$/u
            .test(call.arguments))) {
        return false;
    }
    if (calls.some(call => call.name === 'decorative_floor')
        && !decorativeFloorHelperIsSafe(dependencies)) {
        return false;
    }
    if (family === 'volcano'
        && calls.some(call => call.name === 'place_lake_volcanoes'
            && !/^\s*_G\s*,\s*\{\s*(?:["'][^"']+["']\s*,?\s*)+\}\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
        return false;
    }
    if (family === 'ossuary'
        && calls.some(call => call.name === 'inkwell_talisman_chance'
            && !/^\s*_G\s*,\s*["'][^"']+["'](?:\s*,\s*true\s*,\s*["'][^"']+["'])?\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
        return false;
    }
    if (family === 'bailey') {
        const twoArgumentHelpers = new Set([
            'bailey_talisman_chance',
            'easy_axe_fighter',
            'kobold_axe_returning',
            'orc_knight_with_polearm',
            'orc_warlord_with_axe',
            'orc_warrior_with_polearm',
            'orc_with_polearm'
        ]);
        if (calls.some(call => twoArgumentHelpers.has(call.name)
            && !/^\s*_G\s*,\s*["'][^"']+["']\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
            return false;
        }
        if (calls.some(call => call.name === 'hard_axe_fighter'
            && !/^\s*_G\s*,\s*["'][^"']+["'](?:\s*,\s*false)?\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
            return false;
        }
    }
    if (family === 'sewer'
        && calls.some(call => call.name === 'single_cloud'
            && !/^\s*_G\s*,\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*,\s*false\s*\)\s*(?:--.*)?$/u
                .test(call.arguments))) {
        return false;
    }
    return true;
}

function glyphsFromDirective(line) {
    const match = String(line).trim().match(
        /^(KFEAT|SUBST|NSUBST|SHUFFLE|CLEAR)\s*:\s*(.*)$/iu
    );
    if (!match) {
        return {glyphs: [], maskAll: false};
    }
    const directive = match[1].toUpperCase();
    if (directive === 'CLEAR') {
        return {glyphs: [], maskAll: true};
    }
    let leftParts;
    if (directive === 'SHUFFLE') {
        leftParts = [match[2]];
    } else {
        leftParts = match[2].split(',').map(part =>
            part.split(/[:=]/u, 1)[0]);
    }
    const glyphs = new Set();
    for (const part of leftParts) {
        for (const glyph of String(part || '').replace(/\s+/gu, '')) {
            if (!'/,:=*'.includes(glyph)) {
                glyphs.add(glyph);
            }
        }
    }
    return {glyphs: [...glyphs], maskAll: false};
}

function colonControlAction(line) {
    const value = String(line).trim();
    if (!value.startsWith(':')) {
        return null;
    }
    const lua = value.slice(1).trim();
    if (/^(?:if\b|for\b|while\b|repeat\b|do\b)/u.test(lua)) {
        return 'enter';
    }
    if (/^(?:elseif\b|else\b)/u.test(lua)) {
        return 'branch';
    }
    if (/^(?:end\b|until\b)/u.test(lua)) {
        return 'exit';
    }
    return null;
}

function conditionalIntroducedGlyphs(line) {
    const match = String(line).trim().match(
        /^(?:KFEAT|SUBST|NSUBST)\s*:\s*(.*)$/iu
    );
    const introduced = new Map();
    if (!match) {
        return introduced;
    }
    for (const assignment of match[1].split(',')) {
        const separator = assignment.search(/[:=]/u);
        if (separator < 0) {
            continue;
        }
        const left = assignment.slice(0, separator).replace(/\s+/gu, '');
        const right = assignment.slice(separator + 1);
        for (const target of ['<', '>', 'I']) {
            if (!right.includes(target)) {
                continue;
            }
            if (!introduced.has(target)) {
                introduced.set(target, new Set());
            }
            for (const source of left) {
                introduced.get(target).add(source);
            }
        }
    }
    return introduced;
}

function sanitizePortalSource(source) {
    const lines = String(source || '').split('\n');
    const masks = new Map();
    const output = [];
    let currentName = null;
    let controlDepth = 0;

    const currentMask = () => {
        if (!currentName) {
            return null;
        }
        if (!masks.has(currentName)) {
            masks.set(currentName, {
                glyphs: new Set(),
                maskAll: false,
                introducedGlyphs: new Map()
            });
        }
        return masks.get(currentName);
    };

    for (let index = 0; index < lines.length; index++) {
        let line = lines[index];
        const nameMatch = line.match(/^NAME:\s*(\S+)\s*$/u);
        if (nameMatch) {
            currentName = nameMatch[1];
            controlDepth = 0;
        }

        const action = colonControlAction(line);
        if (action === 'exit') {
            controlDepth = Math.max(0, controlDepth - 1);
        }

        const directive = line.trim().match(/^([A-Z]+)\s*:/u)?.[1] || null;
        const conditionalTerrain = controlDepth > 0
            && ['KFEAT', 'SUBST', 'NSUBST', 'SHUFFLE', 'CLEAR']
                .includes(directive);
        const subvault = directive === 'SUBVAULT';
        if (conditionalTerrain || subvault) {
            const logical = [line];
            while (/\\\s*$/u.test(logical[logical.length - 1])
                && index + 1 < lines.length) {
                logical.push(lines[++index]);
            }
            const mask = currentMask();
            if (mask) {
                if (subvault) {
                    const glyph = logical.join(' ').match(
                        /^\s*SUBVAULT\s*:\s*(\S+)\s*:/u
                    )?.[1];
                    for (const value of String(glyph || '')) {
                        mask.glyphs.add(value);
                    }
                } else {
                    const affected = glyphsFromDirective(logical.join(' '));
                    mask.maskAll ||= affected.maskAll;
                    for (const glyph of affected.glyphs) {
                        mask.glyphs.add(glyph);
                    }
                    for (const [target, sources] of conditionalIntroducedGlyphs(
                        logical.join(' ')
                    )) {
                        if (!mask.introducedGlyphs.has(target)) {
                            mask.introducedGlyphs.set(target, new Set());
                        }
                        for (const source of sources) {
                            mask.introducedGlyphs.get(target).add(source);
                        }
                    }
                }
            }
            output.push(...logical.map(() => ''));
        } else if (line.trim().startsWith(':')) {
            // Embedded Lua is never evaluated. Terrain-affecting helpers are
            // restored below only after an exact source audit.
            output.push('');
        } else {
            output.push(line);
        }

        if (action === 'enter') {
            controlDepth++;
        }
    }
    return {source: output.join('\n'), masks};
}

function stripEmbeddedLua(source) {
    return String(source || '').replace(/\{\{[\s\S]*?\}\}/gu, block =>
        block.replace(/[^\n]/gu, ' '));
}

function replaceKind(cell, previousKind, nextKind) {
    if (!cell || !Array.isArray(cell.kinds)) {
        return cell;
    }
    const kinds = [...new Set(cell.kinds.map(kind =>
        kind === previousKind ? nextKind : kind))];
    return {
        ...cell,
        kinds,
        certain: kinds.length === 1 && kinds[0] !== 'unknown'
    };
}

function applyIntroducedGlyphs(grid, introducedGlyphs) {
    if (!(introducedGlyphs instanceof Map) || !introducedGlyphs.size) {
        return grid;
    }
    return grid.map(row => row.map(cell => {
        if (!cell) {
            return cell;
        }
        const possible = new Set(Array.isArray(cell.possibleGlyphs)
            ? cell.possibleGlyphs
            : [cell.glyph]);
        for (const [target, sources] of introducedGlyphs) {
            if ([...possible].some(glyph => sources.has(glyph))) {
                possible.add(target);
            }
        }
        return possible.size === (cell.possibleGlyphs?.length || 1)
            ? cell
            : {...cell, possibleGlyphs: [...possible], certain: false};
    }));
}

function replaceGlyphKind(grid, glyph, previousKind, nextKind) {
    return grid.map(row => row.map(cell => {
        const possibleGlyphs = Array.isArray(cell?.possibleGlyphs)
            ? [...new Set(cell.possibleGlyphs)]
            : cell?.glyph == null ? [] : [cell.glyph];
        if (!possibleGlyphs.includes(glyph)) {
            return cell;
        }
        if (possibleGlyphs.length > 1) {
            return {
                ...cell,
                kinds: [...new Set([...(cell.kinds || []), nextKind])],
                certain: false
            };
        }
        return replaceKind(cell, previousKind, nextKind);
    }));
}

function setGlyphKind(grid, glyph, kind) {
    return grid.map(row => row.map(cell => {
        const possibleGlyphs = Array.isArray(cell?.possibleGlyphs)
            ? [...new Set(cell.possibleGlyphs)]
            : cell?.glyph == null ? [] : [cell.glyph];
        if (!possibleGlyphs.includes(glyph)) {
            return cell;
        }
        if (possibleGlyphs.length > 1) {
            return {
                ...cell,
                kinds: [...new Set([...(cell.kinds || []), kind])],
                certain: false
            };
        }
        return {...cell, kinds: [kind], certain: true};
    }));
}

function maskGrid(grid, mask) {
    if (!mask || (!mask.maskAll && mask.glyphs.size === 0)) {
        return grid;
    }
    return grid.map(row => row.map(cell => {
        const affected = mask.maskAll || mask.glyphs.has(cell?.glyph)
            || cell?.possibleGlyphs?.some(glyph => mask.glyphs.has(glyph));
        return affected ? {...cell, kinds: [], certain: false} : cell;
    }));
}

function blockForMap(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const remainder = String(source).slice(start + 1);
    const next = /\nNAME:\s*/u.exec(remainder);
    return String(source).slice(start, next ? start + 1 + next.index : undefined);
}

function applyCommonTerrain(template, spec) {
    let grid = template.grid;
    for (const glyph of spec.portalGlyphs || []) {
        grid = replaceGlyphKind(grid, glyph, 'stairs', 'portal');
        grid = replaceGlyphKind(grid, glyph, 'statue', 'portal');
        grid = replaceGlyphKind(grid, glyph, 'floor', 'portal');
    }
    for (const glyph of spec.floorGlyphs || []) {
        grid = replaceGlyphKind(grid, glyph, 'stairs', 'floor');
    }
    return grid;
}

function applyIceTerrain(template, block) {
    let grid = template.grid;
    for (const match of String(block || '').matchAll(
        /^\s*:\s*vault_metal_statue_setup\s*\(\s*_G\s*,\s*["']([^"']+)["']/gmu
    )) {
        for (const glyph of match[1]) {
            grid = setGlyphKind(grid, glyph, 'statue');
        }
    }
    return grid;
}

function applyVolcanoTerrain(template, block, mask) {
    let grid = template.grid;
    mask.glyphs.add('L');
    mask.glyphs.add('y');
    if (/^\s*:\s*place_(?:large|chained|small|tiny)_volcano\s*\(\s*_G\s*\)/mu
        .test(String(block || ''))) {
        grid = setGlyphKind(grid, 'V', 'lava');
    }
    const lakeCall = String(block || '').match(
        /^\s*:\s*place_lake_volcanoes\s*\(\s*_G\s*,\s*\{([^}]*)\}\s*\)/mu
    );
    if (lakeCall) {
        for (const glyph of [...lakeCall[1].matchAll(/["']([^"']+)["']/gu)]
            .map(match => match[1])) {
            grid = setGlyphKind(grid, glyph, 'lava');
        }
    }
    for (const match of String(block || '').matchAll(
        /^\s*:\s*vault_metal_statue_setup\s*\(\s*_G\s*,\s*["']([^"']+)["']/gmu
    )) {
        for (const glyph of match[1]) {
            grid = setGlyphKind(grid, glyph, 'statue');
        }
    }
    return grid;
}

function applyDependencyTerrain(template, block) {
    let grid = template.grid;
    for (const helper of [
        'vault_granite_statue_setup',
        'vault_metal_statue_setup'
    ]) {
        const escaped = helper.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        for (const match of String(block || '').matchAll(new RegExp(
            `^\\s*:\\s*${escaped}\\s*\\(\\s*_G\\s*,\\s*["']([^"']+)["']`,
            'gmu'
        ))) {
            for (const glyph of match[1]) {
                grid = setGlyphKind(grid, glyph, 'statue');
            }
        }
    }
    for (const match of String(block || '').matchAll(
        /^\s*:\s*decorative_floor\s*\(\s*_G\s*,\s*["']([^"']+)["']/gmu
    )) {
        for (const glyph of match[1]) {
            grid = setGlyphKind(grid, glyph, 'floor');
        }
    }
    return grid;
}

function hasPossibleGlyph(template, glyph) {
    return template.grid.some(row => row.some(cell => {
        const finalGlyphs = Array.isArray(cell?.possibleGlyphs)
            ? cell.possibleGlyphs
            : [cell?.glyph];
        return finalGlyphs.includes(glyph);
    }));
}

function candidateFromTemplate(template, original, family, spec, source,
    mask, audited) {
    const block = blockForMap(source, original.name);
    let grid = applyIntroducedGlyphs(template.grid, mask.introducedGlyphs);
    grid = applyCommonTerrain({...template, grid}, spec);
    if (family === 'icecave' && audited) {
        grid = applyIceTerrain({...template, grid}, block);
    } else if (family === 'volcano' && audited) {
        grid = applyVolcanoTerrain({...template, grid}, block, mask);
    }
    if (audited) {
        grid = applyDependencyTerrain({...template, grid}, block);
    }
    grid = maskGrid(grid, mask);
    grid = materializeAuditedEncompassWallFill(original, block, {
        grid,
        // A whole-map terrain mutation, or one explicitly targeting the raw
        // space glyph, owns the base cells and cannot use reset-wall inference.
        audited: audited && !mask.maskAll && !mask.glyphs.has(' ')
    });

    const entryGlyphs = spec.entryGlyphs.filter(glyph =>
        hasPossibleGlyph({...template, grid}, glyph));
    const revealable = spec.revealable === true && audited;
    const forceable = (spec.revealable === true || spec.forceable === true)
        && audited;
    return {
        ...template,
        path: original.path || template.path,
        grid,
        metadata: {
            ...template.metadata,
            tags: [...templateTags(original)],
            place: null,
            depth: null,
            orient: original.metadata?.orient || 'encompass',
            encompass: true,
            parseWarnings: [],
            ...(entryGlyphs.length === 1
                ? {entryAnchorGlyph: entryGlyphs[0]}
                : entryGlyphs.length > 1
                    ? {entryAnchorGlyphs: entryGlyphs}
                    : {}),
            ...(entryGlyphs.length
                ? {entryAnchorObservedKind: 'floor'}
                : {}),
            sourceAudit: revealable
                ? `portal-${family}-coarse-terrain-v1`
                : forceable
                    ? `portal-${family}-known-shell-force-v1`
                    : `portal-${family}-detection-only-v1`,
            matchPolicy: revealable
                ? {...REVEAL_MATCH_POLICY}
                : forceable
                    ? {...FORCE_ONLY_MATCH_POLICY}
                    : {...DETECTION_MATCH_POLICY}
        }
    };
}

export function parsePortalDestinationTemplates(source, parsed, options = {}) {
    const entry = specEntry(options.path);
    if (!entry) {
        return [];
    }
    const [family, spec] = entry;
    if (spec.externalAudit) {
        return [];
    }
    const natural = naturalPortalDestinationTemplates(parsed, options.path);
    if (!natural.length) {
        return [];
    }

    const sanitized = sanitizePortalSource(family === 'trove'
        ? stripEmbeddedLua(source)
        : source);
    const sanitizedByName = new Map(parseDes(sanitized.source, options)
        .map(template => [template.name, template]));
    const helpersAudited = {
        arena: () => arenaHelpersAreSafe(source),
        desolation: () => true,
        sewer: () => sewerHelpersAreSafe(source),
        ossuary: () => ossuaryHelpersAreSafe(source),
        bailey: () => baileyHelpersAreSafe(source),
        bazaar: () => bazaarHelpersAreSafe(source),
        icecave: () => iceHelpersAreSafe(source, options.dependencies),
        volcano: () => volcanoHelpersAreSafe(source, options.dependencies)
    }[family]?.() === true;

    return natural.map(original => {
        const template = sanitizedByName.get(original.name) || original;
        const mask = sanitized.masks.get(original.name)
            || {
                glyphs: new Set(),
                maskAll: false,
                introducedGlyphs: new Map()
            };
        const block = blockForMap(source, original.name);
        const troveAudited = family === 'trove'
            && troveCandidateIsTerrainSafe(
                source,
                block,
                options.dependencies
            );
        const audited = family === 'trove'
            ? troveAudited
            : helpersAudited
                && !(template.metadata?.parseWarnings || []).length
                && portalMapCallsAreSafe(
                    family,
                    block,
                    options.dependencies
                );
        if (troveAudited) {
            for (const glyph of troveDynamicTerrainGlyphs(block)) {
                mask.glyphs.add(glyph);
            }
        }
        return candidateFromTemplate(
            template,
            original,
            family,
            spec,
            source,
            mask,
            audited
        );
    });
}

export function portalDestinationCoverage(
    source,
    options = {},
    runtimeTemplates = [],
    selectedTemplates = runtimeTemplates
) {
    const entry = specEntry(options.path);
    if (!entry) {
        return null;
    }
    const [family, spec] = entry;
    const parsed = options.parsed || parseDes(source, options);
    const natural = naturalPortalDestinationTemplates(parsed, options.path);
    const names = new Set(natural.map(template => template.name));
    const naturalBlocks = natural.map(template => ({
        template,
        block: blockForMap(source, template.name) || ''
    }));
    const mapHelperCalls = [...new Set(naturalBlocks.flatMap(({block}) =>
        [...block.matchAll(/^\s*:\s*([A-Za-z_]\w*)\s*\(/gmu)]
            .map(match => match[1])))].sort();
    const sourceConstructs = Object.freeze({
        mapLuaCandidateCount: naturalBlocks.filter(({block}) =>
            /\{\{/u.test(block)).length,
        subvaultCandidateCount: naturalBlocks.filter(({block}) =>
            /^\s*SUBVAULT\s*:/mu.test(block)
            || /\bsubvault\s*\(/u.test(block)).length,
        conditionalTerrainCandidateCount: naturalBlocks.filter(({template}) =>
            (template.metadata?.parseWarnings || []).some(warning =>
                /directive appears inside Lua control flow/u.test(warning)))
            .length
    });
    const countNames = templates => new Set((templates || [])
        .filter(template => names.has(template?.name))
        .map(template => template.name)).size;
    const naturalRuntime = (runtimeTemplates || []).filter(template =>
        names.has(template?.name));
    const runtimeCount = countNames(runtimeTemplates);
    const selectedCount = countNames(selectedTemplates);
    const revealableCount = naturalRuntime.filter(template =>
        template.metadata?.matchPolicy?.revealDisabled !== true).length;
    const forceOnlyCount = naturalRuntime.filter(template =>
        template.metadata?.matchPolicy?.revealDisabled === true
        && template.metadata?.matchPolicy?.forceRevealDisabled !== true).length;
    const detectionOnlyCount = runtimeCount
        - revealableCount
        - forceOnlyCount;
    return Object.freeze({
        family,
        path: options.path,
        externalAudit: spec.externalAudit === true,
        rawNaturalCount: natural.length,
        parseRuntimeCandidateCount: runtimeCount,
        selectedCount,
        revealableCount,
        forceOnlyCount,
        detectionOnlyCount,
        mapHelperCalls: Object.freeze(mapHelperCalls),
        sourceConstructs,
        complete: natural.length === runtimeCount
            && natural.length === selectedCount
    });
}

export default parsePortalDestinationTemplates;
