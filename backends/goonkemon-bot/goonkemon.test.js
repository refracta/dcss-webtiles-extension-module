import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    analyzeGoonkemonMonster,
    assertNotExploreMode,
    captureDetailUrl,
    findMonsterDescription,
    formatSuccessMessage,
    GoonkemonBot,
    isExploreModeCapture,
    isGotchaTrigger,
    parseMonsterStatuses,
    parseWebtilesChat,
    renderMonsterHtml,
    scoreGoonkemon
} from './goonkemon.js';
import {renderScoreHtml, scoreAnalysis} from './score-rules.js';

test('gotcha trigger is exact and case-insensitive', () => {
    assert.equal(isGotchaTrigger('gotcha!'), true);
    assert.equal(isGotchaTrigger(' GOTCHA! '), true);
    assert.equal(isGotchaTrigger('gotcha'), false);
});

test('parses webtiles chat html', () => {
    assert.deepEqual(parseWebtilesChat(
        '<span class="chat_sender">labter:</span> <span class="chat_msg">gotcha!</span>'
    ), {
        sender: 'labter',
        message: 'gotcha!'
    });
});

test('formats public capture announcement with detail url', () => {
    const url = captureDetailUrl('https://goonkemon.nemelex.cards/', '20260614T021841Z-wizardmodephilia-Dionkal');

    assert.equal(url, 'https://goonkemon.nemelex.cards/20260614T021841Z-wizardmodephilia-Dionkal');
    assert.equal(
        formatSuccessMessage({title: 'Dionkal.', total: 68}, url),
        'Dionkal (68 pts) - https://goonkemon.nemelex.cards/20260614T021841Z-wizardmodephilia-Dionkal'
    );
});

test('saveCapture removes dots from the lord name id component', async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goonkemon-id-'));
    const bot = new GoonkemonBot({storageDir});
    bot.captureImageBundle = async (id, capture, json) => ({
        id,
        capturedAt: json.capturedAt,
        sourceJson: `${id}.json`,
        images: {}
    });
    const monster = {
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Dionkal.',
        body: 'One of the many lords of Pandemonium.\nMax HP: 200 Will: + AC: + EV: + rF: ... rC: ... rElec: .',
        spellset: []
    };
    const analysis = analyzeGoonkemonMonster(monster);

    try {
        const saved = await bot.saveCapture('wizardmodephilia', {
            monster,
            messageTypes: {},
            recentMessages: [],
            playerState: {},
            webtiles: {},
            exploreModeEvidence: [],
            uiMessages: []
        }, analysis);

        assert.match(saved.id, /-wizardmodephilia-Dionkal$/);
        assert.match(path.basename(saved.jsonPath), /-Dionkal\.json$/);
        assert.doesNotMatch(path.basename(saved.jsonPath), /Dionkal\.\.json$/);
    } finally {
        fs.rmSync(storageDir, {recursive: true, force: true});
    }
});

test('normalizes describe-monster items restored from ui-stack', () => {
    const monster = findMonsterDescription({
        msg: 'ui-stack',
        items: [{
            msg: 'ui-push',
            type: 'describe-monster',
            title: 'Dionkal.',
            body: 'One of the many lords of Pandemonium.\nMax HP: 200 Will: + AC: + EV: + rF: ... rC: ... rElec: .',
            spellset: []
        }, {
            msg: 'ui-state',
            type: 'describe-monster',
            pane: 2
        }]
    });

    assert.equal(monster.msg, 'ui-push');
    assert.equal(monster.type, 'describe-monster');
    assert.equal(analyzeGoonkemonMonster(monster).title, 'Dionkal.');
});

test('ignores shallow describe-monster ui-state messages', () => {
    const monster = findMonsterDescription({
        msg: 'ui-stack',
        items: [{
            msg: 'ui-state',
            type: 'describe-monster',
            pane: 2
        }]
    });

    assert.equal(monster, null);
});

test('scores a random pandemonium lord from x-v monster data', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Fech the pandemonium lord',
        body: `
<lightgrey>Max HP: ~287    </lightgrey><lightgrey> Will: ++       </lightgrey><lightgrey> AC: ++++      </lightgrey><lightgrey> EV: ++        </lightgrey>
<lightgrey>    rF: +..     </lightgrey><lightgrey>   rC: ++.      </lightgrey><lightgrey>rElec: +        </lightgrey>
Speed: 130% (normally travels faster than you)

Attacks  Max Damage
Hit      67
Bite     45
`,
        spellset: [{
            spells: [
                {title: 'Plasma Beam', level: 6},
                {title: 'Fire Storm', level: 9},
                {title: 'Haste', level: 6}
            ]
        }]
    });

    assert.equal(score.baseStatScore, 49);
    assert.equal(score.scaledStatScore, 63);
    assert.equal(score.spellScore, 42);
    assert.equal(score.total, 105);
});

