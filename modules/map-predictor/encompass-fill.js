const WALL_BORDER_FILL_FEATURES = new Set([
    'rock_wall',
    'stone_wall',
    'metal_wall',
    'crystal_wall',
    'slimy_wall',
    'permarock_wall',
    'clear_rock_wall',
    'clear_stone_wall',
    'clear_permarock_wall'
]);

function mapRowsFromBlock(block) {
    const match = /(?:^|\n)MAP\s*\n([\s\S]*?)\nENDMAP(?:\n|$)/u.exec(
        String(block || '')
    );
    return match ? match[1].split('\n') : [];
}

function hasStaticWallBorderFill(block) {
    const source = String(block || '');
    const mapStart = /^MAP\s*$/mu.exec(source);
    const header = mapStart ? source.slice(0, mapStart.index) : source;
    const callCount = [...header.matchAll(
        /\bset_border_fill_type\s*\(/gu
    )].length;
    if (callCount === 0) {
        // map_def defaults to rock wall, which is also the terrain installed
        // by dgn_reset_level() before an encompass map is applied.
        return true;
    }

    // A syntactically literal call inside DES Lua control flow is still
    // dynamic. Reject the whole explicit-fill case rather than attempting to
    // interpret branches here.
    if (/^\s*:\s*(?:if|elseif|else|for|while|repeat|until|do|end)\b/mu
        .test(header)) {
        return false;
    }

    const literalCalls = [...header.matchAll(
        /^\s*:\s*set_border_fill_type\s*\(\s*(["'])([^"']+)\1\s*\)\s*(?:(?:--|#).*)?$/gmu
    )];
    return callCount === 1
        && literalCalls.length === 1
        && WALL_BORDER_FILL_FEATURES.has(literalCalls[0][2]);
}

function containsSubvault(block) {
    const source = String(block || '');
    const mapStart = /^MAP\s*$/mu.exec(source);
    const header = mapStart ? source.slice(0, mapStart.index) : source;
    return /^\s*SUBVAULT\s*:/mu.test(header)
        || /\bsubvault\s*\(/u.test(header);
}

function rawRowsMatchTemplate(rows, template, grid) {
    if (!Number.isInteger(template?.width)
        || !Number.isInteger(template?.height)
        || template.width < 1
        || template.height < 1
        || rows.length !== template.height
        || !Array.isArray(grid)
        || grid.length !== template.height
        || grid.some(row => !Array.isArray(row)
            || row.length !== template.width)) {
        return false;
    }
    return rows.reduce(
        (width, row) => Math.max(width, row.length),
        0
    ) === template.width;
}

/**
 * Materialize only the implicit wall base underneath an audited encompass
 * map. Crawl resets the whole level to rock wall, optionally replaces that
 * base with a literal border-fill feature, and then leaves MAP spaces (and
 * short-row padding) untouched. The ordinary parser deliberately represents
 * those cells as null, so this correction belongs only at source-audited
 * fixed-encompass call sites.
 *
 * Any dynamic border fill, non-wall fill, subvault, partial map, dimension
 * disagreement, or unaudited caller fails closed and returns the input grid.
 */
export function materializeAuditedEncompassWallFill(
    template,
    block,
    {grid = template?.grid, audited = false} = {}
) {
    const rows = mapRowsFromBlock(block);
    if (audited !== true
        || template?.metadata?.encompass !== true
        || template?.metadata?.orient !== 'encompass'
        || template?.metadata?.partial === true
        || containsSubvault(block)
        || !hasStaticWallBorderFill(block)
        || !rawRowsMatchTemplate(rows, template, grid)) {
        return grid;
    }

    return grid.map((row, y) => row.map((cell, x) => {
        if (x < rows[y].length && rows[y][x] !== ' ') {
            return cell;
        }
        return {
            kinds: ['wall'],
            certain: true,
            glyph: ' ',
            possibleGlyphs: [' ']
        };
    }));
}
