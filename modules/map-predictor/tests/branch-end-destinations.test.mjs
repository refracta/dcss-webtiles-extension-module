import assert from 'node:assert/strict';
import test from 'node:test';

import {
    branchEndDetectionTemplates,
    naturalBranchEndPrimaries,
    summarizeBranchEndCoverage
} from '../branch-end-destinations.js';
import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {MapMatcher, normalizeTerrainKind} from '../matcher.js';

const ELF_PATH = 'crawl-ref/source/dat/des/branches/elf.des';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';

function elfFixture() {
    return String.raw`
{{
function elf_setup(e)
  e.tags("no_rotate")
end

function elf_monsters(e)
  e.mons("one")
  e.mons("two")
  e.mons("three")
  e.mons("four")
  e.mons("five")
  e.mons("six")
  e.mons("seven")
end

function elf_loot_defenders(e)
  e.kmons("$ = one")
  e.kmons("* = two")
  e.kmons("| = three")
end

function elf_loot_randomisation(e)
  e.kitem("$ = $")
  e.kitem("* = *")
  e.kitem("| = |")
  e.kitem("R = gold")
  e.subst("| = | *:2")
  e.nsubst("$ = 1:R / *:$")
  e.subst("$ = $:20 *:4 |:1")
  e.subst("* = * |:3")
  e.nsubst("* = 2:$ / *:*")
end
}}

NAME: elf_fixture_alpha
PLACE: Elf:$
ORIENT: northwest
: elf_setup(_G)
: elf_monsters(_G)
: elf_loot_defenders(_G)
: elf_loot_randomisation(_G)
MAP
xxxxxxxx
x$|*...x
x..+...@
xxxxxxxx
ENDMAP

NAME: elf_fixture_beta
PLACE: Elf:$
ORIENT: float
: elf_setup(_G)
: elf_monsters(_G)
KITEM: $ = $
SUBST: $ = $ *:1
MAP
xxxxxxxx
x......x
x.$.w..x
xxxxxxxx
ENDMAP

NAME: elf_fixture_gamma
PLACE: Elf:$
ORIENT: south
: elf_setup(_G)
: elf_monsters(_G)
: elf_loot_defenders(_G)
: elf_loot_randomisation(_G)
MAP
xxxxxxxx
x|..*..x
x..W...x
xxxx@xxx
ENDMAP
`;
}

test('Elf end loader keeps every natural primary in one terrain-only set', () => {
    const source = elfFixture();
    const parsed = parseDes(source, {path: ELF_PATH});
    const runtime = parseRuntimeDes(source, {path: ELF_PATH});
    const selected = selectSafeTemplates(runtime, {place: 'Elf', depth: 3});
    const row = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path: ELF_PATH
    });

    assert.deepEqual(row, {
        path: ELF_PATH,
        place: 'Elf:$',
        raw: 3,
        runtime: 3,
        selected: 3,
        revealable: 0,
        detectionOnly: 3,
        placementVerified: 0,
        placementUnverified: 0,
        rawNames: [
            'elf_fixture_alpha',
            'elf_fixture_beta',
            'elf_fixture_gamma'
        ],
        runtimeNames: [
            'elf_fixture_alpha',
            'elf_fixture_beta',
            'elf_fixture_gamma'
        ],
        selectedNames: [
            'elf_fixture_alpha',
            'elf_fixture_beta',
            'elf_fixture_gamma'
        ],
        revealableNames: [],
        detectionOnlyNames: [
            'elf_fixture_alpha',
            'elf_fixture_beta',
            'elf_fixture_gamma'
        ],
        placementVerifiedNames: [],
        placementUnverifiedNames: [],
        missingNames: []
    });
    for (const template of runtime) {
        assert.equal(template.metadata.sourceAudit,
            'elf-end-coarse-terrain-v1');
        assert.equal(template.metadata.partial, true);
        assert.equal(template.metadata.presenceKey, 'place:Elf:$');
        assert.ok(template.metadata.tags.includes('no_rotate'));
        assert.equal(template.metadata.matchPolicy.exhaustivePlacement,
            true);
        assert.equal(template.metadata.matchPolicy.revealDisabled, true);
        assert.equal(template.metadata.matchPolicy.forceRevealDisabled,
            undefined);
    }
    assert.deepEqual(
        selectSafeTemplates(runtime, {place: 'Elf', depth: 2}),
        []
    );
});