test('scores composite branded attack damage', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Cerebov',
        body: `
Max HP: 100 Will: + AC: + EV: + rF: ... rC: ... rElec: .

Attack              Max Damage
Hit: flaming touch  43 + 32 (flame)
`,
        spellset: []
    });

    assert.deepEqual(score.stats.attacks, [75]);
    assert.equal(score.stats.attackTotal, 75);
    assert.equal(score.stats.attackScore, 7);
    assert.match(score.breakdown.baseStats.components.at(-1).source, /43 \+ 32 \(flame\) = 75/);
});

test('scores attack tables that include after-hit effects', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Mnoleg',
        body: `
Max HP: 300 Will: + AC: + EV: + rF: ... rC: ... rElec: .

Attacks  Max Damage  After Damaging Hits
Hit      47          Chaos
Hit      41
Hit      37          Blink self
`,
        spellset: []
    });

    assert.deepEqual(score.stats.attacks, [47, 41, 37]);
    assert.equal(score.stats.attackTotal, 125);
    assert.equal(score.stats.attackScore, 12);
});

test('scores singular attack tables that include after-hit effects', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Lom Lobon',
        body: `
Max HP: 300 Will: + AC: + EV: + rF: ... rC: ... rElec: .

Attack  Max Damage  After Damaging Hits
Hit     40          Drain magic
`,
        spellset: []
    });

    assert.deepEqual(score.stats.attacks, [40]);
    assert.equal(score.stats.attackTotal, 40);
    assert.equal(score.stats.attackScore, 4);
});

test('renders html shell that fetches json and imports score rules', () => {
    const monster = {
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Lom Lobon',
        body: `
Max HP: 250 Will: +++ AC: ++ EV: ++ rF: +.. rC: ... rElec: +
Speed: 150% (normally travels faster than you)

Attack  Max Damage
Hit     50
`,
        spellset: [{
            spells: [
                {title: 'Fire Storm', level: 9},
                {title: 'Blinkbolt', level: 5}
            ]
        }]
    };
    const html = renderMonsterHtml({
        id: 'capture-id',
        analysis: analyzeGoonkemonMonster(monster),
        monster,
        username: 'tester',
        capturedAt: '2026-06-13T00:00:00.000Z',
        webtiles: {
            versionText: 'Dungeon Crawl Stone Soup 0.35-a0-test'
        }
    }, 'capture-id.json', 'capture-id.images.json');

    assert.match(html, /fetchJson\(jsonPath\)/);
    assert.match(html, /import \{renderScoreHtml, scoreAnalysis\} from '\.\/score-rules\.js'/);
    assert.match(html, /data-json="capture-id\.json"/);
    assert.match(html, /data-images="capture-id\.images\.json"/);
    assert.match(html, /data-score-badge/);
    assert.match(html, /fetchJson\(imagePath\)/);
    assert.match(html, /data-captured-at="2026-06-13T00:00:00.000Z"/);
    assert.match(html, /Dungeon Crawl Stone Soup 0.35-a0-test/);
    assert.match(html, /formatCaptureTimes\(\)/);
    assert.doesNotMatch(html, /Tile id:/);
    assert.doesNotMatch(html, /id="goonkemon-capture"/);
    assert.doesNotMatch(html, /<div class="score-subtitle">Base stats<\/div>/);
});

test('score rules render detailed score breakdown from analysis', () => {
    const analysis = analyzeGoonkemonMonster({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Lom Lobon',
        body: `
Max HP: 250 Will: +++ AC: ++ EV: ++ rF: +.. rC: ... rElec: +
Speed: 150% (normally travels faster than you)

Attack  Max Damage
Hit     50
`,
        spellset: [{
            spells: [
                {title: 'Fire Storm', level: 9},
                {title: 'Blinkbolt', level: 5}
            ]
        }]
    });
    const html = renderScoreHtml(analysis);

    assert.equal(analysis.stats.will.raw, '+++');
    assert.equal(analysis.stats.will.pips, 3);
    assert.match(html, /<div class="score-subtitle">Base stats<\/div>/);
    assert.match(html, /<div class="score-subtitle">Status multiplier<\/div>/);
    assert.match(html, /floor\(Base stats \d+ \* Speed 150%\)/);
    assert.match(html, /floor\(Base total \d+ \* Status 1x\)/);
    assert.match(html, /250 =&gt; 250|250/);
    assert.match(html, /\+\+\+ =&gt; 3/);
    assert.match(html, /Fire Storm/);
    assert.match(html, /9 \* 2/);
});

