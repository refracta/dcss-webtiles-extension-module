import assert from 'node:assert/strict';
import test from 'node:test';

import {
    default as ConvenienceModule,
    createMapPredictorStatus,
    mergeConvenienceStatuses
} from './index.js';
import MapPredictor from '../map-predictor/index.js';

function readySummary(overrides = {}) {
    return {
        rcEnabled: true,
        runtimeEnabled: true,
        status: 'map-inferred',
        resultReason: 'ready',
        templates: ['alpha', 'beta'],
        plausibleCandidateCount: 1,
        safePredictionCount: 120,
        forcePredictionCount: 135,
        predictionCount: 120,
        revealEnabled: true,
        forceRevealActive: false,
        match: {
            name: 'alpha_map',
            score: 0.9876,
            evidenceCells: 384,
            distinctKinds: 4,
            coverage: 0.425,
            unique: true
        },
        ...overrides
    };
}

test('Map status is absent without an RC-enabled MapPredictor', () => {
    assert.equal(createMapPredictorStatus(null), null);
    assert.equal(createMapPredictorStatus({rcEnabled: false}), null);
});

test('Map status summarizes score and detailed matcher state', () => {
    const status = createMapPredictorStatus(readySummary());

    assert.equal(status.light, 'Map (98.8%)');
    assert.equal(status.col, 10);
    assert.equal(status.dwemStatusId, 'map-predictor');
    assert.match(status.desc, /MapPredictor: enabled \(RC enabled; Ctrl-M on\)/u);
    assert.match(status.desc, /Best candidate: alpha_map \(98\.8%\)/u);
    assert.match(status.desc, /terrain similarity, not the probability/u);
    assert.match(status.desc, /Verdict: SAFE; reason: ready/u);
    assert.match(status.desc, /Evidence: 384 cells, 4 kinds, 42\.5% coverage/u);
    assert.match(status.desc, /Candidates: 2 loaded, 1 plausible/u);
    assert.match(status.desc, /Predictions: 120 safe, 135 inferred, 120 displayed/u);
    assert.match(status.desc, /Reveal: on/u);
});

test('Map status labels safe consensus without claiming a unique map identity', () => {
    const status = createMapPredictorStatus(readySummary({
        plausibleCandidateCount: 3,
        match: {
            ...readySummary().match,
            unique: false
        }
    }));

    assert.equal(status.col, 10);
    assert.match(status.desc, /Best candidate: alpha_map/u);
    assert.match(
        status.desc,
        /Verdict: SAFE CONSENSUS \(ambiguous identity\); reason: ready/u
    );
    assert.doesNotMatch(status.desc, /Verdict: SAFE;/u);
});

test('Map status is absent while Ctrl-M has paused the runtime', () => {
    const status = createMapPredictorStatus(readySummary({
        runtimeEnabled: false,
        revealEnabled: false
    }));

    assert.equal(status, null);
});

test('Map status distinguishes an unsafe unaccepted candidate', () => {
    const status = createMapPredictorStatus(readySummary({
        resultReason: 'ambiguous',
        plausibleCandidateCount: 3,
        revealEnabled: false
    }));

    assert.equal(status.col, 14);
    assert.match(status.desc, /Verdict: UNSAFE \(unaccepted\)/u);
    assert.match(status.desc, /reason: ambiguous/u);
    assert.match(status.desc, /3 plausible/u);
});

test('status merge replaces only ConvenienceModule entries', () => {
    const serverStatus = {light: 'Haste', text: 'hasted'};
    const foreignCustom = {
        light: 'Other',
        text: 'other',
        isCustomStatus: true
    };
    const staleGold = {
        light: 'Gold (1)',
        text: 'gold',
        isCustomStatus: true
    };
    const staleMap = {
        light: 'Map (1.0%)',
        text: 'map predictor',
        isCustomStatus: true,
        dwemStatusId: 'map-predictor'
    };
    const gold = {light: 'Gold (42)', dwemStatusId: 'convenience-gold'};
    const map = createMapPredictorStatus(readySummary());

    assert.deepEqual(
        mergeConvenienceStatuses(
            [serverStatus, foreignCustom, staleGold, staleMap],
            {gold, map}
        ),
        [serverStatus, foreignCustom, gold, map]
    );
});

