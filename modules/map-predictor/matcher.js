const DEFAULT_WORLD_WIDTH = 80;
const DEFAULT_WORLD_HEIGHT = 70;
const CRAWL_ROTATION_LIMIT = Math.min(DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT);
const CELL_KIND_CACHE = new WeakMap();
const HELL_VESTIBULE_ENTRY_CONSENSUS_PROTOCOL =
    'hell-vestibule-entry-consensus-v1';
const HELL_VESTIBULE_SOURCE_AUDIT =
    'hell-vestibule-fixed-composite-v1';
const HELL_VESTIBULE_PARENT_TRANSFORMS = Object.freeze([
    'r0', 'r0v', 'r0h', 'r0hv'
]);
const HELL_VESTIBULE_SLOT_ROLES = Object.freeze([
    'vestibule_dis',
    'vestibule_tar',
    'vestibule_coc',
    'vestibule_geh',
    'vestibule_geryon'
]);
const HELL_VESTIBULE_SLOT_VARIANTS = Object.freeze([56, 56, 56, 56, 64]);
const HELL_VESTIBULE_ALLOWED_FROM_PLACES = Object.freeze([
    'dungeon', 'depths'
]);
const CLOSED_COMPOSITE_ROLE_POOL_CACHE = new WeakMap();

const KIND_WEIGHTS = {
    wall: 1,
    floor: 1,
    door: 3,
    shallow_water: 3,
    deep_water: 3,
    water: 3,
    lava: 4,
    stair: 4,
    portal: 5,
    altar: 3,
    statue: 2,
    solid: 2,
    open: 1
};

function unique(values) {
    return [...new Set(values)];
}

export function normalizeTerrainKind(kind) {
    if (kind == null) {
        return null;
    }

    const value = String(kind).trim().toLowerCase().replaceAll(' ', '_');
    const aliases = {
        rock_wall: 'wall',
        permanent_rock_wall: 'wall',
        permawall: 'wall',
        stone_wall: 'wall',
        metal_wall: 'wall',
        crystal_wall: 'wall',
        clear_rock_wall: 'wall',
        clear_stone_wall: 'wall',
        clear_permanent_rock_wall: 'wall',
        tree: 'wall',
        closed_door: 'door',
        runed_door: 'door',
        open_door: 'floor',
        escape_hatch: 'stair',
        stairs: 'stair',
        shallowwater: 'shallow_water',
        deepwater: 'deep_water',
        granite_statue: 'statue',
        metal_statue: 'statue',
        arch: 'floor',
        fountain: 'floor',
        trap: 'floor',
        transporter: 'portal',
        shop: 'portal',
        feature: 'open',
        unknown: null,
        unseen: null,
        transparent: null
    };

    if (Object.hasOwn(aliases, value)) {
        return aliases[value];
    }
    if (value.includes('wall')) {
        return 'wall';
    }
    if (value.includes('door')) {
        return 'door';
    }
    if (value.includes('stair') || value.includes('hatch')) {
        return 'stair';
    }
    if (value.includes('portal') || value.startsWith('enter_') || value.startsWith('exit_')) {
        return 'portal';
    }
    if (value.includes('altar')) {
        return 'altar';
    }
    if (value.includes('statue') || value === 'orcish_idol') {
        return 'statue';
    }
    return value || null;
}

function kindsForCell(cell) {
    if (cell == null || cell === ' ') {
        return [];
    }
    if (typeof cell === 'string') {
        const kind = normalizeTerrainKind(cell);
        return kind ? [kind] : [];
    }
    if (Array.isArray(cell)) {
        if (cell.some(kind => ['unknown', 'void', 'unseen', 'transparent']
            .includes(String(kind).trim().toLowerCase()))) {
            return [];
        }
        return unique(cell.map(normalizeTerrainKind).filter(Boolean));
    }

    if (cell.unconstrained || CELL_KIND_CACHE.has(cell)) {
        return cell.unconstrained ? [] : CELL_KIND_CACHE.get(cell);
    }

    const rawKinds = cell.kinds ?? cell.terrainKinds ?? cell.possibleKinds
        ?? cell.kind ?? cell.terrain;
    const values = Array.isArray(rawKinds) ? rawKinds : [rawKinds];
    if (values.some(kind => ['unknown', 'void', 'unseen', 'transparent']
        .includes(String(kind).trim().toLowerCase()))) {
        CELL_KIND_CACHE.set(cell, []);
        return [];
    }
    const kinds = unique(values.map(normalizeTerrainKind).filter(Boolean));
    CELL_KIND_CACHE.set(cell, kinds);
    return kinds;
}

function normalizedTerrainWeight(kind) {
    return KIND_WEIGHTS[kind] || 1;
}

function evenlySample(points, limit) {
    if (points.length <= limit) {
        return points;
    }
    const sampled = [];
    for (let index = 0; index < limit; index++) {
        const sourceIndex = Math.floor((index + 0.5) * points.length / limit);
        sampled.push(points[Math.min(points.length - 1, sourceIndex)]);
    }
    return sampled;
}

function tagSet(template) {
    const tags = template?.metadata?.tags ?? template?.tags ?? [];
    if (tags instanceof Set) {
        return tags;
    }
    if (Array.isArray(tags)) {
        return new Set(tags);
    }
    return new Set(String(tags || '').split(/\s+/).filter(Boolean));
}

function templateGrid(template) {
    return template.grid || template.cells || [];
}

function templateSize(template) {
    const grid = templateGrid(template);
    return {
        width: template.width ?? Math.max(0, ...grid.map(row => row?.length || 0)),
        height: template.height ?? grid.length
    };
}

function normalizedKindList(value) {
    let values;
    if (value instanceof Set || Array.isArray(value)) {
        values = [...value];
    } else {
        values = String(value || '').split(/[\s,]+/u);
    }
    return unique(values.map(normalizeTerrainKind).filter(Boolean)).sort();
}

function stricterMinimum(globalValue, templateValue) {
    const local = Number(templateValue);
    return Number.isFinite(local) ? Math.max(globalValue, local) : globalValue;
}

function effectiveMatchPolicy(template, options) {
    const raw = template?.metadata?.matchPolicy;
    const templateSpecified = Boolean(raw && typeof raw === 'object');
    const policy = templateSpecified ? raw : {};
    const requiredKinds = unique([
        ...options.requiredKinds,
        ...normalizedKindList(policy.requiredKinds)
    ]).sort();
    const configuredFocusMargin = Number(policy.focusMargin);
    const focusMargin = Number.isFinite(configuredFocusMargin)
        ? Math.max(0, configuredFocusMargin)
        : 0;
    const requireFocusInFootprint = policy.requireFocusInFootprint === true;
    const configuredPlausibleSlack = Number(policy.plausibleSlack);
    const plausibleSlack = Number.isFinite(configuredPlausibleSlack)
        ? Math.max(options.candidateSlack, configuredPlausibleSlack, 0)
        : options.candidateSlack;
    const minScore = stricterMinimum(options.minScore, policy.minScore);
    const configuredPlausibleMinScore = Number(policy.plausibleMinScore);
    const plausibleMinScore = Number.isFinite(configuredPlausibleMinScore)
        ? Math.min(minScore, Math.max(0, configuredPlausibleMinScore))
        : minScore;
    return {
        minScore,
        // A high confidence threshold is appropriate for accepting a winner,
        // while a slightly damaged true placement still has to participate in
        // world-space consensus. Families may opt into a wider, lower-scoring
        // plausible set without weakening the winning candidate threshold.
        plausibleSlack,
        plausibleMinScore,
        minEvidenceCells: stricterMinimum(
            options.minEvidenceCells,
            policy.minEvidenceCells
        ),
        minEvidenceWeight: stricterMinimum(
            options.minEvidenceWeight,
            policy.minEvidenceWeight
        ),
        minDistinctKinds: stricterMinimum(
            options.minDistinctKinds,
            policy.minDistinctKinds
        ),
        minCoverage: stricterMinimum(options.minCoverage, policy.minCoverage),
        minSpanXRatio: stricterMinimum(options.minSpanXRatio, policy.minSpanXRatio),
        minSpanYRatio: stricterMinimum(options.minSpanYRatio, policy.minSpanYRatio),
        requiredKinds,
        requireFocusInFootprint,
        focusMargin,
        // Some audited layouts have a fixed Crawl placement rule but no
        // player-entry glyph. For those layouts, enumerate every possible
        // translation of every legal transform instead of using the bounded
        // terrain-anchor heuristic. This makes both normal and explicit
        // force-reveal diagnostics include the real placement.
        exhaustivePlacement: policy.exhaustivePlacement === true,
        // Some source families are useful to catalogue and diagnose but do
        // not yet have a complete placement proof. Keep matching them for
        // debug visibility while making reveal fail closed.
        revealDisabled: policy.revealDisabled === true,
        // A detection-only negative candidate must also be ineligible for
        // the explicit unsafe override. Otherwise an unsupported full map
        // can win correctly and still inject its deliberately coarse grid.
        forceRevealDisabled: policy.forceRevealDisabled === true,
        enforceInPlausible: templateSpecified
            || options.minCoverage > 0
            || options.minSpanXRatio > 0
            || options.minSpanYRatio > 0
            || options.requiredKinds.length > 0
            || requireFocusInFootprint
    };
}

function matrixKey(a, b, c, d) {
    return `${a},${b},${c},${d}`;
}

function multiplyTransform(left, right) {
    return {
        a: left.a * right.a + left.b * right.c,
        b: left.a * right.b + left.b * right.d,
        c: left.c * right.a + left.d * right.c,
        d: left.c * right.b + left.d * right.d
    };
}

function composeTransform(rotation, mirrorX, mirrorY) {
    let matrix = {a: 1, b: 0, c: 0, d: 1};
    if (mirrorX) {
        matrix = multiplyTransform({a: -1, b: 0, c: 0, d: 1}, matrix);
    }
    if (mirrorY) {
        matrix = multiplyTransform({a: 1, b: 0, c: 0, d: -1}, matrix);
    }
    if (rotation === 1) {
        matrix = multiplyTransform({a: 0, b: -1, c: 1, d: 0}, matrix);
    } else if (rotation === -1) {
        matrix = multiplyTransform({a: 0, b: 1, c: -1, d: 0}, matrix);
    }
    return matrix;
}

function transformBounds(matrix, width, height) {
    const corners = [
        [0, 0],
        [Math.max(0, width - 1), 0],
        [0, Math.max(0, height - 1)],
        [Math.max(0, width - 1), Math.max(0, height - 1)]
    ].map(([x, y]) => ({
        x: matrix.a * x + matrix.b * y,
        y: matrix.c * x + matrix.d * y
    }));
    const minX = Math.min(...corners.map(point => point.x));
    const minY = Math.min(...corners.map(point => point.y));
    const maxX = Math.max(...corners.map(point => point.x));
    const maxY = Math.max(...corners.map(point => point.y));
    return {
        minX,
        minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

export function allowedTransforms(template) {
    const tags = tagSet(template);
    const {width, height} = templateSize(template);
    // Crawl mirrors independently, then optionally rotates exactly once by
    // either +90 or -90 degrees. Rotation also requires both original map
    // dimensions to fit GMINM (70), even when the rotated result itself would
    // fit the 80x70 level. It never applies a standalone 180-degree rotation
    // when both mirrors are forbidden.
    const canRotate = !tags.has('no_rotate')
        && width <= CRAWL_ROTATION_LIMIT
        && height <= CRAWL_ROTATION_LIMIT;
    const rotations = canRotate ? [0, 1, -1] : [0];
    const horizontalMirrors = tags.has('no_hmirror') ? [false] : [false, true];
    const verticalMirrors = tags.has('no_vmirror') ? [false] : [false, true];
    const seen = new Set();
    const result = [];

    for (const rotation of rotations) {
        for (const mirrorX of horizontalMirrors) {
            for (const mirrorY of verticalMirrors) {
                const matrix = composeTransform(rotation, mirrorX, mirrorY);
                const key = matrixKey(matrix.a, matrix.b, matrix.c, matrix.d);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                result.push({
                    id: `r${rotation * 90}${mirrorX ? 'h' : ''}${mirrorY ? 'v' : ''}`,
                    ...matrix
                });
            }
        }
    }
    return result;
}

export function transformTemplate(template, transform) {
    const grid = templateGrid(template);
    const {width, height} = templateSize(template);
    const bounds = transformBounds(transform, width, height);
    const transformed = Array.from({length: bounds.height}, () =>
        Array.from({length: bounds.width}, () => null));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tx = transform.a * x + transform.b * y - bounds.minX;
            const ty = transform.c * x + transform.d * y - bounds.minY;
            transformed[ty][tx] = grid[y]?.[x] ?? null;
        }
    }

    return {
        id: transform.id,
        grid: transformed,
        width: bounds.width,
        height: bounds.height
    };
}

