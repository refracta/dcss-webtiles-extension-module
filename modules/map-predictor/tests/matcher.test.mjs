import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MapMatcher,
    allowedTransforms,
    transformTemplate
} from '../matcher.js';

function template(name, rows, metadata = {}) {
    return {
        name,
        width: rows[0].length,
        height: rows.length,
        grid: rows.map(row => [...row].map(kind => ({kinds: [kind]}))),
        metadata: {orient: 'encompass', encompass: true, tags: ['no_rotate', 'no_hmirror', 'no_vmirror'], ...metadata}
    };
}

test('transformTemplate rotates a rectangular grid without losing cells', () => {
    const source = template('shape', [
        ['wall', 'floor', 'door'],
        ['lava', 'water', 'stair']
    ], {orient: 'float', encompass: false, tags: []});
    const rotation = allowedTransforms(source).find(item => item.id.startsWith('r90'));
    const result = transformTemplate(source, rotation);

    assert.equal(result.width, 2);
    assert.equal(result.height, 3);
    assert.equal(result.grid.flat().length, 6);
});

test('no transform tags leave only the identity transform', () => {
    const source = template('fixed', [['wall']], {
        tags: ['no_rotate', 'no_hmirror', 'no_vmirror']
    });
    assert.deepEqual(allowedTransforms(source).map(item => item.id), ['r0']);
});

test('transform combinations match Crawl single-rotation semantics', () => {
    const rotationOnly = template('rotation-only', [['wall']], {
        tags: ['no_hmirror', 'no_vmirror']
    });
    assert.deepEqual(
        allowedTransforms(rotationOnly).map(item => item.id),
        ['r0', 'r90', 'r-90']
    );

    const oneMirror = template('one-mirror', [['wall']], {
        tags: ['no_vmirror']
    });
    assert.equal(allowedTransforms(oneMirror).length, 6);
});

test('rotation requires both original dimensions to fit Crawl GMINM', () => {
    const tooWide = template('cerebov-sized', [
        Array(73).fill('wall'),
        ...Array.from({length: 35}, () => Array(73).fill('floor'))
    ], {
        orient: 'north',
        encompass: false,
        tags: ['no_hmirror', 'no_vmirror']
    });
    assert.deepEqual(allowedTransforms(tooWide).map(item => item.id), ['r0']);

    const boundary = template('rotation-boundary', [
        Array(70).fill('wall'),
        ...Array.from({length: 35}, () => Array(70).fill('floor'))
    ], {
        orient: 'north',
        encompass: false,
        tags: ['no_hmirror', 'no_vmirror']
    });
    assert.deepEqual(
        allowedTransforms(boundary).map(item => item.id),
        ['r0', 'r90', 'r-90']
    );
});

test('matcher identifies a centred encompass map from informative terrain', () => {
    const first = template('first', [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'floor', 'door', 'floor', 'wall'],
        ['wall', 'floor', 'lava', 'floor', 'wall'],
        ['wall', 'floor', 'stair', 'floor', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall']
    ]);
    const second = template('second', [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'floor', 'floor', 'floor', 'wall'],
        ['wall', 'water', 'water', 'water', 'wall'],
        ['wall', 'floor', 'portal', 'floor', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall']
    ]);
    const matcher = new MapMatcher({
        worldWidth: 9,
        worldHeight: 9,
        minEvidenceCells: 8,
        minEvidenceWeight: 10,
        minScore: 0.95,
        minPredictedCells: 8
    });
    matcher.setTemplates([first, second]);
    const offset = 2;
    const observations = [];
    first.grid.forEach((row, y) => row.forEach((cell, x) => {
        if ((x + y) % 2 === 0 || ['door', 'lava', 'stair'].includes(cell.kinds[0])) {
            observations.push({x: x + offset, y: y + offset, kind: cell.kinds[0]});
        }
    }));
    const result = matcher.updateObservations(observations);

    assert.equal(result.ready, true);
    assert.equal(result.best.template.name, 'first');
    assert.ok(result.best.score >= 0.95);
    const observedKeys = new Set(observations.map(cell => `${cell.x},${cell.y}`));
    assert.ok(result.predictions.length >= 8);
    assert.equal(result.predictions.some(cell => observedKeys.has(`${cell.x},${cell.y}`)), false);
});

test('matcher does not unlock from featureless floor evidence', () => {
    const source = template('plain', [
        ['floor', 'floor', 'floor'],
        ['floor', 'floor', 'floor'],
        ['floor', 'floor', 'floor']
    ]);
    const matcher = new MapMatcher({
        worldWidth: 7,
        worldHeight: 7,
        minEvidenceCells: 3,
        minEvidenceWeight: 3
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 2, y: 2, kind: 'floor'},
        {x: 3, y: 2, kind: 'floor'},
        {x: 4, y: 2, kind: 'floor'},
        {x: 2, y: 3, kind: 'floor'}
    ]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'insufficient-evidence');
});

test('unconstrained parser cells provide neither anchors nor evidence', () => {
    const catchAll = {
        kinds: [
            'unknown',
            'wall',
            'floor',
            'door',
            'shallow_water',
            'deep_water',
            'lava',
            'stairs',
            'portal',
            'altar',
            'statue'
        ],
        certain: false
    };
    const source = template('dynamic', [['wall', 'wall'], ['wall', 'wall']]);
    source.grid = source.grid.map(row => row.map(() => structuredClone(catchAll)));
    const matcher = new MapMatcher({
        worldWidth: 5,
        worldHeight: 5,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 0, y: 0, kind: 'wall'},
        {x: 1, y: 0, kind: 'portal'},
        {x: 0, y: 1, kind: 'lava'}
    ]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'no-candidates');
    assert.deepEqual(result.predictions, []);
});

test('consensus fails closed when plausible candidates exceed the cap', () => {
    const source = template('repeated', [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall']
    ]);
    const matcher = new MapMatcher({
        worldWidth: 9,
        worldHeight: 9,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minWinnerMargin: 0.1,
        minPredictedCells: 1,
        maxConsensusCandidates: 2
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([{x: 0, y: 0, kind: 'wall'}]);

    assert.equal(result.consensusOverflow, true);
    assert.ok(result.plausibleCandidateCount > 2);
    assert.equal(result.ready, false);
    assert.deepEqual(result.predictions, []);
    assert.deepEqual(result.provisionalPredictions, []);
    assert.equal(result.structuralSingleton, false);
});

test('uncertain cells are only predicted when all surviving possibilities agree', () => {
    const source = template('uncertain', [
        ['wall', 'wall', 'wall'],
        ['wall', 'floor', 'wall'],
        ['wall', 'wall', 'wall']
    ]);
    source.grid[1][1] = {kinds: ['floor', 'lava'], certain: false};
    const matcher = new MapMatcher({
        worldWidth: 5,
        worldHeight: 5,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minScore: 0.9,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 1, y: 1, kind: 'wall'},
        {x: 2, y: 1, kind: 'wall'},
        {x: 3, y: 1, kind: 'wall'},
        {x: 1, y: 2, kind: 'wall'}
    ]);

    assert.equal(result.predictions.some(cell => cell.x === 2 && cell.y === 2), false);
});

test('void cells in an encompass map are never invented as walls', () => {
    const source = template('void-safe', [
        ['wall', 'door', 'wall'],
        ['floor', 'floor', 'floor'],
        ['wall', 'stair', 'wall']
    ]);
    source.grid[1][1] = null;
    const matcher = new MapMatcher({
        worldWidth: 7,
        worldHeight: 7,
        minEvidenceCells: 7,
        minEvidenceWeight: 8,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 2, y: 2, kind: 'wall'},
        {x: 3, y: 2, kind: 'door'},
        {x: 4, y: 2, kind: 'wall'},
        {x: 2, y: 3, kind: 'floor'},
        {x: 4, y: 3, kind: 'floor'},
        {x: 2, y: 4, kind: 'wall'},
        {x: 3, y: 4, kind: 'stair'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.predictions.some(cell => cell.x === 3 && cell.y === 3), false);
    assert.equal(result.predictions.every(cell =>
        cell.x >= 2 && cell.x <= 4 && cell.y >= 2 && cell.y <= 4), true);
});

test('an exact audited encompass border fills the 80x70 reset wall only', () => {
    const source = template('audited-reset-wall', [
        ['wall', 'wall', 'wall'],
        ['stair', 'floor', 'wall'],
        ['wall', 'floor', 'wall']
    ], {
        encompassBorderFillKind: 'wall',
        matchAnchor: {
            x: 2,
            y: 3,
            glyph: '__entry__',
            requireObservedKind: 'stair'
        },
        matchPolicy: {exhaustivePlacement: false}
    });
    source.grid[1][0].possibleGlyphs = ['__entry__'];
    // A literal MAP space inherits the reset wall. An explicit empty-kinds
    // object is an audited dynamic mask and must remain unrevealed.
    source.grid[1][1] = null;
    source.grid[2][1] = {kinds: [], possibleGlyphs: []};

    const matcher = new MapMatcher({
        worldWidth: 7,
        worldHeight: 7,
        requireExhaustivePlacement: true,
        minEvidenceCells: 4,
        minEvidenceWeight: 6,
        minDistinctKinds: 2,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 2, y: 3, kind: 'stair'},
        {x: 2, y: 2, kind: 'wall'},
        {x: 3, y: 2, kind: 'wall'},
        {x: 4, y: 3, kind: 'wall'}
    ]);

    assert.equal(result.ready, true);
    assert.ok(result.predictions.some(cell =>
        cell.x === 0 && cell.y === 0 && cell.kind === 'wall'));
    assert.ok(result.predictions.some(cell =>
        cell.x === 3 && cell.y === 3 && cell.kind === 'wall'));
    assert.equal(result.predictions.some(cell =>
        cell.x === 3 && cell.y === 4), false);
});

test('a floating fixed region can be located by translation', () => {
    const source = template('floating', [
        ['wall', 'door', 'wall'],
        ['floor', 'lava', 'floor'],
        ['wall', 'stair', 'wall']
    ], {orient: 'float', encompass: false});
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        minEvidenceCells: 7,
        minEvidenceWeight: 10,
        minDistinctKinds: 3,
        minScore: 0.95,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 5, y: 4, kind: 'wall'},
        {x: 6, y: 4, kind: 'door'},
        {x: 7, y: 4, kind: 'wall'},
        {x: 5, y: 5, kind: 'floor'},
        {x: 6, y: 5, kind: 'lava'},
        {x: 7, y: 5, kind: 'floor'},
        {x: 6, y: 6, kind: 'stair'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.offsetX, 5);
    assert.equal(result.best.offsetY, 4);
});

