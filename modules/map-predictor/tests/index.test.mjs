import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {parseDes} from '../des-parser.js';
import MapPredictor, {
    parseRuntimeDes,
    selectSafeTemplates
} from '../runtime.js';
import {
    MapMatcher,
    allowedTransforms,
    normalizeTerrainKind,
    transformTemplate
} from '../matcher.js';
import {compactMatcherResult} from '../matcher-worker.js';

const FULL_SHA = '7480fdf97e436e947913740be25ab553b025f310';
const VAULT_LUA_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const WIZLAB_PATH = 'crawl-ref/source/dat/des/portals/wizlab.des';

class FakeAdapter {
    constructor() {
        this.owner = null;
        this.installed = false;
        this.binding = null;
        this.predictions = [];
        this.revealEnabled = false;
        this.destroyed = false;
        this.samples = [];
    }

    install() {
        this.installed = true;
    }

    setPredictions(predictions) {
        this.predictions = [...predictions];
        return this.predictions;
    }

    clearPredictions() {
        this.predictions = [];
    }

    rememberTerrainSamples(samples) {
        this.samples.push(...structuredClone(samples));
    }

    setRevealEnabled(enabled) {
        this.revealEnabled = Boolean(enabled);
        return this.revealEnabled;
    }

    toggleReveal() {
        return this.setRevealEnabled(!this.revealEnabled);
    }

    scheduleRender() {}

    destroy() {
        this.destroyed = true;
    }
}

class FakeWorker {
    static instances = [];

    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.messages = [];
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    postMessage(message) {
        this.messages.push(structuredClone(message));
    }

    emit(message) {
        this.onmessage?.({data: structuredClone(message)});
    }

    emitError(error = new Error('worker failed')) {
        this.onerror?.(error);
    }

    terminate() {
        this.terminated = true;
    }
}

function fixtureTemplate() {
    const source = String.raw`
NAME: integration_wizlab
ORIENT: encompass
TAGS: no_rotate no_hmirror no_vmirror
MAP
xxxxxx
x....x
x.+A<x
x.ww.x
xxxxxx
ENDMAP
`;
    const parsed = parseDes(source, {path: WIZLAB_PATH})[0];
    parsed.metadata.entryAnchorGlyph = 'A';
    parsed.metadata.entryAnchorObservedKind = 'floor';
    return parsed;
}

function vaultsCompositeSourceFixture() {
    const rows = Array.from({length: 58}, (_, y) =>
        Array.from({length: 66}, (_, x) =>
            x < 2 || x >= 64 || y < 2 || y >= 56 ? 'x' : '.'));
    const slotOrigins = [[4, 4], [35, 4], [4, 31], [35, 31]];
    for (let index = 0; index < slotOrigins.length; index++) {
        const [originX, originY] = slotOrigins[index];
        const glyph = 'ABCD'[index];
        for (let y = 0; y < 23; y++) {
            for (let x = 0; x < 27; x++) {
                rows[originY + y][originX + x] = glyph;
            }
        }
        for (let x = 0; x < 13; x++) {
            rows[originY][originX + x] = '.';
        }
    }
    for (const [x, y, glyph] of [
        [32, 27, '('],
        [33, 27, '<'],
        [31, 28, '['],
        [34, 28, '{'],
        [32, 29, '<'],
        [33, 29, '<']
    ]) {
        rows[y][x] = glyph;
    }

    const quadrantRows = seed => Array.from({length: 23}, (_, y) =>
        Array.from({length: 27}, (_, x) => {
            if (x === 0 || x === 26 || y === 0 || y === 22) {
                return 'x';
            }
            if (x === 12 && y === 10) {
                return 'O';
            }
            if (x === 14 && y === 12) {
                return 'k';
            }
            return (x * 3 + y * 5 + seed) % 11 === 0 ? 'x' : '.';
        }).join('')).join('\n');
    const quadrant = (name, tags, seed) => String.raw`
NAME: ${name}
TAGS: ${tags} unrand
: vaults_end_loot(_G)
: vaults_end_rune(_G)
MAP
${quadrantRows(seed)}
ENDMAP
`;

    return String.raw`
{{
function vaults_end_loot(e)
  if (dgn.persist.vaults_end_crystal) then
    e.subst("x = b")
  else
    e.subst("x = v")
  end
  e.subst("? = | * .:43")
  e.subst("| = | *:2")
  e.subst("* = * |:2")
  e.nsubst("*| = 1:$")
end
function vaults_end_rune(e)
  if e.has_tag("vaults_end_quadrant_prize")
     or e.has_tag("vaults_end_quadrant") then
    e.subvault("k : vaults_end_gem")
    e.subvault("O : vaults_end_rune")
  else
    e.subvault("O : vaults_end_norune")
    e.subst("k = *")
  end
end
}}
NAME:     vaults_vault
PLACE:    Vaults:$
ORIENT:   encompass
TAGS:     no_rotate no_dump
MONS:     vault guard
SHUFFLE:  ABCD
: if not dgn.persist.vaults_end_crystal then
:   dgn.persist.vaults_end_crystal = false
: end
: if crawl.one_chance_in(10) then
:   dgn.persist.vaults_end_crystal = true
SUBST:      x = b
LFLOORTILE: floor_crystal
:   set_border_fill_type('crystal_wall')
: else
:   dgn.persist.vaults_end_crystal = false
SUBST:      x = v
LFLOORTILE: floor_metal_silver
:   set_border_fill_type('metal_wall')
: end
: if crawl.one_chance_in(36) then
SUBVAULT: A : vaults_end_quadrant_prize_mall
SUBVAULT: B : vaults_end_quadrant_mall
SUBVAULT: C : vaults_end_quadrant_mall
SUBVAULT: D : vaults_end_quadrant_mall
: else
SUBVAULT: A : vaults_end_quadrant_prize
SUBVAULT: B : vaults_end_quadrant
SUBVAULT: C : vaults_end_quadrant
SUBVAULT: D : vaults_end_quadrant
:end
SUBST:    ABCD = .
FTILE:    .([{<109 = floor_vault
{{
  set_feature_name("metal_wall", "heavily etched metal wall")
  set_feature_name("crystal_wall", "heavily etched crystal wall")
  set_feature_name("stone_stairs_up_i", "metal staircase leading up")
  set_feature_name("stone_stairs_up_ii", "metal staircase leading up")
  set_feature_name("stone_stairs_up_iii", "metal staircase leading up")
}}
MAP
${rows.map(row => row.join('')).join('\n')}
ENDMAP
${quadrant('fixture_regular_mall_1',
        'vaults_end_quadrant vaults_end_quadrant_mall', 1)}
${quadrant('fixture_regular_mall_2',
        'vaults_end_quadrant vaults_end_quadrant_mall', 2)}
${quadrant('fixture_regular_mall_3',
        'vaults_end_quadrant vaults_end_quadrant_mall', 3)}
${quadrant('fixture_prize', 'vaults_end_quadrant_prize', 4)}
${quadrant('fixture_prize_mall',
        'vaults_end_quadrant_prize vaults_end_quadrant_prize_mall', 5)}
`;
}

function createHarness(options = {}) {
    const template = fixtureTemplate();
    const messages = [];
    const commands = new Map();
    const commandManager = {
        addCommand(command, argumentTypes, handler) {
            commands.set(command, {argumentTypes, handler});
        },
        sendChatMessage(content) {
            messages.push(content);
        }
    };
    const dwem = {Modules: {CommandManager: commandManager}};
    const repository = {
        cache: {close() {}},
        async prepare(versionText) {
            return {revision: FULL_SHA, fullSha: FULL_SHA, versionText};
        },
        async getManifest() {
            return {revision: FULL_SHA, fullSha: FULL_SHA, paths: [WIZLAB_PATH]};
        },
        selectPaths(manifest, place) {
            return /wizlab/i.test(place) ? [WIZLAB_PATH] : [];
        },
        async getParsed() {
            return options.templates || [template];
        }
    };
    const adapter = new FakeAdapter();
    const module = new MapPredictor({
        dwem,
        repository,
        adapter,
        matcherOptions: {
            minScore: 1,
            minEvidenceCells: 12,
            minEvidenceWeight: 12,
            minDistinctKinds: 3,
            minWinnerMargin: 0.01,
            minPredictedCells: 5
        },
        evaluationDelay: 0,
        maxTemplates: options.maxTemplates,
        syncMaxTemplates: options.syncMaxTemplates,
        useWorker: options.useWorker,
        workerFactory: options.workerFactory,
        workerOptions: options.workerOptions
    });
    return {module, adapter, commands, messages, template};
}

function compactReadyResult(template, offsetX = -3, offsetY = -2) {
    return {
        ready: true,
        unique: true,
        reason: 'ready',
        margin: 1,
        plausibleCandidateCount: 1,
        consensusOverflow: false,
        best: {
            template: {name: template.name, path: template.path},
            score: 1,
            evidenceCells: 20,
            evidenceWeight: 20,
            distinctKinds: 4,
            transform: 'identity',
            offsetX,
            offsetY
        },
        predictions: Array.from({length: 5}, (_, index) => ({
            x: offsetX + index,
            y: offsetY,
            kind: index === 0 ? 'wall' : 'floor'
        }))
    };
}