function orientation(template) {
    return String(template?.metadata?.orient ?? template?.orient ?? '').toLowerCase();
}

function isEncompass(template) {
    return Boolean(template?.metadata?.encompass) || orientation(template) === 'encompass';
}

const ORIENTATION_VECTORS = {
    north: {x: 0, y: -1},
    south: {x: 0, y: 1},
    east: {x: 1, y: 0},
    west: {x: -1, y: 0},
    northeast: {x: 1, y: -1},
    northwest: {x: -1, y: -1},
    southeast: {x: 1, y: 1},
    southwest: {x: -1, y: 1}
};

const VECTOR_ORIENTATIONS = new Map(Object.entries(ORIENTATION_VECTORS)
    .map(([name, vector]) => [`${vector.x},${vector.y}`, name]));
const NON_DIRECTIONAL_ORIENTATIONS = new Set([
    'encompass',
    'centre',
    'center',
    'float'
]);

function transformedOrientation(template, transform) {
    const orient = isEncompass(template) ? 'encompass' : orientation(template) || 'float';
    const vector = ORIENTATION_VECTORS[orient];
    if (!vector) {
        return NON_DIRECTIONAL_ORIENTATIONS.has(orient) ? orient : null;
    }
    const x = transform.a * vector.x + transform.b * vector.y;
    const y = transform.c * vector.x + transform.d * vector.y;
    return VECTOR_ORIENTATIONS.get(`${x},${y}`) || null;
}

function absolutePlacement(orient, transformed, worldWidth, worldHeight) {
    const centreX = Math.floor((worldWidth - transformed.width) / 2);
    const centreY = Math.floor((worldHeight - transformed.height) / 2);
    if (orient === 'encompass' || orient === 'centre' || orient === 'center') {
        return {x: centreX, y: centreY};
    }

    const placements = {
        north: {x: centreX, y: 0},
        south: {x: centreX, y: worldHeight - transformed.height},
        east: {x: worldWidth - transformed.width, y: centreY},
        west: {x: 0, y: centreY},
        northeast: {x: worldWidth - transformed.width, y: 0},
        northwest: {x: 0, y: 0},
        southeast: {x: worldWidth - transformed.width, y: worldHeight - transformed.height},
        southwest: {x: 0, y: worldHeight - transformed.height}
    };
    return placements[orient] || null;
}

function candidateFootprint(candidate) {
    return {
        minX: candidate.offsetX,
        minY: candidate.offsetY,
        maxX: candidate.offsetX + candidate.transformed.width - 1,
        maxY: candidate.offsetY + candidate.transformed.height - 1
    };
}

function candidateWorldBounds(candidate, worldWidth, worldHeight) {
    const absolute = absolutePlacement(
        candidate.orientation,
        candidate.transformed,
        worldWidth,
        worldHeight
    );
    if (!absolute) {
        return null;
    }
    const minX = candidate.offsetX - absolute.x;
    const minY = candidate.offsetY - absolute.y;
    return {
        minX,
        minY,
        maxX: minX + worldWidth - 1,
        maxY: minY + worldHeight - 1
    };
}

function candidateFitsWorld(candidate, observationBounds, worldWidth, worldHeight) {
    if (candidate.worldBounds) {
        return observationBounds.minX >= candidate.worldBounds.minX
            && observationBounds.maxX <= candidate.worldBounds.maxX
            && observationBounds.minY >= candidate.worldBounds.minY
            && observationBounds.maxY <= candidate.worldBounds.maxY;
    }

    // A floating vault has no fixed absolute origin. It is still impossible
    // if the union of its footprint and known terrain cannot fit anywhere in
    // a single Crawl level. This constraint is translation-invariant, which
    // is required because WebTiles reports coordinates relative to an
    // arbitrary per-level origin.
    const minX = Math.min(candidate.bounds.minX, observationBounds.minX);
    const minY = Math.min(candidate.bounds.minY, observationBounds.minY);
    const maxX = Math.max(candidate.bounds.maxX, observationBounds.maxX);
    const maxY = Math.max(candidate.bounds.maxY, observationBounds.maxY);
    return maxX - minX + 1 <= worldWidth && maxY - minY + 1 <= worldHeight;
}

function cellAt(candidate, worldX, worldY) {
    const encompassBorderFillKind = candidate.template?.metadata
        ?.encompassBorderFillKind || null;
    const withinWorld = candidate.worldBounds
        && worldX >= candidate.worldBounds.minX
        && worldX <= candidate.worldBounds.maxX
        && worldY >= candidate.worldBounds.minY
        && worldY <= candidate.worldBounds.maxY;
    const localX = worldX - candidate.offsetX;
    const localY = worldY - candidate.offsetY;
    if (localX >= 0 && localY >= 0
        && localX < candidate.transformed.width
        && localY < candidate.transformed.height) {
        const cell = candidate.transformed.grid[localY]?.[localX] ?? null;
        if (cell == null && withinWorld && encompassBorderFillKind) {
            return [encompassBorderFillKind];
        }
        const kinds = kindsForCell(cell);
        if (kinds.length) {
            return kinds;
        }
        // Spaces, CLEAR cells, and short-row padding are deliberately parsed
        // as void. Encompass controls placement, but does not make those
        // unspecified cells safe to reveal as rock walls.
        return [];
    }
    if (withinWorld && encompassBorderFillKind) {
        return [encompassBorderFillKind];
    }
    return [];
}

function normalizedCompatibility(observed, expectedKinds) {
    if (!observed || expectedKinds.length === 0) {
        return {ignored: true, match: 0, penalty: 0};
    }
    if (expectedKinds.includes(observed)) {
        return {
            ignored: false,
            match: normalizedTerrainWeight(observed),
            penalty: 0
        };
    }

    const expectedOpen = expectedKinds.some(kind => kind !== 'wall' && kind !== 'solid' && kind !== 'statue');
    const observedOpen = observed !== 'wall' && observed !== 'solid' && observed !== 'statue';
    if (observed === 'open' && expectedOpen) {
        return {ignored: false, match: 0.5, penalty: 0};
    }
    if (expectedKinds.includes('open') && observedOpen) {
        return {ignored: false, match: 0.5, penalty: 0};
    }

    // Doors may have been opened and diggable walls may have been removed.
    if (observed === 'floor' && expectedKinds.includes('door')) {
        return {ignored: false, match: 0.25, penalty: 0.25};
    }
    if (observedOpen && expectedKinds.includes('wall')) {
        return {ignored: false, match: 0, penalty: 0.75};
    }
    if (observed === 'wall' && expectedOpen) {
        return {ignored: false, match: 0, penalty: 2};
    }
    return {
        ignored: false,
        match: 0,
        penalty: Math.max(1, normalizedTerrainWeight(observed))
    };
}

function focusMatchesCandidate(candidate, focusPosition) {
    if (!candidate.matchPolicy.requireFocusInFootprint) {
        return true;
    }
    if (!focusPosition) {
        return false;
    }
    const margin = candidate.matchPolicy.focusMargin;
    return focusPosition.x >= candidate.bounds.minX - margin
        && focusPosition.x <= candidate.bounds.maxX + margin
        && focusPosition.y >= candidate.bounds.minY - margin
        && focusPosition.y <= candidate.bounds.maxY + margin;
}

function candidateScore(candidate, observationContext, focusPosition) {
    let matchWeight = 0;
    let penaltyWeight = 0;
    let evidenceCells = 0;
    let minEvidenceX = Infinity;
    let minEvidenceY = Infinity;
    let maxEvidenceX = -Infinity;
    let maxEvidenceY = -Infinity;
    const observedKinds = new Set();

    // A partial vault is normally much smaller than the level observation
    // set. In that case, walk its pre-indexed constrained cells and look up
    // observations by row. For sparse early-game evidence or an encompass
    // map, retaining the forward scan avoids walking a larger footprint.
    if (candidate.constrainedCells <= observationContext.observations.length) {
        for (const scoringRow of candidate.scoringRows) {
            const worldY = candidate.offsetY + scoringRow.y;
            const observationRow = observationContext.byY.get(worldY);
            if (!observationRow) {
                continue;
            }
            for (const scoringCell of scoringRow.cells) {
                const worldX = candidate.offsetX + scoringCell.x;
                const observation = observationRow.get(worldX);
                if (!observation) {
                    continue;
                }
                const result = normalizedCompatibility(
                    observation.kind,
                    scoringCell.kinds
                );
                if (result.ignored) {
                    continue;
                }
                evidenceCells++;
                observedKinds.add(observation.kind);
                minEvidenceX = Math.min(minEvidenceX, worldX);
                minEvidenceY = Math.min(minEvidenceY, worldY);
                maxEvidenceX = Math.max(maxEvidenceX, worldX);
                maxEvidenceY = Math.max(maxEvidenceY, worldY);
                matchWeight += result.match;
                penaltyWeight += result.penalty;
            }
        }
    } else {
        for (const observation of observationContext.observations) {
            const expectedKinds = cellAt(candidate, observation.x, observation.y);
            const result = normalizedCompatibility(
                observation.kind,
                expectedKinds
            );
            if (result.ignored) {
                continue;
            }
            evidenceCells++;
            observedKinds.add(observation.kind);
            minEvidenceX = Math.min(minEvidenceX, observation.x);
            minEvidenceY = Math.min(minEvidenceY, observation.y);
            maxEvidenceX = Math.max(maxEvidenceX, observation.x);
            maxEvidenceY = Math.max(maxEvidenceY, observation.y);
            matchWeight += result.match;
            penaltyWeight += result.penalty;
        }
    }

    const evidenceWeight = matchWeight + penaltyWeight;
    const spanX = evidenceCells ? maxEvidenceX - minEvidenceX + 1 : 0;
    const spanY = evidenceCells ? maxEvidenceY - minEvidenceY + 1 : 0;
    const sortedObservedKinds = [...observedKinds].filter(Boolean).sort();
    const requiredKindsReady = candidate.matchPolicy.requiredKinds
        .every(kind => observedKinds.has(kind));
    const {scoringRows, ...publicCandidate} = candidate;
    return {
        ...publicCandidate,
        matchWeight,
        penaltyWeight,
        evidenceWeight,
        evidenceCells,
        distinctKinds: sortedObservedKinds.length,
        observedKinds: sortedObservedKinds,
        constrainedCells: candidate.constrainedCells,
        predictableCells: candidate.predictableCells,
        coverage: candidate.constrainedCells
            ? evidenceCells / candidate.constrainedCells
            : 0,
        spanX,
        spanY,
        spanXRatio: candidate.transformed.width
            ? spanX / candidate.transformed.width
            : 0,
        spanYRatio: candidate.transformed.height
            ? spanY / candidate.transformed.height
            : 0,
        requiredKindsReady,
        focusReady: focusMatchesCandidate(candidate, focusPosition),
        score: evidenceWeight ? matchWeight / evidenceWeight : 0
    };
}