test('translated partial-vault ambiguity never reveals either non-overlapping footprint', () => {
    const source = template('repeated-door', [
        ['door', 'floor', 'door']
    ], {orient: 'float', encompass: false});
    const matcher = new MapMatcher({
        worldWidth: 10,
        worldHeight: 8,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minWinnerMargin: 0.1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([{x: 5, y: 3, kind: 'door'}]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'ambiguous');
    assert.deepEqual(
        result.candidates.map(candidate => candidate.offsetX).sort((left, right) => left - right),
        [3, 5]
    );
    assert.deepEqual(result.predictions, []);
});

test('template plausible tolerance keeps a noisy true anchor as a consensus veto', () => {
    const candidate = (name, noisyCell, tail, plausible = false) => {
        const source = template(name, [[
            'portal', noisyCell, 'floor', 'door', 'lava', tail
        ]], {
            matchAnchor: {
                x: 0,
                y: 0,
                glyph: '@',
                requireObservedKind: 'portal'
            },
            matchPolicy: {
                minScore: 0.99,
                minEvidenceCells: 4,
                minEvidenceWeight: 4,
                minDistinctKinds: 2,
                minCoverage: 0.5,
                minSpanXRatio: 0.5,
                minSpanYRatio: 1,
                requiredKinds: [],
                ...(plausible ? {
                    plausibleMinScore: 0.7,
                    plausibleSlack: 0.3
                } : {})
            }
        });
        source.grid[0][0] = {
            ...source.grid[0][0],
            glyph: '@',
            possibleGlyphs: ['@']
        };
        return source;
    };
    const observations = [
        {x: 0, y: 0, kind: 'portal'},
        // Synthetic stale/noisy terrain: this wall makes the wrong template
        // the strict score-1 winner over the real floor-bearing template.
        {x: 1, y: 0, kind: 'wall'},
        {x: 2, y: 0, kind: 'floor'},
        {x: 3, y: 0, kind: 'door'},
        {x: 4, y: 0, kind: 'lava'}
    ];
    const options = {
        worldWidth: 10,
        worldHeight: 4,
        // A caller may make winner acceptance stricter without collapsing a
        // template's independently-audited plausible consensus floor.
        minScore: 0.995,
        minEvidenceCells: 4,
        minEvidenceWeight: 4,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        requireExhaustivePlacement: true
    };

    const strict = new MapMatcher(options);
    strict.setTemplates([
        candidate('wrong', 'wall', 'wall'),
        candidate('truth', 'floor', 'floor')
    ]);
    const strictResult = strict.updateObservations(observations);
    assert.equal(strictResult.best.template.name, 'wrong');
    assert.equal(strictResult.candidates.length, 1);
    assert.equal(strictResult.predictions.some(cell =>
        cell.x === 5 && cell.y === 0 && cell.kind === 'wall'), true);

    const tolerant = new MapMatcher(options);
    tolerant.setTemplates([
        candidate('wrong', 'wall', 'wall', true),
        candidate('truth', 'floor', 'floor', true)
    ]);
    const tolerantResult = tolerant.updateObservations(observations);
    assert.equal(tolerantResult.best.template.name, 'wrong');
    assert.equal(tolerantResult.candidates.some(item =>
        item.template.name === 'truth'), true);
    assert.equal(tolerantResult.predictions.some(cell =>
        cell.x === 5 && cell.y === 0), false);
});

test('exhaustive placement gate blocks unanchored heuristics without hiding best diagnostics', () => {
    const source = template('heuristic-active', [[
        'wall', 'wall', 'wall', 'floor', 'wall',
        'floor', 'wall', 'floor', 'door'
    ]], {
        orient: 'float',
        encompass: false,
        tags: ['no_rotate', 'no_vmirror'],
        matchPolicy: {
            minScore: 1,
            minEvidenceCells: 3,
            minEvidenceWeight: 3,
            minDistinctKinds: 2,
            requiredKinds: ['wall', 'floor']
        }
    });
    const options = {
        worldWidth: 20,
        worldHeight: 8,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        maxAnchorObservations: 1,
        maxTemplateAnchorsPerKind: 100,
        maxPlacementsPerTransform: 1,
        maxPriorityAnchorsPerKind: 0,
        maxPriorityPlacementsPerTransform: 0
    };
    const observations = [
        {x: 2, y: 2, kind: 'wall'},
        {x: 3, y: 2, kind: 'floor'},
        {x: 4, y: 2, kind: 'wall'},
        {x: 5, y: 2, kind: 'floor'}
    ];

    const compatibleMatcher = new MapMatcher(options);
    compatibleMatcher.setTemplates([source]);
    const compatible = compatibleMatcher.updateObservations(observations);
    assert.equal(compatibleMatcher.options.requireExhaustivePlacement, false);
    assert.equal(compatible.ready, true);

    const guardedMatcher = new MapMatcher({
        ...options,
        requireExhaustivePlacement: true
    });
    guardedMatcher.setTemplates([source]);
    const guarded = guardedMatcher.updateObservations(observations);

    assert.equal(guarded.best.transform, compatible.best.transform);
    assert.equal(guarded.best.offsetX, compatible.best.offsetX);
    assert.equal(guarded.best.offsetY, compatible.best.offsetY);
    assert.equal(guarded.best.score, compatible.best.score);
    assert.equal(guarded.unique, compatible.unique);
    assert.equal(guarded.ready, false);
    assert.equal(guarded.reason, 'placement-unverified');
    assert.deepEqual(guarded.predictions, []);
});

test('disabled partial policy blocks a heuristically unique reflected placement', () => {
    // With one sampled anchor and one placement per transform, the real r0
    // placement is omitted while the reflected placement exactly matches the
    // observed alternating middle. This is the small form of the Pan lord
    // failure where a finite placement search made r0hv look uniquely safe.
    const source = template('heuristic-pan', [[
        'wall', 'wall', 'wall', 'floor', 'wall',
        'floor', 'wall', 'floor', 'door'
    ]], {
        orient: 'float',
        encompass: false,
        tags: ['no_rotate', 'no_vmirror'],
        matchPolicy: {
            minScore: 1,
            minEvidenceCells: 3,
            minEvidenceWeight: 3,
            minDistinctKinds: 2,
            requiredKinds: ['wall', 'floor'],
            revealDisabled: true
        }
    });
    const matcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 8,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 2,
        minPredictedCells: 1,
        maxAnchorObservations: 1,
        maxTemplateAnchorsPerKind: 100,
        maxPlacementsPerTransform: 1,
        maxPriorityAnchorsPerKind: 0,
        maxPriorityPlacementsPerTransform: 0
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 2, y: 2, kind: 'wall'},
        {x: 3, y: 2, kind: 'floor'},
        {x: 4, y: 2, kind: 'wall'},
        {x: 5, y: 2, kind: 'floor'}
    ]);

    assert.equal(result.best.transform, 'r0h');
    assert.equal(result.best.score, 1);
    assert.equal(result.unique, true);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'policy-disabled');
    assert.deepEqual(result.predictions, []);
    assert.ok(result.forcePredictions.length > 0);
    assert.equal(result.forcePredictions.every(cell =>
        Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.kind
    ), true);
});

test('a force-disabled plausible survivor vetoes safe and provisional terrain', () => {
    const rows = [
        ['wall', 'wall', 'wall'],
        ['wall', 'floor', 'door'],
        ['wall', 'floor', 'wall']
    ];
    const supported = template('supported-candidate', rows, {
        matchPolicy: {
            minScore: 1,
            minEvidenceCells: 4,
            minEvidenceWeight: 4,
            minDistinctKinds: 2
        }
    });
    const detectionOnly = template('detection-only-candidate', rows, {
        matchPolicy: {
            minScore: 1,
            minEvidenceCells: 4,
            minEvidenceWeight: 4,
            minDistinctKinds: 2,
            revealDisabled: true,
            forceRevealDisabled: true
        }
    });
    const observations = [
        {x: 1, y: 1, kind: 'wall'},
        {x: 2, y: 2, kind: 'floor'},
        {x: 3, y: 2, kind: 'door'},
        {x: 1, y: 3, kind: 'wall'}
    ];

    for (const legacyExhaustivePlacement of [false, true]) {
        const matcher = new MapMatcher({
            worldWidth: 5,
            worldHeight: 5,
            minScore: 1,
            minEvidenceCells: 1,
            minEvidenceWeight: 1,
            minDistinctKinds: 1,
            minPredictedCells: 1,
            legacyExhaustivePlacement
        });
        matcher.setTemplates([supported, detectionOnly]);
        const result = matcher.updateObservations(observations);

        assert.equal(result.best.template.name, supported.name);
        assert.equal(result.ready, false);
        assert.equal(result.reason, 'ambiguous');
        assert.equal(result.plausibleCandidateCount, 2);
        assert.deepEqual(result.predictions, []);
        assert.deepEqual(result.provisionalPredictions, []);
        assert.ok(result.forcePredictions.length > 0);
    }
});

