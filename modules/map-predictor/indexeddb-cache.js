const DEFAULT_DATABASE_NAME = 'dwem-map-predictor';
const DEFAULT_STORE_NAME = 'artifacts';
const DEFAULT_DATABASE_VERSION = 1;
const ARTIFACT_KINDS = new Set([
    'manifest',
    'source',
    'parsed',
    'resolved-build'
]);

function requireString(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${name} must be a non-empty string`);
    }
    return value;
}

function cloneValue(value) {
    if (value === undefined || value === null || typeof value !== 'object') {
        return value;
    }
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function abortReason(signal) {
    if (signal?.reason instanceof Error) {
        return signal.reason;
    }
    const error = new Error('Cache operation was aborted');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw abortReason(signal);
    }
}

function stableSerialize(value, seen = new Set()) {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (seen.has(value)) {
        throw new TypeError('Cache artifacts must not contain cycles');
    }

    seen.add(value);
    let serialized;
    if (Array.isArray(value)) {
        serialized = `[${value.map(item => stableSerialize(item, seen)).join(',')}]`;
    } else {
        const entries = Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`);
        serialized = `{${entries.join(',')}}`;
    }
    seen.delete(value);
    return serialized;
}

function artifactsEqual(left, right) {
    if (left === right) {
        return true;
    }
    return stableSerialize(left) === stableSerialize(right);
}

export function artifactKey(kind, revision, parserVersion, name = '') {
    if (!ARTIFACT_KINDS.has(kind)) {
        throw new TypeError(`Unknown artifact kind: ${kind}`);
    }
    requireString(revision, 'revision');
    requireString(parserVersion, 'parserVersion');
    if (typeof name !== 'string') {
        throw new TypeError('artifact name must be a string');
    }
    return JSON.stringify([kind, revision, parserVersion, name]);
}

export class CacheConflictError extends Error {
    constructor(key) {
        super(`Refusing to replace immutable cache artifact ${key}`);
        this.name = 'CacheConflictError';
        this.key = key;
    }
}

export class IndexedDBCache {
    constructor(options = {}) {
        this.indexedDB = options.indexedDB === undefined
            ? globalThis.indexedDB
            : options.indexedDB;
        this.databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
        this.storeName = options.storeName || DEFAULT_STORE_NAME;
        this.databaseVersion = options.databaseVersion || DEFAULT_DATABASE_VERSION;
        this.memory = options.memory || new Map();
        this.openPromise = null;
    }

    async _openDatabase() {
        if (!this.indexedDB || typeof this.indexedDB.open !== 'function') {
            return null;
        }
        if (this.openPromise) {
            return this.openPromise;
        }

        this.openPromise = new Promise(resolve => {
            let request;
            try {
                request = this.indexedDB.open(this.databaseName, this.databaseVersion);
            } catch (error) {
                resolve(null);
                return;
            }

            request.onupgradeneeded = () => {
                const database = request.result;
                const names = database.objectStoreNames;
                if (!names || typeof names.contains !== 'function'
                    || !names.contains(this.storeName)) {
                    database.createObjectStore(this.storeName);
                }
            };
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
            request.onsuccess = () => {
                const database = request.result;
                if (database) {
                    database.onversionchange = () => database.close();
                }
                resolve(database || null);
            };
        });
        return this.openPromise;
    }

