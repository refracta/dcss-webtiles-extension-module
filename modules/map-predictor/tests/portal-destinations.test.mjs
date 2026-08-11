import assert from 'node:assert/strict';
import test from 'node:test';

import {parseDes} from '../des-parser.js';
import {materializeAuditedEncompassWallFill} from '../encompass-fill.js';
import {parseRuntimeDes} from '../runtime.js';
import {
    PORTAL_DESTINATION_SPECS,
    naturalPortalDestinationTemplates,
    parsePortalDestinationTemplates,
    portalDestinationCoverage
} from '../portal-destinations.js';

const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';

function sourcePath(family) {
    return `crawl-ref/source/dat/des/portals/${family}.des`;
}

function simpleSource(name = 'destination') {
    return [
        `NAME: ${name}`,
        'ORIENT: encompass',
        'MAP',
        'xxxxx',
        'x<AHx',
        'x...x',
        'xxxxx',
        'ENDMAP'
    ].join('\n');
}

function metalStatueDependency() {
    return String.raw`
function vault_granite_statue_setup(e, glyph, type)
  e.kfeat(glyph .. " = granite_statue")
  e.colour(glyph .. " = grey")
  e.tile(glyph .. " = statue")
  e.set_feature_name("granite_statue", type)
end
function vault_metal_statue_setup(e, glyph, type)
  e.kfeat(glyph .. " = metal_statue")
  e.colour(glyph .. " = red")
  e.tile(glyph .. " = statue")
  e.set_feature_name("metal_statue", type)
end
function decorative_floor(e, glyph, type)
  e.kfeat(glyph .. " = decorative_floor")
  e.colour(glyph .. " = yellow")
  e.tile(glyph .. " = floor")
  e.set_feature_name("decorative_floor", type)
end
`;
}

function repeatedCalls(method, count) {
    return Array.from({length: count}, (_, index) =>
        `  e.${method}("${index} = floor")`).join('\n');
}

function auditedArenaSource() {
    return String.raw`
{{
function arena_setup(e)
  e.tags("no_dump no_item_gen allow_dup")
  e.orient("encompass")
  e.kfeat("< = exit_arena")
  e.kprop("1'< = no_tele_into")
  e.kmask("1'< = no_monster_gen")
  e.mons("generate_awake spectator")
  e.lua_marker("v", props_marker { veto_destroy="veto" })
end
}}
NAME: arena_test
: arena_setup(_G)
MAP
vvvvvvv
v1.A.<v
v.....v
vvvvvvv
ENDMAP
`;
}

function auditedTroveSource() {
    return String.raw`
{{
function trove_setup(e)
  e.tags("no_monster_gen")
  e.tags("no_item_gen")
  e.orient("encompass")
  e.kfeat("< = exit_trove")
end
function trove_offense(e)
  e.kitem("d = sword")
  e.kitem("e = book")
  e.kitem("f = talisman")
  e.subst("d = i")
${Array.from({length: 10}, () => '  e.nsubst("d = 1:d / *:e")').join('\n')}
end
function trove_defense(e)
  e.kitem("g = armour")
  e.kitem("h = jewellery")
  e.kitem("i = potion")
  e.nsubst("g = 1:g / *:h")
  e.nsubst("g = 1:g / *:i")
  e.nsubst("g = 1:g / *:h")
end
function trove_unrand_chances(e)
  e.kitem("? = unrand")
  e.nsubst("d = 1:?")
end
}}
NAME: trove_test
: trove_setup(_G)
{{
trove_offense(_G)
trove_defense(_G)
trove_unrand_chances(_G, "df", {}, {}, {})
subst("q = d")
}}
MAP
xxxxxxxxx
x<.dgq..x
x...A...x
xxxxxxxxx
ENDMAP
`;
}

