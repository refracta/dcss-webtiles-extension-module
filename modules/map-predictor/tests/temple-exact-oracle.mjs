import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import MapMatcher, {
    allowedTransforms,
    normalizeTerrainKind
} from '../matcher.js';
import {auditedTempleDestinationNames} from '../temple-destinations.js';

const TEMPLE_PATH = 'crawl-ref/source/dat/des/branches/temple.des';
const EXPECTED_SHA256 =
    'd780c20b276faf1ae42b2d01401f102eb7ddfaaef3e7e62d5f17572913f9cfe6';
const DEFAULT_ROOTS = ['/tmp/dwem-crawl-d29', '/tmp/dwem-crawl-1b83'];
const roots = (process.argv.length > 2
    ? process.argv.slice(2)
    : DEFAULT_ROOTS).filter(root => fs.existsSync(`${root}/${TEMPLE_PATH}`));

if (!roots.length) {
    throw new Error('No exact Crawl checkout with temple.des');
}

const DYNAMIC_EXITS = Object.freeze({
    jpeg_temple_island: Object.freeze([
        "NSUBST: A = 1:{ / *:'"
    ]),
    nicolae_temple_hex_pool: Object.freeze([
        'NSUBST: { = 1:{ / *:.'
    ]),
    nicolae_temple_figure_eight: Object.freeze([
        'NSUBST: A = 1:{ / *:B'
    ]),
    regret_index_temple_waves: Object.freeze([
        'SHUFFLE: {<defgh / {<defgh / <{hgfed'
    ]),
    nicolae_temple_elliptical: Object.freeze([
        'SHUFFLE: G{',
        'NSUBST: { = 1:{ / *:G'
    ]),
    minmay_crystal_snake_temple: Object.freeze([
        'NSUBST: T = 1:{ / *:T'
    ]),
    nicolae_temple_the_god_donut: Object.freeze([
        'NSUBST: A = 1:{ / *:B'
    ]),
    regret_index_temple_sigil_plot: Object.freeze([
        'NSUBST: A = 1:{ / *:B'
    ]),
    mainiacjoe_temple_archimedes_tessellation: Object.freeze([
        'NSUBST: B = 1:{ / *:B'
    ]),
    mainiacjoe_temple_hex_bubbles: Object.freeze([
        'NSUBST: B = 1:{ / *:B'
    ])
});

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(source);
    assert.ok(match, `${name}: missing source block`);
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const tail = source.slice(start + 1);
    const next = /\nNAME:\s*/u.exec(tail);
    return source.slice(start, next ? start + 1 + next.index : undefined);
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(block);
    assert.ok(match, 'missing MAP block');
    return match[1].split('\n');
}

function headerLines(block) {
    const result = [];
    let pending = '';
    for (const physical of block.split(/^MAP\s*$/mu, 1)[0].split('\n')) {
        const continued = /\\\s*$/u.test(physical);
        const part = continued
            ? physical.replace(/\\\s*$/u, '')
            : physical;
        pending = pending ? `${pending} ${part.trimStart()}` : part;
        if (!continued) {
            result.push(pending);
            pending = '';
        }
    }
    if (pending) {
        result.push(pending);
    }
    return result;
}

function looseAssignment(value) {
    const text = String(value).trim();
    const match = /^(\S+)\s+([=:])\s*(.*)$/u.exec(text)
        || /^([^:=\s]+)([=:])(.*)$/u.exec(text);
    assert.ok(match && match[1] && match[3], `bad assignment: ${value}`);
    return {
        glyphs: [...match[1].replace(/\s+/gu, '')],
        value: match[3].trim()
    };
}

function splitAssignments(value) {
    return value.split(',').map(part => part.trim()).filter(Boolean);
}

function replacementGlyphs(value) {
    const withoutWeights = String(value)
        .replace(/:\d+/gu, '')
        .replace(/(?:^|\s)(?:\*|\d+)\s*[=:]\s*/gu, ' ');
    return new Set(withoutWeights.replace(/[\s/,]/gu, ''));
}

function substOperation(value) {
    return splitAssignments(value).map(part => {
        const assignment = looseAssignment(part);
        const replacements = replacementGlyphs(assignment.value);
        return new Map(assignment.glyphs.map(glyph =>
            [glyph, new Set(replacements)]));
    });
}

