import WebsocketFactory from "./websocket-factory.js";
import * as fs from 'fs';
import {JSDOM} from "jsdom";
import fetch from 'node-fetch';
import {TextDecoder} from 'util';
import crypto from 'crypto';
import JSZip from "jszip";

fs.mkdirSync('data/resources', {recursive: true});
fs.mkdirSync('data/wtrec', {recursive: true});
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const activeRecordings = new Set();
const queuedRecordings = new Set();
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
const CONFIGURED_SPECIAL_RECORDING_PERIODS = Array.isArray(config.specialRecordingPeriods)
    ? config.specialRecordingPeriods
    : [{
        name: 'dcsk-2026',
        start: '2026-02-06T20:00:00.000Z',
        end: '2026-02-22T20:00:00.000Z'
    }];
const SPECIAL_RECORDING_PERIODS = [
    CNC_2ND_ANNIVERSARY_RECORDING_PERIOD,
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

function enqueueWTREC(socket, username, reason = 'unknown') {
    const key = getUsernameKey(username);
    if (!key || activeRecordings.has(key) || queuedRecordings.has(key)) {
        return;
    }
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
    let lobby, socket, interval;
    try {
        await new Promise((resolve, reject) => {
            lobby = {};
            socket = extend(WebsocketFactory.create(config.websocket, {
                handle_message: async function (data) {
                    if (data.msg === 'ping') {
                        socket.pong();
                    } else if (data.msg === 'lobby_entry') {
                        if (!lobby[data.id]) {
                            const reason = getRecordingReason(data);
                            if (reason) {
                                enqueueWTREC(socket, data.username, reason);
                            }
                        }
                        lobby[data.id] = data;
                    } else if (data.msg === 'lobby_remove') {
                        delete lobby[data.id];
                    } else if (data.msg === 'lobby_clear') {
                        lobby = {};
                    }
                }
            }));
            socket.launchQueue = [];
            socket.onclose = socket.onerror = function (event) {
                reject(event);
            }
            interval = setInterval(_ => {
                if (socket.launchQueue.length > 0) {
                    const recording = socket.launchQueue.shift();
                    queuedRecordings.delete(getUsernameKey(recording.username));
                    launchWTREC(recording.username, recording.reason);
                }
            }, 1000);
        })
    } catch (e) {
        console.error(new Date(), e.reason);
    } finally {
        clearQueuedRecordings(socket?.launchQueue);
        clearInterval(interval);
        await new Promise(resolve => setTimeout(resolve, 1000 * 10));
    }
}


async function getScriptMap(valuePath) {
    const scriptMap = {}
    const getDeps = async (path) => {
        const blob = await fetch(`${config.entrypoint}${path}`).then(r => r.blob());
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

function launchWTREC(username, reason = 'unknown') {
    const key = getUsernameKey(username);
    if (activeRecordings.has(key)) {
        return;
    }
    activeRecordings.add(key);

    let socket;
    const cleanup = () => activeRecordings.delete(key);

    try {
        socket = extend(WebsocketFactory.create(config.websocket, {
        handle_message: async function (data) {
            if (data.msg === 'ping') {
                socket.pong();
            } else if (data.msg === 'login_success') {
                socket.data = [{msg: 'watch', username, wtrec: {type: 'send', timing: 0}}];
                socket.isRecording = true;
                socket.startTime = new Date().getTime();

                socket.watch(username);
            } else if (data.msg === 'game_client') {
                if (reason === 'donor' && !socket.donorMessageSent) {
                    socket.donorMessageSent = true;
                    socket.chat_msg(DONOR_RECORDING_MESSAGE);
                }

                socket.readyPromise = new Promise(async resolve => {
                    const currentTime = new Date().getTime();
                    const timing = currentTime - socket.startTime;
                    socket.data.push({...data, wtrec: {type: 'receive', timing}});
                    for (let i = 1; i < 3 + 1; i++) {
                        try {
                            const {window: {document}} = new JSDOM(data.content);
                            const version = data.version;
                            const keyPath = `game-${version}`;
                            const valuePath = `/gamedata/${version}`;
                            const styles = Array.from(document.querySelectorAll('link'))
                                .map(link => link.getAttribute('href'));
                            const styleBlobs = await Promise.all(styles.map(path => fetch(config.entrypoint + path).then(r => r.blob())));
                            const styleMap = styles.map((path, index) => ({[path]: styleBlobs[index]})).reduce((a, e) => ({...a, ...e}), {});
                            const images = Array.from(document.querySelectorAll('img'))
                                .map(link => link.getAttribute('src'));
                            const imagesBlobs = await Promise.all(images.map(path => fetch(config.entrypoint + path).then(r => r.blob())));
                            const imagesMap = images.map((path, index) => ({[path]: imagesBlobs[index]})).reduce((a, e) => ({...a, ...e}), {});
                            const scriptMap = await getScriptMap(valuePath);
                            const resourceMap = {...styleMap, ...imagesMap, ...scriptMap};
                            const resources = Object.keys(resourceMap);
                            const resourceBuffers = await Promise.all(Object.values(resourceMap).map(b => b.arrayBuffer().then(ab => Buffer.from(ab))));
                            const hashes = resourceBuffers.map(buffer => {
                                const hash = crypto.createHash('sha256');
                                hash.update(buffer);
                                return hash.digest('hex');
                            });
                            hashes.sort();
                            const hash = crypto.createHash('sha256');
                            hash.update(JSON.stringify(hashes));
                            socket.resourceHash = hash.digest('hex');
                            socket.resourcePath = `resources/${socket.resourceHash}.zip`;
                            socket.localPath = `data/${socket.resourcePath}`;
                            socket.wtrecName = generateWTRecName();
                            if (!fs.existsSync(socket.localPath)) {
                                const zip = new JSZip();
                                for (let i = 0; i < resources.length; i++) {
                                    const resource = resources[i];
                                    const buffer = resourceBuffers[i];
                                    zip.file(resource, buffer);
                                }
                                const buffer = await zip.generateAsync({type: "nodebuffer"});
                                fs.writeFileSync(socket.localPath, buffer);
                            }
                            console.log(username, `record started (${socket.resourceHash})`);
                            resolve();
                            break;
                        } catch (e) {
                            console.log(username, `record start error (${i})`);
                        }
                    }
                });
            } else if (socket.isRecording && data.msg === 'go_lobby') {
                try {
                    await socket.readyPromise;
                    const currentTime = new Date().getTime();
                    const timing = currentTime - socket.startTime;
                    socket.data.push({...data, wtrec: {type: 'receive', timing}});

                    fs.mkdirSync(`data/wtrec/${username}`, {recursive: true});
                    const json = JSON.stringify({
                        version: '0.1',
                        resourceHash: socket.resourceHash,
                        resourcePath: `${config.wtrecPath}/${socket.resourcePath}`,
                        type: 'server',
                        data: socket.data
                    });
                    // fs.writeFileSync(`wtrec/${username}/${socket.wtrecName}.json`, json, 'utf8');
                    /* const zip = new JSZip();
                    await zip.loadAsync(fs.readFileSync(socket.localPath));
                    zip.file('wtrec.json', json);
                    const buffer = await zip.generateAsync({type: "nodebuffer"});
                    fs.writeFileSync(`wtrec/${username}/${socket.wtrecName}.zip`, buffer); */
                    const wtrecZip = new JSZip();
                    wtrecZip.file('wtrec.json', json, {compression: "DEFLATE", compressionOptions: {level: 9}});
                    const wtrecBuffer = await wtrecZip.generateAsync({type: "nodebuffer"});
                    fs.writeFileSync(`data/wtrec/${username}/${socket.wtrecName}`, wtrecBuffer);
                    console.log(username, 'record ended');
                } catch (e) {
                    console.error(e);
                    console.log(username, 'record save error');
                } finally {
                    cleanup();
                    socket.close();
                }
            } else if (socket.isRecording) {
                if (['login_cookie', 'html', 'ping', 'set_game_links'].includes(data.msg)) {
                    return;
                }
                const currentTime = new Date().getTime();
                const timing = currentTime - socket.startTime;
                socket.data.push({...data, wtrec: {type: 'receive', timing}});
            }
        }
        }));
        socket.onclose = socket.onerror = cleanup;
    } catch (e) {
        cleanup();
        throw e;
    }
}

function extend(socket) {
    socket.safe_send = function (data) {
        data = JSON.stringify(data);
        if (this.readyState === 1) {
            this.send(data);
        } else {
            console.error(`socket status: ${this.readyState}, data: ${data}`)
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
