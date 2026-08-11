import assert from 'node:assert/strict';
import fs from 'node:fs';

import {parseDes} from '../des-parser.js';
import {parseRuntimeDes, selectSafeTemplates} from '../runtime.js';
import MapMatcher, {normalizeTerrainKind} from '../matcher.js';

const ELF_PATH = 'crawl-ref/source/dat/des/branches/elf.des';
const VAULT_PATH = 'crawl-ref/source/dat/dlua/vault.lua';
const DEFAULT_ROOTS = ['/tmp/dwem-crawl-d29', '/tmp/dwem-crawl-1b83'];
const roots = (process.argv.length > 2
    ? process.argv.slice(2)
    : DEFAULT_ROOTS).filter(root =>
    fs.existsSync(`${root}/${ELF_PATH}`)
    && fs.existsSync(`${root}/${VAULT_PATH}`));

if (!roots.length) {
    throw new Error('No exact Crawl checkout with elf.des and vault.lua');
}

function normalizedKinds(cell) {
    const raw = Array.isArray(cell?.kinds) ? cell.kinds : [cell?.kinds];
    if (raw.some(kind => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(kind || '').trim().toLowerCase()))) {
        return [];
    }
    return [...new Set(raw.map(normalizeTerrainKind).filter(Boolean))];
}

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(
        `(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`,
        'u'
    ).exec(String(source || ''));
    assert.ok(match, `missing exact map block: ${name}`);
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const tail = String(source).slice(start + 1);
    const next = /\nNAME:\s*/u.exec(tail);
    return String(source).slice(
        start,
        next ? start + 1 + next.index : undefined
    );
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    assert.ok(match, 'missing exact MAP rows');
    return match[1].split('\n');
}

function independentSlot(source, name) {
    const block = mapBlock(source, name);
    const subvault = /^SUBVAULT:\s*(\S)\s*:\s*elf_blade_entry\s*$/mu
        .exec(block);
    if (!subvault) {
        return null;
    }
    const glyph = subvault[1];
    const rows = mapRows(block);
    const points = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === glyph) {
                points.push({x, y});
            }
        }
    });
    assert.ok(points.length > 0, `${name}: empty SUBVAULT mask`);
    const x = Math.min(...points.map(point => point.x));
    const y = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    const width = maxX - x + 1;
    const height = maxY - y + 1;
    const mask = Array.from({length: height}, (_, localY) =>
        Array.from({length: width}, (_, localX) =>
            rows[y + localY]?.[x + localX] === glyph));
    return {block, glyph, x, y, width, height, mask};
}

function independentEmptyKinds(slot) {
    const header = slot.block.split(/^MAP\s*$/mu, 1)[0];
    const lines = header.split('\n');
    const subvaultIndex = lines.findIndex(line =>
        new RegExp(
            `^SUBVAULT:\\s*${slot.glyph}\\s*:\\s*elf_blade_entry\\s*$`,
            'u'
        ).test(line));
    assert.ok(subvaultIndex >= 0);
    const later = lines.slice(subvaultIndex + 1);
    const substitutions = [];
    for (const line of later) {
        const body = /^SUBST:\s*(.*)$/u.exec(line)?.[1];
        if (!body) {
            continue;
        }
        for (const clause of body.split(',')) {
            const match = new RegExp(
                `^\\s*${slot.glyph}\\s*[:=]\\s*([^\\s]+)\\s*$`,
                'u'
            ).exec(clause);
            if (match) {
                substitutions.push(match[1]);
            }
        }
    }
    assert.equal(substitutions.length, 1,
        `${slot.glyph}: expected one post-SUBVAULT substitution`);
    assert.match(substitutions[0], /^[x"]+$/u,
        `${slot.glyph}: unsupported fallback substitution`);
    const cleared = new Set(later.flatMap(line => {
        const value = /^CLEAR:\s*(\S+)\s*$/u.exec(line)?.[1];
        return value ? [...value] : [];
    }));
    const outcomes = [...substitutions[0]].map(glyph =>
        cleared.has(glyph) ? null : glyph === 'x' ? 'wall' : 'floor');
    return outcomes.length > 0
        && outcomes.every(kind => kind === outcomes[0])
        && outcomes[0] != null
        ? [outcomes[0]]
        : [];
}

function rotateGrid(grid, clockwise) {
    const height = grid.length;
    const width = Math.max(0, ...grid.map(row => row.length));
    const result = Array.from({length: width}, () =>
        Array.from({length: height}, () => null));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (clockwise) {
                result[x][height - 1 - y] = grid[y]?.[x] ?? null;
            } else {
                result[width - 1 - x][y] = grid[y]?.[x] ?? null;
            }
        }
    }
    return result;
}

