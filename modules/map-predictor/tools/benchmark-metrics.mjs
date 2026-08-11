function finiteNumber(value) {
    return Number.isFinite(value) ? value : null;
}

function rounded(value, digits = 6) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return Number(value.toFixed(digits));
}

function coordinateKey(cell) {
    return `${cell.x},${cell.y}`;
}

function predictionKind(cell) {
    return typeof cell?.kind === 'string' ? cell.kind : null;
}

export function matchIdentity(sample) {
    const match = sample?.match;
    if (!match?.name) {
        return null;
    }
    return [
        match.name,
        match.transform || '?',
        finiteNumber(match.offsetX) ?? '?',
        finiteNumber(match.offsetY) ?? '?'
    ].join('|');
}

export function comparePredictionTruth(predictions = [], truth = []) {
    const truthByCoordinate = new Map();
    for (const cell of truth) {
        if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)
            || !predictionKind(cell)) {
            continue;
        }
        truthByCoordinate.set(coordinateKey(cell), predictionKind(cell));
    }

    let checked = 0;
    let matches = 0;
    const mismatches = [];
    const unverifiable = [];
    for (const cell of predictions) {
        if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)
            || !predictionKind(cell)) {
            continue;
        }
        const key = coordinateKey(cell);
        if (!truthByCoordinate.has(key)) {
            unverifiable.push({x: cell.x, y: cell.y, predicted: cell.kind});
            continue;
        }
        checked++;
        const actual = truthByCoordinate.get(key);
        if (actual === cell.kind) {
            matches++;
        } else {
            mismatches.push({
                x: cell.x,
                y: cell.y,
                predicted: cell.kind,
                actual
            });
        }
    }

    const predictionCount = predictions.filter(cell =>
        Number.isInteger(cell?.x) && Number.isInteger(cell?.y)
            && predictionKind(cell)).length;
    return {
        predictionCount,
        truthCount: truthByCoordinate.size,
        checked,
        matches,
        mismatchCount: mismatches.length,
        unverifiableCount: unverifiable.length,
        precision: checked > 0 ? rounded(matches / checked) : null,
        predictionTruthCoverage: predictionCount > 0
            ? rounded(checked / predictionCount)
            : null,
        mismatches: mismatches.slice(0, 100),
        unverifiable: unverifiable.slice(0, 100),
        examplesTruncated: mismatches.length > 100 || unverifiable.length > 100
    };
}

function stateKey(sample) {
    return JSON.stringify([
        sample.eventTime,
        sample.resetSequence,
        sample.status,
        sample.reason,
        sample.observations,
        sample.known,
        sample.displayed,
        sample.native,
        sample.safe,
        sample.provisional,
        sample.bestDisplay,
        sample.force,
        sample.plausible,
        sample.predictionMode,
        sample.revealEnabled,
        sample.forceRevealActive,
        sample.error,
        matchIdentity(sample),
        rounded(sample.match?.score),
        rounded(sample.match?.margin)
    ]);
}

export function compactTimeline(samples = []) {
    const compact = [];
    let previousKey = null;
    for (const sample of samples) {
        const key = stateKey(sample);
        if (key === previousKey) {
            continue;
        }
        previousKey = key;
        compact.push({
            eventTime: finiteNumber(sample.eventTime),
            eventIndex: finiteNumber(sample.eventIndex),
            resetSequence: finiteNumber(sample.resetSequence),
            trigger: sample.trigger || null,
            place: sample.player?.place ?? null,
            depth: finiteNumber(sample.player?.depth),
            observations: sample.observations ?? 0,
            known: sample.known ?? 0,
            best: matchIdentity(sample),
            identity: matchIdentity(sample),
            score: rounded(sample.match?.score),
            margin: rounded(sample.match?.margin),
            reason: sample.reason ?? null,
            plausible: sample.plausible ?? 0,
            displayed: sample.displayed ?? 0,
            native: sample.native ?? 0,
            safe: sample.safe ?? 0,
            provisional: sample.provisional ?? 0,
            bestDisplay: sample.bestDisplay ?? 0,
            force: sample.force ?? 0,
            predictionMode: sample.predictionMode ?? 'none',
            revealEnabled: Boolean(sample.revealEnabled),
            forceRevealActive: Boolean(sample.forceRevealActive),
            error: sample.error || null
        });
    }
    return compact;
}