test('applies buff, debuff, and friendly summoned score multipliers', () => {
    const analysis = analyzeGoonkemonMonster({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Bufflord the pandemonium lord',
        body: `
Max HP: 250 Will: + AC: + EV: + rF: ... rC: ... rElec: .

Attack  Max Damage
Hit     30
`,
        icons: [10463, 10464, 10500, 10501],
        flag: [0x00010000, 0]
    }, {
        iconNameById: {
            10463: 'HASTED',
            10464: 'MIGHT',
            10500: 'SLOWED',
            10501: 'SUMMONED'
        }
    });
    const score = scoreAnalysis(analysis);
    const expectedMultiplier = Math.pow(1.5, 2) * 0.9 * 1.5;

    assert.equal(score.statusMultiplierDetails.buffCount, 2);
    assert.equal(score.statusMultiplierDetails.debuffCount, 1);
    assert.equal(score.statusMultiplierDetails.friendlySummoned, true);
    assert.equal(score.statusMultiplier, expectedMultiplier);
    assert.equal(score.total, Math.floor(score.preStatusTotal * expectedMultiplier));

    const html = renderScoreHtml(analysis);
    assert.match(html, /Buffs/);
    assert.match(html, /1\.5 \^ 2/);
    assert.match(html, /0\.9 \^ 1/);
    assert.match(html, /FRIENDLY \+ SUMMONED/);
});

test('parses tile status icons and foreground flags', () => {
    const statuses = parseMonsterStatuses({
        icons: [10463, 10464, 10500],
        flag: [0x00400000 | 0x00010000, 0x08000000]
    }, {
        10463: 'HASTED',
        10464: 'MIGHT',
        10500: 'RESISTANCE'
    });

    assert.deepEqual(statuses.buffs.map(status => status.name), ['HASTED', 'MIGHT', 'RESISTANCE']);
    assert.deepEqual(statuses.attitude.map(status => status.name), ['FRIENDLY']);
    assert.deepEqual(statuses.debuffs.map(status => status.name), ['PARALYSED', 'POISON']);
    assert.equal(statuses.rawIcons.length, 3);
});

test('analysis includes structured status data', () => {
    const analysis = analyzeGoonkemonMonster({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Bufflord the pandemonium lord',
        body: 'Max HP: 250 Will: + AC: + EV: + rF: ... rC: ... rElec: .\n\nAttack  Max Damage\nHit     30\n',
        icons: [10463],
        flag: [0, 0]
    }, {
        iconNameById: {
            10463: 'HASTED'
        }
    });

    assert.equal(analysis.statuses.buffs[0].name, 'HASTED');
    assert.deepEqual(analysis.statuses.debuffs, []);
});

