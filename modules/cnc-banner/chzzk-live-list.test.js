import assert from 'node:assert/strict';
import test from 'node:test';
import BannerTemplate from './banner-template.js';
import ChzzkLiveList, {
    formatStreamDuration,
    normalizeChzzkLives,
    normalizeStartedAt,
    normalizeThumbnailUrl,
    renderChzzkLiveListHTML
} from './chzzk-live-list.js';

function live(overrides = {}) {
    return {
        channelId: 'f8d7f9a8723391519c68dd8cc6630bc3',
        channelName: 'Wong',
        title: '돌죽',
        viewerCount: 3,
        thumbnailUrl: 'https://livecloud-thumb.akamaized.net/live/image_480.jpg',
        startedAt: '2026-07-31T09:55:06+09:00',
        ...overrides
    };
}

function categoryPayload(lives) {
    return {
        ok: true,
        category: {
            type: 'GAME',
            id: 'Dungeon_Crawl_Stone_Soup',
            name: '던전 크롤 스톤 수프'
        },
        lives
    };
}

test('normalizes matching broadcasts', () => {
    assert.deepEqual(normalizeChzzkLives({ok: true, lives: [live()]}), [{
        ...live(),
        startedAt: '2026-07-31T00:55:06.000Z'
    }]);
});

test('returns no items for unavailable, invalid, or empty payloads', () => {
    assert.deepEqual(normalizeChzzkLives(null), []);
    assert.deepEqual(normalizeChzzkLives({ok: false, lives: [live()]}), []);
    assert.deepEqual(normalizeChzzkLives({ok: true, lives: []}), []);
});

test('accepts keyword-free titles only from the expected category payload', () => {
    const keywordFreeLive = live({title: '오늘은 15룬 도전'});
    assert.equal(
        normalizeChzzkLives(categoryPayload([keywordFreeLive]))[0].title,
        '오늘은 15룬 도전'
    );
    assert.deepEqual(normalizeChzzkLives({
        ...categoryPayload([keywordFreeLive]),
        category: {type: 'GAME', id: 'Other_Game'}
    }), []);
    assert.deepEqual(normalizeChzzkLives({ok: true, lives: [keywordFreeLive]}), []);
});

test('filters unrelated, excluded, duplicate, and unsafe items', () => {
    const lives = normalizeChzzkLives({
        ok: true,
        lives: [
            live({title: '리듬돌죽'}),
            live({channelId: 'another', title: '리듬 돌죽'}),
            live({channelId: 'third', title: 'unrelated game'}),
            live({channelId: 'fourth', title: 'DCSS'}),
            live({channelId: 'fourth', title: 'Stone Soup'}),
            live({channelId: 'https://example.test', title: '돌죽'})
        ]
    });

    assert.deepEqual(lives.map(value => value.title), ['DCSS']);
});

test('normalizes thumbnail and start time values', () => {
    assert.equal(
        normalizeThumbnailUrl('https://livecloud-thumb.akamaized.net/image.jpg'),
        'https://livecloud-thumb.akamaized.net/image.jpg'
    );
    assert.equal(normalizeThumbnailUrl('https://evil.example/image.jpg'), '');
    assert.equal(
        normalizeStartedAt('2026-07-31 09:55:06'),
        '2026-07-31T00:55:06.000Z'
    );
});

test('formats stream duration for Korean and English', () => {
    const startedAt = '2026-07-31T00:00:00.000Z';
    const now = Date.parse('2026-07-31T13:25:00.000Z');
    assert.equal(formatStreamDuration(startedAt, 'ko', now), '13시간 25분');
    assert.equal(formatStreamDuration(startedAt, 'en', now), '13h 25m');
    assert.equal(
        formatStreamDuration(startedAt, 'ko', Date.parse('2026-07-31T03:00:00.000Z')),
        '3시간'
    );
});