test('status subscription coalesces refreshes and ignores identical content', async () => {
    const module = new ConvenienceModule();
    let refreshes = 0;
    module.refreshPlayerStatus = () => {
        refreshes++;
    };
    module.mapPredictorSummary = null;
    module.mapPredictorStatusFingerprint = null;

    module.handleMapPredictorStatus(readySummary());
    module.handleMapPredictorStatus(readySummary());
    assert.equal(refreshes, 0);
    await Promise.resolve();
    assert.equal(refreshes, 1);

    module.handleMapPredictorStatus(readySummary({
        match: {
            ...readySummary().match,
            score: 0.991
        }
    }));
    await Promise.resolve();
    assert.equal(refreshes, 2);

    module.handleMapPredictorStatus({rcEnabled: false});
    await Promise.resolve();
    assert.equal(refreshes, 3);
    assert.equal(module.mapPredictorSummary, null);

    module.handleMapPredictorStatus({rcEnabled: false});
    await Promise.resolve();
    assert.equal(refreshes, 3);
});

test('status subscription releases its snapshot when Ctrl-M pauses', async () => {
    const module = new ConvenienceModule();
    module.refreshPlayerStatus = () => {};
    module.mapPredictorSummary = null;
    module.mapPredictorStatusFingerprint = null;

    module.handleMapPredictorStatus(readySummary());
    await Promise.resolve();
    assert.notEqual(module.mapPredictorSummary, null);

    module.handleMapPredictorStatus(readySummary({runtimeEnabled: false}));
    await Promise.resolve();
    assert.equal(module.mapPredictorSummary, null);
});

function hookPoint() {
    const handlers = [];
    return {
        handlers,
        addHandler(identifier, handler) {
            handlers.push({identifier, handler});
        },
        removeHandler(identifier) {
            for (let index = handlers.length - 1; index >= 0; index--) {
                if (handlers[index].identifier === identifier) {
                    handlers.splice(index, 1);
                }
            }
        }
    };
}

class TrackedEventTarget extends EventTarget {
    constructor() {
        super();
        this.listeners = new Map();
    }

    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        this.listeners.get(type)?.delete(listener);
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }
}

function statusBridgeHarness({registerPredictor = true} = {}) {
    const previousDWEM = globalThis.DWEM;
    const previousDocument = globalThis.document;
    const document = new TrackedEventTarget();
    const receiveBefore = hookPoint();
    const receiveAfter = hookPoint();
    const sendAfter = hookPoint();
    const handleMessage = () => {};
    handleMessage.before = receiveBefore;
    handleMessage.after = receiveAfter;
    const sendMessage = () => {};
    sendMessage.after = sendAfter;
    const rcHandlers = new Map();
    const rcManager = {
        addHandlers(identifier, handlers) {
            rcHandlers.set(identifier, handlers);
        },
        removeHandlers(identifier) {
            rcHandlers.delete(identifier);
        },
        getRCOption(rcfile, option, type, fallback) {
            return fallback;
        }
    };
    const dwem = {
        Modules: {
            IOHook: {
                handle_message: handleMessage,
                send_message: sendMessage
            },
            RCManager: rcManager,
            CommandManager: {
                addCommand() {}
            }
        },
        SourceMapperRegistry: {
            getSourceMapper() {
                return source => source;
            },
            add() {}
        }
    };
    const convenience = new ConvenienceModule();
    const predictor = new MapPredictor({dwem, document});
    dwem.Modules.ConvenienceModule = convenience;
    if (registerPredictor) {
        dwem.Modules.MapPredictor = predictor;
    }
    globalThis.DWEM = dwem;
    globalThis.document = document;

    return {
        convenience,
        document,
        dwem,
        predictor,
        receiveBefore,
        restore() {
            convenience.destroy();
            predictor.destroy();
            if (previousDWEM === undefined) {
                delete globalThis.DWEM;
            } else {
                globalThis.DWEM = previousDWEM;
            }
            if (previousDocument === undefined) {
                delete globalThis.document;
            } else {
                globalThis.document = previousDocument;
            }
        }
    };
}

test('default order subscribes when Convenience onLoad precedes MapPredictor onLoad', async () => {
    const harness = statusBridgeHarness();
    const {convenience, document, predictor, receiveBefore} = harness;
    let statusDeliveries = 0;
    const originalHandler = convenience.handleMapPredictorStatus.bind(convenience);
    convenience.handleMapPredictorStatus = summary => {
        statusDeliveries++;
        originalHandler(summary);
    };

    try {
        // This is the loader's real lifecycle: all instances are registered in
        // DWEM.Modules, then onLoad runs in default-list order.
        convenience.onLoad();
        assert.equal(predictor.statusSubscribers.size, 1);
        assert.equal(statusDeliveries, 1);
        assert.equal(document.listenerCount('dwem:map-predictor-ready'), 0);

        predictor.onLoad();
        await Promise.resolve();

        // The ready event must not create a duplicate subscription after the
        // normal pre-registered-instance path already connected the modules.
        assert.equal(predictor.statusSubscribers.size, 1);
        assert.equal(statusDeliveries, 2);
        assert.equal(predictor.runtime, null);
        assert.equal(predictor.rcEnabled, false);
        assert.equal(
            receiveBefore.handlers.some(
                entry => entry.identifier === 'convenience-module-status'
            ),
            false
        );
    } finally {
        harness.restore();
    }
});

