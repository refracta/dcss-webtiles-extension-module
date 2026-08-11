import assert from 'node:assert/strict';
import test from 'node:test';

import WebtilesAdapter, {
    decodeMapCellDeltas,
    installMapPredictorBackgroundFlag,
    installMapPredictorBackgroundFlagBroker,
    installMapPredictorBackgroundFlagFromExports,
    installMapPredictorKnowledgeVisibilityBroker,
    installMapPredictorRendererTint,
    packMapPredictorBackground,
    parseCrawlSourceRef,
    SYNTHETIC_MAP_MARKER,
    uninstallMapPredictorRendererTint,
    wrapMapPredictorKnowledgeVisibility
} from '../webtiles-adapter.js';

const MAP_PREDICTOR_FLAG = [0, 0x40000000];

function mapPredictorBackground(base) {
    return [base & 0xFFFF, MAP_PREDICTOR_FLAG[1]];
}

function handlerList() {
    return {
        handlers: [],
        addHandler(identifier, handler) {
            this.handlers.push({identifier, handler});
        },
        removeHandler(identifier) {
            this.handlers = this.handlers.filter(entry => {
                return entry.identifier !== identifier;
            });
        }
    };
}

function fakeDwem(owner = {}, originalHandle = () => {}) {
    const before = handlerList();
    const after = handlerList();
    const sendBefore = handlerList();
    const sendAfter = handlerList();
    const mapperRegistrations = [];
    const handledMessages = [];
    const sentMessages = [];
    const handleMessage = message => {
        let cancelled = false;
        for (const {handler} of before.handlers) {
            cancelled = handler(message) || cancelled;
        }
        if (cancelled) {
            return;
        }
        handledMessages.push(message);
        originalHandle(message);
        for (const {handler} of after.handlers) {
            handler(message);
        }
    };
    handleMessage.before = before;
    handleMessage.after = after;
    const sendMessage = (message, data) => {
        let cancelled = false;
        for (const {handler} of sendBefore.handlers) {
            cancelled = handler(message, data) || cancelled;
        }
        if (cancelled) {
            return false;
        }
        sentMessages.push({message, data: structuredClone(data)});
        for (const {handler} of sendAfter.handlers) {
            handler(message, data);
        }
        return true;
    };
    sendMessage.before = sendBefore;
    sendMessage.after = sendAfter;
    const dwem = {
        Modules: {
            MapPredictor: owner,
            IOHook: {
                handle_message: handleMessage,
                send_message: sendMessage
            }
        },
        SourceMapperRegistry: {
            getSourceMapper(type, source) {
                return {type, source};
            },
            add(matcher, mapper) {
                mapperRegistrations.push({matcher, mapper});
            }
        }
    };
    return {
        dwem,
        before,
        after,
        sendBefore,
        sendAfter,
        mapperRegistrations,
        handledMessages,
        sentMessages
    };
}

function nativeMapHarness(owner = {}, adapterOptions = {}, bindingOverrides = {}) {
    const cells = new Map();
    const dirty = [];
    const rendered = [];
    const minimapUpdates = [];
    const key = (x, y) => `${x},${y}`;
    const mapKnowledge = {
        get(x, y) {
            const coordinate = key(x, y);
            if (!cells.has(coordinate)) {
                cells.set(coordinate, {x, y});
            }
            return cells.get(coordinate);
        },
        touch(x, y) {
            const cell = this.get(x, y);
            if (!cell.dirty) {
                dirty.push({x, y});
            }
            cell.dirty = true;
        },
        merge(wireCells) {
            for (const decoded of decodeMapCellDeltas(wireCells)) {
                const current = this.get(decoded.x, decoded.y);
                const diff = decoded.diff;
                for (const [property, value] of Object.entries(diff)) {
                    if (property === 't') {
                        current.t = Object.assign(current.t || {}, value);
                    } else {
                        current[property] = value;
                    }
                }
                this.touch(decoded.x, decoded.y);
            }
        }
    };
    const renderer = {
        render_loc(x, y, cell) {
            rendered.push({x, y, cell: structuredClone(cell)});
        }
    };
    const minimap = {
        update(x, y, cell) {
            minimapUpdates.push({x, y, cell: structuredClone(cell)});
        }
    };
    const originalHandle = message => {
        if (message.msg !== 'map') {
            return;
        }
        if (message.clear) {
            cells.clear();
            dirty.length = 0;
        }
        if (message.cells) {
            mapKnowledge.merge(message.cells);
        }
        for (const {x, y} of dirty.splice(0)) {
            const cell = mapKnowledge.get(x, y);
            cell.dirty = false;
            renderer.render_loc(x, y, cell);
            minimap.update(x, y, cell);
        }
    };
    const hooks = fakeDwem(owner, originalHandle);
    const enums = {
        MF_UNSEEN: 0,
        MF_FLOOR: 1,
        MF_WALL: 2,
        MF_MAP_FLOOR: 3,
        MF_MAP_WALL: 4,
        MF_DOOR: 5,
        MF_ITEM: 6,
        MF_WATER: 7,
        MF_DEEP_WATER: 8,
        MF_LAVA: 9,
        DWEM_MAP_PREDICTOR_BG_FLAG: MAP_PREDICTOR_FLAG.slice(),
        CURSOR_MAP: 2,
        ui: {
            NORMAL: 0,
            VIEW_MAP: 2
        }
    };
    const adapter = new WebtilesAdapter(owner, {
        dwem: hooks.dwem,
        ...adapterOptions
    });
    adapter.install();
    adapter.bindWebtiles({
        mapKnowledge,
        renderer,
        minimap,
        enums,
        dngn: {
            DNGN_UNSEEN: 0,
            DNGN_ERROR: 1,
            FLOOR_MAX: 0x70,
            WALL_MAX: 0x100,
            DNGN_CLOSED_DOOR: 0x11F,
            DNGN_SHALLOW_WATER: 0x120,
            DNGN_DEEP_WATER: 0x121,
            DNGN_LAVA: 0x122,
            basetile(tile) {
                return tile & 0x0000FFFF;
            }
        },
        ...bindingOverrides
    });
    return {
        ...hooks,
        adapter,
        cells,
        mapKnowledge,
        renderer,
        minimap,
        rendered,
        minimapUpdates,
        enums
    };
}

function fakeJqueryEvents() {
    const registrations = [];
    const target = {
        on(names, handler) {
            registrations.push({names, handler});
            return this;
        },
        off(names, handler) {
            for (let index = registrations.length - 1; index >= 0; index--) {
                const entry = registrations[index];
                if (entry.names === names && entry.handler === handler) {
                    registrations.splice(index, 1);
                }
            }
            return this;
        }
    };
    const jquery = () => target;
    const trigger = (type, properties = {}) => {
        let prevented = false;
        let stopped = false;
        const event = {
            type,
            which: 0,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            shiftKey: false,
            ...properties,
            preventDefault() {
                prevented = true;
            },
            stopImmediatePropagation() {
                stopped = true;
            }
        };
        for (const entry of registrations.slice()) {
            if (entry.names.split(/\s+/).some(name => name.split('.')[0] === type)) {
                entry.handler(event);
            }
        }
        return {
            event,
            prevented,
            stopped
        };
    };
    return {jquery, registrations, trigger};
}

function fakeCanvas(id, width = 100, height = 80) {
    const calls = [];
    const context = {
        calls,
        clearRect(...args) {
            calls.push(['clearRect', ...args]);
        },
        fillRect(...args) {
            calls.push(['fillRect', ...args]);
        },
        strokeRect(...args) {
            calls.push(['strokeRect', ...args]);
        },
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {}
    };
    return {
        id,
        width,
        height,
        clientWidth: width,
        clientHeight: height,
        offsetLeft: 0,
        offsetTop: 0,
        style: {},
        parentElement: null,
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        getContext() {
            return context;
        },
        remove() {
            this.parentElement?.removeChild(this);
        },
        context
    };
}

function fakeDom() {
    const elements = new Map();
    const parent = {
        style: {},
        children: [],
        append(element) {
            element.parentElement = this;
            this.children.push(element);
            elements.set(element.id, element);
        },
        removeChild(element) {
            this.children = this.children.filter(child => child !== element);
            elements.delete(element.id);
            element.parentElement = null;
        }
    };
    const dungeon = fakeCanvas('dungeon');
    const minimap = fakeCanvas('minimap');
    parent.append(dungeon);
    parent.append(minimap);
    const document = {
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement(tagName) {
            assert.equal(tagName, 'canvas');
            return fakeCanvas('');
        }
    };
    const window = {
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle() {
            return {position: 'static'};
        }
    };
    return {document, window, dungeon, minimap, parent, elements};
}

test('decodes compact WebTiles coordinates without carrying malformed runs', () => {
    const decoded = decodeMapCellDeltas([
        {x: 4, y: -2, f: 1},
        {f: 2},
        {x: -3, y: 7, f: 3},
        {f: 4},
        {x: 'bad', y: 8},
        {f: 5},
        {x: 0, y: 0, f: 6},
        {x: 2, f: 7}
    ]);

    assert.deepEqual(decoded.map(({index, x, y}) => ({index, x, y})), [
        {index: 0, x: 4, y: -2},
        {index: 1, x: 5, y: -2},
        {index: 2, x: -3, y: 7},
        {index: 3, x: -2, y: 7},
        {index: 6, x: 0, y: 0},
        {index: 7, x: 2, y: 0}
    ]);
    assert.equal(decoded[0].diff.f, 1);

    assert.deepEqual(
        decodeMapCellDeltas([{x: -4, y: 0}, {x: -5, y: 0}], {
            maxAbsCoordinate: -4
        }).map(({x, y}) => ({x, y})),
        [{x: -4, y: 0}]
    );
});

