import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
const HELL_PATH = 'crawl-ref/source/dat/des/branches/hell.des';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const PARENT = 'vestibule_of_hell_subvaulted';
const ROLE_BY_SLOT = Object.freeze({
    A: 'vestibule_dis',
    B: 'vestibule_tar',
    C: 'vestibule_coc',
    D: 'vestibule_geh',
    E: 'vestibule_geryon'
});
const EXPECTED_ROLE_COUNTS = Object.freeze({
    vestibule_dis: 7,
    vestibule_tar: 7,
    vestibule_coc: 7,
    vestibule_geh: 7,
    vestibule_geryon: 8
});
const EXPECTED_SLOTS = Object.freeze({
    A: Object.freeze({x: 12, y: 4, width: 33, height: 16, cells: 288}),
    B: Object.freeze({x: 12, y: 37, width: 33, height: 16, cells: 288}),
    C: Object.freeze({x: 4, y: 12, width: 16, height: 33, cells: 288}),
    D: Object.freeze({x: 37, y: 12, width: 16, height: 33, cells: 288}),
    E: Object.freeze({x: 20, y: 20, width: 17, height: 17, cells: 177})
});
const HELL_ENTRY_SIGNALS = Object.freeze({
    levelEntry: Object.freeze({x: 0, y: 0}),
    levelEntryFromPlace: 'Dungeon'
});

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

function sourceBlocks(source) {
    const matches = [...String(source).matchAll(/^NAME:\s*(\S+)\s*$/gmu)];
    return new Map(matches.map((match, index) => {
        const start = match.index;
        const end = matches[index + 1]?.index ?? String(source).length;
        return [match[1], String(source).slice(start, end)];
    }));
}

function rawRows(block) {
    const body = String(block).match(
        /(?:^|\n)MAP\n([\s\S]*?)\nENDMAP(?:\n|$)/u
    )?.[1];
    assert.notEqual(body, undefined, 'missing raw MAP/ENDMAP');
    const rows = body.split('\n');
    const width = Math.max(...rows.map(row => row.length));
    return rows.map(row => [...row.padEnd(width, ' ')]);
}

function rawTags(block) {
    return new Set([...String(block).matchAll(/^TAGS:\s*(.*?)\s*$/gmu)]
        .flatMap(match => match[1].trim().split(/\s+/u))
        .filter(Boolean));
}

function rawSlots(parentRows) {
    return Object.fromEntries(Object.entries(ROLE_BY_SLOT).map(([id, role]) => {
        const points = [];
        parentRows.forEach((row, y) => row.forEach((glyph, x) => {
            if (glyph === id) {
                points.push({x, y});
            }
        }));
        assert.ok(points.length, `missing parent slot ${id}`);
        const x = Math.min(...points.map(point => point.x));
        const y = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x));
        const maxY = Math.max(...points.map(point => point.y));
        const width = maxX - x + 1;
        const height = maxY - y + 1;
        const mask = Array.from({length: height}, (_, localY) =>
            Array.from({length: width}, (_, localX) =>
                parentRows[y + localY]?.[x + localX] === id));
        return [id, {id, role, x, y, width, height, mask}];
    }));
}

function serializeGrid(grid) {
    return grid.map(row => row.join('')).join('\n');
}

function rotateClockwise(grid) {
    return Array.from({length: grid[0].length}, (_, y) =>
        Array.from({length: grid.length}, (_, x) =>
            grid[grid.length - 1 - x][y]));
}

function rotateAnticlockwise(grid) {
    return rotateClockwise(rotateClockwise(rotateClockwise(grid)));
}

function horizontalMirror(grid) {
    return grid.map(row => [...row].reverse());
}

function verticalMirror(grid) {
    return [...grid].reverse().map(row => [...row]);
}

function gridMismatch(grid, mask) {
    let mismatch = 0;
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x] !== ' ' && !mask[y]?.[x]) {
                mismatch++;
            }
        }
    }
    return mismatch;
}

/**
 * Independent transcription of maps.cc resolve_subvault(). Rotation is
 * chosen first. Exact fits then retain only minimum-mismatch mirror states
 * for that chosen rotation. The union below is every state Crawl can reach.
 */
