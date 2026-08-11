import {parseDes} from './des-parser.js';
import {allowedTransforms, transformTemplate} from './matcher.js';

const SPRINT_SOURCE_AUDIT = 'sprint-exact-source-v1';
export const SPRINT_ENTRY_SENTINEL = '__dwem_sprint_entry_v1__';

const SPRINT_MATCH_POLICY = Object.freeze({
    minScore: 1,
    minEvidenceCells: 24,
    minEvidenceWeight: 28,
    minDistinctKinds: 2,
    requiredKinds: ['floor', 'wall'],
    // Player and spectator clients receive the same terrain packets but not
    // the same lobby/play provenance. Exhaustively score every legal
    // transform and translation so both clients reach the same conservative
    // terrain-consensus result without trusting a spawn coordinate.
    exhaustivePlacement: true
});

const SPRINT_SPECS = Object.freeze({
    'crawl-ref/source/dat/des/sprint/arena_sprint.des': Object.freeze({
        name: 'arena_sprint',
        width: 35,
        height: 34,
        sha256: '264a3d7770312bc86e8e1677d758121465068cdc5770a72b0982f72e7bcdeb31',
        warnings: Object.freeze([]),
        roleGlyphs: Object.freeze([])
    }),
    'crawl-ref/source/dat/des/sprint/fedhas.des': Object.freeze({
        name: 'dungeon_sprint_fedhas',
        width: 55,
        height: 38,
        sha256: '1ca0c1e5a4347ae9ce4fe520cee74a83daa9016cf2e3b9b8494c296304059a3c',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported',
            'Lua helper invisibility_setup is not statically safe: unsupported kitem()'
        ]),
        roleGlyphs: Object.freeze(['o'])
    }),
    'crawl-ref/source/dat/des/sprint/linesprint.des': Object.freeze({
        name: 'linesprint',
        width: 70,
        height: 59,
        sha256: '37663b1d28bea67bbed0f60a57590ff7ddd52d23274b37f26e97f82a43ece229',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported'
        ]),
        roleGlyphs: Object.freeze([
            ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'z', 'y', 'w', 'u', 's', 'r', 'q', 'p', 'o'
        ])
    }),
    'crawl-ref/source/dat/des/sprint/meat.des': Object.freeze({
        name: 'meatsprint',
        width: 70,
        height: 70,
        sha256: 'e43d3f827518f8c32501c841da991b3b087117cfe8e4dddb362a5b907a30d8a9',
        warnings: Object.freeze([
            'Lua helper blood_monster_definitions is not statically safe: unsupported kmons()',
            'Lua helper weapon_creation is not statically safe: unsupported kitem()'
        ]),
        roleGlyphs: Object.freeze([])
    }),
    'crawl-ref/source/dat/des/sprint/menkaure.des': Object.freeze({
        name: 'the_violet_keep_of_menkaure',
        width: 62,
        height: 39,
        sha256: 'd9e8e68697d8e9d8f2d837dec0b549c095efde773327440891d2316ceaa9f645',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported'
        ]),
        roleGlyphs: Object.freeze([...'ABCDEFGHIJKLMNOPQRSTU'])
    }),
    'crawl-ref/source/dat/des/sprint/pitsprint.des': Object.freeze({
        name: 'pitsprint',
        width: 80,
        height: 70,
        sha256: 'f607e8710810779be145c40b42d3e134474de64ceb664b4d6303247bac8628a9',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported',
            'Lua helper general_setup is not statically safe: unsupported marker()'
        ]),
        roleGlyphs: Object.freeze([...'ABCEFGHIJKLNPRSZ']),
        entryChild: 'entrance_room_1',
        entrySelector: 'the_entrance_hall'
    }),
    'crawl-ref/source/dat/des/sprint/red_sonja.des': Object.freeze({
        name: 'dungeon_sprint_1',
        width: 68,
        height: 31,
        sha256: '3483bfedad96e4fedca2b099da741a18145227ab5906dd959f1fff61af8aa6c7',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported'
        ]),
        roleGlyphs: Object.freeze(['B', 'C'])
    }),
    'crawl-ref/source/dat/des/sprint/sprint_mu.des': Object.freeze({
        name: 'dungeon_sprint_mu',
        width: 80,
        height: 70,
        sha256: '01a1626acdf8ab4f65d03ea3646b3ecda761bbb4be093732cc6032b2bfabeeaf',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported'
        ]),
        roleGlyphs: Object.freeze([
            'E', 'T', '1', '2', '3', 'O', 'F', 'H', 'L', 'V', 'M',
            'w', 'h', 'n', 'B', 'Y', 'U', 'G', 'N', 'I', 'R', 'C', 'Z'
        ])
    }),
    'crawl-ref/source/dat/des/sprint/zigsprint.des': Object.freeze({
        name: 'sprint_v',
        width: 80,
        height: 70,
        sha256: 'ef3775a40109e1979de7d2d4ed60150651716da85812c400f9ac085ee6dd2f1f',
        warnings: Object.freeze([
            'SUBVAULT directives are not statically supported'
        ]),
        roleGlyphs: Object.freeze([
            ...'ABCDEFGHIJKLMNOPRSTUVWYZ', '*', '%', '|', '$'
        ]),
        // The inline Lua block replaces both markers with floor after the
        // child rooms have been resolved. parseDes deliberately does not run
        // arbitrary Lua, so apply these two exact-source substitutions here.
        floorGlyphs: Object.freeze(['<', 'a'])
    })
});