test('extracts git revisions and stable release tags', () => {
    assert.deepEqual(
        parseCrawlSourceRef('Dungeon Crawl Stone Soup 0.34-a0-12-gabcdef1234'),
        {type: 'commit', value: 'abcdef1234'}
    );
    assert.deepEqual(
        parseCrawlSourceRef('Dungeon Crawl Stone Soup 0.33.1'),
        {type: 'tag', value: '0.33.1'}
    );
    assert.deepEqual(
        parseCrawlSourceRef('Dungeon Crawl Stone Soup 0.34-a0'),
        {type: 'tag', value: '0.34-a0'}
    );
    assert.equal(parseCrawlSourceRef('Dungeon Crawl Stone Soup 0.34-a0-12'), null);
});

test('reserves a non-conflicting second-word flag for exact d29/1b83 tile flags', () => {
    // These are the second-word allocations in the audited d29df338 and
    // 1b83f8de WebTiles enums: KRAKEN_SW, RAMPAGE, LANDING, and RAY_MULTI.
    const flagData = {
        flags: {
            RAY: 0x00010000,
            MM_UNSEEN: 0x00020000,
            UNSEEN: 0x00040000,
            KRAKEN_SW: [0, 0x01],
            RAMPAGE: [0, 0x020],
            LANDING: [0, 0x200],
            RAY_MULTI: [0, 0x400]
        },
        exclusive_flags: [{
            mask: 0x00180000,
            CURSOR1: 0x00180000,
            CURSOR2: 0x00080000,
            CURSOR3: 0x00100000
        }],
        mask: 0x0000FFFF
    };
    const exportsObject = {};

    assert.deepEqual(
        installMapPredictorBackgroundFlag(exportsObject, flagData),
        MAP_PREDICTOR_FLAG
    );
    assert.deepEqual(flagData.flags.DWEM_MAP_PREDICTED, MAP_PREDICTOR_FLAG);
    assert.deepEqual(
        exportsObject.DWEM_MAP_PREDICTOR_BG_FLAG,
        MAP_PREDICTOR_FLAG
    );
    assert.deepEqual(
        packMapPredictorBackground(0x12345, MAP_PREDICTOR_FLAG),
        [0x2345, 0x40000000]
    );
});

test('chooses another upper-word bit on conflict and fails closed when exhausted', () => {
    const conflicting = {
        flags: {FUTURE_FLAG: [0, 0x40000000]},
        exclusive_flags: []
    };
    assert.deepEqual(
        installMapPredictorBackgroundFlag({}, conflicting),
        [0, 0x20000000]
    );

    const exhausted = {
        flags: {},
        exclusive_flags: [{mask: [0, 0x7FFF0000]}]
    };
    const exportsObject = {};
    assert.equal(
        installMapPredictorBackgroundFlag(exportsObject, exhausted),
        null
    );
    assert.equal(exportsObject.DWEM_MAP_PREDICTOR_BG_FLAG, null);
    assert.equal(exhausted.flags.DWEM_MAP_PREDICTED, undefined);
    assert.equal(packMapPredictorBackground(42, null), null);
});

test('late enum attachment probes cached exports for a collision-free bit', () => {
    const enums = {
        prepare_bg_flags(background) {
            background.FUTURE_FLAG = (
                background[1] & 0x40000000
            ) !== 0;
            background.value = background[0] & 0xFFFF;
            return background;
        }
    };

    assert.deepEqual(
        installMapPredictorBackgroundFlagFromExports(enums),
        [0, 0x20000000]
    );
    assert.deepEqual(
        installMapPredictorBackgroundFlagFromExports(enums),
        [0, 0x20000000]
    );
});

test('background flag broker removes enum hot-path work while disabled', () => {
    const dwem = {};
    const exportsObject = {};
    const flagData = {flags: {}, exclusive_flags: []};
    const broker = installMapPredictorBackgroundFlagBroker(
        dwem,
        exportsObject,
        flagData,
        installMapPredictorBackgroundFlag
    );

    assert.equal(broker.active, true);
    assert.deepEqual(
        flagData.flags.DWEM_MAP_PREDICTED,
        MAP_PREDICTOR_FLAG
    );
    broker.uninstall();
    assert.equal(broker.active, false);
    assert.equal(flagData.flags.DWEM_MAP_PREDICTED, undefined);
    assert.equal(exportsObject.DWEM_MAP_PREDICTOR_BG_FLAG, undefined);

    broker.install();
    assert.deepEqual(
        exportsObject.DWEM_MAP_PREDICTOR_BG_FLAG,
        MAP_PREDICTOR_FLAG
    );
    broker.uninstall();
});

test('custom mapped cells stay unseen and receive only the native orange tint', () => {
    const calls = [];
    class Renderer {
        constructor() {
            this.cell_width = 32;
            this.cell_height = 32;
            this.ctx = {
                fillStyle: null,
                globalCompositeOperation: null,
                save() {
                    calls.push(['save']);
                },
                fillRect(...args) {
                    calls.push(['fillRect', this.fillStyle, ...args]);
                },
                restore() {
                    calls.push(['restore']);
                }
            };
        }

        scaled_size() {
            return {width: 40, height: 36};
        }

        do_render_cell() {
            calls.push(['base']);
            return 'rendered';
        }

        render_cursors(...args) {
            calls.push(['cursor', ...args]);
        }
    }
    const enums = {
        DWEM_MAP_PREDICTOR_BG_FLAG: MAP_PREDICTOR_FLAG.slice()
    };
    const customCell = {
        t: {bg: mapPredictorBackground(0x35)}
    };
    const stockMagicMappedCell = {
        t: {bg: 0x35 | 0x00020000}
    };
    const stockVisible = cell => cell !== stockMagicMappedCell;
    const visible = wrapMapPredictorKnowledgeVisibility(
        stockVisible,
        enums
    );
    assert.equal(visible(customCell), false);
    assert.equal(visible(stockMagicMappedCell), false);
    assert.equal(visible({t: {bg: 0x35}}), true);

    const originalRenderer = Renderer.prototype.do_render_cell;
    const mapKnowledge = {get() {}};
    assert.equal(
        installMapPredictorRendererTint(Renderer, enums, mapKnowledge),
        true
    );
    const tintState = Renderer.prototype.__dwemMapPredictorTintState;
    assert.equal(tintState.mapKnowledge, mapKnowledge);
    const renderer = new Renderer();
    assert.equal(
        renderer.do_render_cell(3, 4, 120, 144, customCell),
        'rendered'
    );
    assert.deepEqual(calls, [
        ['base'],
        ['save'],
        ['fillRect', 'rgba(255, 128, 24, 0.32)', 120, 144, 40, 36],
        ['restore'],
        ['cursor', 3, 4, 120, 144]
    ]);

    calls.length = 0;
    renderer.do_render_cell(3, 4, 120, 144, stockMagicMappedCell);
    assert.deepEqual(calls, [['base']]);
    assert.equal(
        installMapPredictorRendererTint(Renderer, enums, {get() {}}),
        true
    );
    assert.equal(uninstallMapPredictorRendererTint(Renderer), true);
    assert.equal(Renderer.prototype.do_render_cell, originalRenderer);
    assert.equal(tintState.mapKnowledge, null);
    assert.equal(tintState.enums, null);
    assert.equal(
        Object.hasOwn(Renderer.prototype, '__dwemMapPredictorTintState'),
        false
    );

    calls.length = 0;
    renderer.do_render_cell(3, 4, 120, 144, customCell);
    assert.deepEqual(calls, [['base']]);
});

test('map-knowledge visibility broker removes and reinstalls its hot-path patch', () => {
    const dwem = {};
    const original = () => true;
    const enums = {
        DWEM_MAP_PREDICTOR_BG_FLAG: MAP_PREDICTOR_FLAG.slice()
    };
    let visible = original;
    const broker = installMapPredictorKnowledgeVisibilityBroker(
        dwem,
        original,
        enums,
        wrapMapPredictorKnowledgeVisibility,
        nextVisible => {
            visible = nextVisible;
        }
    );
    const predicted = {t: {bg: mapPredictorBackground(0x35)}};

    assert.equal(broker.active, true);
    assert.equal(visible(predicted), false);
    broker.uninstall();
    assert.equal(broker.active, false);
    assert.equal(broker.wrapper, null);
    assert.equal(visible, original);
    assert.equal(visible(predicted), true);

    broker.install();
    assert.equal(broker.active, true);
    assert.equal(visible(predicted), false);
    broker.uninstall();
    assert.equal(visible, original);
});

test('installs native flag, renderer tint, and binding source mappers', () => {
    const owner = {};
    const {
        dwem,
        before,
        after,
        sendBefore,
        mapperRegistrations
    } = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});

    adapter.install();

    assert.equal(owner.webtilesAdapter, adapter);
    assert.equal(before.handlers.length, 1);
    assert.equal(after.handlers.length, 1);
    assert.equal(sendBefore.handlers.length, 1);
    assert.equal(mapperRegistrations.length, 3);
    const byMatcher = new Map(mapperRegistrations.map(entry => [
        entry.matcher,
        entry.mapper
    ]));
    assert.deepEqual(Array.from(byMatcher.keys()).sort(), [
        './cell_renderer',
        './enums',
        './minimap'
    ]);
    assert.ok(Array.from(byMatcher.values()).every(mapper => {
        return mapper.type === 'BeforeReturnInjection';
    }));
    assert.match(byMatcher.get('./enums').source, /bg_flags/);
    assert.match(byMatcher.get('./enums').source, /DWEM_MAP_PREDICTED/);
    const injectedExports = {};
    const injectedFlags = {flags: {}, exclusive_flags: []};
    new Function(
        'exports',
        'bg_flags',
        'DWEM',
        byMatcher.get('./enums').source
    )(injectedExports, injectedFlags, dwem);
    assert.deepEqual(
        injectedFlags.flags.DWEM_MAP_PREDICTED,
        MAP_PREDICTOR_FLAG
    );
    assert.match(byMatcher.get('./cell_renderer').source, /rgba\(255, 128, 24, 0\.32\)/);
    assert.match(
        byMatcher.get('./cell_renderer').source,
        /MapPredictorRendererTintTarget/
    );
    const bindingSource = byMatcher.get('./minimap').source;
    assert.match(bindingSource, /mapKnowledge: map_knowledge/);
    assert.match(bindingSource, /renderer: dungeon_renderer/);
    assert.match(bindingSource, /dngn/);
    assert.match(bindingSource, /jquery: \$/);
    assert.match(bindingSource, /viewData: view_data/);
    assert.match(bindingSource, /getMinimapProjection/);

    adapter.destroy();
    assert.equal(injectedFlags.flags.DWEM_MAP_PREDICTED, undefined);
    assert.equal(injectedExports.DWEM_MAP_PREDICTOR_BG_FLAG, undefined);
    assert.equal(before.handlers.length, 0);
    assert.equal(after.handlers.length, 0);
    assert.equal(sendBefore.handlers.length, 0);
});

