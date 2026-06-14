import * as fs from 'fs';
import * as path from 'path';
import {GoonkemonBot} from "./goonkemon.js";
import {createWebtilesSocket, WebSocket} from "./webtiles-socket.js";

const DEFAULT_TEST_CONFIG = 'config.test.json';
const DEFAULT_ADMIN_USERNAME = 'Translator1';
const DEFAULT_COUNT = 101;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SPRINT_MAP_HOTKEY = 'e';
const DEFAULT_DISMISS_SCOPE = 'los';
const NAMED_LORDS = [
    'Lom Lobon',
    'Cerebov',
    'Gloorx Vloq',
    'Ereshkigal',
    'Mnoleg'
];

const configPath = process.env.GOONKEMON_CONFIG || DEFAULT_TEST_CONFIG;
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const stressConfig = {
    ...config,
    websocket: process.env.GOONKEMON_WEBSOCKET || config.websocket,
    username: process.env.GOONKEMON_USERNAME || config.username,
    password: process.env.GOONKEMON_PASSWORD || config.password,
    email: process.env.GOONKEMON_EMAIL || config.email,
    autoRegister: process.env.GOONKEMON_AUTO_REGISTER === 'true' || config.autoRegister,
    publicChatUsername: process.env.GOONKEMON_PUBLIC_CHAT_USERNAME || config.publicChatUsername,
    storageDir: process.env.GOONKEMON_STORAGE_DIR || config.storageDir || 'data/goonkemon-test',
    captureTimeoutMs: Number(process.env.GOONKEMON_CAPTURE_TIMEOUT_MS || config.captureTimeoutMs || 2500)
};
const adminUsername = process.env.GOONKEMON_TEST_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
const adminPassword = process.env.GOONKEMON_TEST_ADMIN_PASSWORD || '';
const publicRoomUsername = process.env.GOONKEMON_TEST_PUBLIC_USERNAME || '';
const publicRoomPassword = process.env.GOONKEMON_TEST_PUBLIC_PASSWORD || adminPassword;
const explicitGameId = process.env.GOONKEMON_TEST_GAME_ID || '';
const count = Number(process.env.GOONKEMON_TEST_COUNT || DEFAULT_COUNT);
const restoreRc = process.env.GOONKEMON_TEST_RESTORE_RC !== 'false';
const cleanStorage = process.env.GOONKEMON_TEST_CLEAN_STORAGE === 'true';
const sprintMapHotkey = process.env.GOONKEMON_TEST_SPRINT_MAP_HOTKEY || DEFAULT_SPRINT_MAP_HOTKEY;
const dismissScope = process.env.GOONKEMON_TEST_DISMISS_SCOPE || DEFAULT_DISMISS_SCOPE;

if (!adminPassword) {
    throw new Error('Set GOONKEMON_TEST_ADMIN_PASSWORD for the test server admin account.');
}

