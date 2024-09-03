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

let lobby = {};
const socket = extend(WebsocketFactory.create(config.websocket, {
    handle_message: async function (data) {
        if (data.msg === 'ping') {
            socket.pong();
        } else if (data.msg === 'lobby_entry') {
            if (!lobby[data.id]) {
                if (Math.random() > 0.8 && data.username !== 'CNCPublicChat') {
                    socket.launchQueue.push(data.username);
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
setInterval(_ => {
    if (socket.launchQueue.length > 0) {
        launchWTREC(socket.launchQueue.shift());
    }
}, 1000);

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

function launchWTREC(username) {
    const socket = extend(WebsocketFactory.create(config.websocket, {
        handle_message: async function (data) {
            if (data.msg === 'ping') {
                socket.pong();
            } else if (data.msg === 'login_success') {
                socket.data = [{msg: 'watch', username, wtrec: {type: 'send', timing: 0}}];
                socket.isRecording = true;
                socket.startTime = new Date().getTime();

                socket.watch(username);
            } else if (data.msg === 'game_client') {
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
                            socket.resourcePath = `data/resources/${socket.resourceHash}.zip`;
                            socket.wtrecName = generateWTRecName();
                            if (!fs.existsSync(socket.resourcePath)) {
                                const zip = new JSZip();
                                for (let i = 0; i < resources.length; i++) {
                                    const resource = resources[i];
                                    const buffer = resourceBuffers[i];
                                    zip.file(resource, buffer);
                                }
                                const buffer = await zip.generateAsync({type: "nodebuffer"});
                                fs.writeFileSync(socket.resourcePath, buffer);
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
                        type: 'server',
                        data: socket.data
                    });
                    // fs.writeFileSync(`wtrec/${username}/${socket.wtrecName}.json`, json, 'utf8');
                    /* const zip = new JSZip();
                    await zip.loadAsync(fs.readFileSync(socket.resourcePath));
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

