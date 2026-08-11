import IndexedDBCache from './indexeddb-cache.js';
import {SPRINT_SOURCE_PATHS} from './sprint-destinations.js';

const DEFAULT_GITHUB_API = 'https://api.github.com';
const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/gh';
const DEFAULT_OWNER = 'crawl';
const DEFAULT_REPOSITORY = 'crawl';
const DEFAULT_PARSER_VERSION = '1';
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const RESOLVED_BUILD_CACHE_VERSION = 'source-build-v1';
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const STABLE_TAG_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;
const DES_PATH_PATTERN = /^crawl-ref\/source\/dat\/des\/(?:[^/]+\/)*[^/]+\.des$/;
const DES_ROOT = 'crawl-ref/source/dat/des';
const SPRINT_DES_ROOT = `${DES_ROOT}/sprint/`;
const AUXILIARY_PATH_ALLOWLIST = Object.freeze([
    'crawl-ref/source/dat/dlua/vault.lua',
    'crawl-ref/source/dat/dlua/ziggurat.lua'
]);
const AUXILIARY_PATHS = new Set(AUXILIARY_PATH_ALLOWLIST);

const BRANCH_PATHS = {
    dungeon: ['branches/depths.des'],
    temple: ['branches/temple.des'],
    orc: ['branches/orc.des'],
    elf: ['branches/elf.des'],
    lair: ['branches/lair.des'],
    swamp: ['branches/swamp.des'],
    shoals: ['branches/shoals.des'],
    snake: ['branches/snake.des'],
    spider: [
        'branches/spider.des',
        'branches/spider_jumping.des',
        'branches/hilbert_zone.des'
    ],
    slime: ['branches/slime.des'],
    vaults: [
        'branches/vaults.des',
        'branches/vaults_rooms_empty.des',
        'branches/vaults_rooms_ghost.des',
        'branches/vaults_rooms_hard.des',
        'branches/vaults_rooms_standard.des'
    ],
    crypt: ['branches/crypt.des'],
    tomb: ['branches/tomb.des'],
    depths: [
        'branches/depths.des',
        'branches/depths_encompass.des',
        // The guaranteed Depths:$ entrance to Zot is defined in zot.des.
        'branches/zot.des'
    ],
    hell: ['branches/hell.des'],
    dis: ['branches/dis.des', 'branches/hells.des'],
    geh: [
        'branches/geh.des',
        'branches/geh_lava_maze.des',
        'branches/hells.des'
    ],
    coc: ['branches/coc.des', 'branches/hells.des'],
    tar: ['branches/tar.des', 'branches/hells.des'],
    zot: ['branches/zot.des'],
    abyss: ['branches/abyss.des'],
    pan: ['branches/pan.des']
};

const BRANCH_ALIASES = {
    d: 'dungeon',
    dungeon: 'dungeon',
    temple: 'temple',
    orc: 'orc',
    'orcish mines': 'orc',
    elf: 'elf',
    'elven halls': 'elf',
    lair: 'lair',
    swamp: 'swamp',
    shoals: 'shoals',
    snake: 'snake',
    'snake pit': 'snake',
    spider: 'spider',
    'spider nest': 'spider',
    slime: 'slime',
    'slime pits': 'slime',
    vaults: 'vaults',
    crypt: 'crypt',
    tomb: 'tomb',
    depths: 'depths',
    hell: 'hell',
    dis: 'dis',
    geh: 'geh',
    gehenna: 'geh',
    coc: 'coc',
    cocytus: 'coc',
    tar: 'tar',
    tartarus: 'tar',
    zot: 'zot',
    abyss: 'abyss',
    pan: 'pan',
    pandemonium: 'pan'
};

const PORTAL_PATHS = {
    arena: ['portals/arena.des'],
    bailey: ['portals/bailey.des'],
    bazaar: ['portals/bazaar.des'],
    crucible: ['portals/crucible.des'],
    desolation: ['portals/desolation.des'],
    'desolation of salt': ['portals/desolation.des'],
    gauntlet: ['portals/gauntlet.des'],
    gulch: ['portals/gulch.des'],
    icecv: ['portals/icecave.des'],
    icecave: ['portals/icecave.des'],
    'ice cave': ['portals/icecave.des'],
    necropolis: ['portals/necropolis.des'],
    ossuary: ['portals/ossuary.des'],
    sewer: ['portals/sewer.des'],
    trove: ['portals/trove.des'],
    volcano: ['portals/volcano.des'],
    wizlab: ['portals/wizlab.des'],
    'wizard laboratory': ['portals/wizlab.des'],
    ziggurat: ['portals/ziggurat.des'],
    zig: ['portals/ziggurat.des']
};

