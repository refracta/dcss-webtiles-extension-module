import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
    parseDes,
    terrainKindForFeature
} from '../des-parser.js';

function cell(template, glyph) {
    for (const row of template.grid) {
        const found = row.find(value => value && value.glyph === glyph);
        if (found) {
            return found;
        }
    }
    return null;
}

test('parses maps, metadata, keyed terrain, and simple Lua helper effects', () => {
    const source = String.raw`
{{
function fixed_setup(e)
    e.orient("encompass")
    e.tags("helper_tag no_rotate no_hmirror no_vmirror")
    e.place("Pan")
    e.kfeat("Q = deep_water / lava")
    local inert = 'e.subst("x = .") clear("x")'
    os.execute("this must never run")
end
}}
default-depth: D:3-5
NAME: static_fixture
TAGS: direct_tag
KFEAT: Z = granite_statue
KMONS: W = rat
KITEM: x = gold
: fixed_setup(_G)
MAP
QZWx
. +<
ENDMAP
`;

    const [template] = parseDes(source, {path: 'fixture.des'});
    assert.equal(template.name, 'static_fixture');
    assert.equal(template.path, 'fixture.des');
    assert.equal(template.width, 4);
    assert.equal(template.height, 2);
    assert.deepEqual(template.metadata.tags, [
        'direct_tag',
        'helper_tag',
        'no_rotate',
        'no_hmirror',
        'no_vmirror'
    ]);
    assert.equal(template.metadata.place, 'Pan');
    assert.equal(template.metadata.depth, 'D:3-5');
    assert.equal(template.metadata.orient, 'encompass');
    assert.equal(template.metadata.encompass, true);
    assert.deepEqual(template.metadata.allowedTransforms, ['identity']);
    assert.deepEqual(template.metadata.parseWarnings, []);
    assert.deepEqual(cell(template, 'Q').kinds, [
        'deep_water',
        'lava',
        'shallow_water'
    ]);
    assert.equal(cell(template, 'Q').certain, false);
    assert.deepEqual(cell(template, 'Z').kinds, ['statue']);
    assert.deepEqual(cell(template, 'W').kinds, ['floor']);
    assert.deepEqual(cell(template, 'x').kinds, ['floor']);
    assert.deepEqual(cell(template, '+').kinds, ['door']);
    assert.deepEqual(cell(template, '<').kinds, ['stairs']);
    assert.equal(template.grid[1][1], null);
});

test('propagates SUBST, NSUBST, and block SHUFFLE possibilities in order', () => {
    const source = String.raw`
NAME: transforms
SUBST: ? = xW
NSUBST: ! = 1:w / *:l
SHUFFLE: ab/cd
KFEAT: a = stone_wall
KFEAT: c = shallow_water
KMONS: b = rat
KITEM: d = gold
MAP
?!abcd
ENDMAP
`;
    const [template] = parseDes(source);

    assert.deepEqual(cell(template, '?').kinds, ['shallow_water', 'wall']);
    assert.equal(cell(template, '?').certain, false);
    assert.deepEqual(cell(template, '!').kinds, [
        'deep_water',
        'lava',
        'shallow_water'
    ]);
    assert.deepEqual(cell(template, 'a').possibleGlyphs, ['a', 'c']);
    assert.deepEqual(cell(template, 'a').kinds, ['shallow_water', 'wall']);
    assert.deepEqual(cell(template, 'b').possibleGlyphs, ['b', 'd']);
    assert.deepEqual(cell(template, 'b').kinds, ['floor']);
    assert.equal(cell(template, 'b').certain, true);
});

test('keeps malformed transformations fail-closed and never evaluates Lua', () => {
    globalThis.__desParserExecuted = false;
    const source = String.raw`
{{
globalThis.__desParserExecuted = true
function unsafe(e)
    if crawl.coinflip() then
        e.orient("encompass")
        e.tags("conditional_tag")
    end
    e.tags("safe_literal_tag")
end
}}
NAME: malformed
: unsafe(_G)
SUBST: not-an-assignment
MAP
xxx
ENDMAP
`;
    const [template] = parseDes(source);

    assert.equal(globalThis.__desParserExecuted, false);
    assert.deepEqual(template.metadata.tags, ['safe_literal_tag']);
    assert.equal(template.metadata.orient, null);
    assert.ok(template.metadata.parseWarnings.some(warning =>
        warning.includes('conditional orient()')));
    assert.ok(template.metadata.parseWarnings.some(warning =>
        warning.includes('conditional tags()')));
    assert.ok(template.metadata.parseWarnings.some(warning =>
        warning.includes('Could not parse SUBST')));
    assert.deepEqual(template.grid[0][0].kinds, [
        'altar',
        'deep_water',
        'door',
        'floor',
        'lava',
        'portal',
        'shallow_water',
        'stairs',
        'statue',
        'unknown',
        'wall'
    ]);
    assert.equal(template.grid[0][0].certain, false);
    delete globalThis.__desParserExecuted;
});

