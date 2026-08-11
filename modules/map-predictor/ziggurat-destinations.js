const ZIGGURAT_PATH = '/dat/des/portals/ziggurat.des';
export const ZIGGURAT_LUA_PATH = 'crawl-ref/source/dat/dlua/ziggurat.lua';

// The generator and its tagged pillar inventory are byte-identical in the
// two Crawl builds currently served by CNC. Ziggurat terrain is produced by
// Lua rather than by the empty MAP body in ziggurat.des, so accepting either
// file without an exact audit would turn an engine change into guessed map
// data. These hashes deliberately fail closed on every source change.
const ZIGGURAT_DES_SHA256 =
    'b15495df94e66e556485e4fe712f5dfda346b721fc58d0132ff06e31c28d01f7';
const ZIGGURAT_LUA_SHA256 =
    '8500e608a48835e94512f104899ac73f1829081a78d8d84387d464bb6eec506d';

const WORLD_WIDTH = 80;
const WORLD_HEIGHT = 70;
const CENTRE_X = WORLD_WIDTH / 2;
const CENTRE_Y = WORLD_HEIGHT / 2;
const MAX_DEPTH = 27;

const ZIGGURAT_MATCH_POLICY = Object.freeze({
    minScore: 0.997,
    plausibleMinScore: 0.97,
    plausibleSlack: 0.06,
    minEvidenceCells: 28,
    minEvidenceWeight: 32,
    minDistinctKinds: 2,
    minCoverage: 0.004,
    minSpanXRatio: 0.1,
    minSpanYRatio: 0.1,
    requiredKinds: ['wall', 'floor'],
    exhaustivePlacement: true
});

function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

/**
 * Small synchronous SHA-256 for source auditing. Crawl's two audited files
 * are ASCII; rejecting any non-byte character also prevents a lossy hash of
 * a future UTF-16 string.
 */
export function sha256Ascii(value) {
    const source = String(value ?? '');
    const bytes = [];
    for (let index = 0; index < source.length; index++) {
        const code = source.charCodeAt(index);
        if (code > 0x7f) {
            return null;
        }
        bytes.push(code);
    }
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (const shift of [24, 16, 8, 0]) {
        bytes.push((high >>> shift) & 0xff);
    }
    for (const shift of [24, 16, 8, 0]) {
        bytes.push((low >>> shift) & 0xff);
    }

    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const words = new Uint32Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let index = 0; index < 16; index++) {
            const position = offset + index * 4;
            words[index] = ((bytes[position] << 24)
                | (bytes[position + 1] << 16)
                | (bytes[position + 2] << 8)
                | bytes[position + 3]) >>> 0;
        }
        for (let index = 16; index < 64; index++) {
            const left = words[index - 15];
            const right = words[index - 2];
            const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18)
                ^ (left >>> 3);
            const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19)
                ^ (right >>> 10);
            words[index] = (words[index - 16] + sigma0
                + words[index - 7] + sigma1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index++) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11)
                ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choice
                + constants[index] + words[index]) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13)
                ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(word => word.toString(16).padStart(8, '0')).join('');
}

function tagsFor(template) {
    const tags = template?.metadata?.tags ?? template?.tags ?? [];
    return new Set(Array.isArray(tags)
        ? tags
        : String(tags || '').split(/\s+/u).filter(Boolean));
}

function auditedPillarSpecs(parsed) {
    const pillars = (parsed || []).filter(template =>
        tagsFor(template).has('ziggurat_pillar'));
    if (pillars.length !== 30) {
        return null;
    }
    const specs = [];
    for (const pillar of pillars) {
        const tags = tagsFor(pillar);
        if (!tags.has('unrand') || !tags.has('no_exits')
            || pillar?.metadata?.place != null
            || pillar?.metadata?.orient != null
            || !Number.isInteger(pillar.width) || pillar.width < 1
            || pillar.width > 7
            || !Number.isInteger(pillar.height) || pillar.height < 1
            || pillar.height > 7
            || !Array.isArray(pillar.grid)
            || pillar.grid.length !== pillar.height) {
            return null;
        }
        specs.push({
            name: pillar.name,
            width: pillar.width,
            height: pillar.height,
            centered: tags.has('centered')
        });
    }
    return specs;
}

function newTerrainGrid() {
    return Array.from({length: WORLD_HEIGHT}, () =>
        Array.from({length: WORLD_WIDTH}, () => 'wall'));
}

function clampInBounds(value, maximum) {
    return Math.min(maximum - 3, Math.max(2, value));
}

function fillRectangle(grid, x1, y1, x2, y2) {
    for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
            if (grid[y]?.[x] !== undefined) {
                grid[y][x] = 'floor';
            }
        }
    }
}

function mapArea(depth) {
    return 30 + 18 * depth + depth * depth;
}

