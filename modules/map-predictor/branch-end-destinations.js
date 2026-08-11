import {parseDes} from './des-parser.js';

const BRANCH_DES_PATH = /\/dat\/des\/branches\/[^/]+\.des$/u;
const ELF_DES_PATH = /\/dat\/des\/branches\/elf\.des$/u;
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const AUDITED_BRANCH_END_PATHS = Object.freeze([
    '/dat/des/branches/crypt.des',
    '/dat/des/branches/depths.des',
    '/dat/des/branches/depths_encompass.des',
    '/dat/des/branches/dis.des',
    '/dat/des/branches/lair.des',
    '/dat/des/branches/orc.des',
    '/dat/des/branches/coc.des',
    '/dat/des/branches/shoals.des',
    '/dat/des/branches/snake.des',
    '/dat/des/branches/spider.des',
    '/dat/des/branches/swamp.des',
    '/dat/des/branches/tar.des'
]);
const DEPTHS_ENTRY_PATH = /\/dat\/des\/branches\/depths\.des$/u;

const ELF_COARSE_WARNINGS = Object.freeze([
    'Lua helper elf_loot_defenders is not statically safe: unsupported kmons()',
    'Lua helper elf_loot_randomisation is not statically safe: unsupported kitem()',
    'Lua helper elf_loot_randomisation is not statically safe: unsupported subst()',
    'Lua helper elf_loot_randomisation is not statically safe: unsupported nsubst()'
]);

const ELF_END_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.25,
    requiredKinds: ['wall', 'floor'],
    exhaustivePlacement: true,
    revealDisabled: true
    // Elf:$ end vaults are guaranteed PLACE primaries, but they occupy only
    // part of the generated level and have no player-entry glyph. The compact
    // correlation matcher now checks every legal translation, so status and
    // explicit /force_reveal diagnostics no longer depend on anchor sampling.
    // Normal reveal nevertheless remains disabled: unlike a composite
    // candidate, the generic matcher can discard an unresolved under-evidence
    // true placement before consensus. Exhaustive scoring alone does not
    // certify that omission; unresolved placements and procedural negative
    // terrain must both be represented soundly first.
});

const ELF_BLADES_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.05,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor'],
    requireFocusInFootprint: true,
    exhaustivePlacement: true
});

const ELF_BLADES_ENTRY_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    minEvidenceCells: 24,
    minEvidenceWeight: 28,
    minDistinctKinds: 2,
    minCoverage: 0.1,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor']
});

const ELF_BLADES_MAIN_NAMES = Object.freeze([
    'elven_hall_of_blades_hangedman_original',
    'elven_hall_of_blades_hangedman_alternative',
    'nicolae_elf_blades_crystal_corner',
    'nicolae_elf_blades_splatter_lattice'
]);

const ELF_BLADES_ENTRY_NAMES = Object.freeze([
    'mumra_blade_entry_bloodbath',
    'mumra_blade_entry_dagger',
    'infiniplex_blade_entry_pillars',
    'grunt_blade_entry_basic',
    'nicolae_vaults_blade_armed_guards',
    'nicolae_blade_entry_hurt_lockers',
    'nicolae_blade_entry_crossed_weapons',
    'nooodl_blade_entry_preview',
    'nicolae_blade_entry_diamond_columns',
    'nicolae_blade_entry_area_security',
    'nicolae_blade_entry_pointy_end',
    'nicolae_blade_entry_floor_patterns',
    'nicolae_blade_entry_splitting_headache',
    'nicolae_blade_entry_sentries_behind_glass',
    'nicolae_blade_entry_antechamber',
    'nicolae_blade_bullseye',
    'nicolae_blade_lattice',
    'nicolae_blade_little_rooms',
    'nicolae_blade_tridents'
]);

const ELF_BLADES_MAIN_SPECS = Object.freeze({
    elven_hall_of_blades_hangedman_original: Object.freeze({
        width: 65,
        height: 45,
        orient: 'north',
        setupGlyphs: '-',
        directives: Object.freeze({
            NAME: 1, ORIENT: 1, SUBST: 3, SHUFFLE: 1, NSUBST: 1,
            SUBVAULT: 1, CLEAR: 1
        }),
        warnings: Object.freeze([
            'Lua helper hall_of_blades_extra_rewards is not statically safe: unsupported kitem()',
            'SUBVAULT directives are not statically supported'
        ]),
        slot: Object.freeze({
            id: 'A', x: 26, y: 30, width: 13, height: 14,
            maskCells: 170, emptyKinds: Object.freeze([])
        })
    }),
    elven_hall_of_blades_hangedman_alternative: Object.freeze({
        width: 69,
        height: 31,
        orient: 'north',
        setupGlyphs: '-',
        directives: Object.freeze({
            NAME: 1, WEIGHT: 1, ORIENT: 1, SUBST: 3, SHUFFLE: 1,
            NSUBST: 1, SUBVAULT: 1, CLEAR: 1
        }),
        warnings: Object.freeze([
            'Lua helper hall_of_blades_extra_rewards is not statically safe: unsupported kitem()',
            'SUBVAULT directives are not statically supported'
        ]),
        slot: Object.freeze({
            id: 'A', x: 28, y: 11, width: 13, height: 14,
            maskCells: 170, emptyKinds: Object.freeze(['wall'])
        })
    }),
    nicolae_elf_blades_crystal_corner: Object.freeze({
        width: 46,
        height: 46,
        orient: 'northwest',
        setupGlyphs: '-~',
        directives: Object.freeze({
            NAME: 1, ORIENT: 1, KMONS: 1, SUBST: 5, SHUFFLE: 2,
            NSUBST: 1, CLEAR: 1
        }),
        warnings: Object.freeze([
            'Lua helper hall_of_blades_extra_rewards is not statically safe: unsupported kitem()',
            'SUBST directive appears inside Lua control flow',
            'SHUFFLE directive appears inside Lua control flow'
        ]),
        dynamicGlyphs: Object.freeze(['F', 'J', 'H'])
    }),
    nicolae_elf_blades_splatter_lattice: Object.freeze({
        width: 63,
        height: 34,
        orient: 'north',
        setupGlyphs: '7-',
        directives: Object.freeze({
            NAME: 1, ORIENT: 1, KMONS: 1, SUBST: 3, NSUBST: 1,
            SHUFFLE: 1, SUBVAULT: 1, CLEAR: 1
        }),
        warnings: Object.freeze([
            'Lua helper hall_of_blades_extra_rewards is not statically safe: unsupported kitem()',
            'SUBVAULT directives are not statically supported'
        ]),
        slot: Object.freeze({
            id: 'D', x: 48, y: 11, width: 14, height: 13,
            maskCells: 170, emptyKinds: Object.freeze(['wall'])
        })
    })
});

const DETECTION_ONLY_POLICY = Object.freeze({
    ...ELF_END_MATCH_POLICY,
    revealDisabled: true,
    forceRevealDisabled: true
});

const GENERIC_BRANCH_END_DETECTION_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor'],
    revealDisabled: true,
    forceRevealDisabled: true
});

const AUDITED_BRANCH_END_FORCE_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor'],
    revealDisabled: true,
    exhaustivePlacement: true
});

const UNSAFE_BRANCH_END_POLICY = Object.freeze({
    ...AUDITED_BRANCH_END_FORCE_POLICY,
    exhaustivePlacement: false,
    forceRevealDisabled: true
});

const COC_COVE_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.06,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.25,
    requiredKinds: ['wall', 'floor']
});

const COC_COVE_FAMILY_NAMES = Object.freeze([
    'coc_dpeg',
    'coc_old',
    'coc_mu',
    'coc_grunt',
    'coc_hangedman',
    'coc_grunt_cove'
]);

const COC_COVE_STATIC_SIBLINGS = Object.freeze(
    COC_COVE_FAMILY_NAMES.filter(name => name !== 'coc_grunt_cove')
);

const COC_COVE_SLOT_SPECS = Object.freeze({
    A: Object.freeze({x: 35, y: 14}),
    B: Object.freeze({x: 46, y: 9}),
    C: Object.freeze({x: 55, y: 13}),
    E: Object.freeze({x: 56, y: 20}),
    F: Object.freeze({x: 52, y: 25})
});

const COC_COVE_WARNINGS = Object.freeze([
    'Unknown Lua helper serpent_of_hell_setup(_G)',
    'SUBVAULT directives are not statically supported',
    'Lua helper coc_setup is not statically safe: unsupported kitem()',
    'Lua helper coc_setup is not statically safe: unsupported kmask()'
]);

