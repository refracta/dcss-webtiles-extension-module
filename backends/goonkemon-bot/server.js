import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {renderMonsterHtml} from './goonkemon.js';
import {renderScoreHtml, scoreAnalysis} from './score-rules.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://crawl.nemelex.cards',
    'https://test.nemelex.cards',
    'http://localhost:6060',
    'http://127.0.0.1:6060'
]);

export function startGoonkemonHttpServer(bot, config = {}, {logger = console} = {}) {
    const host = config.httpHost || process.env.GOONKEMON_HTTP_HOST || '0.0.0.0';
    const port = Number(config.httpPort || process.env.GOONKEMON_HTTP_PORT || 8787);
    const allowedOrigins = buildAllowedOrigins(config.allowedOrigins);

    const server = http.createServer((request, response) => {
        handleRequest({bot, config, allowedOrigins, request, response}).catch(error => {
            logger.error(new Date(), 'Goonkemon HTTP error:', error);
            sendJson(response, request, 500, {ok: false, error: 'Internal server error.'}, allowedOrigins);
        });
    });

    server.listen(port, host, () => {
        logger.log(new Date(), `Goonkemon HTTP listening on ${host}:${port}`);
    });

    return server;
}

async function handleRequest(context) {
    const {request, response, allowedOrigins} = context;

    if (request.method === 'OPTIONS') {
        sendOptions(response, request, allowedOrigins);
        return;
    }

    const url = new URL(request.url || '/', 'http://goonkemon.local');
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === 'GET' && pathname === '/') {
        redirect(response, '/ranking');
        return;
    }

    if (request.method === 'GET' && pathname === '/list') {
        await serveList(context, url);
        return;
    }

    if (request.method === 'GET' && pathname === '/ranking') {
        await serveRanking(context, url);
        return;
    }

    if (request.method === 'GET' && pathname === '/score-rules.js') {
        sendFile(response, request, path.join(MODULE_DIR, 'score-rules.js'), 'text/javascript; charset=utf-8', allowedOrigins);
        return;
    }

    if (request.method === 'GET' && pathname.startsWith('/data/')) {
        await serveData(context, pathname);
        return;
    }

    if (request.method === 'POST' && pathname === '/score') {
        await serveScore(context);
        return;
    }

    if (request.method === 'POST' && pathname === '/request') {
        await serveCaptureRequest(context);
        return;
    }

    if (request.method === 'GET' && pathname.length > 1 && !pathname.slice(1).includes('/')) {
        await serveDetail(context, pathname.slice(1));
        return;
    }

    sendHtml(response, request, 404, htmlPage('Not found', '<p>Not found.</p>'), allowedOrigins);
}

async function serveScore({bot, request, response, allowedOrigins}) {
    const payload = await readJsonBody(request);
    if (!payload.monster) {
        sendJson(response, request, 400, {ok: false, error: 'Missing monster payload.'}, allowedOrigins);
        return;
    }

    try {
        const analysis = await bot.analyzeMonsterPayload(payload.monster, payload.webtiles || {});
        const score = scoreAnalysis(analysis);
        sendJson(response, request, 200, {
            ok: true,
            analysis,
            score,
            html: renderScoreHtml(analysis)
        }, allowedOrigins);
    } catch (error) {
        sendJson(response, request, 400, {
            ok: false,
            error: String(error?.message || error)
        }, allowedOrigins);
    }
}

async function serveCaptureRequest({bot, request, response, allowedOrigins}) {
    const payload = await readJsonBody(request);
    try {
        const result = bot.requestCapture(payload.username);
        sendJson(response, request, 200, {
            ok: true,
            ...result,
            message: `Queued capture for ${result.username}.`
        }, allowedOrigins);
    } catch (error) {
        sendJson(response, request, 400, {
            ok: false,
            error: String(error?.message || error)
        }, allowedOrigins);
    }
}