function rectangleState(depth, zigExc, localExc) {
    const grid = newTerrainGrid();
    const area = Math.floor(mapArea(depth) * 3 / 4);
    const a = Math.floor(Math.sqrt(area + 4 * localExc * localExc));
    const b = a - 2 * localExc;
    const a2 = Math.floor(a / 2) + (a % 2);
    const b2 = Math.floor(b / 2) + (b % 2);
    const x1 = clampInBounds(CENTRE_X - a2, WORLD_WIDTH);
    const y1 = clampInBounds(CENTRE_Y - b2, WORLD_HEIGHT);
    const x2 = clampInBounds(CENTRE_X + a2, WORLD_WIDTH);
    const y2 = clampInBounds(CENTRE_Y + b2, WORLD_HEIGHT);
    fillRectangle(grid, x1, y1, x2, y2);

    const shift = Math.floor(depth / 2 * (200 - zigExc) / 300);
    const nx1 = clampInBounds(CENTRE_X + y1 - CENTRE_Y, WORLD_WIDTH);
    const ny1 = clampInBounds(
        CENTRE_Y + x1 - CENTRE_X + shift,
        WORLD_HEIGHT
    );
    const nx2 = clampInBounds(CENTRE_X + y2 - CENTRE_Y, WORLD_WIDTH);
    const ny2 = clampInBounds(
        CENTRE_Y + x2 - CENTRE_X - shift,
        WORLD_HEIGHT
    );
    fillRectangle(grid, nx1, ny1, nx2, ny2);
    let entry = {x: x1, y: CENTRE_Y};
    let exit = {x: x2, y: CENTRE_Y};
    if (depth % 2 === 0) {
        [entry, exit] = [exit, entry];
    }
    return {grid, entry, exit, state: {builder: 'rectangle', zigExc, localExc}};
}

function ellipseState(depth, zigExc) {
    const grid = newTerrainGrid();
    const area = mapArea(depth);
    const b = Math.floor(Math.sqrt(
        200 * area / (200 + zigExc) * 100 / 314
    ));
    const a = Math.floor(b * (200 + zigExc) / 200);
    for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
            if (b * b * (CENTRE_X - x) * (CENTRE_X - x)
                + a * a * (CENTRE_Y - y) * (CENTRE_Y - y)
                <= a * a * b * b) {
                grid[y][x] = 'floor';
            }
        }
    }
    let entry = {x: CENTRE_X - a + 2, y: CENTRE_Y};
    let exit = {x: CENTRE_X + a - 2, y: CENTRE_Y};
    if (depth % 2 === 0) {
        [entry, exit] = [exit, entry];
    }
    return {grid, entry, exit, state: {builder: 'ellipse', zigExc, a, b}};
}

function hexagonState(depth) {
    const grid = newTerrainGrid();
    const area = mapArea(depth);
    const a = Math.floor(Math.sqrt(2 * area / Math.sqrt(27))) + 2;
    const b = Math.floor(a * Math.sqrt(3) / 4);
    const left = {
        x: Math.floor(CENTRE_X - (a + Math.sqrt(2 * a)) / 2),
        y: CENTRE_Y
    };
    const right = {x: 2 * CENTRE_X - left.x, y: CENTRE_Y};
    for (let x = 1; x < WORLD_WIDTH - 1; x++) {
        for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
            const dlx = x - left.x;
            const drx = x - right.x;
            const dly = y - left.y;
            const dry = y - right.y;
            if (dlx >= dly && drx <= dry
                && dlx >= -dly && drx <= -dry
                && y >= CENTRE_Y - b && y <= CENTRE_Y + b) {
                grid[y][x] = 'floor';
            }
        }
    }
    let entry = {x: left.x + 1, y: left.y};
    let exit = {x: right.x - 1, y: right.y};
    if (depth % 2 === 0) {
        [entry, exit] = [exit, entry];
    }
    return {grid, entry, exit, state: {builder: 'hex', a, b}};
}

function rectangleIsFloor(grid, x, y, width, height, protectedCells) {
    for (let localY = 0; localY < height; localY++) {
        for (let localX = 0; localX < width; localX++) {
            const worldX = x + localX;
            const worldY = y + localY;
            if (grid[worldY]?.[worldX] !== 'floor'
                || protectedCells[worldY * WORLD_WIDTH + worldX]) {
                return false;
            }
        }
    }
    return true;
}

function addRectangle(mask, x, y, width, height) {
    for (let localY = 0; localY < height; localY++) {
        for (let localX = 0; localX < width; localX++) {
            const worldX = x + localX;
            const worldY = y + localY;
            mask[worldY * WORLD_WIDTH + worldX] = 1;
        }
    }
}