test('changed loot terrain downgrades only maps which call that helper', () => {
    const source = elfFixture().replace(
        'e.subst("| = | *:2")',
        'e.subst("| = x")'
    );
    const runtime = parseRuntimeDes(source, {path: ELF_PATH});
    const byName = new Map(runtime.map(template => [template.name, template]));

    assert.equal(byName.get('elf_fixture_beta').metadata.sourceAudit,
        'elf-end-coarse-terrain-v1');
    for (const name of ['elf_fixture_alpha', 'elf_fixture_gamma']) {
        const template = byName.get(name);
        assert.equal(template.metadata.sourceAudit,
            'elf-end-detection-only-v1');
        assert.equal(template.metadata.matchPolicy.revealDisabled, true);
        assert.equal(template.metadata.matchPolicy.forceRevealDisabled, true);
    }
    assert.equal(runtime.length, naturalBranchEndPrimaries(
        parseDes(source, {path: ELF_PATH}),
        ELF_PATH
    ).length);
});

test('exhaustive Elf diagnostics are force-visible but normal reveal fails closed', () => {
    const runtime = selectSafeTemplates(
        parseRuntimeDes(elfFixture(), {path: ELF_PATH}),
        {place: 'Elf', depth: 3}
    );
    const observations = [];
    runtime[0].grid.forEach((row, y) => row.forEach((cell, x) => {
        if ((x + y) % 4 === 0 || cell?.kinds?.length !== 1) {
            return;
        }
        const kind = normalizeTerrainKind(cell.kinds[0]);
        if (kind) {
            observations.push({x: x + 7, y: y - 3, kind});
        }
    }));
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(runtime);
    const result = matcher.updateObservations(observations);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'policy-disabled');
    assert.equal(result.best.placementSearch, 'exhaustive');
    assert.ok(result.forcePredictions.length > 0);
    assert.deepEqual(result.predictions, []);
});

test('procedural and foreign-vault negative terrain never makes Elf ready', () => {
    const runtime = selectSafeTemplates(
        parseRuntimeDes(elfFixture(), {path: ELF_PATH}),
        {place: 'Elf', depth: 3}
    );
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(runtime);
    let falseReady = 0;

    for (let seed = 0; seed < 64; seed++) {
        matcher.reset({keepTemplates: true});
        const cells = [];
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 22; x++) {
                const edge = x === 0 || y === 0 || x === 21 || y === 15;
                const foreignRing = (x + seed) % 7 === 0
                    || (y * 3 + seed) % 11 === 0;
                cells.push({
                    x: x - 9,
                    y: y - 5,
                    kind: edge || foreignRing ? 'wall' : 'floor'
                });
            }
        }
        const result = matcher.updateObservations(cells);
        falseReady += result.ready ? 1 : 0;
        assert.deepEqual(result.predictions, [], `seed ${seed}`);
        assert.equal(result.forcePredictions.some(cell =>
            ['void', 'unknown'].includes(cell.kind)), false, `seed ${seed}`);
    }
    assert.equal(falseReady, 0);
});

test('changed shared setup fails closed without dropping candidate identity', () => {
    const source = elfFixture().replace(
        'e.tags("no_rotate")',
        'e.tags("no_hmirror")'
    );
    const parsed = parseDes(source, {path: ELF_PATH});
    const runtime = parseRuntimeDes(source, {path: ELF_PATH});

    assert.equal(runtime.length, 3);
    assert.equal(runtime.length,
        naturalBranchEndPrimaries(parsed, ELF_PATH).length);
    assert.ok(runtime.every(template =>
        template.metadata.sourceAudit === 'elf-end-detection-only-v1'));
    assert.ok(runtime.every(template =>
        template.metadata.matchPolicy.forceRevealDisabled === true));
});

test('branch inventory ignores selector-only and removed definitions', () => {
    const parsed = parseDes(String.raw`
NAME: natural
PLACE: Snake:$
MAP
x.x
ENDMAP
NAME: ordinary
PLACE: Snake:2
MAP
x.x
ENDMAP
NAME: selector_only
TAGS: unrand
PLACE: Snake:$
MAP
x.x
ENDMAP
NAME: obsolete
TAGS: removed
PLACE: Snake:$
MAP
x.x
ENDMAP
`, {path: 'crawl-ref/source/dat/des/branches/snake.des'});

    assert.deepEqual(
        naturalBranchEndPrimaries(
            parsed,
            'crawl-ref/source/dat/des/branches/snake.des'
        ).map(template => template.name),
        ['natural']
    );
    assert.deepEqual(naturalBranchEndPrimaries(
        parsed,
        'crawl-ref/source/dat/des/portals/snake.des'
    ), []);
});

