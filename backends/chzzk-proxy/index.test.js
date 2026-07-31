import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {
    SEARCH_KEYWORDS,
    createCachedLiveSource,
    createServer,
    fetchCombinedLives,
    mergeSearchResults,
    normalizeLiveEntry,
    normalizeStartedAt
} from './index.js';

function entry({
    liveId = 1,
    channelId = 'channel-id',
    channelName = 'Crawler',
    title = '돌죽 방송',
    viewerCount = 7
} = {}) {
    return {
        live: {
            liveId,
            liveTitle: title,
            concurrentUserCount: viewerCount,
            liveImageUrl: 'https://example.test/image_{type}.jpg',
            channelId
        },
        channel: {
            channelId,
            channelName,
            channelImageUrl: 'https://example.test/channel.jpg'
        }
    };
}

test('normalizeLiveEntry keeps only matching live titles', () => {
    assert.equal(normalizeLiveEntry(entry({title: 'unrelated game'})), null);
    assert.equal(normalizeLiveEntry(entry({title: '리듬돌죽 고득점 도전'})), null);
    assert.equal(normalizeLiveEntry(entry({title: '오늘은 리듬   돌죽'})), null);

    const live = normalizeLiveEntry(entry({title: 'Dungeon Crawl: Stone   Soup'}));
    assert.equal(live.title, 'Dungeon Crawl: Stone   Soup');
    assert.equal(live.thumbnailUrl, 'https://example.test/image_480.jpg');
    assert.equal(live.url, 'https://chzzk.naver.com/live/channel-id');
});

test('normalizes CHZZK local start times with an explicit timezone', () => {
    assert.equal(
        normalizeStartedAt('2026-07-31 09:55:06'),
        '2026-07-31T09:55:06+09:00'
    );
    assert.equal(normalizeStartedAt('not-a-date'), '');
});

test('mergeSearchResults deduplicates and sorts by viewer count', () => {
    const lives = mergeSearchResults([
        [entry({liveId: 1, title: '돌죽', viewerCount: 3})],
        [entry({liveId: 1, title: 'DCSS', viewerCount: 4})],
        [entry({liveId: 2, channelId: 'other', title: 'Stone Soup', viewerCount: 20})]
    ]);

    assert.deepEqual(lives.map(live => live.liveId), ['2', '1']);
    assert.equal(lives[1].title, 'DCSS');
});

test('fetchCombinedLives searches all three keywords and fails on a partial outage', async () => {
    const calls = [];
    const lives = await fetchCombinedLives({
        search: async keyword => {
            calls.push(keyword);
            return keyword === '돌죽' ? [entry()] : [];
        }
    });

    assert.deepEqual(calls.sort(), [...SEARCH_KEYWORDS].sort());
    assert.equal(lives.length, 1);

    await assert.rejects(
        fetchCombinedLives({
            search: async keyword => {
                if (keyword === 'DCSS') {
                    throw new Error('upstream failed');
                }
                return [];
            }
        }),
        /upstream failed/
    );
});

test('createCachedLiveSource caches empty lists and coalesces concurrent refreshes', async () => {
    let calls = 0;
    let currentTime = 1_000;
    const source = createCachedLiveSource({
        cacheTtlMs: 100,
        now: () => currentTime,
        fetchLives: async () => {
            calls++;
            return [];
        }
    });

    const [first, second] = await Promise.all([source(), source()]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.deepEqual(first.lives, []);

    await source();
    assert.equal(calls, 1);

    currentTime += 101;
    await source();
    assert.equal(calls, 2);
});

test('createCachedLiveSource backs off briefly after a failed refresh', async () => {
    let calls = 0;
    let currentTime = 2_000;
    const source = createCachedLiveSource({
        failureTtlMs: 50,
        now: () => currentTime,
        fetchLives: async () => {
            calls++;
            throw new Error('upstream unavailable');
        }
    });

    await assert.rejects(source(), /upstream unavailable/);
    await assert.rejects(source(), /upstream unavailable/);
    assert.equal(calls, 1);

    currentTime += 51;
    await assert.rejects(source(), /upstream unavailable/);
    assert.equal(calls, 2);
});

test('HTTP server exposes CORS, hides upstream errors behind 503, and has health checks', async t => {
    let fail = false;
    const server = createServer({
        allowedOrigins: new Set(['https://crawl.nemelex.cards']),
        logger: {error() {}},
        getLives: async () => {
            if (fail) {
                throw new Error('temporary failure');
            }
            return {ok: true, lives: []};
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(baseUrl, {
        headers: {Origin: 'https://crawl.nemelex.cards'}
    });
    assert.equal(response.status, 200);
    assert.equal(
        response.headers.get('access-control-allow-origin'),
        'https://crawl.nemelex.cards'
    );
    assert.deepEqual(await response.json(), {ok: true, lives: []});

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);

    fail = true;
    const failed = await fetch(`${baseUrl}/lives`);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).ok, false);
});
