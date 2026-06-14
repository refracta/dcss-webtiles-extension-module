import * as fs from 'fs';
import * as path from 'path';
import {JSDOM} from "jsdom";
import {createWebtilesSocket, WebSocket} from "./webtiles-socket.js";
import {scoreAnalysis} from './score-rules.js';

const DEFAULT_TRIGGER = 'gotcha!';
const DEFAULT_CAPTURE_TIMEOUT_MS = 4000;
const DEFAULT_WATCH_TIMEOUT_MS = 3000;
const DEFAULT_RECONNECT_DELAY_MS = 10000;
const DEFAULT_PUBLIC_CHAT_USERNAME = 'CNCPublicChat';
const DEFAULT_PUBLIC_BASE_URL = 'https://goonkemon.nemelex.cards';
const INFINITY_GLYPH = '\u221e';
const RESIST_MAX = {
    rF: 3,
    rC: 3,
    rElec: 1
};
const STATUS_ICON_BUFFS = new Set([
    'BERSERK',
    'FRENZIED',
    'HASTED',
    'MIGHT',
    'IDEALISED',
    'SWIFT',
    'FIRE_CHAMP',
    'PARTIALLY_CHARGED',
    'FULLY_CHARGED',
    'DEFLECT_MISSILES',
    'INJURY_BOND',
    'BRILLIANCE',
    'RESISTANCE',
    'REGENERATION',
    'TOUCH_OF_BEOGH',
    'UNDYING_ARMS',
    'DOUBLED_VIGOUR',
    'TEMPERED',
    'HEART',
    'WARDING',
    'STRONG_WILLED',
    'SUNDERING',
    'ENKINDLED_1',
    'ENKINDLED_2'
]);
const STATUS_ICON_DEBUFFS = new Set([
    'TRAP_NET',
    'TRAP_WEB',
    'POISON',
    'MORE_POISON',
    'MAX_POISON',
    'STICKY_FLAME',
    'INNER_FLAME',
    'CONSTRICTED',
    'SLOWED',
    'PETRIFYING',
    'PETRIFIED',
    'BLIND',
    'FLEEING',
    'UNAWARE',
    'CONFUSED',
    'STAB_BRAND',
    'DRAIN',
    'INFESTED',
    'CORRODED',
    'VILE_CLUTCH',
    'SLOWLY_DYING',
    'ANGUISH',
    'ANTIMAGIC',
    'CONC_VENOM',
    'DAZED',
    'FIRE_VULN',
    'WATERLOGGED',
    'WEAKENED',
    'PAIN_BOND',
    'BULLSEYE',
    'VITRIFIED',
    'CURSE_OF_AGONY',
    'RETREAT',
    'MAGNETISED',
    'RIMEBLIGHT',
    'WEAK_WILLED',
    'SIGN_OF_RUIN',
    'KINETIC_GRAPNEL',
    'LACED_WITH_CHAOS',
    'VEXED',
    'PYRRHIC',
    'DIMMED',
    'SENTINEL_MARK',
    'MUTE',
    'EXPOSED',
    'STAMPEDE',
    'PARALYSED'
]);
const STATUS_ICON_ATTITUDES = new Set([
    'FRIENDLY',
    'GOOD_NEUTRAL',
    'NEUTRAL'
]);
const STATUS_ICON_SPECIAL = new Set([
    'ANIMATED_WEAPON',
    'SUMMONED',
    'UNREWARDING',
    'MINION',
    'RECALL',
    'GLOWING',
    'PAIN_MIRROR',
    'BOUND_SOUL',
    'POSSESSABLE',
    'STILL_WINDS',
    'TELEPORTING',
    'MALMUTATED',
    'GLOW_LIGHT',
    'GLOW_HEAVY',
    'BIND',
    'GHOSTLY',
    'VENGEANCE_TARGET',
    'SHADOWLESS',
    'UNSTABLE',
    'VAMPIRE_THRALL',
    'FIGMENT',
    'PARADOX',
    'TESSERACT_SPAWN',
    'NOBODY_MEMORY_1',
    'NOBODY_MEMORY_2',
    'NOBODY_MEMORY_3'
]);
const STATUS_OVERLAY_ICON_NAMES = [
    'TRAP_NET',
    'TRAP_WEB',
    'SOMETHING_UNDER',
    'FRIENDLY',
    'GOOD_NEUTRAL',
    'NEUTRAL',
    'PARALYSED',
    'STAB_BRAND',
    'UNAWARE',
    'FLEEING',
    'POISON',
    'MORE_POISON',
    'MAX_POISON'
];
const FG_FLAG_STATUS_DEFINITIONS = [
    {name: 'TRAP_NET', label: 'netted', category: 'debuff', low: 0x00800000},
    {name: 'TRAP_WEB', label: 'webbed', category: 'debuff', low: 0x01000000}
];
const FG_ATTITUDE_STATUS = new Map([
    [0x00010000, {name: 'FRIENDLY', label: 'friendly', category: 'attitude'}],
    [0x00020000, {name: 'GOOD_NEUTRAL', label: 'good neutral', category: 'attitude'}],
    [0x00030000, {name: 'NEUTRAL', label: 'neutral', category: 'attitude'}]
]);
const FG_BEHAVIOUR_STATUS = new Map([
    [0x00100000, {name: 'STAB_BRAND', label: 'stab-vulnerable', category: 'debuff'}],
    [0x00200000, {name: 'UNAWARE', label: 'unaware', category: 'debuff'}],
    [0x00300000, {name: 'FLEEING', label: 'fleeing', category: 'debuff'}],
    [0x00400000, {name: 'PARALYSED', label: 'paralysed', category: 'debuff'}]
]);
const FG_POISON_STATUS = new Map([
    [0x08000000, {name: 'POISON', label: 'poisoned', category: 'debuff'}],
    [0x10000000, {name: 'MORE_POISON', label: 'heavily poisoned', category: 'debuff'}],
    [0x18000000, {name: 'MAX_POISON', label: 'max poison', category: 'debuff'}]
]);
const EVENT_LORD_NAMES = new Set([
    'cerebov',
    'lom lobon',
    'gloorx vloq',
    'ereshkigal',
    'mnoleg'
]);

export function isGotchaTrigger(message, trigger = DEFAULT_TRIGGER) {
    return String(message || '').trim().toLowerCase() ===
        String(trigger || DEFAULT_TRIGGER).trim().toLowerCase();
}

export function parseWebtilesChat(content) {
    const {window: {document}} = new JSDOM(content || '');
    const sender = document.querySelector('.chat_sender')?.textContent
        ?.replace(/:\s*$/, '')
        ?.trim();
    const message = document.querySelector('.chat_msg')?.textContent?.trim();

    if (!sender || message == null) {
        return null;
    }

    return {sender, message};
}

export function scoreGoonkemon(monster, options = {}) {
    return scoreAnalysis(analyzeGoonkemonMonster(monster, options));
}

export function analyzeGoonkemonMonster(monster, options = {}) {
    if (!monster || monster.msg !== 'ui-push' || monster.type !== 'describe-monster') {
        throw new Error('The current UI is not a monster x-v description.');
    }

    const title = cleanText(monster.title || '');
    if (!isEligibleGoonkemonMonster(monster)) {
        throw new Error(`"${title || 'Unknown'}" is not an eligible lord.`);
    }

    const body = cleanText(monster.body || '');
    const stats = parseMonsterStats(body);
    const spells = parseMonsterSpells(monster.spellset || []);
    const statuses = parseMonsterStatuses(monster, options.iconNameById);
    return {
        title,
        stats,
        spells,
        statuses,
        eligible: true
    };
}

export function parseMonsterStatuses(monster, iconNameById = {}) {
    const rawIcons = Array.isArray(monster?.icons)
        ? monster.icons.map(icon => Number(icon)).filter(Number.isFinite)
        : [];
    const iconMap = normalizeIconNameMap(iconNameById);
    const rawFlag = cloneJsonValue(monster?.flag ?? null);
    const indicators = [];

    for (const id of rawIcons) {
        const name = iconMap.get(id) || null;
        indicators.push({
            id,
            name: name || `ICON_${id}`,
            label: statusLabel(name || `ICON_${id}`),
            category: statusCategory(name),
            source: 'icon'
        });
    }

    indicators.push(...parseFlagStatuses(rawFlag));

    return groupStatusIndicators({
        rawIcons,
        rawFlag,
        indicators
    });
}

export function isExploreModeCapture(capture) {
    return capture?.exploreMode === true || truthyCrawlFlag(capture?.playerState?.explore);
}

