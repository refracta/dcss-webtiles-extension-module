import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    naturalBranchEndPrimaries,
    summarizeBranchEndCoverage
} from '../branch-end-destinations.js';
import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {
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
const parsed = parseDes(source, {path: ELF_PATH});
const runtime = parseRuntimeDes(source, {path: ELF_PATH});
const selected = selectSafeTemplates(runtime, {place: 'Elf', depth: 3});
const coverage = summarizeBranchEndCoverage({
    parsed,
    runtime,
    selected,
    path: ELF_PATH
});

assert.equal(coverage.runtime, coverage.raw, coverage.missingNames.join(', '));
assert.equal(coverage.selected, coverage.raw);
assert.equal(coverage.missingNames.length, 0);
assert.ok(selected.every(template =>
    template.metadata?.sourceAudit === 'elf-end-coarse-terrain-v1'));
assert.ok(selected.every(template =>
    template.metadata?.matchPolicy?.revealDisabled === true));

function normalizedKinds(cell) {
    const rawKinds = cell?.kinds;
    const values = Array.isArray(rawKinds) ? rawKinds : [rawKinds];
    if (values.some(kind => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(kind || '').trim().toLowerCase()))) {
        return [];
    }
    return [...new Set(values.map(normalizeTerrainKind).filter(Boolean))];
}

function cellKey(x, y) {
    return `${x},${y}`;
}

function variantOf(template, transform) {
    const transformed = transformTemplate(template, transform);
    const cells = new Map();
    let constrainedCells = 0;
    transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
        const kinds = normalizedKinds(cell);
        if (kinds.length) {
            constrainedCells++;
            cells.set(cellKey(x, y), kinds);
        }
    }));
    return {
        template,
        name: template.name,
        transform: transform.id,
        width: transformed.width,
        height: transformed.height,
        cells,
        constrainedCells
    };
}

const variants = selected.flatMap(template =>
    allowedTransforms(template).map(transform =>
        variantOf(template, transform)));

function observationsFor(variant, dropout, phase) {
    const observations = [];
    for (const [key, kinds] of variant.cells) {
        if (kinds.length !== 1) {
            continue;
        }
        const [x, y] = key.split(',').map(Number);
        const hash = Math.abs(
            Math.imul(x + 17, 73856093)
            ^ Math.imul(y + 31, 19349663)
            ^ Math.imul(phase + 47, 83492791)
        ) % 100;
        if (hash >= dropout) {
            observations.push({x, y, kind: kinds[0]});
        }
    }
    return observations;
}

function scoreVariant(variant, observations) {
    let evidenceCells = 0;
    let matches = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const observedKinds = new Set();
    for (const observation of observations) {
        const kinds = variant.cells.get(cellKey(observation.x, observation.y));
        if (!kinds?.length) {
            continue;
        }
        evidenceCells++;
        observedKinds.add(observation.kind);
        minX = Math.min(minX, observation.x);
        minY = Math.min(minY, observation.y);
        maxX = Math.max(maxX, observation.x);
        maxY = Math.max(maxY, observation.y);
        if (kinds.includes(observation.kind)) {
            matches++;
        }
    }
    const policy = variant.template.metadata.matchPolicy;
    const score = evidenceCells ? matches / evidenceCells : 0;
    const spanX = evidenceCells ? maxX - minX + 1 : 0;
    const spanY = evidenceCells ? maxY - minY + 1 : 0;
    const ready = score >= policy.minScore
        && evidenceCells >= policy.minEvidenceCells
        && evidenceCells >= policy.minEvidenceWeight
        && observedKinds.size >= policy.minDistinctKinds
        && evidenceCells / variant.constrainedCells >= policy.minCoverage
        && spanX / variant.width >= policy.minSpanXRatio
        && spanY / variant.height >= policy.minSpanYRatio
        && policy.requiredKinds.every(kind => observedKinds.has(kind));
    return {variant, ready, score, evidenceCells};
}

