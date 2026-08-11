import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CacheConflictError,
    IndexedDBCache,
    artifactKey
} from '../indexeddb-cache.js';

class FakeRequest {
    constructor() {
        this.result = undefined;
        this.error = null;
        this.onsuccess = null;
        this.onerror = null;
        this.onupgradeneeded = null;
        this.onblocked = null;
    }
}

class FakeObjectStore {
    constructor(values) {
        this.values = values;
    }

    get(key) {
        const request = new FakeRequest();
        queueMicrotask(() => {
            request.result = this.values.get(key);
            request.onsuccess?.();
        });
        return request;
    }

    add(value, key) {
        const request = new FakeRequest();
        queueMicrotask(() => {
            if (this.values.has(key)) {
                request.error = Object.assign(new Error('duplicate key'), {
                    name: 'ConstraintError'
                });
                request.onerror?.();
                return;
            }
            this.values.set(key, value);
            request.result = key;
            request.onsuccess?.();
        });
        return request;
    }
}

class FakeDatabase {
    constructor(values) {
        this.values = values;
        this.hasStore = false;
        this.objectStoreNames = {
            contains: () => this.hasStore
        };
    }

    createObjectStore() {
        this.hasStore = true;
        return new FakeObjectStore(this.values);
    }

    transaction() {
        if (!this.hasStore) {
            throw new Error('missing object store');
        }
        return {
            objectStore: () => new FakeObjectStore(this.values)
        };
    }

    close() {
    }
}

function fakeIndexedDB() {
    const values = new Map();
    const database = new FakeDatabase(values);
    let opened = false;
    return {
        open() {
            const request = new FakeRequest();
            queueMicrotask(() => {
                request.result = database;
                if (!opened) {
                    opened = true;
                    request.onupgradeneeded?.();
                }
                queueMicrotask(() => request.onsuccess?.());
            });
            return request;
        }
    };
}

function abortableWriteIndexedDB() {
    const values = new Map();
    let activeWrite = null;
    let signalWriteStarted;
    const writeStarted = new Promise(resolve => {
        signalWriteStarted = resolve;
    });
    const database = {
        hasStore: false,
        objectStoreNames: {
            contains() {
                return database.hasStore;
            }
        },
        createObjectStore() {
            database.hasStore = true;
        },
        transaction(storeName, mode) {
            assert.equal(storeName, 'artifacts');
            if (!database.hasStore) {
                throw new Error('missing object store');
            }
            if (mode === 'readonly') {
                return {
                    objectStore() {
                        return new FakeObjectStore(values);
                    }
                };
            }
            const transaction = {
                error: null,
                oncomplete: null,
                onerror: null,
                onabort: null,
                aborted: false,
                abortCalls: 0,
                objectStore() {
                    return {
                        add(value, key) {
                            const request = new FakeRequest();
                            activeWrite = {transaction, request, value, key};
                            queueMicrotask(() => {
                                request.result = key;
                                request.onsuccess?.();
                                signalWriteStarted();
                            });
                            return request;
                        }
                    };
                },
                abort() {
                    this.abortCalls++;
                    this.aborted = true;
                    this.onabort?.();
                }
            };
            return transaction;
        },
        close() {
        }
    };
    let opened = false;
    return {
        values,
        writeStarted,
        get activeWrite() {
            return activeWrite;
        },
        commit() {
            if (!activeWrite || activeWrite.transaction.aborted) {
                return false;
            }
            values.set(activeWrite.key, activeWrite.value);
            activeWrite.transaction.oncomplete?.();
            return true;
        },
        open() {
            const request = new FakeRequest();
            queueMicrotask(() => {
                request.result = database;
                if (!opened) {
                    opened = true;
                    request.onupgradeneeded?.();
                }
                queueMicrotask(() => request.onsuccess?.());
            });
            return request;
        }
    };
}

