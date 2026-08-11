import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

const vaultLuaFile = sourceFile(VAULT_LUA_PATH, 'vault.lua');
const dependencies = {
    [VAULT_LUA_PATH]: fs.readFileSync(vaultLuaFile, 'utf8')
};

function normalizedKinds(cell) {
    const values = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    if (values.some(kind => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(kind || '').trim().toLowerCase()))) {
        return [];
    }
    return [...new Set(values.map(normalizeTerrainKind).filter(Boolean))];
}

function cellKey(x, y) {
    return `${x},${y}`;
}

function makeVariant(template, transform) {
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
        constrainedCells,
        forceEnabled:
            template.metadata.matchPolicy.forceRevealDisabled !== true
    };
}

function observationsFor(variant, dropout, phase) {
    const observations = [];
    for (const [key, kinds] of variant.cells) {
        const [x, y] = key.split(',').map(Number);
        const hash = Math.abs(
            Math.imul(x + 23, 73856093)
            ^ Math.imul(y + 41, 19349663)
            ^ Math.imul(phase + 59, 83492791)
        ) % 100;
        if (hash >= dropout) {
            observations.push({
                x,
                y,
                kind: kinds[(hash + phase) % kinds.length]
            });
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
    const score = evidenceCells ? matches / evidenceCells : 0;
    const policy = variant.template.metadata.matchPolicy;
    const spanX = evidenceCells ? maxX - minX + 1 : 0;
    const spanY = evidenceCells ? maxY - minY + 1 : 0;
    const evidenceReady = evidenceCells >= policy.minEvidenceCells
        && evidenceCells >= policy.minEvidenceWeight
        && observedKinds.size >= policy.minDistinctKinds
        && evidenceCells / variant.constrainedCells >= policy.minCoverage
        && spanX / variant.width >= policy.minSpanXRatio
        && spanY / variant.height >= policy.minSpanYRatio
        && policy.requiredKinds.every(kind => observedKinds.has(kind));
    return {
        variant,
        score,
        evidenceCells,
        ready: evidenceReady && score >= policy.minScore
    };
}

function forcePredictions(best, observations) {
    const observed = new Set(observations.map(cell =>
        cellKey(cell.x, cell.y)));
    const predictions = [];
    for (const [key, kinds] of best.variant.cells) {
        if (!observed.has(key) && kinds.length === 1) {
            const [x, y] = key.split(',').map(Number);
            predictions.push({x, y, kind: kinds[0]});
        }
    }
    return predictions;
}

function compareForcePredictions(predictions, truth) {
    let singletonMismatch = 0;
    let unionViolation = 0;
    let outside = 0;
    let unverified = 0;
    for (const prediction of predictions) {
        const expected = truth.cells.get(cellKey(prediction.x, prediction.y));
        if (!expected) {
            outside++;
        } else if (!expected.includes(prediction.kind)) {
            unionViolation++;
            singletonMismatch += expected.length === 1 ? 1 : 0;
        } else if (expected.length !== 1) {
            unverified++;
        }
    }
    return {singletonMismatch, unionViolation, outside, unverified};
}

function proceduralObservations(seed) {
    const observations = [];
    for (let y = 0; y < 26; y++) {
        for (let x = 0; x < 34; x++) {
            const edge = x === 0 || y === 0 || x === 33 || y === 25;
            const pillar = ((x * 7 + seed * 5) % 19 === 0)
                && ((y * 11 + seed * 3) % 17 < 3);
            const partition = (x + seed) % 13 === 0
                && (y + seed * 2) % 9 !== 0;
            const pool = !edge && !pillar && !partition
                && ((x * 31 + y * 17 + seed * 23) % 97 < 4);
            const door = partition && (y + seed) % 9 === 0;
            observations.push({
                x,
                y,
                kind: edge || pillar || partition
                    ? door ? 'door' : 'wall'
                    : pool ? 'shallow_water' : 'floor'
            });
        }
    }
    return observations;
}

const dropouts = [0, 20, 35, 50];
const proceduralSeeds = 64;
const report = {};
let totalCases = 0;
let totalNormalReady = 0;
let totalForceSingletonMismatch = 0;
let totalForceUnionViolation = 0;
let totalForceOutside = 0;
let totalUnsafeForce = 0;
let totalProceduralCases = 0;
let totalProceduralFalseReady = 0;
let totalForceIdentityMiss = 0;
let totalUnexpectedForceViolation = 0;

for (const [branch, spec] of Object.entries(BRANCHES)) {
    const desPath = `crawl-ref/source/dat/des/branches/${branch}.des`;
    const filename = sourceFile(desPath, `${branch}.des`);
    const source = fs.readFileSync(filename, 'utf8');
    const options = {path: desPath, dependencies};
    const parsed = parseDes(source, options);
    const runtime = parseRuntimeDes(source, options);
    const selected = selectSafeTemplates(runtime, {
        place: spec.place || branch,
        depth: spec.depth
    });
    const coverage = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path: desPath
    });
    assert.equal(coverage.raw, spec.raw, branch);
    assert.equal(coverage.runtime, spec.raw, branch);
    assert.equal(coverage.selected, spec.raw, branch);
    assert.deepEqual(coverage.missingNames, [], branch);
    assert.ok(selected.every(template =>
        template.metadata.matchPolicy.revealDisabled === true), branch);
    assert.equal(selected.filter(template =>
        template.metadata.matchPolicy.forceRevealDisabled !== true).length,
    spec.force, branch);

    const variants = selected.flatMap(template =>
        allowedTransforms(template).map(transform =>
            makeVariant(template, transform)));
    let cases = 0;
    let normalReady = 0;
    let forceCases = 0;
    let forceIdentityMiss = 0;
    let forcePredictionCells = 0;
    let forceSingletonMismatch = 0;
    let forceUnionViolation = 0;
    let forceOutside = 0;
    let forceUnverified = 0;
    let unsafeForce = 0;
    let foreignReadyCases = 0;
    const forceOutsideCases = [];
    const forceUnionViolationCases = [];

    for (let truthIndex = 0; truthIndex < variants.length; truthIndex++) {
        const truth = variants[truthIndex];
        for (let dropoutIndex = 0;
            dropoutIndex < dropouts.length;
            dropoutIndex++) {
            cases++;
            const observations = observationsFor(
                truth,
                dropouts[dropoutIndex],
                truthIndex * dropouts.length + dropoutIndex
            );
            const scored = variants.map(variant =>
                scoreVariant(variant, observations));
            const ready = scored.filter(candidate => candidate.ready);
            if (ready.some(candidate =>
                candidate.variant.name !== truth.name)) {
                foreignReadyCases++;
            }
            // Every family is intentionally normal-disabled even if the
            // fixed-alignment terrain score itself is ready.
            normalReady += ready.some(candidate =>
                candidate.variant.template.metadata.matchPolicy
                    .revealDisabled !== true) ? 1 : 0;

            if (!truth.forceEnabled) {
                unsafeForce += truth.template.metadata.matchPolicy
                    .forceRevealDisabled === true ? 0 : 1;
                continue;
            }
            forceCases++;
            const best = scored.sort((left, right) =>
                right.score - left.score
                || right.evidenceCells - left.evidenceCells)[0];
            if (best.variant.name !== truth.name) {
                forceIdentityMiss++;
            }
            const predictions = forcePredictions(best, observations);
            const compared = compareForcePredictions(predictions, truth);
            forcePredictionCells += predictions.length;
            forceSingletonMismatch += compared.singletonMismatch;
            forceUnionViolation += compared.unionViolation;
            forceOutside += compared.outside;
            forceUnverified += compared.unverified;
            if (compared.outside) {
                forceOutsideCases.push({
                    truth: truth.name,
                    truthTransform: truth.transform,
                    best: best.variant.name,
                    bestTransform: best.variant.transform,
                    dropout: dropouts[dropoutIndex],
                    score: best.score,
                    evidenceCells: best.evidenceCells,
                    outside: compared.outside,
                    unverified: compared.unverified
                });
            }
            if (compared.unionViolation) {
                forceUnionViolationCases.push({
                    truth: truth.name,
                    truthTransform: truth.transform,
                    best: best.variant.name,
                    bestTransform: best.variant.transform,
                    dropout: dropouts[dropoutIndex],
                    score: best.score,
                    evidenceCells: best.evidenceCells,
                    unionViolation: compared.unionViolation
                });
            }
            if ((compared.unionViolation || compared.outside)
                && (best.variant.name !== truth.name
                    || best.variant.transform === truth.transform)) {
                totalUnexpectedForceViolation++;
            }
        }
    }

    let proceduralFalseReady = 0;
    let proceduralTerrainReady = 0;
    for (let seed = 0; seed < proceduralSeeds; seed++) {
        const observations = proceduralObservations(seed);
        const ready = variants.map(variant =>
            scoreVariant(variant, observations))
            .filter(candidate => candidate.ready);
        proceduralTerrainReady += ready.length > 0 ? 1 : 0;
        proceduralFalseReady += ready.some(candidate =>
            candidate.variant.template.metadata.matchPolicy
                .revealDisabled !== true) ? 1 : 0;
    }

    totalCases += cases;
    totalNormalReady += normalReady;
    totalForceSingletonMismatch += forceSingletonMismatch;
    totalForceUnionViolation += forceUnionViolation;
    totalForceOutside += forceOutside;
    totalUnsafeForce += unsafeForce;
    totalForceIdentityMiss += forceIdentityMiss;
    totalProceduralCases += proceduralSeeds;
    totalProceduralFalseReady += proceduralFalseReady;
    report[branch] = {
        raw: coverage.raw,
        runtime: coverage.runtime,
        selected: coverage.selected,
        forceEnabled: spec.force,
        forceBlocked: spec.raw - spec.force,
        transforms: variants.length,
        cases,
        normalReady,
        foreignReadyCases,
        forceCases,
        forceIdentityMiss,
        forcePredictionCells,
        forceSingletonMismatch,
        forceUnionViolation,
        forceUnionViolationCases,
        forceOutside,
        forceOutsideCases,
        forceUnverified,
        unsafeForce,
        proceduralCases: proceduralSeeds,
        proceduralTerrainReady,
        proceduralFalseReady
    };
}

assert.ok(totalCases >= 1500, `only ${totalCases} cases`);
assert.equal(totalNormalReady, 0);
assert.equal(totalUnsafeForce, 0);
assert.equal(totalForceIdentityMiss, 0, JSON.stringify(report));
assert.equal(totalUnexpectedForceViolation, 0, JSON.stringify(report));
assert.equal(totalProceduralFalseReady, 0, JSON.stringify(report));

console.log(JSON.stringify({
    sourceRoot: SOURCE_ROOT,
    dropoutPercent: dropouts,
    totalCases,
    totalNormalReady,
    totalForceSingletonMismatch,
    totalForceUnionViolation,
    totalForceOutside,
    totalUnsafeForce,
    totalForceIdentityMiss,
    totalUnexpectedForceViolation,
    totalProceduralCases,
    totalProceduralFalseReady,
    branches: report,
    limitation: 'fixed-alignment oracle; exhaustive arbitrary-translation performance is benchmarked separately'
}, null, 2));
