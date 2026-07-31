import {getLocale} from './utils.js';

const DEFAULT_API_URL = 'https://chzzk-api.nemelex.cards/';
const DEFAULT_TIMEOUT_MS = 7_000;
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const MAX_LIVES = 50;
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
    #banner .cnc-chzzk-live-heading {
        margin-bottom: 4px;
        color: #ffffff;
        font-weight: 600;
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
            !TITLE_PATTERN.test(title) ||
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
    }

    start() {
        clearInterval(this.refreshKey);
        this.update();
        this.refreshKey = setInterval(() => this.update(), this.refreshIntervalMs);
    }

    stop() {
        clearInterval(this.refreshKey);
        this.refreshKey = null;
        this.requestGeneration++;
        this.abortController?.abort();
        this.abortController = null;
        this.remove();
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
                this.remove();
                return;
            }

            this.render(lives);
        } catch (_error) {
            if (generation === this.requestGeneration) {
                this.remove();
            }
        } finally {
            clearTimeout(timeout);
            if (generation === this.requestGeneration) {
                this.abortController = null;
            }
        }
    }

    render(lives) {
        const banner = document.getElementById('banner');
        if (!banner) {
            this.remove();
            return;
        }

        const locale = getLocale();
        const isKorean = locale === 'ko';
        const numberFormat = new Intl.NumberFormat(locale);
        const container = document.createElement('section');
        container.className = 'cnc-chzzk-live-list';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute(
            'aria-label',
            isKorean ? '치지직 돌죽 방송 목록' : 'CHZZK DCSS live streams'
        );

        const style = document.createElement('style');
        style.textContent = LIVE_LIST_STYLE;
        container.append(style);

        const heading = document.createElement('div');
        heading.className = 'cnc-chzzk-live-heading';
        const badge = document.createElement('span');
        badge.className = 'cnc-chzzk-live-badge';
        badge.textContent = 'LIVE';
        heading.append(
            badge,
            document.createTextNode(isKorean ? '치지직 돌죽 방송' : 'CHZZK DCSS streams')
        );
        container.append(heading);

        const list = document.createElement('ul');
        list.className = 'cnc-chzzk-live-items';
        for (const live of lives) {
            const item = document.createElement('li');
            item.className = 'cnc-chzzk-live-item';

            const link = document.createElement('a');
            link.className = 'cnc-chzzk-live-card';
            link.href = `https://chzzk.naver.com/live/${encodeURIComponent(live.channelId)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = `${live.channelName} — ${live.title}`;

            const thumbnail = document.createElement('div');
            thumbnail.className = 'cnc-chzzk-live-thumbnail';
            if (live.thumbnailUrl) {
                const image = document.createElement('img');
                image.src = live.thumbnailUrl;
                image.alt = isKorean
                    ? `${live.channelName} 방송 썸네일`
                    : `${live.channelName} stream thumbnail`;
                image.loading = 'lazy';
                image.decoding = 'async';
                image.referrerPolicy = 'no-referrer';
                image.addEventListener('error', () => image.remove(), {once: true});
                thumbnail.append(image);
            }
            const cardBadge = document.createElement('span');
            cardBadge.className = 'cnc-chzzk-live-badge';
            cardBadge.textContent = 'LIVE';
            thumbnail.append(cardBadge);

            const details = document.createElement('div');
            details.className = 'cnc-chzzk-live-details';
            const title = document.createElement('div');
            title.className = 'cnc-chzzk-live-title';
            title.textContent = live.title;

            const channel = document.createElement('div');
            channel.className = 'cnc-chzzk-live-channel';
            channel.textContent = live.channelName;

            const meta = document.createElement('div');
            meta.className = 'cnc-chzzk-live-meta';

            const viewers = document.createElement('span');
            viewers.className = 'cnc-chzzk-live-viewers';
            viewers.textContent = isKorean
                ? `${numberFormat.format(live.viewerCount)}명`
                : `${numberFormat.format(live.viewerCount)} viewers`;

            const duration = document.createElement('span');
            duration.className = 'cnc-chzzk-live-duration';
            duration.textContent = `· ${formatStreamDuration(live.startedAt, locale)}`;

            meta.append(viewers, duration);
            details.append(title, channel, meta);
            link.append(thumbnail, details);
            item.append(link);
            list.append(item);
        }
        container.append(list);

        const existing = document.querySelector('#banner .cnc-chzzk-live-list');
        if (existing) {
            existing.replaceWith(container);
            return;
        }

        const donationSummary = banner.querySelector('#cnc-donation-summary');
        if (donationSummary?.parentNode) {
            donationSummary.parentNode.insertBefore(container, donationSummary.nextSibling);
        } else {
            banner.append(container);
        }
    }

    remove() {
        for (const element of document.querySelectorAll('#banner .cnc-chzzk-live-list')) {
            element.remove();
        }
    }
}
