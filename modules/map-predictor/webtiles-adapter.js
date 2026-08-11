const HANDLER_ID = 'map-predictor-webtiles-adapter';
// TranslationModule mutates incoming packets at the default priority (0).
// Match SoundSupport's priority so MapPredictor captures the raw wire version
// and place before any localized text replaces them.
const RAW_WIRE_CAPTURE_PRIORITY = 1;
const DUNGEON_OVERLAY_ID = 'map-predictor-dungeon-overlay';
const MINIMAP_OVERLAY_ID = 'map-predictor-minimap-overlay';
const DEFAULT_MAX_ABS_COORDINATE = 32767;
const UNSEEN = 0x00040000;
const BASE_TILE_MASK = 0x0000FFFF;
const MAP_PREDICTOR_BG_FLAG_EXPORT = 'DWEM_MAP_PREDICTOR_BG_FLAG';
const MAP_PREDICTOR_TINT = 'rgba(105, 92, 78, 0.24)';
const SHADOW_CURSOR_EVENT_NAMESPACE = '.mapPredictorShadowCursor';
const SHADOW_CURSOR_EVENTS = [
    `game_keydown${SHADOW_CURSOR_EVENT_NAMESPACE}`,
    `game_keypress${SHADOW_CURSOR_EVENT_NAMESPACE}`
].join(' ');
const NATIVE_SAFE_TERRAIN_KINDS = new Set([
    'floor',
    'wall',
    'door',
    'shallow_water',
    'deep_water',
    'lava'
]);
export const SYNTHETIC_MAP_MARKER = '__dwemMapPredictorSynthetic';
const SYNTHETIC_MAP_MARKER_VALUE = 'native-map-v1';

/**
 * Reserve a client-only background flag in WebTiles' second flag word.
 *
 * The first word contains the 16-bit dungeon tile id and all server background
 * flags. Keeping our marker in the second word means it can never change the
 * base tile selected by dngn.basetile(). The bit is chosen at runtime from the
 * exact client enum table and installation fails closed if no free bit exists.
 * This function is also serialized into the WebTiles `./enums` AMD closure.
 */
export function installMapPredictorBackgroundFlag(exportsObject, flagData) {
    if (!exportsObject || !flagData || typeof flagData !== 'object'
        || !flagData.flags || typeof flagData.flags !== 'object') {
        return null;
    }

    const exportName = 'DWEM_MAP_PREDICTOR_BG_FLAG';
    const propertyName = 'DWEM_MAP_PREDICTED';
    const existing = exportsObject[exportName];
    if (Array.isArray(existing)
        && existing[0] === 0
        && Number.isSafeInteger(existing[1])
        && existing[1] > 0) {
        return existing;
    }

    let usedSecondWord = 0;
    const includeMask = value => {
        if (Array.isArray(value) && Number.isSafeInteger(value[1])) {
            usedSecondWord |= value[1];
        }
    };
    for (const value of Object.values(flagData.flags)) {
        includeMask(value);
    }
    for (const exclusive of flagData.exclusive_flags || []) {
        if (!exclusive || typeof exclusive !== 'object') {
            continue;
        }
        includeMask(exclusive.mask);
        for (const [name, value] of Object.entries(exclusive)) {
            if (name !== 'mask') {
                includeMask(value);
            }
        }
    }

    // Avoid the sign bit so the packed JSON value remains an ordinary positive
    // integer on every browser supported by WebTiles.
    let selected = 0;
    for (let candidate = 0x40000000;
        candidate >= 0x00010000;
        candidate >>>= 1) {
        if ((usedSecondWord & candidate) === 0) {
            selected = candidate;
            break;
        }
    }
    if (selected === 0) {
        exportsObject[exportName] = null;
        return null;
    }

    const packedFlag = [0, selected];
    flagData.flags[propertyName] = packedFlag;
    exportsObject[exportName] = packedFlag;
    return packedFlag;
}

/** Reserve a collision-free flag when the cached enums factory already ran. */
export function installMapPredictorBackgroundFlagFromExports(exportsObject) {
    if (!exportsObject || typeof exportsObject.prepare_bg_flags !== 'function') {
        return null;
    }
    const exportName = 'DWEM_MAP_PREDICTOR_BG_FLAG';
    const existing = exportsObject[exportName];
    if (Array.isArray(existing)
        && existing[0] === 0
        && Number.isSafeInteger(existing[1])
        && existing[1] > 0) {
        return existing;
    }

    let selected = 0;
    for (let candidate = 0x40000000;
        candidate >= 0x00010000;
        candidate >>>= 1) {
        let prepared;
        try {
            prepared = exportsObject.prepare_bg_flags([0, candidate]);
        } catch (error) {
            return null;
        }
        if (!prepared || typeof prepared !== 'object') {
            return null;
        }
        const collides = Object.entries(prepared).some(([name, value]) => {
            return name !== '0' && name !== '1' && name !== 'value'
                && value === true;
        });
        if (!collides) {
            selected = candidate;
            break;
        }
    }
    if (selected === 0) {
        exportsObject[exportName] = null;
        return null;
    }
    const packedFlag = [0, selected];
    exportsObject[exportName] = packedFlag;
    return packedFlag;
}

export function installMapPredictorBackgroundFlagBroker(
    dwem,
    exportsObject,
    flagData,
    installerOrFlag
) {
    if (!dwem || !exportsObject) {
        return null;
    }
    const packedFlag = typeof installerOrFlag === 'function'
        ? installerOrFlag(exportsObject, flagData)
        : installerOrFlag;
    if (!Array.isArray(packedFlag)
        || packedFlag[0] !== 0
        || !Number.isSafeInteger(packedFlag[1])
        || packedFlag[1] <= 0) {
        return null;
    }
    const brokerProperty = 'MapPredictorBackgroundFlagBroker';
    const exportName = 'DWEM_MAP_PREDICTOR_BG_FLAG';
    const flagName = 'DWEM_MAP_PREDICTED';
    dwem[brokerProperty]?.uninstall?.();
    const broker = {
        active: false,
        packedFlag,
        install() {
            if (flagData?.flags) {
                flagData.flags[flagName] = packedFlag;
            }
            exportsObject[exportName] = packedFlag;
            this.active = true;
            return true;
        },
        uninstall() {
            if (flagData?.flags?.[flagName] === packedFlag) {
                delete flagData.flags[flagName];
            }
            if (exportsObject[exportName] === packedFlag) {
                delete exportsObject[exportName];
            }
            this.active = false;
            return true;
        }
    };
    dwem[brokerProperty] = broker;
    broker.install();
    return broker;
}

/** Keep synthetic cells out of WebTiles' "currently visible" semantics. */
export function wrapMapPredictorKnowledgeVisibility(original, enums) {
    if (typeof original !== 'function') {
        return original;
    }
    return function (...args) {
        const background = args[0]?.t?.bg;
        const flag = enums?.DWEM_MAP_PREDICTOR_BG_FLAG;
        const marked = background?.DWEM_MAP_PREDICTED === true
            || (Array.isArray(background)
                && Array.isArray(flag)
                && Number.isSafeInteger(background[1])
                && Number.isSafeInteger(flag[1])
                && (background[1] & flag[1]) !== 0);
        return marked ? false : original.apply(this, args);
    };
}

/**
 * Keep the map_knowledge patch reversible even when RequireJS retains the
 * module factory result across games. The broker owns only functions/enums;
 * it never captures cells or the map-knowledge object itself.
 */
export function installMapPredictorKnowledgeVisibilityBroker(
    dwem,
    original,
    enums,
    wrapperFactory,
    applyVisible
) {
    if (!dwem || typeof original !== 'function'
        || typeof wrapperFactory !== 'function'
        || typeof applyVisible !== 'function') {
        return null;
    }
    const property = 'MapPredictorKnowledgeVisibilityBroker';
    dwem[property]?.uninstall?.();
    const broker = {
        active: false,
        original,
        enums,
        wrapper: null,
        install() {
            if (!this.active) {
                this.wrapper = wrapperFactory(this.original, this.enums);
                applyVisible(this.wrapper);
                this.active = true;
            }
            return true;
        },
        uninstall() {
            if (this.active) {
                applyVisible(this.original);
                this.active = false;
                this.wrapper = null;
            }
            return true;
        }
    };
    dwem[property] = broker;
    broker.install();
    return broker;
}

/**
 * Add the subdued warm-gray tint directly to DungeonCellRenderer's normal cell draw.
 * No auxiliary dungeon/minimap canvas is involved. The marker remains packed
 * in the cell background and therefore survives normal map/X-view redraws.
 * This function is serialized into the WebTiles `./cell_renderer` closure.
 */
export function installMapPredictorRendererTint(
    DungeonCellRenderer,
    enums,
    mapKnowledge,
    tint = 'rgba(105, 92, 78, 0.24)'
) {
    const prototype = DungeonCellRenderer?.prototype;
    const flag = enums?.DWEM_MAP_PREDICTOR_BG_FLAG;
    if (!prototype || typeof prototype.do_render_cell !== 'function'
        || !Array.isArray(flag)
        || flag[0] !== 0
        || !Number.isSafeInteger(flag[1])
        || flag[1] <= 0) {
        return false;
    }
    const stateProperty = '__dwemMapPredictorTintState';
    const installed = prototype[stateProperty];
    if (installed && prototype.do_render_cell === installed.wrapper) {
        installed.enums = enums;
        installed.mapKnowledge = mapKnowledge;
        installed.tint = tint;
        return true;
    }

    const original = prototype.do_render_cell;
    const state = {
        original,
        wrapper: null,
        enums,
        mapKnowledge,
        tint
    };
    state.wrapper = function (...args) {
        const active = prototype[stateProperty];
        const result = original.apply(this, args);
        if (!active || active.wrapper !== state.wrapper) {
            return result;
        }
        const [cx, cy, x, y, suppliedMapCell, suppliedCell] = args;
        let mapCell = suppliedMapCell;
        if (!mapCell && typeof active.mapKnowledge?.get === 'function') {
            mapCell = active.mapKnowledge.get(cx, cy);
        }
        const cell = suppliedCell || mapCell?.t;
        const background = cell?.bg;
        const activeFlag = active.enums?.DWEM_MAP_PREDICTOR_BG_FLAG;
        const marked = Array.isArray(background)
            && Array.isArray(activeFlag)
            && Number.isSafeInteger(background[1])
            && Number.isSafeInteger(activeFlag[1])
            && (background[1] & activeFlag[1]) !== 0;
        if (!marked || !this.ctx
            || typeof this.ctx.fillRect !== 'function') {
            return result;
        }

        const scaled = typeof this.scaled_size === 'function'
            ? this.scaled_size()
            : {
                width: this.cell_width,
                height: this.cell_height
            };
        if (!Number.isFinite(scaled?.width)
            || !Number.isFinite(scaled?.height)) {
            return result;
        }

        this.ctx.save?.();
        try {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.fillStyle = active.tint;
            this.ctx.fillRect(x, y, scaled.width, scaled.height);
        } finally {
            this.ctx.restore?.();
        }

        // The stock renderer draws cursors near the end of do_render_cell.
        // Redraw them once so the translucent client marker never obscures X
        // mode's native or client-only shadow cursor.
        this.render_cursors?.(cx, cy, x, y);
        return result;
    };
    prototype.do_render_cell = state.wrapper;
    Object.defineProperty(
        prototype,
        stateProperty,
        {
            value: state,
            configurable: true,
            enumerable: false,
            writable: false
        }
    );
    return true;
}

export function uninstallMapPredictorRendererTint(target) {
    const stateProperty = '__dwemMapPredictorTintState';
    let prototype = target?.prototype || target || null;
    while (prototype && !Object.prototype.hasOwnProperty.call(
        prototype,
        stateProperty
    )) {
        prototype = Object.getPrototypeOf(prototype);
    }
    const state = prototype?.[stateProperty];
    if (!state || typeof state.original !== 'function') {
        return false;
    }
    if (prototype.do_render_cell === state.wrapper) {
        prototype.do_render_cell = state.original;
    }
    state.mapKnowledge = null;
    state.enums = null;
    state.tint = null;
    delete prototype[stateProperty];
    return true;
}