test('destroy restores a renderer patched before the minimap binding exists', () => {
    class Renderer {
        do_render_cell() {
            return 'base';
        }
    }
    const original = Renderer.prototype.do_render_cell;
    const mapKnowledge = {get() {}};
    const enums = {
        DWEM_MAP_PREDICTOR_BG_FLAG: MAP_PREDICTOR_FLAG.slice()
    };
    const owner = {};
    const {dwem} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.install();

    installMapPredictorRendererTint(Renderer, enums, mapKnowledge);
    const state = Renderer.prototype.__dwemMapPredictorTintState;
    dwem.MapPredictorRendererTintTarget = Renderer.prototype;
    adapter.destroy({releaseBinding: true});

    assert.equal(Renderer.prototype.do_render_cell, original);
    assert.equal(state.mapKnowledge, null);
    assert.equal(dwem.MapPredictorRendererTintTarget, undefined);
});

test('captures immutable wire packets before handlers and reads merged cells after', () => {
    const mapGets = [];
    const ownerEvents = [];
    const knowledgeEvents = [];
    const versionEvents = [];
    const playerEvents = [];
    const owner = {
        onMap(payload) {
            ownerEvents.push(payload);
        },
        onKnowledge(cells, binding) {
            knowledgeEvents.push({cells, binding});
        },
        onVersion(text, data) {
            versionEvents.push({text, data});
        },
        onPlayer(snapshot, data) {
            playerEvents.push({snapshot, data});
        }
    };
    const {dwem, before, after} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.install();
    adapter.bindWebtiles({
        mapKnowledge: {
            get(x, y) {
                mapGets.push([x, y]);
                return {
                    x,
                    y,
                    f: 1,
                    mf: 1,
                    t: {bg: {value: 10, UNSEEN: false}}
                };
            }
        },
        renderer: {}
    });

    const version = {msg: 'version', text: 'Dungeon Crawl Stone Soup 0.34-a0-2-g1234567'};
    before.handlers[0].handler(version);
    assert.deepEqual(adapter.version.sourceRef, {type: 'commit', value: '1234567'});
    assert.equal(versionEvents[0].text, version.text);
    assert.deepEqual(versionEvents[0].data.sourceRef, {
        type: 'commit',
        value: '1234567'
    });

    const player = {
        msg: 'player',
        place: 'WizLab',
        depth: 1,
        pos: {x: 2, y: 3}
    };
    before.handlers[0].handler(player);
    delete player.msg;
    player.pos.x = 99;
    assert.deepEqual(adapter.player.pos, {x: 2, y: 3});
    assert.deepEqual(playerEvents[0].snapshot.pos, {x: 2, y: 3});
    assert.equal(playerEvents[0].data.msg, 'player');

    const map = {
        msg: 'map',
        cells: [
            {x: -1, y: 4, f: 1, t: {bg: 10}},
            {f: 2, t: {bg: 11}}
        ]
    };
    before.handlers[0].handler(map);
    map.cells[0].t.bg = {value: 10, UNSEEN: false};
    after.handlers[0].handler(map);

    assert.deepEqual(mapGets, [[-1, 4], [0, 4]]);
    assert.equal(ownerEvents.length, 1);
    assert.equal(ownerEvents[0].clear, false);
    assert.equal(ownerEvents[0].touched[0].diff.t.bg, 10);
    assert.equal(ownerEvents[0].raw.cells[0].t.bg, 10);
    assert.equal(knowledgeEvents[0].cells[1].cell.f, 1);
    assert.equal(knowledgeEvents[0].cells[1].removed, false);
    assert.equal(knowledgeEvents[0].binding, adapter.binding);
    assert.equal(adapter.observedCells.size, 2);
    adapter.destroy();
});

test('captures immutable message batches before handlers and preserves wire fields', () => {
    const ownerEvents = [];
    const emittedEvents = [];
    const owner = {
        onMessages(messages, raw) {
            ownerEvents.push({messages, raw});
        }
    };
    const {dwem, before} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.on('messages', payload => emittedEvents.push(payload));
    adapter.install();

    const packet = {
        msg: 'msgs',
        more: false,
        messages: [{
            text: '<lightred>The mighty Pandemonium lord Mnoleg resides here.',
            channel: 13,
            turn: 42,
            extra: {source: 'epilogue'}
        }]
    };
    before.handlers[0].handler(packet);

    packet.more = true;
    packet.messages[0].text = 'mutated downstream';
    packet.messages[0].extra.source = 'mutated downstream';

    assert.equal(ownerEvents.length, 1);
    assert.equal(emittedEvents.length, 1);
    assert.equal(
        ownerEvents[0].messages[0].text,
        '<lightred>The mighty Pandemonium lord Mnoleg resides here.'
    );
    assert.equal(ownerEvents[0].messages[0].channel, 13);
    assert.equal(ownerEvents[0].messages[0].turn, 42);
    assert.equal(ownerEvents[0].messages[0].extra.source, 'epilogue');
    assert.equal(ownerEvents[0].raw.more, false);
    assert.deepEqual(emittedEvents[0], ownerEvents[0]);

    emittedEvents[0].messages[0].text = 'mutated listener payload';
    assert.equal(
        ownerEvents[0].messages[0].text,
        '<lightred>The mighty Pandemonium lord Mnoleg resides here.'
    );
    adapter.destroy();
});

test('ignores empty and malformed message batches', () => {
    const ownerEvents = [];
    const emittedEvents = [];
    const owner = {
        onMessages(messages, raw) {
            ownerEvents.push({messages, raw});
        }
    };
    const {dwem, before} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.on('messages', payload => emittedEvents.push(payload));
    adapter.install();

    for (const packet of [
        {msg: 'msgs'},
        {msg: 'msgs', messages: null},
        {msg: 'msgs', messages: 'not-an-array'},
        {msg: 'msgs', messages: []},
        {msg: 'msgs', messages: [null]},
        {msg: 'msgs', messages: [{text: 17}]}
    ]) {
        before.handlers[0].handler(packet);
    }

    assert.deepEqual(ownerEvents, []);
    assert.deepEqual(emittedEvents, []);
    adapter.destroy();
});

test('marks touched unseen cells as removals and drops stale observed knowledge', () => {
    const knowledgeEvents = [];
    let knowledge = {x: 2, y: -3, f: 1, mf: 2};
    const owner = {
        onKnowledge(cells) {
            knowledgeEvents.push(cells);
        }
    };
    const {dwem, before, after} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.install();
    adapter.bindWebtiles({
        mapKnowledge: {
            get() {
                return knowledge;
            }
        },
        renderer: {}
    });

    const known = {msg: 'map', cells: [{x: 2, y: -3, f: 1}]};
    before.handlers[0].handler(known);
    after.handlers[0].handler(known);
    assert.equal(knowledgeEvents[0][0].removed, false);
    assert.equal(adapter.observedCells.size, 1);

    knowledge = {x: 2, y: -3, f: 0, mf: 0};
    const unseen = {msg: 'map', cells: [{x: 2, y: -3, f: 0}]};
    before.handlers[0].handler(unseen);
    after.handlers[0].handler(unseen);
    assert.equal(knowledgeEvents[1][0].removed, true);
    assert.equal(knowledgeEvents[1][0].cell.f, 0);
    assert.equal(adapter.observedCells.size, 0);

    knowledge = {x: 2, y: -3, f: null, mf: 0};
    const missing = {msg: 'map', cells: [{x: 2, y: -3, f: null}]};
    before.handlers[0].handler(missing);
    after.handlers[0].handler(missing);
    assert.equal(knowledgeEvents[2][0].removed, true);
    adapter.destroy();
});

test('clears level predictions and never merges predictions into map knowledge', () => {
    let getCount = 0;
    const mapEvents = [];
    const owner = {
        onMap(payload) {
            mapEvents.push(payload);
        }
    };
    const mapKnowledge = {
        get() {
            getCount++;
            return {f: 0, mf: 0, t: {bg: {UNSEEN: true}}};
        },
        merge() {
            assert.fail('prediction rendering must not merge map knowledge');
        },
        touch() {
            assert.fail('prediction rendering must not touch map knowledge');
        }
    };
    const {dwem, before, after} = fakeDwem(owner);
    const adapter = new WebtilesAdapter(owner, {dwem});
    adapter.install();
    adapter.bindWebtiles({mapKnowledge, renderer: {}});
    adapter.setPredictions([{x: 10, y: 10, kind: 'wall'}]);
    assert.equal(adapter.predictions.length, 1);
    assert.equal(getCount, 0);

    const clear = {msg: 'map', clear: true, cells: []};
    before.handlers[0].handler(clear);
    after.handlers[0].handler(clear);
    assert.equal(mapEvents.length, 1);
    assert.equal(mapEvents[0].clear, true);
    assert.deepEqual(mapEvents[0].touched, []);
    assert.equal(mapEvents[0].raw.msg, 'map');
    assert.equal(adapter.predictions.length, 0);
    assert.equal(getCount, 0);
    adapter.destroy();
});