function cppResolveSubvault(rawGrid, slot, tags) {
    const sourceWidth = rawGrid[0].length;
    const sourceHeight = rawGrid.length;
    const canRotate = sourceWidth <= slot.height
        && sourceHeight <= slot.width
        && !tags.has('no_rotate');
    const mustRotate = sourceWidth > slot.width
        || sourceHeight > slot.height;
    assert.equal(mustRotate && !canRotate, false, 'C++ rejects child size');

    const rotations = mustRotate
        ? [rotateClockwise(rawGrid), rotateAnticlockwise(rawGrid)]
        : canRotate
            ? [rawGrid, rotateClockwise(rawGrid),
                rotateAnticlockwise(rawGrid)]
            : [rawGrid];
    const result = new Map();
    for (const rotated of rotations) {
        assert.equal(rotated[0].length, slot.width, 'inexact child width');
        assert.equal(rotated.length, slot.height, 'inexact child height');
        const mirrors = [
            ['normal', rotated],
            ['horizontal', tags.has('no_hmirror')
                ? rotated : horizontalMirror(rotated)],
            ['both', tags.has('no_vmirror')
                ? (tags.has('no_hmirror')
                    ? rotated : horizontalMirror(rotated))
                : verticalMirror(tags.has('no_hmirror')
                    ? rotated : horizontalMirror(rotated))],
            ['vertical', tags.has('no_vmirror')
                ? rotated : verticalMirror(rotated)]
        ];
        const minimum = Math.min(...mirrors.map(([, grid]) =>
            gridMismatch(grid, slot.mask)));
        for (const [mirror, grid] of mirrors) {
            if (gridMismatch(grid, slot.mask) !== minimum) {
                continue;
            }
            result.set(serializeGrid(grid), {grid, mirror, mismatch: minimum});
        }
    }
    return result;
}

// matcher.js names a de-duplicated D4 matrix by the first construction that
// reaches it. Apply that public ID to an independently parsed raw character
// grid, without using matcher.js's transform implementation.
function applyMatcherTransformId(rawGrid, id) {
    const match = String(id).match(/^r(-?\d+)(h?)(v?)$/u);
    assert.ok(match, `unknown matcher transform ${id}`);
    let grid = rawGrid.map(row => [...row]);
    if (match[2]) {
        grid = horizontalMirror(grid);
    }
    if (match[3]) {
        grid = verticalMirror(grid);
    }
    if (Number(match[1]) === 90) {
        grid = rotateClockwise(grid);
    } else if (Number(match[1]) === -90) {
        grid = rotateAnticlockwise(grid);
    } else {
        assert.equal(Number(match[1]), 0, id);
    }
    return grid;
}

function normalizedKinds(cell) {
    const raw = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    return [...new Set(raw.map(normalizeTerrainKind).filter(Boolean))];
}

function transformPointById(point, width, height, id) {
    const marker = Array.from({length: height}, () =>
        Array.from({length: width}, () => ' '));
    marker[point.y][point.x] = '@';
    const transformed = applyMatcherTransformId(marker, id);
    for (let y = 0; y < transformed.length; y++) {
        const x = transformed[y].indexOf('@');
        if (x >= 0) {
            return {x, y};
        }
    }
    assert.fail(`point disappeared under ${id}`);
}

