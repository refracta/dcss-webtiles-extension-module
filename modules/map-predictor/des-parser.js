const UNKNOWN_GLYPH = '\u0000unknown';

// `matcher.js` deliberately ignores the semantic "unknown" kind. Add every
// terrain kind which the WebTiles normalizer can actually emit so an unknown
// DES construct can neither anchor nor reject a candidate.
const OBSERVABLE_TERRAIN_KINDS = Object.freeze([
    'floor',
    'wall',
    'door',
    'shallow_water',
    'deep_water',
    'lava',
    'stairs',
    'portal',
    'altar',
    'statue'
]);

// These vault names are BRANCH_ENTRANCE/BRANCH_EXIT (MF_STAIR_*), not
// PORTAL_ENTRANCE/PORTAL_EXIT. In particular, an enter_/exit_ prefix alone
// cannot distinguish Crawl stairs from portals (Vaults and Zot are portals).
const BRANCH_STAIR_FEATURES = new Set([
    'exit_dungeon',
    'enter_slime_pits',
    'exit_slime_pits',
    'enter_orcish_mines',
    'exit_orcish_mines',
    'enter_dwarven_hall',
    'exit_dwarven_hall',
    'enter_forest',
    'exit_forest',
    'enter_hall_of_blades',
    'exit_hall_of_blades',
    'enter_lair',
    'exit_lair',
    'enter_crypt',
    'exit_crypt',
    'enter_temple',
    'exit_temple',
    'enter_snake_pit',
    'exit_snake_pit',
    'enter_elven_halls',
    'exit_elven_halls',
    'enter_tomb',
    'exit_tomb',
    'enter_swamp',
    'exit_swamp',
    'enter_shoals',
    'exit_shoals',
    'enter_spider_nest',
    'exit_spider_nest',
    'enter_depths',
    'exit_depths'
]);

export const TERRAIN_KINDS = Object.freeze([
    'floor',
    'wall',
    'door',
    'water',
    'shallow_water',
    'deep_water',
    'lava',
    'stairs',
    'portal',
    'altar',
    'statue',
    'tree',
    'fountain',
    'trap',
    'shop',
    'transporter',
    'arch',
    'feature',
    'void',
    'unknown'
]);

const TRANSFORM_NAMES = Object.freeze([
    'identity',
    'rotate90',
    'rotate180',
    'rotate270',
    'mirrorX',
    'mirrorY',
    'mirrorDiagonal',
    'mirrorAntiDiagonal'
]);

const TRANSFORM_MATRICES = Object.freeze({
    identity: [1, 0, 0, 1],
    rotate90: [0, -1, 1, 0],
    rotate180: [-1, 0, 0, -1],
    rotate270: [0, 1, -1, 0],
    mirrorX: [-1, 0, 0, 1],
    mirrorY: [1, 0, 0, -1],
    mirrorDiagonal: [0, 1, 1, 0],
    mirrorAntiDiagonal: [0, -1, -1, 0]
});

function defaultKindForGlyph(glyph) {
    if (glyph === ' ' || glyph === '') {
        return 'void';
    }
    if ('xXcvbmno'.includes(glyph)) {
        return 'wall';
    }
    if (glyph === 't') {
        return 'tree';
    }
    if ('+='.includes(glyph)) {
        return 'door';
    }
    if (glyph === 'w') {
        return 'deep_water';
    }
    if (glyph === 'W') {
        return 'shallow_water';
    }
    if (glyph === 'l') {
        return 'lava';
    }
    if ('><}{)(]['.includes(glyph)) {
        return 'stairs';
    }
    if (glyph === 'A') {
        // A stone arch has MF_FLOOR in WebTiles and is traversable.
        return 'floor';
    }
    if ('BC'.includes(glyph)) {
        return 'altar';
    }
    if (glyph === '^') {
        return 'trap';
    }
    if ('IG'.includes(glyph)) {
        return 'statue';
    }
    if ('TUVY'.includes(glyph)) {
        // Fountains have MF_FLOOR and are observed as floor by the matcher.
        return 'floor';
    }
    return 'floor';
}

function featureNameWithoutModifiers(feature) {
    return String(feature || '').trim()
        .replace(/^w:\d+\s+/u, '')
        .replace(/\s+w:\d+\b/gu, '')
        .replace(/\s+mimic(?::\d+)?\b/gu, '')
        .replace(/\s+no_mimic\b/gu, '')
        .trim();
}

function normalizedFeatureName(feature) {
    return featureNameWithoutModifiers(feature).toLowerCase()
        .replace(/[ -]+/gu, '_');
}

/**
 * Converts a DES feature name (or a one-character DES glyph) to a stable,
 * deliberately coarse terrain category. Unknown names stay unknown instead
 * of being guessed as floor.
 */
