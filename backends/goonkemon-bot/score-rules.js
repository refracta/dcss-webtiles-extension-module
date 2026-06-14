export const SCORE_RULES = {
    hpDivisor: 50,
    hpBase: 1,
    willPerPip: 2,
    acPerPip: 2,
    evPerPip: 3,
    resistWeights: {
        rF: 3,
        rC: 3,
        rElec: 5
    },
    attackDivisor: 10,
    spellLevelMultiplier: 2,
    buffMultiplier: 1.5,
    debuffMultiplier: 0.9,
    friendlySummonedMultiplier: 1.5
};

export function scoreAnalysis(analysis = {}) {
    const title = analysis.title || 'Unknown';
    const inputStats = analysis.stats || {};
    const hp = statValue(inputStats.hp);
    const willPips = statValue(inputStats.will, 'pips');
    const acPips = statValue(inputStats.ac, 'pips');
    const evPips = statValue(inputStats.ev, 'pips');
    const resists = {
        rF: statValue(inputStats.resists?.rF),
        rC: statValue(inputStats.resists?.rC),
        rElec: statValue(inputStats.resists?.rElec)
    };
    const attacks = normalizeAttacks(inputStats.attacks);
    const speedPercent = statValue(inputStats.speed, 'percent', 100);
    const spells = normalizeSpells(analysis.spells);

    const hpScore = Math.floor(hp / SCORE_RULES.hpDivisor) + SCORE_RULES.hpBase;
    const willScore = willPips * SCORE_RULES.willPerPip;
    const acScore = acPips * SCORE_RULES.acPerPip;
    const evScore = evPips * SCORE_RULES.evPerPip;
    const resistScore = (
        resists.rF * SCORE_RULES.resistWeights.rF +
        resists.rC * SCORE_RULES.resistWeights.rC +
        resists.rElec * SCORE_RULES.resistWeights.rElec
    );
    const attackTotal = attacks.reduce((sum, attack) => sum + attack.damageTotal, 0);
    const attackScore = Math.floor(attackTotal / SCORE_RULES.attackDivisor);
    const baseStatScore = hpScore + willScore + acScore + evScore + resistScore + attackScore;
    const scaledStatScore = Math.floor(baseStatScore * speedPercent / 100);
    const spellScore = spells.reduce((sum, spell) => sum + spell.score, 0);
    const preStatusTotal = scaledStatScore + spellScore;
    const statusMultiplier = scoreStatusMultiplier(analysis.statuses);
    const total = Math.floor(preStatusTotal * statusMultiplier.total);

    const score = {
        total,
        title,
        baseStatScore,
        scaledStatScore,
        spellScore,
        preStatusTotal,
        statusMultiplier: statusMultiplier.total,
        statusMultiplierDetails: statusMultiplier,
        stats: {
            hp,
            hpRaw: statRaw(inputStats.hp),
            hpScore,
            will: statRaw(inputStats.will),
            willPips,
            willScore,
            ac: statRaw(inputStats.ac),
            acPips,
            acScore,
            ev: statRaw(inputStats.ev),
            evPips,
            evScore,
            resists,
            resistsRaw: {
                rF: statRaw(inputStats.resists?.rF),
                rC: statRaw(inputStats.resists?.rC),
                rElec: statRaw(inputStats.resists?.rElec)
            },
            resistScore,
            attackDetails: attacks,
            attacks: attacks.map(attack => attack.damageTotal),
            attackTotal,
            attackScore,
            speedPercent
        },
        spells,
        statuses: statusMultiplier.statuses,
        eligible: true
    };
    score.breakdown = buildScoreBreakdown(score);
    return score;
}