async function serveList({bot, request, response, allowedOrigins}, url) {
    const captures = listCaptures(bot.storageDir);
    const filters = {
        q: String(url.searchParams.get('q') || '').trim().toLowerCase(),
        username: String(url.searchParams.get('username') || '').trim().toLowerCase(),
        lord: String(url.searchParams.get('lord') || '').trim().toLowerCase(),
        spell: String(url.searchParams.get('spell') || '').trim().toLowerCase(),
        stat: String(url.searchParams.get('stat') || '').trim().toLowerCase()
    };
    const filtered = captures.filter(item => matchesFilters(item.capture, filters));
    const rows = filtered
        .sort((a, b) => compareCaptureDateDesc(a.capture, b.capture))
        .map(item => renderListRow(item.capture))
        .join('');

    sendHtml(response, request, 200, htmlPage('Goonkemon list', `
<h1>Goonkemon list</h1>
${renderSearchForm(filters)}
<div class="summary">${filtered.length} / ${captures.length} captures</div>
<table>
<thead><tr><th>Lord</th><th>Score</th><th>Submitter</th><th>Captured</th><th>Spells</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="empty">No captures found.</td></tr>'}</tbody>
</table>`), allowedOrigins);
}

async function serveRanking({bot, request, response, allowedOrigins}, url) {
    const bestPerSubmitter = url.searchParams.get('best') === '1';
    const allRanked = listCaptures(bot.storageDir)
        .map(item => ({...item, score: safeScore(item.capture)}))
        .filter(item => item.score)
        .sort((a, b) => {
            if (b.score.total !== a.score.total) {
                return b.score.total - a.score.total;
            }
            return compareCaptureDateAsc(a.capture, b.capture);
        });
    const ranked = bestPerSubmitter
        ? selectBestCapturePerSubmitter(allRanked)
        : allRanked;

    const rows = ranked.map((item, index) => renderRankingRow(item, index)).join('');
    sendHtml(response, request, 200, htmlPage('Goonkemon ranking', `
<h1>Goonkemon ranking</h1>
<nav><a href="/list">Search captures</a></nav>
${renderRankingOptions(bestPerSubmitter)}
<div class="summary">${ranked.length} / ${allRanked.length} ranked captures</div>
<table>
<thead><tr><th>#</th><th>Lord</th><th>Score</th><th>Submitter</th><th>Captured</th><th>Status</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="empty">No ranked captures.</td></tr>'}</tbody>
</table>`), allowedOrigins);
}

async function serveDetail({bot, request, response, allowedOrigins}, id) {
    const item = findCapture(bot.storageDir, id);
    if (!item) {
        sendHtml(response, request, 404, htmlPage('Not found', '<p>Capture not found.</p>'), allowedOrigins);
        return;
    }

    const encodedId = encodeURIComponent(item.capture.id || id);
    sendHtml(response, request, 200, renderMonsterHtml(
        item.capture,
        `/data/${encodedId}.json`,
        `/data/${encodedId}.images.json`
    ), allowedOrigins);
}

async function serveData({bot, request, response, allowedOrigins}, pathname) {
    const match = pathname.match(/^\/data\/(.+?)(\.images)?\.json$/);
    if (!match) {
        sendJson(response, request, 404, {ok: false, error: 'Not found.'}, allowedOrigins);
        return;
    }

    const item = findCapture(bot.storageDir, match[1]);
    if (!item) {
        sendJson(response, request, 404, {ok: false, error: 'Not found.'}, allowedOrigins);
        return;
    }

    const filePath = match[2]
        ? item.imagesPath
        : item.jsonPath;
    if (!filePath || !fs.existsSync(filePath)) {
        sendJson(response, request, 404, {ok: false, error: 'Not found.'}, allowedOrigins);
        return;
    }

    sendFile(response, request, filePath, 'application/json; charset=utf-8', allowedOrigins);
}

function listCaptures(storageDir) {
    if (!storageDir || !fs.existsSync(storageDir)) {
        return [];
    }

    const items = [];
    walk(storageDir, filePath => {
        if (!filePath.endsWith('.json') || filePath.endsWith('.images.json')) {
            return;
        }
        const capture = readJsonFile(filePath);
        if (!capture?.id || !capture?.monster) {
            return;
        }
        items.push({
            capture,
            jsonPath: filePath,
            imagesPath: filePath.replace(/\.json$/i, '.images.json')
        });
    });
    return items;
}

