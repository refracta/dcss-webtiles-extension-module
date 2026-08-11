import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
    auditReset,
    buildBenchmarkReport,
    comparePredictionTruth,
    summarizeTimeline
} from '../benchmark-metrics.mjs';

function sample(overrides = {}) {
    return {
        eventTime: 0,
        eventIndex: 0,
        resetSequence: 1,
        trigger: 'status',
        player: {place: 'Vaults', depth: 5},
        status: 'matching',
        reason: 'insufficient-evidence',
        observations: 10,
        displayed: 0,
        native: 0,
        safe: 0,
        provisional: 0,
        force: 100,
        plausible: 4,
        predictionMode: 'none',
        revealEnabled: false,
        forceRevealActive: false,
        match: null,
        ...overrides
    };
}

test('truth comparison separates mismatches from unavailable truth', () => {
    const result = comparePredictionTruth([
        {x: 1, y: 1, kind: 'floor'},
        {x: 2, y: 2, kind: 'wall'},
        {x: 3, y: 3, kind: 'door'}
    ], [
        {x: 1, y: 1, kind: 'floor'},
        {x: 2, y: 2, kind: 'floor'}
    ]);
    assert.deepEqual({
        predictionCount: result.predictionCount,
        checked: result.checked,
        matches: result.matches,
        mismatchCount: result.mismatchCount,
        unverifiableCount: result.unverifiableCount,
        precision: result.precision,
        predictionTruthCoverage: result.predictionTruthCoverage
    }, {
        predictionCount: 3,
        checked: 2,
        matches: 1,
        mismatchCount: 1,
        unverifiableCount: 1,
        precision: 0.5,
        predictionTruthCoverage: 0.666667
    });
});

test('timeline reports identity flips, stable point, and automatic display', () => {
    const a = {name: 'vault_a', transform: 'identity', offsetX: 1, offsetY: 2,
        score: 0.8, margin: 0.01};
    const b = {name: 'vault_b', transform: 'rot90', offsetX: 3, offsetY: 4,
        score: 0.99, margin: 0.2};
    const summary = summarizeTimeline([
        sample(),
        sample({eventTime: 10, observations: 20, match: a}),
        sample({eventTime: 20, observations: 30, match: b}),
        sample({
            eventTime: 30,
            observations: 40,
            match: b,
            displayed: 120,
            native: 100,
            provisional: 120,
            predictionMode: 'provisional',
            revealEnabled: true
        })
    ]);
    assert.equal(summary.identityFlipCount, 1);
    assert.equal(summary.finalIdentity, 'vault_b|rot90|3|4');
    assert.equal(summary.firstStablePoint.eventTime, 20);
    assert.equal(summary.firstAutomaticDisplay.eventTime, 30);
    assert.equal(summary.automaticDisplaySucceeded, true);
    assert.equal(summary.forcedDisplaySeen, false);
});

test('reset audit catches stale matcher and rendered state', () => {
    assert.equal(auditReset({after: {
        observations: 0,
        displayed: 0,
        native: 0,
        matchIdentity: null,
        autoRevealApplied: false
    }}).passed, true);
    assert.deepEqual(auditReset({after: {
        observations: 4,
        displayed: 0,
        native: 2,
        matchIdentity: 'old|identity|0|0',
        autoRevealApplied: true
    }}).staleFields, [
        'observations',
        'native',
        'matchIdentity',
        'autoRevealApplied'
    ]);
});

test('same-key Pandemonium clear is audited as a level reset', () => {
    const levelKey = 'Pandemonium\u00000';
    const audit = auditReset({
        eventTime: 4000,
        eventIndex: 50,
        resetSequence: 3,
        options: {resetAutoReveal: true},
        before: {
            levelKey,
            observations: 220,
            displayed: 140,
            native: 90,
            matchIdentity: 'pan_old|r0|1|2',
            autoRevealApplied: true
        },
        after: {
            levelKey,
            observations: 0,
            displayed: 0,
            native: 0,
            matchIdentity: null,
            autoRevealApplied: false
        }
    });
    assert.equal(audit.passed, true);
    assert.equal(audit.after.levelKey, audit.before.levelKey);
    assert.equal(audit.options.resetAutoReveal, true);
});

test('synthetic fixture groups resets and attaches truth metrics', async () => {
    const fixture = JSON.parse(await readFile(new URL(
        './fixtures/synthetic-timeline.json',
        import.meta.url
    ), 'utf8'));
    const report = buildBenchmarkReport(fixture.raw, fixture.sidecar, {
        recordingName: 'fixture.wtrec',
        recordingSha256: 'abc'
    });
    assert.equal(report.targets[0].resetSegments.length, 2);
    assert.equal(report.targets[0].truth.displayed.precision, 1);
    assert.equal(report.recording.sha256, 'abc');
});