async function main() {
    const player = new WebtilesClient(stressConfig.websocket, 'player');
    const trigger = new WebtilesClient(stressConfig.websocket, 'trigger');
    const publicRoom = publicRoomUsername
        ? new WebtilesClient(stressConfig.websocket, 'public-room')
        : null;
    let bot = null;
    let originalRc = null;
    let publicRoomOriginalRc = null;
    let gameId = explicitGameId;

    try {
        if (cleanStorage) {
            fs.rmSync(stressConfig.storageDir, {recursive: true, force: true});
        }

        await player.connect();
        await player.login(adminUsername, adminPassword);
        gameId = gameId || await player.firstPlayableGameId();
        console.log(new Date(), `Using game ${gameId}; sprint map hotkey ${sprintMapHotkey}`);

        originalRc = await player.getRc(gameId);

        if (publicRoom) {
            stressConfig.publicChatUsername = publicRoomUsername;
            await publicRoom.connect();
            await publicRoom.login(publicRoomUsername, publicRoomPassword);
            publicRoomOriginalRc = await publicRoom.getRc(gameId);
            await publicRoom.setRc(gameId, withStressRc(publicRoomOriginalRc));
            await publicRoom.play(gameId);
            await publicRoom.waitForGameReady();
            console.log(new Date(), `Using ${publicRoomUsername} as temporary public chat room`);
        }

        bot = new GoonkemonBot(stressConfig);
        await bot.connect();
        await player.setRc(gameId, withStressRc(originalRc));
        await player.play(gameId);
        await player.waitForGameReady();

        await trigger.connect();
        await trigger.login(adminUsername, adminPassword);
        await trigger.watch(stressConfig.publicChatUsername);

        await enterWizardMode(player);
        await dismissMonsters(player);

        const startedWith = countJsonFiles(stressConfig.storageDir);
        const results = [];
        for (let i = 0; i < count; i++) {
            const monsterName = monsterNameForIteration(i);
            const before = countJsonFiles(stressConfig.storageDir);
            console.log(new Date(), `(${i + 1}/${count}) creating ${monsterName}`);

            await dismissMonsters(player);
            await createMonster(player, monsterName);
            const monster = await openMonsterDescription(player).catch(error => {
                logRecentDiagnostics(player, `Could not open description after creating ${monsterName}`);
                throw error;
            });
            const lastResult = results.at(-1);
            if (lastResult && cleanText(monster.title) === cleanText(lastResult.described)) {
                throw new Error(`Opened the same monster description twice: ${monster.title}`);
            }
            await trigger.chat(stressConfig.trigger || 'gotcha!');
            await waitForJsonCount(stressConfig.storageDir, before + 1, DEFAULT_TIMEOUT_MS);

            results.push({
                index: i + 1,
                requested: monsterName,
                described: monster.title
            });

            await player.escape();
            await dismissMonsters(player);
        }

        const finishedWith = countJsonFiles(stressConfig.storageDir);
        console.log(new Date(), `Goonkemon stress test completed: ${finishedWith - startedWith} captures saved.`);
        console.log(JSON.stringify({
            requested: count,
            saved: finishedWith - startedWith,
            first: results.slice(0, 3),
            last: results.slice(-3)
        }, null, 2));
    } finally {
        if (restoreRc && originalRc != null && gameId) {
            await player.setRc(gameId, originalRc).catch(error => {
                console.warn(new Date(), 'Could not restore original rc:', error.message || error);
            });
        }
        if (restoreRc && publicRoomOriginalRc != null && gameId && publicRoom) {
            await publicRoom.setRc(gameId, publicRoomOriginalRc).catch(error => {
                console.warn(new Date(), 'Could not restore public room rc:', error.message || error);
            });
        }
        bot?.stop();
        player.close();
        trigger.close();
        publicRoom?.close();
    }
}

