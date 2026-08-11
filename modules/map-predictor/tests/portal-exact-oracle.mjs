#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {
    PORTAL_DESTINATION_SPECS,
    portalDestinationCoverage
} from '../portal-destinations.js';
import {
    MapMatcher,
    allowedTransforms,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';

const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const FAMILIES = Object.keys(PORTAL_DESTINATION_SPECS);
const REVEAL_FAMILIES = new Set([
    'arena',
    'sewer',
    'ossuary',
    'bailey',
    'bazaar',
    'icecave',
    'volcano'
]);
const FORCE_ONLY_FAMILIES = new Set([
    'desolation',
    'trove'
]);
const ORACLE_FAMILIES = new Set([
    ...REVEAL_FAMILIES,
    ...FORCE_ONLY_FAMILIES
]);
const NAMELESS_INFERNALISTS =
    'regret_index_trove_nameless_infernalists';
const PLACE_BY_FAMILY = Object.freeze({
    arena: 'Arena',
    desolation: 'Desolation',
    trove: 'Trove',
    sewer: 'Sewer',
    ossuary: 'Ossuary',
    bailey: 'Bailey',
    bazaar: 'Bazaar',
    icecave: 'IceCv',
    volcano: 'Volcano'
});
const OBSERVABLE_KINDS = new Set([
    'floor',
    'wall',
    'door',
    'shallow_water',
    'deep_water',
    'lava',
    'stairs',
    'portal',
    'altar',
    'statue'
]);

function option(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const sourceDirectory = option('--source-dir', null);
const iterations = Number(option('--iterations', '20'));
const fuzzCasesPerFamily = Number(option('--fuzz-cases', '0'));
const seed = Number(option('--seed', '1597463007')) >>> 0;
const requestedFamilies = new Set(String(option(
    '--families',
    [...ORACLE_FAMILIES].join(',')
)).split(',').map(value => value.trim()).filter(Boolean));
const testedFamilies = [...ORACLE_FAMILIES].filter(family =>
    requestedFamilies.has(family));

if (!sourceDirectory
    || !Number.isInteger(iterations)
    || iterations < 1
    || !Number.isInteger(fuzzCasesPerFamily)
    || fuzzCasesPerFamily < 0
    || !testedFamilies.length) {
    throw new Error(
        'Usage: portal-exact-oracle.mjs --source-dir <portal-dir> '
        + '[--iterations 20] [--fuzz-cases 1000] '
        + '[--families sewer,ossuary] [--seed 123]'
    );
}

let randomState = seed;
function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
}

function randomInt(maximum) {
    return Math.floor(random() * maximum);
}

function singletonKind(cell) {
    // Matcher safety is based on a singleton coarse terrain set. `certain`
    // additionally tracks exact glyph certainty, so a floor-vs-floor SUBST
    // may correctly remain predictable while certain is false.
    if (!Array.isArray(cell?.kinds)) {
        return null;
    }
    const kinds = [...new Set(cell.kinds
        .map(normalizeTerrainKind)
        .filter(Boolean))];
    return kinds.length === 1 ? kinds[0] : null;
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
    const remainder = String(source).slice(start + 1);
    const next = /\nNAME:\s*/u.exec(remainder);
    return String(source).slice(
        start,
        next ? start + 1 + next.index : undefined
    );
}

function namelessInfernalistsFillOracle(source, runtime) {
    const target = runtime.find(template =>
        template.name === NAMELESS_INFERNALISTS);
    const block = mapBlock(source, NAMELESS_INFERNALISTS);
    const rowsMatch = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    const rows = rowsMatch ? rowsMatch[1].split('\n') : [];
    if (!target || !rows.length || rows.length !== target.height) {
        return [{
            target: NAMELESS_INFERNALISTS,
            reason: !target ? 'missing-runtime-template' : 'invalid-map-rows'
        }];
    }

    const gaps = [];
    for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < target.width; x++) {
            if (x >= rows[y].length || rows[y][x] === ' ') {
                gaps.push({x, y});
            }
        }
    }
    const failures = gaps.filter(({x, y}) =>
        singletonKind(target.grid[y]?.[x]) !== 'wall');
    return gaps.length > 0 && failures.length === 0
        ? []
        : [{
            target: NAMELESS_INFERNALISTS,
            reason: gaps.length ? 'gap-is-not-wall' : 'no-gap-cells',
            gapCount: gaps.length,
            failureCount: failures.length,
            examples: failures.slice(0, 8)
        }];
}

