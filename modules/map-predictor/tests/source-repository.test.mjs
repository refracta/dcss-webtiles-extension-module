import assert from 'node:assert/strict';
import test from 'node:test';

import IndexedDBCache from '../indexeddb-cache.js';
import SourceRepository, {
    SourceRepositoryError,
    parseCrawlVersion
} from '../source-repository.js';

const FULL_SHA = '1b83f8deab1234567890abcdef1234567890abcd';
const DES_PATH = 'crawl-ref/source/dat/des/branches/temple.des';
const AUXILIARY_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const ZIGGURAT_AUXILIARY_PATH =
    'crawl-ref/source/dat/dlua/ziggurat.lua';

function jsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return data;
        },
        async text() {
            return JSON.stringify(data);
        }
    };
}

function textResponse(value, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return JSON.parse(value);
        },
        async text() {
            return value;
        }
    };
}

test('parseCrawlVersion accepts official git descriptions and exact stable tags', () => {
    assert.deepEqual(parseCrawlVersion('0.35-a0-840-g1b83f8deab'), {
        kind: 'commit',
        version: '0.35-a0-840-g1b83f8deab',
        shortSha: '1b83f8deab'
    });
    assert.deepEqual(
        parseCrawlVersion('Dungeon Crawl Stone Soup 0.35-a0-355-g7480fdf97e'),
        {
            kind: 'commit',
            version: '0.35-a0-355-g7480fdf97e',
            shortSha: '7480fdf97e'
        }
    );
    assert.deepEqual(
        parseCrawlVersion('Dungeon Crawl Stone Soup version 0.34.1\n'),
        {kind: 'tag', version: '0.34.1', tag: '0.34.1'}
    );
});

test('parseCrawlVersion fails closed for forks, dirty builds, and loose text', () => {
    for (const version of [
        'Bloatcrawl 2 0.35-a0-840-g1b83f8deab',
        'Dungeon Crawl Stone Soup 0.35-bcrawl-840-g1b83f8deab',
        '0.35-a0-840-g1b83f8deab-dirty',
        'current: 0.34.1',
        'master',
        ''
    ]) {
        assert.throws(() => parseCrawlVersion(version), SourceRepositoryError);
    }
});

