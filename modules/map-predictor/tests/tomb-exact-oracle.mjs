import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    parseRuntimeDes,
    selectSafeTemplates
} from '../runtime.js';
import {
    allowedTransforms,
    MapMatcher,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';

const EXACT_SHA = '1b83f8deabb8a25598e5bcbc2a041e5f43242734';
const TOMB_PATH = 'crawl-ref/source/dat/des/branches/tomb.des';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const CDN_ROOT = `https://cdn.jsdelivr.net/gh/crawl/crawl@${EXACT_SHA}`;
const DEFAULT_SEED = 0x54_4f_4d_42;
const RUNS_PER_FLOOR = 120;

function xorshift(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}

function choose(random, values) {
    return values[Math.floor(random() * values.length)];
}

async function exactText(path, environmentName) {
    const localPath = process.env[environmentName];
    if (localPath) {
        return fs.readFileSync(localPath, 'utf8');
    }
    const response = await fetch(`${CDN_ROOT}/${path}`);
    if (!response.ok) {
        throw new Error(`Unable to fetch ${path}: HTTP ${response.status}`);
    }
    return response.text();
}

function cellKinds(cell) {
    if (cell == null || cell === ' ') {
        return [];
    }
    if (typeof cell === 'string') {
        const kind = normalizeTerrainKind(cell);
        return kind ? [kind] : [];
    }
    const raw = cell.kinds ?? cell.kind ?? [];
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.some(value => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(value).trim().toLowerCase()))) {
        return [];
    }
    return [...new Set(values.map(normalizeTerrainKind).filter(Boolean))];
}

function transformBounds(transform, width, height) {
    const corners = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1]
    ].map(([x, y]) => ({
        x: transform.a * x + transform.b * y,
        y: transform.c * x + transform.d * y
    }));
    return {
        minX: Math.min(...corners.map(point => point.x)),
        minY: Math.min(...corners.map(point => point.y))
    };
}

function transformPoint(transform, width, height, point) {
    const bounds = transformBounds(transform, width, height);
    return {
        x: transform.a * point.x + transform.b * point.y - bounds.minX,
        y: transform.c * point.x + transform.d * point.y - bounds.minY
    };
}

function legalSubvaultOptions(variant, slot) {
    const candidates = [];
    for (const transform of allowedTransforms(variant)) {
        if (transform.b !== 0 || transform.c !== 0) {
            continue;
        }
        const transformed = transformTemplate(variant, transform);
        if (transformed.width !== slot.width
            || transformed.height !== slot.height) {
            continue;
        }
        let mismatch = 0;
        for (let y = 0; y < slot.height; y++) {
            for (let x = 0; x < slot.width; x++) {
                if (transformed.grid[y]?.[x] != null && !slot.mask[y]?.[x]) {
                    mismatch++;
                }
            }
        }
        candidates.push({
            transform,
            transformed,
            entryAnchorPoints: (variant.entryAnchorPoints || []).map(point =>
                transformPoint(
                    transform,
                    variant.width,
                    variant.height,
                    point
                )),
            mismatch
        });
    }
    const minimum = Math.min(...candidates.map(candidate => candidate.mismatch));
    return candidates.filter(candidate => candidate.mismatch === minimum);
}

function cellsWithGlyph(grid, glyph) {
    const points = [];
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < (grid[y]?.length || 0); x++) {
            const cell = grid[y]?.[x];
            const finalGlyphs = Array.isArray(cell?.possibleGlyphs)
                ? cell.possibleGlyphs
                : [cell?.glyph];
            if (finalGlyphs.includes(glyph)) {
                points.push({x, y});
            }
        }
    }
    return points;
}

function childEntryPoints(slot, selected, glyph) {
    const points = [
        ...cellsWithGlyph(selected.transformed.grid, glyph),
        ...(selected.entryAnchorPoints || [])
    ];
    return [...new Map(points.map(point => [`${point.x},${point.y}`, point]))
        .values()]
        .filter(point => slot.mask[point.y]?.[point.x])
        .map(point => ({x: slot.x + point.x, y: slot.y + point.y}));
}

function shellEntryPoints(template, glyphs) {
    const points = [
        ...glyphs.flatMap(glyph => cellsWithGlyph(template.grid, glyph)),
        ...(template.metadata?.composite?.entryAnchorPoints || [])
    ];
    return [...new Map(points.map(point => [`${point.x},${point.y}`, point]))
        .values()];
}