export class GoonkemonBot {
    constructor(config = {}, {logger = console} = {}) {
        this.websocket = config.websocket;
        this.username = config.username || process.env.GOONKEMON_USERNAME || 'Goonkemon';
        this.password = config.password || process.env.GOONKEMON_PASSWORD || '';
        this.email = config.email || process.env.GOONKEMON_EMAIL || '';
        this.autoRegister = config.autoRegister === true || process.env.GOONKEMON_AUTO_REGISTER === 'true';
        this.entrypoint = config.entrypoint || process.env.GOONKEMON_ENTRYPOINT || '';
        this.publicBaseUrl = config.publicBaseUrl || process.env.GOONKEMON_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
        this.publicChatUsername = config.publicChatUsername || config.idleWatchUsername || DEFAULT_PUBLIC_CHAT_USERNAME;
        this.trigger = config.trigger || DEFAULT_TRIGGER;
        this.captureTimeoutMs = Number(config.captureTimeoutMs || DEFAULT_CAPTURE_TIMEOUT_MS);
        this.watchTimeoutMs = Number(config.watchTimeoutMs || DEFAULT_WATCH_TIMEOUT_MS);
        this.reconnectDelayMs = Number(config.reconnectDelayMs || DEFAULT_RECONNECT_DELAY_MS);
        this.storageDir = config.storageDir || 'data/goonkemon';
        this.rejectExploreMode = config.rejectExploreMode !== false;
        this.logger = logger;

        this.socket = null;
        this.stopped = false;
        this.mode = 'starting';
        this.loginResolver = null;
        this.loginRejecter = null;
        this.pendingWatch = null;
        this.confirmedWatchUsername = null;
        this.activeCapture = null;
        this.queue = Promise.resolve();
        this.registrationAttempted = false;
        this.closedResolver = null;
        this.iconNameMaps = new Map();
    }

    async runForever() {
        while (!this.stopped) {
            try {
                await this.connect();
                await new Promise(resolve => {
                    this.closedResolver = resolve;
                });
            } catch (error) {
                this.logger.error(new Date(), error.message || error);
            } finally {
                this.cleanupConnection(new Error('Goonkemon socket closed.'));
            }

            if (!this.stopped) {
                await delay(this.reconnectDelayMs);
            }
        }
    }

    stop() {
        this.stopped = true;
        this.socket?.close?.();
    }

    async connect() {
        if (!this.websocket) {
            throw new Error('Missing websocket URL.');
        }
        if (!this.username || !this.password) {
            throw new Error('Missing Goonkemon credentials. Set config password or GOONKEMON_PASSWORD.');
        }

        fs.mkdirSync(this.storageDir, {recursive: true});
        this.mode = 'starting';
        this.registrationAttempted = false;
        this.confirmedWatchUsername = null;

        const loginPromise = new Promise((resolve, reject) => {
            this.loginResolver = resolve;
            this.loginRejecter = reject;
        });

        this.socket = extendSocket(createWebtilesSocket(this.websocket, {
            handleMessage: data => this.handleMessage(data),
            logger: this.logger
        }));

        this.socket.onopen = () => {
            this.logger.log(new Date(), `Goonkemon socket opened as ${this.username}`);
            this.socket.login(this.username, this.password);
        };

        this.socket.onclose = event => this.handleClose(event);
        this.socket.onerror = event => this.handleClose(event);

        await loginPromise;
        await this.returnToPublicChat();
        this.logger.log(new Date(), `Goonkemon watching ${this.publicChatUsername}; trigger is "${this.trigger}"`);
    }

    handleClose(event) {
        const reason = event?.reason || event?.message || 'socket closed';
        this.logger.error(new Date(), 'Goonkemon disconnected:', reason);
        this.cleanupConnection(new Error(reason));
        this.closedResolver?.(event);
        this.closedResolver = null;
    }

    cleanupConnection(error) {
        this.rejectLogin(error);
        this.rejectPendingWatch(error);
        if (this.activeCapture) {
            this.activeCapture.error = error;
            this.activeCapture = null;
        }
        this.mode = 'closed';
    }

    handleMessage(data) {
        if (data?.msg === 'ping') {
            this.socket?.pong();
            return;
        }

        if (data?.msg === 'login_success') {
            this.resolveLogin();
            return;
        }

        if (data?.msg === 'login_fail') {
            this.handleLoginFailure(data);
            return;
        }

        if (data?.msg === 'register_fail') {
            this.rejectLogin(new Error(data.reason || 'Registration failed.'));
            return;
        }

        if (data?.msg === 'auth_error') {
            const error = new Error(data.reason || 'WebTiles auth error.');
            this.rejectPendingWatch(error);
            if (this.activeCapture) {
                this.activeCapture.error = error;
            }
            return;
        }

        if (data?.msg === 'watching_started') {
            this.confirmedWatchUsername = data.username;
            this.resolvePendingWatch(data.username);
        }

        if (data?.msg === 'go_lobby') {
            this.confirmedWatchUsername = null;
            this.rejectPendingWatch(new Error(data.message || 'Target is not watchable.'));
        }

        if (this.activeCapture) {
            this.recordCaptureMessage(data);
        }

        if (data?.msg === 'chat') {
            this.handleChat(data);
        }
    }

    handleLoginFailure(data) {
        if (this.autoRegister && !this.registrationAttempted) {
            this.registrationAttempted = true;
            this.logger.log(new Date(), `Goonkemon login failed; attempting registration for ${this.username}`);
            this.socket.register(this.username, this.password, this.email);
            return;
        }

        this.rejectLogin(new Error(data.reason || 'Login failed.'));
    }

    resolveLogin() {
        this.loginResolver?.();
        this.loginResolver = null;
        this.loginRejecter = null;
    }

    rejectLogin(error) {
        this.loginRejecter?.(error);
        this.loginResolver = null;
        this.loginRejecter = null;
    }

    handleChat(data) {
        if (this.mode !== 'public') {
            return;
        }

        const chat = parseWebtilesChat(data.content);
        if (!chat || sameUsername(chat.sender, this.username)) {
            return;
        }

        if (!isGotchaTrigger(chat.message, this.trigger)) {
            return;
        }

        this.enqueueCapture(chat.sender);
    }

    enqueueCapture(username) {
        this.queue = this.queue
            .catch(() => {})
            .then(() => this.captureNow(username))
            .catch(error => {
                this.logger.error(new Date(), 'Goonkemon capture failed:', error.message || error);
            });
    }

    requestCapture(username) {
        const target = String(username || '').trim();
        if (!target) {
            throw new Error('Missing username.');
        }
        this.enqueueCapture(target);
        return {queued: true, username: target};
    }

    async captureNow(username) {
        const target = String(username || '').trim();
        if (!target || sameUsername(target, this.username) || sameUsername(target, this.publicChatUsername)) {
            return;
        }

        this.logger.log(new Date(), `Goonkemon gotcha requested by ${target}`);
        let watchedTarget = false;

        try {
            const capture = await this.collectMonsterDescription(target, () => {
                watchedTarget = true;
            });
            if (this.rejectExploreMode) {
                assertNotExploreMode(capture);
            }
            const iconNameById = await this.iconNameMapForCapture(capture).catch(error => {
                this.logger.warn(new Date(), 'Could not load status icon names:', error.message || error);
                return {};
            });
            const analysis = analyzeGoonkemonMonster(capture.monster, {iconNameById});
            const score = scoreAnalysis(analysis);
            const saved = await this.saveCapture(target, capture, analysis);
            const detailUrl = captureDetailUrl(this.publicBaseUrl, saved.id);

            await this.returnToPublicChat();
            this.socket?.chat_msg(formatSuccessMessage(score, detailUrl));
            this.logger.log(new Date(), `Goonkemon scored ${target}: ${score.total}`, detailUrl, saved.jsonPath);
        } catch (error) {
            const message = formatFailureMessage(error);
            this.logger.warn(new Date(), target, message);
            if (watchedTarget || sameUsername(this.confirmedWatchUsername, target)) {
                this.socket?.chat_msg(message);
            }
        } finally {
            await this.returnToPublicChat().catch(error => {
                this.logger.warn(new Date(), 'Could not return to public chat:', error.message || error);
            });
        }
    }

    async collectMonsterDescription(username, onWatched) {
        const capture = {
            username,
            startedAt: new Date().toISOString(),
            messageTypes: {},
            uiMessages: [],
            recentMessages: [],
            playerState: {},
            webtiles: {
                entrypoint: this.entrypoint,
                gameClientVersion: null,
                versionText: null,
                gameStarted: null
            },
            exploreMode: false,
            exploreModeEvidence: [],
            eligibleMonsterLocked: false,
            monster: null,
            error: null
        };

        this.mode = 'capture';
        this.activeCapture = capture;

        try {
            await this.watchRoom(username);
            onWatched?.();
            await delay(this.captureTimeoutMs);

            if (capture.error) {
                throw capture.error;
            }
            if (!capture.monster) {
                throw new Error('No monster x-v description was visible. Open x-v on a lord, then type gotcha!.');
            }

            return capture;
        } finally {
            if (this.activeCapture === capture) {
                this.activeCapture = null;
            }
        }
    }