function nsubstOperation(value) {
    return splitAssignments(value).map(part => {
        const assignment = looseAssignment(part);
        const replacements = new Set();
        for (const alternative of assignment.value.split('/')) {
            const body = alternative.trim()
                .replace(/^(?:\*|\d+)\s*[=:]\s*/u, '');
            for (const glyph of replacementGlyphs(body)) {
                replacements.add(glyph);
            }
        }
        return new Map(assignment.glyphs.map(glyph =>
            [glyph, new Set(replacements)]));
    });
}

function shuffleOperation(value) {
    const operations = [];
    for (const rawPart of splitAssignments(value)) {
        const blocks = rawPart.replace(/\s+/gu, '').split('/');
        const mapping = new Map();
        const add = (glyph, replacement) => {
            if (!mapping.has(glyph)) {
                mapping.set(glyph, new Set());
            }
            mapping.get(glyph).add(replacement);
        };
        if (blocks.length === 1) {
            for (const glyph of blocks[0]) {
                for (const replacement of blocks[0]) {
                    add(glyph, replacement);
                }
            }
        } else {
            assert.ok(blocks.every(block => block.length === blocks[0].length),
                `unequal SHUFFLE blocks: ${rawPart}`);
            for (let column = 0; column < blocks[0].length; column++) {
                for (const block of blocks) {
                    for (const replacement of blocks) {
                        add(block[column], replacement[column]);
                    }
                }
            }
        }
        operations.push(mapping);
    }
    return operations;
}

function independentDefinition(block) {
    const operations = [];
    const features = new Map();
    const tags = new Set();
    let place = null;
    let orient = null;
    for (const line of headerLines(block)) {
        const directive = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/u
            .exec(line);
        if (!directive) {
            continue;
        }
        const key = directive[1].toUpperCase();
        const value = directive[2];
        if (key === 'TAGS') {
            value.split(/\s+/u).filter(Boolean).forEach(tag => tags.add(tag));
        } else if (key === 'PLACE') {
            place = value;
        } else if (key === 'ORIENT') {
            orient = value.toLowerCase();
        } else if (key === 'SUBST') {
            operations.push(...substOperation(value));
        } else if (key === 'NSUBST') {
            operations.push(...nsubstOperation(value));
        } else if (key === 'SHUFFLE') {
            operations.push(...shuffleOperation(value));
        } else if (key === 'KFEAT') {
            const assignment = looseAssignment(value);
            const kinds = new Set(assignment.value.split('/')
                .flatMap(feature => kindsForFeature(feature, tags)));
            for (const glyph of assignment.glyphs) {
                features.set(glyph, kinds);
            }
        }
    }
    return {operations, features, tags, place, orient};
}

function possibleGlyphs(raw, operations) {
    let possible = new Set([raw]);
    for (const operation of operations) {
        const next = new Set();
        for (const glyph of possible) {
            if (operation.has(glyph)) {
                operation.get(glyph).forEach(value => next.add(value));
            } else {
                next.add(glyph);
            }
        }
        possible = next;
    }
    return possible;
}

function kindsForGlyph(glyph, tags) {
    if ('xXcvbmno'.includes(glyph) || glyph === 't') {
        return ['wall'];
    }
    if ('+='.includes(glyph)) {
        return ['door'];
    }
    if (glyph === 'w') {
        return tags.has('no_pool_fixup')
            ? ['deep_water']
            : ['deep_water', 'shallow_water'];
    }
    if (glyph === 'W') {
        return ['shallow_water'];
    }
    if (glyph === 'l') {
        return ['lava'];
    }
    if ('><}{)(]['.includes(glyph)) {
        return ['stair'];
    }
    if (glyph === 'A' || 'TUVY'.includes(glyph) || glyph === '^') {
        return ['floor'];
    }
    if ('BC'.includes(glyph)) {
        return ['altar'];
    }
    if ('IG'.includes(glyph)) {
        return ['statue'];
    }
    return ['floor'];
}

