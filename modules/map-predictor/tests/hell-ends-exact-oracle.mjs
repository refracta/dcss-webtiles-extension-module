import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
    naturalBranchEndPrimaries,
    summarizeBranchEndCoverage
} from '../branch-end-destinations.js';
import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import MapMatcher, {
    allowedTransforms,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';

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
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const BRANCH_ROOT = 'crawl-ref/source/dat/des/branches';
const BRANCHES = Object.freeze({
    dis: Object.freeze({place: 'Dis', raw: 4, normal: 0}),
    geh: Object.freeze({place: 'Geh', raw: 7, normal: 7}),
    coc: Object.freeze({place: 'Coc', raw: 6, normal: 6}),
    tar: Object.freeze({place: 'Tar', raw: 4, normal: 0})
});

function read(root, relative) {
    const filename = path.join(root, relative.replace(/^crawl-ref\//u, ''));
    if (!fs.existsSync(filename)) {
        throw new Error(`exact Crawl source unavailable: ${filename}`);
    }
    return fs.readFileSync(filename, 'utf8');
}

function sourceHash(source) {
    return crypto.createHash('sha256').update(source).digest('hex');
}

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const start = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(source);
    assert.ok(start, name);
    const offset = start.index + (start[0].startsWith('\n') ? 1 : 0);
    const tail = source.slice(offset + 1);
    const next = /\nNAME:\s*/u.exec(tail);
    return source.slice(offset, next ? offset + 1 + next.index : undefined);
}

function normalizedKinds(cell) {
    return [...new Set((cell?.kinds || [])
        .map(normalizeTerrainKind)
        .filter(Boolean))];
}

function finalGlyphs(cell) {
    return Array.isArray(cell?.possibleGlyphs)
        && cell.possibleGlyphs.length
        ? cell.possibleGlyphs
        : [cell?.glyph];
}

function entryPoints(template) {
    const points = [];
    template.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (finalGlyphs(cell).includes('{')) {
            points.push({x, y});
        }
    }));
    return points;
}