    recordCaptureMessage(data) {
        const key = data?.msg || 'unknown';
        this.activeCapture.messageTypes[key] = (this.activeCapture.messageTypes[key] || 0) + 1;

        recordCaptureMetadata(this.activeCapture, data);

        const monster = findMonsterDescription(data);
        if (monster) {
            const eligible = isEligibleGoonkemonMonster(monster);
            if (!this.activeCapture.eligibleMonsterLocked || eligible) {
                this.activeCapture.monster = monster;
                this.activeCapture.eligibleMonsterLocked = eligible;
            }
        }

        if (isSavedUiMessage(data)) {
            this.activeCapture.uiMessages.push(data);
        }
    }

    async returnToPublicChat() {
        this.mode = 'public';
        await this.watchRoom(this.publicChatUsername);
    }

    watchRoom(username) {
        if (sameUsername(this.confirmedWatchUsername, username)) {
            return Promise.resolve();
        }

        this.rejectPendingWatch(new Error('Watch request superseded.'));

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingWatch?.resolve === resolve) {
                    this.pendingWatch = null;
                    reject(new Error(`Timed out watching ${username}.`));
                }
            }, this.watchTimeoutMs);

            this.pendingWatch = {
                username,
                resolve: watchedUsername => {
                    clearTimeout(timer);
                    this.pendingWatch = null;
                    resolve(watchedUsername);
                },
                reject: error => {
                    clearTimeout(timer);
                    this.pendingWatch = null;
                    reject(error);
                }
            };

            this.socket.watch(username);
        });
    }

    resolvePendingWatch(username) {
        if (!this.pendingWatch || !sameUsername(this.pendingWatch.username, username)) {
            return;
        }
        this.pendingWatch.resolve(username);
    }

    rejectPendingWatch(error) {
        if (!this.pendingWatch) {
            return;
        }
        this.pendingWatch.reject(error);
    }

    async saveCapture(username, capture, analysis) {
        const now = new Date();
        const id = `${formatTimestamp(now)}-${safeFilename(username)}-${safeCaptureTitle(analysis.title)}`;
        const dir = path.join(this.storageDir, safeFilename(username));
        fs.mkdirSync(dir, {recursive: true});

        const jsonPath = path.join(dir, `${id}.json`);
        const imagesPath = path.join(dir, `${id}.images.json`);
        const json = {
            id,
            capturedAt: now.toISOString(),
            username,
            analysis,
            monster: capture.monster,
            messageTypes: capture.messageTypes,
            recentMessages: capture.recentMessages,
            playerState: capture.playerState,
            webtiles: {
                entrypoint: capture.webtiles?.entrypoint || this.entrypoint,
                gameClientVersion: capture.webtiles?.gameClientVersion || null,
                versionText: capture.webtiles?.versionText || null,
                gameStarted: capture.webtiles?.gameStarted || null
            },
            exploreModeEvidence: capture.exploreModeEvidence,
            uiMessages: capture.uiMessages
        };
        const imageBundle = await this.captureImageBundle(id, capture, json).catch(error => {
            this.logger.warn(new Date(), 'Could not save goonkemon image bundle:', error.message || error);
            json.tileRendering = {
                error: String(error?.message || error),
                sprites: {},
                iconTiles: {},
                statusIconSizes: {}
            };
            return {
                id,
                capturedAt: now.toISOString(),
                error: String(error?.message || error),
                images: {}
            };
        });

        fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
        fs.writeFileSync(imagesPath, JSON.stringify(imageBundle, null, 2));

        return {id, jsonPath, imagesPath};
    }

    async captureImageBundle(id, capture, json) {
        const entrypoint = capture.webtiles?.entrypoint || this.entrypoint;
        const version = capture.webtiles?.gameClientVersion;
        const rendered = await buildCaptureTileRendering(capture.monster, entrypoint, version);
        json.tileRendering = rendered.tileRendering;
        return {
            id,
            capturedAt: json.capturedAt,
            sourceJson: `${id}.json`,
            webtiles: {
                entrypoint,
                gameClientVersion: version || null,
                versionText: capture.webtiles?.versionText || null,
                gameStarted: capture.webtiles?.gameStarted || null
            },
            images: rendered.images
        };
    }

    async analyzeMonsterPayload(monster, webtiles = {}) {
        const capture = {
            webtiles: {
                entrypoint: webtiles.entrypoint || this.entrypoint,
                gameClientVersion: webtiles.gameClientVersion || null
            }
        };
        const iconNameById = await this.iconNameMapForCapture(capture).catch(error => {
            this.logger.warn(new Date(), 'Could not load status icon names for HTTP score:', error.message || error);
            return {};
        });
        return analyzeGoonkemonMonster(monster, {iconNameById});
    }

    async iconNameMapForCapture(capture) {
        const entrypoint = capture.webtiles?.entrypoint || this.entrypoint;
        const version = capture.webtiles?.gameClientVersion;
        if (!entrypoint || !version) {
            return {};
        }

        const key = `${entrypoint.replace(/\/$/, '')}|${version}`;
        if (!this.iconNameMaps.has(key)) {
            this.iconNameMaps.set(key, loadIconNameMap(entrypoint, version));
        }
        return this.iconNameMaps.get(key);
    }
}

function extendSocket(socket) {
    socket.safe_send = function (data) {
        const text = JSON.stringify(data);
        if (this.readyState === WebSocket.OPEN) {
            this.send(text);
        } else {
            console.error(`socket status: ${this.readyState}, data: ${text}`);
        }
    };

    socket.login = function (username, password) {
        socket.safe_send({msg: 'login', username, password});
    };

    socket.register = function (username, password, email) {
        socket.safe_send({msg: 'register', username, password, email});
    };

    socket.watch = function (username) {
        socket.safe_send({msg: 'watch', username});
    };

    socket.chat_msg = function (text) {
        socket.safe_send({msg: 'chat_msg', text});
    };

    socket.pong = function () {
        socket.safe_send({msg: 'pong'});
    };

    return socket;
}

function findMonsterDescription(data) {
    if (data?.msg === 'ui-push' && data.type === 'describe-monster') {
        return data;
    }

    if (data?.msg === 'ui-stack' && Array.isArray(data.items)) {
        for (let i = data.items.length - 1; i >= 0; i--) {
            const item = data.items[i];
            if (item?.type === 'describe-monster') {
                return {msg: 'ui-push', ...item};
            }
        }
    }

    return null;
}

function isSavedUiMessage(data) {
    if (data?.msg === 'ui-push' && data.type === 'describe-monster') {
        return true;
    }
    if (data?.msg === 'ui-stack' && Array.isArray(data.items)) {
        return data.items.some(item => item?.type === 'describe-monster');
    }
    return data?.msg === 'ui-state' && data.type === 'describe-monster';
}

function recordCaptureMetadata(capture, data) {
    if (data?.msg === 'game_client') {
        capture.webtiles.gameClientVersion = data.version || capture.webtiles.gameClientVersion;
    }

    if (data?.msg === 'version') {
        capture.webtiles.versionText = data.text || data.version || capture.webtiles.versionText;
    }

    if (data?.msg === 'game_started') {
        capture.webtiles.gameStarted = cloneJsonValue(data);
    }

    if (data?.msg === 'player') {
        for (const key of ['name', 'title', 'species', 'job', 'xl', 'turn', 'wizard', 'explore']) {
            if (Object.hasOwn(data, key)) {
                capture.playerState[key] = data[key];
            }
        }
        if (truthyCrawlFlag(data.explore)) {
            markExploreMode(capture, 'player.explore flag');
        }
    }

    if (data?.msg === 'msgs' && Array.isArray(data.messages)) {
        for (const message of data.messages) {
            const text = cleanText(message?.text || '');
            if (!text) {
                continue;
            }
            capture.recentMessages.push({
                turn: message.turn ?? null,
                channel: message.channel ?? null,
                text
            });
            if (capture.recentMessages.length > 50) {
                capture.recentMessages.shift();
            }
            if (/\bEntered explore mode\b|ABOUT TO ENTER EXPLORE MODE|\*EXPLORE\*/i.test(text)) {
                markExploreMode(capture, `message: ${text.slice(0, 120)}`);
            }
        }
    }
}

function markExploreMode(capture, evidence) {
    capture.exploreMode = true;
    if (!capture.exploreModeEvidence.includes(evidence)) {
        capture.exploreModeEvidence.push(evidence);
    }
}

export function assertNotExploreMode(capture) {
    if (!isExploreModeCapture(capture)) {
        return;
    }

    const evidence = capture.exploreModeEvidence?.length
        ? ` Evidence: ${capture.exploreModeEvidence.join('; ')}.`
        : '';
    throw new Error(`Explore mode captures are not allowed.${evidence}`);
}

