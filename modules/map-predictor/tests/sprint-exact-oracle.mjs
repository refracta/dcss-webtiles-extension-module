import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

import {parseDes} from '../des-parser.js';
import {MapMatcher, allowedTransforms, normalizeTerrainKind,
    transformTemplate} from '../matcher.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {
    auditedSprintDestinationTemplates,
    selectAuditedSprintCatalog,
    SPRINT_ENTRY_SENTINEL,
    SPRINT_SOURCE_PATHS
} from '../sprint-destinations.js';

const GOLDEN = Object.freeze({
    'arena_sprint.des': Object.freeze({
        name: 'arena_sprint', width: 35, height: 34,
        source: '264a3d7770312bc86e8e1677d758121465068cdc5770a72b0982f72e7bcdeb31',
        single: 1166, multi: 24, masked: 0, nil: 0,
        transforms: ['r0'], anchor: [17, 17],
        digest: 'ca773b0b18f1df085b9380b4af2488e9e0150c20bd341ab30a8f32b368866f16'
    }),
    'fedhas.des': Object.freeze({
        name: 'dungeon_sprint_fedhas', width: 55, height: 38,
        source: '1ca0c1e5a4347ae9ce4fe520cee74a83daa9016cf2e3b9b8494c296304059a3c',
        single: 2090, multi: 0, masked: 0, nil: 0,
        transforms: ['r0'], anchor: [2, 2],
        digest: '967ba3572af09304d9c3e301a23f9211cd0d9d70cc23b7cf57170eab0846bf9d'
    }),
    'linesprint.des': Object.freeze({
        name: 'linesprint', width: 70, height: 59,
        source: '37663b1d28bea67bbed0f60a57590ff7ddd52d23274b37f26e97f82a43ece229',
        single: 3938, multi: 192, masked: 0, nil: 0,
        transforms: ['r0', 'r0v', 'r0h', 'r0hv', 'r90', 'r90v', 'r90h', 'r90hv'],
        anchor: [1, 1],
        digest: '1d14ff1e4879f2800ef330e70a1f7448c414152a5f972e07566120cdd228b6ac'
    }),
    'meat.des': Object.freeze({
        name: 'meatsprint', width: 70, height: 70,
        source: 'e43d3f827518f8c32501c841da991b3b087117cfe8e4dddb362a5b907a30d8a9',
        single: 4900, multi: 0, masked: 0, nil: 0,
        transforms: ['r0'], anchor: [34, 35],
        digest: '309905bc64c5cb64f9441ce51acdd823d41152bd227fa2121f287a11d5d06944'
    }),
    'menkaure.des': Object.freeze({
        name: 'the_violet_keep_of_menkaure', width: 62, height: 39,
        source: 'd9e8e68697d8e9d8f2d837dec0b549c095efde773327440891d2316ceaa9f645',
        single: 1702, multi: 594, masked: 0, nil: 122,
        transforms: ['r0'], anchor: [18, 17],
        digest: 'd031d27a172f07cc5fbc90669bea482fe7e3b1a4e952c5d710cf838ee8225891'
    }),
    'pitsprint.des': Object.freeze({
        name: 'pitsprint', width: 80, height: 70,
        source: 'f607e8710810779be145c40b42d3e134474de64ceb664b4d6303247bac8628a9',
        single: 3879, multi: 1720, masked: 1, nil: 0,
        transforms: ['r0'], anchor: [17, 57],
        digest: 'e23d8054be17cb12cd2814ea8584c2dd53039a9f52e16a4f6a71053115b7d62e'
    }),
    'red_sonja.des': Object.freeze({
        name: 'dungeon_sprint_1', width: 68, height: 31,
        source: '3483bfedad96e4fedca2b099da741a18145227ab5906dd959f1fff61af8aa6c7',
        single: 2044, multi: 64, masked: 0, nil: 0,
        transforms: ['r0'], anchor: [4, 2],
        digest: 'b688a0f1a741d87774a74939b15e40c0f7a39863f5e38a76553db887827b6923'
    }),
    'sprint_mu.des': Object.freeze({
        name: 'dungeon_sprint_mu', width: 80, height: 70,
        source: '01a1626acdf8ab4f65d03ea3646b3ecda761bbb4be093732cc6032b2bfabeeaf',
        single: 3398, multi: 752, masked: 1450, nil: 0,
        transforms: ['r0'], anchor: [1, 1],
        digest: 'b819d8b7e044ab28c5cd6dec8bdbbf0cc37333b67de2cb13f0b4adf699818381'
    }),
    'zigsprint.des': Object.freeze({
        name: 'sprint_v', width: 80, height: 70,
        source: 'ef3775a40109e1979de7d2d4ed60150651716da85812c400f9ac085ee6dd2f1f',
        single: 5020, multi: 160, masked: 420, nil: 0,
        transforms: ['r0'], anchor: [8, 10],
        digest: '5caf9a4a39b46b9bdad69b60a860d178a01874ae983cdec62cca0ff54336d993'
    })
});