function buildConsensusPredictions(scored, observations) {
    const observed = new Set(observations.map(cell =>
        cellKey(cell.x, cell.y)));
    const predictions = [];
    const first = scored[0]?.variant;
    if (!first) {
        return predictions;
    }
    for (const [key, kinds] of first.cells) {
        if (observed.has(key) || kinds.length !== 1) {
            continue;
        }
        const kind = kinds[0];
        if (scored.every(candidate => {
            const candidateKinds = candidate.variant.cells.get(key);
            return candidateKinds?.length === 1
                && candidateKinds[0] === kind;
        })) {
            const [x, y] = key.split(',').map(Number);
            predictions.push({x, y, kind});
        }
    }
    return predictions;
}

const dropouts = [0, 20, 35, 50];
let cases = 0;
let trueMissing = 0;
let foreignReadyCases = 0;
let consensusPredictionCells = 0;
let consensusMismatches = 0;
let normalReady = 0;

for (let trueIndex = 0; trueIndex < variants.length; trueIndex++) {
    const truth = variants[trueIndex];
    for (let dropoutIndex = 0; dropoutIndex < dropouts.length; dropoutIndex++) {
        cases++;
        const observations = observationsFor(
            truth,
            dropouts[dropoutIndex],
            trueIndex * dropouts.length + dropoutIndex
        );
        const scored = variants.map(variant =>
            scoreVariant(variant, observations));
        const trueScore = scored[trueIndex];
        if (!trueScore.ready || trueScore.score !== 1) {
            trueMissing++;
            continue;
        }
        const ready = scored.filter(candidate => candidate.ready);
        if (ready.some(candidate => candidate.variant.name !== truth.name)) {
            foreignReadyCases++;
        }
        // Runtime policy intentionally keeps all of these partial placements
        // out of normal reveal even if this fixed-alignment oracle is ready.
        normalReady += truth.template.metadata.matchPolicy.revealDisabled
            ? 0
            : 1;
        const predictions = buildConsensusPredictions(ready, observations);
        consensusPredictionCells += predictions.length;
        for (const prediction of predictions) {
            const expected = truth.cells.get(cellKey(
                prediction.x,
                prediction.y
            ));
            if (expected?.length !== 1 || expected[0] !== prediction.kind) {
                consensusMismatches++;
            }
        }
    }
}

const terrainMutation = source.replace(
    /e\.subst\(["']\|\s*=\s*\|\s*\*:2["']\)/u,
    'e.subst("| = x")'
);
const mutatedParsed = parseDes(terrainMutation, {path: ELF_PATH});
const mutatedRuntime = parseRuntimeDes(terrainMutation, {path: ELF_PATH});
const mutatedSelected = selectSafeTemplates(
    mutatedRuntime,
    {place: 'Elf', depth: 3}
);
assert.equal(mutatedSelected.length,
    naturalBranchEndPrimaries(mutatedParsed, ELF_PATH).length);
const unsafeForceEnabled = mutatedRuntime.filter(template =>
    template.metadata?.sourceAudit === 'elf-end-detection-only-v1'
    && template.metadata?.matchPolicy?.forceRevealDisabled !== true);

assert.ok(cases >= 300, `only ${cases} cases`);
assert.equal(trueMissing, 0);
assert.equal(consensusMismatches, 0);
assert.equal(normalReady, 0);
assert.equal(unsafeForceEnabled.length, 0);

console.log(JSON.stringify({
    sourcePath,
    coverage,
    transforms: variants.length,
    cases,
    dropoutPercent: dropouts,
    trueMissing,
    foreignReadyCases,
    consensusPredictions: consensusPredictionCells,
    consensusMismatches,
    normalReady,
    mutatedDetectionOnly: mutatedRuntime.filter(template =>
        template.metadata?.sourceAudit === 'elf-end-detection-only-v1').length,
    unsafeForceEnabled: unsafeForceEnabled.length,
    limitation: 'fixed-alignment terrain oracle; arbitrary translation remains policy-disabled'
}, null, 2));
