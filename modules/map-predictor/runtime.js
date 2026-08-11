import {parseDes} from './des-parser.js';
import {materializeAuditedEncompassWallFill} from './encompass-fill.js';
import MapMatcher from './matcher.js';
import SourceRepository from './source-repository.js';
import {normalizeWebtilesKnowledgeUpdates} from './terrain-normalizer.js';
import WebtilesAdapter from './webtiles-adapter.js';
import MatcherWorkerClient from './worker-client.js';
import {parsePortalDestinationTemplates} from './portal-destinations.js';
import {auditedTempleDestinationTemplates} from './temple-destinations.js';
import {
    auditedSprintDestinationTemplates,
    selectAuditedSprintCatalog
} from './sprint-destinations.js';
import {
    auditedZigguratTemplates,
    materializeZigguratTemplates
} from './ziggurat-destinations.js';
import {
    auditedBranchEndFamilyTemplates,
    auditedElfBladesTemplates,
    auditedElfEndTemplates,
    auditedHellVestibuleTemplates,
    auditedShoalsEndTemplates,
    naturalBranchEndPrimaries
} from './branch-end-destinations.js';

export const PARSER_VERSION = 'des-runtime-v22';
const EVALUATION_DELAY_MS = 140;
// The exact Temple closed set is 94 maps (53 revealable layouts plus 41
// detection-only negatives). Keep the worker as the preferred path, while
// allowing that audited catalog through the synchronous fallback. The small
// headroom is intentional: unexpected source growth still fails closed until
// its inventory and matcher cost are audited.
const DEFAULT_MAX_TEMPLATES = 112;
const DEFAULT_SYNC_MAX_TEMPLATES = 96;
const MODULE_NAME = 'MapPredictor';
const RC_HANDLER_ID = 'map-predictor-rc';
const HOTKEY_CODE = 'KeyM';

const PAN_LORDS = Object.freeze({
    Mnoleg: 'mnoleg',
    'Lom Lobon': 'lom_lobon',
    Cerebov: 'cerebov',
    'Gloorx Vloq': 'gloorx_vloq'
});

const WIZLAB_PATH_SUFFIX = '/dat/des/portals/wizlab.des';

const WIZLAB_TERRAIN_HELPERS = Object.freeze({
    vault_granite_statue_setup: Object.freeze({
        feature: 'granite_statue',
        methods: Object.freeze({
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
    }),
    vault_metal_statue_setup: Object.freeze({
        feature: 'metal_statue',
        methods: Object.freeze({
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
    }),
    decorative_floor: Object.freeze({
        feature: 'decorative_floor',
        methods: Object.freeze({
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
    })
});

const WIZLAB_DETECTION_MATCH_POLICY = Object.freeze({
    // A dynamically generated WizLab still has to compete with every map
    // which can be revealed. This prevents an unsupported laboratory from
    // being forced into the nearest warning-free layout. Its coarse fixed
    // skeleton is diagnostic-only, however, so neither normal nor forced
    // reveal may inject terrain from it.
    revealDisabled: true,
    forceRevealDisabled: true
});

const PAN_LORD_HELPER_WARNINGS = new Set([
    'Lua helper pan_lord_setup is not statically safe: unsupported hook()',
    'Lua helper pan_lord_setup is not statically safe: unsupported kitem()',
    'Lua helper pan_lord_setup is not statically safe: unsupported kmons()',
    'Lua helper pan_lord_setup is not statically safe: unsupported nsubst()',
    'Lua helper pan_lord_setup is not statically safe: unsupported subst()'
]);

const PAN_LORD_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.15,
    minSpanXRatio: 0.35,
    minSpanYRatio: 0.35,
    requiredKinds: ['wall', 'floor'],
    // Pan lord rooms are floating partial vaults. Exhaustively score every
    // legal translation so moving outside the room cannot discard the true
    // placement or make a sampled reflected placement look uniquely best.
    exhaustivePlacement: true,
    // Detection and /force_reveal diagnostics use the exhaustive result, but
    // normal reveal remains disabled until partial-vault consensus has a
    // proof that under-evidence placements cannot contradict it.
    revealDisabled: true
});

const BRANCH_END_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.06,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.25,
    requiredKinds: ['wall', 'floor']
});

const VAULTS_QUADRANT_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.18,
    minSpanXRatio: 0.45,
    minSpanYRatio: 0.45,
    requiredKinds: ['wall', 'floor'],
    requireFocusInFootprint: true
});

// Once a quadrant is placed in the audited Vaults:5 master shell its
// position is no longer floating, so the player's current square need not be
// inside that quadrant. The matcher still requires broad evidence before it
// eliminates any alternative from that fixed slot.
const VAULTS_COMPOSITE_QUADRANT_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.18,
    minSpanXRatio: 0.45,
    minSpanYRatio: 0.45,
    requiredKinds: ['wall', 'floor']
});

const TOMB_COMPOSITE_SUBVAULT_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    minEvidenceCells: 48,
    minEvidenceWeight: 56,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor']
});

const TOMB_MASTER_WARNINGS = Object.freeze({
    tomb_1: Object.freeze([
        'SUBVAULT directives are not statically supported',
        'SUBST directive appears inside Lua control flow',
        'Lua helper vault_granite_statue_setup is called conditionally',
        'Unknown Lua helper vault_granite_statue_setup(_G)'
    ]),
    tomb_2: Object.freeze([
        'SUBVAULT directives are not statically supported'
    ]),
    tomb_3: Object.freeze([
        'SUBVAULT directives are not statically supported'
    ])
});

const TOMB_COMPONENTS = Object.freeze({
    tomb_1_centre: Object.freeze({
        width: 33,
        height: 20,
        names: Object.freeze([
            'tomb_1_centre_old',
            'tomb_1_centre_grunt_parallel',
            'tomb_1_centre_grunt_layered',
            'tomb_1_centre_nicolae_necropolis'
        ]),
        warnings: Object.freeze([
            'Lua helper tomb_1_centre_setup is not statically safe: unsupported subst()',
            'Lua helper tomb_1_centre_setup is not statically safe: unsupported lua_marker()'
        ])
    }),
    tomb_1_hall_stairs: Object.freeze({
        width: 39,
        height: 12,
        names: Object.freeze([
            'tomb_1_hall_stairs_old',
            'tomb_1_hall_stairs_grunt_patterns',
            'tomb_1_hall_stairs_grunt_snakey',
            'tomb_1_hall_stairs_nicolae_cartouches',
            'tomb_1_hall_stairs_nicolae_galleries'
        ]),
        warnings: Object.freeze([
            'Lua helper tomb_1_stairs_setup is not statically safe: unsupported lua_marker()',
            'Lua helper tomb_1_stairs_setup is not statically safe: unsupported subst()'
        ])
    }),
    tomb_2_ambush: Object.freeze({
        width: 29,
        height: 22,
        names: Object.freeze([
            'tomb_2_ambush_old',
            'tomb_2_ambush_grunt_patterns',
            'tomb_2_ambush_grunt_arcs',
            'tomb_2_ambush_grunt_hexed'
        ]),
        warnings: Object.freeze([
            'Lua helper tomb_2_ambush_setup is not statically safe: unsupported lua_marker()',
            'Lua helper tomb_2_ambush_setup is not statically safe: unsupported subst()',
            'Lua helper tomb_2_ambush_setup is not statically safe: unsupported nsubst()'
        ])
    }),
    tomb_3_rune: Object.freeze({
        width: 41,
        height: 20,
        names: Object.freeze([
            'tomb_3_rune_old',
            'tomb_3_rune_grunt_curves',
            'tomb_3_rune_grunt_snapback',
            'tomb_3_rune_grunt_layered',
            'tomb_3_rune_grunt_doroklohe'
        ]),
        warnings: Object.freeze([
            'Lua helper tomb_3_rune_setup is not statically safe: unsupported kmask()',
            'Lua helper tomb_3_rune_setup is not statically safe: unsupported kitem()',
            'Lua helper tomb_3_rune_setup is not statically safe: unsupported subst()'
        ])
    })
});

const TOMB_COMPONENT_DIRECTIVES = Object.freeze({
    tomb_1_centre_old: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 1, SUBST: 2, NSUBST: 1
    }),
    tomb_1_centre_grunt_parallel: Object.freeze({
        NAME: 1, TAGS: 1, TILE: 2, COLOUR: 1, SUBST: 2, NSUBST: 1
    }),
    tomb_1_centre_grunt_layered: Object.freeze({
        NAME: 1, TAGS: 1, TILE: 2, COLOUR: 1, SUBST: 3,
        SHUFFLE: 2, NSUBST: 1
    }),
    tomb_1_centre_nicolae_necropolis: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 2, SUBST: 3
    }),
    tomb_1_hall_stairs_old: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 1, SUBST: 2
    }),
    tomb_1_hall_stairs_grunt_patterns: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 3, SUBST: 2, NSUBST: 1
    }),
    tomb_1_hall_stairs_grunt_snakey: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 1, SUBST: 2
    }),
    tomb_1_hall_stairs_nicolae_cartouches: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 1, SUBST: 2
    }),
    tomb_1_hall_stairs_nicolae_galleries: Object.freeze({
        NAME: 1, TAGS: 1, SHUFFLE: 1, SUBST: 1
    }),
    tomb_2_ambush_old: Object.freeze({NAME: 1, TAGS: 1, MONS: 1}),
    tomb_2_ambush_grunt_patterns: Object.freeze({
        NAME: 1, TAGS: 1, MONS: 1, SHUFFLE: 1, SUBST: 1
    }),
    tomb_2_ambush_grunt_arcs: Object.freeze({NAME: 1, TAGS: 1, MONS: 1}),
    tomb_2_ambush_grunt_hexed: Object.freeze({NAME: 1, TAGS: 1, MONS: 1}),
    tomb_3_rune_old: Object.freeze({NAME: 1, TAGS: 1}),
    tomb_3_rune_grunt_curves: Object.freeze({NAME: 1, TAGS: 1}),
    tomb_3_rune_grunt_snapback: Object.freeze({NAME: 1, TAGS: 1}),
    tomb_3_rune_grunt_layered: Object.freeze({NAME: 1, TAGS: 1}),
    tomb_3_rune_grunt_doroklohe: Object.freeze({
        NAME: 1, TAGS: 1, KMONS: 1, NSUBST: 1
    })
});

const ZOT_END_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.4,
    requiredKinds: ['wall', 'floor'],
    // hall_of_Zot is edge-oriented, so every legal translation of every
    // mirror can be enumerated exactly. The player arrives in the generated
    // area south of the hall and need not stand inside its 80x36 footprint.
    exhaustivePlacement: true,
    // Exhaustive enumeration alone is not sufficient for an unanchored
    // partial vault: a still-unseen true placement can have no evidence while
    // procedural terrain outside it makes a shifted placement look perfect.
    // Keep the exact best placement available to the explicitly unsafe force
    // command, but do not treat under-evidence placements as disproven.
    revealDisabled: true
});

const DEPTHS_ZOT_ENTRY_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.18,
    minSpanXRatio: 0.4,
    minSpanYRatio: 0.4,
    requiredKinds: ['wall', 'floor'],
    requireFocusInFootprint: true
});

const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';

const HELL_END_FAMILIES = Object.freeze({
    '/branches/dis.des': {
        place: 'Dis:$',
        setup: 'dis_setup',
        setupMethods: {
            place: 1,
            tags: 1,
            kitem: 1,
            set_feature_name: 1
        },
        setupTags: ['dis', 'no_rotate'],
        names: ['dis_st', 'dis_hangedman', 'dis_grunt_layers'],
        calls: ['serpent_of_hell_setup', 'dis_setup', 'dis_rune',
            'vault_metal_statue_setup'],
        tags: ['no_rotate'],
        revealDisabled: true,
        warnings: [
            'Unknown Lua helper serpent_of_hell_setup(_G)',
            'Lua helper dis_setup is not statically safe: dynamic tags()',
            'Lua helper dis_setup is not statically safe: unsupported kitem()',
            'Lua helper dis_rune is not statically safe: unsupported kmask()',
            'Lua helper dis_rune is not statically safe: unsupported kitem()',
            'Unknown Lua helper vault_metal_statue_setup(_G)'
        ]
    },
    '/branches/geh.des': {
        place: 'Geh:$',
        setup: 'geh_setup',
        setupMethods: {
            place: 1,
            kmask: 1,
            kitem: 1,
            lrockcol: 1,
            lfloorcol: 1,
            lfloortile: 1,
            colour: 1,
            set_feature_name: 2
        },
        names: ['geh_old', 'geh_mu', 'evilmike_geh', 'geh_grunt',
            'lightli_geh_unto_the_cruel', 'geh_hangedman',
            'geh_grunt_pentagon'],
        calls: ['serpent_of_hell_setup', 'geh_setup'],
        tags: [],
        revealDisabled: false,
        warnings: [
            'Unknown Lua helper serpent_of_hell_setup(_G)',
            'Lua helper geh_setup is not statically safe: unsupported kmask()',
            'Lua helper geh_setup is not statically safe: unsupported kitem()'
        ]
    },
    '/branches/coc.des': {
        place: 'Coc:$',
        setup: 'coc_setup',
        setupMethods: {
            place: 1,
            tags: 1,
            kitem: 2,
            kmask: 1,
            lrockcol: 1,
            lfloorcol: 1,
            lfloortile: 1,
            colour: 1,
            set_feature_name: 3
        },
        setupTags: ['no_rotate'],
        names: ['coc_dpeg', 'coc_old', 'coc_mu', 'coc_grunt',
            'coc_hangedman'],
        calls: ['serpent_of_hell_setup', 'coc_setup'],
        tags: ['no_rotate'],
        revealDisabled: true,
        warnings: [
            'Unknown Lua helper serpent_of_hell_setup(_G)',
            'Lua helper coc_setup is not statically safe: unsupported kitem()',
            'Lua helper coc_setup is not statically safe: unsupported kmask()'
        ]
    },
    '/branches/tar.des': {
        place: 'Tar:$',
        setup: 'tar_setup',
        setupMethods: {
            place: 1,
            tags: 1,
            kmask: 1,
            kitem: 1
        },
        setupTags: ['no_rotate'],
        // tar_mu and tar_grunt are composites whose generated maze/subvault
        // cells are intentionally left unsupported.
        names: ['tar_old', 'tar_minmay_river', 'tar_grunt_cathedral'],
        calls: ['serpent_of_hell_setup', 'tar_setup'],
        tags: ['no_rotate'],
        revealDisabled: true,
        warnings: [
            'Unknown Lua helper serpent_of_hell_setup(_G)',
            'Lua helper tar_setup is not statically safe: unsupported kmask()',
            'Lua helper tar_setup is not statically safe: unsupported kitem()'
        ]
    }
});

const VAULTS_QUADRANT_WARNINGS = Object.freeze([
    'Lua helper vaults_end_loot is not statically safe: unsupported subst()',
    'Lua helper vaults_end_loot is not statically safe: unsupported nsubst()',
    'Lua helper vaults_end_rune is not statically safe: unsupported subvault()',
    'Lua helper vaults_end_rune is not statically safe: unsupported subst()'
]);

const SLIME_END_WARNINGS = Object.freeze([
    'Lua helper setup_slime_pit_ending is not statically safe: unsupported kitem()',
    'Lua helper setup_slime_pit_ending is not statically safe: unsupported lua_marker()',
    'Lua helper setup_slime_pit_ending is not statically safe: unsupported kmask()',
    'Lua helper setup_slime_pit_ending is not statically safe: unsupported shuffle()'
]);

const ZOT_END_WARNINGS = Object.freeze([
    'NSUBST directive appears inside Lua control flow',
    'SUBST directive appears inside Lua control flow',
    'Direct Lua kfeat() call is not statically supported'
]);

const SERPENT_OF_HELL_METHODS = Object.freeze({kmons: 1});
const DIS_RUNE_METHODS = Object.freeze({kmask: 1, kitem: 1});
const METAL_STATUE_METHODS = Object.freeze({
    kfeat: 1,
    colour: 1,
    tile: 1,
    set_feature_name: 1
});
const VAULTS_END_LOOT_METHODS = Object.freeze({subst: 5, nsubst: 1});
const VAULTS_END_RUNE_METHODS = Object.freeze({
    has_tag: 2,
    subvault: 3,
    subst: 1
});
const SLIME_END_HELPER_METHODS = Object.freeze({
    place: 1,
    orient: 1,
    mons: 3,
    kfeat: 1,
    kitem: 3,
    tile: 1,
    lua_marker: 2,
    kmask: 1,
    kprop: 2,
    shuffle: 1,
    set_feature_name: 2
});
const ZOT_ENTRY_HELPER_METHODS = Object.freeze({
    tags: 1,
    place: 1,
    orient: 1,
    kitem: 1,
    kfeat: 2,
    kmask: 1,
    mons: 3,
    kmons: 2
});
const PAN_LORD_HELPER_METHODS = Object.freeze({
    tags: 1,
    set_random_mon_list: 1,
    lfloorcol: 4,
    lrockcol: 4,
    lfloortile: 4,
    lrocktile: 4,
    tile: 5,
    kitem: 4,
    kmons: 4,
    nsubst: 1,
    subst: 1,
    hook: 1
});
const TOMB_TERRAIN_HELPER_METHODS = Object.freeze({
    tomb_trap_set: Object.freeze({kfeat: 1}),
    tomb_1_centre_setup: Object.freeze({
        kfeat: 1,
        subst: 1,
        lua_marker: 2
    }),
    tomb_1_stairs_setup: Object.freeze({
        lua_marker: 3,
        subst: 4
    }),
    tomb_2_ambush_setup: Object.freeze({
        lua_marker: 3,
        subst: 2,
        nsubst: 1
    }),
    tomb_3_khufu: Object.freeze({kmons: 1}),
    tomb_3_rune_setup: Object.freeze({
        kmask: 1,
        kitem: 2,
        subst: 1
    })
});

const BRANCH_ALIASES = {
    d: 'dungeon',
    dungeon: 'dungeon',
    temple: 'temple',
    orc: 'orc',
    'orcish mines': 'orc',
    elf: 'elf',
    'elven halls': 'elf',
    lair: 'lair',
    swamp: 'swamp',
    shoals: 'shoals',
    snake: 'snake',
    'snake pit': 'snake',
    spider: 'spider',
    'spider nest': 'spider',
    slime: 'slime',
    'slime pits': 'slime',
    vaults: 'vaults',
    crypt: 'crypt',
    tomb: 'tomb',
    depths: 'depths',
    hell: 'hell',
    dis: 'dis',
    geh: 'geh',
    gehenna: 'geh',
    coc: 'coc',
    cocytus: 'coc',
    tar: 'tar',
    tartarus: 'tar',
    zot: 'zot',
    abyss: 'abyss',
    pan: 'pan',
    pandemonium: 'pan',
    wizlab: 'wizlab',
    'wizard laboratory': 'wizlab'
};

