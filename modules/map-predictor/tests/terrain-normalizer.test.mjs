import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeWebtilesCell,
    normalizeWebtilesKnowledgeUpdate,
    normalizeWebtilesKnowledgeUpdates
} from '../terrain-normalizer.js';

const enums = {
    MF_FLOOR: 1,
    MF_WALL: 2,
    MF_MAP_FLOOR: 3,
    MF_MAP_WALL: 4,
    MF_DOOR: 5,
    MF_STAIR_UP: 12,
    MF_STAIR_DOWN: 13,
    MF_STAIR_BRANCH: 14,
    MF_WATER: 16,
    MF_LAVA: 17,
    MF_DEEP_WATER: 22,
    MF_PORTAL: 23
};

test('known minimap terrain becomes matcher evidence', () => {
    assert.deepEqual(normalizeWebtilesCell({x: 2, y: 3, f: 1, mf: 2}, {enums}), {
        x: 2,
        y: 3,
        kind: 'wall'
    });
});

test('unseen feature zero is ignored even with an explore minimap value', () => {
    assert.equal(normalizeWebtilesCell({x: 2, y: 3, f: 0, mf: 1}, {enums}), null);
});

test('background terrain recovers the floor beneath an item or monster minimap value', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_MAX: 20,
        DNGN_FLOOR: 2,
        basetile: value => value
    };
    const result = normalizeWebtilesCell({x: 4, y: 5, f: 1, mf: 6, t: {bg: 2}}, {enums, dngn});
    assert.equal(result.kind, 'floor');
});

test('prepared background flag objects retain their base tile', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_MAX: 20,
        DNGN_ROCK_WALL: 13,
        basetile: value => value
    };
    const result = normalizeWebtilesCell({x: 1, y: 1, f: 1, mf: 9, t: {bg: {value: 13}}}, {enums, dngn});
    assert.equal(result.kind, 'wall');
});

test('arches and transporters use the same coarse kinds as DES templates', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_MAX: 20,
        DNGN_STONE_ARCH: 30,
        DNGN_TRANSPORTER: 31,
        basetile: value => value
    };
    assert.equal(normalizeWebtilesCell({
        x: 0,
        y: 0,
        f: 1,
        mf: enums.MF_FLOOR,
        t: {bg: 30}
    }, {enums, dngn}).kind, 'floor');
    assert.equal(normalizeWebtilesCell({
        x: 1,
        y: 0,
        f: 1,
        mf: enums.MF_FLOOR,
        t: {bg: 31}
    }, {enums, dngn}).kind, 'portal');
});

test('branch entrance tiles are stairs while Vaults and Zot gates stay portals', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_MAX: 20,
        DNGN_ENTER: 30,
        DNGN_RETURN: 31,
        DNGN_ENTER_LAIR: 32,
        DNGN_EXIT_TEMPLE: 33,
        DNGN_ENTER_ORC: 34,
        DNGN_RETURN_DEPTHS: 35,
        DNGN_ENTER_VAULTS: 36,
        DNGN_ENTER_ZOT_OPEN: 37,
        basetile: value => value
    };

    for (const tile of [30, 31, 32, 33, 34, 35]) {
        assert.equal(normalizeWebtilesCell({
            x: tile,
            y: 0,
            f: 1,
            mf: enums.MF_PORTAL,
            t: {bg: tile}
        }, {enums, dngn}).kind, 'stair');
    }

    for (const tile of [36, 37]) {
        assert.equal(normalizeWebtilesCell({
            x: tile,
            y: 0,
            f: 1,
            mf: enums.MF_PORTAL,
            t: {bg: tile}
        }, {enums, dngn}).kind, 'portal');
    }
});

test('the live Geh:7 exit packet remains portal evidence for the Hell anchor', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_MAX: 20,
        DNGN_EXIT_GEHENNA: 3159,
        basetile: value => value
    };

    assert.deepEqual(normalizeWebtilesCell({
        x: 0,
        y: 0,
        f: 199,
        mf: enums.MF_PORTAL,
        t: {bg: [3159, 0]}
    }, {enums, dngn}), {
        x: 0,
        y: 0,
        kind: 'portal'
    });
});

test('generated floor and wall texture ranges follow Crawl tileinfo ordering', () => {
    const dngn = {
        DNGN_UNSEEN: 0,
        FLOOR_PEBBLE_LIGHTRED: 117,
        FLOOR_MAX: 1147,
        WALL_STONE_DARK: 2656,
        WALL_MAX: 2736,
        basetile: value => value >= 117 && value < 130 ? 117 : value
    };

    assert.equal(normalizeWebtilesCell({
        x: 0,
        y: 0,
        f: 33,
        mf: enums.MF_FLOOR,
        t: {bg: 125}
    }, {enums, dngn}).kind, 'floor');
    assert.equal(normalizeWebtilesCell({
        x: 1,
        y: 0,
        f: 9,
        mf: enums.MF_WALL,
        t: {bg: 2656}
    }, {enums, dngn}).kind, 'wall');
});

test('the FLOOR_MAX alias cannot hide the first wall tile and names are cached', () => {
    let scans = 0;
    const dngn = new Proxy({
        DNGN_UNSEEN: 0,
        FLOOR_MAX: 10,
        WALL_BRICK_DARK_1: 10,
        WALL_MAX: 20,
        basetile: value => value
    }, {
        ownKeys(target) {
            scans++;
            return Reflect.ownKeys(target);
        }
    });
    const cell = {x: 0, y: 0, f: 1, mf: enums.MF_FLOOR, t: {bg: 10}};

    assert.equal(normalizeWebtilesCell(cell, {enums, dngn}).kind, 'wall');
    assert.equal(normalizeWebtilesCell({...cell, x: 1}, {enums, dngn}).kind, 'wall');
    assert.equal(scans, 1);
});

test('knowledge updates preserve explicit unseen-cell tombstones', () => {
    const binding = {enums};
    assert.deepEqual(normalizeWebtilesKnowledgeUpdate({
        x: -2,
        y: 5,
        cell: {f: 1, mf: enums.MF_WALL},
        removed: false
    }, binding), {
        x: -2,
        y: 5,
        kind: 'wall',
        removed: false
    });
    assert.deepEqual(normalizeWebtilesKnowledgeUpdate({
        x: -2,
        y: 5,
        cell: {f: 0, mf: enums.MF_FLOOR},
        removed: true
    }, binding), {
        x: -2,
        y: 5,
        kind: null,
        removed: true
    });
    assert.deepEqual(normalizeWebtilesKnowledgeUpdate({
        x: 3,
        y: 4,
        f: null,
        mf: enums.MF_FLOOR
    }, binding), {
        x: 3,
        y: 4,
        kind: null,
        removed: true
    });
    assert.equal(normalizeWebtilesKnowledgeUpdate({
        x: 0,
        y: 0,
        cell: undefined,
        removed: false
    }, binding), null);
    assert.equal(normalizeWebtilesKnowledgeUpdates([
        {x: 0, y: 0, cell: {f: 0}, removed: true},
        {x: 1, y: 0, cell: undefined, removed: false}
    ], binding).length, 1);
});