export const SPRINT_SOURCE_PATHS = Object.freeze(Object.keys(SPRINT_SPECS));
export const SPRINT_TEMPLATE_NAMES = Object.freeze(Object.values(SPRINT_SPECS)
    .map(spec => spec.name));

const SHA256_CONSTANTS = Object.freeze([
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
]);

function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(text) {
    if (typeof TextEncoder === 'function') {
        return [...new TextEncoder().encode(String(text))];
    }
    const encoded = unescape(encodeURIComponent(String(text)));
    return [...encoded].map(character => character.charCodeAt(0));
}

/**
 * Small synchronous SHA-256 used during the synchronous DES cache parser.
 * WebCrypto is asynchronous and therefore cannot protect this boundary.
 */
export function sprintSourceSha256(text) {
    const bytes = utf8Bytes(text);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) {
        bytes.push((high >>> shift) & 0xff);
    }
    for (let shift = 24; shift >= 0; shift -= 8) {
        bytes.push((low >>> shift) & 0xff);
    }

    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const words = new Array(64).fill(0);
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
            const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11)
                ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const first = (h + sigma1 + choose + SHA256_CONSTANTS[index]
                + words[index]) >>> 0;
            const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13)
                ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const second = (sigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + first) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (first + second) >>> 0;
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
    return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

function warningSetMatches(actual, expected) {
    return Array.isArray(actual)
        && actual.length === expected.length
        && expected.every(warning => actual.includes(warning));
}

function sourceSpec(path) {
    const normalized = String(path || '').replace(/^\/+/, '');
    return Object.entries(SPRINT_SPECS).find(([candidate]) =>
        normalized === candidate || normalized.endsWith(`/${candidate}`)) || null;
}

function mapBlock(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const start = new RegExp(`(?:^|\\n)NAME:\\s*${escaped}\\s*(?:\\n|$)`, 'u')
        .exec(String(source || ''));
    if (!start) {
        return null;
    }
    const offset = start.index + (source[start.index] === '\n' ? 1 : 0);
    const tail = source.slice(offset);
    const next = /\nNAME:\s*/u.exec(tail.slice(1));
    return next ? tail.slice(0, next.index + 1) : tail;
}