// Official 0.34+ finite branch lengths. Unknown or variable branches never
// satisfy `$`; that is safer than treating every floor as a branch end.
const BRANCH_END_DEPTHS = {
    dungeon: 15,
    temple: 1,
    orc: 2,
    elf: 3,
    lair: 5,
    swamp: 4,
    shoals: 4,
    snake: 4,
    spider: 4,
    slime: 5,
    vaults: 5,
    crypt: 3,
    tomb: 3,
    depths: 4,
    hell: 1,
    dis: 7,
    geh: 7,
    coc: 7,
    tar: 7,
    zot: 5
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function numericOption(value, minimum, maximum) {
    return Number.isFinite(value) && value >= minimum && value <= maximum
        ? value
        : undefined;
}

function readMatcherOptions(storage = globalThis.localStorage) {
    let configured = {};
    try {
        configured = JSON.parse(storage?.DWEM_MAP_PREDICTOR || '{}');
    } catch (error) {
        configured = {};
    }

    return Object.fromEntries(Object.entries({
        minScore: numericOption(configured.minScore, 0.8, 1),
        minEvidenceCells: numericOption(configured.minEvidenceCells, 4, 5000),
        minEvidenceWeight: numericOption(configured.minEvidenceWeight, 4, 10000),
        minDistinctKinds: numericOption(configured.minDistinctKinds, 1, 20),
        minWinnerMargin: numericOption(configured.minWinnerMargin, 0, 1),
        candidateSlack: numericOption(configured.candidateSlack, 0, 1),
        minPredictedCells: numericOption(configured.minPredictedCells, 1, 5600)
    }).filter(([, value]) => value !== undefined));
}

function templateTags(template) {
    const tags = template?.metadata?.tags ?? template?.tags ?? [];
    return new Set(Array.isArray(tags)
        ? tags
        : String(tags || '').split(/\s+/).filter(Boolean));
}

function templateHasPossibleGlyph(template, glyph) {
    if (typeof glyph !== 'string' || !glyph.length
        || !Array.isArray(template?.grid)) {
        return false;
    }
    return template.grid.some(row => Array.isArray(row) && row.some(cell => {
        const finalGlyphs = Array.isArray(cell?.possibleGlyphs)
            ? cell.possibleGlyphs
            : [cell?.glyph];
        return finalGlyphs.includes(glyph);
    }));
}

function addWizlabEntryAnchors(templates, path) {
    if (!String(path || '').endsWith(WIZLAB_PATH_SUFFIX)) {
        return templates;
    }
    return templates.map(template => {
        if (!String(template?.name || '').startsWith('wizlab_')
            || !template?.metadata?.encompass
            || !templateHasPossibleGlyph(template, 'A')) {
            return template;
        }
        return {
            ...template,
            metadata: {
                ...template.metadata,
                // Disconnected portal destinations place the arriving player
                // on a stone arch. In Wizlabs that arch is the final `A`
                // glyph; `<` is the exit and is elsewhere. Multiple possible
                // A positions (for example Eringya after NSUBST) are kept so
                // matching resolves them from terrain without guessing.
                entryAnchorGlyph: 'A',
                entryAnchorObservedKind: 'floor'
            }
        };
    });
}

function normalizeBranch(value) {
    const normalized = String(value || '').trim().toLowerCase()
        .replace(/^(?:the|an?)\s+/u, '');
    return BRANCH_ALIASES[normalized] || normalized;
}

function selectorTermMatches(term, player) {
    const match = term.match(/^([^:]+?)(?::(\$|\d+|\d+-|\d+-\d+|-\d+))?$/u);
    if (!match) {
        return null;
    }
    const branch = normalizeBranch(match[1]);
    const playerBranch = normalizeBranch(String(player?.place || '').split(':', 1)[0]);
    if (!branch || branch !== playerBranch) {
        return false;
    }
    if (!match[2]) {
        return true;
    }

    const depth = Number(player?.depth);
    if (!Number.isInteger(depth) || depth < 0) {
        return null;
    }
    const range = match[2];
    if (range === '$') {
        return BRANCH_END_DEPTHS[branch] !== undefined
            ? depth === BRANCH_END_DEPTHS[branch]
            : null;
    }
    if (/^\d+$/u.test(range)) {
        return depth === Number(range);
    }
    if (/^\d+-$/u.test(range)) {
        return depth >= Number(range.slice(0, -1));
    }
    if (/^-\d+$/u.test(range)) {
        return depth <= Number(range.slice(1));
    }
    const bounds = range.match(/^(\d+)-(\d+)$/u);
    return bounds ? depth >= Number(bounds[1]) && depth <= Number(bounds[2]) : null;
}

function selectorMatches(selector, player) {
    if (!selector) {
        return true;
    }
    const terms = String(selector).split(',').map(term => term.trim()).filter(Boolean);
    if (!terms.length) {
        return false;
    }
    const positives = [];
    const negatives = [];
    for (const rawTerm of terms) {
        const negative = rawTerm.startsWith('!');
        const term = negative ? rawTerm.slice(1).trim() : rawTerm;
        const result = selectorTermMatches(term, player);
        if (result === null) {
            return false;
        }
        (negative ? negatives : positives).push(result);
    }
    return (positives.length === 0 || positives.some(Boolean))
        && !negatives.some(Boolean);
}

function partialPresenceMatches(metadata, player, signals) {
    const presenceKey = metadata?.presenceKey;
    if (typeof presenceKey !== 'string' || !presenceKey) {
        return false;
    }
    if (presenceKey.startsWith('place:')) {
        return Boolean(player)
            && selectorMatches(presenceKey.slice('place:'.length), player);
    }
    return presenceKey === signals?.presenceKey;
}

/**
 * Map prediction deliberately starts with full-level, non-overwritable
 * maps. Partial vaults and procedural layouts cannot safely predict the cells
 * outside their fixed footprint from WebTiles data alone.
 */
export function selectSafeTemplates(templates, player = null, signals = {}) {
    if (signals?.invalidated) {
        return [];
    }
    const eligible = (templates || []).filter(template => {
        const tags = templateTags(template);
        const metadata = template?.metadata || {};
        const fullMap = Boolean(metadata.encompass);
        const presenceMatches = !metadata.presenceKey
            || partialPresenceMatches(metadata, player, signals);
        const verifiedPartial = metadata.partial === true
            && presenceMatches;
        return (fullMap || verifiedPartial)
            && presenceMatches
            && !tags.has('removed')
            && !tags.has('overwritable')
            // `unrand` maps are selector-only building blocks. They may
            // inherit a branch DEPTH and even use ORIENT encompass, but are
            // not independently eligible primary maps.
            && (verifiedPartial || !tags.has('unrand'))
            && (metadata.parseWarnings == null
                || (Array.isArray(metadata.parseWarnings)
                    && metadata.parseWarnings.length === 0))
            && (!player || (selectorMatches(metadata.place, player)
                && selectorMatches(metadata.depth, player)))
            && Array.isArray(template.grid)
            && template.grid.length > 0;
    });

    // Crawl tries matching PLACE primary maps before DEPTH layouts. Once an
    // eligible PLACE inventory exists for this floor, accepting DEPTH-only
    // encompass layouts would compare against maps that cannot naturally be
    // selected there. Explicit signal-gated partials (Pan lords) remain valid.
    const hasPrimaryPlace = Boolean(player) && eligible.some(template =>
        Boolean(template?.metadata?.place)
        && selectorMatches(template.metadata.place, player));
    const primaryEligible = hasPrimaryPlace
        ? eligible.filter(template => Boolean(template?.metadata?.place)
            || (template?.metadata?.partial
                && !String(template?.metadata?.presenceKey || '')
                    .startsWith('place:')))
        : eligible;

    return primaryEligible.map(template => {
        const trustedEntryConsensus = template?.metadata
            ?.trustedEntryConsensus;
        const trustedEntryFromPlace = normalizeBranch(
            signals?.levelEntryFromPlace
        );
        const entryProvenanceMatches = !trustedEntryConsensus
            || (Array.isArray(trustedEntryConsensus.allowedFromPlaces)
                && trustedEntryConsensus.allowedFromPlaces.includes(
                    trustedEntryFromPlace
                ));
        const explicitAnchor = (template?.metadata?.entryAnchorGlyph
                || template?.metadata?.entryAnchorGlyphs)
                && entryProvenanceMatches
            ? signals.levelEntry
            : null;
        const anchorGlyph = template?.metadata?.entryAnchorGlyph;
        const anchorGlyphs = template?.metadata?.entryAnchorGlyphs;
        if (!explicitAnchor
            || !Number.isInteger(explicitAnchor.x)
            || !Number.isInteger(explicitAnchor.y)
            || (typeof anchorGlyph !== 'string'
                && (!Array.isArray(anchorGlyphs) || !anchorGlyphs.length))) {
            return template;
        }
        return {
            ...template,
            metadata: {
                ...template.metadata,
                matchAnchor: {
                    x: explicitAnchor.x,
                    y: explicitAnchor.y,
                    // `levelEntry` is populated only from a live level-key
                    // transition followed by that transition's map clear.
                    // Reconnects and same-level resyncs never receive this
                    // marker, so exact entry-consensus policies can reject
                    // a merely coincident portal at the player's position.
                    ...(trustedEntryConsensus
                        ? {
                            trustedLevelEntry: true,
                            trustedLevelEntryFromPlace:
                                trustedEntryFromPlace
                        }
                        : {}),
                    ...(typeof anchorGlyph === 'string'
                        ? {glyph: anchorGlyph}
                        : {glyphs: [...anchorGlyphs]}),
                    ...(template?.metadata?.entryAnchorObservedKind
                        ? {
                            requireObservedKind:
                                template.metadata.entryAnchorObservedKind
                        }
                        : {})
                }
            }
        };
    });
}

function warningSetMatches(actual, expected) {
    return Array.isArray(actual)
        && actual.length === expected.length
        && expected.every(warning => actual.includes(warning));
}

function luaFunctionRegion(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const startPattern = new RegExp(
        `(?:^|\\n)function\\s+${escaped}\\s*\\(`,
        'u'
    );
    const match = startPattern.exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const remainder = String(source).slice(start);
    const closing = /^end\s*$/gmu.exec(remainder);
    if (!closing) {
        return null;
    }
    return remainder.slice(0, closing.index + closing[0].length);
}

function luaMapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const startPattern = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    );
    const match = startPattern.exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const remainder = String(source).slice(start + 1);
    const next = /\nNAME:\s*/u.exec(remainder);
    const end = next ? start + 1 + next.index : String(source).length;
    return String(source).slice(start, end);
}