function mirrorGrid(grid, horizontal, vertical) {
    let result = grid.map(row => [...row]);
    if (horizontal) {
        result = result.map(row => [...row].reverse());
    }
    if (vertical) {
        result.reverse();
    }
    return result;
}

function gridSignature(grid) {
    return grid.map(row => row.map(cell => cell == null
        ? null
        : `${cell.glyph ?? ''}:${normalizedKinds(cell).join('|')}`)
        .map(cell => JSON.stringify(cell)).join('\u0001')).join('\u0002');
}

function independentChildVariants(template, slot) {
    const tags = new Set(template.metadata?.tags || []);
    const canRotate = !tags.has('no_rotate')
        && template.width <= slot.height
        && template.height <= slot.width;
    const mustRotate = template.width > slot.width
        || template.height > slot.height;
    assert.ok(!mustRotate || canRotate,
        `${template.name}: child cannot fit exact slot`);
    const rotations = mustRotate
        ? [true, false]
        : canRotate ? [null, true, false] : [null];
    const variants = new Map();
    for (const rotation of rotations) {
        const rotated = rotation == null
            ? template.grid.map(row => [...row])
            : rotateGrid(template.grid, rotation);
        assert.equal(rotated[0]?.length, slot.width,
            `${template.name}: non-exact child width`);
        assert.equal(rotated.length, slot.height,
            `${template.name}: non-exact child height`);
        const mirrors = [];
        for (const horizontal of tags.has('no_hmirror')
            ? [false] : [false, true]) {
            for (const vertical of tags.has('no_vmirror')
                ? [false] : [false, true]) {
                const grid = mirrorGrid(rotated, horizontal, vertical);
                let mismatch = 0;
                for (let y = 0; y < slot.height; y++) {
                    for (let x = 0; x < slot.width; x++) {
                        if (grid[y]?.[x] != null && !slot.mask[y]?.[x]) {
                            mismatch++;
                        }
                    }
                }
                mirrors.push({grid, mismatch});
            }
        }
        const minimum = Math.min(...mirrors.map(variant => variant.mismatch));
        for (const variant of mirrors.filter(candidate =>
            candidate.mismatch === minimum)) {
            const signature = gridSignature(variant.grid);
            variants.set(signature, {
                name: template.name,
                grid: variant.grid,
                signature
            });
        }
    }
    return [...variants.values()];
}

function sourcePoint(prepared, transformedX, transformedY) {
    const transform = prepared.transform;
    const bounds = prepared.sourceBounds;
    const x = transformedX + bounds.minX;
    const y = transformedY + bounds.minY;
    const determinant = transform.a * transform.d
        - transform.b * transform.c;
    return {
        x: (transform.d * x - transform.b * y) / determinant,
        y: (-transform.c * x + transform.a * y) / determinant
    };
}

function assemblyKinds(prepared, child, x, y) {
    const slot = prepared.composite.slots[0];
    if (slot && child) {
        const source = sourcePoint(prepared, x, y);
        const slotX = source.x - slot.x;
        const slotY = source.y - slot.y;
        if (slotX >= 0 && slotY >= 0
            && slotX < slot.width && slotY < slot.height
            && slot.mask[slotY]?.[slotX]) {
            const cell = child.grid[slotY]?.[slotX];
            return cell == null ? slot.emptyKinds : normalizedKinds(cell);
        }
    }
    return normalizedKinds(prepared.transformed.grid[y]?.[x]);
}

function absolutePlacement(prepared) {
    const width = prepared.transformed.width;
    const height = prepared.transformed.height;
    const centreX = Math.floor((80 - width) / 2);
    const centreY = Math.floor((70 - height) / 2);
    return {
        north: {x: centreX, y: 0},
        south: {x: centreX, y: 70 - height},
        east: {x: 80 - width, y: centreY},
        west: {x: 0, y: centreY},
        northeast: {x: 80 - width, y: 0},
        northwest: {x: 0, y: 0},
        southeast: {x: 80 - width, y: 70 - height},
        southwest: {x: 0, y: 70 - height}
    }[prepared.orientation];
}

function proceduralKind(x, y) {
    const hash = (Math.imul(x + 97, 73856093)
        ^ Math.imul(y + 193, 19349663)) >>> 0;
    return hash % 5 === 0 ? 'wall' : 'floor';
}

