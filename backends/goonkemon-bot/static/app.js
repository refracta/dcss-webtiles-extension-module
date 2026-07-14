import {scoreAnalysis} from './score-rules.js';

const appRoot = document.getElementById('goonkemon-app');
const siteRoot = new URL('./', import.meta.url);

installNavigation();
renderApp();

async function renderApp() {
    try {
        const response = await fetch(new URL('data/captures.json', siteRoot), {cache: 'no-store'});
        if (!response.ok) {
            throw new Error(`Could not load captures: ${response.status}`);
        }
        const payload = await response.json();
        const captures = Array.isArray(payload.captures) ? payload.captures : [];
        if (document.body.dataset.view === 'list') {
            renderList(captures);
        } else {
            renderRanking(captures);
        }
    } catch (error) {
        appRoot.innerHTML = `<p class="error" role="alert">${escapeHtml(error.message || error)}</p>`;
    }
}

function installNavigation() {
    document.querySelectorAll('[data-route]').forEach(link => {
        const route = String(link.dataset.route || '').replace(/^\/+|\/+$/g, '');
        link.href = new URL(route ? `${route}/` : './', siteRoot).href;
    });
}

function renderRanking(captures) {
    const params = new URLSearchParams(window.location.search);
    const bestPerSubmitter = params.get('best') === '1';
    const allRanked = captures
        .map(capture => ({capture, score: safeScore(capture)}))
        .filter(item => item.score)
        .sort(compareRankedCaptures);
    const ranked = bestPerSubmitter
        ? selectBestCapturePerSubmitter(allRanked)
        : allRanked;
    const rows = ranked.map((item, index) => renderRankingRow(item, index)).join('');

    appRoot.innerHTML = `
<form method="get" action="${escapeAttribute(window.location.pathname)}" class="ranking-options">
    <label><input type="checkbox" name="best" value="1"${bestPerSubmitter ? ' checked' : ''}> Best submission per participant only</label>
    <button type="submit">Apply</button>
</form>
<div class="summary">${ranked.length} / ${allRanked.length} ranked captures</div>
<div class="table-scroll">
    <table class="ranking-table">
        <thead><tr><th>#</th><th>Lord</th><th>Score</th><th>Submitter</th><th>Captured</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">No ranked captures.</td></tr>'}</tbody>
    </table>
</div>`;
}

function renderList(captures) {
    const params = new URLSearchParams(window.location.search);
    const filters = {
        q: String(params.get('q') || '').trim(),
        username: String(params.get('username') || '').trim(),
        lord: String(params.get('lord') || '').trim(),
        spell: String(params.get('spell') || '').trim(),
        stat: String(params.get('stat') || '').trim()
    };
    const filtered = captures
        .filter(capture => matchesFilters(capture, filters))
        .sort((a, b) => compareCaptureDate(b, a));
    const rows = filtered.map(renderListRow).join('');

    appRoot.innerHTML = `
<form method="get" action="${escapeAttribute(window.location.pathname)}" class="filters">
    ${renderFilterInput('q', 'Search', filters.q)}
    ${renderFilterInput('username', 'Submitter', filters.username)}
    ${renderFilterInput('lord', 'Lord', filters.lord)}
    ${renderFilterInput('spell', 'Spell', filters.spell)}
    ${renderFilterInput('stat', 'Stat', filters.stat)}
    <button type="submit">Filter</button>
</form>
<div class="summary">${filtered.length} / ${captures.length} captures</div>
<div class="table-scroll">
    <table class="capture-table">
        <thead><tr><th>Lord</th><th>Score</th><th>Submitter</th><th>Captured</th><th>Spells</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">No captures found.</td></tr>'}</tbody>
    </table>
</div>`;
}

function renderFilterInput(name, label, value) {
    return `<label for="filter-${name}">${escapeHtml(label)}<input id="filter-${name}" name="${name}" value="${escapeAttribute(value)}"></label>`;
}

function renderRankingRow({capture, score}, index) {
    const statuses = score.statusMultiplierDetails || {};
    const statusText = `x${formatMultiplier(score.statusMultiplier)} ` +
        `(${statuses.buffCount || 0} buffs, ${statuses.debuffCount || 0} debuffs` +
        `${statuses.friendlySummoned ? ', friendly summoned' : ''})`;
    return `<tr>
<td>${index + 1}</td>
<td><a href="${escapeAttribute(detailUrl(capture.id))}">${escapeHtml(score.title || capture.id)}</a></td>
<td class="points">${escapeHtml(score.total)}</td>
<td>${escapeHtml(capture.username || '')}</td>
<td>${renderTime(capture.capturedAt)}</td>
<td>${escapeHtml(statusText)}</td>
</tr>`;
}

function renderListRow(capture) {
    const score = safeScore(capture);
    const analysis = capture.analysis || {};
    const spells = (analysis.spells || [])
        .map(spell => spell.title)
        .filter(Boolean)
        .slice(0, 5)
        .join(', ');
    return `<tr>
<td><a href="${escapeAttribute(detailUrl(capture.id))}">${escapeHtml(analysis.title || capture.id)}</a></td>
<td class="points">${score ? escapeHtml(score.total) : '-'}</td>
<td>${escapeHtml(capture.username || '')}</td>
<td>${renderTime(capture.capturedAt)}</td>
<td>${escapeHtml(spells || 'none')}</td>
</tr>`;
}

function safeScore(capture) {
    try {
        return scoreAnalysis(capture.analysis || {});
    } catch (error) {
        return null;
    }
}

function compareRankedCaptures(a, b) {
    if (b.score.total !== a.score.total) {
        return b.score.total - a.score.total;
    }
    const dateOrder = compareCaptureDate(a.capture, b.capture);
    return dateOrder || String(a.capture.id || '').localeCompare(String(b.capture.id || ''));
}

function compareCaptureDate(a, b) {
    return dateValue(a?.capturedAt) - dateValue(b?.capturedAt);
}

function dateValue(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function selectBestCapturePerSubmitter(ranked) {
    const seen = new Set();
    return ranked.filter(item => {
        const username = normalize(item.capture?.username);
        const key = username || `\u0000${item.capture?.id || ''}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function matchesFilters(capture, filters) {
    const analysis = capture.analysis || {};
    const username = normalize(capture.username);
    const title = normalize(analysis.title);
    const spells = normalize((analysis.spells || []).map(spell => [
        spell.title,
        spell.schools,
        spell.effect,
        spell.range
    ].filter(Boolean).join(' ')).join(' '));
    const stats = normalize(JSON.stringify(analysis.stats || {}));
    const haystack = normalize(JSON.stringify({
        username: capture.username,
        title: analysis.title,
        stats: analysis.stats,
        spells: analysis.spells,
        statuses: analysis.statuses
    }));

    return (!filters.username || username.includes(normalize(filters.username))) &&
        (!filters.lord || title.includes(normalize(filters.lord))) &&
        (!filters.spell || spells.includes(normalize(filters.spell))) &&
        (!filters.stat || stats.includes(normalize(filters.stat))) &&
        (!filters.q || haystack.includes(normalize(filters.q)));
}

function detailUrl(id) {
    return new URL(`${encodeURIComponent(id)}/`, siteRoot).href;
}

function renderTime(value) {
    const raw = String(value || '');
    const date = new Date(raw);
    const label = Number.isNaN(date.valueOf()) ? raw : formatDateTime(date);
    return `<time datetime="${escapeAttribute(raw)}" title="${escapeAttribute(raw)}">${escapeHtml(label)}</time>`;
}

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

function formatMultiplier(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '1';
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
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
