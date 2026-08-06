import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {
    CHZZK_CATEGORY,
    createCachedLiveSource,
    createServer,
    fetchChzzkCategoryLives,
    fetchDcssLives,
    normalizeCategoryLives,
    normalizeLiveEntry,
    normalizeStartedAt
} from './index.js';

function entry({
    liveId = 1,
    channelId = 'channel-id',
    channelName = 'Crawler',
    title = '돌죽 방송',
    viewerCount = 7,
    categoryType = CHZZK_CATEGORY.type,
    categoryId = CHZZK_CATEGORY.id,
    categoryName = CHZZK_CATEGORY.name
} = {}) {
    return {
        liveId,
        liveTitle: title,
        concurrentUserCount: viewerCount,
        liveImageUrl: 'https://example.test/image_{type}.jpg',
        channelId,
        categoryType,
        liveCategory: categoryId,
        liveCategoryValue: categoryName,
        channel: {
            channelId,
            channelName,
            channelImageUrl: 'https://example.test/channel.jpg'
        }
    };
}

test('normalizeLiveEntry keeps category broadcasts regardless of title keywords', () => {
    assert.equal(normalizeLiveEntry(entry({categoryId: 'Other_Game'})), null);
    assert.equal(normalizeLiveEntry(entry({title: '리듬돌죽 고득점 도전'})), null);
    assert.equal(normalizeLiveEntry(entry({title: '오늘은 리듬   돌죽'})), null);
    assert.equal(normalizeLiveEntry(entry({title: ''})), null);
    assert.equal(normalizeLiveEntry(entry({channelId: ''})), null);

    const live = normalizeLiveEntry(entry({title: '오늘은 15룬 도전'}));
    assert.equal(live.title, '오늘은 15룬 도전');
    assert.equal(live.thumbnailUrl, 'https://example.test/image_480.jpg');
    assert.equal(live.url, 'https://chzzk.naver.com/live/channel-id');
    assert.equal(live.categoryName, CHZZK_CATEGORY.name);
});

test('normalizes CHZZK local start times with an explicit timezone', () => {
    assert.equal(
        normalizeStartedAt('2026-07-31 09:55:06'),
        '2026-07-31T09:55:06+09:00'
    );
    assert.equal(normalizeStartedAt('not-a-date'), '');
});

test('normalizeCategoryLives deduplicates and sorts by viewer count', () => {
    const lives = normalizeCategoryLives([
        entry({liveId: 1, title: '첫 방송', viewerCount: 3}),
        entry({liveId: 1, title: '갱신된 방송', viewerCount: 4}),
        entry({liveId: 2, channelId: 'other', title: '키워드 없는 방송', viewerCount: 20})
    ]);

    assert.deepEqual(lives.map(live => live.liveId), ['2', '1']);
    assert.equal(lives[1].title, '갱신된 방송');
});

test('fetchChzzkCategoryLives uses the DCSS category endpoint once for a short page', async () => {
    const urls = [];
    const lives = await fetchChzzkCategoryLives({
        fetchImpl: async url => {
            urls.push(new URL(url));
            return upstreamResponse({
                content: {
                    data: [entry()],
                    page: {next: {concurrentUserCount: 7, liveId: 1}}
                }
            });
        }
    });

    assert.equal(lives.length, 1);
    assert.equal(urls.length, 1);
    assert.equal(
        urls[0].pathname,
        '/service/v2/categories/GAME/Dungeon_Crawl_Stone_Soup/lives'
    );
    assert.equal(urls[0].searchParams.get('size'), '50');
    assert.equal(urls[0].searchParams.get('sortType'), 'POPULAR');
    assert.equal(urls[0].searchParams.has('keyword'), false);
});

test('fetchChzzkCategoryLives follows the viewer and live ID cursor', async () => {
    const urls = [];
    const lives = await fetchChzzkCategoryLives({
        pageSize: 2,
        fetchImpl: async url => {
            const parsedUrl = new URL(url);
            urls.push(parsedUrl);
            if (urls.length === 1) {
                return upstreamResponse({
                    content: {
                        data: [entry({liveId: 1}), entry({liveId: 2})],
                        page: {next: {concurrentUserCount: 3, liveId: 2}}
                    }
                });
            }
            return upstreamResponse({
                content: {data: [entry({liveId: 3})], page: null}
            });
        }
    });

    assert.equal(lives.length, 3);
    assert.equal(urls.length, 2);
    assert.equal(urls[1].searchParams.get('concurrentUserCount'), '3');
    assert.equal(urls[1].searchParams.get('liveId'), '2');
});

test('fetchDcssLives normalizes one category result and propagates upstream errors', async () => {
    let calls = 0;
    const lives = await fetchDcssLives({
        fetchCategory: async () => {
            calls++;
            return [entry()];
        }
    });

    assert.equal(calls, 1);
    assert.equal(lives.length, 1);

    await assert.rejects(
        fetchDcssLives({
            fetchCategory: async () => {
                throw new Error('upstream failed');
            }
        }),
        /upstream failed/
    );
});

test('fetchChzzkCategoryLives rejects HTTP errors and invalid payloads', async () => {
    await assert.rejects(
        fetchChzzkCategoryLives({
            fetchImpl: async () => upstreamResponse({}, false, 503)
        }),
        /returned 503/
    );
    await assert.rejects(
        fetchChzzkCategoryLives({
            fetchImpl: async () => upstreamResponse({content: {data: null}})
        }),
        /invalid payload/
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
    assert.deepEqual(first.category, CHZZK_CATEGORY);

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

function upstreamResponse(payload, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => payload
    };
}