function option(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const sourceDirectory = option('--source-dir');
if (!sourceDirectory) {
    throw new Error('Usage: sprint-exact-oracle.mjs --source-dir <dat/des/sprint>');
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalGrid(template) {
    const stats = {single: 0, multi: 0, masked: 0, nil: 0};
    const text = template.grid.map(row => row.map(cell => {
        if (cell == null) {
            stats.nil++;
            return '~';
        }
        const kinds = [...new Set(cell.kinds || [])].sort();
        if (kinds.length === 1) {
            stats.single++;
        } else if (kinds.length > 1) {
            stats.multi++;
        } else {
            stats.masked++;
        }
        return `${kinds.join(',')}${
            cell.possibleGlyphs?.includes(SPRINT_ENTRY_SENTINEL) ? '@' : ''}`;
    }).join('\t')).join('\n');
    return {stats, digest: sha256(text)};
}

function singletonKind(cell) {
    const kinds = [...new Set((cell?.kinds || [])
        .map(normalizeTerrainKind).filter(Boolean))];
    return kinds.length === 1 ? kinds[0] : null;
}

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const start = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(source);
    if (!start) {
        return null;
    }
    const offset = start.index + (source[start.index] === '\n' ? 1 : 0);
    const tail = source.slice(offset);
    const next = /\nNAME:\s*/u.exec(tail.slice(1));
    return next ? tail.slice(0, next.index + 1) : tail;
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function directSubvaultConsensusChecks(source, parsed, primary, runtime) {
    const block = mapBlock(source, primary.name);
    const rows = mapRows(block);
    const declarations = [...String(block || '').matchAll(
        /^\s*SUBVAULT:\s*(\S+)\s*:\s*(\S+)\s*$/gmu
    )].flatMap(match => [...match[1]].map(glyph => ({
        glyph,
        selector: match[2]
    })));
    const byGlyph = new Map(declarations.map(entry => [
        entry.glyph,
        entry.selector
    ]));
    const shuffleGroups = [...String(block || '').matchAll(
        /^\s*SHUFFLE:\s*(.+?)\s*$/gmu
    )].flatMap(match => match[1].split(/[\s/,]+/u)
        .filter(Boolean).map(group => [...group]));
    let checks = 0;

    for (const declaration of declarations) {
        const points = [];
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
                if (row[x] === declaration.glyph) {
                    points.push({x, y});
                }
            }
        });
        if (!points.length) {
            continue;
        }
        const minX = Math.min(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x));
        const maxY = Math.max(...points.map(point => point.y));
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const pointKeys = new Set(points.map(point => `${point.x},${point.y}`));
        const group = shuffleGroups.find(candidate =>
            candidate.includes(declaration.glyph)) || [declaration.glyph];
        const selectors = group.map(glyph => byGlyph.get(glyph)).filter(Boolean);
        const children = selectors.flatMap(selector => parsed.filter(template =>
            template.name === selector
            || template.metadata?.tags?.includes(selector)));
        // This independent check covers direct, warning-free leaf children.
        // Recursive/helper-driven children are guarded by the frozen full-grid
        // digest and remain masked wherever the runtime cannot prove consensus.
        if (!children.length || children.some(child =>
            child.metadata?.parseWarnings?.length
            || /^\s*SUBVAULT:/mu.test(mapBlock(source, child.name) || ''))) {
            continue;
        }
        const variants = children.flatMap(child =>
            allowedTransforms(child).flatMap(transform => {
                const transformed = transformTemplate(child, transform);
                if (transformed.width !== width || transformed.height !== height) {
                    return [];
                }
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if (transformed.grid[y]?.[x] != null
                            && !pointKeys.has(`${minX + x},${minY + y}`)) {
                            return [];
                        }
                    }
                }
                return [transformed];
            }));
        if (!variants.length) {
            continue;
        }
        for (const point of points) {
            const localX = point.x - minX;
            const localY = point.y - minY;
            const expected = variants.map(variant =>
                singletonKind(variant.grid[localY]?.[localX]));
            if (expected.some(kind => !kind)
                || new Set(expected).size !== 1) {
                continue;
            }
            const actual = singletonKind(runtime.grid[point.y]?.[point.x]);
            if (actual) {
                assert.equal(
                    actual,
                    expected[0],
                    `${primary.name}/${declaration.glyph} @ ${point.x},${point.y}`
                );
                checks++;
            }
        }
    }
    return checks;
}