test('same-key Pandemonium clear removes old native and observed map state', () => {
    const harness = nativeMapHarness();
    const {adapter, dwem, cells, enums} = harness;
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Pandemonium',
        depth: 0,
        pos: {x: 3, y: 4}
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{
            x: 3,
            y: 4,
            f: 6,
            mf: enums.MF_FLOOR,
            t: {bg: 0x2A}
        }]
    });
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 0x2A}}
    }]);
    adapter.setPredictions([{x: 20, y: 21, kind: 'floor'}]);
    adapter.setRevealEnabled(true);

    assert.equal(adapter.observedCells.size, 1);
    assert.equal(adapter._nativeCells.size, 1);
    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);

    // Pan-to-Pan retains the same place/depth fields. The following full map
    // packet, rather than the player level key, is the authoritative boundary.
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Pandemonium',
        depth: 0,
        pos: {x: -6, y: 7}
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: true,
        cells: [{
            x: -6,
            y: 7,
            f: 6,
            mf: enums.MF_FLOOR,
            t: {bg: 0x35}
        }]
    });

    assert.deepEqual(adapter.predictions, []);
    assert.equal(adapter._nativeCells.size, 0);
    assert.equal(adapter.observedCells.size, 1);
    assert.equal(adapter.observedCells.has('3,4'), false);
    assert.equal(adapter.observedCells.has('-6,7'), true);
    assert.equal(cells.has('20,21'), false);
    assert.equal(cells.has('3,4'), false);
    assert.equal(cells.get('-6,7').mf, enums.MF_FLOOR);
    adapter.destroy();
});

test('off-level X maps retain current-floor evidence and manual reveal state', () => {
    const mapEvents = [];
    const knowledgeEvents = [];
    const harness = nativeMapHarness({
        onMap(payload) {
            mapEvents.push(payload);
        },
        onKnowledge(cells) {
            knowledgeEvents.push(cells);
        }
    });
    const {adapter, dwem, cells, enums} = harness;
    const currentFloor = {
        x: 3,
        y: 4,
        f: 6,
        mf: enums.MF_FLOOR,
        t: {bg: 0x2A}
    };
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Pandemonium',
        depth: 0,
        pos: {x: 3, y: 4}
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        player_on_level: true,
        cells: [currentFloor]
    });
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: currentFloor
    }]);
    adapter.setPredictions([{x: 20, y: 21, kind: 'floor'}]);
    adapter.setRevealEnabled(true);

    assert.equal(mapEvents.length, 1);
    assert.equal(knowledgeEvents.length, 1);
    assert.equal(adapter._nativeCells.size, 1);
    assert.equal(adapter._terrainSamples.size, 1);

    // The same coordinate on another floor deliberately has different
    // terrain. It must be drawn by WebTiles but never enter current-floor
    // observations or notify the matcher owner.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: false,
        cells: [{
            x: 3,
            y: 4,
            f: 17,
            mf: enums.MF_WALL,
            t: {bg: 0x77}
        }]
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 8, y: 9, f: 17, mf: enums.MF_WALL, t: {bg: 0x77}}]
    });

    assert.equal(adapter.playerOnLevel, false);
    assert.equal(mapEvents.length, 1);
    assert.equal(knowledgeEvents.length, 1);
    assert.equal(adapter.observedCells.size, 1);
    assert.equal(adapter.observedCells.get('3,4').mf, enums.MF_FLOOR);
    assert.equal(adapter.observedCells.has('8,9'), false);
    assert.equal(adapter.predictions.length, 1);
    assert.equal(adapter.revealEnabled, true);
    assert.equal(adapter._nativeCells.size, 0);
    assert.equal(adapter._terrainSamples.size, 1);
    assert.deepEqual(adapter.applyNativePredictions(adapter.predictions), []);
    assert.equal(cells.get('3,4').mf, enums.MF_WALL);

    // Returning to the player's floor is a view transition, not a new Pan
    // level. Retained predictions are re-applied after the native full merge.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: true,
        cells: [currentFloor]
    });
    assert.equal(adapter.playerOnLevel, true);
    assert.equal(mapEvents.length, 1);
    assert.equal(knowledgeEvents.length, 2);
    assert.equal(adapter.predictions.length, 1);
    assert.equal(adapter.revealEnabled, true);
    assert.equal(adapter._nativeCells.size, 1);
    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);

    // A manual OFF choice survives another off-level round trip and a
    // distinguishable spectator-only same-floor full synchronization.
    adapter.setRevealEnabled(false);
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: false,
        cells: [{x: -1, y: -2, f: 17, mf: enums.MF_WALL, t: {bg: 0x77}}]
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: true,
        cells: [currentFloor]
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: true,
        spect_only: true,
        cells: [currentFloor]
    });

    assert.equal(mapEvents.length, 1);
    assert.equal(adapter.revealEnabled, false);
    assert.equal(adapter.predictions.length, 1);
    assert.equal(adapter._nativeCells.size, 0);
    assert.equal(adapter.observedCells.get('3,4').mf, enums.MF_FLOOR);
    adapter.destroy();
});

test('soft teardown retains the off-level guard and hard teardown resets it', () => {
    const {adapter, dwem} = nativeMapHarness();
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: false,
        cells: []
    });
    assert.equal(adapter.playerOnLevel, false);

    adapter.destroy({releaseBinding: false});
    assert.equal(adapter._playerOnLevel, false);
    assert.equal(adapter.playerOnLevel, false);
    assert.deepEqual(adapter.rehydrateKnowledge(), []);

    adapter.destroy({releaseBinding: true});
    assert.equal(adapter._playerOnLevel, null);
    assert.equal(adapter.playerOnLevel, true);
    assert.equal(adapter.binding, null);
});

test('soft resume refreshes player_on_level before rehydrating map knowledge', () => {
    const mapEvents = [];
    const knowledgeEvents = [];
    const harness = nativeMapHarness({
        onMap(payload) {
            mapEvents.push(payload);
        },
        onKnowledge(cells) {
            knowledgeEvents.push(cells);
        }
    });
    const {adapter, dwem, mapKnowledge, cells, enums} = harness;
    let boundPlayerOnLevel = true;
    mapKnowledge.player_on_level = () => boundPlayerOnLevel;
    mapKnowledge.bounds = () => ({left: 8, right: 8, top: 9, bottom: 9});
    cells.set('8,9', {x: 8, y: 9, f: 17, mf: enums.MF_FLOOR});

    // Pause while viewing another level, return while handlers are absent,
    // then resume. The retained false bit must not suppress current knowledge
    // or ordinary follow-up diffs which omit player_on_level.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        player_on_level: false,
        cells: []
    });
    adapter.destroy({releaseBinding: false});
    boundPlayerOnLevel = true;
    cells.set('8,9', {x: 8, y: 9, f: 17, mf: enums.MF_FLOOR});
    adapter.install();
    assert.equal(adapter.playerOnLevel, true);
    assert.deepEqual(
        adapter.rehydrateKnowledge().map(({x, y}) => ({x, y})),
        [{x: 8, y: 9}]
    );
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 8, y: 9, f: 18, mf: enums.MF_FLOOR}]
    });
    assert.equal(mapEvents.length, 1);
    assert.equal(knowledgeEvents.length, 1);

    // The inverse transition is equally important: entering an off-level map
    // while paused must not be ingested as the player's current floor.
    adapter.destroy({releaseBinding: false});
    boundPlayerOnLevel = false;
    adapter.install();
    assert.equal(adapter.playerOnLevel, false);
    assert.deepEqual(adapter.rehydrateKnowledge(), []);
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: -4, y: -5, f: 19, mf: enums.MF_WALL}]
    });
    assert.equal(mapEvents.length, 1);
    assert.equal(knowledgeEvents.length, 1);
    assert.equal(adapter.observedCells.has('-4,-5'), false);

    adapter.destroy({releaseBinding: true});
});

test('injects safe sampled terrain through native WebTiles map handling', () => {
    const ownerMaps = [];
    const ownerKnowledge = [];
    const harness = nativeMapHarness({
        onMap(payload) {
            ownerMaps.push(payload);
        },
        onKnowledge(cells) {
            ownerKnowledge.push(cells);
        }
    });
    const {adapter, cells, handledMessages, rendered, minimapUpdates, enums} = harness;

    assert.equal(adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {
            x: 1,
            y: 2,
            f: 17,
            mf: enums.MF_FLOOR,
            g: '#',
            col: 8,
            mon: {id: 99},
            cloud: 81,
            icons: [7],
            t: {
                bg: {value: 0x34, UNSEEN: false},
                fg: 52,
                cloud: 53,
                icons: [54],
                flv: {f: 61, s: 62, unsafe: 'drop'}
            }
        }
    }]), 1);

    adapter.setPredictions([{x: 10, y: 11, kind: 'floor'}]);
    adapter.setRevealEnabled(true);

    assert.equal(handledMessages.length, 1);
    assert.equal(handledMessages[0].msg, 'map');
    assert.equal(typeof handledMessages[0][SYNTHETIC_MAP_MARKER], 'string');
    assert.deepEqual(handledMessages[0].cells, [{
        x: 10,
        y: 11,
        mf: enums.MF_MAP_FLOOR,
        g: '#',
        col: 8,
        t: {
            bg: mapPredictorBackground(0x34),
            flv: {f: 61, s: 62}
        }
    }]);
    assert.deepEqual(cells.get('10,11'), {
        x: 10,
        y: 11,
        mf: enums.MF_MAP_FLOOR,
        g: '#',
        col: 8,
        t: {
            bg: mapPredictorBackground(0x34),
            flv: {f: 61, s: 62}
        },
        dirty: false
    });
    assert.equal(rendered.length, 1);
    assert.equal(minimapUpdates.length, 1);
    assert.deepEqual(ownerMaps, []);
    assert.deepEqual(ownerKnowledge, []);
    assert.equal(adapter.observedCells.size, 0);
    adapter.destroy();
});