function transformedCellStats(transformed) {
    let constrainedCells = 0;
    let predictableCells = 0;
    const scoringRows = [];
    const flatScoringCells = [];
    for (let y = 0; y < transformed.height; y++) {
        const scoringCells = [];
        for (let x = 0; x < transformed.width; x++) {
            const cell = transformed.grid[y]?.[x];
            const kinds = kindsForCell(cell);
            if (kinds.length) {
                constrainedCells++;
                const scoringCell = {x, kinds};
                scoringCells.push(scoringCell);
                flatScoringCells.push({x, y, kinds});
            }
            if (kinds.length === 1) {
                predictableCells++;
            }
        }
        if (scoringCells.length) {
            scoringRows.push({y, cells: scoringCells});
        }
    }
    return {
        constrainedCells,
        predictableCells,
        scoringRows,
        flatScoringCells
    };
}

function templateAnchors(transformed, options) {
    const anchors = new Map();
    for (let y = 0; y < transformed.height; y++) {
        for (let x = 0; x < transformed.width; x++) {
            const kinds = kindsForCell(transformed.grid[y]?.[x]);
            for (const kind of kinds) {
                const points = anchors.get(kind) || [];
                points.push({x, y});
                anchors.set(kind, points);
            }
        }
    }
    for (const [kind, points] of anchors) {
        anchors.set(
            kind,
            evenlySample(points, options.maxTemplateAnchorsPerKind)
        );
    }
    return anchors;
}

function transformedSourcePoint(transform, template, point) {
    const {width, height} = templateSize(template);
    const bounds = transformBounds(transform, width, height);
    return {
        x: transform.a * point.x + transform.b * point.y - bounds.minX,
        y: transform.c * point.x + transform.d * point.y - bounds.minY
    };
}

function matchAnchorPlacements(template, transformed, transform, composite) {
    const anchor = template?.metadata?.matchAnchor;
    if (anchor == null) {
        return null;
    }
    if (typeof anchor !== 'object'
        || !Number.isInteger(anchor.x)
        || !Number.isInteger(anchor.y)) {
        return [];
    }
    const glyphs = new Set([
        ...(typeof anchor.glyph === 'string' && anchor.glyph.length
            ? [anchor.glyph]
            : []),
        ...(Array.isArray(anchor.glyphs)
            ? anchor.glyphs.filter(glyph =>
                typeof glyph === 'string' && glyph.length)
            : [])
    ]);
    if (!glyphs.size) {
        return [];
    }
    const shellGlyphs = Array.isArray(composite?.shellEntryAnchorGlyphs)
        ? new Set(composite.shellEntryAnchorGlyphs)
        : glyphs;

    const placements = new Map();
    for (let y = 0; y < transformed.height; y++) {
        for (let x = 0; x < transformed.width; x++) {
            const cell = transformed.grid[y]?.[x];
            if (!cell || typeof cell !== 'object') {
                continue;
            }
            if (!cellHasAnyGlyph(cell, shellGlyphs)) {
                continue;
            }
            const placement = {x: anchor.x - x, y: anchor.y - y};
            placements.set(`${placement.x},${placement.y}`, placement);
        }
    }
    // A composite's arriving hatch can live inside one of its registered
    // subvaults rather than in the master shell. prepareComposite enumerates
    // those points over every legal child mirror, so they are just as
    // exhaustive as a literal glyph in the shell. Convert the original
    // master coordinates through the selected parent transform here.
    for (const point of composite?.entryAnchorPoints || []) {
        if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) {
            continue;
        }
        const transformedPoint = transformedSourcePoint(
            transform,
            template,
            point
        );
        const placement = {
            x: anchor.x - transformedPoint.x,
            y: anchor.y - transformedPoint.y
        };
        placements.set(`${placement.x},${placement.y}`, placement);
    }
    return [...placements.values()];
}

function matchAnchorRequiredKind(template) {
    const kind = template?.metadata?.matchAnchor?.requireObservedKind;
    return normalizeTerrainKind(kind);
}

function buildObservationContext(observations, options) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const byY = new Map();
    for (const observation of observations) {
        minX = Math.min(minX, observation.x);
        minY = Math.min(minY, observation.y);
        maxX = Math.max(maxX, observation.x);
        maxY = Math.max(maxY, observation.y);
        let row = byY.get(observation.y);
        if (!row) {
            row = new Map();
            byY.set(observation.y, row);
        }
        row.set(observation.x, observation);
    }
    const anchorObservations = observations
        .filter(cell => cell.kind)
        .sort((left, right) => normalizedTerrainWeight(right.kind)
            - normalizedTerrainWeight(left.kind))
        .slice(0, options.maxAnchorObservations);
    return {
        observations,
        byY,
        anchorObservations,
        bounds: {minX, minY, maxX, maxY}
    };
}

function placementCandidates(prepared, anchorObservations, options) {
    const offsets = new Map();
    const priorityOffsets = new Set();

    for (const observation of anchorObservations) {
        const kind = observation.kind;
        const weight = normalizedTerrainWeight(kind);
        const points = prepared.anchorsByKind.get(kind) || [];
        const priorityKind = weight >= 4
            && points.length <= options.maxPriorityAnchorsPerKind;
        for (const point of points) {
            const offsetX = observation.x - point.x;
            const offsetY = observation.y - point.y;
            const key = `${offsetX},${offsetY}`;
            offsets.set(key, (offsets.get(key) || 0) + weight);
            if (priorityKind) {
                priorityOffsets.add(key);
            }
        }
    }

    const ranked = [...offsets.entries()]
        .sort((left, right) => right[1] - left[1]);
    const selected = ranked.slice(0, options.maxPlacementsPerTransform);
    const selectedKeys = new Set(selected.map(([key]) => key));
    for (const entry of ranked) {
        if (selected.length >= options.maxPlacementsPerTransform
            + options.maxPriorityPlacementsPerTransform) {
            break;
        }
        if (priorityOffsets.has(entry[0]) && !selectedKeys.has(entry[0])) {
            selected.push(entry);
            selectedKeys.add(entry[0]);
        }
    }

    return selected
        .map(([key]) => {
            const [x, y] = key.split(',').map(Number);
            return {x, y};
        });
}

function exhaustivePlacementRange(prepared, observationBounds, options) {
    const absolute = absolutePlacement(
        prepared.orientation,
        prepared.transformed,
        options.worldWidth,
        options.worldHeight
    );
    let minX;
    let maxX;
    let minY;
    let maxY;

    if (absolute) {
        // WebTiles coordinates differ from Crawl's internal level coordinates
        // by one unknown translation. The observed bounding box constrains
        // the internal level origin to these inclusive ranges. Adding the
        // layout's fixed ORIENT placement enumerates every legal world-space
        // offset exactly.
        minX = observationBounds.maxX - options.worldWidth + 1 + absolute.x;
        maxX = observationBounds.minX + absolute.x;
        minY = observationBounds.maxY - options.worldHeight + 1 + absolute.y;
        maxY = observationBounds.minY + absolute.y;
    } else {
        // A floating vault may occupy any position for which its footprint
        // and all observations still fit in one Crawl level. This is a safe
        // superset of Crawl's border/docking rules and is exhaustive in the
        // relative WebTiles coordinate space.
        minX = observationBounds.maxX - options.worldWidth + 1;
        maxX = observationBounds.minX
            + options.worldWidth - prepared.transformed.width;
        minY = observationBounds.maxY - options.worldHeight + 1;
        maxY = observationBounds.minY
            + options.worldHeight - prepared.transformed.height;
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: Math.max(0, maxX - minX + 1),
        height: Math.max(0, maxY - minY + 1)
    };
}

function exhaustivePlacementCandidates(prepared, observationBounds, options) {
    const range = exhaustivePlacementRange(
        prepared,
        observationBounds,
        options
    );
    const placements = [];
    for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
            placements.push({x, y});
        }
    }
    return placements;
}

function compositeSubvaultOptionsForSlot(variant, slot) {
    const candidates = [];
    for (const transform of allowedTransforms(variant)) {
        // resolve_subvault rotates a child exactly when the transposed child
        // dimensions fit the registered mask. Non-square Vaults/Tomb slots
        // naturally reject those variants below, while the 13x14 Hall of
        // Blades entries must rotate to fit its 14x13 east-facing slot.
        const transformed = transformTemplate(variant, transform);
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
        candidates.push({
            id: `${variant.name}:${transform.id}`,
            name: variant.name,
            roles: [...variant.roles],
            grid: transformed.grid,
            entryAnchorPoints: Array.isArray(variant.entryAnchorPoints)
                ? variant.entryAnchorPoints.map(point =>
                    transformedSourcePoint(transform, variant, point))
                : [],
            transform: transform.id,
            mismatch
        });
    }
    const minimum = Math.min(...candidates.map(candidate => candidate.mismatch));
    return candidates.filter(candidate => candidate.mismatch === minimum)
        .map(candidate => {
            let constrainedCells = 0;
            let predictableCells = 0;
            for (let y = 0; y < slot.height; y++) {
                for (let x = 0; x < slot.width; x++) {
                    if (!slot.mask[y]?.[x]) {
                        continue;
                    }
                    const cell = candidate.grid[y]?.[x];
                    const kinds = cell == null
                        ? (Array.isArray(slot.emptyKinds)
                            ? normalizedKindList(slot.emptyKinds)
                            : ['floor'])
                        : kindsForCell(cell);
                    if (kinds.length) {
                        constrainedCells++;
                    }
                    if (kinds.length === 1) {
                        predictableCells++;
                    }
                }
            }
            return {...candidate, constrainedCells, predictableCells};
        });
}

function cellHasAnyGlyph(cell, glyphs) {
    if (!cell || typeof cell !== 'object') {
        return false;
    }
    const finalGlyphs = Array.isArray(cell.possibleGlyphs)
        ? cell.possibleGlyphs
        : [cell.glyph];
    return finalGlyphs.some(glyph => glyphs.has(glyph));
}

function compositeEntryAnchorPoints(slots, shellPoints = []) {
    const points = new Map();
    for (const point of shellPoints) {
        if (Number.isInteger(point?.x) && Number.isInteger(point?.y)) {
            points.set(`${point.x},${point.y}`, {x: point.x, y: point.y});
        }
    }
    for (const slot of slots) {
        const glyphs = new Set(Array.isArray(slot.entryAnchorGlyphs)
            ? slot.entryAnchorGlyphs.filter(glyph =>
                typeof glyph === 'string' && glyph.length)
            : []);
        if (!glyphs.size) {
            continue;
        }
        for (const variant of slot.variants) {
            for (const point of variant.entryAnchorPoints || []) {
                if (!Number.isInteger(point?.x)
                    || !Number.isInteger(point?.y)
                    || !slot.mask[point.y]?.[point.x]) {
                    continue;
                }
                const sourcePoint = {x: slot.x + point.x, y: slot.y + point.y};
                points.set(
                    `${sourcePoint.x},${sourcePoint.y}`,
                    sourcePoint
                );
            }
            for (let y = 0; y < slot.height; y++) {
                for (let x = 0; x < slot.width; x++) {
                    if (!slot.mask[y]?.[x]
                        || !cellHasAnyGlyph(variant.grid[y]?.[x], glyphs)) {
                        continue;
                    }
                    const point = {x: slot.x + x, y: slot.y + y};
                    points.set(`${point.x},${point.y}`, point);
                }
            }
        }
    }
    return [...points.values()];
}