test('a non-tied force-disabled survivor still vetoes automatic terrain', () => {
    const supportedRows = Array.from({length: 10}, (_, y) =>
        Array.from({length: 10}, (_, x) =>
            x === 0 || y === 0 || x === 9 || y === 9
                ? 'wall'
                : 'floor'));
    const detectionRows = structuredClone(supportedRows);
    for (let x = 2; x <= 7; x++) {
        detectionRows[2][x] = 'wall';
    }
    const policy = {
        minScore: 0.9,
        minEvidenceCells: 10,
        minEvidenceWeight: 10,
        minDistinctKinds: 2,
        minCoverage: 0,
        minSpanXRatio: 0,
        minSpanYRatio: 0,
        requiredKinds: [],
        plausibleSlack: 0.08,
        plausibleMinScore: 0.8
    };
    const supported = template('supported-non-tie', supportedRows, {
        matchPolicy: policy
    });
    const detectionOnly = template('detection-non-tie', detectionRows, {
        matchPolicy: {
            ...policy,
            revealDisabled: true,
            forceRevealDisabled: true
        }
    });
    const observations = [];
    supported.grid.forEach((row, y) => row.forEach((entry, x) => {
        if (x !== 9 || y !== 9) {
            observations.push({x, y, kind: entry.kinds[0]});
        }
    }));

    for (const legacyExhaustivePlacement of [false, true]) {
        const matcher = new MapMatcher({
            worldWidth: 10,
            worldHeight: 10,
            minEvidenceCells: 1,
            minEvidenceWeight: 1,
            minDistinctKinds: 1,
            minPredictedCells: 1,
            minWinnerMargin: 0.025,
            legacyExhaustivePlacement
        });
        matcher.setTemplates([supported, detectionOnly]);
        const result = matcher.updateObservations(observations);

        assert.equal(result.best.template.name, supported.name);
        assert.equal(result.best.score, 1);
        assert.ok(result.margin > 0.025 && result.margin < 0.08);
        assert.equal(result.unique, true);
        assert.equal(result.plausibleCandidateCount, 2);
        assert.equal(result.ready, false);
        assert.equal(result.reason, 'ambiguous');
        assert.deepEqual(result.predictions, []);
        assert.deepEqual(result.provisionalPredictions, []);
    }
});

test('entry anchor follows a reflected possible glyph and rejects terrain-derived offsets', () => {
    const source = template('anchored-reflection', [
        ['wall', 'door', 'portal'],
        ['lava', 'stair', 'floor']
    ], {
        orient: 'float',
        encompass: false,
        tags: ['no_rotate', 'no_vmirror']
    });
    source.grid[0][2] = {
        ...source.grid[0][2],
        glyph: 'P',
        possibleGlyphs: ['P', '@']
    };
    source.metadata.matchAnchor = {x: 8, y: -2, glyph: '@'};
    const disabledUnanchored = template('disabled-unanchored', [[
        'solid'
    ]], {
        orient: 'float',
        encompass: false,
        matchPolicy: {revealDisabled: true}
    });
    const matcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 15,
        requireExhaustivePlacement: true,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source, disabledUnanchored]);
    const result = matcher.updateObservations([
        {x: 8, y: -2, kind: 'portal'},
        {x: 9, y: -2, kind: 'door'},
        {x: 10, y: -2, kind: 'wall'},
        {x: 9, y: -1, kind: 'stair'},
        {x: 10, y: -1, kind: 'lava'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.transform, 'r0h');
    assert.equal(result.best.offsetX, 8);
    assert.equal(result.best.offsetY, -2);
    assert.deepEqual(result.predictions, [{x: 8, y: -1, kind: 'floor'}]);
});

test('entry anchor tracks its glyph through a clockwise rotation', () => {
    const source = template('anchored-rotation', [
        ['wall', 'door'],
        ['lava', 'stair'],
        ['portal', 'floor']
    ], {
        orient: 'float',
        encompass: false,
        tags: ['no_hmirror', 'no_vmirror']
    });
    source.grid[2][0] = {
        ...source.grid[2][0],
        glyph: '@',
        possibleGlyphs: ['@']
    };
    source.metadata.matchAnchor = {x: -4, y: 5, glyph: '@'};
    const matcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 15,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: -4, y: 5, kind: 'portal'},
        {x: -3, y: 5, kind: 'lava'},
        {x: -2, y: 5, kind: 'wall'},
        {x: -3, y: 6, kind: 'stair'},
        {x: -2, y: 6, kind: 'door'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.transform, 'r90');
    assert.equal(result.best.offsetX, -4);
    assert.equal(result.best.offsetY, 5);
    assert.deepEqual(result.predictions, [{x: -4, y: 6, kind: 'floor'}]);
});

test('exhaustive placement keeps an unanchored rotated offset beyond heuristic caps', () => {
    const source = template('exhaustive-rotation', [
        ['wall', 'door', 'lava', 'floor'],
        ['portal', 'water', 'stair', 'altar'],
        ['statue', 'solid', 'floor', 'door']
    ], {
        orient: 'float',
        encompass: false,
        tags: ['no_hmirror', 'no_vmirror'],
        matchPolicy: {
            exhaustivePlacement: true,
            minScore: 1,
            minEvidenceCells: 11,
            minEvidenceWeight: 11,
            minDistinctKinds: 8
        }
    });
    const clockwise = allowedTransforms(source)
        .find(transform => transform.id === 'r90');
    const transformed = transformTemplate(source, clockwise);
    const offsetX = -6;
    const offsetY = 3;
    const missing = {x: 0, y: 3};
    const observations = [];
    transformed.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (x !== missing.x || y !== missing.y) {
            observations.push({
                x: offsetX + x,
                y: offsetY + y,
                kind: cell.kinds[0]
            });
        }
    }));
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        requireExhaustivePlacement: true,
        // The old heuristic could inspect only one ranked offset per
        // transform. Exact placement must not depend on this cap.
        maxPlacementsPerTransform: 1,
        maxPriorityPlacementsPerTransform: 0,
        minScore: 1,
        minEvidenceCells: 11,
        minEvidenceWeight: 11,
        minDistinctKinds: 8,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations(observations);

    assert.equal(result.ready, true);
    assert.equal(result.reason, 'ready');
    assert.equal(result.best.transform, 'r90');
    assert.equal(result.best.placementSearch, 'exhaustive');
    assert.equal(result.best.offsetX, offsetX);
    assert.equal(result.best.offsetY, offsetY);
    assert.deepEqual(result.forcePredictions, [{
        x: offsetX + missing.x,
        y: offsetY + missing.y,
        kind: transformed.grid[missing.y][missing.x].kinds[0]
    }]);
});

test('correlation exhaustive placement is result-equivalent to legacy enumeration', () => {
    const terrain = ['wall', 'floor', 'door', 'lava', 'shallow_water'];
    const random = seed => {
        let state = seed >>> 0;
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 0x100000000;
        };
    };
    const summary = result => ({
        ready: result.ready,
        unique: result.unique,
        reason: result.reason,
        margin: result.margin,
        structuralSingleton: result.structuralSingleton,
        plausibleCandidateCount: result.plausibleCandidateCount,
        consensusOverflow: result.consensusOverflow,
        best: result.best && {
            id: result.best.id,
            score: result.best.score,
            matchWeight: result.best.matchWeight,
            penaltyWeight: result.best.penaltyWeight,
            evidenceWeight: result.best.evidenceWeight,
            evidenceCells: result.best.evidenceCells,
            distinctKinds: result.best.distinctKinds,
            observedKinds: result.best.observedKinds,
            coverage: result.best.coverage,
            spanX: result.best.spanX,
            spanY: result.best.spanY,
            requiredKindsReady: result.best.requiredKindsReady,
            focusReady: result.best.focusReady,
            offsetX: result.best.offsetX,
            offsetY: result.best.offsetY,
            transform: result.best.transform
        },
        candidates: result.candidates.map(candidate => ({
            id: candidate.id,
            score: candidate.score,
            evidenceWeight: candidate.evidenceWeight,
            evidenceCells: candidate.evidenceCells
        })),
        predictions: result.predictions,
        provisionalPredictions: result.provisionalPredictions,
        forcePredictions: result.forcePredictions
    });

    for (let seed = 1; seed <= 48; seed++) {
        const next = random(seed);
        const templates = Array.from({length: 2}, (_, templateIndex) => {
            const rows = Array.from({length: 3}, () =>
                Array.from({length: 4}, () =>
                    next() < 0.18
                        ? null
                        : terrain[Math.floor(next() * terrain.length)]));
            return template(`random-${seed}-${templateIndex}`, rows, {
                orient: templateIndex ? 'float' : 'north',
                encompass: false,
                tags: templateIndex
                    ? ['no_vmirror']
                    : ['no_rotate', 'no_hmirror', 'no_vmirror'],
                matchPolicy: {
                    exhaustivePlacement: true,
                    minScore: 0.72,
                    minEvidenceCells: 3,
                    minEvidenceWeight: 3,
                    minDistinctKinds: 2,
                    minCoverage: 0.2,
                    minSpanXRatio: 0.25,
                    minSpanYRatio: 0.25,
                    requiredKinds: seed % 3 === 0 ? ['wall'] : [],
                    requireFocusInFootprint: seed % 4 === 0,
                    // A fractional margin catches inclusive-boundary drift
                    // between the compact batch and candidate.bounds logic.
                    focusMargin: seed % 8 === 0 ? 0.5 : 1,
                    revealDisabled: seed % 5 === 0
                }
            });
        });
        const observations = [];
        for (let y = -2; y <= 5; y++) {
            for (let x = -3; x <= 6; x++) {
                if (next() < 0.34) {
                    observations.push({
                        x,
                        y,
                        kind: terrain[Math.floor(next() * terrain.length)]
                    });
                }
            }
        }
        const options = {
            worldWidth: 10,
            worldHeight: 8,
            minScore: 0.7,
            minEvidenceCells: 2,
            minEvidenceWeight: 2,
            minDistinctKinds: 1,
            candidateSlack: 0.08,
            minWinnerMargin: 0.03,
            maxConsensusCandidates: 7,
            minPredictedCells: 1
        };
        const correlation = new MapMatcher(options);
        const legacy = new MapMatcher({
            ...options,
            legacyExhaustivePlacement: true
        });
        correlation.setTemplates(templates);
        legacy.setTemplates(templates);
        if (seed % 4 === 0) {
            correlation.setFocusPosition({x: 1, y: 1}, {evaluate: false});
            legacy.setFocusPosition({x: 1, y: 1}, {evaluate: false});
        }
        const actual = correlation.updateObservations(observations);
        const expected = legacy.updateObservations(observations);
        assert.deepEqual(summary(actual), summary(expected), `seed ${seed}`);
        assert.ok(correlation.getEvaluationStats().exhaustiveOffsets > 0);
        assert.equal(
            correlation.getEvaluationStats().exhaustiveOffsets,
            legacy.getEvaluationStats().exhaustiveOffsets,
            `legal exhaustive offsets, seed ${seed}`
        );
    }
});