const NAMELESS_INFERNALISTS_MAP = String.raw`MAP
xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxlxllllllllllllllllllllllllx
xlxlxlllllllllllllllllllllllx
xllxlxllllllllllllllllllllllx
xlllxlxlllllllllllllllllllllx
xllllxlxlllllllllllllllllllxx
xlllllxlxllllllllllllllllllxx
xllllllxloooooooooolllllllxlx
xlllllllooccxmyxxxolllllllxlxxxxxxxxxx
xllllllloccgmmm.Axollllllxlllllllllxlx
xlllllllocgg'm...xollllllxlllllllllxlx
xllllllloxm'....myolllllxlllllllllxllx
xlllllllommm.<.mmmolllllxllllllllxlllx
xllllllloym.....mxoooooolllllllllxlllx
xlllllllox...m...xxxxxxollllllllxllllx
xllllllloxA.mmm..dxy~~xolllllllxlllllx
xllllllloxxxymxxd'W'G~xolllllllxlllllx
xllllllloooooooxxWdW'yxollllllxllllllx
xllllllxlllllloxy'WdWxxooooooolllllllx
xlllllxlllllllox~G'W'dxxmyxxxolllllllx
xlllllxlllllllox~~yxd'.mmm.Axolllllllx
xllllxlllllllloxxxxxx...m...xolllllllx
xlllxlllllllllooooooxm.....myolllllllx
xlllxllllllllxlllllommm.<.mmmolllllllx
xllxlllllllllxllllloym....'mxolllllllx
xlxlllllllllxllllllox...m'ggcolllllllx
xlxlllllllllxlllllloxA.mmmgccolllllllx
xxxxxxxxxxlxllllllloxxxymxccoolllllllx
         xlxllllllloooooooooolxllllllx
         xxllllllllllllllllllxlxlllllx
         xxlllllllllllllllllllxlxllllx
         xlllllllllllllllllllllxlxlllx
         xllllllllllllllllllllllxlxllx
         xlllllllllllllllllllllllxlxlx
         xllllllllllllllllllllllllxlxx
         xlllllllllllllllllllllllllxlx
         xllllllllllllllllllllllllllxx
         xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ENDMAP`;

function auditedNamelessInfernalistsSource() {
    return auditedTroveSource()
        .replace(
            'NAME: trove_test',
            'NAME: regret_index_trove_nameless_infernalists'
        )
        .replace(/MAP\n[\s\S]*?\nENDMAP/u, NAMELESS_INFERNALISTS_MAP);
}

function auditedIceSource() {
    return String.raw`
{{
function ice_cave_appearance(e)
  e.kfeat("< = exit_ice_cave")
  e.set_feature_name("rock_wall", "ice")
  e.set_feature_name("stone_arch", "ice")
  e.set_feature_name("shallow_water", "ice")
  e.set_feature_name("deep_water", "ice")
end
function ice_cave_common_loot(e, glyphs)
  ice_cave_armour_loot(e, glyphs:sub(1,3))
  ice_cave_weapon_loot(e, glyphs:sub(4,5))
  ice_cave_magic_loot(e, glyphs:sub(6,6))
end
function ice_cave_natural_monster_set(e)
${repeatedCalls('kmons', 16)}
${repeatedCalls('set_random_mon_list', 2)}
  dgn.random_item_def()
end
function ice_cave_undead_demon_monster_set(e)
  simulacrum_monsters()
  scythe("freezing")
${repeatedCalls('kmons', 17)}
${repeatedCalls('set_random_mon_list', 2)}
  dgn.random_entry_arg()
  dgn.random_entry_arg()
  dgn.random_entry_arg()
  dgn.random_entry_arg()
end
function simulacrum_monsters()
  return {}
end
function ice_cave_armour_loot(e)
${repeatedCalls('kitem', 3)}
end
function ice_cave_weapon_loot(e)
${repeatedCalls('kitem', 3)}
  dgn.random_item_def()
end
function ice_cave_magic_loot(e)
${repeatedCalls('kitem', 1)}
end
function ice_cave_necro_loot(e)
${repeatedCalls('kitem', 1)}
end
function place_freezing_vapour_machine(e)
  e.lua_marker("!", marker)
end
}}
NAME: ice_test
DEPTH: IceCv
ORIENT: encompass
: ice_cave_appearance(_G)
MAP
xxxxxxx
x<....x
x.xxx.x
x..A..x
xxxxxxx
ENDMAP
`;
}

function markerHelper(name) {
    return String.raw`
function ${name}(e)
  e.kfeat("V = l")
  e.lua_marker("V", marker)
end`;
}

function auditedSewerSource() {
    return String.raw`
{{
function sewer_setup(e)
  e.kfeat("< = exit_sewer")
  e.colour("w = green")
  e.colour("W = lightgreen")
end
}}
NAME: sewer_test
DEPTH: Sewer
ORIENT: encompass
: sewer_setup(_G)
MAP
xxxxxxx
x<....x
x.wW.x
x..A.xx
xxxxxxx
ENDMAP
`;
}

