import http from 'node:http';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

export const CHZZK_CATEGORY = Object.freeze({
    type: 'GAME',
    id: 'Dungeon_Crawl_Stone_Soup',
    name: '던전 크롤 스톤 수프'
});

const CHZZK_CATEGORY_API_URL = 'https://api.chzzk.naver.com/service/v2/categories';
const EXCLUDED_TITLE_PATTERN = /리듬\s*돌죽/i;
const CATEGORY_PAGE_SIZE = 50;
const MAX_CATEGORY_PAGES = 5;
const DEFAULT_PORT = 3000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_FAILURE_TTL_MS = 15_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
    'https://crawl.nemelex.cards',
    'https://test.nemelex.cards',
    'http://localhost:6060',
    'http://127.0.0.1:6060'
]);

export async function fetchChzzkCategoryLives({
    category = CHZZK_CATEGORY,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    pageSize = CATEGORY_PAGE_SIZE,
    maxPages = MAX_CATEGORY_PAGES
} = {}) {
    const results = [];
    let cursor = null;

    for (let page = 0; page < maxPages; page++) {
        const categoryType = encodeURIComponent(category.type);
        const categoryId = encodeURIComponent(category.id);
        const url = new URL(
            `${CHZZK_CATEGORY_API_URL}/${categoryType}/${categoryId}/lives`
        );
        url.searchParams.set('size', String(pageSize));
        url.searchParams.set('sortType', 'POPULAR');
        if (cursor) {
            url.searchParams.set(
                'concurrentUserCount',
                String(cursor.concurrentUserCount)
            );
            url.searchParams.set('liveId', cursor.liveId);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetchImpl(url, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'CNC-Chzzk-Category-Proxy/1.1'
                },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`CHZZK category API returned ${response.status}`);
            }

            const payload = await response.json();
            const data = payload?.content?.data;
            if (!Array.isArray(data)) {
                throw new Error('CHZZK category API returned an invalid payload');
            }

            results.push(...data);
            if (data.length < pageSize) {
                break;
            }

            const next = payload?.content?.page?.next;
            const concurrentUserCount = Number(next?.concurrentUserCount);
            const liveId = String(next?.liveId || '').trim();
            if (!Number.isFinite(concurrentUserCount) || !liveId) {
                break;
            }
            if (
                cursor &&
                cursor.concurrentUserCount === concurrentUserCount &&
                cursor.liveId === liveId
            ) {
                break;
            }
            cursor = {concurrentUserCount, liveId};
        } finally {
            clearTimeout(timeout);
        }
    }

    return results;
}

export function normalizeLiveEntry(entry) {
    const live = entry?.live || entry;
    const channel = live?.channel || entry?.channel;
    if (!live || !channel) {
        return null;
    }

    const title = String(live.liveTitle || '').trim();
    const channelId = String(channel.channelId || live.channelId || '').trim();
    if (
        !title ||
        !channelId ||
        live.categoryType !== CHZZK_CATEGORY.type ||
        live.liveCategory !== CHZZK_CATEGORY.id ||
        EXCLUDED_TITLE_PATTERN.test(title)
    ) {
        return null;
    }

    const liveId = String(live.liveId || '').trim();
    const viewerCount = Math.max(0, Number.parseInt(live.concurrentUserCount, 10) || 0);
    const thumbnailUrl = String(live.liveImageUrl || live.defaultThumbnailImageUrl || '')
        .replace('{type}', '480');
    const openDate = String(live.openDate || '').trim();

    return {
        liveId,
        channelId,
        channelName: String(channel.channelName || '').trim(),
        channelImageUrl: String(channel.channelImageUrl || '').trim(),
        title,
        viewerCount,
        thumbnailUrl,
        openDate,
        startedAt: normalizeStartedAt(openDate),
        categoryName: String(live.liveCategoryValue || '').trim(),
        adult: Boolean(live.adult),
        url: `https://chzzk.naver.com/live/${encodeURIComponent(channelId)}`
    };
}

export function normalizeStartedAt(value) {
    const raw = String(value || '').trim();
    const koreanLocalTime = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    if (koreanLocalTime) {
        const [, year, month, day, hour, minute, second] = koreanLocalTime;
        return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
    }

    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function normalizeCategoryLives(entries) {
    const livesById = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
        const live = normalizeLiveEntry(entry);
        if (!live) {
            continue;
        }

        const key = live.liveId || live.channelId;
        const existing = livesById.get(key);
        if (!existing || live.viewerCount > existing.viewerCount) {
            livesById.set(key, live);
        }
    }

    return [...livesById.values()].sort((left, right) => (
        right.viewerCount - left.viewerCount ||
        left.channelName.localeCompare(right.channelName, 'ko') ||
        left.title.localeCompare(right.title, 'ko')
    ));
}