function inspectRevision(revision) {
    const vaultLua = read(revision.root, VAULT_LUA_PATH);
    const dependencies = {[VAULT_LUA_PATH]: vaultLua};
    const families = {};
    const sources = {};

    for (const [branch, spec] of Object.entries(BRANCHES)) {
        const sourcePath = `${BRANCH_ROOT}/${branch}.des`;
        const source = read(revision.root, sourcePath);
        sources[branch] = source;
        const options = {path: sourcePath, dependencies};
        const parsed = parseDes(source, options);
        const runtime = parseRuntimeDes(source, options);
        const selected = selectSafeTemplates(
            runtime,
            {place: spec.place, depth: 7},
            {levelEntry: {x: 0, y: 0}}
        );
        const coverage = summarizeBranchEndCoverage({
            parsed,
            runtime,
            selected,
            path: sourcePath
        });
        const normal = selected.filter(template =>
            template.metadata?.matchPolicy?.revealDisabled !== true);

        assert.equal(naturalBranchEndPrimaries(parsed, sourcePath).length,
            spec.raw, `${revision.name}/${branch} raw inventory`);
        assert.equal(coverage.raw, spec.raw, branch);
        assert.equal(coverage.runtime, spec.raw, branch);
        assert.equal(coverage.selected, spec.raw, branch);
        assert.deepEqual(coverage.missingNames, [], branch);
        assert.equal(normal.length, spec.normal,
            `${revision.name}/${branch} normal subset`);

        for (const template of selected.filter(candidate =>
            candidate.metadata?.entryAnchorGlyph === '{')) {
            assert.equal(template.metadata.entryAnchorObservedKind, 'portal',
                `${branch}/${template.name} live entry kind`);
            assert.ok(entryPoints(template).length > 0,
                `${branch}/${template.name} has no possible { anchor`);
            assert.equal(template.metadata.matchAnchor?.requireObservedKind,
                'portal', `${branch}/${template.name} selected anchor kind`);
            for (const transform of allowedTransforms(template)) {
                assert.ok(entryPoints(transformTemplate(template, transform)).length,
                    `${branch}/${template.name}/${transform.id} lost anchor`);
            }
        }

        const rawByName = new Map(parsed.map(template => [
            template.name,
            template
        ]));
        for (const template of normal) {
            const raw = rawByName.get(template.name);
            assert.ok(raw, template.name);
            template.grid.forEach((row, y) => row.forEach((cell, x) => {
                const kinds = normalizedKinds(cell);
                if (kinds.length !== 1) {
                    return;
                }
                const original = raw.grid[y]?.[x];
                if (original == null) {
                    assert.equal(kinds[0], 'wall',
                        `${template.name}/${x},${y} non-wall blank fill`);
                    return;
                }
                const originalKinds = normalizedKinds(original);
                const coveSlot = template.name === 'coc_grunt_cove'
                    && 'ABCEF'.includes(original.glyph);
                assert.ok(coveSlot && kinds[0] === 'floor'
                    || originalKinds.includes(kinds[0]),
                `${template.name}/${x},${y} singleton escaped source union`);
            }));
        }

        families[branch] = {sourcePath, source, parsed, runtime, selected, normal};
    }

    const disCity = families.dis.parsed.find(template =>
        template.name === 'iron_city_of_dis');
    assert.equal(disCity.metadata.encompass, false);
    assert.match(mapBlock(sources.dis, 'iron_city_of_dis'),
        /SUBVAULT:\s*A\s*:\s*dis_castle/u);
    assert.equal(families.dis.normal.length, 0);

    const cove = families.coc.selected.find(template =>
        template.name === 'coc_grunt_cove');
    assert.equal(cove.metadata.sourceAudit,
        'hell-end-coc-cove-static-terrain-v1');
    const coveSlots = cove.grid.flat().filter(cell =>
        'ABCEF'.includes(cell?.glyph || ''));
    assert.equal(coveSlots.length, 60);
    assert.ok(coveSlots.every(cell =>
        normalizedKinds(cell).join('|') === 'floor'));
    for (const name of [
        'coc_grunt_cove_antaeus',
        'coc_grunt_cove_fiend'
    ]) {
        const child = families.coc.parsed.find(template =>
            template.name === name);
        const cells = child.grid.flat().filter(Boolean);
        assert.equal(cells.length, 12, name);
        assert.ok(cells.every(cell =>
            normalizedKinds(cell).join('|') === 'floor'), name);
    }

    assert.match(mapBlock(sources.tar, 'tar_mu'),
        /SUBVAULT:\s*=\s*:\s*tar_mu_maze/u);
    const generatedTar = mapBlock(sources.tar, 'tar_grunt');
    assert.match(generatedTar, /extend_map\s*\{/u);
    assert.match(generatedTar, /tar_setup\s*\(\s*_G\s*\)/u);
    assert.match(generatedTar, /dgn\.place_maps\s*\{/u);
    assert.doesNotMatch(generatedTar, /^MAP\s*$/mu);
    assert.equal(families.tar.normal.length, 0);

    return {dependencies, families, hashes: Object.fromEntries(
        Object.entries(sources).map(([branch, source]) => [
            branch,
            sourceHash(source)
        ]))};
}

function matcherOracle(family, player, seedBase) {
    const anchored = selectSafeTemplates(
        family.runtime,
        player,
        {levelEntry: {x: 0, y: 0}}
    );
    let cases = 0;
    let predictions = 0;
    for (const truth of family.normal) {
        for (const transform of allowedTransforms(truth)) {
            const transformed = transformTemplate(truth, transform);
            const [entry] = entryPoints(transformed);
            assert.ok(entry, `${truth.name}/${transform.id}`);
            const truthKinds = new Map();
            const observations = [];
            transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
                const kinds = normalizedKinds(cell);
                const worldX = x - entry.x;
                const worldY = y - entry.y;
                truthKinds.set(`${worldX},${worldY}`, kinds);
                const hash = Math.abs(
                    Math.imul(x + 19, 73856093)
                    ^ Math.imul(y + 37, 19349663)
                    ^ Math.imul(seedBase + cases + 53, 83492791)
                ) % 100;
                if (kinds.length === 1 && hash >= 45) {
                    observations.push({x: worldX, y: worldY, kind: kinds[0]});
                }
            }));
            const withoutEntry = observations.filter(cell =>
                cell.x !== 0 || cell.y !== 0);
            withoutEntry.push({x: 0, y: 0, kind: 'portal'});
            const matcher = new MapMatcher({worldWidth: 80, worldHeight: 70});
            matcher.setTemplates(anchored);
            const result = matcher.updateObservations(withoutEntry);
            assert.equal(result.ready, true,
                `${truth.name}/${transform.id}: ${result.reason}`);
            assert.equal(result.best.template.name, truth.name,
                `${truth.name}/${transform.id} identity`);
            assert.ok(result.predictions.length >= 20,
                `${truth.name}/${transform.id} no mapping output`);
            for (const prediction of result.predictions) {
                assert.ok(truthKinds.get(`${prediction.x},${prediction.y}`)
                    ?.includes(prediction.kind),
                `${truth.name}/${transform.id} unsafe prediction`);
            }
            predictions += result.predictions.length;
            cases++;
        }
    }
    return {cases, predictions};
}