function auditedOssuarySource() {
    return String.raw`
{{
function ossuary_setup_features(e)
  e.tags("no_monster_gen")
  e.tags("no_item_gen")
  e.tile("c = stone_wall_ossuary")
  e.kfeat("< = exit_ossuary")
end
function inkwell_talisman_chance(e, iglyph, nsubst, nglyph)
  e.kitem(iglyph .. " = inkwell talisman")
  e.nsubst(nglyph .. " = 1:" .. iglyph .. ":3 " .. nglyph .. ":17 / *:" .. nglyph)
  e.subst(iglyph .. " = " .. iglyph .. ":3 .:17")
end
}}
NAME: ossuary_test
DEPTH: Ossuary
ORIENT: encompass
: inkwell_talisman_chance(_G, "e")
: ossuary_setup_features(_G)
MAP
xxxxxxx
x<..e.x
x.ccc.x
x..A..x
xxxxxxx
ENDMAP

NAME: ossuary_dynamic_test
DEPTH: Ossuary
ORIENT: encompass
{{
mapgrd[1][1] = 'x'
}}
: inkwell_talisman_chance(_G, "e")
: ossuary_setup_features(_G)
MAP
xxxxxxx
x<..e.x
x..A..x
x.....x
xxxxxxx
ENDMAP
`;
}

function baileyMonsterHelper(name, calls = 1) {
    return `function ${name}(e, glyph)\n${repeatedCalls('kmons', calls)}\nend`;
}

function auditedBaileySource() {
    return String.raw`
{{
function bailey_setup(e)
  e.kfeat("< = exit_bailey")
  e.lrocktile("wall_brick_brown")
end
${baileyMonsterHelper('kobold_axe_returning')}
${baileyMonsterHelper('easy_axe_fighter')}
${baileyMonsterHelper('hard_axe_fighter', 2)}
${baileyMonsterHelper('orc_warlord_with_axe')}
${baileyMonsterHelper('orc_with_polearm')}
${baileyMonsterHelper('orc_warrior_with_polearm')}
${baileyMonsterHelper('orc_knight_with_polearm')}
${baileyMonsterHelper('orc_warlord_with_polearm')}
function bailey_talisman_chance(e, glyph)
  e.kitem(glyph .. " = fortress talisman / blade talisman w:5")
  e.subst(glyph .. " = " .. glyph .. ":15 .:85")
end
}}
NAME: bailey_test
DEPTH: Bailey
ORIENT: encompass
: easy_axe_fighter(_G, "1")
: bailey_talisman_chance(_G, "f")
: decorative_floor(_G, "B", "orcish standard")
: bailey_setup(_G)
MAP
xxxxxxxxx
x<..B...x
x>.1f...x
x...A...x
xxxxxxxxx
ENDMAP
`;
}

function auditedBazaarSource() {
    return String.raw`
{{
function random_bazaar_tileset()
  local keys = util.keys({})
  return crawl.random2(1)
end
function randomise_bazaar_tiles()
  local tileset = random_bazaar_tileset()
  dgn.change_floor_colour(tileset)
  dgn.change_floor_tile(tileset)
  dgn.change_rock_tile(tileset)
end
function create_shop_halos()
  dgn.get_floor_colour()
  dgn.floor_halo("enter_shop", "yellow", "halo")
end
function bazaar_setup(e)
  e.tags("normal_bazaar")
  e.tags("no_monster_gen")
  e.kmons("K = customer")
  e.kmons("K = customer")
  e.kfeat("< = stone_arch")
  e.kfeat("> = exit_bazaar")
  e.nsubst(". = 2:K / 4 = K. / 6 : K .:260 / *:.")
  e.nsubst(". = 1:K / 2 = K. / 3 : K .:260 / *:.")
  randomise_bazaar_tiles()
  randomise_bazaar_tiles()
  dgn.set_branch_epilogue("Bazaar", "create_shop_halos")
  dgn.set_branch_epilogue("Bazaar", nil)
  dgn.set_branch_epilogue("Bazaar", nil)
  crawl.mpr("1")
  crawl.mpr("2")
  crawl.mpr("3")
  crawl.mpr("4")
  crawl.mpr("5")
  you.god()
  you.god()
  you.god()
  you.god()
  you.god()
  you.god()
  you.get_base_mutation_level("hated by all")
  you.silenced()
  you.silenced()
end
}}
NAME: bazaar_test
DEPTH: Bazaar
ORIENT: encompass
SHUFFLE: AB
SUBST: A = <, B = >
: bazaar_setup(_G)
MAP
xxxxxxxxx
xA.....Bx
x.......x
x.......x
xxxxxxxxx
ENDMAP

NAME: bazaar_dynamic_test
DEPTH: Bazaar
ORIENT: encompass
{{
mapgrd[1][1] = 'x'
}}
: bazaar_setup(_G)
MAP
xxxxxxx
x<...>x
x.....x
x.....x
xxxxxxx
ENDMAP
`;
}