function assertCompilerCallOrder(revision, parentBlock) {
    const offsets = [
        ...[...parentBlock.matchAll(/^SUBVAULT:\s*[A-E]\s*:/gmu)]
            .map(match => match.index),
        parentBlock.search(/^SHUFFLE:\s*ABCD\s*$/mu),
        parentBlock.search(/^SUBST:\s*ABCDE\s*=\s*\.\s*$/mu)
    ];
    assert.equal(offsets.length, 7);
    assert.ok(offsets.every((offset, index) => offset >= 0
        && (index === 0 || offset > offsets[index - 1])),
    'SUBVAULT A-E must compile before SHUFFLE/SUBST');

    const grammar = read(revision, 'crawl-ref/source/util/levcomp.ypp');
    const subvaultAction = grammar.slice(
        grammar.indexOf('subvault_specifier : STRING'),
        grammar.indexOf('\n%%', grammar.indexOf('subvault_specifier : STRING'))
    );
    const shuffleAction = grammar.slice(
        grammar.indexOf('shuffle_spec    : ITEM_INFO'),
        grammar.indexOf('\nclear', grammar.indexOf('shuffle_spec    : ITEM_INFO'))
    );
    const substAction = grammar.slice(
        grammar.indexOf('subst_spec      : ITEM_INFO'),
        grammar.indexOf('\nitems', grammar.indexOf('subst_spec      : ITEM_INFO'))
    );
    for (const [name, action, call] of [
        ['SUBVAULT', subvaultAction, 'subvault'],
        ['SHUFFLE', shuffleAction, 'shuffle'],
        ['SUBST', substAction, 'subst']
    ]) {
        assert.match(action, /lc_map\.main\.add\s*\(/u, `${name} main chunk`);
        assert.match(action, new RegExp(`make_stringf\\("${call}\\(`, 'u'));
    }

    const mapdef = read(revision, 'crawl-ref/source/mapdef.cc');
    const applyStart = mapdef.indexOf('string map_def::apply_subvault');
    const applyEnd = mapdef.indexOf('\nbool map_def::is_subvault', applyStart);
    const apply = mapdef.slice(applyStart, applyEnd);
    assert.ok(apply.indexOf('resolve_subvault(vault)')
        < apply.indexOf('map.merge_subvault'),
    'apply_subvault must resolve then immediately merge');
    const mergeStart = mapdef.indexOf('map_lines::merge_subvault');
    const mergeEnd = mapdef.indexOf('\nvoid map_lines::', mergeStart + 1);
    const merge = mapdef.slice(mergeStart, mergeEnd);
    assert.match(merge, /\(\*this\)\(x, y\) = SUBVAULT_GLYPH/u);
    assert.match(merge, /immutable by the parent vault/u);

    const maps = read(revision, 'crawl-ref/source/maps.cc');
    const resolveStart = maps.indexOf('bool resolve_subvault(map_def &map)');
    const resolveEnd = maps.indexOf('\n// Given a rectangular region', resolveStart);
    const resolve = maps.slice(resolveStart, resolveEnd);
    assert.ok(resolve.indexOf('if (must_rot || can_rot && coinflip())')
        < resolve.indexOf('bool exact_fit'),
    'resolve_subvault must choose rotation before mirror mismatch');
    assert.ok(resolve.indexOf('subvault_mismatch_count')
        < resolve.indexOf('min_mismatch'),
    'resolve_subvault minimum mismatch audit drifted');
}

function assertArrivalSemantics(revision) {
    const branchData = read(revision, 'crawl-ref/source/branch-data.h');
    const vestibule = branchData.slice(
        branchData.indexOf('{ BRANCH_VESTIBULE'),
        branchData.indexOf('{ BRANCH_DIS',
            branchData.indexOf('{ BRANCH_VESTIBULE'))
    );
    assert.match(vestibule,
        /DNGN_ENTER_HELL, DNGN_EXIT_HELL, NUM_FEATURES/u);

    const dungeon = read(revision, 'crawl-ref/source/dungeon.cc');
    const start = dungeon.indexOf('static void _fixup_branch_stairs()');
    const end = dungeon.indexOf('\n/// List all stone stairs', start);
    const fixup = dungeon.slice(start, end);
    assert.match(fixup, /top && bottom \? exit/u);
    assert.match(fixup, /DNGN_ESCAPE_HATCH_UP/u);
    assert.match(fixup, /vault_stairs\.push_back/u);
    assert.match(fixup,
        /(?:_set_grd\(coord,\s*exit\)|env\.grid\(coord\)\s*=\s*exit)/u);
    assert.match(fixup,
        /(?:_set_grd\(\*it,\s*DNGN_FLOOR\)|env\.grid\(\*it\)\s*=\s*DNGN_FLOOR)/u);
}

function assertRawInventory(blocks) {
    const actual = Object.fromEntries(Object.keys(EXPECTED_ROLE_COUNTS)
        .map(role => [role, []]));
    for (const [name, block] of blocks) {
        const tags = rawTags(block);
        for (const role of Object.keys(actual)) {
            if (tags.has(role) && !tags.has('removed')
                && !tags.has('unrand') && !tags.has('overwritable')) {
                actual[role].push(name);
            }
        }
    }
    for (const [role, count] of Object.entries(EXPECTED_ROLE_COUNTS)) {
        assert.equal(actual[role].length, count, `${role} closed inventory`);
    }
    assert.equal(Object.values(actual).flat().length, 36);
    return actual;
}

function preparedTemplate(template) {
    const matcher = new MapMatcher({minPredictedCells: 1});
    matcher.setTemplates([template]);
    assert.equal(matcher.preparedTemplates.length, 4,
        'Hell parent permits four mirrors and no rotations');
    return matcher.preparedTemplates.find(candidate =>
        candidate.transform.id === 'r0');
}

function assertIndependentResolve(template, blocks, rawSlotById) {
    const prepared = preparedTemplate(template);
    const counts = {};
    for (const slot of prepared.composite.slots) {
        const rawSlot = rawSlotById[slot.id];
        const expectedSlot = EXPECTED_SLOTS[slot.id];
        assert.deepEqual({
            x: slot.x,
            y: slot.y,
            width: slot.width,
            height: slot.height,
            cells: slot.mask.flat().filter(Boolean).length
        }, expectedSlot);
        assert.equal(slot.role, ROLE_BY_SLOT[slot.id]);
        assert.deepEqual(slot.mask, rawSlot.mask);

        const roleVariants = slot.variants.filter(variant =>
            variant.roles.includes(slot.role));
        const names = [...new Set(roleVariants.map(variant => variant.name))];
        assert.equal(names.length, EXPECTED_ROLE_COUNTS[slot.role]);
        counts[slot.id] = {};
        for (const name of names) {
            const rawGrid = rawRows(blocks.get(name));
            const expected = cppResolveSubvault(
                rawGrid,
                rawSlot,
                rawTags(blocks.get(name))
            );
            const production = roleVariants.filter(variant =>
                variant.name === name);
            const actualShapes = new Set(production.map(variant =>
                serializeGrid(applyMatcherTransformId(
                    rawGrid,
                    variant.transform
                ))));
            assert.deepEqual([...actualShapes].sort(),
                [...expected.keys()].sort(), `${slot.id}/${name} C++ states`);
            assert.ok(production.every(variant => variant.mismatch === 0),
                `${slot.id}/${name} wrote outside mask`);
            counts[slot.id][name] = expected.size;
        }
    }
    return {prepared, counts};
}

function cellKind(cell, phase, shellColon) {
    const kinds = normalizedKinds(cell);
    if (!kinds.length) {
        return null;
    }
    if (kinds.includes('wall') && kinds.includes('floor')) {
        return shellColon;
    }
    return kinds[Math.abs(phase) % kinds.length];
}

function sourceTruth(template, prepared, choices, shellColon, phase) {
    const grid = Array.from({length: template.height}, () =>
        Array.from({length: template.width}, () => null));
    for (let y = 0; y < template.height; y++) {
        for (let x = 0; x < template.width; x++) {
            const slotIndex = prepared.composite.slots.findIndex(slot => {
                const localX = x - slot.x;
                const localY = y - slot.y;
                return localX >= 0 && localY >= 0
                    && localX < slot.width && localY < slot.height
                    && slot.mask[localY]?.[localX];
            });
            if (slotIndex >= 0) {
                const slot = prepared.composite.slots[slotIndex];
                const cell = choices[slotIndex].grid[y - slot.y]?.[x - slot.x];
                grid[y][x] = cellKind(cell,
                    phase + x * 17 + y * 31, shellColon);
            } else {
                grid[y][x] = cellKind(template.grid[y]?.[x],
                    phase + x * 13 + y * 29, shellColon);
            }
        }
    }
    return grid;
}

function scenario(template, parentId, childIndex, phase, centralState = null) {
    const prepared = preparedTemplate(template);
    const choices = prepared.composite.slots.map((slot, slotIndex) => {
        const pool = slot.variants.filter(variant =>
            variant.roles.includes(slot.role));
        return pool[(childIndex * 7 + slotIndex * 11) % pool.length];
    });
    const entryStates = prepared.composite.slots[4].variants
        .filter(variant => variant.roles.includes(
            prepared.composite.slots[4].role
        ))
        .flatMap(variant => variant.entryAnchorPoints.map(point => ({
            variant,
            point
        })));
    assert.equal(entryStates.length, 360,
        'audited Geryon variants must expose all transformed arrival states');
    const selectedEntry = centralState == null
        ? {
            variant: choices[4],
            point: choices[4].entryAnchorPoints[
                phase % choices[4].entryAnchorPoints.length
            ]
        }
        : entryStates[centralState];
    assert.ok(selectedEntry,
        `missing Geryon arrival state ${centralState}`);
    choices[4] = selectedEntry.variant;
    const geryon = selectedEntry.variant;
    const childEntry = selectedEntry.point;
    const sourceEntry = {
        x: prepared.composite.slots[4].x + childEntry.x,
        y: prepared.composite.slots[4].y + childEntry.y
    };
    const transformedEntry = transformPointById(
        sourceEntry,
        template.width,
        template.height,
        parentId
    );
    const source = sourceTruth(
        template,
        prepared,
        choices,
        phase % 2 ? 'wall' : 'floor',
        phase
    );
    const transformed = applyMatcherTransformId(source, parentId);
    transformed[transformedEntry.y][transformedEntry.x] = 'portal';
    const offset = {x: -transformedEntry.x, y: -transformedEntry.y};
    const absolute = {
        x: Math.floor((80 - transformed[0].length) / 2),
        y: Math.floor((70 - transformed.length) / 2)
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
            const kind = localX >= 0 && localX < transformed[0].length
                && localY >= 0 && localY < transformed.length
                ? transformed[localY][localX]
                : 'wall';
            if (kind) {
                truth.set(`${worldX},${worldY}`, kind);
            }
        }
    }
    const observations = [];
    for (const [key, kind] of truth) {
        const [x, y] = key.split(',').map(Number);
        const hash = Math.abs(Math.imul(x + 101, 73856093)
            ^ Math.imul(y + 211, 19349663)
            ^ Math.imul(phase + 307, 83492791)) % 100;
        if (hash >= 34) {
            observations.push({x, y, kind});
        }
    }
    observations.push({x: 0, y: 0, kind: 'portal'});
    return {
        truth,
        observations,
        choices,
        entryStates: entryStates.length,
        parentId,
        offset
    };
}