function entryRoutes(template, selectedChildren, random) {
    const slots = template.metadata.composite.slots;
    if (template.name === 'tomb_1') {
        const upstairs = cellsWithGlyph(template.grid, '(');
        const retainedUpstairs = choose(random, upstairs);
        const routes = [
            {point: retainedUpstairs, kind: 'stair', id: 'branch-entry'},
            ...childEntryPoints(slots[0], selectedChildren[0], '>')
                .map(point => ({point, kind: 'stair', id: 'centre-return'})),
            ...childEntryPoints(slots[1], selectedChildren[1], 'P')
                .map(point => ({point, kind: 'floor', id: 'hall-return'}))
        ];
        return {route: choose(random, routes), retainedUpstairs, upstairs};
    }
    if (template.name === 'tomb_2') {
        const shell = shellEntryPoints(template, ['C', 'H', 'I']);
        const child = childEntryPoints(slots[0], selectedChildren[0], 'R');
        return {
            route: choose(random, [
                ...shell.map(point => ({point, kind: 'floor', id: 'shell'})),
                ...child.map(point => ({point, kind: 'floor', id: 'ambush'}))
            ])
        };
    }
    return {
        route: choose(random, shellEntryPoints(template, ['D', 'E'])
            .map(point => ({point, kind: 'floor', id: 'shell'})))
    };
}

function selectedChildren(template, random) {
    const composite = template.metadata.composite;
    return composite.slots.map(slot => {
        const pool = composite.variants.filter(variant =>
            variant.roles.includes(slot.role));
        const variant = choose(random, pool);
        const option = choose(random, legalSubvaultOptions(variant, slot));
        return {variant, ...option};
    });
}

function sourceTruth(template, children, entry) {
    const composite = template.metadata.composite;
    const grid = Array.from({length: template.height}, () =>
        Array.from({length: template.width}, () => null));
    for (let y = 0; y < template.height; y++) {
        for (let x = 0; x < template.width; x++) {
            const slotIndex = composite.slots.findIndex(slot => {
                const localX = x - slot.x;
                const localY = y - slot.y;
                return localX >= 0 && localY >= 0
                    && localX < slot.width && localY < slot.height
                    && slot.mask[localY]?.[localX];
            });
            let kinds;
            if (slotIndex >= 0) {
                const slot = composite.slots[slotIndex];
                const cell = children[slotIndex].transformed.grid[y - slot.y]
                    ?.[x - slot.x];
                kinds = cellKinds(cell);
                grid[y][x] = kinds.length === 1
                    ? kinds[0]
                    : cell == null ? 'floor' : null;
            } else {
                kinds = cellKinds(template.grid[y]?.[x]);
                grid[y][x] = kinds.length === 1 ? kinds[0] : null;
            }
        }
    }

    if (template.name === 'tomb_1') {
        for (const point of entry.upstairs) {
            grid[point.y][point.x] = point.x === entry.retainedUpstairs.x
                && point.y === entry.retainedUpstairs.y ? 'stair' : 'floor';
        }
    }
    grid[entry.route.point.y][entry.route.point.x] = entry.route.kind;
    return grid;
}