export function terrainKindForFeature(feature) {
    if (typeof feature !== 'string') {
        return 'unknown';
    }

    const raw = feature.trim();
    if (!raw) {
        return 'unknown';
    }

    const featureName = featureNameWithoutModifiers(raw);
    if (featureName.length === 1) {
        return defaultKindForGlyph(featureName);
    }
    const normalized = normalizedFeatureName(featureName);

    if (normalized === '.' || normalized === 'floor') {
        return 'floor';
    }
    if (normalized === 'nothing') {
        // Unlike KMONS/KITEM, "nothing" is not a valid KFEAT floor alias.
        return 'unknown';
    }
    if (normalized.includes('open_door')) {
        return 'floor';
    }
    if (normalized === 'stone_arch' || normalized === 'decorative_floor'
        || normalized.includes('fountain')
        || normalized.startsWith('cache_of_') || normalized === 'runelight'
        || normalized === 'binding_sigil' || normalized === 'endless_salt'
        || normalized === 'abandoned_shop') {
        return 'floor';
    }
    if (normalized.includes('shop')) {
        // DNGN_ENTER_SHOP is exposed by the current WebTiles normalizer as
        // enter_shop, and therefore belongs to its portal comparison class.
        return 'portal';
    }
    if (normalized.includes('transporter')) {
        return 'portal';
    }
    if (normalized === 'web' || normalized.includes('trap')) {
        return 'trap';
    }
    if (normalized.includes('door')) {
        return 'door';
    }
    if (normalized.includes('deep_water') || normalized.includes('open_sea')) {
        return 'deep_water';
    }
    if (normalized.includes('shallow_water')) {
        return 'shallow_water';
    }
    if (normalized === 'toxic_bog') {
        return 'shallow_water';
    }
    if (normalized.includes('water')) {
        return 'water';
    }
    if (normalized.includes('lava')) {
        return 'lava';
    }
    if (normalized.includes('altar')) {
        return 'altar';
    }
    if (normalized.includes('statue') || normalized.includes('idol')) {
        return 'statue';
    }
    if (normalized.includes('fountain')) {
        return 'fountain';
    }
    if (normalized.includes('tree') || normalized.includes('mangrove')) {
        return 'tree';
    }
    if (normalized.includes('wall') || normalized.includes('grate')) {
        return 'wall';
    }
    if (BRANCH_STAIR_FEATURES.has(normalized)
        || normalized.includes('stair') || normalized.includes('escape_hatch')
        || normalized === 'malign_gateway') {
        return 'stairs';
    }
    if (normalized.includes('portal') || normalized.startsWith('enter_')
        || normalized.startsWith('exit_') || normalized.includes('gateway')
        || normalized.includes('passage_of_golubria')) {
        return 'portal';
    }
    if (normalized.includes('arch')) {
        return 'floor';
    }
    if (normalized.includes('cache_') || normalized.includes('runelight')
        || normalized.includes('sigil')) {
        return 'feature';
    }
    return 'unknown';
}

function unique(values) {
    return [...new Set(values)];
}

function addTags(target, value) {
    for (const tag of String(value || '').trim().split(/\s+/u)) {
        if (tag && !target.tags.includes(tag)) {
            target.tags.push(tag);
        }
    }
}

function parseAssignment(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(\S+)\s+([=:])\s*(.*)$/u);
    if (match && match[3]) {
        return {glyphs: match[1], operator: match[2], value: match[3].trim()};
    }

    match = text.match(/^([^:=\s]+)([=:])(.*)$/u);
    if (match && match[3]) {
        return {glyphs: match[1], operator: match[2], value: match[3].trim()};
    }
    return null;
}

function splitAssignments(value) {
    return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
}

function parseReplacementGlyphs(value) {
    const compact = String(value || '').replace(/\s+/gu, '');
    const result = new Set();

    for (let i = 0; i < compact.length; i++) {
        const glyph = compact[i];
        result.add(glyph);
        if (compact[i + 1] === ':' && /\d/u.test(compact[i + 2] || '')) {
            i += 2;
            while (i + 1 < compact.length && /\d/u.test(compact[i + 1])) {
                i++;
            }
        }
    }
    return result;
}

function unknownOperation(reason) {
    return {allUnknown: true, reason, mapping: new Map()};
}

function mappingOperation(mapping, reason = null) {
    return {allUnknown: false, reason, mapping};
}

function addParseWarning(current, warning, {taintGrid = false} = {}) {
    if (!current.warnings.includes(warning)) {
        current.warnings.push(warning);
    }
    if (taintGrid && !current.gridTainted) {
        current.operations.push(unknownOperation(warning));
        current.gridTainted = true;
    }
}

function parseSubst(value, warnings) {
    const operations = [];
    for (const part of splitAssignments(value)) {
        const assignment = parseAssignment(part);
        if (!assignment) {
            warnings.push(`Could not parse SUBST assignment: ${part}`);
            operations.push(unknownOperation('malformed SUBST'));
            continue;
        }

        const replacements = parseReplacementGlyphs(assignment.value);
        if (!replacements.size) {
            replacements.add(UNKNOWN_GLYPH);
            warnings.push(`SUBST has no statically readable replacement: ${part}`);
        }
        const mapping = new Map();
        for (const glyph of assignment.glyphs) {
            mapping.set(glyph, new Set(replacements));
        }
        operations.push(mappingOperation(mapping));
    }
    return operations;
}

function stripNsubstCount(value) {
    return String(value || '').trim().replace(/^(?:\*|\d+)\s*[=:]\s*/u, '');
}