function bresenhamPoints(targetX, targetY) {
    const points = [];
    let x = 0;
    let y = 0;
    const dx = Math.abs(targetX);
    const dy = Math.abs(targetY);
    const sx = targetX < 0 ? -1 : 1;
    const sy = targetY < 0 ? -1 : 1;
    let error = dx - dy;
    while (x !== targetX || y !== targetY) {
        const doubled = error * 2;
        if (doubled > -dy) {
            error -= dy;
            x += sx;
        }
        if (doubled < dx) {
            error += dx;
            y += sy;
        }
        points.push({x, y});
    }
    return points;
}

function arrivalObservations(truth) {
    const observations = [];
    for (let y = -8; y <= 8; y++) {
        for (let x = -8; x <= 8; x++) {
            const kind = truth.get(`${x},${y}`);
            if (!kind) {
                continue;
            }
            const ray = bresenhamPoints(x, y);
            const blocked = ray.slice(0, -1).some(point => {
                const intermediate = truth.get(`${point.x},${point.y}`);
                return intermediate === 'wall' || intermediate === 'door';
            });
            if (!blocked) {
                observations.push({x, y, kind});
            }
        }
    }
    assert.ok(observations.some(cell =>
        cell.x === 0 && cell.y === 0 && cell.kind === 'portal'));
    return observations;
}