function independentAssemblyKinds(prepared, child, exact, x, y) {
    if (!exact?.slot || !child) {
        return assemblyKinds(prepared, child, x, y);
    }
    const source = sourcePoint(prepared, x, y);
    const slotX = source.x - exact.slot.x;
    const slotY = source.y - exact.slot.y;
    if (slotX < 0 || slotY < 0
        || slotX >= exact.slot.width || slotY >= exact.slot.height
        || !exact.slot.mask[slotY]?.[slotX]) {
        return assemblyKinds(prepared, child, x, y);
    }
    const cell = exact.child.grid[slotY]?.[slotX];
    return cell == null ? exact.emptyKinds : normalizedKinds(cell);
}

function representativeLevel(prepared, child, exact = null) {
    const placement = absolutePlacement(prepared);
    assert.ok(placement, prepared.orientation);
    const originX = -placement.x;
    const originY = -placement.y;
    const actual = new Map();
    const predictable = new Set();
    for (let y = originY; y < originY + 70; y++) {
        for (let x = originX; x < originX + 80; x++) {
            actual.set(`${x},${y}`, proceduralKind(x, y));
        }
    }
    for (let y = 0; y < prepared.transformed.height; y++) {
        for (let x = 0; x < prepared.transformed.width; x++) {
            const kinds = exact
                ? independentAssemblyKinds(prepared, child, exact, x, y)
                : assemblyKinds(prepared, child, x, y);
            if (kinds.length) {
                actual.set(`${x},${y}`, kinds[0]);
            }
            if (kinds.length === 1) {
                predictable.add(`${x},${y}`);
            }
        }
    }
    const observations = [];
    for (const [key, kind] of actual) {
        const [x, y] = key.split(',').map(Number);
        const withheld = predictable.has(key)
            && Math.abs(Math.imul(x + 11, 31) ^ Math.imul(y + 17, 47)) % 3
                === 0;
        if (!withheld) {
            observations.push({x, y, kind});
        }
    }
    return {actual, observations};
}