function truthyCrawlFlag(value) {
    return value === true || value === 1 || value === '1' ||
        String(value || '').toLowerCase() === 'true';
}

function normalizeIconNameMap(iconNameById = {}) {
    if (iconNameById instanceof Map) {
        return iconNameById;
    }

    const map = new Map();
    for (const [id, name] of Object.entries(iconNameById || {})) {
        const numericId = Number(id);
        if (Number.isFinite(numericId) && name) {
            map.set(numericId, String(name));
        }
    }
    return map;
}

function parseFlagStatuses(rawFlag) {
    const [low, high] = normalizeFlagPair(rawFlag);
    const statuses = [];

    for (const definition of FG_FLAG_STATUS_DEFINITIONS) {
        if ((low & definition.low) === definition.low) {
            statuses.push(statusIndicator(definition, null, 'flag'));
        }
    }

    const attitude = low & 0x00030000;
    if (FG_ATTITUDE_STATUS.has(attitude)) {
        statuses.push(statusIndicator(FG_ATTITUDE_STATUS.get(attitude), null, 'flag'));
    }

    const behaviour = low & 0x00700000;
    if (FG_BEHAVIOUR_STATUS.has(behaviour)) {
        statuses.push(statusIndicator(FG_BEHAVIOUR_STATUS.get(behaviour), null, 'flag'));
    }

    const poison = high & 0x18000000;
    if (FG_POISON_STATUS.has(poison)) {
        statuses.push(statusIndicator(FG_POISON_STATUS.get(poison), null, 'flag'));
    }

    return statuses;
}

function normalizeFlagPair(value) {
    if (Array.isArray(value)) {
        return [
            toUint32(value[0]),
            toUint32(value[1])
        ];
    }

    if (Number.isFinite(Number(value))) {
        return [toUint32(value), 0];
    }

    return [0, 0];
}

function toUint32(value) {
    return Number(value || 0) >>> 0;
}

function statusIndicator(definition, id, source) {
    const name = definition?.name || `ICON_${id}`;
    return {
        id,
        name,
        label: definition?.label || statusLabel(name),
        category: definition?.category || statusCategory(name),
        source
    };
}

function statusCategory(name) {
    if (!name) {
        return 'unknown';
    }
    if (STATUS_ICON_ATTITUDES.has(name)) {
        return 'attitude';
    }
    if (STATUS_ICON_BUFFS.has(name)) {
        return 'buff';
    }
    if (STATUS_ICON_DEBUFFS.has(name)) {
        return 'debuff';
    }
    if (STATUS_ICON_SPECIAL.has(name) || /^NOBODY_MEMORY_/.test(name)) {
        return 'special';
    }
    return 'unknown';
}

function statusLabel(name) {
    return String(name || '')
        .replace(/^TILEI_/, '')
        .toLowerCase()
        .replace(/_/g, ' ');
}