function mismatchCount(predictions, truth) {
    return predictions.filter(prediction =>
        truth.get(`${prediction.x},${prediction.y}`) !== prediction.kind)
        .length;
}

function runMatcherScenarios(template) {
    const parentIds = ['r0', 'r0v', 'r0h', 'r0hv'];
    const summary = {
        scenarios: 0,
        ready: 0,
        safePredictions: 0,
        safeMismatches: 0,
        forcePredictions: 0,
        forceMismatches: 0
    };
    for (let index = 0; index < 8; index++) {
        const generated = scenario(
            template,
            parentIds[index % parentIds.length],
            index,
            1009 + index * 97
        );
        const [anchored] = selectSafeTemplates(
            [template],
            {place: 'Hell', depth: 1},
            HELL_ENTRY_SIGNALS
        );
        assert.equal(anchored.metadata.matchAnchor.requireObservedKind,
            'portal');
        const matcher = new MapMatcher({
            requireExhaustivePlacement: true,
            minPredictedCells: 1
        });
        matcher.setTemplates([anchored]);
        assert.ok(matcher.preparedTemplates.every(candidate =>
            candidate.matchAnchorPlacements.length === 37));
        matcher.updateObservations(generated.observations);
        const result = matcher.getResult();
        const safeMismatches = mismatchCount(
            result.predictions,
            generated.truth
        );
        const forceMismatches = mismatchCount(
            result.forcePredictions,
            generated.truth
        );
        assert.equal(safeMismatches, 0, `scenario ${index} normal mismatch`);
        assert.equal(forceMismatches, 0, `scenario ${index} force mismatch`);
        summary.scenarios++;
        summary.ready += Number(result.ready);
        summary.safePredictions += result.predictions.length;
        summary.safeMismatches += safeMismatches;
        summary.forcePredictions += result.forcePredictions.length;
        summary.forceMismatches += forceMismatches;
    }
    assert.ok(summary.ready > 0, 'no normal-reveal matcher scenario became ready');
    assert.ok(summary.safePredictions > 0, 'no normal predictions produced');
    return summary;
}

function runArrivalScenarios(template) {
    const parentIds = ['r0', 'r0v', 'r0h', 'r0hv'];
    const [anchored] = selectSafeTemplates(
        [template],
        {place: 'Hell', depth: 1},
        HELL_ENTRY_SIGNALS
    );
    const summary = {
        rawScenarios: 0,
        scenarios: 0,
        observations: {min: Infinity, max: 0},
        evidenceCells: {min: Infinity, max: 0},
        evidenceWeight: {min: Infinity, max: 0},
        coverage: {min: Infinity, max: 0},
        spanXRatio: {min: Infinity, max: 0},
        spanYRatio: {min: Infinity, max: 0},
        reasons: {},
        ready: 0,
        safePredictions: 0,
        safeMismatches: 0,
        forcePredictions: 0,
        forceMismatches: 0
    };
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates([anchored]);
    const grouped = new Map();
    for (let centralState = 0; centralState < 360; centralState++) {
        for (let parentIndex = 0;
            parentIndex < parentIds.length;
            parentIndex++) {
            const generated = scenario(
                template,
                parentIds[parentIndex],
                centralState * 13 + parentIndex,
                2003 + centralState * 101 + parentIndex * 17,
                centralState
            );
            const observations = arrivalObservations(generated.truth);
            const signature = observations.map(cell =>
                `${cell.x},${cell.y}:${cell.kind}`).join('|');
            const group = grouped.get(signature) || {
                observations,
                truths: [],
                label: `${centralState}/${parentIds[parentIndex]}`
            };
            group.truths.push(generated.truth);
            grouped.set(signature, group);
            summary.rawScenarios++;
        }
    }
    for (const group of grouped.values()) {
        const {observations} = group;
        matcher.reset();
        matcher.updateObservations(observations);
        const result = matcher.getResult();
        const safeMismatches = group.truths.reduce((count, truth) =>
            count + mismatchCount(result.predictions, truth), 0);
        const forceMismatches = group.truths.reduce((count, truth) =>
            count + mismatchCount(result.forcePredictions, truth), 0);
        assert.equal(safeMismatches, 0,
            `arrival ${group.label} normal mismatch`);
        const best = result.best;
        assert.ok(best, 'arrival matcher produced no diagnostic best');
        summary.scenarios++;
        summary.observations.min = Math.min(
            summary.observations.min,
            observations.length
        );
        summary.observations.max = Math.max(
            summary.observations.max,
            observations.length
        );
        for (const key of [
            'evidenceCells',
            'evidenceWeight',
            'coverage',
            'spanXRatio',
            'spanYRatio'
        ]) {
            summary[key].min = Math.min(summary[key].min, best[key]);
            summary[key].max = Math.max(summary[key].max, best[key]);
        }
        summary.reasons[result.reason] =
            (summary.reasons[result.reason] || 0) + group.truths.length;
        summary.ready += Number(result.ready) * group.truths.length;
        summary.safePredictions += result.predictions.length
            * group.truths.length;
        summary.safeMismatches += safeMismatches;
        summary.forcePredictions += result.forcePredictions.length
            * group.truths.length;
        summary.forceMismatches += forceMismatches;
    }
    assert.equal(summary.ready, summary.rawScenarios,
        'every legal first-entry state must reveal by closed consensus');
    assert.deepEqual(summary.reasons, {ready: summary.rawScenarios});
    assert.ok(summary.safePredictions > 0,
        'first-entry consensus produced no terrain');
    return summary;
}