function withoutTrailingSlash(value) {
    return value.replace(/\/+$/, '');
}

function throwIfAborted(signal) {
    if (!signal?.aborted) {
        return;
    }
    if (signal.reason !== undefined) {
        throw signal.reason;
    }
    const error = new Error('Map source operation was aborted');
    error.name = 'AbortError';
    throw error;
}

function validManifestPath(path) {
    return typeof path === 'string' && DES_PATH_PATTERN.test(path)
        && !path.split('/').includes('..');
}

function validAuxiliaryPath(path) {
    return typeof path === 'string' && AUXILIARY_PATHS.has(path);
}

function normalizeVersionText(versionText) {
    if (typeof versionText !== 'string') {
        throw new SourceRepositoryError('invalid-version', 'Crawl version must be text');
    }
    const normalized = versionText.trim();
    if (!normalized || normalized.includes('\n') || normalized.includes('\r')) {
        throw new SourceRepositoryError('invalid-version', 'Crawl version text is malformed');
    }
    return normalized;
}

function normalizePlace(place) {
    let value = place;
    if (value && typeof value === 'object') {
        value = value.place;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const branch = value.split(':', 1)[0].trim().toLowerCase()
        .replace(/^(?:the|an?)\s+/u, '');
    return branch || null;
}

function manifestPaths(manifest) {
    const paths = Array.isArray(manifest) ? manifest : manifest?.paths;
    if (!Array.isArray(paths) || !paths.every(validManifestPath)) {
        throw new SourceRepositoryError('invalid-manifest', 'DES manifest is malformed');
    }
    return paths;
}

function manifestAuxiliaryPaths(manifest) {
    const paths = manifest?.auxiliaryPaths;
    if (!Array.isArray(paths)
        || paths.length !== AUXILIARY_PATH_ALLOWLIST.length
        || new Set(paths).size !== paths.length
        || !paths.every(validAuxiliaryPath)
        || !AUXILIARY_PATH_ALLOWLIST.every(path => paths.includes(path))) {
        throw new SourceRepositoryError(
            'invalid-manifest',
            'Auxiliary source manifest is malformed'
        );
    }
    return paths;
}

function encodePath(path) {
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export class SourceRepositoryError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'SourceRepositoryError';
        this.code = code;
        Object.assign(this, details);
    }
}

export function parseCrawlVersion(versionText) {
    const normalized = normalizeVersionText(versionText);
    const prefix = '(?:Dungeon Crawl Stone Soup(?: version)?\\s+)?';
    const gitPattern = new RegExp(
        `^${prefix}(\\d+\\.\\d+(?:\\.\\d+)?`
        + `(?:-(?:a|b|rc)\\d+)?-\\d+-g([0-9a-f]{7,40}))$`,
        'i'
    );
    const gitMatch = normalized.match(gitPattern);
    if (gitMatch) {
        return Object.freeze({
            kind: 'commit',
            version: gitMatch[1],
            shortSha: gitMatch[2].toLowerCase()
        });
    }

    const stablePattern = new RegExp(`^${prefix}(\\d+\\.\\d+(?:\\.\\d+)?)$`);
    const stableMatch = normalized.match(stablePattern);
    if (stableMatch && STABLE_TAG_PATTERN.test(stableMatch[1])) {
        return Object.freeze({
            kind: 'tag',
            version: stableMatch[1],
            tag: stableMatch[1]
        });
    }

    throw new SourceRepositoryError(
        'invalid-version',
        'Version is neither an official Crawl git description nor an exact stable tag'
    );
}

