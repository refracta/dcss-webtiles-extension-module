import assert from 'node:assert/strict';
import test from 'node:test';

import MapPredictor, {
    isSprintCandidateScope,
    selectSafeTemplates,
    templateSelectionPlayer
} from '../runtime.js';
import {parseDes} from '../des-parser.js';
import {MapMatcher} from '../matcher.js';
import SourceRepository from '../source-repository.js';
import {
    sanitizeAuditedSprintSource,
    selectAuditedSprintCatalog,
    sprintSourceSha256,
    SPRINT_ENTRY_SENTINEL,
    SPRINT_SOURCE_PATHS,
    SPRINT_TEMPLATE_NAMES
} from '../sprint-destinations.js';

function hookPoint() {
    const handlers = new Map();
    return {
        handlers,
        addHandler(id, handler) {
            handlers.set(id, handler);
        },
        removeHandler(id) {
            handlers.delete(id);
        },
        emit(...args) {
            for (const handler of handlers.values()) {
                handler(...args);
            }
        }
    };
}

class FakeAdapter {
    constructor() {
        this.predictions = [];
        this.revealEnabled = false;
    }

    install() {}

    setPredictions(predictions) {
        this.predictions = [...predictions];
    }

    clearPredictions() {
        this.predictions = [];
    }

    setRevealEnabled(value) {
        this.revealEnabled = Boolean(value);
        return this.revealEnabled;
    }

    toggleReveal() {
        return this.setRevealEnabled(!this.revealEnabled);
    }

    scheduleRender() {}

    destroy() {}
}

function fakeWindow(hash = '') {
    const listeners = new Map();
    return {
        location: {hash},
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) {
                listeners.delete(type);
            }
        },
        listeners
    };
}

function harness({hash = ''} = {}) {
    const messages = [];
    const commands = new Map();
    const sendBefore = hookPoint();
    const dwem = {
        Modules: {
            IOHook: {send_message: {before: sendBefore}},
            CommandManager: {
                addCommand(name, args, handler) {
                    commands.set(name, {args, handler});
                },
                sendChatMessage(message) {
                    messages.push(message);
                }
            }
        }
    };
    const repository = {
        cache: {close() {}},
        selectPaths() {
            return [];
        }
    };
    const adapter = new FakeAdapter();
    const window = fakeWindow(hash);
    const module = new MapPredictor({
        dwem,
        repository,
        adapter,
        window,
        useWorker: false
    });
    return {
        module,
        adapter,
        commands,
        messages,
        sendBefore,
        window
    };
}

function sprintTemplate(name = 'fixture_sprint') {
    return {
        name,
        path: `crawl-ref/source/dat/des/sprint/${name}.des`,
        width: 2,
        height: 2,
        grid: [
            [{
                kinds: ['stairs'],
                possibleGlyphs: [SPRINT_ENTRY_SENTINEL]
            }, {kinds: ['wall'], possibleGlyphs: ['x']}],
            [{kinds: ['floor'], possibleGlyphs: ['.']}, {
                kinds: ['wall'],
                possibleGlyphs: ['x']
            }]
        ],
        metadata: {
            encompass: true,
            orient: 'encompass',
            tags: ['sprint', 'no_rotate', 'no_hmirror', 'no_vmirror'],
            place: 'D:1',
            parseWarnings: [],
            sprint: true,
            autoReveal: true,
            matchPolicy: {
                minScore: 1,
                minEvidenceCells: 3,
                minEvidenceWeight: 3,
                minDistinctKinds: 2,
                requiredKinds: ['floor', 'wall'],
                exhaustivePlacement: true
            }
        }
    };
}

function readyResult(template, offset = 0) {
    return {
        ready: true,
        reason: 'ready',
        margin: 1,
        unique: true,
        best: {
            template,
            score: 1,
            transform: 'r0',
            offsetX: offset,
            offsetY: 0
        },
        predictions: [{x: offset + 4, y: 5, kind: 'wall'}],
        forcePredictions: []
    };
}