test('classifies every generated monster status icon name', () => {
    const sourceBackedStatusNames = `
BERSERK IDEALISED TOUCH_OF_BEOGH SHADOWLESS SUMMONED MINION UNREWARDING
TESSERACT_SPAWN ANIMATED_WEAPON VENGEANCE_TARGET VAMPIRE_THRALL ENKINDLED_1
ENKINDLED_2 NOBODY_MEMORY_1 NOBODY_MEMORY_2 NOBODY_MEMORY_3 PYRRHIC FRENZIED
DRAIN MIGHT SWIFT DAZED HASTED SLOWED CORRODED INFESTED WEAKENED PETRIFIED
PETRIFYING BOUND_SOUL POSSESSABLE PARTIALLY_CHARGED FULLY_CHARGED VITRIFIED
CONFUSED SENTINEL_MARK DIMMED GLOWING LACED_WITH_CHAOS CONC_VENOM FIRE_CHAMP
INNER_FLAME PAIN_MIRROR STICKY_FLAME STRONG_WILLED ANGUISH FIRE_VULN
RESISTANCE GHOSTLY MALMUTATED MAGNETISED RECALL TELEPORTING FIGMENT BLIND
BRILLIANCE SLOWLY_DYING WATERLOGGED STILL_WINDS ANTIMAGIC DEFLECT_MISSILES
INJURY_BOND GLOW_LIGHT GLOW_HEAVY BULLSEYE CURSE_OF_AGONY REGENERATION
RETREAT RIMEBLIGHT UNDYING_ARMS BIND SIGN_OF_RUIN WEAK_WILLED DOUBLED_VIGOUR
KINETIC_GRAPNEL TEMPERED HEART UNSTABLE VEXED PARADOX WARDING SUNDERING
EXPOSED CONSTRICTED VILE_CLUTCH PAIN_BOND MUTE STAMPEDE
`.trim().split(/\s+/);
    const iconNameById = Object.fromEntries(sourceBackedStatusNames.map((name, index) => [10000 + index, name]));
    const statuses = parseMonsterStatuses({
        icons: Object.keys(iconNameById).map(Number),
        flag: [0x00030000 | 0x00400000 | 0x00800000 | 0x01000000, 0x18000000]
    }, iconNameById);

    assert.deepEqual(statuses.unknown, []);
    assert.ok(statuses.buffs.some(status => status.name === 'ENKINDLED_1'));
    assert.ok(statuses.debuffs.some(status => status.name === 'SENTINEL_MARK'));
    assert.ok(statuses.attitude.some(status => status.name === 'NEUTRAL'));
});

test('accepts named pandemonium lords', () => {
    for (const title of ['Cerebov', 'Lom Lobon', 'Gloorx Vloq', 'Ereshkigal', 'Mnoleg']) {
        const score = scoreGoonkemon({
            msg: 'ui-push',
            type: 'describe-monster',
            title,
            body: 'Max HP: ~350 Will: ++++ AC: +++ EV: +++ rF: +.. rC: +.. rElec: .\n\nAttack  Max Damage\nHit     50\n',
            spellset: []
        });

        assert.equal(score.title, title);
        assert.equal(score.eligible, true);
    }
});

test('accepts random pandemonium lords whose title is only a name', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Ubbyrowk.',
        body: `
A terrifying demon lord of Pandemonium.

Max HP: ~260 Will: ++ AC: +++ EV: ++ rF: +.. rC: +.. rElec: .

Attack  Max Damage
Hit     42
`,
        spellset: []
    });

    assert.equal(score.title, 'Ubbyrowk.');
    assert.equal(score.eligible, true);
});

test('accepts infinite resistance glyphs from crawl markup', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Cerebov',
        body: 'Max HP: ~650 Will: \u221e AC: ++++ EV: ++ rF: \u221e rC: ... rElec: \u221e\n\nAttack  Max Damage\nHit     70\n',
        spellset: []
    });

    assert.equal(score.stats.willPips, 5);
    assert.equal(score.stats.resists.rF, 6);
    assert.equal(score.stats.resists.rElec, 2);
    assert.equal(score.stats.resistScore, 28);
});

test('subtracts vulnerable resistance pips', () => {
    const score = scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Mnoleg',
        body: 'Max HP: 300 Will: + AC: + EV: + rF: x.. rC: -.. rElec: .\n\nAttack  Max Damage\nHit     40\n',
        spellset: []
    });

    assert.equal(score.stats.resists.rF, -1);
    assert.equal(score.stats.resists.rC, -1);
    assert.equal(score.stats.resistScore, -6);
});

test('rejects non-pandemonium monsters', () => {
    assert.throws(() => scoreGoonkemon({
        msg: 'ui-push',
        type: 'describe-monster',
        title: 'Arachne the Outcast',
        body: 'Max HP: ~204',
        spellset: []
    }), /not an eligible lord/);
});

test('detects explore-mode captures from player state', () => {
    assert.equal(isExploreModeCapture({playerState: {explore: 1}}), true);
    assert.equal(isExploreModeCapture({exploreMode: true}), true);
    assert.equal(isExploreModeCapture({playerState: {explore: 0}}), false);
});

test('rejects explore-mode captures before saving', () => {
    assert.throws(() => assertNotExploreMode({
        playerState: {explore: 1},
        exploreModeEvidence: ['player.explore flag']
    }), /Explore mode captures are not allowed\. Evidence: player\.explore flag\./);

    assert.doesNotThrow(() => assertNotExploreMode({playerState: {explore: 0}}));
});
