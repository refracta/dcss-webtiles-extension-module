import assert from 'node:assert/strict';
import test from 'node:test';
import {
    formatStreamDuration,
    normalizeChzzkLives,
    normalizeStartedAt,
    normalizeThumbnailUrl
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