function prepareComposite(template, options) {
    const composite = template?.metadata?.composite;
    const vaultsComposite = composite?.type === 'vaults-end-quadrants-v1';
    const fixedComposite = composite?.type === 'fixed-subvaults-v1';
    if (!composite || (!vaultsComposite && !fixedComposite)
        || !Array.isArray(composite.slots)
        || (vaultsComposite && composite.slots.length !== 4)
        || !Array.isArray(composite.variants)
        || (composite.slots.length > 0 && !composite.variants.length)
        || (vaultsComposite && (!Array.isArray(composite.regimes)
            || !composite.regimes.length))) {
        return composite ? null : undefined;
    }
    const variantPolicy = effectiveMatchPolicy({
        metadata: {matchPolicy: composite.variantPolicy || {}}
    }, options);
    const slots = composite.slots.map(slot => {
        if (!slot || !Array.isArray(slot.mask)
            || slot.mask.length !== slot.height
            || slot.mask.some(row =>
                !Array.isArray(row) || row.length !== slot.width)) {
            return null;
        }
        const variants = composite.variants.flatMap(variant => {
            if (!variant || !Array.isArray(variant.grid)
                || !((variant.width === slot.width
                        && variant.height === slot.height)
                    || (variant.width === slot.height
                        && variant.height === slot.width))
                || !Array.isArray(variant.roles)
                || !variant.roles.length) {
                return [];
            }
            return compositeSubvaultOptionsForSlot(variant, slot);
        });
        return variants.length ? {
            ...slot,
            variants,
            emptyKinds: Array.isArray(slot.emptyKinds)
                ? normalizedKindList(slot.emptyKinds)
                : ['floor'],
            entryAnchorGlyphs: Array.isArray(slot.entryAnchorGlyphs)
                ? [...slot.entryAnchorGlyphs]
                : []
        } : null;
    });
    if (slots.some(slot => !slot)) {
        return null;
    }
    const availableRoles = new Set(slots.flatMap(slot =>
        slot.variants.flatMap(variant => variant.roles)));
    if (vaultsComposite && composite.regimes.some(regime =>
        !availableRoles.has(regime.prizeRole)
        || !availableRoles.has(regime.regularRole))) {
        return null;
    }
    if (fixedComposite && slots.some(slot =>
        typeof slot.role !== 'string'
        || !slot.role
        || !availableRoles.has(slot.role)
        || !slot.variants.some(variant => variant.roles.includes(slot.role)))) {
        return null;
    }
    return {
        type: composite.type,
        slots,
        regimes: vaultsComposite
            ? composite.regimes.map(regime => ({...regime}))
            : [],
        borderFillKind: normalizeTerrainKind(composite.borderFillKind),
        variantPolicy,
        entryAnchorPoints: compositeEntryAnchorPoints(
            slots,
            Array.isArray(composite.entryAnchorPoints)
                ? composite.entryAnchorPoints
                : []
        ),
        shellEntryAnchorGlyphs:
            Array.isArray(composite.shellEntryAnchorGlyphs)
                ? [...composite.shellEntryAnchorGlyphs]
                : null
    };
}

function prepareTemplates(templates, options) {
    const prepared = [];
    templates.forEach((template, templateIndex) => {
        const composite = prepareComposite(template, options);
        if (composite === null) {
            return;
        }
        for (const transform of allowedTransforms(template)) {
            const transformed = transformTemplate(template, transform);
            const effectiveOrientation = transformedOrientation(template, transform);
            if (transformed.width > options.worldWidth
                || transformed.height > options.worldHeight
                || !effectiveOrientation) {
                continue;
            }
            const cellStats = transformedCellStats(transformed);
            prepared.push({
                template,
                templateIndex,
                transform,
                transformed,
                sourceBounds: transformBounds(
                    transform,
                    templateSize(template).width,
                    templateSize(template).height
                ),
                orientation: effectiveOrientation,
                anchorsByKind: templateAnchors(transformed, options),
                matchAnchorPlacements: matchAnchorPlacements(
                    template,
                    transformed,
                    transform,
                    composite
                ),
                matchAnchorRequiredKind: matchAnchorRequiredKind(template),
                matchPolicy: effectiveMatchPolicy(template, options),
                composite,
                ...cellStats
            });
        }
    });
    return prepared;
}

function buildCandidate(prepared, placement, placementSearch, options) {
    const {
        template,
        templateIndex,
        transform,
        transformed,
        sourceBounds,
        orientation: effectiveOrientation,
        matchPolicy,
        constrainedCells,
        predictableCells,
        scoringRows,
        composite
    } = prepared;
    const candidate = {
        id: `${template.name || templateIndex}:${transform.id}:${placement.x},${placement.y}`,
        template,
        templateIndex,
        transformed,
        transform: transform.id,
        offsetX: placement.x,
        offsetY: placement.y,
        orientation: effectiveOrientation,
        encompass: isEncompass(template),
        placementSearch,
        matchPolicy,
        constrainedCells,
        predictableCells,
        scoringRows,
        ...(composite ? {
            composite,
            sourceTransform: transform,
            sourceBounds
        } : {})
    };
    candidate.bounds = candidateFootprint(candidate);
    candidate.worldBounds = candidateWorldBounds(
        candidate,
        options.worldWidth,
        options.worldHeight
    );
    return candidate;
}

function effectiveAnchorState(prepared, observationContext) {
    const fixedPlacements = prepared.matchAnchorPlacements;
    const requiredKind = prepared.matchAnchorRequiredKind;
    if (fixedPlacements === null
        || fixedPlacements.length === 0
        || !requiredKind) {
        return {fixedPlacements, unverified: false};
    }

    const matchAnchor = prepared.template?.metadata?.matchAnchor;
    const observation = matchAnchor
        ? observationContext.byY.get(matchAnchor.y)?.get(matchAnchor.x)
        : null;
    if (observation?.kind === requiredKind) {
        return {fixedPlacements, unverified: false};
    }

    return {fixedPlacements: null, unverified: true};
}

function buildCandidates(preparedTemplates, observationContext, options) {
    const candidates = [];
    for (const prepared of preparedTemplates) {
        const {matchPolicy} = prepared;
        // A live, natural portal transition gives us a strong entry anchor.
        // Wizard inter-level travel, reconnects, and other exceptional entry
        // paths can instead put the player on an ordinary floor. Do not let
        // that stale/untrusted anchor erase the entire terrain closed set:
        // fall back to an unanchored search, while evaluate() keeps normal
        // reveal fail-closed with `anchor-unverified`.
        const {fixedPlacements: effectiveFixedPlacements} =
            effectiveAnchorState(prepared, observationContext);
        const placements = effectiveFixedPlacements === null
            ? matchPolicy.exhaustivePlacement
                ? exhaustivePlacementCandidates(
                    prepared,
                    observationContext.bounds,
                    options
                )
                : placementCandidates(
                    prepared,
                    observationContext.anchorObservations,
                    options
                )
            : effectiveFixedPlacements;
        for (const placement of placements) {
            const candidate = buildCandidate(
                prepared,
                placement,
                effectiveFixedPlacements !== null
                    ? 'anchor'
                    : matchPolicy.exhaustivePlacement
                        ? 'exhaustive'
                        : 'heuristic',
                options
            );
            if (candidateFitsWorld(
                candidate,
                observationContext.bounds,
                options.worldWidth,
                options.worldHeight
            )) {
                candidates.push(candidate);
            }
        }
    }
    return candidates;
}

function popcount32(value) {
    let bits = value >>> 0;
    bits -= (bits >>> 1) & 0x55555555;
    bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
    return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function correlationBatch(
    prepared,
    observationContext,
    focusPosition,
    options,
    ordinalStart
) {
    const range = exhaustivePlacementRange(
        prepared,
        observationContext.bounds,
        options
    );
    const count = range.width * range.height;
    if (!count) {
        return null;
    }

    const observations = observationContext.observations;
    const observedKinds = unique(observations.map(cell => cell.kind));
    const observedKindIndexes = new Map(observedKinds.map((kind, index) =>
        [kind, index]));
    const signatures = [];
    const signatureIndexes = new Map();
    const cells = prepared.flatScoringCells || [];
    const cellXs = new Uint16Array(cells.length);
    const cellYs = new Uint16Array(cells.length);
    const cellSignatures = new Uint16Array(cells.length);
    cells.forEach((cell, index) => {
        const key = cell.kinds.join('\u0000');
        let signatureIndex = signatureIndexes.get(key);
        if (signatureIndex == null) {
            signatureIndex = signatures.length;
            signatureIndexes.set(key, signatureIndex);
            signatures.push(cell.kinds);
        }
        cellXs[index] = cell.x;
        cellYs[index] = cell.y;
        cellSignatures[index] = signatureIndex;
    });

    const compatibilityWidth = observedKinds.length;
    const compatibilityMatches = new Float64Array(
        signatures.length * compatibilityWidth
    );
    const compatibilityPenalties = new Float64Array(
        signatures.length * compatibilityWidth
    );
    signatures.forEach((kinds, signatureIndex) => {
        observedKinds.forEach((kind, kindIndex) => {
            const result = normalizedCompatibility(kind, kinds);
            const compatibilityIndex = signatureIndex * compatibilityWidth
                + kindIndex;
            compatibilityMatches[compatibilityIndex] = result.match;
            compatibilityPenalties[compatibilityIndex] = result.penalty;
        });
    });

    const matchWeights = new Float64Array(count);
    const penaltyWeights = new Float64Array(count);
    const evidenceCells = new Uint32Array(count);
    const needsPolicyMetrics = prepared.matchPolicy.enforceInPlausible;
    const needsKindMasks = needsPolicyMetrics
        && (prepared.matchPolicy.minDistinctKinds > 0
            || prepared.matchPolicy.requiredKinds.length > 0);
    const kindMasks = needsKindMasks
        ? Array.from(
            {length: Math.ceil(observedKinds.length / 32)},
            () => new Uint32Array(count)
        )
        : [];
    const needsSpan = needsPolicyMetrics
        && (prepared.matchPolicy.minSpanXRatio > 0
            || prepared.matchPolicy.minSpanYRatio > 0);
    const minEvidenceXs = needsSpan ? new Int32Array(count) : null;
    const minEvidenceYs = needsSpan ? new Int32Array(count) : null;
    const maxEvidenceXs = needsSpan ? new Int32Array(count) : null;
    const maxEvidenceYs = needsSpan ? new Int32Array(count) : null;
    if (needsSpan) {
        minEvidenceXs.fill(0x7fffffff);
        minEvidenceYs.fill(0x7fffffff);
        maxEvidenceXs.fill(-0x80000000);
        maxEvidenceYs.fill(-0x80000000);
    }

    const rangeWidth = range.width;
    const rangeHeight = range.height;
    const rangeMinX = range.minX;
    const rangeMinY = range.minY;
    for (const observation of observations) {
        const kindIndex = observedKindIndexes.get(observation.kind);
        const kindWord = kindIndex >>> 5;
        const kindBit = 1 << (kindIndex & 31);
        const observationX = observation.x;
        const observationY = observation.y;
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
            const offsetColumn = observationX - cellXs[cellIndex] - rangeMinX;
            if (offsetColumn < 0 || offsetColumn >= rangeWidth) {
                continue;
            }
            const offsetRow = observationY - cellYs[cellIndex] - rangeMinY;
            if (offsetRow < 0 || offsetRow >= rangeHeight) {
                continue;
            }
            const placementIndex = offsetRow * rangeWidth + offsetColumn;
            const compatibilityIndex = cellSignatures[cellIndex]
                * compatibilityWidth + kindIndex;
            matchWeights[placementIndex]
                += compatibilityMatches[compatibilityIndex];
            penaltyWeights[placementIndex]
                += compatibilityPenalties[compatibilityIndex];
            evidenceCells[placementIndex]++;
            if (needsKindMasks) {
                kindMasks[kindWord][placementIndex] |= kindBit;
            }
            if (needsSpan) {
                if (observationX < minEvidenceXs[placementIndex]) {
                    minEvidenceXs[placementIndex] = observationX;
                }
                if (observationY < minEvidenceYs[placementIndex]) {
                    minEvidenceYs[placementIndex] = observationY;
                }
                if (observationX > maxEvidenceXs[placementIndex]) {
                    maxEvidenceXs[placementIndex] = observationX;
                }
                if (observationY > maxEvidenceYs[placementIndex]) {
                    maxEvidenceYs[placementIndex] = observationY;
                }
            }
        }
    }

    const requiredKindMasks = [];
    let requiredKindsPossible = true;
    for (const kind of prepared.matchPolicy.requiredKinds) {
        const kindIndex = observedKindIndexes.get(kind);
        if (kindIndex == null) {
            requiredKindsPossible = false;
            break;
        }
        requiredKindMasks.push({
            word: kindIndex >>> 5,
            mask: 1 << (kindIndex & 31)
        });
    }
    const arrays = [
        matchWeights,
        penaltyWeights,
        evidenceCells,
        cellXs,
        cellYs,
        cellSignatures,
        compatibilityMatches,
        compatibilityPenalties,
        ...kindMasks,
        ...(needsSpan ? [
            minEvidenceXs,
            minEvidenceYs,
            maxEvidenceXs,
            maxEvidenceYs
        ] : [])
    ];
    return {
        prepared,
        focusPosition,
        range,
        count,
        ordinalStart,
        matchWeights,
        penaltyWeights,
        evidenceCells,
        observedKinds,
        kindMasks,
        requiredKindMasks,
        requiredKindsPossible,
        minEvidenceXs,
        minEvidenceYs,
        maxEvidenceXs,
        maxEvidenceYs,
        allocatedBytes: arrays.reduce(
            (total, array) => total + array.byteLength,
            0
        )
    };
}