const SHOALS_END_PATH = '/dat/des/branches/shoals.des';
const SHOALS_DIRECT_END_SPECS = Object.freeze({
    shoals_end_hellmonk_lost_city: Object.freeze({
        width: 62,
        height: 49,
        entryCells: 87,
        tags: Object.freeze([]),
        directives: Object.freeze({
            NAME: 1,
            ORIENT: 1,
            PLACE: 1,
            WEIGHT: 1,
            MONS: 1,
            KMONS: 2,
            KITEM: 3,
            SHUFFLE: 1,
            NSUBST: 3,
            SUBST: 3
        }),
        entryDirective:
            /^NSUBST:\s*'\s*=\s*1:\(\s*\/\s*1:\[\s*\/\s*1:\{\s*\/\s*2\s*=\s*<\.\.\s*\/\s*\*=P\.\.\.\.\.\.\s*$/mu
    }),
    shoals_end_hellmonk_holy_island: Object.freeze({
        width: 59,
        height: 58,
        entryCells: 4,
        tags: Object.freeze(['no_trap_gen']),
        directives: Object.freeze({
            NAME: 1,
            TAGS: 1,
            ORIENT: 1,
            PLACE: 1,
            WEIGHT: 1,
            MONS: 4,
            KMONS: 3,
            KITEM: 2,
            KFEAT: 4,
            SHUFFLE: 1,
            SUBST: 3,
            NSUBST: 4,
            TILE: 1,
            FTILE: 2
        }),
        entryDirective:
            /^NSUBST:\s*<\s*=\s*1:\(\s*\/\s*1:\[\s*\/\s*1:\{\s*\/\s*\*\s*=\s*<\s*$/mu
    })
});
const SHOALS_END_FAMILY_NAMES = Object.freeze([
    ...Object.keys(SHOALS_DIRECT_END_SPECS),
    'shoals_end_hellmonk_storm_palace'
]);
const SHOALS_END_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    plausibleMinScore: 0.965,
    plausibleSlack: 0.08,
    minEvidenceCells: 96,
    minEvidenceWeight: 110,
    minDistinctKinds: 2,
    minCoverage: 0.05,
    minSpanXRatio: 0.25,
    minSpanYRatio: 0.25,
    requiredKinds: ['wall', 'floor']
});

const HELL_VESTIBULE_PATH = '/dat/des/branches/hell.des';
const HELL_VESTIBULE_PARENT = 'vestibule_of_hell_subvaulted';
const HELL_VESTIBULE_PARENT_WARNINGS = Object.freeze([
    'SUBVAULT directives are not statically supported',
    'NSUBST directive appears inside Lua control flow',
    'SUBST directive appears inside Lua control flow'
]);
const HELL_VESTIBULE_LAVA_WARNINGS = Object.freeze([
    'Lua helper hell_lava_spawns is not statically safe: unsupported kmons()',
    'Lua helper hell_lava_spawns is not statically safe: unsupported kmask()',
    'Lua helper hell_lava_spawns is not statically safe: unsupported nsubst()'
]);
const HELL_VESTIBULE_WATER_WARNINGS = Object.freeze([
    'Lua helper hell_water_spawns is not statically safe: unsupported kmons()',
    'Lua helper hell_water_spawns is not statically safe: unsupported kmask()',
    'Lua helper hell_water_spawns is not statically safe: unsupported nsubst()'
]);
const HELL_VESTIBULE_SWIMMING_WARNINGS = Object.freeze([
    'KFEAT directive appears inside Lua control flow',
    'SUBST directive appears inside Lua control flow'
]);
const HELL_VESTIBULE_ROLES = Object.freeze({
    vestibule_dis: Object.freeze({
        slot: 'A',
        width: 33,
        height: 16,
        names: Object.freeze([
            'vestibule_dis_old',
            'vestibule_dis_mu',
            'vestibule_dis_nicolae_mini_city_of_dis',
            'vestibule_dis_grunt_castle',
            'vestibule_dis_nicolae_crystalline',
            'vestibule_dis_nicolae_girt_by_a_triple_wall',
            'vestibule_dis_nicolae_metal_as_hell'
        ])
    }),
    vestibule_tar: Object.freeze({
        slot: 'B',
        width: 33,
        height: 16,
        names: Object.freeze([
            'vestibule_tar_old',
            'vestibule_tar_mu',
            'vestibule_tar_nicolae_necropolis',
            'vestibule_tar_grunt_deathgaze',
            'vestibule_tar_nicolae_cwn_annwn',
            'vestibule_tar_nicolae_miasmatic',
            'vestibule_tar_nicolae_seven_gates_of_the_underworld'
        ])
    }),
    vestibule_coc: Object.freeze({
        slot: 'C',
        width: 33,
        height: 16,
        names: Object.freeze([
            'vestibule_coc_old',
            'vestibule_coc_mu',
            'vestibule_coc_nicolae_fridge_bridge',
            'vestibule_coc_grunt_go_with_the_floe',
            'vestibule_coc_nicolae_advancing_glacier',
            'vestibule_coc_nicolae_freezer_leak',
            'vestibule_coc_nicolae_polynya'
        ])
    }),
    vestibule_geh: Object.freeze({
        slot: 'D',
        width: 33,
        height: 16,
        names: Object.freeze([
            'vestibule_geh_old',
            'vestibule_geh_mu',
            'vestibule_geh_nicolae_lava_paths',
            'vestibule_geh_grunt_obsidian_fortress',
            'vestibule_geh_nicolae_gehenna_overflowing',
            'vestibule_geh_nicolae_lone_tower',
            'vestibule_geh_nicolae_tongues_of_flame'
        ])
    }),
    vestibule_geryon: Object.freeze({
        slot: 'E',
        width: 17,
        height: 17,
        names: Object.freeze([
            'vestibule_geryon_old',
            'vestibule_geryon_mu',
            'vestibule_geryon_nicolae_six_columns',
            'vestibule_geryon_nicolae_wayward_sun',
            'vestibule_geryon_grunt_focused',
            'vestibule_geryon_nicolae_amphitheater',
            'vestibule_geryon_nicolae_diamonds',
            'vestibule_geryon_nicolae_swimming_pool'
        ])
    })
});
const HELL_VESTIBULE_SLOT_SPECS = Object.freeze({
    A: Object.freeze({x: 12, y: 4, width: 33, height: 16, maskCells: 288}),
    B: Object.freeze({x: 12, y: 37, width: 33, height: 16, maskCells: 288}),
    C: Object.freeze({x: 4, y: 12, width: 16, height: 33, maskCells: 288}),
    D: Object.freeze({x: 37, y: 12, width: 16, height: 33, maskCells: 288}),
    E: Object.freeze({x: 20, y: 20, width: 17, height: 17, maskCells: 177})
});
const HELL_VESTIBULE_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    plausibleMinScore: 0.965,
    plausibleSlack: 0.08,
    minEvidenceCells: 72,
    minEvidenceWeight: 84,
    minDistinctKinds: 2,
    minCoverage: 0.05,
    minSpanXRatio: 0.2,
    minSpanYRatio: 0.2,
    requiredKinds: ['wall', 'floor']
});
const HELL_VESTIBULE_CHILD_MATCH_POLICY = Object.freeze({
    minScore: 0.995,
    plausibleMinScore: 0.95,
    plausibleSlack: 0.1,
    minEvidenceCells: 24,
    minEvidenceWeight: 28,
    minDistinctKinds: 2,
    minCoverage: 0.08,
    minSpanXRatio: 0.18,
    minSpanYRatio: 0.18,
    requiredKinds: ['wall', 'floor']
});

const LAIR_SMALL_ENDING_WARNINGS = Object.freeze([
    'Lua helper lair_small_ending is not statically safe: unsupported kitem()',
    'Lua helper lair_small_ending is not statically safe: unsupported hook()'
]);
const DEPTHS_ENTRY_WARNING =
    'Lua helper depths_entry is not statically safe: unsupported kitem()';

function templateTags(template) {
    const tags = template?.metadata?.tags ?? template?.tags ?? [];
    return new Set(Array.isArray(tags)
        ? tags
        : String(tags || '').split(/\s+/u).filter(Boolean));
}

function positivePlaceTerms(place) {
    return String(place || '').split(',')
        .map(term => term.trim())
        .filter(term => term && !term.startsWith('!'));
}

function isBranchEndPlace(place) {
    return positivePlaceTerms(place).some(term => /:\$$/u.test(term));
}

function normalizedBranchEndPlace(place) {
    return positivePlaceTerms(place).find(term => /:\$$/u.test(term)) || null;
}

function isElfEndPlace(place) {
    return positivePlaceTerms(place).some(term =>
        /^Elf:\$$/iu.test(term));
}

/**
 * Lists active primary PLACE branch-end maps directly from parsed DES.
 * Keeping this source-driven lets tests compare the generator's catalogue to
 * the runtime catalogue without maintaining a second list of vault names.
 */