const reports = [];
for (const root of roots) {
    const source = fs.readFileSync(`${root}/${ELF_PATH}`, 'utf8');
    const vault = fs.readFileSync(`${root}/${VAULT_PATH}`, 'utf8');
    const options = {
        path: ELF_PATH,
        dependencies: {[VAULT_PATH]: vault}
    };
    const parsed = parseDes(source, options);
    const parsedByName = new Map(parsed.map(template => [
        template.name,
        template
    ]));
    const runtime = parseRuntimeDes(source, options);
    const selected = selectSafeTemplates(runtime, {
        place: 'Elf',
        depth: 2
    });
    assert.equal(selected.length, 4);
    assert.ok(selected.every(template =>
        template.metadata.sourceAudit === 'elf-blades-fixed-composite-v1'));

    const preparedMatcher = new MapMatcher();
    preparedMatcher.setTemplates(selected);
    assert.equal(preparedMatcher.preparedTemplates.length, 32);

    let assemblies = 0;
    let entryAssemblies = 0;
    let safePredictions = 0;
    let safeMismatches = 0;
    let sourceLegalChildVariants = 0;
    const childTransforms = new Set();
    for (const prepared of preparedMatcher.preparedTemplates) {
        const exactSlot = independentSlot(source, prepared.template.name);
        const children = prepared.composite.slots.length
            ? prepared.composite.slots[0].variants
            : [null];
        let expectedByKey = new Map();
        let exactEmptyKinds = [];
        if (exactSlot) {
            const productionSlot = prepared.composite.slots[0];
            assert.equal(productionSlot.x, exactSlot.x);
            assert.equal(productionSlot.y, exactSlot.y);
            assert.equal(productionSlot.width, exactSlot.width);
            assert.equal(productionSlot.height, exactSlot.height);
            assert.deepEqual(productionSlot.mask, exactSlot.mask);
            exactEmptyKinds = independentEmptyKinds(exactSlot);
            assert.deepEqual(productionSlot.emptyKinds, exactEmptyKinds,
                `${prepared.template.name}: wrong child-space fallback`);
            expectedByKey = new Map(parsed
                .filter(template => (template.metadata?.tags || [])
                    .includes('elf_blade_entry'))
                .flatMap(template => independentChildVariants(
                    template,
                    exactSlot
                ))
                .map(variant => [
                    `${variant.name}\u0000${variant.signature}`,
                    variant
                ]));
            const actualKeys = [...new Set(children.map(child =>
                `${child.name}\u0000${gridSignature(child.grid)}`))].sort();
            assert.deepEqual(actualKeys, [...expectedByKey.keys()].sort(),
                `${prepared.template.name}: resolve_subvault transform set`);
            sourceLegalChildVariants += expectedByKey.size;
        }
        for (const child of children) {
            assemblies++;
            if (child) {
                entryAssemblies++;
                childTransforms.add(child.transform);
            }
            if (!child || !exactSlot) {
                continue;
            }
            const exactChild = expectedByKey.get(
                `${child.name}\u0000${gridSignature(child.grid)}`
            );
            assert.ok(exactChild, `${child.name}: unmodelled child transform`);
            const productionSlot = prepared.composite.slots[0];
            for (let y = 0; y < exactSlot.height; y++) {
                for (let x = 0; x < exactSlot.width; x++) {
                    if (!exactSlot.mask[y]?.[x]) {
                        continue;
                    }
                    const productionCell = child.grid[y]?.[x];
                    const predicted = productionCell == null
                        ? productionSlot.emptyKinds
                        : normalizedKinds(productionCell);
                    if (predicted.length !== 1) {
                        continue;
                    }
                    const sourceCell = exactChild.grid[y]?.[x];
                    const truth = sourceCell == null
                        ? exactEmptyKinds
                        : normalizedKinds(sourceCell);
                    safePredictions++;
                    if (truth.length !== 1 || truth[0] !== predicted[0]) {
                        safeMismatches++;
                    }
                }
            }
        }
    }
    assert.equal(assemblies, 920);
    assert.equal(entryAssemblies, 912);
    assert.equal(safeMismatches, 0);
    assert.deepEqual([...childTransforms].sort(), [
        'r0', 'r0h', 'r90hv', 'r90v'
    ]);

    let normalReady = 0;
    let normalPredictions = 0;
    let normalMismatches = 0;
    let forcePredictions = 0;
    let forceMismatches = 0;
    for (const template of selected) {
        const prepared = preparedMatcher.preparedTemplates.find(candidate =>
            candidate.template.name === template.name
            && candidate.transform.id === 'r0');
        assert.ok(prepared, template.name);
        const child = prepared.composite.slots[0]?.variants[0] || null;
        const exactSlot = independentSlot(source, template.name);
        const exactChild = child && exactSlot
            ? independentChildVariants(
                parsedByName.get(child.name),
                exactSlot
            ).find(candidate =>
                candidate.signature === gridSignature(child.grid))
            : null;
        assert.ok(!child || exactChild, `${template.name}: missing exact child`);
        const level = representativeLevel(prepared, child,
            exactSlot && exactChild ? {
                slot: exactSlot,
                child: exactChild,
                emptyKinds: independentEmptyKinds(exactSlot)
            } : null);
        const matcher = new MapMatcher();
        matcher.setTemplates(selected);
        matcher.setFocusPosition({
            x: Math.floor(prepared.transformed.width / 2),
            y: Math.floor(prepared.transformed.height / 2)
        }, {evaluate: false});
        const result = matcher.updateObservations(level.observations);
        assert.equal(result.best?.template?.name, template.name);
        assert.equal(result.ready, true, `${template.name}: ${result.reason}`);
        normalReady++;
        normalPredictions += result.predictions.length;
        for (const prediction of result.predictions) {
            if (level.actual.get(`${prediction.x},${prediction.y}`)
                !== prediction.kind) {
                normalMismatches++;
            }
        }
        forcePredictions += result.forcePredictions.length;
        for (const prediction of result.forcePredictions) {
            if (level.actual.get(`${prediction.x},${prediction.y}`)
                !== prediction.kind) {
                forceMismatches++;
            }
        }
    }
    assert.equal(normalMismatches, 0);
    assert.equal(forceMismatches, 0);

    const inventoryMutation = source.replace(
        'NAME:   mumra_blade_entry_bloodbath',
        'NAME:   mumra_blade_entry_bloodbath_changed'
    );
    const mutated = parseRuntimeDes(inventoryMutation, options)
        .filter(template => template.metadata?.place === 'Elf:2');
    assert.equal(mutated.length, 4);
    assert.ok(mutated.every(template =>
        template.metadata.sourceAudit === 'elf-blades-detection-only-v1'
        && template.metadata.matchPolicy.forceRevealDisabled === true));

    reports.push({
        root,
        parents: selected.length,
        parentTransforms: preparedMatcher.preparedTemplates.length,
        entryChildren: 19,
        legalAssemblies: assemblies,
        entryAssemblies,
        childTransforms: [...childTransforms].sort(),
        sourceLegalChildVariants,
        safePredictions,
        safeMismatches,
        normalReady,
        normalPredictions,
        normalMismatches,
        forcePredictions,
        forceMismatches,
        inventoryMutation: 'detection-only'
    });
}

console.log(JSON.stringify({reports}, null, 2));