function possiblePillarMask(state, specs, depth) {
    const protectedCells = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
    const protect = ({x, y}) => {
        protectedCells[y * WORLD_WIDTH + x] = 1;
    };
    protect(state.entry);
    protect({x: state.exit.x, y: state.exit.y - 1});
    protect({x: state.exit.x, y: state.exit.y + 1});
    if (depth < MAX_DEPTH) {
        protect(state.exit);
    }
    const mask = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
    for (const spec of specs) {
        if (spec.centered) {
            // good_place(c) treats c as the top-left of its floor check, but
            // dgn.place_map(map, ..., c.x, c.y) treats it as the MAP_FLOAT
            // centre and writes at c - size/2. resolve_map/place_map can each
            // rotate a non-square pillar, so conservatively admit both size
            // orientations for the gate and for the actual footprint.
            const sizes = spec.width === spec.height
                ? [[spec.width, spec.height]]
                : [[spec.width, spec.height], [spec.height, spec.width]];
            const gateCanSucceed = sizes.some(([width, height]) =>
                rectangleIsFloor(
                    state.grid,
                    CENTRE_X,
                    CENTRE_Y,
                    width,
                    height,
                    protectedCells
                ));
            if (gateCanSucceed) {
                for (const [width, height] of sizes) {
                    addRectangle(
                        mask,
                        CENTRE_X - Math.floor(width / 2),
                        CENTRE_Y - Math.floor(height / 2),
                        width,
                        height
                    );
                }
            }
            continue;
        }
        for (let offset = -15; offset <= -spec.width; offset++) {
            const placements = [
                {
                    x: CENTRE_X + offset - spec.width + 1,
                    y: CENTRE_Y + offset - spec.height + 1
                },
                {
                    x: CENTRE_X + offset - spec.width + 1,
                    y: CENTRE_Y - offset
                },
                {x: CENTRE_X - offset, y: CENTRE_Y - offset},
                {
                    x: CENTRE_X - offset,
                    y: CENTRE_Y + offset - spec.height + 1
                }
            ];
            if (!placements.every(point => rectangleIsFloor(
                state.grid,
                point.x,
                point.y,
                spec.width,
                spec.height,
                protectedCells
            ))) {
                continue;
            }
            for (const point of placements) {
                addRectangle(mask, point.x, point.y, spec.width, spec.height);
            }
        }
    }
    return mask;
}

function cell(kind, glyph) {
    return {kinds: [kind], certain: true, glyph, possibleGlyphs: [glyph]};
}

const WALL_CELL = Object.freeze(cell('wall', 'x'));
const FLOOR_CELL = Object.freeze(cell('floor', '.'));
const ENTRY_CELL = Object.freeze(cell('floor', 'A'));
const STAIR_CELL = Object.freeze(cell('stairs', '>'));
const PORTAL_CELL = Object.freeze(cell('portal', 'P'));
const UNCERTAIN_CELL = Object.freeze({
    kinds: Object.freeze([]),
    certain: false,
    glyph: '?',
    possibleGlyphs: Object.freeze(['?'])
});

function runtimeGrid(state, specs, depth) {
    const mask = possiblePillarMask(state, specs, depth);
    const grid = state.grid.map((row, y) => row.map((kind, x) =>
        mask[y * WORLD_WIDTH + x]
            ? UNCERTAIN_CELL
            : kind === 'wall' ? WALL_CELL : FLOOR_CELL));
    grid[state.entry.y][state.entry.x] = ENTRY_CELL;
    if (depth < MAX_DEPTH) {
        grid[state.exit.y][state.exit.x] = STAIR_CELL;
    }
    grid[state.exit.y - 1][state.exit.x] = PORTAL_CELL;
    grid[state.exit.y + 1][state.exit.x] = PORTAL_CELL;
    return grid;
}

function stateKey(state, specs, depth) {
    const mask = possiblePillarMask(state, specs, depth);
    const values = new Array(WORLD_WIDTH * WORLD_HEIGHT);
    for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let x = 0; x < WORLD_WIDTH; x++) {
            const index = y * WORLD_WIDTH + x;
            values[index] = mask[index]
                ? '?'
                : state.grid[y][x] === 'wall' ? 'x' : '.';
        }
    }
    values[state.entry.y * WORLD_WIDTH + state.entry.x] = 'A';
    if (depth < MAX_DEPTH) {
        values[state.exit.y * WORLD_WIDTH + state.exit.x] = '>';
    }
    values[(state.exit.y - 1) * WORLD_WIDTH + state.exit.x] = 'P';
    values[(state.exit.y + 1) * WORLD_WIDTH + state.exit.x] = 'P';
    return values.join('');
}