function auditedVolcanoSource() {
    return String.raw`
{{
function make_fiery_armour(e, armour)
  for _, item in ipairs(armour) do
    item = item
  end
  return string.gsub("", "x", "")
end
function make_fiery_weapon(e, weapon)
  for _, item in ipairs(weapon) do
    item = item
  end
  local value = string.gsub("", "x", "")
  e.item(value)
end
function setup_loot(e)
  e.item(make_fiery_armour(e, {}))
  e.item("loot")
  e.item(make_fiery_weapon(e, {}))
  e.item("loot")
end
function volcano_setup(e)
  setup_loot(e)
  e.kfeat("< = exit_volcano")
  e.kfeat("I = exit_volcano")
  e.kfeat("^ = trap_alarm")
  e.subst("L : LLL.l")
  e.subst("L = lll.")
  e.subst("y : yyy.x")
  e.subst("y = xxx.")
  e.colour("c = red")
  e.set_feature_name("stone_arch", "tunnel")
end
function fiery_guardians(e)
${repeatedCalls('mons', 19)}
  crawl.x_chance_in_y(1, 2)
  crawl.random2(2)
  crawl.random2(2)
end
function place_lake_volcanoes(e, glyphs)
  for _, glyph in ipairs(glyphs) do
    place_lake_volcano(e, glyph)
  end
end
function place_lake_volcano(e, glyph)
  e.kfeat(glyph .. " = l")
  e.lua_marker(glyph, marker)
end
${markerHelper('place_large_volcano')}
${markerHelper('place_chained_volcano')}
${markerHelper('place_small_volcano')}
${markerHelper('place_tiny_volcano')}
}}
NAME: volcano_test
DEPTH: Volcano
ORIENT: encompass
: volcano_setup(_G)
: place_tiny_volcano(_G)
MAP
xxxxxxxxx
x<..L.I.x
x..y.V..x
x...A...x
xxxxxxxxx
ENDMAP
`;
}

test('all source-driven portal families preserve their natural inventory', () => {
    for (const family of Object.keys(PORTAL_DESTINATION_SPECS)) {
        const source = simpleSource(`${family}_fixed`);
        const path = sourcePath(family);
        const parsed = parseDes(source, {path});
        const natural = naturalPortalDestinationTemplates(parsed, path);
        assert.equal(natural.length, 1, family);

        if (PORTAL_DESTINATION_SPECS[family].externalAudit) {
            const coverage = portalDestinationCoverage(
                source,
                {path, parsed},
                natural,
                natural
            );
            assert.equal(coverage.complete, true, family);
            assert.equal(coverage.rawNaturalCount,
                coverage.parseRuntimeCandidateCount, family);
            assert.equal(coverage.rawNaturalCount, coverage.selectedCount, family);
            continue;
        }

        const runtime = parsePortalDestinationTemplates(
            source,
            parsed,
            {path}
        );
        const coverage = portalDestinationCoverage(
            source,
            {path, parsed},
            runtime,
            runtime
        );
        assert.equal(runtime.length, natural.length, family);
        assert.equal(coverage.complete, true, family);
        assert.equal(coverage.rawNaturalCount,
            coverage.parseRuntimeCandidateCount, family);
        assert.equal(coverage.rawNaturalCount, coverage.selectedCount, family);
        assert.equal(
            coverage.revealableCount
                + coverage.forceOnlyCount
                + coverage.detectionOnlyCount,
            coverage.rawNaturalCount,
            family
        );
        assert.equal(portalDestinationCoverage(
            source,
            {path, parsed},
            runtime,
            []
        ).complete, false, `${family} selected invariant`);
    }
});

test('portal specs keep natural arrival arches separate from exit glyphs', () => {
    const expected = {
        arena: {entry: ['A'], portal: ['<']},
        bailey: {entry: ['A'], portal: ['<']},
        bazaar: {entry: ['<'], portal: ['>']},
        crucible: {entry: [], portal: []},
        desolation: {entry: ['H'], portal: ['<']},
        gauntlet: {entry: ['A'], portal: ['<']},
        gulch: {entry: ['A'], portal: ['<']},
        icecave: {entry: ['A'], portal: ['<']},
        necropolis: {entry: ['A'], portal: ['<', '>']},
        ossuary: {entry: ['A'], portal: ['<']},
        sewer: {entry: ['A'], portal: ['<']},
        trove: {entry: ['A'], portal: ['<']},
        volcano: {entry: ['A'], portal: ['<', 'I']},
        wizlab: {entry: ['A'], portal: ['<']},
        ziggurat: {entry: [], portal: []}
    };

    for (const [family, glyphs] of Object.entries(expected)) {
        assert.deepEqual(
            PORTAL_DESTINATION_SPECS[family].entryGlyphs,
            glyphs.entry,
            `${family} arrival`
        );
        assert.deepEqual(
            PORTAL_DESTINATION_SPECS[family].portalGlyphs || [],
            glyphs.portal,
            `${family} exits`
        );
    }
});