function scenario(template, seed) {
    const random = xorshift(seed);
    const children = selectedChildren(template, random);
    const entry = entryRoutes(template, children, random);
    assert.ok(entry.route, `seed ${seed}: no entry route for ${template.name}`);
    const parentTransform = choose(random, allowedTransforms(template));
    const truthTemplate = {
        width: template.width,
        height: template.height,
        grid: sourceTruth(template, children, entry)
    };
    const transformedTruth = transformTemplate(truthTemplate, parentTransform);
    const transformedEntry = transformPoint(
        parentTransform,
        template.width,
        template.height,
        entry.route.point
    );
    const offset = {
        x: Math.floor(random() * 17) - 8,
        y: Math.floor(random() * 17) - 8
    };
    const levelEntry = {
        x: offset.x + transformedEntry.x,
        y: offset.y + transformedEntry.y
    };
    const absolute = {
        x: Math.floor((80 - transformedTruth.width) / 2),
        y: Math.floor((70 - transformedTruth.height) / 2)
    };
    const worldBounds = {
        minX: offset.x - absolute.x,
        minY: offset.y - absolute.y
    };
    const truth = new Map();
    for (let y = 0; y < 70; y++) {
        for (let x = 0; x < 80; x++) {
            const worldX = worldBounds.minX + x;
            const worldY = worldBounds.minY + y;
            const localX = worldX - offset.x;
            const localY = worldY - offset.y;
            const kind = localX >= 0 && localY >= 0
                && localX < transformedTruth.width
                && localY < transformedTruth.height
                ? transformedTruth.grid[localY]?.[localX]
                : 'wall';
            if (kind) {
                truth.set(`${worldX},${worldY}`, kind);
            }
        }
    }

    const radiusX = 18 + Math.floor(random() * 18);
    const radiusY = 18 + Math.floor(random() * 18);
    const observations = [];
    for (const [key, kind] of truth) {
        const [x, y] = key.split(',').map(Number);
        const dx = Math.abs(x - levelEntry.x);
        const dy = Math.abs(y - levelEntry.y);
        const withinRadius = dx <= radiusX && dy <= radiusY;
        const corridor = dx <= 2 || dy <= 2;
        if ((withinRadius || corridor) && random() >= 0.23) {
            observations.push({x, y, kind});
        }
    }
    if (!observations.some(cell => cell.x === levelEntry.x
        && cell.y === levelEntry.y)) {
        observations.push({...levelEntry, kind: entry.route.kind});
    }
    return {
        children,
        entry,
        levelEntry,
        observations,
        parentTransform,
        truth
    };
}

function mismatchCells(predictions, truth) {
    return predictions.filter(prediction =>
        truth.get(`${prediction.x},${prediction.y}`) !== prediction.kind);
}

function runScenario(template, seed) {
    const generated = scenario(template, seed);
    const depth = Number(template.name.slice(-1));
    const [anchored] = selectSafeTemplates(
        [template],
        {place: 'Tomb', depth},
        {levelEntry: generated.levelEntry}
    );
    assert.ok(anchored?.metadata?.matchAnchor,
        `seed ${seed}: missing Tomb:${depth} match anchor`);
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates([anchored]);
    matcher.updateObservations(generated.observations);
    const result = matcher.getResult();
    const mismatches = mismatchCells(result.predictions, generated.truth);
    assert.equal(mismatches.length, 0,
        `seed ${seed} ${template.name} ${generated.entry.route.id} `
        + `${generated.parentTransform.id}: safe prediction mismatch `
        + JSON.stringify(mismatches.slice(0, 3)));
    const forceMismatches = mismatchCells(
        result.forcePredictions,
        generated.truth
    );
    return {
        ready: result.ready,
        predictions: result.predictions.length,
        forcePredictions: result.forcePredictions.length,
        forceMismatches: forceMismatches.length,
        route: generated.entry.route.id,
        parentTransform: generated.parentTransform.id,
        childTransforms: generated.children.map(child => child.transform.id)
    };
}

const tombSource = await exactText(TOMB_PATH, 'DWEM_TOMB_ORACLE_SOURCE');
const vaultLua = await exactText(
    VAULT_LUA_PATH,
    'DWEM_TOMB_ORACLE_VAULT_LUA'
);
const parseOptions = {
    path: TOMB_PATH,
    dependencies: {[VAULT_LUA_PATH]: vaultLua}
};
const templates = parseRuntimeDes(tombSource, parseOptions)
    .filter(template => template.metadata?.sourceAudit === 'tomb-fixed-composite-v1');
assert.deepEqual(templates.map(template => template.name), [
    'tomb_1',
    'tomb_2',
    'tomb_3'
]);