function batchPlacement(batch, index) {
    return {
        x: batch.range.minX + index % batch.range.width,
        y: batch.range.minY + Math.floor(index / batch.range.width)
    };
}

function batchFocusReady(batch, index) {
    const policy = batch.prepared.matchPolicy;
    if (!policy.requireFocusInFootprint) {
        return true;
    }
    if (!batch.focusPosition) {
        return false;
    }
    const placement = batchPlacement(batch, index);
    const margin = policy.focusMargin;
    return batch.focusPosition.x >= placement.x - margin
        && batch.focusPosition.x <= placement.x
            + batch.prepared.transformed.width - 1 + margin
        && batch.focusPosition.y >= placement.y - margin
        && batch.focusPosition.y <= placement.y
            + batch.prepared.transformed.height - 1 + margin;
}

function batchDistinctKinds(batch, index) {
    let count = 0;
    for (const mask of batch.kindMasks) {
        count += popcount32(mask[index]);
    }
    return count;
}

function batchRequiredKindsReady(batch, index) {
    return batch.requiredKindsPossible
        && batch.requiredKindMasks.every(({word, mask}) =>
            (batch.kindMasks[word][index] & mask) !== 0);
}

function batchEvidenceReady(batch, index) {
    const policy = batch.prepared.matchPolicy;
    const evidenceCells = batch.evidenceCells[index];
    const matchWeight = batch.matchWeights[index];
    const penaltyWeight = batch.penaltyWeights[index];
    const evidenceWeight = matchWeight + penaltyWeight;
    if (evidenceCells < policy.minEvidenceCells
        || evidenceWeight < policy.minEvidenceWeight
        || (batch.prepared.constrainedCells
            ? evidenceCells / batch.prepared.constrainedCells
            : 0) < policy.minCoverage
        || !batchFocusReady(batch, index)) {
        return false;
    }
    if (batch.kindMasks.length
        && (batchDistinctKinds(batch, index) < policy.minDistinctKinds
            || !batchRequiredKindsReady(batch, index))) {
        return false;
    }
    if (batch.minEvidenceXs) {
        const spanX = evidenceCells
            ? batch.maxEvidenceXs[index] - batch.minEvidenceXs[index] + 1
            : 0;
        const spanY = evidenceCells
            ? batch.maxEvidenceYs[index] - batch.minEvidenceYs[index] + 1
            : 0;
        if (spanX / batch.prepared.transformed.width < policy.minSpanXRatio
            || spanY / batch.prepared.transformed.height
                < policy.minSpanYRatio) {
            return false;
        }
    }
    return true;
}

function compareReferences(left, right) {
    return right.score - left.score
        || right.evidenceWeight - left.evidenceWeight
        || left.penaltyWeight - right.penaltyWeight
        || left.ordinal - right.ordinal;
}

function materializeReference(
    reference,
    observationContext,
    focusPosition,
    options
) {
    if (reference.candidate) {
        return reference.candidate;
    }
    const candidate = buildCandidate(
        reference.batch.prepared,
        batchPlacement(reference.batch, reference.index),
        'exhaustive',
        options
    );
    return candidateScore(candidate, observationContext, focusPosition);
}

function insertTopReference(references, reference, limit) {
    if (limit <= 0) {
        return;
    }
    let index = references.length;
    while (index > 0
        && compareReferences(reference, references[index - 1]) < 0) {
        index--;
    }
    if (index >= limit) {
        return;
    }
    references.splice(index, 0, reference);
    if (references.length > limit) {
        references.pop();
    }
}

function scoreCandidateSpace(
    preparedTemplates,
    observationContext,
    focusPosition,
    options
) {
    const references = [];
    const batches = [];
    let ordinal = 0;
    let exhaustiveOffsets = 0;
    let correlationBytes = 0;
    for (const prepared of preparedTemplates) {
        const {fixedPlacements} = effectiveAnchorState(
            prepared,
            observationContext
        );
        if (fixedPlacements === null
            && prepared.matchPolicy.exhaustivePlacement) {
            const batch = correlationBatch(
                prepared,
                observationContext,
                focusPosition,
                options,
                ordinal
            );
            if (batch) {
                batches.push(batch);
                ordinal += batch.count;
                exhaustiveOffsets += batch.count;
                correlationBytes += batch.allocatedBytes;
            }
            continue;
        }
        const placements = fixedPlacements === null
            ? placementCandidates(
                prepared,
                observationContext.anchorObservations,
                options
            )
            : fixedPlacements;
        const placementSearch = fixedPlacements !== null
            ? 'anchor'
            : 'heuristic';
        for (const placement of placements) {
            const candidate = buildCandidate(
                prepared,
                placement,
                placementSearch,
                options
            );
            if (!candidateFitsWorld(
                candidate,
                observationContext.bounds,
                options.worldWidth,
                options.worldHeight
            )) {
                continue;
            }
            references.push({
                candidate: candidateScore(
                    candidate,
                    observationContext,
                    focusPosition
                ),
                ordinal
            });
            const reference = references[references.length - 1];
            reference.score = reference.candidate.score;
            reference.matchWeight = reference.candidate.matchWeight;
            reference.penaltyWeight = reference.candidate.penaltyWeight;
            reference.evidenceWeight = reference.candidate.evidenceWeight;
            reference.evidenceCells = reference.candidate.evidenceCells;
            ordinal++;
        }
    }

    let bestReference = null;
    let secondReference = null;
    const consider = reference => {
        if (!bestReference || compareReferences(reference, bestReference) < 0) {
            secondReference = bestReference;
            bestReference = reference;
        } else if (!secondReference
            || compareReferences(reference, secondReference) < 0) {
            secondReference = reference;
        }
    };
    references.forEach(consider);
    for (const batch of batches) {
        for (let index = 0; index < batch.count; index++) {
            const ordinal = batch.ordinalStart + index;
            const matchWeight = batch.matchWeights[index];
            const penaltyWeight = batch.penaltyWeights[index];
            const evidenceWeight = matchWeight + penaltyWeight;
            const score = evidenceWeight
                ? matchWeight / evidenceWeight
                : 0;
            const betterThanBest = !bestReference
                || score > bestReference.score
                || (score === bestReference.score
                    && (evidenceWeight > bestReference.evidenceWeight
                        || (evidenceWeight === bestReference.evidenceWeight
                            && (penaltyWeight < bestReference.penaltyWeight
                                || (penaltyWeight
                                        === bestReference.penaltyWeight
                                    && ordinal < bestReference.ordinal)))));
            if (betterThanBest) {
                secondReference = bestReference;
                bestReference = {
                    batch,
                    index,
                    ordinal,
                    score,
                    matchWeight,
                    penaltyWeight,
                    evidenceWeight,
                    evidenceCells: batch.evidenceCells[index]
                };
            } else if (!secondReference
                || score > secondReference.score
                || (score === secondReference.score
                    && (evidenceWeight > secondReference.evidenceWeight
                        || (evidenceWeight === secondReference.evidenceWeight
                            && (penaltyWeight < secondReference.penaltyWeight
                                || (penaltyWeight
                                        === secondReference.penaltyWeight
                                    && ordinal < secondReference.ordinal)))))) {
                secondReference = {
                    batch,
                    index,
                    ordinal,
                    score,
                    matchWeight,
                    penaltyWeight,
                    evidenceWeight,
                    evidenceCells: batch.evidenceCells[index]
                };
            }
        }
    }
    return {
        references,
        batches,
        bestReference,
        secondReference,
        exhaustiveOffsets,
        correlationBytes
    };
}

function plausibleReference(reference, best, options) {
    const policy = reference.candidate
        ? reference.candidate.matchPolicy
        : reference.batch.prepared.matchPolicy;
    const baseline = reference.score >= policy.plausibleMinScore
        && best.score - reference.score <= policy.plausibleSlack
        && reference.evidenceCells >= options.minEvidenceCells;
    if (!baseline) {
        return false;
    }
    if (reference.candidate) {
        return !reference.candidate.matchPolicy.enforceInPlausible
            || candidateEvidenceReady(reference.candidate);
    }
    return !reference.batch.prepared.matchPolicy.enforceInPlausible
        || batchEvidenceReady(reference.batch, reference.index);
}

function plausibleCandidateSpace(space, best, options) {
    let count = 0;
    const survivors = [];
    const considerReference = reference => {
        if (!plausibleReference(reference, best, options)) {
            return;
        }
        count++;
        insertTopReference(
            survivors,
            reference,
            options.maxConsensusCandidates
        );
    };
    space.references.forEach(considerReference);
    for (const batch of space.batches) {
        for (let index = 0; index < batch.count; index++) {
            const matchWeight = batch.matchWeights[index];
            const penaltyWeight = batch.penaltyWeights[index];
            const evidenceWeight = matchWeight + penaltyWeight;
            const score = evidenceWeight ? matchWeight / evidenceWeight : 0;
            const policy = batch.prepared.matchPolicy;
            if (score < policy.plausibleMinScore
                || best.score - score > policy.plausibleSlack
                || batch.evidenceCells[index] < options.minEvidenceCells
                || (policy.enforceInPlausible
                    && !batchEvidenceReady(batch, index))) {
                continue;
            }
            count++;
            if (options.maxConsensusCandidates <= 0) {
                continue;
            }
            const ordinal = batch.ordinalStart + index;
            const worst = survivors[survivors.length - 1];
            const canEnter = survivors.length
                    < options.maxConsensusCandidates
                || score > worst.score
                || (score === worst.score
                    && (evidenceWeight > worst.evidenceWeight
                        || (evidenceWeight === worst.evidenceWeight
                            && (penaltyWeight < worst.penaltyWeight
                                || (penaltyWeight === worst.penaltyWeight
                                    && ordinal < worst.ordinal)))));
            if (!canEnter) {
                continue;
            }
            insertTopReference(survivors, {
                batch,
                index,
                ordinal,
                score,
                matchWeight,
                penaltyWeight,
                evidenceWeight,
                evidenceCells: batch.evidenceCells[index]
            }, options.maxConsensusCandidates);
        }
    }
    return {count, survivors};
}

function compositeSourcePoint(candidate, worldX, worldY) {
    const transform = candidate.sourceTransform;
    const bounds = candidate.sourceBounds;
    if (!transform || !bounds) {
        return null;
    }
    const transformedX = worldX - candidate.offsetX;
    const transformedY = worldY - candidate.offsetY;
    if (transformedX < 0 || transformedY < 0
        || transformedX >= candidate.transformed.width
        || transformedY >= candidate.transformed.height) {
        return null;
    }
    const x = transformedX + bounds.minX;
    const y = transformedY + bounds.minY;
    const determinant = transform.a * transform.d - transform.b * transform.c;
    if (Math.abs(determinant) !== 1) {
        return null;
    }
    return {
        x: (transform.d * x - transform.b * y) / determinant,
        y: (-transform.c * x + transform.a * y) / determinant
    };
}

function compositeSlotPoint(slot, sourcePoint) {
    const x = sourcePoint.x - slot.x;
    const y = sourcePoint.y - slot.y;
    if (x < 0 || y < 0 || x >= slot.width || y >= slot.height
        || !slot.mask[y]?.[x]) {
        return null;
    }
    return {x, y};
}