function transformedAnchor(transformed) {
    const points = [];
    transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (cell?.possibleGlyphs?.includes(SPRINT_ENTRY_SENTINEL)) {
            points.push({x, y});
        }
    }));
    assert.equal(points.length, 1);
    return points[0];
}

function worldCells(template, transform) {
    const transformed = transformTemplate(template, transform);
    const offsetX = Math.floor((80 - transformed.width) / 2);
    const offsetY = Math.floor((70 - transformed.height) / 2);
    const cells = [];
    for (let y = 0; y < 70; y++) {
        for (let x = 0; x < 80; x++) {
            const localX = x - offsetX;
            const localY = y - offsetY;
            const cell = localX >= 0 && localX < transformed.width
                && localY >= 0 && localY < transformed.height
                ? transformed.grid[localY]?.[localX]
                : null;
            const kind = cell == null ? 'wall' : singletonKind(cell);
            if (kind) {
                cells.push({x, y, kind});
            }
        }
    }
    const anchor = transformedAnchor(transformed);
    return {
        cells,
        anchor: {x: offsetX + anchor.x, y: offsetY + anchor.y},
        offsetX,
        offsetY
    };
}

const actualFiles = fs.readdirSync(sourceDirectory)
    .filter(name => name.endsWith('.des')).sort();
const expectedFiles = Object.keys(GOLDEN).sort();
assert.deepEqual(actualFiles, expectedFiles, 'Sprint source inventory changed');

const started = performance.now();
const templates = [];
const reports = [];
let directConsensusTotal = 0;
for (const canonicalPath of SPRINT_SOURCE_PATHS) {
    const basename = path.basename(canonicalPath);
    const golden = GOLDEN[basename];
    const source = fs.readFileSync(path.join(sourceDirectory, basename), 'utf8');
    assert.equal(sha256(source), golden.source, `${basename}: source hash`);
    const parsed = parseDes(source, {path: canonicalPath});
    const audited = auditedSprintDestinationTemplates(source, parsed, {
        path: canonicalPath
    });
    assert.equal(audited?.length, 1, `${basename}: one audited primary`);
    const [template] = audited;
    const runtimeIntegration = parseRuntimeDes(source, {path: canonicalPath});
    assert.equal(runtimeIntegration.length, 1,
        `${basename}: runtime exact-source integration`);
    assert.equal(template.name, golden.name);
    assert.equal(template.width, golden.width);
    assert.equal(template.height, golden.height);
    assert.equal(template.metadata.sourceAudit, 'sprint-exact-source-v1');
    assert.equal(template.metadata.autoReveal, true);
    assert.equal(template.metadata.requiresTrustedEntry, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, undefined);
    assert.equal(template.metadata.entryAnchorObservedKind, undefined);
    assert.equal(template.metadata.encompassBorderFillKind, 'wall');
    assert.equal(template.metadata.matchPolicy.exhaustivePlacement, true);
    assert.equal(template.metadata.matchAnchor, undefined);

    const anchors = [];
    template.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (cell?.possibleGlyphs?.includes(SPRINT_ENTRY_SENTINEL)) {
            anchors.push([x, y, singletonKind(cell)]);
        }
    }));
    assert.deepEqual(anchors, [[...golden.anchor, 'stair']],
        `${basename}: exact entry sentinel`);

    const canonical = canonicalGrid(template);
    assert.deepEqual(canonical.stats, {
        single: golden.single,
        multi: golden.multi,
        masked: golden.masked,
        nil: golden.nil
    });
    assert.equal(canonical.digest, golden.digest,
        `${basename}: independently frozen terrain digest`);
    assert.deepEqual(
        allowedTransforms(template).map(transform => transform.id),
        golden.transforms,
        `${basename}: legal transform set`
    );
    const directConsensusChecks = directSubvaultConsensusChecks(
        source,
        parsed,
        parsed.find(candidate => candidate.name === template.name),
        template
    );
    directConsensusTotal += directConsensusChecks;

    const mutated = `${source}\n# oracle mutation`;
    assert.deepEqual(auditedSprintDestinationTemplates(
        mutated,
        parseDes(mutated, {path: canonicalPath}),
        {path: canonicalPath}
    ), [], `${basename}: mutation must fail closed`);

    templates.push(template);
    reports.push({
        file: basename,
        name: template.name,
        ...canonical.stats,
        transforms: golden.transforms.length,
        directConsensusChecks,
        anchor: golden.anchor,
        digest: canonical.digest
    });
}
assert.equal(selectAuditedSprintCatalog(templates).length, 9);
assert.ok(directConsensusTotal >= 4000,
    `too few independent child-consensus checks: ${directConsensusTotal}`);