test('the default browser fetch keeps its required global receiver', async () => {
    const originalFetch = globalThis.fetch;
    let receiver = null;
    globalThis.fetch = function () {
        receiver = this;
        return Promise.resolve(jsonResponse({sha: FULL_SHA}));
    };
    try {
        const repository = new SourceRepository({
            cache: new IndexedDBCache({indexedDB: null})
        });
        await repository.prepare('0.35-a0-840-g1b83f8deab');
        assert.equal(receiver, globalThis);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('request timeout defaults to thirty seconds and rejects unsafe values', () => {
    const repository = new SourceRepository({
        fetch: async () => jsonResponse({}),
        cache: new IndexedDBCache({indexedDB: null})
    });
    assert.equal(repository.requestTimeoutMs, 30000);

    for (const requestTimeoutMs of [0, -1, Number.POSITIVE_INFINITY, NaN, '10']) {
        assert.throws(
            () => new SourceRepository({requestTimeoutMs}),
            /requestTimeoutMs must be a positive finite number/
        );
    }
});

test('requests time out fail closed and abort the underlying fetch', async () => {
    let fetchSignal = null;
    const repository = new SourceRepository({
        requestTimeoutMs: 10,
        cache: new IndexedDBCache({indexedDB: null}),
        fetch: async (url, options) => {
            fetchSignal = options.signal;
            return new Promise(() => {});
        }
    });

    await assert.rejects(
        repository.prepare('0.35-a0-840-g1b83f8deab'),
        error => error instanceof SourceRepositoryError
            && error.code === 'request-timeout'
            && error.timeoutMs === 10
    );
    assert.equal(fetchSignal.aborted, true);
    assert.equal(fetchSignal.reason.code, 'request-timeout');
});

test('caller abort signals propagate and retain their reason', async () => {
    const caller = new AbortController();
    const abortReason = new Error('caller stopped the request');
    let fetchSignal = null;
    const repository = new SourceRepository({
        requestTimeoutMs: 1000,
        cache: new IndexedDBCache({indexedDB: null}),
        fetch: async (url, options) => {
            fetchSignal = options.signal;
            return new Promise(() => {});
        }
    });

    const request = repository._request('https://example.invalid/request', {
        headers: {Accept: 'application/json'},
        signal: caller.signal
    });
    caller.abort(abortReason);

    await assert.rejects(
        request,
        error => error.code === 'network-error' && error.cause === abortReason
    );
    assert.equal(fetchSignal.aborted, true);
    assert.equal(fetchSignal.reason, abortReason);
});

test('caller abort remains linked while the response body is pending', async () => {
    const caller = new AbortController();
    const abortReason = new Error('runtime paused during body read');
    let fetchSignal = null;
    let bodyStarted;
    const bodyReady = new Promise(resolve => {
        bodyStarted = resolve;
    });
    const repository = new SourceRepository({
        requestTimeoutMs: 1000,
        cache: new IndexedDBCache({indexedDB: null}),
        fetch: async (url, options) => {
            fetchSignal = options.signal;
            return {
                ok: true,
                status: 200,
                text() {
                    bodyStarted();
                    return new Promise(() => {});
                }
            };
        }
    });

    const request = repository._requestText(
        'https://example.invalid/pending-body',
        {signal: caller.signal}
    );
    await bodyReady;
    caller.abort(abortReason);

    await assert.rejects(
        request,
        error => error.code === 'network-error' && error.cause === abortReason
    );
    assert.equal(fetchSignal.aborted, true);
    assert.equal(fetchSignal.reason, abortReason);
});

test('aborting a pending source body prevents parse and cache writes', async () => {
    const caller = new AbortController();
    const abortReason = new Error('MapPredictor runtime disabled');
    let fetchSignal = null;
    let bodyStarted;
    const bodyReady = new Promise(resolve => {
        bodyStarted = resolve;
    });
    let parseCalls = 0;
    let sourceWrites = 0;
    let parsedWrites = 0;
    const build = {
        revision: FULL_SHA,
        fullSha: FULL_SHA,
        versionText: '0.35-a0-840-g1b83f8deab'
    };
    const manifest = {
        revision: FULL_SHA,
        fullSha: FULL_SHA,
        parserVersion: 'abort-v1',
        paths: [DES_PATH],
        auxiliaryPaths: [AUXILIARY_PATH, ZIGGURAT_AUXILIARY_PATH]
    };
    const repository = new SourceRepository({
        requestTimeoutMs: 1000,
        parserVersion: 'abort-v1',
        cache: {
            async getManifest() {
                return manifest;
            },
            async getSource() {
                return undefined;
            },
            async getParsed() {
                return undefined;
            },
            async setSource() {
                sourceWrites++;
            },
            async setParsed() {
                parsedWrites++;
            }
        },
        fetch: async (url, options) => {
            fetchSignal = options.signal;
            return {
                ok: true,
                status: 200,
                text() {
                    bodyStarted();
                    return new Promise(() => {});
                }
            };
        }
    });

    const request = repository.getParsed(
        build,
        DES_PATH,
        () => {
            parseCalls++;
            return [];
        },
        {signal: caller.signal}
    );
    await bodyReady;
    caller.abort(abortReason);

    await assert.rejects(request, error => {
        return error.code === 'network-error' && error.cause === abortReason;
    });
    assert.equal(fetchSignal.aborted, true);
    assert.equal(parseCalls, 0);
    assert.equal(sourceWrites, 0);
    assert.equal(parsedWrites, 0);
});

test('successful requests clean up timeout and caller abort forwarding', async () => {
    const caller = new AbortController();
    let fetchOptions = null;
    const repository = new SourceRepository({
        requestTimeoutMs: 10,
        cache: new IndexedDBCache({indexedDB: null}),
        fetch: async (url, options) => {
            fetchOptions = options;
            return jsonResponse({sha: FULL_SHA});
        }
    });

    await repository._request('https://example.invalid/request', {
        headers: {Accept: 'application/json'},
        signal: caller.signal
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    caller.abort(new Error('late abort'));

    assert.deepEqual(fetchOptions.headers, {Accept: 'application/json'});
    assert.equal(fetchOptions.signal.aborted, false);
});

test('prepare resolves a short SHA and getManifest performs one recursive tree listing', async () => {
    const calls = [];
    const fetch = async url => {
        calls.push(url);
        if (url.includes('/commits/1b83f8deab')) {
            return jsonResponse({sha: FULL_SHA});
        }
        if (url.includes(`/git/trees/${FULL_SHA}?recursive=1`)) {
            return jsonResponse({
                truncated: false,
                tree: [
                    {type: 'blob', path: DES_PATH},
                    {type: 'blob', path: AUXILIARY_PATH},
                    {type: 'blob', path: ZIGGURAT_AUXILIARY_PATH},
                    {type: 'blob', path: 'crawl-ref/source/dat/des/portals/sewer.des'},
                    {type: 'blob', path: 'crawl-ref/source/dat/des/branches/readme.txt'},
                    {type: 'tree', path: 'crawl-ref/source/dat/des/branches/fake.des'},
                    {type: 'blob', path: 'docs/example.des'}
                ]
            });
        }
        throw new Error(`unexpected request ${url}`);
    };
    const repository = new SourceRepository({
        fetch,
        cache: new IndexedDBCache({indexedDB: null}),
        parserVersion: 'test-parser'
    });

    const build = await repository.prepare('0.35-a0-840-g1b83f8deab');
    assert.deepEqual(build, {
        revision: FULL_SHA,
        fullSha: FULL_SHA,
        versionText: '0.35-a0-840-g1b83f8deab'
    });
    const manifest = await repository.getManifest(build);
    assert.deepEqual(manifest.paths, [
        DES_PATH,
        'crawl-ref/source/dat/des/portals/sewer.des'
    ]);
    assert.deepEqual(manifest.auxiliaryPaths, [
        AUXILIARY_PATH,
        ZIGGURAT_AUXILIARY_PATH
    ]);
    await repository.getManifest(build);

    assert.equal(calls.filter(url => url.includes('/commits/')).length, 1);
    assert.equal(calls.filter(url => url.includes('/git/trees/')).length, 1);
});

test('commit resolution is reused across repository instances without another API call', async () => {
    const memory = new Map();
    let resolveCalls = 0;
    const first = new SourceRepository({
        cache: new IndexedDBCache({indexedDB: null, memory}),
        fetch: async url => {
            assert.match(url, /\/commits\/1b83f8deab$/u);
            resolveCalls++;
            return jsonResponse({sha: FULL_SHA});
        }
    });
    const firstBuild = await first.prepare('0.35-a0-840-g1b83f8deab');

    const second = new SourceRepository({
        cache: new IndexedDBCache({indexedDB: null, memory}),
        fetch: async () => {
            throw new Error('cached commit resolution must avoid the network');
        }
    });
    const secondBuild = await second.prepare('0.35-a0-840-g1b83f8deab');

    assert.deepEqual(secondBuild, firstBuild);
    assert.equal(resolveCalls, 1);
});

test('malformed cached commit resolution fails closed before fetching', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    await cache.setArtifact(
        'resolved-build',
        '1b83f8deab',
        'source-build-v1',
        'commit',
        {shortSha: '1b83f8deab', fullSha: `2${FULL_SHA.slice(1)}`}
    );
    let fetchCalls = 0;
    const repository = new SourceRepository({
        cache,
        fetch: async () => {
            fetchCalls++;
            return jsonResponse({sha: FULL_SHA});
        }
    });

    await assert.rejects(
        repository.prepare('0.35-a0-840-g1b83f8deab'),
        error => error instanceof SourceRepositoryError
            && error.code === 'invalid-cache'
    );
    assert.equal(fetchCalls, 0);
});

test('source and parsed artifacts use the full SHA and immutable cache keys', async () => {
    const calls = [];
    let parserCalls = 0;
    const fetch = async url => {
        calls.push(url);
        if (url.includes('/commits/1b83f8deab')) {
            return jsonResponse({sha: FULL_SHA});
        }
        if (url.includes('/git/trees/')) {
            return jsonResponse({
                truncated: false,
                tree: [
                    {type: 'blob', path: DES_PATH},
                    {type: 'blob', path: AUXILIARY_PATH},
                    {type: 'blob', path: ZIGGURAT_AUXILIARY_PATH}
                ]
            });
        }
        if (url.includes('cdn.jsdelivr.net')) {
            return textResponse('NAME: sample\nMAP\n.\nENDMAP\n');
        }
        throw new Error(`unexpected request ${url}`);
    };
    const repository = new SourceRepository({
        fetch,
        cache: new IndexedDBCache({indexedDB: null}),
        parserVersion: 'parser-v2'
    });
    const build = await repository.prepare('0.35-a0-840-g1b83f8deab');

    const first = await repository.getParsed(build, DES_PATH, source => {
        parserCalls += 1;
        return {length: source.length};
    });
    const second = await repository.getParsed(build, DES_PATH, () => {
        parserCalls += 1;
        return {length: 0};
    });

    assert.deepEqual(second, first);
    assert.equal(parserCalls, 1);
    const cdnCalls = calls.filter(url => url.includes('cdn.jsdelivr.net'));
    assert.equal(cdnCalls.length, 1);
    assert.match(cdnCalls[0], new RegExp(`@${FULL_SHA}/${DES_PATH}$`));
});

test('allowlisted auxiliary sources use the exact full SHA and source cache', async () => {
    const calls = [];
    const cache = new IndexedDBCache({indexedDB: null});
    const vaultSource = 'function pan_lord_setup(e)\n  return e\nend\n';
    const fetch = async url => {
        calls.push(url);
        if (url.includes('/commits/1b83f8deab')) {
            return jsonResponse({sha: FULL_SHA});
        }
        if (url.includes('/git/trees/')) {
            return jsonResponse({
                truncated: false,
                tree: [
                    {type: 'blob', path: DES_PATH},
                    {type: 'blob', path: AUXILIARY_PATH},
                    {type: 'blob', path: ZIGGURAT_AUXILIARY_PATH}
                ]
            });
        }
        if (url.includes('cdn.jsdelivr.net')) {
            return textResponse(vaultSource);
        }
        throw new Error(`unexpected request ${url}`);
    };
    const repository = new SourceRepository({
        fetch,
        cache,
        parserVersion: 'auxiliary-v1'
    });
    const build = await repository.prepare('0.35-a0-840-g1b83f8deab');

    assert.equal(
        await repository.getAuxiliarySource(build, AUXILIARY_PATH),
        vaultSource
    );
    assert.equal(
        await repository.getAuxiliarySource(build, AUXILIARY_PATH),
        vaultSource
    );
    assert.equal(
        await cache.getSource(build.revision, 'auxiliary-v1', AUXILIARY_PATH),
        vaultSource
    );

    const cdnCalls = calls.filter(url => url.includes('cdn.jsdelivr.net'));
    assert.equal(cdnCalls.length, 1);
    assert.match(
        cdnCalls[0],
        new RegExp(`@${FULL_SHA}/${AUXILIARY_PATH.replaceAll('.', '\\.')}$`)
    );
});

test('auxiliary source access rejects arbitrary Lua and traversal before fetching', async () => {
    let fetchCalls = 0;
    const repository = new SourceRepository({
        fetch: async () => {
            fetchCalls++;
            return jsonResponse({});
        },
        cache: new IndexedDBCache({indexedDB: null})
    });
    const build = {
        revision: FULL_SHA,
        fullSha: FULL_SHA,
        versionText: '0.35-a0-840-g1b83f8deab'
    };

    for (const path of [
        'crawl-ref/source/dat/dlua/init.lua',
        'crawl-ref/source/dat/dlua/../dlua/vault.lua',
        `${AUXILIARY_PATH}/../vault.lua`,
        `/${AUXILIARY_PATH}`,
        `${AUXILIARY_PATH}?raw=1`
    ]) {
        await assert.rejects(
            repository.getAuxiliarySource(build, path),
            error => error instanceof SourceRepositoryError
                && error.code === 'unknown-path'
        );
    }
    assert.equal(fetchCalls, 0);
});

test('a recursive tree missing the required auxiliary source fails closed', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    const repository = new SourceRepository({
        cache,
        parserVersion: 'missing-auxiliary-v1',
        fetch: async url => url.includes('/commits/')
            ? jsonResponse({sha: FULL_SHA})
            : jsonResponse({
                truncated: false,
                tree: [
                    {type: 'blob', path: DES_PATH},
                    {type: 'tree', path: AUXILIARY_PATH}
                ]
            })
    });
    const build = await repository.prepare('0.35-a0-840-g1b83f8deab');

    await assert.rejects(
        repository.getAuxiliarySource(build, AUXILIARY_PATH),
        error => error instanceof SourceRepositoryError
            && error.code === 'missing-auxiliary-source'
            && error.paths?.[0] === AUXILIARY_PATH
    );
    assert.equal(
        await cache.getManifest(build.revision, 'missing-auxiliary-v1'),
        undefined
    );
});

test('cached manifests cannot add or omit auxiliary allowlist entries', async () => {
    for (const auxiliaryPaths of [
        [],
        ['crawl-ref/source/dat/dlua/init.lua'],
        [AUXILIARY_PATH, AUXILIARY_PATH]
    ]) {
        const cache = new IndexedDBCache({indexedDB: null});
        const repository = new SourceRepository({
            cache,
            parserVersion: 'cached-auxiliary-v1',
            fetch: async () => {
                throw new Error('cached manifest must be rejected before fetching');
            }
        });
        const build = {
            revision: FULL_SHA,
            fullSha: FULL_SHA,
            versionText: '0.35-a0-840-g1b83f8deab'
        };
        await cache.setManifest(build.revision, repository.parserVersion, {
            revision: build.revision,
            fullSha: build.fullSha,
            parserVersion: repository.parserVersion,
            paths: [DES_PATH],
            auxiliaryPaths
        });

        await assert.rejects(
            repository.getManifest(build),
            error => error instanceof SourceRepositoryError
                && error.code === 'invalid-manifest'
        );
    }
});

test('stable tags are verified and their exact commit is used on jsDelivr', async () => {
    const calls = [];
    const fetch = async url => {
        calls.push(url);
        if (url.includes('/commits/0.34.1')) {
            return jsonResponse({sha: FULL_SHA});
        }
        if (url.includes('/git/trees/')) {
            return jsonResponse({
                truncated: false,
                tree: [
                    {type: 'blob', path: DES_PATH},
                    {type: 'blob', path: AUXILIARY_PATH},
                    {type: 'blob', path: ZIGGURAT_AUXILIARY_PATH}
                ]
            });
        }
        return textResponse('NAME: stable');
    };
    const repository = new SourceRepository({
        fetch,
        cache: new IndexedDBCache({indexedDB: null})
    });
    const build = await repository.prepare('0.34.1');

    assert.equal(build.revision, '0.34.1');
    assert.equal(build.fullSha, FULL_SHA);
    assert.equal(build.tag, '0.34.1');
    await repository.getSource(build, DES_PATH);
    assert.ok(calls.some(url => url.includes(`@${FULL_SHA}/`)));
    assert.equal(calls.some(url => url.includes('@0.34.1/')), false);
});

test('a cached stable manifest with mismatched tag metadata fails closed', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    const repository = new SourceRepository({
        cache,
        parserVersion: 'stable-tag-mismatch-v1',
        fetch: async () => {
            throw new Error('cached manifest must be rejected before fetching');
        }
    });
    const build = {
        revision: '0.34.1',
        fullSha: FULL_SHA,
        tag: '0.34.1',
        versionText: '0.34.1'
    };
    await cache.setManifest(build.revision, repository.parserVersion, {
        revision: build.revision,
        fullSha: build.fullSha,
        tag: '0.34.2',
        parserVersion: repository.parserVersion,
        paths: [DES_PATH],
        auxiliaryPaths: [AUXILIARY_PATH, ZIGGURAT_AUXILIARY_PATH]
    });

    await assert.rejects(
        repository.getAuxiliarySource(build, AUXILIARY_PATH),
        error => error instanceof SourceRepositoryError
            && error.code === 'invalid-manifest'
    );
});

test('a moved stable tag cannot reuse artifacts cached for a different commit', async () => {
    const cache = new IndexedDBCache({indexedDB: null});
    const first = new SourceRepository({
        cache,
        fetch: async url => {
            if (url.includes('/commits/')) {
                return jsonResponse({sha: FULL_SHA});
            }
            if (url.includes('/git/trees/')) {
                return jsonResponse({
                    truncated: false,
                    tree: [
                        {type: 'blob', path: DES_PATH},
                        {type: 'blob', path: AUXILIARY_PATH},
                        {type: 'blob', path: ZIGGURAT_AUXILIARY_PATH}
                    ]
                });
            }
            return textResponse('first immutable vault helper');
        }
    });
    const firstBuild = await first.prepare('0.34.1');
    await first.getAuxiliarySource(firstBuild, AUXILIARY_PATH);

    const movedSha = `2${FULL_SHA.slice(1)}`;
    const secondCalls = [];
    const second = new SourceRepository({
        cache,
        fetch: async url => {
            secondCalls.push(url);
            return jsonResponse({sha: movedSha});
        }
    });
    const secondBuild = await second.prepare('0.34.1');
    await assert.rejects(
        second.getAuxiliarySource(secondBuild, AUXILIARY_PATH),
        error => error.code === 'invalid-manifest'
    );
    assert.equal(secondCalls.length, 1);
    assert.match(secondCalls[0], /\/commits\/0\.34\.1$/u);
});

test('selectPaths lazily selects strict branch and portal source groups', () => {
    const repository = new SourceRepository({
        fetch: async () => jsonResponse({}),
        cache: new IndexedDBCache({indexedDB: null})
    });
    const paths = [
        'crawl-ref/source/dat/des/branches/spider.des',
        'crawl-ref/source/dat/des/branches/spider_jumping.des',
        'crawl-ref/source/dat/des/branches/hilbert_zone.des',
        'crawl-ref/source/dat/des/branches/temple_compat.des',
        'crawl-ref/source/dat/des/branches/abyss.des',
        'crawl-ref/source/dat/des/portals/icecave.des',
        'crawl-ref/source/dat/des/portals/crucible.des',
        'crawl-ref/source/dat/des/portals/gulch.des',
        'crawl-ref/source/dat/des/portals/necropolis.des',
        'crawl-ref/source/dat/des/branches/depths.des',
        'crawl-ref/source/dat/des/portals/ziggurat.des'
    ];

    assert.deepEqual(repository.selectPaths(paths, 'Spider:3'), paths.slice(0, 3));
    assert.deepEqual(repository.selectPaths(paths, {place: 'an Ice Cave'}), [paths[5]]);
    assert.deepEqual(repository.selectPaths(paths, 'The Abyss'), [paths[4]]);
    assert.deepEqual(repository.selectPaths(paths, 'a Crucible'), [paths[6]]);
    assert.deepEqual(repository.selectPaths(paths, 'a Gulch'), [paths[7]]);
    assert.deepEqual(repository.selectPaths(paths, 'a Necropolis'), [paths[8]]);
    assert.deepEqual(repository.selectPaths(paths, 'D:7'), []);
    assert.deepEqual(repository.selectPaths(paths, 'D', 15), [paths[9]]);
    assert.deepEqual(repository.selectPaths(paths, 'Dungeon', 14), []);
    assert.deepEqual(repository.selectPaths(paths, 'Ziggurat', 27), [paths[10]]);
    assert.deepEqual(repository.selectPaths(paths, 'Zig', 1), [paths[10]]);
    assert.deepEqual(repository.selectPaths(paths, 'UnknownFork:1'), []);

    const currentVaultPaths = [
        'crawl-ref/source/dat/des/branches/vaults.des',
        'crawl-ref/source/dat/des/branches/vaults_rooms_empty.des',
        'crawl-ref/source/dat/des/branches/vaults_rooms_hard.des',
        'crawl-ref/source/dat/des/branches/vaults_rooms_standard.des'
    ];
    assert.deepEqual(
        repository.selectPaths(currentVaultPaths, 'Vaults'),
        currentVaultPaths
    );
});

test('truncated trees, unresolved revisions, and HTTP errors fail closed', async () => {
    const truncated = new SourceRepository({
        cache: new IndexedDBCache({indexedDB: null}),
        fetch: async url => url.includes('/commits/')
            ? jsonResponse({sha: FULL_SHA})
            : jsonResponse({truncated: true, tree: [{type: 'blob', path: DES_PATH}]})
    });
    const build = await truncated.prepare('0.35-a0-840-g1b83f8deab');
    await assert.rejects(
        truncated.getManifest(build),
        error => error.code === 'truncated-tree'
    );

    const unresolved = new SourceRepository({
        fetch: async () => jsonResponse({sha: `2${FULL_SHA.slice(1)}`})
    });
    await assert.rejects(
        unresolved.prepare('0.35-a0-840-g1b83f8deab'),
        error => error.code === 'unresolved-revision'
    );

    const httpError = new SourceRepository({
        fetch: async () => jsonResponse({}, 404)
    });
    await assert.rejects(
        httpError.prepare('0.35-a0-840-g1b83f8deab'),
        error => error.code === 'http-error' && error.status === 404
    );

    const corsError = new SourceRepository({
        fetch: async () => {
            throw new TypeError('Failed to fetch');
        }
    });
    await assert.rejects(
        corsError.prepare('0.35-a0-840-g1b83f8deab'),
        error => error.code === 'network-error' && error.cause instanceof TypeError
    );
});