function findRendererTintPrototype(target) {
    let prototype = target?.prototype || target || null;
    while (prototype) {
        if (Object.prototype.hasOwnProperty.call(prototype, 'do_render_cell')
            && typeof prototype.do_render_cell === 'function') {
            return prototype;
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    return null;
}

const TERRAIN_STYLES = {
    floor: {
        fill: '#9bb7d1',
        stroke: '#cae1f5',
        alpha: 0.18
    },
    wall: {
        fill: '#71879b',
        stroke: '#b9cee0',
        alpha: 0.42
    },
    door: {
        fill: '#bd8c55',
        stroke: '#f0bf83',
        alpha: 0.48
    },
    water: {
        fill: '#367dab',
        stroke: '#72c3e8',
        alpha: 0.36
    },
    lava: {
        fill: '#c24c2e',
        stroke: '#ff9b59',
        alpha: 0.42
    },
    stair: {
        fill: '#6db66d',
        stroke: '#b7efad',
        alpha: 0.52
    },
    portal: {
        fill: '#9c62c7',
        stroke: '#e0b1ff',
        alpha: 0.52
    },
    unknown: {
        fill: '#8e78aa',
        stroke: '#cbb7e2',
        alpha: 0.25
    }
};

function cloneValue(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            // WebTiles packets are JSON data, but fall through for decorated
            // objects created by the renderer.
        }
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        if (Array.isArray(value)) {
            return value.slice();
        }
        if (typeof value === 'object') {
            return {...value};
        }
        return value;
    }
}

function isCoordinate(value, maxAbsCoordinate) {
    return Number.isSafeInteger(value) && Math.abs(value) <= maxAbsCoordinate;
}

/**
 * Expand the compact coordinate runs used by WebTiles map packets.
 *
 * The first cell in a packet normally has x/y. A following cell without x/y
 * is one square to the right of the previous cell. Malformed runs are dropped
 * rather than being attached to a guessed coordinate.
 */
export function decodeMapCellDeltas(cells, options = {}) {
    if (!Array.isArray(cells)) {
        return [];
    }

    const maxAbsCoordinate = Number.isSafeInteger(options.maxAbsCoordinate)
        ? Math.abs(options.maxAbsCoordinate)
        : DEFAULT_MAX_ABS_COORDINATE;
    const decoded = [];
    let lastX;
    let lastY;
    let hasPrevious = false;

    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
            hasPrevious = false;
            continue;
        }

        const hasExplicitX = Object.prototype.hasOwnProperty.call(cell, 'x');
        const hasExplicitY = Object.prototype.hasOwnProperty.call(cell, 'y');
        const x = hasExplicitX ? cell.x : (hasPrevious ? lastX + 1 : undefined);
        const y = hasExplicitY ? cell.y : (hasPrevious ? lastY : undefined);

        if (!isCoordinate(x, maxAbsCoordinate)
            || !isCoordinate(y, maxAbsCoordinate)) {
            hasPrevious = false;
            continue;
        }

        lastX = x;
        lastY = y;
        hasPrevious = true;
        decoded.push({
            index,
            x,
            y,
            diff: cloneValue(cell)
        });
    }

    return decoded;
}

export function parseCrawlSourceRef(versionText) {
    if (typeof versionText !== 'string') {
        return null;
    }

    const commitMatch = versionText.match(/(?:^|[-+])g([0-9a-f]{7,40})(?=$|[^0-9a-f])/i);
    if (commitMatch) {
        return {
            type: 'commit',
            value: commitMatch[1].toLowerCase()
        };
    }

    const tagMatch = versionText.match(
        /\b(\d+\.\d+(?:\.\d+)?(?:-(?:a|b|rc)\d+)?)\b/i
    );
    const tagRemainder = tagMatch
        ? versionText.slice(tagMatch.index + tagMatch[0].length)
        : '';
    if (tagMatch && !/^-\d+/.test(tagRemainder)) {
        return {
            type: 'tag',
            value: tagMatch[1]
        };
    }

    return null;
}

function cellKey(x, y) {
    return `${x},${y}`;
}

function sameLocation(first, second) {
    return Boolean(first && second
        && first.x === second.x
        && first.y === second.y);
}

function normalizeLocation(location, maxAbsCoordinate) {
    if (!location || typeof location !== 'object'
        || !isCoordinate(location.x, maxAbsCoordinate)
        || !isCoordinate(location.y, maxAbsCoordinate)) {
        return null;
    }
    return {x: location.x, y: location.y};
}

function clampLocation(location, bounds) {
    if (!bounds) {
        return cloneValue(location);
    }
    return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, location.x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, location.y))
    };
}

function parseCellKey(key) {
    if (typeof key !== 'string') {
        return null;
    }
    const match = key.match(/^(-?\d+),(-?\d+)$/);
    if (!match) {
        return null;
    }
    const x = Number(match[1]);
    const y = Number(match[2]);
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? {x, y} : null;
}

function predictionEntries(input) {
    if (!input) {
        return [];
    }
    if (Array.isArray(input)) {
        return input.map(value => [null, value]);
    }
    if (input instanceof Map) {
        return Array.from(input.entries());
    }
    if (input.cells !== undefined) {
        return predictionEntries(input.cells);
    }
    if (typeof input[Symbol.iterator] === 'function' && typeof input !== 'string') {
        return Array.from(input, value => [null, value]);
    }
    if (typeof input === 'object') {
        return Object.entries(input);
    }
    return [];
}

function normalizePrediction(value, key, defaultConfidence) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const keyPosition = parseCellKey(key);
    const x = value.x ?? keyPosition?.x;
    const y = value.y ?? keyPosition?.y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        return null;
    }

    const rawConfidence = value.confidence ?? defaultConfidence ?? 1;
    const numericConfidence = Number(rawConfidence);
    const confidence = Number.isFinite(numericConfidence)
        ? Math.max(0, Math.min(1, numericConfidence))
        : 1;

    return {
        ...cloneValue(value),
        x,
        y,
        confidence
    };
}

function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function numericTileValue(value) {
    if (Number.isSafeInteger(value)) {
        return value;
    }
    if (Array.isArray(value) && Number.isSafeInteger(value[0])) {
        return value[0];
    }
    if (value && typeof value === 'object'
        && Number.isSafeInteger(value.value)) {
        return value.value;
    }
    return null;
}

function mapPredictorBackgroundFlag(enums) {
    const flag = enums?.[MAP_PREDICTOR_BG_FLAG_EXPORT];
    if (!Array.isArray(flag)
        || flag[0] !== 0
        || !Number.isSafeInteger(flag[1])
        || flag[1] <= 0
        || (flag[1] & (flag[1] - 1)) !== 0) {
        return null;
    }
    return [0, flag[1]];
}

/** Pack a base dungeon tile with the audited client-only second-word flag. */
export function packMapPredictorBackground(baseBackground, flag) {
    if (!Number.isSafeInteger(baseBackground)
        || !Array.isArray(flag)
        || flag[0] !== 0
        || !Number.isSafeInteger(flag[1])
        || flag[1] <= 0
        || (flag[1] & (flag[1] - 1)) !== 0) {
        return null;
    }
    return [baseBackground & BASE_TILE_MASK, flag[1]];
}

function isSyntheticMapMessage(message) {
    return message?.msg === 'map'
        && message[SYNTHETIC_MAP_MARKER] === SYNTHETIC_MAP_MARKER_VALUE;
}

function playerLevelKey(player) {
    const place = typeof player?.place === 'string' ? player.place.trim() : '';
    const depth = Number(player?.depth);
    if (!place || !Number.isFinite(depth)) {
        return null;
    }
    return `${place}\u0000${depth}`;
}

/**
 * Bridges MapPredictor to versioned WebTiles game modules.
 *
 * Optional owner callbacks:
 * - onVersion(text, data)
 * - onPlayer(snapshot, data)
 * - onMessages(messages, raw)
 * - onMap({clear, touched, raw})
 * - onKnowledge([{x, y, cell, removed, terrainReliable}], binding)
 */
export default class WebtilesAdapter {
    constructor(owner = null, options = {}) {
        this.owner = owner;
        this.dwem = options.dwem || globalThis.DWEM;
        this.document = options.document || globalThis.document;
        this.window = options.window || globalThis.window;
        this.maxAbsCoordinate = Number.isSafeInteger(options.maxAbsCoordinate)
            ? Math.abs(options.maxAbsCoordinate)
            : DEFAULT_MAX_ABS_COORDINATE;

        this.binding = null;
        this._version = null;
        this._clientVersion = null;
        this._player = {};
        this._predictions = new Map();
        this._observedCells = new Map();
        this._terrainSamples = new Map();
        this._nativeCells = new Map();
        // A real sparse LOS delta can omit both `mf` and `t.bg`. Native
        // rendering then needs the prediction's sampled background as a visual
        // repair, but that repaired tile is not authoritative terrain evidence.
        this._unreliableTerrainCells = new Set();
        this._pendingMaps = new WeakMap();
        this._pendingNativeReapply = new WeakMap();
        // `player_on_level` describes the map currently displayed by
        // WebTiles, not the player's branch. While it is false the client may
        // be rendering another floor from the X map; those cells must never
        // replace the current-floor matcher state.
        this._playerOnLevel = null;
        this._xModeActive = false;
        this._serverMapCursor = null;
        this._shadowMapCursor = null;
        this._shadowCursorEventTarget = null;
        this._listeners = new Map();
        this._revealEnabled = Boolean(options.revealEnabled);
        this._nativeMode = options.nativeMode !== false;
        this._lateSourceMapperInstallation = options.lateSourceMapperInstallation === true;
        this._installed = false;
        this._mapperInstalled = false;
        this._dynamicReplacers = [];
        this._rendererTintTarget = null;
        this._destroyed = false;
        this._renderRequest = null;
        this._resizeObserver = null;
        this._observedCanvases = new Set();
        this._minimapInteractionCanvas = null;
        this._positionedParents = new Map();
        this.dungeonOverlay = null;
        this.minimapOverlay = null;

        this.handleMessageBefore = this.handleMessageBefore.bind(this);
        this.handleMessageAfter = this.handleMessageAfter.bind(this);
        this.handleSendMessageBefore = this.handleSendMessageBefore.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handleProjectionChange = this.handleProjectionChange.bind(this);
        this.handleShadowCursorEvent = this.handleShadowCursorEvent.bind(this);
    }

    get version() {
        return cloneValue(this._version);
    }

    get clientVersion() {
        return this._clientVersion;
    }

    get player() {
        return cloneValue(this._player);
    }

    get revealEnabled() {
        return this._revealEnabled;
    }

    get predictions() {
        return Array.from(this._predictions.values(), cloneValue);
    }

    get observedCells() {
        return new Map(Array.from(this._observedCells, ([key, value]) => [
            key,
            cloneValue(value)
        ]));
    }

    get playerOnLevel() {
        return this._playerOnLevel !== false;
    }

    get nativeVisualStatus() {
        const backgroundFlag = mapPredictorBackgroundFlag(
            this.binding?.enums
        );
        return {
            available: backgroundFlag !== null,
            backgroundFlag: cloneValue(backgroundFlag),
            property: backgroundFlag ? 'DWEM_MAP_PREDICTED' : null,
            tint: backgroundFlag ? MAP_PREDICTOR_TINT : null
        };
    }