function findCapture(storageDir, id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
        return null;
    }
    return listCaptures(storageDir).find(item => item.capture.id === normalizedId) || null;
}

function walk(dir, visit) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, visit);
        } else if (entry.isFile()) {
            visit(fullPath);
        }
    }
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return null;
    }
}

function matchesFilters(capture, filters) {
    const analysis = capture.analysis || capture.score || {};
    const username = String(capture.username || '').toLowerCase();
    const title = String(analysis.title || capture.monster?.title || '').toLowerCase();
    const spells = (analysis.spells || []).map(spell => [
        spell.title,
        spell.schools,
        spell.effect,
        spell.range
    ].filter(Boolean).join(' ')).join(' ').toLowerCase();
    const stats = JSON.stringify(analysis.stats || {}).toLowerCase();
    const haystack = JSON.stringify({
        username: capture.username,
        title: analysis.title,
        stats: analysis.stats,
        spells: analysis.spells,
        statuses: analysis.statuses
    }).toLowerCase();

    return (!filters.username || username.includes(filters.username)) &&
        (!filters.lord || title.includes(filters.lord)) &&
        (!filters.spell || spells.includes(filters.spell)) &&
        (!filters.stat || stats.includes(filters.stat)) &&
        (!filters.q || haystack.includes(filters.q));
}

function safeScore(capture) {
    try {
        return scoreAnalysis(capture.analysis || capture.score || {});
    } catch (error) {
        return null;
    }
}

function renderSearchForm(filters) {
    return `<form method="get" action="/list" class="filters">
<label>Search <input name="q" value="${escapeAttribute(filters.q)}"></label>
<label>Submitter <input name="username" value="${escapeAttribute(filters.username)}"></label>
<label>Lord <input name="lord" value="${escapeAttribute(filters.lord)}"></label>
<label>Spell <input name="spell" value="${escapeAttribute(filters.spell)}"></label>
<label>Stat <input name="stat" value="${escapeAttribute(filters.stat)}"></label>
<button type="submit">Filter</button>
</form>`;
}

function renderRankingOptions(bestPerSubmitter) {
    return `<form method="get" action="/ranking" class="ranking-options">
<label><input type="checkbox" name="best" value="1"${bestPerSubmitter ? ' checked' : ''}> Best submission per participant only</label>
<button type="submit">Apply</button>
</form>`;
}