function mapRows(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function subvaultGlyphs(block) {
    return [...String(block || '').matchAll(
        /^\s*SUBVAULT:\s*(\S+)\s*:\s*\S+\s*$/gmu
    )].flatMap(match => [...match[1]]);
}

function replaceHelperCall(source, helper, replacement = '') {
    const escaped = helper.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return source.replace(
        new RegExp(`^\\s*:\\s*${escaped}\\(_G\\)\\s*$`, 'gmu'),
        replacement
    );
}

function sanitizeAuditedSprintSource(source, path) {
    let sanitized = String(source || '').replace(/^\s*SUBVAULT:.*$/gmu, '');
    if (path.endsWith('/fedhas.des')) {
        sanitized = replaceHelperCall(sanitized, 'invisibility_setup');
    } else if (path.endsWith('/meat.des')) {
        sanitized = replaceHelperCall(sanitized, 'blood_monster_definitions');
        sanitized = replaceHelperCall(sanitized, 'weapon_creation');
    } else if (path.endsWith('/linesprint.des')) {
        sanitized = replaceHelperCall(sanitized, 'line_setup', [
            'KFEAT: & = closed_door',
            'KFEAT: ~ = closed_door',
            'KFEAT: < = closed_door',
            'KFEAT: x = permarock_wall',
            'KFEAT: # = permarock_wall'
        ].join('\n'));
        sanitized = replaceHelperCall(sanitized, 'general_item_setup');
    } else if (path.endsWith('/pitsprint.des')) {
        sanitized = replaceHelperCall(sanitized, 'general_setup', [
            'KFEAT: & = closed_door',
            'KFEAT: =~<>#_ = runed_door',
            'KFEAT: @ = floor'
        ].join('\n'));
        for (const helper of [
            'general_item_setup',
            'base_monster_setup',
            'storerooms_monster_setup',
            'metal_vault_setup',
            'steel_vault_setup',
            'titanium_vault_setup'
        ]) {
            sanitized = replaceHelperCall(sanitized, helper);
        }
        sanitized = replaceHelperCall(
            sanitized,
            'iron_vault_setup',
            "SUBST: ' = ))]]cc"
        );
        sanitized = replaceHelperCall(sanitized, 'armoury_setup', [
            'SUBST: c = ccc(',
            'SUBST: d = ddd['
        ].join('\n'));
        sanitized = replaceHelperCall(
            sanitized,
            'coven_setup',
            'KFEAT: v = crystal_wall'
        );
    } else if (path.endsWith('/sprint_mu.des')) {
        sanitized = replaceHelperCall(sanitized, 'acq_on_sight');
    } else if (path.endsWith('/zigsprint.des')) {
        sanitized = sanitized.replace(
            /^\s*:\s*setup_room\(_G,\s*(\d+)\)\s*$/gmu,
            (line, rawId) => Number(rawId) > 1
                ? ['SUBST: a = .', 'SUBST: Z = XXX.', 'SUBST: z = XX.'].join('\n')
                : ''
        );
    }
    return sanitized;
}

function auditedGrid(template, rows, spec) {
    const dynamic = new Set(spec.roleGlyphs);
    const floorGlyphs = new Set(spec.floorGlyphs || []);
    return template.grid.map((row, y) => row.map((cell, x) => {
        const rawGlyph = rows[y]?.[x] ?? ' ';
        if (dynamic.has(rawGlyph)) {
            return {
                ...cell,
                kinds: [],
                certain: false
            };
        }
        if (floorGlyphs.has(rawGlyph)) {
            return {
                ...cell,
                kinds: ['floor'],
                certain: true,
                possibleGlyphs: ['.']
            };
        }
        return cell;
    }));
}

function templateKinds(cell) {
    if (cell == null) {
        return ['floor'];
    }
    const kinds = Array.isArray(cell?.kinds) ? cell.kinds : [];
    if (!kinds.length || kinds.includes('unknown') || kinds.includes('void')) {
        return null;
    }
    return [...new Set(kinds)];
}

function cellHasGlyph(cell, glyph) {
    if (!cell || typeof cell !== 'object') {
        return false;
    }
    const glyphs = Array.isArray(cell.possibleGlyphs)
        ? cell.possibleGlyphs
        : [cell.glyph];
    return glyphs.includes(glyph);
}

function addEntrySentinel(cell) {
    const possibleGlyphs = new Set([
        ...(Array.isArray(cell?.possibleGlyphs) ? cell.possibleGlyphs : []),
        SPRINT_ENTRY_SENTINEL
    ]);
    return {
        ...(cell || {}),
        possibleGlyphs: [...possibleGlyphs]
    };
}

function shuffleAlternatives(block, glyph) {
    for (const match of String(block || '').matchAll(
        /^\s*SHUFFLE:\s*(\S+)\s*$/gmu
    )) {
        const group = [...match[1]];
        if (group.includes(glyph)) {
            return group;
        }
    }
    return [glyph];
}

function subvaultDeclarations(block) {
    return [...String(block || '').matchAll(
        /^\s*SUBVAULT:\s*(\S+)\s*:\s*(\S+)\s*$/gmu
    )].flatMap(match => [...match[1]].map(glyph => ({
        glyph,
        selector: match[2]
    })));
}

function slotForGlyph(rows, glyph) {
    const points = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === glyph) {
                points.push({x, y});
            }
        }
    });
    if (!points.length) {
        return null;
    }
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return {
        x: minX,
        y: minY,
        width,
        height,
        mask: Array.from({length: height}, (_, y) =>
            Array.from({length: width}, (_, x) =>
                rows[minY + y]?.[minX + x] === glyph))
    };
}