const reports = REVISIONS.map(revision => ({
    revision,
    inspected: inspectRevision(revision)
}));
assert.deepEqual(reports[0].inspected.hashes, reports[1].inspected.hashes,
    'the two tested revisions no longer share the audited Hell sources');

let transformCases = 0;
let predictionCells = 0;
for (let index = 0; index < reports.length; index++) {
    const {families} = reports[index].inspected;
    for (const [branch, place] of [['geh', 'Geh'], ['coc', 'Coc']]) {
        const result = matcherOracle(
            families[branch],
            {place, depth: 7},
            index * 1000 + (branch === 'coc' ? 500 : 0)
        );
        transformCases += result.cases;
        predictionCells += result.predictions;
    }
}
assert.equal(transformCases, 132);

const baseline = reports[1].inspected;
const cocFamily = baseline.families.coc;
const mutatedCove = cocFamily.source.replace(
    'SUBVAULT: F : coc_grunt_cove_fiend',
    'SUBVAULT: F : coc_grunt_cove_antaeus'
);
assert.notEqual(mutatedCove, cocFamily.source);
const mutatedRuntime = parseRuntimeDes(mutatedCove, {
    path: cocFamily.sourcePath,
    dependencies: baseline.dependencies
});
const mutatedSelected = selectSafeTemplates(
    mutatedRuntime,
    {place: 'Coc', depth: 7},
    {levelEntry: {x: 0, y: 0}}
);
assert.equal(mutatedSelected.length, 6);
assert.ok(mutatedSelected.every(template =>
    template.metadata.matchPolicy.revealDisabled === true));
assert.equal(mutatedSelected.find(template =>
    template.name === 'coc_grunt_cove').metadata.sourceAudit,
'branch-end-detection-only-v1');

const gehFamily = baseline.families.geh;
const addedGehPrimary = `${gehFamily.source}\n
NAME: future_geh_end
ORIENT: encompass
: serpent_of_hell_setup(_G)
: geh_setup(_G)
MAP
xxxx
x{.x
xxxx
ENDMAP
`;
const addedGehSelected = selectSafeTemplates(parseRuntimeDes(
    addedGehPrimary,
    {
        path: gehFamily.sourcePath,
        dependencies: baseline.dependencies
    }
), {place: 'Geh', depth: 7}, {levelEntry: {x: 0, y: 0}});
assert.equal(addedGehSelected.filter(template =>
    template.metadata?.matchPolicy?.revealDisabled !== true).length, 0);

process.stdout.write(`${JSON.stringify({
    revisions: reports.map(({revision, inspected}) => ({
        name: revision.name,
        sha: revision.sha,
        hashes: inspected.hashes,
        normal: Object.fromEntries(Object.entries(inspected.families)
            .map(([branch, family]) => [
                branch,
                family.normal.map(template => template.name)
            ]))
    })),
    exactTransformCases: transformCases,
    predictionCells,
    unsafePredictionCells: 0,
    liveEntryAnchorKind: 'portal',
    mutationFailClosed: {
        cocCoveGeometry: true,
        gehPrimaryInventory: true
    },
    dynamicNormalBlocked: ['iron_city_of_dis', 'tar_mu', 'tar_grunt']
}, null, 2)}\n`);