function evaluateArrival(template, observations, options = {}) {
    const selected = options.selected || selectSafeTemplates(
        [template],
        {place: 'Hell', depth: 1},
        HELL_ENTRY_SIGNALS
    )[0];
    const matcher = new MapMatcher({
        requireExhaustivePlacement: options.exhaustive !== false,
        minPredictedCells: 1
    });
    matcher.setTemplates(selected ? [selected] : []);
    matcher.updateObservations(observations);
    return matcher.getResult();
}

function withoutTrustedEntry(selected) {
    const matchAnchor = {...selected.metadata.matchAnchor};
    delete matchAnchor.trustedLevelEntry;
    return {
        ...selected,
        metadata: {...selected.metadata, matchAnchor}
    };
}

function runTrustedEntryGateScenarios(template) {
    const parentIds = ['r0', 'r0v', 'r0h', 'r0hv'];
    const ordinarySelected = withoutTrustedEntry(selectSafeTemplates(
        [template],
        {place: 'Hell', depth: 1},
        HELL_ENTRY_SIGNALS
    )[0]);
    const ordinaryMatcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    ordinaryMatcher.setTemplates([ordinarySelected]);
    let sparse = null;
    let readyDecoy = null;
    for (let centralState = 0;
        centralState < 360 && (!sparse || !readyDecoy);
        centralState++) {
        const generated = scenario(
            template,
            parentIds[centralState % parentIds.length],
            7001 + centralState,
            9001 + centralState * 29,
            centralState
        );
        const observations = arrivalObservations(generated.truth);
        const selected = selectSafeTemplates(
            [template],
            {place: 'Hell', depth: 1},
            HELL_ENTRY_SIGNALS
        )[0];
        ordinaryMatcher.reset();
        ordinaryMatcher.updateObservations(observations);
        const ordinary = ordinaryMatcher.getResult();
        if (!ordinary.ready && !sparse) {
            sparse = {generated, observations, selected, ordinary};
        }
        if (ordinary.ready && !readyDecoy) {
            readyDecoy = {generated, observations, selected, ordinary};
        }
    }
    assert.ok(sparse, 'no under-evidence entry state found');
    assert.ok(readyDecoy, 'no policy-ready entry decoy found');

    const positive = evaluateArrival(template, sparse.observations, {
        selected: sparse.selected
    });
    assert.equal(positive.ready, true);
    assert.equal(positive.trustedEntryConsensus, true);
    assert.ok(positive.predictions.length > 0);
    assert.equal(mismatchCount(
        positive.predictions,
        sparse.generated.truth
    ), 0);
    const selectedFromDepths = selectSafeTemplates(
        [template],
        {place: 'Hell', depth: 1},
        {
            levelEntry: {x: 0, y: 0},
            levelEntryFromPlace: 'Depths'
        }
    )[0];
    const depthsPositive = evaluateArrival(template, sparse.observations, {
        selected: selectedFromDepths
    });
    assert.equal(depthsPositive.ready, true);
    assert.equal(depthsPositive.trustedEntryConsensus, true);
    assert.equal(mismatchCount(
        depthsPositive.predictions,
        sparse.generated.truth
    ), 0);

    const certificate = template.metadata.trustedEntryConsensus;
    const brokenCertificate = {
        ...template,
        metadata: {
            ...template.metadata,
            trustedEntryConsensus: {
                ...certificate,
                anchorPlacementsPerTransform: 36
            }
        }
    };
    const floorAnchor = sparse.observations.map(cell =>
        cell.x === 0 && cell.y === 0
            ? {...cell, kind: 'floor'}
            : cell);
    const resumed = selectSafeTemplates(
        [template],
        {place: 'Hell', depth: 1},
        {}
    )[0];
    const branchReturns = Object.fromEntries([
        'Dis', 'Geh', 'Coc', 'Tar'
    ].map(place => {
        const selected = selectSafeTemplates(
            [template],
            {place: 'Hell', depth: 1},
            {
                levelEntry: {x: 0, y: 0},
                levelEntryFromPlace: place
            }
        )[0];
        return [`${place.toLowerCase()}ReturnPortal`, evaluateArrival(
            template,
            sparse.observations,
            {selected}
        )];
    }));
    const rejected = {
        untrustedTransition: sparse.ordinary,
        changedCertificate: evaluateArrival(
            brokenCertificate,
            sparse.observations
        ),
        wrongAnchorKind: evaluateArrival(template, floorAnchor, {
            selected: sparse.selected
        }),
        nonExhaustiveMatcher: evaluateArrival(
            template,
            sparse.observations,
            {selected: sparse.selected, exhaustive: false}
        ),
        reconnectWithoutEntry: evaluateArrival(
            template,
            sparse.observations,
            {selected: resumed}
        ),
        ...branchReturns
    };
    for (const [name, result] of Object.entries(rejected)) {
        assert.equal(result.ready, false, `${name} unexpectedly ready`);
        assert.equal(result.predictions.length, 0,
            `${name} emitted safe predictions`);
        assert.notEqual(result.trustedEntryConsensus, true,
            `${name} passed trusted-entry closure`);
    }
    assert.deepEqual(selectSafeTemplates(
        [template],
        {place: 'Dungeon', depth: 1},
        HELL_ENTRY_SIGNALS
    ), [], 'foreign procedural portal selected the Vestibule');

    // Treat a policy-ready legal entrance as a noisy decoy. Pick a different
    // legal true parent which the ordinary scored pool has discarded. The
    // trusted closure must retain it anyway, so every emitted singleton still
    // agrees with that true map.
    const ordinaryIds = new Set(readyDecoy.ordinary.candidates.map(candidate =>
        `${candidate.transform}:${candidate.offsetX},${candidate.offsetY}`));
    let hiddenTrue = null;
    for (let centralState = 0; centralState < 360 && !hiddenTrue;
        centralState++) {
        for (const parentId of parentIds) {
            const candidate = scenario(
                template,
                parentId,
                11003 + centralState,
                13001 + centralState * 31,
                centralState
            );
            const id = `${candidate.parentId}:`
                + `${candidate.offset.x},${candidate.offset.y}`;
            if (!ordinaryIds.has(id)) {
                hiddenTrue = candidate;
                break;
            }
        }
    }
    assert.ok(hiddenTrue,
        'ordinary ready-decoy pool did not discard a legal parent');
    const closed = evaluateArrival(template, readyDecoy.observations, {
        selected: readyDecoy.selected
    });
    assert.equal(closed.ready, true);
    assert.equal(closed.trustedEntryConsensus, true);
    assert.ok(closed.predictions.length > 0);
    assert.equal(mismatchCount(closed.predictions, hiddenTrue.truth), 0,
        'ready decoy eliminated a below-threshold true parent');

    return {
        dungeonPositivePredictions: positive.predictions.length,
        depthsPositivePredictions: depthsPositive.predictions.length,
        rejected: Object.keys(rejected),
        foreignPortalRejected: 1,
        readyDecoyPredictions: closed.predictions.length,
        readyDecoyMismatches: 0
    };
}

