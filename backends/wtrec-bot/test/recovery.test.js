import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import websocket from 'websocket';
import JSZip from 'jszip';

const source = fileURLToPath(new URL('../index.js', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wtrec-test-'));
    const state = {connections: [], watches: [], logs: '', resources: options.resources || 'ok', login: options.login !== false,
        start: options.start !== false, requests: 0, ready: 0};
    const server = http.createServer((request, response) => {
        if (request.url === '/donation') {
            response.setHeader('Content-Type', 'application/json');
            response.end('{"donations":[]}');
        } else if (request.url === '/gamedata/test/game.js') {
            state.requests++;
            if (state.resources === 'hang') return;
            response.statusCode = state.resources === 'fail' ? 503 : 200;
            response.end('define([], function () {});');
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    const transportSockets = new Set();
    server.on('connection', socket => {
        transportSockets.add(socket);
        socket.on('close', () => transportSockets.delete(socket));
    });
    const wsServer = new websocket.server({httpServer: server});
    const send = (connection, ...msgs) => {
        if (connection.connected && !connection.muted) connection.sendUTF(JSON.stringify({msgs}));
    };
    wsServer.on('request', request => {
        const connection = request.accept('no-compression');
        state.connections.push(connection);
        connection.on('message', message => {
            const data = JSON.parse(message.utf8Data);
            if (data.msg === 'login' && state.login) {
                send(connection, {msg: 'login_success', username: 'wtrec'}, {msg: 'lobby_clear'},
                    {msg: 'lobby_entry', id: 1, username: 'ASCIIPhilia', game_id: 'test'}, {msg: 'lobby_complete'});
            } else if (data.msg === 'watch') {
                state.watches.push(connection);
                if (state.start) send(connection,
                    {msg: 'game_client', version: 'test', content: '<html><head></head><body></body></html>'},
                    {msg: 'player', name: 'ASCIIPhilia', xl: 7});
            } else if (data.msg === 'chat_msg') {
                state.ready++;
            }
        });
    });
    const heartbeat = setInterval(() => {
        for (const connection of state.connections) send(connection, {msg: 'ping'});
    }, 40);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
        websocket: `ws://127.0.0.1:${port}/socket`, entrypoint: `http://127.0.0.1:${port}`,
        donationApiUrl: `http://127.0.0.1:${port}/donation`, wtrecPath: 'https://recordings.invalid',
        username: 'wtrec', password: 'test-password', randomRecordingRate: 0,
        socketConnectTimeoutMs: 500, socketIdleTimeoutMs: 350, socketLoginTimeoutMs: 300,
        recordingStartTimeoutMs: 300, resourceFetchTimeoutMs: 150, resourcePreparationTimeoutMs: 1000,
        reconnectDelayMs: 100, recordingRetryDelayMs: 1100, queueIntervalMs: 30
    }));
    const child = spawn(process.execPath, [source], {cwd: directory, stdio: ['ignore', 'pipe', 'pipe']});
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { state.logs += chunk; });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        clearInterval(heartbeat);
        wsServer.shutDown();
        for (const socket of transportSockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, {recursive: true, force: true});
    });
    state.waitFor = async predicate => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            if (await predicate()) return;
            if (child.exitCode !== null || child.signalCode !== null) break;
            await delay(25);
        }
        assert.fail(`Condition did not become true. Bot output:\n${state.logs}`);
    };
    state.send = send;
    state.recordings = async () => {
        const folder = path.join(directory, 'data/wtrec/ASCIIPhilia');
        try { return (await fs.readdir(folder)).filter(name => name.endsWith('.wtrec')).map(name => path.join(folder, name)); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    state.readRecording = async filename => JSON.parse(await (await JSZip.loadAsync(await fs.readFile(filename))).file('wtrec.json').async('string'));
    return state;
}

test('a forced donor already in the lobby is recorded and saved as a valid WTREC archive', {timeout: 12000}, async t => {
    const s = await fixture(t);
    await s.waitFor(() => s.ready === 1);
    assert.equal(s.watches.length, 1);
    s.send(s.watches[0], {msg: 'go_lobby'});
    await s.waitFor(async () => (await s.recordings()).length === 1);
    const recording = await s.readRecording((await s.recordings())[0]);
    assert.equal(recording.type, 'server');
    assert.equal(recording.interrupted, undefined);
    assert.equal(recording.data[0].username, 'ASCIIPhilia');
    assert.ok(recording.data.some(message => message.msg === 'player' && message.xl === 7));
    assert.equal(recording.data.at(-1).msg, 'go_lobby');
});

test('a silent lobby reconnects without duplicating an active recording', {timeout: 12000}, async t => {
    const s = await fixture(t);
    await s.waitFor(() => s.ready === 1);
    s.connections[0].muted = true;
    await s.waitFor(() => s.logs.includes('lobby reconnect in'));
    await s.waitFor(() => s.logs.split('lobby received:').length >= 3);
    await delay(250);
    assert.equal(s.watches.length, 1);
});

test('a silent recording saves its captured data and reattaches to the same lobby player', {timeout: 12000}, async t => {
    const s = await fixture(t);
    await s.waitFor(() => s.ready === 1);
    s.watches[0].muted = true;
    await s.waitFor(async () => (await s.recordings()).length === 1);
    const recording = await s.readRecording((await s.recordings())[0]);
    assert.equal(recording.interrupted, true);
    assert.ok(recording.data.some(message => message.msg === 'player'));
    await s.waitFor(() => s.ready === 2);
    assert.equal(s.watches.length, 2);
    assert.equal(s.watches[0].connected, false);
});

for (const failure of ['fail', 'hang']) {
    test(`resource requests that ${failure} release the player for a successful retry`, {timeout: 12000}, async t => {
        const s = await fixture(t, {resources: failure});
        await s.waitFor(() => s.logs.includes('record preparation failed'));
        assert.ok(s.requests >= 3);
        assert.equal((await s.recordings()).length, 0);
        s.resources = 'ok';
        await s.waitFor(() => s.ready === 1);
        assert.ok(s.watches.length >= 2);
        s.send(s.watches.at(-1), {msg: 'go_lobby'});
        await s.waitFor(async () => (await s.recordings()).length === 1);
        assert.ok(!s.logs.includes('UnhandledPromiseRejection'));
    });
}

test('login cannot wait forever while server heartbeats continue', {timeout: 12000}, async t => {
    const s = await fixture(t, {login: false});
    await s.waitFor(() => s.logs.includes('login timeout'));
    s.login = true;
    await s.waitFor(() => s.ready === 1);
});

test('a missing game_client cannot pin a player while heartbeats continue', {timeout: 12000}, async t => {
    const s = await fixture(t, {start: false});
    await s.waitFor(() => s.logs.includes('recording start timeout'));
    s.start = true;
    await s.waitFor(() => s.ready === 1);
    assert.equal(s.watches.length, 2);
});