test('correlation exhaustive placement emits only provisional survivor consensus', () => {
    const rows = [
        ['wall', 'floor', 'door', 'lava'],
        ['altar', 'stair', 'portal', 'deep_water'],
        ['shallow_water', 'wall', 'floor', 'statue'],
        ['door', 'lava', 'altar', 'wall']
    ];
    const policy = {
        exhaustivePlacement: true,
        revealDisabled: true,
        minScore: 1,
        minEvidenceCells: 10,
        minEvidenceWeight: 10,
        minDistinctKinds: 2,
        minCoverage: 0,
        minSpanXRatio: 0,
        minSpanYRatio: 0,
        requiredKinds: []
    };
    const first = template('correlation-provisional-a', rows, {
        orient: 'float',
        encompass: false,
        matchPolicy: policy
    });
    const secondRows = structuredClone(rows);
    secondRows[3][3] = 'floor';
    const second = template('correlation-provisional-b', secondRows, {
        orient: 'float',
        encompass: false,
        matchPolicy: policy
    });
    const offset = {x: 2, y: -1};
    const observations = [];
    first.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (y < 3) {
            observations.push({
                x: offset.x + x,
                y: offset.y + y,
                kind: cell.kinds[0]
            });
        }
    }));
    const options = {
        worldWidth: 10,
        worldHeight: 8,
        requireExhaustivePlacement: true,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        maxConsensusCandidates: 8,
        minPredictedCells: 1
    };
    const correlation = new MapMatcher(options);
    const legacy = new MapMatcher({...options, legacyExhaustivePlacement: true});
    correlation.setTemplates([first, second]);
    legacy.setTemplates([first, second]);
    const actual = correlation.updateObservations(observations);
    const expected = legacy.updateObservations(observations);

    assert.ok(correlation.getEvaluationStats().exhaustiveBatches > 0);
    assert.equal(actual.ready, false);
    assert.equal(actual.reason, 'policy-disabled');
    assert.equal(actual.structuralSingleton, false);
    assert.deepEqual(actual.predictions, []);
    assert.ok(actual.provisionalPredictions.length > 0, JSON.stringify({
        reason: actual.reason,
        plausible: actual.plausibleCandidateCount,
        overflow: actual.consensusOverflow,
        candidates: actual.candidates.map(candidate => candidate.id),
        force: actual.forcePredictions.length,
        stats: correlation.getEvaluationStats()
    }));
    assert.ok(actual.provisionalPredictions.length
        < actual.forcePredictions.length);
    assert.deepEqual(
        actual.provisionalPredictions,
        expected.provisionalPredictions
    );
    assert.deepEqual(actual.forcePredictions, expected.forcePredictions);
    assert.equal(actual.provisionalPredictions.some(cell =>
        cell.x === offset.x + 3 && cell.y === offset.y + 3), false);
});

test('multiple symmetric entry anchors reveal only world-space consensus', () => {
    const source = template('symmetric-entries', [
        ['floor', 'wall', 'floor', 'wall', 'floor', 'lava', 'door']
    ], {orient: 'float', encompass: false});
    for (const x of [2, 4]) {
        source.grid[0][x] = {
            ...source.grid[0][x],
            glyph: '@',
            possibleGlyphs: ['@']
        };
    }
    source.metadata.matchAnchor = {x: 0, y: 0, glyph: '@'};
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 8,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minWinnerMargin: 0.1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([{x: 0, y: 0, kind: 'floor'}]);

    assert.equal(result.ready, true);
    assert.equal(result.unique, false);
    assert.deepEqual(
        result.candidates.map(candidate => candidate.offsetX).sort((left, right) => left - right),
        [-4, -2]
    );
    assert.deepEqual(result.predictions, [
        {x: -2, y: 0, kind: 'floor'},
        {x: -1, y: 0, kind: 'wall'}
    ]);
    assert.equal(result.predictions.some(cell => cell.x === 1 || cell.x === 2), false);
});

test('a non-portal wizard arrival falls back to terrain matching for force only', () => {
    const source = template('wizard-arrival', [
        ['portal', 'wall', 'door', 'wall'],
        ['wall', 'floor', 'lava', 'wall'],
        ['wall', 'floor', 'floor', 'wall']
    ], {orient: 'float', encompass: false});
    source.grid[0][0] = {
        ...source.grid[0][0],
        glyph: '<',
        possibleGlyphs: ['<']
    };
    source.metadata.matchAnchor = {
        x: 0,
        y: 0,
        glyph: '<',
        requireObservedKind: 'portal'
    };
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        requireExhaustivePlacement: true,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 2,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offset = {x: 4, y: 3};
    const observations = [{x: 0, y: 0, kind: 'floor'}];
    source.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (x + y < 4) {
            observations.push({
                x: offset.x + x,
                y: offset.y + y,
                kind: cell.kinds[0]
            });
        }
    }));

    const result = matcher.updateObservations(observations);

    assert.equal(result.best.template.name, 'wizard-arrival');
    assert.equal(result.best.offsetX, offset.x);
    assert.equal(result.best.offsetY, offset.y);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'anchor-unverified');
    assert.deepEqual(result.predictions, []);
    assert.ok(result.forcePredictions.length > 0);
});

test('an impossible entry glyph yields no candidates even with matching terrain', () => {
    const source = template('missing-entry', [
        ['wall', 'door'],
        ['lava', 'floor']
    ], {orient: 'float', encompass: false});
    source.metadata.matchAnchor = {x: 4, y: 4, glyph: '@'};
    const matcher = new MapMatcher({
        worldWidth: 10,
        worldHeight: 8,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 4, y: 4, kind: 'wall'},
        {x: 5, y: 4, kind: 'door'},
        {x: 4, y: 5, kind: 'lava'}
    ]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'no-candidates');
    assert.deepEqual(result.predictions, []);
});

test('an entry glyph removed by substitution cannot anchor through its raw source glyph', () => {
    const source = template('removed-entry', [
        ['wall', 'door'],
        ['lava', 'floor']
    ], {orient: 'float', encompass: false});
    source.grid[0][0] = {
        ...source.grid[0][0],
        glyph: '@',
        possibleGlyphs: ['.']
    };
    source.metadata.matchAnchor = {x: 4, y: 4, glyph: '@'};
    const matcher = new MapMatcher({
        worldWidth: 10,
        worldHeight: 8,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 4, y: 4, kind: 'wall'},
        {x: 5, y: 4, kind: 'door'},
        {x: 4, y: 5, kind: 'lava'}
    ]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'no-candidates');
    assert.deepEqual(result.predictions, []);
});

