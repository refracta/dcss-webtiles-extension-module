import {escapeHtml, getLocale} from './utils.js';

const DEFAULT_API_URL = 'https://chzzk-api.nemelex.cards/';
const DEFAULT_TIMEOUT_MS = 7_000;
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const MAX_LIVES = 50;
const CHZZK_CATEGORY_TYPE = 'GAME';
const CHZZK_CATEGORY_ID = 'Dungeon_Crawl_Stone_Soup';
const TITLE_PATTERN = /돌죽|dcss|stone\s+soup/i;
const EXCLUDED_TITLE_PATTERN = /리듬\s*돌죽/i;

const LIVE_LIST_STYLE = `
    #banner .cnc-chzzk-live-list {
        width: min(980px, calc(100% - 10px));
        box-sizing: border-box;
        margin: 0 0 12px 0;
        padding: 9px 11px;
        border: 1px solid rgba(0, 230, 150, 0.45);
        border-left: 3px solid #00e696;
        border-radius: 6px;
        background: rgba(8, 17, 15, 0.9);
        color: #dcebe6;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    #banner .cnc-chzzk-live-badge {
        display: inline-block;
        margin-right: 5px;
        padding: 1px 5px;
        border-radius: 4px;
        background: #e02020;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.35;
        vertical-align: 1px;
    }
    #banner .cnc-chzzk-live-items {
        display: grid;
        grid-auto-columns: minmax(210px, 240px);
        grid-auto-flow: column;
        gap: 10px;
        margin: 0;
        padding: 0 0 6px 0;
        list-style: none;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scroll-snap-type: inline proximity;
        scrollbar-color: #477767 rgba(255, 255, 255, 0.08);
        scrollbar-width: thin;
    }
    #banner .cnc-chzzk-live-item {
        min-width: 0;
        margin: 0;
        scroll-snap-align: start;
    }
    #banner .cnc-chzzk-live-card {
        display: block;
        min-width: 0;
        height: 100%;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.035);
        color: #f4d700 !important;
        text-decoration: none;
    }
    #banner .cnc-chzzk-live-card:hover {
        border-color: rgba(0, 230, 150, 0.65);
        color: #ffffff !important;
    }
    #banner .cnc-chzzk-live-thumbnail {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: linear-gradient(135deg, #17352d, #0c1815);
    }
    #banner .cnc-chzzk-live-thumbnail img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    #banner .cnc-chzzk-live-thumbnail .cnc-chzzk-live-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        margin: 0;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
    }
    #banner .cnc-chzzk-live-details {
        padding: 7px 8px 8px;
    }
    #banner .cnc-chzzk-live-title {
        display: block;
        overflow: hidden;
        color: #ffffff;
        font-weight: 600;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    #banner .cnc-chzzk-live-channel {
        margin-top: 4px;
        overflow: hidden;
        color: #b9d2ca;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    #banner .cnc-chzzk-live-meta {
        display: flex;
        gap: 5px;
        justify-content: flex-start;
        margin-top: 4px;
    }
    #banner .cnc-chzzk-live-viewers,
    #banner .cnc-chzzk-live-duration {
        color: #9bb7ae;
        font-size: 12px;
        white-space: nowrap;
    }
`;