export async function fetchDcssLives({
    fetchCategory = fetchChzzkCategoryLives,
    ...categoryOptions
} = {}) {
    return normalizeCategoryLives(await fetchCategory(categoryOptions));
}

export function createCachedLiveSource({
    fetchLives = fetchDcssLives,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    failureTtlMs = DEFAULT_FAILURE_TTL_MS,
    now = Date.now
} = {}) {
    let cache = null;
    let failure = null;
    let refreshPromise = null;

    return async function getLives() {
        const currentTime = now();
        if (cache && currentTime < cache.expiresAt) {
            return cache.payload;
        }
        if (failure && currentTime < failure.retryAfter) {
            throw failure.error;
        }

        if (!refreshPromise) {
            refreshPromise = Promise.resolve()
                .then(fetchLives)
                .then(lives => {
                    const updatedAtMs = now();
                    const payload = {
                        ok: true,
                        category: {...CHZZK_CATEGORY},
                        updatedAt: new Date(updatedAtMs).toISOString(),
                        lives
                    };
                    cache = {
                        expiresAt: updatedAtMs + cacheTtlMs,
                        payload
                    };
                    failure = null;
                    return payload;
                })
                .catch(error => {
                    failure = {
                        error,
                        retryAfter: now() + failureTtlMs
                    };
                    throw error;
                })
                .finally(() => {
                    refreshPromise = null;
                });
        }

        return refreshPromise;
    };
}

export function parseAllowedOrigins(value = process.env.ALLOWED_ORIGINS) {
    if (!value) {
        return new Set(DEFAULT_ALLOWED_ORIGINS);
    }

    return new Set(String(value)
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean));
}

export function createServer({
    getLives = createCachedLiveSource(),
    allowedOrigins = parseAllowedOrigins(),
    logger = console
} = {}) {
    const loggedErrors = new WeakSet();

    return http.createServer(async (request, response) => {
        setCommonHeaders(response);
        const originAllowed = setCorsHeaders(request, response, allowedOrigins);

        if (request.method === 'OPTIONS') {
            response.statusCode = originAllowed ? 204 : 403;
            response.end();
            return;
        }

        const url = new URL(request.url || '/', 'http://chzzk-proxy.local');
        if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
            sendJson(response, 200, {ok: true});
            return;
        }

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/lives')) {
            try {
                sendJson(response, 200, await getLives());
            } catch (error) {
                if (error && typeof error === 'object') {
                    if (!loggedErrors.has(error)) {
                        loggedErrors.add(error);
                        logger.error('Failed to refresh CHZZK live list:', error);
                    }
                } else {
                    logger.error('Failed to refresh CHZZK live list:', error);
                }
                sendJson(response, 503, {
                    ok: false,
                    error: 'CHZZK live list is temporarily unavailable.'
                });
            }
            return;
        }

        sendJson(response, 404, {ok: false, error: 'Not found.'});
    });
}

function setCommonHeaders(response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
}

function setCorsHeaders(request, response, allowedOrigins) {
    const origin = request.headers.origin;
    if (!origin) {
        return true;
    }
    if (!allowedOrigins.has(origin)) {
        return false;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    response.setHeader('Vary', 'Origin');
    return true;
}

function sendJson(response, status, payload) {
    const body = JSON.stringify(payload);
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
}

function positiveInteger(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function startServer({logger = console} = {}) {
    const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
    const cacheTtlMs = positiveInteger(process.env.CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
    const failureTtlMs = positiveInteger(
        process.env.FAILURE_CACHE_TTL_MS,
        DEFAULT_FAILURE_TTL_MS
    );
    const upstreamTimeoutMs = positiveInteger(
        process.env.UPSTREAM_TIMEOUT_MS,
        DEFAULT_UPSTREAM_TIMEOUT_MS
    );
    const getLives = createCachedLiveSource({
        cacheTtlMs,
        failureTtlMs,
        fetchLives: () => fetchDcssLives({timeoutMs: upstreamTimeoutMs})
    });
    const server = createServer({getLives, logger});

    server.listen(port, '0.0.0.0', () => {
        logger.log(`CHZZK proxy listening on 0.0.0.0:${port}`);
    });
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startServer();
}