    install() {
        if (this._installed) {
            return this;
        }

        const mapPredictor = this.owner
            || this.dwem?.Modules?.MapPredictor;
        if (mapPredictor) {
            this.owner = mapPredictor;
            mapPredictor.webtilesAdapter = this;
        }

        const ioHook = this.dwem?.Modules?.IOHook;
        if (!ioHook) {
            throw new Error('MapPredictor WebtilesAdapter requires IOHook.');
        }

        ioHook.handle_message.before.addHandler(
            HANDLER_ID,
            this.handleMessageBefore,
            RAW_WIRE_CAPTURE_PRIORITY
        );
        ioHook.handle_message.after.addHandler(
            HANDLER_ID,
            this.handleMessageAfter
        );
        ioHook.send_message?.before?.addHandler(
            HANDLER_ID,
            this.handleSendMessageBefore
        );

        this.installSourceMapper();
        this.dwem?.MapPredictorBackgroundFlagBroker?.install?.();
        const broker = this.dwem?.MapPredictorWebtilesBindingBroker;
        if (typeof broker?.bind === 'function') {
            broker.bind(this);
        } else if (this.bindCachedWebtiles()) {
            // bindCachedWebtiles installs every reversible cached-module
            // integration and binds this adapter in one operation.
        } else if (this.binding) {
            this.installKnowledgeVisibility(this.binding);
            this.installRendererTint(this.binding);
        }
        // IO hooks are absent while MapPredictor is paused. Refresh this bit
        // from WebTiles before rehydrating so a level-view switch made during
        // that pause cannot leave the adapter permanently on the wrong map.
        this.syncPlayerOnLevelFromBinding();
        this.window?.addEventListener?.('resize', this.handleWindowResize);
        this._installed = true;
        this._destroyed = false;
        return this;
    }

    cachedWebtilesModules() {
        const requirejs = this.window?.requirejs
            || this.window?.require
            || globalThis.requirejs;
        const contexts = requirejs?.s?.contexts;
        if (!contexts || typeof contexts !== 'object') {
            return null;
        }
        for (const context of Object.values(contexts)) {
            const defined = context?.defined;
            if (!defined || typeof defined !== 'object') {
                continue;
            }
            const minimapIds = Object.keys(defined)
                .filter(identifier => /(?:^|\/)minimap$/u.test(identifier))
                .reverse();
            for (const minimapId of minimapIds) {
                const separator = minimapId.lastIndexOf('/');
                const prefix = separator < 0
                    ? ''
                    : minimapId.slice(0, separator + 1);
                const module = name => defined[`${prefix}${name}`];
                const modules = {
                    mapKnowledge: module('map_knowledge'),
                    renderer: module('dungeon_renderer'),
                    cellRenderer: module('cell_renderer'),
                    enums: module('enums'),
                    dngn: module('tileinfo-dngn'),
                    player: module('player'),
                    viewData: module('view_data'),
                    minimap: defined[minimapId],
                    jquery: defined.jquery
                };
                if (modules.mapKnowledge && modules.renderer
                    && modules.cellRenderer && modules.enums && modules.dngn
                    && modules.player && modules.viewData && modules.minimap) {
                    return modules;
                }
            }
        }
        return null;
    }

    bindCachedWebtiles() {
        const modules = this.cachedWebtilesModules();
        if (!modules) {
            return false;
        }
        const flag = installMapPredictorBackgroundFlagFromExports(
            modules.enums
        );
        if (!flag) {
            return false;
        }
        installMapPredictorBackgroundFlagBroker(
            this.dwem,
            modules.enums,
            null,
            flag
        );

        const CellRenderer = modules.cellRenderer.DungeonCellRenderer;
        if (!installMapPredictorRendererTint(
            CellRenderer,
            modules.enums,
            modules.mapKnowledge,
            MAP_PREDICTOR_TINT
        )) {
            return false;
        }
        if (this.dwem) {
            this.dwem.MapPredictorRendererTintTarget = CellRenderer.prototype;
        }

        const createBinding = () => ({
            mapKnowledge: modules.mapKnowledge,
            renderer: modules.renderer,
            enums: modules.enums,
            dngn: modules.dngn,
            player: modules.player,
            jquery: modules.jquery,
            viewData: modules.viewData,
            minimap: {
                update: modules.minimap.update,
                center: modules.minimap.center,
                clear: modules.minimap.clear,
                doViewCenterUpdate: modules.minimap.do_view_center_update,
                stopFarview: modules.minimap.stop_minimap_farview
            }
        });
        const broker = {
            bind: adapter => {
                if (!adapter || typeof adapter.bindWebtiles !== 'function') {
                    return false;
                }
                adapter.bindWebtiles(createBinding());
                return true;
            }
        };
        this.dwem.MapPredictorWebtilesBindingBroker = broker;
        return broker.bind(this);
    }

    installSourceMapper() {
        if (this._mapperInstalled) {
            return;
        }

        const sourceMapperRegistry = this.dwem?.SourceMapperRegistry;
        if (!sourceMapperRegistry) {
            throw new Error('MapPredictor WebtilesAdapter requires SourceMapperRegistry.');
        }

        const enumsSource = [
            '!(typeof exports !== "undefined"',
            '&& typeof bg_flags !== "undefined"',
            '&& typeof DWEM !== "undefined"',
            `&& (${installMapPredictorBackgroundFlagBroker.toString()})(`,
            'DWEM, exports, bg_flags,',
            `(${installMapPredictorBackgroundFlag.toString()})));`
        ].join(' ');
        const sourceMappers = [[
            './enums',
            sourceMapperRegistry.getSourceMapper(
                'BeforeReturnInjection',
                enumsSource
            )
        ]];

        const rendererSource = [
            '!(typeof DungeonCellRenderer !== "undefined"',
            '&& typeof enums !== "undefined"',
            '&& typeof map_knowledge !== "undefined"',
            '&& typeof DWEM !== "undefined"',
            '&& (DWEM.MapPredictorRendererTintTarget = DungeonCellRenderer.prototype)',
            `&& (${installMapPredictorRendererTint.toString()})(`,
            `DungeonCellRenderer, enums, map_knowledge, ${JSON.stringify(MAP_PREDICTOR_TINT)}));`
        ].join(' ');
        sourceMappers.push([
            './cell_renderer',
            sourceMapperRegistry.getSourceMapper(
                'BeforeReturnInjection',
                rendererSource
            )
        ]);

        function bindMapPredictorWebtiles() {
            const broker = {
                bind: function (adapter) {
                    if (!adapter || typeof adapter.bindWebtiles !== 'function') {
                        return false;
                    }
                    adapter.bindWebtiles({
                        mapKnowledge: map_knowledge,
                        renderer: dungeon_renderer,
                        enums,
                        dngn,
                        player,
                        jquery: $,
                        viewData: view_data,
                        minimap: {
                            update,
                            center,
                            clear,
                            doViewCenterUpdate: do_view_center_update,
                            stopFarview: stop_minimap_farview
                        },
                        getMinimapProjection: function () {
                            return {
                                cellWidth: cell_w,
                                cellHeight: cell_h,
                                cellX: cell_x,
                                cellY: cell_y,
                                displayX: display_x,
                                displayY: display_y,
                                enabled
                            };
                        }
                    });
                    return true;
                }
            };
            DWEM.MapPredictorWebtilesBindingBroker = broker;
            const mapPredictor = DWEM.Modules.MapPredictor;
            if (mapPredictor?.runtimeEnabled) {
                broker.bind(mapPredictor.webtilesAdapter);
            }
        }

        const mapper = sourceMapperRegistry.getSourceMapper(
            'BeforeReturnInjection',
            `!(${bindMapPredictorWebtiles.toString()})();`
        );
        sourceMappers.push(['./minimap', mapper]);
        for (const [identifier, sourceMapper] of sourceMappers) {
            if (this._lateSourceMapperInstallation) {
                this.installDynamicSourceMapper(identifier, sourceMapper);
            } else {
                sourceMapperRegistry.add(identifier, sourceMapper);
            }
        }
        this._mapperInstalled = true;
    }

    installDynamicSourceMapper(identifier, sourceMapper) {
        const injector = this.dwem?.Injector;
        const matcherRegistry = this.dwem?.MatcherRegistry;
        const matchers = Object.values(
            matcherRegistry?.matchers?.[identifier] || {}
        ).filter(matcher => typeof matcher === 'function');
        if (!Array.isArray(injector?.replacers) || matchers.length === 0) {
            throw new Error(`MapPredictor cannot install late source mapper for ${identifier}.`);
        }
        const replacer = {
            matcher: argumentsList => matchers.some(matcher =>
                matcher(argumentsList)),
            mapper: argumentsList => {
                const index = argumentsList.findLastIndex(argument =>
                    typeof argument === 'function');
                if (index < 0) {
                    return argumentsList;
                }
                const source = sourceMapper(argumentsList[index].toString());
                const evaluate = this.window?.eval || globalThis.eval;
                argumentsList[index] = evaluate(`(${source})`);
                return argumentsList;
            }
        };
        injector.replacers.push(replacer);
        this._dynamicReplacers.push(replacer);
    }

    removeDynamicSourceMappers() {
        if (this._dynamicReplacers.length === 0) {
            return;
        }
        const replacers = this.dwem?.Injector?.replacers;
        if (Array.isArray(replacers)) {
            const installed = new Set(this._dynamicReplacers);
            for (let index = replacers.length - 1; index >= 0; index--) {
                if (installed.has(replacers[index])) {
                    replacers.splice(index, 1);
                }
            }
        }
        this._dynamicReplacers = [];
        this._mapperInstalled = false;
    }

    bindWebtiles(binding) {
        if (!binding || !binding.mapKnowledge || !binding.renderer) {
            throw new Error('Invalid WebTiles map binding.');
        }

        if (this.binding && this.binding !== binding) {
            uninstallMapPredictorRendererTint(this._rendererTintTarget);
            this._rendererTintTarget = null;
            this.removeShadowCursorHandlers();
            this.clearShadowMapCursor({restore: false, remove: true});
            this._xModeActive = false;
            this._serverMapCursor = null;
            this.clearNativePredictions();
            this.clearTerrainSamples();
            this._playerOnLevel = null;
        }
        this.binding = binding;
        this.syncPlayerOnLevelFromBinding(binding);
        this.installKnowledgeVisibility(binding);
        this.installRendererTint(binding);
        this.installShadowCursorHandlers();
        this.setXModeActive(this.isViewMapState(binding.renderer.ui_state));
        if (this._nativeMode) {
            this.removePredictionOverlays();
            if (this._revealEnabled && this._predictions.size > 0) {
                this.applyNativePredictions(this._predictions);
            }
        } else {
            this.ensureOverlays();
            this.observeBaseCanvases();
        }
        this.scheduleRender();
        this.emit('binding', binding);
        this.notifyOwner('onWebtilesBound', binding);
        return this;
    }

    syncPlayerOnLevelFromBinding(binding = this.binding) {
        if (typeof binding?.mapKnowledge?.player_on_level !== 'function') {
            return this._playerOnLevel;
        }
        try {
            const playerOnLevel = binding.mapKnowledge.player_on_level();
            if (typeof playerOnLevel === 'boolean') {
                this._playerOnLevel = playerOnLevel;
            }
        } catch (error) {
            console.error(error);
        }
        return this._playerOnLevel;
    }

    installKnowledgeVisibility(binding = this.binding) {
        const mapKnowledge = binding?.mapKnowledge;
        if (!mapKnowledge || typeof mapKnowledge.visible !== 'function') {
            return false;
        }
        const visibilityBroker = this.dwem
            ?.MapPredictorKnowledgeVisibilityBroker;
        visibilityBroker?.uninstall?.();
        if (this.dwem?.MapPredictorKnowledgeVisibilityBroker
            === visibilityBroker) {
            delete this.dwem.MapPredictorKnowledgeVisibilityBroker;
        }
        return Boolean(installMapPredictorKnowledgeVisibilityBroker(
            this.dwem,
            mapKnowledge.visible,
            binding?.enums,
            wrapMapPredictorKnowledgeVisibility,
            nextVisible => {
                mapKnowledge.visible = nextVisible;
            }
        ));
    }