function observedFixtureCells(template, offsetX, offsetY) {
    const enums = {
        MF_FLOOR: 1,
        MF_WALL: 2,
        MF_DOOR: 3,
        MF_STAIR_UP: 4,
        MF_DEEP_WATER: 5
    };
    const kindToFeature = {
        floor: enums.MF_FLOOR,
        wall: enums.MF_WALL,
        door: enums.MF_DOOR,
        stairs: enums.MF_STAIR_UP,
        deep_water: enums.MF_DEEP_WATER
    };
    const cells = [];
    for (let y = 0; y < template.height; y++) {
        for (let x = 0; x < template.width; x++) {
            if ((x + y) % 4 === 0) {
                continue;
            }
            const kind = template.grid[y][x]?.kinds?.[0] || 'wall';
            cells.push({
                x: offsetX + x,
                y: offsetY + y,
                cell: {f: 1, mf: kindToFeature[kind]}
            });
        }
    }
    return {cells, binding: {enums}};
}

async function waitUntil(predicate, attempts = 50) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.fail('condition did not become true');
}

function transitionToWizlab(module, pos = {x: 0, y: 0}) {
    module.onPlayer({place: 'Dungeon', depth: 1, pos: {x: 0, y: 0}});
    module.onPlayer({place: 'a Wizlab', depth: 0, pos});
    module.onMap({clear: true});
}

test('selectSafeTemplates accepts only full, non-overwritable maps', () => {
    const safe = fixtureTemplate();
    const partial = structuredClone(safe);
    partial.metadata.encompass = false;
    const overwritable = structuredClone(safe);
    overwritable.metadata.tags.push('overwritable');
    const removed = structuredClone(safe);
    removed.metadata.tags.push('removed');
    const warned = structuredClone(safe);
    warned.metadata.parseWarnings = ['unsupported SUBVAULT'];

    assert.deepEqual(
        selectSafeTemplates([partial, overwritable, safe, removed, warned]),
        [safe]
    );
});

test('audited Pan lord helpers expose terrain-matched partial footprints', () => {
    const source = String.raw`
{{
function pan_lord_setup(_G, name)
    _G.tags("unrand")
    _G.set_random_mon_list("demon")
    _G.lfloorcol("red")
    _G.lfloorcol("blue")
    _G.lfloorcol("green")
    _G.lfloorcol("white")
    _G.lrockcol("red")
    _G.lrockcol("blue")
    _G.lrockcol("green")
    _G.lrockcol("white")
    _G.lfloortile("floor")
    _G.lfloortile("floor")
    _G.lfloortile("floor")
    _G.lfloortile("floor")
    _G.lrocktile("wall")
    _G.lrocktile("wall")
    _G.lrocktile("wall")
    _G.lrocktile("wall")
    _G.tile("c = wall")
    _G.tile("b = wall")
    _G.tile("v = wall")
    _G.tile("d = wall")
    _G.tile("e = wall")
    _G.kitem("O = glowing rune of Zot")
    _G.kitem("O = magical rune of Zot")
    _G.kitem("O = fiery rune of Zot")
    _G.kitem("O = dark rune of Zot")
    _G.kmons("& = demon")
    _G.kmons("& = demon")
    _G.kmons("& = demon")
    _G.kmons("& = demon")
    if count_pan_runes() > 0 then
        _G.nsubst("& = " .. count_pan_runes() .. ":& / *:${'`'}")
    else
        _G.subst("& = .")
    end
    if crawl.one_chance_in(3) then
        _G.hook("post_place", function()
            dgn.place_maps{ tag="mnolegdec", count=1 }
        end)
    end
end

colours = {}
}}
default-depth: Pan
NAME: partial_mnoleg
TAGS: mnoleg uniq_mnoleg
ORIENT: northeast
: pan_lord_setup(_G, "Mnoleg")
MAP
xxxxx
x...x
x.&.x
xxxxx
ENDMAP
`;
    const path = 'crawl-ref/source/dat/des/branches/pan.des';
    const templates = parseRuntimeDes(source, {path});

    assert.equal(templates.length, 1);
    assert.equal(templates[0].metadata.partial, true);
    assert.equal(templates[0].metadata.presenceKey, undefined);
    assert.equal(templates[0].metadata.lordTag, 'mnoleg');
    assert.equal(templates[0].metadata.matchPolicy.revealDisabled, true);
    assert.equal(templates[0].metadata.matchPolicy.exhaustivePlacement, true);
    assert.equal(
        templates[0].metadata.matchPolicy.requireFocusInFootprint,
        undefined
    );
    assert.equal(templates[0].grid[2][2].kinds[0], 'floor');
    assert.deepEqual(selectSafeTemplates(
        templates,
        {place: 'Pandemonium', depth: 0}
    ), templates);
    assert.deepEqual(selectSafeTemplates(
        templates,
        {place: 'Pandemonium', depth: 0},
        {presenceKey: 'pan-lord:mnoleg'}
    ), templates);

    const changedHelper = source.replace(
        '_G.tile("c = wall")',
        '_G.kfeat("c = lava")'
    );
    assert.deepEqual(parseRuntimeDes(changedHelper, {path}), []);
});

test('audited Gehenna helpers admit coarse end maps and reject terrain mutations', () => {
    const primarySource = String.raw`
{{
function geh_setup(e)
    e.place("Geh:$")
    e.kmask("O = no_item_gen")
    e.kitem("O = obsidian rune of Zot")
    e.lrockcol("brown")
    e.lfloorcol("lightgrey")
    e.lfloortile("floor_pebble_darkgray")
    e.colour("v = red")
    e.set_feature_name("floor", "Ashen ground")
    e.set_feature_name("metal_wall", "tempered metal wall")
end
}}
NAME: geh_old
ORIENT: encompass
: serpent_of_hell_setup(_G)
: geh_setup(_G)
MAP
 xxxxx
 x.D.x
 x.O.x
 xxxxx
ENDMAP
`;
    const source = [
        primarySource,
        ...[
            'geh_mu',
            'evilmike_geh',
            'geh_grunt',
            'lightli_geh_unto_the_cruel',
            'geh_hangedman',
            'geh_grunt_pentagon'
        ].map(name => String.raw`