test('unsupported branch ends remain closed-set negative candidates', () => {
    const path = 'crawl-ref/source/dat/des/branches/snake.des';
    const source = String.raw`
{{
function dynamic_rune(e)
  e.subst("w = l")
end
}}
NAME: static_snake_end
PLACE: Snake:$
ORIENT: north
MAP
xxxxxxxx
x......x
x..ww..x
xxxxxxxx
ENDMAP
NAME: dynamic_snake_end
PLACE: Snake:$
ORIENT: float
: dynamic_rune(_G)
MAP
xxxxxxxx
x......x
x..ww..x
xxxxxxxx
ENDMAP
`;
    const parsed = parseDes(source, {path});
    const runtime = branchEndDetectionTemplates(parsed, {path});
    const selected = selectSafeTemplates(runtime, {
        place: 'Snake',
        depth: 4
    });
    const row = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path
    });

    assert.equal(row.raw, 2);
    assert.equal(row.runtime, 2);
    assert.equal(row.selected, 2);
    assert.equal(row.detectionOnly, 2);
    assert.deepEqual(row.missingNames, []);
    assert.ok(runtime.every(template =>
        template.metadata.sourceAudit === 'branch-end-detection-only-v1'));
    assert.ok(runtime.every(template =>
        template.metadata.matchPolicy.revealDisabled === true));
    assert.ok(runtime.every(template =>
        template.metadata.matchPolicy.forceRevealDisabled === true));
});

test('ordinary branch ends keep direct and audited helpers forceable only', () => {
    const path = 'crawl-ref/source/dat/des/branches/snake.des';
    const source = String.raw`
NAME: direct_end
PLACE: Snake:$
ORIENT: north
MAP
xxxxxxxx
x......x
x..ww..x
xxxxxxxx
ENDMAP
NAME: item_only_end
PLACE: Snake:$
ORIENT: float
: if crawl.coinflip() then
KITEM: A = any good_item
: end
MAP
xxxxxxxx
x......x
x..AA..x
xxxxxxxx
ENDMAP
NAME: statue_end
PLACE: Snake:$
ORIENT: south
: vault_metal_statue_setup(_G, "G", "mystic cage")
MAP
xxxxxxxx
x..GG..x
x......x
xxxxxxxx
ENDMAP
NAME: conditional_terrain_end
PLACE: Snake:$
ORIENT: west
: if crawl.coinflip() then
SUBST: w = l
: end
MAP
xxxxxxxx
x..ww..x
x......x
xxxxxxxx
ENDMAP
`;
    const dependencies = {
        [VAULT_LUA_PATH]: String.raw`
function vault_metal_statue_setup(e, glyph, type)
  e.kfeat(glyph .. " = metal_statue")
  e.colour(glyph .. " = mist")
  e.tile(glyph .. " = dngn_mystic_cage")
  e.set_feature_name("metal_statue", type)
end
`
    };
    const options = {path, dependencies};
    const parsed = parseDes(source, options);
    const runtime = parseRuntimeDes(source, options);
    const selected = selectSafeTemplates(runtime, {
        place: 'Snake',
        depth: 4
    });
    const row = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path
    });
    const byName = new Map(runtime.map(template =>
        [template.name, template]));

    assert.equal(row.raw, 4);
    assert.equal(row.runtime, 4);
    assert.equal(row.selected, 4);
    assert.deepEqual(row.missingNames, []);
    for (const name of ['direct_end', 'item_only_end', 'statue_end']) {
        const template = byName.get(name);
        assert.equal(template.metadata.matchPolicy.revealDisabled, true);
        assert.equal(template.metadata.matchPolicy.forceRevealDisabled,
            undefined);
        assert.equal(template.metadata.matchPolicy.exhaustivePlacement, true);
    }
    const unsafe = byName.get('conditional_terrain_end');
    assert.equal(unsafe.metadata.matchPolicy.revealDisabled, true);
    assert.equal(unsafe.metadata.matchPolicy.forceRevealDisabled, true);
    assert.equal(unsafe.metadata.matchPolicy.exhaustivePlacement, false);
    assert.deepEqual(
        byName.get('statue_end').grid.flat()
            .find(cell => cell?.glyph === 'G').kinds,
        ['statue']
    );

    const changed = parseRuntimeDes(source, {
        path,
        dependencies: {
            [VAULT_LUA_PATH]: dependencies[VAULT_LUA_PATH].replace(
                'metal_statue',
                'lava'
            )
        }
    });
    const changedStatue = changed.find(template =>
        template.name === 'statue_end');
    assert.equal(changedStatue.metadata.sourceAudit,
        'branch-end-detection-only-v1');
    assert.equal(changedStatue.metadata.matchPolicy.forceRevealDisabled, true);
});