function groupStatusIndicators(statuses) {
    const groups = {
        rawIcons: statuses.rawIcons,
        rawFlag: statuses.rawFlag,
        buffs: [],
        debuffs: [],
        special: [],
        attitude: [],
        unknown: [],
        indicators: []
    };
    const seen = new Set();

    for (const indicator of statuses.indicators) {
        const key = `${indicator.source}:${indicator.id ?? ''}:${indicator.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const normalized = {
            id: indicator.id,
            name: indicator.name,
            label: indicator.label,
            category: indicator.category,
            source: indicator.source
        };
        groups.indicators.push(normalized);
        if (normalized.category === 'buff') {
            groups.buffs.push(normalized);
        } else if (normalized.category === 'debuff') {
            groups.debuffs.push(normalized);
        } else if (normalized.category === 'special') {
            groups.special.push(normalized);
        } else if (normalized.category === 'attitude') {
            groups.attitude.push(normalized);
        } else {
            groups.unknown.push(normalized);
        }
    }

    return groups;
}

function cloneJsonValue(value) {
    if (value == null) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

async function buildCaptureTileRendering(monster, entrypoint, version) {
    const tileRendering = {
        sprites: {
            main: {},
            player: {},
            gui: {},
            icons: {}
        },
        iconTiles: {},
        statusIconSizes: {},
        images: []
    };
    const images = {};

    if (!entrypoint || !version) {
        tileRendering.error = 'Missing WebTiles entrypoint or game client version.';
        return {tileRendering, images};
    }

    const modules = new Map();
    const baseUrl = entrypoint.replace(/\/$/, '');
    const tileRequests = collectTileRequests(monster);
    const textureNames = Object.keys(tileRequests).filter(texture => tileRequests[texture].size);

    for (const texture of textureNames) {
        const moduleName = tileInfoModuleName(texture);
        if (!moduleName) {
            continue;
        }
        const module = await loadWebtilesAmdModule(entrypoint, version, moduleName, modules);
        for (const tileId of tileRequests[texture]) {
            const info = compactTileInfo(module?.get_tile_info?.(tileId));
            if (info) {
                tileRendering.sprites[texture][tileId] = info;
            }
        }
    }

    if (tileRequests.icons.size) {
        const icons = await loadWebtilesAmdModule(entrypoint, version, 'tileinfo-icons', modules);
        const statusIconSizes = await loadWebtilesAmdModule(entrypoint, version, 'status-icon-sizes', modules)
            .catch(() => null);

        for (const name of STATUS_OVERLAY_ICON_NAMES) {
            const tileId = Number(icons?.[name]);
            if (Number.isFinite(tileId)) {
                tileRendering.iconTiles[name] = tileId;
                tileRequests.icons.add(tileId);
            }
        }

        for (const tileId of tileRequests.icons) {
            const info = compactTileInfo(icons?.get_tile_info?.(tileId));
            if (info) {
                tileRendering.sprites.icons[tileId] = info;
            }
            const size = Number(statusIconSizes?.status_icon_size?.(tileId));
            if (Number.isFinite(size) && size > 0) {
                tileRendering.statusIconSizes[tileId] = size;
            }
        }
    }

    for (const texture of textureNames) {
        images[texture] = await fetchTileImage(baseUrl, version, texture);
        tileRendering.images.push(texture);
    }

    return {tileRendering, images};
}

function collectTileRequests(monster) {
    const requests = {
        main: new Set(),
        player: new Set(),
        gui: new Set(),
        icons: new Set()
    };
    const parts = monsterTileParts(monster);

    if (parts.length) {
        for (const part of parts) {
            if (Number.isFinite(Number(part.tile))) {
                requests[part.texture || 'player'].add(Number(part.tile));
            }
        }
    } else {
        const tileId = monsterTileId(monster);
        if (Number.isFinite(Number(tileId))) {
            requests[monsterTileTexture(monster)].add(Number(tileId));
        }
    }

    for (const group of monster?.spellset || []) {
        for (const spell of group.spells || []) {
            if (Number.isFinite(Number(spell.tile))) {
                requests.gui.add(Number(spell.tile));
            }
        }
    }

    for (const iconId of monster?.icons || []) {
        if (Number.isFinite(Number(iconId))) {
            requests.icons.add(Number(iconId));
        }
    }

    if (monster?.flag != null || requests.icons.size) {
        requests.icons.add(0);
    }

    return requests;
}

function tileInfoModuleName(texture) {
    return {
        main: 'tileinfo-main',
        player: 'tileinfo-player',
        gui: 'tileinfo-gui',
        icons: 'tileinfo-icons'
    }[texture] || '';
}

function compactTileInfo(info) {
    if (!info) {
        return null;
    }

    const compact = {};
    for (const key of ['sx', 'sy', 'ex', 'ey', 'ox', 'oy', 'w', 'h']) {
        const value = Number(info[key]);
        if (Number.isFinite(value)) {
            compact[key] = value;
        }
    }
    return Number.isFinite(compact.sx) && Number.isFinite(compact.sy) &&
        Number.isFinite(compact.ex) && Number.isFinite(compact.ey)
        ? compact
        : null;
}

async function fetchTileImage(baseUrl, version, texture) {
    const response = await fetch(`${baseUrl}/gamedata/${version}/${texture}.png`);
    if (!response.ok) {
        throw new Error(`Could not load ${texture}.png: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get('content-type') || 'image/png';
    return {
        mime,
        data: buffer.toString('base64'),
        byteLength: buffer.length
    };
}

async function loadIconNameMap(entrypoint, version) {
    const modules = new Map();
    const icons = await loadWebtilesAmdModule(entrypoint, version, 'tileinfo-icons', modules);
    const byId = {};
    for (const [name, id] of Object.entries(icons || {})) {
        if (Number.isFinite(Number(id))) {
            byId[Number(id)] = name;
        }
    }
    return byId;
}

async function loadWebtilesAmdModule(entrypoint, version, moduleName, modules) {
    const name = moduleNameFromDependency(moduleName);
    if (modules.has(name)) {
        return modules.get(name);
    }

    const baseUrl = entrypoint.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/gamedata/${version}/${name}.js`);
    if (!response.ok) {
        throw new Error(`Could not load ${name}.js: ${response.status}`);
    }

    const source = await response.text();
    const dependencies = parseAmdDependencies(source);
    const resolvedDependencies = [];
    for (const dependency of dependencies) {
        resolvedDependencies.push(await loadWebtilesAmdModule(entrypoint, version, dependency, modules));
    }

    let exported = null;
    const define = (deps, factory) => {
        if (typeof deps === 'function') {
            factory = deps;
            deps = [];
        }
        exported = factory(...deps.map(dep => {
            const depName = moduleNameFromDependency(dep);
            const index = dependencies.map(moduleNameFromDependency).indexOf(depName);
            return index >= 0 ? resolvedDependencies[index] : modules.get(depName);
        }));
    };

    Function('define', `${source}\n//# sourceURL=goonkemon-${name}.js`)(define);
    if (!exported) {
        throw new Error(`Module ${name} did not export a value.`);
    }
    modules.set(name, exported);
    return exported;
}

function parseAmdDependencies(source) {
    const match = String(source || '').match(/define\(\s*(\[[\s\S]*?\])\s*,/);
    if (!match) {
        return [];
    }
    return Function(`"use strict"; return ${match[1]};`)();
}

function moduleNameFromDependency(name) {
    return String(name || '').replace(/^\.\//, '');
}

function isEligibleGoonkemonTitle(title) {
    const normalized = normalizeTitle(title);
    if (/\bpan(?:demonium)? lord\b/i.test(normalized)) {
        return true;
    }

    for (const lordName of EVENT_LORD_NAMES) {
        if (normalized === lordName ||
            normalized.startsWith(`${lordName},`) ||
            normalized.startsWith(`${lordName} the `)) {
            return true;
        }
    }

    return false;
}

function isEligibleGoonkemonMonster(monster) {
    if (isEligibleGoonkemonTitle(cleanText(monster?.title || ''))) {
        return true;
    }

    const body = cleanText(monster?.body || '');
    return /\bpandemonium\b/i.test(body) && /\bdemon lord\b|\blord of pandemonium\b|\blords of pandemonium\b/i.test(body);
}

function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/^the\s+/, '')
        .replace(/\.$/, '')
        .trim();
}

function parseMonsterStats(body) {
    const hpRaw = normalizeStatRaw(parseTextAfter(body, /Max HP:\s*(~?\s*\d+)/i));
    const hp = parseNumberAfter(body, /Max HP:\s*~?\s*(\d+)/i, 0);
    const willText = parseTextAfter(body, /Will:\s*([\u221e+\-.]+)/i);
    const acText = parseTextAfter(body, /\bAC:\s*([\u221e+\-\s.]+?)(?=\s+EV:|\n|$)/i);
    const evText = parseTextAfter(body, /\bEV:\s*(none|[\u221e+\-\s.]+?)(?=\s|$)/i);
    const speedPercent = parseNumberAfter(body, /Speed:\s*(\d+)%/i, 100);
    const attackDetails = parseAttackDamages(body);
    const resists = {
        rF: parseResist(body, /rF:\s*([\u221e+x.\- ]+)/i, RESIST_MAX.rF),
        rC: parseResist(body, /rC:\s*([\u221e+x.\- ]+)/i, RESIST_MAX.rC),
        rElec: parseResist(body, /rElec:\s*([\u221e+x.\- ]+)/i, RESIST_MAX.rElec)
    };

    const willPips = countPips(willText, 5);
    const acPips = countPips(acText, 6);
    const evPips = evText.toLowerCase() === 'none' ? 0 : countPips(evText, 6);

    return {
        hp: {
            raw: hpRaw || String(hp),
            value: hp
        },
        will: {
            raw: willText,
            pips: willPips
        },
        ac: {
            raw: acText,
            pips: acPips
        },
        ev: {
            raw: evText,
            pips: evPips
        },
        resists,
        attacks: {
            items: attackDetails
        },
        speed: {
            percent: speedPercent
        }
    };
}

function parseMonsterSpells(spellset) {
    const spells = [];
    for (const group of spellset) {
        for (const spell of group.spells || []) {
            const level = Number.isFinite(Number(spell.level))
                ? Number(spell.level)
                : parseNumberAfter(String(spell.range_string || ''), /\((?:[^0-9]*)(\d+)/, 0);
            spells.push({
                title: cleanText(spell.title || ''),
                level,
                effect: cleanText(spell.effect || ''),
                range: cleanText(spell.range_string || ''),
                schools: cleanText(spell.schools || '')
            });
        }
    }
    return spells;
}

function parseAttackDamages(body) {
    const lines = body.split('\n');
    const damages = [];
    let inTable = false;

    for (const line of lines) {
        if (/^Attacks?\s+Max Damage/i.test(line.trim())) {
            inTable = true;
            continue;
        }

        if (!inTable) {
            continue;
        }

        if (!line.trim()) {
            if (damages.length) {
                break;
            }
            continue;
        }

        const columns = line.trimEnd().split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
        if (columns.length >= 2) {
            const name = columns[0];
            const damageText = columns[1];
            const damageParts = damageNumbers(damageText);
            const damageTotal = damageParts.reduce((sum, number) => sum + number, 0);
            if (damageTotal > 0) {
                damages.push({
                    name,
                    damageText,
                    damageParts,
                    damageTotal,
                    afterHit: columns.slice(2).join(' ')
                });
            }
        }
    }

    return damages;
}

function damageNumbers(value) {
    return (String(value || '').match(/\d+/g) || [])
        .map(Number);
}

function parseResist(body, pattern, maxResist) {
    const raw = parseTextAfter(body, pattern);
    return {
        raw,
        value: countSignedPips(raw, maxResist * 2),
        max: maxResist
    };
}

function parseNumberAfter(text, pattern, fallback) {
    const match = text.match(pattern);
    return match ? Number(match[1]) : fallback;
}

function normalizeStatRaw(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseTextAfter(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : '';
}

function countPips(value, infinityValue) {
    const text = String(value || '');
    if (text.includes(INFINITY_GLYPH)) {
        return infinityValue;
    }
    return (text.match(/\+/g) || []).length;
}

function countSignedPips(value, infinityValue) {
    const text = String(value || '');
    if (text.includes(INFINITY_GLYPH)) {
        return infinityValue;
    }
    const positive = (text.match(/\+/g) || []).length;
    const negative = (text.match(/[x-]/gi) || []).length;
    return positive - negative;
}

function cleanText(value) {
    return decodeEntities(stripTags(String(value || ''))).replace(/[ \t]+\n/g, '\n').trim();
}

function stripTags(value) {
    return value.replace(/<[^>]*>/g, '');
}

function decodeEntities(value) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' '
    };
    return value.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => entities[entity] || entity);
}