export function normalizeChzzkLives(payload) {
    if (!payload || payload.ok !== true || !Array.isArray(payload.lives)) {
        return [];
    }

    const hasCategoryMetadata = payload.category !== undefined;
    const isDcssCategory = payload.category?.type === CHZZK_CATEGORY_TYPE &&
        payload.category?.id === CHZZK_CATEGORY_ID;
    if (hasCategoryMetadata && !isDcssCategory) {
        return [];
    }

    const seenChannels = new Set();
    const lives = [];

    for (const value of payload.lives.slice(0, MAX_LIVES)) {
        const channelId = String(value?.channelId || '').trim();
        const channelName = String(value?.channelName || '').trim().slice(0, 80);
        const title = String(value?.title || '').trim().slice(0, 240);
        const viewerCount = Number(value?.viewerCount);
        const thumbnailUrl = normalizeThumbnailUrl(value?.thumbnailUrl);
        const startedAt = normalizeStartedAt(value?.startedAt || value?.openDate);

        if (
            !/^[A-Za-z0-9_-]{1,64}$/.test(channelId) ||
            !channelName ||
            !title ||
            (!isDcssCategory && !TITLE_PATTERN.test(title)) ||
            EXCLUDED_TITLE_PATTERN.test(title) ||
            !Number.isFinite(viewerCount) ||
            viewerCount < 0 ||
            seenChannels.has(channelId)
        ) {
            continue;
        }

        seenChannels.add(channelId);
        lives.push({
            channelId,
            channelName,
            title,
            viewerCount: Math.floor(viewerCount),
            thumbnailUrl,
            startedAt
        });
    }

    return lives;
}

export function normalizeThumbnailUrl(value) {
    try {
        const url = new URL(String(value || ''));
        const allowedHost = url.hostname.endsWith('.akamaized.net') ||
            url.hostname.endsWith('.pstatic.net') ||
            url.hostname === 'pstatic.net';
        return url.protocol === 'https:' && allowedHost ? url.href : '';
    } catch (_error) {
        return '';
    }
}

