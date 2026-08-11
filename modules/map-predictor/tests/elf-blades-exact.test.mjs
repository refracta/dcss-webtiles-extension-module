import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    auditedElfBladesTemplates
} from '../branch-end-destinations.js';
import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import MapMatcher from '../matcher.js';

const ELF_PATH = 'crawl-ref/source/dat/des/branches/elf.des';
const VAULT_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const EXACT_ROOTS = [
    '/tmp/dwem-crawl-d29',
    '/tmp/dwem-crawl-1b83'
].filter(root => fs.existsSync(`${root}/${ELF_PATH}`)
    && fs.existsSync(`${root}/${VAULT_PATH}`));

function exactArtifacts(root) {
    const source = fs.readFileSync(`${root}/${ELF_PATH}`, 'utf8');
    const vault = fs.readFileSync(`${root}/${VAULT_PATH}`, 'utf8');
    const options = {
        path: ELF_PATH,
        dependencies: {[VAULT_PATH]: vault}
    };
    return {source, vault, options};
}

for (const root of EXACT_ROOTS) {
    test(`exact ${root.split('-').at(-1)} Elf:2 inventory is one closed composite set`, () => {
        const {source, vault, options} = exactArtifacts(root);
        const parsed = parseDes(source, options);
        const runtime = parseRuntimeDes(source, options);
        const selected = selectSafeTemplates(runtime, {
            place: 'Elf',
            depth: 2
        });
        assert.equal(selected.length, 4);
        assert.ok(selected.every(template =>
            template.metadata.sourceAudit
                === 'elf-blades-fixed-composite-v1'));
        assert.ok(selected.every(template =>
            template.metadata.matchPolicy.exhaustivePlacement === true
            && template.metadata.matchPolicy.revealDisabled !== true));
        assert.deepEqual(selected.map(template =>
            template.metadata.composite.slots.length), [1, 1, 0, 1]);
        assert.deepEqual(selected.map(template =>
            template.metadata.composite.variants.length), [19, 19, 0, 19]);

        const matcher = new MapMatcher();
        matcher.setTemplates(selected);
        assert.equal(matcher.preparedTemplates.length, 32);
        const byName = new Map();
        for (const prepared of matcher.preparedTemplates) {
            const variants = byName.get(prepared.template.name) || [];
            variants.push(prepared);
            byName.set(prepared.template.name, variants);
        }
        assert.ok([...byName.values()].every(variants =>
            variants.length === 8));
        for (const variants of byName.values()) {
            const slot = variants[0].composite.slots[0];
            if (!slot) {
                continue;
            }
            assert.equal(slot.variants.length, 38);
        }

        const renamed = source.replace(
            'NAME:   mumra_blade_entry_bloodbath',
            'NAME:   mumra_blade_entry_bloodbath_changed'
        );
        const renamedParsed = parseDes(renamed, options);
        const renamedRuntime = auditedElfBladesTemplates(
            renamed,
            renamedParsed,
            options
        );
        assert.equal(renamedRuntime.length, 4);
        assert.ok(renamedRuntime.every(template =>
            template.metadata.sourceAudit
                === 'elf-blades-detection-only-v1'
            && template.metadata.matchPolicy.forceRevealDisabled === true));

        const helperMutation = vault.replace(
            "e.kfeat(glyph .. ' = decorative_floor')",
            "e.kfeat(glyph .. ' = lava')"
        );
        const helperOptions = {
            ...options,
            dependencies: {[VAULT_PATH]: helperMutation}
        };
        const helperRuntime = auditedElfBladesTemplates(
            source,
            parsed,
            helperOptions
        );
        assert.ok(helperRuntime.every(template =>
            template.metadata.sourceAudit
                === 'elf-blades-detection-only-v1'));
    });
}

test('exact Elf:2 sources are available for the Hall of Blades regression', {
    skip: EXACT_ROOTS.length > 0 ? false : 'exact Crawl checkouts unavailable'
}, () => {
    assert.ok(EXACT_ROOTS.length >= 1);
});
