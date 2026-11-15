import WebsocketFactory from "./websocket-factory.js";
import * as fs from 'fs';
import {JSDOM} from "jsdom";
import fetch from 'node-fetch';
import {TextDecoder} from 'util';
import crypto from 'crypto';
import JSZip from "jszip";
import {terminateSocket} from "./socket-watchdog.js";

fs.mkdirSync('data/resources', {recursive: true});
fs.mkdirSync('data/wtrec', {recursive: true});
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const activeRecordings = new Set();
const queuedRecordings = new Set();
const retryNotBefore = new Map();
const CONNECT_TIMEOUT_MS = timeoutSetting('socketConnectTimeoutMs', 20_000);
const IDLE_TIMEOUT_MS = timeoutSetting('socketIdleTimeoutMs', 90_000);
const LOGIN_TIMEOUT_MS = timeoutSetting('socketLoginTimeoutMs', 30_000);
const RECORDING_START_TIMEOUT_MS = timeoutSetting('recordingStartTimeoutMs', 30_000);
const RESOURCE_FETCH_TIMEOUT_MS = timeoutSetting('resourceFetchTimeoutMs', 15_000);
const RESOURCE_PREPARATION_TIMEOUT_MS = timeoutSetting('resourcePreparationTimeoutMs', 120_000);
const RECONNECT_DELAY_MS = timeoutSetting('reconnectDelayMs', 10_000);
const RECORDING_RETRY_DELAY_MS = timeoutSetting('recordingRetryDelayMs', 10_000);
const QUEUE_INTERVAL_MS = timeoutSetting('queueIntervalMs', 1_000);

