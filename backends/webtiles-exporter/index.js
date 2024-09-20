import WebsocketFactory from "./websocket-factory.js";
import * as fs from 'fs';
import WebSocket from "websocket/lib/W3CWebSocket.js";
import client from 'prom-client';
import express from 'express';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const sessionGauge = new client.Gauge({
    name: 'session_data',
    help: 'Session data for different types',
    labelNames: ['type']
});

const latencyGauge = new client.Gauge({
    name: 'latency',
    help: 'Socket round-trip latency'
});

const app = express();
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});
app.listen(9100, () => {
    console.log('Metrics server running on http://localhost:9100/metrics');
});

setTimeout(async _ => {
    while (true) {
        try {
            await new Promise(async (resolve, reject) => {
                const socket = WebsocketFactory.create(config.websocket, {
                    handle_message: async function (data) {
                        if (data.msg === 'ping') {
                            socket.pong();
                        } else if ('register_fail') {
                            socket?.registerResolver?.();
                        }
                    }
                });

                socket.safe_send = function (data) {
                    data = JSON.stringify(data);
                    if (this.readyState === 1) {
                        this.send(data);
                    } else {
                        console.error(`socket status: ${this.readyState}, data: ${data}`)
                    }
                }

                socket.pong = function () {
                    socket.safe_send({msg: 'pong'});
                }

                socket.onopen = async function (event) {
                    console.log(new Date(), 'socket.onopen (latency)');
                    while (socket.readyState === WebSocket.OPEN) {
                        const t1 = Date.now();
                        socket.register();
                        socket.registerResolver = null;
                        await new Promise(resolve => {
                            socket.registerResolver = resolve;
                        });
                        const t2 = Date.now();
                        const latency = t2 - t1;
                        latencyGauge.set(latency);
                        console.log(new Date(), 'latency:', latency);
                        await new Promise(resolve => setTimeout(resolve, config.interval));
                    }
                }

                socket.register = function (username = '', password = 'LATENCY_CHECK', email = '') {
                    socket.safe_send({
                        msg: 'register', username, password, email
                    });
                }

                socket.onclose = socket.onerror = function (event) {
                    reject(event);
                }
            });
        } catch (e) {
            console.error(new Date(), e.reason);
        } finally {
            await new Promise(resolve => setTimeout(resolve, 1000 * 10));
        }
    }
});

setTimeout(async _ => {
    while (true) {
        try {
            await new Promise(async (resolve, reject) => {
                const socket = WebsocketFactory.create(config.websocket, {
                    handle_message: async function (data) {
                        if (data.msg === 'ping') {
                            socket.pong();
                        } else if (data.msg === 'admin_log' && data.text.includes('connections')) {
                            const matches = Array.from(data.text.match(/(\d+) connections: (\d+) playing \((\d+) idle\), (\d+) watching \((\d+) anon\), (\d+) in lobby \((\d+) anon\);/)).slice(1);
                            const [total, playing, playing_idle, watching, watching_anon, lobby, lobby_anon] = matches;
                            const sessionData = {
                                total,
                                playing,
                                playing_idle,
                                watching,
                                watching_anon,
                                lobby,
                                lobby_anon
                            };
                            for (const key in sessionData) {
                                sessionData[key] = parseInt(sessionData[key]);
                                sessionGauge.set({type: key}, sessionData[key]);
                            }
                            socket?.loginResolver?.(sessionData);
                        }
                    }
                });

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

                socket.pong = function () {
                    socket.safe_send({msg: 'pong'});
                }

                socket.onopen = async function (event) {
                    console.log(new Date(), 'socket.onopen (sessionData)');
                    while (socket.readyState === WebSocket.OPEN) {
                        socket.login(config.username, config.password);
                        socket.loginResolver = null;
                        await new Promise(resolve => {
                            socket.loginResolver = resolve;
                        });
                        await new Promise(resolve => setTimeout(resolve, config.interval));
                    }
                }

                socket.onclose = socket.onerror = function (event) {
                    reject(event);
                }
            });
        } catch (e) {
            console.error(new Date(), e.reason);
        } finally {
            await new Promise(resolve => setTimeout(resolve, 1000 * 10));
        }
    }
});