function templateMatchesSelector(template, selector) {
    return template?.name === selector
        || (template?.metadata?.tags || []).includes(selector);
}

function transformedChildren(template, slot) {
    const candidates = [];
    for (const transform of allowedTransforms(template)) {
        const transformed = transformTemplate(template, transform);
        if (transformed.width !== slot.width
            || transformed.height !== slot.height) {
            continue;
        }
        let mismatch = 0;
        for (let y = 0; y < slot.height; y++) {
            for (let x = 0; x < slot.width; x++) {
                if (transformed.grid[y]?.[x] != null && !slot.mask[y]?.[x]) {
                    mismatch++;
                }
            }
        }
        candidates.push({transformed, mismatch});
    }
    const minimum = Math.min(...candidates.map(candidate => candidate.mismatch));
    if (minimum !== 0) {
        return [];
    }
    return candidates.filter(candidate => candidate.mismatch === minimum)
        .map(candidate => candidate.transformed);
}

function overlaySlotConsensus(grid, slot, candidates) {
    for (let y = 0; y < slot.height; y++) {
        for (let x = 0; x < slot.width; x++) {
            if (!slot.mask[y]?.[x]) {
                continue;
            }
            const kinds = new Set();
            let safe = candidates.length > 0;
            for (const candidate of candidates) {
                const possible = templateKinds(candidate.grid[y]?.[x]);
                if (!possible) {
                    safe = false;
                    break;
                }
                possible.forEach(kind => kinds.add(kind));
            }
            const base = grid[slot.y + y]?.[slot.x + x];
            const possibleGlyphs = candidates.some(candidate =>
                cellHasGlyph(
                    candidate.grid[y]?.[x],
                    SPRINT_ENTRY_SENTINEL
                ))
                ? [SPRINT_ENTRY_SENTINEL]
                : [];
            grid[slot.y + y][slot.x + x] = {
                ...(base || {}),
                kinds: safe ? [...kinds].sort() : [],
                certain: safe && kinds.size === 1,
                possibleGlyphs
            };
        }
    }
}