function compositeVariantKinds(variant, slotPoint, slot = null) {
    const cell = variant.grid[slotPoint.y]?.[slotPoint.x];
    // SUBVAULT copies only non-space child cells. A child space leaves the
    // parent's A/B/C/D glyph, which the later `SUBST: ABCD = .` turns into
    // floor. An audited dynamic cell is an object with no kinds and must stay
    // unconstrained rather than falling back to floor.
    return cell == null
        ? (Array.isArray(slot?.emptyKinds) ? slot.emptyKinds : ['floor'])
        : kindsForCell(cell);
}

function scoreCompositeVariant(
    variant,
    slot,
    parent,
    observationContext,
    matchPolicy
) {
    let matchWeight = 0;
    let penaltyWeight = 0;
    let evidenceCells = 0;
    let minEvidenceX = Infinity;
    let minEvidenceY = Infinity;
    let maxEvidenceX = -Infinity;
    let maxEvidenceY = -Infinity;
    const observedKinds = new Set();

    for (const observation of observationContext.observations) {
        const sourcePoint = compositeSourcePoint(
            parent,
            observation.x,
            observation.y
        );
        if (!sourcePoint) {
            continue;
        }
        const slotPoint = compositeSlotPoint(slot, sourcePoint);
        if (!slotPoint) {
            continue;
        }
        const result = normalizedCompatibility(
            observation.kind,
            compositeVariantKinds(variant, slotPoint, slot)
        );
        if (result.ignored) {
            continue;
        }
        evidenceCells++;
        observedKinds.add(observation.kind);
        minEvidenceX = Math.min(minEvidenceX, observation.x);
        minEvidenceY = Math.min(minEvidenceY, observation.y);
        maxEvidenceX = Math.max(maxEvidenceX, observation.x);
        maxEvidenceY = Math.max(maxEvidenceY, observation.y);
        matchWeight += result.match;
        penaltyWeight += result.penalty;
    }

    const evidenceWeight = matchWeight + penaltyWeight;
    const spanX = evidenceCells ? maxEvidenceX - minEvidenceX + 1 : 0;
    const spanY = evidenceCells ? maxEvidenceY - minEvidenceY + 1 : 0;
    const sortedObservedKinds = [...observedKinds].filter(Boolean).sort();
    return {
        id: variant.id,
        variant,
        matchPolicy,
        matchWeight,
        penaltyWeight,
        evidenceWeight,
        evidenceCells,
        distinctKinds: sortedObservedKinds.length,
        observedKinds: sortedObservedKinds,
        constrainedCells: variant.constrainedCells,
        predictableCells: variant.predictableCells,
        coverage: variant.constrainedCells
            ? evidenceCells / variant.constrainedCells
            : 0,
        spanX,
        spanY,
        spanXRatio: slot.width ? spanX / slot.width : 0,
        spanYRatio: slot.height ? spanY / slot.height : 0,
        requiredKindsReady: matchPolicy.requiredKinds
            .every(kind => observedKinds.has(kind)),
        focusReady: true,
        score: evidenceWeight ? matchWeight / evidenceWeight : 0
    };
}

function compositeRolePool(
    parent,
    slot,
    role,
    observationContext,
    options
) {
    const scored = slot.variants
        .filter(variant => variant.roles.includes(role))
        .map(variant => scoreCompositeVariant(
            variant,
            slot,
            parent,
            observationContext,
            parent.composite.variantPolicy
        ))
        .sort((left, right) => right.score - left.score
            || right.evidenceWeight - left.evidenceWeight
            || left.penaltyWeight - right.penaltyWeight);
    if (!scored.length) {
        return {valid: false, survivors: [], consensus: []};
    }

    const evidenceReady = scored.filter(candidateEvidenceReady);
    const policyReady = evidenceReady.filter(candidateScoreReady);
    const notYetTested = scored.filter(candidate =>
        !candidateEvidenceReady(candidate));
    let survivors;
    if (policyReady.length) {
        const best = policyReady[0];
        survivors = [
            ...notYetTested,
            ...policyReady.filter(candidate =>
                plausibleCandidate(candidate, best, options))
        ];
    } else if (notYetTested.length) {
        // A coarse/dynamic true child can expose less scoreable evidence than
        // a fully constrained decoy. It remains possible until it itself has
        // enough evidence to pass or fail the policy; a ready decoy must not
        // eliminate it merely by being easier to score.
        survivors = notYetTested;
    } else if (evidenceReady.length) {
        // Broad observations contradict every member of this role. It can no
        // longer be the selected prize/regular pool for this physical slot.
        return {valid: false, survivors: [], consensus: []};
    } else {
        // Sparse evidence is not permission to discard a source alternative.
        survivors = scored;
    }

    return {
        valid: true,
        survivors,
        consensus: compositePoolConsensus(slot, survivors)
    };
}

function compositePoolConsensus(slot, survivors) {
    const consensus = Array.from({length: slot.height}, () =>
        Array.from({length: slot.width}, () => null));
    for (let y = 0; y < slot.height; y++) {
        for (let x = 0; x < slot.width; x++) {
            if (!slot.mask[y]?.[x]) {
                continue;
            }
            let kind = null;
            let safe = true;
            for (const candidate of survivors) {
                const kinds = compositeVariantKinds(
                    candidate.variant,
                    {x, y},
                    slot
                );
                if (kinds.length !== 1) {
                    safe = false;
                    break;
                }
                if (kind == null) {
                    [kind] = kinds;
                } else if (kind !== kinds[0]) {
                    safe = false;
                    break;
                }
            }
            if (safe) {
                consensus[y][x] = kind;
            }
        }
    }
    return consensus;
}

function compositeDistinctNamesFeasible(nameSets, fixedSlot, fixedName) {
    const used = new Set([fixedName]);
    const remaining = nameSets
        .map((names, index) => ({index, names}))
        .filter(entry => entry.index !== fixedSlot)
        .sort((left, right) => left.names.size - right.names.size);
    const search = index => {
        if (index >= remaining.length) {
            return true;
        }
        for (const name of remaining[index].names) {
            if (used.has(name)) {
                continue;
            }
            used.add(name);
            if (search(index + 1)) {
                return true;
            }
            used.delete(name);
        }
        return false;
    };
    return search(0);
}

function pruneCompositeFamilyPools(slots, pools) {
    const nameSets = pools.map(pool => new Set(
        pool.survivors.map(candidate => candidate.variant.name)
    ));
    const pruned = pools.map((pool, slotIndex) => {
        const survivors = pool.survivors.filter(candidate =>
            compositeDistinctNamesFeasible(
                nameSets,
                slotIndex,
                candidate.variant.name
            ));
        return {
            valid: survivors.length > 0,
            survivors,
            consensus: survivors.length
                ? compositePoolConsensus(slots[slotIndex], survivors)
                : []
        };
    });
    return pruned.every(pool => pool.valid) ? pruned : null;
}

function closedCompositeRolePool(slot, role) {
    let byRole = CLOSED_COMPOSITE_ROLE_POOL_CACHE.get(slot);
    if (!byRole) {
        byRole = new Map();
        CLOSED_COMPOSITE_ROLE_POOL_CACHE.set(slot, byRole);
    }
    const cached = byRole.get(role);
    if (cached) {
        return cached;
    }
    const survivors = slot.variants
        .filter(variant => variant.roles.includes(role))
        .map(variant => ({variant}));
    const pool = {
        valid: survivors.length > 0,
        survivors,
        consensus: survivors.length
            ? compositePoolConsensus(slot, survivors)
            : []
    };
    byRole.set(role, pool);
    return pool;
}

function fixedCompositeClosedFamilies(scoredParents) {
    const families = [];
    for (const parent of scoredParents) {
        if (parent.composite?.type !== 'fixed-subvaults-v1') {
            return [];
        }
        const pools = parent.composite.slots.map(slot =>
            closedCompositeRolePool(slot, slot.role));
        if (!pools.every(pool => pool.valid)) {
            return [];
        }
        families.push({
            parent,
            regime: 'fixed-closed',
            prizeIndex: -1,
            pools
        });
    }
    return families;
}

function compositeFamilyKind(family, worldX, worldY) {
    const parent = family.parent;
    if (parent.worldBounds
        && (worldX < parent.worldBounds.minX
            || worldX > parent.worldBounds.maxX
            || worldY < parent.worldBounds.minY
            || worldY > parent.worldBounds.maxY)) {
        return null;
    }
    const sourcePoint = compositeSourcePoint(parent, worldX, worldY);
    if (!sourcePoint) {
        return parent.composite.borderFillKind || null;
    }
    for (let index = 0; index < parent.composite.slots.length; index++) {
        const slot = parent.composite.slots[index];
        const slotPoint = compositeSlotPoint(slot, sourcePoint);
        if (slotPoint) {
            return family.pools[index].consensus[slotPoint.y]?.[slotPoint.x]
                || null;
        }
    }
    const kinds = cellAt(parent, worldX, worldY);
    return kinds.length === 1 ? kinds[0] : null;
}

function compositeShellFamily(parent) {
    return {
        parent,
        shellOnly: true,
        pools: parent.composite.slots.map(slot => ({
            consensus: Array.from({length: slot.height}, () =>
                Array.from({length: slot.width}, () => null))
        }))
    };
}

function compositeConsensusPredictions(
    families,
    observations,
    excludedKeys = new Set()
) {
    if (!families.length) {
        return [];
    }
    const observedKeys = new Set(observations.map(cell => `${cell.x},${cell.y}`));
    for (const key of excludedKeys) {
        observedKeys.add(key);
    }
    const familyBounds = families.map(({parent}) =>
        parent.worldBounds || parent.bounds);
    const minX = Math.max(...familyBounds.map(bounds => bounds.minX));
    const minY = Math.max(...familyBounds.map(bounds => bounds.minY));
    const maxX = Math.min(...familyBounds.map(bounds => bounds.maxX));
    const maxY = Math.min(...familyBounds.map(bounds => bounds.maxY));
    const predictions = [];
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (observedKeys.has(`${x},${y}`)) {
                continue;
            }
            let consensus = null;
            let safe = true;
            for (const family of families) {
                const kind = compositeFamilyKind(family, x, y);
                if (!kind) {
                    safe = false;
                    break;
                }
                if (consensus == null) {
                    consensus = kind;
                } else if (consensus !== kind) {
                    safe = false;
                    break;
                }
            }
            if (safe && consensus) {
                predictions.push({x, y, kind: consensus});
            }
        }
    }
    return predictions;
}

function exactStringArray(values, expected) {
    return Array.isArray(values)
        && values.length === expected.length
        && values.every((value, index) => value === expected[index]);
}

/**
 * The Vestibule is a guaranteed, exact-source full-level composite, but many
 * legal entrance rooms expose less than the normal global evidence floor on
 * the first WebTiles packet. A verified transition portal still permits safe
 * world-space consensus, provided the matcher has retained the complete
 * parent/child closure. Keep this deliberately structural and destination-
 * specific: an audit label or a portal observation alone is not sufficient.
 */