test('classifies named features without treating unknown names as floor', () => {
    assert.equal(terrainKindForFeature('rock_wall'), 'wall');
    assert.equal(terrainKindForFeature('closed_clear_door'), 'door');
    assert.equal(terrainKindForFeature('open_door'), 'floor');
    assert.equal(terrainKindForFeature('stone_arch'), 'floor');
    assert.equal(terrainKindForFeature('decorative_floor'), 'floor');
    assert.equal(terrainKindForFeature('fountain_blood'), 'floor');
    assert.equal(terrainKindForFeature('exit_wizlab'), 'portal');
    assert.equal(terrainKindForFeature('enter_vaults'), 'portal');
    assert.equal(terrainKindForFeature('enter_lair'), 'stairs');
    assert.equal(terrainKindForFeature('exit_temple'), 'stairs');
    assert.equal(terrainKindForFeature('transporter_landing'), 'portal');
    assert.equal(terrainKindForFeature('malign_gateway'), 'stairs');
    assert.equal(terrainKindForFeature('toxic_bog'), 'shallow_water');
    assert.equal(terrainKindForFeature('permanent teleport trap'), 'trap');
    assert.equal(terrainKindForFeature('nothing'), 'unknown');
    assert.equal(terrainKindForFeature('not_a_real_feature'), 'unknown');
});

test('matches Crawl default glyphs and conservatively models water fixup', () => {
    const source = [
        'NAME: defaults',
        'MAP',
        'wWAB^T',
        'x',
        'ENDMAP',
        'NAME: masked_water',
        'TAGS: no_pool_fixup',
        'KFEAT: q = deep_water',
        'KFEAT: z = deep_water',
        'KMASK: w = !no_pool_fixup',
        'KMASK: q = no_pool_fixup',
        'MAP',
        'wqz',
        'ENDMAP',
        'NAME: open_sea',
        'KFEAT: o = open_sea',
        'MAP',
        'o',
        'ENDMAP'
    ].join('\n');

    const [defaults, masked, openSea] = parseDes(source);
    assert.equal(defaults.width, 6);
    assert.deepEqual(cell(defaults, 'w').kinds, ['deep_water', 'shallow_water']);
    assert.deepEqual(cell(defaults, 'W').kinds, ['shallow_water']);
    assert.deepEqual(cell(defaults, 'A').kinds, ['floor']);
    assert.deepEqual(cell(defaults, 'B').kinds, ['altar']);
    assert.deepEqual(cell(defaults, '^').kinds, ['trap']);
    assert.deepEqual(cell(defaults, 'T').kinds, ['floor']);
    assert.deepEqual(cell(defaults, 'x').kinds, ['wall']);
    assert.equal(defaults.grid[1][1], null);

    assert.deepEqual(cell(masked, 'w').kinds, ['deep_water', 'shallow_water']);
    assert.deepEqual(cell(masked, 'q').kinds, ['deep_water']);
    assert.deepEqual(cell(masked, 'z').kinds, ['deep_water']);
    assert.deepEqual(cell(openSea, 'o').kinds, ['deep_water']);
});