function safeFilename(value) {
    return String(value || 'unknown')
        .trim()
        .replace(/[^a-z0-9_.-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'unknown';
}

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function formatSuccessMessage(score, detailUrl = '') {
    const title = displayCaptureTitle(score?.title);
    const points = Number.isFinite(Number(score?.total)) ? String(score.total) : '?';
    const url = String(detailUrl || '').trim();
    return `${title} (${points} pts)${url ? ` - ${url}` : ''}`;
}

export function captureDetailUrl(publicBaseUrl, id) {
    const baseUrl = String(publicBaseUrl || DEFAULT_PUBLIC_BASE_URL).trim().replace(/\/+$/, '');
    const captureId = String(id || '').trim();
    return captureId ? `${baseUrl}/${encodeURIComponent(captureId)}` : baseUrl;
}

function formatFailureMessage(error) {
    const reason = String(error?.message || error || 'unknown error').replace(/\s+/g, ' ').trim();
    return `Goonkemon: could not score this x-v target: ${reason}`;
}

function safeCaptureTitle(value) {
    return safeFilename(value)
        .replace(/\./g, '')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'unknown';
}

function displayCaptureTitle(value) {
    return String(value || 'Unknown Goonkemon')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/g, '')
        .trim() || 'Unknown Goonkemon';
}

function captureVersionText(capture) {
    const webtiles = capture?.webtiles || {};
    const gameStarted = webtiles.gameStarted || {};
    return String(
        webtiles.versionText ||
        gameStarted.version ||
        gameStarted.game_version ||
        gameStarted.versionText ||
        webtiles.gameClientVersion ||
        ''
    ).trim();
}

export function renderMonsterHtml(capture, jsonFilename = '', imagesFilename = '') {
    const analysis = capture.analysis || capture.score || analyzeGoonkemonMonster(capture.monster);
    const {monster, username, capturedAt} = capture;
    const title = analysis.title || cleanText(monster?.title || 'Unknown');
    const tileId = monsterTileId(monster);
    const tileTexture = monsterTileTexture(monster);
    const tileParts = monsterTileParts(monster);
    const body = renderMonsterBody(monster);
    const status = monster.status
        ? `<section class="menu-section status-section">
<div class="section-title">Status</div>
<div class="desc-text">${renderCrawlMarkup(String(monster.status || '').trim())}</div>
</section>`
        : '';
    const sourceJson = jsonFilename || `${capture.id || 'capture'}.json`;
    const sourceImages = imagesFilename || sourceJson.replace(/\.json$/i, '.images.json');
    const versionText = captureVersionText(capture);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} - Goonkemon</title>
<style>
:root {
    color-scheme: dark;
    --crawl-bg: #050505;
    --crawl-panel: #0b0b0b;
    --crawl-panel-2: #151515;
    --crawl-border: #757575;
    --crawl-border-dim: #333;
    --crawl-text: #d6d6d6;
    --crawl-dim: #9a9a9a;
    --crawl-yellow: #ffff55;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    min-height: 100vh;
    background: #111;
    color: var(--crawl-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 14px;
    line-height: 1.3;
}
main {
    width: min(1080px, calc(100vw - 24px));
    margin: 12px auto;
}
.ui-window {
    background: var(--crawl-bg);
    border: 2px solid var(--crawl-border);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
}
.menu-titlebar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--crawl-border-dim);
    background: #101010;
}
.monster-tile {
    width: 48px;
    height: 48px;
    image-rendering: pixelated;
}
h1 {
    margin: 0;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
}
.score-badge {
    color: var(--crawl-yellow);
    white-space: nowrap;
}
.menu-body {
    padding: 10px 12px 12px;
}
.desc-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.spellset {
    margin: 8px 0 10px;
}
.spell-label {
    margin: 4px 0;
    white-space: pre-wrap;
}
.spell-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.spell-item {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 1px 0;
}
.spell-item canvas {
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
}
.spell-line {
    min-width: 0;
    color: inherit;
}
.spell-key {
    color: #fff;
}
.spell-name {
    color: inherit;
}
.spell-meta {
	    color: var(--crawl-dim);
	}
	.score-loading,
	.score-error {
	    margin-top: 8px;
	    color: var(--crawl-dim);
	}
	.score-error {
	    color: #ff5555;
	}
	.status-loading,
	.status-empty {
	    color: var(--crawl-dim);
	}
	.status-groups {
	    display: grid;
	    gap: 6px;
	}
	.status-group {
	    display: grid;
	    grid-template-columns: 86px minmax(0, 1fr);
	    gap: 8px;
	    align-items: start;
	}
	.status-group-label {
	    color: var(--crawl-dim);
	}
	.status-tags {
	    display: flex;
	    flex-wrap: wrap;
	    gap: 4px;
	}
	.status-tag {
	    border: 1px solid var(--crawl-border-dim);
	    background: #101010;
	    padding: 1px 5px;
	    color: #dcdcdc;
	}
	.status-buff {
	    color: #55ff55;
	}
	.status-debuff {
	    color: #ff5555;
	}
	.status-special {
	    color: #55ffff;
	}
	.status-attitude {
	    color: #d6d6d6;
	}
	.status-unknown {
	    color: #ffff55;
	}
	.menu-section {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--crawl-border-dim);
}
.section-title {
    margin-bottom: 4px;
    color: #fff;
}
	.score-grid {
	    display: grid;
	    grid-template-columns: repeat(4, minmax(88px, 1fr));
	    gap: 1px;
	    margin: 8px 0 0;
    background: var(--crawl-border-dim);
    border: 1px solid var(--crawl-border-dim);
}
.score-cell {
    min-width: 0;
    padding: 5px 6px;
    background: var(--crawl-panel-2);
}
.score-label {
    color: var(--crawl-dim);
}
	.score-value {
	    color: #fff;
	}
	.score-detail {
	    display: grid;
	    gap: 10px;
	    margin-top: 10px;
	}
	.score-equations {
	    display: grid;
	    gap: 2px;
	    color: #dcdcdc;
	}
	.score-equation strong,
	.score-subtitle {
	    color: #fff;
	    font-weight: 400;
	}
	.score-table {
	    width: 100%;
	    border-collapse: collapse;
	    table-layout: fixed;
	    background: var(--crawl-bg);
	}
	.score-table th,
	.score-table td {
	    padding: 4px 6px;
	    border: 1px solid var(--crawl-border-dim);
	    text-align: left;
	    vertical-align: top;
	}
	.score-table th {
	    color: var(--crawl-dim);
	    background: #101010;
	    font-weight: 400;
	}
	.score-points {
	    width: 72px;
	    color: #fff;
	    text-align: right;
	    white-space: nowrap;
	}
	.score-empty {
	    color: var(--crawl-dim);
	}
	.source {
	    margin-top: 8px;
	    color: var(--crawl-dim);
	    font-size: 12px;
	}