function rejectedRuntime(source, vaultLua) {
    return parseRuntimeDes(source, {
        path: HELL_PATH,
        dependencies: {[VAULT_LUA_PATH]: vaultLua}
    }).filter(template => template.metadata?.sourceAudit
        === 'hell-vestibule-fixed-composite-v1');
}

function mutationSources(source) {
    const reordered = source.replace(
        /(SUBVAULT:\s*A\s*:\s*vestibule_dis\s*\n)(SUBVAULT:\s*B\s*:\s*vestibule_tar\s*\n)(SUBVAULT:\s*C\s*:\s*vestibule_coc\s*\n)(SUBVAULT:\s*D\s*:\s*vestibule_geh\s*\n)(SUBVAULT:\s*E\s*:\s*vestibule_geryon\s*\n)(SHUFFLE:\s*ABCD\s*\n)/u,
        '$6$1$2$3$4$5'
    );
    const extraChild = `${source}\nNAME: vestibule_dis_oracle_extra\n`
        + 'TAGS: vestibule_dis\nMAP\n'
        + `${Array.from({length: 16}, () => '.'.repeat(33)).join('\n')}\n`
        + 'ENDMAP\n';
    const changedMask = source.replace(
        'xxxxxxxxxxxxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxx',
        'xxxxxxxxxxxxxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxx'
    );
    return [
        ['subvault-shuffle-order', reordered],
        ['extra-role-child', extraChild],
        ['parent-slot-mask', changedMask],
        ['lava-helper-feature', source.replace(
            'e.kfeat("~l = l")',
            'e.kfeat("~l = w")'
        )],
        ['swimming-control', source.replace(
            'crawl.one_chance_in( 3 )',
            'crawl.one_chance_in( 4 )'
        )]
    ];
}

