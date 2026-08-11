import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import {MapMatcher, normalizeTerrainKind} from '../matcher.js';
import {
    auditedZigguratTemplates,
    materializeZigguratTemplates,
    ZIGGURAT_LUA_PATH
} from '../ziggurat-destinations.js';

const DES_PATH = 'crawl-ref/source/dat/des/portals/ziggurat.des';
const WIDTH = 80;
const HEIGHT = 70;
const CX = 40;
const CY = 35;
const EXPECTED_CANDIDATES = Object.freeze([
    5, 5, 9, 7, 9, 8, 11, 8, 13, 10, 14, 11, 14, 12,
    18, 14, 18, 14, 19, 16, 23, 17, 22, 18, 22, 19, 25
]);

function sourceFile(root, relative) {
    const filename = path.join(root, relative.replace(/^crawl-ref\//u, ''));
    assert.ok(fs.existsSync(filename), `missing exact source: ${filename}`);
    return fs.readFileSync(filename, 'utf8');
}

function rawBlocks(source) {
    const matches = [...source.matchAll(/^NAME:\s*(.+?)\s*$/gmu)];
    return matches.map((match, index) => source.slice(
        match.index,
        matches[index + 1]?.index ?? source.length
    ));
}

function rawPillarSpecs(source) {
    return rawBlocks(source).flatMap(block => {
        const tags = new Set([...block.matchAll(/^TAGS:\s*(.*?)\s*$/gmu)]
            .flatMap(match => match[1].trim().split(/\s+/u)));
        if (!tags.has('ziggurat_pillar')) {
            return [];
        }
        const body = block.match(/(?:^|\n)MAP\n([\s\S]*?)\nENDMAP/u)?.[1];
        assert.notEqual(body, undefined);
        const rows = body.split('\n');
        return [{
            width: Math.max(...rows.map(row => row.length)),
            height: rows.length,
            centered: tags.has('centered')
        }];
    });
}

function baseGrid() {
    return Array.from({length: HEIGHT}, () =>
        Array.from({length: WIDTH}, () => 'wall'));
}

function fill(grid, x1, y1, x2, y2) {
    for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
            grid[y][x] = 'floor';
        }
    }
}

function clamp(value, maximum) {
    return Math.max(2, Math.min(maximum - 3, value));
}

function independentState(depth, state) {
    const grid = baseGrid();
    const area = 30 + 18 * depth + depth * depth;
    let entry;
    let exit;
    if (state.builder === 'rectangle') {
        const rectangleArea = Math.floor(area * 3 / 4);
        const a = Math.floor(Math.sqrt(
            rectangleArea + 4 * state.localExc * state.localExc
        ));
        const b = a - 2 * state.localExc;
        const a2 = Math.floor(a / 2) + a % 2;
        const b2 = Math.floor(b / 2) + b % 2;
        const x1 = clamp(CX - a2, WIDTH);
        const y1 = clamp(CY - b2, HEIGHT);
        const x2 = clamp(CX + a2, WIDTH);
        const y2 = clamp(CY + b2, HEIGHT);
        fill(grid, x1, y1, x2, y2);
        const shift = Math.floor(
            depth / 2 * (200 - state.zigExc) / 300
        );
        fill(
            grid,
            clamp(CX + y1 - CY, WIDTH),
            clamp(CY + x1 - CX + shift, HEIGHT),
            clamp(CX + y2 - CY, WIDTH),
            clamp(CY + x2 - CX - shift, HEIGHT)
        );
        entry = {x: x1, y: CY};
        exit = {x: x2, y: CY};
    } else if (state.builder === 'ellipse') {
        const b = Math.floor(Math.sqrt(
            200 * area / (200 + state.zigExc) * 100 / 314
        ));
        const a = Math.floor(b * (200 + state.zigExc) / 200);
        assert.equal(a, state.a);
        assert.equal(b, state.b);
        for (let x = 0; x < WIDTH; x++) {
            for (let y = 0; y < HEIGHT; y++) {
                if (b * b * (CX - x) ** 2 + a * a * (CY - y) ** 2
                    <= a * a * b * b) {
                    grid[y][x] = 'floor';
                }
            }
        }
        entry = {x: CX - a + 2, y: CY};
        exit = {x: CX + a - 2, y: CY};
    } else {
        assert.equal(state.builder, 'hex');
        const a = Math.floor(Math.sqrt(2 * area / Math.sqrt(27))) + 2;
        const b = Math.floor(a * Math.sqrt(3) / 4);
        assert.equal(a, state.a);
        assert.equal(b, state.b);
        const left = {
            x: Math.floor(CX - (a + Math.sqrt(2 * a)) / 2),
            y: CY
        };
        const right = {x: 2 * CX - left.x, y: CY};
        for (let x = 1; x < WIDTH - 1; x++) {
            for (let y = 1; y < HEIGHT - 1; y++) {
                const dlx = x - left.x;
                const drx = x - right.x;
                const dly = y - left.y;
                const dry = y - right.y;
                if (dlx >= dly && drx <= dry
                    && dlx >= -dly && drx <= -dry
                    && y >= CY - b && y <= CY + b) {
                    grid[y][x] = 'floor';
                }
            }
        }
        entry = {x: left.x + 1, y: CY};
        exit = {x: right.x - 1, y: CY};
    }
    if (depth % 2 === 0) {
        [entry, exit] = [exit, entry];
    }
    return {grid, entry, exit};
}