test('D:$ entry helper is audited exactly and source drift keeps all identities', () => {
    const path = 'crawl-ref/source/dat/des/branches/depths.des';
    const source = String.raw`
{{
function depths_entry(e)
  e.tags("depths_entry uniq_depths_entry chance_depths_entry no_monster_gen")
  e.place("D:$")
  e.orient("float")
  e.weight("20")
  e.kitem("g = smoky gem")
  e.kfeat("O = enter_depths")
  e.tile("G = depths_column")
  e.tile("c = stone_wall_depths_entry")
  e.tile("b = wall_depths_crystal")
end
}}
NAME: depths_entry_fixture
: depths_entry(_G)
MAP
xxxxxxxx
x..Og..x
x......x
xxxxxxxx
ENDMAP
`;
    const runtime = parseRuntimeDes(source, {path});
    const selected = selectSafeTemplates(runtime, {
        place: 'Dungeon',
        depth: 15
    });

    assert.equal(runtime.length, 1);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].metadata.sourceAudit,
        'branch-end-coarse-depths-entry-v1');
    assert.equal(selected[0].metadata.matchPolicy.revealDisabled, true);
    assert.equal(selected[0].metadata.matchPolicy.exhaustivePlacement, true);
    assert.equal(selected[0].metadata.matchPolicy.forceRevealDisabled,
        undefined);
    assert.deepEqual(selected[0].grid.flat()
        .find(cell => cell?.glyph === 'O').kinds, ['stairs']);

    const changed = parseRuntimeDes(source.replace(
        'e.weight("20")',
        'e.weight("21")'
    ), {path});
    assert.equal(changed.length, 1);
    assert.equal(changed[0].metadata.sourceAudit,
        'branch-end-detection-only-v1');
    assert.equal(changed[0].metadata.matchPolicy.forceRevealDisabled, true);
});

test('gap loader adds only unsupported primaries beside existing full maps', () => {
    const path = 'crawl-ref/source/dat/des/branches/shoals.des';
    const source = String.raw`
NAME: existing_static_end
PLACE: Shoals:$
ORIENT: encompass
MAP
xxxxxxxx
x......x
x......x
xxxxxxxx
ENDMAP
NAME: unresolved_composite_end
PLACE: Shoals:$
ORIENT: encompass
SUBVAULT: A: dynamic_child
MAP
xxxxxxxx
x..AA..x
x..AA..x
xxxxxxxx
ENDMAP
`;
    const parsed = parseDes(source, {path});
    const runtime = parseRuntimeDes(source, {path});
    const selected = selectSafeTemplates(runtime, {
        place: 'Shoals',
        depth: 4
    });
    const coverage = summarizeBranchEndCoverage({
        parsed,
        runtime,
        selected,
        path
    });

    assert.equal(coverage.raw, 2);
    assert.equal(coverage.runtime, 2);
    assert.equal(coverage.selected, 2);
    assert.deepEqual(coverage.missingNames, []);
    assert.equal(runtime.filter(template =>
        template.name === 'existing_static_end').length, 1);
    const unresolved = runtime.find(template =>
        template.name === 'unresolved_composite_end');
    assert.equal(unresolved.metadata.sourceAudit,
        'branch-end-detection-only-v1');
    assert.equal(unresolved.metadata.matchPolicy.revealDisabled, true);
    assert.equal(unresolved.metadata.matchPolicy.forceRevealDisabled, true);
});