test('Sprint source hashing is synchronous and standards-compatible', () => {
    assert.equal(
        sprintSourceSha256(''),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    assert.equal(
        sprintSourceSha256('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
});

test('Ziggurat Sprint setup-room transporters survive helper sanitization', () => {
    const source = String.raw`
NAME: room_start
: setup_room(_G, 1)
MAP
Aa
ENDMAP

NAME: room_1
: setup_room(_G, 2)
MAP
AaZz
ENDMAP
`;
    const sanitized = sanitizeAuditedSprintSource(
        source,
        'crawl-ref/source/dat/des/sprint/zigsprint.des'
    );
    const [start, later] = parseDes(sanitized);

    assert.deepEqual(start.grid[0][0].kinds, ['portal']);
    assert.deepEqual(start.grid[0][1].kinds, ['floor']);
    assert.deepEqual(later.grid[0][0].kinds, ['portal']);
    assert.deepEqual(later.grid[0][1].kinds, ['portal']);
    assert.deepEqual(later.metadata.parseWarnings, []);
});

test('Sprint catalog audit requires the complete exact nine once each', () => {
    const catalog = SPRINT_TEMPLATE_NAMES.map(name => ({
        name,
        metadata: {
            sourceAudit: 'sprint-exact-source-v1',
            sprint: true,
            autoReveal: true
        }
    }));
    assert.equal(selectAuditedSprintCatalog(catalog).length, 9);
    assert.deepEqual(selectAuditedSprintCatalog(catalog.slice(1)), []);
    assert.deepEqual(selectAuditedSprintCatalog([...catalog, catalog[0]]), []);
    const changed = structuredClone(catalog);
    changed[0].metadata.sourceAudit = 'generic';
    assert.deepEqual(selectAuditedSprintCatalog(changed), []);
});

test('repository Sprint selection audits the whole directory inventory', () => {
    const repository = new SourceRepository({
        fetch: async () => {
            throw new Error('not used');
        },
        cache: {}
    });
    const exact = {paths: [...SPRINT_SOURCE_PATHS]};
    assert.deepEqual(
        repository.selectPaths(exact, 'Dungeon', 0),
        [...SPRINT_SOURCE_PATHS]
    );
    assert.deepEqual(repository.selectPaths(exact, 'Dungeon', 1), []);
    assert.deepEqual(repository.selectPaths(exact, 'Dungeon'), []);
    assert.deepEqual(repository.selectPaths(exact, 'Dungeon', '0'), []);
    assert.deepEqual(repository.selectPaths(exact, ' Dungeon ', 0), []);
    assert.deepEqual(repository.selectPaths(
        {paths: SPRINT_SOURCE_PATHS.slice(1)},
        'Dungeon',
        0
    ), []);
    assert.deepEqual(repository.selectPaths(
        {paths: [
            ...SPRINT_SOURCE_PATHS,
            'crawl-ref/source/dat/des/sprint/new_upstream_sprint.des'
        ]},
        'Dungeon',
        0
    ), []);
});

test('only an exact received Dungeon depth zero player scopes Sprint candidates', () => {
    assert.equal(isSprintCandidateScope({place: 'Dungeon', depth: 0}), true);
    assert.equal(isSprintCandidateScope({place: 'Dungeon', depth: 1}), false);
    assert.equal(isSprintCandidateScope({place: 'Temple', depth: 0}), false);
    assert.equal(isSprintCandidateScope({place: 'Dungeon'}), false);
    assert.equal(isSprintCandidateScope({place: 'Dungeon', depth: '0'}), false);
    assert.equal(isSprintCandidateScope({place: ' Dungeon ', depth: 0}), false);

    assert.deepEqual(
        templateSelectionPlayer({place: 'Dungeon', depth: 0, turn: 17}),
        {place: 'Dungeon', depth: 1, turn: 17}
    );
    assert.deepEqual(
        templateSelectionPlayer({place: 'Dungeon', depth: 1}),
        {place: 'Dungeon', depth: 1}
    );
});

test('lobby hash and outgoing game ids have no Sprint influence', () => {
    const {module, sendBefore} = harness({hash: '#play-sprint-web-trunk'});
    module.onLoad();
    sendBefore.emit('play', {game_id: 'dcss-git-sprint'});
    assert.equal(Object.hasOwn(module, 'gameId'), false);
    assert.equal(Object.hasOwn(module, 'gameMode'), false);
    assert.equal(Object.hasOwn(module, 'sprintSpawnPending'), false);
    assert.equal(module.levelKey, null);
});

test('chargen, player, and spectator Sprint clears never create an anchor', () => {
    const snapshots = [
        {name: '', turn: 0, pos: {x: 0, y: 0}},
        {name: 'SprintTester', turn: 0, pos: {x: 12, y: 9}},
        {name: 'SprintTester', turn: 17, pos: {x: 30, y: 20}}
    ];
    for (const snapshot of snapshots) {
        const module = harness().module;
        module.onPlayer({
            ...snapshot,
            place: 'Dungeon',
            depth: 0
        });
        module.onMap({
            clear: true,
            touched: [{...snapshot.pos}],
            raw: {player_on_level: true}
        });
        assert.deepEqual(module.levelSignals, {});
        const [selected] = selectSafeTemplates(
            [sprintTemplate()],
            templateSelectionPlayer(module.player),
            module.levelSignals
        );
        assert.equal(selected.metadata.matchAnchor, undefined);
        assert.equal(selected.metadata.matchPolicy.exhaustivePlacement, true);
    }
});

test('player and spectator packets produce the same exhaustive terrain result', () => {
    const evaluate = turn => {
        const module = harness().module;
        module.onPlayer({
            name: 'SprintTester',
            place: 'Dungeon',
            depth: 0,
            turn,
            pos: {x: 5, y: 6}
        });
        module.onMap({clear: true, raw: {player_on_level: true}});
        const selected = selectSafeTemplates(
            [sprintTemplate()],
            templateSelectionPlayer(module.player),
            module.levelSignals
        );
        const matcher = new MapMatcher({
            requireExhaustivePlacement: true,
            minPredictedCells: 1
        });
        matcher.setTemplates(selected);
        matcher.updateObservations([
            {x: 5, y: 6, kind: 'stair'},
            {x: 6, y: 6, kind: 'wall'},
            {x: 5, y: 7, kind: 'floor'}
        ], {evaluate: false});
        const result = matcher.evaluate();
        return {
            reason: result.reason,
            match: result.best && {
                name: result.best.template.name,
                transform: result.best.transform,
                offsetX: result.best.offsetX,
                offsetY: result.best.offsetY
            },
            predictions: result.predictions
        };
    };
    assert.deepEqual(evaluate(0), evaluate(17));
});

test('Sprint auto reveal is once per session and manual OFF survives reload', async () => {
    const {module, adapter, messages} = harness();
    const first = sprintTemplate('first');
    module.gameSession = 1;
    module.player = {place: 'Dungeon', depth: 0};
    module.levelKey = 'Dungeon\u00000';
    module.templates = [first];

    // Worker results intentionally compact templates to name/path only; the
    // owner must recover audited autoReveal metadata from its configured set.
    module.handleResult(readyResult({name: first.name, path: first.path}));
    assert.equal(adapter.revealEnabled, true);
    assert.equal(module.autoRevealApplied, true);
    assert.match(messages.at(-1), /Automatically mapped/);

    module.toggleReveal();
    assert.equal(adapter.revealEnabled, false);
    const changedWinner = sprintTemplate('changed_winner');
    module.handleResult(readyResult(changedWinner, 2));
    assert.equal(adapter.revealEnabled, false);

    module.build = {revision: 'a'.repeat(40), fullSha: 'a'.repeat(40)};
    module.manifest = {paths: []};
    module.player = {place: 'Dungeon', depth: 0};
    await module.reloadSources();
    assert.equal(module.autoRevealApplied, true);
    assert.equal(adapter.revealEnabled, false);

    module.build = null;
    module.manifest = null;
    module.resetLevel({resetAutoReveal: true});
    assert.equal(module.autoRevealApplied, false);
    module.templates = [first];
    module.handleResult(readyResult(first));
    assert.equal(adapter.revealEnabled, true);
});

test('safe results are preferred and supported rejected candidates auto reveal provisionally', () => {
    const {module, adapter} = harness();
    const ordinary = sprintTemplate('ordinary');
    ordinary.metadata.sprint = false;
    ordinary.metadata.autoReveal = false;
    module.templates = [ordinary];
    module.handleResult(readyResult(ordinary));
    assert.equal(adapter.revealEnabled, true);
    assert.equal(module.autoRevealApplied, true);

    module.resetLevel({resetAutoReveal: true});
    module.templates = [ordinary];
    module.handleResult({
        ...readyResult(ordinary),
        ready: false,
        reason: 'below-threshold',
        predictions: [],
        provisionalPredictions: [{x: 7, y: 8, kind: 'floor'}],
        forcePredictions: [{x: 7, y: 8, kind: 'floor'}]
    });
    assert.equal(adapter.revealEnabled, true);
    assert.equal(module.autoRevealApplied, true);
    assert.equal(module.getDebugState().status, 'map-provisional');
    assert.equal(module.getDebugState().predictionMode, 'provisional');
    assert.deepEqual(adapter.predictions.map(({x, y, kind}) => ({x, y, kind})), [
        {x: 7, y: 8, kind: 'floor'}
    ]);
});