test('uses mapped floor flags and a fixed closed-door tile without samples', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, handledMessages, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {
            f: 6,
            mf: enums.MF_FLOOR,
            t: {bg: 0x0004002A}
        }
    }]);

    const injected = adapter.applyNativePredictions([
        {x: 3, y: 4, kind: 'floor'},
        {x: 4, y: 4, kind: 'door'}
    ]);

    assert.equal(injected.length, 2);
    assert.equal(injected[0].mf, enums.MF_MAP_FLOOR);
    assert.deepEqual(injected[0].t.bg, mapPredictorBackground(0x2A));
    assert.deepEqual(injected[1], {
        x: 4,
        y: 4,
        mf: enums.MF_DOOR,
        t: {bg: mapPredictorBackground(0x11F)}
    });
    assert.equal(cells.get('3,4').mf, enums.MF_MAP_FLOOR);
    assert.equal(cells.get('4,4').mf, enums.MF_DOOR);
    assert.equal(handledMessages.length, 1);

    adapter.clearNativePredictions();
    const before = handledMessages.length;
    const reinjected = adapter.applyNativePredictions([
        {x: 8, y: 9, kind: 'door'}
    ]);
    assert.equal(reinjected.length, 1);
    assert.equal(reinjected[0].mf, enums.MF_DOOR);
    assert.equal(handledMessages.length, before + 1);
    assert.equal(cells.get('8,9').mf, enums.MF_DOOR);
    adapter.destroy();
});

test('fixed closed-door fallback requires both runtime constants and custom flag', () => {
    const missingTile = nativeMapHarness();
    delete missingTile.adapter.binding.dngn.DNGN_CLOSED_DOOR;
    assert.deepEqual(
        missingTile.adapter.applyNativePredictions([
            {x: 8, y: 9, kind: 'door'}
        ]),
        []
    );
    assert.equal(missingTile.cells.has('8,9'), false);
    assert.equal(missingTile.handledMessages.length, 0);
    missingTile.adapter.destroy();

    const missingFeature = nativeMapHarness();
    delete missingFeature.adapter.binding.enums.MF_DOOR;
    assert.deepEqual(
        missingFeature.adapter.applyNativePredictions([
            {x: 8, y: 9, kind: 'door'}
        ]),
        []
    );
    assert.equal(missingFeature.cells.has('8,9'), false);
    assert.equal(missingFeature.handledMessages.length, 0);
    missingFeature.adapter.destroy();

    const missingFlag = nativeMapHarness();
    delete missingFlag.adapter.binding.enums.DWEM_MAP_PREDICTOR_BG_FLAG;
    assert.deepEqual(
        missingFlag.adapter.applyNativePredictions([
            {x: 8, y: 9, kind: 'door'}
        ]),
        []
    );
    assert.equal(missingFlag.cells.has('8,9'), false);
    assert.equal(missingFlag.handledMessages.length, 0);
    missingFlag.adapter.destroy();
});

test('uses versioned fixed tiles for unseen water and lava without prior samples', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, enums} = harness;

    const injected = adapter.applyNativePredictions([
        {x: 1, y: 2, kind: 'shallow_water'},
        {x: 2, y: 2, kind: 'deep_water'},
        {x: 3, y: 2, kind: 'lava'},
        {x: 4, y: 2, kind: 'water'}
    ]);

    assert.deepEqual(injected, [
        {
            x: 1,
            y: 2,
            mf: enums.MF_WATER,
            t: {bg: mapPredictorBackground(0x120)}
        },
        {
            x: 2,
            y: 2,
            mf: enums.MF_DEEP_WATER,
            t: {bg: mapPredictorBackground(0x121)}
        },
        {
            x: 3,
            y: 2,
            mf: enums.MF_LAVA,
            t: {bg: mapPredictorBackground(0x122)}
        }
    ]);
    assert.equal(cells.get('1,2').mf, enums.MF_WATER);
    assert.equal(cells.get('2,2').mf, enums.MF_DEEP_WATER);
    assert.equal(cells.get('3,2').mf, enums.MF_LAVA);
    assert.equal(cells.has('4,2'), false);
    adapter.destroy();
});

test('never injects void or unknown predictions into native map knowledge', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, handledMessages, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {
            f: 6,
            mf: enums.MF_FLOOR,
            g: '.',
            col: 7,
            t: {bg: 0x2A}
        }
    }]);

    const injected = adapter.applyNativePredictions([
        {x: 1, y: 1, kind: 'void'},
        {x: 2, y: 1, kind: 'unknown'},
        {x: 3, y: 1, kind: 'unseen'},
        {x: 4, y: 1, kind: 'transparent'},
        {x: 5, y: 1, kind: 'floor'}
    ]);

    assert.deepEqual(injected.map(({x, y}) => `${x},${y}`), ['5,1']);
    assert.equal(handledMessages.length, 1);
    assert.deepEqual(
        handledMessages[0].cells.map(({x, y}) => `${x},${y}`),
        ['5,1']
    );
    for (let x = 1; x <= 4; x++) {
        assert.equal(cells.has(`${x},1`), false);
    }
    assert.equal(cells.get('5,1').mf, enums.MF_MAP_FLOOR);
    adapter.destroy();
});

test('observed closed-door samples override the fixed tile with native flavour', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, handledMessages, enums} = harness;
    assert.equal(adapter.rememberTerrainSamples([{
        kind: 'door',
        cell: {
            f: 19,
            mf: enums.MF_DOOR,
            g: '+',
            col: 6,
            t: {bg: 0x132}
        }
    }]), 1);

    const injected = adapter.applyNativePredictions([
        {x: -2, y: 7, kind: 'door'}
    ]);

    assert.deepEqual(injected, [{
        x: -2,
        y: 7,
        f: 19,
        mf: enums.MF_DOOR,
        g: '+',
        col: 6,
        t: {bg: mapPredictorBackground(0x132)}
    }]);
    assert.equal(cells.get('-2,7').mf, enums.MF_DOOR);
    assert.equal(handledMessages.length, 1);
    adapter.destroy();
});

test('special or occupied cells cannot replace terrain samples', () => {
    const harness = nativeMapHarness();
    const {adapter, enums} = harness;
    assert.equal(adapter.rememberTerrainSamples([
        {
            kind: 'floor',
            cell: {f: 6, mf: enums.MF_FLOOR, g: '.', t: {bg: 0x2A}}
        },
        {
            kind: 'wall',
            cell: {f: 17, mf: enums.MF_WALL, g: '#', t: {bg: 0x77}}
        }
    ]), 2);

    // Open doors/arches and trees are coarse matcher floor/wall kinds, but
    // their feature tiles live after WALL_MAX and must not become the visual
    // sample used for every inferred floor or wall.
    assert.equal(adapter.rememberTerrainSamples([
        {
            kind: 'floor',
            cell: {f: 23, mf: enums.MF_FLOOR, g: "'", t: {bg: 0x120}}
        },
        {
            kind: 'wall',
            cell: {f: 24, mf: enums.MF_WALL, g: '♣', t: {bg: 0x121}}
        },
        {
            kind: 'floor',
            cell: {f: 6, mf: enums.MF_ITEM, g: '!', t: {bg: 0x2B}}
        }
    ]), 0);

    const injected = adapter.applyNativePredictions([
        {x: 10, y: 10, kind: 'floor'},
        {x: 11, y: 10, kind: 'wall'}
    ]);
    assert.deepEqual(injected.map(cell => ({
        x: cell.x,
        y: cell.y,
        glyph: cell.g,
        background: cell.t.bg[0] & 0xFFFF
    })), [
        {x: 10, y: 10, glyph: '.', background: 0x2A},
        {x: 11, y: 10, glyph: '#', background: 0x77}
    ]);
    adapter.destroy();
});

test('level changes clear samples and a clear packet can repopulate them', () => {
    let adapterRef;
    const harness = nativeMapHarness({
        onKnowledge(cells) {
            adapterRef.rememberTerrainSamples(cells.flatMap(entry => {
                return entry.cell?.mf === harness.enums.MF_FLOOR
                    ? [{kind: 'floor', cell: entry.cell}]
                    : [];
            }));
        }
    });
    const {adapter, dwem, enums} = harness;
    adapterRef = adapter;

    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Dungeon',
        depth: 1
    });
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 0x2A}}
    }]);
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Dungeon',
        depth: 2
    });
    assert.deepEqual(
        adapter.applyNativePredictions([{x: 4, y: 4, kind: 'floor'}]),
        []
    );

    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        clear: true,
        cells: [{x: 1, y: 1, f: 6, mf: enums.MF_FLOOR, t: {bg: 0x35}}]
    });
    const injected = adapter.applyNativePredictions([
        {x: 5, y: 5, kind: 'floor'}
    ]);
    assert.equal(injected.length, 1);
    assert.equal(injected[0].t.bg[0] & 0xFFFF, 0x35);
    adapter.destroy();
});