export function normalizeStartedAt(value) {
    const raw = String(value || '').trim();
    const koreanLocalTime = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    const timestamp = Date.parse(koreanLocalTime
        ? `${koreanLocalTime[1]}-${koreanLocalTime[2]}-${koreanLocalTime[3]}T${koreanLocalTime[4]}:${koreanLocalTime[5]}:${koreanLocalTime[6]}+09:00`
        : raw);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function formatStreamDuration(startedAt, locale = 'ko', now = Date.now()) {
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs) || startedAtMs > now) {
        return locale === 'ko' ? '방송 중' : 'Live';
    }

    const totalMinutes = Math.max(1, Math.floor((now - startedAtMs) / 60_000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (locale === 'ko') {
        if (days > 0) {
            return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
        }
        if (hours > 0) {
            return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
        }
        return `${minutes}분`;
    }

    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

export function renderChzzkLiveListHTML(lives, locale = 'ko', now = Date.now()) {
    if (!Array.isArray(lives) || lives.length === 0) {
        return '';
    }

    const normalizedLocale = locale === 'ko' ? 'ko' : 'en';
    const isKorean = normalizedLocale === 'ko';
    const numberFormat = new Intl.NumberFormat(normalizedLocale);
    const items = lives.map(live => {
        const channelId = String(live?.channelId || '');
        const channelName = String(live?.channelName || '');
        const title = String(live?.title || '');
        const thumbnailUrl = normalizeThumbnailUrl(live?.thumbnailUrl);
        const viewerCount = Math.max(0, Math.floor(Number(live?.viewerCount) || 0));
        const cardTitle = escapeHtml(`${channelName} — ${title}`);
        const thumbnail = thumbnailUrl
            ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(
                isKorean
                    ? `${channelName} 방송 썸네일`
                    : `${channelName} stream thumbnail`
            )}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
            : '';
        const viewers = isKorean
            ? `${numberFormat.format(viewerCount)}명`
            : `${numberFormat.format(viewerCount)} viewers`;
        const duration = formatStreamDuration(live?.startedAt, normalizedLocale, now);

        return `
            <li class="cnc-chzzk-live-item">
                <a class="cnc-chzzk-live-card"
                   href="https://chzzk.naver.com/live/${encodeURIComponent(channelId)}"
                   target="_blank"
                   rel="noopener noreferrer"
                   title="${cardTitle}">
                    <div class="cnc-chzzk-live-thumbnail">
                        ${thumbnail}
                        <span class="cnc-chzzk-live-badge">LIVE</span>
                    </div>
                    <div class="cnc-chzzk-live-details">
                        <div class="cnc-chzzk-live-title">${escapeHtml(title)}</div>
                        <div class="cnc-chzzk-live-channel">${escapeHtml(channelName)}</div>
                        <div class="cnc-chzzk-live-meta">
                            <span class="cnc-chzzk-live-viewers">${viewers}</span>
                            <span class="cnc-chzzk-live-duration">· ${duration}</span>
                        </div>
                    </div>
                </a>
            </li>
        `;
    }).join('');

    return `
        <section class="cnc-chzzk-live-list"
                 aria-live="polite"
                 aria-label="${isKorean ? '치지직 돌죽 방송 목록' : 'CHZZK DCSS live streams'}">
            <style>${LIVE_LIST_STYLE}</style>
            <ul class="cnc-chzzk-live-items">${items}</ul>
        </section>
    `;
}

export default class ChzzkLiveList {
    constructor({
        apiUrl = DEFAULT_API_URL,
        fetchImpl = (...args) => globalThis.fetch(...args),
        timeoutMs = DEFAULT_TIMEOUT_MS,
        refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS
    } = {}) {
        this.apiUrl = apiUrl;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.refreshIntervalMs = refreshIntervalMs;
        this.requestGeneration = 0;
        this.abortController = null;
        this.refreshKey = null;
        this.cachedLives = [];
    }

    start() {
        clearInterval(this.refreshKey);
        this.bindThumbnailErrorHandlers();
        this.update();
        this.refreshKey = setInterval(() => this.update(), this.refreshIntervalMs);
    }

    stop() {
        clearInterval(this.refreshKey);
        this.refreshKey = null;
        this.requestGeneration++;
        this.abortController?.abort();
        this.abortController = null;
        this.clear();
    }

    async update() {
        const generation = ++this.requestGeneration;
        this.abortController?.abort();
        const controller = new AbortController();
        this.abortController = controller;
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await this.fetchImpl(this.apiUrl, {
                cache: 'no-store',
                credentials: 'omit',
                headers: {Accept: 'application/json'},
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`CHZZK proxy returned ${response.status}`);
            }

            const lives = normalizeChzzkLives(await response.json());
            if (generation !== this.requestGeneration) {
                return;
            }
            if (lives.length === 0) {
                this.clear();
                return;
            }

            this.cachedLives = lives;
            this.render();
        } catch (_error) {
            if (generation === this.requestGeneration) {
                this.clear();
            }
        } finally {
            clearTimeout(timeout);
            if (generation === this.requestGeneration) {
                this.abortController = null;
            }
        }
    }

    getHTML(locale = getLocale(), now = Date.now()) {
        return renderChzzkLiveListHTML(this.cachedLives, locale, now);
    }

    render() {
        const banner = document.getElementById('banner');
        if (!banner) {
            this.remove();
            return;
        }

        const template = document.createElement('template');
        template.innerHTML = this.getHTML();
        const container = template.content.firstElementChild;
        if (!container) {
            this.remove();
            return;
        }
        const existing = [...document.querySelectorAll('#banner .cnc-chzzk-live-list')];
        if (existing.length > 0) {
            existing[0].replaceWith(container);
            for (const duplicate of existing.slice(1)) {
                duplicate.remove();
            }
        } else {
            const donationSummary = banner.querySelector('#cnc-donation-summary');
            if (donationSummary?.parentNode) {
                donationSummary.parentNode.insertBefore(container, donationSummary.nextSibling);
            } else {
                banner.append(container);
            }
        }
        this.bindThumbnailErrorHandlers(container);
    }

    bindThumbnailErrorHandlers(root = document) {
        for (const image of root.querySelectorAll('.cnc-chzzk-live-thumbnail img')) {
            if (image.dataset.cncChzzkErrorBound) {
                continue;
            }
            image.dataset.cncChzzkErrorBound = 'true';
            if (image.complete && image.naturalWidth === 0) {
                image.remove();
                continue;
            }
            image.addEventListener('error', () => image.remove(), {once: true});
        }
    }

    clear() {
        this.cachedLives = [];
        this.remove();
    }

    remove() {
        for (const element of document.querySelectorAll('#banner .cnc-chzzk-live-list')) {
            element.remove();
        }
    }
}