test('ready event connects a late-registered MapPredictor and is removed on destroy', () => {
    const harness = statusBridgeHarness({registerPredictor: false});
    const {convenience, document, dwem, predictor} = harness;
    try {
        convenience.onLoad();
        assert.equal(convenience.mapPredictorStatusSource, undefined);
        assert.equal(document.listenerCount('dwem:map-predictor-ready'), 1);

        dwem.Modules.MapPredictor = predictor;
        predictor.onLoad();
        assert.equal(convenience.mapPredictorStatusSource, predictor);
        assert.equal(predictor.statusSubscribers.size, 1);
        assert.equal(predictor.runtime, null);
        assert.equal(document.listenerCount('dwem:map-predictor-ready'), 0);

        convenience.destroy();
        assert.equal(predictor.statusSubscribers.size, 0);
        predictor.announceReady();
        assert.equal(predictor.statusSubscribers.size, 0);
    } finally {
        harness.restore();
    }
});

test('status packet hooks exist only while Gold or Map has a visible consumer', async () => {
    const previousDWEM = globalThis.DWEM;
    const before = hookPoint();
    const after = hookPoint();
    const delivered = [];
    const ioHook = {
        handle_message(data) {
            for (const entry of [...before.handlers]) {
                entry.handler(data);
            }
            delivered.push(structuredClone(data));
            module.player.status = structuredClone(data.status);
            for (const entry of [...after.handlers]) {
                entry.handler(data);
            }
        }
    };
    ioHook.handle_message.before = before;
    ioHook.handle_message.after = after;
    globalThis.DWEM = {Modules: {IOHook: ioHook}};

    const nativeStatus = {light: 'Haste', text: 'hasted'};
    const staleGold = {
        light: 'Gold (1)',
        text: 'gold',
        isCustomStatus: true
    };
    const staleMap = {
        light: 'Map (1.0%)',
        text: 'map predictor',
        isCustomStatus: true,
        dwemStatusId: 'map-predictor'
    };
    const module = new ConvenienceModule();
    module.statusLifecycleReady = true;
    module.statusHooksInstalled = false;
    module.removeStatusHooksAfterRefresh = false;
    module.mapPredictorSummary = null;
    module.mapPredictorStatusFingerprint = null;
    module.showGoldStatus = false;
    module.player = {
        god: null,
        gold: 42,
        status: [nativeStatus, staleGold, staleMap]
    };

    try {
        module.syncStatusHooks();
        assert.equal(before.handlers.length, 0);
        assert.equal(after.handlers.length, 0);

        module.handleMapPredictorStatus(readySummary());
        module.handleMapPredictorStatus(readySummary());
        assert.equal(before.handlers.length, 1);
        assert.equal(after.handlers.length, 1);
        await Promise.resolve();
        assert.deepEqual(
            delivered.at(-1).status.map(status => status.dwemStatusId || status.text),
            ['hasted', 'map-predictor']
        );

        module.handleMapPredictorStatus({rcEnabled: false});
        assert.equal(before.handlers.length, 1);
        await Promise.resolve();
        assert.deepEqual(delivered.at(-1).status, [nativeStatus]);
        assert.equal(before.handlers.length, 0);
        assert.equal(after.handlers.length, 0);

        module.showGoldStatus = true;
        module.syncStatusHooks();
        assert.equal(before.handlers.length, 1);
        module.handleMapPredictorStatus(readySummary());
        await Promise.resolve();
        assert.equal(before.handlers.length, 1);
        assert.deepEqual(
            delivered.at(-1).status.map(status => status.dwemStatusId || status.text),
            ['hasted', 'convenience-gold', 'map-predictor']
        );

        module.handleMapPredictorStatus({rcEnabled: false});
        await Promise.resolve();
        assert.equal(before.handlers.length, 1);
        assert.deepEqual(
            delivered.at(-1).status.map(status => status.dwemStatusId || status.text),
            ['hasted', 'convenience-gold']
        );

        module.showGoldStatus = false;
        module.schedulePlayerStatusRefresh({syncHooksAfter: true});
        await Promise.resolve();
        assert.deepEqual(delivered.at(-1).status, [nativeStatus]);
        assert.equal(before.handlers.length, 0);
        assert.equal(after.handlers.length, 0);
    } finally {
        module.destroyed = true;
        module.removeStatusHooks();
        globalThis.DWEM = previousDWEM;
    }
});
