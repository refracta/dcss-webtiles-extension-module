import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';

import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {
    MapMatcher,
    allowedTransforms,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';

const ELF_PATH = 'crawl-ref/source/dat/des/branches/elf.des';
const sourcePath = process.argv[2]
    || process.env.DWEM_ELF_DES
    || '/tmp/dwem-exact-elf.des';
if (!fs.existsSync(sourcePath)) {
    throw new Error(`Elf DES source is unavailable: ${sourcePath}`);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const selected = selectSafeTemplates(parseRuntimeDes(source, {
    path: ELF_PATH
}), {place: 'Elf', depth: 3});
assert.equal(selected.length, 21);
assert.ok(selected.every(template =>
    template.metadata?.matchPolicy?.exhaustivePlacement === true));
assert.ok(selected.every(template =>
    template.metadata?.matchPolicy?.revealDisabled === true));
const exhaustive = selected;

const truth = exhaustive[Math.min(10, exhaustive.length - 1)];
const transform = allowedTransforms(truth)[0];
const transformed = transformTemplate(truth, transform);
const observations = [];
transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
    const kinds = [...new Set((cell?.kinds || [])
        .map(normalizeTerrainKind)
        .filter(Boolean))];
    if (kinds.length === 1 && (x * 17 + y * 31) % 5 !== 0) {
        observations.push({x: x - 19, y: y - 13, kind: kinds[0]});
    }
}));
assert.ok(observations.length >= 300);

if (typeof global.gc === 'function') {
    global.gc();
}
const before = process.memoryUsage();
const matcher = new MapMatcher({
    requireExhaustivePlacement: true,
    minPredictedCells: 1
});
matcher.setTemplates(exhaustive);
const started = performance.now();
const result = matcher.updateObservations(observations);
const elapsedMilliseconds = performance.now() - started;
const after = process.memoryUsage();
const stats = matcher.getEvaluationStats();

assert.equal(result.reason, 'policy-disabled');
assert.equal(result.best.template.name, truth.name);
assert.equal(result.best.transform, transform.id);
assert.equal(result.best.offsetX, -19);
assert.equal(result.best.offsetY, -13);
assert.ok(result.forcePredictions.length > 0);
assert.ok(stats.exhaustiveOffsets > 100000);
assert.ok(stats.correlationBytes < 32 * 1024 * 1024,
    `correlation buffers: ${stats.correlationBytes} bytes`);
assert.ok(elapsedMilliseconds < 2000,
    `Elf exhaustive evaluation: ${elapsedMilliseconds.toFixed(2)}ms`);

process.stdout.write(`${JSON.stringify({
    templates: exhaustive.length,
    observations: observations.length,
    exhaustiveOffsets: stats.exhaustiveOffsets,
    exhaustiveBatches: stats.exhaustiveBatches,
    correlationMiB: Number((stats.correlationBytes / 1048576).toFixed(2)),
    elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(2)),
    rssDeltaMiB: Number(((after.rss - before.rss) / 1048576).toFixed(2)),
    arrayBuffersDeltaMiB: Number((
        (after.arrayBuffers - before.arrayBuffers) / 1048576
    ).toFixed(2)),
    best: result.best.template.name,
    score: result.best.score
})}\n`);
