import assert from 'node:assert/strict';
import test from 'node:test';

import MapPredictor from '../map-predictor/index.js';
import RCManager from './index.js';

const VERSION = 'Dungeon Crawl Stone Soup 0.33-a0-123-gabc';

function hookPoint() {
    const handlers = [];
    return {
        addHandler(identifier, handler) {
            handlers.push({identifier, handler});
        },
        dispatch(...args) {
            let result;
            for (const entry of handlers) {
                const nextResult = entry.handler(...args);
                if (nextResult !== undefined) {
                    result = nextResult;
                }
            }
            return result;
        }
    };
}

function replaceGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
        value
    });
    return () => {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            delete globalThis[name];
        }
    };
}

async function waitUntil(predicate, label) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${label}.`);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

function createHarness(rcfileByURL = new Map()) {
    const receiveBefore = hookPoint();
    const sendBefore = hookPoint();
    const received = [];
    const socketMessages = [];
    const fetchCalls = [];

    const handleMessage = data => {
        received.push(data);
    };
    handleMessage.before = receiveBefore;

    const sendMessage = () => {};
    sendMessage.before = sendBefore;

    const rcManager = new RCManager();
    const dwem = {
        Modules: {
            IOHook: {
                handle_message: handleMessage,
                send_message: sendMessage
            },
            RCManager: rcManager,
            SiteInformation: {current_user: 'ViewerAccount'}
        },
        SourceMapperRegistry: {
            getSourceMapper(_type, source) {
                return source;
            },
            add() {}
        }
    };
    const activations = [];
    const predictor = new MapPredictor({
        dwem,
        document: {}
    });
    predictor.applyRcEnabled = async enabled => {
        predictor.rcEnabled = Boolean(enabled);
        activations.push(Boolean(enabled));
        return predictor.rcEnabled;
    };

    const restoreGlobals = [
        replaceGlobal('DWEM', dwem),
        replaceGlobal('location', {host: 'crawl.nemelex.cards'}),
        replaceGlobal('document', {querySelectorAll: () => []}),
        replaceGlobal('socket', {
            send(message) {
                socketMessages.push(JSON.parse(message));
            }
        }),
        replaceGlobal('fetch', async (url, options) => {
            const request = {
                url,
                options,
                body: JSON.parse(options.body)
            };
            fetchCalls.push(request);
            return {
                async text() {
                    return rcfileByURL.get(request.body.url) ?? '';
                }
            };
        }),
        replaceGlobal('require', (_dependencies, callback) => {
            callback({});
            queueMicrotask(() => rcManager.initResolver?.());
        })
    ];

    rcManager.onLoad();
    predictor.onLoad();

    return {
        rcManager,
        predictor,
        activations,
        fetchCalls,
        socketMessages,
        send(msg, data) {
            return sendBefore.dispatch(msg, data);
        },
        receive(data) {
            return receiveBefore.dispatch(data);
        },
        async settle() {
            await waitUntil(
                () => activations.length > 0 && rcManager.queue === undefined,
                'RC initialization'
            );
        },
        cleanup() {
            predictor.destroy();
            for (const restore of restoreGlobals.reverse()) {
                restore();
            }
        }
    };
}

test('RC ownership follows the watched player and keeps play on its own game', async t => {
    for (const expected of [true, false]) {
        await t.test(`watch target map_predictor = ${expected}`, async () => {
            const target = 'TargetPlayer';
            const targetRCURL = `https://archive.nemelex.cards/rcfiles/crawl-git/${target}.rc`;
            const harness = createHarness(new Map([
                [targetRCURL, `map_predictor = ${expected}`]
            ]));
            try {
                harness.send('watch', {username: target});
                assert.equal(harness.receive({msg: 'game_client'}), true);
                assert.equal(harness.receive({msg: 'version', text: VERSION}), true);
                await harness.settle();

                assert.deepEqual(harness.activations, [expected]);
                assert.equal(harness.fetchCalls.length, 1);
                assert.equal(
                    harness.fetchCalls[0].body.url,
                    targetRCURL,
                    'watch must fetch the target player RC'
                );
                assert.equal(
                    harness.fetchCalls[0].body.url.includes('ViewerAccount'),
                    false,
                    'watch username must not fall back to current_user'
                );
                assert.deepEqual(harness.socketMessages, []);
            } finally {
                harness.cleanup();
            }
        });
    }

    await t.test('play consumes the RC returned for its own game id', async () => {
        const harness = createHarness();
        try {
            harness.send('play', {game_id: 'dcss-git-own-game'});
            assert.equal(harness.receive({msg: 'game_client'}), true);
            assert.deepEqual(harness.socketMessages, [
                {msg: 'get_rc', game_id: 'dcss-git-own-game'}
            ]);

            assert.equal(harness.receive({msg: 'version', text: VERSION}), true);
            assert.equal(harness.fetchCalls.length, 0);
            assert.equal(harness.receive({
                msg: 'rcfile_contents',
                contents: 'map_predictor = true'
            }), true);
            await harness.settle();

            assert.deepEqual(harness.activations, [true]);
            assert.equal(
                harness.fetchCalls.length,
                0,
                'play must not proxy-fetch another account when server RC is available'
            );
        } finally {
            harness.cleanup();
        }
    });
});