// Exercise every Crawl-legal primary transform with exact coarse terrain,
// exhaustive unanchored placement, the 80x70 reset-wall model, and all nine
// maps competing. This is deliberately separate from source parsing.
const matchReports = [];
for (const target of templates) {
    for (const transform of allowedTransforms(target)) {
        const world = worldCells(target, transform);
        const selected = selectSafeTemplates(
            templates,
            {place: 'Dungeon', depth: 1},
            {}
        );
        // Keep every 5th predictable cell, but always include the exact
        // arrival stair. The sample spans the complete level and leaves ample
        // cells for prediction/wall-fill assertions.
        const observations = world.cells.filter((cell, index) =>
            index % 5 === 0
            || (cell.x === world.anchor.x && cell.y === world.anchor.y));
        const matcher = new MapMatcher({
            requireExhaustivePlacement: true,
            minPredictedCells: 1,
            maxConsensusCandidates: 8192
        });
        matcher.setTemplates(selected);
        matcher.updateObservations(observations, {evaluate: false});
        const matchStarted = performance.now();
        const result = matcher.evaluate();
        const elapsedMs = performance.now() - matchStarted;
        assert.equal(result.reason, 'ready',
            `${target.name}/${transform.id}: ${result.reason}`);
        assert.equal(result.best.template.name, target.name,
            `${target.name}/${transform.id}: wrong primary`);
        assert.equal(result.best.transform, transform.id,
            `${target.name}/${transform.id}: wrong transform`);
        assert.ok(result.predictions.length > 0);

        const observationKeys = new Set(observations.map(cell =>
            `${cell.x},${cell.y}`));
        const outsidePrediction = result.predictions.find(cell => {
            if (observationKeys.has(`${cell.x},${cell.y}`)) {
                return false;
            }
            const transformed = transformTemplate(target, transform);
            const offsetX = Math.floor((80 - transformed.width) / 2);
            const offsetY = Math.floor((70 - transformed.height) / 2);
            return cell.kind === 'wall'
                && (cell.x < offsetX || cell.x >= offsetX + transformed.width
                    || cell.y < offsetY
                    || cell.y >= offsetY + transformed.height);
        });
        if (target.width < 80 || target.height < 70) {
            assert.ok(outsidePrediction,
                `${target.name}/${transform.id}: missing reset-wall prediction`);
        }
        matchReports.push({
            name: target.name,
            transform: transform.id,
            observations: observations.length,
            predictions: result.predictions.length,
            elapsedMs: Math.round(elapsedMs * 100) / 100
        });
    }
}

