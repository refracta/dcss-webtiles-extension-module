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
    || process.env.DWEM_CRAWL_SOURCE_ROOT
    || '/tmp/dwem-crawl-1b83';
const BRANCH_ROOT = 'crawl-ref/source/dat/des/branches';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const TARGETS = Object.freeze({
    depths: Object.freeze({
        player: Object.freeze({place: 'Dungeon', depth: 15}),
        raw: 9,
        added: 9,
        force: 9
    }),
    depths_encompass: Object.freeze({
        player: Object.freeze({place: 'Depths', depth: 4}),
        raw: 2,
        added: 2,
        force: 0
    }),
    shoals: Object.freeze({
        player: Object.freeze({place: 'Shoals', depth: 4}),
        raw: 3,
        added: 1,
        force: 0
    }),
    coc: Object.freeze({
        player: Object.freeze({place: 'Coc', depth: 7}),
        raw: 6,
        // coc_grunt_cove is now a dedicated, source-audited static-terrain
        // candidate rather than a generic branch-end gap placeholder.
        added: 0,
        force: 0
    }),
    dis: Object.freeze({
        player: Object.freeze({place: 'Dis', depth: 7}),
        raw: 4,
        added: 1,
        force: 0
    }),
    tar: Object.freeze({
        player: Object.freeze({place: 'Tar', depth: 7}),
        raw: 4,
        added: 1,
        force: 0
    })
});

function readSource(relative) {
    const filename = path.join(SOURCE_ROOT, relative);
    if (!fs.existsSync(filename)) {
        throw new Error(`source is unavailable: ${filename}`);
    }
    return fs.readFileSync(filename, 'utf8');
}

function replaceExactly(source, before, after) {
    const first = source.indexOf(before);
    assert.notEqual(first, -1, before);
    assert.equal(source.indexOf(before, first + before.length), -1, before);
    return source.slice(0, first) + after
        + source.slice(first + before.length);
}

const vaultLua = readSource(VAULT_LUA_PATH);
const dependencies = {[VAULT_LUA_PATH]: vaultLua};

function inspect(branch, spec, {
    source = readSource(`${BRANCH_ROOT}/${branch}.des`),
    dependency = vaultLua
} = {}) {
    const sourcePath = `${BRANCH_ROOT}/${branch}.des`;
    const options = {
        path: sourcePath,
        dependencies: {[VAULT_LUA_PATH]: dependency}
    };
    const parsed = parseDes(source, options);
    const raw = naturalBranchEndPrimaries(parsed, sourcePath);
    const runtime = parseRuntimeDes(source, options);
    const selected = selectSafeTemplates(runtime, spec.player);
    const coverage = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path: sourcePath
    });
    const rawNames = new Set(raw.map(template => template.name));
    const selectedRaw = selected.filter(template =>
        rawNames.has(template.name));
    const added = selectedRaw.filter(template =>
        String(template.metadata?.sourceAudit || '')
            .startsWith('branch-end-'));
    const forceEnabled = added.filter(template =>
        template.metadata.matchPolicy.forceRevealDisabled !== true);

    assert.equal(raw.length, spec.raw, branch);
    assert.equal(coverage.raw, spec.raw, branch);
    assert.equal(coverage.runtime, spec.raw, branch);
    assert.equal(coverage.selected, spec.raw, branch);
    assert.deepEqual(coverage.missingNames, [], branch);
    assert.equal(new Set(runtime.map(template => template.name)).size,
        runtime.length, `${branch} duplicate runtime name`);
    assert.equal(added.length, spec.added, branch);
    assert.equal(forceEnabled.length, spec.force, branch);
    assert.ok(added.every(template =>
        template.metadata.matchPolicy.revealDisabled === true), branch);
    return {coverage, added, forceEnabled};
}

const targetReport = {};
for (const [branch, spec] of Object.entries(TARGETS)) {
    const result = inspect(branch, spec);
    targetReport[branch] = {
        raw: result.coverage.raw,
        runtime: result.coverage.runtime,
        selected: result.coverage.selected,
        added: result.added.length,
        forceEnabled: result.forceEnabled.length,
        forceBlocked: result.added.length - result.forceEnabled.length
    };
}

let rawTotal = 0;
let runtimeTotal = 0;
const missingNames = [];
const branchDirectory = path.join(SOURCE_ROOT, BRANCH_ROOT);
for (const filename of fs.readdirSync(branchDirectory)
    .filter(name => name.endsWith('.des')).sort()) {
    const sourcePath = `${BRANCH_ROOT}/${filename}`;
    const source = readSource(sourcePath);
    const options = {path: sourcePath, dependencies};
    const parsed = parseDes(source, options);
    const raw = naturalBranchEndPrimaries(parsed, sourcePath);
    if (!raw.length) {
        continue;
    }
    const runtime = parseRuntimeDes(source, options);
    const runtimeNames = new Set(runtime.map(template => template.name));
    assert.equal(runtimeNames.size, runtime.length,
        `${filename} duplicate runtime name`);
    rawTotal += raw.length;
    for (const template of raw) {
        if (runtimeNames.has(template.name)) {
            runtimeTotal++;
        } else {
            missingNames.push(`${filename}:${template.name}`);
        }
    }
}
assert.equal(rawTotal, 130);
assert.equal(runtimeTotal, 130);
assert.deepEqual(missingNames, []);

const depthsSource = readSource(`${BRANCH_ROOT}/depths.des`);
const changedDepthsHelper = replaceExactly(
    depthsSource,
    'e.weight("20")',
    'e.weight("21")'
);
const helperDowngrade = inspect('depths', {
    ...TARGETS.depths,
    force: 0
}, {source: changedDepthsHelper});
assert.ok(helperDowngrade.added.every(template =>
    template.metadata.sourceAudit === 'branch-end-detection-only-v1'));

const badGranite = replaceExactly(
    vaultLua,
    'e.kfeat(glyph .. " = granite_statue")',
    'e.kfeat(glyph .. " = lava")'
);
const statueDowngrade = inspect('depths', {
    ...TARGETS.depths,
    force: 8
}, {dependency: badGranite});
assert.equal(statueDowngrade.added.find(template =>
    template.name === 'gammafunk_depths_entry_grave')
    .metadata.sourceAudit, 'branch-end-detection-only-v1');

process.stdout.write(`${JSON.stringify({
    sourceRoot: SOURCE_ROOT,
    total: {raw: rawTotal, runtime: runtimeTotal, missing: 0},
    targets: targetReport,
    mutationRegression: {
        depthsHelperDowngraded: 9,
        graniteStatueDowngraded: 1,
        identityCountInvariant: true,
        normalReady: 0
    }
}, null, 2)}\n`);