function resolveSprintSubvaults(source, parsed, cleanParsed, primary, spec) {
    const rawByName = new Map(parsed.map(template => [template.name, template]));
    const cleanByName = new Map(cleanParsed.map(template => [template.name, template]));
    const memo = new Map();
    const resolving = new Set();

    const resolve = name => {
        if (memo.has(name)) {
            return memo.get(name);
        }
        if (resolving.has(name)) {
            return null;
        }
        const raw = rawByName.get(name);
        const clean = cleanByName.get(name);
        const block = mapBlock(source, name);
        const rows = mapRows(block);
        if (!raw || !clean || !block
            || clean.metadata?.parseWarnings?.length
            || rows.length !== clean.height) {
            memo.set(name, null);
            return null;
        }
        resolving.add(name);
        const grid = clean.grid.map(row => row.map(cell => cell == null
            ? null
            : {...cell, kinds: [...(cell.kinds || [])]}));
        if (name === spec.entryChild) {
            const entryPoints = [];
            rows.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] === '{') {
                        entryPoints.push({x, y});
                    }
                }
            });
            if (entryPoints.length !== 1
                || templateKinds(grid[entryPoints[0].y]?.[entryPoints[0].x])
                    ?.join('|') !== 'stairs') {
                resolving.delete(name);
                memo.set(name, null);
                return null;
            }
            const [{x, y}] = entryPoints;
            grid[y][x] = addEntrySentinel(grid[y][x]);
        }
        const declarations = subvaultDeclarations(block);
        const byGlyph = new Map(declarations.map(entry => [entry.glyph, entry.selector]));
        for (const {glyph} of declarations) {
            const slot = slotForGlyph(rows, glyph);
            if (!slot) {
                continue;
            }
            const selectors = shuffleAlternatives(block, glyph)
                .map(alternative => byGlyph.get(alternative))
                .filter(Boolean);
            let unresolved = false;
            const variants = [];
            for (const selector of selectors) {
                const matches = parsed.filter(template =>
                    templateMatchesSelector(template, selector));
                if (!matches.length) {
                    unresolved = true;
                    break;
                }
                for (const match of matches) {
                    const child = resolve(match.name);
                    if (!child) {
                        unresolved = true;
                        break;
                    }
                    const candidate = {
                        ...match,
                        width: child.width,
                        height: child.height,
                        grid: child.grid,
                        metadata: {
                            ...match.metadata,
                            parseWarnings: []
                        }
                    };
                    variants.push(...transformedChildren(candidate, slot));
                }
                if (unresolved) {
                    break;
                }
            }
            overlaySlotConsensus(grid, slot, unresolved ? [] : variants);
        }
        const resolved = {
            ...clean,
            grid,
            metadata: {
                ...clean.metadata,
                parseWarnings: []
            }
        };
        resolving.delete(name);
        memo.set(name, resolved);
        return resolved;
    };

    const resolved = resolve(primary.name);
    if (!resolved) {
        return auditedGrid(primary, mapRows(mapBlock(source, primary.name)), spec);
    }
    return auditedGrid(resolved, mapRows(mapBlock(source, primary.name)), {
        ...spec,
        roleGlyphs: []
    });
}

function installSprintEntrySentinel(grid, spec) {
    const result = grid.map(row => row.map(cell => cell == null
        ? null
        : {
            ...cell,
            possibleGlyphs: [...(cell.possibleGlyphs || [])]
        }));
    const existing = [];
    const stairs = [];
    result.forEach((row, y) => row.forEach((cell, x) => {
        if (cellHasGlyph(cell, SPRINT_ENTRY_SENTINEL)) {
            existing.push({x, y});
        }
        if (templateKinds(cell)?.join('|') === 'stairs') {
            stairs.push({x, y});
        }
    }));
    if (spec.entryChild) {
        return existing.length === 1 ? result : null;
    }
    if (existing.length || stairs.length !== 1) {
        return null;
    }
    const [{x, y}] = stairs;
    result[y][x] = addEntrySentinel(result[y][x]);
    return result;
}