function trustedHellVestibuleEntryClosure(
    preparedTemplates,
    scoredParents,
    observationContext,
    options
) {
    if (!options.requireExhaustivePlacement
        || preparedTemplates.length !== 4
        || scoredParents.length !== 148) {
        return false;
    }
    const template = preparedTemplates[0]?.template;
    const metadata = template?.metadata;
    const certificate = metadata?.trustedEntryConsensus;
    const anchor = metadata?.matchAnchor;
    if (template?.width !== 57 || template?.height !== 57
        || metadata?.sourceAudit !== HELL_VESTIBULE_SOURCE_AUDIT
        || metadata?.place !== 'Hell'
        || metadata?.composite?.type !== 'fixed-subvaults-v1'
        || metadata.composite.variants?.length !== 36
        || certificate?.protocol
            !== HELL_VESTIBULE_ENTRY_CONSENSUS_PROTOCOL
        || certificate.requiredObservedKind !== 'portal'
        || !exactStringArray(
            certificate.allowedFromPlaces,
            HELL_VESTIBULE_ALLOWED_FROM_PLACES
        )
        || certificate.anchorPlacementsPerTransform !== 37
        || certificate.sourceVariantCount !== 36
        || !exactStringArray(
            certificate.parentTransforms,
            HELL_VESTIBULE_PARENT_TRANSFORMS
        )
        || !Array.isArray(certificate.preparedSlotVariantCounts)
        || certificate.preparedSlotVariantCounts.length
            !== HELL_VESTIBULE_SLOT_VARIANTS.length
        || certificate.preparedSlotVariantCounts.some((count, index) =>
            count !== HELL_VESTIBULE_SLOT_VARIANTS[index])
        || anchor?.trustedLevelEntry !== true
        || !HELL_VESTIBULE_ALLOWED_FROM_PLACES.includes(
            anchor?.trustedLevelEntryFromPlace
        )
        || anchor?.requireObservedKind !== 'portal'
        || !Number.isInteger(anchor.x)
        || !Number.isInteger(anchor.y)
        || observationContext.byY.get(anchor.y)?.get(anchor.x)?.kind
            !== 'portal') {
        return false;
    }

    const transforms = preparedTemplates.map(prepared =>
        prepared.transform.id).sort();
    if (!exactStringArray(
        transforms,
        [...HELL_VESTIBULE_PARENT_TRANSFORMS].sort()
    )) {
        return false;
    }
    for (const prepared of preparedTemplates) {
        const slots = prepared.composite?.slots;
        if (prepared.template !== template
            || prepared.matchAnchorRequiredKind !== 'portal'
            || prepared.matchAnchorPlacements?.length !== 37
            || prepared.composite?.type !== 'fixed-subvaults-v1'
            || !Array.isArray(slots)
            || slots.length !== HELL_VESTIBULE_SLOT_ROLES.length) {
            return false;
        }
        for (let index = 0; index < slots.length; index++) {
            if (slots[index].role !== HELL_VESTIBULE_SLOT_ROLES[index]
                || slots[index].variants.length
                    !== HELL_VESTIBULE_SLOT_VARIANTS[index]) {
                return false;
            }
        }
        const entryVariants = slots[4].variants;
        const entryReferences = entryVariants.reduce((count, variant) =>
            count + variant.entryAnchorPoints.length, 0);
        const entryPlacements = new Set(entryVariants.flatMap(variant =>
            variant.entryAnchorPoints.map(point => `${point.x},${point.y}`)));
        if (entryReferences !== 360 || entryPlacements.size !== 37) {
            return false;
        }
    }
    return new Set(scoredParents.map(parent => parent.id)).size === 148
        && scoredParents.every(parent =>
            parent.template === template
            && parent.placementSearch === 'anchor'
            && parent.composite?.type === 'fixed-subvaults-v1');
}

function evaluateCompositeCandidates(
    scoredParents,
    observationContext,
    observations,
    options,
    excludedKeys,
    trustedEntryClosure = false
) {
    const diagnosticBest = scoredParents[0] || null;
    if (!diagnosticBest) {
        return null;
    }
    const evidenceReadyParents = scoredParents.filter(candidateEvidenceReady);
    const policyReadyParents = evidenceReadyParents.filter(candidateScoreReady);
    // A focus-gated partial vault cannot be the true placement when the
    // player's authoritative square is outside its footprint. That is a
    // structural exclusion, not missing terrain evidence, so do not retain
    // it as an unresolved family in cross-placement consensus.
    const unresolvedParents = scoredParents.filter(candidate =>
        candidate.focusReady && !candidateEvidenceReady(candidate));
    const best = policyReadyParents[0] || diagnosticBest;
    let plausibleParents;
    if (policyReadyParents.length) {
        plausibleParents = [
            ...unresolvedParents,
            ...policyReadyParents.filter(candidate =>
                plausibleCandidate(candidate, best, options))
        ];
    } else if (unresolvedParents.length) {
        plausibleParents = unresolvedParents;
    } else {
        plausibleParents = [];
    }
    const families = [];
    for (const parent of plausibleParents) {
        const parentFamilyStart = families.length;
        const poolCache = parent.composite.slots.map(() => new Map());
        const rolePool = (slot, slotIndex, role) => {
            const cached = poolCache[slotIndex].get(role);
            if (cached) {
                return cached;
            }
            const pool = compositeRolePool(
                parent,
                slot,
                role,
                observationContext,
                options
            );
            poolCache[slotIndex].set(role, pool);
            return pool;
        };
        if (parent.composite.type === 'fixed-subvaults-v1') {
            const pools = parent.composite.slots.map((slot, index) =>
                rolePool(slot, index, slot.role));
            if (pools.every(pool => pool.valid)) {
                families.push({
                    parent,
                    regime: 'fixed',
                    prizeIndex: -1,
                    pools
                });
            }
        } else {
            for (const regime of parent.composite.regimes) {
                for (let prizeIndex = 0;
                    prizeIndex < parent.composite.slots.length;
                    prizeIndex++) {
                    const pools = parent.composite.slots.map((slot, index) =>
                        rolePool(
                            slot,
                            index,
                            index === prizeIndex
                                ? regime.prizeRole
                                : regime.regularRole
                        ));
                    if (pools.every(pool => pool.valid)) {
                        const distinctPools = pruneCompositeFamilyPools(
                            parent.composite.slots,
                            pools
                        );
                        if (distinctPools) {
                            families.push({
                                parent,
                                regime: regime.id,
                                prizeIndex,
                                pools: distinctPools
                            });
                        }
                    }
                }
            }
        }
        if (families.length === parentFamilyStart) {
            // A changed or otherwise unconstrained quadrant can contradict
            // every audited child role for one placement while another
            // placement still has viable children. Retain that placement's
            // fixed master shell in the cross-parent consensus instead of
            // dropping the entire parent hypothesis globally.
            families.push(compositeShellFamily(parent));
        }
    }
    const evidenceReady = policyReadyParents.length > 0;
    const scoreReady = policyReadyParents.length > 0;
    // Quadrant terrain may be modified after generation. Even if every
    // source quadrant role is contradicted, the audited master shell and its
    // border fill remain fixed and can still be revealed safely.
    // The trusted first-entry path must not eliminate a legal hypothesis on
    // score alone. Initial packets can contain transient/noisy cells, making
    // a decoy policy-ready while the true parent or child scores below the
    // normal threshold. Build a separate cap-free closure from all 148 legal
    // anchored parents and every fixed-role child variant. The ordinary
    // scored families remain untouched for diagnostics and /force_reveal.
    const trustedFamilies = trustedEntryClosure
        ? fixedCompositeClosedFamilies(scoredParents)
        : [];
    const closureComplete = trustedFamilies.length === scoredParents.length
        && scoredParents.length > 0
        && scoredParents.every(parent => trustedFamilies.some(family =>
            family.parent.id === parent.id));
    const trustedEntryConsensus = trustedEntryClosure && closureComplete;
    const predictionFamilies = trustedEntryConsensus
        ? trustedFamilies
        : families;
    const bestPredictionFamilies = predictionFamilies
        .filter(family => family.parent.id === best.id);
    const forceFamilies = bestPredictionFamilies.length
        ? bestPredictionFamilies
        : [compositeShellFamily(best)];
    const forcePredictions = compositeConsensusPredictions(
        forceFamilies,
        observations,
        excludedKeys
    );
    const consensusAuthorized = (evidenceReady && scoreReady)
        || trustedEntryConsensus;
    const predictions = consensusAuthorized
        ? compositeConsensusPredictions(
            predictionFamilies,
            observations,
            excludedKeys
        )
        : [];
    const ready = consensusAuthorized && predictionFamilies.length > 0
        && predictions.length >= options.minPredictedCells;
    const resolvedFamilyCount = families.filter(family =>
        !family.shellOnly).length;
    return {
        ready,
        unique: resolvedFamilyCount === 1,
        best,
        margin: plausibleParents.length > 1 ? 0 : 1,
        candidates: plausibleParents,
        predictions,
        forcePredictions,
        plausibleCandidateCount: resolvedFamilyCount,
        consensusOverflow: false,
        trustedEntryConsensus,
        reason: ready ? 'ready'
            : !evidenceReady && !trustedEntryConsensus
                ? 'insufficient-evidence'
            : !scoreReady ? 'below-threshold'
                : !ready ? 'ambiguous'
                    : 'ready'
    };
}

function consensusPredictions(candidates, observations) {
    if (!candidates.length) {
        return [];
    }
    const observedKeys = new Set(observations.map(cell => `${cell.x},${cell.y}`));
    const predictionBounds = candidate =>
        candidate.template?.metadata?.encompassBorderFillKind
            && candidate.worldBounds
            ? candidate.worldBounds
            : candidate.bounds;
    const bounds = candidates.map(predictionBounds);
    const minX = Math.max(...bounds.map(bound => bound.minX));
    const minY = Math.max(...bounds.map(bound => bound.minY));
    const maxX = Math.min(...bounds.map(bound => bound.maxX));
    const maxY = Math.min(...bounds.map(bound => bound.maxY));
    if (minX > maxX || minY > maxY) {
        return [];
    }

    const predictions = [];
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (observedKeys.has(`${x},${y}`)) {
                continue;
            }
            let consensus = null;
            let safe = true;
            for (const candidate of candidates) {
                const kinds = cellAt(candidate, x, y);
                if (kinds.length !== 1) {
                    safe = false;
                    break;
                }
                if (consensus == null) {
                    [consensus] = kinds;
                } else if (consensus !== kinds[0]) {
                    safe = false;
                    break;
                }
            }
            if (safe && consensus) {
                predictions.push({x, y, kind: consensus});
            }
        }
    }
    return predictions;
}

function candidateEvidenceReady(candidate) {
    const policy = candidate.matchPolicy;
    return candidate.evidenceCells >= policy.minEvidenceCells
        && candidate.evidenceWeight >= policy.minEvidenceWeight
        && candidate.distinctKinds >= policy.minDistinctKinds
        && candidate.coverage >= policy.minCoverage
        && candidate.spanXRatio >= policy.minSpanXRatio
        && candidate.spanYRatio >= policy.minSpanYRatio
        && candidate.requiredKindsReady
        && candidate.focusReady;
}

function candidateScoreReady(candidate) {
    return candidate.score >= candidate.matchPolicy.minScore;
}

function plausibleCandidate(candidate, best, options) {
    const baseline = candidate.score >= candidate.matchPolicy.plausibleMinScore
        && best.score - candidate.score <= candidate.matchPolicy.plausibleSlack
        && candidate.evidenceCells >= options.minEvidenceCells;
    if (!baseline) {
        return false;
    }
    return !candidate.matchPolicy.enforceInPlausible
        || candidateEvidenceReady(candidate);
}

export class MapMatcher {
    constructor(options = {}) {
        this.options = {
            worldWidth: options.worldWidth ?? DEFAULT_WORLD_WIDTH,
            worldHeight: options.worldHeight ?? DEFAULT_WORLD_HEIGHT,
            minScore: options.minScore ?? 0.965,
            minEvidenceCells: options.minEvidenceCells ?? 18,
            minEvidenceWeight: options.minEvidenceWeight ?? 22,
            minDistinctKinds: options.minDistinctKinds ?? 2,
            minCoverage: options.minCoverage ?? 0,
            minSpanXRatio: options.minSpanXRatio ?? 0,
            minSpanYRatio: options.minSpanYRatio ?? 0,
            requiredKinds: normalizedKindList(options.requiredKinds),
            minWinnerMargin: options.minWinnerMargin ?? 0.025,
            candidateSlack: options.candidateSlack ?? 0.0125,
            maxConsensusCandidates: options.maxConsensusCandidates ?? 16,
            minPredictedCells: options.minPredictedCells ?? 20,
            // Heuristic anchor sampling is useful for locating floating
            // vaults, but a truncated placement search cannot prove that its
            // apparent winner is unique. Callers that require certified
            // placement may opt in; explicit matchAnchor glyphs enumerate
            // every matching glyph and are therefore complete.
            requireExhaustivePlacement:
                options.requireExhaustivePlacement === true,
            maxAnchorObservations: options.maxAnchorObservations ?? 28,
            maxTemplateAnchorsPerKind: options.maxTemplateAnchorsPerKind ?? 160,
            maxPlacementsPerTransform: options.maxPlacementsPerTransform ?? 24,
            maxPriorityAnchorsPerKind: options.maxPriorityAnchorsPerKind ?? 64,
            maxPriorityPlacementsPerTransform:
                options.maxPriorityPlacementsPerTransform ?? 48,
            // Test/oracle escape hatch. Production exhaustive searches use a
            // compact translation-correlation batch; the legacy object-per-
            // offset path remains available so randomized equivalence tests
            // can compare the two implementations directly.
            legacyExhaustivePlacement:
                options.legacyExhaustivePlacement === true
        };
        this.templates = [];
        this.preparedTemplates = [];
        this.observations = new Map();
        this.volatileObservations = new Set();
        this.focusPosition = null;
        this.lastEvaluationStats = {
            exhaustiveOffsets: 0,
            exhaustiveBatches: 0,
            correlationBytes: 0
        };
        this.result = this.emptyResult();
    }