test('uses matcher-compatible kinds for keyed features and transport markers', () => {
    const source = String.raw`
NAME: keyed_features
KFEAT: a = open_door
KFEAT: b = stone_arch
KFEAT: c = fountain_blood
KFEAT: d = transporter
KFEAT: e = malign_gateway
KFEAT: f = toxic_bog
KFEAT: g = nothing
KFEAT: h = floor
KFEAT: h = granite_statue
KFEAT: i = B no_mimic
KFEAT: j = any shop
MARKER: k = lua:transp_loc("entry")
MARKER: l = lua:transp_dest_loc("entry")
MARKER: m = feat:stone_arch
MAP
abcdefghijklm
ENDMAP
`;
    const [template] = parseDes(source);

    for (const glyph of 'abcm') {
        assert.deepEqual(cell(template, glyph).kinds, ['floor'], glyph);
    }
    for (const glyph of 'djkl') {
        assert.deepEqual(cell(template, glyph).kinds, ['portal'], glyph);
    }
    assert.deepEqual(cell(template, 'e').kinds, ['stairs']);
    assert.deepEqual(cell(template, 'f').kinds, ['shallow_water']);
    assert.deepEqual(cell(template, 'h').kinds, ['statue']);
    assert.deepEqual(cell(template, 'i').kinds, ['altar']);
    assert.equal(cell(template, 'g').certain, false);
    assert.ok(cell(template, 'g').kinds.includes('unknown'));
    assert.ok(cell(template, 'g').kinds.includes('floor'));
    assert.ok(cell(template, 'g').kinds.includes('wall'));
});

test('statically recognizes deterministic literal transporter loops only', () => {
    const source = String.raw`
NAME: loop_transporters
{{
local origins = "PQ"
local destinations = "rs"
for i = 1, #origins do
    lua_marker(origins:sub(i,i), transp_loc("origin_" .. tostring(i)))
    lua_marker(destinations:sub(i,i),
               transp_dest_loc("origin_" .. tostring(i)))
end
}}
MAP
PQrs
ENDMAP
`;
    const [template] = parseDes(source);

    for (const glyph of 'PQrs') {
        assert.deepEqual(cell(template, glyph).kinds, ['portal'], glyph);
    }
    assert.deepEqual(template.metadata.parseWarnings, []);
});

test('fails closed for conditional or dynamically keyed Lua transporters', () => {
    const source = String.raw`
NAME: unsafe_transporter
{{
if crawl.coinflip() then
    lua_marker("Z", transp_loc("conditional"))
end
}}
MAP
Z
ENDMAP
`;
    const [template] = parseDes(source);

    assert.ok(template.metadata.parseWarnings.some(warning =>
        warning.includes('transporter marker is conditional')));
    assert.equal(cell(template, 'Z').certain, false);
    assert.ok(cell(template, 'Z').kinds.includes('unknown'));
});

test('warns and fails closed for unsupported helper and conditional mutations', () => {
    const source = String.raw`
{{
function unsafe_setup(e)
    e.tags("always_present")
    e.subst("x = .")
    e.nsubst("x = 1:. / *:x")
    e.shuffle("xy")
    e.marker("x = feat:stone_arch")
    e.subvault("A : child_vault")
    e.clear("z")
    clear("z")
    e.kfeat("Q = " .. dynamic_feature)
    if crawl.coinflip() then e.orient("encompass") end
    if crawl.coinflip() then
        e.place("Pan")
    end
end
}}
NAME: unsafe_helper
: unsafe_setup(_G)
MAP
xQ
ENDMAP

NAME: missing_helper
: no_such_setup(_G)
MAP
x
ENDMAP

NAME: subvaulted
SUBVAULT: A : child_vault
MAP
A
ENDMAP

NAME: conditional_directives
: if crawl.coinflip() then
KFEAT: q = lava
KMASK: q = no_pool_fixup
SUBST: q = .
NSUBST: q = 1:. / *:q
SHUFFLE: qr
MARKER: q = feat:stone_arch
: else
CLEAR: q
: end
MAP
q
ENDMAP

NAME: conditional_helpers
: if crawl.coinflip() then
: unsafe_setup(_G)
: no_such_setup(_G, dynamic_option())
: end
MAP
x
ENDMAP
`;
    const [helper, missing, subvaulted, conditional, conditionalHelpers] =
        parseDes(source);

    assert.ok(helper.metadata.tags.includes('always_present'));
    for (const fragment of [
        'unsupported subst()',
        'unsupported nsubst()',
        'unsupported shuffle()',
        'unsupported marker()',
        'unsupported subvault()',
        'unsupported clear()',
        'unsupported direct clear()',
        'dynamic kfeat()',
        'conditional orient()',
        'conditional place()'
    ]) {
        assert.ok(helper.metadata.parseWarnings.some(warning =>
            warning.includes(fragment)), fragment);
    }
    assert.equal(cell(helper, 'x').certain, false);

    assert.ok(missing.metadata.parseWarnings.some(warning =>
        warning.includes('Unknown Lua helper no_such_setup(_G)')));
    assert.equal(cell(missing, 'x').certain, false);

    assert.ok(subvaulted.metadata.parseWarnings.some(warning =>
        warning.includes('SUBVAULT directives are not statically supported')));
    assert.equal(cell(subvaulted, 'A').certain, false);

    for (const directive of [
        'KFEAT',
        'KMASK',
        'SUBST',
        'NSUBST',
        'SHUFFLE',
        'MARKER',
        'CLEAR'
    ]) {
        assert.ok(conditional.metadata.parseWarnings.some(warning =>
            warning.includes(`${directive} directive appears inside Lua control flow`)),
        directive);
    }
    assert.equal(cell(conditional, 'q').certain, false);

    assert.ok(conditionalHelpers.metadata.parseWarnings.some(warning =>
        warning.includes('Lua helper unsafe_setup is called conditionally')));
    assert.ok(conditionalHelpers.metadata.parseWarnings.some(warning =>
        warning.includes('unsafe_setup') && warning.includes('unsupported subst()')));
    assert.ok(conditionalHelpers.metadata.parseWarnings.some(warning =>
        warning.includes('Unknown Lua helper no_such_setup(_G)')));
    assert.equal(cell(conditionalHelpers, 'x').certain, false);
});