function timeoutSetting(name, fallback) {
    const value = Number(config[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
const donorRecordingUsernames = new Set();

const RANDOM_RECORDING_RATE = clamp(Number(config.randomRecordingRate ?? 0.05), 0, 1);
const DONATION_API_URL = config.donationApiUrl || 'https://donation.abstr.net/api/donation';
const DONATION_REFRESH_INTERVAL_MS = Math.max(1000, Number(
    config.donationRefreshIntervalMs ?? (config.donationRefreshIntervalSeconds ?? 300) * 1000
) || 5 * 60 * 1000);
const DONATION_LOOKBACK_DAYS = Math.max(1, Number(config.donationLookbackDays ?? 45) || 45);
const DONATION_THRESHOLD_KRW = Math.max(1, Number(config.donationThresholdKrw ?? 10000) || 10000);
const DONATION_FETCH_TIMEOUT_MS = Math.max(1000, Number(config.donationFetchTimeoutMs ?? 15000) || 15000);
const CONFIGURED_FORCED_DONOR_RECORDING_USERNAMES = Array.isArray(config.forcedDonorRecordingUsernames)
    ? config.forcedDonorRecordingUsernames
    : [];
const FORCED_DONOR_RECORDING_USERNAMES = ['ASCIIPhilia', ...CONFIGURED_FORCED_DONOR_RECORDING_USERNAMES];
const CNC_2ND_ANNIVERSARY_RECORDING_PERIOD = {
    name: 'cnc-2nd-anniversary-tournament',
    start: '2026-06-17T15:00:00.000Z',
    end: '2026-07-01T15:00:00.000Z'
};
// Match the 0.35 tournament advertised in modules/cnc-banner/banner-template.js.
const DCSS_035_RECORDING_PERIOD = {
    name: 'dcss-0.35-tournament',
    start: '2026-12-04T20:00:00.000Z',
    end: '2026-12-20T20:00:00.000Z'
};
const CONFIGURED_SPECIAL_RECORDING_PERIODS = Array.isArray(config.specialRecordingPeriods)
    ? config.specialRecordingPeriods
    : [{
        name: 'dcsk-2026',
        start: '2026-02-06T20:00:00.000Z',
        end: '2026-02-22T20:00:00.000Z'
    }];
const SPECIAL_RECORDING_PERIODS = [
    CNC_2ND_ANNIVERSARY_RECORDING_PERIOD,
    DCSS_035_RECORDING_PERIOD,
    ...CONFIGURED_SPECIAL_RECORDING_PERIODS
];
const DONOR_RECORDING_MESSAGE = 'Thank you for your server support. Server-side WTREC recording has been enabled.';

for (const username of FORCED_DONOR_RECORDING_USERNAMES) {
    donorRecordingUsernames.add(getUsernameKey(username));
}

function getRecordingReason(data) {
    if (!data.username || data.username === 'CNCPublicChat') {
        return null;
    }

    if (isDonorRecordingUsername(data.username)) {
        return 'donor';
    }

    if (isSpecialRecordingPeriod()) {
        return 'period';
    }

    return Math.random() < RANDOM_RECORDING_RATE ? 'random' : null;
}

function getCurrentRecordingReason(entry, specialPeriodActive) {
    if (!entry.username || getUsernameKey(entry.username) === 'cncpublicchat') return null;
    if (isDonorRecordingUsername(entry.username)) return 'donor';
    if (specialPeriodActive) return 'period';
    // Keep the original random draw. A past tournament or donor eligibility
    // must not permanently qualify a player for new recordings after it ends.
    return entry.recordingReason === 'random' ? 'random' : null;
}

function enqueueWTREC(socket, username, reason = 'unknown') {
    const key = getUsernameKey(username);
    if (!key || activeRecordings.has(key) || queuedRecordings.has(key) ||
        Date.now() < (retryNotBefore.get(key) || 0)) {
        return;
    }
    retryNotBefore.delete(key);
    queuedRecordings.add(key);
    socket.launchQueue.push({username, reason});
}

function clearQueuedRecordings(queue = []) {
    for (const recording of queue) {
        queuedRecordings.delete(getUsernameKey(recording?.username || recording));
    }
}

async function refreshDonorRecordingUsernames() {
    const nextDonorUsernames = new Set(FORCED_DONOR_RECORDING_USERNAMES.map(getUsernameKey));

    try {
        const data = await fetchJson(DONATION_API_URL, DONATION_FETCH_TIMEOUT_MS);
        const cutoffMs = Date.now() - DONATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        const amountByUser = new Map();

        for (const donation of collectDonationRows(data)) {
            if (!isCncDonation(donation) || getDonationTimeMs(donation) < cutoffMs) {
                continue;
            }

            const key = getUsernameKey(donation.username);
            const amount = Number(donation.amount) || 0;
            if (!key || amount <= 0) {
                continue;
            }

            amountByUser.set(key, (amountByUser.get(key) || 0) + amount);
        }

        for (const [key, amount] of amountByUser) {
            if (amount >= DONATION_THRESHOLD_KRW) {
                nextDonorUsernames.add(key);
            }
        }

        donorRecordingUsernames.clear();
        for (const username of nextDonorUsernames) {
            if (username) donorRecordingUsernames.add(username);
        }

        console.log(new Date(), `donor WTREC targets refreshed: ${donorRecordingUsernames.size}`);
    } catch (e) {
        console.error(new Date(), 'donor WTREC target refresh failed', e.message || e);
    }
}

function collectDonationRows(data) {
    const rows = [];
    const seen = new Set();
    for (const donation of [
        ...(data?.overall?.donations || []),
        ...(data?.currentMonth?.donations || []),
        ...(data?.donations || [])
    ]) {
        const key = donation.transactionId || JSON.stringify(donation);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(donation);
    }
    return rows;
}

function isCncDonation(donation) {
    return String(donation?.type || '').toUpperCase() === 'CNC' ||
        String(donation?.code || '').toUpperCase().startsWith('CNC');
}

function getDonationTimeMs(donation) {
    const value = donation?.datetimeISO || donation?.date || donation?.matchedAt;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
}

async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {Accept: 'application/json'}
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function isDonorRecordingUsername(username) {
    return donorRecordingUsernames.has(getUsernameKey(username));
}

function isSpecialRecordingPeriod(now = new Date()) {
    return SPECIAL_RECORDING_PERIODS.some(({start, end}) => {
        const startTime = Date.parse(start);
        const endTime = Date.parse(end);
        return Number.isFinite(startTime) && Number.isFinite(endTime) &&
            now.getTime() >= startTime && now.getTime() < endTime;
    });
}

function getUsernameKey(username) {
    return String(username || '').trim().toLowerCase();
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

await refreshDonorRecordingUsernames();
setInterval(refreshDonorRecordingUsernames, DONATION_REFRESH_INTERVAL_MS);

while (true) {
    let lobby = {}, socket, interval;
    try {
        await new Promise((resolve, reject) => {
            socket = createSocket('lobby', data => {
                if (data.msg === 'ping') {
                    socket.pong();
                } else if (data.msg === 'lobby_entry') {
                    const entry = {...lobby[data.id], ...data};
                    if (!lobby[data.id]) entry.recordingReason = getRecordingReason(entry);
                    lobby[data.id] = entry;
                } else if (data.msg === 'lobby_remove') {
                    const key = getUsernameKey(lobby[data.id]?.username);
                    delete lobby[data.id];
                    retryNotBefore.delete(key);
                } else if (data.msg === 'lobby_clear') {
                    lobby = {};
                    clearQueuedRecordings(socket.launchQueue);
                    socket.launchQueue = [];
                } else if (data.msg === 'lobby_complete') {
                    console.log(new Date(), `lobby received: ${Object.keys(lobby).length} games`);
                }
            });
            socket.launchQueue = [];
            socket.onclose = event => reject(new Error(socket.failureReason || event.reason || 'lobby connection closed'));
            socket.onerror = () => reject(new Error(socket.failureReason || 'lobby connection error'));
            interval = setInterval(() => {
                if (socket.readyState !== 1 || !socket.loggedIn) return;
                const specialPeriodActive = isSpecialRecordingPeriod();
                for (const [key, retryAt] of retryNotBefore) {
                    if (Date.now() >= retryAt) retryNotBefore.delete(key);
                }
                // Reconcile the current lobby, not just newly added games. A
                // failed recording must be retried even if its player stays in-game.
                for (const entry of Object.values(lobby)) {
                    const reason = getCurrentRecordingReason(entry, specialPeriodActive);
                    if (reason) enqueueWTREC(socket, entry.username, reason);
                }
                const recording = socket.launchQueue.shift();
                if (!recording) return;
                const key = getUsernameKey(recording.username);
                queuedRecordings.delete(key);
                const entry = Object.values(lobby).find(entry => getUsernameKey(entry.username) === key);
                const reason = entry && getCurrentRecordingReason(entry, specialPeriodActive);
                if (!reason) return;
                try {
                    launchWTREC(recording.username, reason);
                } catch (error) {
                    console.error(new Date(), recording.username, 'record launch failed', error.message);
                }
            }, QUEUE_INTERVAL_MS);
        });
    } catch (error) {
        console.error(new Date(), `lobby reconnect in ${RECONNECT_DELAY_MS}ms: ${error.message || error}`);
    } finally {
        clearQueuedRecordings(socket?.launchQueue);
        clearInterval(interval);
        terminateSocket(socket, 'lobby reconnect');
        await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
}

function createSocket(label, handleMessage) {
    let loginTimer;
    const socket = extend(WebsocketFactory.create(config.websocket, {
        label,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        handle_message(data) {
            if (data.msg === 'login_success') {
                clearTimeout(loginTimer);
                socket.loggedIn = true;
                console.log(new Date(), `[${label}] login succeeded`);
            } else if (data.msg === 'login_fail') {
                terminateSocket(socket, 'login failed');
                return;
            }
            return handleMessage(data);
        }
    }));
    socket.addEventListener('open', () => {
        if (socket.readyState === 1) {
            loginTimer = setTimeout(() => terminateSocket(socket, 'login timeout'), LOGIN_TIMEOUT_MS);
        }
    });
    socket.addEventListener('close', () => clearTimeout(loginTimer));
    return socket;
}

async function fetchBlob(url, signal) {
    const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(RESOURCE_FETCH_TIMEOUT_MS)])
    });
    if (!response.ok) throw new Error(`Resource HTTP ${response.status}`);
    return await response.blob();
}

async function getScriptMap(valuePath, signal) {
    const scriptMap = {}
    const getDeps = async (path) => {
        const blob = await fetchBlob(`${config.entrypoint}${path}`, signal);
        scriptMap[path] = blob;
        const rawDeps = getDependencies(new TextDecoder().decode(await blob.arrayBuffer()));
        return rawDeps.map(dep => `${valuePath}/${dep.slice(2)}.js`);
    }
    let queue = [`${valuePath}/game.js`];
    while (queue.length > 0) {
        const path = queue.pop();
        if (scriptMap[path]) {
            continue;
        }
        const deps = await getDeps(path);
        queue = [...queue, ...deps.filter(dep => !scriptMap[dep])];
    }
    return scriptMap;
}

function getDependencies(script) {
    return eval(`
        const window = {};
        const global = {};
        const client = {
            inhibit_messages: () => {
            }
        };
        let dependencies = [];

        function define() {
            if (Array.isArray(arguments[0])) {
                dependencies = arguments[0];
            }
        }

        define.amd = true;
        ${script}
        dependencies.filter(dep => dep.startsWith('./'));
    `);
}

function generateWTRecName() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}.${hours}:${minutes}:${seconds}.wtrec`;
}

async function prepareRecordingResources(socket, username, data, signal) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        signal.throwIfAborted();
        try {
            const {window} = new JSDOM(data.content);
            const styles = Array.from(window.document.querySelectorAll('link')).map(link => link.getAttribute('href'));
            const images = Array.from(window.document.querySelectorAll('img')).map(image => image.getAttribute('src'));
            window.close();
            const paths = [...styles, ...images];
            const blobs = await Promise.all(paths.map(path => fetchBlob(config.entrypoint + path, signal)));
            const resourceMap = Object.fromEntries(paths.map((path, index) => [path, blobs[index]]));
            Object.assign(resourceMap, await getScriptMap(`/gamedata/${data.version}`, signal));
            const resources = Object.keys(resourceMap);
            const buffers = await Promise.all(Object.values(resourceMap).map(blob => blob.arrayBuffer().then(Buffer.from)));
            const hashes = buffers.map(buffer => crypto.createHash('sha256').update(buffer).digest('hex')).sort();
            socket.resourceHash = crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
            socket.resourcePath = `resources/${socket.resourceHash}.zip`;
            socket.localPath = `data/${socket.resourcePath}`;
            socket.wtrecName = generateWTRecName();
            if (!fs.existsSync(socket.localPath)) {
                const zip = new JSZip();
                resources.forEach((resource, index) => zip.file(resource, buffers[index]));
                const buffer = await zip.generateAsync({type: 'nodebuffer'});
                signal.throwIfAborted();
                fs.writeFileSync(socket.localPath, buffer);
            }
            signal.throwIfAborted();
            console.log(new Date(), username, `record started (${socket.resourceHash})`);
            return true;
        } catch (error) {
            console.error(new Date(), username, `record start error (${attempt}): ${error.message}`);
            if (signal.aborted || attempt === 3) throw error;
        }
    }
}

function launchWTREC(username, reason = 'unknown') {
    const key = getUsernameKey(username);
    if (activeRecordings.has(key)) return;
    activeRecordings.add(key);

    let socket, startTimer, finishing = false;
    const resources = new AbortController();
    const cleanup = () => {
        activeRecordings.delete(key);
        retryNotBefore.set(key, Date.now() + RECORDING_RETRY_DELAY_MS);
    };
    const finish = async (endMessage, interrupted = false) => {
        if (finishing) return;
        finishing = true;
        clearTimeout(startTimer);
        // Preserve a completed resource bundle and the messages already captured.
        // Incomplete resource downloads must settle before this player can retry.
        if (interrupted) resources.abort();
        terminateSocket(socket, interrupted ? 'recording interrupted' : 'recording completed');
        try {
            if (!await socket?.readyPromise) return;
            socket.data.push({
                ...(endMessage || {msg: 'go_lobby'}),
                wtrec: {type: 'receive', timing: Date.now() - socket.startTime}
            });
            const directory = `data/wtrec/${username}`;
            fs.mkdirSync(directory, {recursive: true});
            const json = JSON.stringify({
                version: '0.1',
                resourceHash: socket.resourceHash,
                resourcePath: `${config.wtrecPath}/${socket.resourcePath}`,
                type: 'server',
                ...(interrupted ? {interrupted: true} : {}),
                data: socket.data
            });
            const zip = new JSZip();
            zip.file('wtrec.json', json, {compression: 'DEFLATE', compressionOptions: {level: 9}});
            const buffer = await zip.generateAsync({type: 'nodebuffer'});
            const path = `${directory}/${socket.wtrecName}`;
            fs.writeFileSync(`${path}.tmp`, buffer);
            fs.renameSync(`${path}.tmp`, path);
            console.log(new Date(), username, interrupted ? 'partial record saved' : 'record ended');
        } catch (error) {
            console.error(new Date(), username, 'record save error', error.message || error);
        } finally {
            resources.abort();
            cleanup();
        }
    };

    try {
        socket = createSocket(`recording:${username}`, data => {
            if (finishing) return;
            if (data.msg === 'ping') {
                socket.pong();
            } else if (data.msg === 'login_success') {
                socket.data = [{msg: 'watch', username, wtrec: {type: 'send', timing: 0}}];
                socket.isRecording = true;
                socket.startTime = Date.now();
                startTimer = setTimeout(() => terminateSocket(socket, 'recording start timeout'), RECORDING_START_TIMEOUT_MS);
                socket.watch(username);
            } else if (data.msg === 'game_client' && socket.isRecording) {
                if (socket.readyPromise) return;
                clearTimeout(startTimer);
                socket.data.push({...data, wtrec: {type: 'receive', timing: Date.now() - socket.startTime}});
                const signal = AbortSignal.any([resources.signal, AbortSignal.timeout(RESOURCE_PREPARATION_TIMEOUT_MS)]);
                socket.readyPromise = prepareRecordingResources(socket, username, data, signal)
                    .then(ready => {
                        if (!finishing && reason === 'donor') socket.chat_msg(DONOR_RECORDING_MESSAGE);
                        return ready;
                    }).catch(error => {
                        console.error(new Date(), username, 'record preparation failed', error.message);
                        // The promise settles with false, so finalization never waits
                        // forever after all resource preparation attempts fail.
                        void finish(null, true);
                        return false;
                    });
            } else if (socket.isRecording && data.msg === 'go_lobby') {
                return finish(data);
            } else if (socket.isRecording && !['login_cookie', 'html', 'set_game_links'].includes(data.msg)) {
                socket.data.push({...data, wtrec: {type: 'receive', timing: Date.now() - socket.startTime}});
            }
        });
        socket.onclose = event => {
            if (!finishing) console.error(new Date(), username, 'record connection closed:', socket.failureReason || event.reason);
            void finish(null, true);
        };
        socket.onerror = () => {
            if (!finishing) console.error(new Date(), username, 'record connection error');
            void finish(null, true);
        };
    } catch (error) {
        clearTimeout(startTimer);
        resources.abort();
        cleanup();
        throw error;
    }
}

function extend(socket) {
    socket.safe_send = function (data) {
        if (this.readyState === 1) {
            try {
                this.send(JSON.stringify(data));
            } catch (error) {
                terminateSocket(this, `send failed: ${error.message}`);
            }
        } else {
            console.error(`socket status: ${this.readyState}, message: ${data.msg}`);
        }
    }

    socket.login = function (username, password) {
        socket.safe_send({msg: 'login', username, password});
    }

    socket.play = function (game_id) {
        socket.safe_send({msg: 'play', game_id});
    }

    socket.key = function (keycode) {
        socket.safe_send({msg: 'key', keycode});
    }

    socket.chat_msg = function (text) {
        socket.safe_send({msg: 'chat_msg', text});
    }

    socket.watch = function (username) {
        socket.safe_send({msg: 'watch', username});
    }

    socket.pong = function () {
        socket.safe_send({msg: 'pong'});
    }

    socket.onopen = async function (event) {
        socket.login(config.username, config.password);
    }

    socket.onclose = socket.onerror = function (event) {
        // console.error(event);
    }
    return socket;
}
