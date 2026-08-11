import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {MapMatcher, normalizeTerrainKind} from '../matcher.js';

const REVISIONS = Object.freeze([
    Object.freeze({
        name: 'd29',
        sha: 'd29df338190a301517290f9f7fd72d9b7ec79297',
        root: '/tmp/dwem-crawl-d29/crawl-ref'
    }),
    Object.freeze({
        name: '1b83',
        sha: '1b83f8deabb8a25598e5bcbc2a041e5f43242734',
        root: '/tmp/dwem-crawl-1b83/crawl-ref'
    })
]);
const SHOALS_PATH = 'crawl-ref/source/dat/des/branches/shoals.des';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const DIRECT = Object.freeze({
    shoals_end_hellmonk_lost_city: Object.freeze({
        width: 62, height: 49, entries: 87
    }),
    shoals_end_hellmonk_holy_island: Object.freeze({
        width: 59, height: 58, entries: 4
    })
});
const FAMILY = Object.freeze([
    ...Object.keys(DIRECT),
    'shoals_end_hellmonk_storm_palace'
]);

function read(revision, relative) {
    const filename = path.join(
        revision.root,
        relative.replace(/^crawl-ref\//u, '')
    );
    if (!fs.existsSync(filename)) {
        throw new Error(`exact Crawl source unavailable: ${filename}`);
    }
    return fs.readFileSync(filename, 'utf8');
}

function rawBlocks(source) {
    const matches = [...String(source).matchAll(/^NAME:\s*(\S+)\s*$/gmu)];
    return new Map(matches.map((match, index) => [
        match[1],
        String(source).slice(
            match.index,
            matches[index + 1]?.index ?? String(source).length
        )
    ]));
}

function rawTags(block) {
    return new Set([...String(block).matchAll(/^TAGS:\s*(.*?)\s*$/gmu)]
        .flatMap(match => match[1].trim().split(/\s+/u))
        .filter(Boolean));
}

function rawPlace(block) {
    return String(block).match(/^PLACE:\s*(.*?)\s*$/mu)?.[1] || null;
}

function rawMapRows(block) {
    const match = String(block).match(
        /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u
    );
    return match ? match[1].split('\n') : [];
}

function activeShoalsEndNames(blocks) {
    return [...blocks].flatMap(([name, block]) => {
        const tags = rawTags(block);
        return rawPlace(block) === 'Shoals:$' && /^MAP\s*$/mu.test(block)
            && !tags.has('removed') && !tags.has('unrand')
            ? [name]
            : [];
    }).sort();
}

function entryPoints(template) {
    const glyphs = new Set(['{', '(', '[', '<']);
    const points = [];
    template.grid.forEach((row, y) => row.forEach((cell, x) => {
        const possible = new Set([
            cell?.glyph,
            ...(cell?.possibleGlyphs || [])
        ]);
        if ([...glyphs].some(glyph => possible.has(glyph))) {
            points.push({x, y});
        }
    }));
    return points;
}

function normalizedKinds(cell) {
    return [...new Set((cell?.kinds || [])
        .map(normalizeTerrainKind)
        .filter(Boolean))];
}

function applyGlyphMapping(glyphs, mapping) {
    return new Set([...glyphs].flatMap(glyph =>
        mapping[glyph] || [glyph]));
}

function independentPossibleGlyphs(name, rawGlyph) {
    let glyphs = new Set([rawGlyph]);
    const apply = mapping => {
        glyphs = applyGlyphMapping(glyphs, mapping);
    };
    if (name === 'shoals_end_hellmonk_lost_city') {
        // Exact mapdef.cc block shuffle permutes equal-length segments as
        // units. Consequently d/e/f form one column and %/*/| the other.
        apply({
            d: ['d', 'e', 'f'], e: ['d', 'e', 'f'], f: ['d', 'e', 'f'],
            '%': ['%', '*', '|'], '*': ['%', '*', '|'],
            '|': ['%', '*', '|']
        });
        apply({'|': ['O', '|']});
        apply({
            d: ['.'], e: ['.'], '%': ['|'], '*': ['|'],
            1: ['1', '.'], 2: ['2', '.'], 3: ['3', '4'],
            G: ['G', '.'], R: ['R', '.']
        });
        apply(Object.fromEntries([...';pqrsyz'].map(glyph =>
            [glyph, ['W', '.']])));
        apply({'.': ['.', '0', 'W']});
        apply({D: ['x', '.'], c: ['c', '.']});
        apply({"'": ['(', '[', '{', '<', '.', 'P']});
        return glyphs;
    }
    assert.equal(name, 'shoals_end_hellmonk_holy_island');
    apply({
        H: ['H', 'I', 'J'], I: ['H', 'I', 'J'], J: ['H', 'I', 'J'],
        h: ['h', 'i', 'j'], i: ['h', 'i', 'j'], j: ['h', 'i', 'j'],
        D: ['D', 'E', 'F'], E: ['D', 'E', 'F'], F: ['D', 'E', 'F']
    });
    apply({I: ['|'], J: ['|'], i: ['.'], j: ['.']});
    apply({'<': ['(', '[', '{', '<']});
    apply({'-': ['W', "'", 'P'], _: ['W', "'", 'P']});
    // map_lines resolves the two clauses on this SUBST line in order.
    apply({3: ['3', '0']});
    apply({0: ['0', '.']});
    apply({4: ['4', '5', '.']});
    apply({"'": ["'", '1', '2', 'P']});
    apply({q: ['c', "'"], r: ['c', "'"], s: ['c', "'"]});
    return glyphs;
}

function independentTideKinds(name, glyphs) {
    const kinds = new Set();
    for (const glyph of glyphs) {
        if (glyph === '+') {
            kinds.add('door');
        } else if (glyph === 'x' || glyph === 'c') {
            kinds.add('wall');
        } else if (glyph === 'W') {
            kinds.add('shallow_water');
            kinds.add('floor');
        } else if (glyph === 'w') {
            // Crawl's ordinary pool fixup may first make deep water shallow;
            // a shallow result is subsequently tide-susceptible.
            kinds.add('deep_water');
            kinds.add('shallow_water');
            kinds.add('floor');
        } else if (['(', '[', '{', '<'].includes(glyph)) {
            kinds.add('stair');
        } else if (glyph === 'G') {
            kinds.add('statue');
        } else if (name === 'shoals_end_hellmonk_holy_island'
            && ['D', 'E', 'F'].includes(glyph)) {
            kinds.add('altar');
        } else {
            kinds.add('floor');
            kinds.add('shallow_water');
        }
    }
    return kinds;
}

function assertIndependentTerrain(block, template) {
    const rows = rawMapRows(block);
    assert.equal(rows.length, template.height);
    let cells = 0;
    for (let y = 0; y < template.height; y++) {
        assert.equal(rows[y].length, template.width);
        for (let x = 0; x < template.width; x++) {
            const possible = independentPossibleGlyphs(
                template.name,
                rows[y][x]
            );
            const productionGlyphs = new Set(
                template.grid[y][x]?.possibleGlyphs
                    || [template.grid[y][x]?.glyph]
            );
            assert.deepEqual(
                [...productionGlyphs].sort(),
                [...possible].sort(),
                `${template.name} possible glyph ${x},${y}`
            );
            assert.deepEqual(
                normalizedKinds(template.grid[y][x]).sort(),
                [...independentTideKinds(template.name, possible)].sort(),
                `${template.name} independent terrain ${x},${y}`
            );
            cells++;
        }
    }
    return cells;
}

function assertExactTideAndArrival(revision) {
    const shoals = read(revision, 'crawl-ref/source/dgn-shoals.cc');
    const susceptibleStart = shoals.indexOf(
        'static inline bool _shoals_tide_susceptible_feat'
    );
    const susceptibleEnd = shoals.indexOf(
        '\n// Return true if tide effects can propagate',
        susceptibleStart
    );
    const susceptible = shoals.slice(susceptibleStart, susceptibleEnd);
    assert.match(susceptible,
        /feat == DNGN_SHALLOW_WATER \|\| feat == DNGN_FLOOR/u);
    const postStart = shoals.indexOf('void shoals_postprocess_level()');
    const postEnd = shoals.indexOf('\nstatic void _shoals_clamp_height_at',
        postStart);
    const post = shoals.slice(postStart, postEnd);
    const vaultPost = post.includes('_shoals_postprocess_vaults()')
        ? shoals.slice(
            shoals.indexOf('static void _shoals_postprocess_vaults()'),
            shoals.indexOf('\nvoid shoals_postprocess_level()',
                shoals.indexOf('static void _shoals_postprocess_vaults()'))
        )
        : post;
    assert.match(vaultPost, /MMT_VAULT/u);
    assert.ok(/is_tide_immune/u.test(vaultPost)
        || (/dgn_get_vault_height/u.test(vaultPost)
            && /INVALID_HEIGHT/u.test(vaultPost)),
    'Shoals vault postprocess no longer identifies tide-immune vault cells');
    assert.match(post, /shoals_apply_tides\(0, true\)/u);
    const applyStart = shoals.indexOf('static void _shoals_apply_tide_at');
    const applyEnd = shoals.indexOf('\nstatic int _shoals_tide_at', applyStart);
    const apply = shoals.slice(applyStart, applyEnd);
    assert.match(apply, /newfeat = DNGN_FLOOR/u);
    assert.match(apply, /newfeat = DNGN_SHALLOW_WATER/u);

    const dungeon = read(revision, 'crawl-ref/source/dungeon.cc');
    const findStart = dungeon.indexOf('coord_def dgn_find_nearby_stair');
    const findEnd = dungeon.indexOf('\ncoord_def ', findStart + 1);
    const find = dungeon.slice(findStart, findEnd);
    assert.match(find, /feat_is_stone_stair_up/u);
    assert.match(find, /looking_at == DNGN_ESCAPE_HATCH_UP/u);

    const files = read(revision, 'crawl-ref/source/files.cc');
    const destStart = files.indexOf('static int _get_dest_stair_type');
    const destEnd = files.indexOf('\nstatic bool _nonfriendly_nearby',
        destStart);
    const destination = files.slice(destStart, destEnd);
    for (const suffix of ['I', 'II', 'III']) {
        assert.match(destination, new RegExp(
            `DNGN_STONE_STAIRS_DOWN_${suffix}: return `
                + `DNGN_STONE_STAIRS_UP_${suffix}`, 'u'));
    }
    assert.match(destination,
        /feat_is_escape_hatch\(stair_taken\).*return stair_taken/su);
    const placeStart = files.indexOf('static void _place_player_on_stair');
    const placeEnd = files.indexOf('\nstatic void _clear_env_map', placeStart);
    assert.match(files.slice(placeStart, placeEnd),
        /you\.move_to\(dgn_find_nearby_stair\(stair_type, dest_pos, find_first,/u);

    // &~ uses a down-I transition for every requested branch bottom. The
    // ordinary load path above consequently lands on the exact up-I entry or,
    // if substitutions chose another up stair/hatch, dungeon.cc's exhaustive
    // second pass lands on one of those alternatives.
    const wizard = read(revision, 'crawl-ref/source/wiz-dgn.cc');
    const goStart = wizard.indexOf('static void _wizard_go_to_level');
    const goEnd = wizard.indexOf('\nvoid wizard_interlevel_travel', goStart);
    const go = wizard.slice(goStart, goEnd);
    assert.match(go,
        /pos\.id\.depth == brdepth\[pos\.id\.branch\][\s\S]*stair_taken = DNGN_STONE_STAIRS_DOWN_I/u);
    assert.match(go,
        /load_level\(stair_taken, LOAD_ENTER_LEVEL, old_level\)/u);

    const branchData = read(revision, 'crawl-ref/source/branch-data.h');
    const branchStart = branchData.indexOf('{ BRANCH_SHOALS');
    const branchEnd = branchData.indexOf('{ BRANCH_SNAKE', branchStart);
    assert.match(branchData.slice(branchStart, branchEnd),
        /DNGN_ENTER_SHOALS, DNGN_EXIT_SHOALS, NUM_FEATURES/u);
    assert.match(branchData.slice(branchStart, branchEnd),
        /BRANCH_SHOALS, BRANCH_LAIR, 2, 3, 4, 15/u);
}

function runtimeFor(source, vaultLua) {
    return parseRuntimeDes(source, {
        path: SHOALS_PATH,
        dependencies: {[VAULT_LUA_PATH]: vaultLua}
    });
}

function tideInvariant(template) {
    let mutable = 0;
    for (const cell of template.grid.flat()) {
        if (!cell) {
            continue;
        }
        const kinds = normalizedKinds(cell);
        const floor = kinds.includes('floor');
        const shallow = kinds.includes('shallow_water');
        if (floor || shallow) {
            mutable++;
            assert.equal(floor, true, `${template.name} missed tide floor`);
            assert.equal(shallow, true,
                `${template.name} missed tide shallow water`);
        }
    }
    assert.ok(mutable > 1000, `${template.name} tide audit was vacuous`);
    return mutable;
}

function cellKind(cell, phase) {
    const kinds = normalizedKinds(cell);
    return kinds.length ? kinds[Math.abs(phase) % kinds.length] : null;
}

function scenarioTruth(template, entry, phase) {
    const offset = {x: -entry.x, y: -entry.y};
    const absolute = {
        x: Math.floor((80 - template.width) / 2),
        y: Math.floor((70 - template.height) / 2)
    };
    const worldMin = {
        x: offset.x - absolute.x,
        y: offset.y - absolute.y
    };
    const truth = new Map();
    for (let y = 0; y < 70; y++) {
        for (let x = 0; x < 80; x++) {
            const worldX = worldMin.x + x;
            const worldY = worldMin.y + y;
            const localX = worldX - offset.x;
            const localY = worldY - offset.y;
            const kind = localX >= 0 && localX < template.width
                && localY >= 0 && localY < template.height
                ? cellKind(
                    template.grid[localY]?.[localX],
                    phase + localX * 17 + localY * 31
                )
                : 'deep_water';
            if (kind) {
                truth.set(`${worldX},${worldY}`, kind);
            }
        }
    }
    truth.set('0,0', 'stair');
    const observations = [];
    for (const [key, kind] of truth) {
        const [x, y] = key.split(',').map(Number);
        const hash = Math.abs(Math.imul(x + 43, 73856093)
            ^ Math.imul(y + 71, 19349663)
            ^ Math.imul(phase + 101, 83492791)) % 100;
        if (hash >= 25) {
            observations.push({x, y, kind});
        }
    }
    observations.push({x: 0, y: 0, kind: 'stair'});
    return {truth, observations};
}

function mismatchCount(predictions, truth) {
    return predictions.filter(prediction =>
        truth.get(`${prediction.x},${prediction.y}`) !== prediction.kind)
        .length;
}

function matcherScenario(runtime, target, phase) {
    const selected = selectSafeTemplates(
        runtime,
        {place: 'Shoals', depth: 4},
        {levelEntry: {x: 0, y: 0}}
    );
    const template = selected.find(candidate => candidate.name === target);
    const entry = entryPoints(template)[phase % entryPoints(template).length];
    const generated = scenarioTruth(template, entry, phase);
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(selected);
    matcher.updateObservations(generated.observations);
    const result = matcher.getResult();
    assert.equal(result.best?.template?.name, target, `${target} best`);
    assert.equal(mismatchCount(result.predictions, generated.truth), 0,
        `${target} normal mismatch`);
    assert.equal(mismatchCount(result.forcePredictions, generated.truth), 0,
        `${target} force mismatch`);
    return {
        ready: result.ready,
        predictions: result.predictions.length,
        forcePredictions: result.forcePredictions.length
    };
}

function assertMutationsFailClosed(source, vaultLua) {
    const added = `${source}\nNAME: shoals_end_oracle_extra\n`
        + 'ORIENT: encompass\nPLACE: Shoals:$\nMAP\n...\nENDMAP\n';
    const mutations = [
        ['border', source.replace(
            'set_border_fill_type("open_sea")',
            'set_border_fill_type("rock")'
        )],
        ['entry', source.replace(
            "NSUBST:  < = 1:( / 1:[ / 1:{ / * = <",
            "NSUBST:  < = 1:( / 1:[ / 1:. / * = <"
        )],
        ['family', added]
    ];
    for (const [name, mutation] of mutations) {
        assert.notEqual(mutation, source, `${name} mutation did not apply`);
        const direct = runtimeFor(mutation, vaultLua).filter(template =>
            Object.hasOwn(DIRECT, template.name));
        assert.equal(direct.length, 2, `${name} lost direct identity`);
        assert.ok(direct.every(template =>
            template.metadata?.sourceAudit
                === 'shoals-end-detection-only-v1'
            && template.metadata?.matchPolicy?.revealDisabled === true
            && template.metadata?.matchPolicy?.forceRevealDisabled === true),
        `${name} did not fail closed`);
    }
    return mutations.length;
}

function inspectRevision(revision) {
    const source = read(revision, SHOALS_PATH);
    const vaultLua = read(revision, VAULT_LUA_PATH);
    const blocks = rawBlocks(source);
    assert.deepEqual(activeShoalsEndNames(blocks), [...FAMILY].sort());
    assertExactTideAndArrival(revision);

    const parsed = parseDes(source, {path: SHOALS_PATH});
    const runtime = runtimeFor(source, vaultLua);
    const selected = selectSafeTemplates(
        runtime,
        {place: 'Shoals', depth: 4},
        {levelEntry: {x: 0, y: 0}}
    );
    const natural = parsed.filter(template =>
        template.metadata?.place === 'Shoals:$'
        && !new Set(template.metadata?.tags || []).has('unrand'));
    assert.equal(natural.length, 3);
    assert.equal(runtime.filter(template => FAMILY.includes(template.name)).length,
        3);
    assert.equal(selected.filter(template => FAMILY.includes(template.name)).length,
        3);

    const directSummary = {};
    for (const [name, spec] of Object.entries(DIRECT)) {
        const template = selected.find(candidate => candidate.name === name);
        assert.ok(template, name);
        assert.equal(template.width, spec.width);
        assert.equal(template.height, spec.height);
        assert.equal(template.metadata.sourceAudit,
            'shoals-end-static-arrival-v1');
        assert.equal(template.metadata.matchAnchor.requireObservedKind, 'stair');
        assert.equal(entryPoints(template).length, spec.entries);
        const matcher = new MapMatcher({requireExhaustivePlacement: true});
        matcher.setTemplates([template]);
        assert.equal(matcher.preparedTemplates.length, 8);
        assert.ok(matcher.preparedTemplates.every(candidate =>
            candidate.matchAnchorPlacements.length === spec.entries));
        directSummary[name] = {
            entries: spec.entries,
            tideMutableCells: tideInvariant(template),
            independentTerrainCells: assertIndependentTerrain(
                blocks.get(name),
                template
            )
        };
    }
    const storm = selected.find(template =>
        template.name === 'shoals_end_hellmonk_storm_palace');
    assert.equal(storm.metadata.sourceAudit,
        'branch-end-detection-only-v1');
    assert.equal(storm.metadata.matchPolicy.revealDisabled, true);
    assert.equal(storm.metadata.matchPolicy.forceRevealDisabled, true);

    const scenarios = Object.keys(DIRECT).map((name, index) =>
        matcherScenario(runtime, name, 701 + index * 97));
    assert.ok(scenarios.every(result => result.ready));
    assert.ok(scenarios.every(result => result.predictions > 0));
    return {
        revision: revision.name,
        sha: revision.sha,
        raw: 3,
        runtime: 3,
        selected: 3,
        normal: 2,
        forceEnabled: 2,
        detectionOnly: 1,
        transforms: 8,
        direct: directSummary,
        mutationsRejected: assertMutationsFailClosed(source, vaultLua),
        scenarios
    };
}

console.log(JSON.stringify({
    policy: 'floor<->shallow_water tide union; natural up-stair anchor',
    revisions: REVISIONS.map(inspectRevision)
}, null, 2));