test('keeps MARKER positions fixed when later glyph transforms run', () => {
    const source = String.raw`
NAME: marker_order
MARKER: B = lua:transp_loc("fixed_position")
SHUFFLE: Bx
MAP
Bx
ENDMAP
`;
    const [template] = parseDes(source);

    assert.deepEqual(cell(template, 'B').kinds, ['portal']);
    assert.deepEqual(cell(template, 'x').kinds, ['altar', 'wall']);
    assert.equal(cell(template, 'x').certain, false);
});

test('preserves explicit blank cells, short-row padding, and CLEAR as void', () => {
    const source = [
        'NAME: padding',
        'CLEAR: q',
        'MAP',
        'xq  ',
        'x',
        'ENDMAP'
    ].join('\n');
    const [template] = parseDes(source);

    assert.equal(template.width, 4);
    assert.equal(template.height, 2);
    assert.deepEqual(cell(template, 'x').kinds, ['wall']);
    assert.equal(template.grid[0][1], null);
    assert.equal(template.grid[0][2], null);
    assert.equal(template.grid[0][3], null);
    assert.equal(template.grid[1][1], null);
    assert.equal(template.grid[1][3], null);
});

test('parses the local Crawl wizlab source when it is available', t => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const wizlabPath = path.resolve(
        here,
        '../../../../crawl/crawl-ref/source/dat/des/portals/wizlab.des'
    );
    if (!fs.existsSync(wizlabPath)) {
        t.skip('local Crawl checkout is unavailable');
        return;
    }

    const templates = parseDes(fs.readFileSync(wizlabPath, 'utf8'), {
        path: 'crawl-ref/source/dat/des/portals/wizlab.des'
    });
    assert.equal(templates.length, 26);

    const destinations = templates.filter(template => template.name.startsWith('wizlab_'));
    assert.equal(destinations.length, 15);
    for (const template of destinations) {
        assert.equal(template.metadata.depth, 'WizLab');
        assert.equal(template.metadata.encompass, true, template.name);
        assert.ok(template.metadata.tags.includes('no_item_gen'), template.name);
        assert.ok(template.metadata.tags.includes('no_monster_gen'), template.name);
        assert.ok(template.width > 0 && template.height > 0, template.name);
    }

    const demon = templates.find(template => template.name === 'wizlab_demon');
    assert.deepEqual(demon.metadata.allowedTransforms, ['identity']);
    assert.deepEqual(cell(demon, '<').kinds, ['portal']);

    for (const name of [
        'wizlab_demon',
        'wizlab_wucad',
        'wizlab_lehudib'
    ]) {
        const template = templates.find(candidate => candidate.name === name);
        assert.deepEqual(template.metadata.parseWarnings, [], name);
    }

    const doroklohe = templates.find(template => template.name === 'wizlab_doroklohe');
    assert.ok(doroklohe.metadata.parseWarnings.some(warning =>
        warning.includes('SUBST directive appears inside Lua control flow')));
    const borgnjor = templates.find(template => template.name === 'wizlab_borgnjor');
    assert.ok(borgnjor.metadata.parseWarnings.some(warning =>
        warning.includes('SUBST directive appears inside Lua control flow')));

    const golubria = templates.find(template => template.name === 'wizlab_golubria');
    assert.deepEqual(golubria.metadata.parseWarnings, []);
    const golubriaPortals = golubria.grid.flat().filter(value =>
        value?.certain && value.kinds.length === 1 && value.kinds[0] === 'portal');
    assert.equal(golubriaPortals.length, 24);

    const entrance = templates.find(template => template.name === 'mu_enter_wizlab_1');
    assert.ok(entrance.metadata.tags.includes('uniq_wizlab'));
    assert.ok(entrance.metadata.parseWarnings.some(warning =>
        warning.includes('unsupported subst()')));
    assert.equal(cell(entrance, 'O').certain, false);
});