function entryGlyphs(template) {
    return new Set([
        ...(typeof template.metadata?.entryAnchorGlyph === 'string'
            ? [template.metadata.entryAnchorGlyph]
            : []),
        ...(Array.isArray(template.metadata?.entryAnchorGlyphs)
            ? template.metadata.entryAnchorGlyphs
            : [])
    ]);
}

function cellHasEntryGlyph(cell, glyphs) {
    const finalGlyphs = Array.isArray(cell?.possibleGlyphs)
        ? cell.possibleGlyphs
        : [cell?.glyph];
    return finalGlyphs.some(glyph => glyphs.has(glyph));
}

function transformedTruth(template, transform, offsetX, offsetY) {
    const transformed = transformTemplate(template, transform);
    const truth = new Map();
    const possibleKinds = new Map();
    const cellDetails = new Map();
    const observations = [];
    const anchors = [];
    const glyphs = entryGlyphs(template);
    for (let y = 0; y < transformed.height; y++) {
        for (let x = 0; x < transformed.width; x++) {
            const cell = transformed.grid[y]?.[x];
            const kind = singletonKind(cell);
            const world = {x: x + offsetX, y: y + offsetY};
            const key = `${world.x},${world.y}`;
            const kinds = [...new Set((cell?.kinds || [])
                .map(normalizeTerrainKind)
                .filter(Boolean))];
            possibleKinds.set(key, kinds);
            cellDetails.set(key, {
                glyph: cell?.glyph ?? null,
                possibleGlyphs: [...(cell?.possibleGlyphs || [])],
                certain: cell?.certain === true,
                kinds
            });
            if (kind) {
                truth.set(key, kind);
                if (OBSERVABLE_KINDS.has(kind)) {
                    observations.push({...world, kind});
                }
            }
            if (cellHasEntryGlyph(cell, glyphs)) {
                anchors.push(world);
            }
        }
    }
    return {truth, possibleKinds, cellDetails, observations, anchors};
}

function sampledObservations(all, rate, noiseRate, anchor) {
    const result = all.filter(() => random() < rate);
    const keyed = new Map(result.map(cell => [`${cell.x},${cell.y}`, cell]));
    const anchorObservation = all.find(cell =>
        cell.x === anchor.x && cell.y === anchor.y);
    if (anchorObservation) {
        keyed.set(`${anchor.x},${anchor.y}`, anchorObservation);
    }
    const observations = [...keyed.values()].map(cell => ({...cell}));
    const noiseKinds = ['floor', 'wall', 'door', 'lava', 'portal'];
    for (const cell of observations) {
        // The destination entrance is supplied by the Webtiles transition
        // event, not inferred from a potentially stale terrain observation.
        // Portal destinations replace the source portal with a stone arch,
        // which Webtiles reports as coarse floor; keep it out of noise.
        if (cell.x === anchor.x && cell.y === anchor.y) {
            cell.kind = 'floor';
            continue;
        }
        if (random() >= noiseRate) {
            continue;
        }
        const alternatives = noiseKinds.filter(kind => kind !== cell.kind);
        cell.kind = alternatives[randomInt(alternatives.length)];
    }
    return observations;
}

function predictionMismatches(predictions, groundTruth) {
    return predictions.flatMap(cell => {
        const key = `${cell.x},${cell.y}`;
        const truthKind = groundTruth.truth.get(key) || null;
        if (truthKind === cell.kind) {
            return [];
        }
        const targetKinds = groundTruth.possibleKinds.get(key) || [];
        return [{
            ...cell,
            truthKind,
            targetKinds,
            unionContainsPrediction: targetKinds.length === 0
                || targetKinds.includes(cell.kind),
            targetCell: groundTruth.cellDetails.get(key) || null
        }];
    });
}