test('a Pan-sized north vault matches relative WebTiles coordinates within its footprint', () => {
    const rows = Array.from({length: 31}, () => Array(80).fill(null));
    const observedTerrain = [
        {x: 0, y: 0, kind: 'wall'},
        {x: 79, y: 0, kind: 'door'},
        {x: 0, y: 30, kind: 'lava'},
        {x: 79, y: 30, kind: 'stair'},
        {x: 40, y: 15, kind: 'portal'},
        {x: 20, y: 5, kind: 'altar'},
        {x: 60, y: 25, kind: 'statue'},
        {x: 30, y: 12, kind: 'deep_water'}
    ];
    for (const cell of observedTerrain) {
        rows[cell.y][cell.x] = cell.kind;
    }
    rows[15][41] = 'floor';

    const source = template('pan-primary', rows, {
        orient: 'north',
        encompass: false
    });
    const matcher = new MapMatcher({
        worldWidth: 80,
        worldHeight: 70,
        minEvidenceCells: 8,
        minEvidenceWeight: 8,
        minDistinctKinds: 4,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offsetX = -37;
    const offsetY = -12;
    const observations = observedTerrain.map(cell => ({
        x: offsetX + cell.x,
        y: offsetY + cell.y,
        kind: cell.kind
    }));
    // Known random terrain below the north vault is part of the same level,
    // but must neither count as vault evidence nor become a prediction.
    observations.push({x: offsetX + 40, y: offsetY + 69, kind: 'open'});
    const result = matcher.updateObservations(observations);

    assert.equal(result.ready, true);
    assert.equal(result.best.template.name, 'pan-primary');
    assert.equal(result.best.offsetX, offsetX);
    assert.equal(result.best.offsetY, offsetY);
    assert.deepEqual(result.best.worldBounds, {
        minX: offsetX,
        minY: offsetY,
        maxX: offsetX + 79,
        maxY: offsetY + 69
    });
    assert.deepEqual(result.predictions, [
        {x: offsetX + 41, y: offsetY + 15, kind: 'floor'}
    ]);
    assert.equal(result.predictions.every(cell =>
        cell.x >= offsetX && cell.x < offsetX + 80
        && cell.y >= offsetY && cell.y < offsetY + 31), true);
});

test('63 partial footprints score identically with 3500 level observations', () => {
    const templates = Array.from({length: 63}, (_, templateIndex) => ({
        name: `quadrant-${templateIndex}`,
        width: 27,
        height: 23,
        grid: Array.from({length: 23}, (_, y) =>
            Array.from({length: 27}, (_, x) => ({
                kinds: [
                    (x * 3 + y * 5 + templateIndex) % 11 === 0
                        ? 'floor'
                        : 'wall'
                ]
            }))),
        metadata: {
            orient: 'float',
            tags: [],
            matchPolicy: {
                minScore: 0.995,
                minEvidenceCells: 72,
                minEvidenceWeight: 84,
                minDistinctKinds: 2,
                minCoverage: 0.18,
                minSpanXRatio: 0.45,
                minSpanYRatio: 0.45,
                requiredKinds: ['wall', 'floor'],
                requireFocusInFootprint: true
            }
        }
    }));
    const observations = [];
    for (let y = 0; y < 70; y++) {
        for (let x = 0; x < 50; x++) {
            observations.push({
                x,
                y,
                kind: (x * 3 + y * 5) % 11 === 0 ? 'floor' : 'wall'
            });
        }
    }
    const matcher = new MapMatcher({
        worldWidth: 80,
        worldHeight: 70,
        minScore: 0.8,
        minEvidenceCells: 4,
        minEvidenceWeight: 4,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates(templates);
    matcher.updateObservations(observations, {evaluate: false});
    matcher.setFocusPosition({x: 13, y: 11}, {evaluate: false});
    const result = matcher.evaluate();

    // These are the legacy observation-scan results for the same inventory.
    assert.equal(matcher.observations.size, 3500);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.consensusOverflow, true);
    assert.equal(result.plausibleCandidateCount, 126);
    assert.equal(result.best.id, 'quadrant-0:r0:0,0');
    assert.equal(result.best.score, 1);
    assert.equal(result.best.evidenceCells, 621);
    assert.equal(result.best.evidenceWeight, 621);
    assert.equal(result.best.coverage, 1);
    assert.equal(result.best.spanX, 27);
    assert.equal(result.best.spanY, 23);
    assert.deepEqual(result.best.observedKinds, ['floor', 'wall']);
    assert.equal(result.margin, 0);
    assert.deepEqual(result.predictions, []);
});

test('per-template policy rejects clustered wall-floor coincidence but accepts broad coverage', () => {
    const rows = Array.from({length: 10}, (_, y) =>
        Array.from({length: 20}, (_, x) => (x + y) % 2 ? 'floor' : 'wall'));
    const source = template('pan-wall-floor', rows, {
        orient: 'north',
        encompass: false,
        matchPolicy: {
            minScore: 1,
            minEvidenceCells: 10,
            minEvidenceWeight: 10,
            minDistinctKinds: 2,
            minCoverage: 0.05,
            minSpanXRatio: 0.9,
            minSpanYRatio: 0.9,
            requiredKinds: ['wall', 'floor']
        }
    });
    const matcher = new MapMatcher({
        worldWidth: 20,
        worldHeight: 20,
        minScore: 0.5,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minPredictedCells: 1,
        maxPlacementsPerTransform: 64
    });
    matcher.setTemplates([source]);
    const offsetX = -7;
    const offsetY = 4;
    const clustered = [
        {x: 5, y: 1},
        {x: 6, y: 2},
        {x: 7, y: 3},
        {x: 8, y: 4}
    ].map(cell => ({
        x: offsetX + cell.x,
        y: offsetY + cell.y,
        kind: rows[cell.y][cell.x]
    }));
    const rejected = matcher.updateObservations(clustered);

    assert.equal(rejected.ready, false);
    assert.equal(rejected.reason, 'insufficient-evidence');
    assert.equal(rejected.best.requiredKindsReady, false);
    assert.deepEqual(rejected.best.observedKinds, ['wall']);
    assert.equal(rejected.best.constrainedCells, 200);
    assert.equal(rejected.best.predictableCells, 200);
    assert.ok(rejected.best.coverage < 0.05);
    assert.ok(rejected.best.spanXRatio < 0.9);
    assert.ok(rejected.best.spanYRatio < 0.9);
    assert.deepEqual(rejected.predictions, []);

    matcher.reset({keepTemplates: true});
    const broadCells = [
        {x: 0, y: 0},
        {x: 19, y: 9},
        {x: 2, y: 1},
        {x: 4, y: 2},
        {x: 6, y: 3},
        {x: 8, y: 4},
        {x: 10, y: 5},
        {x: 12, y: 6},
        {x: 14, y: 7},
        {x: 16, y: 8}
    ];
    const broad = broadCells.map(cell => ({
        x: offsetX + cell.x,
        y: offsetY + cell.y,
        kind: rows[cell.y][cell.x]
    }));
    broad.push({x: offsetX + 10, y: offsetY + 19, kind: 'open'});
    const accepted = matcher.updateObservations(broad);

    assert.equal(accepted.ready, true);
    assert.equal(accepted.best.offsetX, offsetX);
    assert.equal(accepted.best.offsetY, offsetY);
    assert.equal(accepted.best.score, 1);
    assert.equal(accepted.best.evidenceCells, 10);
    assert.equal(accepted.best.evidenceWeight, 10);
    assert.equal(accepted.best.distinctKinds, 2);
    assert.deepEqual(accepted.best.observedKinds, ['floor', 'wall']);
    assert.equal(accepted.best.coverage, 0.05);
    assert.equal(accepted.best.spanX, 20);
    assert.equal(accepted.best.spanY, 10);
    assert.equal(accepted.best.spanXRatio, 1);
    assert.equal(accepted.best.spanYRatio, 1);
    assert.equal(accepted.best.requiredKindsReady, true);
});

test('focus-gated partial policy fails closed without focus and honors its margin', () => {
    const source = template('focused-vault', [
        ['wall', 'door', 'wall'],
        ['lava', 'floor', 'stair'],
        ['wall', 'portal', 'wall']
    ], {
        orient: 'float',
        encompass: false,
        matchPolicy: {
            requireFocusInFootprint: true,
            focusMargin: 1
        }
    });
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        minEvidenceCells: 8,
        minEvidenceWeight: 8,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const observations = [
        {x: 4, y: 3, kind: 'wall'},
        {x: 5, y: 3, kind: 'door'},
        {x: 6, y: 3, kind: 'wall'},
        {x: 4, y: 4, kind: 'lava'},
        {x: 6, y: 4, kind: 'stair'},
        {x: 4, y: 5, kind: 'wall'},
        {x: 5, y: 5, kind: 'portal'},
        {x: 6, y: 5, kind: 'wall'}
    ];
    const withoutFocus = matcher.updateObservations(observations);
    assert.equal(withoutFocus.ready, false);
    assert.equal(withoutFocus.best.focusReady, false);

    const inside = matcher.setFocusPosition({x: 5, y: 4});
    assert.equal(inside.ready, true);
    assert.equal(inside.best.focusReady, true);

    const withinMargin = matcher.setFocusPosition({x: 3, y: 4});
    assert.equal(withinMargin.ready, true);
    assert.equal(withinMargin.best.focusReady, true);

    const outsideMargin = matcher.setFocusPosition({x: 2, y: 4});
    assert.equal(outsideMargin.ready, false);
    assert.equal(outsideMargin.best.focusReady, false);

    matcher.reset({keepTemplates: true});
    matcher.updateObservations(observations, {evaluate: false});
    const afterReset = matcher.evaluate();
    assert.equal(matcher.focusPosition, null);
    assert.equal(afterReset.ready, false);
    assert.equal(afterReset.best.focusReady, false);
});

test('edge orientation follows Crawl mirrors when deriving world bounds', () => {
    const source = template('mirrored-corner', [
        ['wall', 'door', 'portal'],
        ['lava', 'stair', 'floor']
    ], {
        orient: 'northeast',
        encompass: false,
        tags: ['no_rotate', 'no_vmirror']
    });
    const matcher = new MapMatcher({
        worldWidth: 10,
        worldHeight: 8,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offsetX = -3;
    const offsetY = 4;
    const result = matcher.updateObservations([
        {x: offsetX, y: offsetY, kind: 'portal'},
        {x: offsetX + 1, y: offsetY, kind: 'door'},
        {x: offsetX + 2, y: offsetY, kind: 'wall'},
        {x: offsetX + 1, y: offsetY + 1, kind: 'stair'},
        {x: offsetX + 2, y: offsetY + 1, kind: 'lava'},
        // Southeast corner of the inferred level, outside the vault.
        {x: offsetX + 9, y: offsetY + 7, kind: 'open'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.transform, 'r0h');
    assert.equal(result.best.orientation, 'northwest');
    assert.deepEqual(result.best.worldBounds, {
        minX: offsetX,
        minY: offsetY,
        maxX: offsetX + 9,
        maxY: offsetY + 7
    });
    assert.deepEqual(result.predictions, [
        {x: offsetX, y: offsetY + 1, kind: 'floor'}
    ]);
});

test('edge orientation follows Crawl rotations when deriving world bounds', () => {
    const source = template('rotated-edge', [
        ['wall', 'door'],
        ['lava', 'stair'],
        ['portal', 'floor']
    ], {
        orient: 'north',
        encompass: false,
        tags: ['no_hmirror', 'no_vmirror']
    });
    const matcher = new MapMatcher({
        worldWidth: 10,
        worldHeight: 8,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offsetX = -4;
    const offsetY = 5;
    const result = matcher.updateObservations([
        // Clockwise layout: portal/lava/wall over floor/stair/door.
        {x: offsetX, y: offsetY, kind: 'portal'},
        {x: offsetX + 1, y: offsetY, kind: 'lava'},
        {x: offsetX + 2, y: offsetY, kind: 'wall'},
        {x: offsetX + 1, y: offsetY + 1, kind: 'stair'},
        {x: offsetX + 2, y: offsetY + 1, kind: 'door'},
        // Northwest corner of the inferred level, outside the east vault.
        {x: offsetX - 7, y: offsetY - 3, kind: 'open'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.transform, 'r90');
    assert.equal(result.best.orientation, 'east');
    assert.deepEqual(result.best.worldBounds, {
        minX: offsetX - 7,
        minY: offsetY - 3,
        maxX: offsetX + 2,
        maxY: offsetY + 4
    });
    assert.deepEqual(result.predictions, [
        {x: offsetX, y: offsetY + 1, kind: 'floor'}
    ]);
});

test('fixed edge candidates are rejected when observations fall beyond the inferred level', () => {
    const source = template('north-boundary', [
        ['wall', 'door', 'lava']
    ], {orient: 'north', encompass: false});
    const matcher = new MapMatcher({
        worldWidth: 9,
        worldHeight: 7,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 2,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: 2, y: 4, kind: 'wall'},
        {x: 3, y: 4, kind: 'door'},
        {x: 4, y: 4, kind: 'lava'},
        // North-oriented placement makes y=4 the level's northern edge.
        {x: 2, y: 3, kind: 'open'}
    ]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'no-candidates');
    assert.deepEqual(result.predictions, []);
});

test('unknown orientations are excluded instead of being treated as floating vaults', () => {
    const source = template('unknown-orient', [
        ['wall', 'door'],
        ['lava', 'floor']
    ], {orient: 'somewhere', encompass: false});
    const matcher = new MapMatcher({
        worldWidth: 9,
        worldHeight: 7,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([{x: 2, y: 2, kind: 'door'}]);

    assert.equal(result.ready, false);
    assert.equal(result.reason, 'no-candidates');
    assert.deepEqual(result.predictions, []);
});

test('centre orientation derives a fixed world origin but reveals only its footprint', () => {
    const source = template('central-room', [
        ['wall', 'door', 'wall'],
        ['lava', 'floor', 'stair'],
        ['wall', 'portal', 'wall']
    ], {orient: 'centre', encompass: false});
    const matcher = new MapMatcher({
        worldWidth: 9,
        worldHeight: 9,
        minEvidenceCells: 8,
        minEvidenceWeight: 8,
        minDistinctKinds: 3,
        minScore: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offsetX = -2;
    const offsetY = 5;
    const observations = [];
    source.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (x !== 1 || y !== 1) {
            observations.push({
                x: offsetX + x,
                y: offsetY + y,
                kind: cell.kinds[0]
            });
        }
    }));
    observations.push({x: -5, y: 2, kind: 'open'});
    const result = matcher.updateObservations(observations);

    assert.equal(result.ready, true);
    assert.deepEqual(result.best.worldBounds, {
        minX: -5,
        minY: 2,
        maxX: 3,
        maxY: 10
    });
    assert.deepEqual(result.predictions, [
        {x: offsetX + 1, y: offsetY + 1, kind: 'floor'}
    ]);
    assert.equal(result.predictions.every(cell =>
        cell.x >= offsetX && cell.x <= offsetX + 2
        && cell.y >= offsetY && cell.y <= offsetY + 2), true);
});

test('relative WebTiles coordinates may be negative', () => {
    const source = template('relative', [
        ['wall', 'door', 'wall'],
        ['floor', 'lava', 'floor'],
        ['wall', 'stair', 'wall']
    ]);
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        minEvidenceCells: 7,
        minEvidenceWeight: 10,
        minDistinctKinds: 3,
        minScore: 0.95,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations([
        {x: -4, y: -3, kind: 'wall'},
        {x: -3, y: -3, kind: 'door'},
        {x: -2, y: -3, kind: 'wall'},
        {x: -4, y: -2, kind: 'floor'},
        {x: -3, y: -2, kind: 'lava'},
        {x: -2, y: -2, kind: 'floor'},
        {x: -3, y: -1, kind: 'stair'}
    ]);

    assert.equal(result.ready, true);
    assert.equal(result.best.offsetX, -4);
    assert.equal(result.best.offsetY, -3);
});

test('observations can be explicitly forgotten when WebTiles makes a cell unseen', () => {
    const source = template('forget', [
        ['wall', 'door', 'wall'],
        ['floor', 'lava', 'floor'],
        ['wall', 'stair', 'wall']
    ]);
    const matcher = new MapMatcher({
        worldWidth: 8,
        worldHeight: 8,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minScore: 0.9,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    matcher.updateObservations([{x: -2, y: 3, kind: 'lava'}], {evaluate: false});
    assert.equal(matcher.observations.size, 1);
    matcher.removeObservations([{x: -2, y: 3}], {evaluate: false});
    assert.equal(matcher.observations.size, 0);
});

test('a rare observation can anchor to an uncertain template feature', () => {
    const source = template('random-entry', Array.from({length: 20}, (_, y) =>
        Array.from({length: 20}, (_, x) =>
            x === 18 && y === 17 ? 'floor'
                : x === 17 && y === 18 ? 'door'
                    : x === 0 || y === 0 || x === 19 || y === 19 ? 'wall'
                        : 'floor')));
    source.grid[18][18] = {
        kinds: ['portal', 'floor'],
        certain: false
    };
    const decoy = template('decoy', Array.from({length: 20}, (_, y) =>
        Array.from({length: 20}, (_, x) =>
            x === 0 || y === 0 || x === 19 || y === 19 ? 'wall' : 'floor')));
    decoy.grid[2][2] = {kinds: ['portal', 'floor'], certain: false};

    const matcher = new MapMatcher({
        worldWidth: 24,
        worldHeight: 24,
        minEvidenceCells: 8,
        minEvidenceWeight: 10,
        minDistinctKinds: 3,
        minScore: 0.95,
        minPredictedCells: 8,
        maxTemplateAnchorsPerKind: 12,
        maxPlacementsPerTransform: 4
    });
    matcher.setTemplates([decoy, source]);
    const result = matcher.updateObservations([
        {x: -1, y: -1, kind: 'floor'},
        {x: 0, y: -1, kind: 'floor'},
        {x: 1, y: -1, kind: 'wall'},
        {x: -1, y: 0, kind: 'door'},
        {x: 0, y: 0, kind: 'portal'},
        {x: 1, y: 0, kind: 'wall'},
        {x: -1, y: 1, kind: 'wall'},
        {x: 0, y: 1, kind: 'wall'},
        {x: 1, y: 1, kind: 'wall'}
    ]);

    assert.equal(result.ready, true, JSON.stringify({
        reason: result.reason,
        best: result.best && {
            name: result.best.template.name,
            score: result.best.score,
            offsetX: result.best.offsetX,
            offsetY: result.best.offsetY,
            evidenceCells: result.best.evidenceCells,
            distinctKinds: result.best.distinctKinds
        },
        margin: result.margin,
        candidates: result.candidates.length,
        predictions: result.predictions.length
    }));
    assert.equal(result.best.template.name, 'random-entry');
    assert.equal(result.best.offsetX, -18);
    assert.equal(result.best.offsetY, -18);
});

function vaultsCompositeMatcherFixture() {
    const cell = (kind, glyph = '.') => ({
        kinds: [kind],
        glyph,
        possibleGlyphs: [glyph]
    });
    const grid = Array.from({length: 10}, (_, y) =>
        Array.from({length: 12}, (_, x) =>
            cell(x === 0 || x === 11 || y === 0 || y === 9
                ? 'wall'
                : 'floor')));
    const slots = [
        {id: 'A', x: 1, y: 1, width: 2, height: 2},
        {id: 'B', x: 8, y: 1, width: 2, height: 2},
        {id: 'C', x: 1, y: 7, width: 2, height: 2},
        {id: 'D', x: 8, y: 7, width: 2, height: 2}
    ].map(slot => ({
        ...slot,
        mask: [[true, true], [true, true]]
    }));
    for (const slot of slots) {
        for (let y = 0; y < slot.height; y++) {
            for (let x = 0; x < slot.width; x++) {
                grid[slot.y + y][slot.x + x] = {
                    kinds: [],
                    certain: false,
                    glyph: slot.id,
                    possibleGlyphs: ['.']
                };
            }
        }
    }
    grid[5][5] = cell('stair', '{');
    const variant = (name, roles, kinds) => ({
        name,
        roles,
        tags: ['no_rotate', 'no_hmirror', 'no_vmirror'],
        width: 2,
        height: 2,
        grid: kinds.map(row => row.map(kind => cell(kind)))
    });
    const variants = [
        variant('prize', ['normalPrize'], [
            ['wall', 'door'],
            ['floor', 'lava']
        ]),
        variant('regular-one', ['normalRegular'], [
            ['wall', 'floor'],
            ['floor', 'door']
        ]),
        variant('regular-two', ['normalRegular'], [
            ['door', 'wall'],
            ['floor', 'floor']
        ]),
        variant('regular-three', ['normalRegular'], [
            ['floor', 'door'],
            ['wall', 'floor']
        ])
    ];
    return {
        name: 'vaults_vault_fixture',
        width: 12,
        height: 10,
        grid,
        metadata: {
            orient: 'encompass',
            encompass: true,
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror'],
            matchAnchor: {
                x: 0,
                y: 0,
                glyphs: ['{', '<'],
                requireObservedKind: 'stair'
            },
            matchPolicy: {
                minScore: 1,
                minEvidenceCells: 8,
                minEvidenceWeight: 8,
                minDistinctKinds: 2,
                minCoverage: 0,
                minSpanXRatio: 0,
                minSpanYRatio: 0,
                requiredKinds: ['wall', 'floor']
            },
            composite: {
                type: 'vaults-end-quadrants-v1',
                slots,
                variants,
                borderFillKind: 'wall',
                variantPolicy: {
                    minScore: 1,
                    minEvidenceCells: 3,
                    minEvidenceWeight: 3,
                    minDistinctKinds: 2,
                    minCoverage: 0.5,
                    minSpanXRatio: 0.5,
                    minSpanYRatio: 0.5,
                    requiredKinds: []
                },
                regimes: [{
                    id: 'normal',
                    prizeRole: 'normalPrize',
                    regularRole: 'normalRegular'
                }]
            }
        }
    };
}

test('fixed composites anchor through every legal child mirror', () => {
    const cell = (kind, glyph = '.') => ({
        kinds: [kind],
        glyph,
        possibleGlyphs: [glyph]
    });
    const grid = Array.from({length: 6}, (_, y) =>
        Array.from({length: 8}, (_, x) =>
            cell(x === 0 || x === 7 || y === 0 || y === 5
                ? 'wall'
                : 'floor')));
    const slot = {
        id: 'A',
        role: 'room',
        x: 2,
        y: 2,
        width: 3,
        height: 2,
        mask: [[true, true, true], [true, true, true]],
        entryAnchorGlyphs: ['R']
    };
    for (let y = 0; y < slot.height; y++) {
        for (let x = 0; x < slot.width; x++) {
            grid[slot.y + y][slot.x + x] = {
                kinds: [],
                certain: false,
                glyph: 'A',
                possibleGlyphs: []
            };
        }
    }
    const variant = (name, kinds) => {
        const variantGrid = kinds.map(row => row.map(kind => cell(kind)));
        variantGrid[0][0] = {
            ...variantGrid[0][0],
            // Like Tomb's hatch_dest marker, the marker coordinate survives
            // even though a later SUBST removes its source glyph.
            glyph: 'R',
            possibleGlyphs: ['.']
        };
        return {
            name,
            roles: ['room'],
            tags: ['no_rotate'],
            width: 3,
            height: 2,
            grid: variantGrid,
            entryAnchorPoints: [{x: 0, y: 0}]
        };
    };
    const source = {
        name: 'fixed-child-anchor',
        width: 8,
        height: 6,
        grid,
        metadata: {
            orient: 'encompass',
            encompass: true,
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror'],
            matchAnchor: {x: 10, y: 10, glyphs: ['R']},
            matchPolicy: {
                minScore: 1,
                minEvidenceCells: 8,
                minEvidenceWeight: 8,
                minDistinctKinds: 2,
                minCoverage: 0,
                minSpanXRatio: 0,
                minSpanYRatio: 0,
                requiredKinds: ['wall', 'floor']
            },
            composite: {
                type: 'fixed-subvaults-v1',
                slots: [slot],
                variants: [
                    variant('room-one', [
                        ['floor', 'wall', 'floor'],
                        ['floor', 'door', 'wall']
                    ]),
                    variant('room-two', [
                        ['floor', 'wall', 'floor'],
                        ['wall', 'floor', 'wall']
                    ])
                ],
                shellEntryAnchorGlyphs: [],
                borderFillKind: 'wall',
                variantPolicy: {
                    minScore: 1,
                    minEvidenceCells: 2,
                    minEvidenceWeight: 2,
                    minDistinctKinds: 1,
                    minCoverage: 0,
                    minSpanXRatio: 0,
                    minSpanYRatio: 0,
                    requiredKinds: []
                }
            }
        }
    };
    const offset = {x: 8, y: 8};
    const actual = source.metadata.composite.variants[0];
    const truth = [];
    for (let worldY = 6; worldY < 16; worldY++) {
        for (let worldX = 6; worldX < 18; worldX++) {
            const sourceX = worldX - offset.x;
            const sourceY = worldY - offset.y;
            let kind = 'wall';
            if (sourceX >= 0 && sourceX < source.width
                && sourceY >= 0 && sourceY < source.height) {
                if (sourceX >= slot.x && sourceX < slot.x + slot.width
                    && sourceY >= slot.y && sourceY < slot.y + slot.height) {
                    kind = actual.grid[sourceY - slot.y][sourceX - slot.x]
                        .kinds[0];
                } else {
                    [kind] = source.grid[sourceY][sourceX].kinds;
                }
            }
            truth.push({x: worldX, y: worldY, kind});
        }
    }
    const withheld = new Set(['11,11', '12,11']);
    const matcher = new MapMatcher({
        worldWidth: 12,
        worldHeight: 10,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 2,
        minEvidenceWeight: 2,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations(truth.filter(cell =>
        !withheld.has(`${cell.x},${cell.y}`)));
    const truthByKey = new Map(truth.map(cell => [
        `${cell.x},${cell.y}`,
        cell.kind
    ]));

    assert.equal(result.ready, true, result.reason);
    assert.ok(result.predictions.length > 0);
    assert.equal(result.predictions.every(prediction =>
        truthByKey.get(`${prediction.x},${prediction.y}`)
            === prediction.kind), true);
    assert.ok(result.forcePredictions.length > 0);
});

test('Vaults composite uses a stair anchor and reveals exact slot consensus', () => {
    const source = vaultsCompositeMatcherFixture();
    const matcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);

    assert.equal(matcher.updateObservations([
        {x: 0, y: 0, kind: 'floor'}
    ]).reason, 'anchor-unverified');
    matcher.reset({keepTemplates: true});

    const chosen = ['prize', 'regular-one', 'regular-two', 'regular-three']
        .map(name => source.metadata.composite.variants.find(variant =>
            variant.name === name));
    const offset = {x: -5, y: -5};
    const truth = [];
    for (let worldY = -6; worldY <= 5; worldY++) {
        for (let worldX = -6; worldX <= 7; worldX++) {
            const sourceX = worldX - offset.x;
            const sourceY = worldY - offset.y;
            let kind = 'wall';
            if (sourceX >= 0 && sourceX < source.width
                && sourceY >= 0 && sourceY < source.height) {
                const slotIndex = source.metadata.composite.slots.findIndex(slot =>
                    sourceX >= slot.x && sourceX < slot.x + slot.width
                    && sourceY >= slot.y && sourceY < slot.y + slot.height);
                if (slotIndex >= 0) {
                    const slot = source.metadata.composite.slots[slotIndex];
                    kind = chosen[slotIndex]
                        .grid[sourceY - slot.y][sourceX - slot.x].kinds[0];
                } else {
                    [kind] = source.grid[sourceY][sourceX].kinds;
                }
            }
            truth.push({x: worldX, y: worldY, kind});
        }
    }
    const withheld = new Set(source.metadata.composite.slots.map(slot =>
        `${offset.x + slot.x + 1},${offset.y + slot.y + 1}`));
    const observations = truth.filter(entry =>
        !withheld.has(`${entry.x},${entry.y}`));
    const result = matcher.updateObservations(observations);
    const truthByPosition = new Map(truth.map(entry => [
        `${entry.x},${entry.y}`,
        entry.kind
    ]));

    assert.equal(result.ready, true, result.reason);
    assert.ok(result.predictions.length > 0);
    assert.equal(result.predictions.every(prediction =>
        truthByPosition.get(`${prediction.x},${prediction.y}`)
            === prediction.kind), true);
    assert.equal(result.predictions.some(prediction =>
        source.metadata.composite.slots.some(slot => {
            const sourceX = prediction.x - offset.x;
            const sourceY = prediction.y - offset.y;
            return sourceX >= slot.x && sourceX < slot.x + slot.width
                && sourceY >= slot.y && sourceY < slot.y + slot.height;
        })), true);

    const unanchored = structuredClone(source);
    delete unanchored.metadata.matchAnchor;
    const forceOnlyMatcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    forceOnlyMatcher.setTemplates([unanchored]);
    const forceOnly = forceOnlyMatcher.updateObservations(observations);
    assert.equal(forceOnly.ready, false);
    assert.equal(forceOnly.reason, 'placement-unverified');
    assert.deepEqual(forceOnly.predictions, []);
    assert.ok(forceOnly.forcePredictions.length > 0);

    const changedSlot = source.metadata.composite.slots[0];
    const changed = observations.filter(entry => {
        const sourceX = entry.x - offset.x;
        const sourceY = entry.y - offset.y;
        return sourceX >= changedSlot.x
            && sourceX < changedSlot.x + changedSlot.width
            && sourceY >= changedSlot.y
            && sourceY < changedSlot.y + changedSlot.height;
    }).map((entry, index) => ({
        ...entry,
        kind: index % 2 ? 'portal' : 'altar'
    }));
    const afterMutation = matcher.updateObservations(changed);
    assert.equal(matcher.volatileObservations.size, changed.length);
    assert.equal(afterMutation.predictions.every(prediction =>
        truthByPosition.get(`${prediction.x},${prediction.y}`)
            === prediction.kind), true);
    assert.equal(afterMutation.predictions.some(prediction =>
        matcher.volatileObservations.has(`${prediction.x},${prediction.y}`)), false);
});

test('a force-disabled singleton composite cannot auto-display best terrain', () => {
    const source = vaultsCompositeMatcherFixture();
    source.metadata.matchPolicy.forceRevealDisabled = true;
    source.metadata.composite.type = 'fixed-subvaults-v1';
    delete source.metadata.composite.regimes;
    source.metadata.composite.slots.forEach((slot, index) => {
        slot.role = `fixed-slot-${index}`;
    });
    source.metadata.composite.variants.forEach((variant, index) => {
        variant.roles = [`fixed-slot-${index}`];
    });
    const offset = {x: -5, y: -5};
    const observations = [];
    source.grid.forEach((row, y) => row.forEach((entry, x) => {
        if (x === 6 && y === 5) {
            return;
        }
        const slotIndex = source.metadata.composite.slots.findIndex(slot =>
            x >= slot.x && x < slot.x + slot.width
            && y >= slot.y && y < slot.y + slot.height);
        const kind = slotIndex < 0
            ? entry.kinds[0]
            : source.metadata.composite.variants[slotIndex]
                .grid[y - source.metadata.composite.slots[slotIndex].y]
                [x - source.metadata.composite.slots[slotIndex].x]
                .kinds[0];
        observations.push({
            x: offset.x + x,
            y: offset.y + y,
            kind
        });
    }));
    const matcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const result = matcher.updateObservations(observations);

    assert.equal(result.best.template.name, source.name);
    assert.equal(result.structuralSingleton, true);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'ambiguous');
    assert.deepEqual(result.predictions, []);
    assert.deepEqual(result.provisionalPredictions, []);
    assert.deepEqual(result.forcePredictions, []);
});

test('Vaults composite keeps the fixed shell when quadrant roles are modified', () => {
    const source = vaultsCompositeMatcherFixture();
    const matcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offset = {x: -5, y: -5};
    const observations = [{x: 0, y: 0, kind: 'stair'}];
    source.grid.forEach((row, y) => row.forEach((cell, x) => {
        const inSlot = source.metadata.composite.slots.some(slot =>
            x >= slot.x && x < slot.x + slot.width
            && y >= slot.y && y < slot.y + slot.height);
        if (!inSlot && cell.kinds.length === 1 && (x + y) % 3 === 0) {
            observations.push({
                x: offset.x + x,
                y: offset.y + y,
                kind: cell.kinds[0]
            });
        }
    }));
    source.metadata.composite.slots.forEach(slot => {
        for (let y = 0; y < slot.height; y++) {
            for (let x = 0; x < slot.width; x++) {
                observations.push({
                    x: offset.x + slot.x + x,
                    y: offset.y + slot.y + y,
                    kind: (x + y) % 2 ? 'portal' : 'altar'
                });
            }
        }
    });

    const result = matcher.updateObservations(observations);
    assert.equal(result.ready, true, result.reason);
    assert.equal(result.plausibleCandidateCount, 0);
    assert.ok(result.predictions.length > 0);
    assert.equal(result.predictions.some(prediction =>
        source.metadata.composite.slots.some(slot => {
            const sourceX = prediction.x - offset.x;
            const sourceY = prediction.y - offset.y;
            return sourceX >= slot.x && sourceX < slot.x + slot.width
                && sourceY >= slot.y && sourceY < slot.y + slot.height;
        })), false);
});

test('a ready quadrant decoy cannot eliminate an untested dynamic child', () => {
    const source = vaultsCompositeMatcherFixture();
    const dynamicCell = {
        kinds: [],
        certain: false,
        glyph: 'O',
        possibleGlyphs: ['O']
    };
    const fixed = kind => ({
        kinds: [kind],
        glyph: '.',
        possibleGlyphs: ['.']
    });
    source.metadata.composite.variants.push(
        {
            name: 'true-dynamic',
            roles: ['normalRegular'],
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror'],
            width: 2,
            height: 2,
            grid: [
                [structuredClone(dynamicCell), structuredClone(dynamicCell)],
                [structuredClone(dynamicCell), fixed('wall')]
            ]
        },
        {
            name: 'false-ready-decoy',
            roles: ['normalRegular'],
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror'],
            width: 2,
            height: 2,
            grid: [
                [fixed('wall'), fixed('floor')],
                [fixed('door'), fixed('floor')]
            ]
        }
    );
    const matcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 3,
        minEvidenceWeight: 3,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);
    const offset = {x: -5, y: -5};
    const observations = [];
    source.grid.forEach((row, y) => row.forEach((cell, x) => {
        const inSlot = source.metadata.composite.slots.some(slot =>
            x >= slot.x && x < slot.x + slot.width
            && y >= slot.y && y < slot.y + slot.height);
        if (!inSlot && cell.kinds.length === 1) {
            observations.push({
                x: offset.x + x,
                y: offset.y + y,
                kind: cell.kinds[0]
            });
        }
    }));
    const selectedNames = [
        'prize',
        'true-dynamic',
        'regular-one',
        'regular-two'
    ];
    source.metadata.composite.slots.forEach((slot, slotIndex) => {
        if (slotIndex === 1) {
            const actualObserved = [
                {x: 0, y: 0, kind: 'wall'},
                {x: 1, y: 0, kind: 'floor'},
                {x: 0, y: 1, kind: 'door'}
            ];
            observations.push(...actualObserved.map(entry => ({
                x: offset.x + slot.x + entry.x,
                y: offset.y + slot.y + entry.y,
                kind: entry.kind
            })));
            return;
        }
        const selected = source.metadata.composite.variants.find(variant =>
            variant.name === selectedNames[slotIndex]);
        selected.grid.forEach((row, y) => row.forEach((cell, x) => {
            observations.push({
                x: offset.x + slot.x + x,
                y: offset.y + slot.y + y,
                kind: cell.kinds[0]
            });
        }));
    });

    const result = matcher.updateObservations(observations);
    const dynamicSlot = source.metadata.composite.slots[1];
    const target = {
        x: offset.x + dynamicSlot.x + 1,
        y: offset.y + dynamicSlot.y + 1
    };
    assert.equal(result.ready, true, result.reason);
    assert.equal(result.predictions.some(prediction =>
        prediction.x === target.x && prediction.y === target.y), false);
});

test('a ready shifted stair anchor cannot eliminate an unresolved true parent', () => {
    const source = vaultsCompositeMatcherFixture();
    source.grid[5][8] = {
        kinds: ['stair'],
        glyph: '<',
        possibleGlyphs: ['<']
    };
    source.metadata.matchPolicy = {
        minScore: 1,
        minEvidenceCells: 5,
        minEvidenceWeight: 5,
        minDistinctKinds: 2,
        minCoverage: 0,
        minSpanXRatio: 0,
        minSpanYRatio: 0,
        requiredKinds: []
    };
    source.metadata.composite.variantPolicy.minDistinctKinds = 1;
    const matcher = new MapMatcher({
        worldWidth: 14,
        worldHeight: 12,
        requireExhaustivePlacement: true,
        minScore: 1,
        minEvidenceCells: 1,
        minEvidenceWeight: 1,
        minDistinctKinds: 1,
        minPredictedCells: 1
    });
    matcher.setTemplates([source]);

    // The real offset is -5,-5. These four floor cells belong to its dynamic
    // child slot, so they provide no parent-shell evidence and contradict
    // every fully-tested prize/regular child. At the shifted `<` anchor
    // offset (-8,-5), however, they coincide with ordinary floor cells and
    // make that wrong parent and its unresolved child pools look viable.
    const observations = [
        {x: 0, y: 0, kind: 'stair'},
        {x: -4, y: -4, kind: 'floor'},
        {x: -3, y: -4, kind: 'floor'},
        {x: -4, y: -3, kind: 'floor'},
        {x: -3, y: -3, kind: 'floor'}
    ];
    const result = matcher.updateObservations(observations);
    const target = {x: 3, y: -2};

    assert.equal(result.ready, true, result.reason);
    assert.equal(result.best.offsetX, -8);
    assert.equal(result.candidates.some(candidate =>
        candidate.offsetX === -5 && candidate.offsetY === -5), true);
    assert.ok(result.plausibleCandidateCount > 0);
    // Wrong offset sees a wall here; the unresolved real offset's fixed shell
    // sees floor. Its per-parent shell fallback must suppress that false wall.
    assert.equal(result.predictions.some(prediction =>
        prediction.x === target.x && prediction.y === target.y), false);
});