test('native magic mapping injects only wall outlines beside predicted or observed open cells', () => {
    const dom = fakeDom();
    const harness = nativeMapHarness({}, {
        document: dom.document,
        window: dom.window
    });
    const {adapter, dwem, cells, handledMessages, enums} = harness;
    adapter.rememberTerrainSamples([
        {
            kind: 'floor',
            cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 0x2A}}
        },
        {
            kind: 'wall',
            cell: {f: 17, mf: enums.MF_WALL, t: {bg: 0x77}}
        }
    ]);

    // This authoritative floor is not part of the prediction set. It verifies
    // that server-observed open terrain also exposes the adjacent wall edge.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 20, y: 20, f: 6, mf: enums.MF_FLOOR, t: {bg: 0x2A}}]
    });
    handledMessages.length = 0;

    const injected = adapter.applyNativePredictions([
        {x: 10, y: 10, kind: 'floor'},
        {x: 11, y: 10, kind: 'wall'},
        {x: 12, y: 10, kind: 'wall'},
        {x: 21, y: 20, kind: 'wall'},
        {x: 22, y: 20, kind: 'wall'}
    ]);

    assert.deepEqual(injected.map(({x, y}) => `${x},${y}`), [
        '10,10',
        '11,10',
        '21,20'
    ]);
    assert.equal(handledMessages.length, 1);
    const nativePacket = handledMessages[0];
    assert.equal(typeof nativePacket[SYNTHETIC_MAP_MARKER], 'string');
    assert.deepEqual(nativePacket.cells.map(({x, y}) => `${x},${y}`), [
        '10,10',
        '11,10',
        '21,20'
    ]);
    assert.equal(nativePacket.cells[0].mf, enums.MF_MAP_FLOOR);
    assert.equal(nativePacket.cells[1].mf, enums.MF_MAP_WALL);
    assert.equal(nativePacket.cells[2].mf, enums.MF_MAP_WALL);
    for (const cell of nativePacket.cells) {
        assert.deepEqual(
            cell.t.bg,
            mapPredictorBackground(cell.t.bg[0])
        );
        assert.equal(cell.t.bg[0] & 0x00020000, 0);
    }

    // Only the first wall layer bordering open terrain is magic-mapped.
    assert.equal(cells.get('11,10').mf, enums.MF_MAP_WALL);
    assert.equal(cells.get('21,20').mf, enums.MF_MAP_WALL);
    assert.equal(cells.has('12,10'), false);
    assert.equal(cells.has('22,20'), false);

    // Native mode must not create either legacy transparent overlay canvas.
    assert.equal(dom.elements.has('map-predictor-dungeon-overlay'), false);
    assert.equal(dom.elements.has('map-predictor-minimap-overlay'), false);
    assert.equal(adapter.dungeonOverlay, null);
    assert.equal(adapter.minimapOverlay, null);
    adapter.destroy();
});

test('repairs a sparse real LOS diff after restoring its synthetic cell', () => {
    const ownerMaps = [];
    const ownerKnowledge = [];
    const harness = nativeMapHarness({
        onMap(payload) {
            ownerMaps.push(payload);
        },
        onKnowledge(cells) {
            ownerKnowledge.push(cells);
        }
    });
    const {adapter, dwem, cells, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 17, mf: enums.MF_FLOOR, t: {bg: 99}}
    }]);
    adapter.applyNativePredictions([{x: 20, y: 21, kind: 'floor'}]);
    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);

    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 20, y: 21, f: 23, g: '?', col: 3}]
    });

    assert.deepEqual(cells.get('20,21'), {
        x: 20,
        y: 21,
        t: {bg: 99},
        f: 23,
        g: '?',
        col: 3,
        dirty: false
    });
    assert.equal(ownerMaps.length, 1);
    assert.equal(ownerKnowledge.length, 1);
    assert.equal(ownerKnowledge[0][0].cell.mf, undefined);
    assert.deepEqual(ownerKnowledge[0][0].cell.t, {bg: 99});
    assert.equal(ownerKnowledge[0][0].cell.t.bg & 0x00020000, 0);
    assert.equal(ownerKnowledge[0][0].terrainReliable, false);
    assert.equal(adapter._unreliableTerrainCells.has('20,21'), true);

    // The server-owned cell was removed from the synthetic registry, so a
    // later rollback cannot overwrite the new authoritative knowledge.
    adapter.clearNativePredictions();
    assert.equal(cells.get('20,21').f, 23);
    adapter.destroy({releaseBinding: false});
    assert.equal(adapter._unreliableTerrainCells.has('20,21'), true);
    adapter.install();
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Dungeon',
        depth: 1
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'player',
        place: 'Dungeon',
        depth: 2
    });
    assert.equal(adapter._unreliableTerrainCells.has('20,21'), false);
    adapter.destroy();
});

test('a real LOS terrain delta takes ownership from a stale prediction', () => {
    const harness = nativeMapHarness();
    const {adapter, dwem, cells, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 17, mf: enums.MF_FLOOR, t: {bg: 99}}
    }]);
    adapter.setPredictions([{x: 20, y: 21, kind: 'floor'}]);
    adapter.setRevealEnabled(true);
    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);

    // Entering LOS changes both map knowledge and the screen background. The
    // prediction must be restored before this authoritative diff is merged,
    // and the stale prediction list must not be re-applied afterward.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{
            x: 20,
            y: 21,
            f: 23,
            mf: enums.MF_FLOOR,
            g: '.',
            col: 7,
            t: {bg: 0x35}
        }]
    });

    assert.equal(cells.get('20,21').t.bg, 0x35);
    assert.equal(cells.get('20,21').t.bg & 0x00020000, 0);
    assert.equal(cells.get('20,21').mf, enums.MF_FLOOR);
    assert.equal(adapter._nativeCells.has('20,21'), false);

    // Re-emitting the still-stale prediction result must continue to respect
    // the now-visible server cell rather than turning it into magic mapping.
    adapter.setPredictions([{x: 20, y: 21, kind: 'floor'}]);
    assert.equal(cells.get('20,21').t.bg, 0x35);
    assert.equal(cells.get('20,21').mf, enums.MF_FLOOR);
    assert.equal(adapter._nativeCells.has('20,21'), false);
    adapter.destroy();
});

test('screen-only visible terrain is server knowledge and is never overpainted', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 17, mf: enums.MF_FLOOR, t: {bg: 99}}
    }]);

    // WebTiles may omit unchanged f/mf fields while still retaining a real
    // visible tile background in map_knowledge.
    cells.set('20,21', {
        x: 20,
        y: 21,
        f: 0,
        mf: enums.MF_UNSEEN,
        t: {bg: 0x35}
    });
    assert.deepEqual(adapter.applyNativePredictions([
        {x: 20, y: 21, kind: 'floor'}
    ]), []);
    assert.equal(cells.get('20,21').t.bg, 0x35);
    assert.equal(adapter._nativeCells.has('20,21'), false);

    // A real magic-mapped base tile is also known, even when f/mf happen to be
    // absent. A flag without a base tile remains truly unseen and injectable.
    cells.set('22,21', {
        x: 22,
        y: 21,
        f: 0,
        mf: enums.MF_UNSEEN,
        t: {bg: 0x35 | 0x00020000}
    });
    cells.set('23,21', {
        x: 23,
        y: 21,
        f: 0,
        mf: enums.MF_UNSEEN,
        t: {bg: 0x00040000}
    });
    const injected = adapter.applyNativePredictions([
        {x: 22, y: 21, kind: 'floor'},
        {x: 23, y: 21, kind: 'floor'}
    ]);
    assert.deepEqual(injected.map(({x, y}) => ({x, y})), [
        {x: 23, y: 21}
    ]);
    assert.equal(cells.get('22,21').t.bg, 0x35 | 0x00020000);
    assert.equal(cells.get('23,21').mf, enums.MF_MAP_FLOOR);
    adapter.destroy();
});

test('reapplies a revealed cell after an unseen X-mode server redraw', () => {
    const harness = nativeMapHarness();
    const {adapter, dwem, cells, enums} = harness;
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 17, mf: enums.MF_FLOOR, t: {bg: 99}}
    }]);
    adapter.setPredictions([{x: 20, y: 21, kind: 'floor'}]);
    adapter.setRevealEnabled(true);
    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);

    // X mode can redraw an unknown server cell without making it known. The
    // client-only prediction should survive that redraw and remain reversible.
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{
            x: 20,
            y: 21,
            f: 0,
            mf: enums.MF_UNSEEN,
            t: {bg: 0x00040000}
        }]
    });

    assert.equal(cells.get('20,21').mf, enums.MF_MAP_FLOOR);
    adapter.setRevealEnabled(false);
    assert.deepEqual(cells.get('20,21'), {
        x: 20,
        y: 21,
        f: 0,
        mf: enums.MF_UNSEEN,
        t: {bg: 0x00040000},
        dirty: false
    });
    adapter.destroy();
});