export function selectBestCapturePerSubmitter(ranked) {
    const seen = new Set();
    return ranked.filter(item => {
        const username = String(item.capture?.username || '').trim().toLowerCase();
        const key = username || `\u0000${item.capture?.id || ''}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function renderListRow(capture) {
    const score = safeScore(capture);
    const analysis = capture.analysis || capture.score || {};
    const spells = (analysis.spells || []).map(spell => spell.title).filter(Boolean).slice(0, 5).join(', ');
    return `<tr>
<td><a href="/${encodeURIComponent(capture.id)}">${escapeHtml(analysis.title || capture.monster?.title || capture.id)}</a></td>
<td class="points">${score ? escapeHtml(score.total) : '-'}</td>
<td>${escapeHtml(capture.username || '')}</td>
<td><span data-time="${escapeAttribute(capture.capturedAt)}">${escapeHtml(capture.capturedAt || '')}</span></td>
<td>${escapeHtml(spells || 'none')}</td>
</tr>`;
}

function renderRankingRow(item, index) {
    const {capture, score} = item;
    const statuses = score.statusMultiplierDetails || {};
    const statusText = `x${formatMultiplier(score.statusMultiplier)} ` +
        `(${statuses.buffCount || 0} buffs, ${statuses.debuffCount || 0} debuffs` +
        `${statuses.friendlySummoned ? ', friendly summoned' : ''})`;
    return `<tr>
<td>${index + 1}</td>
<td><a href="/${encodeURIComponent(capture.id)}">${escapeHtml(score.title || capture.id)}</a></td>
<td class="points">${escapeHtml(score.total)}</td>
<td>${escapeHtml(capture.username || '')}</td>
<td><span data-time="${escapeAttribute(capture.capturedAt)}">${escapeHtml(capture.capturedAt || '')}</span></td>
<td>${escapeHtml(statusText)}</td>
</tr>`;
}

function compareCaptureDateAsc(a, b) {
    return Date.parse(a.capturedAt || 0) - Date.parse(b.capturedAt || 0);
}

function compareCaptureDateDesc(a, b) {
    return Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0);
}

async function readJsonBody(request) {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) {
            throw new Error('Request body too large.');
        }
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
}

function sendFile(response, request, filePath, contentType, allowedOrigins) {
    if (!fs.existsSync(filePath)) {
        sendJson(response, request, 404, {ok: false, error: 'Not found.'}, allowedOrigins);
        return;
    }
    writeHeaders(response, request, 200, contentType, allowedOrigins, {'Cache-Control': 'no-store'});
    fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, request, status, data, allowedOrigins) {
    writeHeaders(response, request, status, 'application/json; charset=utf-8', allowedOrigins, {
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(data));
}

function sendHtml(response, request, status, html, allowedOrigins) {
    writeHeaders(response, request, status, 'text/html; charset=utf-8', allowedOrigins, {
        'Cache-Control': 'no-store'
    });
    response.end(html);
}

function sendOptions(response, request, allowedOrigins) {
    writeHeaders(response, request, 204, 'text/plain; charset=utf-8', allowedOrigins, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
    });
    response.end();
}

function redirect(response, location) {
    response.writeHead(302, {Location: location});
    response.end();
}

function writeHeaders(response, request, status, contentType, allowedOrigins, extra = {}) {
    const headers = {
        'Content-Type': contentType,
        ...extra
    };
    const origin = request.headers.origin;
    if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
    }
    response.writeHead(status, headers);
}

function buildAllowedOrigins(origins) {
    const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
    const configured = Array.isArray(origins)
        ? origins
        : String(process.env.GOONKEMON_ALLOWED_ORIGINS || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
    configured.forEach(origin => allowed.add(origin));
    return allowed;
}

function htmlPage(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
body {
    margin: 0;
    min-height: 100vh;
    background: #111;
    color: #d6d6d6;
    font: 14px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
main {
    width: min(1180px, calc(100vw - 24px));
    margin: 16px auto;
}
h1 {
    margin: 0 0 12px;
    color: #fff;
    font-size: 20px;
}
a { color: #55ffff; }
nav { margin-bottom: 10px; }
table {
    width: 100%;
    border-collapse: collapse;
    background: #050505;
}
th, td {
    padding: 6px 8px;
    border: 1px solid #333;
    text-align: left;
    vertical-align: top;
}
th {
    color: #aaa;
    background: #101010;
    font-weight: 400;
}
.points {
    color: #ffff55;
    text-align: right;
    white-space: nowrap;
}
.filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    align-items: end;
}
.filters label {
    display: grid;
    gap: 2px;
    color: #aaa;
}
.ranking-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}
.ranking-options label {
    display: flex;
    align-items: center;
    gap: 6px;
}
.ranking-options input[type="checkbox"] {
    width: 16px;
    height: 16px;
    margin: 0;
    padding: 0;
    accent-color: #55ffff;
}
input, button {
    color: #fff;
    background: #050505;
    border: 1px solid #555;
    font: inherit;
    padding: 4px 6px;
}
button { cursor: pointer; }
.summary, .empty {
    color: #aaa;
}
@media (max-width: 720px) {
    main { width: calc(100vw - 8px); margin: 4px auto; }
    table { font-size: 12px; }
    th, td { padding: 4px; }
}
</style>
</head>
<body>
<main>${body}</main>
<script>
document.querySelectorAll('[data-time]').forEach(element => {
    const raw = element.dataset.time || '';
    const date = new Date(raw);
    if (!Number.isNaN(date.valueOf())) {
        element.textContent = formatDateTime(date);
        element.title = raw;
    }
});

function formatDateTime(date) {
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    };
    try {
        return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch (error) {
        return date.toLocaleString();
    }
}
</script>
</body>
</html>`;
}

function formatMultiplier(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '1';
    }
    return String(Math.round(number * 100) / 100);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