class WebtilesClient {
    constructor(websocket, label, logger = console) {
        this.websocket = websocket;
        this.label = label;
        this.logger = logger;
        this.socket = null;
        this.waiters = [];
        this.messages = [];
        this.playerState = {};
        this.autoNewgameChoice = false;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = extendSocket(createWebtilesSocket(this.websocket, {
                handleMessage: data => this.handleMessage(data),
                logger: this.logger
            }));
            this.socket.onopen = resolve;
            this.socket.onerror = reject;
            this.socket.onclose = event => this.rejectAll(new Error(event?.reason || `${this.label} socket closed`));
        });
    }

    close() {
        this.socket?.close?.();
    }

    handleMessage(data) {
        if (data?.msg === 'ping') {
            this.socket?.pong();
            return;
        }

        if (this.autoNewgameChoice && data?.msg === 'ui-push' && data.type === 'newgame-choice') {
            const hotkey = selectedNewgameChoiceHotkey(data);
            if (Number.isFinite(hotkey)) {
                setTimeout(() => this.socket?.input(String.fromCharCode(hotkey)), 150);
            }
        }

        if (data?.msg === 'player') {
            Object.assign(this.playerState, data);
        }

        this.messages.push(data);
        const remaining = [];
        for (const waiter of this.waiters) {
            if (waiter.predicate(data)) {
                clearTimeout(waiter.timer);
                waiter.resolve(data);
            } else {
                remaining.push(waiter);
            }
        }
        this.waiters = remaining;
    }

    rejectAll(error) {
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        this.waiters = [];
    }

    waitFor(predicate, timeoutMs = DEFAULT_TIMEOUT_MS) {
        for (const message of this.messages) {
            if (predicate(message)) {
                return Promise.resolve(message);
            }
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter(waiter => waiter.timer !== timer);
                reject(new Error(`${this.label} timed out waiting for message.`));
            }, timeoutMs);

            this.waiters.push({predicate, resolve, reject, timer});
        });
    }

    async login(username, password) {
        this.socket.login(username, password);
        const result = await this.waitFor(data => data?.msg === 'login_success' || data?.msg === 'login_fail');
        if (result.msg === 'login_fail') {
            throw new Error(result.reason || `${this.label} login failed.`);
        }
    }

    async firstPlayableGameId() {
        const links = await this.waitFor(data => data?.msg === 'set_game_links' && data.content);
        const matches = [...String(links.content).matchAll(/#play-([^"]+)/g)].map(match => match[1]);
        if (!matches.length) {
            throw new Error('No playable game id found.');
        }
        return matches.find(id => /sprint/i.test(id)) || matches[0];
    }

    async getRc(gameId) {
        this.socket.get_rc(gameId);
        const message = await this.waitFor(data => data?.msg === 'rcfile_contents' && data.game_id === gameId);
        return message.contents || '';
    }

    async setRc(gameId, contents) {
        this.socket.set_rc(gameId, contents);
        await delay(250);
    }

    async play(gameId) {
        this.autoNewgameChoice = true;
        this.socket.play(gameId);
    }

    async waitForGameReady() {
        await this.waitFor(data => data?.msg === 'map', 60000);
        this.autoNewgameChoice = false;
    }

    async watch(username) {
        this.socket.watch(username);
        await this.waitFor(data => data?.msg === 'watching_started' && sameUsername(data.username, username));
    }

    async input(text) {
        this.socket.input(text);
        await delay(120);
    }

    async key(keycode) {
        this.socket.key(keycode);
        await delay(120);
    }

    async escape() {
        await this.key(27);
    }

    async chat(text) {
        this.socket.chat_msg(text);
        await delay(120);
    }
}

function extendSocket(socket) {
    socket.safe_send = function (data) {
        const text = JSON.stringify(data);
        if (this.readyState === WebSocket.OPEN) {
            this.send(text);
        } else {
            throw new Error(`socket status: ${this.readyState}, data: ${text}`);
        }
    };

    socket.login = function (username, password) {
        socket.safe_send({msg: 'login', username, password});
    };

    socket.play = function (game_id) {
        socket.safe_send({msg: 'play', game_id});
    };

    socket.watch = function (username) {
        socket.safe_send({msg: 'watch', username});
    };

    socket.input = function (text) {
        socket.safe_send({msg: 'input', text});
    };

    socket.key = function (keycode) {
        socket.safe_send({msg: 'key', keycode});
    };

    socket.chat_msg = function (text) {
        socket.safe_send({msg: 'chat_msg', text});
    };

    socket.get_rc = function (game_id) {
        socket.safe_send({msg: 'get_rc', game_id});
    };

    socket.set_rc = function (game_id, contents) {
        socket.safe_send({msg: 'set_rc', game_id, contents});
    };

    socket.pong = function () {
        socket.safe_send({msg: 'pong'});
    };

    return socket;
}

async function enterWizardMode(playerClient) {
    if (truthyCrawlFlag(playerClient.playerState.wizard)) {
        return;
    }

    await playerClient.input('&wiz\r');
    await waitUntil(() => truthyCrawlFlag(playerClient.playerState.wizard), 4000);
    await playerClient.escape();
    await delay(300);
}

async function createMonster(playerClient, name) {
    const before = playerClient.messages.length;
    await playerClient.input(`&m${name}\r`);
    await delay(500);
    await playerClient.input(' ');
    await delay(200);
    const texts = recentMessageTexts(playerClient, before);
    if (!texts.some(text => /encounter|appears|created|summon|come[s]? into view|nearby/i.test(text))) {
        console.warn(new Date(), `No obvious creation message for ${name}. Recent messages:`, texts.slice(-5));
    }
}

async function openMonsterDescription(playerClient) {
    const attempts = [
        ['x', '=', 'v'],
        ['x', 'v'],
        ['x', '=', '=', 'v'],
        ['x', '=', '=', '=', 'v']
    ];

    for (const keys of attempts) {
        const before = playerClient.messages.length;
        await playerClient.escape();
        await inputLookSequence(playerClient, keys);
        await chooseExamineMenuIfPresent(playerClient, before);
        try {
            return await waitForNewMonsterDescription(playerClient, before, 2500);
        } catch (error) {
            await playerClient.escape();
        }
    }

    throw new Error('Could not open a monster x-v description.');
}

async function inputLookSequence(playerClient, keys) {
    const before = playerClient.messages.length;
    await playerClient.input(keys[0]);
    await waitForNewMessage(playerClient, before, data => data?.msg === 'input_mode' && data.mode === 7, 700)
        .catch(() => {});
    for (const key of keys.slice(1)) {
        await playerClient.input(key);
    }
}

function waitForNewMonsterDescription(playerClient, afterIndex, timeoutMs) {
    return waitForNewMessage(playerClient, afterIndex, data =>
        data?.msg === 'ui-push' && data.type === 'describe-monster', timeoutMs);
}

function waitForNewMessage(playerClient, afterIndex, predicate, timeoutMs) {
    return playerClient.waitFor(data => {
        const index = playerClient.messages.indexOf(data);
        return index >= afterIndex && predicate(data);
    }, timeoutMs);
}

async function chooseExamineMenuIfPresent(playerClient, afterIndex) {
    const menu = await waitForNewMessage(playerClient, afterIndex, data =>
        data?.msg === 'menu' && /what do you want to examine/i.test(cleanText(data.title?.text || data.title || '')),
    500).catch(() => null);
    if (!menu) {
        return;
    }

    const items = Array.isArray(menu.items) ? menu.items : [];
    const monsterItem = items.find(item =>
        /pandemonium lord|demon lord|lom lobon|cerebov|gloorx vloq|ereshkigal|mnoleg/i.test(cleanText(item.text || ''))
    ) || items.find(item => Array.isArray(item.hotkeys) && item.hotkeys.length);
    const hotkey = monsterItem?.hotkeys?.[0] || monsterItem?.hotkey || 97;
    await playerClient.input(String.fromCharCode(hotkey));
}

async function dismissMonsters(playerClient) {
    await playerClient.input(`&G${dismissScope}\r`);
    await delay(500);
    await playerClient.input(' ');
    await playerClient.escape();
    await delay(300);
}

function monsterNameForIteration(index) {
    if (index < NAMED_LORDS.length) {
        return NAMED_LORDS[index];
    }
    if (index % 20 === 0) {
        return NAMED_LORDS[(index / 20) % NAMED_LORDS.length];
    }
    return 'pandemonium lord';
}

function withStressRc(original) {
    const markerStart = '# GOONKEMON_STRESS_START';
    const markerEnd = '# GOONKEMON_STRESS_END';
    const stripped = String(original || '').replace(
        new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}\\n?`, 'g'),
        ''
    );

    return `${stripped.trimEnd()}
${markerStart}
species = Minotaur
background = Berserker
weapon = axe
default_manual_training = true
wiz_mode = yes
${markerEnd}
`;
}

function countJsonFiles(dir) {
    if (!fs.existsSync(dir)) {
        return 0;
    }

    let count = 0;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countJsonFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            count++;
        }
    }
    return count;
}

async function waitForJsonCount(dir, expectedCount, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (countJsonFiles(dir) >= expectedCount) {
            return;
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for ${expectedCount} saved captures in ${dir}.`);
}