const seedBase = Number(process.env.DWEM_TOMB_ORACLE_SEED || DEFAULT_SEED);
const summary = {
    exactSha: EXACT_SHA,
    seedBase: seedBase >>> 0,
    runsPerFloor: RUNS_PER_FLOOR,
    total: 0,
    ready: 0,
    safePredictions: 0,
    safeMismatches: 0,
    forcePredictions: 0,
    forceMismatches: 0,
    negativeSources: 0,
    negativeFalseReady: 0,
    wizardDirectStairRejected: 0,
    routes: {},
    parentTransforms: {},
    childTransforms: {}
};
for (const [floorIndex, template] of templates.entries()) {
    for (let run = 0; run < RUNS_PER_FLOOR; run++) {
        const seed = (seedBase + floorIndex * 0x1f_12_3b_b5
            + run * 0x9e_37_79_b9) >>> 0;
        const result = runScenario(template, seed);
        summary.total++;
        summary.ready += Number(result.ready);
        summary.safePredictions += result.predictions;
        summary.forcePredictions += result.forcePredictions;
        summary.forceMismatches += result.forceMismatches;
        summary.routes[`${template.name}:${result.route}`] =
            (summary.routes[`${template.name}:${result.route}`] || 0) + 1;
        summary.parentTransforms[result.parentTransform] =
            (summary.parentTransforms[result.parentTransform] || 0) + 1;
        for (const transform of result.childTransforms) {
            summary.childTransforms[transform] =
                (summary.childTransforms[transform] || 0) + 1;
        }
    }
}
assert.ok(summary.ready >= RUNS_PER_FLOOR * 2,
    `too few ready scenarios: ${summary.ready}/${summary.total}`);
assert.ok(summary.safePredictions > 0, 'oracle produced no safe predictions');

// `&~` can jump directly to Tomb:2/3 without following one of the named
// escape hatches. Crawl then places the wizard on an ordinary stair. That is
// not a natural Tomb route: the real source destinations are
// hatch_dest_name() markers substituted to floor, and dungeon.cc moves the
// player onto that floor without creating a return stair. Keep the artificial
// wizard arrival force-only instead of weakening the production anchor.
for (const [floorIndex, template] of templates.slice(1).entries()) {
    const generated = scenario(
        template,
        (seedBase + 0x57_49_5a_00 + floorIndex) >>> 0
    );
    const depth = Number(template.name.slice(-1));
    const [anchored] = selectSafeTemplates(
        [template],
        {place: 'Tomb', depth},
        {levelEntry: generated.levelEntry}
    );
    const observations = generated.observations
        .filter(cell => cell.x !== generated.levelEntry.x
            || cell.y !== generated.levelEntry.y);
    observations.push({...generated.levelEntry, kind: 'stair'});
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates([anchored]);
    const direct = matcher.updateObservations(observations);
    assert.equal(direct.ready, false, `${template.name} wizard direct ready`);
    assert.equal(direct.reason, 'anchor-unverified',
        `${template.name} wizard direct reason`);
    assert.equal(direct.predictions.length, 0,
        `${template.name} wizard direct safe predictions`);
    summary.wizardDirectStairRejected++;
}
assert.equal(summary.wizardDirectStairRejected, 2);

const unsafeHelperMutation = tombSource.replace(
    'e.kfeat("^ = trap_alarm / trap_net / trap_zot / trap_dispersal / trap_tyrant")',
    'e.kfeat("^ = rock_wall")'
);
const unsafeMarkerMutation = tombSource.replace(
    'MARKER:   C = lua:hatch_dest_name("tomb1_hall_exit_2")',
    'MARKER:   C = lua:hatch_name("tomb1_hall_exit_2")'
);
const addedComponentMutation = `${tombSource}\n`
    + `NAME: tomb_3_rune_unresolved_oracle\n`
    + `TAGS: tomb_3_rune unrand\n`
    + `MAP\n${Array.from({length: 20}, () => '.'.repeat(41)).join('\n')}\n`
    + 'ENDMAP\n';
for (const [name, mutation] of [
    ['terrain-helper-mutation', unsafeHelperMutation],
    ['entry-marker-mutation', unsafeMarkerMutation],
    ['unresolved-component-mutation', addedComponentMutation]
]) {
    summary.negativeSources++;
    const rejected = parseRuntimeDes(mutation, parseOptions)
        .filter(template => template.metadata?.sourceAudit
            === 'tomb-fixed-composite-v1');
    assert.equal(rejected.length, 0, `${name} did not fail closed`);
    const matcher = new MapMatcher({requireExhaustivePlacement: true});
    matcher.setTemplates(rejected);
    matcher.updateObservations([
        {x: 0, y: 0, kind: 'floor'},
        {x: 1, y: 0, kind: 'wall'}
    ]);
    const falseReady = matcher.getResult().ready;
    summary.negativeFalseReady += Number(falseReady);
    assert.equal(falseReady, false,
        `${name} produced a false-ready matcher`);
}

console.log(JSON.stringify(summary, null, 2));