function possiblePillarMask(truth, specs, depth) {
    const mask = new Uint8Array(WIDTH * HEIGHT);
    const protectedCells = new Set([
        `${truth.entry.x},${truth.entry.y}`,
        `${truth.exit.x},${truth.exit.y - 1}`,
        `${truth.exit.x},${truth.exit.y + 1}`,
        ...(depth < 27 ? [`${truth.exit.x},${truth.exit.y}`] : [])
    ]);
    const good = (x, y, width, height) => {
        for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) {
                if (truth.grid[y + dy]?.[x + dx] !== 'floor'
                    || protectedCells.has(`${x + dx},${y + dy}`)) {
                    return false;
                }
            }
        }
        return true;
    };
    const mark = (x, y, width, height) => {
        for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) {
                mask[(y + dy) * WIDTH + x + dx] = 1;
            }
        }
    };
    for (const spec of specs) {
        if (spec.centered) {
            const sizes = spec.width === spec.height
                ? [[spec.width, spec.height]]
                : [[spec.width, spec.height], [spec.height, spec.width]];
            if (sizes.some(([width, height]) =>
                good(CX, CY, width, height))) {
                for (const [width, height] of sizes) {
                    mark(
                        CX - Math.floor(width / 2),
                        CY - Math.floor(height / 2),
                        width,
                        height
                    );
                }
            }
            continue;
        }
        for (let offset = -15; offset <= -spec.width; offset++) {
            const points = [
                [CX + offset - spec.width + 1,
                    CY + offset - spec.height + 1],
                [CX + offset - spec.width + 1, CY - offset],
                [CX - offset, CY - offset],
                [CX - offset, CY + offset - spec.height + 1]
            ];
            if (points.every(([x, y]) =>
                good(x, y, spec.width, spec.height))) {
                points.forEach(([x, y]) =>
                    mark(x, y, spec.width, spec.height));
            }
        }
    }
    return mask;
}

function expectedKind(truth, depth, x, y) {
    if (x === truth.entry.x && y === truth.entry.y) {
        return 'floor';
    }
    if (x === truth.exit.x && Math.abs(y - truth.exit.y) === 1) {
        return 'portal';
    }
    if (depth < 27 && x === truth.exit.x && y === truth.exit.y) {
        return 'stair';
    }
    return truth.grid[y][x];
}

function assertTemplateSound(template, pillarSpecs) {
    const depth = template.metadata.ziggurat.depth;
    for (const state of template.metadata.ziggurat.states) {
        const truth = independentState(depth, state);
        const pillarMask = possiblePillarMask(truth, pillarSpecs, depth);
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const kinds = template.grid[y][x].kinds
                    .map(normalizeTerrainKind).filter(Boolean);
                const protectedFeature = x === truth.entry.x
                    && y === truth.entry.y
                    || x === truth.exit.x
                        && Math.abs(y - truth.exit.y) <= 1;
                if (pillarMask[y * WIDTH + x] && !protectedFeature) {
                    assert.equal(kinds.length, 0,
                        `unmasked pillar cell d${depth} ${x},${y}`);
                }
                if (kinds.length === 1) {
                    assert.equal(
                        kinds[0],
                        expectedKind(truth, depth, x, y),
                        `${state.builder} d${depth} ${x},${y}`
                    );
                }
            }
        }
    }
}