test('flags unsafe constructs in local Hell and Depths sources', t => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const desRoot = path.resolve(
        here,
        '../../../../crawl/crawl-ref/source/dat/des/branches'
    );
    const fixturePaths = {
        hell: path.join(desRoot, 'hell.des'),
        depths: path.join(desRoot, 'depths.des'),
        encompass: path.join(desRoot, 'depths_encompass.des')
    };
    if (Object.values(fixturePaths).some(fixturePath => !fs.existsSync(fixturePath))) {
        t.skip('local Crawl checkout is unavailable');
        return;
    }

    const parseFixture = (fixturePath, basename) => parseDes(
        fs.readFileSync(fixturePath, 'utf8'),
        {path: `crawl-ref/source/dat/des/branches/${basename}`}
    );
    const hell = parseFixture(fixturePaths.hell, 'hell.des');
    const depths = parseFixture(fixturePaths.depths, 'depths.des');
    const encompass = parseFixture(
        fixturePaths.encompass,
        'depths_encompass.des'
    );

    const hellEntry = hell.find(template => template.name === 'hell_entry');
    assert.ok(hellEntry.metadata.parseWarnings.some(warning =>
        warning.includes('hell_entry_feature') && warning.includes('dynamic kfeat()')));
    assert.equal(cell(hellEntry, 'O').certain, false);

    const vestibule = hell.find(template =>
        template.name === 'vestibule_of_hell_subvaulted');
    for (const fragment of [
        'SUBVAULT directives are not statically supported',
        'NSUBST directive appears inside Lua control flow',
        'SUBST directive appears inside Lua control flow'
    ]) {
        assert.ok(vestibule.metadata.parseWarnings.some(warning =>
            warning.includes(fragment)), fragment);
    }

    const swimmingPool = hell.find(template =>
        template.name === 'vestibule_geryon_nicolae_swimming_pool');
    assert.ok(swimmingPool.metadata.parseWarnings.some(warning =>
        warning.includes('KFEAT directive appears inside Lua control flow')));

    const depthsEntry = depths.find(template =>
        template.name === 'grunt_enter_depths_snipers');
    assert.ok(depthsEntry.metadata.parseWarnings.some(warning =>
        warning.includes('depths_entry') && warning.includes('unsupported kitem()')));
    assert.ok(depthsEntry.metadata.tags.includes('depths_entry'));
    assert.equal(depthsEntry.metadata.place, 'D:$');
    assert.equal(depthsEntry.metadata.orient, 'float');

    const profane = encompass.find(template =>
        template.name === 'grunt_profane_halls');
    assert.ok(profane.metadata.parseWarnings.some(warning =>
        warning.includes('SUBVAULT directives are not statically supported')));
    assert.ok(profane.metadata.parseWarnings.some(warning =>
        warning.includes('grunt_profane_halls_setup')
        && warning.includes('unsupported subst()')));

    const radiant = encompass.find(template =>
        template.name === 'radiant_caverns_a_rkd');
    for (const fragment of ['unsupported shuffle()', 'unsupported marker()']) {
        assert.ok(radiant.metadata.parseWarnings.some(warning =>
            warning.includes(fragment)), fragment);
    }

    const hexagons = encompass.find(template =>
        template.name === 'hellmonk_hyper_hexagons');
    assert.ok(hexagons.metadata.parseWarnings.some(warning =>
        warning.includes('SUBVAULT directives are not statically supported')));
    assert.ok(hexagons.metadata.parseWarnings.some(warning =>
        warning.includes('SUBST directive appears inside Lua control flow')));
});