.lightgrey, .lightgray { color: #b8b8b8; }
.darkgrey, .darkgray { color: #666; }
.white, .w { color: #fff; }
.yellow { color: #ffff55; }
.red { color: #aa0000; }
.lightred { color: #ff5555; }
.green { color: #00aa00; }
.lightgreen { color: #55ff55; }
.blue { color: #5555ff; }
.lightblue { color: #7777ff; }
.magenta { color: #aa00aa; }
.lightmagenta { color: #ff55ff; }
.cyan { color: #00aaaa; }
.lightcyan { color: #55ffff; }
.brown { color: #aa5500; }
.fg0 { color: #050505; }
.fg1 { color: #5555ff; }
.fg2 { color: #00aa00; }
.fg3 { color: #00aaaa; }
.fg4 { color: #aa0000; }
.fg5 { color: #aa00aa; }
.fg6 { color: #aa5500; }
.fg7 { color: #b8b8b8; }
.fg8 { color: #666; }
.fg9 { color: #7777ff; }
.fg10 { color: #55ff55; }
.fg11 { color: #55ffff; }
.fg12 { color: #ff5555; }
.fg13 { color: #ff55ff; }
.fg14 { color: #ffff55; }
.fg15 { color: #fff; }
@media (max-width: 720px) {
	    main { width: calc(100vw - 8px); margin: 4px auto; }
	    .menu-titlebar { grid-template-columns: auto 1fr; }
	    .score-badge { grid-column: 2; }
	    .score-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	    .score-table { table-layout: auto; }
	}
</style>
</head>
<body>
<main>
<section class="ui-window" role="document" aria-label="Goonkemon monster capture">
<div class="menu-titlebar">
${renderTileCanvas(tileId, titleInitials(title), tileTexture, 'monster-tile', title, tileParts, monsterTileStatusAttributes(monster))}
<h1>${escapeHtml(title)}</h1>
<div class="score-badge" data-score-badge>...</div>
</div>
<div class="menu-body">
${body}
${status}
		<section class="menu-section">
		<div class="section-title">Tile status</div>
		<div id="goonkemon-status-indicators">
		<div class="status-loading">Loading status indicators...</div>
		</div>
		</section>
		<section class="menu-section">
		<div class="section-title">Goonkemon score</div>
		<div id="goonkemon-score" data-json="${escapeAttribute(sourceJson)}" data-images="${escapeAttribute(sourceImages)}">
		<div class="score-loading">Loading score from ${escapeHtml(sourceJson)}...</div>
		</div>
		<div class="source">Captured for ${escapeHtml(username)} at <span data-captured-at="${escapeAttribute(capturedAt)}">${escapeHtml(capturedAt)}</span>${versionText ? ` (${escapeHtml(versionText)})` : ''}.</div>
		</section>
	</div>
</section>
</main>
<script type="module">
import {renderScoreHtml, scoreAnalysis} from './score-rules.js';

const scoreRoot = document.getElementById('goonkemon-score');
const statusRoot = document.getElementById('goonkemon-status-indicators');
const badge = document.querySelector('[data-score-badge]');
const jsonPath = scoreRoot?.dataset.json || '';
const imagePath = scoreRoot?.dataset.images || jsonPath.replace(/\\.json$/i, '.images.json');

async function renderDynamicScore() {
    try {
        const capture = await fetchJson(jsonPath);
        const analysis = capture.analysis || capture.score;
        if (!analysis) {
            throw new Error('Capture JSON has no analysis data.');
        }
        const score = scoreAnalysis(analysis);
        scoreRoot.innerHTML = renderScoreHtml(analysis);
        if (statusRoot) {
            statusRoot.innerHTML = renderStatusHtml(analysis.statuses);
        }
        if (badge) {
            badge.textContent = score.total + ' pts';
        }
    } catch (error) {
        scoreRoot.innerHTML = '<div class="score-error">' + escapeHtml(String(error.message || error)) + '</div>';
        if (statusRoot) {
            statusRoot.innerHTML = '<div class="score-error">' + escapeHtml(String(error.message || error)) + '</div>';
        }
        if (badge) {
            badge.textContent = 'score unavailable';
        }
    }
}

async function fetchJson(path) {
    const response = await fetch(path, {cache: 'no-store'});
    if (!response.ok) {
        throw new Error('Could not load ' + path + ': ' + response.status);
    }
    return response.json();
}

function renderStatusHtml(statuses = {}) {
    const groups = [
        ['attitude', 'Attitude', 'status-attitude'],
        ['buffs', 'Buffs', 'status-buff'],
        ['debuffs', 'Debuffs', 'status-debuff'],
        ['special', 'Special', 'status-special'],
        ['unknown', 'Unknown', 'status-unknown']
    ];
    const rows = groups
        .map(([key, label, className]) => {
            const items = Array.isArray(statuses[key]) ? statuses[key] : [];
            if (!items.length) {
                return '';
            }
            const tags = items.map(item => {
                const title = item.id == null ? item.source : item.source + ' #' + item.id;
                return '<span class="status-tag ' + className + '" title="' + escapeHtml(title) + '">' +
                    escapeHtml(item.label || item.name) + '</span>';
            }).join('');
            return '<div class="status-group"><div class="status-group-label">' + label + '</div>' +
                '<div class="status-tags">' + tags + '</div></div>';
        })
        .filter(Boolean)
        .join('');
    return rows ? '<div class="status-groups">' + rows + '</div>' :
        '<div class="status-empty">No tile status indicators.</div>';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function formatCaptureTimes() {
    document.querySelectorAll('[data-captured-at]').forEach(element => {
        const raw = element.dataset.capturedAt || '';
        const date = new Date(raw);
        if (Number.isNaN(date.valueOf())) {
            return;
        }
        element.textContent = formatDateTime(date);
        element.title = raw;
    });
}

function formatDateTime(date) {
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    };
    try {
        return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch (error) {
        return date.toLocaleString();
    }
}

formatCaptureTimes();
renderDynamicScore();
</script>
<script>
(() => {
    const scoreRoot = document.getElementById('goonkemon-score');
    const jsonPath = scoreRoot?.dataset.json || '';
    const imagePath = scoreRoot?.dataset.images || jsonPath.replace(/\\.json$/i, '.images.json');
    const canvases = Array.from(document.querySelectorAll('canvas[data-tile]'));
    const images = {};
    let tileRendering = {};

    function drawFallback(canvas) {
        const ctx = canvas.getContext('2d');
        const tile = Number(canvas.dataset.tile || 0);
        const label = canvas.dataset.label || '?';
        const hue = Math.abs((tile * 47) % 360);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'hsl(' + hue + ' 80% 62%)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
        ctx.fillStyle = 'hsl(' + hue + ' 72% 48% / 0.35)';
        ctx.fillRect(5, 5, canvas.width - 10, canvas.height - 10);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + Math.max(12, Math.floor(canvas.height * 0.34)) + 'px monospace';
        ctx.fillText(label.slice(0, 3), canvas.width / 2, canvas.height / 2 - 2);
        ctx.fillStyle = '#aaa';
        ctx.font = '8px monospace';
        ctx.fillText(String(tile || ''), canvas.width / 2, canvas.height - 7);
    }

    function loadImage(name, imageData) {
        return new Promise((resolve, reject) => {
            const source = imageData?.dataUrl || (imageData?.data
                ? 'data:' + (imageData.mime || 'image/png') + ';base64,' + imageData.data
                : '');
            if (!source) {
                reject(new Error('Missing image data for ' + name));
                return;
            }
            const image = new Image();
            image.onload = () => {
                images[name] = image;
                resolve(image);
            };
            image.onerror = () => reject(new Error('Could not load stored ' + name + ' image'));
            image.src = source;
        });
    }

    function drawSprite(canvas) {
        const parts = parseTileParts(canvas);
        if (parts.length) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            return parts.map(part => drawSpritePart(canvas, part, false)).every(Boolean);
        }

        return drawSpritePart(canvas, {
            texture: canvas.dataset.texture || 'main',
            tile: Number(canvas.dataset.tile || 0),
            xofs: 0,
            yofs: 0,
            clear: true
        }, true);
    }

    function parseTileParts(canvas) {
        if (!canvas.dataset.parts) {
            return [];
        }
        try {
            const parsed = JSON.parse(canvas.dataset.parts);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function drawSpritePart(canvas, part, clear) {
        const texture = part.texture || 'main';
        const tile = Number(part.tile || 0);
        const image = images[texture];
        const info = tileRendering?.sprites?.[texture]?.[tile];
        if (!image || !info) {
            return false;
        }

        const ctx = canvas.getContext('2d');
        const sw = Math.max(1, info.ex - info.sx);
        const sh = Math.max(1, info.ey - info.sy);
        const scale = Math.min(canvas.width, canvas.height) / 32;
        const sizeOx = 16 - Number(info.w || 0) / 2;
        const sizeOy = 32 - Number(info.h || 0);
        const xofs = Number(part.xofs || 0);
        const yAdjust = part.adjustY ? Math.max(0, Number(info.h || 0) - 32) : 0;
        const yofs = Number(part.yofs || 0) + yAdjust;
        const dx = Math.round((canvas.width - 32 * scale) / 2 + (xofs + Number(info.ox || 0) + sizeOx) * scale);
        const dy = Math.round((canvas.height - 32 * scale) / 2 + (yofs + Number(info.oy || 0) + sizeOy) * scale);
        if (clear) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, info.sx, info.sy, sw, sh, dx, dy,
            Math.ceil(sw * scale), Math.ceil(sh * scale));
        return true;
    }

    function drawIconPart(canvas, tile, xofs, yofs) {
        const image = images.icons;
        const info = tileRendering?.sprites?.icons?.[Number(tile || 0)];
        if (!image || !info) {
            return false;
        }

        const ctx = canvas.getContext('2d');
        const sw = Math.max(1, info.ex - info.sx);
        const sh = Math.max(1, info.ey - info.sy);
        const scale = Math.min(canvas.width, canvas.height) / 32;
        const sizeOx = 16 - Number(info.w || 0) / 2;
        const sizeOy = 32 - Number(info.h || 0);
        const dx = Math.round((canvas.width - 32 * scale) / 2 + ((xofs || 0) + Number(info.ox || 0) + sizeOx) * scale);
        const dy = Math.round((canvas.height - 32 * scale) / 2 + ((yofs || 0) + Number(info.oy || 0) + sizeOy) * scale);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, info.sx, info.sy, sw, sh, dx, dy,
            Math.ceil(sw * scale), Math.ceil(sh * scale));
        return true;
    }

    function drawStatusOverlays(canvas) {
        if (canvas.dataset.monsterTile !== 'true' || !images.icons) {
            return;
        }

        const iconIds = parseJsonData(canvas.dataset.icons, []);
        const flag = parseFlagPair(parseJsonData(canvas.dataset.flag, null));
        const icons = tileRendering.iconTiles || {};
        let statusShift = 0;

        if ((flag[0] & 0x00800000) === 0x00800000) {
            drawIconPart(canvas, icons.TRAP_NET, 0, 0);
        }
        if ((flag[0] & 0x01000000) === 0x01000000) {
            drawIconPart(canvas, icons.TRAP_WEB, 0, 0);
        }
        if ((flag[0] & 0x00040000) === 0x00040000) {
            drawIconPart(canvas, icons.SOMETHING_UNDER, 0, 0);
        }

        const attitude = flag[0] & 0x00030000;
        if (attitude === 0x00010000) {
            drawIconPart(canvas, icons.FRIENDLY, 0, 0);
        } else if (attitude === 0x00020000) {
            drawIconPart(canvas, icons.GOOD_NEUTRAL, 0, 0);
        } else if (attitude === 0x00030000) {
            drawIconPart(canvas, icons.NEUTRAL, 0, 0);
        }

        const behaviour = flag[0] & 0x00700000;
        if (behaviour === 0x00400000 && drawIconPart(canvas, icons.PARALYSED, 0, 0)) {
            statusShift += 12;
        } else if (behaviour === 0x00100000 && drawIconPart(canvas, icons.STAB_BRAND, 0, 0)) {
            statusShift += 12;
        } else if (behaviour === 0x00200000 && drawIconPart(canvas, icons.UNAWARE, 0, 0)) {
            statusShift += 7;
        } else if (behaviour === 0x00300000 && drawIconPart(canvas, icons.FLEEING, 0, 0)) {
            statusShift += 3;
        }

        const poison = flag[1] & 0x18000000;
        if (poison === 0x08000000 && drawIconPart(canvas, icons.POISON, -statusShift, 0)) {
            statusShift += 5;
        } else if (poison === 0x10000000 && drawIconPart(canvas, icons.MORE_POISON, -statusShift, 0)) {
            statusShift += 5;
        } else if (poison === 0x18000000 && drawIconPart(canvas, icons.MAX_POISON, -statusShift, 0)) {
            statusShift += 5;
        }

        for (const iconId of iconIds) {
            if (drawIconPart(canvas, Number(iconId), -statusShift, 0)) {
                statusShift += statusIconSize(Number(iconId));
            }
        }
    }

    function statusIconSize(iconId) {
        const size = Number(tileRendering?.statusIconSizes?.[iconId]);
        return Number.isFinite(size) && size > 0 ? size : 0;
    }

    function parseJsonData(value, fallback) {
        try {
            return JSON.parse(value || '');
        } catch (error) {
            return fallback;
        }
    }

    function parseFlagPair(value) {
        if (Array.isArray(value)) {
            return [Number(value[0] || 0) >>> 0, Number(value[1] || 0) >>> 0];
        }
        if (Number.isFinite(Number(value))) {
            return [Number(value) >>> 0, 0];
        }
        return [0, 0];
    }

    async function renderTiles() {
        canvases.forEach(drawFallback);
        if (!jsonPath || !imagePath) {
            return;
        }
        try {
            const [capture, imageBundle] = await Promise.all([fetchJson(jsonPath), fetchJson(imagePath)]);
            tileRendering = capture.tileRendering || {};
            const storedImages = imageBundle.images || {};
            await Promise.all(Object.entries(storedImages).map(([name, data]) => loadImage(name, data)));
            canvases.forEach(canvas => {
                if (!drawSprite(canvas)) {
                    drawFallback(canvas);
                }
                drawStatusOverlays(canvas);
            });
        } catch (error) {
            console.warn('Goonkemon tile sprite fallback:', error.message || error);
        }
    }

    async function fetchJson(path) {
        const response = await fetch(path, {cache: 'no-store'});
        if (!response.ok) {
            throw new Error('Could not load ' + path + ': ' + response.status);
        }
        return response.json();
    }

    renderTiles();
})();
</script>
</body>
</html>
`;
}

function renderMonsterBody(monster) {
    const raw = String(monster.body || '').trim();
    const marker = 'SPELLSET_PLACEHOLDER';
    const spellset = renderSpellGroups(monster.spellset || []);

    if (!raw.includes(marker)) {
        return `<div class="desc-text">${renderCrawlMarkup(raw)}</div>${spellset}`;
    }

    const markerIndex = raw.indexOf(marker);
    const before = raw.slice(0, markerIndex).trimEnd();
    const after = raw.slice(markerIndex + marker.length).trimStart();
    return `<div class="desc-text">${renderCrawlMarkup(before)}</div>${spellset}` +
        `<div class="desc-text">${renderCrawlMarkup(after)}</div>`;
}

function renderSpellGroups(spellset) {
    if (!Array.isArray(spellset) || !spellset.length) {
        return '';
    }

    const groups = spellset.map(group => {
        const spells = Array.isArray(group.spells) ? group.spells : [];
        if (!spells.length) {
            return '';
        }

        const label = String(group.label || '').trim();
        const rows = spells.map(spell => {
            const title = cleanText(spell.title || '');
            const letter = cleanText(spell.letter || '');
            const meta = [
                spell.effect ? renderCrawlMarkup(String(spell.effect)) : '',
                spell.range_string ? renderCrawlMarkup(String(spell.range_string)) : '',
                spell.schools ? escapeHtml(spell.schools) : '',
                Number.isFinite(Number(spell.level)) ? `L${Number(spell.level)}` : ''
            ].filter(Boolean).join(' ');

            return `<li class="spell-item fg${Number(spell.colour) || 7}">
${renderTileCanvas(spell.tile, letter || titleInitials(title), 'gui', '', title)}
<div class="spell-line"><span class="spell-key">${escapeHtml(letter)}</span> - <span class="spell-name">${escapeHtml(title)}</span> <span class="spell-meta">${meta}</span></div>
</li>`;
        }).join('\n');

        return `<div class="spellset">
${label ? `<div class="spell-label">${renderCrawlMarkup(label)}</div>` : ''}
<ol class="spell-list">${rows}</ol>
</div>`;
    }).join('\n');

    return groups.trim();
}

function renderTileCanvas(tileId, label, texture, className, title, parts = [], extraAttributes = '') {
    const partsAttribute = parts.length
        ? ` data-parts="${escapeAttribute(JSON.stringify(parts))}"`
        : '';
    const attributes = extraAttributes ? ` ${extraAttributes.trim()}` : '';
    if (!Number.isFinite(Number(tileId))) {
        return `<canvas class="${escapeAttribute(className)}" width="48" height="48" data-tile="0" data-texture="${escapeAttribute(texture)}" data-label="${escapeAttribute(label)}" title="${escapeAttribute(title || '')}"${partsAttribute}${attributes}></canvas>`;
    }

    return `<canvas class="${escapeAttribute(className)}" width="48" height="48" data-tile="${escapeAttribute(tileId)}" data-texture="${escapeAttribute(texture)}" data-label="${escapeAttribute(label)}" title="${escapeAttribute(title || '')}"${partsAttribute}${attributes}></canvas>`;
}

function monsterTileStatusAttributes(monster) {
    const icons = Array.isArray(monster?.icons)
        ? monster.icons.map(icon => Number(icon)).filter(Number.isFinite)
        : [];
    return [
        'data-monster-tile="true"',
        `data-icons="${escapeAttribute(JSON.stringify(icons))}"`,
        `data-flag="${escapeAttribute(JSON.stringify(monster?.flag ?? null))}"`
    ].join(' ');
}

function monsterTileId(monster) {
    const firstPart = monsterTileParts(monster)[0];
    if (firstPart) {
        return firstPart.tile;
    }

    if (Number.isFinite(Number(monster?.fg_idx))) {
        return Number(monster.fg_idx);
    }

    const firstDollTile = Array.isArray(monster?.doll) ? monster.doll.find(part =>
        Array.isArray(part) && Number.isFinite(Number(part[0]))
    ) : null;
    if (firstDollTile) {
        return Number(firstDollTile[0]);
    }

    return null;
}

function monsterTileTexture(monster) {
    if (monsterTileParts(monster).length) {
        return 'player';
    }
    return 'main';
}

function monsterTileParts(monster) {
    const mcacheMap = new Map();
    if (Array.isArray(monster?.mcache)) {
        for (const part of monster.mcache) {
            if (Array.isArray(part) && Number.isFinite(Number(part[0]))) {
                mcacheMap.set(Number(part[0]), {
                    xofs: Number(part[1]) || 0,
                    yofs: Number(part[2]) || 0
                });
            }
        }
    }

    if (Array.isArray(monster?.doll) && monster.doll.length) {
        return monster.doll
            .filter(part => Array.isArray(part) && Number.isFinite(Number(part[0])))
            .map(part => {
                const tile = Number(part[0]);
                const mcache = mcacheMap.get(tile) || {xofs: 0, yofs: 0};
                return {
                    texture: 'player',
                    tile,
                    xofs: mcache.xofs,
                    yofs: mcache.yofs,
                    adjustY: true
                };
            });
    }

    if (Array.isArray(monster?.mcache) && monster.mcache.length) {
        return monster.mcache
            .filter(part => Array.isArray(part) && Number.isFinite(Number(part[0])))
            .map(part => ({
                texture: 'player',
                tile: Number(part[0]),
                xofs: Number(part[1]) || 0,
                yofs: Number(part[2]) || 0,
                adjustY: true
            }));
    }

    return [];
}

function titleInitials(value) {
    const words = cleanText(value).split(/\s+/).filter(word => /^[a-z0-9]/i.test(word));
    const initials = words.slice(0, 2).map(word => word[0]).join('').toUpperCase();
    return initials || '?';
}

function normalizeCrawlColour(tag) {
    const name = String(tag || '').toLowerCase();
    const aliases = {
        lightgray: 'lightgrey',
        darkgray: 'darkgrey',
        w: 'white'
    };
    const normalized = aliases[name] || name;
    return /^(black|blue|green|cyan|red|magenta|brown|lightgrey|darkgrey|lightblue|lightgreen|lightcyan|lightred|lightmagenta|yellow|white)$/.test(normalized)
        ? normalized
        : '';
}

function renderCrawlMarkup(value) {
    const escaped = escapeHtml(value);
    let open = false;
    const rendered = escaped.replace(/&lt;(\/?)([a-z]+)&gt;/gi, (match, closing, tag) => {
        const name = normalizeCrawlColour(tag);
        if (!name) {
            return '';
        }
        if (closing) {
            if (!open) {
                return '';
            }
            open = false;
            return '</span>';
        }

        const prefix = open ? '</span>' : '';
        open = true;
        return `${prefix}<span class="${name}">`;
    });

    return open ? `${rendered}</span>` : rendered;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeJsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
}

function sameUsername(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