function identityChanges(samples) {
    const changes = [];
    let previous;
    for (const sample of samples) {
        const identity = matchIdentity(sample);
        if (identity === previous) {
            continue;
        }
        changes.push({
            eventTime: finiteNumber(sample.eventTime),
            eventIndex: finiteNumber(sample.eventIndex),
            observations: sample.observations ?? 0,
            from: previous ?? null,
            to: identity
        });
        previous = identity;
    }
    return changes;
}

function firstStableSample(samples, finalIdentity) {
    if (!finalIdentity) {
        return null;
    }
    let lastDifferent = -1;
    for (let index = 0; index < samples.length; index++) {
        if (matchIdentity(samples[index]) !== finalIdentity) {
            lastDifferent = index;
        }
    }
    for (let index = lastDifferent + 1; index < samples.length; index++) {
        if (matchIdentity(samples[index]) === finalIdentity) {
            return samples[index];
        }
    }
    return null;
}

function automaticDisplaySample(samples) {
    return samples.find(sample => sample.displayed > 0
        && sample.forceRevealActive !== true
        && (sample.predictionMode === 'safe'
            || sample.predictionMode === 'provisional'
            || sample.predictionMode === 'best')) || null;
}

function lastNonNullIdentity(samples) {
    for (let index = samples.length - 1; index >= 0; index--) {
        const identity = matchIdentity(samples[index]);
        if (identity) {
            return identity;
        }
    }
    return null;
}

export function summarizeTimeline(samples = []) {
    const timeline = compactTimeline(samples);
    const changes = identityChanges(samples);
    const finalIdentity = lastNonNullIdentity(samples);
    const stable = firstStableSample(samples, finalIdentity);
    const automatic = automaticDisplaySample(samples);
    const nonNullChanges = changes.filter(change => change.to !== null);
    let flips = 0;
    let previousIdentity = null;
    for (const change of nonNullChanges) {
        if (previousIdentity && previousIdentity !== change.to) {
            flips++;
        }
        previousIdentity = change.to;
    }

    return {
        sampleCount: samples.length,
        eventTimeRange: samples.length > 0
            ? [finiteNumber(samples[0].eventTime), finiteNumber(samples.at(-1).eventTime)]
            : [null, null],
        maxObservations: Math.max(0, ...samples.map(sample =>
            Number(sample.observations) || 0)),
        maxKnown: Math.max(0, ...samples.map(sample =>
            Number(sample.known) || 0)),
        maxDisplayed: Math.max(0, ...samples.map(sample =>
            Number(sample.displayed) || 0)),
        maxNative: Math.max(0, ...samples.map(sample =>
            Number(sample.native) || 0)),
        maxBestDisplay: Math.max(0, ...samples.map(sample =>
            Number(sample.bestDisplay) || 0)),
        finalIdentity,
        identityFlipCount: flips,
        identityChanges: changes,
        firstStablePoint: stable ? {
            eventTime: finiteNumber(stable.eventTime),
            eventIndex: finiteNumber(stable.eventIndex),
            observations: stable.observations ?? 0,
            identity: finalIdentity,
            score: rounded(stable.match?.score),
            reason: stable.reason ?? null
        } : null,
        firstAutomaticDisplay: automatic ? {
            eventTime: finiteNumber(automatic.eventTime),
            eventIndex: finiteNumber(automatic.eventIndex),
            observations: automatic.observations ?? 0,
            identity: matchIdentity(automatic),
            displayed: automatic.displayed,
            native: automatic.native,
            mode: automatic.predictionMode,
            score: rounded(automatic.match?.score),
            reason: automatic.reason ?? null
        } : null,
        automaticDisplaySucceeded: Boolean(automatic),
        forcedDisplaySeen: samples.some(sample =>
            sample.forceRevealActive === true && sample.displayed > 0),
        timeline
    };
}

function targetMatches(sample, target) {
    const time = finiteNumber(sample.eventTime);
    if (Number.isFinite(target.fromTime) && (!Number.isFinite(time)
        || time < target.fromTime)) {
        return false;
    }
    if (Number.isFinite(target.toTime) && (!Number.isFinite(time)
        || time > target.toTime)) {
        return false;
    }
    if (target.place && sample.player?.place !== target.place) {
        return false;
    }
    if (Number.isFinite(target.depth)
        && Number(sample.player?.depth) !== target.depth) {
        return false;
    }
    return true;
}