test('unsupported destinations remain non-forceable negative candidates', () => {
    const path = sourcePath('bailey');
    const source = simpleSource('bailey_test');
    const templates = parseRuntimeDes(source, {path});

    assert.equal(templates.length, 1);
    assert.equal(templates[0].metadata.matchPolicy.revealDisabled, true);
    assert.equal(templates[0].metadata.matchPolicy.forceRevealDisabled, true);
    assert.equal(templates[0].metadata.entryAnchorGlyph, 'A');
    assert.equal(templates[0].metadata.entryAnchorObservedKind, 'floor');
});

test('Arena reveal requires the exact static setup helper contract', () => {
    const path = sourcePath('arena');
    const source = auditedArenaSource();
    const [template] = parseRuntimeDes(source, {path});

    assert.equal(template.metadata.sourceAudit, 'portal-arena-coarse-terrain-v1');
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(
        template.grid.flat().find(cell => cell?.glyph === '<').kinds,
        ['portal']
    );

    const mutation = source.replace(
        '  e.mons("generate_awake spectator")',
        '  e.mons("generate_awake spectator")\n  e.subst("v = .")'
    );
    const [disabled] = parseRuntimeDes(mutation, {path});
    assert.equal(disabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);
});

test('dynamic conditional and subvault cells are masked without dropping maps', () => {
    const path = sourcePath('gauntlet');
    const source = String.raw`
NAME: assembled_gauntlet
ORIENT: encompass
: if crawl.coinflip() then
SUBST: q = x
: else
SUBST: q = .
: end
SUBVAULT: B : gauntlet_arena
MAP
xxxxxxx
x<qB..x
x.....x
xxxxxxx
ENDMAP
`;
    const [template] = parseRuntimeDes(source, {path});
    const q = template.grid.flat().find(cell => cell?.glyph === 'q');
    const b = template.grid.flat().find(cell => cell?.glyph === 'B');

    assert.equal(q.certain, false);
    assert.deepEqual(q.kinds, []);
    assert.equal(b.certain, false);
    assert.deepEqual(b.kinds, []);
    assert.equal(template.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Desolation exposes only an audited static shell to explicit force reveal', () => {
    const path = sourcePath('desolation');
    const source = String.raw`
NAME: desolation_test
ORIENT: encompass
SUBVAULT: B : desolation_ruin
: if crawl.coinflip() then
SHUFFLE: qr
: end
: set_border_fill_type('endless_salt')
: set_feature_name("granite_statue", "ruined idol")
MAP
xxxxxxxxx
x<..B...x
x..qr...x
x...H...x
xxxxxxxxx
ENDMAP
`;
    const [template] = parseRuntimeDes(source, {path});
    const cells = template.grid.flat().filter(Boolean);

    assert.equal(
        template.metadata.sourceAudit,
        'portal-desolation-known-shell-force-v1'
    );
    assert.equal(template.metadata.matchPolicy.revealDisabled, true);
    assert.equal(template.metadata.matchPolicy.forceRevealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'H');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(cells.find(cell => cell.glyph === '<').kinds, ['portal']);
    assert.deepEqual(cells.find(cell => cell.glyph === 'B').kinds, []);
    assert.deepEqual(cells.find(cell => cell.glyph === 'q').kinds, []);
    assert.deepEqual(cells.find(cell => cell.glyph === 'r').kinds, []);

    const mutation = source.replace(
        ': set_feature_name("granite_statue", "ruined idol")',
        ': set_feature_name("granite_statue", "ruined idol")\n'
            + ': terrain_mutator(_G)'
    );
    const [disabled] = parseRuntimeDes(mutation, {path});
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Trove exposes audited item-only Lua shells and masks every dynamic glyph', () => {
    const path = sourcePath('trove');
    const source = auditedTroveSource();
    const [template] = parseRuntimeDes(source, {path});
    const cells = template.grid.flat().filter(Boolean);

    assert.equal(
        template.metadata.sourceAudit,
        'portal-trove-known-shell-force-v1'
    );
    assert.equal(template.metadata.matchPolicy.revealDisabled, true);
    assert.equal(template.metadata.matchPolicy.forceRevealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(cells.find(cell => cell.glyph === '<').kinds, ['portal']);
    for (const glyph of ['d', 'g', 'q']) {
        assert.deepEqual(cells.find(cell => cell.glyph === glyph).kinds, []);
    }

    const helperMutation = source.replace(
        '  e.kitem("d = sword")',
        '  e.kitem("d = sword")\n  e.kfeat("q = rock_wall")'
    );
    const [helperDisabled] = parseRuntimeDes(helperMutation, {path});
    assert.equal(helperDisabled.metadata.matchPolicy.forceRevealDisabled, true);

    const newMapHelper = source.replace(
        ': trove_setup(_G)',
        ': trove_setup(_G)\n: terrain_mutator(_G)'
    );
    const [mapDisabled] = parseRuntimeDes(newMapHelper, {path});
    assert.equal(mapDisabled.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Nameless Infernalists Trove restores encompass wall base under MAP gaps', () => {
    const path = sourcePath('trove');
    const source = auditedNamelessInfernalistsSource();
    const [parsed] = parseDes(source, {path});
    const [runtime] = parseRuntimeDes(source, {path});

    assert.equal(runtime.name, 'regret_index_trove_nameless_infernalists');
    assert.equal(runtime.metadata.sourceAudit,
        'portal-trove-known-shell-force-v1');
    assert.deepEqual([runtime.width, runtime.height], [38, 38]);

    // The generic parser must not certify these context-free gaps as wall.
    // This fixture's unsupported embedded Lua broadens them to unknown; the
    // audited runtime loader alone knows that encompass generation resets the
    // level to rock before applying MAP cells.
    assert.notDeepEqual(parsed.grid[0][37]?.kinds, ['wall'],
        'short-row padding');
    assert.notDeepEqual(parsed.grid[28][0]?.kinds, ['wall'],
        'literal leading MAP space');
    for (const [x, y] of [[37, 0], [0, 28], [8, 28]]) {
        assert.deepEqual(runtime.grid[y][x], {
            kinds: ['wall'],
            certain: true,
            glyph: ' ',
            possibleGlyphs: [' ']
        });
    }
    assert.deepEqual(runtime.grid[28][9].kinds, ['wall']);
    assert.equal(runtime.grid[28][9].glyph, 'x');
});

test('encompass fill fails closed for non-wall, subvault, and partial maps', () => {
    const path = sourcePath('trove');
    const base = auditedNamelessInfernalistsSource();
    for (const mutation of [
        base.replace(
            ': trove_setup(_G)',
            ": trove_setup(_G)\n: set_border_fill_type('open_sea')"
        ),
        base.replace(
            ': trove_setup(_G)',
            ': trove_setup(_G)\nSUBVAULT: B : dynamic_trove_piece'
        )
    ]) {
        const [runtime] = parseRuntimeDes(mutation, {path});
        assert.equal(runtime.metadata.sourceAudit,
            'portal-trove-known-shell-force-v1');
        assert.equal(runtime.grid[28][0], null);
    }

    const partial = {
        width: 2,
        height: 1,
        grid: [[null, {kinds: ['wall'], certain: true, glyph: 'x'}]],
        metadata: {
            encompass: true,
            orient: 'encompass',
            partial: true
        }
    };
    const grid = materializeAuditedEncompassWallFill(
        partial,
        'NAME: partial\nORIENT: encompass\nMAP\n x\nENDMAP\n',
        {audited: true}
    );
    assert.equal(grid, partial.grid);
    assert.equal(grid[0][0], null);

    const fixed = {
        ...partial,
        metadata: {...partial.metadata, partial: false}
    };
    const conditional = materializeAuditedEncompassWallFill(
        fixed,
        "NAME: dynamic\nORIENT: encompass\n"
            + ': if crawl.coinflip() then\n'
            + ": set_border_fill_type('rock_wall')\n"
            + ': end\nMAP\n x\nENDMAP\n',
        {audited: true}
    );
    assert.equal(conditional, fixed.grid);
    assert.equal(conditional[0][0], null);

    const literalWall = materializeAuditedEncompassWallFill(
        fixed,
        "NAME: fixed\nORIENT: encompass\n"
            + ": set_border_fill_type('permarock_wall')\n"
            + 'MAP\n x\nENDMAP\n',
        {audited: true}
    );
    assert.notEqual(literalWall, fixed.grid);
    assert.deepEqual(literalWall[0][0].kinds, ['wall']);
});

test('audited Sewer setup enables every static coarse destination', () => {
    const path = sourcePath('sewer');
    const source = auditedSewerSource();
    const [template] = parseRuntimeDes(source, {path});

    assert.equal(template.metadata.sourceAudit, 'portal-sewer-coarse-terrain-v1');
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(
        template.grid.flat().find(cell => cell?.glyph === '<').kinds,
        ['portal']
    );

    const mutation = source.replace(
        '  e.colour("W = lightgreen")',
        '  e.colour("W = lightgreen")\n  e.subst("x = .")'
    );
    const [disabled] = parseRuntimeDes(mutation, {path});
    assert.equal(disabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);

    const directMapMutation = source.replace(
        ': sewer_setup(_G)',
        ': sewer_setup(_G)\n: e.subst("x = .")'
    );
    const [mapDisabled] = parseRuntimeDes(directMapMutation, {path});
    assert.equal(mapDisabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(mapDisabled.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Ossuary keeps map-level terrain Lua as a detection-only competitor', () => {
    const path = sourcePath('ossuary');
    const templates = parseRuntimeDes(auditedOssuarySource(), {path});
    const fixed = templates.find(template => template.name === 'ossuary_test');
    const dynamic = templates.find(template =>
        template.name === 'ossuary_dynamic_test');

    assert.equal(templates.length, 2);
    assert.equal(fixed.metadata.sourceAudit, 'portal-ossuary-coarse-terrain-v1');
    assert.equal(fixed.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(fixed.metadata.entryAnchorGlyph, 'A');
    assert.equal(fixed.metadata.entryAnchorObservedKind, 'floor');
    assert.equal(dynamic.metadata.matchPolicy.revealDisabled, true);
    assert.equal(dynamic.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Bailey audits monster/item helpers and dependency terrain separately', () => {
    const path = sourcePath('bailey');
    const dependencies = {[VAULT_LUA_PATH]: metalStatueDependency()};
    const [template] = parseRuntimeDes(auditedBaileySource(), {
        path,
        dependencies
    });

    assert.equal(template.metadata.sourceAudit, 'portal-bailey-coarse-terrain-v1');
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(
        template.grid.flat().find(cell => cell?.glyph === '>').kinds,
        ['stairs']
    );
    assert.deepEqual(
        template.grid.flat().find(cell => cell?.glyph === 'B').kinds,
        ['floor']
    );

    const [explicitSecondExit] = parseRuntimeDes(
        auditedBaileySource().replace(
            ': bailey_setup(_G)',
            'KFEAT: > = exit_bailey\n: bailey_setup(_G)'
        ),
        {path, dependencies}
    );
    assert.deepEqual(
        explicitSecondExit.grid.flat().find(cell => cell?.glyph === '>').kinds,
        ['portal']
    );

    const mutation = auditedBaileySource().replace(
        '  e.kmons("0 = floor")',
        '  e.kmons("0 = floor")\n  e.kfeat("1 = rock_wall")'
    );
    const [disabled] = parseRuntimeDes(mutation, {path, dependencies});
    assert.equal(disabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);
});

test('Bazaar preserves floor/portal unions through shuffled exit glyphs', () => {
    const path = sourcePath('bazaar');
    const templates = parseRuntimeDes(auditedBazaarSource(), {path});
    const fixed = templates.find(template => template.name === 'bazaar_test');
    const dynamic = templates.find(template =>
        template.name === 'bazaar_dynamic_test');
    const shuffled = fixed.grid.flat().filter(cell =>
        cell?.possibleGlyphs?.includes('<')
        && cell.possibleGlyphs.includes('>'));

    assert.equal(templates.length, 2);
    assert.equal(fixed.metadata.sourceAudit, 'portal-bazaar-coarse-terrain-v1');
    assert.equal(fixed.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(fixed.metadata.entryAnchorGlyph, '<');
    assert.equal(fixed.metadata.entryAnchorObservedKind, 'floor');
    assert.ok(shuffled.length >= 2);
    for (const cell of shuffled) {
        assert.equal(cell.certain, false);
        assert.ok(cell.kinds.includes('floor'));
        assert.ok(cell.kinds.includes('portal'));
    }
    assert.equal(dynamic.metadata.matchPolicy.revealDisabled, true);
    assert.equal(dynamic.metadata.matchPolicy.forceRevealDisabled, true);

    const conditionalSource = auditedBazaarSource().replace(
        'SHUFFLE: AB\nSUBST: A = <, B = >',
        ': if crawl.coinflip() then\nSUBST: A = <, B = >\n'
            + ': else\nSUBST: A = >, B = <\n: end'
    );
    const conditional = parseRuntimeDes(conditionalSource, {path})
        .find(template => template.name === 'bazaar_test');
    assert.equal(conditional.metadata.entryAnchorGlyph, '<');
    assert.ok(conditional.grid.flat().some(cell =>
        cell?.possibleGlyphs?.includes('>')));
});

test('audited Ice Cave helpers enable coarse native reveal candidates', () => {
    const path = sourcePath('icecave');
    const source = auditedIceSource();
    const dependencies = {[VAULT_LUA_PATH]: metalStatueDependency()};
    const [template] = parseRuntimeDes(source, {path, dependencies});

    assert.equal(template.metadata.sourceAudit, 'portal-icecave-coarse-terrain-v1');
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    const entrance = template.grid.flat().find(cell => cell?.glyph === '<');
    assert.deepEqual(entrance.kinds, ['portal']);

    const mutated = source.replace(
        '  e.set_feature_name("deep_water", "ice")',
        '  e.set_feature_name("deep_water", "ice")\n  e.subst("x = .")'
    );
    const [disabled] = parseRuntimeDes(mutated, {path, dependencies});
    assert.equal(disabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);

    const newMapHelper = source.replace(
        ': ice_cave_appearance(_G)',
        ': ice_cave_appearance(_G)\n: new_terrain_helper(_G)'
    );
    const mapHelperTemplates = parseRuntimeDes(newMapHelper, {
        path,
        dependencies
    });
    assert.equal(mapHelperTemplates.length, 1);
    assert.equal(
        mapHelperTemplates[0].metadata.matchPolicy.revealDisabled,
        true
    );
    assert.equal(
        mapHelperTemplates[0].metadata.matchPolicy.forceRevealDisabled,
        true
    );

    const nestedHelperMutation = source.replace(
        '  dgn.random_item_def()',
        '  dgn.random_item_def()\n  terrain_mutator(e)'
    );
    const [nestedDisabled] = parseRuntimeDes(nestedHelperMutation, {
        path,
        dependencies
    });
    assert.equal(nestedDisabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(
        nestedDisabled.metadata.matchPolicy.forceRevealDisabled,
        true
    );
});

test('audited Volcano helpers restore exits and mask random setup glyphs', () => {
    const path = sourcePath('volcano');
    const source = auditedVolcanoSource();
    const dependencies = {[VAULT_LUA_PATH]: metalStatueDependency()};
    const [template] = parseRuntimeDes(source, {path, dependencies});

    assert.equal(template.metadata.sourceAudit, 'portal-volcano-coarse-terrain-v1');
    assert.equal(template.metadata.matchPolicy.revealDisabled, undefined);
    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    const cells = template.grid.flat().filter(Boolean);
    assert.deepEqual(cells.find(cell => cell.glyph === '<').kinds, ['portal']);
    assert.deepEqual(cells.find(cell => cell.glyph === 'V').kinds, ['lava']);
    assert.equal(cells.find(cell => cell.glyph === 'L').certain, false);
    assert.equal(cells.find(cell => cell.glyph === 'y').certain, false);

    const lootMutation = source.replace(
        '  e.item("loot")',
        '  e.item("loot")\n  e.subst("x = .")'
    );
    const [disabled] = parseRuntimeDes(lootMutation, {path, dependencies});
    assert.equal(disabled.metadata.matchPolicy.revealDisabled, true);
    assert.equal(disabled.metadata.matchPolicy.forceRevealDisabled, true);

    const removedExit = source.replace(
        ': place_tiny_volcano(_G)',
        ': place_tiny_volcano(_G)\nNSUBST: I = 2'
    );
    const [sameAnchor] = parseRuntimeDes(removedExit, {path, dependencies});
    assert.equal(sameAnchor.metadata.entryAnchorGlyph, 'A');
    assert.equal(sameAnchor.metadata.entryAnchorGlyphs, undefined);
    assert.deepEqual(
        sameAnchor.grid.flat().find(cell => cell?.glyph === 'I')
            .possibleGlyphs,
        ['2']
    );

    const removedArrival = source.replace(
        ': place_tiny_volcano(_G)',
        ': place_tiny_volcano(_G)\nSUBST: A = .'
    );
    const [unanchored] = parseRuntimeDes(removedArrival, {path, dependencies});
    assert.equal(unanchored.metadata.entryAnchorGlyph, undefined);
    assert.equal(unanchored.metadata.entryAnchorObservedKind, undefined);
});

test('Volcano NSUBST keeps every possible natural stone arch as an anchor', () => {
    const path = sourcePath('volcano');
    const dependencies = {[VAULT_LUA_PATH]: metalStatueDependency()};
    const source = auditedVolcanoSource()
        .replace('NAME: volcano_test', 'NAME: volcano_pools_test')
        .replace(
            ': place_tiny_volcano(_G)',
            'NSUBST: U = 1:A / *:.\n: place_tiny_volcano(_G)'
        )
        .replace('x...A...x', 'x.UU.U..x');
    const [template] = parseRuntimeDes(source, {path, dependencies});
    const possibleAnchors = template.grid.flat().filter(cell =>
        cell?.possibleGlyphs?.includes('A'));

    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.equal(possibleAnchors.length, 3);
    assert.ok(possibleAnchors.every(cell => cell.kinds.includes('floor')));
});