export class SourceRepository {
    constructor(options = {}) {
        const fetchImpl = options.fetch || options.fetchImpl || globalThis.fetch;
        this.fetch = fetchImpl === globalThis.fetch && typeof fetchImpl === 'function'
            ? fetchImpl.bind(globalThis)
            : fetchImpl;
        this.cache = options.cache || new IndexedDBCache(options.cacheOptions);
        this.githubOwner = options.githubOwner || DEFAULT_OWNER;
        this.githubRepository = options.githubRepository || options.githubRepo
            || DEFAULT_REPOSITORY;
        this.githubApi = withoutTrailingSlash(options.githubApi || DEFAULT_GITHUB_API);
        this.cdnBase = withoutTrailingSlash(options.cdnBase || DEFAULT_CDN_BASE);
        this.cdnPackage = options.cdnPackage
            || `${this.githubOwner}/${this.githubRepository}`;
        this.parserVersion = String(options.parserVersion || DEFAULT_PARSER_VERSION);
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.resolvedVersions = new Map();

        if (!this.parserVersion) {
            throw new TypeError('parserVersion must not be empty');
        }
        if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
            throw new TypeError('requestTimeoutMs must be a positive finite number');
        }
    }

    async _request(url, options = {}) {
        return this._requestWithConsumer(url, options, null);
    }

    async _requestJson(url, options = {}, invalidMessage = 'Response is not JSON') {
        return this._requestWithConsumer(url, options, async response => {
            try {
                return await response.json();
            } catch (error) {
                throw new SourceRepositoryError(
                    'invalid-response',
                    invalidMessage,
                    {cause: error}
                );
            }
        });
    }

    async _requestText(url, options = {}, invalidMessage = 'Response is not text') {
        return this._requestWithConsumer(url, options, async response => {
            try {
                return await response.text();
            } catch (error) {
                throw new SourceRepositoryError(
                    'invalid-response',
                    invalidMessage,
                    {cause: error}
                );
            }
        });
    }

    async _requestWithConsumer(url, options = {}, consumeResponse = null) {
        if (typeof this.fetch !== 'function') {
            throw new SourceRepositoryError('fetch-unavailable', 'No fetch implementation is available');
        }

        const controller = new AbortController();
        const callerSignal = options.signal;
        throwIfAborted(callerSignal);
        const timeoutError = new SourceRepositoryError(
            'request-timeout',
            `Request timed out after ${this.requestTimeoutMs}ms for ${url}`,
            {timeoutMs: this.requestTimeoutMs}
        );
        let timeoutId = null;
        let timedOut = false;
        let callerAbortListener = null;
        let callerAbortListenerAttached = false;

        const timeoutPromise = new Promise((unused, reject) => {
            timeoutId = globalThis.setTimeout(() => {
                timedOut = true;
                controller.abort(timeoutError);
                reject(timeoutError);
            }, this.requestTimeoutMs);
        });
        const requestPromise = Promise.resolve().then(async () => {
            const response = await this.fetch(url, {
                ...options,
                signal: controller.signal
            });
            if (!response || response.ok !== true) {
                throw new SourceRepositoryError(
                    'http-error',
                    `HTTP request failed for ${url}`,
                    {status: response?.status ?? null}
                );
            }
            return typeof consumeResponse === 'function'
                ? consumeResponse(response)
                : response;
        });
        const requestPromises = [requestPromise, timeoutPromise];

        if (callerSignal) {
            requestPromises.push(new Promise((unused, reject) => {
                callerAbortListener = () => {
                    if (timeoutId !== null) {
                        globalThis.clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    const reason = callerSignal.reason === undefined
                        ? Object.assign(new Error('Request was aborted'), {name: 'AbortError'})
                        : callerSignal.reason;
                    controller.abort(reason);
                    reject(reason);
                };
                if (callerSignal.aborted) {
                    callerAbortListener();
                } else {
                    callerSignal.addEventListener('abort', callerAbortListener, {once: true});
                    callerAbortListenerAttached = true;
                }
            }));
        }

        let result;
        try {
            result = await Promise.race(requestPromises);
        } catch (error) {
            if (timedOut) {
                throw timeoutError;
            }
            if (error instanceof SourceRepositoryError) {
                throw error;
            }
            throw new SourceRepositoryError('network-error', `Request failed for ${url}`, {cause: error});
        } finally {
            if (timeoutId !== null) {
                globalThis.clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (callerSignal && callerAbortListener && callerAbortListenerAttached) {
                callerSignal.removeEventListener('abort', callerAbortListener);
                callerAbortListenerAttached = false;
            }
        }
        return result;
    }

    async _resolveCommit(reference, expectedPrefix = null, options = {}) {
        throwIfAborted(options.signal);
        const encodedReference = encodeURIComponent(reference);
        const url = `${this.githubApi}/repos/${encodeURIComponent(this.githubOwner)}`
            + `/${encodeURIComponent(this.githubRepository)}/commits/${encodedReference}`;
        const data = await this._requestJson(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            signal: options.signal
        }, 'GitHub commit response is not JSON');
        throwIfAborted(options.signal);
        const fullSha = typeof data?.sha === 'string' ? data.sha.toLowerCase() : '';
        if (!FULL_SHA_PATTERN.test(fullSha)) {
            throw new SourceRepositoryError('unresolved-revision', 'GitHub did not resolve a full commit SHA');
        }
        if (expectedPrefix && !fullSha.startsWith(expectedPrefix.toLowerCase())) {
            throw new SourceRepositoryError('unresolved-revision', 'Resolved commit does not match Crawl version');
        }
        return fullSha;
    }

    async prepare(versionText, options = {}) {
        throwIfAborted(options.signal);
        const parsed = parseCrawlVersion(versionText);
        const cacheKey = `${parsed.kind}:${parsed.version}`;
        if (this.resolvedVersions.has(cacheKey)) {
            return this.resolvedVersions.get(cacheKey);
        }

        const normalizedVersionText = normalizeVersionText(versionText);
        // A git commit is immutable, so persist its short-to-full resolution
        // alongside the DES artifacts. This avoids spending one unauthenticated
        // GitHub API request on every page reload behind a shared NAT. Stable
        // tags are intentionally excluded: a moved tag must be re-resolved and
        // compared with its cached manifest instead of silently trusting an
        // old association.
        if (parsed.kind === 'commit'
            && typeof this.cache?.getArtifact === 'function') {
            const cached = await this.cache.getArtifact(
                'resolved-build',
                parsed.shortSha,
                RESOLVED_BUILD_CACHE_VERSION,
                'commit',
                {signal: options.signal}
            );
            throwIfAborted(options.signal);
            if (cached !== undefined) {
                const fullSha = String(cached?.fullSha || '').toLowerCase();
                if (cached?.shortSha !== parsed.shortSha
                    || !FULL_SHA_PATTERN.test(fullSha)
                    || !fullSha.startsWith(parsed.shortSha)) {
                    throw new SourceRepositoryError(
                        'invalid-cache',
                        'Cached Crawl commit resolution is malformed'
                    );
                }
                const build = Object.freeze({
                    revision: fullSha,
                    fullSha,
                    versionText: normalizedVersionText
                });
                this.resolvedVersions.set(cacheKey, build);
                return build;
            }
        }

        const reference = parsed.kind === 'tag' ? parsed.tag : parsed.shortSha;
        const fullSha = await this._resolveCommit(
            reference,
            parsed.kind === 'commit' ? parsed.shortSha : null,
            options
        );
        throwIfAborted(options.signal);
        const build = Object.freeze({
            revision: parsed.kind === 'tag' ? parsed.tag : fullSha,
            fullSha,
            ...(parsed.kind === 'tag' ? {tag: parsed.tag} : {}),
            versionText: normalizedVersionText
        });
        if (parsed.kind === 'commit'
            && typeof this.cache?.setArtifact === 'function') {
            throwIfAborted(options.signal);
            await this.cache.setArtifact(
                'resolved-build',
                parsed.shortSha,
                RESOLVED_BUILD_CACHE_VERSION,
                'commit',
                {shortSha: parsed.shortSha, fullSha},
                {signal: options.signal}
            );
            throwIfAborted(options.signal);
        }
        throwIfAborted(options.signal);
        this.resolvedVersions.set(cacheKey, build);
        return build;
    }

    _validateBuild(build) {
        if (!build || typeof build !== 'object' || !FULL_SHA_PATTERN.test(build.fullSha || '')) {
            throw new SourceRepositoryError('invalid-build', 'Build must contain a resolved full SHA');
        }
        if (build.tag !== undefined) {
            if (!STABLE_TAG_PATTERN.test(build.tag) || build.revision !== build.tag) {
                throw new SourceRepositoryError('invalid-build', 'Stable build tag is malformed');
            }
        } else if (build.revision !== build.fullSha) {
            throw new SourceRepositoryError('invalid-build', 'Git build revision must be its full SHA');
        }
        return build;
    }

    _validateManifest(manifest, build) {
        if (!manifest || manifest.revision !== build.revision
            || manifest.parserVersion !== this.parserVersion
            || manifest.fullSha !== build.fullSha
            || (build.tag === undefined
                ? manifest.tag !== undefined
                : manifest.tag !== build.tag)) {
            throw new SourceRepositoryError('invalid-manifest', 'Cached DES manifest has wrong metadata');
        }
        const paths = manifestPaths(manifest);
        if (paths.length === 0 || new Set(paths).size !== paths.length) {
            throw new SourceRepositoryError('invalid-manifest', 'Cached DES manifest has invalid paths');
        }
        manifestAuxiliaryPaths(manifest);
        return manifest;
    }

    async getManifest(build, options = {}) {
        throwIfAborted(options.signal);
        this._validateBuild(build);
        const cached = await this.cache.getManifest(
            build.revision,
            this.parserVersion,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        if (cached !== undefined) {
            return this._validateManifest(cached, build);
        }

        const treeUrl = `${this.githubApi}/repos/${encodeURIComponent(this.githubOwner)}`
            + `/${encodeURIComponent(this.githubRepository)}/git/trees/${build.fullSha}?recursive=1`;
        const data = await this._requestJson(treeUrl, {
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            signal: options.signal
        }, 'GitHub tree response is not JSON');
        throwIfAborted(options.signal);
        if (data?.truncated !== false) {
            throw new SourceRepositoryError('truncated-tree', 'GitHub returned a truncated repository tree');
        }
        if (!Array.isArray(data.tree)) {
            throw new SourceRepositoryError('invalid-response', 'GitHub tree response has no tree array');
        }

        const paths = [...new Set(data.tree
            .filter(item => item?.type === 'blob' && validManifestPath(item.path))
            .map(item => item.path))].sort();
        if (paths.length === 0) {
            throw new SourceRepositoryError('invalid-response', 'GitHub tree contains no Crawl DES files');
        }
        const auxiliaryPaths = [...new Set(data.tree
            .filter(item => item?.type === 'blob' && validAuxiliaryPath(item.path))
            .map(item => item.path))].sort();
        const missingAuxiliaryPaths = AUXILIARY_PATH_ALLOWLIST.filter(
            path => !auxiliaryPaths.includes(path)
        );
        if (missingAuxiliaryPaths.length > 0) {
            throw new SourceRepositoryError(
                'missing-auxiliary-source',
                'GitHub tree is missing a required auxiliary source',
                {paths: missingAuxiliaryPaths}
            );
        }
        const manifest = {
            revision: build.revision,
            fullSha: build.fullSha,
            ...(build.tag ? {tag: build.tag} : {}),
            parserVersion: this.parserVersion,
            paths,
            auxiliaryPaths
        };
        this._validateManifest(manifest, build);
        throwIfAborted(options.signal);
        await this.cache.setManifest(
            build.revision,
            this.parserVersion,
            manifest,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        return manifest;
    }

    selectPaths(manifest, place, depth = null) {
        const manifestPathList = manifestPaths(manifest);
        const available = new Set(manifestPathList);
        if (place === 'Dungeon' && Number.isInteger(depth) && depth === 0) {
            // Sprint selection is a closed set. Comparing the complete source
            // directory catches both an omitted known map and a newly added
            // upstream map before either can be auto-revealed as one of the
            // audited nine.
            const actual = manifestPathList
                .filter(path => path.startsWith(SPRINT_DES_ROOT))
                .sort();
            const expected = [...SPRINT_SOURCE_PATHS].sort();
            if (actual.length !== expected.length
                || actual.some((path, index) => path !== expected[index])) {
                return [];
            }
            return [...SPRINT_SOURCE_PATHS];
        }
        const normalized = normalizePlace(place);
        if (!normalized) {
            return [];
        }

        const portal = PORTAL_PATHS[normalized];
        const branchName = BRANCH_ALIASES[normalized];
        // D:$ entrances live in branches/depths.des, but fetching that large
        // source on every ordinary Dungeon floor is unnecessary. The caller
        // supplies the current depth separately, so load it only where the
        // PLACE selector can naturally choose one of these primaries.
        const branch = branchName === 'dungeon' && Number(depth) !== 15
            ? undefined
            : BRANCH_PATHS[branchName];
        const candidates = portal || branch || [];
        return candidates
            .map(path => `${DES_ROOT}/${path}`)
            .filter(path => available.has(path));
    }

    async getSource(build, path, options = {}) {
        throwIfAborted(options.signal);
        this._validateBuild(build);
        if (!validManifestPath(path)) {
            throw new SourceRepositoryError('unknown-path', 'Refusing to fetch a non-DES source path');
        }
        const manifest = await this.getManifest(build, options);
        throwIfAborted(options.signal);
        if (!manifest.paths.includes(path)) {
            throw new SourceRepositoryError('unknown-path', 'DES source path is absent from the manifest');
        }

        const cached = await this.cache.getSource(
            build.revision,
            this.parserVersion,
            path,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        if (cached !== undefined) {
            if (typeof cached !== 'string') {
                throw new SourceRepositoryError('invalid-cache', 'Cached DES source is not text');
            }
            return cached;
        }

        // Always fetch the exact commit we resolved. Even release tags can be
        // moved between the GitHub tree request and the CDN request.
        const reference = build.fullSha;
        const packageName = this.cdnPackage.split('/')
            .map(segment => encodeURIComponent(segment)).join('/');
        const url = `${this.cdnBase}/${packageName}@${encodeURIComponent(reference)}`
            + `/${encodePath(path)}`;
        const source = await this._requestText(
            url,
            {signal: options.signal},
            'jsDelivr response is not text'
        );
        throwIfAborted(options.signal);
        if (typeof source !== 'string') {
            throw new SourceRepositoryError('invalid-response', 'jsDelivr response is not text');
        }
        throwIfAborted(options.signal);
        await this.cache.setSource(
            build.revision,
            this.parserVersion,
            path,
            source,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        return source;
    }

    async getAuxiliarySource(build, path, options = {}) {
        throwIfAborted(options.signal);
        this._validateBuild(build);
        if (!validAuxiliaryPath(path)) {
            throw new SourceRepositoryError(
                'unknown-path',
                'Refusing to fetch a non-allowlisted auxiliary source path'
            );
        }
        const manifest = await this.getManifest(build, options);
        throwIfAborted(options.signal);
        if (!manifestAuxiliaryPaths(manifest).includes(path)) {
            throw new SourceRepositoryError(
                'unknown-path',
                'Auxiliary source path is absent from the manifest'
            );
        }

        const cached = await this.cache.getSource(
            build.revision,
            this.parserVersion,
            path,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        if (cached !== undefined) {
            if (typeof cached !== 'string') {
                throw new SourceRepositoryError(
                    'invalid-cache',
                    'Cached auxiliary source is not text'
                );
            }
            return cached;
        }

        // Auxiliary sources obey the same immutable-source rule as DES: the
        // resolved full SHA, never a potentially movable release tag.
        const packageName = this.cdnPackage.split('/')
            .map(segment => encodeURIComponent(segment)).join('/');
        const url = `${this.cdnBase}/${packageName}@${encodeURIComponent(build.fullSha)}`
            + `/${encodePath(path)}`;
        const source = await this._requestText(
            url,
            {signal: options.signal},
            'jsDelivr auxiliary source response is not text'
        );
        throwIfAborted(options.signal);
        if (typeof source !== 'string') {
            throw new SourceRepositoryError(
                'invalid-response',
                'jsDelivr auxiliary source response is not text'
            );
        }
        throwIfAborted(options.signal);
        await this.cache.setSource(
            build.revision,
            this.parserVersion,
            path,
            source,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        return source;
    }

    async getParsed(build, path, parser, options = {}) {
        throwIfAborted(options.signal);
        this._validateBuild(build);
        if (typeof parser !== 'function') {
            throw new TypeError('parser must be a function');
        }
        if (!validManifestPath(path)) {
            throw new SourceRepositoryError('unknown-path', 'Refusing to parse a non-DES source path');
        }
        const manifest = await this.getManifest(build, options);
        throwIfAborted(options.signal);
        if (!manifest.paths.includes(path)) {
            throw new SourceRepositoryError('unknown-path', 'DES source path is absent from the manifest');
        }
        const cached = await this.cache.getParsed(
            build.revision,
            this.parserVersion,
            path,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        if (cached !== undefined) {
            return cached;
        }

        const source = await this.getSource(build, path, options);
        throwIfAborted(options.signal);
        const parsed = await parser(source, {build, path});
        throwIfAborted(options.signal);
        if (parsed === undefined) {
            throw new SourceRepositoryError('invalid-parser-result', 'Parser returned undefined');
        }
        throwIfAborted(options.signal);
        await this.cache.setParsed(
            build.revision,
            this.parserVersion,
            path,
            parsed,
            {signal: options.signal}
        );
        throwIfAborted(options.signal);
        return parsed;
    }
}

export default SourceRepository;
