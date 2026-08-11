const TEMPLE_PATH_SUFFIX = '/dat/des/branches/temple.des';

// The d29df338 and 1b83f8de builds currently served by CNC contain the same
// temple.des bytes. Temple anchoring depends on Crawl's post-generation stair
// fixup, so a changed source inventory must be audited again instead of
// silently inheriting this proof.
const AUDITED_SOURCE = Object.freeze({
    length: 170713,
    fnv1a: 0xd0caacee,
    mix: 0x53d7ca2b,
    naturalMaps: 94
});

const ALL_TRANSFORMS = 'all';
const NO_QUARTER_TURN = 'no-quarter-turn';
const IDENTITY_ONLY = 'identity-only';

// [name, width, height, possible `{` cells, fixed `{` cells, transforms]
// This is deliberately an inventory rather than a name-prefix filter. A new
// warning-free Temple map is not source-closed until its exit construction is
// checked against _fixup_branch_stairs().
const AUDITED_MAP_ROWS = Object.freeze([
    ['nicolae_temple_stand_before_the_council', 16, 15, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_colour_theory', 37, 23, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_godpark', 29, 29, 1, 1, ALL_TRANSFORMS],
    ['pf_temple_reverse_labyrinth', 33, 38, 1, 1, ALL_TRANSFORMS],
    ['jpeg_temple_alley_garden', 64, 23, 1, 1, NO_QUARTER_TURN],
    ['jpeg_temple_island', 49, 37, 3, 0, NO_QUARTER_TURN],
    ['cyrus_temple_forest', 47, 19, 1, 1, NO_QUARTER_TURN],
    ['minmay_temple_forest_path', 50, 38, 1, 1, ALL_TRANSFORMS],
    ['minmay_temple_curvy_loop', 34, 43, 1, 1, NO_QUARTER_TURN],
    ['nicolae_temple_hex_pool', 31, 33, 6, 0, ALL_TRANSFORMS],
    ['nicolae_temple_figure_zero', 29, 29, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_cloud_nine', 19, 19, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_godzebo', 50, 33, 1, 1, ALL_TRANSFORMS],
    ['dshaligram_water_room_temple', 51, 19, 1, 1, NO_QUARTER_TURN],
    ['eino_temple_water', 33, 55, 1, 1, NO_QUARTER_TURN],
    ['cyrus_circular_temple', 31, 21, 1, 1, NO_QUARTER_TURN],
    ['minmay_temple_curvy_branch', 55, 39, 1, 1, ALL_TRANSFORMS],
    ['oiseaux_autumnal_temple', 40, 47, 1, 1, NO_QUARTER_TURN],
    ['nicolae_temple_figure_eight', 45, 29, 6, 0, ALL_TRANSFORMS],
    ['nicolae_temple_god_jail', 29, 13, 1, 1, ALL_TRANSFORMS],
    ['regret_index_temple_waves', 27, 31, 2, 0, NO_QUARTER_TURN],
    ['regret_index_temple_generic_petals', 33, 31, 1, 1, NO_QUARTER_TURN],
    ['dpeg_five_rooms_temple', 47, 31, 1, 1, NO_QUARTER_TURN],
    ['eino_temple_scatter_basement', 35, 33, 1, 1, NO_QUARTER_TURN],
    ['eino_temple_rhombus', 43, 43, 1, 1, ALL_TRANSFORMS],
    ['minmay_crystal_spiral_temple', 43, 43, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_elliptical', 49, 31, 8, 0, ALL_TRANSFORMS],
    ['regret_index_temple_chain_breaker', 45, 25, 1, 1, NO_QUARTER_TURN],
    ['regret_index_temple_mists', 51, 29, 1, 1, NO_QUARTER_TURN],
    ['regret_index_temple_sphere_string', 65, 27, 1, 1, NO_QUARTER_TURN],
    ['mainiacjoe_temple_coin_purse', 35, 37, 1, 1, ALL_TRANSFORMS],
    ['mainiacjoe_temple_bowtie_tessellation', 49, 49, 1, 1, ALL_TRANSFORMS],
    ['mainiacjoe_temple_big_plus', 43, 43, 1, 1, ALL_TRANSFORMS],
    ['mainiacjoe_temple_cubbyholes', 46, 41, 1, 1, ALL_TRANSFORMS],
    ['sentei_temple_godly_chess', 12, 12, 1, 1, IDENTITY_ONLY],
    ['kilobyte_greek_temple', 61, 21, 1, 1, NO_QUARTER_TURN],
    ['minmay_crystal_snake_temple', 37, 43, 3, 0, NO_QUARTER_TURN],
    ['roderic_octagonal_lattice_temple', 43, 33, 1, 1, NO_QUARTER_TURN],
    ['grunt_wide_crystal_templ', 37, 21, 1, 1, NO_QUARTER_TURN],
    ['nicolae_temple_the_god_donut', 53, 53, 5, 0, ALL_TRANSFORMS],
    ['regret_index_temple_sigil_plot', 51, 43, 12, 0, ALL_TRANSFORMS],
    ['mainiacjoe_temple_archimedes_tessellation', 65, 49, 22, 0, ALL_TRANSFORMS],
    ['mainiacjoe_temple_circle_huts', 63, 63, 1, 1, ALL_TRANSFORMS],
    ['mainiacjoe_temple_hex_bubbles', 51, 51, 22, 0, ALL_TRANSFORMS],
    ['mainiacjoe_temple_starburst', 69, 69, 1, 1, ALL_TRANSFORMS],
    ['mainiacjoe_temple_trianglar_array', 55, 55, 1, 1, ALL_TRANSFORMS],
    ['regret_index_temple_trove_trio', 42, 15, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_ziggedy_zaggedy', 27, 23, 1, 1, ALL_TRANSFORMS],
    ['nicolae_temple_dense_god_circle', 18, 18, 1, 1, ALL_TRANSFORMS],
    ['pf_slimified_temple', 43, 11, 1, 1, NO_QUARTER_TURN],
    ['pf_slime_end_temple', 28, 28, 1, 1, ALL_TRANSFORMS],
    ['hellmonk_choose_your_character', 19, 21, 1, 1, IDENTITY_ONLY],
    ['ebering_the_one_and_only', 5, 5, 1, 1, ALL_TRANSFORMS]
]);

const AUDITED_MAPS = new Map(AUDITED_MAP_ROWS.map(row => [row[0], Object.freeze({
    width: row[1],
    height: row[2],
    anchorCells: row[3],
    fixedAnchorCells: row[4],
    transforms: row[5]
})]));

const DYNAMIC_ANCHOR_PROOFS = Object.freeze({
    jpeg_temple_island: Object.freeze({
        raw: Object.freeze({'{': 0, A: 3}),
        lines: Object.freeze(["NSUBST: A = 1:{ / *:'"])
    }),
    nicolae_temple_hex_pool: Object.freeze({
        raw: Object.freeze({'{': 6}),
        lines: Object.freeze(['NSUBST: { = 1:{ / *:.'])
    }),
    nicolae_temple_figure_eight: Object.freeze({
        raw: Object.freeze({'{': 0, A: 6}),
        lines: Object.freeze(['NSUBST: A = 1:{ / *:B'])
    }),
    regret_index_temple_waves: Object.freeze({
        raw: Object.freeze({'{': 1, '<': 1}),
        lines: Object.freeze(['SHUFFLE: {<defgh / {<defgh / <{hgfed'])
    }),
    nicolae_temple_elliptical: Object.freeze({
        raw: Object.freeze({'{': 4, G: 4}),
        lines: Object.freeze(['SHUFFLE: G{', 'NSUBST: { = 1:{ / *:G'])
    }),
    minmay_crystal_snake_temple: Object.freeze({
        raw: Object.freeze({'{': 0, T: 3}),
        lines: Object.freeze(['NSUBST: T = 1:{ / *:T'])
    }),
    nicolae_temple_the_god_donut: Object.freeze({
        raw: Object.freeze({'{': 0, A: 5}),
        lines: Object.freeze(['NSUBST: A = 1:{ / *:B'])
    }),
    regret_index_temple_sigil_plot: Object.freeze({
        raw: Object.freeze({'{': 0, A: 12}),
        lines: Object.freeze(['NSUBST: A = 1:{ / *:B'])
    }),
    mainiacjoe_temple_archimedes_tessellation: Object.freeze({
        raw: Object.freeze({'{': 0, B: 22}),
        lines: Object.freeze(['NSUBST: B = 1:{ / *:B'])
    }),
    mainiacjoe_temple_hex_bubbles: Object.freeze({
        raw: Object.freeze({'{': 0, B: 22}),
        lines: Object.freeze(['NSUBST: B = 1:{ / *:B'])
    })
});

const EXPECTED_TRANSFORMS = Object.freeze({
    [ALL_TRANSFORMS]: Object.freeze([
        'identity', 'rotate90', 'rotate180', 'rotate270',
        'mirrorX', 'mirrorY', 'mirrorDiagonal', 'mirrorAntiDiagonal'
    ]),
    [NO_QUARTER_TURN]: Object.freeze([
        'identity', 'rotate180', 'mirrorX', 'mirrorY'
    ]),
    [IDENTITY_ONLY]: Object.freeze(['identity'])
});

function sourceFingerprint(source) {
    const text = String(source || '');
    let fnv1a = 0x811c9dc5;
    let mix = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        fnv1a = Math.imul(fnv1a ^ code, 0x01000193) >>> 0;
        mix = (Math.imul(mix ^ code, 0x85ebca77) + 0xc2b2ae3d) >>> 0;
    }
    return {length: text.length, fnv1a, mix};
}

function sourceIsAudited(source) {
    const actual = sourceFingerprint(source);
    return actual.length === AUDITED_SOURCE.length
        && actual.fnv1a === AUDITED_SOURCE.fnv1a
        && actual.mix === AUDITED_SOURCE.mix;
}

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(String(source || ''));
    if (!match) {
        return null;
    }
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const tail = String(source).slice(start + 1);
    const next = /\nNAME:\s*/u.exec(tail);
    return String(source).slice(
        start,
        next ? start + 1 + next.index : undefined
    );
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function logicalHeaderLines(block) {
    const header = String(block || '').split(/^MAP\s*$/mu, 1)[0];
    const result = [];
    let pending = '';
    for (const physical of header.split('\n')) {
        const continued = /\\\s*$/u.test(physical);
        const part = continued
            ? physical.replace(/\\\s*$/u, '')
            : physical;
        pending = pending ? `${pending} ${part.trimStart()}` : part;
        if (!continued) {
            result.push(pending);
            pending = '';
        }
    }
    if (pending) {
        result.push(pending);
    }
    return result;
}

function normalizedDirectiveLines(block) {
    return logicalHeaderLines(block).flatMap(line => {
        const match = /^\s*(NSUBST|SHUFFLE|SUBST|CLEAR|KFEAT)\s*:\s*(.*?)\s*$/u
            .exec(line);
        return match
            ? [`${match[1]}: ${match[2].replace(/\s+/gu, ' ')}`]
            : [];
    });
}

function rawGlyphCount(rows, glyph) {
    let count = 0;
    for (const row of rows) {
        for (const value of row) {
            count += value === glyph ? 1 : 0;
        }
    }
    return count;
}

function anchorProofIsClosed(name, block, rows) {
    const dynamic = DYNAMIC_ANCHOR_PROOFS[name];
    const directives = normalizedDirectiveLines(block);
    if (!dynamic) {
        // With one literal stone stair up and no terrain operation touching
        // it, _fixup_branch_stairs() converts that exact square to
        // DNGN_EXIT_TEMPLE and records a feature marker for the original
        // DNGN_STONE_STAIRS_UP_I. dgn_find_nearby_stair() checks that marker
        // before any other Temple exit (notably an escape hatch).
        return rawGlyphCount(rows, '{') === 1
            && directives.every(line => !line.includes('{'));
    }
    return Object.entries(dynamic.raw).every(([glyph, count]) =>
        rawGlyphCount(rows, glyph) === count)
        && dynamic.lines.every(line => directives.includes(line));
}

function borderFillKind(block) {
    const header = String(block || '').split(/^MAP\s*$/mu, 1)[0];
    const calls = [...header.matchAll(
        /^\s*:\s*set_border_fill_type\s*\(\s*(["'])([^"']+)\1\s*\)\s*$/gmu
    )];
    const callCount = [...header.matchAll(/\bset_border_fill_type\s*\(/gu)]
        .length;
    if (callCount === 0) {
        return 'wall';
    }
    if (callCount !== 1 || calls.length !== 1) {
        return null;
    }
    return {
        rock_wall: 'wall',
        open_sea: 'deep_water',
        endless_lava: 'lava'
    }[calls[0][2]] || null;
}

function looseAssignment(value) {
    const text = String(value || '').trim();
    const match = /^(\S+)\s+([=:])\s*(.*)$/u.exec(text)
        || /^([^:=\s]+)([=:])(.*)$/u.exec(text);
    return match && match[1] && match[3]
        ? {glyphs: [...match[1].replace(/\s+/gu, '')], value: match[3]}
        : null;
}

function replacementGlyphs(value) {
    const result = new Set();
    const withoutWeights = String(value || '')
        .replace(/:\d+/gu, '')
        .replace(/(?:^|\s)(?:\*|\d+)\s*[=:]\s*/gu, ' ');
    for (const glyph of withoutWeights.replace(/[\s/,]/gu, '')) {
        result.add(glyph);
    }
    return result;
}

function coarseTerrainAudit(block) {
    const header = String(block || '').split(/^MAP\s*$/mu, 1)[0];
    const logicalLines = logicalHeaderLines(block);
    const tainted = new Set();
    const edges = new Map();
    const featureKinds = new Map();
    const addEdge = (from, to) => {
        if (!edges.has(from)) {
            edges.set(from, new Set());
        }
        edges.get(from).add(to);
    };

    for (const line of logicalLines) {
        const directive = /^\s*(SUBST|NSUBST|SHUFFLE|CLEAR|KFEAT|MARKER)\s*:\s*(.*?)\s*$/u
            .exec(line);
        if (!directive) {
            continue;
        }
        const key = directive[1];
        const value = directive[2];
        if (key === 'SHUFFLE') {
            for (const part of value.split(',')) {
                const glyphs = [...new Set(
                    part.replace(/[\s/]/gu, '')
                )];
                for (const glyph of glyphs) {
                    tainted.add(glyph);
                    for (const replacement of glyphs) {
                        addEdge(glyph, replacement);
                    }
                }
            }
            continue;
        }
        if (key === 'CLEAR') {
            for (const glyph of value.replace(/\s+/gu, '')) {
                tainted.add(glyph);
            }
            continue;
        }
        for (const part of value.split(',')) {
            const assignment = looseAssignment(part);
            if (!assignment) {
                continue;
            }
            for (const glyph of assignment.glyphs) {
                tainted.add(glyph);
                if (key === 'KFEAT') {
                    const kinds = new Set(assignment.value.split('/')
                        .flatMap(feature => coarseKindsForFeature(feature)));
                    featureKinds.set(glyph, kinds);
                    continue;
                }
                for (const replacement of replacementGlyphs(assignment.value)) {
                    addEdge(glyph, replacement);
                }
            }
        }
    }

    // Four older temples express count-dependent substitutions directly in
    // Lua. Their raw glyph is unsafe coarse terrain even though the parser's
    // warning has already tainted the ordinary template.
    for (const call of header.matchAll(
        /\bnsubst\s*\(\s*(["'])([\s\S]*?)\1\s*\)/gu
    )) {
        const assignment = looseAssignment(call[2]);
        for (const glyph of assignment?.glyphs || []) {
            tainted.add(glyph);
            for (const replacement of replacementGlyphs(
                assignment?.value || ''
            )) {
                addEdge(glyph, replacement);
            }
        }
    }
    for (const line of logicalLines) {
        const dynamic = /\bnsubst\s*\(\s*["']([^"'=:\s]+)\s*=/u
            .exec(line);
        if (!dynamic) {
            continue;
        }
        for (const glyph of dynamic[1]) {
            tainted.add(glyph);
            if (line.includes('{')) {
                addEdge(glyph, '{');
            }
        }
    }

    // Exact helper calls in the audited source either affect only clouds or
    // replace the named glyph with a statue. Mask the latter instead of
    // depending on its implementation in vault.lua for a negative candidate.
    for (const call of header.matchAll(
        /vault_(?:granite|metal)_statue_setup\s*\(\s*_G\s*,\s*(["'])(.)\1/gu
    )) {
        tainted.add(call[2]);
    }

    const reachesExit = new Map();
    const canReachExit = (glyph, visiting = new Set()) => {
        if (glyph === '{') {
            return true;
        }
        if (reachesExit.has(glyph)) {
            return reachesExit.get(glyph);
        }
        if (visiting.has(glyph)) {
            return false;
        }
        const nextVisiting = new Set(visiting).add(glyph);
        const result = [...(edges.get(glyph) || [])].some(next =>
            canReachExit(next, nextVisiting));
        reachesExit.set(glyph, result);
        return result;
    };
    const reachableGlyphs = glyph => {
        const result = new Set();
        const pending = [glyph];
        while (pending.length) {
            const next = pending.pop();
            if (result.has(next)) {
                continue;
            }
            result.add(next);
            pending.push(...(edges.get(next) || []));
        }
        return result;
    };
    const possibleKinds = (glyph, tags) => [...reachableGlyphs(glyph)]
        .flatMap(value => [
            ...coarseKindForGlyph(value, tags),
            ...(featureKinds.get(value) || [])
        ]);
    return {tainted, canReachExit, possibleKinds};
}

function coarseKindsForFeature(feature) {
    const raw = String(feature || '').trim()
        .replace(/^w:\d+\s+/u, '');
    if (raw.length === 1) {
        return coarseKindForGlyph(raw, new Set());
    }
    const value = raw.toLowerCase()
        .replace(/^w:\d+\s+/u, '')
        .replace(/[ -]+/gu, '_');
    if (value.includes('open_door')) {
        return ['floor'];
    }
    if (value.includes('door')) {
        return ['door'];
    }
    if (value.includes('deep_water') || value.includes('open_sea')) {
        return ['deep_water', 'shallow_water'];
    }
    if (value.includes('shallow_water')) {
        return ['shallow_water'];
    }
    if (value.includes('lava')) {
        return ['lava'];
    }
    if (value.includes('wall') || value.includes('tree')
        || value.includes('grate')) {
        return ['wall'];
    }
    if (value.includes('altar')) {
        return ['altar'];
    }
    if (value.includes('statue') || value.includes('idol')) {
        return ['statue'];
    }
    if (value.includes('stair') || value.includes('hatch')) {
        return ['stairs'];
    }
    if (value.startsWith('enter_') || value.startsWith('exit_')
        || value.includes('portal') || value.includes('gateway')) {
        return ['portal'];
    }
    return ['floor'];
}

function coarseKindForGlyph(glyph, tags) {
    if ('xcvbmno'.includes(glyph) || glyph === 't') {
        return ['wall'];
    }
    if ('+='.includes(glyph)) {
        return ['door'];
    }
    if (glyph === 'w') {
        return tags.has('no_pool_fixup')
            ? ['deep_water']
            : ['deep_water', 'shallow_water'];
    }
    if (glyph === 'W') {
        return ['shallow_water'];
    }
    if (glyph === 'l') {
        return ['lava'];
    }
    if ('><}{)(]['.includes(glyph)) {
        return ['stairs'];
    }
    if (glyph === 'A' || 'TUVY'.includes(glyph) || glyph === '^') {
        return ['floor'];
    }
    if ('BC'.includes(glyph)) {
        return ['altar'];
    }
    if ('IG'.includes(glyph)) {
        return ['statue'];
    }
    return ['floor'];
}

function detectionOnlyTemplate(template, block) {
    const rows = mapRows(block);
    const fillKind = borderFillKind(block);
    if (!fillKind || rows.length !== template.height
        || rows.reduce((width, row) => Math.max(width, row.length), 0)
            !== template.width) {
        return null;
    }
    const tags = new Set(template.metadata?.tags || []);
    const terrain = coarseTerrainAudit(block);
    let constrainedCells = 0;
    let entryAnchorCells = 0;
    const grid = Array.from({length: template.height}, (_, y) =>
        Array.from({length: template.width}, (_, x) => {
            const raw = x < rows[y].length ? rows[y][x] : ' ';
            if (raw === ' ') {
                constrainedCells++;
                return {
                    kinds: [fillKind],
                    certain: true,
                    glyph: ' ',
                    possibleGlyphs: [' ']
                };
            }
            const anchor = terrain.canReachExit(raw);
            entryAnchorCells += anchor ? 1 : 0;
            if (terrain.tainted.has(raw)) {
                const safeKinds = [...new Set(
                    terrain.possibleKinds(raw, tags)
                )];
                if (safeKinds.length === 1) {
                    constrainedCells++;
                    return {
                        kinds: safeKinds,
                        certain: true,
                        glyph: raw,
                        possibleGlyphs: anchor && raw !== '{'
                            ? [raw, '{']
                            : [raw]
                    };
                }
                return anchor ? {
                    kinds: ['unknown'],
                    certain: false,
                    glyph: raw,
                    possibleGlyphs: raw === '{' ? ['{'] : [raw, '{']
                } : null;
            }
            constrainedCells++;
            return {
                kinds: coarseKindForGlyph(raw, tags),
                certain: true,
                glyph: raw,
                possibleGlyphs: [raw]
            };
        }));
    if (!entryAnchorCells || constrainedCells < 18) {
        return null;
    }
    return {
        ...template,
        grid,
        metadata: {
            ...template.metadata,
            parseWarnings: [],
            hasUncertainCells: true,
            sourceAudit: 'temple-detection-only-v1',
            entryAnchorGlyph: '{',
            entryAnchorObservedKind: 'stair',
            implicitFillKind: fillKind,
            coarseConstrainedCells: constrainedCells,
            coarseEntryAnchorCells: entryAnchorCells,
            matchPolicy: {
                minScore: 0.995,
                minEvidenceCells: 18,
                minEvidenceWeight: 22,
                minDistinctKinds: 2,
                minCoverage: 0.01,
                minSpanXRatio: 0.1,
                minSpanYRatio: 0.1,
                revealDisabled: true,
                forceRevealDisabled: true
            }
        }
    };
}

function transformInventoryMatches(template, spec) {
    const actual = template?.metadata?.allowedTransforms;
    const expected = EXPECTED_TRANSFORMS[spec.transforms];
    return Array.isArray(actual)
        && actual.length === expected.length
        && actual.every((name, index) => name === expected[index]);
}

function anchorCellCounts(template) {
    let possible = 0;
    let fixed = 0;
    for (const row of template.grid || []) {
        for (const cell of row || []) {
            const glyphs = cell?.possibleGlyphs;
            if (!Array.isArray(glyphs) || !glyphs.includes('{')) {
                continue;
            }
            possible++;
            fixed += glyphs.length === 1 ? 1 : 0;
        }
    }
    return {possible, fixed};
}

function materializeFill(template, rows, kind) {
    let filledCells = 0;
    const grid = template.grid.map((row, y) => row.map((cell, x) => {
        if (x < rows[y].length && rows[y][x] !== ' ') {
            return cell;
        }
        filledCells++;
        return {
            kinds: [kind],
            certain: true,
            glyph: ' ',
            possibleGlyphs: [' ']
        };
    }));
    return {grid, filledCells};
}

function normalizedKinds(template) {
    const aliases = new Map([
        ['stairs', 'stair'],
        ['tree', 'wall']
    ]);
    const kinds = new Set();
    for (const row of template.grid || []) {
        for (const cell of row || []) {
            for (const raw of cell?.kinds || []) {
                if (!['unknown', 'void'].includes(raw)) {
                    kinds.add(aliases.get(raw) || raw);
                }
            }
        }
    }
    return kinds;
}

function templeMatchPolicy(template) {
    const kinds = normalizedKinds(template);
    const structural = ['wall', 'deep_water', 'lava']
        .find(kind => kinds.has(kind));
    return {
        minScore: 0.995,
        minEvidenceCells: template.width * template.height <= 36 ? 12 : 72,
        minEvidenceWeight: template.width * template.height <= 36 ? 14 : 84,
        minDistinctKinds: 2,
        minCoverage: template.width * template.height <= 36 ? 0.4 : 0.04,
        minSpanXRatio: 0.25,
        minSpanYRatio: 0.25,
        requiredKinds: structural ? ['floor', structural] : ['floor']
    };
}

function templateIsAudited(template, spec, block) {
    const rows = mapRows(block);
    const anchors = anchorCellCounts(template);
    const fillKind = borderFillKind(block);
    return template?.metadata?.place === 'Temple'
        && template?.metadata?.orient === 'encompass'
        && template?.metadata?.encompass === true
        && Array.isArray(template?.metadata?.parseWarnings)
        && template.metadata.parseWarnings.length === 0
        && template.width === spec.width
        && template.height === spec.height
        && rows.length === spec.height
        && rows.reduce((width, row) => Math.max(width, row.length), 0)
            === spec.width
        && anchors.possible === spec.anchorCells
        && anchors.fixed === spec.fixedAnchorCells
        && anchorProofIsClosed(template.name, block, rows)
        && fillKind !== null
        && transformInventoryMatches(template, spec);
}

/**
 * Returns null for non-Temple sources, an empty array for a changed/unsafe
 * Temple source, and the exact anchored destination inventory otherwise.
 */
export function auditedTempleDestinationTemplates(source, parsed, options = {}) {
    const path = String(options?.path || '');
    if (!path.endsWith(TEMPLE_PATH_SUFFIX)) {
        return null;
    }
    if (!sourceIsAudited(source) || !Array.isArray(parsed)) {
        return [];
    }

    const natural = parsed.filter(template =>
        template?.metadata?.place === 'Temple'
        && template?.metadata?.encompass === true);
    const safe = natural.filter(template =>
        Array.isArray(template?.metadata?.parseWarnings)
        && template.metadata.parseWarnings.length === 0);
    if (natural.length !== AUDITED_SOURCE.naturalMaps
        || safe.length !== AUDITED_MAPS.size
        || safe.some(template => !AUDITED_MAPS.has(template.name))
        || [...AUDITED_MAPS.keys()].some(name =>
            !safe.some(template => template.name === name))) {
        return [];
    }

    const result = [];
    for (const template of natural) {
        const spec = AUDITED_MAPS.get(template.name);
        const block = mapBlock(source, template.name);
        if (!block) {
            return [];
        }
        if (!spec) {
            const detection = detectionOnlyTemplate(template, block);
            if (!detection) {
                return [];
            }
            result.push(detection);
            continue;
        }
        if (!templateIsAudited(template, spec, block)) {
            return [];
        }
        const rows = mapRows(block);
        const fillKind = borderFillKind(block);
        const materialized = materializeFill(template, rows, fillKind);
        const withGrid = {...template, grid: materialized.grid};
        result.push({
            ...withGrid,
            metadata: {
                ...template.metadata,
                sourceAudit: 'temple-encompass-entry-v1',
                entryAnchorGlyph: '{',
                entryAnchorObservedKind: 'stair',
                implicitFillKind: fillKind,
                implicitFillCells: materialized.filledCells,
                matchPolicy: templeMatchPolicy(withGrid)
            }
        });
    }
    return result;
}

export const auditedTempleDestinationNames = Object.freeze(
    [...AUDITED_MAPS.keys()]
);