function selectedNewgameChoiceHotkey(data) {
    const buttons = data?.['main-items']?.buttons || [];
    if (!buttons.length) {
        return null;
    }

    const title = cleanText(data.title?.text || data.title || '');
    if (/choice of maps/i.test(title)) {
        const selected = buttons.find(button =>
            String.fromCharCode(button.hotkey || 0).toLowerCase() === sprintMapHotkey.toLowerCase()
        );
        if (selected) {
            return selected.hotkey;
        }
    }

    return buttons[0]?.hotkey;
}

function cleanText(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function recentMessageTexts(playerClient, afterIndex = Math.max(0, playerClient.messages.length - 20)) {
    const result = [];
    for (const data of playerClient.messages.slice(afterIndex)) {
        if (data?.msg !== 'msgs' || !Array.isArray(data.messages)) {
            continue;
        }
        for (const message of data.messages) {
            const text = cleanText(message.text || '');
            if (text) {
                result.push(text);
            }
        }
    }
    return result;
}

function logRecentDiagnostics(playerClient, label) {
    console.warn(new Date(), label);
    console.warn(new Date(), 'Player state:', JSON.stringify(playerClient.playerState));
    console.warn(new Date(), 'Recent messages:', recentMessageTexts(playerClient).slice(-12));
    console.warn(new Date(), 'Recent UI/input:', playerClient.messages.slice(-12).map(data => ({
        msg: data?.msg,
        type: data?.type,
        mode: data?.mode,
        title: cleanText(data?.title?.text || data?.title || '')
    })));
}

function truthyCrawlFlag(value) {
    return value === true || value === 1 || value === '1' ||
        String(value || '').toLowerCase() === 'true';
}

async function waitUntil(predicate, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
            return;
        }
        await delay(100);
    }
    throw new Error('Timed out waiting for condition.');
}

function sameUsername(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

await main();