test('keeps X-mode cursor movement client-only beyond the server map bounds', () => {
    const jqueryEvents = fakeJqueryEvents();
    const cursorCalls = [];
    const removedCursors = [];
    const blocked = [];
    const document = {};
    const viewData = {
        place_cursor(id, location) {
            cursorCalls.push({id, location: structuredClone(location)});
        },
        remove_cursor(id) {
            removedCursors.push(id);
        }
    };
    const harness = nativeMapHarness({
        onShadowCursorBlocked(payload) {
            blocked.push(payload);
        }
    }, {document}, {
        jquery: jqueryEvents.jquery,
        viewData
    });
    const {adapter, dwem, cells, enums, sentMessages} = harness;
    assert.equal(jqueryEvents.registrations.length, 1);

    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 10, y: 10, f: 6, mf: enums.MF_FLOOR, t: {bg: 42}}]
    });
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 42}}
    }]);
    adapter.setPredictions([{x: 12, y: 10, kind: 'floor'}]);
    adapter.setRevealEnabled(true);
    assert.equal(cells.has('11,10'), false);
    assert.equal(cells.get('12,10').mf, enums.MF_MAP_FLOOR);

    dwem.Modules.IOHook.handle_message({
        msg: 'ui_state',
        state: enums.ui.VIEW_MAP
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'cursor',
        id: enums.CURSOR_MAP,
        loc: {x: 10, y: 10}
    });

    // Native X mode traverses black holes inside its rectangular map bounds.
    // The first cell beyond the server bounds is intentionally not injected;
    // a farther active prediction still extends the client rectangle over it.
    // A diagonal step is independently clamped to each rectangle: the server
    // stays at (10,10), while the wider client rectangle advances to (11,10).
    const firstMove = jqueryEvents.trigger('game_keydown', {
        which: 34,
        code: 'PageDown',
        originalEvent: {code: 'PageDown'}
    });
    assert.equal(firstMove.prevented, true);
    assert.equal(firstMove.stopped, true);
    assert.deepEqual(cursorCalls.at(-1), {
        id: enums.CURSOR_MAP,
        location: {x: 11, y: 10}
    });

    // A duplicate/delayed packet for the unchanged server anchor must not
    // erase the locally advanced cursor after the native handler draws it.
    dwem.Modules.IOHook.handle_message({
        msg: 'cursor',
        id: enums.CURSOR_MAP,
        loc: {x: 10, y: 10}
    });
    assert.deepEqual(cursorCalls.at(-1).location, {x: 11, y: 10});

    const secondMove = jqueryEvents.trigger('game_keypress', {which: 108});
    assert.equal(secondMove.prevented, true);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 12, y: 10});

    const callsAtClientEdge = cursorCalls.length;
    const clampedAtClientEdge = jqueryEvents.trigger('game_keydown', {
        which: 34,
        code: 'PageDown'
    });
    assert.equal(clampedAtClientEdge.prevented, true);
    assert.equal(clampedAtClientEdge.stopped, true);
    assert.equal(cursorCalls.length, callsAtClientEdge);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 12, y: 10});

    // Selection, travel, and description input never reaches the server while
    // the visible cursor points at client-only knowledge.
    const enter = jqueryEvents.trigger('game_keypress', {which: 13});
    assert.equal(enter.prevented, true);
    assert.equal(enter.stopped, true);
    assert.equal(blocked.at(-1).reason, 'client-only-cursor');
    assert.deepEqual(cursorCalls.at(-1).location, {x: 12, y: 10});

    // Walking back to the exact authoritative anchor is also local. From the
    // anchor, ordinary server-owned movement remains untouched.
    jqueryEvents.trigger('game_keydown', {which: 37, code: 'ArrowLeft'});
    const returnToAnchor = jqueryEvents.trigger('game_keydown', {
        which: 37,
        code: 'ArrowLeft'
    });
    assert.equal(returnToAnchor.prevented, true);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 10, y: 10});
    const nativeMove = jqueryEvents.trigger('game_keydown', {
        which: 37,
        code: 'ArrowLeft'
    });
    assert.equal(nativeMove.prevented, false);
    assert.equal(nativeMove.stopped, false);

    jqueryEvents.trigger('game_keydown', {which: 39, code: 'ArrowRight'});
    const xKeydown = jqueryEvents.trigger('game_keydown', {
        which: 88,
        shiftKey: true,
        code: 'KeyX'
    });
    assert.equal(xKeydown.prevented, false);
    const xKeypress = jqueryEvents.trigger('game_keypress', {
        which: 88,
        shiftKey: true
    });
    assert.equal(xKeypress.prevented, true);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 11, y: 10});
    const exit = jqueryEvents.trigger('game_keydown', {
        which: 27,
        code: 'Escape'
    });
    assert.equal(exit.prevented, false);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 10, y: 10});

    // Hybrid/mobile helpers bypass game_key events and call comm directly.
    // They remain blocked at a client-only cursor, while their Escape key
    // restores the real anchor and is allowed through to leave X mode.
    jqueryEvents.trigger('game_keydown', {which: 39, code: 'ArrowRight'});
    assert.equal(dwem.Modules.IOHook.send_message('input', {text: '.'}), false);
    assert.equal(
        dwem.Modules.IOHook.send_message('text_input', {text: 'x'}),
        false
    );
    assert.equal(
        dwem.Modules.IOHook.send_message('key', {keycode: 13}),
        false
    );
    assert.deepEqual(sentMessages, []);
    assert.equal(
        dwem.Modules.IOHook.send_message('key', {keycode: 27}),
        true
    );
    assert.deepEqual(sentMessages, [{
        message: 'key',
        data: {keycode: 27}
    }]);
    assert.deepEqual(cursorCalls.at(-1).location, {x: 10, y: 10});

    jqueryEvents.trigger('game_keydown', {which: 39, code: 'ArrowRight'});
    dwem.Modules.IOHook.handle_message({
        msg: 'ui_state',
        state: enums.ui.NORMAL
    });
    assert.deepEqual(removedCursors, [enums.CURSOR_MAP]);

    adapter.destroy();
    assert.equal(jqueryEvents.registrations.length, 0);
});

test('rebinding during an X-mode shadow discards the stale server anchor', () => {
    const jqueryEvents = fakeJqueryEvents();
    const removedCursors = [];
    const document = {};
    const viewData = {
        place_cursor() {},
        remove_cursor(id) {
            removedCursors.push(id);
        }
    };
    const harness = nativeMapHarness({}, {document}, {
        jquery: jqueryEvents.jquery,
        viewData
    });
    const {adapter, dwem, enums} = harness;
    dwem.Modules.IOHook.handle_message({
        msg: 'map',
        cells: [{x: 4, y: 5, f: 6, mf: enums.MF_FLOOR, t: {bg: 42}}]
    });
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 42}}
    }]);
    adapter.setPredictions([{x: 5, y: 5, kind: 'floor'}]);
    adapter.setRevealEnabled(true);
    dwem.Modules.IOHook.handle_message({
        msg: 'ui_state',
        state: enums.ui.VIEW_MAP
    });
    dwem.Modules.IOHook.handle_message({
        msg: 'cursor',
        id: enums.CURSOR_MAP,
        loc: {x: 4, y: 5}
    });
    assert.equal(jqueryEvents.trigger('game_keydown', {
        which: 39,
        code: 'ArrowRight'
    }).prevented, true);

    const oldBinding = adapter.binding;
    adapter.bindWebtiles({
        ...oldBinding,
        renderer: {
            ...oldBinding.renderer,
            ui_state: enums.ui.VIEW_MAP
        }
    });
    assert.deepEqual(removedCursors, [enums.CURSOR_MAP]);
    assert.equal(adapter._xModeActive, true);
    assert.equal(adapter._shadowMapCursor, null);
    assert.equal(adapter._serverMapCursor, null);
    assert.equal(jqueryEvents.registrations.length, 1);

    // Recreate the visual prediction on the new binding. It still must not
    // consume input until that binding receives its own authoritative cursor.
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 6, mf: enums.MF_FLOOR, t: {bg: 42}}
    }]);
    adapter.applyNativePredictions(adapter.predictions);
    assert.equal(jqueryEvents.trigger('game_keydown', {
        which: 39,
        code: 'ArrowRight'
    }).prevented, false);

    dwem.Modules.IOHook.handle_message({
        msg: 'cursor',
        id: enums.CURSOR_MAP,
        loc: {x: 4, y: 5}
    });
    assert.equal(jqueryEvents.trigger('game_keydown', {
        which: 39,
        code: 'ArrowRight'
    }).prevented, true);

    adapter.destroy();
    assert.equal(jqueryEvents.registrations.length, 0);
});

test('rolls native predictions back on clear, disable, and result revoke', () => {
    const harness = nativeMapHarness();
    const {adapter, cells, handledMessages, rendered, minimapUpdates, enums} = harness;
    const original = {x: 30, y: 31};
    cells.set('30,31', structuredClone(original));
    adapter.rememberTerrainSamples([{
        kind: 'floor',
        cell: {f: 17, mf: enums.MF_FLOOR, t: {bg: 99}}
    }]);

    adapter.applyNativePredictions([{x: 30, y: 31, kind: 'floor'}]);
    const renderedAfterInjection = rendered.length;
    const minimapAfterInjection = minimapUpdates.length;
    assert.equal(adapter.clearNativePredictions().length, 1);
    assert.deepEqual(cells.get('30,31'), original);
    assert.ok(rendered.length > renderedAfterInjection);
    assert.ok(minimapUpdates.length > minimapAfterInjection);
    assert.ok(handledMessages.every(message => {
        return typeof message[SYNTHETIC_MAP_MARKER] === 'string';
    }));

    adapter.setPredictions([{x: 30, y: 31, kind: 'floor'}]);
    adapter.setRevealEnabled(true);
    assert.equal(cells.get('30,31').mf, enums.MF_MAP_FLOOR);
    adapter.setRevealEnabled(false);
    assert.deepEqual(cells.get('30,31'), original);

    adapter.setRevealEnabled(true);
    assert.equal(cells.get('30,31').mf, enums.MF_MAP_FLOOR);
    adapter.clearPredictions();
    assert.deepEqual(cells.get('30,31'), original);
    assert.deepEqual(adapter.predictions, []);
    adapter.destroy();
});

test('soft pause clears native state and the retained binding can reveal again', () => {
    const {adapter, cells} = nativeMapHarness();
    const original = {x: 18, y: 19};
    cells.set('18,19', structuredClone(original));

    adapter.setPredictions([{x: 18, y: 19, kind: 'door'}]);
    adapter.setRevealEnabled(true);
    assert.notDeepEqual(cells.get('18,19'), original);

    const binding = adapter.binding;
    adapter.destroy({releaseBinding: false});
    assert.deepEqual(cells.get('18,19'), original);
    assert.equal(adapter.binding, binding);
    assert.deepEqual(adapter.predictions, []);
    assert.equal(adapter.observedCells.size, 0);

    adapter.install();
    adapter.setPredictions([{x: 18, y: 19, kind: 'door'}]);
    adapter.setRevealEnabled(true);
    assert.notDeepEqual(cells.get('18,19'), original);
    adapter.destroy();
    assert.deepEqual(cells.get('18,19'), original);
    assert.equal(adapter.binding, null);
});

