import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {allowedTransforms} from '../matcher.js';
import {PARSER_VERSION} from '../runtime.js';
import {
    materializeZigguratTemplates,
    sha256Ascii
} from '../ziggurat-destinations.js';

function pillarSpecs() {
    return [
        {name: 'free_2', width: 2, height: 2, centered: false},
        {name: 'free_3', width: 3, height: 3, centered: false},
        {name: 'free_5', width: 5, height: 5, centered: false},
        ...Array.from({length: 27}, (_, index) => ({
            name: `centred_${index}`,
            width: index % 7 + 1,
            height: index % 5 + 1,
            centered: true
        }))
    ];
}

function descriptor(matchAnchor = null) {
    return {
        name: 'ziggurat_generated_descriptor',
        width: 1,
        height: 1,
        grid: [[{kinds: ['wall'], certain: true, glyph: 'x'}]],
        metadata: {
            sourceAudit: 'ziggurat-lua-generator-descriptor-v1',
            zigguratFactory: {pillarSpecs: pillarSpecs()},
            ...(matchAnchor ? {matchAnchor} : {})
        }
    };
}

function repeatedCenteredDescriptor(width, height) {
    const value = descriptor();
    value.metadata.zigguratFactory.pillarSpecs = Array.from(
        {length: 30},
        (_, index) => ({
            name: `centered_${index}`,
            width,
            height,
            centered: true
        })
    );
    return value;
}

test('synchronous source hash agrees with Node SHA-256', () => {
    assert.equal(PARSER_VERSION, 'des-runtime-v23');
    for (const source of ['', 'abc', 'ziggurat\nMAP\nENDMAP\n']) {
        assert.equal(
            sha256Ascii(source),
            crypto.createHash('sha256').update(source).digest('hex')
        );
    }
    assert.equal(sha256Ascii('\u2603'), null);
});

test('lazy factory generates only the occupied Ziggurat floor', () => {
    const expectedCounts = new Map([[1, 5], [2, 5], [10, 10], [27, 25]]);
    const matchAnchor = {
        x: 3,
        y: -2,
        glyph: 'A',
        requireObservedKind: 'floor'
    };
    for (const [depth, expected] of expectedCounts) {
        const templates = materializeZigguratTemplates(
            [descriptor(matchAnchor)],
            {place: 'Ziggurat', depth}
        );
        assert.equal(templates.length, expected, `depth ${depth}`);
        for (const template of templates) {
            assert.equal(template.width, 80);
            assert.equal(template.height, 70);
            assert.deepEqual(template.metadata.matchAnchor, matchAnchor);
            assert.equal(template.metadata.ziggurat.depth, depth);
            assert.equal(allowedTransforms(template).length, 1);
            assert.equal(template.grid.flat().filter(cell =>
                cell?.glyph === 'A').length, 1);
            assert.equal(template.grid.flat().filter(cell =>
                cell?.glyph === 'P').length, 2);
            assert.equal(template.grid.flat().filter(cell =>
                cell?.glyph === '>').length, depth < 27 ? 1 : 0);
        }
    }
});

test('lazy factory fails closed for an invalid depth or descriptor', () => {
    assert.deepEqual(materializeZigguratTemplates([descriptor()], {depth: 0}), []);
    assert.deepEqual(materializeZigguratTemplates([descriptor()], {depth: 28}), []);
    const malformed = descriptor();
    malformed.metadata.zigguratFactory.pillarSpecs.pop();
    assert.deepEqual(
        materializeZigguratTemplates([malformed], {depth: 1}),
        []
    );
    const ordinary = {name: 'ordinary'};
    assert.deepEqual(
        materializeZigguratTemplates([ordinary], {depth: 1}),
        [ordinary]
    );
});

test('centered pillars mask their MAP_FLOAT footprint, not the Lua gate box', () => {
    const [even] = materializeZigguratTemplates(
        [repeatedCenteredDescriptor(2, 2)],
        {depth: 27}
    );
    for (const [x, y] of [[39, 34], [40, 34], [39, 35], [40, 35]]) {
        assert.deepEqual(even.grid[y][x].kinds, [], `${x},${y}`);
    }
    assert.deepEqual(even.grid[36][41].kinds, ['floor']);

    const [nonSquare] = materializeZigguratTemplates(
        [repeatedCenteredDescriptor(7, 5)],
        {depth: 27}
    );
    // place_map may rotate again after the Lua good_place gate, so both the
    // 7x5 and 5x7 centre-relative footprints must be excluded.
    for (const [x, y] of [[37, 33], [43, 37], [38, 32], [42, 38]]) {
        assert.deepEqual(nonSquare.grid[y][x].kinds, [], `${x},${y}`);
    }
});