NAME: ${name}
ORIENT: encompass
: serpent_of_hell_setup(_G)
: geh_setup(_G)
MAP
xxxxx
x.{.x
x...x
xxxxx
ENDMAP
`)
    ].join('\n');
    const path = 'crawl-ref/source/dat/des/branches/geh.des';
    const dependencies = {
        [VAULT_LUA_PATH]: String.raw`
function serpent_of_hell_setup(e)
    e.kmons("D = Serpent of Hell")
end
`
    };
    const options = {path, dependencies};
    const original = parseDes(source, options)[0];

    assert.deepEqual(original.metadata.parseWarnings, [
        'Unknown Lua helper serpent_of_hell_setup(_G)',
        'Lua helper geh_setup is not statically safe: unsupported kmask()',
        'Lua helper geh_setup is not statically safe: unsupported kitem()'
    ]);

    const templates = parseRuntimeDes(source, options);
    assert.equal(templates.length, 7);
    assert.equal(templates[0].name, 'geh_old');
    assert.equal(templates[0].metadata.place, 'Geh:$');
    assert.equal(
        templates[0].metadata.sourceAudit,
        'hell-end-coarse-terrain-v1'
    );
    assert.equal(templates[0].metadata.entryAnchorGlyph, '{');
    assert.deepEqual(templates[0].metadata.parseWarnings, []);
    assert.deepEqual(templates[0].grid[0][0], {
        kinds: ['wall'],
        certain: true,
        glyph: ' ',
        possibleGlyphs: [' ']
    });
    assert.deepEqual(
        selectSafeTemplates(templates, {place: 'Gehenna', depth: 7}),
        templates
    );
    const [anchored] = selectSafeTemplates(
        templates,
        {place: 'Gehenna', depth: 7},
        {levelEntry: {x: -2, y: 6}}
    );
    assert.deepEqual(anchored.metadata.matchAnchor, {
        x: -2,
        y: 6,
        glyph: '{',
        requireObservedKind: 'portal'
    });

    const mutated = source.replace(
        '    e.kitem("O = obsidian rune of Zot")',
        '    e.kitem("O = obsidian rune of Zot")\n    e.kfeat("x = lava")'
    );
    assert.deepEqual(parseRuntimeDes(mutated, options), []);

    const duplicatePlace = source.replace(
        '    e.place("Geh:$")',
        '    e.place("Geh:$")\n    e.place("Geh:$")'
    );
    assert.deepEqual(parseRuntimeDes(duplicatePlace, options), []);

    const helperBorderMutation = source.replace(
        '    e.place("Geh:$")',
        "    set_border_fill_type('rock_wall')\n    e.place(\"Geh:$\")"
    );
    assert.deepEqual(parseRuntimeDes(helperBorderMutation, options), []);
});

test('incomplete Hell-end families remain detection-only', () => {
    const source = String.raw`
{{
function dis_setup(e)
    e.place("Dis:$")
    e.tags("dis", "no_rotate")
    e.kitem("$ = $ no_pickup")
    e.set_feature_name("metal_statue", "iron statue")
end
function dis_rune(e)
    e.kmask("O = no_item_gen")
    e.kitem("O = iron rune of Zot")
end
}}
NAME: dis_st
ORIENT: encompass
: serpent_of_hell_setup(_G)
: dis_setup(_G)
: dis_rune(_G)
: vault_metal_statue_setup(_G, "G", "iron statue")
MAP
xxxxx
x{OGx
x...x
xxxxx
ENDMAP
`;
    const dependencies = {
        [VAULT_LUA_PATH]: String.raw`
function serpent_of_hell_setup(e)
    e.kmons("D = Serpent of Hell")
end
function vault_metal_statue_setup(e, glyph, type)
    e.kfeat(glyph .. " = metal_statue")
    e.colour(glyph .. " = cyan")
    e.tile(glyph .. " = iron")
    e.set_feature_name("metal_statue", type)
end
`
    };
    const [template] = parseRuntimeDes(source, {
        path: 'crawl-ref/source/dat/des/branches/dis.des',
        dependencies
    });

    assert.equal(template.metadata.entryAnchorGlyph, '{');
    assert.equal(template.metadata.entryAnchorObservedKind, 'portal');
    assert.equal(template.metadata.matchPolicy.revealDisabled, true);
});

test('Vaults:5 is one audited shell with four complete quadrant slots', () => {
    const source = vaultsCompositeSourceFixture();
    const path = 'crawl-ref/source/dat/des/branches/vaults.des';
    const [template] = parseRuntimeDes(source, {path});

    assert.equal(template.name, 'vaults_vault');
    assert.equal(template.width, 66);
    assert.equal(template.height, 58);
    assert.equal(template.metadata.sourceAudit, 'vaults-end-composite-v1');
    assert.deepEqual(template.metadata.entryAnchorGlyphs, ['{', '(', '[', '<']);
    assert.equal(template.metadata.entryAnchorObservedKind, 'stair');
    assert.equal(template.metadata.composite.slots.length, 4);
    assert.ok(template.metadata.composite.slots.every(slot =>
        slot.width === 27
        && slot.height === 23
        && slot.mask.flat().filter(Boolean).length === 608));
    assert.equal(template.metadata.composite.variants.length, 5);
    assert.equal(template.metadata.composite.borderFillKind, 'wall');

    const dynamicVariant = template.metadata.composite.variants[0];
    assert.deepEqual(
        dynamicVariant.grid.flat().find(cell => cell?.glyph === 'O').kinds,
        []
    );
    assert.deepEqual(
        dynamicVariant.grid.flat().find(cell => cell?.glyph === 'k').kinds,
        []
    );
    const [selected] = selectSafeTemplates(
        [template],
        {place: 'Vaults', depth: 5},
        {levelEntry: {x: 2, y: -3}}
    );
    assert.deepEqual(selected.metadata.matchAnchor, {
        x: 2,
        y: -3,
        glyphs: ['{', '(', '[', '<'],
        requireObservedKind: 'stair'
    });

    // Any extra generator directive invalidates the whole composite rather
    // than silently continuing with an incomplete daily source inventory.
    const changedMaster = source.replace(
        'SUBVAULT: D : vaults_end_quadrant',
        'SUBVAULT: D : vaults_end_quadrant\n'
            + 'SUBVAULT: D : vaults_end_quadrant'
    );
    assert.deepEqual(parseRuntimeDes(changedMaster, {path}), []);

    const changedQuadrant = source.replace(
        ': vaults_end_rune(_G)\nMAP',
        ': vaults_end_rune(_G)\n: kfeat("x = lava")\nMAP'
    );
    assert.deepEqual(parseRuntimeDes(changedQuadrant, {path}), []);
});

test('audited Slime helper rejects a duplicate allowed orient call', () => {
    const source = String.raw`
{{
function setup_slime_pit_ending(e, loot_under_rune)
    e.place("Slime:$")
    e.orient("encompass")
    e.mons("Royal Jelly")
    e.mons("acid blob")
    e.mons("great orb of eyes / nothing")
    e.kfeat("Z = altar_jiyva")
    e.kitem("k = |, starry gem")
    e.kitem("O = *, *, |, |, slimy rune of Zot")
    e.kitem("O = slimy rune of Zot")
    e.tile("n = slimy_transparent_stone")
    e.lua_marker("1", "monster marker")
    e.lua_marker("Z", "wall marker")
    e.kmask("|Ok* = no_monster_gen")
    e.kprop("|Ok* = no_jiyva")
    e.kprop("|Ok* = no_tele_into")
    e.shuffle("{[(")
    e.set_feature_name("stone_wall", "rune-carved stone wall")
    e.set_feature_name("clear_stone_wall", "rune-carved clear stone wall")
end
}}
NAME: slime_pit_fixture
: setup_slime_pit_ending(_G)
MAP
xxxxx
x{[(x
x.Z.x
x.O.x
xxxxx
ENDMAP
`;
    const path = 'crawl-ref/source/dat/des/branches/slime.des';
    const templates = parseRuntimeDes(source, {path});
    assert.equal(templates.length, 1);
    assert.equal(
        templates[0].metadata.sourceAudit,
        'slime-end-coarse-terrain-v1'
    );
    assert.equal(templates[0].metadata.entryAnchorGlyph, '{');
    assert.equal(templates[0].metadata.matchPolicy.revealDisabled, true);
    const shuffledStairs = templates[0].grid.flat()
        .filter(cell => ['{', '[', '('].includes(cell?.glyph));
    assert.equal(shuffledStairs.length, 3);
    assert.ok(shuffledStairs.every(cell =>
        ['{', '[', '('].every(glyph => cell.possibleGlyphs.includes(glyph))));

    const duplicateOrient = source.replace(
        '    e.orient("encompass")',
        '    e.orient("encompass")\n    e.orient("float")'
    );
    assert.deepEqual(parseRuntimeDes(duplicateOrient, {path}), []);
});

test('Slime shaft entry remains detection-only with a wrong trusted anchor', () => {
    const source = String.raw`
{{
function setup_slime_pit_ending(e, loot_under_rune)
    e.place("Slime:$")
    e.orient("encompass")
    e.mons("Royal Jelly")
    e.mons("acid blob")
    e.mons("great orb of eyes / nothing")
    e.kfeat("Z = altar_jiyva")
    e.kitem("k = |, starry gem")
    e.kitem("O = *, *, |, |, slimy rune of Zot")
    e.kitem("O = slimy rune of Zot")
    e.tile("n = slimy_transparent_stone")
    e.lua_marker("1", "monster marker")
    e.lua_marker("Z", "wall marker")
    e.kmask("|Ok* = no_monster_gen")
    e.kprop("|Ok* = no_jiyva")
    e.kprop("|Ok* = no_tele_into")
    e.shuffle("{[(")
    e.set_feature_name("stone_wall", "rune-carved stone wall")
    e.set_feature_name("clear_stone_wall", "rune-carved clear stone wall")
end
}}
NAME: slime_pit_shaft_fixture
NSUBST: { = { / .
: setup_slime_pit_ending(_G)
MAP
xxxxxxxx
x......x
x.{....x
x......x
x..Z...x
x...O..x
x......x
xxxxxxxx
ENDMAP
`;
    const path = 'crawl-ref/source/dat/des/branches/slime.des';
    const [template] = parseRuntimeDes(source, {path});
    const [anchored] = selectSafeTemplates(
        [template],
        {place: 'Slime', depth: 5},
        // A live Slime:4 -> Slime:5 transition may be a shaft whose landing
        // square is ordinary floor rather than the numbered `{` stair.
        {levelEntry: {x: 0, y: 0}}
    );
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates([{
        ...anchored,
        metadata: {
            ...anchored.metadata,
            matchPolicy: {
                ...anchored.metadata.matchPolicy,
                minScore: 0,
                minEvidenceCells: 1,
                minEvidenceWeight: 1,
                minDistinctKinds: 1,
                minCoverage: 0,
                minSpanXRatio: 0,
                minSpanYRatio: 0,
                requiredKinds: []
            }
        }
    }]);

    const result = matcher.updateObservations([
        {x: 0, y: 0, kind: 'floor'}
    ]);
    assert.equal(result.reason, 'policy-disabled');
    assert.equal(result.ready, false);
    assert.deepEqual(result.predictions, []);
});

test('audited Zot entry and end fixtures preserve terrain and entry anchors', () => {
    const hallRows = Array.from({length: 36}, (_, y) => {
        if (y === 14) {
            return `${'x'.repeat(39)}.Z.${'x'.repeat(38)}`;
        }
        if (y === 35) {
            return `${'x'.repeat(40)}@${'x'.repeat(39)}`;
        }
        return `x${'.'.repeat(78)}x`;
    });
    const source = String.raw`
NAME: evilmike_zot_entry_basic
: zot_entry_setup(_G, true)
MAP
xxxxx
x.Z.x
x.O.x
xxxxx
ENDMAP

NAME: hall_of_Zot
PLACE: Zot:$
ORIENT: north
: if crawl.one_chance_in(4) then
NSUBST: H = 1:^ / * = ^'
SUBST: D = '
: kfeat("oO = " .. t_choice_a.t .. " / " .. t_choice_b.t)
: else
SUBST: D = ^'', O = d, o = '
: end
MAP
${hallRows.join('\n')}
ENDMAP
`;
    const path = 'crawl-ref/source/dat/des/branches/zot.des';
    const dependencies = {
        [VAULT_LUA_PATH]: String.raw`
function zot_entry_setup(e, use_default_mons)
    e.tags("zot_entry")
    e.place("Depths:$")
    e.orient("float")
    e.kitem("R = midnight gem")
    e.kfeat("O = enter_zot")
    e.kfeat("Z = zot_statue")
    e.kmask("R = no_item_gen")
    e.mons("base draconian")
    e.mons("fire dragon")
    e.mons("nonbase draconian")
    e.kmons("0 = ettin")
    e.kmons("9 = fire giant")
end
`
    };
    const templates = parseRuntimeDes(source, {path, dependencies});
    const entry = templates.find(template =>
        template.name === 'evilmike_zot_entry_basic');
    const hall = templates.find(template => template.name === 'hall_of_Zot');

    assert.equal(entry.metadata.sourceAudit, 'depths-zot-entry-v1');
    assert.equal(entry.metadata.place, 'Depths:$');
    assert.equal(entry.metadata.partial, true);
    assert.deepEqual(
        entry.grid.flat().find(cell => cell?.glyph === 'O').kinds,
        ['portal']
    );
    assert.deepEqual(
        entry.grid.flat().find(cell => cell?.glyph === 'Z').kinds,
        ['statue']
    );
    assert.deepEqual(
        selectSafeTemplates(templates, {place: 'Depths', depth: 4})
            .map(template => template.name),
        ['evilmike_zot_entry_basic']
    );

    assert.equal(hall.metadata.sourceAudit, 'zot-end-primary-v1');
    // `@` is a vault-layout connector, not the player's Zot:5 arrival
    // stair, so it must not be bound to the WebTiles level-entry coordinate.
    assert.equal(hall.metadata.entryAnchorGlyph, undefined);
    assert.deepEqual(
        hall.grid.flat().find(cell => cell?.glyph === 'Z').kinds,
        []
    );
    const [selectedHall] = selectSafeTemplates(
        templates,
        {place: 'Zot', depth: 5},
        {levelEntry: {x: 7, y: 9}}
    );
    assert.equal(selectedHall.name, 'hall_of_Zot');
    assert.equal(selectedHall.metadata.matchAnchor, undefined);
    assert.equal(hall.metadata.matchAnchor, undefined);

    const duplicateOrientDependencies = {
        [VAULT_LUA_PATH]: dependencies[VAULT_LUA_PATH].replace(
            '    e.orient("float")',
            '    e.orient("float")\n    e.orient("float")'
        )
    };
    assert.equal(parseRuntimeDes(source, {
        path,
        dependencies: duplicateOrientDependencies
    }).some(template => template.metadata?.sourceAudit
        === 'depths-zot-entry-v1'), false);

    const duplicatePlaceDependencies = {
        [VAULT_LUA_PATH]: dependencies[VAULT_LUA_PATH].replace(
            '    e.place("Depths:$")',
            '    e.place("Depths:$")\n    e.place("Depths:$")'
        )
    };
    assert.equal(parseRuntimeDes(source, {
        path,
        dependencies: duplicatePlaceDependencies
    }).some(template => template.metadata?.sourceAudit
        === 'depths-zot-entry-v1'), false);
});

test('exact 1b83 Zot:5 hall exhaustively matches every legal mirror placement', async () => {
    const source = await readFile(new URL(
        './fixtures/zot-hall-1b83f8de.des',
        import.meta.url
    ), 'utf8');
    const templates = parseRuntimeDes(source, {
        path: 'crawl-ref/source/dat/des/branches/zot.des'
    });
    const [hall] = selectSafeTemplates(templates, {place: 'Zot', depth: 5});

    assert.equal(hall.metadata.sourceAudit, 'zot-end-primary-v1');
    assert.equal(hall.width, 80);
    assert.equal(hall.height, 36);
    assert.equal(hall.metadata.matchPolicy.exhaustivePlacement, true);
    assert.equal(hall.metadata.matchPolicy.revealDisabled, true);
    assert.equal(hall.metadata.matchPolicy.requireFocusInFootprint, undefined);
    // Crawl's GMINM=70 prevents a 90-degree turn of this 80-wide map. Its
    // four legal mirror states must nevertheless all remain matchable.
    assert.deepEqual(
        allowedTransforms(hall).map(transform => transform.id),
        ['r0', 'r0v', 'r0h', 'r0hv']
    );

    for (const transform of allowedTransforms(hall)) {
        const transformed = transformTemplate(hall, transform);
        const offsetX = -40;
        // A vertical mirror turns ORIENT north into ORIENT south, whose
        // absolute y position in the 70-high level is 70 - 36 = 34.
        const offsetY = transform.id.includes('v') ? 4 : -30;
        const observations = [];
        transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
            const kinds = cell?.kinds || [];
            if (kinds.length === 1
                && ['wall', 'floor'].includes(kinds[0])
                && (x === 0 || x === 79 || y === 0 || y === 35
                    || (x + y * transformed.width) % 5 === 0)) {
                observations.push({
                    x: offsetX + x,
                    y: offsetY + y,
                    kind: kinds[0]
                });
            }
        }));
        const matcher = new MapMatcher({
            requireExhaustivePlacement: true,
            minPredictedCells: 20
        });
        matcher.setTemplates([hall]);
        const result = matcher.updateObservations(observations);

        assert.equal(result.ready, false, transform.id);
        assert.equal(result.reason, 'policy-disabled', transform.id);
        assert.deepEqual(result.predictions, [], transform.id);
        assert.equal(result.best.transform, transform.id);
        assert.equal(result.best.placementSearch, 'exhaustive');
        assert.equal(result.best.offsetX, offsetX);
        assert.equal(result.best.offsetY, offsetY);
        assert.ok(result.forcePredictions.length > 2000);
    }
});

test('Zot:5 procedural terrain cannot certify a shifted unseen hall', async () => {
    const source = await readFile(new URL(
        './fixtures/zot-hall-1b83f8de.des',
        import.meta.url
    ), 'utf8');
    const [hall] = selectSafeTemplates(parseRuntimeDes(source, {
        path: 'crawl-ref/source/dat/des/branches/zot.des'
    }), {place: 'Zot', depth: 5});
    const transformed = transformTemplate(
        hall,
        allowedTransforms(hall).find(transform => transform.id === 'r0')
    );
    const observations = [];
    for (let y = 0; y < 17; y++) {
        for (let x = 0; x < transformed.width; x++) {
            const kinds = [...new Set(
                (transformed.grid[y]?.[x]?.kinds || [])
                    .map(normalizeTerrainKind)
                    .filter(Boolean)
            )];
            const kind = kinds.length === 1 ? kinds[0] : null;
            if (kind && (x * 17 + y * 31) % 5 === 0) {
                observations.push({x, y, kind});
            }
        }
    }
    assert.equal(observations.length, 272);

    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates([hall]);
    const result = matcher.updateObservations(observations);

    assert.equal(result.best.transform, 'r0');
    assert.equal(result.best.offsetX, 0);
    assert.equal(result.best.offsetY, 0);
    assert.equal(result.best.score, 1);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'policy-disabled');
    assert.deepEqual(result.predictions, []);
    assert.ok(result.forcePredictions.length > 2000);

    // The real hall begins seventeen rows lower. The explicit force result is
    // therefore demonstrably unsafe even though the decoy placement scores
    // perfectly against the observed procedural band.
    const truth = new Map();
    for (let y = 0; y < transformed.height; y++) {
        for (let x = 0; x < transformed.width; x++) {
            const kinds = [...new Set(
                (transformed.grid[y]?.[x]?.kinds || [])
                    .map(normalizeTerrainKind)
                    .filter(Boolean)
            )];
            const kind = kinds.length === 1 ? kinds[0] : null;
            if (kind) {
                truth.set(`${x},${y + 17}`, kind);
                if (y < 17) {
                    truth.set(`${x},${y}`, kind);
                }
            }
        }
    }
    const mismatches = result.forcePredictions.filter(cell =>
        truth.has(`${cell.x},${cell.y}`)
        && truth.get(`${cell.x},${cell.y}`) !== cell.kind);
    assert.ok(mismatches.length > 0);
});

test('Golubria uses the map transition entry without a chat signal', () => {
    const golubria = fixtureTemplate();
    golubria.name = 'wizlab_golubria';
    const [selected] = selectSafeTemplates(
        [golubria],
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: -3, y: 4}}
    );

    assert.notEqual(selected, golubria);
    assert.deepEqual(selected.metadata.matchAnchor, {
        x: -3,
        y: 4,
        glyph: 'A',
        requireObservedKind: 'floor'
    });
    assert.equal(golubria.metadata.matchAnchor, undefined);
});

test('warning-free Wizlabs bind every possible arrival arch to level entry', () => {
    const source = String.raw`
NAME: wizlab_cloud
ORIENT: encompass
MAP
xxxxx
xA<.x
x.<.x
xxxxx
ENDMAP
`;
    const [portal] = parseRuntimeDes(source, {path: WIZLAB_PATH});
    assert.equal(portal.metadata.entryAnchorGlyph, 'A');
    assert.equal(portal.metadata.entryAnchorObservedKind, 'floor');
    assert.equal(portal.metadata.presenceKey, undefined);

    const [selected] = selectSafeTemplates(
        [portal],
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: -6, y: 8}}
    );
    assert.deepEqual(selected.metadata.matchAnchor, {
        x: -6,
        y: 8,
        glyph: 'A',
        requireObservedKind: 'floor'
    });
});

test('Wizlab anchor discovery ignores an arrival arch removed by substitution', () => {
    const source = String.raw`
NAME: wizlab_removed_exit
ORIENT: encompass
NSUBST: A = .
MAP
xxxxx
x.A.x
xxxxx
ENDMAP
`;
    const [template] = parseRuntimeDes(source, {path: WIZLAB_PATH});
    const arrival = template.grid.flat().find(cell => cell?.glyph === 'A');

    assert.deepEqual(arrival.possibleGlyphs, ['.']);
    assert.equal(template.metadata.entryAnchorGlyph, undefined);
});

test('Eringya anchors only its final A marker, not decorative stone arches', () => {
    const source = String.raw`
NAME: wizlab_eringya
ORIENT: encompass
KFEAT: - = stone_arch
NSUBST: A = 1:< / *:A
MARKER: A = feat:stone_arch
MAP
xxxxxxx
xA.-.Ax
xxxxxxx
ENDMAP
`;
    const [template] = parseRuntimeDes(source, {path: WIZLAB_PATH});

    assert.equal(template.metadata.entryAnchorGlyph, 'A');
    assert.equal(template.metadata.entryAnchorGlyphs, undefined);
    assert.equal(template.metadata.entryAnchorObservedKind, 'floor');
    assert.equal(template.grid.flat().filter(cell =>
        cell?.possibleGlyphs?.includes('A')).length, 2);
    assert.equal(template.grid.flat().filter(cell =>
        cell?.glyph === '-' && cell?.possibleGlyphs?.includes('A')).length, 0);

    const [selected] = selectSafeTemplates(
        [template],
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: 2, y: -4}}
    );
    assert.deepEqual(selected.metadata.matchAnchor, {
        x: 2,
        y: -4,
        glyph: 'A',
        requireObservedKind: 'floor'
    });
});

test('chat messages never choose Pan or Wizlab map candidates', () => {
    const {module} = createHarness();
    module.onPlayer({
        place: 'a Wizlab',
        depth: 0,
        pos: {x: 3, y: -2}
    });
    module.onMessages([{
        text: '<b>Welcome to The Roulette of Golubria!</b>'
    }]);

    module.onMessages([{
        text: '<lightred>The mighty Pandemonium lord Mnoleg resides here.'
    }]);

    assert.equal(module.getDebugState().levelSignals.presenceKey, undefined);
    assert.equal(module.getDebugState().levelSignals.golubriaEntry, undefined);
    module.destroy();
});

test('all Wizlabs compete by terrain and audited Iskenderun beats Golubria', () => {
    const source = String.raw`
{{
function wizlab_setup(e)
    e.orient("encompass")
    e.tags("no_item_gen no_monster_gen")
    e.kfeat("< = exit_wizlab")
end
}}
NAME: wizlab_iskenderun
TAGS: no_rotate no_hmirror no_vmirror
: vault_metal_statue_setup(_G, "G", "arcane conduit")
: wizlab_setup(_G)
MAP
xxxxxxxxxxx
xA<.x.....x
x.x.x.xxx.x
x.x...G...x
x.xxx.+.x.x
x.....x.x.x
xxx.x...x.x
x...xxx...x
xxxxxxxxxxx
ENDMAP
NAME: wizlab_golubria
TAGS: no_rotate no_hmirror no_vmirror
: wizlab_setup(_G)
MAP
xxxxxxxxxxx
xA<.......x
x.xxxxxxx.x
x.x.....x.x
x.x.xxx.x.x
x.x.....x.x
x.xxxxxxx.x
x.........x
xxxxxxxxxxx
ENDMAP
`;
    const dependencies = {
        [VAULT_LUA_PATH]: String.raw`
function vault_metal_statue_setup(e, glyph, type)
    e.kfeat(glyph .. " = metal_statue")
    e.colour(glyph .. " = vehumet")
    e.tile(glyph .. " = arcane_conduit")
    e.set_feature_name("metal_statue", type)
end
`
    };
    const parsed = parseRuntimeDes(source, {
        path: WIZLAB_PATH,
        dependencies
    });
    assert.deepEqual(parsed.map(template => template.name), [
        'wizlab_iskenderun',
        'wizlab_golubria'
    ]);
    const iskenderun = parsed[0];
    assert.equal(
        iskenderun.metadata.sourceAudit,
        'wizlab-coarse-terrain-v1'
    );
    assert.equal(iskenderun.metadata.entryAnchorGlyph, 'A');
    assert.equal(iskenderun.metadata.entryAnchorObservedKind, 'floor');
    assert.deepEqual(
        iskenderun.grid.flat().find(cell => cell?.glyph === 'G').kinds,
        ['statue']
    );

    const templates = selectSafeTemplates(
        parsed,
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: 0, y: 0}}
    );
    const anchor = {x: 1, y: 1};
    const observations = [];
    iskenderun.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (cell?.kinds?.length === 1 && (x + y) % 2 === 0) {
            observations.push({
                x: x - anchor.x,
                y: y - anchor.y,
                kind: cell.kinds[0]
            });
        }
    }));
    const matcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 20,
        minScore: 0.98,
        minEvidenceCells: 20,
        minEvidenceWeight: 20,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        requireExhaustivePlacement: true
    });
    matcher.setTemplates(templates);
    const result = matcher.updateObservations(observations);

    assert.equal(result.best.template.name, 'wizlab_iskenderun');
    assert.equal(result.best.score, 1);
    assert.equal(result.ready, true);
    assert.ok(result.forcePredictions.length > 0);
    assert.equal(result.forcePredictions.some(cell =>
        ['void', 'unknown'].includes(cell.kind)), false);

    const changedDependencies = {
        [VAULT_LUA_PATH]: dependencies[VAULT_LUA_PATH].replace(
            'glyph .. " = metal_statue"',
            'glyph .. " = lava"'
        )
    };
    const changed = parseRuntimeDes(source, {
        path: WIZLAB_PATH,
        dependencies: changedDependencies
    });
    const changedIskenderun = changed.find(template =>
        template.name === 'wizlab_iskenderun');
    assert.equal(
        changedIskenderun.metadata.sourceAudit,
        'wizlab-detection-only-v1'
    );
    assert.equal(
        changedIskenderun.metadata.matchPolicy.revealDisabled,
        true
    );
    assert.equal(
        changedIskenderun.metadata.matchPolicy.forceRevealDisabled,
        true
    );

    const changedTemplates = selectSafeTemplates(
        changed,
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: 0, y: 0}}
    );
    const changedMatcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 20,
        minScore: 0.98,
        minEvidenceCells: 20,
        minEvidenceWeight: 20,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        requireExhaustivePlacement: true
    });
    changedMatcher.setTemplates(changedTemplates);
    const changedResult = changedMatcher.updateObservations(observations);
    assert.equal(changedResult.best.template.name, 'wizlab_iskenderun');
    assert.equal(changedResult.reason, 'policy-disabled');
    assert.deepEqual(changedResult.predictions, []);
    assert.deepEqual(changedResult.forcePredictions, []);
});

test('Golubria falls back to the packet level entry without collapsing symmetry', () => {
    const golubria = fixtureTemplate();
    golubria.name = 'wizlab_golubria';
    const [selected] = selectSafeTemplates(
        [golubria],
        {place: 'a Wizlab', depth: 0},
        {levelEntry: {x: 5, y: -7}}
    );

    assert.deepEqual(selected.metadata.matchAnchor, {
        x: 5,
        y: -7,
        glyph: 'A',
        requireObservedKind: 'floor'
    });
});

test('worker result serialization omits transformed grids and candidate payloads', () => {
    const template = fixtureTemplate();
    const compact = compactMatcherResult({
        ready: true,
        unique: true,
        reason: 'ready',
        margin: 1,
        plausibleCandidateCount: 1,
        consensusOverflow: false,
        best: {
            template,
            transformed: {grid: template.grid},
            score: 1,
            evidenceCells: 20,
            evidenceWeight: 20,
            distinctKinds: 4,
            transform: 'identity',
            placementSearch: 'exhaustive',
            offsetX: 1,
            offsetY: 2
        },
        candidates: [{transformed: {grid: template.grid}}],
        predictions: [{x: 3, y: 4, kind: 'wall'}],
        forcePredictions: [{x: 5, y: 6, kind: 'floor'}]
    });

    assert.deepEqual(compact.best.template, {
        name: template.name,
        path: template.path
    });
    assert.equal(compact.best.transformed, undefined);
    assert.equal(compact.best.placementSearch, 'exhaustive');
    assert.equal(compact.best.template.grid, undefined);
    assert.equal(compact.candidates, undefined);
    assert.deepEqual(compact.predictions, [{x: 3, y: 4, kind: 'wall'}]);
    assert.deepEqual(compact.forcePredictions, [
        {x: 5, y: 6, kind: 'floor'}
    ]);
});

test('safe templates honor PLACE and DEPTH selectors for the current floor', () => {
    const end = fixtureTemplate();
    end.name = 'slime_end';
    end.metadata.place = 'Slime:$';
    end.metadata.depth = null;
    const middle = structuredClone(end);
    middle.name = 'slime_middle';
    middle.metadata.place = null;
    middle.metadata.depth = 'Slime:2-, !Slime:$';
    const tombTwo = structuredClone(end);
    tombTwo.name = 'tomb_two';
    tombTwo.metadata.place = 'Tomb:2';

    assert.deepEqual(
        selectSafeTemplates([end, middle], {place: 'Slime', depth: 3})
            .map(template => template.name),
        ['slime_middle']
    );
    assert.deepEqual(
        selectSafeTemplates([end, middle], {place: 'Slime', depth: 5})
            .map(template => template.name),
        ['slime_end']
    );
    assert.deepEqual(
        selectSafeTemplates([tombTwo], {place: 'Tomb', depth: 1}),
        []
    );
    assert.deepEqual(
        selectSafeTemplates([tombTwo], {place: 'Tomb', depth: 2}),
        [tombTwo]
    );
});

test('eligible PLACE primaries take priority over DEPTH-only layouts', () => {
    const placePrimary = fixtureTemplate();
    placePrimary.name = 'depths_place_primary';
    placePrimary.metadata.place = 'Depths:$';
    placePrimary.metadata.depth = null;
    const depthLayout = structuredClone(placePrimary);
    depthLayout.name = 'depths_depth_layout';
    depthLayout.metadata.place = null;
    depthLayout.metadata.depth = 'Depths';

    assert.deepEqual(
        selectSafeTemplates(
            [depthLayout, placePrimary],
            {place: 'Depths', depth: 4}
        ).map(template => template.name),
        ['depths_place_primary']
    );
    assert.deepEqual(
        selectSafeTemplates(
            [depthLayout, placePrimary],
            {place: 'Depths', depth: 3}
        ).map(template => template.name),
        ['depths_depth_layout']
    );
});

test('module loads exact-version sources, infers a map, and reveals locally', async () => {
    const {module, adapter, commands, messages, template} = createHarness();
    assert.equal(module.matcher.options.requireExhaustivePlacement, true);
    module.onLoad();
    assert.equal(adapter.installed, true);
    assert.ok(commands.has('/reveal'));
    assert.ok(commands.has('/force_reveal'));
    assert.ok(commands.has('/reveal_status'));

    transitionToWizlab(module);
    await module.prepareVersion(
        'Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e'
    );
    assert.equal(module.getDebugState().templates.length, 1);
    assert.equal(module.getDebugState().revision, FULL_SHA);

    const {cells, binding} = observedFixtureCells(template, -3, -2);
    module.onKnowledge(cells, binding);
    module.handleResult(module.matcher.evaluate());

    const state = module.getDebugState();
    assert.equal(state.status, 'map-inferred');
    assert.equal(state.match.name, 'integration_wizlab');
    assert.equal(state.match.offsetX, -3);
    assert.equal(state.match.offsetY, -2);
    assert.ok(state.predictionCount >= 5);
    assert.equal(adapter.revealEnabled, true);
    assert.equal(messages.filter(message => message.includes('Automatically mapped')).length, 1);

    commands.get('/reveal').handler();
    assert.equal(adapter.revealEnabled, false);
    assert.match(messages.at(-1), /cleared from the client/);

    const observationsBeforeReload = module.matcher.observations.size;
    await module.reloadSources();
    assert.equal(module.matcher.observations.size, observationsBeforeReload);
    assert.equal(module.getDebugState().templates.length, 1);
    assert.equal(module.getDebugState().match.name, 'integration_wizlab');
    // Reload only rebuilds immutable source/worker state; it preserves the
    // user's current reveal choice for this level.
    assert.equal(adapter.revealEnabled, false);

    const observationsBeforeForget = module.matcher.observations.size;
    module.onKnowledge([{
        x: cells[0].x,
        y: cells[0].y,
        cell: {f: 0, mf: 0}
    }], binding);
    assert.equal(module.matcher.observations.size, observationsBeforeForget - 1);

    module.onMap({clear: true});
    assert.equal(adapter.revealEnabled, false);
    assert.equal(module.matcher.observations.size, 0);
    assert.equal(adapter.predictions.length, 0);
});

test('force reveal maps the best rejected placement and reports detailed status', () => {
    const {module, adapter, commands, messages, template} = createHarness();
    module.onLoad();
    const forcedCells = Array.from({length: 6}, (_, index) => ({
        x: index,
        y: 4,
        kind: index === 0 ? 'wall' : 'floor'
    }));
    module.templates = [template];
    module.handleResult({
        ready: false,
        unique: true,
        reason: 'policy-disabled',
        margin: 0.031,
        plausibleCandidateCount: 3,
        consensusOverflow: false,
        best: {
            template: {name: template.name, path: template.path},
            score: 0.91,
            evidenceCells: 14,
            evidenceWeight: 16,
            distinctKinds: 3,
            coverage: 0.2,
            transform: 'r0h',
            offsetX: -7,
            offsetY: 2
        },
        predictions: [],
        forcePredictions: forcedCells
    });

    assert.equal(module.getDebugState().status, 'map-provisional');
    assert.equal(module.getDebugState().predictionMode, 'provisional');
    assert.equal(adapter.revealEnabled, true);
    assert.deepEqual(
        adapter.predictions.map(({x, y, kind}) => ({x, y, kind})),
        forcedCells
    );
    commands.get('/reveal').handler();
    assert.equal(adapter.revealEnabled, false);
    commands.get('/reveal_status').handler();
    assert.match(messages.at(-1), /unaccepted candidate/);
    assert.match(messages.at(-1), /91\.00%/);
    assert.match(messages.at(-1), /3 plausible/);
    assert.match(messages.at(-1), /6 force cells/);
    assert.match(messages.at(-1), /policy-disabled/);

    commands.get('/force_reveal').handler();
    assert.equal(module.forceRevealActive, true);
    assert.equal(adapter.revealEnabled, true);
    assert.deepEqual(adapter.predictions.map(({x, y, kind}) => ({x, y, kind})), forcedCells);
    assert.match(messages.at(-1), /UNSAFE FORCE/);
    assert.match(messages.at(-1), /AMBIGUOUS/);

    commands.get('/force_reveal').handler();
    assert.equal(module.forceRevealActive, false);
    // Leaving explicit force restores the manual OFF state that preceded it.
    assert.equal(adapter.revealEnabled, false);
    assert.deepEqual(
        adapter.predictions.map(({x, y, kind}) => ({x, y, kind})),
        forcedCells
    );
    assert.match(messages.at(-1), /Forced terrain cleared/);

    module.handleResult({
        ...module.result,
        forcePredictions: []
    });
    commands.get('/force_reveal').handler();
    assert.match(messages.at(-1), /no unrevealed inferred cells left/);
    assert.doesNotMatch(messages.at(-1), /No candidate placement/);
});

test('detection-only and force-disabled results stay hidden automatically', () => {
    const {module, adapter, template} = createHarness();
    module.onLoad();
    module.templates = [template];
    module.handleResult({
        ready: false,
        unique: true,
        reason: 'policy-disabled',
        best: {
            template: {name: template.name, path: template.path},
            score: 1,
            transform: 'identity',
            offsetX: 0,
            offsetY: 0
        },
        predictions: [],
        // The matcher emits this empty array for forceRevealDisabled and
        // failed-audit detection-only templates.
        forcePredictions: []
    });

    assert.equal(module.getDebugState().status, 'matching');
    assert.equal(module.getDebugState().predictionMode, 'none');
    assert.equal(adapter.revealEnabled, false);
    assert.deepEqual(adapter.predictions, []);
});

test('manual reveal OFF latches across later provisional candidate updates', () => {
    const {module, adapter, template} = createHarness();
    module.onLoad();
    module.templates = [template];
    const provisional = {
        ...compactReadyResult(template),
        ready: false,
        reason: 'below-threshold',
        predictions: [],
        forcePredictions: [{x: 1, y: 2, kind: 'floor'}]
    };

    module.handleResult(provisional);
    assert.equal(adapter.revealEnabled, true);
    assert.equal(module.toggleReveal(), false);

    module.handleResult({
        ...provisional,
        best: {...provisional.best, score: 0.94, offsetX: 3},
        forcePredictions: [{x: 4, y: 2, kind: 'wall'}]
    });
    assert.equal(adapter.revealEnabled, false);
    assert.equal(module.autoRevealApplied, true);
    assert.deepEqual(
        adapter.predictions.map(({x, y, kind}) => ({x, y, kind})),
        [{x: 4, y: 2, kind: 'wall'}]
    );
});

test('leaving force reveal restores an accepted safe auto reveal', () => {
    const {module, adapter, template} = createHarness();
    module.onLoad();
    module.templates = [template];
    const safe = {
        ...compactReadyResult(template),
        forcePredictions: Array.from({length: 6}, (_, index) => ({
            x: index,
            y: 9,
            kind: index === 0 ? 'wall' : 'floor'
        }))
    };
    module.handleResult(safe);
    assert.equal(adapter.revealEnabled, true);

    module.toggleForceReveal();
    assert.equal(module.forceRevealActive, true);
    module.toggleForceReveal();

    assert.equal(module.forceRevealActive, false);
    assert.equal(adapter.revealEnabled, true);
    assert.deepEqual(
        adapter.predictions.map(({x, y, kind}) => ({x, y, kind})),
        safe.predictions
    );
});

test('only an observed level transition installs and preserves an entry anchor', async () => {
    const anchored = fixtureTemplate();
    const {module} = createHarness({templates: [anchored]});

    module.onPlayer({place: 'Dungeon', depth: 1, pos: {x: 0, y: 0}});
    await module.prepareVersion(
        'Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e'
    );
    module.onPlayer({place: 'a Wizlab', depth: 0, pos: {x: 7, y: 9}});
    module.onMap({clear: true});
    await waitUntil(() => module.getDebugState().templates.length === 1);
    assert.equal(
        module.getDebugState().levelSignals.levelEntryFromPlace,
        'dungeon'
    );
    assert.deepEqual(module.templates[0].metadata.matchAnchor, {
        x: 7,
        y: 9,
        glyph: 'A',
        requireObservedKind: 'floor'
    });

    // A same-level full resync or wizard recreation is not evidence that the
    // current position is an entry glyph, so it must remove the old anchor.
    module.onPlayer({place: 'a Wizlab', depth: 0, pos: {x: -4, y: 3}});
    module.onMap({clear: true});
    await waitUntil(() => module.getDebugState().templates.length === 1);

    assert.equal(module.getDebugState().levelSignals.levelEntry, undefined);
    assert.equal(module.awaitingLevelEntry, false);
    assert.equal(module.templates[0].metadata.matchAnchor, undefined);
    module.destroy();
});

test('the Slime wall-collapse message invalidates inferred end terrain', async () => {
    const template = fixtureTemplate();
    template.name = 'slime_end_fixture';
    template.metadata.place = 'Slime:$';
    const path = 'crawl-ref/source/dat/des/branches/slime.des';
    let parsedRequests = 0;
    const neverReloads = new Promise(() => {});
    const repository = {
        cache: {close() {}},
        async prepare(versionText) {
            return {revision: FULL_SHA, fullSha: FULL_SHA, versionText};
        },
        async getManifest() {
            return {revision: FULL_SHA, fullSha: FULL_SHA, paths: [path]};
        },
        selectPaths() {
            return [path];
        },
        async getParsed() {
            parsedRequests++;
            return parsedRequests === 1 ? [template] : neverReloads;
        }
    };
    const adapter = new FakeAdapter();
    const module = new MapPredictor({
        repository,
        adapter,
        useWorker: false,
        evaluationDelay: 0
    });

    module.onPlayer({place: 'Slime', depth: 5, pos: {x: 2, y: 3}});
    await module.prepareVersion(
        'Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e'
    );
    assert.deepEqual(module.getDebugState().templates, ['slime_end_fixture']);

    module.handleResult(compactReadyResult(template));
    assert.equal(adapter.predictions.length, 5);
    adapter.setRevealEnabled(true);
    module.onMessages([{
        text: 'The stone walls suddenly <b>crumble and collapse.</b>'
    }]);

    const state = module.getDebugState();
    assert.equal(state.levelSignals.invalidated, true);
    assert.deepEqual(state.templates, []);
    assert.equal(state.predictionCount, 0);
    assert.equal(state.revealEnabled, false);
    assert.equal(state.status, 'no-safe-templates');
    assert.equal(parsedRequests, 2);
    module.destroy();
});

test('later contradictory terrain demotes a safe map to a provisional candidate', async () => {
    const {module, adapter, template} = createHarness();
    module.onLoad();
    transitionToWizlab(module);
    await module.prepareVersion('Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e');

    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    module.handleResult(module.matcher.evaluate());
    assert.equal(module.getDebugState().status, 'map-inferred');
    assert.ok(adapter.predictions.length >= 5);

    const contradictory = observed.cells.map(entry => ({
        ...entry,
        cell: {
            f: 1,
            mf: entry.cell.mf === observed.binding.enums.MF_WALL
                ? observed.binding.enums.MF_FLOOR
                : observed.binding.enums.MF_WALL
        }
    }));
    module.onKnowledge(contradictory, observed.binding);
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(module.getDebugState().status, 'map-provisional');
    assert.notEqual(module.getDebugState().resultReason, 'ready');
    assert.equal(module.getDebugState().predictionMode, 'provisional');
    assert.ok(adapter.predictions.length > 0);
});

test('unsupported places fail closed without source requests or predictions', async () => {
    const {module, adapter} = createHarness();
    module.onPlayer({place: 'Dungeon', depth: 3});
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');

    const state = module.getDebugState();
    assert.equal(state.status, 'unsupported-place');
    assert.deepEqual(state.sourcePaths, []);
    assert.deepEqual(state.templates, []);
    assert.deepEqual(adapter.predictions, []);
});

test('large candidate inventories fail closed before synchronous matching', async () => {
    const templates = Array.from({length: 3}, (_, index) => {
        const candidate = structuredClone(fixtureTemplate());
        candidate.name = `candidate_${index}`;
        return candidate;
    });
    const {module, adapter} = createHarness({templates, maxTemplates: 2});
    module.onPlayer({place: 'a Wizlab', depth: 0});
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');

    assert.equal(module.getDebugState().status, 'too-many-candidates');
    assert.deepEqual(module.getDebugState().templates, []);
    assert.deepEqual(adapter.predictions, []);
});

test('synchronous fallback admits the exact 94-map Temple catalog only within audited headroom', async () => {
    const templates = Array.from({length: 94}, (_, index) => {
        const candidate = structuredClone(fixtureTemplate());
        candidate.name = `temple_catalog_${index}`;
        return candidate;
    });
    const accepted = createHarness({templates, useWorker: false}).module;
    accepted.onPlayer({place: 'a Wizlab', depth: 0});
    await accepted.prepareVersion('0.35-a0-355-g7480fdf97e');

    assert.equal(accepted.maxTemplates, 112);
    assert.equal(accepted.syncMaxTemplates, 96);
    assert.equal(accepted.getDebugState().status, 'matching');
    assert.equal(accepted.getDebugState().templates.length, 94);
    accepted.destroy();

    const unexpectedGrowth = Array.from({length: 97}, (_, index) => {
        const candidate = structuredClone(fixtureTemplate());
        candidate.name = `unexpected_catalog_${index}`;
        return candidate;
    });
    const rejected = createHarness({
        templates: unexpectedGrowth,
        useWorker: false
    }).module;
    rejected.onPlayer({place: 'a Wizlab', depth: 0});
    await rejected.prepareVersion('0.35-a0-355-g7480fdf97e');

    assert.equal(rejected.getDebugState().status, 'too-many-candidates');
    assert.deepEqual(rejected.getDebugState().templates, []);
    rejected.destroy();
});

test('a new version immediately invalidates an older in-flight source load', async () => {
    const oldTemplate = fixtureTemplate();
    oldTemplate.name = 'old_template';
    const newTemplate = fixtureTemplate();
    newTemplate.name = 'new_template';
    let resolveOld;
    let markOldStarted;
    const oldStarted = new Promise(resolve => {
        markOldStarted = resolve;
    });
    const oldParsed = new Promise(resolve => {
        resolveOld = resolve;
    });
    const repository = {
        cache: {close() {}},
        async prepare(text) {
            const revision = text === 'version-a' ? 'a' : 'b';
            return {revision, fullSha: revision, versionText: text};
        },
        async getManifest(build) {
            return {revision: build.revision, paths: [WIZLAB_PATH]};
        },
        selectPaths() {
            return [WIZLAB_PATH];
        },
        async getParsed(build) {
            if (build.revision === 'a') {
                markOldStarted();
                return oldParsed;
            }
            return [newTemplate];
        }
    };
    const adapter = new FakeAdapter();
    const module = new MapPredictor({repository, adapter});
    module.onPlayer({place: 'a Wizlab', depth: 0});

    module.onVersion('version-a');
    await oldStarted;
    module.onVersion('version-b');
    await waitUntil(() => module.getDebugState().templates.includes('new_template'));
    resolveOld([oldTemplate]);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(module.getDebugState().revision, 'b');
    assert.deepEqual(module.getDebugState().templates, ['new_template']);
});

test('the first version packet preserves map evidence received during reconnect', async () => {
    const {module, template} = createHarness();
    module.onPlayer({place: 'a Wizlab', depth: 0, pos: {x: 0, y: 0}});
    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    const before = module.matcher.observations.size;
    assert.ok(before > 0);

    module.onVersion(
        'Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e'
    );
    await waitUntil(() => module.getDebugState().templates.length === 1);

    assert.equal(module.matcher.observations.size, before);
    assert.equal(module.getDebugState().observationCount, before);
    assert.equal(module.getDebugState().levelSignals.levelEntry, undefined);
    assert.equal(module.templates[0].metadata.matchAnchor, undefined);
    assert.ok(module.getDebugState().predictionCount > 0);
    assert.equal(module.getDebugState().predictionMode, 'provisional');
    assert.equal(module.getDebugState().resultReason, 'placement-unverified');
    module.destroy();
});

test('module worker configures once and evaluates observation snapshots in background', async () => {
    FakeWorker.instances = [];
    const {module, adapter, template} = createHarness({
        useWorker: true,
        workerOptions: {WorkerClass: FakeWorker}
    });
    transitionToWizlab(module);
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');

    assert.equal(FakeWorker.instances.length, 1);
    const worker = FakeWorker.instances[0];
    assert.match(String(worker.url), /matcher-worker\.js$/u);
    assert.equal(worker.options.type, 'module');
    const configure = worker.messages.find(message => message.type === 'configure');
    assert.ok(configure);
    assert.equal(configure.templates.length, 1);
    assert.equal(module.matcher.preparedTemplates.length, 0);
    worker.emit({
        type: 'configured',
        versionGeneration: configure.versionGeneration,
        levelGeneration: configure.levelGeneration,
        templateGeneration: configure.templateGeneration
    });

    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    await waitUntil(() => worker.messages.some(message => message.type === 'evaluate'));
    const evaluate = worker.messages.find(message => message.type === 'evaluate');
    assert.equal(evaluate.templates, undefined);
    assert.equal(evaluate.observations.length, module.matcher.observations.size);
    worker.emit({
        type: 'result',
        requestId: evaluate.requestId,
        versionGeneration: evaluate.versionGeneration,
        levelGeneration: evaluate.levelGeneration,
        templateGeneration: evaluate.templateGeneration,
        observationRevision: evaluate.observationRevision,
        result: compactReadyResult(template)
    });

    assert.equal(module.getDebugState().workerActive, true);
    assert.equal(module.getDebugState().workerStatus, 'ready');
    assert.equal(module.getDebugState().status, 'map-inferred');
    assert.equal(adapter.predictions.length, 5);
    assert.equal(worker.messages.filter(message => message.type === 'configure').length, 1);
});

test('worker coalesces updates and ignores a stale result after level reset', async () => {
    FakeWorker.instances = [];
    const {module, adapter, template} = createHarness({
        useWorker: true,
        workerOptions: {WorkerClass: FakeWorker}
    });
    transitionToWizlab(module);
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');
    const worker = FakeWorker.instances[0];
    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    await waitUntil(() => worker.messages.some(message => message.type === 'evaluate'));
    const first = worker.messages.find(message => message.type === 'evaluate');

    module.onKnowledge([{
        ...observed.cells[0],
        cell: {f: 1, mf: observed.binding.enums.MF_FLOOR}
    }], observed.binding);
    await waitUntil(() => module.getDebugState().workerStatus === 'queued');
    assert.equal(worker.messages.filter(message => message.type === 'evaluate').length, 1);

    module.resetLevel({keepTemplates: true, keepReveal: false});
    worker.emit({
        type: 'result',
        requestId: first.requestId,
        versionGeneration: first.versionGeneration,
        levelGeneration: first.levelGeneration,
        templateGeneration: first.templateGeneration,
        observationRevision: first.observationRevision,
        result: compactReadyResult(template)
    });
    assert.deepEqual(adapter.predictions, []);
    await waitUntil(() => worker.messages.filter(message => message.type === 'evaluate').length === 2);
    const second = worker.messages.filter(message => message.type === 'evaluate')[1];
    assert.ok(second.levelGeneration > first.levelGeneration);
    assert.deepEqual(second.observations, []);
});

test('a stale worker error releases the in-flight slot after level reset', async () => {
    FakeWorker.instances = [];
    const {module, template} = createHarness({
        useWorker: true,
        workerOptions: {WorkerClass: FakeWorker}
    });
    transitionToWizlab(module);
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');
    const worker = FakeWorker.instances[0];
    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    await waitUntil(() => worker.messages.some(message => message.type === 'evaluate'));
    const first = worker.messages.find(message => message.type === 'evaluate');

    module.resetLevel({keepTemplates: true, keepReveal: false});
    module.onKnowledge([observed.cells[0]], observed.binding);
    await waitUntil(() => module.getDebugState().workerStatus === 'queued');
    worker.emit({
        type: 'error',
        phase: 'evaluate',
        requestId: first.requestId,
        versionGeneration: first.versionGeneration,
        levelGeneration: first.levelGeneration,
        templateGeneration: first.templateGeneration,
        observationRevision: first.observationRevision,
        error: {code: 'old-level-error', message: 'old level failed'}
    });

    await waitUntil(() => worker.messages.filter(message =>
        message.type === 'evaluate').length === 2);
    assert.equal(module.getDebugState().workerActive, true);
    assert.notEqual(module.getDebugState().workerStatus, 'fallback');
});

test('worker construction failure safely falls back to synchronous matching', async () => {
    class ThrowingWorker {
        constructor() {
            throw new Error('blocked by worker-src');
        }
    }

    const {module, adapter, template} = createHarness({
        useWorker: true,
        workerOptions: {WorkerClass: ThrowingWorker}
    });
    transitionToWizlab(module);
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');
    assert.equal(module.getDebugState().workerActive, false);
    assert.equal(module.getDebugState().workerStatus, 'fallback');
    assert.match(module.getDebugState().worker.failure.message, /worker-src/u);

    const observed = observedFixtureCells(template, -3, -2);
    module.onKnowledge(observed.cells, observed.binding);
    await waitUntil(() => module.getDebugState().status === 'map-inferred');
    assert.ok(adapter.predictions.length >= 5);
});

test('cross-origin blob worker bootstrap is revoked and terminated on destroy', async () => {
    FakeWorker.instances = [];
    const blobs = [];
    const revoked = [];
    class FakeBlob {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
            blobs.push(this);
        }
    }
    const urlApi = {
        createObjectURL() {
            return 'blob:https://crawl.example/matcher-worker';
        },
        revokeObjectURL(url) {
            revoked.push(url);
        }
    };
    const {module, adapter} = createHarness({
        useWorker: true,
        workerOptions: {
            WorkerClass: FakeWorker,
            BlobClass: FakeBlob,
            urlApi,
            location: {origin: 'https://crawl.example'}
        }
    });
    transitionToWizlab(module);
    await module.prepareVersion('0.35-a0-355-g7480fdf97e');

    const worker = FakeWorker.instances[0];
    assert.equal(String(worker.url), 'blob:https://crawl.example/matcher-worker');
    assert.match(blobs[0].parts[0], /import .*matcher-worker\.js/u);
    assert.equal(module.getDebugState().worker.mode, 'blob-module');

    module.destroy();
    assert.equal(worker.terminated, true);
    assert.deepEqual(revoked, ['blob:https://crawl.example/matcher-worker']);
    assert.equal(module.getDebugState().workerStatus, 'destroyed');
    assert.equal(module.getDebugState().workerActive, false);
    assert.equal(adapter.destroyed, true);
});