test('a cached minimap factory broker survives only a soft pause', () => {
    class CellRenderer {
        do_render_cell() {
            return 'base';
        }
    }
    const originalRenderer = CellRenderer.prototype.do_render_cell;
    const renderer = new CellRenderer();
    const firstKnowledge = {get() {}};
    const secondKnowledge = {get() {}};
    const enums = {
        DWEM_MAP_PREDICTOR_BG_FLAG: MAP_PREDICTOR_FLAG.slice()
    };
    let liveBinding = {
        mapKnowledge: firstKnowledge,
        renderer,
        enums
    };
    let bindCalls = 0;
    const firstOwner = {};
    const {dwem} = fakeDwem(firstOwner);
    // This represents the closure installed by the minimap AMD factory. The
    // factory runs once, but exposes only live WebTiles module handles.
    dwem.MapPredictorWebtilesBindingBroker = {
        bind(adapter) {
            bindCalls++;
            adapter.bindWebtiles(liveBinding);
            return true;
        }
    };

    const first = new WebtilesAdapter(firstOwner, {dwem});
    first.install();
    const firstTintState = CellRenderer.prototype.__dwemMapPredictorTintState;
    assert.equal(first.binding.mapKnowledge, firstKnowledge);
    assert.equal(firstTintState.mapKnowledge, firstKnowledge);

    first.destroy({releaseBinding: false});
    assert.equal(first.binding.mapKnowledge, firstKnowledge);
    assert.equal(firstTintState.mapKnowledge, null);
    assert.equal(CellRenderer.prototype.do_render_cell, originalRenderer);
    assert.equal(
        Object.hasOwn(CellRenderer.prototype, '__dwemMapPredictorTintState'),
        false
    );

    liveBinding = {
        mapKnowledge: secondKnowledge,
        renderer,
        enums
    };
    first.install();

    assert.equal(bindCalls, 2);
    assert.equal(first.binding.mapKnowledge, secondKnowledge);
    assert.notEqual(first.binding.mapKnowledge, firstKnowledge);
    assert.equal(
        CellRenderer.prototype.__dwemMapPredictorTintState.mapKnowledge,
        secondKnowledge
    );

    first.destroy({releaseBinding: true});
    assert.equal(first.binding, null);
    assert.equal(dwem.MapPredictorWebtilesBindingBroker, undefined);
    assert.equal(CellRenderer.prototype.do_render_cell, originalRenderer);
    assert.equal(
        Object.hasOwn(CellRenderer.prototype, '__dwemMapPredictorTintState'),
        false
    );
});

test('RC false first game can attach to already-cached same-version modules', () => {
    class CellRenderer {
        do_render_cell() {
            return 'base';
        }
    }
    const originalRenderer = CellRenderer.prototype.do_render_cell;
    const renderer = new CellRenderer();
    renderer.ui_state = 0;
    const originalVisible = () => true;
    const mapKnowledge = {
        get() {
            return {x: 0, y: 0};
        },
        visible: originalVisible
    };
    const enums = {
        ui: {NORMAL: 0, VIEW_MAP: 2},
        prepare_bg_flags(background) {
            background.value = background[0] & 0xFFFF;
            return background;
        }
    };
    const prefix = 'game-trunk/';
    const minimap = {
        update() {},
        center() {},
        clear() {},
        do_view_center_update() {},
        stop_minimap_farview() {}
    };
    const defined = {
        [`${prefix}map_knowledge`]: mapKnowledge,
        [`${prefix}dungeon_renderer`]: renderer,
        [`${prefix}cell_renderer`]: {DungeonCellRenderer: CellRenderer},
        [`${prefix}enums`]: enums,
        [`${prefix}tileinfo-dngn`]: {},
        [`${prefix}player`]: {},
        [`${prefix}view_data`]: {},
        [`${prefix}minimap`]: minimap,
        jquery: () => ({on() {}, off() {}})
    };
    const owner = {};
    const {dwem} = fakeDwem(owner);
    const window = {
        requirejs: {
            s: {contexts: {_: {defined}}}
        },
        addEventListener() {},
        removeEventListener() {}
    };

    // No adapter or mapper existed while the first game ran with RC false.
    const first = new WebtilesAdapter(owner, {dwem, window});
    first.install();
    const flag = enums.DWEM_MAP_PREDICTOR_BG_FLAG;
    assert.deepEqual(flag, MAP_PREDICTOR_FLAG);
    assert.equal(first.binding.mapKnowledge, mapKnowledge);
    assert.equal(
        mapKnowledge.visible({t: {bg: [0x35, flag[1]]}}),
        false
    );
    assert.notEqual(CellRenderer.prototype.do_render_cell, originalRenderer);

    first.destroy({releaseBinding: true});
    assert.equal(dwem.MapPredictorWebtilesBindingBroker, undefined);
    assert.equal(enums.DWEM_MAP_PREDICTOR_BG_FLAG, undefined);
    assert.equal(mapKnowledge.visible, originalVisible);
    assert.equal(
        dwem.MapPredictorKnowledgeVisibilityBroker,
        undefined
    );
    assert.equal(CellRenderer.prototype.do_render_cell, originalRenderer);

    // The AMD factories remain cached. Their minimal broker must reinstall
    // reversible hooks and bind a clean adapter for the following game.
    const second = new WebtilesAdapter({}, {dwem, window});
    second.install();
    assert.deepEqual(enums.DWEM_MAP_PREDICTOR_BG_FLAG, flag);
    assert.equal(second.binding.mapKnowledge, mapKnowledge);
    assert.equal(
        mapKnowledge.visible({t: {bg: [0x35, flag[1]]}}),
        false
    );
    assert.notEqual(CellRenderer.prototype.do_render_cell, originalRenderer);
    second.destroy({releaseBinding: true});
    assert.equal(dwem.MapPredictorWebtilesBindingBroker, undefined);
    assert.equal(enums.DWEM_MAP_PREDICTOR_BG_FLAG, undefined);
    assert.equal(mapKnowledge.visible, originalVisible);
    assert.equal(
        dwem.MapPredictorKnowledgeVisibilityBroker,
        undefined
    );
    assert.equal(CellRenderer.prototype.do_render_cell, originalRenderer);
});

test('draws predictions on separate transparent dungeon and minimap canvases', () => {
    const dom = fakeDom();
    const {dwem} = fakeDwem();
    const adapter = new WebtilesAdapter(null, {
        dwem,
        document: dom.document,
        window: dom.window,
        nativeMode: false
    });
    const mapKnowledge = {
        get() {
            assert.fail('drawing predictions must not query or mutate map knowledge');
        }
    };
    const renderer = {
        element: dom.dungeon,
        in_view() {
            return true;
        },
        canvas_coords(x, y) {
            return {x: x * 10, y: y * 10, width: 10, height: 10};
        }
    };
    adapter.bindWebtiles({
        mapKnowledge,
        renderer,
        enums: {},
        getMinimapProjection() {
            return {
                cellWidth: 2,
                cellHeight: 2,
                cellX: 0,
                cellY: 0,
                displayX: 0,
                displayY: 0,
                enabled: true
            };
        }
    });
    adapter.setPredictions([
        {x: 2, y: 2, kind: 'floor', confidence: 0.8},
        {x: 3, y: 2, kind: 'wall', confidence: 1}
    ]);
    adapter.setRevealEnabled(true);

    const dungeonOverlay = dom.elements.get('map-predictor-dungeon-overlay');
    const minimapOverlay = dom.elements.get('map-predictor-minimap-overlay');
    assert.ok(dungeonOverlay);
    assert.ok(minimapOverlay);
    assert.equal(dungeonOverlay.style.pointerEvents, 'none');
    assert.equal(minimapOverlay.style.pointerEvents, 'none');
    assert.equal(
        dungeonOverlay.context.calls.filter(([name]) => name === 'fillRect').length,
        2
    );
    assert.equal(
        minimapOverlay.context.calls.filter(([name]) => name === 'fillRect').length,
        2
    );

    const dungeonFillCount = dungeonOverlay.context.calls
        .filter(([name]) => name === 'fillRect').length;
    const offLevel = {
        msg: 'map',
        clear: true,
        player_on_level: false,
        cells: []
    };
    adapter.handleMessageBefore(offLevel);
    adapter.handleMessageAfter(offLevel);
    adapter.setPredictions([{x: 7, y: 7, kind: 'floor', confidence: 1}]);
    assert.equal(adapter.playerOnLevel, false);
    assert.equal(
        dungeonOverlay.context.calls.filter(([name]) => name === 'fillRect').length,
        dungeonFillCount
    );
    assert.ok(dungeonOverlay.context.calls.some(([name]) => name === 'clearRect'));

    const returnToLevel = {
        msg: 'map',
        clear: true,
        player_on_level: true,
        cells: []
    };
    adapter.handleMessageBefore(returnToLevel);
    adapter.handleMessageAfter(returnToLevel);
    assert.equal(adapter.playerOnLevel, true);
    assert.equal(
        dungeonOverlay.context.calls.filter(([name]) => name === 'fillRect').length,
        dungeonFillCount + 1
    );

    adapter.setRevealEnabled(false);
    assert.equal(
        dungeonOverlay.context.calls.filter(([name]) => name === 'fillRect').length,
        dungeonFillCount + 1
    );
    assert.ok(dungeonOverlay.context.calls.some(([name]) => name === 'clearRect'));

    adapter.destroy();
    assert.equal(dom.elements.has('map-predictor-dungeon-overlay'), false);
    assert.equal(dom.elements.has('map-predictor-minimap-overlay'), false);
});
