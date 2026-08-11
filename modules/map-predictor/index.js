const MODULE_NAME = 'MapPredictor';
const RC_HANDLER_ID = 'map-predictor-rc';
export const MAP_PREDICTOR_READY_EVENT = 'dwem:map-predictor-ready';

function emptyState(module) {
    return {
        rcEnabled: module.rcEnabled,
        runtimeEnabled: false,
        status: module.status,
        versionText: null,
        revision: null,
        fullSha: null,
        player: {place: null, depth: null, pos: null},
        levelKey: null,
        gameSession: 0,
        autoRevealApplied: false,
        levelSignals: {},
        sourcePaths: [],
        templates: [],
        observationCount: 0,
        predictionCount: 0,
        predictionMode: 'none',
        safePredictionCount: 0,
        provisionalPredictionCount: 0,
        forcePredictionCount: 0,
        plausibleCandidateCount: 0,
        revealEnabled: false,
        forceRevealActive: false,
        resultReason: null,
        match: null,
        workerActive: false,
        workerStatus: 'disabled',
        worker: {
            active: false,
            status: 'disabled',
            mode: null,
            failure: null
        },
        error: module.error ? {...module.error} : null
    };
}

/**
 * Small RC-gated facade. The parser, catalogs, matcher, adapter, cache, and
 * worker modules are dynamically imported only after `map_predictor = true`.
 */
export default class MapPredictor {
    static name = MODULE_NAME;
    static version = '0.2';
    static dependencies = ['IOHook', 'CommandManager', 'RCManager'];
    static description = '(Alpha) Predicts fixed maps with client-only inferred terrain.';

    constructor(options = {}) {
        this.dwem = options.dwem || globalThis.DWEM;
        this.runtimeOptions = {...options};
        this.rcEnabled = false;
        this.runtimeEnabled = false;
        this.status = 'idle';
        this.error = null;
        this.runtime = null;
        this.runtimeUnsubscribe = null;
        this.statusSubscribers = new Set();
        this.loadGeneration = 0;
        this.destroyed = false;
        this.rcHandlerInstalled = false;
    }

    get repository() {
        return this.runtime?.repository || null;
    }

    get matcher() {
        return this.runtime?.matcher || null;
    }

    get webtilesAdapter() {
        return this.runtime?.webtilesAdapter || null;
    }

    get templates() {
        return this.runtime?.templates || [];
    }

    onLoad() {
        const rcManager = this.dwem?.Modules?.RCManager;
        if (!rcManager?.addHandlers) {
            throw new Error('MapPredictor requires RCManager.');
        }
        rcManager.addHandlers(RC_HANDLER_ID, {
            onGameInitialize: rcfile => {
                const enabled = rcManager.getRCOption(
                    rcfile,
                    'map_predictor',
                    'boolean',
                    false
                ) === true;
                return this.applyRcEnabled(enabled);
            },
            onGameEnd: () => this.endGame()
        });
        this.rcHandlerInstalled = true;
        this.status = 'disabled-by-rc';
        this.emitStatus();
        this.announceReady();
    }

    announceReady() {
        const eventTarget = this.runtimeOptions.document || globalThis.document;
        const CustomEventClass = this.runtimeOptions.window?.CustomEvent
            || globalThis.CustomEvent;
        if (typeof eventTarget?.dispatchEvent !== 'function'
            || typeof CustomEventClass !== 'function') {
            return false;
        }
        eventTarget.dispatchEvent(new CustomEventClass(
            MAP_PREDICTOR_READY_EVENT,
            {detail: {module: this}}
        ));
        return true;
    }

    async applyRcEnabled(enabled) {
        const nextEnabled = Boolean(enabled);
        this.rcEnabled = nextEnabled;
        if (!nextEnabled) {
            this.loadGeneration++;
            this.releaseRuntime({destroy: true});
            this.status = 'disabled-by-rc';
            this.error = null;
            this.emitStatus();
            return false;
        }
        if (this.destroyed) {
            return false;
        }
        if (this.runtime) {
            this.runtime.applyRcEnabled(true);
            return true;
        }

        const generation = ++this.loadGeneration;
        this.status = 'loading-runtime';
        this.error = null;
        this.emitStatus();
        try {
            const {default: MapPredictorRuntime} = await import('./runtime.js');
            if (generation !== this.loadGeneration || !this.rcEnabled
                || this.destroyed) {
                return false;
            }
            const runtime = new MapPredictorRuntime({
                ...this.runtimeOptions,
                dwem: this.dwem
            });
            this.runtime = runtime;
            this.runtimeUnsubscribe = runtime.subscribeStatus(state => {
                if (this.runtime !== runtime) {
                    return;
                }
                this.runtimeEnabled = state.runtimeEnabled;
                this.status = state.status;
                this.error = state.error;
                this.emitStatus();
            });
            runtime.applyRcEnabled(true);
            return true;
        } catch (error) {
            if (generation !== this.loadGeneration || !this.rcEnabled) {
                return false;
            }
            this.runtimeEnabled = false;
            this.status = 'runtime-load-error';
            this.error = {
                code: error?.code || error?.name || 'error',
                message: error?.message || String(error)
            };
            console.error('[MapPredictor]', error);
            this.emitStatus();
            return false;
        }
    }

    releaseRuntime({destroy = false} = {}) {
        const runtime = this.runtime;
        this.runtimeUnsubscribe?.();
        this.runtimeUnsubscribe = null;
        this.runtime = null;
        this.runtimeEnabled = false;
        if (runtime) {
            if (destroy) {
                runtime.destroy();
            } else {
                runtime.endGame();
            }
        }
    }

    endGame() {
        this.loadGeneration++;
        this.releaseRuntime({destroy: false});
        this.rcEnabled = false;
        this.status = 'waiting-for-game';
        this.error = null;
        this.emitStatus();
    }

    subscribeStatus(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('MapPredictor status listener must be a function.');
        }
        this.statusSubscribers.add(listener);
        listener(this.getDebugState());
        return () => {
            this.statusSubscribers.delete(listener);
        };
    }

    emitStatus() {
        if (this.statusSubscribers.size === 0) {
            return;
        }
        const state = this.getDebugState();
        for (const listener of this.statusSubscribers) {
            try {
                listener(structuredClone(state));
            } catch (error) {
                console.error('[MapPredictor] status listener failed', error);
            }
        }
    }

    getDebugState() {
        if (!this.runtime) {
            return emptyState(this);
        }
        return {
            ...this.runtime.getDebugState(),
            rcEnabled: this.rcEnabled,
            runtimeEnabled: this.runtimeEnabled
        };
    }

    destroy() {
        this.loadGeneration++;
        this.releaseRuntime({destroy: true});
        this.destroyed = true;
        this.rcEnabled = false;
        this.status = 'destroyed';
        this.dwem?.Modules?.RCManager?.removeHandlers?.(RC_HANDLER_ID);
        this.rcHandlerInstalled = false;
        this.emitStatus();
        this.statusSubscribers.clear();
    }
}