function calledEntryMethods(region) {
    return [...String(region || '').matchAll(/\be\.([A-Za-z_]\w*)\s*\(/gu)]
        .map(match => match[1]);
}

function methodMultisetMatches(actual, expected) {
    if (!Array.isArray(actual) || !expected || typeof expected !== 'object') {
        return false;
    }
    const expectedEntries = Object.entries(expected);
    const expectedTotal = expectedEntries.reduce(
        (total, [, count]) => total + count,
        0
    );
    if (actual.length !== expectedTotal) {
        return false;
    }

    const actualCounts = new Map();
    for (const method of actual) {
        actualCounts.set(method, (actualCounts.get(method) || 0) + 1);
    }
    return actualCounts.size === expectedEntries.length
        && expectedEntries.every(([method, count]) =>
            Number.isInteger(count)
            && count >= 0
            && actualCounts.get(method) === count);
}

function literalTagsCallMatches(region, tags) {
    if (!Array.isArray(tags) || !tags.length) {
        return true;
    }
    const argumentsPattern = tags.map(tag => {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return `["']${escaped}["']`;
    }).join('\\s*,\\s*');
    return new RegExp(`\\be\\.tags\\(\\s*${argumentsPattern}\\s*\\)`, 'u')
        .test(String(region || ''));
}

function literalStringCallMatches(region, method, value) {
    const escapedMethod = String(method || '')
        .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const escapedValue = String(value ?? '')
        .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(
        `\\be\\.${escapedMethod}\\(\\s*["']${escapedValue}["']\\s*\\)`,
        'u'
    ).test(String(region || ''));
}

function hasTerrainMutation(region) {
    return /\be\.(?:clear|kfeat|nsubst|shuffle|subst|subvault)\s*\(/u
        .test(String(region || ''));
}

function hasBorderFillMutation(region) {
    return /\bset_border_fill_type\s*\(/u.test(String(region || ''));
}

function sourceHellHelpersAreSafe(source, family, dependencies) {
    const setup = luaFunctionRegion(source, family.setup);
    const vaultLua = dependencies?.[VAULT_LUA_PATH];
    const serpent = luaFunctionRegion(vaultLua, 'serpent_of_hell_setup');
    if (!setup || !serpent || hasTerrainMutation(setup)
        || hasBorderFillMutation(setup)
        || hasBorderFillMutation(serpent)
        || !methodMultisetMatches(
            calledEntryMethods(setup),
            family.setupMethods
        )
        || !literalStringCallMatches(setup, 'place', family.place)
        || !literalTagsCallMatches(setup, family.setupTags)) {
        return false;
    }
    const serpentMethods = calledEntryMethods(serpent);
    if (!methodMultisetMatches(serpentMethods, SERPENT_OF_HELL_METHODS)) {
        return false;
    }

    if (family.setup === 'dis_setup') {
        const rune = luaFunctionRegion(source, 'dis_rune');
        const metal = luaFunctionRegion(vaultLua, 'vault_metal_statue_setup');
        if (!rune || hasTerrainMutation(rune)
            || hasBorderFillMutation(rune)
            || hasBorderFillMutation(metal)
            || !methodMultisetMatches(
                calledEntryMethods(rune),
                DIS_RUNE_METHODS
            )
            || !metal
            || !/e\.kfeat\(glyph\s*\.\.\s*["']\s*=\s*metal_statue["']\)/u
                .test(metal)) {
            return false;
        }
        if (!methodMultisetMatches(
            calledEntryMethods(metal),
            METAL_STATUE_METHODS
        )) {
            return false;
        }
    }
    return true;
}

function stripHelperCalls(source, helperNames) {
    const alternatives = helperNames
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('|');
    const pattern = new RegExp(
        `^\\s*:?[ \\t]*(?:${alternatives})\\s*\\(\\s*_G\\b[^\\n]*$`,
        'gmu'
    );
    return String(source).replace(pattern, '');
}

function wizlabTerrainHelperAudit(dependencies) {
    const vaultLua = dependencies?.[VAULT_LUA_PATH];
    return new Map(Object.entries(WIZLAB_TERRAIN_HELPERS).map(([name, spec]) => {
        const region = luaFunctionRegion(vaultLua, name);
        const escapedFeature = spec.feature
            .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const assignsExpectedFeature = new RegExp(
            `\\be\\.kfeat\\(\\s*glyph\\s*\\.\\.\\s*["']\\s*=\\s*`
                + `${escapedFeature}["']\\s*\\)`,
            'u'
        ).test(String(region || ''));
        return [name, Boolean(region
            && assignsExpectedFeature
            && methodMultisetMatches(calledEntryMethods(region), spec.methods))];
    }));
}

function parseWizlabTerrainHelperCall(line) {
    const match = String(line).match(
        /^\s*:?\s*(vault_granite_statue_setup|vault_metal_statue_setup|decorative_floor)\s*\(\s*_G\s*,\s*(["'])([^"'])\2\s*,\s*(["'])([^"']*)\4\s*\)\s*$/u
    );
    return match ? {
        name: match[1],
        glyph: match[3],
        type: match[5]
    } : null;
}

function wizlabTerrainHelperCalls(block) {
    const names = Object.keys(WIZLAB_TERRAIN_HELPERS).join('|');
    const startsHelperCall = new RegExp(`^\\s*:?\\s*(?:${names})\\s*\\(`, 'u');
    return String(block || '').split('\n').flatMap(line => {
        if (!startsHelperCall.test(line)) {
            return [];
        }
        return [{line, call: parseWizlabTerrainHelperCall(line)}];
    });
}

function rewriteWizlabTerrainHelpers(source, helperAudit) {
    return String(source).split('\n').map(line => {
        const call = parseWizlabTerrainHelperCall(line);
        if (!call) {
            return line;
        }
        const feature = helperAudit.get(call.name)
            ? WIZLAB_TERRAIN_HELPERS[call.name].feature
            : '__dwem_unknown_wizlab_feature';
        return `KFEAT: ${call.glyph} = ${feature}`;
    }).join('\n');
}

function stripWizlabDynamicLua(source) {
    const helperNames = Object.keys(WIZLAB_TERRAIN_HELPERS).join('|');
    const externalHelper = new RegExp(
        `^\\s*:?\\s*(?:${helperNames})\\s*\\(`,
        'u'
    );
    const directTerrainMutation = /^\s*:\s*(?:clear|kfeat|kitem|kmask|kmons|map|marker|nsubst|orient|place|shuffle|subst|subvault|tags)\s*\(/u;
    let controlDepth = 0;

    return String(source).split('\n').map(line => {
        const lua = line.trim().startsWith(':')
            ? line.trim().slice(1).trim()
            : null;
        if (lua && /^(?:if\b|for\b|while\b|repeat\b|do\b)/u.test(lua)) {
            controlDepth++;
            return '';
        }
        if (lua && /^(?:elseif\b|else\b)/u.test(lua)) {
            return '';
        }
        if (lua && /^(?:end\b|until\b)/u.test(lua)) {
            controlDepth = Math.max(0, controlDepth - 1);
            return '';
        }
        if (controlDepth > 0 || directTerrainMutation.test(line)
            || externalHelper.test(line)) {
            return '';
        }
        return line;
    }).join('\n');
}

function auditedWizlabTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith(WIZLAB_PATH_SUFFIX)) {
        return null;
    }

    const helperAudit = wizlabTerrainHelperAudit(options?.dependencies);
    const rewrittenSource = rewriteWizlabTerrainHelpers(source, helperAudit);
    const rewrittenByName = new Map(parseDes(rewrittenSource, options)
        .map(template => [template.name, template]));
    const detectionByName = new Map(parseDes(
        stripWizlabDynamicLua(rewrittenSource),
        options
    ).map(template => [template.name, template]));

    const candidates = parsed.flatMap(original => {
        if (!String(original?.name || '').startsWith('wizlab_')
            || !original?.metadata?.encompass) {
            return [];
        }
        const block = luaMapBlock(source, original.name);
        const helperCalls = wizlabTerrainHelperCalls(block);
        const expectedWarnings = [...new Set(helperCalls.flatMap(({call}) =>
            call ? [`Unknown Lua helper ${call.name}(_G)`] : []))];
        const helperCallsAreAudited = helperCalls.every(({call}) =>
            call && helperAudit.get(call.name) === true);
        const helperWarningsOnly = warningSetMatches(
            original.metadata?.parseWarnings || [],
            expectedWarnings
        );
        const rewritten = rewrittenByName.get(original.name);
        const safe = Boolean(rewritten
            && rewritten.width === original.width
            && rewritten.height === original.height
            && rewritten.metadata?.encompass
            && !rewritten.metadata?.parseWarnings?.length
            && helperCallsAreAudited
            && helperWarningsOnly);
        const candidate = safe
            ? rewritten
            : detectionByName.get(original.name);
        if (!candidate
            || candidate.width !== original.width
            || candidate.height !== original.height
            || !candidate.metadata?.encompass
            || candidate.metadata?.parseWarnings?.length) {
            return [];
        }
        return [{
            ...candidate,
            metadata: {
                ...candidate.metadata,
                parseWarnings: [],
                sourceAudit: safe
                    ? 'wizlab-coarse-terrain-v1'
                    : 'wizlab-detection-only-v1',
                ...(safe ? {} : {
                    matchPolicy: {
                        ...(candidate.metadata?.matchPolicy || {}),
                        ...WIZLAB_DETECTION_MATCH_POLICY
                    }
                })
            }
        }];
    });
    return addWizlabEntryAnchors(candidates, path);
}

function materializeHellExitPortal(grid) {
    return grid.map(row => row.map(cell => {
        if (!cell) {
            return cell;
        }
        const glyphs = Array.isArray(cell.possibleGlyphs)
            && cell.possibleGlyphs.length
            ? [...new Set(cell.possibleGlyphs)]
            : [cell.glyph];
        if (!glyphs.includes('{')) {
            return cell;
        }
        const kinds = glyphs.length === 1
            ? ['portal']
            : [...new Set([...(cell.kinds || []), 'portal'])];
        return {...cell, kinds};
    }));
}

function auditedHellEndTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    const familyEntry = Object.entries(HELL_END_FAMILIES)
        .find(([suffix]) => path.endsWith(suffix));
    if (!familyEntry) {
        return [];
    }
    const family = familyEntry[1];
    if (!family.revealDisabled) {
        const naturalNames = naturalBranchEndPrimaries(parsed, path)
            .map(template => template.name)
            .sort();
        const setupCalls = (String(source).match(new RegExp(
            `\\b${family.setup}\\s*\\(\\s*_G\\s*\\)`,
            'gu'
        )) || []).length;
        if (naturalNames.join('|')
            !== [...family.names].sort().join('|')
            || setupCalls !== family.names.length) {
            return [];
        }
    }
    if (!sourceHellHelpersAreSafe(source, family, options?.dependencies)) {
        return [];
    }

    const originalByName = new Map(parsed.map(template => [template.name, template]));
    const sanitized = parseDes(stripHelperCalls(source, family.calls), options);
    return sanitized.flatMap(template => {
        if (!family.names.includes(template.name)) {
            return [];
        }
        const original = originalByName.get(template.name);
        const block = luaMapBlock(source, template.name);
        if (!original || !block
            || !warningSetMatches(original.metadata?.parseWarnings, family.warnings)
            || template.metadata?.parseWarnings?.length
            || !template.metadata?.encompass
            || template.width !== original.width
            || template.height !== original.height
            || template.metadata?.orient !== original.metadata?.orient
            || (block.match(/serpent_of_hell_setup\s*\(/gu) || []).length !== 1
            || (block.match(new RegExp(`${family.setup}\\s*\\(`, 'gu')) || []).length !== 1
            || (block.includes('vault_metal_statue_setup')
                && !/vault_metal_statue_setup\s*\(\s*_G\s*,\s*["']G["']/u
                    .test(block))) {
            return [];
        }
        const tags = new Set([
            ...(template.metadata?.tags || []),
            ...family.tags
        ]);
        const grid = materializeHellExitPortal(
            materializeAuditedEncompassWallFill(original, block, {
                grid: template.grid,
                audited: true
            })
        );
        return [{
            ...template,
            grid,
            metadata: {
                ...template.metadata,
                place: family.place,
                tags: [...tags],
                parseWarnings: [],
                // Branch-end generation places the arriving player on the
                // surviving upstairs glyph. Anchoring that glyph to the
                // WebTiles level-entry coordinate avoids losing the true
                // placement among thousands of repetitive wall/floor
                // offsets. SUBST/SHUFFLE alternatives remain represented by
                // possibleGlyphs in the parsed grid.
                entryAnchorGlyph: '{',
                // Hell's `{` exit is a branch gateway (DNGN_EXIT_DIS,
                // DNGN_EXIT_GEHENNA, DNGN_EXIT_COCYTUS, or
                // DNGN_EXIT_TARTARUS). WebTiles reports all four through
                // MF_PORTAL, unlike ordinary upstairs in dungeon branches.
                entryAnchorObservedKind: 'portal',
                sourceAudit: 'hell-end-coarse-terrain-v1',
                matchPolicy: {
                    ...BRANCH_END_MATCH_POLICY,
                    ...(family.revealDisabled ? {revealDisabled: true} : {})
                }
            }
        }];
    });
}

function sourceVaultsQuadrantHelpersAreSafe(source) {
    const loot = luaFunctionRegion(source, 'vaults_end_loot');
    const rune = luaFunctionRegion(source, 'vaults_end_rune');
    if (!loot || !rune) {
        return false;
    }
    const compactLoot = loot.replace(/\s+/gu, ' ');
    const compactRune = rune.replace(/\s+/gu, ' ');
    const lootMethods = calledEntryMethods(loot);
    const runeMethods = calledEntryMethods(rune);
    return methodMultisetMatches(lootMethods, VAULTS_END_LOOT_METHODS)
        && /e\.subst\(["']x\s*=\s*b["']\)/u.test(compactLoot)
        && /e\.subst\(["']x\s*=\s*v["']\)/u.test(compactLoot)
        && /e\.subst\(["']\?\s*=\s*\|\s*\*\s*\.:43["']\)/u.test(compactLoot)
        && methodMultisetMatches(runeMethods, VAULTS_END_RUNE_METHODS)
        && compactRune.includes('e.subvault("k : vaults_end_gem")')
        && compactRune.includes('e.subvault("O : vaults_end_rune")')
        && compactRune.includes('e.subvault("O : vaults_end_norune")')
        && compactRune.includes('e.subst("k = *")');
}

function vaultsDirectiveMultiset(block) {
    const header = String(block || '').split(/^MAP\s*$/mu, 1)[0];
    const counts = {};
    for (const match of header.matchAll(/^([A-Z][A-Z0-9_-]*)\s*:/gmu)) {
        counts[match[1]] = (counts[match[1]] || 0) + 1;
    }
    return counts;
}

function exactObjectCounts(actual, expected) {
    const actualEntries = Object.entries(actual || {}).sort();
    const expectedEntries = Object.entries(expected || {}).sort();
    return actualEntries.length === expectedEntries.length
        && actualEntries.every(([key, count], index) =>
            key === expectedEntries[index][0]
            && count === expectedEntries[index][1]);
}

function canonicalVaultsLuaLine(line) {
    return String(line || '').trim().replace(/^:\s*/u, '')
        .replace(/\s+/gu, '')
        .replaceAll('"', "'");
}

function sourceVaultsMasterIsSafe(source) {
    const block = luaMapBlock(source, 'vaults_vault');
    if (!block || !exactObjectCounts(vaultsDirectiveMultiset(block), {
        NAME: 1,
        PLACE: 1,
        ORIENT: 1,
        TAGS: 1,
        MONS: 1,
        SHUFFLE: 1,
        SUBST: 3,
        LFLOORTILE: 2,
        SUBVAULT: 8,
        FTILE: 1
    })) {
        return false;
    }

    const literalChecks = [
        /^PLACE:\s*Vaults:\$\s*$/mu,
        /^ORIENT:\s*encompass\s*$/mu,
        /^TAGS:\s*no_rotate\s+no_dump\s*$/mu,
        /^MONS:\s*vault guard\s*$/mu,
        /^SHUFFLE:\s*ABCD\s*$/mu,
        /^SUBST:\s*x\s*=\s*b\s*$/mu,
        /^SUBST:\s*x\s*=\s*v\s*$/mu,
        /^SUBST:\s*ABCD\s*=\s*\.\s*$/mu,
        /^LFLOORTILE:\s*floor_crystal\s*$/mu,
        /^LFLOORTILE:\s*floor_metal_silver\s*$/mu,
        /^FTILE:\s*\.\(\[\{<109\s*=\s*floor_vault\s*$/mu
    ];
    if (!literalChecks.every(pattern => pattern.test(block))) {
        return false;
    }

    const expectedSubvaults = [
        ['A', 'vaults_end_quadrant_prize_mall'],
        ['B', 'vaults_end_quadrant_mall'],
        ['C', 'vaults_end_quadrant_mall'],
        ['D', 'vaults_end_quadrant_mall'],
        ['A', 'vaults_end_quadrant_prize'],
        ['B', 'vaults_end_quadrant'],
        ['C', 'vaults_end_quadrant'],
        ['D', 'vaults_end_quadrant']
    ];
    const actualSubvaults = [...block.matchAll(
        /^SUBVAULT:\s*([A-D])\s*:\s*(\S+)\s*$/gmu
    )].map(match => [match[1], match[2]]);
    if (actualSubvaults.length !== expectedSubvaults.length
        || actualSubvaults.some((value, index) =>
            value[0] !== expectedSubvaults[index][0]
            || value[1] !== expectedSubvaults[index][1])) {
        return false;
    }

    const expectedControl = [
        'ifnotdgn.persist.vaults_end_crystalthen',
        'dgn.persist.vaults_end_crystal=false',
        'end',
        'ifcrawl.one_chance_in(10)then',
        'dgn.persist.vaults_end_crystal=true',
        "set_border_fill_type('crystal_wall')",
        'else',
        'dgn.persist.vaults_end_crystal=false',
        "set_border_fill_type('metal_wall')",
        'end',
        'ifcrawl.one_chance_in(36)then',
        'else',
        'end'
    ];
    const actualControl = block.split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalVaultsLuaLine);
    if (actualControl.length !== expectedControl.length
        || actualControl.some((line, index) => line !== expectedControl[index])) {
        return false;
    }

    const crystalBranch = /:\s*if\s+crawl\.one_chance_in\(10\)\s+then\s*\n\s*:\s*dgn\.persist\.vaults_end_crystal\s*=\s*true\s*\n\s*SUBST:\s*x\s*=\s*b\s*\n\s*LFLOORTILE:\s*floor_crystal\s*\n\s*:\s*set_border_fill_type\(["']crystal_wall["']\)\s*\n\s*:\s*else\s*\n\s*:\s*dgn\.persist\.vaults_end_crystal\s*=\s*false\s*\n\s*SUBST:\s*x\s*=\s*v\s*\n\s*LFLOORTILE:\s*floor_metal_silver\s*\n\s*:\s*set_border_fill_type\(["']metal_wall["']\)\s*\n\s*:\s*end/u;
    const quadrantBranch = /:\s*if\s+crawl\.one_chance_in\(36\)\s+then\s*\n\s*SUBVAULT:\s*A\s*:\s*vaults_end_quadrant_prize_mall\s*\n\s*SUBVAULT:\s*B\s*:\s*vaults_end_quadrant_mall\s*\n\s*SUBVAULT:\s*C\s*:\s*vaults_end_quadrant_mall\s*\n\s*SUBVAULT:\s*D\s*:\s*vaults_end_quadrant_mall\s*\n\s*:\s*else\s*\n\s*SUBVAULT:\s*A\s*:\s*vaults_end_quadrant_prize\s*\n\s*SUBVAULT:\s*B\s*:\s*vaults_end_quadrant\s*\n\s*SUBVAULT:\s*C\s*:\s*vaults_end_quadrant\s*\n\s*SUBVAULT:\s*D\s*:\s*vaults_end_quadrant\s*\n\s*:\s*end/u;
    if (!crystalBranch.test(block) || !quadrantBranch.test(block)) {
        return false;
    }

    const luaRegion = /\{\{([\s\S]*?)\}\}/u.exec(block)?.[1] || '';
    const featureCalls = [...luaRegion.matchAll(
        /set_feature_name\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/gu
    )].map(match => [match[1], match[2]]);
    const expectedFeatures = [
        ['metal_wall', 'heavily etched metal wall'],
        ['crystal_wall', 'heavily etched crystal wall'],
        ['stone_stairs_up_i', 'metal staircase leading up'],
        ['stone_stairs_up_ii', 'metal staircase leading up'],
        ['stone_stairs_up_iii', 'metal staircase leading up']
    ];
    const residue = luaRegion.replace(
        /set_feature_name\(\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*\)/gu,
        ''
    ).replace(/\s+/gu, '');
    return !residue
        && featureCalls.length === expectedFeatures.length
        && featureCalls.every((value, index) =>
            value[0] === expectedFeatures[index][0]
            && value[1] === expectedFeatures[index][1]);
}

function mapRowsFromBlock(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function vaultsSlotDefinitions(rows) {
    const slots = [];
    for (const id of 'ABCD') {
        const points = [];
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
                if (row[x] === id) {
                    points.push({x, y});
                }
            }
        });
        if (!points.length) {
            return [];
        }
        const minX = Math.min(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x));
        const maxY = Math.max(...points.map(point => point.y));
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const mask = Array.from({length: height}, (_, y) =>
            Array.from({length: width}, (_, x) =>
                rows[minY + y]?.[minX + x] === id));
        const maskCells = mask.flat().filter(Boolean).length;
        if (width !== 27 || height !== 23 || maskCells !== 608) {
            return [];
        }
        slots.push({id, x: minX, y: minY, width, height, mask});
    }
    return slots;
}

function maskGridGlyphs(grid, glyphs) {
    const dynamic = new Set(glyphs);
    return grid.map(row => row.map(cell => {
        if (!cell || typeof cell !== 'object') {
            return cell;
        }
        const possible = new Set([
            cell.glyph,
            ...(Array.isArray(cell.possibleGlyphs) ? cell.possibleGlyphs : [])
        ]);
        if (![...possible].some(glyph => dynamic.has(glyph))) {
            return cell;
        }
        return {
            ...cell,
            kinds: [],
            certain: false
        };
    }));
}

function stripAuditedVaultsDynamicLines(source) {
    const removable = [
        /^\s*SUBST:\s*x\s*=\s*[bv]\s*$/gmu,
        /^\s*SUBVAULT:\s*[A-D]\s*:\s*vaults_end_quadrant(?:_prize)?(?:_mall)?\s*$/gmu,
        /^\s*SUBST:\s*A\s*=\s*\+\s*,\s*a\s*=\s*\.\s*,\s*CD\s*=\s*x\s*$/gmu,
        /^\s*SHUFFLE:\s*CD\s*$/gmu,
        /^\s*SUBST:\s*C\s*=\s*\.\s*,\s*DAa\s*=\s*x\s*$/gmu,
        /^\s*SUBVAULT:\s*V\s*:\s*vaults_end_room_rune\s*$/gmu,
        /^\s*SUBVAULT:\s*[XYZ]\s*:\s*vaults_end_room\s*$/gmu
    ];
    return removable.reduce(
        (result, pattern) => result.replace(pattern, ''),
        stripHelperCalls(source, ['vaults_end_loot', 'vaults_end_rune'])
    );
}

function sourceVaultsSpecialQuadrantIsSafe(block, name) {
    if (name === 'vaults_end_dpeg_shops1') {
        return /^:\s*if\s+crawl\.one_chance_in\(4\)\s+then\s*$/mu.test(block)
            && /^SUBST:\s*A\s*=\s*\+\s*,\s*a\s*=\s*\.\s*,\s*CD\s*=\s*x\s*$/mu.test(block)
            && /^:\s*else\s*$/mu.test(block)
            && /^SHUFFLE:\s*CD\s*$/mu.test(block)
            && /^SUBST:\s*C\s*=\s*\.\s*,\s*DAa\s*=\s*x\s*$/mu.test(block)
            && (block.match(/^:\s*end\s*$/gmu) || []).length === 1;
    }
    if (name === 'vaults_end_classical_rooms') {
        const subvaults = [...block.matchAll(
            /^SUBVAULT:\s*([VXYZ])\s*:\s*(\S+)\s*$/gmu
        )].map(match => `${match[1]}:${match[2]}`);
        return subvaults.join('|') === [
            'V:vaults_end_room_rune',
            'X:vaults_end_room',
            'Y:vaults_end_room',
            'Z:vaults_end_room'
        ].join('|')
            && /^SHUFFLE:\s*VXYZ\s*$/mu.test(block)
            && /^SUBST:\s*VXYZ\s*=\s*\.\s*$/mu.test(block)
            && /^:\s*if\s*\(dgn\.persist\.vaults_end_crystal\)\s*then\s*$/mu.test(block)
            && /^SUBST:\s*x\s*=\s*b\s*$/mu.test(block)
            && /^SUBST:\s*x\s*=\s*v\s*$/mu.test(block)
            && (block.match(/^:\s*end\s*$/gmu) || []).length === 1;
    }
    return true;
}

function sourceVaultsQuadrantControlIsSafe(block, name) {
    const lines = String(block || '').split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalVaultsLuaLine);
    const expected = name === 'vaults_end_dpeg_shops1'
        ? [
            'ifcrawl.one_chance_in(4)then',
            'else',
            'end',
            'vaults_end_loot(_G)',
            'vaults_end_rune(_G)'
        ]
        : name === 'vaults_end_classical_rooms'
            ? [
                'if(dgn.persist.vaults_end_crystal)then',
                'else',
                'end'
            ]
            : ['vaults_end_loot(_G)', 'vaults_end_rune(_G)'];
    return lines.length === expected.length
        && lines.every((line, index) => line === expected[index]);
}

function vaultsQuadrantWarningsAreAudited(template) {
    const warnings = template?.metadata?.parseWarnings;
    if (template?.name === 'vaults_end_dpeg_shops1') {
        return warningSetMatches(warnings, [
            'SUBST directive appears inside Lua control flow',
            'SHUFFLE directive appears inside Lua control flow',
            ...VAULTS_QUADRANT_WARNINGS
        ]);
    }
    if (template?.name === 'vaults_end_classical_rooms') {
        return warningSetMatches(warnings, [
            'SUBVAULT directives are not statically supported',
            'SUBST directive appears inside Lua control flow'
        ]);
    }
    return warningSetMatches(warnings, VAULTS_QUADRANT_WARNINGS);
}

function auditedVaultsQuadrantTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/vaults.des')
        || !sourceVaultsQuadrantHelpersAreSafe(source)) {
        return [];
    }
    const originalByName = new Map(parsed.map(template => [template.name, template]));
    const sanitized = parseDes(stripAuditedVaultsDynamicLines(source), options);
    const templates = sanitized.flatMap(template => {
        const tags = templateTags(template);
        const original = originalByName.get(template.name);
        const block = luaMapBlock(source, template.name);
        if (!original
            || ![...tags].some(tag => tag.startsWith('vaults_end_quadrant'))
            || !vaultsQuadrantWarningsAreAudited(original)
            || !block
            || block.includes('{{')
            || !sourceVaultsSpecialQuadrantIsSafe(block, template.name)
            || !sourceVaultsQuadrantControlIsSafe(block, template.name)
            || template.metadata?.parseWarnings?.length
            || template.width !== 27
            || template.height !== 23
            || template.metadata?.encompass
            || tags.has('removed')
            || tags.has('overwritable')
            // The composite matcher enforces Crawl's registered-subvault
            // no-duplicate rule across the four slots. A future allow_dup
            // quadrant would change that rule and therefore fails this audit.
            || tags.has('allow_dup')) {
            return [];
        }
        const dynamicGlyphs = ['O', 'k'];
        if (template.name === 'vaults_end_dpeg_shops1') {
            dynamicGlyphs.push('A', 'a', 'C', 'D');
        } else if (template.name === 'vaults_end_classical_rooms') {
            dynamicGlyphs.push('V', 'X', 'Y', 'Z');
        }
        return [{
            ...template,
            grid: maskGridGlyphs(template.grid, dynamicGlyphs),
            metadata: {
                ...template.metadata,
                orient: 'float',
                partial: true,
                place: 'Vaults:$',
                presenceKey: 'place:Vaults:$',
                parseWarnings: [],
                sourceAudit: 'vaults-end-quadrant-v1',
                matchPolicy: {...VAULTS_QUADRANT_MATCH_POLICY}
            }
        }];
    });

    const eligibleOriginals = parsed.filter(template => {
        const tags = templateTags(template);
        return [...tags].some(tag => tag.startsWith('vaults_end_quadrant'))
            && !tags.has('removed')
            && !tags.has('overwritable');
    });
    const uniqueNames = new Set(templates.map(template => template.name));
    return templates.length === eligibleOriginals.length
        && uniqueNames.size === templates.length
        ? templates
        : [];
}

function auditedVaultsEndCompositeTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/vaults.des')
        || !sourceVaultsMasterIsSafe(source)) {
        return [];
    }
    const masterBlock = luaMapBlock(source, 'vaults_vault');
    const rows = mapRowsFromBlock(masterBlock);
    const slots = vaultsSlotDefinitions(rows);
    const quadrants = auditedVaultsQuadrantTemplates(source, parsed, options);
    const sanitized = parseDes(stripAuditedVaultsDynamicLines(source), options);
    const master = sanitized.find(template => template.name === 'vaults_vault');
    const rawMaster = parsed.find(template => template.name === 'vaults_vault');
    const entryGlyphs = new Set(['{', '(', '[', '<']);
    const entryCells = rows.flatMap((row, y) => [...row].flatMap((glyph, x) =>
        entryGlyphs.has(glyph) ? [{x, y, glyph}] : []));
    if (!master || !rawMaster || slots.length !== 4 || quadrants.length === 0
        || master.metadata?.parseWarnings?.length
        || !master.metadata?.encompass
        || master.width !== 66 || master.height !== 58
        || rows.length !== master.height
        || rows.some(row => row.length !== master.width)
        || entryCells.length !== 6
        || entryCells.map(cell => `${cell.x},${cell.y},${cell.glyph}`).join('|')
            !== '32,27,(|33,27,<|31,28,[|34,28,{|32,29,<|33,29,<') {
        return [];
    }

    const roleCounts = {
        normalPrize: 0,
        normalRegular: 0,
        mallPrize: 0,
        mallRegular: 0
    };
    const variants = quadrants.map(template => {
        const tags = templateTags(template);
        const roles = [];
        if (tags.has('vaults_end_quadrant_prize')) {
            roles.push('normalPrize');
            roleCounts.normalPrize++;
        }
        if (tags.has('vaults_end_quadrant')) {
            roles.push('normalRegular');
            roleCounts.normalRegular++;
        }
        if (tags.has('vaults_end_quadrant_prize_mall')) {
            roles.push('mallPrize');
            roleCounts.mallPrize++;
        }
        if (tags.has('vaults_end_quadrant_mall')) {
            roles.push('mallRegular');
            roleCounts.mallRegular++;
        }
        return {
            name: template.name,
            width: template.width,
            height: template.height,
            grid: template.grid,
            tags: [...tags],
            roles
        };
    });
    if (roleCounts.normalPrize < 1
        || roleCounts.normalRegular < 3
        || roleCounts.mallPrize < 1
        || roleCounts.mallRegular < 3
        || variants.some(variant => variant.roles.length === 0)) {
        return [];
    }

    const slotGlyphs = new Set('ABCD');
    const shellGrid = master.grid.map((row, y) => row.map((cell, x) =>
        slotGlyphs.has(rows[y]?.[x])
            ? {...cell, kinds: [], certain: false}
            : cell));
    return [{
        ...master,
        grid: shellGrid,
        metadata: {
            ...master.metadata,
            place: 'Vaults:$',
            parseWarnings: [],
            // Vaults:5 redistributes the three numbered upstairs among these
            // six central stair glyphs. A normal descent therefore anchors
            // the shell to every legal stair cell, while a shaft landing is
            // rejected by the matcher's observed-kind check.
            entryAnchorGlyphs: ['{', '(', '[', '<'],
            entryAnchorObservedKind: 'stair',
            sourceAudit: 'vaults-end-composite-v1',
            matchPolicy: {...BRANCH_END_MATCH_POLICY},
            composite: {
                type: 'vaults-end-quadrants-v1',
                slots,
                variants,
                variantPolicy: {...VAULTS_COMPOSITE_QUADRANT_MATCH_POLICY},
                borderFillKind: 'wall',
                regimes: [
                    {
                        id: 'normal',
                        prizeRole: 'normalPrize',
                        regularRole: 'normalRegular'
                    },
                    {
                        id: 'mall-1-in-36',
                        prizeRole: 'mallPrize',
                        regularRole: 'mallRegular'
                    }
                ]
            }
        }
    }];
}

function sourceWithoutLuaComments(region) {
    return String(region || '')
        .replace(/--\[\[[\s\S]*?\]\]/gu, '')
        .replace(/--[^\n]*/gu, '');
}

function sourceTombHelpersAreSafe(source, dependencies) {
    const regions = Object.fromEntries(Object.keys(TOMB_TERRAIN_HELPER_METHODS)
        .map(name => [name, luaFunctionRegion(source, name)]));
    if (Object.values(regions).some(region => !region)) {
        return false;
    }
    for (const [name, expected] of Object.entries(
        TOMB_TERRAIN_HELPER_METHODS
    )) {
        const activeRegion = sourceWithoutLuaComments(regions[name]);
        if (!methodMultisetMatches(calledEntryMethods(activeRegion), expected)) {
            return false;
        }
    }

    const trap = sourceWithoutLuaComments(regions.tomb_trap_set);
    const centre = sourceWithoutLuaComments(regions.tomb_1_centre_setup);
    const stairs = sourceWithoutLuaComments(regions.tomb_1_stairs_setup);
    const ambush = sourceWithoutLuaComments(regions.tomb_2_ambush_setup);
    const khufu = sourceWithoutLuaComments(regions.tomb_3_khufu);
    const rune = sourceWithoutLuaComments(regions.tomb_3_rune_setup);
    const literalChecks = [
        /e\.kfeat\(["']\^\s*=\s*trap_alarm\s*\/\s*trap_net\s*\/\s*trap_zot\s*\/\s*trap_dispersal\s*\/\s*trap_tyrant["']\)/u
            .test(trap),
        /e\.kfeat\(["']\^\s*=\s*trap_alarm\s+w:5\s*\/\s*trap_dispersal\s*\/\s*trap_net\s*\/\s*trap_zot["']\)/u
            .test(centre),
        /e\.subst\(["']\.\s*=\s*\^\s+\.:490["']\)/u.test(centre),
        /e\.lua_marker\(["']>["']\s*,\s*hatch_name\(["']tomb2_entry["']\)\)/u
            .test(centre),
        /e\.lua_marker\(["']>["']\s*,\s*hatch_dest_name\(["']tomb2_exit["']\)\)/u
            .test(centre),
        /e\.lua_marker\(["']P["']\s*,\s*hatch_dest_name\(["']tomb1_hall_entry["']\)\)/u
            .test(stairs),
        /e\.subst\(["']P\s*=\s*\.["']\)/u.test(stairs),
        /e\.lua_marker\(["']Q["']\s*,\s*hatch_name\(["']tomb1_hall_exit_1["']\)\)/u
            .test(stairs),
        /e\.subst\(["']Q\s*=\s*>["']\)/u.test(stairs),
        /e\.lua_marker\(["']R["']\s*,\s*hatch_name\(["']tomb1_hall_exit_2["']\)\)/u
            .test(stairs),
        /e\.subst\(["']R\s*=\s*>["']\)/u.test(stairs),
        /e\.subst\(["']\.\s*=\s*3\s+\^\s+\.:230["']\)/u.test(stairs),
        /e\.lua_marker\(["']R["']\s*,\s*hatch_dest_name\(["']tomb2_entry["']\)\)/u
            .test(ambush),
        /e\.lua_marker\(["']R["']\s*,\s*hatch_dest_name\(["']tomb1_hall_exit_1["']\)\)/u
            .test(ambush),
        /e\.subst\(["']R\s*=\s*\.["']\)/u.test(ambush),
        /e\.lua_marker\(["']S["']\s*,\s*hatch_name\(["']tomb2_exit["']\)\)/u
            .test(ambush),
        /e\.nsubst\(["']S\s*=\s*1:<\s*\/\s*\*:\.["']\)/u.test(ambush),
        /e\.subst\(["']\.\s*=\s*\^\s+\.:740["']\)/u.test(ambush),
        /e\.kmons\(glyph\s*\.\.\s*["']\s*=\s*Khufu\s+w:3\s*\/\s*royal mummy,\s*royal mummy["']\)/u
            .test(khufu),
        /e\.kmask\(["']OR\s*=\s*no_item_gen["']\)/u.test(rune),
        /e\.kitem\(["']R\s*=\s*sanguine gem["']\)/u.test(rune),
        /e\.kitem\(["']O\s*=\s*golden rune of Zot["']\)/u.test(rune),
        /e\.subst\(["']\.\s*=\s*\^\s+\.:490["']\)/u.test(rune)
    ];
    if (!literalChecks.every(Boolean)) {
        return false;
    }

    // Tomb:1's only external terrain helper either turns the retained
    // sarcophagus glyph into a granite statue or the enclosing conditional
    // substitutes it. Those cells are masked below, but auditing the helper
    // still proves it cannot mutate unrelated glyphs.
    return wizlabTerrainHelperAudit(dependencies)
        .get('vault_granite_statue_setup') === true;
}

function canonicalTombLuaLines(block) {
    return String(block || '').split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalVaultsLuaLine);
}

function sourceTombMasterIsSafe(source, name) {
    const block = luaMapBlock(source, name);
    const specs = {
        tomb_1: {
            directives: {
                NAME: 1, PLACE: 1, ORIENT: 1, TAGS: 1, SUBVAULT: 2,
                MONS: 3, NSUBST: 1, SUBST: 6, TILE: 1
            },
            place: 'Tomb:1',
            tags: 'no_dump',
            subvaults: ['A:tomb_1_centre', 'B:tomb_1_hall_stairs'],
            lua: [
                'tomb_guardian_set(_G,true)',
                'ifcrawl.x_chance_in_y(3,4)then',
                "vault_granite_statue_setup(_G,'FIJKLMNOPQ','sarcophagus')",
                'else',
                'end',
                'tomb_trap_set(_G)',
                "set_feature_name('escape_hatch_down','one-way staircase leading down')"
            ]
        },
        tomb_2: {
            directives: {
                NAME: 1, PLACE: 1, ORIENT: 1, TAGS: 1, SUBVAULT: 1,
                MONS: 1, NSUBST: 1, MARKER: 7, SUBST: 10, SHUFFLE: 2
            },
            place: 'Tomb:2',
            tags: 'no_dump no_trap_gen',
            subvaults: ['B:tomb_2_ambush'],
            lua: [
                'tomb_guardian_set(_G)',
                'tomb_mummy_priest_set(_G)',
                'tomb_trap_set(_G)',
                "set_border_fill_type('permarock_wall')",
                "set_feature_name('escape_hatch_down','one-way staircase leading down')",
                "set_feature_name('escape_hatch_up','one-way staircase leading up')"
            ]
        },
        tomb_3: {
            directives: {
                NAME: 1, PLACE: 1, ORIENT: 1, TAGS: 1, SUBVAULT: 1,
                ITEM: 1, KITEM: 3, SUBST: 3, NSUBST: 1, MARKER: 4
            },
            place: 'Tomb:3',
            tags: 'no_rotate no_dump no_trap_gen',
            subvaults: ['A:tomb_3_rune'],
            lua: [
                'tomb_guardian_set(_G)',
                'tomb_trap_set(_G)',
                "set_border_fill_type('permarock_wall')",
                "set_feature_name('escape_hatch_down','one-way staircase leading down')",
                "set_feature_name('escape_hatch_up','one-way staircase leading up')"
            ]
        }
    };
    const spec = specs[name];
    if (!block || !spec
        || !exactObjectCounts(vaultsDirectiveMultiset(block), spec.directives)
        || !new RegExp(`^PLACE:\\s*${spec.place}\\s*$`, 'mu')
            .test(block)
        || !/^ORIENT:\s*encompass\s*$/mu.test(block)
        || !new RegExp(`^TAGS:\\s*${spec.tags.replaceAll(' ', '\\s+')}\\s*$`, 'mu')
            .test(block)) {
        return false;
    }
    const subvaults = [...block.matchAll(
        /^SUBVAULT:\s*([A-Z])\s*:\s*(\S+)\s*$/gmu
    )].map(match => `${match[1]}:${match[2]}`);
    const lua = canonicalTombLuaLines(block);
    const expectedLua = spec.lua.map(canonicalVaultsLuaLine);
    const markerChecks = {
        tomb_1: [],
        tomb_2: [
            /^MARKER:\s*C\s*=\s*lua:hatch_dest_name\(["']tomb1_hall_exit_2["']\)\s*$/mu,
            /^SUBST:\s*C\s*=\s*\.\s*$/mu,
            /^SHUFFLE:\s*EH\s*\/\s*FI\s*$/mu,
            /^MARKER:\s*H\s*=\s*lua:hatch_dest_name\(["']tomb3_exit_1["']\)\s*$/mu,
            /^MARKER:\s*I\s*=\s*lua:hatch_dest_name\(["']tomb3_exit_2["']\)\s*$/mu,
            /^SUBST:\s*HI\s*=\s*\.\s*$/mu
        ],
        tomb_3: [
            /^MARKER:\s*D\s*=\s*lua:hatch_dest_name\(["']tomb3_entry_1["']\)\s*$/mu,
            /^MARKER:\s*E\s*=\s*lua:hatch_dest_name\(["']tomb3_entry_2["']\)\s*$/mu,
            /^SUBST:\s*DE\s*=\s*\.\s*$/mu
        ]
    }[name] || [];
    return subvaults.join('|') === spec.subvaults.join('|')
        && lua.length === expectedLua.length
        && lua.every((line, index) => line === expectedLua[index])
        && markerChecks.every(pattern => pattern.test(block));
}

function sourceTombComponentIsSafe(block, template, role) {
    const spec = TOMB_COMPONENTS[role];
    const tags = templateTags(template);
    const allowedTags = new Set([
        role,
        'unrand',
        'no_hmirror',
        'no_vmirror',
        'no_rotate'
    ]);
    if (!block || !spec || !spec.names.includes(template.name)
        || !exactObjectCounts(
            vaultsDirectiveMultiset(block),
            TOMB_COMPONENT_DIRECTIVES[template.name]
        )
        || !tags.has(role)
        || !tags.has('unrand')
        || [...tags].some(tag => !allowedTags.has(tag))
        || template.width !== spec.width
        || template.height !== spec.height
        || template.metadata?.encompass) {
        return false;
    }
    const helperByRole = {
        tomb_1_centre: 'tomb_1_centre_setup',
        tomb_1_hall_stairs: 'tomb_1_stairs_setup',
        tomb_2_ambush: 'tomb_2_ambush_setup',
        tomb_3_rune: 'tomb_3_rune_setup'
    };
    const expectedLua = template.name === 'tomb_3_rune_grunt_doroklohe'
        ? ['tomb_3_rune_setup(_G)', "tomb_3_khufu(_G,'O')"]
        : role === 'tomb_1_centre'
            && template.name === 'tomb_1_centre_nicolae_necropolis'
            ? ['tomb_trap_set(_G)', 'tomb_1_centre_setup(_G)']
            : role === 'tomb_1_centre'
                && ['tomb_1_centre_grunt_parallel',
                    'tomb_1_centre_grunt_layered'].includes(template.name)
                ? [
                    'tomb_1_centre_setup(_G)',
                    "set_feature_name('granite_statue','sarcophagus')"
                ]
                : [`${helperByRole[role]}(_G)`];
    const lua = canonicalTombLuaLines(block);
    const canonicalExpectedLua = expectedLua.map(canonicalVaultsLuaLine);
    return lua.length === canonicalExpectedLua.length
        && lua.every((line, index) => line === canonicalExpectedLua[index]);
}

function stripAuditedTombDynamicLines(source, preserveEntryMarkers = false) {
    let result = String(source).replace(
        /^\s*:\s*if\s+crawl\.x_chance_in_y\(3,\s*4\)\s+then\s*$[\s\S]*?^\s*:\s*end\s*$/mu,
        ''
    );
    result = result.replace(
        /^\s*SUBVAULT:\s*[AB]\s*:\s*tomb_[123]_[A-Za-z0-9_]+\s*$/gmu,
        ''
    );
    result = result.replace(
        /^\s*:?\s*tomb_1_stairs_setup\s*\(\s*_G\s*\)\s*$/gmu,
        preserveEntryMarkers ? '' : 'SUBST: P = ., Q = >, R = >'
    );
    result = result.replace(
        /^\s*:?\s*tomb_2_ambush_setup\s*\(\s*_G\s*\)\s*$/gmu,
        preserveEntryMarkers ? '' : 'SUBST: R = .\nNSUBST: S = 1:< / *:.'
    );
    if (preserveEntryMarkers) {
        result = result.replace(
            /^\s*SUBST:\s*(?:C|HI|DE)\s*=\s*\.\s*$/gmu,
            ''
        );
    }
    return stripHelperCalls(result, [
        'tomb_1_centre_setup',
        'tomb_3_rune_setup',
        'tomb_3_khufu'
    ]);
}

function templateGlyphPoints(template, glyphs) {
    const wanted = new Set(glyphs || []);
    const points = [];
    for (let y = 0; y < (template?.grid?.length || 0); y++) {
        for (let x = 0; x < (template.grid[y]?.length || 0); x++) {
            const cell = template.grid[y]?.[x];
            const finalGlyphs = Array.isArray(cell?.possibleGlyphs)
                ? cell.possibleGlyphs
                : [cell?.glyph];
            if (finalGlyphs.some(glyph => wanted.has(glyph))) {
                points.push({x, y});
            }
        }
    }
    return points;
}

function tombSlotDefinition(rows, definition) {
    const points = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === definition.id) {
                points.push({x, y});
            }
        }
    });
    if (!points.length) {
        return null;
    }
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const mask = Array.from({length: height}, (_, y) =>
        Array.from({length: width}, (_, x) =>
            rows[minY + y]?.[minX + x] === definition.id));
    if (width !== definition.width
        || height !== definition.height
        || mask.flat().filter(Boolean).length !== definition.maskCells) {
        return null;
    }
    return {
        id: definition.id,
        role: definition.role,
        x: minX,
        y: minY,
        width,
        height,
        mask,
        entryAnchorGlyphs: [...(definition.entryAnchorGlyphs || [])]
    };
}

function auditedTombCompositeTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/tomb.des')
        || !sourceTombHelpersAreSafe(source, options?.dependencies)) {
        return [];
    }
    const sanitized = parseDes(stripAuditedTombDynamicLines(source), options);
    const markerPreserving = parseDes(
        stripAuditedTombDynamicLines(source, true),
        options
    );
    const sanitizedByName = new Map(sanitized.map(template => [
        template.name,
        template
    ]));
    const markerPreservingByName = new Map(markerPreserving.map(template => [
        template.name,
        template
    ]));
    const rawByName = new Map(parsed.map(template => [template.name, template]));
    const masterSpecs = [
        {
            name: 'tomb_1',
            place: 'Tomb:1',
            width: 80,
            height: 70,
            slots: [
                {
                    id: 'A', role: 'tomb_1_centre', width: 33, height: 20,
                    maskCells: 634, entryAnchorGlyphs: ['>']
                },
                {
                    id: 'B', role: 'tomb_1_hall_stairs', width: 39,
                    height: 12, maskCells: 312, entryAnchorGlyphs: ['P']
                }
            ],
            entryAnchorGlyphs: ['(', '>', 'P'],
            shellEntryAnchorGlyphs: ['('],
            markerEntryAnchorGlyphs: [],
            dynamicGlyphs: [...'FIJKLMNOPQ']
        },
        {
            name: 'tomb_2',
            place: 'Tomb:2',
            width: 43,
            height: 38,
            slots: [
                {
                    id: 'B', role: 'tomb_2_ambush', width: 29, height: 22,
                    maskCells: 638, entryAnchorGlyphs: ['R']
                }
            ],
            entryAnchorGlyphs: ['C', 'H', 'I', 'R'],
            shellEntryAnchorGlyphs: ['C', 'H', 'I'],
            markerEntryAnchorGlyphs: ['C', 'H', 'I'],
            entryAnchorObservedKind: 'floor',
            dynamicGlyphs: []
        },
        {
            name: 'tomb_3',
            place: 'Tomb:3',
            width: 43,
            height: 38,
            slots: [
                {
                    id: 'A', role: 'tomb_3_rune', width: 41, height: 20,
                    maskCells: 795, entryAnchorGlyphs: []
                }
            ],
            entryAnchorGlyphs: ['D', 'E'],
            shellEntryAnchorGlyphs: ['D', 'E'],
            markerEntryAnchorGlyphs: ['D', 'E'],
            entryAnchorObservedKind: 'floor',
            dynamicGlyphs: []
        }
    ];

    // The registered pools are closed sets. If a daily source adds, removes,
    // or renames an eligible child, disable every Tomb composite rather than
    // silently matching against an incomplete catalogue.
    for (const [role, spec] of Object.entries(TOMB_COMPONENTS)) {
        const eligibleNames = parsed.filter(template => {
            const tags = templateTags(template);
            return tags.has(role)
                && !tags.has('removed')
                && !tags.has('overwritable');
        }).map(template => template.name).sort();
        if (eligibleNames.join('|') !== [...spec.names].sort().join('|')) {
            return [];
        }
    }

    const variantsByRole = new Map();
    for (const [role, spec] of Object.entries(TOMB_COMPONENTS)) {
        const variants = [];
        for (const name of spec.names) {
            const raw = rawByName.get(name);
            const template = sanitizedByName.get(name);
            const markerTemplate = markerPreservingByName.get(name);
            const block = luaMapBlock(source, name);
            const expectedWarnings = name === 'tomb_3_rune_grunt_doroklohe'
                ? [
                    ...spec.warnings,
                    'Lua helper tomb_3_khufu is not statically safe: unsupported kmons()'
                ]
                : spec.warnings;
            const markerGlyphs = role === 'tomb_1_hall_stairs'
                ? ['P']
                : role === 'tomb_2_ambush' ? ['R'] : [];
            const entryAnchorPoints = templateGlyphPoints(
                markerTemplate,
                markerGlyphs
            );
            if (!raw || !template || !markerTemplate
                || !warningSetMatches(
                    raw.metadata?.parseWarnings,
                    expectedWarnings
                )
                || template.metadata?.parseWarnings?.length
                || markerTemplate.width !== template.width
                || markerTemplate.height !== template.height
                || (markerGlyphs.length && !entryAnchorPoints.length)
                || !sourceTombComponentIsSafe(block, template, role)) {
                return [];
            }
            variants.push({
                name: template.name,
                width: template.width,
                height: template.height,
                grid: template.grid,
                tags: [...templateTags(template)],
                roles: [role],
                entryAnchorPoints
            });
        }
        variantsByRole.set(role, variants);
    }

    const composites = [];
    for (const spec of masterSpecs) {
        const raw = rawByName.get(spec.name);
        const master = sanitizedByName.get(spec.name);
        const markerMaster = markerPreservingByName.get(spec.name);
        const block = luaMapBlock(source, spec.name);
        const rows = mapRowsFromBlock(block);
        const slots = spec.slots.map(definition =>
            tombSlotDefinition(rows, definition));
        const markerEntryAnchorPoints = templateGlyphPoints(
            markerMaster,
            spec.markerEntryAnchorGlyphs
        );
        if (!raw || !master || !markerMaster || !block
            || !sourceTombMasterIsSafe(source, spec.name)
            || !warningSetMatches(
                raw.metadata?.parseWarnings,
                TOMB_MASTER_WARNINGS[spec.name]
            )
            || master.metadata?.parseWarnings?.length
            || !master.metadata?.encompass
            || master.width !== spec.width
            || master.height !== spec.height
            || markerMaster.width !== spec.width
            || markerMaster.height !== spec.height
            || (spec.markerEntryAnchorGlyphs.length
                && !markerEntryAnchorPoints.length)
            || rows.length !== spec.height
            || rows.some(row => row.length !== spec.width)
            || slots.some(slot => !slot)) {
            return [];
        }
        const slotGlyphs = new Set(spec.slots.map(slot => slot.id));
        let shellGrid = master.grid.map((row, y) => row.map((cell, x) =>
            slotGlyphs.has(rows[y]?.[x])
                ? {...cell, kinds: [], certain: false}
                : cell));
        shellGrid = maskGridGlyphs(shellGrid, spec.dynamicGlyphs);
        const variants = spec.slots.flatMap(slot =>
            variantsByRole.get(slot.role));
        composites.push({
            ...master,
            grid: shellGrid,
            metadata: {
                ...master.metadata,
                place: spec.place,
                parseWarnings: [],
                entryAnchorGlyphs: [...spec.entryAnchorGlyphs],
                ...(spec.entryAnchorObservedKind
                    ? {entryAnchorObservedKind: spec.entryAnchorObservedKind}
                    : {}),
                sourceAudit: 'tomb-fixed-composite-v1',
                matchPolicy: {...BRANCH_END_MATCH_POLICY},
                composite: {
                    type: 'fixed-subvaults-v1',
                    slots,
                    variants,
                    variantPolicy: {...TOMB_COMPOSITE_SUBVAULT_MATCH_POLICY},
                    borderFillKind: 'wall',
                    shellEntryAnchorGlyphs: [...spec.shellEntryAnchorGlyphs],
                    entryAnchorPoints: markerEntryAnchorPoints
                }
            }
        });
    }
    return composites;
}

function sourceSlimeEndHelperIsSafe(source) {
    const helper = luaFunctionRegion(source, 'setup_slime_pit_ending');
    if (!helper) {
        return false;
    }
    const methods = calledEntryMethods(helper);
    const compact = helper.replace(/\s+/gu, ' ');
    return methodMultisetMatches(methods, SLIME_END_HELPER_METHODS)
        && literalStringCallMatches(helper, 'place', 'Slime:$')
        && literalStringCallMatches(helper, 'orient', 'encompass')
        && /e\.kfeat\(["']Z\s*=\s*altar_jiyva["']\)/u.test(compact)
        && /e\.shuffle\(["']\{\[\(["']\)/u.test(compact)
        && !/\be\.(?:clear|nsubst|subst|subvault)\s*\(/u.test(helper);
}

function auditedSlimeEndTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/slime.des')
        || !sourceSlimeEndHelperIsSafe(source)) {
        return [];
    }
    const originalByName = new Map(parsed.map(template => [template.name, template]));
    const sanitized = parseDes(
        stripHelperCalls(source, ['setup_slime_pit_ending']),
        options
    );
    return sanitized.flatMap(template => {
        const original = originalByName.get(template.name);
        const block = luaMapBlock(source, template.name);
        if (!block
            || !original
            || !warningSetMatches(
                original.metadata?.parseWarnings,
                SLIME_END_WARNINGS
            )
            || (block.match(/setup_slime_pit_ending\s*\(/gu) || []).length !== 1
            || template.metadata?.parseWarnings?.length
            || template.width !== original.width
            || template.height !== original.height) {
            return [];
        }
        const shuffledUpstairs = new Set(['{', '[', '(']);
        const grid = template.grid.map(row => row.map(cell => {
            if (!cell) {
                return cell;
            }
            if (shuffledUpstairs.has(cell.glyph)) {
                // setup_slime_pit_ending() shuffles the three numbered stone
                // upstairs. The helper is stripped before parsing, so restore
                // that exact audited possibility set explicitly. Keep the
                // anchor for placement diagnostics only: a shaft can enter
                // Slime:5 on an ordinary floor, so level entry alone does not
                // certify which numbered stair generated.
                return {
                    ...cell,
                    possibleGlyphs: [...shuffledUpstairs]
                };
            }
            if (cell.glyph === 'Z') {
                return {
                    ...cell,
                    kinds: ['altar'],
                    certain: true
                };
            }
            return cell;
        }));
        return [{
            ...template,
            grid,
            metadata: {
                ...template.metadata,
                place: 'Slime:$',
                orient: 'encompass',
                encompass: true,
                entryAnchorGlyph: '{',
                parseWarnings: [],
                sourceAudit: 'slime-end-coarse-terrain-v1',
                matchPolicy: {
                    ...BRANCH_END_MATCH_POLICY,
                    revealDisabled: true
                }
            }
        }];
    });
}

function zotConditionalEntranceIsCoarseFloor(source) {
    const block = luaMapBlock(source, 'hall_of_Zot');
    if (!block) {
        return false;
    }
    const conditional = block.match(
        /^: if crawl\.one_chance_in\(4\) then$([\s\S]*?)^: end$/mu
    )?.[1];
    if (!conditional) {
        return false;
    }
    const compact = conditional.replace(/\s+/gu, ' ');
    const directives = conditional.match(/\b(?:NSUBST|SUBST|kfeat)\b/gu) || [];
    return directives.length === 4
        && /NSUBST:\s*H\s*=\s*1:\^\s*\/\s*\*\s*=\s*\^'/u.test(compact)
        && /SUBST:\s*D\s*=\s*'/u.test(compact)
        && /kfeat\(["']oO\s*=\s*["']\s*\.\./u.test(compact)
        && /SUBST:\s*D\s*=\s*\^''\s*,\s*O\s*=\s*d\s*,\s*o\s*=\s*'/u
            .test(compact)
        && !/(?:wall|water|lava|statue|door|portal)/iu.test(conditional);
}

function sourceZotEntryHelperIsSafe(dependencies) {
    const helper = luaFunctionRegion(
        dependencies?.[VAULT_LUA_PATH],
        'zot_entry_setup'
    );
    if (!helper) {
        return false;
    }
    const methods = calledEntryMethods(helper);
    const compact = helper.replace(/\s+/gu, ' ');
    return methodMultisetMatches(methods, ZOT_ENTRY_HELPER_METHODS)
        && literalStringCallMatches(helper, 'tags', 'zot_entry')
        && literalStringCallMatches(helper, 'place', 'Depths:$')
        && literalStringCallMatches(helper, 'orient', 'float')
        && /e\.kfeat\(["']O\s*=\s*enter_zot["']\)/u.test(compact)
        && /e\.kfeat\(["']Z\s*=\s*zot_statue["']\)/u.test(compact)
        && !/\be\.(?:clear|nsubst|shuffle|subst|subvault)\s*\(/u.test(helper);
}

function auditedDepthsZotEntryTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/zot.des')
        || !sourceZotEntryHelperIsSafe(options?.dependencies)) {
        return [];
    }
    const simpleWarnings = ['Unknown Lua helper zot_entry_setup(_G)'];
    const gauntletWarnings = [
        'KMONS directive appears inside Lua control flow',
        ...simpleWarnings
    ];
    const originalByName = new Map(parsed.map(template => [template.name, template]));
    const sanitizedSource = stripHelperCalls(source, ['zot_entry_setup'])
        .replace(
            /^KMONS:\s*8\s*=\s*(?:storm dragon|quicksilver dragon)\s*$/gmu,
            ''
        );
    return parseDes(sanitizedSource, options).flatMap(template => {
        const original = originalByName.get(template.name);
        const block = luaMapBlock(source, template.name);
        const warnings = original?.metadata?.parseWarnings;
        if (!original
            || template.name === 'zot_entry_small'
            || !block
            || (block.match(/zot_entry_setup\s*\(/gu) || []).length !== 1
            || (!warningSetMatches(warnings, simpleWarnings)
                && !warningSetMatches(warnings, gauntletWarnings))
            || template.metadata?.parseWarnings?.length
            || template.metadata?.encompass
            || template.width !== original.width
            || template.height !== original.height) {
            return [];
        }
        const grid = template.grid.map(row => row.map(cell => {
            if (!cell || (cell.glyph !== 'O' && cell.glyph !== 'Z')) {
                return cell;
            }
            return {
                ...cell,
                kinds: [cell.glyph === 'O' ? 'portal' : 'statue'],
                certain: true
            };
        }));
        const tags = new Set([...(template.metadata?.tags || []), 'zot_entry']);
        return [{
            ...template,
            grid,
            metadata: {
                ...template.metadata,
                tags: [...tags],
                place: 'Depths:$',
                orient: 'float',
                partial: true,
                presenceKey: 'place:Depths:$',
                parseWarnings: [],
                sourceAudit: 'depths-zot-entry-v1',
                matchPolicy: {...DEPTHS_ZOT_ENTRY_MATCH_POLICY}
            }
        }];
    });
}

function auditedZotEndTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    const original = parsed.find(template => template.name === 'hall_of_Zot');
    if (!path.endsWith('/branches/zot.des')
        || !original
        || !warningSetMatches(original.metadata?.parseWarnings, ZOT_END_WARNINGS)
        || !zotConditionalEntranceIsCoarseFloor(source)) {
        return [];
    }
    const sanitizedSource = String(source).replace(
        /^: if crawl\.one_chance_in\(4\) then$[\s\S]*?^: end$/mu,
        ''
    );
    const template = parseDes(sanitizedSource, options)
        .find(candidate => candidate.name === 'hall_of_Zot');
    if (!template
        || template.metadata?.parseWarnings?.length
        || template.width !== 80
        || template.height !== 36
        || template.metadata?.place !== 'Zot:$'
        || template.metadata?.orient !== 'north') {
        return [];
    }
    const grid = template.grid.map(row => row.map(cell => {
        if (!cell || cell.glyph !== 'Z') {
            return cell;
        }
        // Orb dais has no stable coarse WebTiles analogue in the parser.
        return {...cell, kinds: [], certain: false};
    }));
    return [{
        ...template,
        grid,
        metadata: {
            ...template.metadata,
            partial: true,
            presenceKey: 'place:Zot:$',
            parseWarnings: [],
            sourceAudit: 'zot-end-primary-v1',
            matchPolicy: {...ZOT_END_MATCH_POLICY}
        }
    }];
}

function panLordHelperIsTerrainSafe(source) {
    const match = String(source || '').match(
        /function\s+pan_lord_setup\s*\(\s*_G\b[^)]*\)([\s\S]*?)\nend\s*\n\s*colours\s*=/u
    );
    if (!match) {
        return false;
    }
    const body = match[1];
    const methods = [...body.matchAll(/\b_G\.([A-Za-z_]\w*)\s*\(/gu)]
        .map(call => call[1]);
    if (!methodMultisetMatches(methods, PAN_LORD_HELPER_METHODS)) {
        return false;
    }

    // The only local geometry mutation changes '&' among three glyphs which
    // all have the same coarse terrain class (floor). Keep this deliberately
    // strict so an upstream helper change disables partial inference.
    const compact = body.replace(/\s+/gu, ' ');
    const safeSubst = /_G\.subst\(\s*["']&\s*=\s*\.["']\s*\)/u;
    const safeNsubst = /_G\.nsubst\(\s*["']&\s*=\s*["']\s*\.\.\s*count_pan_runes\(\)\s*\.\.\s*["']:&\s*\/\s*\*:`["']\s*\)/u;
    if (!/_G\.tags\(\s*["']unrand["']\s*\)/u.test(compact)
        || !safeSubst.test(compact) || !safeNsubst.test(compact)) {
        return false;
    }

    // post_place may add a separate decor vault, but collision checking keeps
    // it off the primary vault's non-space MMT_VAULT footprint.
    const dgnCalls = [...body.matchAll(/\bdgn\.([A-Za-z_]\w*)\s*(?:\(|\{)/gu)]
        .map(call => call[1]);
    return dgnCalls.length === 1
        && dgnCalls[0] === 'place_maps'
        && /_G\.hook\(\s*["']post_place["']/u.test(body);
}

function warningsAreAuditedPanLordWarnings(template) {
    const warnings = template?.metadata?.parseWarnings;
    return Array.isArray(warnings)
        && warnings.length === PAN_LORD_HELPER_WARNINGS.size
        && warnings.every(warning => PAN_LORD_HELPER_WARNINGS.has(warning));
}

function partialPanLordTemplates(source, parsed, options) {
    const path = String(options?.path || '');
    if (!path.endsWith('/branches/pan.des')
        || !panLordHelperIsTerrainSafe(source)) {
        return [];
    }

    const auditedByName = new Map(parsed
        .filter(warningsAreAuditedPanLordWarnings)
        .map(template => [template.name, template]));
    const withoutSetupCalls = String(source).replace(
        /^\s*:?[ \t]*pan_lord_setup\s*\(\s*_G\b[^\n]*$/gmu,
        ''
    );
    return parseDes(withoutSetupCalls, options).flatMap(template => {
        const tags = templateTags(template);
        const lordTag = Object.values(PAN_LORDS).find(tag =>
            tags.has(tag) && tags.has(`uniq_${tag}`));
        const audited = auditedByName.get(template.name);
        if (!lordTag || !audited
            || audited.width !== template.width
            || audited.height !== template.height
            || audited.metadata?.orient !== template.metadata?.orient
            || template.metadata?.encompass
            || template.metadata?.parseWarnings?.length) {
            return [];
        }
        return [{
            ...template,
            metadata: {
                ...template.metadata,
                partial: true,
                lordTag,
                sourceAudit: 'pan-lord-primary-v1',
                matchPolicy: {...PAN_LORD_MATCH_POLICY}
            }
        }];
    });
}

export function parseRuntimeDes(source, options = {}) {
    const parsed = parseDes(source, options);
    const sprintMaps = auditedSprintDestinationTemplates(
        source,
        parsed,
        options
    );
    // Sprint is exact-source-only. A recognized path with a changed hash or
    // failed audit must never fall back to the generic encompass parser.
    if (sprintMaps !== null) {
        return sprintMaps;
    }
    if (String(options?.path || '').endsWith(
        '/dat/des/portals/ziggurat.des'
    )) {
        // The MAP body is intentionally empty; terrain is generated by the
        // exact-version ziggurat.lua dependency. Never fall through to a
        // static portal-map approximation when that source audit fails.
        return auditedZigguratTemplates(source, parsed, options);
    }
    const templeMaps = auditedTempleDestinationTemplates(
        source,
        parsed,
        options
    );
    const wizlabMaps = auditedWizlabTemplates(source, parsed, options);
    const elfEndMaps = auditedElfEndTemplates(source, parsed, options);
    const elfBladesMaps = auditedElfBladesTemplates(source, parsed, options);
    const hellVestibuleMaps = auditedHellVestibuleTemplates(
        source,
        parsed,
        options
    );
    const shoalsEndMaps = auditedShoalsEndTemplates(
        source,
        parsed,
        options
    );
    const portalMaps = parsePortalDestinationTemplates(
        source,
        parsed,
        options
    );
    let hellEndMaps = auditedHellEndTemplates(source, parsed, options);
    const initialFullMapsBeforeShoals = templeMaps ?? wizlabMaps
        ?? (portalMaps.length
        ? []
        : selectSafeTemplates(parsed));
    const shoalsEndNames = new Set(shoalsEndMaps.map(template =>
        template.name));
    const initialFullMaps = initialFullMapsBeforeShoals.filter(template =>
        !shoalsEndNames.has(template.name));
    const branchEndMaps = auditedBranchEndFamilyTemplates(
        source,
        parsed,
        options,
        [
            ...initialFullMaps,
            ...elfEndMaps,
            ...elfBladesMaps,
            ...hellEndMaps,
            ...shoalsEndMaps
        ]
    );
    const cocFamilyIsComplete = branchEndMaps.some(template =>
        template?.metadata?.sourceAudit
            === 'hell-end-coc-cove-static-terrain-v1');
    if (cocFamilyIsComplete) {
        hellEndMaps = hellEndMaps.map(template => {
            if (template?.metadata?.place !== 'Coc:$') {
                return template;
            }
            const matchPolicy = {...template.metadata.matchPolicy};
            delete matchPolicy.revealDisabled;
            return {
                ...template,
                metadata: {...template.metadata, matchPolicy}
            };
        });
    }
    const branchEndNames = new Set([
        ...elfEndMaps,
        ...elfBladesMaps,
        ...branchEndMaps
    ].map(template => template.name));
    const fullMaps = initialFullMaps.filter(template =>
        !branchEndNames.has(template.name));
    const runtime = [
        ...fullMaps,
        ...portalMaps,
        ...elfEndMaps,
        ...elfBladesMaps,
        ...hellVestibuleMaps,
        ...shoalsEndMaps,
        ...branchEndMaps,
        ...hellEndMaps,
        ...auditedVaultsEndCompositeTemplates(source, parsed, options),
        ...auditedTombCompositeTemplates(source, parsed, options),
        ...auditedSlimeEndTemplates(source, parsed, options),
        ...auditedDepthsZotEntryTemplates(source, parsed, options),
        ...auditedZotEndTemplates(source, parsed, options),
        ...partialPanLordTemplates(source, parsed, options)
    ];
    return runtime;
}

function parseSafeDes(source, options) {
    return parseRuntimeDes(source, options);
}

function playerLevelKey(player) {
    const place = typeof player?.place === 'string' ? player.place : '';
    if (!place.trim() || !Number.isInteger(player?.depth)) {
        return null;
    }
    return `${place}\u0000${player.depth}`;
}

function hasExplicitPlayerLevel(player) {
    return typeof player?.place === 'string' && Boolean(player.place.trim())
        && Number.isInteger(player?.depth);
}

export function isSprintCandidateScope(player) {
    // Live WebTiles player packets use the pseudo-level Dungeon:0 for every
    // Sprint. Ordinary Dungeon starts at depth 1. This received packet field
    // opens only the audited source catalog; it does not establish identity,
    // placement, or readiness. Lobby hashes, game ids, chat text, and server
    // metadata must not influence this scope.
    return hasExplicitPlayerLevel(player)
        && player.place === 'Dungeon'
        && player.depth === 0;
}

export function templateSelectionPlayer(player) {
    if (!isSprintCandidateScope(player)) {
        return player;
    }
    // Sprint WebTiles reports its pseudo-D:1 as depth 0.
    // DES selectors are authored in Crawl's one-based `D:1` notation, so
    // normalize only the immutable selector view; keep the wire snapshot in
    // this.player untouched for diagnostics.
    return {
        ...(player || {}),
        place: 'Dungeon',
        depth: 1
    };
}

function resultSummary(result) {
    const best = result?.best;
    if (!best) {
        return null;
    }
    return {
        name: best.template?.name || null,
        path: best.template?.path || null,
        score: best.score,
        evidenceCells: best.evidenceCells,
        evidenceWeight: best.evidenceWeight,
        distinctKinds: best.distinctKinds,
        coverage: best.coverage,
        spanXRatio: best.spanXRatio,
        spanYRatio: best.spanYRatio,
        observedKinds: Array.isArray(best.observedKinds)
            ? [...best.observedKinds]
            : [],
        requiredKindsReady: best.requiredKindsReady,
        focusReady: best.focusReady,
        transform: best.transform,
        placementSearch: best.placementSearch,
        offsetX: best.offsetX,
        offsetY: best.offsetY,
        margin: result.margin,
        unique: result.unique
    };
}

export default class MapPredictorRuntime {
    static name = MODULE_NAME;
    static version = '0.2';
    static dependencies = ['IOHook', 'CommandManager', 'RCManager'];
    static description = '(Alpha) Infers fixed maps and injects client-only magic-mapped terrain.';

    constructor(options = {}) {
        this.dwem = options.dwem || globalThis.DWEM;
        this.window = options.window || globalThis.window;
        this.document = options.document || globalThis.document;
        this.runtimeOptions = {...options};
        this.eagerRuntime = options.eagerRuntime === true
            || Boolean(options.repository || options.matcher || options.adapter);
        this.rcEnabled = this.eagerRuntime;
        this.runtimeEnabled = false;
        this.runtimeIntegrationsInstalled = false;
        this.runtimeAbortController = null;
        this.rcHandlerInstalled = false;
        this.hotkeyInstalled = false;
        this.statusSubscribers = new Set();
        this.pausedMatch = null;
        this.pausedResultReason = null;
        this.resumeContext = null;
        this.status = 'idle';
        this.error = null;
        this.repository = null;
        this.matcher = null;
        this.matcherOptions = {};
        this.webtilesAdapter = null;
        this.result = null;
        this.versionText = null;
        this.build = null;
        this.manifest = null;
        this.runtimeDependencies = {};
        this.gameSession = 0;
        this.autoRevealApplied = false;
        this.player = {};
        this.levelSignals = {};
        this.awaitingLevelEntry = false;
        this.entryTransitionPending = false;
        this.pendingLevelEntry = null;
        this.pendingLevelEntryFromPlace = null;
        this.levelKey = null;
        this.sourceKey = null;
        this.sourcePaths = [];
        this.templates = [];
        this.loadGeneration = 0;
        this.versionGeneration = 0;
        this.levelGeneration = 0;
        this.templateGeneration = 0;
        this.workerRequestId = 0;
        this.pendingWorkerRequestId = null;
        this.workerEvaluationQueued = false;
        this.observationRevision = 0;
        this.evaluationTimer = null;
        this.notificationFingerprint = null;
        this.forceRevealActive = false;
        this.commandsRegistered = false;
        this.destroyed = false;
        this.evaluationDelay = options.evaluationDelay ?? EVALUATION_DELAY_MS;
        this.maxTemplates = options.maxTemplates ?? DEFAULT_MAX_TEMPLATES;
        this.syncMaxTemplates = options.syncMaxTemplates
            ?? DEFAULT_SYNC_MAX_TEMPLATES;
        this.timerApi = options.timerApi || globalThis;
        const explicitlyConfiguredWorker = Object.prototype.hasOwnProperty.call(
            options,
            'useWorker'
        );
        this.workerAllowed = explicitlyConfiguredWorker
            ? options.useWorker !== false
            : !options.matcher;
        this.workerOptions = options.workerOptions || {};
        this.workerFactory = options.workerFactory || (callbacks =>
            new MatcherWorkerClient({
                ...this.workerOptions,
                ...callbacks
            }));
        this.workerClient = null;
        this.workerFallback = false;
        this.workerStatus = this.workerAllowed ? 'idle' : 'disabled';
        this.workerFailure = null;
        this.handleRuntimeHotkey = event => {
            if (!this.rcEnabled || event?.repeat || !event?.ctrlKey
                || event?.altKey || event?.metaKey) {
                return;
            }
            const key = String(event?.key || '').toLowerCase();
            if (event?.code !== HOTKEY_CODE && key !== 'm') {
                return;
            }
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
            if (this.runtimeEnabled) {
                this.deactivateRuntime({status: 'paused', releaseBinding: false});
                this.sendLocalMessage('<b>[MapPredictor]</b> Disabled for this game. Press <b>Ctrl-M</b> to enable it.');
            } else {
                this.activateRuntime({resume: true});
                this.sendLocalMessage('<b>[MapPredictor]</b> Enabled for this game.');
            }
        };
        if (this.eagerRuntime) {
            this.initializeRuntime();
            this.runtimeEnabled = true;
        }
    }

    onLoad() {
        if (this.eagerRuntime) {
            this.activateRuntime();
            return;
        }
        const rcManager = this.dwem?.Modules?.RCManager;
        if (!rcManager?.addHandlers) {
            throw new Error('MapPredictor requires RCManager.');
        }
        rcManager.addHandlers(RC_HANDLER_ID, {
            onGameInitialize: rcfile => {
                const enabled = rcManager.getRCOption(
                    rcfile,
                    'map_predictor',
                    'boolean',
                    false
                ) === true;
                this.applyRcEnabled(enabled);
            },
            onGameEnd: () => {
                this.endGame();
            }
        });
        this.rcHandlerInstalled = true;
        this.status = 'disabled-by-rc';
        this.emitStatus();
    }

    initializeRuntime() {
        if (this.repository && this.matcher && this.webtilesAdapter) {
            return;
        }
        const options = this.runtimeOptions;
        if (!this.runtimeAbortController
            || this.runtimeAbortController.signal.aborted) {
            this.runtimeAbortController = new AbortController();
        }
        this.repository = options.repositoryFactory?.()
            || options.repository
            || new SourceRepository({
                parserVersion: options.parserVersion || PARSER_VERSION,
                ...(options.repositoryOptions || {})
            });
        const matcherOptions = {
            // Production reveal must never treat a truncated heuristic
            // placement search as proof of uniqueness. Explicit entry-glyph
            // anchors enumerate every legal glyph placement; unsupported
            // unanchored inventories remain visible in diagnostics only.
            requireExhaustivePlacement: true,
            ...readMatcherOptions(options.storage),
            ...(options.matcherOptions || {})
        };
        this.matcher = options.matcherFactory?.(matcherOptions)
            || options.matcher
            || new MapMatcher(matcherOptions);
        this.matcherOptions = {...(this.matcher.options || matcherOptions)};
        const retainedAdapter = this.webtilesAdapter;
        this.webtilesAdapter = options.adapter
            || retainedAdapter
            || options.adapterFactory?.(this)
            || new WebtilesAdapter(this, {
                dwem: this.dwem,
                lateSourceMapperInstallation: true,
                ...(options.adapterOptions || {})
            });
        this.webtilesAdapter.owner = this;
        this.result = this.matcher.getResult();
        this.workerClient = null;
        this.workerFallback = false;
        this.workerStatus = this.workerAllowed ? 'idle' : 'disabled';
        this.workerFailure = null;
        this.error = null;
    }

    applyRcEnabled(enabled) {
        this.rcEnabled = Boolean(enabled);
        if (!this.rcEnabled) {
            this.removeHotkey();
            this.deactivateRuntime({
                status: 'disabled-by-rc',
                releaseBinding: true,
                clearPausedMatch: true
            });
            this.clearSessionState();
            this.emitStatus();
            return false;
        }
        if (this.runtimeEnabled) {
            // RCManager invokes this at a real game-initialization boundary.
            // Rebuild every map-bearing runtime resource so a same-version
            // play/watch transition cannot inherit cells, templates, pending
            // source work, or entry provenance from the previous game.
            this.deactivateRuntime({
                status: 'restarting-game',
                releaseBinding: false,
                clearPausedMatch: true
            });
        }
        this.installHotkey();
        this.activateRuntime({newSession: true});
        return true;
    }

    activateRuntime({newSession = false, resume = false} = {}) {
        if ((!this.rcEnabled && !this.eagerRuntime) || this.destroyed) {
            return false;
        }
        const alreadyEnabled = this.runtimeEnabled;
        this.runtimeEnabled = true;
        this.initializeRuntime();
        const context = resume ? this.resumeContext : null;
        if (newSession) {
            this.gameSession++;
            this.autoRevealApplied = false;
        }
        if (!this.runtimeIntegrationsInstalled) {
            try {
                this.registerCommands();
                this.webtilesAdapter.install();
                this.runtimeIntegrationsInstalled = true;
            } catch (error) {
                this.fail('activation-error', error);
                this.deactivateRuntime({
                    status: 'activation-error',
                    releaseBinding: true
                });
                return false;
            }
        }
        this.status = 'waiting-for-version';
        if (context?.player?.place) {
            this.onPlayer(context.player);
        }
        if (resume && this.webtilesAdapter?.binding) {
            const cells = this.webtilesAdapter.rehydrateKnowledge?.() || [];
            if (cells.length > 0) {
                this.onKnowledge(cells, this.webtilesAdapter.binding);
            }
        }
        if (context?.versionText) {
            this.onVersion(context.versionText);
        }
        this.resumeContext = null;
        this.emitStatus();
        return !alreadyEnabled;
    }

    deactivateRuntime({
        status = 'paused',
        releaseBinding = false,
        clearPausedMatch = false
    } = {}) {
        if (!this.runtimeEnabled) {
            if (releaseBinding) {
                this.webtilesAdapter?.destroy({releaseBinding: true});
                this.webtilesAdapter = null;
                this.resumeContext = null;
            }
            this.status = status;
            if (clearPausedMatch) {
                this.pausedMatch = null;
                this.pausedResultReason = null;
            }
            this.emitStatus();
            return false;
        }
        this.pausedMatch = clearPausedMatch ? null : resultSummary(this.result);
        this.pausedResultReason = clearPausedMatch
            ? null
            : (this.result?.reason || null);
        this.resumeContext = releaseBinding ? null : {
            versionText: this.versionText,
            player: {
                place: this.player?.place,
                depth: this.player?.depth,
                pos: this.player?.pos ? {...this.player.pos} : undefined,
                name: this.player?.name,
                turn: this.player?.turn
            }
        };
        this.runtimeEnabled = false;
        if (this.runtimeAbortController
            && !this.runtimeAbortController.signal.aborted) {
            const abortError = new Error('MapPredictor runtime disabled');
            abortError.name = 'AbortError';
            this.runtimeAbortController.abort(abortError);
        }
        this.runtimeAbortController = null;
        this.versionGeneration++;
        this.loadGeneration++;
        this.levelGeneration++;
        this.templateGeneration++;
        this.observationRevision++;
        this.cancelEvaluation();
        this.stopMatcherWorker(status === 'destroyed' ? 'destroyed' : 'paused');
        this.unregisterCommands();
        this.webtilesAdapter?.destroy({releaseBinding});
        void this.repository?.cache?.close?.();
        this.matcher?.reset?.({keepTemplates: false});
        this.repository = null;
        this.matcher = null;
        this.matcherOptions = {};
        if (releaseBinding) {
            this.webtilesAdapter = null;
        }
        this.runtimeIntegrationsInstalled = false;
        this.versionText = null;
        this.build = null;
        this.manifest = null;
        this.runtimeDependencies = {};
        this.player = {};
        this.levelSignals = {};
        this.awaitingLevelEntry = false;
        this.entryTransitionPending = false;
        this.pendingLevelEntry = null;
        this.pendingLevelEntryFromPlace = null;
        this.levelKey = null;
        this.sourceKey = null;
        this.sourcePaths = [];
        this.templates = [];
        this.result = null;
        this.forceRevealActive = false;
        this.autoRevealApplied = false;
        this.status = status;
        this.error = null;
        this.emitStatus();
        return true;
    }

    installHotkey() {
        if (this.hotkeyInstalled) {
            return;
        }
        this.document?.addEventListener?.(
            'keydown',
            this.handleRuntimeHotkey,
            true
        );
        this.hotkeyInstalled = true;
    }

    removeHotkey() {
        if (!this.hotkeyInstalled) {
            return;
        }
        this.document?.removeEventListener?.(
            'keydown',
            this.handleRuntimeHotkey,
            true
        );
        this.hotkeyInstalled = false;
    }

    clearSessionState() {
        this.gameSession = 0;
        this.autoRevealApplied = false;
        this.levelKey = null;
        this.levelSignals = {};
        this.entryTransitionPending = false;
        this.awaitingLevelEntry = false;
        this.pendingLevelEntry = null;
        this.pendingLevelEntryFromPlace = null;
        this.resumeContext = null;
        this.pausedMatch = null;
        this.pausedResultReason = null;
        this.notificationFingerprint = null;
    }

    endGame() {
        this.deactivateRuntime({
            status: 'waiting-for-game',
            releaseBinding: true,
            clearPausedMatch: true
        });
        this.rcEnabled = false;
        this.removeHotkey();
        this.clearSessionState();
        this.emitStatus();
    }

    subscribeStatus(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('MapPredictor status listener must be a function.');
        }
        this.statusSubscribers.add(listener);
        listener(this.getDebugState());
        return () => {
            this.statusSubscribers.delete(listener);
        };
    }

    emitStatus() {
        if (this.statusSubscribers.size === 0) {
            return;
        }
        const state = this.getDebugState();
        for (const listener of this.statusSubscribers) {
            try {
                listener(structuredClone(state));
            } catch (error) {
                console.error('[MapPredictor] status listener failed', error);
            }
        }
    }

    registerCommands() {
        if (this.commandsRegistered) {
            return;
        }
        const commandManager = this.dwem?.Modules?.CommandManager;
        if (!commandManager) {
            throw new Error('MapPredictor requires CommandManager.');
        }

        commandManager.addCommand('/reveal', [], () => this.toggleReveal(), {
            module: MODULE_NAME,
            description: 'Toggle safe inferred terrain in the client map'
        });
        commandManager.addCommand('/force_reveal', [], () => {
            this.toggleForceReveal();
        }, {
            module: MODULE_NAME,
            description: 'Toggle unsafe mapping of the current best candidate'
        });
        commandManager.addCommand('/reveal_status', [], () => {
            this.sendRevealStatusMessage();
        }, {
            module: MODULE_NAME,
            description: 'Show detailed fixed-map match and reveal status'
        });
        commandManager.addCommand('/map_predictor status', [], () => {
            this.sendRevealStatusMessage();
        }, {
            module: MODULE_NAME,
            description: 'Show map prediction status',
            aliases: ['/automap status']
        });
        commandManager.addCommand('/map_predictor reload', [], () => {
            void this.reloadSources();
        }, {
            module: MODULE_NAME,
            description: 'Reload map sources from the immutable cache',
            aliases: ['/automap reload']
        });
        this.commandsRegistered = true;
    }

    unregisterCommands() {
        if (!this.commandsRegistered) {
            return;
        }
        const commandManager = this.dwem?.Modules?.CommandManager;
        commandManager?.removeCommandsByModule?.(MODULE_NAME);
        this.commandsRegistered = false;
    }

    onVersion(text) {
        if (!this.runtimeEnabled || !this.repository
            || typeof text !== 'string' || !text.trim()) {
            return;
        }
        if (text === this.versionText && (this.build
            || this.status === 'resolving-version')) {
            return;
        }
        const firstVersion = this.versionText === null && this.build === null;
        this.versionText = text;
        this.loadGeneration++;
        this.build = null;
        this.manifest = null;
        this.runtimeDependencies = {};
        this.awaitingLevelEntry = false;
        this.entryTransitionPending = false;
        this.pendingLevelEntry = null;
        // A reconnect can deliver player/map packets before the first version
        // packet reaches this freshly loaded module. Those terrain samples
        // belong to the current level and must survive initial source
        // resolution. A later version change still invalidates everything.
        if (!firstVersion) {
            this.resetLevel({keepTemplates: false, keepReveal: false});
        }
        void this.prepareVersion(text);
    }

    async prepareVersion(text) {
        if (!this.runtimeEnabled || !this.repository) {
            return;
        }
        const generation = ++this.versionGeneration;
        const repository = this.repository;
        const signal = this.runtimeAbortController?.signal;
        this.status = 'resolving-version';
        this.error = null;
        this.emitStatus();
        try {
            const build = await repository.prepare(text, {signal});
            const manifest = await repository.getManifest(build, {signal});
            if (generation !== this.versionGeneration || this.destroyed
                || !this.runtimeEnabled || !this.repository) {
                return;
            }
            const changed = Boolean(this.build)
                && this.build.revision !== build.revision;
            this.build = build;
            this.manifest = manifest;
            if (changed) {
                this.sourceKey = null;
                this.sourcePaths = [];
                this.templates = [];
                this.runtimeDependencies = {};
                this.templateGeneration++;
                this.levelGeneration++;
                this.observationRevision++;
                this.stopMatcherWorker(
                    this.workerFallback
                        ? 'fallback'
                        : (this.workerAllowed ? 'idle' : 'disabled')
                );
                this.matcher.reset({keepTemplates: false});
                this.result = this.matcher.getResult();
                this.webtilesAdapter.clearPredictions();
            }
            this.status = 'version-ready';
            this.emitStatus();
            await this.ensureSources();
        } catch (error) {
            if (generation !== this.versionGeneration || this.destroyed
                || !this.runtimeEnabled) {
                return;
            }
            this.fail('version-error', error);
        }
    }

    onPlayer(player) {
        if (!this.runtimeEnabled || !this.matcher) {
            return;
        }
        const previousPlace = normalizeBranch(this.player?.place);
        this.player = {...this.player, ...(player || {})};
        const sprintCandidateScope = isSprintCandidateScope(this.player);
        const nextLevelKey = playerLevelKey(this.player);
        const focus = Number.isInteger(this.player?.pos?.x)
            && Number.isInteger(this.player?.pos?.y)
            ? {x: this.player.pos.x, y: this.player.pos.y}
            : null;
        const previousFocus = this.matcher.focusPosition;
        if (nextLevelKey && nextLevelKey !== this.levelKey) {
            const transitionIsTrusted = !sprintCandidateScope
                && this.levelKey !== null;
            this.levelKey = nextLevelKey;
            // A first attach or reconnect also sends player + map-clear, but
            // its current position is not necessarily an entry stair. Only a
            // level-key transition observed by this live module can certify
            // that the following clear belongs to a real level entry.
            this.levelSignals = {};
            this.entryTransitionPending = transitionIsTrusted;
            this.pendingLevelEntry = transitionIsTrusted && focus
                ? {...focus}
                : null;
            this.pendingLevelEntryFromPlace = transitionIsTrusted
                ? previousPlace
                : null;
            this.awaitingLevelEntry = transitionIsTrusted && !focus;
            this.resetLevel({
                keepTemplates: false,
                keepReveal: false,
                resetAutoReveal: true
            });
            this.matcher.setFocusPosition(focus, {evaluate: false});
            void this.ensureSources();
            return;
        }
        if (this.entryTransitionPending && this.awaitingLevelEntry && focus) {
            this.awaitingLevelEntry = false;
            this.pendingLevelEntry = {...focus};
            this.matcher.setFocusPosition(focus, {evaluate: false});
            return;
        }
        const focusChanged = previousFocus?.x !== focus?.x
            || previousFocus?.y !== focus?.y;
        if (focusChanged) {
            this.matcher.setFocusPosition(focus, {evaluate: false});
            this.observationRevision++;
            if (this.templates.some(template =>
                template?.metadata?.matchPolicy?.requireFocusInFootprint)) {
                this.scheduleEvaluation();
            }
        }
    }

    onMap({clear, touched, raw} = {}) {
        if (!this.runtimeEnabled || !this.matcher) {
            return;
        }
        if (clear) {
            const trustedEntry = this.entryTransitionPending
                && Number.isInteger(this.pendingLevelEntry?.x)
                && Number.isInteger(this.pendingLevelEntry?.y)
                ? {...this.pendingLevelEntry}
                : null;
            const trustedEntryFromPlace = trustedEntry
                ? this.pendingLevelEntryFromPlace
                : null;
            const signalBoundTemplates = Boolean(trustedEntry)
                || Object.keys(this.levelSignals).length > 0
                || this.templates.some(template => template?.metadata?.partial
                    || template?.metadata?.matchAnchor);
            const focus = Number.isInteger(this.player?.pos?.x)
                && Number.isInteger(this.player?.pos?.y)
                ? {x: this.player.pos.x, y: this.player.pos.y}
                : null;
            // WebTiles sends a new-level player packet before map clear. The
            // pending position is committed only for a level transition we
            // observed; same-level resyncs and wizard recreation clear stale
            // anchors instead of trusting the player's arbitrary position.
            this.levelSignals = trustedEntry
                ? {
                    levelEntry: trustedEntry,
                    ...(trustedEntryFromPlace
                        ? {levelEntryFromPlace: trustedEntryFromPlace}
                        : {})
                }
                : {};
            this.entryTransitionPending = false;
            this.pendingLevelEntry = null;
            this.pendingLevelEntryFromPlace = null;
            this.awaitingLevelEntry = false;
            this.resetLevel({
                keepTemplates: !signalBoundTemplates,
                keepReveal: false
            });
            this.matcher.setFocusPosition(focus, {evaluate: false});
            if (signalBoundTemplates) {
                void this.ensureSources({force: true});
            }
        }
    }

    onMessages(messages) {
        if (!this.runtimeEnabled || !this.matcher) {
            return;
        }
        let invalidated = false;
        for (const message of messages || []) {
            const text = String(message?.text || '').replace(/<[^>]*>/gu, ' ')
                .replace(/\s+/gu, ' ')
                .trim();
            if (/stone walls suddenly crumble and collapse[.!]/iu.test(text)
                && normalizeBranch(this.player?.place) === 'slime'
                && Number(this.player?.depth) === BRANCH_END_DEPTHS.slime) {
                invalidated = true;
            }
        }
        if (!invalidated) {
            return;
        }
        const next = {
            ...this.levelSignals,
            ...(invalidated ? {invalidated: true} : {})
        };
        if (JSON.stringify(next) === JSON.stringify(this.levelSignals)) {
            return;
        }
        this.levelSignals = next;
        if (invalidated) {
            // Terrain-changing events revoke client knowledge immediately.
            // Do not wait for source/cache work: a slow or failed reload must
            // never leave pre-collapse Slime walls injected in mapKnowledge.
            // Resetting the level also makes an in-flight worker result stale.
            this.resetLevel({keepTemplates: false, keepReveal: false});
        }
        this.sourceKey = null;
        const reload = this.ensureSources({force: true});
        if (invalidated) {
            this.status = 'no-safe-templates';
        }
        void reload;
    }

    onKnowledge(cells, binding) {
        if (!this.runtimeEnabled || !this.matcher || !this.webtilesAdapter) {
            return;
        }
        const updates = normalizeWebtilesKnowledgeUpdates(
            cells,
            binding || this.webtilesAdapter.binding || {}
        );
        const sourceCells = new Map((cells || []).map(cell => [
            `${cell?.x},${cell?.y}`,
            cell
        ]));
        this.webtilesAdapter.rememberTerrainSamples?.(updates.flatMap(update => {
            if (update.removed || !update.kind) {
                return [];
            }
            const source = sourceCells.get(`${update.x},${update.y}`);
            return source?.cell ? [{kind: update.kind, cell: source.cell}] : [];
        }));
        if (!updates.length) {
            return;
        }
        const latestByCoordinate = new Map(updates.map(update => [
            `${update.x},${update.y}`,
            update
        ]));
        const removed = [];
        const upserts = [];
        for (const [key, update] of latestByCoordinate) {
            const previous = this.matcher.observations.get(key);
            if (update.removed) {
                if (previous) {
                    removed.push(update);
                }
            } else if (previous?.kind !== update.kind) {
                upserts.push(update);
            }
        }
        if (!removed.length && !upserts.length) {
            return;
        }
        this.matcher.removeObservations(
            removed,
            {evaluate: false}
        );
        this.matcher.updateObservations(
            upserts,
            {evaluate: false}
        );
        this.observationRevision++;
        // Keep validating an inferred map as new terrain arrives. A candidate
        // that looked unique in the first viewport can be disproved later;
        // retaining that stale overlay would be worse than withdrawing it.
        this.scheduleEvaluation();
    }

    onWebtilesBound() {
        if (this.runtimeEnabled) {
            this.webtilesAdapter?.scheduleRender();
        }
    }

    onRevealChanged() {
        // Exposed as a callback for the adapter; no server state is changed.
        this.emitStatus();
    }

    workerEnvelope() {
        return {
            versionGeneration: this.versionGeneration,
            levelGeneration: this.levelGeneration,
            templateGeneration: this.templateGeneration
        };
    }

    isWorkerActive() {
        return Boolean(this.workerClient && !this.workerFallback);
    }

    stopMatcherWorker(nextStatus = null) {
        const client = this.workerClient;
        this.workerClient = null;
        this.workerToken = null;
        this.pendingWorkerRequestId = null;
        this.workerEvaluationQueued = false;
        client?.terminate?.();
        if (nextStatus) {
            this.workerStatus = nextStatus;
        }
    }

    startMatcherWorker() {
        if (!this.runtimeEnabled || !this.matcher
            || !this.workerAllowed || this.workerFallback || this.destroyed) {
            return false;
        }

        const token = {};
        this.workerToken = token;
        try {
            const client = this.workerFactory({
                onMessage: message => {
                    if (this.workerToken === token) {
                        this.handleWorkerMessage(message);
                    }
                },
                onError: error => {
                    if (this.workerToken === token) {
                        this.activateSyncFallback(error);
                    }
                }
            });
            if (!client || typeof client.postMessage !== 'function') {
                throw new Error('Invalid matcher worker client.');
            }
            this.workerClient = client;
            this.workerStatus = 'starting';
            return true;
        } catch (error) {
            this.workerToken = null;
            this.workerFailure = {
                code: error?.code || error?.name || 'worker-unavailable',
                message: error?.message || String(error)
            };
            this.workerFallback = true;
            this.workerStatus = 'fallback';
            return false;
        }
    }

    configureMatcher(templates) {
        this.templateGeneration++;
        this.stopMatcherWorker();
        this.result = this.matcher.emptyResult();

        if (!templates.length) {
            this.result = this.matcher.setTemplates([]);
            if (!this.workerFallback) {
                this.workerStatus = this.workerAllowed ? 'idle' : 'disabled';
            }
            return this.result;
        }

        if (this.startMatcherWorker()) {
            this.workerStatus = 'configuring';
            try {
                this.workerClient.postMessage({
                    type: 'configure',
                    ...this.workerEnvelope(),
                    options: this.matcherOptions,
                    templates
                });
            } catch (error) {
                return this.activateSyncFallback(error, {applyResult: false});
            }
            if (this.matcher.observations.size > 0) {
                this.scheduleEvaluation();
            }
            return this.result;
        }

        this.result = this.matcher.setTemplates(templates);
        return this.result;
    }

    activateSyncFallback(error, {applyResult = true} = {}) {
        if (this.destroyed || !this.runtimeEnabled || !this.matcher) {
            return this.result;
        }
        this.stopMatcherWorker();
        this.workerFallback = true;
        this.workerStatus = 'fallback';
        this.workerFailure = {
            code: error?.code || error?.name || 'worker-error',
            message: error?.message || String(error)
        };
        this.levelGeneration++;
        if (this.templates.length > this.syncMaxTemplates) {
            this.result = this.matcher.setTemplates([]);
            this.webtilesAdapter.clearPredictions();
            this.status = 'worker-required';
            return this.result;
        }
        try {
            this.result = this.matcher.setTemplates(this.templates);
            if (applyResult) {
                this.handleResult(this.result);
            }
        } catch (fallbackError) {
            this.webtilesAdapter.clearPredictions();
            this.fail('matcher-error', fallbackError);
        }
        return this.result;
    }

    workerMessageIsCurrent(message) {
        return message?.versionGeneration === this.versionGeneration
            && message?.levelGeneration === this.levelGeneration
            && message?.templateGeneration === this.templateGeneration;
    }

    workerConfigurationIsCurrent(message) {
        return message?.versionGeneration === this.versionGeneration
            && message?.templateGeneration === this.templateGeneration;
    }

    handleWorkerMessage(message) {
        if (!message || this.destroyed || !this.runtimeEnabled
            || !this.matcher) {
            return;
        }
        if (message.type === 'configured') {
            if (this.workerConfigurationIsCurrent(message)) {
                this.workerStatus = this.workerEvaluationQueued
                    ? 'queued'
                    : (this.pendingWorkerRequestId === null
                        ? 'ready'
                        : 'evaluating');
            }
            return;
        }
        if (message.type === 'error') {
            const current = message.phase === 'configure'
                ? this.workerConfigurationIsCurrent(message)
                : this.workerMessageIsCurrent(message);
            if (current) {
                this.activateSyncFallback(message.error || new Error('Matcher worker failed.'));
            } else if (message.phase === 'evaluate'
                && message.requestId === this.pendingWorkerRequestId) {
                const rerun = this.workerEvaluationQueued;
                this.pendingWorkerRequestId = null;
                this.workerEvaluationQueued = false;
                this.workerStatus = 'ready';
                if (rerun && this.isWorkerActive()) {
                    this.scheduleEvaluation();
                }
            }
            return;
        }
        if (message.type !== 'result'
            || message.requestId !== this.pendingWorkerRequestId) {
            return;
        }

        const current = this.workerMessageIsCurrent(message)
            && message.observationRevision === this.observationRevision;
        const rerun = this.workerEvaluationQueued || !current;
        this.pendingWorkerRequestId = null;
        this.workerEvaluationQueued = false;
        this.workerStatus = 'ready';

        if (current && message.result && typeof message.result === 'object') {
            this.handleResult(message.result);
        } else if (current) {
            this.activateSyncFallback(new Error('Invalid matcher worker result.'));
            return;
        }
        if (rerun && this.isWorkerActive()) {
            this.scheduleEvaluation();
        }
    }

    requestWorkerEvaluation() {
        if (!this.runtimeEnabled || !this.matcher
            || !this.isWorkerActive()) {
            return false;
        }
        if (this.pendingWorkerRequestId !== null) {
            this.workerEvaluationQueued = true;
            this.workerStatus = 'queued';
            return true;
        }

        const requestId = ++this.workerRequestId;
        this.pendingWorkerRequestId = requestId;
        this.workerEvaluationQueued = false;
        this.workerStatus = 'evaluating';
        try {
            this.workerClient.postMessage({
                type: 'evaluate',
                ...this.workerEnvelope(),
                observationRevision: this.observationRevision,
                requestId,
                observations: [...this.matcher.observations.values()],
                volatileObservations: [
                    ...(this.matcher.volatileObservations || [])
                ],
                focusPosition: this.matcher.focusPosition
                    ? {...this.matcher.focusPosition}
                    : null
            });
        } catch (error) {
            this.pendingWorkerRequestId = null;
            this.activateSyncFallback(error);
        }
        return true;
    }

    evaluateMatcher() {
        if (!this.runtimeEnabled || !this.matcher) {
            return null;
        }
        if (this.requestWorkerEvaluation()) {
            return null;
        }
        return this.matcher.evaluate();
    }

    resetLevel({
        keepTemplates = true,
        keepReveal = false,
        resetAutoReveal = false
    } = {}) {
        this.cancelEvaluation();
        this.levelGeneration++;
        this.observationRevision++;
        this.workerEvaluationQueued = false;
        this.matcher.reset({keepTemplates});
        this.result = this.matcher.getResult();
        this.notificationFingerprint = null;
        this.forceRevealActive = false;
        if (resetAutoReveal) {
            this.autoRevealApplied = false;
        }
        this.webtilesAdapter.clearPredictions();
        if (!keepReveal) {
            this.webtilesAdapter.setRevealEnabled(false);
        }
        if (!keepTemplates) {
            this.templateGeneration++;
            this.stopMatcherWorker(
                this.workerFallback ? 'fallback' : (this.workerAllowed ? 'idle' : 'disabled')
            );
            this.sourceKey = null;
            this.sourcePaths = [];
            this.templates = [];
        }
        this.emitStatus();
    }

    async ensureSources({force = false} = {}) {
        if (!this.runtimeEnabled || !this.repository || !this.matcher
            || !this.build || !this.manifest || !this.player?.place
            || !hasExplicitPlayerLevel(this.player) || this.destroyed) {
            return;
        }
        const paths = this.repository.selectPaths(
            this.manifest,
            this.player.place,
            this.player.depth
        );
        const desiredKey = `${this.build.revision}\u0000${this.player.place}`
            + `\u0000${this.player.depth}\u0000${paths.join('|')}`
            + `\u0000${JSON.stringify(this.levelSignals)}`
            + `\u0000${this.gameSession}`;
        if (!force && desiredKey === this.sourceKey) {
            return;
        }

        const generation = ++this.loadGeneration;
        const repository = this.repository;
        const signal = this.runtimeAbortController?.signal;
        this.sourceKey = desiredKey;
        this.sourcePaths = paths;
        this.error = null;
        if (!paths.length) {
            this.templates = [];
            this.result = this.configureMatcher([]);
            this.status = 'unsupported-place';
            this.webtilesAdapter.clearPredictions();
            this.emitStatus();
            return;
        }

        this.status = 'loading-sources';
        this.emitStatus();
        try {
            const auxiliaryPaths = Array.isArray(this.manifest?.auxiliaryPaths)
                ? this.manifest.auxiliaryPaths
                : [];
            const dependencyEntries = typeof repository.getAuxiliarySource === 'function'
                ? await Promise.all(auxiliaryPaths.map(async path => [
                    path,
                    await repository.getAuxiliarySource(
                        this.build,
                        path,
                        {signal}
                    )
                ]))
                : [];
            const dependencies = Object.fromEntries(dependencyEntries);
            const parsedGroups = await Promise.all(paths.map(path =>
                repository.getParsed(
                    this.build,
                    path,
                    (source, options) => parseSafeDes(source, {
                        ...options,
                        dependencies
                    }),
                    {signal}
                )));
            if (generation !== this.loadGeneration || this.destroyed
                || !this.runtimeEnabled || !this.matcher) {
                return;
            }
            this.runtimeDependencies = dependencies;
            const parsedTemplates = parsedGroups.flat();
            const auditedTemplates = isSprintCandidateScope(this.player)
                ? selectAuditedSprintCatalog(parsedTemplates)
                : parsedTemplates;
            const selectorPlayer = templateSelectionPlayer(this.player);
            const templates = materializeZigguratTemplates(
                selectSafeTemplates(
                    auditedTemplates,
                    selectorPlayer,
                    this.levelSignals
                ),
                selectorPlayer
            );
            const candidateLimit = (!this.workerAllowed || this.workerFallback)
                ? Math.min(this.maxTemplates, this.syncMaxTemplates)
                : this.maxTemplates;
            if (templates.length > candidateLimit) {
                this.templates = [];
                this.result = this.configureMatcher([]);
                this.status = 'too-many-candidates';
                this.webtilesAdapter.clearPredictions();
                this.emitStatus();
                return;
            }
            this.templates = templates;
            this.result = this.configureMatcher(templates);
            this.status = templates.length ? 'matching' : 'no-safe-templates';
            this.handleResult(this.result);
        } catch (error) {
            if (generation !== this.loadGeneration || this.destroyed
                || !this.runtimeEnabled) {
                return;
            }
            this.fail('source-error', error);
        }
    }

    scheduleEvaluation() {
        if (!this.runtimeEnabled || !this.matcher
            || this.evaluationTimer !== null || this.destroyed) {
            return;
        }
        const setTimer = this.timerApi?.setTimeout?.bind(this.timerApi)
            || globalThis.setTimeout.bind(globalThis);
        this.evaluationTimer = setTimer(() => {
            this.evaluationTimer = null;
            const result = this.evaluateMatcher();
            if (result) {
                this.handleResult(result);
            }
        }, this.evaluationDelay);
    }

    cancelEvaluation() {
        if (this.evaluationTimer === null) {
            return;
        }
        const clearTimer = this.timerApi?.clearTimeout?.bind(this.timerApi)
            || globalThis.clearTimeout.bind(globalThis);
        clearTimer(this.evaluationTimer);
        this.evaluationTimer = null;
    }

    handleResult(result) {
        if (!this.runtimeEnabled || !this.matcher || !this.webtilesAdapter) {
            return;
        }
        this.result = result;
        if (this.forceRevealActive) {
            const forced = Array.isArray(result?.forcePredictions)
                ? result.forcePredictions
                : [];
            if (!result?.best || !forced.length) {
                this.forceRevealActive = false;
                this.webtilesAdapter.clearPredictions();
                this.webtilesAdapter.setRevealEnabled(false);
                if (this.templates.length) {
                    this.status = 'matching';
                }
                this.emitStatus();
                return;
            }
            const confidence = result.best?.score ?? 0;
            this.webtilesAdapter.setPredictions(forced.map(cell => ({
                ...cell,
                confidence
            })));
            this.webtilesAdapter.setRevealEnabled(true);
            this.status = 'map-forced';
            this.emitStatus();
            return;
        }
        if (!result?.ready || !result.predictions?.length) {
            this.webtilesAdapter.clearPredictions();
            if (this.templates.length) {
                this.status = 'matching';
            }
            this.emitStatus();
            return;
        }

        const confidence = result.best?.score ?? 1;
        this.webtilesAdapter.setPredictions(result.predictions.map(cell => ({
            ...cell,
            confidence
        })));
        this.status = 'map-inferred';

        const best = result.best;
        const autoAppliedNow = this.autoRevealApplied === false;
        if (autoAppliedNow) {
            // Latch before touching the adapter. A render/binding callback can
            // synchronously trigger another matcher result, and must not apply
            // automatic reveal twice. The latch belongs to this level, not to
            // a transform or winner fingerprint. Manual /reveal OFF therefore
            // remains respected until a real level/runtime transition.
            this.autoRevealApplied = true;
            this.webtilesAdapter.setRevealEnabled(true);
        }
        const fingerprint = [
            this.levelKey,
            best?.template?.path,
            best?.template?.name,
            best?.transform,
            best?.offsetX,
            best?.offsetY
        ].join('|');
        if (fingerprint === this.notificationFingerprint) {
            this.emitStatus();
            return;
        }
        this.notificationFingerprint = fingerprint;
        const name = escapeHtml(best?.template?.name || 'fixed map');
        const percentage = Math.round(confidence * 1000) / 10;
        this.sendLocalMessage(
            `<b>[MapPredictor]</b> ${name} matched (${percentage}%). `
            + (autoAppliedNow
                ? 'Automatically mapped; type <b>/reveal</b> to hide it.'
                : 'Type <b>/reveal</b> to magic-map the inferred terrain.')
        );
        this.emitStatus();
    }

    toggleReveal() {
        if (!this.runtimeEnabled || !this.webtilesAdapter) {
            return false;
        }
        if (!this.result?.ready || !this.webtilesAdapter.predictions.length) {
            const detail = this.result?.reason === 'anchor-unverified'
                ? ' The terrain matched, but the arrival square was not the map portal; use /force_reveal for an explicit best-effort placement.'
                : this.result?.reason === 'placement-unverified'
                    ? ' The source matched, but its position has not been exhaustively verified.'
                : this.result?.reason === 'policy-disabled'
                    ? ' This map family is detection-only until its dynamic alternatives are fully verified.'
                    : '';
            this.sendLocalMessage(
                '<b>[MapPredictor]</b> No safely revealable fixed-map match yet.'
                + detail
            );
            return false;
        }
        const enabled = this.webtilesAdapter.toggleReveal();
        this.sendLocalMessage(
            `<b>[MapPredictor]</b> Inferred terrain ${enabled ? 'mapped in the client' : 'cleared from the client map'}.`
        );
        this.emitStatus();
        return enabled;
    }

    toggleForceReveal() {
        if (!this.runtimeEnabled || !this.webtilesAdapter) {
            return false;
        }
        if (this.forceRevealActive) {
            this.forceRevealActive = false;
            this.webtilesAdapter.setRevealEnabled(false);
            this.webtilesAdapter.clearPredictions();
            this.autoRevealApplied = false;
            // Keep a safe result ready for a later normal /reveal command.
            this.handleResult(this.result);
            this.sendLocalMessage(
                '<b>[MapPredictor]</b> Forced terrain cleared from the client map.'
            );
            this.emitStatus();
            return false;
        }

        const predictions = Array.isArray(this.result?.forcePredictions)
            ? this.result.forcePredictions
            : [];
        if (!this.result?.best) {
            this.sendLocalMessage(
                '<b>[MapPredictor]</b> No candidate placement is available to force.'
            );
            return false;
        }
        if (!predictions.length) {
            const name = escapeHtml(
                this.result.best?.template?.name || 'matched candidate'
            );
            this.sendLocalMessage(
                `<b>[MapPredictor]</b> ${name} matched, but there are no `
                + 'unrevealed inferred cells left to force.'
            );
            return false;
        }

        this.forceRevealActive = true;
        const confidence = this.result.best?.score ?? 0;
        this.webtilesAdapter.setPredictions(predictions.map(cell => ({
            ...cell,
            confidence
        })));
        this.webtilesAdapter.setRevealEnabled(true);
        this.status = 'map-forced';
        const name = escapeHtml(
            this.result.best?.template?.name || 'unknown candidate'
        );
        const percentage = (confidence * 100).toFixed(1);
        const reason = escapeHtml(this.result.reason || 'unknown');
        const ambiguous = Number(this.result.plausibleCandidateCount) > 1
            || Number(this.result.margin) < this.matcherOptions.minWinnerMargin;
        this.sendLocalMessage(
            `<b>[MapPredictor] UNSAFE FORCE${ambiguous ? ' / AMBIGUOUS' : ''}:</b> `
            + `${name} (${percentage}%, `
            + `${reason}) mapped ${predictions.length} inferred cells. `
            + 'The placement may be wrong; type <b>/force_reveal</b> again to undo it.'
        );
        this.emitStatus();
        return true;
    }

    async reloadSources() {
        if (!this.runtimeEnabled || !this.matcher || !this.webtilesAdapter) {
            return;
        }
        if (!this.build || !this.manifest) {
            this.sendLocalMessage('<b>[MapPredictor]</b> Crawl version is not ready yet.');
            return;
        }
        // Source reload is not a level transition. WebTiles will not resend
        // the already-known map cells, so clearing observations here leaves
        // the matcher empty until the player happens to receive new deltas.
        // Invalidate templates/workers and native predictions while retaining
        // the real server evidence, volatile-cell set, focus, and level-entry
        // signal accumulated for this level.
        this.cancelEvaluation();
        this.loadGeneration++;
        this.templateGeneration++;
        this.stopMatcherWorker(
            this.workerFallback
                ? 'fallback'
                : (this.workerAllowed ? 'idle' : 'disabled')
        );
        this.notificationFingerprint = null;
        this.forceRevealActive = false;
        this.webtilesAdapter.clearPredictions();
        this.templates = [];
        this.sourceKey = null;
        this.sourcePaths = [];
        this.result = this.matcher.setTemplates([]);
        await this.ensureSources({force: true});
        this.sendStatusMessage();
        this.emitStatus();
    }

    sendStatusMessage() {
        const summary = this.getDebugState();
        const candidateLabel = summary.resultReason === 'ready'
            ? 'match'
            : 'unaccepted candidate';
        const score = summary.match
            ? `, ${candidateLabel} ${escapeHtml(summary.match.name)} `
                + `${(summary.match.score * 100).toFixed(1)}%`
            : '';
        const reason = summary.resultReason
            ? `, reason ${escapeHtml(summary.resultReason)}`
            : '';
        const error = summary.error ? `, error ${escapeHtml(summary.error.code)}` : '';
        this.sendLocalMessage(
            `<b>[MapPredictor]</b> ${escapeHtml(summary.status)}; `
            + `${summary.templates.length} fixed-map candidates, `
            + `${summary.observationCount} observed cells${score}${reason}${error}.`
        );
    }

    sendRevealStatusMessage() {
        const summary = this.getDebugState();
        const match = summary.match;
        if (!match) {
            this.sendLocalMessage(
                `<b>[MapPredictor]</b> ${escapeHtml(summary.status)}; `
                + `${summary.templates.length} candidates, `
                + `${summary.observationCount} observed cells, `
                + `reason ${escapeHtml(summary.resultReason || 'not-evaluated')}.`
            );
            return;
        }

        const score = Number.isFinite(match.score)
            ? `${(match.score * 100).toFixed(2)}%`
            : 'n/a';
        const margin = Number.isFinite(match.margin)
            ? `${(match.margin * 100).toFixed(2)}%`
            : 'n/a';
        const coverage = Number.isFinite(match.coverage)
            ? `${(match.coverage * 100).toFixed(1)}%`
            : 'n/a';
        const candidateLabel = summary.resultReason === 'ready'
            ? 'accepted match'
            : 'unaccepted candidate';
        this.sendLocalMessage(
            `<b>[MapPredictor]</b> ${candidateLabel} `
            + `${escapeHtml(match.name || 'unknown')} `
            + `(${score}, margin ${margin}); evidence ${match.evidenceCells ?? 0} cells, `
            + `${match.distinctKinds ?? 0} kinds, coverage ${coverage}; `
            + `transform ${escapeHtml(match.transform || 'unknown')} `
            + `(${escapeHtml(match.placementSearch || 'unknown')} placement) `
            + `@ ${match.offsetX ?? '?'},${match.offsetY ?? '?'}; `
            + `${summary.plausibleCandidateCount} plausible, `
            + `${summary.safePredictionCount} safe / ${summary.forcePredictionCount} force cells; `
            + `reason ${escapeHtml(summary.resultReason || 'unknown')}, `
            + `forced ${summary.forceRevealActive ? 'on' : 'off'}.`
        );
    }

    sendLocalMessage(content) {
        this.dwem?.Modules?.CommandManager?.sendChatMessage?.(content);
    }

    fail(status, error) {
        if (!this.runtimeEnabled) {
            return;
        }
        this.status = status;
        this.error = {
            code: error?.code || error?.name || 'error',
            message: error?.message || String(error)
        };
        console.error('[MapPredictor]', error);
        this.emitStatus();
    }

    getDebugState() {
        const activeMatch = resultSummary(this.result);
        const match = activeMatch || (!this.runtimeEnabled
            ? this.pausedMatch
            : null);
        return {
            rcEnabled: this.rcEnabled,
            runtimeEnabled: this.runtimeEnabled,
            status: this.status,
            versionText: this.versionText,
            revision: this.build?.revision || null,
            fullSha: this.build?.fullSha || null,
            player: {
                place: this.player?.place ?? null,
                depth: this.player?.depth ?? null,
                pos: this.player?.pos ? {...this.player.pos} : null
            },
            levelKey: this.levelKey,
            gameSession: this.gameSession,
            autoRevealApplied: this.autoRevealApplied,
            levelSignals: structuredClone(this.levelSignals),
            sourcePaths: [...this.sourcePaths],
            templates: this.templates.map(template => template.name),
            observationCount: this.matcher?.observations?.size ?? 0,
            predictionCount: this.webtilesAdapter?.predictions?.length ?? 0,
            safePredictionCount: Array.isArray(this.result?.predictions)
                ? this.result.predictions.length
                : 0,
            forcePredictionCount: Array.isArray(this.result?.forcePredictions)
                ? this.result.forcePredictions.length
                : 0,
            plausibleCandidateCount: this.result?.plausibleCandidateCount ?? 0,
            revealEnabled: this.webtilesAdapter?.revealEnabled ?? false,
            forceRevealActive: this.forceRevealActive,
            resultReason: this.result?.reason
                || (!this.runtimeEnabled ? this.pausedResultReason : null),
            match,
            workerActive: this.isWorkerActive(),
            workerStatus: this.workerStatus,
            worker: {
                active: this.isWorkerActive(),
                status: this.workerStatus,
                mode: this.workerClient?.mode || null,
                failure: this.workerFailure ? {...this.workerFailure} : null
            },
            error: this.error ? {...this.error} : null
        };
    }

    destroy() {
        this.deactivateRuntime({
            status: 'destroyed',
            releaseBinding: true,
            clearPausedMatch: true
        });
        this.destroyed = true;
        this.rcEnabled = false;
        this.clearSessionState();
        this.removeHotkey();
        if (this.rcHandlerInstalled) {
            this.dwem?.Modules?.RCManager?.removeHandlers?.(RC_HANDLER_ID);
        }
        this.rcHandlerInstalled = false;
        this.emitStatus();
        this.statusSubscribers.clear();
    }
}