function groupByReset(samples) {
    const groups = new Map();
    for (const sample of samples) {
        const key = Number.isFinite(sample.resetSequence)
            ? sample.resetSequence
            : 0;
        const group = groups.get(key) || [];
        group.push(sample);
        groups.set(key, group);
    }
    return [...groups.entries()].map(([resetSequence, group]) => ({
        resetSequence,
        ...summarizeTimeline(group)
    }));
}

export function auditReset(reset) {
    const after = reset?.after || {};
    const staleFields = [];
    for (const field of ['observations', 'displayed', 'native']) {
        if ((Number(after[field]) || 0) !== 0) {
            staleFields.push(field);
        }
    }
    if (after.matchIdentity) {
        staleFields.push('matchIdentity');
    }
    if (after.autoRevealApplied === true) {
        staleFields.push('autoRevealApplied');
    }
    return {
        eventTime: finiteNumber(reset?.eventTime),
        eventIndex: finiteNumber(reset?.eventIndex),
        resetSequence: finiteNumber(reset?.resetSequence),
        options: reset?.options || {},
        before: reset?.before || null,
        after: reset?.after || null,
        passed: staleFields.length === 0,
        staleFields
    };
}

export function buildBenchmarkReport(raw, sidecar, metadata = {}) {
    const samples = Array.isArray(raw?.samples) ? raw.samples : [];
    const targets = (sidecar.targets || []).map((target, index) => {
        const id = target.id || `target-${index + 1}`;
        const targetSamples = samples.filter(sample => targetMatches(sample, target));
        const truth = raw?.truth?.[id] || null;
        return {
            id,
            selector: {
                place: target.place ?? null,
                depth: finiteNumber(target.depth),
                fromTime: finiteNumber(target.fromTime),
                toTime: finiteNumber(target.toTime),
                truthAt: finiteNumber(target.truthAt)
            },
            ...summarizeTimeline(targetSamples),
            resetSegments: groupByReset(targetSamples),
            truth: truth ? {
                capturedAt: finiteNumber(truth.capturedAt),
                finalizedAt: finiteNumber(truth.finalizedAt),
                predictionMode: truth.predictionMode || null,
                displayed: comparePredictionTruth(
                    truth.displayedPredictions,
                    truth.observations
                ),
                safe: comparePredictionTruth(
                    truth.safePredictions,
                    truth.observations
                ),
                provisional: comparePredictionTruth(
                    truth.provisionalPredictions,
                    truth.observations
                ),
                bestDisplay: comparePredictionTruth(
                    truth.bestDisplayPredictions,
                    truth.observations
                )
            } : null
        };
    });
    const resetAudits = (raw?.resets || []).map(auditReset);

    return {
        schemaVersion: 1,
        benchmark: sidecar.name || metadata.recordingName || 'map-predictor',
        recording: {
            name: metadata.recordingName || null,
            sha256: metadata.recordingSha256 || null,
            source: metadata.recordingSource || null
        },
        dwemCommit: metadata.dwemCommit || sidecar.dwemCommit || null,
        crawlVersion: raw?.finalState?.versionText || null,
        playback: {
            startTime: finiteNumber(sidecar.startTime) ?? 0,
            endTime: finiteNumber(sidecar.endTime),
            speed: finiteNumber(sidecar.speed) ?? 10,
            preludeMs: finiteNumber(sidecar.preludeMs) ?? 30000,
            crop: raw?.crop ? {
                requestedCutoff: finiteNumber(raw.crop.requestedCutoff),
                cutoff: finiteNumber(raw.crop.cutoff),
                firstTargetTime: finiteNumber(raw.crop.firstTargetTime),
                originalMessageCount: finiteNumber(
                    raw.crop.originalMessageCount
                ),
                retainedMessageCount: finiteNumber(
                    raw.crop.retainedMessageCount
                ),
                droppedMenuMessageCount: finiteNumber(
                    raw.crop.droppedMenuMessageCount
                )
            } : null,
            lastEventTime: finiteNumber(raw?.currentEventTime),
            lastEventIndex: finiteNumber(raw?.currentEventIndex)
        },
        targets,
        resets: {
            count: resetAudits.length,
            failedCount: resetAudits.filter(audit => !audit.passed).length,
            audits: resetAudits
        },
        errors: Array.isArray(metadata.errors) ? metadata.errors : [],
        adapter: raw?.adapter || null,
        finalState: raw?.finalState || null
    };
}
