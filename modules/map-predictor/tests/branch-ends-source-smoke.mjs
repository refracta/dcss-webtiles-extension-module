import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    naturalBranchEndPrimaries,
    summarizeBranchEndCoverage
} from '../branch-end-destinations.js';
import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';

const SOURCE_ROOT = process.argv[2]
    || process.env.DWEM_BRANCH_DES_ROOT
    || '/tmp/dwem-branch-sha-1b83f8de';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const BRANCHES = Object.freeze({
    crypt: Object.freeze({depth: 3, raw: 8, force: 0}),
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

function replaceExactly(source, before, after) {
    const first = source.indexOf(before);
    assert.notEqual(first, -1, before);
    assert.equal(source.indexOf(before, first + before.length), -1, before);
    return source.slice(0, first) + after
        + source.slice(first + before.length);
}

const vaultLua = fs.readFileSync(sourceFile(
    VAULT_LUA_PATH,
    'vault.lua'
), 'utf8');
const sources = new Map(Object.keys(BRANCHES).map(branch => {
    const relative = `crawl-ref/source/dat/des/branches/${branch}.des`;
    return [branch, {
        relative,
        source: fs.readFileSync(sourceFile(relative, `${branch}.des`), 'utf8')
    }];
}));

function inspect(branch, {
    source = sources.get(branch).source,
    dependency = vaultLua
} = {}) {
    const spec = BRANCHES[branch];
    const relative = sources.get(branch).relative;
    const options = {
        path: relative,
        dependencies: {[VAULT_LUA_PATH]: dependency}
    };
    const parsed = parseDes(source, options);
    const runtime = parseRuntimeDes(source, options);
    const selected = selectSafeTemplates(runtime, {
        place: branch,
        depth: spec.depth
    });
    const coverage = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path: relative
    });
    const forceEnabled = selected.filter(template =>
        template.metadata.matchPolicy.forceRevealDisabled !== true);
    assert.equal(naturalBranchEndPrimaries(parsed, relative).length,
        spec.raw, branch);
    assert.equal(coverage.raw, spec.raw, branch);
    assert.equal(coverage.runtime, spec.raw, branch);
    assert.equal(coverage.selected, spec.raw, branch);
    assert.deepEqual(coverage.missingNames, [], branch);
    assert.ok(selected.every(template =>
        template.metadata.matchPolicy.revealDisabled === true), branch);
    return {
        raw: coverage.raw,
        runtime: coverage.runtime,
        selected: coverage.selected,
        forceEnabled: forceEnabled.length,
        forceBlocked: selected.length - forceEnabled.length,
        byName: new Map(selected.map(template => [template.name, template]))
    };
}

const baseline = {};
for (const [branch, spec] of Object.entries(BRANCHES)) {
    const result = inspect(branch);
    assert.equal(result.forceEnabled, spec.force, branch);
    baseline[branch] = {
        raw: result.raw,
        runtime: result.runtime,
        selected: result.selected,
        forceEnabled: result.forceEnabled,
        forceBlocked: result.forceBlocked
    };
}

const badGranite = replaceExactly(
    vaultLua,
    'e.kfeat(glyph .. " = granite_statue")',
    'e.kfeat(glyph .. " = lava")'
);
for (const [branch, name] of [
    ['spider', 'floodkiller_spider_rune_tomb'],
    ['swamp', 'byrel_swamp_growth_death_and_undeath']
]) {
    const result = inspect(branch, {dependency: badGranite});
    assert.equal(result.forceEnabled, BRANCHES[branch].force - 1, branch);
    assert.equal(result.byName.get(name).metadata.sourceAudit,
        'branch-end-detection-only-v1', name);
}

const badMetal = replaceExactly(
    vaultLua,
    'e.kfeat(glyph .. " = metal_statue")',
    'e.kfeat(glyph .. " = lava")'
);
for (const [branch, name] of [
    ['lair', 'evil_forest'],
    ['orc', 'st_orc_town'],
    ['snake', 'grunt_snake_rune_serpentine_throne']
]) {
    const result = inspect(branch, {dependency: badMetal});
    assert.equal(result.forceEnabled, BRANCHES[branch].force - 1, branch);
    assert.equal(result.byName.get(name).metadata.sourceAudit,
        'branch-end-detection-only-v1', name);
}

const badCloud = replaceExactly(
    vaultLua,
    '"size = 1, "',
    '"size = 2, "'
);
for (const [branch, name] of [
    ['orc', 'grunt_orc_tribal_feast'],
    ['swamp', 'nzn_swamp_witches_coven']
]) {
    const result = inspect(branch, {dependency: badCloud});
    assert.equal(result.forceEnabled, BRANCHES[branch].force - 1, branch);
    assert.equal(result.byName.get(name).metadata.sourceAudit,
        'branch-end-detection-only-v1', name);
}

const changedLairHelper = replaceExactly(
    sources.get('lair').source,
    'e.weight(5)',
    'e.weight(6)'
);
const lairDowngrade = inspect('lair', {source: changedLairHelper});
assert.equal(lairDowngrade.forceEnabled, BRANCHES.lair.force - 5);
for (const name of [
    'wormcave',
    'hangedman_lair_caniforms_friends',
    'guppyfry_lair_end_dragon',
    'hangedman_lair_in_review',
    'hangedman_lair_tendril_chambers'
]) {
    assert.equal(lairDowngrade.byName.get(name).metadata.sourceAudit,
        'branch-end-detection-only-v1', name);
}

process.stdout.write(`${JSON.stringify({
    sourceRoot: SOURCE_ROOT,
    baseline,
    auditDowngradeSmoke: {
        graniteHelper: 2,
        metalHelper: 3,
        singleCloudHelper: 2,
        lairSmallEndingCandidates: 5,
        candidateCountInvariant: true,
        normalRevealReady: 0
    }
}, null, 2)}\n`);