export function naturalBranchEndPrimaries(parsed, path = null) {
    if (path && !BRANCH_DES_PATH.test(String(path))) {
        return [];
    }
    return (parsed || []).filter(template => {
        const tags = templateTags(template);
        return isBranchEndPlace(template?.metadata?.place)
            && !tags.has('removed')
            && !tags.has('unrand')
            && Array.isArray(template?.grid)
            && template.grid.length > 0;
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
    return closing
        ? remainder.slice(0, closing.index + closing[0].length)
        : null;
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

function methodMultisetMatches(region, expected) {
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
        && expectedEntries.every(([method, count]) =>
            counts.get(method) === count);
}

function hasUnexpectedLuaControl(region) {
    return /\b(?:if|elseif|else|for|while|repeat|until|do)\b/u
        .test(String(region || ''))
        || /\b(?:dgn|dgn_run_map|_G)\s*\./u.test(String(region || ''));
}

function randomisationSubstitutionsStayFloor(region) {
    const calls = [...String(region || '').matchAll(
        /\be\.(?:nsubst|subst)\(\s*(["'])([^"']*)\1\s*\)/gu
    )];
    return calls.length === 5 && calls.every(match =>
        // `$`, `*`, `|`, and `R` are item slots on ordinary floor. Digits and
        // punctuation here are only DES weights/count syntax. Any new glyph
        // fails this audit instead of being guessed terrain-neutral.
        /^[\s$*|R0-9:=/.]+$/u.test(match[2]));
}

function elfHelperAudit(source) {
    const setup = luaFunctionRegion(source, 'elf_setup');
    const monsters = luaFunctionRegion(source, 'elf_monsters');
    const defenders = luaFunctionRegion(source, 'elf_loot_defenders');
    const randomisation = luaFunctionRegion(source, 'elf_loot_randomisation');
    const sharedSafe = [setup, monsters].every(region =>
        region && !hasUnexpectedLuaControl(region))
        && methodMultisetMatches(setup, {tags: 1})
        && /\be\.tags\(\s*["']no_rotate["']\s*\)/u.test(setup)
        && methodMultisetMatches(monsters, {mons: 7});
    const lootSafe = [defenders, randomisation].every(region =>
        region && !hasUnexpectedLuaControl(region))
        && methodMultisetMatches(defenders, {kmons: 3})
        && methodMultisetMatches(randomisation, {
            kitem: 4,
            subst: 3,
            nsubst: 2
        })
        && randomisationSubstitutionsStayFloor(randomisation);
    return {sharedSafe, lootSafe};
}

function helperCallCount(block, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return (String(block || '').match(
        new RegExp(`(?:^|\\n)\\s*:?\\s*${escaped}\\s*\\(`, 'gu')
    ) || []).length;
}

function elfMapHelperMode(block, warnings) {
    const hasSharedCalls = helperCallCount(block, 'elf_setup') === 1
        && helperCallCount(block, 'elf_monsters') === 1;
    const defenders = helperCallCount(block, 'elf_loot_defenders');
    const randomisation = helperCallCount(block, 'elf_loot_randomisation');
    if (!hasSharedCalls || defenders !== randomisation
        || ![0, 1].includes(defenders)) {
        return null;
    }
    if (defenders === 0 && warningSetMatches(warnings, [])) {
        return 'direct';
    }
    if (defenders === 1
        && warningSetMatches(warnings, ELF_COARSE_WARNINGS)) {
        return 'loot-helpers';
    }
    return null;
}

function stripElfTerrainNeutralCalls(source) {
    return String(source).replace(
        /^\s*:?\s*(?:elf_loot_defenders|elf_loot_randomisation)\s*\(\s*_G\s*\)\s*$/gmu,
        ''
    );
}

function withElfRuntimeMetadata(template, safe) {
    const tags = new Set(templateTags(template));
    tags.add('no_rotate');
    const partial = !template?.metadata?.encompass;
    const place = template?.metadata?.place;
    return {
        ...template,
        metadata: {
            ...template.metadata,
            tags: [...tags],
            ...(partial ? {
                partial: true,
                presenceKey: `place:${place}`
            } : {}),
            parseWarnings: [],
            sourceAudit: safe
                ? 'elf-end-coarse-terrain-v1'
                : 'elf-end-detection-only-v1',
            matchPolicy: safe
                ? {...ELF_END_MATCH_POLICY}
                : {...DETECTION_ONLY_POLICY}
        }
    };
}

/**
 * Builds the complete Elf:$ primary candidate set. Candidate identity never
 * comes from messages: all maps compete using observed terrain. A source
 * change which invalidates the coarse helper proof keeps the map as a
 * detection-only negative candidate, preventing a closed-set mislabel.
 */
export function auditedElfEndTemplates(source, parsed, options = {}) {
    const path = String(options?.path || '');
    if (!ELF_DES_PATH.test(path)) {
        return [];
    }
    const rawCandidates = naturalBranchEndPrimaries(parsed, path)
        .filter(template => isElfEndPlace(template?.metadata?.place));
    if (!rawCandidates.length) {
        return [];
    }

    const helperAudit = elfHelperAudit(source);
    const sanitizedByName = helperAudit.sharedSafe
        ? new Map(parseDes(stripElfTerrainNeutralCalls(source), options)
            .map(template => [template.name, template]))
        : new Map();

    return rawCandidates.map(original => {
        const sanitized = sanitizedByName.get(original.name);
        const block = luaMapBlock(source, original.name);
        const helperMode = elfMapHelperMode(
            block,
            original.metadata?.parseWarnings || []
        );
        const safe = Boolean(helperAudit.sharedSafe
            && sanitized
            && block
            && helperMode
            && (helperMode === 'direct' || helperAudit.lootSafe)
            && sanitized.width === original.width
            && sanitized.height === original.height
            && sanitized.metadata?.orient === original.metadata?.orient
            && sanitized.metadata?.place === original.metadata?.place
            && warningSetMatches(sanitized.metadata?.parseWarnings, [])
            && templateTags(sanitized).has('no_rotate'));
        return withElfRuntimeMetadata(safe ? sanitized : original, safe);
    });
}

function luaTopLevelFunctionRegion(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const start = new RegExp(`^function\\s+${escaped}\\s*\\(`, 'mu')
        .exec(String(source || ''));
    if (!start) {
        return null;
    }
    const tail = String(source).slice(start.index + start[0].length);
    const next = /^function\s+[A-Za-z_]\w*\s*\(/mu.exec(tail);
    return String(source).slice(
        start.index,
        next ? start.index + start[0].length + next.index : undefined
    );
}

function standaloneLuaCalls(region, declaredName) {
    return [...String(region || '').matchAll(
        /(?:^|[^A-Za-z0-9_.])([A-Za-z_]\w*)\s*\(/gmu
    )].map(match => match[1]).filter(name => name !== declaredName);
}

function exactStringList(actual, expected) {
    return actual.length === expected.length
        && actual.every((value, index) => value === expected[index]);
}

function elfBladesHelpersAreSafe(source, dependencies) {
    const entry = luaFunctionRegion(source, 'elven_blade_entry');
    const setup = luaFunctionRegion(source, 'hall_of_blades_setup');
    const monsters = luaFunctionRegion(source, 'hall_of_blades_monsters');
    const rewards = luaFunctionRegion(source, 'hall_of_blades_extra_rewards');
    const weapons = luaTopLevelFunctionRegion(
        dependencies?.[VAULT_LUA_PATH],
        'hall_of_blades_weapon'
    );
    const decorative = luaTopLevelFunctionRegion(
        dependencies?.[VAULT_LUA_PATH],
        'decorative_floor'
    );
    return Boolean(entry && setup && monsters && rewards && weapons
        && decorative
        && methodMultisetMatches(entry, {tags: 1, mons: 1})
        && /\be\.tags\(\s*["']elf_blade_entry no_monster_gen unrand["']\s*\)/u
            .test(entry)
        && /\bdecorative_floor\(\s*e\s*,\s*["']-["']\s*,\s*["']weapon-inlaid floor["']\s*\)/u
            .test(entry)
        && (entry.match(/\bdecorative_floor\s*\(/gu) || []).length === 1
        && exactStringList(
            standaloneLuaCalls(entry, 'elven_blade_entry'),
            ['decorative_floor']
        )
        && methodMultisetMatches(setup, {tags: 2, place: 1})
        && /\be\.tags\(\s*["']no_monster_gen["']\s*\)/u.test(setup)
        && /\be\.tags\(\s*["']no_item_gen["']\s*\)/u.test(setup)
        && /\be\.place\(\s*["']Elf:2["']\s*\)/u.test(setup)
        && /\bdecorative_floor\(\s*e\s*,\s*w_floor\s*,\s*["']weapon-inlaid floor["']\s*\)/u
            .test(setup)
        && (setup.match(/\bdecorative_floor\s*\(/gu) || []).length === 1
        && exactStringList(
            standaloneLuaCalls(setup, 'hall_of_blades_setup'),
            ['decorative_floor']
        )
        && methodMultisetMatches(monsters, {mons: 4})
        && (monsters.match(/\bhall_of_blades_weapon\(\s*e\s*\)/gu)
            || []).length === 1
        && exactStringList(
            standaloneLuaCalls(monsters, 'hall_of_blades_monsters'),
            ['hall_of_blades_weapon']
        )
        && methodMultisetMatches(rewards, {kitem: 4})
        && exactStringList(
            standaloneLuaCalls(rewards, 'hall_of_blades_extra_rewards'),
            []
        )
        && methodMultisetMatches(weapons, {mons: 3})
        && exactStringList(
            standaloneLuaCalls(weapons, 'hall_of_blades_weapon'),
            []
        )
        && !/\be\.(?:clear|default_subvault_glyphs|kfeat|kmask|nsubst|orient|place|shuffle|subst|subvault)\s*\(/u
            .test(weapons)
        && methodMultisetMatches(decorative, {
            kfeat: 1,
            colour: 1,
            tile: 1,
            set_feature_name: 1
        })
        && exactStringList(
            standaloneLuaCalls(decorative, 'decorative_floor'),
            ['pairs']
        )
        && /\be\.kfeat\(\s*glyph\s*\.\.\s*["']\s*=\s*decorative_floor["']\s*\)/u
            .test(decorative)
        && !/\be\.(?:clear|default_subvault_glyphs|kmask|nsubst|orient|place|shuffle|subst|subvault)\s*\(/u
            .test(decorative));
}

function exactCounts(actual, expected) {
    const left = Object.entries(actual || {}).sort();
    const right = Object.entries(expected || {}).sort();
    return left.length === right.length
        && left.every(([key, count], index) =>
            key === right[index][0] && count === right[index][1]);
}

function desDirectiveCounts(block) {
    const header = String(block || '').split(/^MAP\s*$/mu, 1)[0];
    const counts = {};
    for (const match of header.matchAll(/^([A-Z][A-Z0-9_-]*)\s*:/gmu)) {
        counts[match[1]] = (counts[match[1]] || 0) + 1;
    }
    return counts;
}

function canonicalElfLuaLine(line) {
    return String(line || '').trim().replace(/^:\s*/u, '')
        .replace(/\s+/gu, '')
        .replaceAll('"', "'");
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function elfBladesSlot(rows, definition) {
    if (!definition) {
        return null;
    }
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
    if (minX !== definition.x || minY !== definition.y
        || width !== definition.width || height !== definition.height
        || mask.flat().filter(Boolean).length !== definition.maskCells) {
        return null;
    }
    return {
        id: definition.id,
        role: 'elf_blade_entry',
        x: minX,
        y: minY,
        width,
        height,
        mask,
        emptyKinds: [...definition.emptyKinds],
        entryAnchorGlyphs: []
    };
}

function maskCoordinates(grid, points) {
    const masked = new Set(points.map(point => `${point.x},${point.y}`));
    return grid.map((row, y) => row.map((cell, x) =>
        masked.has(`${x},${y}`)
            ? {...cell, kinds: [], certain: false}
            : cell));
}

function coordinatesForGlyphs(rows, glyphs) {
    const wanted = new Set(glyphs || []);
    const result = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (wanted.has(row[x])) {
                result.push({x, y});
            }
        }
    });
    return result;
}

function sanitizeElfBladesSource(source) {
    let result = String(source || '')
        .replace(
            /^\s*:?\s*(?:hall_of_blades_monsters|hall_of_blades_extra_rewards)\s*\(\s*_G\s*\)\s*$/gmu,
            ''
        )
        .replace(
            /^\s*:?\s*hall_of_blades_setup\s*\(\s*_G\s*,\s*(["'])([^"']+)\1\s*\)\s*$/gmu,
            (line, quote, glyphs) => [
                'PLACE: Elf:2',
                glyphs.includes('~')
                    ? 'KFEAT: ~ = decorative_floor'
                    : ''
            ].filter(Boolean).join('\n')
        )
        .replace(
            /^\s*SUBVAULT:\s*[AD]\s*:\s*elf_blade_entry\s*$/gmu,
            ''
        );
    result = result.replace(
        /^\s*:\s*if\s+crawl\.one_chance_in\(4\)\s+then\s*$\n^\s*SUBST:\s*FJH\s*=\s*b\s*$\n^\s*:\s*else\s*$\n^\s*SHUFFLE:\s*FH\s*$\n^\s*SUBST:\s*FJ\s*=\s*\.\s*,\s*H\s*:\s*bb\.\s*$\n^\s*:\s*end\s*$/gmu,
        ''
    );
    return result;
}

function elfBladesMainBlockIsSafe(block, spec) {
    if (!block || !spec
        || !exactCounts(desDirectiveCounts(block), spec.directives)
        || !new RegExp(`^ORIENT:\\s*${spec.orient}\\s*$`, 'mu')
            .test(block)) {
        return false;
    }
    const expectedLua = [
        'hall_of_blades_monsters(_G)',
        'hall_of_blades_extra_rewards(_G)',
        ...(spec === ELF_BLADES_MAIN_SPECS.nicolae_elf_blades_crystal_corner
            ? [
                'ifcrawl.one_chance_in(4)then',
                'else',
                'end'
            ]
            : []),
        `hall_of_blades_setup(_G,'${spec.setupGlyphs}')`
    ];
    const lua = String(block).split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalElfLuaLine);
    if (lua.length !== expectedLua.length
        || lua.some((line, index) => line !== expectedLua[index])) {
        return false;
    }
    if (spec.slot
        && !new RegExp(
            `^SUBVAULT:\\s*${spec.slot.id}\\s*:\\s*elf_blade_entry\\s*$`,
            'mu'
        ).test(block)) {
        return false;
    }
    if (spec.dynamicGlyphs) {
        return /:\s*if\s+crawl\.one_chance_in\(4\)\s+then\s*\n\s*SUBST:\s*FJH\s*=\s*b\s*\n\s*:\s*else\s*\n\s*SHUFFLE:\s*FH\s*\n\s*SUBST:\s*FJ\s*=\s*\.\s*,\s*H\s*:\s*bb\.\s*\n\s*:\s*end/u
            .test(block);
    }
    return true;
}

function elfBladesDetectionTemplates(candidates) {
    return candidates.map(template => ({
        ...template,
        metadata: {
            ...template.metadata,
            partial: true,
            presenceKey: 'place:Elf:2',
            place: 'Elf:2',
            parseWarnings: [],
            sourceAudit: 'elf-blades-detection-only-v1',
            matchPolicy: {...DETECTION_ONLY_POLICY}
        }
    }));
}

/**
 * Builds the guaranteed Elf:2 Hall of Blades as a closed parent/entry-child
 * composite. The four PLACE primaries and all nineteen registered
 * `elf_blade_entry` children are audited from the same elf.des artifact.
 * Any helper, inventory, geometry, or conditional-terrain drift turns the
 * whole family into detection-only negatives instead of guessing a sibling.
 */
export function auditedElfBladesTemplates(source, parsed, options = {}) {
    const path = String(options?.path || '');
    if (!ELF_DES_PATH.test(path)) {
        return [];
    }
    const rawMains = (parsed || []).filter(template =>
        template?.metadata?.place === 'Elf:2');
    if (!rawMains.length) {
        return [];
    }
    const mainNames = rawMains.map(template => template.name).sort();
    const rawEntries = (parsed || []).filter(template =>
        templateTags(template).has('elf_blade_entry')
        && !templateTags(template).has('removed')
        && !templateTags(template).has('overwritable'));
    const entryNames = rawEntries.map(template => template.name).sort();
    const inventorySafe = mainNames.join('|')
            === [...ELF_BLADES_MAIN_NAMES].sort().join('|')
        && entryNames.join('|')
            === [...ELF_BLADES_ENTRY_NAMES].sort().join('|');
    const helpersSafe = elfBladesHelpersAreSafe(
        source,
        options?.dependencies
    );
    if (!inventorySafe || !helpersSafe) {
        return elfBladesDetectionTemplates(rawMains);
    }

    const entriesByName = new Map(rawEntries.map(template => [
        template.name,
        template
    ]));
    const entries = [];
    for (const name of ELF_BLADES_ENTRY_NAMES) {
        const template = entriesByName.get(name);
        const block = luaMapBlock(source, name);
        const tags = templateTags(template);
        if (!template || !block || template.width !== 13
            || template.height !== 14
            || template.metadata?.orient != null
            || template.metadata?.place != null
            || template.metadata?.parseWarnings?.length
            || helperCallCount(block, 'elven_blade_entry') !== 1
            || !tags.has('elf_blade_entry') || !tags.has('unrand')
            || !tags.has('no_monster_gen')) {
            return elfBladesDetectionTemplates(rawMains);
        }
        entries.push({
            name: template.name,
            width: template.width,
            height: template.height,
            grid: template.grid,
            tags: [...tags],
            roles: ['elf_blade_entry']
        });
    }

    const sanitizedByName = new Map(parseDes(
        sanitizeElfBladesSource(source),
        options
    ).map(template => [template.name, template]));
    const rawByName = new Map(rawMains.map(template => [
        template.name,
        template
    ]));
    const result = [];
    for (const name of ELF_BLADES_MAIN_NAMES) {
        const spec = ELF_BLADES_MAIN_SPECS[name];
        const raw = rawByName.get(name);
        const shell = sanitizedByName.get(name);
        const block = luaMapBlock(source, name);
        const rows = mapRows(block);
        const slot = spec.slot ? elfBladesSlot(rows, spec.slot) : null;
        if (!raw || !shell || !block
            || !elfBladesMainBlockIsSafe(block, spec)
            || !warningSetMatches(raw.metadata?.parseWarnings, spec.warnings)
            || shell.metadata?.parseWarnings?.length
            || shell.width !== spec.width || shell.height !== spec.height
            || shell.metadata?.orient !== spec.orient
            || shell.metadata?.place !== 'Elf:2'
            || rows.length !== spec.height
            || rows.some(row => row.length > spec.width)
            || (spec.slot && !slot)) {
            return elfBladesDetectionTemplates(rawMains);
        }
        const maskedPoints = spec.slot
            ? coordinatesForGlyphs(rows, [spec.slot.id])
            : coordinatesForGlyphs(rows, spec.dynamicGlyphs || []);
        result.push({
            ...shell,
            grid: maskCoordinates(shell.grid, maskedPoints),
            metadata: {
                ...shell.metadata,
                partial: true,
                presenceKey: 'place:Elf:2',
                place: 'Elf:2',
                parseWarnings: [],
                sourceAudit: 'elf-blades-fixed-composite-v1',
                matchPolicy: {...ELF_BLADES_MATCH_POLICY},
                composite: {
                    type: 'fixed-subvaults-v1',
                    slots: slot ? [slot] : [],
                    variants: slot ? entries : [],
                    variantPolicy: {...ELF_BLADES_ENTRY_MATCH_POLICY},
                    borderFillKind: null,
                    shellEntryAnchorGlyphs: [],
                    entryAnchorPoints: []
                }
            }
        });
    }
    return result;
}

function cocCoveSlotMatches(rows, glyph, spec) {
    const points = coordinatesForGlyphs(rows, [glyph]);
    if (points.length !== 12) {
        return false;
    }
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    if (minX !== spec.x || minY !== spec.y
        || maxX !== spec.x + 3 || maxY !== spec.y + 3) {
        return false;
    }
    const signature = Array.from({length: 4}, (_, y) =>
        Array.from({length: 4}, (_, x) =>
            rows[spec.y + y]?.[spec.x + x] === glyph ? glyph : '.')
            .join(''));
    return signature.join('/') === [
        `.${glyph}${glyph}.`,
        glyph.repeat(4),
        glyph.repeat(4),
        `.${glyph}${glyph}.`
    ].join('/');
}

function cocCoveChildIsFloor(template, block, name) {
    const tags = templateTags(template);
    const expectedDirectives = name === 'coc_grunt_cove_antaeus'
        ? {NAME: 1, TAGS: 1, MONS: 1, KITEM: 2}
        : {NAME: 1, TAGS: 1, MONS: 1, KITEM: 1};
    const rows = mapRows(block);
    const cells = template?.grid?.flat().filter(Boolean) || [];
    return Boolean(template && block
        && exactCounts(desDirectiveCounts(block), expectedDirectives)
        && template.width === 4 && template.height === 4
        && template.metadata?.orient == null
        && template.metadata?.place == null
        && template.metadata?.parseWarnings?.length === 0
        && rows.length === 4
        && rows.map(row => row.length).join(',') === '3,4,4,3'
        && cells.length === 12
        && cells.every(cell => Array.isArray(cell.kinds)
            && cell.kinds.length === 1 && cell.kinds[0] === 'floor')
        && tags.has(name)
        && (name === 'coc_grunt_cove_fiend') === tags.has('allow_dup')
        && !String(block).split('\n').some(line =>
            line.trimStart().startsWith(':')));
}

function cocCoveBlockIsSafe(block, rows) {
    if (!block
        || !exactCounts(desDirectiveCounts(block), {
            NAME: 1,
            ORIENT: 1,
            MONS: 2,
            KMONS: 2,
            KFEAT: 2,
            SHUFFLE: 1,
            SUBVAULT: 5
        })
        || rows.length !== 70
        || rows.some(row => row.length !== 70)
        || !/^ORIENT:\s*encompass\s*$/mu.test(block)
        || !/^KFEAT:\s*9\s*=\s*w\s*$/mu.test(block)
        || !/^KFEAT:\s*X\s*=\s*open_sea\s*$/mu.test(block)
        || !/^SHUFFLE:\s*ABCEF\s*$/mu.test(block)) {
        return false;
    }
    const lua = String(block).split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalElfLuaLine);
    if (lua.join('|') !== [
        'serpent_of_hell_setup(_G)',
        "set_border_fill_type('open_sea')",
        'coc_setup(_G)'
    ].join('|')) {
        return false;
    }
    const subvaults = [...String(block).matchAll(
        /^SUBVAULT:\s*([ABCEF])\s*:\s*(\S+)\s*$/gmu
    )].map(match => [match[1], match[2]]);
    const expected = [
        ['A', 'coc_grunt_cove_antaeus'],
        ['B', 'coc_grunt_cove_fiend'],
        ['C', 'coc_grunt_cove_fiend'],
        ['E', 'coc_grunt_cove_fiend'],
        ['F', 'coc_grunt_cove_fiend']
    ];
    return subvaults.length === expected.length
        && subvaults.every(([glyph, name], index) =>
            glyph === expected[index][0] && name === expected[index][1])
        && Object.entries(COC_COVE_SLOT_SPECS).every(([glyph, spec]) =>
            cocCoveSlotMatches(rows, glyph, spec));
}

function sanitizeCocCoveSource(source) {
    return String(source || '')
        .replace(
            /^\s*:?\s*(?:serpent_of_hell_setup|coc_setup)\s*\(\s*_G\s*\)\s*$/gmu,
            ''
        )
        .replace(
            /^\s*:?\s*set_border_fill_type\s*\(\s*["']open_sea["']\s*\)\s*$/gmu,
            ''
        )
        .replace(
            /^\s*SUBVAULT:\s*[ABCEF]\s*:\s*coc_grunt_cove_(?:antaeus|fiend)\s*$/gmu,
            ''
        );
}

/**
 * Coc:7 has five ordinary encompass endings plus coc_grunt_cove. The cove's
 * five shuffled SUBVAULT rooms differ only in monsters and items: both
 * registered 4x4 children occupy the same twelve cells and every occupied
 * child cell is floor. Collapse that exact child terrain consensus into the
 * parent only when the complete six-map source inventory, helper-audited
 * siblings, directives, child pool, and slot geometry all still match.
 */
function auditedCocCoveTemplate(source, parsed, options, existingTemplates) {
    const path = String(options?.path || '');
    if (!path.endsWith('/dat/des/branches/coc.des')) {
        return null;
    }
    const rawCandidates = naturalBranchEndPrimaries(parsed, path);
    if (rawCandidates.map(template => template.name).sort().join('|')
        !== [...COC_COVE_FAMILY_NAMES].sort().join('|')
        || (String(source).match(/\bcoc_setup\s*\(\s*_G\s*\)/gu) || [])
            .length !== COC_COVE_FAMILY_NAMES.length) {
        return null;
    }
    const existingByName = new Map((existingTemplates || []).map(template => [
        template.name,
        template
    ]));
    if (!COC_COVE_STATIC_SIBLINGS.every(name => {
        const template = existingByName.get(name);
        return template?.metadata?.sourceAudit === 'hell-end-coarse-terrain-v1'
            && template?.metadata?.place === 'Coc:$'
            && template?.metadata?.encompass === true;
    })) {
        return null;
    }

    const byName = new Map((parsed || []).map(template => [
        template.name,
        template
    ]));
    const parent = byName.get('coc_grunt_cove');
    const sanitizedParent = parseDes(
        sanitizeCocCoveSource(source),
        options
    ).find(template => template.name === 'coc_grunt_cove');
    const parentBlock = luaMapBlock(source, 'coc_grunt_cove');
    const rows = mapRows(parentBlock);
    if (!parent || !sanitizedParent || !parentBlock
        || !warningSetMatches(parent.metadata?.parseWarnings, COC_COVE_WARNINGS)
        || sanitizedParent.metadata?.parseWarnings?.length
        || sanitizedParent.width !== parent.width
        || sanitizedParent.height !== parent.height
        || sanitizedParent.metadata?.orient !== parent.metadata?.orient
        || parent.width !== 70 || parent.height !== 70
        || parent.metadata?.orient !== 'encompass'
        || parent.metadata?.place !== 'Coc:$'
        || !templateTags(parent).has('no_rotate')
        || !cocCoveBlockIsSafe(parentBlock, rows)) {
        return null;
    }
    for (const name of [
        'coc_grunt_cove_antaeus',
        'coc_grunt_cove_fiend'
    ]) {
        if (!cocCoveChildIsFloor(
            byName.get(name),
            luaMapBlock(source, name),
            name
        )) {
            return null;
        }
    }

    const slotGlyphs = new Set(Object.keys(COC_COVE_SLOT_SPECS));
    let entryCount = 0;
    const grid = sanitizedParent.grid.map(row => row.map(cell => {
        if (cell?.glyph === '{'
            || cell?.possibleGlyphs?.includes('{')) {
            entryCount++;
            // At a Hell branch end Crawl turns `{` into the branch's
            // PORTAL_EXIT feature. The cove has exactly one deterministic
            // entry, so replace the generic DES stair kind with its runtime
            // WebTiles kind rather than widening it.
            cell = {...cell, kinds: ['portal']};
        }
        if (!slotGlyphs.has(cell?.glyph)) {
            return cell;
        }
        return {
            ...cell,
            kinds: ['floor'],
            certain: true,
            possibleGlyphs: [cell.glyph]
        };
    }));
    if (entryCount !== 1) {
        return null;
    }
    return {
        ...parent,
        grid,
        metadata: {
            ...parent.metadata,
            parseWarnings: [],
            entryAnchorGlyph: '{',
            // The Hell branch exit encoded by `{` is a DNGN_EXIT_COCYTUS
            // gateway and arrives as MF_PORTAL in WebTiles.
            entryAnchorObservedKind: 'portal',
            sourceAudit: 'hell-end-coc-cove-static-terrain-v1',
            matchPolicy: {...COC_COVE_MATCH_POLICY}
        }
    };
}

function shoalsEntryCells(template) {
    const glyphs = new Set(['{', '(', '[', '<']);
    const points = [];
    for (let y = 0; y < (template?.grid?.length || 0); y++) {
        for (let x = 0; x < (template.grid[y]?.length || 0); x++) {
            const cell = template.grid[y]?.[x];
            const possible = new Set([
                cell?.glyph,
                ...(cell?.possibleGlyphs || [])
            ]);
            if ([...glyphs].some(glyph => possible.has(glyph))) {
                points.push({x, y, cell});
            }
        }
    }
    return points;
}

function shoalsTideSafeGrid(grid) {
    return grid.map(row => row.map(cell => {
        if (!cell) {
            return cell;
        }
        const kinds = new Set(cell.kinds || []);
        const before = kinds.size;
        // Exact dgn-shoals.cc tides can replace every non-immune vault floor
        // with shallow water and every shallow-water cell with floor. Neither
        // direct ending has no_tide tags/KPROP. Deep water remains deep unless
        // ordinary pool fixup first made it shallow; the parser already keeps
        // both deep and shallow possibilities for those cells.
        if (kinds.has('floor')) {
            kinds.add('shallow_water');
        }
        if (kinds.has('shallow_water')) {
            kinds.add('floor');
        }
        return kinds.size === before ? cell : {
            ...cell,
            kinds: [...kinds],
            certain: false
        };
    }));
}

function shoalsDirectFamilyIsSafe(source, parsed) {
    const candidates = naturalBranchEndPrimaries(parsed, SHOALS_END_PATH)
        .filter(template => /^Shoals:\$$/u.test(
            normalizedBranchEndPlace(template?.metadata?.place) || ''
        ));
    if (candidates.map(template => template.name).sort().join('|')
        !== [...SHOALS_END_FAMILY_NAMES].sort().join('|')) {
        return false;
    }
    const byName = new Map(candidates.map(template => [
        template.name,
        template
    ]));
    return Object.entries(SHOALS_DIRECT_END_SPECS).every(([name, spec]) => {
        const template = byName.get(name);
        const block = luaMapBlock(source, name);
        const tags = [...templateTags(template)].sort();
        const luaLines = String(block || '').split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith(':'));
        const entries = shoalsEntryCells(template);
        return Boolean(template && block
            && template.width === spec.width
            && template.height === spec.height
            && template.metadata?.orient === 'encompass'
            && template.metadata?.encompass === true
            && template.metadata?.place === 'Shoals:$'
            && warningSetMatches(template.metadata?.parseWarnings, [])
            && tags.join('|') === [...spec.tags].sort().join('|')
            && exactCounts(desDirectiveCounts(block), spec.directives)
            && /^ORIENT:\s*encompass\s*$/mu.test(block)
            && /^PLACE:\s*Shoals:\$\s*$/mu.test(block)
            && /^WEIGHT:\s*3\s*$/mu.test(block)
            && luaLines.length === 1
            && /^:\s*set_border_fill_type\(\s*["']open_sea["']\s*\)\s*$/u
                .test(luaLines[0])
            && spec.entryDirective.test(block)
            && entries.length === spec.entryCells
            && entries.every(({cell}) =>
                (cell?.kinds || []).includes('stairs'))
            && template.grid.flat().filter(Boolean).every(cell =>
                Array.isArray(cell.kinds) && cell.kinds.length > 0
                && !cell.kinds.some(kind =>
                    ['unknown', 'void', 'unseen', 'transparent']
                        .includes(String(kind || '').toLowerCase()))));
    });
}

/**
 * Replaces the two direct Shoals:$ encompasses with tide-safe, transition-
 * anchored candidates. The third natural primary (storm palace) retains the
 * generic SUBVAULT detection-only path. Inventory or directive drift keeps
 * both direct identities as detection-only negatives instead of allowing the
 * warning-free parser output to reveal at an unverified placement.
 */
export function auditedShoalsEndTemplates(source, parsed, options = {}) {
    const path = String(options?.path || '');
    if (!path.endsWith(SHOALS_END_PATH)) {
        return [];
    }
    const byName = new Map((parsed || []).map(template => [
        template.name,
        template
    ]));
    const safe = shoalsDirectFamilyIsSafe(source, parsed);
    return Object.keys(SHOALS_DIRECT_END_SPECS).flatMap(name => {
        const template = byName.get(name);
        if (!template) {
            return [];
        }
        return [{
            ...template,
            grid: shoalsTideSafeGrid(template.grid),
            metadata: {
                ...template.metadata,
                parseWarnings: [],
                sourceAudit: safe
                    ? 'shoals-end-static-arrival-v1'
                    : 'shoals-end-detection-only-v1',
                ...(safe ? {
                    entryAnchorGlyphs: ['{', '(', '[', '<'],
                    entryAnchorObservedKind: 'stair'
                } : {}),
                matchPolicy: safe
                    ? {...SHOALS_END_MATCH_POLICY}
                    : {...GENERIC_BRANCH_END_DETECTION_POLICY}
            }
        }];
    });
}

function hellVestibuleSlot(rows, id, role) {
    const spec = HELL_VESTIBULE_SLOT_SPECS[id];
    if (!spec) {
        return null;
    }
    const points = coordinatesForGlyphs(rows, [id]);
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
            rows[minY + y]?.[minX + x] === id));
    if (minX !== spec.x || minY !== spec.y
        || width !== spec.width || height !== spec.height
        || mask.flat().filter(Boolean).length !== spec.maskCells) {
        return null;
    }
    return {
        id,
        role,
        x: minX,
        y: minY,
        width,
        height,
        mask,
        // Every exact child has one non-space cell for every mask cell after
        // resolve_subvault chooses a minimum-mismatch mirror. Do not invent a
        // fallback if a future source breaks that invariant.
        emptyKinds: [],
        entryAnchorGlyphs: role === 'vestibule_geryon'
            ? ['{', '(', '[', '<']
            : []
    };
}

function hellVestibuleHelpersAreSafe(source, dependencies) {
    const lava = luaFunctionRegion(source, 'hell_lava_spawns');
    const water = luaFunctionRegion(source, 'hell_water_spawns');
    const featureAudit = vaultFeatureHelperAudit(dependencies);
    const lavaSafe = Boolean(lava
        && !hasUnexpectedLuaControl(lava)
        && methodMultisetMatches(lava, {
            kmons: 1, kfeat: 1, kmask: 1, nsubst: 1
        })
        && /\be\.kfeat\(\s*["']~l\s*=\s*l["']\s*\)/u.test(lava)
        && /\be\.kmask\(\s*["']l\s*=\s*no_monster_gen["']\s*\)/u
            .test(lava)
        && /\be\.nsubst\(\s*["']l\s*=\s*6:~\s*\/\s*4\s*=\s*~l\s*\/\s*\*:l["']\s*\)/u
            .test(lava));
    const waterSafe = Boolean(water
        && !hasUnexpectedLuaControl(water)
        && methodMultisetMatches(water, {
            kmons: 1, kfeat: 1, kmask: 1, nsubst: 1
        })
        && /\be\.kfeat\(\s*["']Pw\s*=\s*w["']\s*\)/u.test(water)
        && /\be\.kmask\(\s*["']wW\s*=\s*no_monster_gen["']\s*\)/u
            .test(water)
        && /\be\.nsubst\(\s*["']w\s*=\s*8:P\s*\/\s*4\s*=\s*Pw\s*\/\s*\*:w["']\s*\)/u
            .test(water));
    return {
        safe: lavaSafe && waterSafe
            && featureAudit.get('vault_metal_statue_setup')?.safe === true,
        featureAudit
    };
}

function hellVestibuleParentIsSafe(source, parsed) {
    const parent = (parsed || []).find(template =>
        template.name === HELL_VESTIBULE_PARENT);
    const block = luaMapBlock(source, HELL_VESTIBULE_PARENT);
    const rows = mapRows(block);
    const activeHellPrimaries = (parsed || []).filter(template => {
        const tags = templateTags(template);
        return template?.metadata?.place === 'Hell'
            && template?.metadata?.encompass === true
            && !tags.has('removed') && !tags.has('unrand');
    }).map(template => template.name);
    if (!parent || !block
        || activeHellPrimaries.join('|') !== HELL_VESTIBULE_PARENT
        || !warningSetMatches(
            parent.metadata?.parseWarnings,
            HELL_VESTIBULE_PARENT_WARNINGS
        )
        || !exactCounts(desDirectiveCounts(block), {
            NAME: 1,
            PLACE: 1,
            ORIENT: 1,
            TAGS: 1,
            SUBVAULT: 5,
            SHUFFLE: 1,
            SUBST: 3,
            MONS: 1,
            NSUBST: 1
        })
        || parent.width !== 57 || parent.height !== 57
        || parent.metadata?.place !== 'Hell'
        || parent.metadata?.orient !== 'encompass'
        || !parent.metadata?.encompass
        || !templateTags(parent).has('no_rotate')
        || !templateTags(parent).has('no_dump')
        || rows.length !== 57
        || rows.some(row => row.length !== 57)) {
        return null;
    }
    const literals = [
        /^PLACE:\s*Hell\s*$/mu,
        /^ORIENT:\s*encompass\s*$/mu,
        /^TAGS:\s*no_rotate\s+no_dump\s*$/mu,
        /^SHUFFLE:\s*ABCD\s*$/mu,
        /^SUBST:\s*ABCDE\s*=\s*\.\s*$/mu,
        /^MONS:\s*Murray\s*$/mu,
        /^NSUBST:\s*:\s*=\s*1:1\s*\/\s*\*:\.\s*$/mu,
        /^SUBST:\s*:\s*=\s*\.\s*$/mu,
        /^SUBST:\s*:\s*=\s*x\s*$/mu
    ];
    if (!literals.every(pattern => pattern.test(block))) {
        return null;
    }
    const expectedSubvaults = [
        ['A', 'vestibule_dis'],
        ['B', 'vestibule_tar'],
        ['C', 'vestibule_coc'],
        ['D', 'vestibule_geh'],
        ['E', 'vestibule_geryon']
    ];
    const actualSubvaults = [...block.matchAll(
        /^SUBVAULT:\s*([A-E])\s*:\s*(\S+)\s*$/gmu
    )].map(match => [match[1], match[2]]);
    if (actualSubvaults.length !== expectedSubvaults.length
        || actualSubvaults.some((value, index) =>
            value[0] !== expectedSubvaults[index][0]
            || value[1] !== expectedSubvaults[index][1])) {
        return null;
    }
    // levcomp appends SUBVAULT, SHUFFLE, and SUBST statements to the same
    // main Lua chunk in source order. apply_subvault() also resolves and
    // merges immediately, making its cells SUBVAULT_GLYPH before the next
    // statement runs. Fixed roles are therefore valid only for this exact
    // ordering; moving SHUFFLE before a SUBVAULT would change the family.
    const subvaultOffsets = [...block.matchAll(/^SUBVAULT:/gmu)]
        .map(match => match.index);
    const shuffleOffset = block.search(/^SHUFFLE:\s*ABCD\s*$/mu);
    const eraseOffset = block.search(/^SUBST:\s*ABCDE\s*=\s*\.\s*$/mu);
    if (subvaultOffsets.length !== 5
        || subvaultOffsets.some((offset, index) => index > 0
            && offset <= subvaultOffsets[index - 1])
        || shuffleOffset <= subvaultOffsets.at(-1)
        || eraseOffset <= shuffleOffset) {
        return null;
    }
    const control = block.split('\n')
        .filter(line => line.trimStart().startsWith(':'))
        .map(canonicalElfLuaLine);
    if (control.join('|') !== [
        'ifcrawl.coinflip()then',
        'ifcrawl.coinflip()then',
        'else',
        'end',
        'else',
        'end'
    ].join('|')) {
        return null;
    }
    const slots = expectedSubvaults.map(([id, role]) =>
        hellVestibuleSlot(rows, id, role));
    return slots.every(Boolean) ? {parent, block, rows, slots} : null;
}

function stripHellVestibuleParentDynamics(source) {
    const block = luaMapBlock(source, HELL_VESTIBULE_PARENT);
    if (!block) {
        return String(source || '');
    }
    const mapIndex = block.indexOf('\nMAP\n');
    if (mapIndex < 0) {
        return String(source || '');
    }
    const header = block.slice(0, mapIndex).split('\n').filter(line => {
        const value = line.trim();
        return !value.startsWith(':')
            && !/^SUBVAULT:\s*[A-E]\s*:/u.test(value)
            && !/^SHUFFLE:\s*ABCD\s*$/u.test(value)
            && !/^SUBST:\s*ABCDE\s*=\s*\.$/u.test(value)
            && !/^MONS:\s*Murray$/u.test(value)
            && !/^NSUBST:\s*:\s*=/u.test(value)
            && !/^SUBST:\s*:\s*=/u.test(value);
    }).join('\n');
    const sanitizedBlock = header + block.slice(mapIndex);
    return String(source).slice(0, String(source).indexOf(block))
        + sanitizedBlock
        + String(source).slice(String(source).indexOf(block) + block.length);
}

function replaceHellVestibuleSwimmingControl(source, water) {
    const replacement = water
        ? 'KFEAT: 1 = w\nSUBST: l = w'
        : 'KFEAT: 1 = l';
    return String(source).replace(
        /:\s*if\s+crawl\.one_chance_in\(\s*3\s*\)\s+then\s*\n\s*KFEAT:\s*1\s*=\s*w\s*\n\s*SUBST:\s*l\s*:\s*w\s*\n\s*:\s*else\s*\n\s*KFEAT:\s*1\s*=\s*l\s*\n\s*:\s*end/u,
        replacement
    );
}

function sanitizeHellVestibuleSource(source, featureAudit, water) {
    let result = stripHellVestibuleParentDynamics(source);
    result = result.replace(
        /^\s*:?\s*(?:hell_lava_spawns|hell_water_spawns)\s*\(\s*_G\s*\)\s*$/gmu,
        ''
    );
    result = rewriteVaultFeatureHelpers(result, featureAudit);
    return replaceHellVestibuleSwimmingControl(result, water);
}

function expectedHellVestibuleChildWarnings(block, name) {
    const warnings = [];
    if ((String(block).match(/\bhell_lava_spawns\s*\(\s*_G\s*\)/gu)
        || []).length === 1) {
        warnings.push(...HELL_VESTIBULE_LAVA_WARNINGS);
    }
    if ((String(block).match(/\bhell_water_spawns\s*\(\s*_G\s*\)/gu)
        || []).length === 1) {
        warnings.push(...HELL_VESTIBULE_WATER_WARNINGS);
    }
    if ((String(block).match(/\bvault_metal_statue_setup\s*\(/gu)
        || []).length === 1) {
        warnings.push('Unknown Lua helper vault_metal_statue_setup(_G)');
    }
    if (name === 'vestibule_geryon_nicolae_swimming_pool') {
        warnings.push(...HELL_VESTIBULE_SWIMMING_WARNINGS);
    }
    return warnings;
}

function mergedHellVestibuleGrid(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)
        || left.length !== right.length) {
        return null;
    }
    const result = [];
    for (let y = 0; y < left.length; y++) {
        if (!Array.isArray(left[y]) || !Array.isArray(right[y])
            || left[y].length !== right[y].length) {
            return null;
        }
        const row = [];
        for (let x = 0; x < left[y].length; x++) {
            const a = left[y][x];
            const b = right[y][x];
            if (a == null || b == null) {
                if (a !== b) {
                    return null;
                }
                row.push(null);
                continue;
            }
            const kinds = [...new Set([
                ...(a.kinds || []),
                ...(b.kinds || [])
            ])].sort();
            const possibleGlyphs = [...new Set([
                a.glyph,
                ...(a.possibleGlyphs || []),
                b.glyph,
                ...(b.possibleGlyphs || [])
            ].filter(glyph => glyph != null))];
            row.push({
                ...a,
                kinds,
                possibleGlyphs,
                certain: kinds.length === 1 && a.certain && b.certain
            });
        }
        result.push(row);
    }
    return result;
}

function hellVestibuleGeryonRuntimeGrid(grid) {
    const stoneUp = new Set(['{', '(', '[']);
    return grid.map(row => row.map(cell => {
        if (!cell) {
            return cell;
        }
        const glyphs = new Set([
            cell.glyph,
            ...(cell.possibleGlyphs || [])
        ]);
        const hasStone = [...stoneUp].some(glyph => glyphs.has(glyph));
        const hasHatch = glyphs.has('<');
        if (!hasStone && !hasHatch) {
            return cell;
        }
        // _fixup_branch_stairs turns every '<' hatch into DNGN_EXIT_HELL,
        // randomly keeps one stone upstair as that same portal, and floors the
        // other stone upstairs. Keep the full sound union; the authoritative
        // level-entry point separately anchors which portal Crawl used.
        const kinds = new Set((cell.kinds || []).filter(kind =>
            kind !== 'stairs'));
        if (hasHatch || hasStone) {
            kinds.add('portal');
        }
        if (hasStone) {
            kinds.add('floor');
        }
        return {...cell, kinds: [...kinds].sort(), certain: false};
    }));
}

function hellVestibuleEntryPoints(grid) {
    const glyphs = new Set(['{', '(', '[', '<']);
    const points = [];
    for (let y = 0; y < (grid?.length || 0); y++) {
        for (let x = 0; x < (grid[y]?.length || 0); x++) {
            const cell = grid[y]?.[x];
            const possible = new Set([
                cell?.glyph,
                ...(cell?.possibleGlyphs || [])
            ]);
            if ([...glyphs].some(glyph => possible.has(glyph))) {
                points.push({x, y});
            }
        }
    }
    return points;
}

/**
 * Builds the guaranteed Hell Vestibule as one source-closed composite. Crawl
 * resolves the five SUBVAULT directives before the later SHUFFLE/SUBST calls,
 * so A-E retain fixed roles; resolve_subvault alone chooses each child's
 * legal rotation/mirror. Any inventory/helper/geometry drift returns no
 * revealable template instead of matching an incomplete family.
 */
export function auditedHellVestibuleTemplates(source, parsed, options = {}) {
    const path = String(options?.path || '');
    if (!path.endsWith(HELL_VESTIBULE_PATH)) {
        return [];
    }
    const parentAudit = hellVestibuleParentIsSafe(source, parsed);
    const helperAudit = hellVestibuleHelpersAreSafe(
        source,
        options?.dependencies
    );
    if (!parentAudit || !helperAudit.safe) {
        return [];
    }

    const rawByName = new Map((parsed || []).map(template => [
        template.name,
        template
    ]));
    for (const [role, spec] of Object.entries(HELL_VESTIBULE_ROLES)) {
        const eligible = (parsed || []).filter(template => {
            const tags = templateTags(template);
            return tags.has(role) && !tags.has('removed')
                && !tags.has('overwritable') && !tags.has('unrand');
        }).map(template => template.name).sort();
        if (eligible.join('|') !== [...spec.names].sort().join('|')) {
            return [];
        }
    }

    const waterParsed = parseDes(sanitizeHellVestibuleSource(
        source,
        helperAudit.featureAudit,
        true
    ), options);
    const lavaParsed = parseDes(sanitizeHellVestibuleSource(
        source,
        helperAudit.featureAudit,
        false
    ), options);
    const waterByName = new Map(waterParsed.map(template => [
        template.name,
        template
    ]));
    const lavaByName = new Map(lavaParsed.map(template => [
        template.name,
        template
    ]));

    const variants = [];
    for (const [role, spec] of Object.entries(HELL_VESTIBULE_ROLES)) {
        for (const name of spec.names) {
            const raw = rawByName.get(name);
            const water = waterByName.get(name);
            const lava = lavaByName.get(name);
            const block = luaMapBlock(source, name);
            const sanitizedBlock = luaMapBlock(
                sanitizeHellVestibuleSource(
                    source,
                    helperAudit.featureAudit,
                    true
                ),
                name
            );
            const rows = mapRows(block);
            const rawTags = templateTags(raw);
            const sanitizedTags = templateTags(water);
            if (!raw || !water || !lava || !block || !sanitizedBlock
                || !warningSetMatches(
                    raw.metadata?.parseWarnings,
                    expectedHellVestibuleChildWarnings(block, name)
                )
                || water.metadata?.parseWarnings?.length
                || lava.metadata?.parseWarnings?.length
                || water.width !== spec.width || water.height !== spec.height
                || lava.width !== spec.width || lava.height !== spec.height
                || water.metadata?.orient != null
                || water.metadata?.place != null
                || !rawTags.has(role) || !sanitizedTags.has(role)
                || rows.length !== spec.height
                || rows.some(row => row.length > spec.width)
                || Math.max(...rows.map(row => row.length)) !== spec.width
                || water.grid.flat().filter(Boolean).length
                    !== HELL_VESTIBULE_SLOT_SPECS[spec.slot].maskCells
                || lava.grid.flat().filter(Boolean).length
                    !== HELL_VESTIBULE_SLOT_SPECS[spec.slot].maskCells
                || sanitizedBlock.split('\n').some(line =>
                    line.trimStart().startsWith(':'))) {
                return [];
            }
            let grid = name === 'vestibule_geryon_nicolae_swimming_pool'
                ? mergedHellVestibuleGrid(water.grid, lava.grid)
                : water.grid;
            if (!grid) {
                return [];
            }
            let entryAnchorPoints = [];
            if (role === 'vestibule_geryon') {
                entryAnchorPoints = hellVestibuleEntryPoints(grid);
                grid = hellVestibuleGeryonRuntimeGrid(grid);
                if (!entryAnchorPoints.length) {
                    return [];
                }
            }
            variants.push({
                name,
                width: water.width,
                height: water.height,
                grid,
                tags: [...sanitizedTags],
                roles: [role],
                entryAnchorPoints
            });
        }
    }

    const parent = waterByName.get(HELL_VESTIBULE_PARENT);
    if (!parent || parent.metadata?.parseWarnings?.length
        || parent.width !== 57 || parent.height !== 57
        || variants.length !== 36) {
        return [];
    }
    const slotGlyphs = new Set(Object.keys(HELL_VESTIBULE_SLOT_SPECS));
    const shellGrid = parent.grid.map((row, y) => row.map((cell, x) => {
        const rawGlyph = parentAudit.rows[y]?.[x];
        if (slotGlyphs.has(rawGlyph)) {
            return {...cell, kinds: [], certain: false};
        }
        if (rawGlyph === ':') {
            return {
                ...cell,
                kinds: ['floor', 'wall'],
                possibleGlyphs: ['.', '1', 'x'],
                certain: false
            };
        }
        return cell;
    }));
    return [{
        ...parent,
        grid: shellGrid,
        metadata: {
            ...parent.metadata,
            place: 'Hell',
            tags: ['no_rotate', 'no_dump'],
            parseWarnings: [],
            // Entering the Vestibule places the player at DNGN_EXIT_HELL.
            // WebTiles exposes it as MF_PORTAL. The point lives inside the
            // Geryon child, so the composite enumerates every legal transformed
            // child entry point rather than guessing from a message.
            entryAnchorGlyphs: ['{', '(', '[', '<'],
            entryAnchorObservedKind: 'portal',
            sourceAudit: 'hell-vestibule-fixed-composite-v1',
            trustedEntryConsensus: {
                protocol: 'hell-vestibule-entry-consensus-v1',
                requiredObservedKind: 'portal',
                allowedFromPlaces: ['dungeon', 'depths'],
                parentTransforms: ['r0', 'r0v', 'r0h', 'r0hv'],
                anchorPlacementsPerTransform: 37,
                sourceVariantCount: 36,
                preparedSlotVariantCounts: [56, 56, 56, 56, 64]
            },
            matchPolicy: {...HELL_VESTIBULE_MATCH_POLICY},
            composite: {
                type: 'fixed-subvaults-v1',
                slots: parentAudit.slots,
                variants,
                variantPolicy: {...HELL_VESTIBULE_CHILD_MATCH_POLICY},
                borderFillKind: 'wall',
                shellEntryAnchorGlyphs: [],
                entryAnchorPoints: []
            }
        }
    }];
}

function auditedBranchEndPath(path) {
    return AUDITED_BRANCH_END_PATHS.some(suffix =>
        String(path || '').endsWith(suffix));
}

function itemAndMonsterWarningsOnly(warnings) {
    return Array.isArray(warnings) && warnings.length > 0
        && warnings.every(warning =>
            /^(?:KITEM|KMONS) directive appears inside Lua control flow$/u
                .test(warning)
            || /^Direct Lua (?:kitem|kmons)\(\) call is not statically supported$/u
                .test(warning));
}

function vaultFeatureHelperAudit(dependencies) {
    const source = dependencies?.[VAULT_LUA_PATH];
    return new Map([
        ['vault_granite_statue_setup', 'granite_statue'],
        ['vault_metal_statue_setup', 'metal_statue']
    ].map(([name, feature]) => {
        const region = luaFunctionRegion(source, name);
        const escapedFeature = feature.replace(
            /[.*+?^${}()|[\]\\]/gu,
            '\\$&'
        );
        const assignsFeature = new RegExp(
            `\\be\\.kfeat\\(glyph\\s*\\.\\.\\s*["']\\s*=\\s*`
                + `${escapedFeature}["']\\s*\\)`,
            'u'
        ).test(String(region || ''));
        const safe = Boolean(region
            && assignsFeature
            && methodMultisetMatches(region, {
                kfeat: 1,
                colour: 1,
                tile: 1,
                set_feature_name: 1
            }));
        return [name, {feature, safe}];
    }));
}

function singleCloudHelperIsSafe(dependencies) {
    const region = luaFunctionRegion(
        dependencies?.[VAULT_LUA_PATH],
        'single_cloud'
    );
    return Boolean(region
        && methodMultisetMatches(region, {marker: 1})
        && /lua:fog_machine/u.test(region)
        && /size\s*=\s*1/u.test(region)
        && /walk_dist\s*=\s*0/u.test(region)
        && /start_clouds\s*=\s*1/u.test(region)
        && /spread_rate\s*=\s*0/u.test(region));
}

function lairSmallEndingHelperIsSafe(source) {
    const region = luaFunctionRegion(source, 'lair_small_ending');
    return Boolean(region
        && methodMultisetMatches(region, {
            tags: 1,
            weight: 1,
            kitem: 1,
            is_validating: 1,
            hook: 1
        })
        && /\be\.tags\(\s*["']lair_end_small["']\s*\)/u.test(region)
        && /\be\.weight\(\s*5\s*\)/u.test(region)
        && /\be\.kitem\(\s*["']R\s*=\s*earthy gem["']\s*\)/u
            .test(region)
        && /\be\.hook\(\s*["']post_place["']/u.test(region)
        && /dgn\.place_maps\s*\{\s*tag\s*=\s*["']lair_end_small["']\s*\}/u
            .test(region)
        && !/\be\.(?:clear|kfeat|kmask|nsubst|orient|shuffle|subst|subvault)\s*\(/u
            .test(region));
}

function depthsEntryHelperIsSafe(source) {
    const region = luaFunctionRegion(source, 'depths_entry');
    const executableLines = String(region || '').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('--')
            && !/^function\s+depths_entry\s*\(/u.test(line)
            && line !== 'end');
    return Boolean(region
        && !hasUnexpectedLuaControl(region)
        && executableLines.length === 9
        && executableLines.every(line => /^e\.[a-z_]+\s*\(.*\)$/u.test(line))
        && methodMultisetMatches(region, {
            tags: 1,
            place: 1,
            orient: 1,
            weight: 1,
            kitem: 1,
            kfeat: 1,
            tile: 3
        })
        && /\be\.tags\(\s*["']depths_entry uniq_depths_entry chance_depths_entry no_monster_gen["']\s*\)/u
            .test(region)
        && /\be\.place\(\s*["']D:\$["']\s*\)/u.test(region)
        && /\be\.orient\(\s*["']float["']\s*\)/u.test(region)
        && /\be\.weight\(\s*["']20["']\s*\)/u.test(region)
        && /\be\.kitem\(\s*["']g\s*=\s*smoky gem["']\s*\)/u
            .test(region)
        && /\be\.kfeat\(\s*["']O\s*=\s*enter_depths["']\s*\)/u
            .test(region)
        && [
            'G = depths_column',
            'c = stone_wall_depths_entry',
            'b = wall_depths_crystal'
        ].every(value => {
            const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
            return new RegExp(
                `\\be\\.tile\\(\\s*["']${escaped}["']\\s*\\)`,
                'u'
            ).test(region);
        }));
}

function rewriteDepthsEntryCalls(source, safe) {
    if (!safe) {
        return String(source || '');
    }
    return String(source || '').replace(
        /^\s*:?\s*depths_entry\s*\(\s*_G\s*\)\s*$/gmu,
        [
            'TAGS: depths_entry uniq_depths_entry chance_depths_entry no_monster_gen',
            'PLACE: D:$',
            'ORIENT: float',
            'WEIGHT: 20',
            'KFEAT: O = enter_depths'
        ].join('\n')
    );
}

function vaultFeatureHelperCalls(block) {
    return [...String(block || '').matchAll(
        /^\s*:?\s*(vault_(?:granite|metal)_statue_setup)\s*\(\s*_G\s*,\s*(["'])([^"']+)\2\s*,\s*(["'])([^"']+)\4\s*\)\s*$/gmu
    )].map(match => ({
        name: match[1],
        glyph: match[3],
        type: match[5]
    }));
}

function rewriteVaultFeatureHelpers(source, audit) {
    return String(source).replace(
        /^\s*:?\s*(vault_(?:granite|metal)_statue_setup)\s*\(\s*_G\s*,\s*(["'])([^"']+)\2\s*,\s*(["'])([^"']+)\4\s*\)\s*$/gmu,
        (line, name, glyphQuote, glyph) => {
            const helper = audit.get(name);
            return helper?.safe
                ? `KFEAT: ${glyph} = ${helper.feature}`
                : line;
        }
    );
}

function stripTerrainNeutralBranchLines(source) {
    const lines = String(source || '').split('\n');
    const result = [];
    let skipContinuation = false;
    for (const line of lines) {
        if (skipContinuation) {
            skipContinuation = /\\\s*$/u.test(line);
            continue;
        }
        if (/^\s*(?:KITEM|KMONS)\s*:/u.test(line)) {
            skipContinuation = /\\\s*$/u.test(line);
            continue;
        }
        if (/^\s*:?\s*(?:kitem|lair_small_ending|single_cloud)\s*\(/u
            .test(line)) {
            skipContinuation = /\\\s*$/u.test(line);
            continue;
        }
        result.push(line);
    }
    return result.join('\n');
}

function branchControlAction(line) {
    const value = String(line || '').trim();
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

function branchDirectiveGlyphs(line) {
    const match = String(line || '').trim().match(
        /^(KFEAT|SUBST|NSUBST|SHUFFLE|CLEAR)\s*:\s*(.*)$/iu
    );
    if (!match) {
        return {glyphs: [], maskAll: false};
    }
    if (match[1].toUpperCase() === 'CLEAR') {
        return {glyphs: [], maskAll: true};
    }
    const pieces = match[1].toUpperCase() === 'SHUFFLE'
        ? [match[2]]
        : match[2].split(',').map(part => part.split(/[:=]/u, 1)[0]);
    const glyphs = new Set();
    for (const piece of pieces) {
        for (const glyph of String(piece || '').replace(/\s+/gu, '')) {
            if (!'/,:=*'.includes(glyph)) {
                glyphs.add(glyph);
            }
        }
    }
    return {glyphs: [...glyphs], maskAll: false};
}

function branchSourceMask(masks, name) {
    if (!name) {
        return null;
    }
    if (!masks.has(name)) {
        masks.set(name, {glyphs: new Set(), maskAll: false});
    }
    return masks.get(name);
}

function sanitizeBranchSource(source) {
    const lines = String(source || '').split('\n');
    const output = [];
    const masks = new Map();
    let currentName = null;
    let controlDepth = 0;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const name = line.match(/^NAME:\s*(\S+)\s*$/u)?.[1];
        if (name) {
            currentName = name;
            controlDepth = 0;
        }
        const action = branchControlAction(line);
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
            while (/\\\s*$/u.test(logical.at(-1))
                && index + 1 < lines.length) {
                logical.push(lines[++index]);
            }
            const mask = branchSourceMask(masks, currentName);
            if (mask) {
                if (subvault) {
                    const glyphs = logical.join(' ').match(
                        /^\s*SUBVAULT\s*:\s*(\S+)\s*:/u
                    )?.[1] || '';
                    for (const glyph of glyphs) {
                        mask.glyphs.add(glyph);
                    }
                } else {
                    const affected = branchDirectiveGlyphs(
                        logical.join(' ')
                    );
                    mask.maskAll ||= affected.maskAll;
                    for (const glyph of affected.glyphs) {
                        mask.glyphs.add(glyph);
                    }
                }
            }
            output.push(...logical.map(() => ''));
        } else if (line.trim().startsWith(':')) {
            const mask = branchSourceMask(masks, currentName);
            const literalGlyphs = line.match(
                /\(\s*_G\s*,\s*["']([^"']+)["']/u
            )?.[1] || line.match(
                /\b(?:kfeat|nsubst|shuffle|subst)\s*\(\s*["']([^"'=:\s]+)/u
            )?.[1] || '';
            if (mask) {
                for (const glyph of literalGlyphs) {
                    mask.glyphs.add(glyph);
                }
            }
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

function applyBranchMask(template, mask) {
    if (!mask || (!mask.maskAll && mask.glyphs.size === 0)) {
        return template;
    }
    return {
        ...template,
        grid: template.grid.map(row => row.map(cell => {
            const affected = mask.maskAll || mask.glyphs.has(cell?.glyph)
                || cell?.possibleGlyphs?.some(glyph =>
                    mask.glyphs.has(glyph));
            return affected ? {...cell, kinds: [], certain: false} : cell;
        }))
    };
}

function sanitizedCandidateMatches(candidate, original) {
    return Boolean(candidate
        && candidate.width === original.width
        && candidate.height === original.height
        && candidate.metadata?.orient === original.metadata?.orient
        && candidate.metadata?.place === original.metadata?.place
        && warningSetMatches(candidate.metadata?.parseWarnings, []));
}

function statueCallsAreAudited(block, warnings, audit) {
    const calls = vaultFeatureHelperCalls(block);
    const expectedWarnings = calls.map(call =>
        `Unknown Lua helper ${call.name}(_G)`);
    return calls.length > 0
        && calls.every(call => audit.get(call.name)?.safe === true)
        && warningSetMatches(warnings, expectedWarnings);
}

function singleCloudCallIsAudited(block, warnings, dependencies) {
    const calls = [...String(block || '').matchAll(
        /^\s*:?\s*single_cloud\s*\(\s*_G\s*,\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']+)\3\s*,\s*(?:true|false)\s*\)\s*$/gmu
    )];
    return calls.length === 1
        && singleCloudHelperIsSafe(dependencies)
        && warningSetMatches(warnings, [
            'Unknown Lua helper single_cloud(_G)'
        ]);
}

function depthsEntryCallIsAudited({
    source,
    block,
    warnings,
    featureAudit
}) {
    if (!depthsEntryHelperIsSafe(source)
        || helperCallCount(block, 'depths_entry') !== 1) {
        return false;
    }
    const statueCalls = vaultFeatureHelperCalls(block);
    const expectedWarnings = [
        DEPTHS_ENTRY_WARNING,
        ...statueCalls.map(call =>
            `Unknown Lua helper ${call.name}(_G)`)
    ];
    return statueCalls.every(call =>
        featureAudit.get(call.name)?.safe === true)
        && warningSetMatches(warnings, expectedWarnings);
}

function branchEndCandidateAudit({
    source,
    original,
    rewritten,
    block,
    featureAudit,
    dependencies,
    depthsEntry
}) {
    const warnings = original?.metadata?.parseWarnings || [];
    if (warningSetMatches(warnings, [])) {
        return {safe: true, template: original, audit: 'direct'};
    }
    if (itemAndMonsterWarningsOnly(warnings)
        && sanitizedCandidateMatches(rewritten, original)) {
        return {
            safe: true,
            template: rewritten,
            audit: 'items-monsters-only'
        };
    }
    if (warningSetMatches(warnings, LAIR_SMALL_ENDING_WARNINGS)
        && helperCallCount(block, 'lair_small_ending') === 1
        && lairSmallEndingHelperIsSafe(source)
        && sanitizedCandidateMatches(rewritten, original)) {
        return {
            safe: true,
            template: rewritten,
            audit: 'lair-small-ending'
        };
    }
    if (statueCallsAreAudited(block, warnings, featureAudit)
        && rewritten
        && sanitizedCandidateMatches(rewritten, original)) {
        return {safe: true, template: rewritten, audit: 'statue-helper'};
    }
    if (singleCloudCallIsAudited(block, warnings, dependencies)
        && sanitizedCandidateMatches(rewritten, original)) {
        return {safe: true, template: rewritten, audit: 'single-cloud'};
    }
    if (depthsEntry
        && depthsEntryCallIsAudited({
            source,
            block,
            warnings,
            featureAudit
        })
        && sanitizedCandidateMatches(rewritten, original)) {
        return {safe: true, template: rewritten, audit: 'depths-entry'};
    }
    return {
        safe: false,
        template: sanitizedCandidateMatches(rewritten, original)
            ? rewritten
            : original,
        audit: 'detection-only'
    };
}

function withBranchEndRuntimeMetadata(template, safe, audit) {
    const partial = !template?.metadata?.encompass;
    const place = template?.metadata?.place;
    return {
        ...template,
        metadata: {
            ...template.metadata,
            ...(partial ? {
                partial: true,
                presenceKey: `place:${place}`
            } : {}),
            parseWarnings: [],
            sourceAudit: safe
                ? `branch-end-coarse-${audit}-v1`
                : 'branch-end-detection-only-v1',
            matchPolicy: safe
                ? {...AUDITED_BRANCH_END_FORCE_POLICY}
                : {...UNSAFE_BRANCH_END_POLICY}
        }
    };
}

/**
 * Produces one complete, branch-local closed set for the six ordinary branch
 * endings audited by this module. Normal reveal remains disabled for every
 * partial. Exact coarse terrain candidates may be inspected with the explicit
 * unsafe force command; unresolved conditional terrain may not.
 */
export function auditedBranchEndFamilyTemplates(
    source,
    parsed,
    options = {},
    existingTemplates = []
) {
    const path = String(options?.path || '');
    if (!auditedBranchEndPath(path)) {
        return [];
    }
    const cocCove = auditedCocCoveTemplate(
        source,
        parsed,
        options,
        existingTemplates
    );
    const specialTemplates = cocCove ? [cocCove] : [];
    const existingNames = namesOf([
        ...existingTemplates,
        ...specialTemplates
    ]);
    const rawCandidates = naturalBranchEndPrimaries(parsed, path)
        .filter(template => !existingNames.has(template.name));
    const featureAudit = vaultFeatureHelperAudit(options?.dependencies);
    const depthsEntry = DEPTHS_ENTRY_PATH.test(path);
    const rewrittenSource = rewriteDepthsEntryCalls(
        source,
        depthsEntry && depthsEntryHelperIsSafe(source)
    );
    const sanitized = sanitizeBranchSource(rewriteVaultFeatureHelpers(
        stripTerrainNeutralBranchLines(rewrittenSource),
        featureAudit
    ));
    const rewrittenByName = new Map(parseDes(
        sanitized.source,
        options
    ).map(template => [
        template.name,
        applyBranchMask(template, sanitized.masks.get(template.name))
    ]));

    const genericTemplates = rawCandidates.map(original => {
        const result = branchEndCandidateAudit({
            source,
            original,
            rewritten: rewrittenByName.get(original.name),
            block: luaMapBlock(source, original.name),
            featureAudit,
            dependencies: options?.dependencies,
            depthsEntry
        });
        return withBranchEndRuntimeMetadata(
            result.template,
            result.safe,
            result.audit
        );
    });
    return [...specialTemplates, ...genericTemplates];
}

/**
 * Retains every still-unsupported natural branch-end primary as a negative
 * terrain candidate. These templates can stop a supported sibling from being
 * falsely labelled, but they can neither reveal nor be force-revealed: their
 * Lua/helper terrain and placement have not been audited yet.
 */
export function branchEndDetectionTemplates(
    parsed,
    options = {},
    existingTemplates = []
) {
    const path = String(options?.path || '');
    if (!BRANCH_DES_PATH.test(path)) {
        return [];
    }
    const existingNames = namesOf(existingTemplates);
    return naturalBranchEndPrimaries(parsed, path).flatMap(template => {
        if (existingNames.has(template.name)) {
            return [];
        }
        const partial = !template?.metadata?.encompass;
        const place = template?.metadata?.place;
        return [{
            ...template,
            metadata: {
                ...template.metadata,
                ...(partial ? {
                    partial: true,
                    presenceKey: `place:${place}`
                } : {}),
                parseWarnings: [],
                sourceAudit: 'branch-end-detection-only-v1',
                matchPolicy: {...GENERIC_BRANCH_END_DETECTION_POLICY}
            }
        }];
    });
}

function namesOf(templates) {
    return new Set((templates || []).map(template => template?.name)
        .filter(Boolean));
}

/**
 * Returns one machine-readable source/runtime coverage row. Callers may pass
 * the post-player-filter list as `selected` to distinguish catalogued maps
 * from maps actually competing on that floor.
 */
export function summarizeBranchEndCoverage({
    parsed = [],
    runtime = [],
    selected = [],
    path = null
} = {}) {
    const rawCandidates = naturalBranchEndPrimaries(parsed, path);
    const rawNames = namesOf(rawCandidates);
    const runtimeCandidates = (runtime || []).filter(template =>
        rawNames.has(template?.name));
    const selectedCandidates = (selected || []).filter(template =>
        rawNames.has(template?.name));
    const runtimeNames = namesOf(runtimeCandidates);
    const revealable = runtimeCandidates.filter(template =>
        template?.metadata?.matchPolicy?.revealDisabled !== true);
    const detectionOnly = runtimeCandidates.filter(template =>
        template?.metadata?.matchPolicy?.revealDisabled === true);
    const placementVerified = revealable.filter(template =>
        template?.metadata?.matchPolicy?.exhaustivePlacement === true
        || template?.metadata?.matchAnchor != null
        || template?.metadata?.entryAnchorGlyph != null
        || template?.metadata?.entryAnchorGlyphs != null);
    const placementUnverified = revealable.filter(template =>
        !placementVerified.includes(template));
    const place = normalizedBranchEndPlace(
        rawCandidates[0]?.metadata?.place
    );
    return {
        path,
        place,
        raw: rawCandidates.length,
        runtime: runtimeCandidates.length,
        selected: selectedCandidates.length,
        revealable: revealable.length,
        detectionOnly: detectionOnly.length,
        placementVerified: placementVerified.length,
        placementUnverified: placementUnverified.length,
        rawNames: [...rawNames].sort(),
        runtimeNames: [...runtimeNames].sort(),
        selectedNames: [...namesOf(selectedCandidates)].sort(),
        revealableNames: [...namesOf(revealable)].sort(),
        detectionOnlyNames: [...namesOf(detectionOnly)].sort(),
        placementVerifiedNames: [...namesOf(placementVerified)].sort(),
        placementUnverifiedNames: [...namesOf(placementUnverified)].sort(),
        missingNames: [...rawNames].filter(name => !runtimeNames.has(name)).sort()
    };
}