function kindsForFeature(feature, tags) {
    const raw = String(feature).trim().replace(/^w:\d+\s+/u, '');
    if (raw.length === 1) {
        return kindsForGlyph(raw, tags);
    }
    const value = raw.toLowerCase()
        .replace(/^w:\d+\s+/u, '')
        .replace(/[ -]+/gu, '_');
    if (value.includes('open_door')) {
        return ['floor'];
    }
    if (value.includes('door')) {
        return ['door'];
    }
    if (value.includes('deep_water') || value.includes('open_sea')) {
        return tags.has('no_pool_fixup')
            ? ['deep_water']
            : ['deep_water', 'shallow_water'];
    }
    if (value.includes('shallow_water')) {
        return ['shallow_water'];
    }
    if (value.includes('lava')) {
        return ['lava'];
    }
    if (value.includes('wall') || value.includes('tree')
        || value.includes('grate')) {
        return ['wall'];
    }
    if (value.includes('altar')) {
        return ['altar'];
    }
    if (value.includes('statue') || value.includes('idol')) {
        return ['statue'];
    }
    if (value.includes('stair') || value.includes('hatch')) {
        return ['stair'];
    }
    if (value.startsWith('enter_') || value.startsWith('exit_')
        || value.includes('portal') || value.includes('gateway')) {
        return ['portal'];
    }
    return ['floor'];
}

