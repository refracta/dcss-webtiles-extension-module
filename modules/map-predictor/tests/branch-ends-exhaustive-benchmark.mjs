import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {
    MapMatcher,
    allowedTransforms,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';

const SOURCE_ROOT = process.argv[2]
    || process.env.DWEM_BRANCH_DES_ROOT
    || '/tmp/dwem-crawl-1b83';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const BRANCHES = Object.freeze({
    crypt: Object.freeze({depth: 3, raw: 8, force: 0}),
    depths: Object.freeze({place: 'Dungeon', depth: 15, raw: 9, force: 9}),
    lair: Object.freeze({depth: 5, raw: 14, force: 14}),
    orc: Object.freeze({depth: 2, raw: 15, force: 14}),
    snake: Object.freeze({depth: 4, raw: 9, force: 8}),
    spider: Object.freeze({depth: 4, raw: 9, force: 6}),
    swamp: Object.freeze({depth: 4, raw: 10, force: 8})
});

function sourceFile(relative, compactName) {
    const candidates = [
        path.join(SOURCE_ROOT, compactName),
        path.join(SOURCE_ROOT, relative)
    ];
    const resolved = candidates.find(filename => fs.existsSync(filename));
    if (!resolved) {
        throw new Error(`source is unavailable: ${candidates.join(', ')}`);
    }
    return resolved;
}

function kindsFor(cell) {
    const raw = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    if (raw.some(kind => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(kind || '').trim().toLowerCase()))) {
        return [];
    }
    return [...new Set(raw.map(normalizeTerrainKind).filter(Boolean))];
}

function predictableCells(template) {
    return template.grid.flat().reduce((total, cell) =>
        total + (kindsFor(cell).length === 1 ? 1 : 0), 0);
}

function observationsFor(transformed, offsetX, offsetY) {
    const observations = [];
    transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
        const kinds = kindsFor(cell);
        if (kinds.length === 1 && (x * 17 + y * 31) % 5 !== 0) {
            observations.push({
                x: x + offsetX,
                y: y + offsetY,
                kind: kinds[0]
            });
        }
    }));
    return observations;
}

function comparePredictions(predictions, transformed, offsetX, offsetY) {
    let unionViolation = 0;
    let outside = 0;
    for (const prediction of predictions) {
        const kinds = kindsFor(
            transformed.grid[prediction.y - offsetY]
                ?.[prediction.x - offsetX]
        );
        if (!kinds.length) {
            outside++;
        } else if (!kinds.includes(prediction.kind)) {
            unionViolation++;
        }
    }
    return {unionViolation, outside};
}

const vaultLua = fs.readFileSync(sourceFile(
    VAULT_LUA_PATH,
    'vault.lua'
), 'utf8');
const dependencies = {[VAULT_LUA_PATH]: vaultLua};
const report = {};

for (const [branch, spec] of Object.entries(BRANCHES)) {
    if (typeof global.gc === 'function') {
        global.gc();
    }
    const before = process.memoryUsage();
    const relative = `crawl-ref/source/dat/des/branches/${branch}.des`;
    const source = fs.readFileSync(sourceFile(relative, `${branch}.des`), 'utf8');
    const options = {path: relative, dependencies};
    const selected = selectSafeTemplates(parseRuntimeDes(source, options), {
        place: spec.place || branch,
        depth: spec.depth
    });
    assert.equal(selected.length, spec.raw, branch);
    assert.ok(selected.every(template =>
        template.metadata.matchPolicy.revealDisabled === true), branch);
    const forceable = selected.filter(template =>
        template.metadata.matchPolicy.forceRevealDisabled !== true);
    assert.equal(forceable.length, spec.force, branch);

    const candidates = forceable.length ? forceable : selected;
    const truth = [...candidates].sort((left, right) =>
        predictableCells(right) - predictableCells(left))[0];
    const transform = allowedTransforms(truth)[0];
    const transformed = transformTemplate(truth, transform);
    const offsetX = -17;
    const offsetY = -11;
    const observations = observationsFor(transformed, offsetX, offsetY);
    assert.ok(observations.length >= 72,
        `${branch}:${truth.name} only has ${observations.length} observations`);

    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    const prepareStarted = performance.now();
    matcher.setTemplates(selected);
    const prepareMilliseconds = performance.now() - prepareStarted;
    const evaluateStarted = performance.now();
    const result = matcher.updateObservations(observations);
    const evaluateMilliseconds = performance.now() - evaluateStarted;
    const after = process.memoryUsage();
    const stats = matcher.getEvaluationStats();

    assert.equal(result.ready, false, branch);
    assert.equal(result.reason, 'policy-disabled', branch);
    assert.deepEqual(result.predictions, [], branch);
    assert.equal(result.best.template.name, truth.name, branch);
    if (forceable.length) {
        assert.ok(result.forcePredictions.length > 0, branch);
        assert.equal(result.best.placementSearch, 'exhaustive', branch);
        assert.ok(stats.exhaustiveOffsets > 0, branch);
    } else {
        assert.deepEqual(result.forcePredictions, [], branch);
    }
    assert.ok(stats.correlationBytes < 64 * 1024 * 1024,
        `${branch} correlation buffers: ${stats.correlationBytes}`);
    assert.ok(evaluateMilliseconds < 2500,
        `${branch} evaluation: ${evaluateMilliseconds.toFixed(2)}ms`);

    report[branch] = {
        templates: selected.length,
        forceEnabled: forceable.length,
        truth: truth.name,
        observations: observations.length,
        best: result.best.template.name,
        bestTransform: result.best.transform,
        bestOffset: [result.best.offsetX, result.best.offsetY],
        forcePredictions: result.forcePredictions.length,
        forceComparison: comparePredictions(
            result.forcePredictions,
            transformed,
            offsetX,
            offsetY
        ),
        exhaustiveOffsets: stats.exhaustiveOffsets,
        exhaustiveBatches: stats.exhaustiveBatches,
        correlationMiB: Number((stats.correlationBytes / 1048576).toFixed(2)),
        prepareMilliseconds: Number(prepareMilliseconds.toFixed(2)),
        evaluateMilliseconds: Number(evaluateMilliseconds.toFixed(2)),
        rssDeltaMiB: Number(((after.rss - before.rss) / 1048576).toFixed(2)),
        arrayBuffersDeltaMiB: Number((
            (after.arrayBuffers - before.arrayBuffers) / 1048576
        ).toFixed(2))
    };
}

process.stdout.write(`${JSON.stringify({
    sourceRoot: SOURCE_ROOT,
    branchLocal: true,
    branches: report
}, null, 2)}\n`);