function runMatchCase(family, matcher, target, transform, rate, noiseRate) {
    const localTruth = transformedTruth(target, transform, 0, 0);
    if (!localTruth.anchors.length) {
        throw new Error(`${target.name}/${transform.id} has no entry anchor`);
    }
    const chosenAnchor = localTruth.anchors[randomInt(localTruth.anchors.length)];
    // Webtiles coordinates are relative to the level transition, so pin the
    // actual entrance at (0,0). This removes a redundant random translation
    // dimension and lets thousands of cases reuse one prepared matcher.
    const offsetX = -chosenAnchor.x;
    const offsetY = -chosenAnchor.y;
    const groundTruth = transformedTruth(
        target,
        transform,
        offsetX,
        offsetY
    );
    const levelEntry = {x: 0, y: 0};
    const entryKey = `${levelEntry.x},${levelEntry.y}`;
    groundTruth.truth.set(entryKey, 'floor');
    const existingEntry = groundTruth.observations.find(cell =>
        cell.x === levelEntry.x && cell.y === levelEntry.y);
    if (existingEntry) {
        existingEntry.kind = 'floor';
    } else {
        groundTruth.observations.push({...levelEntry, kind: 'floor'});
    }
    const truthUnionViolations = [...groundTruth.truth].flatMap(([key, kind]) => {
        const kinds = groundTruth.possibleKinds.get(key) || [];
        return kinds.length === 0 || kinds.includes(kind)
            ? []
            : [{key, kind, kinds, cell: groundTruth.cellDetails.get(key) || null}];
    });
    const observations = sampledObservations(
        groundTruth.observations,
        rate,
        noiseRate,
        levelEntry
    );
    matcher.reset();
    const result = matcher.updateObservations(observations);
    const bestMatchesTarget = result.best?.template?.name === target.name
        && result.best?.transform === transform.id
        && result.best?.offsetX === offsetX
        && result.best?.offsetY === offsetY;
    return {
        result,
        offsetX,
        offsetY,
        observationRate: rate,
        noiseRate,
        observationCount: observations.length,
        bestMatchesTarget,
        truthUnionViolations,
        acceptedPredictions: result.ready ? result.predictions : [],
        safeMismatches: predictionMismatches(
            result.ready ? result.predictions : [],
            groundTruth
        ),
        forceMismatches: predictionMismatches(
            result.forcePredictions,
            groundTruth
        )
    };
}

const vaultLuaPath = path.join(sourceDirectory, 'vault.lua');
const dependencies = fs.existsSync(vaultLuaPath)
    ? {[VAULT_LUA_PATH]: fs.readFileSync(vaultLuaPath, 'utf8')}
    : {};
const groups = new Map();
const matrix = [];
let unsupportedPolicyViolations = 0;
const exactEncompassFillViolations = [];

