import MapMatcher from './matcher.js';

let matcher = null;
let templateGeneration = 0;

function compactTemplate(template) {
    if (!template) {
        return null;
    }
    return {
        name: template.name || null,
        path: template.path || null
    };
}

function compactBest(best) {
    if (!best) {
        return null;
    }
    return {
        template: compactTemplate(best.template),
        score: best.score,
        evidenceCells: best.evidenceCells,
        evidenceWeight: best.evidenceWeight,
        distinctKinds: best.distinctKinds,
        constrainedCells: best.constrainedCells,
        predictableCells: best.predictableCells,
        coverage: best.coverage,
        spanX: best.spanX,
        spanY: best.spanY,
        spanXRatio: best.spanXRatio,
        spanYRatio: best.spanYRatio,
        observedKinds: Array.isArray(best.observedKinds)
            ? [...best.observedKinds]
            : [],
        requiredKindsReady: best.requiredKindsReady,
        focusReady: best.focusReady,
        transform: best.transform,
        placementSearch: best.placementSearch,
        offsetX: best.offsetX,
        offsetY: best.offsetY
    };
}

export function compactMatcherResult(result) {
    return {
        ready: Boolean(result?.ready),
        unique: Boolean(result?.unique),
        best: compactBest(result?.best),
        margin: result?.margin ?? null,
        predictions: Array.isArray(result?.predictions)
            ? result.predictions.map(cell => ({
                x: cell.x,
                y: cell.y,
                kind: cell.kind
            }))
            : [],
        provisionalPredictions: Array.isArray(result?.provisionalPredictions)
            ? result.provisionalPredictions.map(cell => ({
                x: cell.x,
                y: cell.y,
                kind: cell.kind
            }))
            : [],
        bestDisplayPredictions: Array.isArray(result?.bestDisplayPredictions)
            ? result.bestDisplayPredictions.map(cell => ({
                x: cell.x,
                y: cell.y,
                kind: cell.kind
            }))
            : [],
        forcePredictions: Array.isArray(result?.forcePredictions)
            ? result.forcePredictions.map(cell => ({
                x: cell.x,
                y: cell.y,
                kind: cell.kind
            }))
            : [],
        structuralSingleton: result?.structuralSingleton === true,
        plausibleCandidateCount: result?.plausibleCandidateCount ?? 0,
        consensusOverflow: Boolean(result?.consensusOverflow),
        reason: result?.reason || 'not-evaluated'
    };
}

function errorData(error) {
    return {
        code: error?.code || error?.name || 'worker-error',
        message: error?.message || String(error)
    };
}

function reply(message) {
    globalThis.postMessage(message);
}

function handleConfigure(message) {
    templateGeneration = message.templateGeneration;
    matcher = new MapMatcher(message.options || {});
    matcher.setTemplates(message.templates || []);
    reply({
        type: 'configured',
        versionGeneration: message.versionGeneration,
        levelGeneration: message.levelGeneration,
        templateGeneration
    });
}

function handleEvaluate(message) {
    if (!matcher || message.templateGeneration !== templateGeneration) {
        throw new Error('Matcher worker configuration is stale.');
    }
    matcher.reset({keepTemplates: true});
    matcher.updateObservations(message.observations || [], {evaluate: false});
    matcher.setVolatileObservations(
        message.volatileObservations || [],
        {evaluate: false}
    );
    matcher.setFocusPosition(message.focusPosition, {evaluate: false});
    const result = compactMatcherResult(matcher.evaluate());
    reply({
        type: 'result',
        requestId: message.requestId,
        versionGeneration: message.versionGeneration,
        levelGeneration: message.levelGeneration,
        templateGeneration: message.templateGeneration,
        observationRevision: message.observationRevision,
        result
    });
}

function handleMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== 'object') {
        return;
    }
    try {
        if (message.type === 'configure') {
            handleConfigure(message);
        } else if (message.type === 'evaluate') {
            handleEvaluate(message);
        }
    } catch (error) {
        reply({
            type: 'error',
            phase: message.type,
            requestId: message.requestId,
            versionGeneration: message.versionGeneration,
            levelGeneration: message.levelGeneration,
            templateGeneration: message.templateGeneration,
            observationRevision: message.observationRevision,
            error: errorData(error)
        });
    }
}

if (typeof globalThis.addEventListener === 'function'
    && typeof globalThis.postMessage === 'function') {
    globalThis.addEventListener('message', handleMessage);
}
