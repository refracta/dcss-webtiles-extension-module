import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import websocket from 'websocket';
import WebsocketFactory from '../websocket-factory.js';

async function server(t, upgrade = true) {
    const httpServer = http.createServer();
    const sockets = new Set();
    httpServer.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    const wsServer = upgrade ? new websocket.server({httpServer}) : null;
    if (!upgrade) httpServer.on('upgrade', () => {});
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        wsServer?.shutDown();
        await new Promise(resolve => httpServer.close(resolve));
    });
    return {wsServer, sockets, url: `ws://127.0.0.1:${httpServer.address().port}/socket`};
}

function closed(socket) {
    return new Promise(resolve => socket.addEventListener('close', resolve));
}

test('an upgrade that never completes is aborted and releases its TCP connection', {timeout: 4000}, async t => {
    const s = await server(t, false);
    const socket = WebsocketFactory.create(s.url, {connectTimeoutMs: 150, idleTimeoutMs: 500});
    const request = socket._client._req;
    await closed(socket);
    assert.match(socket.failureReason, /connect timeout/);
    await new Promise(resolve => setTimeout(resolve, 50));
    // An unresponsive peer may keep its half-open endpoint around. The client
    // must release both its HTTP request and the underlying TCP socket.
    assert.equal(request.destroyed, true);
    assert.equal(request.socket.destroyed, true);
});

test('silent open sockets are terminated without waiting for a close handshake', {timeout: 4000}, async t => {
    const s = await server(t);
    s.wsServer.on('request', request => request.accept('no-compression'));
    const socket = WebsocketFactory.create(s.url, {connectTimeoutMs: 1000, idleTimeoutMs: 150});
    await closed(socket);
    assert.match(socket.failureReason, /receive timeout/);
    assert.equal(socket.readyState, 3);
});

test('application messages keep an idle game connection alive', {timeout: 4000}, async t => {
    const s = await server(t);
    let interval;
    t.after(() => clearInterval(interval));
    s.wsServer.on('request', request => {
        const connection = request.accept('no-compression');
        interval = setInterval(() => connection.sendUTF('{"msg":"ping"}'), 40);
    });
    const socket = WebsocketFactory.create(s.url, {connectTimeoutMs: 1000, idleTimeoutMs: 200});
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(socket.readyState, 1);
    clearInterval(interval);
    const done = closed(socket);
    socket.close();
    await done;
});

test('rejected message handlers close the socket instead of escaping as unhandled rejections', {timeout: 4000}, async t => {
    const s = await server(t);
    s.wsServer.on('request', request => request.accept('no-compression').sendUTF('{"msg":"test"}'));
    const socket = WebsocketFactory.create(s.url, {
        handle_message: async () => { throw new Error('test handler failure'); },
        connectTimeoutMs: 1000,
        idleTimeoutMs: 1000
    });
    await closed(socket);
    assert.equal(socket.failureReason, 'message handler failed');
});