/**
 * Return one exact-source Sprint primary. SUBVAULT footprints are masked
 * rather than guessed: the outer layout is fixed, while child selection and
 * child Lua remain outside the automatic reveal proof.
 */
export function auditedSprintDestinationTemplates(source, parsed, options = {}) {
    const resolved = sourceSpec(options.path);
    if (!resolved) {
        return null;
    }
    const [path, spec] = resolved;
    if (sprintSourceSha256(source) !== spec.sha256) {
        return [];
    }

    const rawPrimary = (parsed || []).find(template => template.name === spec.name);
    const block = mapBlock(source, spec.name);
    const rows = mapRows(block);
    const declaredRoles = [...new Set(subvaultGlyphs(block))].sort();
    const expectedRoles = [...new Set(spec.roleGlyphs)].sort();
    const entryChildren = spec.entrySelector
        ? (parsed || []).filter(template =>
            templateMatchesSelector(template, spec.entrySelector))
        : [];
    if (!rawPrimary || !block
        || rawPrimary.width !== spec.width
        || rawPrimary.height !== spec.height
        || rawPrimary.metadata?.encompass !== true
        || !(rawPrimary.metadata?.tags || []).includes('sprint')
        || !warningSetMatches(rawPrimary.metadata?.parseWarnings, spec.warnings)
        || rows.length !== spec.height
        || declaredRoles.join('') !== expectedRoles.join('')
        || (spec.entrySelector
            && (entryChildren.length !== 1
                || entryChildren[0]?.name !== spec.entryChild))) {
        return [];
    }

    const cleanParsed = parseDes(
        sanitizeAuditedSprintSource(source, path),
        options
    );
    const sanitized = cleanParsed.find(template => template.name === spec.name);
    if (!sanitized
        || sanitized.width !== spec.width
        || sanitized.height !== spec.height
        || sanitized.metadata?.parseWarnings?.length) {
        return [];
    }

    const grid = installSprintEntrySentinel(resolveSprintSubvaults(
        source,
        parsed || [],
        cleanParsed,
        sanitized,
        spec
    ), spec);
    if (!grid) {
        return [];
    }

    return [{
        ...sanitized,
        path,
        grid,
        metadata: {
            ...sanitized.metadata,
            // Some exact audited helpers install transform restrictions.
            // The sanitized parser replacement models terrain only, so retain
            // the raw parser's audited tag/orientation result for Crawl's
            // actual legal transform set.
            tags: [...(rawPrimary.metadata?.tags || [])],
            orient: rawPrimary.metadata?.orient,
            encompass: rawPrimary.metadata?.encompass,
            place: 'D:1',
            parseWarnings: [],
            sourceAudit: SPRINT_SOURCE_AUDIT,
            sourceSha256: spec.sha256,
            sprint: true,
            autoReveal: true,
            // Every audited Sprint primary is an encompass map. Crawl resets
            // the complete 80x70 level to rock wall before centring the
            // transformed MAP; null MAP cells and the area outside the MAP
            // therefore have one exact coarse kind. Deliberately masked
            // SUBVAULT cells remain cell objects with an empty `kinds` array
            // and are not covered by this fill.
            encompassBorderFillKind: 'wall',
            dynamicSubvaultGlyphs: [...spec.roleGlyphs],
            matchPolicy: {...SPRINT_MATCH_POLICY}
        }
    }];
}

export function selectAuditedSprintCatalog(templates) {
    const candidates = Array.isArray(templates) ? templates : [];
    const names = candidates.map(template => template?.name).sort();
    const expectedNames = [...SPRINT_TEMPLATE_NAMES].sort();
    if (candidates.length !== expectedNames.length
        || names.join('|') !== expectedNames.join('|')
        || candidates.some(template =>
            template?.metadata?.sourceAudit !== SPRINT_SOURCE_AUDIT
            || template?.metadata?.sprint !== true
            || template?.metadata?.autoReveal !== true)) {
        return [];
    }
    return candidates;
}

export default auditedSprintDestinationTemplates;