test('renders compact cards without a visible list heading', () => {
    const html = renderChzzkLiveListHTML(
        normalizeChzzkLives({ok: true, lives: [live()]}),
        'ko',
        Date.parse('2026-07-31T13:25:06.000Z')
    );

    assert.match(html, /class="cnc-chzzk-live-list"/);
    assert.match(html, /class="cnc-chzzk-live-title">돌죽<\/div>/);
    assert.match(html, />3명<\/span>/);
    assert.match(html, />· 12시간 30분<\/span>/);
    assert.doesNotMatch(html, /cnc-chzzk-live-heading/);
    assert.equal((html.match(/>LIVE<\/span>/g) || []).length, 1);
    assert.equal(renderChzzkLiveListHTML([], 'ko'), '');
});

test('escapes all API-provided strings in cached banner HTML', () => {
    const html = renderChzzkLiveListHTML([live({
        channelId: 'safe-channel',
        channelName: '\"><img src=x onerror=alert(1)>',
        title: 'DCSS <script>alert(2)</script> & "quoted"',
        thumbnailUrl: 'https://evil.example/image.jpg'
    })], 'en');

    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /evil\.example/);
    assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
    assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('caches successful lives and clears them for empty or failed responses', async () => {
    const list = new ChzzkLiveList({
        fetchImpl: async () => response({ok: true, lives: [live()]})
    });
    let renderCount = 0;
    let removeCount = 0;
    list.render = () => renderCount++;
    list.remove = () => removeCount++;

    await list.update();
    assert.equal(renderCount, 1);
    assert.equal(list.cachedLives.length, 1);
    assert.match(list.getHTML('ko'), /cnc-chzzk-live-list/);

    list.fetchImpl = async () => response({ok: true, lives: []});
    await list.update();
    assert.deepEqual(list.cachedLives, []);
    assert.equal(list.getHTML('ko'), '');
    assert.equal(removeCount, 1);

    list.cachedLives = normalizeChzzkLives({ok: true, lives: [live()]});
    list.fetchImpl = async () => response({}, false, 503);
    await list.update();
    assert.deepEqual(list.cachedLives, []);
    assert.equal(removeCount, 2);
});

test('ignores a superseded request after a redraw starts a new refresh', async () => {
    let resolveFirst;
    let requestCount = 0;
    const list = new ChzzkLiveList({
        fetchImpl: () => {
            requestCount++;
            if (requestCount === 1) {
                return new Promise(resolve => {
                    resolveFirst = resolve;
                });
            }
            return Promise.resolve(response({
                ok: true,
                lives: [live({channelId: 'new-channel', title: 'DCSS new'})]
            }));
        }
    });
    list.render = () => {};
    list.remove = () => {};

    const firstUpdate = list.update();
    const firstSignal = list.abortController.signal;
    const secondUpdate = list.update();
    assert.equal(firstSignal.aborted, true);
    await secondUpdate;

    resolveFirst(response({
        ok: true,
        lives: [live({channelId: 'old-channel', title: 'DCSS old'})]
    }));
    await firstUpdate;

    assert.equal(list.cachedLives.length, 1);
    assert.equal(list.cachedLives[0].title, 'DCSS new');
});

test('places cached lives immediately after donations in every banner variant', () => {
    const originalWindow = globalThis.window;
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {getItem: () => null};

    try {
        const donations = {
            getSummaryHTML: locale => `<div id="donations-${locale}"></div>`
        };
        const chzzkLives = {
            getHTML: locale => `<section id="chzzk-${locale}"></section>`
        };
        const template = new BannerTemplate(donations, chzzkLives);

        for (const [locale, method] of [
            ['ko', 'getKoreanBanner'],
            ['en', 'getEnglishBanner']
        ]) {
            for (const aprilFools of [false, true]) {
                globalThis.window = {
                    location: {
                        search: `?forceLang=${locale}${aprilFools ? '&aprilFools=true' : ''}`
                    }
                };
                const html = template[method](null);
                const donationIndex = html.indexOf(`id="donations-${locale}"`);
                const chzzkIndex = html.indexOf(`id="chzzk-${locale}"`);
                assert.ok(donationIndex >= 0);
                assert.ok(chzzkIndex > donationIndex);
                assert.equal((html.match(new RegExp(`id="chzzk-${locale}"`, 'g')) || []).length, 1);
            }
        }
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
        if (originalLocalStorage === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = originalLocalStorage;
        }
    }
});

function response(payload, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => payload
    };
}