function initialObservations(template) {
    let entry = null;
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (template.grid[y][x].glyph === 'A') {
                entry = {x, y};
            }
        }
    }
    assert.ok(entry);
    const observations = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (Math.max(Math.abs(x - entry.x), Math.abs(y - entry.y)) > 8) {
                continue;
            }
            const kinds = template.grid[y][x].kinds
                .map(normalizeTerrainKind).filter(Boolean);
            const kind = kinds[0] || 'floor';
            if (kind === 'wall') {
                let bordersFloor = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (template.grid[y + dy]?.[x + dx]?.kinds
                            ?.includes('floor')) {
                            bordersFloor = true;
                        }
                    }
                }
                if (!bordersFloor) {
                    continue;
                }
            }
            observations.push({x: x - entry.x, y: y - entry.y, kind});
        }
    }
    return {entry, observations};
}

function matcherSmoke(templates) {
    let ready = 0;
    let predictions = 0;
    for (const truthTemplate of templates) {
        const {entry, observations} = initialObservations(truthTemplate);
        const matcher = new MapMatcher({
            requireExhaustivePlacement: true,
            minPredictedCells: 1
        });
        matcher.setTemplates(templates);
        matcher.updateObservations(observations);
        const result = matcher.getResult();
        assert.equal(result.reason, 'ready');
        ready++;
        predictions += result.predictions.length;
        for (const prediction of result.predictions) {
            const cell = truthTemplate.grid[prediction.y + entry.y]
                ?.[prediction.x + entry.x];
            assert.equal(
                prediction.kind,
                normalizeTerrainKind(cell?.kinds?.[0]),
                `unsafe matcher prediction ${prediction.x},${prediction.y}`
            );
        }
    }
    return {ready, predictions};
}

const root = process.argv[2] || process.env.CRAWL_SOURCE_ROOT;
assert.ok(root,
    'usage: node ziggurat-exact-oracle.mjs <crawl-ref source root>');
const source = sourceFile(root, DES_PATH);
const lua = sourceFile(root, ZIGGURAT_LUA_PATH);
const parsed = parseDes(source, {path: DES_PATH});
const options = {
    path: DES_PATH,
    dependencies: {[ZIGGURAT_LUA_PATH]: lua}
};
const descriptor = parseRuntimeDes(source, options);
assert.equal(descriptor.length, 1);
assert.equal(auditedZigguratTemplates(`${source}\n`, parsed, {
    path: DES_PATH,
    dependencies: {[ZIGGURAT_LUA_PATH]: lua}
}).length, 0, 'DES mutation did not fail closed');
assert.equal(auditedZigguratTemplates(source, parsed, {
    path: DES_PATH,
    dependencies: {[ZIGGURAT_LUA_PATH]: `${lua}\n`}
}).length, 0, 'Lua mutation did not fail closed');

const pillarSpecs = rawPillarSpecs(source);
assert.equal(pillarSpecs.length, 30);
const anchored = selectSafeTemplates(
    descriptor,
    {place: 'Ziggurat', depth: 1},
    {levelEntry: {x: 0, y: 0}}
);
assert.equal(anchored.length, 1);
assert.deepEqual(anchored[0].metadata.matchAnchor, {
    x: 0,
    y: 0,
    glyph: 'A',
    requireObservedKind: 'floor'
});
const started = performance.now();
const rows = [];
for (let depth = 1; depth <= 27; depth++) {
    const templates = materializeZigguratTemplates(anchored, {depth});
    assert.equal(templates.length, EXPECTED_CANDIDATES[depth - 1]);
    const states = templates.flatMap(template =>
        template.metadata.ziggurat.states);
    assert.equal(states.filter(state => state.builder === 'hex').length, 1);
    assert.equal(states.filter(state => state.builder === 'ellipse').length,
        101);
    assert.equal(states.filter(state => state.builder === 'rectangle').length,
        depth % 2 ? 202 : 101);
    templates.forEach(template => assertTemplateSound(template, pillarSpecs));
    const smoke = [1, 10, 27].includes(depth)
        ? matcherSmoke(templates)
        : null;
    rows.push({depth, candidates: templates.length, states: states.length, smoke});
}

console.log(JSON.stringify({
    sourceAudit: 'exact-byte-sha256',
    depths: rows,
    mutationsRejected: 2,
    elapsedMs: Math.round(performance.now() - started)
}, null, 2));