function scoreStatusMultiplier(statuses = {}) {
    const normalized = normalizeStatuses(statuses);
    const buffCount = normalized.buffs.length;
    const debuffCount = normalized.debuffs.length;
    const hasFriendly = normalized.attitude.some(status => status.name === 'FRIENDLY');
    const hasSummoned = normalized.special.some(status => status.name === 'SUMMONED');
    const friendlySummoned = hasFriendly && hasSummoned;
    const buff = Math.pow(SCORE_RULES.buffMultiplier, buffCount);
    const debuff = Math.pow(SCORE_RULES.debuffMultiplier, debuffCount);
    const friendlySummonedBonus = friendlySummoned ? SCORE_RULES.friendlySummonedMultiplier : 1;

    return {
        total: buff * debuff * friendlySummonedBonus,
        buff,
        debuff,
        friendlySummonedBonus,
        buffCount,
        debuffCount,
        friendlySummoned,
        statuses: normalized
    };
}

function normalizeStatuses(statuses = {}) {
    return {
        buffs: normalizeStatusItems(statuses.buffs),
        debuffs: normalizeStatusItems(statuses.debuffs),
        attitude: normalizeStatusItems(statuses.attitude),
        special: normalizeStatusItems(statuses.special),
        unknown: normalizeStatusItems(statuses.unknown)
    };
}

function normalizeStatusItems(items) {
    return (Array.isArray(items) ? items : []).map(item => ({
        name: String(item?.name || ''),
        label: String(item?.label || item?.name || '').trim(),
        source: String(item?.source || '')
    })).filter(item => item.name);
}

export function renderScoreHtml(analysis) {
    const score = scoreAnalysis(analysis);
    return `<div class="score-grid">${renderScoreRows(score)}</div>${renderScoreDetails(score)}`;
}

function normalizeAttacks(attacks) {
    const items = Array.isArray(attacks?.items)
        ? attacks.items
        : Array.isArray(attacks)
            ? attacks
            : [];

    return items.map((attack, index) => ({
        name: attack.name || `Attack ${index + 1}`,
        damageText: attack.damageText || String(attack.damageTotal || 0),
        damageParts: Array.isArray(attack.damageParts)
            ? attack.damageParts.map(Number).filter(Number.isFinite)
            : [],
        damageTotal: Number(attack.damageTotal || 0),
        afterHit: attack.afterHit || ''
    }));
}

function normalizeSpells(spells) {
    return (Array.isArray(spells) ? spells : []).map(spell => {
        const level = Number(spell.level || 0);
        return {
            title: spell.title || 'Unknown spell',
            level,
            effect: spell.effect || '',
            range: spell.range || '',
            schools: spell.schools || '',
            score: level * SCORE_RULES.spellLevelMultiplier
        };
    });
}