function evaluateNeighborhood(target, transform, radius) {
    const world = worldCells(target, transform);
    const observations = world.cells.filter(cell =>
        Math.abs(cell.x - world.anchor.x) <= radius
        && Math.abs(cell.y - world.anchor.y) <= radius);
    const selected = selectSafeTemplates(
        templates,
        {place: 'Dungeon', depth: 1},
        {}
    );
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 20,
        maxConsensusCandidates: 16
    });
    matcher.setTemplates(selected);
    matcher.updateObservations(observations, {evaluate: false});
    return {result: matcher.evaluate(), world, observations};
}

// A 9x9 view of dungeon_sprint_mu contains only 21 constrained cells. It is
// a useful confusion regression: the player packet may scope the Sprint
// catalog, but sparse terrain still cannot authorize a reveal.
const sparseTarget = templates.find(template =>
    template.name === 'dungeon_sprint_mu');
assert.ok(sparseTarget);
const sparse = evaluateNeighborhood(
    sparseTarget,
    allowedTransforms(sparseTarget)[0],
    4
);
assert.equal(sparse.result.ready, false);
assert.equal(sparse.result.reason, 'insufficient-evidence');

// A 17x17 entry neighborhood is sufficient across all nine audited maps and
// all 16 Crawl-legal transforms. Symmetric terrain can give another map the
// best label, so the safety invariant is consensus: the real placement must
// remain plausible and every injected singleton must agree with its terrain.
const neighborhoodReports = [];
for (const target of templates) {
    for (const transform of allowedTransforms(target)) {
        const {result, world, observations} = evaluateNeighborhood(
            target,
            transform,
            8
        );
        assert.equal(result.ready, true,
            `${target.name}/${transform.id}: ${result.reason}`);
        assert.equal(result.candidates.some(candidate =>
            candidate.template.name === target.name
            && candidate.transform === transform.id
            && candidate.offsetX === world.offsetX
            && candidate.offsetY === world.offsetY), true,
        `${target.name}/${transform.id}: actual placement was discarded`);
        const actualKinds = new Map(world.cells.map(cell => [
            `${cell.x},${cell.y}`,
            cell.kind
        ]));
        for (const prediction of result.predictions) {
            assert.equal(
                prediction.kind,
                actualKinds.get(`${prediction.x},${prediction.y}`),
                `${target.name}/${transform.id}: unsafe prediction at `
                    + `${prediction.x},${prediction.y}`
            );
        }
        neighborhoodReports.push({
            name: target.name,
            transform: transform.id,
            observations: observations.length,
            candidates: result.candidates.length,
            predictions: result.predictions.length
        });
    }
}

// Procedural-looking ordinary terrain must never become a fixed Sprint
// placement merely because a caller selected the Sprint candidate scope.
const negativePatterns = {
    allFloor: () => 'floor',
    allWall: () => 'wall',
    checker: (x, y) => (x + y) % 2 === 0 ? 'wall' : 'floor',
    rectangularRoom: (x, y) => Math.abs(x) === 8 || Math.abs(y) === 8
        ? 'wall' : 'floor',
    seededThirtyPercentWall: (x, y) =>
        ((x * 1103515245 + y * 12345 + 0x5f3759df) >>> 0) % 10 < 3
            ? 'wall' : 'floor'
};
for (const [name, kindAt] of Object.entries(negativePatterns)) {
    const observations = [];
    for (let y = -8; y <= 8; y++) {
        for (let x = -8; x <= 8; x++) {
            observations.push({x, y, kind: kindAt(x, y)});
        }
    }
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 20,
        maxConsensusCandidates: 16
    });
    matcher.setTemplates(selectSafeTemplates(
        templates,
        {place: 'Dungeon', depth: 1},
        {}
    ));
    matcher.updateObservations(observations, {evaluate: false});
    const result = matcher.evaluate();
    assert.equal(result.ready, false, `${name}: false Sprint reveal`);
}

const elapsedMs = performance.now() - started;
process.stdout.write(`${JSON.stringify({
    sourceDirectory,
    files: reports,
    matches: matchReports,
    neighborhoods: neighborhoodReports,
    directConsensusTotal,
    elapsedMs: Math.round(elapsedMs * 100) / 100
}, null, 2)}\n`);