function statesForDepth(depth) {
    const states = [hexagonState(depth)];
    for (let zigExc = 0; zigExc <= 100; zigExc++) {
        states.push(ellipseState(depth, zigExc));
        const baseExc = Math.floor(depth / 2);
        states.push(rectangleState(depth, zigExc, baseExc));
        if ((depth - 1) % 2 === 0) {
            states.push(rectangleState(depth, zigExc, baseExc + 1));
        }
    }
    return states;
}

function templatesForDepth(depth, pillarSpecs) {
    const byGrid = new Map();
    for (const state of statesForDepth(depth)) {
        const key = stateKey(state, pillarSpecs, depth);
        const existing = byGrid.get(key);
        if (existing) {
            existing.states.push(state.state);
            continue;
        }
        byGrid.set(key, {state, states: [state.state]});
    }
    return [...byGrid.values()].map((value, index) => ({
        name: `ziggurat_generated_d${depth}_${index + 1}`,
        path: `generated:${ZIGGURAT_LUA_PATH}`,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        grid: runtimeGrid(value.state, pillarSpecs, depth),
        metadata: {
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror', 'no_dump'],
            place: 'Ziggurat',
            depth: `Ziggurat:${depth}`,
            orient: 'encompass',
            encompass: true,
            allowedTransforms: ['identity'],
            hasUncertainCells: true,
            parseWarnings: [],
            sourceLine: 1,
            sourceAudit: 'ziggurat-lua-generator-v1',
            entryAnchorGlyph: 'A',
            entryAnchorObservedKind: 'floor',
            matchPolicy: {...ZIGGURAT_MATCH_POLICY},
            ziggurat: {
                depth,
                states: value.states
            }
        }
    }));
}

/**
 * Replays the audited Lua terrain builders for all 27 floors. Per-depth
 * selection later leaves only the finite silhouettes reachable for that
 * floor. Dynamic pillar cells are excluded from both scoring and prediction;
 * their complete possible placement union is derived from the audited sizes.
 */
export function auditedZigguratTemplates(source, parsed, options = {}) {
    if (!String(options?.path || '').endsWith(ZIGGURAT_PATH)
        || sha256Ascii(source) !== ZIGGURAT_DES_SHA256
        || sha256Ascii(options?.dependencies?.[ZIGGURAT_LUA_PATH])
            !== ZIGGURAT_LUA_SHA256) {
        return [];
    }
    const generator = (parsed || []).filter(template =>
        template?.name === 'ziggurat1');
    if (generator.length !== 1
        || generator[0]?.metadata?.place !== 'Zig'
        || generator[0]?.width !== 0
        || generator[0]?.height !== 0
        || (generator[0]?.grid?.length || 0) !== 0) {
        return [];
    }
    const pillarSpecs = auditedPillarSpecs(parsed);
    if (!pillarSpecs) {
        return [];
    }
    // Keep the source-cache value compact. Expanding all 27 floors would put
    // more than two million cell objects into IndexedDB even though a live
    // player can occupy only one floor. ensureSources materializes this
    // audited descriptor after its normal PLACE/DEPTH filtering step.
    return [{
        name: 'ziggurat_generated_descriptor',
        path: `generated:${ZIGGURAT_LUA_PATH}`,
        width: 1,
        height: 1,
        grid: [[cell('wall', 'x')]],
        metadata: {
            tags: ['no_rotate', 'no_hmirror', 'no_vmirror', 'no_dump'],
            place: 'Ziggurat',
            depth: 'Ziggurat:1-27',
            orient: 'encompass',
            encompass: true,
            allowedTransforms: ['identity'],
            hasUncertainCells: true,
            parseWarnings: [],
            sourceLine: 1,
            sourceAudit: 'ziggurat-lua-generator-descriptor-v1',
            entryAnchorGlyph: 'A',
            entryAnchorObservedKind: 'floor',
            matchPolicy: {...ZIGGURAT_MATCH_POLICY},
            zigguratFactory: {pillarSpecs}
        }
    }];
}

export function materializeZigguratTemplates(templates, player) {
    const depth = Number(player?.depth);
    return (templates || []).flatMap(template => {
        if (template?.metadata?.sourceAudit
            !== 'ziggurat-lua-generator-descriptor-v1') {
            return [template];
        }
        const pillarSpecs = template.metadata?.zigguratFactory?.pillarSpecs;
        if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH
            || !Array.isArray(pillarSpecs) || pillarSpecs.length !== 30) {
            return [];
        }
        return templatesForDepth(depth, pillarSpecs).map(materialized => ({
            ...materialized,
            metadata: {
                ...materialized.metadata,
                ...(template.metadata?.matchAnchor
                    ? {matchAnchor: {...template.metadata.matchAnchor}}
                    : {})
            }
        }));
    });
}

export default auditedZigguratTemplates;