    emptyResult() {
        return {
            ready: false,
            unique: false,
            best: null,
            candidates: [],
            predictions: [],
            forcePredictions: [],
            reason: 'not-evaluated'
        };
    }

    setTemplates(templates = []) {
        this.templates = templates.filter(template => template && templateGrid(template).length);
        this.preparedTemplates = prepareTemplates(this.templates, this.options);
        return this.evaluate();
    }

    reset({keepTemplates = true} = {}) {
        this.observations.clear();
        this.volatileObservations.clear();
        this.focusPosition = null;
        if (!keepTemplates) {
            this.templates = [];
            this.preparedTemplates = [];
        }
        this.result = this.emptyResult();
        return this.result;
    }

    updateObservations(cells = [], {evaluate = true} = {}) {
        for (const cell of cells) {
            const kind = normalizeTerrainKind(cell?.kind ?? cell?.terrain);
            if (!kind || !Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) {
                continue;
            }
            // WebTiles coordinates are relative to a per-level origin (usually
            // the player's entry square), so negative values are expected.
            if (Math.abs(cell.x) > this.options.worldWidth * 2
                || Math.abs(cell.y) > this.options.worldHeight * 2) {
                continue;
            }
            const key = `${cell.x},${cell.y}`;
            const previous = this.observations.get(key);
            if (previous && previous.kind !== kind) {
                // Once server knowledge changes, that coordinate is no
                // longer reliable source-generation evidence. Composite
                // vault matching ignores it for the rest of the level and
                // never predicts over it, preventing opened doors, digging,
                // or scripted terrain changes from selecting a decoy child.
                this.volatileObservations.add(key);
            }
            this.observations.set(key, {x: cell.x, y: cell.y, kind});
        }
        return evaluate ? this.evaluate() : this.result;
    }

    setVolatileObservations(keys = [], {evaluate = true} = {}) {
        this.volatileObservations = new Set(
            [...keys].filter(key => typeof key === 'string')
        );
        return evaluate ? this.evaluate() : this.result;
    }

    setFocusPosition(position, {evaluate = true} = {}) {
        this.focusPosition = Number.isInteger(position?.x)
            && Number.isInteger(position?.y)
            ? {x: position.x, y: position.y}
            : null;
        return evaluate ? this.evaluate() : this.result;
    }

    removeObservations(cells = [], {evaluate = true} = {}) {
        for (const cell of cells) {
            if (Number.isInteger(cell?.x) && Number.isInteger(cell?.y)) {
                this.observations.delete(`${cell.x},${cell.y}`);
            }
        }
        return evaluate ? this.evaluate() : this.result;
    }

    evaluate() {
        this.lastEvaluationStats = {
            exhaustiveOffsets: 0,
            exhaustiveBatches: 0,
            correlationBytes: 0
        };
        const observations = [...this.observations.values()];
        if (!this.templates.length) {
            this.result = {...this.emptyResult(), reason: 'no-templates'};
            return this.result;
        }
        if (!observations.length) {
            this.result = {...this.emptyResult(), reason: 'no-observations'};
            return this.result;
        }

        const compositeOnly = this.preparedTemplates.length > 0
            && this.preparedTemplates.every(prepared => prepared.composite);
        const scoringObservations = compositeOnly
            ? observations.filter(cell =>
                !this.volatileObservations.has(`${cell.x},${cell.y}`))
            : observations;
        if (!scoringObservations.length) {
            this.result = {...this.emptyResult(), reason: 'no-observations'};
            return this.result;
        }
        const observationContext = buildObservationContext(
            scoringObservations,
            this.options
        );
        const anchorUnverified = this.preparedTemplates.some(prepared =>
            !prepared.matchPolicy.revealDisabled
            && effectiveAnchorState(prepared, observationContext).unverified);
        const placementUnverified = anchorUnverified
            || (this.options.requireExhaustivePlacement
            && this.preparedTemplates.some(prepared =>
                !prepared.matchPolicy.revealDisabled
                && prepared.matchAnchorPlacements === null
                && !prepared.matchPolicy.exhaustivePlacement));
        const placementUnverifiedReason = anchorUnverified
            ? 'anchor-unverified'
            : 'placement-unverified';
        if (!compositeOnly && !this.options.legacyExhaustivePlacement) {
            const space = scoreCandidateSpace(
                this.preparedTemplates,
                observationContext,
                this.focusPosition,
                this.options
            );
            this.lastEvaluationStats = {
                exhaustiveOffsets: space.exhaustiveOffsets,
                exhaustiveBatches: space.batches.length,
                correlationBytes: space.correlationBytes
            };
            if (!space.bestReference) {
                this.result = {
                    ...this.emptyResult(),
                    reason: placementUnverified
                        ? placementUnverifiedReason
                        : 'no-candidates'
                };
                return this.result;
            }
            const best = materializeReference(
                space.bestReference,
                observationContext,
                this.focusPosition,
                this.options
            );
            const evidenceReady = candidateEvidenceReady(best);
            const scoreReady = candidateScoreReady(best);
            const revealDisabled = best.matchPolicy.revealDisabled;
            const margin = space.secondReference
                ? best.score - space.secondReference.score
                : 1;
            const plausible = plausibleCandidateSpace(
                space,
                best,
                this.options
            );
            const consensusOverflow = plausible.count
                > this.options.maxConsensusCandidates;
            const survivors = plausible.survivors.map(reference =>
                materializeReference(
                    reference,
                    observationContext,
                    this.focusPosition,
                    this.options
                ));
            // Correlation is an exact replacement for enumerating/scoring
            // every translation, but it is not a proof that an under-
            // evidence true placement can be discarded. Partial layouts such
            // as Elf:$ and Zot:5 therefore remain revealDisabled until they
            // have a separate unresolved-placement certificate.
            const forcePredictions = best.matchPolicy.forceRevealDisabled
                ? []
                : consensusPredictions([best], observations);
            const predictions = !revealDisabled && !placementUnverified
                && evidenceReady && scoreReady && !consensusOverflow
                ? consensusPredictions(survivors, observations)
                : [];
            const uniqueWinner = margin >= this.options.minWinnerMargin;
            const consensusReady = !revealDisabled && !placementUnverified
                && !consensusOverflow && survivors.length > 0
                && predictions.length >= this.options.minPredictedCells;
            this.result = {
                ready: !revealDisabled && !placementUnverified
                    && evidenceReady && scoreReady
                    && (uniqueWinner || consensusReady),
                unique: uniqueWinner,
                best,
                margin,
                candidates: survivors,
                predictions,
                forcePredictions,
                plausibleCandidateCount: plausible.count,
                consensusOverflow,
                reason: revealDisabled ? 'policy-disabled'
                    : placementUnverified ? placementUnverifiedReason
                        : !evidenceReady ? 'insufficient-evidence'
                            : !scoreReady ? 'below-threshold'
                                : !(uniqueWinner || consensusReady)
                                    ? 'ambiguous'
                                    : 'ready'
            };
            return this.result;
        }
        const scored = buildCandidates(
            this.preparedTemplates,
            observationContext,
            this.options
        )
            .map(candidate => candidateScore(
                candidate,
                observationContext,
                this.focusPosition
            ))
            .sort((left, right) => right.score - left.score
                || right.evidenceWeight - left.evidenceWeight
                || left.penaltyWeight - right.penaltyWeight);
        if (this.options.legacyExhaustivePlacement) {
            this.lastEvaluationStats = {
                exhaustiveOffsets: scored.filter(candidate =>
                    candidate.placementSearch === 'exhaustive').length,
                exhaustiveBatches: 0,
                correlationBytes: 0
            };
        }
        const best = scored[0] || null;
        if (!best) {
            this.result = {
                ...this.emptyResult(),
                reason: placementUnverified
                    ? placementUnverifiedReason
                    : 'no-candidates'
            };
            return this.result;
        }

        if (compositeOnly) {
            const trustedEntryClosure = trustedHellVestibuleEntryClosure(
                this.preparedTemplates,
                scored,
                observationContext,
                this.options
            );
            const compositeResult = evaluateCompositeCandidates(
                scored,
                observationContext,
                observations,
                this.options,
                this.volatileObservations,
                trustedEntryClosure
            ) || {...this.emptyResult(), reason: 'no-candidates'};
            // A truncated terrain-placement search can never authorize normal
            // mapping, but the user explicitly requested a best-effort
            // `/force_reveal` path. Preserve the composite evaluator's best
            // placement and force-only cells while removing every safe cell.
            // This mirrors the non-composite force contract: diagnostic best
            // guesses remain available, whereas normal reveal stays closed.
            this.result = placementUnverified
                ? {
                    ...compositeResult,
                    ready: false,
                    predictions: [],
                    reason: placementUnverifiedReason
                }
                : compositeResult;
            return this.result;
        }

        const evidenceReady = candidateEvidenceReady(best);
        const scoreReady = candidateScoreReady(best);
        const revealDisabled = best.matchPolicy.revealDisabled;
        const secondDifferent = scored.find(candidate =>
            candidate.templateIndex !== best.templateIndex
            || candidate.offsetX !== best.offsetX
            || candidate.offsetY !== best.offsetY
            || candidate.transform !== best.transform);
        const margin = secondDifferent ? best.score - secondDifferent.score : 1;
        const plausible = scored
            .filter(candidate => plausibleCandidate(candidate, best, this.options));
        const consensusOverflow = plausible.length > this.options.maxConsensusCandidates;
        const survivors = plausible.slice(0, this.options.maxConsensusCandidates);
        // Expose the singleton terrain cells from the current supported best
        // placement even when normal score, ambiguity, policy, or exhaustive-
        // placement gates reject it. Callers must keep this separate from
        // consensus predictions: it powers the provisional orange display as
        // well as the explicit force command.
        const forcePredictions = best.matchPolicy.forceRevealDisabled
            ? []
            : consensusPredictions([best], observations);
        const predictions = !revealDisabled && !placementUnverified
            && evidenceReady && scoreReady && !consensusOverflow
            ? consensusPredictions(survivors, observations)
            : [];
        const uniqueWinner = margin >= this.options.minWinnerMargin;
        const consensusReady = !revealDisabled && !placementUnverified
            && !consensusOverflow && survivors.length > 0
            && predictions.length >= this.options.minPredictedCells;

        this.result = {
            ready: !revealDisabled && !placementUnverified
                && evidenceReady && scoreReady && (uniqueWinner || consensusReady),
            unique: uniqueWinner,
            best,
            margin,
            candidates: survivors,
            predictions,
            forcePredictions,
            plausibleCandidateCount: plausible.length,
            consensusOverflow,
            reason: revealDisabled ? 'policy-disabled'
                : placementUnverified ? placementUnverifiedReason
                    : !evidenceReady ? 'insufficient-evidence'
                        : !scoreReady ? 'below-threshold'
                            : !(uniqueWinner || consensusReady) ? 'ambiguous'
                                : 'ready'
        };
        return this.result;
    }

    getResult() {
        return this.result;
    }

    getEvaluationStats() {
        return {...this.lastEvaluationStats};
    }
}

export default MapMatcher;