function parseNsubst(value, warnings) {
    const operations = [];
    for (const part of splitAssignments(value)) {
        const assignment = parseAssignment(part);
        if (!assignment) {
            warnings.push(`Could not parse NSUBST assignment: ${part}`);
            operations.push(unknownOperation('malformed NSUBST'));
            continue;
        }

        const replacements = new Set();
        for (const specifier of assignment.value.split('/')) {
            const replacement = stripNsubstCount(specifier);
            for (const glyph of parseReplacementGlyphs(replacement)) {
                replacements.add(glyph);
            }
        }
        if (!replacements.size) {
            replacements.add(UNKNOWN_GLYPH);
            warnings.push(`NSUBST has no statically readable replacement: ${part}`);
        }

        const mapping = new Map();
        for (const glyph of assignment.glyphs) {
            mapping.set(glyph, new Set(replacements));
        }
        operations.push(mappingOperation(mapping));
    }
    return operations;
}

function mergeMapping(mapping, glyph, replacements) {
    if (!mapping.has(glyph)) {
        mapping.set(glyph, new Set());
    }
    for (const replacement of replacements) {
        mapping.get(glyph).add(replacement);
    }
}

function parseShuffle(value, warnings) {
    const operations = [];
    for (const rawPart of splitAssignments(value)) {
        const part = rawPart.replace(/\s+/gu, '');
        if (!part) {
            continue;
        }

        const blocks = part.split('/');
        const mapping = new Map();
        if (blocks.length === 1) {
            const replacements = new Set(blocks[0]);
            for (const glyph of blocks[0]) {
                mergeMapping(mapping, glyph, replacements);
            }
        } else if (blocks.every(block => block.length === blocks[0].length)) {
            for (let position = 0; position < blocks[0].length; position++) {
                const replacements = new Set(blocks.map(block => block[position]));
                for (const block of blocks) {
                    mergeMapping(mapping, block[position], replacements);
                }
            }
        } else {
            const replacements = new Set(blocks.join(''));
            for (const glyph of replacements) {
                mergeMapping(mapping, glyph, replacements);
            }
            warnings.push(`SHUFFLE blocks have different widths: ${rawPart}`);
        }

        if (!mapping.size) {
            warnings.push(`Could not parse SHUFFLE: ${rawPart}`);
            operations.push(unknownOperation('malformed SHUFFLE'));
        } else {
            operations.push(mappingOperation(mapping));
        }
    }
    return operations;
}

function featureCanReceivePoolFixup(feature) {
    const name = featureNameWithoutModifiers(feature);
    return name === 'w' || normalizedFeatureName(name) === 'deep_water';
}

function parseKfeat(value, featureKinds, poolFixupFeatureGlyphs, warnings) {
    const assignment = parseAssignment(value);
    if (!assignment) {
        warnings.push(`Could not parse KFEAT assignment: ${value}`);
        return false;
    }

    const kinds = new Set();
    let canReceivePoolFixup = false;
    for (const alternative of assignment.value.split('/')) {
        const kind = terrainKindForFeature(alternative);
        kinds.add(kind);
        canReceivePoolFixup ||= featureCanReceivePoolFixup(alternative);
    }
    if (!kinds.size) {
        kinds.add('unknown');
    }

    for (const glyph of assignment.glyphs) {
        // Each KFEAT declaration replaces the keyed feature slot for its
        // glyph. Repeated declarations do not accumulate alternatives.
        featureKinds.set(glyph, new Set(kinds));
        if (canReceivePoolFixup) {
            poolFixupFeatureGlyphs.add(glyph);
        } else {
            poolFixupFeatureGlyphs.delete(glyph);
        }
    }
    return true;
}

function parseKmask(value, poolFixupOverrides, warnings) {
    const assignment = parseAssignment(value);
    if (!assignment) {
        warnings.push(`Could not parse KMASK assignment: ${value}`);
        return false;
    }

    const tokens = assignment.value.split(/\s+/u);
    const disablesFixup = tokens.includes('no_pool_fixup');
    const enablesFixup = tokens.includes('!no_pool_fixup');
    if (!disablesFixup && !enablesFixup) {
        return true;
    }
    for (const glyph of assignment.glyphs) {
        poolFixupOverrides.set(glyph, disablesFixup && !enablesFixup);
    }
    return true;
}

function addTerrainMarker(current, glyphs, kind, canReceivePoolFixup = false) {
    current.terrainMarkers.push({
        glyphs: new Set(glyphs),
        kind,
        canReceivePoolFixup,
        operationCount: current.operations.length
    });
}