function buildScoreBreakdown(score) {
    const stats = score.stats || {};
    const resists = stats.resists || {};
    const baseComponents = [
        {
            label: 'Max HP',
            source: formatParsed(stats.hpRaw, stats.hp),
            calculation: `floor(${Number(stats.hp || 0)} / ${SCORE_RULES.hpDivisor}) + ${SCORE_RULES.hpBase}`,
            points: Number(stats.hpScore || 0)
        },
        {
            label: 'Will',
            source: formatParsed(stats.will, stats.willPips),
            calculation: `${Number(stats.willPips || 0)} * ${SCORE_RULES.willPerPip}`,
            points: Number(stats.willScore || 0)
        },
        {
            label: 'AC',
            source: formatParsed(stats.ac, stats.acPips),
            calculation: `${Number(stats.acPips || 0)} * ${SCORE_RULES.acPerPip}`,
            points: Number(stats.acScore || 0)
        },
        {
            label: 'EV',
            source: formatParsed(stats.ev, stats.evPips),
            calculation: `${Number(stats.evPips || 0)} * ${SCORE_RULES.evPerPip}`,
            points: Number(stats.evScore || 0)
        },
        {
            label: 'Resists',
            source: [
                `rF ${formatParsed(stats.resistsRaw?.rF, Number(resists.rF || 0))}`,
                `rC ${formatParsed(stats.resistsRaw?.rC, Number(resists.rC || 0))}`,
                `rElec ${formatParsed(stats.resistsRaw?.rElec, Number(resists.rElec || 0))}`
            ].join(', '),
            calculation: `${Number(resists.rF || 0)} * ${SCORE_RULES.resistWeights.rF} + ` +
                `${Number(resists.rC || 0)} * ${SCORE_RULES.resistWeights.rC} + ` +
                `${Number(resists.rElec || 0)} * ${SCORE_RULES.resistWeights.rElec}`,
            points: Number(stats.resistScore || 0)
        },
        {
            label: 'Attacks',
            source: formatAttackSource(stats.attackDetails || []),
            calculation: `floor(${Number(stats.attackTotal || 0)} / ${SCORE_RULES.attackDivisor})`,
            points: Number(stats.attackScore || 0)
        }
    ];
    const spellComponents = score.spells.map(spell => ({
        label: spell.title || 'Unknown spell',
        source: [
            Number.isFinite(Number(spell.level)) ? `L${Number(spell.level)}` : '',
            spell.effect || '',
            spell.range || '',
            spell.schools || ''
        ].filter(Boolean).join(' '),
        calculation: `${Number(spell.level || 0)} * ${SCORE_RULES.spellLevelMultiplier}`,
        points: Number(spell.score || 0)
    }));

    return {
        stats: {
            calculation: `floor(Base stats ${Number(score.baseStatScore || 0)} * Speed ${Number(stats.speedPercent || 100)}%)`,
            points: Number(score.scaledStatScore || 0)
        },
        preStatusTotal: {
            calculation: `Stats ${Number(score.scaledStatScore || 0)} + Spells ${Number(score.spellScore || 0)}`,
            points: Number(score.preStatusTotal || 0)
        },
        statusMultiplier: {
            calculation: formatStatusMultiplierCalculation(score.statusMultiplierDetails),
            points: formatMultiplier(score.statusMultiplier || 1),
            components: buildStatusMultiplierComponents(score.statusMultiplierDetails)
        },
        total: {
            calculation: `floor(Base total ${Number(score.preStatusTotal || 0)} * Status ${formatMultiplier(score.statusMultiplier || 1)})`,
            points: Number(score.total || 0)
        },
        baseStats: {
            calculation: baseComponents.map(row => row.points).join(' + '),
            points: Number(score.baseStatScore || 0),
            components: baseComponents
        },
        spells: {
            calculation: spellComponents.length ? spellComponents.map(row => row.points).join(' + ') : '0',
            points: Number(score.spellScore || 0),
            components: spellComponents
        }
    };
}

function buildStatusMultiplierComponents(details = {}) {
    const statuses = details.statuses || {};
    return [
        {
            label: 'Buffs',
            source: formatStatusSource(statuses.buffs),
            calculation: `${SCORE_RULES.buffMultiplier} ^ ${Number(details.buffCount || 0)}`,
            points: formatMultiplier(details.buff ?? 1)
        },
        {
            label: 'Debuffs',
            source: formatStatusSource(statuses.debuffs),
            calculation: `${SCORE_RULES.debuffMultiplier} ^ ${Number(details.debuffCount || 0)}`,
            points: formatMultiplier(details.debuff ?? 1)
        },
        {
            label: 'Friendly summoned',
            source: details.friendlySummoned ? 'FRIENDLY + SUMMONED' : 'not both present',
            calculation: details.friendlySummoned
                ? `${SCORE_RULES.friendlySummonedMultiplier}`
                : '1',
            points: formatMultiplier(details.friendlySummonedBonus ?? 1)
        }
    ];
}

function formatStatusMultiplierCalculation(details = {}) {
    return `Buffs ${formatMultiplier(details.buff ?? 1)} * ` +
        `Debuffs ${formatMultiplier(details.debuff ?? 1)} * ` +
        `Friendly summoned ${formatMultiplier(details.friendlySummonedBonus ?? 1)}`;
}

function renderScoreRows(score) {
    const rows = [
        ['Total', score.total],
        ['Base total', score.preStatusTotal],
        ['Status', formatMultiplier(score.statusMultiplier)],
        ['Stats', score.scaledStatScore],
        ['Spells', score.spellScore],
        ['Base stats', score.baseStatScore],
        ['Speed', `${score.stats.speedPercent}%`],
        ['Attacks', score.stats.attackTotal]
    ];

    return rows.map(([label, value]) =>
        `<div class="score-cell"><div class="score-label">${escapeHtml(label)}</div><div class="score-value">${escapeHtml(value)}</div></div>`
    ).join('');
}

