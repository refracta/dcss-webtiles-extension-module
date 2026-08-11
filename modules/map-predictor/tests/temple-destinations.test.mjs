import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import MapMatcher, {
    allowedTransforms,
    normalizeTerrainKind
} from '../matcher.js';
import {
    auditedTempleDestinationNames,
    auditedTempleDestinationTemplates
} from '../temple-destinations.js';

const TEMPLE_PATH = 'crawl-ref/source/dat/des/branches/temple.des';
const ROOTS = ['/tmp/dwem-crawl-d29', '/tmp/dwem-crawl-1b83']
    .filter(root => fs.existsSync(`${root}/${TEMPLE_PATH}`));
const exactSourcesAvailable = ROOTS.length === 2;

function exactSource(root = ROOTS[0]) {
    return fs.readFileSync(`${root}/${TEMPLE_PATH}`, 'utf8');
}

function normalizedKinds(cell) {
    const raw = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    if (raw.some(kind => ['unknown', 'void'].includes(String(kind)))) {
        return [];
    }
    return [...new Set(raw.map(normalizeTerrainKind).filter(Boolean))];
}

test('exact Temple catalog is closed and every candidate is entry-anchored', {
    skip: !exactSourcesAvailable
}, () => {
    for (const root of ROOTS) {
        const source = exactSource(root);
        const parsed = parseDes(source, {path: TEMPLE_PATH});
        const runtime = parseRuntimeDes(source, {path: TEMPLE_PATH});
        const selected = selectSafeTemplates(runtime, {
            place: 'Temple',
            depth: 1
        }, {levelEntry: {x: 17, y: -9}});
        const normal = selected.filter(template =>
            template.metadata.sourceAudit === 'temple-encompass-entry-v1');
        const detection = selected.filter(template =>
            template.metadata.sourceAudit === 'temple-detection-only-v1');

        assert.equal(parsed.filter(template =>
            template.metadata.place === 'Temple').length, 94, root);
        assert.equal(runtime.length, 94, root);
        assert.equal(selected.length, 94, root);
        assert.equal(normal.length, 53, root);
        assert.equal(detection.length, 41, root);
        assert.equal(normal.reduce((sum, template) =>
            sum + allowedTransforms(template).length, 0), 330, root);
        assert.equal(detection.reduce((sum, template) =>
            sum + allowedTransforms(template).length, 0), 281, root);
        assert.deepEqual(normal.map(template => template.name).sort(),
            [...auditedTempleDestinationNames].sort(), root);

        for (const template of selected) {
            assert.deepEqual(template.metadata.matchAnchor, {
                x: 17,
                y: -9,
                glyph: '{',
                requireObservedKind: 'stair'
            }, template.name);
        }
        for (const template of normal) {
            assert.notEqual(template.metadata.matchPolicy.revealDisabled,
                true, template.name);
        }
        for (const template of detection) {
            assert.equal(template.metadata.matchPolicy.revealDisabled,
                true, template.name);
            assert.equal(template.metadata.matchPolicy.forceRevealDisabled,
                true, template.name);
            assert.ok(template.metadata.coarseConstrainedCells >= 18,
                template.name);
            assert.ok(template.metadata.coarseEntryAnchorCells >= 1,
                template.name);
        }

        assert.deepEqual(
            Object.fromEntries(['wall', 'deep_water', 'lava'].map(kind => [
                kind,
                normal.filter(template =>
                    template.metadata.implicitFillKind === kind).length
            ])),
            {wall: 48, deep_water: 4, lava: 1},
            root
        );
        assert.equal(normal.reduce((sum, template) =>
            sum + template.metadata.implicitFillCells, 0), 12083, root);
    }
});
test('Temple source mutation fails closed instead of falling back to generic maps', {
    skip: !exactSourcesAvailable
}, () => {
    const source = exactSource();
    const mutated = source.replace(
        'NAME:        ebering_the_one_and_only',
        'NAME:        ebering_the_one_and_only_changed'
    );
    assert.notEqual(mutated, source);
    const parsed = parseDes(mutated, {path: TEMPLE_PATH});
    assert.deepEqual(auditedTempleDestinationTemplates(
        mutated,
        parsed,
        {path: TEMPLE_PATH}
    ), []);
    assert.deepEqual(parseRuntimeDes(mutated, {path: TEMPLE_PATH}), []);
});

test('Temple normal reveal needs a live stair observation at the trusted entry', {
    skip: !exactSourcesAvailable
}, () => {
    const source = exactSource();
    const selected = selectSafeTemplates(
        parseRuntimeDes(source, {path: TEMPLE_PATH}),
        {place: 'Temple', depth: 1},
        {levelEntry: {x: 0, y: 0}}
    );
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(selected);
    const result = matcher.updateObservations([
        {x: 0, y: 0, kind: 'floor'},
        {x: 1, y: 0, kind: 'floor'}
    ]);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'anchor-unverified');
    assert.deepEqual(result.predictions, []);
});

test('anchored Temple consensus reveals only withheld exact terrain', {
    skip: !exactSourcesAvailable
}, () => {
    const source = exactSource();
    const selected = selectSafeTemplates(
        parseRuntimeDes(source, {path: TEMPLE_PATH}),
        {place: 'Temple', depth: 1},
        {levelEntry: {x: 0, y: 0}}
    );
    const truth = selected.find(template =>
        template.name === 'nicolae_temple_stand_before_the_council');
    let anchor = null;
    truth.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (cell?.possibleGlyphs?.length === 1
            && cell.possibleGlyphs[0] === '{') {
            anchor = {x, y};
        }
    }));
    assert.ok(anchor);

    const actual = new Map();
    const observations = [];
    truth.grid.forEach((row, y) => row.forEach((cell, x) => {
        const kinds = normalizedKinds(cell);
        if (kinds.length !== 1) {
            return;
        }
        const world = {x: x - anchor.x, y: y - anchor.y};
        const key = `${world.x},${world.y}`;
        actual.set(key, kinds[0]);
        const withheld = ((Math.imul(x + 3, 31)
            ^ Math.imul(y + 7, 47)) >>> 0) % 5 === 0
            && kinds[0] !== 'stair';
        if (!withheld) {
            observations.push({...world, kind: kinds[0]});
        }
    }));

    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(selected);
    const result = matcher.updateObservations(observations);
    assert.equal(result.ready, true, result.reason);
    assert.equal(result.best.template.name, truth.name);
    assert.ok(result.predictions.length >= 40);
    for (const prediction of result.predictions) {
        assert.equal(actual.get(`${prediction.x},${prediction.y}`),
            prediction.kind, JSON.stringify(prediction));
    }
});