test('memory fallback namespaces manifest, source, and parsed artifacts', async () => {
    const cache = new IndexedDBCache({indexedDB: null});

    await cache.setManifest('abcdef0', 'parser-1', {paths: ['one.des']});
    await cache.setSource('abcdef0', 'parser-1', 'one.des', 'NAME: one');
    await cache.setParsed('abcdef0', 'parser-1', 'one.des', [{name: 'one'}]);

    assert.deepEqual(
        await cache.getManifest('abcdef0', 'parser-1'),
        {paths: ['one.des']}
    );
    assert.equal(
        await cache.getSource('abcdef0', 'parser-1', 'one.des'),
        'NAME: one'
    );
    assert.deepEqual(
        await cache.getParsed('abcdef0', 'parser-1', 'one.des'),
        [{name: 'one'}]
    );
    assert.equal(await cache.getSource('abcdef0', 'parser-2', 'one.des'), undefined);
    assert.notEqual(
        artifactKey('source', 'abcdef0', 'parser-1', 'one.des'),
        artifactKey('parsed', 'abcdef0', 'parser-1', 'one.des')
    );
});

test('artifacts are immutable and returned values cannot mutate the cache', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    const manifest = {paths: ['one.des']};
    await cache.setManifest('revision', 'parser', manifest);

    manifest.paths.push('outside.des');
    const cached = await cache.getManifest('revision', 'parser');
    cached.paths.push('local-mutation.des');

    assert.deepEqual(
        await cache.getManifest('revision', 'parser'),
        {paths: ['one.des']}
    );
    await assert.rejects(
        cache.setManifest('revision', 'parser', {paths: ['different.des']}),
        CacheConflictError
    );
    await cache.setManifest('revision', 'parser', {paths: ['one.des']});
});

test('an injected IndexedDB persists artifacts between cache instances', async () => {
    const indexedDB = fakeIndexedDB();
    const first = new IndexedDBCache({
        indexedDB,
        databaseName: 'test-database'
    });
    await first.setSource('revision', 'parser', 'map.des', 'NAME: persisted');
    await first.setArtifact(
        'resolved-build',
        '1b83f8deab',
        'source-build-v1',
        'commit',
        {shortSha: '1b83f8deab', fullSha: '1b83f8deab1234567890abcdef1234567890abcd'}
    );
    await first.close();

    const second = new IndexedDBCache({
        indexedDB,
        databaseName: 'test-database'
    });
    assert.equal(
        await second.getSource('revision', 'parser', 'map.des'),
        'NAME: persisted'
    );
    assert.deepEqual(
        await second.getArtifact(
            'resolved-build',
            '1b83f8deab',
            'source-build-v1',
            'commit'
        ),
        {
            shortSha: '1b83f8deab',
            fullSha: '1b83f8deab1234567890abcdef1234567890abcd'
        }
    );
    await second.close();
});

test('abort cancels a pending IndexedDB write before transaction commit', async () => {
    const indexedDB = abortableWriteIndexedDB();
    const cache = new IndexedDBCache({
        indexedDB,
        databaseName: 'abort-database'
    });
    const controller = new AbortController();
    const reason = new Error('runtime disabled during cache write');

    const write = cache.setSource(
        'revision',
        'parser',
        'map.des',
        'NAME: should_not_commit',
        {signal: controller.signal}
    );
    await indexedDB.writeStarted;
    controller.abort(reason);

    await assert.rejects(write, error => error === reason);
    assert.equal(indexedDB.activeWrite.transaction.abortCalls, 1);
    assert.equal(indexedDB.commit(), false);
    assert.equal(indexedDB.values.size, 0);
    assert.equal(cache.memory.size, 0);
});

test('pre-aborted memory cache operations never read or write artifacts', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    const controller = new AbortController();
    const reason = new Error('already disabled');
    controller.abort(reason);

    await assert.rejects(
        cache.setParsed('revision', 'parser', 'map.des', [], {
            signal: controller.signal
        }),
        error => error === reason
    );
    await assert.rejects(
        cache.getParsed('revision', 'parser', 'map.des', {
            signal: controller.signal
        }),
        error => error === reason
    );
    assert.equal(cache.memory.size, 0);
});

test('close synchronously releases in-memory source and parsed artifacts', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    await cache.setSource('revision', 'parser', 'map.des', 'NAME: cached');
    await cache.setParsed('revision', 'parser', 'map.des', [{name: 'cached'}]);
    assert.equal(cache.memory.size, 2);

    const closing = cache.close();
    assert.equal(cache.memory.size, 0);
    await closing;
});
