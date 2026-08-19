import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import MapPredictor from '../index.js';
import {MapMatcher} from '../matcher.js';
import WebtilesAdapter from '../webtiles-adapter.js';

function hookPoint() {
    const handlers = [];
    return {
        handlers,
        addHandler(identifier, handler, priority = 0) {
            handlers.push({identifier, handler, priority});
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

function dispatchHook(point, message) {
    for (const entry of point.handlers.slice()
        .sort((left, right) => right.priority - left.priority)) {
        entry.handler(message);
    }
}

function fakeDocument() {
    const listeners = [];
    return {
        listeners,
        addEventListener(type, handler, capture = false) {
            listeners.push({type, handler, capture: Boolean(capture)});
        },
        removeEventListener(type, handler, capture = false) {
            const normalizedCapture = Boolean(capture);
            for (let index = listeners.length - 1; index >= 0; index--) {
                const entry = listeners[index];
                if (entry.type === type && entry.handler === handler
                    && entry.capture === normalizedCapture) {
                    listeners.splice(index, 1);
                }
            }
        },
        dispatch(type, event) {
            const ordered = listeners.filter(entry => entry.type === type)
                .sort((left, right) => Number(right.capture) - Number(left.capture));
            for (const entry of ordered) {
                if (event.immediatePropagationStopped) {
                    break;
                }
                entry.handler(event);
            }
        }
    };
}

function lifecycleHarness(options = {}) {
    const receiveBefore = hookPoint();
    const receiveAfter = hookPoint();
    const sendBefore = hookPoint();
    const commands = [];
    const messages = [];
    const commandManager = {
        addCommand(command, argumentTypes, handler, options = {}) {
            commands.push({command, argumentTypes, handler, ...options});
        },
        removeCommandsByModule(module) {
            let removed = 0;
            for (let index = commands.length - 1; index >= 0; index--) {
                if (commands[index].module === module) {
                    commands.splice(index, 1);
                    removed++;
                }
            }
            return removed;
        },
        sendChatMessage(message) {
            messages.push(message);
        }
    };
    const rcHandlers = new Map();
    const rcManager = {
        session: {game_id: 'dcss-git'},
        addHandlers(identifier, handlers) {
            rcHandlers.set(identifier, handlers);
        },
        removeHandlers(identifier) {
            rcHandlers.delete(identifier);
        },
        getRCOption(rcfile, name, type, fallback) {
            const match = String(rcfile).match(
                new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)`, 'm')
            );
            return match ? match[1] === 'true' : fallback;
        }
    };
    const sourceMapperRegistry = {
        getSourceMapper() {
            return source => source;
        }
    };
    const matcherEntries = Object.fromEntries([
        './enums',
        './map_knowledge',
        './cell_renderer',
        './minimap'
    ].map(identifier => [identifier, {latest: () => false}]));
    const document = fakeDocument();
    const window = {
        location: {hash: ''},
        addEventListener() {},
        removeEventListener() {},
        eval
    };
    const dwem = {
        Modules: {
            IOHook: {
                handle_message: {
                    before: receiveBefore,
                    after: receiveAfter
                },
                send_message: {before: sendBefore}
            },
            CommandManager: commandManager,
            RCManager: rcManager
        },
        SourceMapperRegistry: sourceMapperRegistry,
        MatcherRegistry: {matchers: matcherEntries},
        Injector: {replacers: []}
    };
    const counters = {
        repositories: 0,
        cacheCloses: 0,
        matchers: 0,
        adapters: 0
    };
    const adapters = [];
    const module = new MapPredictor({
        dwem,
        window,
        document,
        useWorker: false,
        repositoryFactory() {
            counters.repositories++;
            if (typeof options.repositoryFactory === 'function') {
                return options.repositoryFactory(counters);
            }
            return {
                cache: {
                    close() {
                        counters.cacheCloses++;
                    }
                }
            };
        },
        matcherFactory(options) {
            counters.matchers++;
            return new MapMatcher(options);
        },
        adapterFactory(owner) {
            counters.adapters++;
            const adapter = new WebtilesAdapter(owner, {
                dwem,
                window,
                document,
                lateSourceMapperInstallation: true
            });
            adapters.push(adapter);
            return adapter;
        }
    });
    return {
        module,
        dwem,
        document,
        rcHandlers,
        commands,
        messages,
        receiveBefore,
        receiveAfter,
        sendBefore,
        counters,
        adapters
    };
}

function ctrlMEvent() {
    return {
        key: 'm',
        code: 'KeyM',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        repeat: false,
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
            this.immediatePropagationStopped = true;
        }
    };
}

test('RC false is lazy and Ctrl-M performs a zero-map-memory runtime cycle', async () => {
    const harness = lifecycleHarness();
    const {
        module,
        dwem,
        document,
        rcHandlers,
        commands,
        receiveBefore,
        receiveAfter,
        sendBefore,
        counters,
        adapters
    } = harness;
    const states = [];
    module.subscribeStatus(state => states.push(state));
    module.onLoad();

    assert.deepEqual(counters, {
        repositories: 0,
        cacheCloses: 0,
        matchers: 0,
        adapters: 0
    });
    assert.equal(module.repository, null);
    assert.equal(module.matcher, null);
    assert.equal(module.webtilesAdapter, null);
    assert.equal(commands.length, 0);
    assert.equal(receiveBefore.handlers.length, 0);
    assert.equal(receiveAfter.handlers.length, 0);
    assert.equal(sendBefore.handlers.length, 0);
    assert.equal(document.listeners.length, 0);
    assert.equal(dwem.Injector.replacers.length, 0);
    assert.equal(states.at(-1).rcEnabled, false);
    assert.equal(states.at(-1).runtimeEnabled, false);

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = false'
    );
    assert.equal(document.listeners.length, 0);
    assert.equal(counters.repositories, 0);

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );
    assert.equal(module.rcEnabled, true);
    assert.equal(module.runtimeEnabled, true);
    assert.equal(counters.repositories, 1);
    assert.equal(counters.matchers, 1);
    assert.equal(counters.adapters, 1);
    assert.equal(commands.length, 5);
    assert.equal(receiveBefore.handlers.length, 1);
    assert.equal(receiveAfter.handlers.length, 1);
    assert.equal(sendBefore.handlers.length, 1);
    assert.equal(document.listeners.length, 1);
    assert.equal(dwem.Injector.replacers.length, 3);

    const knownCell = {x: 0, y: 0, f: 1, mf: 1, t: {bg: 0x20}};
    adapters[0].bindWebtiles({
        mapKnowledge: {
            get() {
                return knownCell;
            },
            bounds() {
                return {left: 0, right: 0, top: 0, bottom: 0};
            }
        },
        renderer: {},
        enums: {MF_UNSEEN: 0, MF_FLOOR: 1},
        dngn: {
            DNGN_UNSEEN: 0,
            FLOOR_MAX: 0x70,
            WALL_MAX: 0x100,
            basetile(tile) {
                return tile & 0xFFFF;
            }
        }
    });
    module.runtime.onPlayer({
        place: 'Dungeon',
        depth: 1,
        pos: {x: 0, y: 0}
    });

    let serverKeydowns = 0;
    document.addEventListener('keydown', () => {
        serverKeydowns++;
    });
    const disable = ctrlMEvent();
    document.dispatch('keydown', disable);
    assert.equal(disable.defaultPrevented, true);
    assert.equal(disable.immediatePropagationStopped, true);
    assert.equal(serverKeydowns, 0);
    assert.equal(module.runtimeEnabled, false);
    assert.equal(module.repository, null);
    assert.equal(module.matcher, null);
    assert.deepEqual(module.templates, []);
    assert.equal(module.getDebugState().observationCount, 0);
    assert.equal(module.getDebugState().predictionCount, 0);
    assert.equal(module.getDebugState().workerActive, false);
    assert.equal(commands.length, 0);
    assert.equal(receiveBefore.handlers.length, 1);
    assert.deepEqual(
        receiveBefore.handlers.map(({identifier, priority}) => ({
            identifier,
            priority
        })),
        [{identifier: 'map-predictor-paused-context', priority: 1}]
    );
    assert.equal(receiveAfter.handlers.length, 0);
    assert.equal(sendBefore.handlers.length, 0);
    assert.equal(dwem.Injector.replacers.length, 0);
    assert.equal(counters.cacheCloses, 1);
    assert.equal(adapters[0].observedCells.size, 0);
    assert.equal(adapters[0].predictions.length, 0);
    // RC true keeps only the capture key and a raw player/version tracker used
    // to resume the clean runtime on the floor currently being played.
    assert.equal(document.listeners.filter(entry => entry.capture).length, 1);

    const enable = ctrlMEvent();
    document.dispatch('keydown', enable);
    assert.equal(enable.defaultPrevented, true);
    assert.equal(serverKeydowns, 0);
    assert.equal(module.runtimeEnabled, true);
    assert.equal(counters.repositories, 2);
    assert.equal(counters.matchers, 2);
    assert.equal(counters.adapters, 1);
    assert.equal(commands.length, 5);
    assert.equal(receiveBefore.handlers.length, 1);
    assert.equal(
        receiveBefore.handlers[0].identifier,
        'map-predictor-webtiles-adapter'
    );
    assert.equal(dwem.Injector.replacers.length, 3);
    assert.equal(module.getDebugState().observationCount, 1);

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = false'
    );
    assert.equal(module.rcEnabled, false);
    assert.equal(module.runtimeEnabled, false);
    assert.equal(document.listeners.filter(entry => entry.capture).length, 0);
    assert.equal(commands.length, 0);
    assert.equal(receiveBefore.handlers.length, 0);
    assert.equal(dwem.Injector.replacers.length, 0);
    assert.equal(module.webtilesAdapter, null);
    assert.equal(states.at(-1).rcEnabled, false);
    assert.equal(states.at(-1).runtimeEnabled, false);
    assert.equal(rcHandlers.has('map-predictor-rc'), true);

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );
    assert.equal(module.runtimeEnabled, true);
    assert.equal(counters.repositories, 3);
});

test('Ctrl-M resumes from the raw current floor instead of the floor where it paused', async () => {
    const harness = lifecycleHarness();
    const {
        module,
        document,
        rcHandlers,
        receiveBefore,
        receiveAfter,
        adapters
    } = harness;
    module.onLoad();
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );

    const currentCell = {
        x: 9,
        y: 11,
        f: 1,
        mf: 1,
        t: {bg: 0x20}
    };
    adapters[0].bindWebtiles({
        mapKnowledge: {
            get(x, y) {
                return x === 9 && y === 11 ? currentCell : undefined;
            },
            bounds() {
                return {left: 9, right: 9, top: 11, bottom: 11};
            },
            player_on_level() {
                return true;
            }
        },
        renderer: {},
        player: {},
        enums: {MF_UNSEEN: 0, MF_FLOOR: 1},
        dngn: {
            DNGN_UNSEEN: 0,
            FLOOR_MAX: 0x70,
            WALL_MAX: 0x100,
            basetile(tile) {
                return tile & 0xFFFF;
            }
        }
    });
    module.runtime.onPlayer({
        place: 'Dungeon',
        depth: 2,
        pos: {x: 1, y: 2},
        turn: 120
    });

    document.dispatch('keydown', ctrlMEvent());
    assert.equal(module.runtimeEnabled, false);
    assert.equal(receiveAfter.handlers.length, 0);
    assert.deepEqual(
        receiveBefore.handlers.map(({identifier, priority}) => ({
            identifier,
            priority
        })),
        [{identifier: 'map-predictor-paused-context', priority: 1}]
    );

    // A real level transition sends player diffs before its full map. While
    // paused, retain only this raw identity/focus context; map cells remain
    // entirely unobserved until Ctrl-M resumes and rehydrates WebTiles.
    dispatchHook(receiveBefore, {
        msg: 'player',
        place: 'Vaults',
        depth: 5,
        name: 'Watcher'
    });
    dispatchHook(receiveBefore, {
        msg: 'player',
        pos: {x: 9, y: 11},
        turn: 456
    });
    const contextBeforeMap = structuredClone(module.runtime.resumeContext);
    dispatchHook(receiveBefore, {
        msg: 'map',
        clear: true,
        cells: [{x: 9, y: 11, f: 999, mf: 999}]
    });
    assert.deepEqual(module.runtime.resumeContext, contextBeforeMap);
    assert.equal(adapters[0].observedCells.size, 0);

    document.dispatch('keydown', ctrlMEvent());
    assert.equal(module.runtimeEnabled, true);
    assert.equal(module.runtime.player.place, 'Vaults');
    assert.equal(module.runtime.player.depth, 5);
    assert.deepEqual(module.runtime.player.pos, {x: 9, y: 11});
    assert.equal(module.runtime.player.turn, 456);
    assert.equal(module.runtime.levelKey, `Vaults${String.fromCharCode(0)}5`);
    assert.equal(module.runtime.matcher.focusPosition.x, 9);
    assert.equal(module.runtime.matcher.focusPosition.y, 11);
    assert.equal(module.runtime.getDebugState().observationCount, 1);
    assert.equal(adapters[0].player.place, 'Vaults');
    assert.equal(adapters[0].player.depth, 5);
    assert.equal(module.runtime.resumeContext, null);
    assert.deepEqual(
        receiveBefore.handlers.map(({identifier}) => identifier),
        ['map-predictor-webtiles-adapter']
    );

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = false'
    );
    assert.equal(receiveBefore.handlers.length, 0);
});

test('the RC facade has no static parser, catalog, matcher, or adapter imports', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.match(source, /import\('\.\/runtime\.js'\)/);
    assert.doesNotMatch(source, /des-parser|safe-catalog|matcher\.js|webtiles-adapter/);
});

test('Ctrl-M and RC false abort pending source work before later phases', async () => {
    const pendingSignals = [];
    let manifestCalls = 0;
    let cacheCloses = 0;
    const harness = lifecycleHarness({
        repositoryFactory() {
            return {
                cache: {
                    close() {
                        cacheCloses++;
                    }
                },
                prepare(versionText, {signal}) {
                    pendingSignals.push(signal);
                    return new Promise((resolve, reject) => {
                        signal.addEventListener('abort', () => {
                            reject(signal.reason);
                        }, {once: true});
                    });
                },
                async getManifest() {
                    manifestCalls++;
                    assert.fail('an aborted prepare must not reach the manifest');
                }
            };
        }
    });
    const {module, document, rcHandlers} = harness;
    module.onLoad();
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );

    module.runtime.onVersion('0.35-a0-840-g1b83f8deab');
    assert.equal(pendingSignals.length, 1);
    const ctrlPause = ctrlMEvent();
    document.dispatch('keydown', ctrlPause);
    assert.equal(pendingSignals[0].aborted, true);
    assert.equal(module.runtimeEnabled, false);
    assert.equal(module.repository, null);

    const ctrlResume = ctrlMEvent();
    document.dispatch('keydown', ctrlResume);
    assert.equal(module.runtimeEnabled, true);
    assert.equal(pendingSignals.length, 2);
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = false'
    );
    assert.equal(pendingSignals[1].aborted, true);
    assert.equal(module.runtime, null);
    assert.equal(module.runtimeEnabled, false);
    assert.equal(manifestCalls, 0);
    assert.equal(cacheCloses, 2);

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manifestCalls, 0);
});

test('game end releases runtime state and a new game starts from a blank session', async () => {
    const harness = lifecycleHarness();
    const {module, rcHandlers} = harness;
    module.onLoad();
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );
    const oldRuntime = module.runtime;
    oldRuntime.gameSession = 7;
    oldRuntime.levelKey = `Dungeon${String.fromCharCode(0)}1`;
    oldRuntime.entryTransitionPending = true;
    oldRuntime.pendingLevelEntry = {place: 'Dungeon', depth: 1};
    oldRuntime.levelSignals = {portal: 'old'};
    oldRuntime.resumeContext = {versionText: 'old-version'};

    rcHandlers.get('map-predictor-rc').onGameEnd();
    const ended = module.getDebugState();
    assert.equal(module.runtime, null);
    assert.equal(ended.rcEnabled, false);
    assert.equal(ended.runtimeEnabled, false);
    assert.equal(Object.hasOwn(ended, 'gameId'), false);
    assert.equal(Object.hasOwn(ended, 'gameMode'), false);
    assert.equal(ended.gameSession, 0);
    assert.equal(ended.levelKey, null);
    assert.deepEqual(ended.levelSignals, {});

    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );
    assert.notEqual(module.runtime, oldRuntime);
    assert.equal(Object.hasOwn(module.runtime, 'gameId'), false);
    assert.equal(Object.hasOwn(module.runtime, 'gameMode'), false);
    assert.equal(module.runtime.levelKey, null);
    assert.deepEqual(module.runtime.levelSignals, {});
    assert.equal(module.runtime.resumeContext, null);
});

test('a new game initialization resets an already-enabled runtime session', async () => {
    const harness = lifecycleHarness();
    const {module, dwem, rcHandlers} = harness;
    module.onLoad();
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );
    const runtime = module.runtime;
    const firstSession = runtime.gameSession;
    runtime.levelKey = `Dungeon${String.fromCharCode(0)}5`;
    runtime.levelSignals = {entry: 'stale'};
    runtime.autoRevealApplied = true;
    // A lobby game id is intentionally irrelevant. Only received player
    // packets may select the Sprint catalog.
    dwem.Modules.RCManager.session.game_id = 'dcss-git-sprint';
    await rcHandlers.get('map-predictor-rc').onGameInitialize(
        'map_predictor = true'
    );

    assert.equal(module.runtime, runtime);
    assert.equal(Object.hasOwn(runtime, 'gameId'), false);
    assert.equal(Object.hasOwn(runtime, 'gameMode'), false);
    assert.equal(runtime.gameSession, firstSession + 1);
    assert.equal(runtime.levelKey, null);
    assert.deepEqual(runtime.levelSignals, {});
    assert.equal(runtime.autoRevealApplied, false);
});