    async _databaseRequest(mode, operation, options = {}) {
        const signal = options.signal;
        throwIfAborted(signal);
        const database = await this._openDatabase();
        throwIfAborted(signal);
        if (!database) {
            return {available: false, value: undefined};
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let transaction = null;
            let request;
            let requestValue;
            let callerAbortListener = null;
            const cleanup = () => {
                if (signal && callerAbortListener) {
                    signal.removeEventListener('abort', callerAbortListener);
                    callerAbortListener = null;
                }
            };
            const resolveOnce = value => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(value);
            };
            const rejectOnce = error => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(error);
            };
            try {
                throwIfAborted(signal);
                transaction = database.transaction(this.storeName, mode);
                callerAbortListener = () => {
                    try {
                        transaction?.abort?.();
                    } catch (error) {
                        // The transaction may already be completing. The
                        // caller's abort still wins this operation's promise.
                    }
                    rejectOnce(abortReason(signal));
                };
                if (signal) {
                    if (signal.aborted) {
                        callerAbortListener();
                        return;
                    }
                    signal.addEventListener('abort', callerAbortListener, {once: true});
                }
                request = operation(transaction.objectStore(this.storeName));
            } catch (error) {
                rejectOnce(error);
                return;
            }
            const waitForCommit = mode === 'readwrite'
                && ('oncomplete' in transaction || typeof transaction.abort === 'function');
            request.onsuccess = () => {
                requestValue = request.result;
                if (!waitForCommit) {
                    resolveOnce({available: true, value: requestValue});
                }
            };
            request.onerror = () => rejectOnce(
                request.error || new Error('IndexedDB request failed')
            );
            if (waitForCommit) {
                transaction.oncomplete = () => resolveOnce({
                    available: true,
                    value: requestValue
                });
                transaction.onerror = () => rejectOnce(
                    transaction.error || request?.error
                    || new Error('IndexedDB transaction failed')
                );
                transaction.onabort = () => rejectOnce(
                    signal?.aborted
                        ? abortReason(signal)
                        : (transaction.error || new Error('IndexedDB transaction aborted'))
                );
            }
        });
    }

    async getArtifact(kind, revision, parserVersion, name = '', options = {}) {
        const signal = options.signal;
        throwIfAborted(signal);
        const key = artifactKey(kind, revision, parserVersion, name);
        if (this.memory.has(key)) {
            throwIfAborted(signal);
            return cloneValue(this.memory.get(key));
        }

        try {
            const result = await this._databaseRequest(
                'readonly',
                store => store.get(key),
                {signal}
            );
            throwIfAborted(signal);
            if (result.available && result.value !== undefined) {
                throwIfAborted(signal);
                this.memory.set(key, cloneValue(result.value));
                return cloneValue(result.value);
            }
        } catch (error) {
            throwIfAborted(signal);
            // IndexedDB is an optional persistent layer. Memory remains usable.
        }
        throwIfAborted(signal);
        return undefined;
    }

    async setArtifact(kind, revision, parserVersion, name, value, options = {}) {
        const signal = options.signal;
        throwIfAborted(signal);
        if (value === undefined) {
            throw new TypeError('Cache artifacts must not be undefined');
        }
        const key = artifactKey(kind, revision, parserVersion, name);
        const existing = await this.getArtifact(
            kind,
            revision,
            parserVersion,
            name,
            {signal}
        );
        throwIfAborted(signal);
        if (existing !== undefined) {
            if (!artifactsEqual(existing, value)) {
                throw new CacheConflictError(key);
            }
            return existing;
        }

        const storedValue = cloneValue(value);
        throwIfAborted(signal);
        try {
            await this._databaseRequest(
                'readwrite',
                store => store.add(storedValue, key),
                {signal}
            );
            throwIfAborted(signal);
        } catch (error) {
            throwIfAborted(signal);
            if (error?.name === 'ConstraintError') {
                const concurrent = await this.getArtifact(
                    kind,
                    revision,
                    parserVersion,
                    name,
                    {signal}
                );
                throwIfAborted(signal);
                if (concurrent !== undefined && artifactsEqual(concurrent, value)) {
                    return concurrent;
                }
                throw new CacheConflictError(key);
            }
            // Failed persistence does not make the in-memory cache unusable.
        }
        throwIfAborted(signal);
        this.memory.set(key, storedValue);
        return cloneValue(storedValue);
    }

    getManifest(revision, parserVersion, options = {}) {
        return this.getArtifact(
            'manifest',
            revision,
            parserVersion,
            'manifest',
            options
        );
    }

    setManifest(revision, parserVersion, manifest, options = {}) {
        return this.setArtifact(
            'manifest',
            revision,
            parserVersion,
            'manifest',
            manifest,
            options
        );
    }

    getSource(revision, parserVersion, path, options = {}) {
        return this.getArtifact('source', revision, parserVersion, path, options);
    }

    setSource(revision, parserVersion, path, source, options = {}) {
        return this.setArtifact(
            'source',
            revision,
            parserVersion,
            path,
            source,
            options
        );
    }

    getParsed(revision, parserVersion, path, options = {}) {
        return this.getArtifact('parsed', revision, parserVersion, path, options);
    }

    setParsed(revision, parserVersion, path, parsed, options = {}) {
        return this.setArtifact(
            'parsed',
            revision,
            parserVersion,
            path,
            parsed,
            options
        );
    }

    async close() {
        // Runtime OFF must drop parsed/source artifacts synchronously even if
        // an IndexedDB open request is still completing in the background.
        this.memory.clear();
        if (!this.openPromise) {
            return;
        }
        const database = await this.openPromise;
        database?.close?.();
        this.openPromise = null;
    }
}

export default IndexedDBCache;