function renderScoreDetails(score) {
    const breakdown = score.breakdown || buildScoreBreakdown(score);
    const baseRows = renderScoreTableRows(breakdown.baseStats.components);
    const spellRows = breakdown.spells.components.length
        ? renderScoreTableRows(breakdown.spells.components)
        : `<tr><td colspan="4" class="score-empty">No spells scored.</td></tr>`;
    const statusRows = renderScoreTableRows(breakdown.statusMultiplier.components);

    return `<div class="score-detail">
<div class="score-equations">
<div class="score-equation"><strong>Stats</strong> = ${escapeHtml(breakdown.stats.calculation)} = ${escapeHtml(breakdown.stats.points)}</div>
<div class="score-equation"><strong>Base total</strong> = ${escapeHtml(breakdown.preStatusTotal.calculation)} = ${escapeHtml(breakdown.preStatusTotal.points)}</div>
<div class="score-equation"><strong>Status</strong> = ${escapeHtml(breakdown.statusMultiplier.calculation)} = ${escapeHtml(breakdown.statusMultiplier.points)}</div>
<div class="score-equation"><strong>Total</strong> = ${escapeHtml(breakdown.total.calculation)} = ${escapeHtml(breakdown.total.points)}</div>
</div>
<div>
<div class="score-subtitle">Base stats</div>
<table class="score-table">
<thead><tr><th>Item</th><th>Source</th><th>Calculation</th><th class="score-points">Pts</th></tr></thead>
<tbody>${baseRows}</tbody>
</table>
</div>
<div>
<div class="score-subtitle">Status multiplier</div>
<table class="score-table">
<thead><tr><th>Item</th><th>Source</th><th>Calculation</th><th class="score-points">Mult</th></tr></thead>
<tbody>${statusRows}</tbody>
</table>
</div>
<div>
<div class="score-subtitle">Spells</div>
<table class="score-table">
<thead><tr><th>Spell</th><th>Source</th><th>Calculation</th><th class="score-points">Pts</th></tr></thead>
<tbody>${spellRows}</tbody>
</table>
</div>
</div>`;
}

function formatStatusSource(items) {
    if (!Array.isArray(items) || !items.length) {
        return 'none';
    }

    return items.map(item => item.label || item.name).join(', ');
}

function formatMultiplier(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '1x';
    }
    const rounded = Math.round(number * 10000) / 10000;
    return `${rounded}x`;
}

function renderScoreTableRows(rows) {
    return rows.map(row => `<tr>
<td>${escapeHtml(row.label)}</td>
<td>${escapeHtml(row.source)}</td>
<td>${escapeHtml(row.calculation)}</td>
<td class="score-points">${escapeHtml(row.points)}</td>
</tr>`).join('');
}

function formatParsed(raw, value) {
    const text = String(raw || '').trim();
    if (!text) {
        return String(value);
    }
    return text === String(value) ? text : `${text} => ${value}`;
}

function formatAttackSource(attackDetails) {
    if (!attackDetails.length) {
        return 'none';
    }

    return attackDetails.map(attack => {
        const totalSuffix = Number(attack.damageTotal || 0) &&
            String(attack.damageText || '') !== String(attack.damageTotal)
            ? ` = ${attack.damageTotal}`
            : '';
        const afterHit = attack.afterHit ? ` [${attack.afterHit}]` : '';
        return `${attack.name} ${attack.damageText}${totalSuffix}${afterHit}`;
    }).join('; ');
}

function statValue(stat, key = 'value', fallback = 0) {
    if (stat && typeof stat === 'object') {
        const value = Number(stat[key]);
        return Number.isFinite(value) ? value : fallback;
    }
    const value = Number(stat);
    return Number.isFinite(value) ? value : fallback;
}

function statRaw(stat) {
    if (stat && typeof stat === 'object') {
        return String(stat.raw ?? '');
    }
    return String(stat ?? '');
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