function inspectRevision(revision) {
    const source = read(revision, HELL_PATH);
    const vaultLua = read(revision, VAULT_LUA_PATH);
    const blocks = sourceBlocks(source);
    const parentBlock = blocks.get(PARENT);
    assert.ok(parentBlock);
    assertCompilerCallOrder(revision, parentBlock);
    assertArrivalSemantics(revision);
    const inventory = assertRawInventory(blocks);
    const rawSlotById = rawSlots(rawRows(parentBlock));
    for (const [id, expected] of Object.entries(EXPECTED_SLOTS)) {
        const slot = rawSlotById[id];
        assert.deepEqual({
            x: slot.x,
            y: slot.y,
            width: slot.width,
            height: slot.height,
            cells: slot.mask.flat().filter(Boolean).length
        }, expected);
    }

    const options = {
        path: HELL_PATH,
        dependencies: {[VAULT_LUA_PATH]: vaultLua}
    };
    const runtime = parseRuntimeDes(source, options);
    const exact = runtime.filter(template =>
        template.metadata?.sourceAudit
            === 'hell-vestibule-fixed-composite-v1');
    assert.equal(runtime.length, 1, `${revision.name} runtime inventory`);
    assert.equal(exact.length, 1, `${revision.name} audited composite`);
    const [template] = exact;
    assert.equal(template.name, PARENT);
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.matchPolicy.forceRevealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorObservedKind, 'portal');
    assert.deepEqual(template.metadata.trustedEntryConsensus, {
        protocol: 'hell-vestibule-entry-consensus-v1',
        requiredObservedKind: 'portal',
        allowedFromPlaces: ['dungeon', 'depths'],
        parentTransforms: ['r0', 'r0v', 'r0h', 'r0hv'],
        anchorPlacementsPerTransform: 37,
        sourceVariantCount: 36,
        preparedSlotVariantCounts: [56, 56, 56, 56, 64]
    });
    assert.equal(template.metadata.composite.variants.length, 36);
    assert.deepEqual(template.metadata.composite.slots.map(slot => slot.role),
        Object.values(ROLE_BY_SLOT));
    assert.deepEqual(template.metadata.composite.slots[4].entryAnchorGlyphs,
        ['{', '(', '[', '<']);

    const selected = selectSafeTemplates(
        runtime,
        {place: 'Hell', depth: 1},
        HELL_ENTRY_SIGNALS
    );
    assert.equal(selected.length, 1);
    assert.deepEqual(selected[0].metadata.matchAnchor, {
        x: 0,
        y: 0,
        trustedLevelEntry: true,
        trustedLevelEntryFromPlace: 'dungeon',
        glyphs: ['{', '(', '[', '<'],
        requireObservedKind: 'portal'
    });

    const resolve = assertIndependentResolve(template, blocks, rawSlotById);
    const mutations = mutationSources(source);
    for (const [name, mutation] of mutations) {
        assert.notEqual(mutation, source, `${name} mutation did not apply`);
        assert.equal(rejectedRuntime(mutation, vaultLua).length, 0,
            `${name} did not fail closed`);
    }
    const changedVaultLua = vaultLua.replace(
        'e.kfeat(glyph .. " = metal_statue")',
        'e.kfeat(glyph .. " = granite_statue")'
    );
    assert.notEqual(changedVaultLua, vaultLua,
        'vault.lua mutation did not apply');
    assert.equal(rejectedRuntime(source, changedVaultLua).length, 0,
        'vault metal helper mutation did not fail closed');

    return {
        revision: revision.name,
        sha: revision.sha,
        raw: 1,
        runtime: runtime.length,
        selected: selected.length,
        normal: 1,
        force: 1,
        detectionOnly: 0,
        variants: template.metadata.composite.variants.length,
        roles: Object.fromEntries(Object.entries(inventory)
            .map(([role, names]) => [role, names.length])),
        slotResolveStates: Object.fromEntries(
            Object.entries(resolve.counts).map(([slot, values]) => [
                slot,
                Object.values(values).reduce((sum, count) => sum + count, 0)
            ])
        ),
        anchorPlacementsPerParentMirror: 37,
        mutationsRejected: mutations.length + 1,
        matcher: runMatcherScenarios(template),
        arrival: revision.name === 'd29'
            ? runArrivalScenarios(template)
            : null,
        trustedEntryGates: revision.name === 'd29'
            ? runTrustedEntryGateScenarios(template)
            : null
    };
}

const summary = {
    sourceOrder: 'SUBVAULT A-E -> SHUFFLE ABCD -> SUBST ABCDE',
    roleAssignment: 'fixed-before-parent-shuffle',
    revisions: REVISIONS.map(inspectRevision)
};
console.log(JSON.stringify(summary, null, 2));