function fillKind(block) {
    const header = headerLines(block).join('\n');
    const calls = [...header.matchAll(
        /^\s*:\s*set_border_fill_type\s*\(\s*(["'])([^"']+)\1\s*\)\s*$/gmu
    )];
    if (!calls.length) {
        return 'wall';
    }
    assert.equal(calls.length, 1);
    const kind = {open_sea: 'deep_water', endless_lava: 'lava'}[calls[0][2]];
    assert.ok(kind, `unsupported fill ${calls[0][2]}`);
    return kind;
}

function independentGrid(block) {
    const rows = mapRows(block);
    const definition = independentDefinition(block);
    const width = Math.max(...rows.map(row => row.length));
    const fill = fillKind(block);
    const grid = Array.from({length: rows.length}, (_, y) =>
        Array.from({length: width}, (_, x) => {
            const raw = x < rows[y].length ? rows[y][x] : ' ';
            if (raw === ' ') {
                return {glyphs: new Set([' ']), kinds: new Set([fill])};
            }
            const glyphs = possibleGlyphs(raw, definition.operations);
            const kinds = new Set();
            for (const glyph of glyphs) {
                const values = definition.features.has(glyph)
                    ? definition.features.get(glyph)
                    : kindsForGlyph(glyph, definition.tags);
                values.forEach(kind => kinds.add(kind));
            }
            return {glyphs, kinds};
        }));
    return {rows, width, height: rows.length, grid, ...definition};
}

function independentCoarseGrid(block) {
    const rows = mapRows(block);
    const definition = independentDefinition(block);
    const width = Math.max(...rows.map(row => row.length));
    const edges = new Map();
    const uncertain = new Set();
    const add = (from, to) => {
        if (!edges.has(from)) {
            edges.set(from, new Set());
        }
        edges.get(from).add(to);
    };
    for (const operation of definition.operations) {
        for (const [glyph, replacements] of operation) {
            replacements.forEach(replacement => add(glyph, replacement));
        }
    }
    for (const line of headerLines(block)) {
        const risky = /^\s*(?:CLEAR|MARKER)\s*:\s*(.*?)\s*$/u.exec(line);
        if (risky) {
            const assignment = risky[1].includes('=')
                || risky[1].includes(':')
                ? looseAssignment(risky[1])
                : {glyphs: [...risky[1].replace(/\s+/gu, '')]};
            assignment.glyphs.forEach(glyph => uncertain.add(glyph));
        }
        const direct = /\bnsubst\s*\(\s*["']([^"'=:\s]+)\s*=/u
            .exec(line);
        if (direct) {
            [...direct[1]].forEach(glyph => uncertain.add(glyph));
        }
        const helper = /vault_(?:granite|metal)_statue_setup\s*\(\s*_G\s*,\s*(["'])(.)\1/u
            .exec(line);
        if (helper) {
            uncertain.add(helper[2]);
        }
    }
    const possible = raw => {
        const glyphs = new Set();
        const pending = [raw];
        while (pending.length) {
            const glyph = pending.pop();
            if (glyphs.has(glyph)) {
                continue;
            }
            glyphs.add(glyph);
            pending.push(...(edges.get(glyph) || []));
        }
        if ([...glyphs].some(glyph => uncertain.has(glyph))) {
            return new Set([
                'wall', 'floor', 'door', 'deep_water', 'shallow_water',
                'lava', 'stair', 'portal', 'altar', 'statue'
            ]);
        }
        const kinds = new Set();
        for (const glyph of glyphs) {
            kindsForGlyph(glyph, definition.tags)
                .forEach(kind => kinds.add(kind));
            (definition.features.get(glyph) || [])
                .forEach(kind => kinds.add(kind));
        }
        return kinds;
    };
    const fill = fillKind(block);
    const grid = Array.from({length: rows.length}, (_, y) =>
        Array.from({length: width}, (_, x) => {
            const raw = x < rows[y].length ? rows[y][x] : ' ';
            return raw === ' ' ? new Set([fill]) : possible(raw);
        }));
    return {rows, width, height: rows.length, grid};
}

function productionKinds(cell) {
    const raw = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    if (raw.some(kind => ['unknown', 'void'].includes(String(kind)))) {
        return [];
    }
    return [...new Set(raw.map(normalizeTerrainKind).filter(Boolean))].sort();
}

function independentTransformCount(definition, width, height) {
    const canRotate = !definition.tags.has('no_rotate')
        && width <= 70 && height <= 70;
    const rotations = canRotate ? [0, 1, -1] : [0];
    const hmirrors = definition.tags.has('no_hmirror') ? [0] : [0, 1];
    const vmirrors = definition.tags.has('no_vmirror') ? [0] : [0, 1];
    const matrices = new Set();
    for (const rotation of rotations) {
        for (const h of hmirrors) {
            for (const v of vmirrors) {
                let matrix = rotation === 1
                    ? [0, -1, 1, 0]
                    : rotation === -1
                        ? [0, 1, -1, 0]
                        : [1, 0, 0, 1];
                if (h) {
                    matrix = [-matrix[0], matrix[1], -matrix[2], matrix[3]];
                }
                if (v) {
                    matrix = [matrix[0], -matrix[1], matrix[2], -matrix[3]];
                }
                matrices.add(matrix.join(','));
            }
        }
    }
    return matrices.size;
}

function assertExitProof(name, block, independent) {
    const lines = headerLines(block).map(line => line.trim()
        .replace(/\s+/gu, ' '));
    const possible = independent.grid.flat()
        .filter(cell => cell.glyphs.has('{')).length;
    assert.ok(possible > 0, `${name}: no possible stone-up-I exit`);
    const dynamic = DYNAMIC_EXITS[name];
    if (dynamic) {
        for (const expected of dynamic) {
            assert.ok(lines.includes(expected), `${name}: ${expected}`);
        }
    } else {
        assert.equal(independent.rows.join('').split('{').length - 1, 1,
            `${name}: fixed exit cardinality`);
        assert.ok(!lines.some(line =>
            /^(?:SUBST|NSUBST|SHUFFLE|CLEAR|KFEAT):/u.test(line)
            && line.includes('{')), `${name}: fixed exit mutated`);
    }
    return possible;
}

const reports = [];
for (const root of roots) {
    const source = fs.readFileSync(`${root}/${TEMPLE_PATH}`, 'utf8');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
        EXPECTED_SHA256, root);
    const runtime = parseRuntimeDes(source, {path: TEMPLE_PATH});
    const selected = selectSafeTemplates(runtime, {
        place: 'Temple',
        depth: 1
    }, {levelEntry: {x: 0, y: 0}});
    const normal = selected.filter(template =>
        template.metadata.sourceAudit === 'temple-encompass-entry-v1');
    const detection = selected.filter(template =>
        template.metadata.sourceAudit === 'temple-detection-only-v1');
    assert.equal(selected.length, 94);
    assert.equal(normal.length, 53);
    assert.equal(detection.length, 41);
    assert.deepEqual(normal.map(template => template.name).sort(),
        [...auditedTempleDestinationNames].sort());

    let transforms = 0;
    let anchorCells = 0;
    let safePredictionCells = 0;
    let safePredictionMismatches = 0;
    let possibleGlyphMismatches = 0;
    const safeMismatchCases = [];
    let detectionConstrainedCells = 0;
    let detectionConstraintMismatches = 0;
    const detectionMismatchCases = [];
    const independentByName = new Map();
    for (const template of normal) {
        const block = mapBlock(source, template.name);
        const independent = independentGrid(block);
        independentByName.set(template.name, independent);
        assert.equal(independent.place, 'Temple', template.name);
        assert.equal(independent.orient, 'encompass', template.name);
        assert.equal(independent.width, template.width, template.name);
        assert.equal(independent.height, template.height, template.name);
        const transformCount = independentTransformCount(
            independent,
            independent.width,
            independent.height
        );
        assert.equal(allowedTransforms(template).length, transformCount,
            template.name);
        transforms += transformCount;
        anchorCells += assertExitProof(template.name, block, independent);

        for (let y = 0; y < template.height; y++) {
            for (let x = 0; x < template.width; x++) {
                const production = template.grid[y][x];
                const truth = independent.grid[y][x];
                const productionGlyphs = [...(production?.possibleGlyphs || [])]
                    .sort();
                if (productionGlyphs.join('')
                    !== [...truth.glyphs].sort().join('')) {
                    possibleGlyphMismatches++;
                }
                const kinds = productionKinds(production);
                if (kinds.length !== 1) {
                    continue;
                }
                safePredictionCells += transformCount;
                if (!truth.kinds.has(kinds[0])) {
                    safePredictionMismatches += transformCount;
                    safeMismatchCases.push({
                        name: template.name,
                        x,
                        y,
                        production: kinds,
                        truth: [...truth.kinds],
                        glyphs: [...truth.glyphs]
                    });
                }
            }
        }
    }
    assert.equal(transforms, 330);
    assert.equal(possibleGlyphMismatches, 0);
    assert.equal(safePredictionMismatches, 0,
        JSON.stringify(safeMismatchCases));

    for (const template of detection) {
        const truth = independentCoarseGrid(mapBlock(source, template.name));
        assert.equal(truth.width, template.width, template.name);
        assert.equal(truth.height, template.height, template.name);
        for (let y = 0; y < template.height; y++) {
            for (let x = 0; x < template.width; x++) {
                const production = productionKinds(template.grid[y][x]);
                if (production.length !== 1) {
                    continue;
                }
                detectionConstrainedCells++;
                const possible = truth.grid[y][x];
                if (possible.size !== 1 || !possible.has(production[0])) {
                    detectionConstraintMismatches++;
                    detectionMismatchCases.push({
                        name: template.name,
                        x,
                        y,
                        production,
                        possible: [...possible]
                    });
                }
            }
        }
    }
    assert.equal(detectionConstraintMismatches, 0,
        JSON.stringify(detectionMismatchCases.slice(0, 20)));

    // Exact fixed cells from every unsupported map act as negative evidence.
    // Even with every dynamic square omitted, no supported map may become a
    // normal-reveal winner against the matching detection-only candidate.
    const matcher = new MapMatcher({
        requireExhaustivePlacement: true,
        minPredictedCells: 1
    });
    matcher.setTemplates(selected);
    let negativeCases = 0;
    let negativeFalseReady = 0;
    for (const template of detection) {
        matcher.reset({keepTemplates: true});
        const anchors = [];
        template.grid.forEach((row, y) => row.forEach((cell, x) => {
            if (cell?.possibleGlyphs?.includes('{')) {
                anchors.push({x, y});
            }
        }));
        assert.ok(anchors.length, template.name);
        const anchor = anchors[0];
        const observations = [];
        template.grid.forEach((row, y) => row.forEach((cell, x) => {
            const kinds = productionKinds(cell);
            if (kinds.length === 1) {
                observations.push({
                    x: x - anchor.x,
                    y: y - anchor.y,
                    kind: kinds[0]
                });
            }
        }));
        observations.push({x: 0, y: 0, kind: 'stair'});
        const result = matcher.updateObservations(observations);
        negativeCases++;
        negativeFalseReady += result.ready ? 1 : 0;
    }
    assert.equal(negativeFalseReady, 0);

    const mutation = source.replace(
        'NAME:        ebering_the_one_and_only',
        'NAME:        ebering_the_one_and_only_changed'
    );
    assert.deepEqual(parseRuntimeDes(mutation, {path: TEMPLE_PATH}), []);

    reports.push({
        root,
        sha256: EXPECTED_SHA256,
        naturalCatalog: selected.length,
        normalRevealable: normal.length,
        detectionOnly: detection.length,
        normalTransforms: transforms,
        possibleEntryCells: anchorCells,
        safePredictionCells,
        safePredictionMismatches,
        possibleGlyphMismatches,
        detectionConstrainedCells,
        detectionConstraintMismatches,
        negativeCases,
        negativeFalseReady,
        mutation: 'fail-closed'
    });
}

console.log(JSON.stringify({reports}, null, 2));