for (const family of FAMILIES) {
    const sourcePath = path.join(sourceDirectory, `${family}.des`);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Missing exact source: ${sourcePath}`);
    }
    const source = fs.readFileSync(sourcePath, 'utf8');
    const repositoryPath = `crawl-ref/source/dat/des/portals/${family}.des`;
    const options = {path: repositoryPath, dependencies};
    const parsed = parseDes(source, options);
    const runtime = parseRuntimeDes(source, options);
    if (family === 'trove') {
        exactEncompassFillViolations.push(
            ...namelessInfernalistsFillOracle(source, runtime)
        );
    }
    const selected = selectSafeTemplates(
        runtime,
        {place: PLACE_BY_FAMILY[family] || family, depth: 1},
        {levelEntry: {x: 0, y: 0}}
    );
    const coverage = portalDestinationCoverage(
        source,
        {...options, parsed},
        runtime,
        selected
    );
    matrix.push(coverage);
    groups.set(family, {runtime, selected});

    unsupportedPolicyViolations += runtime.filter(template => {
        const policy = template.metadata?.matchPolicy;
        if (policy?.revealDisabled !== true
            || policy?.forceRevealDisabled === true) {
            return false;
        }
        return !FORCE_ONLY_FAMILIES.has(family)
            || template.metadata?.sourceAudit
                !== `portal-${family}-known-shell-force-v1`;
    }).length;
    if (!ORACLE_FAMILIES.has(family) && family !== 'wizlab') {
        unsupportedPolicyViolations += runtime.filter(template =>
            template.metadata?.matchPolicy?.revealDisabled !== true
            || template.metadata?.matchPolicy?.forceRevealDisabled !== true)
            .length;
    }
}

let cases = 0;
let readyCases = 0;
let safePredictionCells = 0;
let safePredictionMismatches = 0;
let forcePredictionCells = 0;
let forcePredictionMismatches = 0;
let forceWrongBestMismatches = 0;
let forceSameBestMismatches = 0;
let forceUnionViolationMismatches = 0;
let forceAmbiguousContainedMismatches = 0;
let truthUnionViolations = 0;
const mismatchExamples = [];
const forceMismatchExamples = [];
const familyResults = {};

function recordOutcome(family, stats, target, transform, outcome, caseKind) {
    cases++;
    stats[caseKind]++;
    readyCases += outcome.result.ready ? 1 : 0;
    stats.readyCases += outcome.result.ready ? 1 : 0;
    safePredictionCells += outcome.acceptedPredictions.length;
    stats.safePredictionCells += outcome.acceptedPredictions.length;
    safePredictionMismatches += outcome.safeMismatches.length;
    stats.safePredictionMismatches += outcome.safeMismatches.length;
    stats[`${caseKind}SafePredictionMismatches`]
        += outcome.safeMismatches.length;
    forcePredictionCells += outcome.result.forcePredictions.length;
    stats.forcePredictionCells += outcome.result.forcePredictions.length;
    forcePredictionMismatches += outcome.forceMismatches.length;
    stats.forcePredictionMismatches += outcome.forceMismatches.length;
    stats[`${caseKind}ForcePredictionMismatches`]
        += outcome.forceMismatches.length;
    truthUnionViolations += outcome.truthUnionViolations.length;
    stats.truthUnionViolations += outcome.truthUnionViolations.length;

    const unionViolations = outcome.forceMismatches.filter(cell =>
        !cell.unionContainsPrediction).length;
    const contained = outcome.forceMismatches.length - unionViolations;
    forceUnionViolationMismatches += unionViolations;
    forceAmbiguousContainedMismatches += contained;
    stats.forceUnionViolationMismatches += unionViolations;
    stats.forceAmbiguousContainedMismatches += contained;
    if (outcome.bestMatchesTarget) {
        forceSameBestMismatches += outcome.forceMismatches.length;
        stats.forceSameBestMismatches += outcome.forceMismatches.length;
    } else {
        forceWrongBestMismatches += outcome.forceMismatches.length;
        stats.forceWrongBestMismatches += outcome.forceMismatches.length;
    }

    const common = {
        family,
        target: target.name,
        transform: transform.id,
        reason: outcome.result.reason,
        best: outcome.result.best?.template?.name || null,
        bestTransform: outcome.result.best?.transform || null,
        bestMatchesTarget: outcome.bestMatchesTarget,
        targetOffset: [outcome.offsetX, outcome.offsetY],
        bestOffset: [
            outcome.result.best?.offsetX,
            outcome.result.best?.offsetY
        ],
        score: outcome.result.best?.score || null,
        margin: outcome.result.margin ?? null,
        evidenceCells: outcome.result.best?.evidenceCells ?? null,
        evidenceWeight: outcome.result.best?.evidenceWeight ?? null,
        distinctKinds: outcome.result.best?.distinctKinds ?? null,
        coverage: outcome.result.best?.coverage ?? null,
        spanXRatio: outcome.result.best?.spanXRatio ?? null,
        spanYRatio: outcome.result.best?.spanYRatio ?? null,
        plausibleCandidateCount:
            outcome.result.plausibleCandidateCount ?? null,
        observationRate: outcome.observationRate,
        noiseRate: outcome.noiseRate
    };
    if (outcome.safeMismatches.length && mismatchExamples.length < 12) {
        mismatchExamples.push({
            ...common,
            count: outcome.safeMismatches.length,
            cells: outcome.safeMismatches.slice(0, 4)
        });
    }
    if (outcome.forceMismatches.length && forceMismatchExamples.length < 12) {
        forceMismatchExamples.push({
            ...common,
            unionViolations,
            ambiguousContained: contained,
            count: outcome.forceMismatches.length,
            cells: outcome.forceMismatches.slice(0, 4)
        });
    }
}

for (const family of testedFamilies) {
    const {runtime: templates, selected} = groups.get(family);
    const targets = templates.filter(template =>
        template.metadata?.matchPolicy?.forceRevealDisabled !== true);
    const matcher = new MapMatcher({
        worldWidth: 80,
        worldHeight: 70,
        minScore: 0.965,
        minEvidenceCells: 18,
        minEvidenceWeight: 22,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        requireExhaustivePlacement: true,
        maxConsensusCandidates: 64
    });
    matcher.setTemplates(selected);
    const stats = {
        templates: targets.length,
        normalRevealTemplates: targets.filter(template =>
            template.metadata?.matchPolicy?.revealDisabled !== true).length,
        forceOnlyTemplates: targets.filter(template =>
            template.metadata?.matchPolicy?.revealDisabled === true).length,
        totalCandidates: templates.length,
        detectionOnlyCandidates: templates.length - targets.length,
        transformCases: 0,
        fuzzCases: 0,
        transformCasesSafePredictionMismatches: 0,
        fuzzCasesSafePredictionMismatches: 0,
        transformCasesForcePredictionMismatches: 0,
        fuzzCasesForcePredictionMismatches: 0,
        readyCases: 0,
        safePredictionCells: 0,
        safePredictionMismatches: 0,
        forcePredictionCells: 0,
        forcePredictionMismatches: 0,
        forceWrongBestMismatches: 0,
        forceSameBestMismatches: 0,
        forceUnionViolationMismatches: 0,
        forceAmbiguousContainedMismatches: 0,
        truthUnionViolations: 0
    };
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const target = targets[targetIndex];
        const transforms = allowedTransforms(target);
        for (const transform of transforms) {
            const outcome = runMatchCase(
                family,
                matcher,
                target,
                transform,
                0.55,
                0
            );
            recordOutcome(
                family,
                stats,
                target,
                transform,
                outcome,
                'transformCases'
            );
        }
        const targetFuzzCases = fuzzCasesPerFamily
            ? Math.floor(fuzzCasesPerFamily / targets.length)
                + (targetIndex < fuzzCasesPerFamily % targets.length ? 1 : 0)
            : iterations;
        for (let index = 0; index < targetFuzzCases; index++) {
            const transforms = allowedTransforms(target);
            const transform = transforms[randomInt(transforms.length)];
            const rate = 0.25 + random() * 0.55;
            const noiseRate = random() < 0.4 ? random() * 0.004 : 0;
            const outcome = runMatchCase(
                family,
                matcher,
                target,
                transform,
                rate,
                noiseRate
            );
            recordOutcome(
                family,
                stats,
                target,
                transform,
                outcome,
                'fuzzCases'
            );
        }
    }
    familyResults[family] = stats;
}

const result = {
    seed,
    iterationsPerTemplate: iterations,
    fuzzCasesPerFamily,
    testedFamilies,
    matrix,
    coverageComplete: matrix.every(item => item.complete),
    unsupportedPolicyViolations,
    exactEncompassFillViolations,
    cases,
    readyCases,
    safePredictionCells,
    safePredictionMismatches,
    forcePredictionCells,
    forcePredictionMismatches,
    forceWrongBestMismatches,
    forceSameBestMismatches,
    forceUnionViolationMismatches,
    forceAmbiguousContainedMismatches,
    truthUnionViolations,
    mismatchExamples,
    forceMismatchExamples,
    families: familyResults
};

console.log(JSON.stringify(result, null, 2));

if (!result.coverageComplete
    || unsupportedPolicyViolations > 0
    || exactEncompassFillViolations.length > 0
    || truthUnionViolations > 0
    || safePredictionMismatches > 0) {
    process.exitCode = 1;
}