function parseMarker(value, current) {
    const assignment = parseAssignment(value);
    if (!assignment) {
        current.warnings.push(`Could not parse MARKER assignment: ${value}`);
        return false;
    }

    let kind = null;
    const feature = assignment.value.match(/^feat\s*:\s*(\S(?:.*\S)?)\s*$/u);
    if (feature) {
        kind = terrainKindForFeature(feature[1]);
    } else if (/^lua\s*:\s*transp_(?:dest_)?loc\s*\(/u.test(assignment.value)) {
        kind = 'portal';
    }
    if (!kind) {
        return true;
    }

    addTerrainMarker(
        current,
        assignment.glyphs,
        kind,
        Boolean(feature && featureCanReceivePoolFixup(feature[1]))
    );
    return true;
}

function setPortalGlyphs(current, glyphs) {
    addTerrainMarker(current, glyphs, 'portal');
}

function literalLuaAssignment(line) {
    const match = line.match(/^(?:local\s+)?([A-Za-z_]\w*)\s*=\s*/u);
    if (!match) {
        return null;
    }
    const start = match[0].length;
    if (line[start] !== '"' && line[start] !== "'") {
        return null;
    }
    const literal = readLuaString(line, start);
    if (!literal || !/^\s*;?\s*$/u.test(line.slice(literal.end))) {
        return null;
    }
    return {name: match[1], value: literal.value};
}

function literalLuaMarkerGlyphs(line, current) {
    const startMatch = line.match(/\blua_marker\s*\(\s*/u);
    if (!startMatch) {
        return null;
    }
    if (!current.literalLuaLoop && current.literalLuaControlDepth > 0) {
        return null;
    }
    const start = startMatch.index + startMatch[0].length;
    if (line[start] === '"' || line[start] === "'") {
        const literal = readLuaString(line, start);
        return literal ? literal.value : null;
    }

    const expression = line.slice(start).match(
        /^([A-Za-z_]\w*):sub\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)/u
    );
    if (!expression || expression[2] !== expression[3]) {
        return null;
    }
    const loop = current.literalLuaLoop;
    const value = current.literalLuaStrings.get(expression[1]);
    const bound = loop && current.literalLuaStrings.get(loop.boundName);
    if (!loop || loop.nestedDepth !== 0 || loop.indexName !== expression[2]
        || value == null || bound == null || value.length !== bound.length) {
        return null;
    }
    return value;
}

/**
 * Recognizes only literal, deterministic transporter loops. This is static
 * pattern matching: no Lua expression is evaluated and conditional/nested
 * marker calls are ignored.
 */
function parseLiteralLuaTerrain(rawLine, current) {
    const line = stripLuaComment(rawLine).trim();
    if (!line) {
        return;
    }

    const assignment = literalLuaAssignment(line);
    if (assignment && current.literalLuaControlDepth === 0
        && !current.literalLuaLoop) {
        current.literalLuaStrings.set(assignment.name, assignment.value);
    }

    const loopStart = line.match(
        /^for\s+([A-Za-z_]\w*)\s*=\s*1\s*,\s*#([A-Za-z_]\w*)\s+do\s*$/u
    );
    if (loopStart && current.literalLuaControlDepth === 0
        && current.literalLuaStrings.has(loopStart[2])) {
        current.literalLuaLoop = {
            indexName: loopStart[1],
            boundName: loopStart[2],
            nestedDepth: 0
        };
        return;
    }

    const loop = current.literalLuaLoop;
    if (loop && /^(?:if\b|while\b|repeat\b|for\b|do\b)/u.test(line)) {
        loop.nestedDepth++;
    }
    if (loop && (/^end\b/u.test(line) || /^until\b/u.test(line))) {
        if (loop.nestedDepth > 0) {
            loop.nestedDepth--;
        } else {
            current.literalLuaLoop = null;
        }
        current.pendingLuaMarkerGlyphs = null;
        return;
    }

    if (!loop && /^(?:if\b|while\b|repeat\b|for\b|do\b|(?:local\s+)?function\b)/u.test(line)) {
        current.literalLuaControlDepth++;
        current.pendingLuaMarkerGlyphs = null;
        return;
    }
    if (!loop && (/^end\b/u.test(line) || /^until\b/u.test(line))) {
        current.literalLuaControlDepth = Math.max(0, current.literalLuaControlDepth - 1);
        current.pendingLuaMarkerGlyphs = null;
        return;
    }

    const markerGlyphs = literalLuaMarkerGlyphs(line, current);
    if (markerGlyphs != null) {
        if (/\btransp_(?:dest_)?loc\s*\(/u.test(line)) {
            setPortalGlyphs(current, markerGlyphs);
            current.pendingLuaMarkerGlyphs = null;
        } else {
            current.pendingLuaMarkerGlyphs = markerGlyphs;
        }
        return;
    }

    if (/\blua_marker\s*\(/u.test(line)) {
        if (/\btransp_(?:dest_)?loc\s*\(/u.test(line)) {
            addParseWarning(
                current,
                'Lua transporter marker is conditional or dynamically keyed',
                {taintGrid: true}
            );
            current.unresolvedLuaMarker = false;
        } else {
            current.unresolvedLuaMarker = true;
        }
        return;
    }

    if (current.unresolvedLuaMarker) {
        if (/\btransp_(?:dest_)?loc\s*\(/u.test(line)) {
            addParseWarning(
                current,
                'Lua transporter marker is conditional or dynamically keyed',
                {taintGrid: true}
            );
        }
        if (/\)/u.test(line)) {
            current.unresolvedLuaMarker = false;
        }
    }

    if (current.pendingLuaMarkerGlyphs != null) {
        if (/\btransp_(?:dest_)?loc\s*\(/u.test(line)) {
            setPortalGlyphs(current, current.pendingLuaMarkerGlyphs);
        }
        if (/\)/u.test(line)) {
            current.pendingLuaMarkerGlyphs = null;
        }
    }
}

function parseKeyedFloor(value, keyedFloorGlyphs, warnings, directive) {
    const assignment = parseAssignment(value);
    if (!assignment) {
        warnings.push(`Could not parse ${directive} assignment: ${value}`);
        return false;
    }
    for (const glyph of assignment.glyphs) {
        keyedFloorGlyphs.add(glyph);
    }
    return true;
}

function stripLuaComment(line) {
    let quote = null;
    let escaped = false;
    for (let i = 0; i < line.length - 1; i++) {
        const char = line[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\' && quote) {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '-' && line[i + 1] === '-') {
            return line.slice(0, i);
        }
    }
    return line;
}

function readLuaString(text, start) {
    const quote = text[start];
    let value = '';
    let escaped = false;

    for (let i = start + 1; i < text.length; i++) {
        const char = text[i];
        if (escaped) {
            const escapes = {n: '\n', r: '\r', t: '\t'};
            value += escapes[char] ?? char;
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === quote) {
            return {value, end: i + 1};
        } else {
            value += char;
        }
    }
    return null;
}

const SAFE_HELPER_METHODS = new Set([
    'orient',
    'tags',
    'place',
    'depth',
    'kfeat'
]);

const UNSUPPORTED_HELPER_METHODS = new Set([
    'clear',
    'default_subvault_glyphs',
    'hook',
    'kitem',
    'kmask',
    'kmons',
    'lua_marker',
    'map',
    'marker',
    'name',
    'nsubst',
    'shuffle',
    'subst',
    'subvault'
]);

function maskLuaStrings(line) {
    const characters = [...line];
    let quote = null;
    let escaped = false;

    for (let index = 0; index < characters.length; index++) {
        const character = characters[index];
        if (quote) {
            characters[index] = ' ';
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
        } else if (character === '"' || character === "'") {
            quote = character;
            characters[index] = ' ';
        }
    }
    return characters.join('');
}

function helperMethodCalls(line, parameter) {
    const calls = [];
    const escapedParameter = parameter.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`\\b${escapedParameter}\\.([A-Za-z_]\\w*)\\s*\\(\\s*`, 'gu');
    const code = maskLuaStrings(line);
    let match;

    while ((match = pattern.exec(line))) {
        if (/\s/u.test(code[match.index] || '')) {
            continue;
        }
        const start = match.index + match[0].length;
        let literal = null;
        let literalOnly = false;
        if (line[start] === '"' || line[start] === "'") {
            literal = readLuaString(line, start);
            if (literal) {
                literalOnly = /^\s*\)/u.test(line.slice(literal.end));
                pattern.lastIndex = literal.end;
            }
        }
        calls.push({
            method: match[1],
            value: literal?.value ?? null,
            literalOnly
        });
    }
    return calls;
}

function directHelperMutationCalls(line) {
    const methods = new Set([
        ...SAFE_HELPER_METHODS,
        ...UNSUPPORTED_HELPER_METHODS
    ]);
    const code = maskLuaStrings(line);
    const pattern = /(^|[^.\w:])([A-Za-z_]\w*)\s*\(/gu;
    const calls = [];
    let match;

    while ((match = pattern.exec(code))) {
        const method = match[2].toLowerCase();
        if (methods.has(method)) {
            calls.push(method);
        }
    }
    return unique(calls);
}

function addHelperIssue(helper, issue) {
    if (!helper.issues.includes(issue)) {
        helper.issues.push(issue);
    }
}

function startsLuaControl(line) {
    const text = line.trim();
    return /^(?:if\b|for\b|while\b|repeat\b|do\b|(?:local\s+)?function\b)/u.test(text);
}

function extractLuaHelpers(source) {
    const helpers = new Map();
    const lines = source.replace(/\r\n?/gu, '\n').split('\n');
    let current = null;

    for (const rawLine of lines) {
        const line = stripLuaComment(rawLine);
        const trimmed = line.trim();
        if (!current) {
            const match = trimmed.match(/^(?:local\s+)?function\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\b[^)]*\)\s*$/u);
            if (match) {
                current = {
                    name: match[1],
                    parameter: match[2],
                    controlDepth: 0,
                    effects: [],
                    issues: []
                };
            }
            continue;
        }

        if (/^end\b/u.test(trimmed)) {
            if (current.controlDepth > 0) {
                current.controlDepth--;
            } else {
                helpers.set(current.name, current);
                current = null;
            }
            continue;
        }
        if (/^until\b/u.test(trimmed)) {
            current.controlDepth = Math.max(0, current.controlDepth - 1);
            continue;
        }

        const entersControl = startsLuaControl(trimmed);
        const conditional = current.controlDepth > 0 || entersControl;
        for (const call of helperMethodCalls(line, current.parameter)) {
            if (SAFE_HELPER_METHODS.has(call.method)) {
                if (conditional) {
                    addHelperIssue(current, `conditional ${call.method}()`);
                } else if (!call.literalOnly) {
                    addHelperIssue(current, `dynamic ${call.method}()`);
                } else {
                    current.effects.push({method: call.method, value: call.value});
                }
            } else if (UNSUPPORTED_HELPER_METHODS.has(call.method)) {
                addHelperIssue(current, `unsupported ${call.method}()`);
            }
        }
        for (const method of directHelperMutationCalls(line)) {
            addHelperIssue(current, `unsupported direct ${method}()`);
        }
        if (entersControl) {
            const endsOnSameLine = /\bend\s*;?\s*$/u.test(maskLuaStrings(trimmed));
            if (!endsOnSameLine) {
                current.controlDepth++;
            }
        }
    }
    return helpers;
}

function helperCallName(line) {
    let text = stripLuaComment(line).trim();
    if (text.startsWith(':')) {
        text = text.slice(1).trim();
    }
    if (text.startsWith('{{') && text.endsWith('}}')) {
        text = text.slice(2, -2).trim();
    }
    const match = text.match(/^([A-Za-z_]\w*)\s*\(\s*_G\b/u);
    return match ? match[1] : null;
}

function addHelperWarnings(current, helper) {
    for (const issue of helper?.issues || []) {
        addParseWarning(
            current,
            `Lua helper ${helper.name} is not statically safe: ${issue}`,
            {taintGrid: true}
        );
    }
}

function applyHelper(current, helper) {
    for (const effect of helper.effects) {
        if (effect.method === 'tags') {
            addTags(current, effect.value);
        } else if (effect.method === 'orient') {
            current.orient = effect.value.trim().toLowerCase();
        } else if (effect.method === 'place') {
            current.place = effect.value.trim();
        } else if (effect.method === 'depth') {
            current.depth = effect.value.trim();
        } else if (effect.method === 'kfeat') {
            parseKfeat(
                effect.value,
                current.featureKinds,
                current.poolFixupFeatureGlyphs,
                current.warnings
            );
        }
    }
    addHelperWarnings(current, helper);
}

function multiplyMatrices(left, right) {
    return [
        left[0] * right[0] + left[1] * right[2],
        left[0] * right[1] + left[1] * right[3],
        left[2] * right[0] + left[3] * right[2],
        left[2] * right[1] + left[3] * right[3]
    ];
}

function matrixKey(matrix) {
    return matrix.join(',');
}

function allowedTransforms(tags) {
    const tagSet = new Set(tags);
    const horizontal = tagSet.has('no_hmirror')
        ? [TRANSFORM_MATRICES.identity]
        : [TRANSFORM_MATRICES.identity, TRANSFORM_MATRICES.mirrorX];
    const vertical = tagSet.has('no_vmirror')
        ? [TRANSFORM_MATRICES.identity]
        : [TRANSFORM_MATRICES.identity, TRANSFORM_MATRICES.mirrorY];
    const rotations = tagSet.has('no_rotate')
        ? [TRANSFORM_MATRICES.identity]
        : [
            TRANSFORM_MATRICES.identity,
            TRANSFORM_MATRICES.rotate90,
            TRANSFORM_MATRICES.rotate270
        ];
    const matrices = new Set();

    for (const hmirror of horizontal) {
        for (const vmirror of vertical) {
            const mirrored = multiplyMatrices(vmirror, hmirror);
            for (const rotation of rotations) {
                matrices.add(matrixKey(multiplyMatrices(rotation, mirrored)));
            }
        }
    }

    const nameByMatrix = new Map(Object.entries(TRANSFORM_MATRICES)
        .map(([name, matrix]) => [matrixKey(matrix), name]));
    const names = new Set([...matrices].map(key => nameByMatrix.get(key)).filter(Boolean));
    return TRANSFORM_NAMES.filter(name => names.has(name));
}

function resolveGlyph(glyph, operations) {
    let possible = new Set([glyph]);
    for (const operation of operations) {
        if (operation.allUnknown) {
            return new Set([UNKNOWN_GLYPH]);
        }
        const next = new Set();
        for (const candidate of possible) {
            if (candidate === UNKNOWN_GLYPH) {
                next.add(candidate);
            } else if (operation.mapping.has(candidate)) {
                for (const replacement of operation.mapping.get(candidate)) {
                    next.add(replacement);
                }
            } else {
                next.add(candidate);
            }
        }
        possible = next;
    }
    return possible;
}

function poolFixupIsDisabled(glyph, current) {
    if (current.poolFixupOverrides.has(glyph)) {
        return current.poolFixupOverrides.get(glyph);
    }
    return current.tags.includes('no_pool_fixup');
}

function addKindWithPoolFixup(kinds, kind, glyph, current, canReceivePoolFixup) {
    kinds.add(kind);
    if (kind === 'deep_water' && canReceivePoolFixup
        && !poolFixupIsDisabled(glyph, current)) {
        // Crawl's post-generation _prepare_water() may turn deep water next
        // to dry terrain (or newly shallow water) into shallow water. Without
        // spatial/RNG execution both results must remain possible.
        kinds.add('shallow_water');
    }
}

function markerTerrainForGlyph(glyph, possibleGlyphs, current) {
    const kinds = new Set();
    let guaranteed = false;

    for (const marker of current.terrainMarkers) {
        const glyphsAtMarker = resolveGlyph(
            glyph,
            current.operations.slice(0, marker.operationCount)
        );
        const matching = [...glyphsAtMarker]
            .filter(value => value !== UNKNOWN_GLYPH && marker.glyphs.has(value));
        if (!matching.length && !glyphsAtMarker.has(UNKNOWN_GLYPH)) {
            continue;
        }

        kinds.add(marker.kind);
        if (marker.kind === 'deep_water' && marker.canReceivePoolFixup
            && [...possibleGlyphs].some(value =>
                value === UNKNOWN_GLYPH || !poolFixupIsDisabled(value, current))) {
            kinds.add('shallow_water');
        }
        if (!glyphsAtMarker.has(UNKNOWN_GLYPH)
            && matching.length === glyphsAtMarker.size) {
            guaranteed = true;
        }
    }

    return {kinds, guaranteed};
}

function cellForGlyph(glyph, current, cache) {
    if (!cache.has(glyph)) {
        cache.set(glyph, resolveGlyph(glyph, current.operations));
    }
    const possibleGlyphs = cache.get(glyph);
    const kinds = new Set();
    const markerTerrain = markerTerrainForGlyph(glyph, possibleGlyphs, current);

    if (!markerTerrain.guaranteed) {
        for (const possibleGlyph of possibleGlyphs) {
            if (possibleGlyph === UNKNOWN_GLYPH) {
                kinds.add('unknown');
            } else if (current.featureKinds.has(possibleGlyph)) {
                for (const kind of current.featureKinds.get(possibleGlyph)) {
                    addKindWithPoolFixup(
                        kinds,
                        kind,
                        possibleGlyph,
                        current,
                        current.poolFixupFeatureGlyphs.has(possibleGlyph)
                    );
                }
            } else if (current.keyedFloorGlyphs.has(possibleGlyph)) {
                kinds.add('floor');
            } else {
                addKindWithPoolFixup(
                    kinds,
                    defaultKindForGlyph(possibleGlyph),
                    possibleGlyph,
                    current,
                    possibleGlyph === 'w'
                );
            }
        }
    }
    for (const kind of markerTerrain.kinds) {
        kinds.add(kind);
    }

    if (kinds.size === 1 && kinds.has('void')) {
        return null;
    }
    if (kinds.has('unknown') || kinds.has('void')) {
        // An unknown feature, or a substitution which may erase this cell,
        // can reveal any terrain already present underneath the vault.
        for (const kind of OBSERVABLE_TERRAIN_KINDS) {
            kinds.add(kind);
        }
    }

    const sortedKinds = [...kinds].sort();
    const certain = sortedKinds.length === 1 && sortedKinds[0] !== 'unknown';
    return {
        kinds: sortedKinds.length ? sortedKinds : ['unknown'],
        certain,
        glyph,
        possibleGlyphs: [...possibleGlyphs]
            .filter(value => value !== UNKNOWN_GLYPH)
            .sort()
    };
}

function makeTemplate(current, path) {
    const width = current.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    const cache = new Map();
    const grid = current.rows.map(row => {
        const cells = [];
        for (let x = 0; x < width; x++) {
            cells.push(cellForGlyph(row[x] || ' ', current, cache));
        }
        return cells;
    });
    const hasUncertainCells = grid.some(row => row.some(cell => cell && !cell.certain));
    const orient = current.orient || null;

    return {
        name: current.name,
        path: path || null,
        width,
        height: grid.length,
        grid,
        metadata: {
            tags: [...current.tags],
            place: current.place || null,
            depth: current.depth || current.defaultDepth || null,
            orient,
            encompass: orient === 'encompass',
            allowedTransforms: allowedTransforms(current.tags),
            hasUncertainCells,
            parseWarnings: [...current.warnings],
            sourceLine: current.sourceLine
        }
    };
}

function newMap(name, sourceLine, defaultDepth) {
    return {
        name,
        sourceLine,
        defaultDepth,
        rows: [],
        tags: [],
        place: null,
        depth: null,
        orient: null,
        featureKinds: new Map(),
        poolFixupFeatureGlyphs: new Set(),
        poolFixupOverrides: new Map(),
        terrainMarkers: [],
        literalLuaStrings: new Map(),
        literalLuaLoop: null,
        literalLuaControlDepth: 0,
        pendingLuaMarkerGlyphs: null,
        unresolvedLuaMarker: false,
        desControlDepth: 0,
        keyedFloorGlyphs: new Set(),
        operations: [],
        gridTainted: false,
        warnings: []
    };
}

function appendLogicalLine(lines, index) {
    const sourceLine = index + 1;
    let line = lines[index];
    while (/\\\s*$/u.test(line) && index + 1 < lines.length) {
        line = line.replace(/\\\s*$/u, '') + lines[++index].trimStart();
    }
    return {line, index, sourceLine};
}

const CONDITIONAL_DIRECTIVES = new Set([
    'TAGS',
    'PLACE',
    'DEPTH',
    'ORIENT',
    'KFEAT',
    'KMONS',
    'KITEM',
    'KMASK',
    'MARKER',
    'SUBVAULT',
    'SUBST',
    'NSUBST',
    'SHUFFLE',
    'CLEAR'
]);

const DIRECT_LUA_MUTATORS = new Set([
    'clear',
    'default_subvault_glyphs',
    'kfeat',
    'kitem',
    'kmask',
    'kmons',
    'map',
    'marker',
    'nsubst',
    'orient',
    'place',
    'shuffle',
    'subst',
    'subvault',
    'tags'
]);

function colonControlAction(line) {
    const trimmed = stripLuaComment(line).trim();
    if (!trimmed.startsWith(':')) {
        return null;
    }
    const lua = trimmed.slice(1).trim();
    if (/^(?:if\b|for\b|while\b|repeat\b|do\b)/u.test(lua)) {
        return 'enter';
    }
    if (/^(?:elseif\b|else\b)/u.test(lua)) {
        return 'branch';
    }
    if (/^(?:end\b|until\b)/u.test(lua)) {
        return 'exit';
    }
    return null;
}

function directLuaMutator(line) {
    const trimmed = stripLuaComment(line).trim();
    if (!trimmed.startsWith(':')) {
        return null;
    }
    const match = trimmed.slice(1).trim().match(/^([A-Za-z_]\w*)\s*\(/u);
    const name = match?.[1]?.toLowerCase() || null;
    return DIRECT_LUA_MUTATORS.has(name) ? name : null;
}

/**
 * Parses Crawl's textual .des format without evaluating any embedded Lua.
 * Only literal, top-level effects from simple Lua helpers are recognized.
 */
export function parseDes(source, {path = null} = {}) {
    if (typeof source !== 'string') {
        throw new TypeError('parseDes source must be a string');
    }

    const normalized = source.replace(/\r\n?/gu, '\n');
    const lines = normalized.split('\n');
    const helpers = extractLuaHelpers(normalized);
    const templates = [];
    let defaultDepth = null;
    let current = null;
    let inMap = false;
    let inEpilogue = false;

    for (let index = 0; index < lines.length; index++) {
        if (inMap) {
            const line = lines[index];
            if (line.trim() === 'ENDMAP') {
                templates.push(makeTemplate(current, path));
                current = null;
                inMap = false;
            } else {
                current.rows.push(line);
            }
            continue;
        }

        const logical = appendLogicalLine(lines, index);
        index = logical.index;
        const line = logical.line;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (inEpilogue) {
            if (trimmed.includes('}}')) {
                inEpilogue = false;
            }
            continue;
        }
        if (/^epilogue\s*\{\{/iu.test(trimmed)) {
            inEpilogue = !trimmed.includes('}}');
            continue;
        }

        const defaultMatch = trimmed.match(/^default-depth\s*:\s*(.*)$/iu);
        if (defaultMatch) {
            defaultDepth = defaultMatch[1].trim() || null;
            continue;
        }

        const directive = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u);
        if (directive && directive[1].toUpperCase() === 'NAME') {
            current = newMap(directive[2].trim(), logical.sourceLine, defaultDepth);
            continue;
        }
        if (!current) {
            continue;
        }
        if (trimmed === 'MAP') {
            inMap = true;
            continue;
        }

        const controlAction = colonControlAction(line);
        if (controlAction === 'enter') {
            current.desControlDepth++;
            continue;
        }
        if (controlAction === 'branch') {
            continue;
        }
        if (controlAction === 'exit') {
            current.desControlDepth = Math.max(0, current.desControlDepth - 1);
            continue;
        }

        parseLiteralLuaTerrain(line, current);
        const mutator = directLuaMutator(line);
        if (mutator) {
            addParseWarning(
                current,
                `Direct Lua ${mutator}() call is not statically supported`,
                {taintGrid: true}
            );
            continue;
        }

        const helperName = helperCallName(line);
        if (helperName) {
            if (current.desControlDepth > 0) {
                addParseWarning(
                    current,
                    `Lua helper ${helperName} is called conditionally`,
                    {taintGrid: true}
                );
            }
            if (!helpers.has(helperName)) {
                addParseWarning(
                    current,
                    `Unknown Lua helper ${helperName}(_G)`,
                    {taintGrid: true}
                );
            } else if (current.desControlDepth > 0) {
                addHelperWarnings(current, helpers.get(helperName));
            } else {
                applyHelper(current, helpers.get(helperName));
            }
            continue;
        }
        if (!directive) {
            continue;
        }

        const key = directive[1].toUpperCase();
        const value = directive[2].trim();
        if (key === 'SUBVAULT') {
            addParseWarning(
                current,
                'SUBVAULT directives are not statically supported',
                {taintGrid: true}
            );
            if (current.desControlDepth > 0) {
                addParseWarning(
                    current,
                    'SUBVAULT directive appears inside Lua control flow',
                    {taintGrid: true}
                );
            }
            continue;
        }
        if (current.desControlDepth > 0 && CONDITIONAL_DIRECTIVES.has(key)) {
            addParseWarning(
                current,
                `${key} directive appears inside Lua control flow`,
                {taintGrid: true}
            );
            continue;
        }
        if (key === 'TAGS') {
            addTags(current, value);
        } else if (key === 'PLACE') {
            current.place = value || null;
        } else if (key === 'DEPTH') {
            current.depth = value || null;
        } else if (key === 'ORIENT') {
            current.orient = value.toLowerCase() || null;
        } else if (key === 'KFEAT') {
            parseKfeat(
                value,
                current.featureKinds,
                current.poolFixupFeatureGlyphs,
                current.warnings
            );
        } else if (key === 'KMONS' || key === 'KITEM') {
            parseKeyedFloor(value, current.keyedFloorGlyphs, current.warnings, key);
        } else if (key === 'KMASK') {
            parseKmask(value, current.poolFixupOverrides, current.warnings);
        } else if (key === 'MARKER') {
            parseMarker(value, current);
        } else if (key === 'SUBST') {
            current.operations.push(...parseSubst(value, current.warnings));
        } else if (key === 'NSUBST') {
            current.operations.push(...parseNsubst(value, current.warnings));
        } else if (key === 'SHUFFLE') {
            current.operations.push(...parseShuffle(value, current.warnings));
        } else if (key === 'CLEAR') {
            const mapping = new Map();
            for (const glyph of value.replace(/\s+/gu, '')) {
                mapping.set(glyph, new Set([' ']));
            }
            current.operations.push(mappingOperation(mapping));
        }
    }

    return templates;
}

export default parseDes;