    installRendererTint(binding = this.binding) {
        const target = findRendererTintPrototype(binding?.renderer);
        if (!target) {
            return false;
        }
        this._rendererTintTarget = target;
        if (this.dwem) {
            this.dwem.MapPredictorRendererTintTarget = target;
        }
        return installMapPredictorRendererTint(
            {prototype: target},
            binding?.enums,
            binding?.mapKnowledge,
            MAP_PREDICTOR_TINT
        );
    }

    on(type, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('WebtilesAdapter event handler must be a function.');
        }
        const handlers = this._listeners.get(type) || new Set();
        handlers.add(handler);
        this._listeners.set(type, handlers);
        return () => this.off(type, handler);
    }

    off(type, handler) {
        const handlers = this._listeners.get(type);
        handlers?.delete(handler);
        if (handlers?.size === 0) {
            this._listeners.delete(type);
        }
    }

    emit(type, payload) {
        const handlers = this._listeners.get(type);
        if (!handlers) {
            return;
        }
        for (const handler of handlers) {
            try {
                handler(payload);
            } catch (error) {
                console.error(error);
            }
        }
    }

    notifyOwner(method, ...args) {
        const handler = this.owner?.[method];
        if (typeof handler !== 'function') {
            return;
        }
        try {
            handler.call(this.owner, ...args);
        } catch (error) {
            console.error(error);
        }
    }

    installShadowCursorHandlers() {
        this.removeShadowCursorHandlers();
        if (!this._nativeMode || !this.document) {
            return false;
        }
        const jquery = this.binding?.jquery || this.window?.jQuery;
        if (typeof jquery !== 'function') {
            return false;
        }
        let target;
        try {
            target = jquery(this.document);
        } catch (error) {
            console.error(error);
            return false;
        }
        if (!target || typeof target.on !== 'function') {
            return false;
        }
        // Desktop WebTiles funnels navigation through these custom events.
        // Mobile input does not emit them; handleSendMessageBefore provides a
        // second guard if a hybrid device enters shadow mode from a keyboard.
        target.on(SHADOW_CURSOR_EVENTS, this.handleShadowCursorEvent);
        this._shadowCursorEventTarget = target;
        return true;
    }

    removeShadowCursorHandlers() {
        this._shadowCursorEventTarget?.off?.(
            SHADOW_CURSOR_EVENTS,
            this.handleShadowCursorEvent
        );
        this._shadowCursorEventTarget = null;
    }

    mapCursorType() {
        const value = this.binding?.enums?.CURSOR_MAP;
        return Number.isSafeInteger(value) ? value : null;
    }

    isViewMapState(state) {
        const value = this.binding?.enums?.ui?.VIEW_MAP;
        return Number.isSafeInteger(value) && state === value;
    }

    setXModeActive(active) {
        const next = Boolean(active);
        if (next === this._xModeActive) {
            if (!next) {
                this.clearShadowMapCursor({restore: false, remove: true});
                this._serverMapCursor = null;
            }
            return next;
        }
        this._xModeActive = next;
        if (!next) {
            this.clearShadowMapCursor({restore: false, remove: true});
            this._serverMapCursor = null;
        }
        return next;
    }

    handleXModeMessageAfter(message) {
        if (message.msg === 'ui_state') {
            this.setXModeActive(this.isViewMapState(message.state));
            return true;
        }
        if (message.msg !== 'cursor'
            || message.id !== this.mapCursorType()) {
            return false;
        }

        const previousShadow = this._shadowMapCursor;
        const previousServerCursor = this._serverMapCursor;
        this._serverMapCursor = normalizeLocation(
            message.loc,
            this.maxAbsCoordinate
        );
        if (previousShadow
            && sameLocation(previousServerCursor, this._serverMapCursor)) {
            // A duplicate/delayed anchor update has just been drawn by the
            // native handler. Put the still-active client cursor back on top.
            this.placeShadowMapCursor(previousShadow);
            return true;
        }
        // A changed authoritative cursor (for example, a mouse move) safely
        // leaves the client-only shadow instead of letting them diverge.
        this._shadowMapCursor = null;
        if (previousShadow) {
            this.emit('shadow-cursor', {
                active: false,
                reason: 'server-cursor',
                cursor: cloneValue(this._serverMapCursor)
            });
        }
        return true;
    }

    serverKnownBounds() {
        let bounds = null;
        const include = location => {
            if (!bounds) {
                bounds = {
                    minX: location.x,
                    maxX: location.x,
                    minY: location.y,
                    maxY: location.y
                };
                return;
            }
            bounds.minX = Math.min(bounds.minX, location.x);
            bounds.maxX = Math.max(bounds.maxX, location.x);
            bounds.minY = Math.min(bounds.minY, location.y);
            bounds.maxY = Math.max(bounds.maxY, location.y);
        };
        for (const key of this._observedCells.keys()) {
            const location = parseCellKey(key);
            if (location && this.isServerKnown(location.x, location.y)) {
                include(location);
            }
        }
        if (this._serverMapCursor) {
            include(this._serverMapCursor);
        }
        return bounds;
    }

    shadowClientBounds() {
        let bounds = this.serverKnownBounds();
        for (const record of this._nativeCells.values()) {
            if (!bounds) {
                bounds = {
                    minX: record.x,
                    maxX: record.x,
                    minY: record.y,
                    maxY: record.y
                };
                continue;
            }
            bounds.minX = Math.min(bounds.minX, record.x);
            bounds.maxX = Math.max(bounds.maxX, record.x);
            bounds.minY = Math.min(bounds.minY, record.y);
            bounds.maxY = Math.max(bounds.maxY, record.y);
        }
        return bounds;
    }

    shadowClientContains(location) {
        if (this._nativeCells.size === 0) {
            return false;
        }
        const bounds = this.shadowClientBounds();
        return Boolean(bounds
            && location.x >= bounds.minX
            && location.x <= bounds.maxX
            && location.y >= bounds.minY
            && location.y <= bounds.maxY);
    }

    shadowCursorDirection(event) {
        const type = event?.type;
        const which = Number(event?.which);
        if (type === 'game_keypress') {
            return ({
                98: {x: -1, y: 1},
                104: {x: -1, y: 0},
                106: {x: 0, y: 1},
                107: {x: 0, y: -1},
                108: {x: 1, y: 0},
                110: {x: 1, y: 1},
                117: {x: 1, y: -1},
                121: {x: -1, y: -1}
            })[which] || null;
        }
        if (type !== 'game_keydown') {
            return null;
        }
        return ({
            33: {x: 1, y: -1},
            34: {x: 1, y: 1},
            35: {x: -1, y: 1},
            36: {x: -1, y: -1},
            37: {x: -1, y: 0},
            38: {x: 0, y: -1},
            39: {x: 1, y: 0},
            40: {x: 0, y: 1},
            97: {x: -1, y: 1},
            98: {x: 0, y: 1},
            99: {x: 1, y: 1},
            100: {x: -1, y: 0},
            102: {x: 1, y: 0},
            103: {x: -1, y: -1},
            104: {x: 0, y: -1},
            105: {x: 1, y: -1}
        })[which] || null;
    }

    isShadowCursorExit(event) {
        return event?.type === 'game_keydown'
            && Number(event.which) === 27;
    }

    shouldConsumeShadowKeydown(event) {
        if (event?.ctrlKey || event?.altKey || event?.metaKey) {
            return true;
        }
        const which = Number(event?.which);
        const code = event?.originalEvent?.code || event?.code || '';
        if (code.startsWith('Numpad') || code.startsWith('Arrow')
            || code === 'Delete' || code === 'Insert'
            || code === 'Home' || code === 'End'
            || code === 'PageUp' || code === 'PageDown'
            || code.startsWith('F')) {
            return true;
        }
        // Printable keys are sent by WebTiles from the following keypress, so
        // handle them exactly once there. Control/navigation keys are sent
        // directly from keydown and must be stopped here.
        return !Number.isFinite(which) || which < 32 || which > 126;
    }

    consumeShadowCursorEvent(event, reason) {
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        if (reason) {
            const payload = {
                reason,
                cursor: cloneValue(this._shadowMapCursor),
                serverCursor: cloneValue(this._serverMapCursor)
            };
            this.emit('shadow-cursor-blocked', payload);
            this.notifyOwner('onShadowCursorBlocked', cloneValue(payload));
        }
        return false;
    }

    centerShadowCursor(location) {
        const renderer = this.binding?.renderer;
        if (typeof renderer?.in_view !== 'function'
            || renderer.in_view(location.x, location.y)) {
            return;
        }
        this.binding?.minimap?.doViewCenterUpdate?.(location.x, location.y);
    }

    placeShadowMapCursor(location) {
        const cursorType = this.mapCursorType();
        const viewData = this.binding?.viewData;
        if (this._playerOnLevel === false
            || cursorType === null
            || typeof viewData?.place_cursor !== 'function') {
            return false;
        }
        try {
            viewData.place_cursor(cursorType, cloneValue(location));
        } catch (error) {
            console.error(error);
            return false;
        }
        this._shadowMapCursor = cloneValue(location);
        this.centerShadowCursor(location);
        this.emit('shadow-cursor', {
            active: true,
            cursor: cloneValue(location),
            serverCursor: cloneValue(this._serverMapCursor)
        });
        return true;
    }

    clearShadowMapCursor(options = {}) {
        const previous = this._shadowMapCursor;
        if (!previous) {
            return false;
        }
        this._shadowMapCursor = null;
        const cursorType = this.mapCursorType();
        const viewData = this.binding?.viewData;
        try {
            if (options.remove && cursorType !== null) {
                viewData?.remove_cursor?.(cursorType);
            } else if (options.restore !== false
                && cursorType !== null
                && this._serverMapCursor
                && typeof viewData?.place_cursor === 'function') {
                viewData.place_cursor(
                    cursorType,
                    cloneValue(this._serverMapCursor)
                );
                this.centerShadowCursor(this._serverMapCursor);
            }
        } catch (error) {
            console.error(error);
        }
        this.emit('shadow-cursor', {
            active: false,
            reason: options.reason || 'cleared',
            cursor: cloneValue(this._serverMapCursor)
        });
        return true;
    }

    validateShadowMapCursor() {
        if (this._shadowMapCursor
            && !this.shadowClientContains(this._shadowMapCursor)) {
            this.clearShadowMapCursor({reason: 'prediction-revoked'});
            return false;
        }
        return true;
    }

    handleShadowCursorEvent(event) {
        if (!this._nativeMode || !this._revealEnabled
            || this._playerOnLevel === false
            || !this._xModeActive || !this._serverMapCursor) {
            return;
        }
        if (this._shadowMapCursor && this.isShadowCursorExit(event)) {
            this.clearShadowMapCursor({reason: 'exit'});
            return;
        }

        const direction = this.shadowCursorDirection(event);
        const modified = Boolean(event?.ctrlKey || event?.altKey
            || event?.metaKey || event?.shiftKey);
        if (direction && !modified) {
            const origin = this._shadowMapCursor || this._serverMapCursor;
            const rawTarget = {
                x: origin.x + direction.x,
                y: origin.y + direction.y
            };
            if (this._shadowMapCursor) {
                const target = clampLocation(
                    rawTarget,
                    this.shadowClientBounds()
                );
                if (sameLocation(target, this._serverMapCursor)) {
                    this.clearShadowMapCursor({reason: 'anchor'});
                    return this.consumeShadowCursorEvent(event);
                }
                if (sameLocation(target, this._shadowMapCursor)) {
                    return this.consumeShadowCursorEvent(event);
                }
                if (this.shadowClientContains(target)) {
                    this.placeShadowMapCursor(target);
                    return this.consumeShadowCursorEvent(event);
                }
                return this.consumeShadowCursorEvent(
                    event,
                    'outside-client-map'
                );
            }
            const clientBounds = this.shadowClientBounds();
            if (!clientBounds || this._nativeCells.size === 0) {
                return;
            }
            const serverTarget = clampLocation(
                rawTarget,
                this.serverKnownBounds()
            );
            const clientTarget = clampLocation(rawTarget, clientBounds);
            if (!sameLocation(clientTarget, serverTarget)
                && this.placeShadowMapCursor(clientTarget)) {
                return this.consumeShadowCursorEvent(event);
            }
            return;
        }

        if (!this._shadowMapCursor) {
            return;
        }
        if (direction) {
            return this.consumeShadowCursorEvent(event, 'jump-unsupported');
        }
        if (event?.type === 'game_keypress'
            || (event?.type === 'game_keydown'
                && this.shouldConsumeShadowKeydown(event))) {
            return this.consumeShadowCursorEvent(event, 'client-only-cursor');
        }
    }

    handleSendMessageBefore(message, data) {
        if (!this._shadowMapCursor) {
            return false;
        }
        if (message === 'key' && Number(data?.keycode) === 27) {
            this.clearShadowMapCursor({reason: 'exit'});
            return false;
        }
        if (message === 'input'
            || message === 'text_input'
            || message === 'key') {
            const payload = {
                reason: 'client-only-cursor',
                cursor: cloneValue(this._shadowMapCursor),
                serverCursor: cloneValue(this._serverMapCursor)
            };
            this.emit('shadow-cursor-blocked', payload);
            this.notifyOwner('onShadowCursorBlocked', cloneValue(payload));
            return true;
        }
        return false;
    }

    handleMessageBefore(message) {
        if (!message || typeof message !== 'object') {
            return false;
        }

        // Synthetic packets must continue through WebTiles' native display
        // handler, but must never become matcher observations or owner events.
        if (isSyntheticMapMessage(message)) {
            return false;
        }

        if (message.msg === 'msgs') {
            const validMessages = Array.isArray(message.messages)
                && message.messages.length > 0
                && message.messages.every(entry => entry
                    && typeof entry === 'object'
                    && !Array.isArray(entry)
                    && typeof entry.text === 'string');
            if (!validMessages) {
                return false;
            }

            const messages = cloneValue(message.messages);
            const raw = cloneValue(message);
            this.emit('messages', {
                messages: cloneValue(messages),
                raw: cloneValue(raw)
            });
            this.notifyOwner(
                'onMessages',
                cloneValue(messages),
                cloneValue(raw)
            );
            return false;
        }

        if (message.msg === 'game_client') {
            this._clientVersion = typeof message.version === 'string'
                ? message.version
                : null;
            const payload = {clientVersion: this._clientVersion};
            this.emit('client-version', payload);
            this.notifyOwner(
                'onClientVersion',
                this._clientVersion,
                cloneValue(message)
            );
            return false;
        }

        if (message.msg === 'version') {
            const text = typeof message.text === 'string' ? message.text : '';
            this._version = {
                text,
                sourceRef: parseCrawlSourceRef(text)
            };
            const payload = this.version;
            this.emit('version', payload);
            this.notifyOwner('onVersion', text, {
                ...cloneValue(message),
                sourceRef: cloneValue(this._version.sourceRef)
            });
            return false;
        }

        if (message.msg === 'player') {
            const previousLevelKey = playerLevelKey(this._player);
            const diff = cloneValue(message);
            delete diff.msg;
            this._player = {
                ...this._player,
                ...diff
            };
            const nextLevelKey = playerLevelKey(this._player);
            if (previousLevelKey && nextLevelKey
                && previousLevelKey !== nextLevelKey) {
                this.clearTerrainSamples();
                this._unreliableTerrainCells.clear();
            }
            const payload = {
                player: this.player,
                diff: cloneValue(diff)
            };
            this.emit('player', payload);
            this.notifyOwner(
                'onPlayer',
                cloneValue(this._player),
                cloneValue(message)
            );
            return false;
        }

        if (message.msg !== 'map') {
            return false;
        }

        const hasPlayerOnLevel = Object.prototype.hasOwnProperty.call(
            message,
            'player_on_level'
        );
        const explicitPlayerOnLevel = hasPlayerOnLevel
            ? Boolean(message.player_on_level)
            : undefined;
        const previousPlayerOnLevel = this._playerOnLevel;
        const playerOnLevel = explicitPlayerOnLevel
            ?? (previousPlayerOnLevel ?? true);
        const returningToPlayerLevel = previousPlayerOnLevel === false
            && playerOnLevel === true;
        const leavingPlayerLevel = previousPlayerOnLevel !== false
            && playerOnLevel === false;
        // `spect_only` is emitted for a newly attached watcher's full-map
        // synchronization. It is a view refresh, not a new Crawl floor.
        const sameLevelResync = playerOnLevel === true
            && message.spect_only === true;
        const retainCurrentState = playerOnLevel === false
            || returningToPlayerLevel
            || sameLevelResync;
        this._playerOnLevel = playerOnLevel;

        const cells = decodeMapCellDeltas(message.cells, {
            maxAbsCoordinate: this.maxAbsCoordinate
        });
        if (playerOnLevel) {
            for (const decodedCell of cells) {
                const diff = decodedCell?.diff;
                const hasBackground = diff?.t && typeof diff.t === 'object'
                    && Object.prototype.hasOwnProperty.call(diff.t, 'bg');
                if (hasBackground || Number.isFinite(diff?.mf)
                    || diff?.f === 0) {
                    this._unreliableTerrainCells.delete(
                        cellKey(decodedCell.x, decodedCell.y)
                    );
                }
            }
        }
        if (message.clear === true) {
            if (!retainCurrentState) {
                // Samples are level-local visual data. Clear them before the
                // native handler processes a genuinely new current level;
                // onKnowledge will repopulate them from this clear packet.
                this.clearTerrainSamples();
            }
            this.restoreNativeCellsBeforeServer();
        } else if (leavingPlayerLevel) {
            // A defensive path for versions which switch the displayed floor
            // without a full clear. Retain prediction data, but remove native
            // cells before an off-level diff can merge into them.
            this.restoreNativeCellsBeforeServer();
        } else if (playerOnLevel) {
            const restoredNativeKeys = this.restoreNativeCellsBeforeServer(cells);
            if (restoredNativeKeys.length > 0) {
                // A normal server redraw (notably the full-screen X view) can
                // send an unseen diff for a client-only mapped cell. Let the
                // authoritative diff merge first, then restore the prediction
                // only if the resulting server cell is still unknown.
                this._pendingNativeReapply.set(message, restoredNativeKeys);
            }
        }

        const capture = {
            clear: message.clear === true,
            playerOnLevel,
            previousPlayerOnLevel,
            returningToPlayerLevel,
            leavingPlayerLevel,
            sameLevelResync,
            retainCurrentState,
            vgrdc: cloneValue(message.vgrdc),
            cells,
            raw: cloneValue(message)
        };
        this._pendingMaps.set(message, capture);

        if (capture.clear && !retainCurrentState) {
            this._observedCells.clear();
            this._unreliableTerrainCells.clear();
            this.clearPredictions();
        }
        if (playerOnLevel === false || returningToPlayerLevel) {
            this.clearShadowMapCursor({
                restore: false,
                remove: true,
                reason: playerOnLevel === false
                    ? 'off-level-map'
                    : 'returning-to-player-level'
            });
            this._serverMapCursor = null;
        }

        const beforePayload = cloneValue(capture);
        this.emit('map-before', beforePayload);
        if (playerOnLevel && !returningToPlayerLevel && !sameLevelResync) {
            this.notifyOwner('onMap', {
                clear: capture.clear,
                playerOnLevel: true,
                previousPlayerOnLevel,
                returningToPlayerLevel: false,
                sameLevelResync: false,
                touched: cloneValue(capture.cells),
                raw: cloneValue(capture.raw)
            });
        }
        return false;
    }

    handleMessageAfter(message) {
        if (!message || typeof message !== 'object') {
            return;
        }
        if (isSyntheticMapMessage(message)) {
            return;
        }
        if (message.msg !== 'map') {
            this.handleXModeMessageAfter(message);
            return;
        }

        const nativeReapplyKeys = this._pendingNativeReapply.get(message) || [];
        this._pendingNativeReapply.delete(message);

        const capture = this._pendingMaps.get(message)
            || {
                clear: message.clear === true,
                playerOnLevel: Object.prototype.hasOwnProperty.call(
                    message,
                    'player_on_level'
                )
                    ? Boolean(message.player_on_level)
                    : (this._playerOnLevel ?? true),
                previousPlayerOnLevel: this._playerOnLevel,
                returningToPlayerLevel: false,
                leavingPlayerLevel: false,
                sameLevelResync: message.spect_only === true,
                retainCurrentState: message.spect_only === true,
                vgrdc: cloneValue(message.vgrdc),
                cells: decodeMapCellDeltas(message.cells, {
                    maxAbsCoordinate: this.maxAbsCoordinate
                }),
                raw: cloneValue(message)
            };
        this._pendingMaps.delete(message);

        if (capture.playerOnLevel === false) {
            // The native client still needs the packet to draw the selected X
            // map floor, but none of its knowledge belongs to the player's
            // current level or the matcher.
            this.emit('map', {
                ...capture,
                cells: [],
                ignoredOffLevel: true
            });
            this.scheduleRender();
            return;
        }

        const knowledgeCells = [];
        for (const decodedCell of capture.cells) {
            const knowledge = this.readKnowledge(decodedCell.x, decodedCell.y);
            const removed = knowledge !== undefined
                && !this.knowledgeIsKnown(knowledge);
            const cell = {
                ...decodedCell,
                knowledge,
                removed
            };
            knowledgeCells.push(cell);
            const key = cellKey(decodedCell.x, decodedCell.y);
            if (removed) {
                this._observedCells.delete(key);
                this._unreliableTerrainCells.delete(key);
            } else if (knowledge) {
                this._observedCells.set(
                    key,
                    knowledge
                );
            }
        }

        const payload = {
            ...capture,
            cells: knowledgeCells
        };
        this.emit('map', payload);
        if (knowledgeCells.length > 0) {
            const knowledgePayload = {
                clear: capture.clear,
                cells: cloneValue(knowledgeCells)
            };
            this.emit('knowledge', knowledgePayload);
            this.notifyOwner(
                'onKnowledge',
                knowledgeCells.map(entry => ({
                    x: entry.x,
                    y: entry.y,
                    cell: cloneValue(entry.knowledge),
                    removed: entry.removed,
                    terrainReliable: !this._unreliableTerrainCells.has(
                        cellKey(entry.x, entry.y)
                    )
                })),
                this.binding
            );
        }
        if (capture.retainCurrentState
            && this._nativeMode
            && this._revealEnabled
            && this._predictions.size > 0) {
            // Returning from an off-level X map (or completing a spectator
            // full resync) rebuilds native map knowledge. Reapply the retained
            // current-floor prediction only after that authoritative merge.
            this.applyNativePredictions(this._predictions);
        } else if (nativeReapplyKeys.length > 0
            && this._nativeMode
            && this._revealEnabled) {
            this.reapplyNativePredictions(nativeReapplyKeys);
        }
        this.validateShadowMapCursor();
        this.scheduleRender();
    }

    readKnowledge(x, y) {
        const mapKnowledge = this.binding?.mapKnowledge;
        if (!mapKnowledge || typeof mapKnowledge.get !== 'function') {
            return undefined;
        }
        try {
            return cloneValue(mapKnowledge.get(x, y));
        } catch (error) {
            console.error(error);
            return undefined;
        }
    }

    rehydrateKnowledge() {
        // This is also the soft-resume boundary. WebTiles may have changed
        // between the player's level and an off-level X map while our IO
        // handlers were uninstalled.
        this.syncPlayerOnLevelFromBinding();
        if (this._playerOnLevel === false) {
            return [];
        }
        const mapKnowledge = this.binding?.mapKnowledge;
        const bounds = typeof mapKnowledge?.bounds === 'function'
            ? mapKnowledge.bounds()
            : null;
        if (!bounds || !Number.isInteger(bounds.left)
            || !Number.isInteger(bounds.right)
            || !Number.isInteger(bounds.top)
            || !Number.isInteger(bounds.bottom)
            || bounds.right < bounds.left || bounds.bottom < bounds.top) {
            return [];
        }
        const width = bounds.right - bounds.left + 1;
        const height = bounds.bottom - bounds.top + 1;
        if (width * height > 100000) {
            return [];
        }

        const cells = [];
        this._observedCells.clear();
        for (let y = bounds.top; y <= bounds.bottom; y++) {
            for (let x = bounds.left; x <= bounds.right; x++) {
                const knowledge = this.readKnowledge(x, y);
                if (!this.knowledgeIsKnown(knowledge)) {
                    continue;
                }
                this._observedCells.set(cellKey(x, y), cloneValue(knowledge));
                cells.push({
                    x,
                    y,
                    cell: cloneValue(knowledge),
                    removed: false,
                    terrainReliable: !this._unreliableTerrainCells.has(
                        cellKey(x, y)
                    )
                });
            }
        }
        return cells;
    }

    rememberTerrainSamples(samples) {
        if (this._playerOnLevel === false || !Array.isArray(samples)) {
            return 0;
        }

        let remembered = 0;
        for (const entry of samples) {
            if (!entry || typeof entry !== 'object'
                || !entry.cell || typeof entry.cell !== 'object') {
                continue;
            }
            const kind = this.predictionKind({kind: entry.kind});
            if (kind === 'unknown') {
                continue;
            }
            const sample = this.sanitizeTerrainSample(entry.cell, kind);
            if (!sample) {
                continue;
            }
            this._terrainSamples.set(kind, sample);
            remembered++;
        }
        return remembered;
    }

    clearTerrainSamples() {
        const count = this._terrainSamples.size;
        this._terrainSamples.clear();
        return count;
    }

    terrainSampleMatchesKind(kind, baseBackground, mapFeature) {
        const enums = this.binding?.enums || {};
        const allowedFeatures = {
            floor: [enums.MF_FLOOR, enums.MF_MAP_FLOOR],
            wall: [enums.MF_WALL, enums.MF_MAP_WALL],
            door: [enums.MF_DOOR],
            shallow_water: [enums.MF_WATER],
            deep_water: [enums.MF_DEEP_WATER],
            lava: [enums.MF_LAVA]
        }[kind];
        if (!allowedFeatures?.some(Number.isSafeInteger)
            || !allowedFeatures.includes(mapFeature)) {
            return false;
        }
        if (kind !== 'floor' && kind !== 'wall') {
            return true;
        }

        const dngn = this.binding?.dngn;
        const floorMax = dngn?.FLOOR_MAX;
        const wallMax = dngn?.WALL_MAX;
        if (!Number.isSafeInteger(floorMax)
            || !Number.isSafeInteger(wallMax)
            || floorMax >= wallMax) {
            return false;
        }

        if (kind === 'floor') {
            const unseen = Number.isSafeInteger(dngn?.DNGN_UNSEEN)
                ? dngn.DNGN_UNSEEN
                : -1;
            const error = dngn?.DNGN_ERROR;
            return baseBackground > unseen
                && baseBackground < floorMax
                && (!Number.isSafeInteger(error) || baseBackground !== error);
        }
        return baseBackground >= floorMax && baseBackground < wallMax;
    }

    sanitizeTerrainSample(cell, kind = 'unknown') {
        if (!Number.isSafeInteger(cell.f) || cell.f === 0) {
            return null;
        }
        const rawBackground = numericTileValue(cell.t?.bg);
        if (rawBackground === null) {
            return null;
        }

        let baseBackground;
        try {
            baseBackground = typeof this.binding?.dngn?.basetile === 'function'
                ? this.binding.dngn.basetile(rawBackground)
                : rawBackground & 0x0000FFFF;
        } catch (error) {
            baseBackground = rawBackground & 0x0000FFFF;
        }
        if (!Number.isSafeInteger(baseBackground)) {
            return null;
        }
        if (!this.terrainSampleMatchesKind(kind, baseBackground, cell.mf)) {
            return null;
        }

        const background = packMapPredictorBackground(
            baseBackground,
            mapPredictorBackgroundFlag(this.binding?.enums)
        );
        if (!background) {
            return null;
        }

        const sample = {
            f: cell.f,
            t: {
                bg: background
            }
        };
        if (Number.isSafeInteger(cell.mf)) {
            sample.mf = cell.mf;
        }
        if (typeof cell.g === 'string') {
            sample.g = cell.g;
        }
        if (Number.isSafeInteger(cell.col)) {
            sample.col = cell.col;
        }

        const flavour = cell.t?.flv ?? cell.flv;
        if (flavour && typeof flavour === 'object' && !Array.isArray(flavour)) {
            const safeFlavour = {};
            if (Number.isSafeInteger(flavour.f)) {
                safeFlavour.f = flavour.f;
            }
            if (Number.isSafeInteger(flavour.s)) {
                safeFlavour.s = flavour.s;
            }
            if (Object.keys(safeFlavour).length > 0) {
                sample.t.flv = safeFlavour;
            }
        }
        return sample;
    }

    nativePredictionCell(prediction) {
        const kind = this.predictionKind(prediction);
        if (!NATIVE_SAFE_TERRAIN_KINDS.has(kind)) {
            return null;
        }
        const sample = this._terrainSamples.get(kind)
            || this.nativeFixedTerrainSample(kind);
        if (!sample) {
            return null;
        }

        const cell = {
            x: prediction.x,
            y: prediction.y,
            ...cloneValue(sample)
        };
        const enums = this.binding?.enums || {};
        if (kind === 'wall') {
            if (!Number.isSafeInteger(enums.MF_MAP_WALL)) {
                return null;
            }
            cell.mf = enums.MF_MAP_WALL;
            delete cell.f;
        } else if (kind === 'floor') {
            if (!Number.isSafeInteger(enums.MF_MAP_FLOOR)) {
                return null;
            }
            cell.mf = enums.MF_MAP_FLOOR;
            delete cell.f;
        }
        return cell;
    }

    nativeFixedTerrainSample(kind) {
        const dngn = this.binding?.dngn || {};
        const enums = this.binding?.enums || {};
        const fixed = {
            door: {
                tile: dngn.DNGN_CLOSED_DOOR,
                mapFeature: enums.MF_DOOR
            },
            shallow_water: {
                tile: dngn.DNGN_SHALLOW_WATER,
                mapFeature: enums.MF_WATER
            },
            deep_water: {
                tile: dngn.DNGN_DEEP_WATER,
                mapFeature: enums.MF_DEEP_WATER
            },
            lava: {
                tile: dngn.DNGN_LAVA,
                mapFeature: enums.MF_LAVA
            }
        }[kind];
        if (!Number.isSafeInteger(fixed?.tile)
            || !Number.isSafeInteger(fixed?.mapFeature)) {
            return null;
        }
        const background = packMapPredictorBackground(
            fixed.tile,
            mapPredictorBackgroundFlag(this.binding?.enums)
        );
        if (!background) {
            return null;
        }
        return {
            mf: fixed.mapFeature,
            t: {
                bg: background
            }
        };
    }

    wallIsMagicMapBoundary(prediction, predictions) {
        for (let deltaY = -1; deltaY <= 1; deltaY++) {
            for (let deltaX = -1; deltaX <= 1; deltaX++) {
                if (deltaX === 0 && deltaY === 0) {
                    continue;
                }
                const key = cellKey(
                    prediction.x + deltaX,
                    prediction.y + deltaY
                );
                const predicted = predictions.get(key);
                if (predicted) {
                    const kind = this.predictionKind(predicted);
                    if (kind !== 'wall' && kind !== 'unknown') {
                        return true;
                    }
                }
                const observed = this._observedCells.get(key);
                if (observed) {
                    const kind = this.predictionKind({mf: observed.mf});
                    if (kind !== 'wall' && kind !== 'unknown') {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    knowledgeIsKnown(cell) {
        if (!cell || typeof cell !== 'object') {
            return false;
        }
        const unseenFeature = this.binding?.enums?.MF_UNSEEN ?? 0;
        if (cell.f !== undefined && cell.f !== null && cell.f !== 0) {
            return true;
        }
        if (cell.mf !== undefined
            && cell.mf !== null
            && cell.mf !== unseenFeature) {
            return true;
        }

        // A screen-only WebTiles delta can carry a usable background without
        // repeating f/mf. Treat that terrain as server-owned as well: otherwise
        // a stale prediction can paint MM_UNSEEN over a square that is already
        // visible in LOS. A bare UNSEEN tile (or flag with no base tile) still
        // remains eligible for a client prediction.
        return this.knowledgeHasTerrainBackground(cell);
    }

    knowledgeHasTerrainBackground(cell) {
        const background = cell?.t?.bg;
        const rawBackground = numericTileValue(background);
        if (rawBackground === null
            || (background && typeof background === 'object'
                && background.UNSEEN === true)
            || (rawBackground & UNSEEN) !== 0) {
            return false;
        }

        let baseBackground;
        try {
            baseBackground = typeof this.binding?.dngn?.basetile === 'function'
                ? this.binding.dngn.basetile(rawBackground)
                : rawBackground & 0x0000FFFF;
        } catch (error) {
            baseBackground = rawBackground & 0x0000FFFF;
        }
        const unseenTile = this.binding?.dngn?.DNGN_UNSEEN;
        return Number.isSafeInteger(baseBackground)
            && (!Number.isSafeInteger(unseenTile)
                || baseBackground !== unseenTile);
    }

    mergeKnowledgeDiff(snapshot, diff) {
        const merged = snapshot && typeof snapshot === 'object'
            ? cloneValue(snapshot)
            : {};
        for (const [property, value] of Object.entries(diff || {})) {
            if (property === 't' && value && typeof value === 'object') {
                merged.t = {
                    ...(merged.t && typeof merged.t === 'object'
                        ? merged.t
                        : {}),
                    ...cloneValue(value)
                };
            } else {
                merged[property] = cloneValue(value);
            }
        }
        return merged;
    }

    sparseServerBackground(record, expected) {
        const predictedKind = record.kind || 'unknown';
        const serverKind = this.predictionKind({mf: expected?.mf});
        let sample = record.synthetic;
        if (serverKind !== 'unknown' && serverKind !== predictedKind) {
            const serverSample = this._terrainSamples.get(serverKind)
                || this.nativeFixedTerrainSample(serverKind);
            if (!serverSample) {
                return null;
            }
            sample = serverSample;
        }
        const background = numericTileValue(sample?.t?.bg);
        return background === null ? null : background & 0x0000FFFF;
    }

    primeSparseServerBackground(record, decodedCell) {
        const diff = decodedCell?.diff;
        if (!record || !diff || typeof diff !== 'object'
            || (diff.t && typeof diff.t === 'object'
                && Object.prototype.hasOwnProperty.call(diff.t, 'bg'))) {
            return false;
        }

        const expected = this.mergeKnowledgeDiff(record.snapshot, diff);
        if (!this.knowledgeIsKnown(expected)
            || this.knowledgeHasTerrainBackground(expected)) {
            return false;
        }
        const background = this.sparseServerBackground(record, expected);
        if (!Number.isSafeInteger(background)) {
            return false;
        }
        const usedPredictedTerrain = this.predictionKind({mf: expected?.mf})
            === 'unknown';

        const mapKnowledge = this.binding?.mapKnowledge;
        if (!mapKnowledge || typeof mapKnowledge.get !== 'function') {
            return false;
        }
        let target;
        try {
            target = mapKnowledge.get(record.x, record.y);
        } catch (error) {
            console.error(error);
            return false;
        }
        if (!target || typeof target !== 'object') {
            return false;
        }
        if (!target.t || typeof target.t !== 'object') {
            target.t = {};
        }
        target.t.bg = background;
        if (usedPredictedTerrain) {
            this._unreliableTerrainCells.add(record.key);
        } else {
            this._unreliableTerrainCells.delete(record.key);
        }
        return true;
    }

    dispatchNativeMap(cells) {
        if (!Array.isArray(cells) || cells.length === 0) {
            return false;
        }
        const handleMessage = this.dwem?.Modules?.IOHook?.handle_message;
        if (typeof handleMessage !== 'function') {
            return false;
        }
        handleMessage({
            msg: 'map',
            cells: cloneValue(cells),
            [SYNTHETIC_MAP_MARKER]: SYNTHETIC_MAP_MARKER_VALUE
        });
        return true;
    }

    replaceKnowledgeCell(x, y, snapshot, touch = false) {
        const mapKnowledge = this.binding?.mapKnowledge;
        if (!mapKnowledge || typeof mapKnowledge.get !== 'function') {
            return false;
        }
        let target;
        try {
            target = mapKnowledge.get(x, y);
        } catch (error) {
            console.error(error);
            return false;
        }
        if (!target || typeof target !== 'object') {
            return false;
        }
        for (const property of Object.keys(target)) {
            delete target[property];
        }
        Object.assign(target, cloneValue(snapshot));
        if (touch && typeof mapKnowledge.touch === 'function') {
            mapKnowledge.touch(x, y);
        }
        return true;
    }

    restoreNativeCellsBeforeServer(touched = null) {
        const decodedByKey = touched === null
            ? null
            : new Map(touched.map(cell => [cellKey(cell.x, cell.y), cell]));
        const keys = decodedByKey === null
            ? Array.from(this._nativeCells.keys())
            : Array.from(decodedByKey.keys());
        const restored = [];
        for (const key of new Set(keys)) {
            const record = this._nativeCells.get(key);
            if (!record) {
                continue;
            }
            // Do not touch here: the original server handler will merge and
            // touch immediately after all before hooks have completed.
            this.replaceKnowledgeCell(
                record.x,
                record.y,
                record.snapshot,
                false
            );
            if (decodedByKey) {
                this.primeSparseServerBackground(
                    record,
                    decodedByKey.get(key)
                );
            }
            this._nativeCells.delete(key);
            restored.push(key);
        }
        return restored;
    }

    injectNativePredictions(predictions, keys = null) {
        const selected = keys === null
            ? Array.from(predictions.values())
            : Array.from(new Set(keys), key => predictions.get(key)).filter(Boolean);
        const cells = [];
        const staged = [];
        for (const prediction of selected) {
            if (this.predictionKind(prediction) === 'wall'
                && !this.wallIsMagicMapBoundary(prediction, predictions)) {
                continue;
            }
            const syntheticCell = this.nativePredictionCell(prediction);
            if (!syntheticCell) {
                continue;
            }
            const snapshot = this.readKnowledge(prediction.x, prediction.y);
            if (snapshot === undefined || this.knowledgeIsKnown(snapshot)) {
                continue;
            }
            const nativeKey = cellKey(prediction.x, prediction.y);
            if (this._nativeCells.has(nativeKey)) {
                continue;
            }
            const record = {
                key: nativeKey,
                x: prediction.x,
                y: prediction.y,
                snapshot,
                kind: this.predictionKind(prediction),
                synthetic: cloneValue(syntheticCell)
            };
            this._nativeCells.set(nativeKey, record);
            staged.push(record);
            cells.push(syntheticCell);
        }

        if (cells.length === 0) {
            return [];
        }
        try {
            if (!this.dispatchNativeMap(cells)) {
                for (const record of staged) {
                    this._nativeCells.delete(record.key);
                }
                return [];
            }
        } catch (error) {
            for (const record of staged) {
                this.replaceKnowledgeCell(
                    record.x,
                    record.y,
                    record.snapshot,
                    true
                );
                this._nativeCells.delete(record.key);
            }
            throw error;
        }
        return cloneValue(cells);
    }

    applyNativePredictions(input = this._predictions) {
        if (!this._nativeMode || !this.binding
            || this._playerOnLevel === false) {
            return [];
        }

        // Re-applying a result can revoke only part of the previous result;
        // repaint every restored coordinate before injecting the replacement.
        this.rollbackNativeCells(true);
        const normalizedPredictions = new Map();
        const defaultConfidence = input && typeof input === 'object'
            ? input.confidence
            : undefined;
        for (const [key, value] of predictionEntries(input)) {
            const prediction = normalizePrediction(value, key, defaultConfidence);
            if (!prediction
                || Math.abs(prediction.x) > this.maxAbsCoordinate
                || Math.abs(prediction.y) > this.maxAbsCoordinate) {
                continue;
            }
            normalizedPredictions.set(
                cellKey(prediction.x, prediction.y),
                prediction
            );
        }
        const injected = this.injectNativePredictions(normalizedPredictions);
        this.validateShadowMapCursor();
        return injected;
    }

    reapplyNativePredictions(keys) {
        if (!this._nativeMode || !this.binding || !this._revealEnabled
            || this._playerOnLevel === false) {
            return [];
        }
        const injected = this.injectNativePredictions(this._predictions, keys);
        this.validateShadowMapCursor();
        return injected;
    }

    rollbackNativeCells(refresh = true) {
        const records = Array.from(this._nativeCells.values());
        this._nativeCells.clear();
        if (records.length === 0) {
            return [];
        }

        for (const record of records) {
            this.replaceKnowledgeCell(
                record.x,
                record.y,
                record.snapshot,
                refresh
            );
        }

        if (refresh) {
            const refreshCells = records.map(({x, y}) => ({x, y}));
            const refreshedThroughMap = this.dispatchNativeMap(refreshCells);
            if (!refreshedThroughMap) {
                for (const record of records) {
                    const cell = this.readKnowledge(record.x, record.y);
                    this.binding?.renderer?.render_loc?.(
                        record.x,
                        record.y,
                        cell
                    );
                    this.binding?.minimap?.update?.(
                        record.x,
                        record.y,
                        cell
                    );
                }
            }

            // A no-op map diff adds its own dirty bookkeeping. Restore once
            // more without touching so the retained knowledge is byte-for-byte
            // equivalent to the pre-injection snapshot.
            for (const record of records) {
                this.replaceKnowledgeCell(
                    record.x,
                    record.y,
                    record.snapshot,
                    false
                );
            }
        }
        return records.map(({x, y}) => ({x, y}));
    }

    clearNativePredictions() {
        const restored = this.rollbackNativeCells(true);
        this.clearShadowMapCursor({reason: 'predictions-cleared'});
        return restored;
    }

    setPredictions(input) {
        const next = new Map();
        const defaultConfidence = input && typeof input === 'object'
            ? input.confidence
            : undefined;
        for (const [key, value] of predictionEntries(input)) {
            const prediction = normalizePrediction(value, key, defaultConfidence);
            if (!prediction) {
                continue;
            }
            if (Math.abs(prediction.x) > this.maxAbsCoordinate
                || Math.abs(prediction.y) > this.maxAbsCoordinate) {
                continue;
            }
            next.set(cellKey(prediction.x, prediction.y), prediction);
        }
        this._predictions = next;
        this.emit('predictions', this.predictions);
        if (this._nativeMode) {
            if (this._revealEnabled) {
                this.applyNativePredictions(this._predictions);
            } else {
                this.clearNativePredictions();
            }
        }
        this.scheduleRender();
        return this.predictions;
    }

    clearPredictions() {
        const hadPredictions = this._predictions.size > 0;
        this.clearNativePredictions();
        if (!hadPredictions) {
            this.scheduleRender();
            return;
        }
        this._predictions.clear();
        this.emit('predictions', []);
        this.scheduleRender();
    }

    setRevealEnabled(enabled) {
        const next = Boolean(enabled);
        if (next === this._revealEnabled) {
            if (this._nativeMode && !next) {
                this.clearNativePredictions();
            }
            return this._revealEnabled;
        }
        this._revealEnabled = next;
        if (this._nativeMode) {
            if (next) {
                this.applyNativePredictions(this._predictions);
            } else {
                this.clearNativePredictions();
            }
        }
        this.emit('reveal', next);
        this.notifyOwner('onRevealChanged', next);
        this.scheduleRender();
        return next;
    }

    toggleReveal(force) {
        return this.setRevealEnabled(
            typeof force === 'boolean' ? force : !this._revealEnabled
        );
    }

    getSnapshot() {
        return {
            version: this.version,
            clientVersion: this.clientVersion,
            player: this.player,
            playerOnLevel: this.playerOnLevel,
            revealEnabled: this.revealEnabled,
            nativeVisual: this.nativeVisualStatus,
            predictions: this.predictions,
            observedCells: this.observedCells
        };
    }

    handleWindowResize() {
        this.scheduleRender();
    }

    handleProjectionChange() {
        this.scheduleRender();
    }

    scheduleRender() {
        if (this._destroyed || this._renderRequest !== null) {
            return;
        }

        const requestFrame = this.window?.requestAnimationFrame?.bind(this.window);
        if (requestFrame) {
            this._renderRequest = requestFrame(() => {
                this._renderRequest = null;
                this.render();
            });
        } else {
            this.render();
        }
    }

    render() {
        if (this._destroyed) {
            return;
        }

        if (this._nativeMode) {
            this.removePredictionOverlays();
            return;
        }

        this.ensureOverlays();
        this.clearOverlay(this.dungeonOverlay);
        this.clearOverlay(this.minimapOverlay);

        if (!this._revealEnabled || this._predictions.size === 0
            || this._playerOnLevel === false) {
            return;
        }

        this.renderDungeonOverlay();
        this.renderMinimapOverlay();
    }

    removePredictionOverlays() {
        const dungeonOverlay = this.dungeonOverlay
            || this.document?.getElementById?.(DUNGEON_OVERLAY_ID);
        const minimapOverlay = this.minimapOverlay
            || this.document?.getElementById?.(MINIMAP_OVERLAY_ID);
        dungeonOverlay?.remove?.();
        minimapOverlay?.remove?.();
        this.dungeonOverlay = null;
        this.minimapOverlay = null;
    }

    ensureOverlays() {
        if (!this.document) {
            return;
        }

        const dungeonCanvas = this.binding?.renderer?.element
            || this.document.getElementById?.('dungeon');
        const minimapCanvas = this.document.getElementById?.('minimap');
        this.dungeonOverlay = this.ensureOverlayCanvas(
            DUNGEON_OVERLAY_ID,
            dungeonCanvas,
            30
        );
        this.minimapOverlay = this.ensureOverlayCanvas(
            MINIMAP_OVERLAY_ID,
            minimapCanvas,
            3
        );
    }

    ensureOverlayCanvas(id, baseCanvas, zIndex) {
        if (!baseCanvas?.parentElement) {
            return null;
        }

        let overlay = this.document.getElementById?.(id);
        if (overlay && overlay.parentElement !== baseCanvas.parentElement) {
            overlay.remove?.();
            overlay = null;
        }
        if (!overlay) {
            overlay = this.document.createElement('canvas');
            overlay.id = id;
            overlay.setAttribute?.('aria-hidden', 'true');
            baseCanvas.parentElement.append(overlay);
        }

        this.positionParent(baseCanvas.parentElement);
        const width = baseCanvas.width || 0;
        const height = baseCanvas.height || 0;
        if (overlay.width !== width) {
            overlay.width = width;
        }
        if (overlay.height !== height) {
            overlay.height = height;
        }
        Object.assign(overlay.style, {
            position: 'absolute',
            pointerEvents: 'none',
            left: `${baseCanvas.offsetLeft || 0}px`,
            top: `${baseCanvas.offsetTop || 0}px`,
            width: baseCanvas.style?.width
                || `${baseCanvas.clientWidth || baseCanvas.width || 0}px`,
            height: baseCanvas.style?.height
                || `${baseCanvas.clientHeight || baseCanvas.height || 0}px`,
            zIndex: String(zIndex)
        });
        return overlay;
    }

    positionParent(parent) {
        if (!parent?.style || this._positionedParents.has(parent)) {
            return;
        }
        const computedPosition = this.window?.getComputedStyle?.(parent)?.position;
        const currentPosition = parent.style.position || '';
        if ((computedPosition || currentPosition || 'static') === 'static') {
            this._positionedParents.set(parent, currentPosition);
            parent.style.position = 'relative';
        }
    }

    observeBaseCanvases() {
        const interactionCanvas = this.document?.getElementById?.('minimap_overlay');
        if (interactionCanvas !== this._minimapInteractionCanvas) {
            this.removeMinimapInteractionListeners();
            this._minimapInteractionCanvas = interactionCanvas;
            for (const eventName of ['mousedown', 'mousemove', 'mouseup', 'mouseleave']) {
                interactionCanvas?.addEventListener?.(
                    eventName,
                    this.handleProjectionChange
                );
            }
        }

        const ResizeObserverClass = this.window?.ResizeObserver;
        if (!ResizeObserverClass) {
            return;
        }
        if (!this._resizeObserver) {
            this._resizeObserver = new ResizeObserverClass(() => {
                this.scheduleRender();
            });
        }

        const canvases = [
            this.binding?.renderer?.element,
            this.document?.getElementById?.('minimap')
        ];
        for (const canvas of canvases) {
            if (canvas && !this._observedCanvases.has(canvas)) {
                this._resizeObserver.observe(canvas);
                this._observedCanvases.add(canvas);
            }
        }
    }

    removeMinimapInteractionListeners() {
        for (const eventName of ['mousedown', 'mousemove', 'mouseup', 'mouseleave']) {
            this._minimapInteractionCanvas?.removeEventListener?.(
                eventName,
                this.handleProjectionChange
            );
        }
        this._minimapInteractionCanvas = null;
    }

    clearOverlay(overlay) {
        if (!overlay) {
            return;
        }
        const context = overlay.getContext?.('2d');
        context?.clearRect(0, 0, overlay.width, overlay.height);
    }

    renderDungeonOverlay() {
        const renderer = this.binding?.renderer;
        const overlay = this.dungeonOverlay;
        const context = overlay?.getContext?.('2d');
        if (!renderer || !context || typeof renderer.canvas_coords !== 'function') {
            return;
        }

        for (const prediction of this._predictions.values()) {
            if (!prediction.showKnown && this.isServerKnown(prediction.x, prediction.y)) {
                continue;
            }
            if (typeof renderer.in_view === 'function'
                && !renderer.in_view(prediction.x, prediction.y)) {
                continue;
            }
            const rectangle = renderer.canvas_coords(prediction.x, prediction.y);
            if (!rectangle
                || !Number.isFinite(rectangle.x)
                || !Number.isFinite(rectangle.y)
                || rectangle.x + rectangle.width <= 0
                || rectangle.y + rectangle.height <= 0
                || rectangle.x >= overlay.width
                || rectangle.y >= overlay.height) {
                continue;
            }
            this.drawPrediction(context, rectangle, prediction, true);
        }
    }

    renderMinimapOverlay() {
        const overlay = this.minimapOverlay;
        const context = overlay?.getContext?.('2d');
        const projection = this.binding?.getMinimapProjection?.();
        if (!context || !projection || projection.enabled === false) {
            return;
        }

        const cellWidth = numberOr(projection.cellWidth, projection.cell_w);
        const cellHeight = numberOr(projection.cellHeight, projection.cell_h);
        const cellX = numberOr(projection.cellX, projection.cell_x);
        const cellY = numberOr(projection.cellY, projection.cell_y);
        const displayX = numberOr(projection.displayX, projection.display_x);
        const displayY = numberOr(projection.displayY, projection.display_y);
        if (![cellWidth, cellHeight, cellX, cellY, displayX, displayY]
            .every(Number.isFinite)
            || cellWidth <= 0
            || cellHeight <= 0) {
            return;
        }

        for (const prediction of this._predictions.values()) {
            if (!prediction.showKnown && this.isServerKnown(prediction.x, prediction.y)) {
                continue;
            }
            const rectangle = {
                x: displayX + (prediction.x - cellX) * cellWidth,
                y: displayY + (prediction.y - cellY) * cellHeight,
                width: cellWidth,
                height: cellHeight
            };
            if (rectangle.x + rectangle.width <= 0
                || rectangle.y + rectangle.height <= 0
                || rectangle.x >= overlay.width
                || rectangle.y >= overlay.height) {
                continue;
            }
            this.drawPrediction(context, rectangle, prediction, false);
        }
    }

    drawPrediction(context, rectangle, prediction, detailed) {
        const style = this.predictionStyle(prediction);
        const confidence = prediction.confidence ?? 1;
        const alpha = Math.max(0.08, style.alpha * (0.35 + confidence * 0.65));
        const inset = detailed ? Math.max(1, Math.floor(rectangle.width * 0.06)) : 0;
        const x = rectangle.x + inset;
        const y = rectangle.y + inset;
        const width = Math.max(1, rectangle.width - inset * 2);
        const height = Math.max(1, rectangle.height - inset * 2);

        context.save?.();
        context.globalAlpha = alpha;
        context.fillStyle = style.fill;
        context.fillRect(x, y, width, height);
        context.globalAlpha = Math.min(0.9, alpha + 0.2);
        context.strokeStyle = style.stroke;
        context.lineWidth = detailed ? Math.max(1, Math.floor(width / 16)) : 1;
        context.strokeRect?.(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));

        if (detailed && width >= 8 && height >= 8) {
            context.globalAlpha = Math.max(0.12, alpha * 0.7);
            context.beginPath?.();
            context.moveTo?.(x, y + height);
            context.lineTo?.(x + width, y);
            context.stroke?.();
        }
        context.restore?.();
    }

    predictionStyle(prediction) {
        const kind = this.predictionKind(prediction);
        if (kind === 'shallow_water' || kind === 'deep_water') {
            return TERRAIN_STYLES.water;
        }
        return TERRAIN_STYLES[kind] || TERRAIN_STYLES.unknown;
    }

    predictionKind(prediction) {
        const rawKind = prediction.kind
            ?? prediction.terrain
            ?? prediction.feature
            ?? prediction.type;
        if (typeof rawKind === 'string') {
            const normalized = rawKind.toLowerCase();
            if (normalized.includes('wall') || normalized === 'solid') {
                return 'wall';
            }
            if (normalized.includes('door')) {
                return 'door';
            }
            if (normalized.includes('deep_water')
                || normalized.includes('deep water')) {
                return 'deep_water';
            }
            if (normalized.includes('shallow_water')
                || normalized.includes('shallow water')) {
                return 'shallow_water';
            }
            if (normalized.includes('water')) {
                return 'water';
            }
            if (normalized.includes('lava')) {
                return 'lava';
            }
            if (normalized.includes('stair') || normalized.includes('exit')) {
                return 'stair';
            }
            if (normalized.includes('portal') || normalized.includes('transporter')) {
                return 'portal';
            }
            if (normalized.includes('altar')) {
                return 'altar';
            }
            if (normalized.includes('statue') || normalized.includes('idol')) {
                return 'statue';
            }
            if (normalized.includes('floor') || normalized === 'open') {
                return 'floor';
            }
        }

        const enums = this.binding?.enums || {};
        const mf = prediction.mf;
        if (!Number.isFinite(mf)) {
            return 'unknown';
        }
        if (mf === enums.MF_WALL || mf === enums.MF_MAP_WALL) {
            return 'wall';
        }
        if (mf === enums.MF_DOOR) {
            return 'door';
        }
        if (mf === enums.MF_WATER) {
            return 'shallow_water';
        }
        if (mf === enums.MF_DEEP_WATER) {
            return 'deep_water';
        }
        if (mf === enums.MF_LAVA) {
            return 'lava';
        }
        if (mf === enums.MF_STAIR_UP
            || mf === enums.MF_STAIR_DOWN
            || mf === enums.MF_STAIR_BRANCH) {
            return 'stair';
        }
        if (mf === enums.MF_PORTAL
            || mf === enums.MF_TRANSPORTER
            || mf === enums.MF_TRANSPORTER_LANDING) {
            return 'portal';
        }
        if (mf === enums.MF_FLOOR || mf === enums.MF_MAP_FLOOR) {
            return 'floor';
        }
        return 'unknown';
    }

    isServerKnown(x, y) {
        const cell = this._observedCells.get(cellKey(x, y));
        if (!cell) {
            return false;
        }

        const unseenFeature = this.binding?.enums?.MF_UNSEEN ?? 0;
        if ((cell.f === 0 || cell.f == null)
            && (cell.mf === undefined || cell.mf === unseenFeature)) {
            return false;
        }
        if (cell.mf !== undefined && cell.mf !== unseenFeature) {
            return true;
        }

        const background = cell.t?.bg;
        if (background && typeof background === 'object') {
            return background.UNSEEN !== true && cell.f !== 0;
        }
        if (Number.isSafeInteger(background)) {
            return (background & 0x00040000) === 0 && cell.f !== 0;
        }
        return cell.f !== undefined && cell.f !== 0;
    }

    destroy({releaseBinding = true} = {}) {
        this.removeShadowCursorHandlers();
        this.clearShadowMapCursor({restore: false, remove: true});
        this._xModeActive = false;
        this._serverMapCursor = null;
        this.clearNativePredictions();
        this._predictions.clear();
        this._observedCells.clear();
        if (releaseBinding) {
            this._unreliableTerrainCells.clear();
        }
        this.clearTerrainSamples();
        this._pendingMaps = new WeakMap();
        this._pendingNativeReapply = new WeakMap();
        if (releaseBinding) {
            this._playerOnLevel = null;
        }
        this._player = {};
        this._version = null;
        this._clientVersion = null;
        this._revealEnabled = false;
        const ioHook = this.dwem?.Modules?.IOHook;
        ioHook?.handle_message?.before?.removeHandler?.(HANDLER_ID);
        ioHook?.handle_message?.after?.removeHandler?.(HANDLER_ID);
        ioHook?.send_message?.before?.removeHandler?.(HANDLER_ID);
        this.window?.removeEventListener?.('resize', this.handleWindowResize);

        if (this._renderRequest !== null) {
            this.window?.cancelAnimationFrame?.(this._renderRequest);
            this._renderRequest = null;
        }
        this._resizeObserver?.disconnect?.();
        this._resizeObserver = null;
        this._observedCanvases.clear();
        this.removeMinimapInteractionListeners();

        this.removePredictionOverlays();
        const visibilityBroker = this.dwem
            ?.MapPredictorKnowledgeVisibilityBroker;
        visibilityBroker?.uninstall?.();
        if (this.dwem?.MapPredictorKnowledgeVisibilityBroker
            === visibilityBroker) {
            delete this.dwem.MapPredictorKnowledgeVisibilityBroker;
        }
        const rendererTintTarget = this._rendererTintTarget
            || this.dwem?.MapPredictorRendererTintTarget;
        uninstallMapPredictorRendererTint(rendererTintTarget);
        if (this.dwem?.MapPredictorRendererTintTarget === rendererTintTarget) {
            delete this.dwem.MapPredictorRendererTintTarget;
        }
        this.dwem?.MapPredictorBackgroundFlagBroker?.uninstall?.();

        for (const [parent, previousPosition] of this._positionedParents) {
            if (parent.style?.position === 'relative') {
                parent.style.position = previousPosition;
            }
        }
        this._positionedParents.clear();
        this._listeners.clear();
        this.removeDynamicSourceMappers();
        if (releaseBinding) {
            delete this.dwem?.MapPredictorWebtilesBindingBroker;
            this.binding = null;
            this._rendererTintTarget = null;
        }
        this._installed = false;
        this._destroyed = true;
    }
}
