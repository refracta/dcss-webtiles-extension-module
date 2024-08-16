import WebsocketFactory from "./websocket-factory.js";
import * as fs from 'fs';
import WebSocket from "websocket/lib/W3CWebSocket.js";
import {JSDOM} from "jsdom";
import {Client, Events, GatewayIntentBits} from 'discord.js';


const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]});
await client.login(config.discordToken);
let socket, channel;
client.once(Events.ClientReady, async readyClient => {
    console.log(new Date(), `Ready! Logged in as ${readyClient.user.tag}`);
    try {
        const guilds = await client.guilds.fetch();
        let targetGuild = guilds.find(g => g.name === config.discordGuild);
        targetGuild = await targetGuild.fetch();
        const channels = await targetGuild.channels.fetch();
        channel = channels.find(ch => ch.name === config.discordChannel && ch.isTextBased());
    } catch (error) {
        console.error('An error occurred while fetching the guild or channel:', error);
    }
});
client.on('messageCreate', (message) => {
    if (message.author.id === client.user.id) return;

    if (socket && message.channel.name === config.discordChannel) {
        const sender = message.member.displayName;
        if (message.content !== '') {
            socket.chat_msg(JSON.stringify({msg: 'discord', sender, text: message.content}));
            console.log(new Date(), `[DISCORD] ${sender}: ${message.content}`);
        }
        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                socket.chat_msg(JSON.stringify({msg: 'discord', sender, text: attachment.url}));
                console.log(new Date(), `[DISCORD-ATTACHMENT] ${sender}: ${message.url}`);
            });
        }
    }
});

while (true) {
    try {
        await new Promise(async (resolve, reject) => {
            socket = WebsocketFactory.create('wss://crawl.nemelex.cards/socket', {
                handle_message: function (data) {
                    if (data.msg === 'login_success') {
                        socket.login_resolver();
                    } else if (data.msg === 'chat') {
                        try {
                            const {window: {document}} = new JSDOM(data.content);
                            const sender = document.querySelector('.chat_sender').textContent;
                            const message = document.querySelector('.chat_msg').textContent;
                            if (channel && sender !== config.username) {
                                channel.send(`${sender}: ${message}`);
                                console.log(new Date(), `[WEBSOCKET] ${sender}: ${message}`);
                            }
                        } catch (e) {
                        }
                    } else if (data.msg === 'ping') {
                        console.log(new Date(), 'ping');
                        socket.pong();
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

            socket.play = function (game_id) {
                socket.safe_send({msg: 'play', game_id});
            }

            socket.key = function (keycode) {
                socket.safe_send({msg: 'key', keycode});
            }

            socket.chat_msg = function (text) {
                socket.safe_send({msg: 'chat_msg', text});
            }

            socket.pong = function () {
                socket.safe_send({msg: 'pong'});
            }

            socket.onopen = async function (event) {
                console.log(new Date(), 'socket.onopen');
                socket.login(config.username, config.password);
                await new Promise(resolve => {
                    socket.login_resolver = resolve;
                });
                console.log(new Date(), 'login_success!');
                socket.play('dcss-0.31-sprint');
                while (socket.readyState === WebSocket.OPEN) {
                    socket.key(-99999);
                    console.log(new Date(), 'send key: -99999');
                    await new Promise(resolve => setTimeout(resolve, 1000 * 60));
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

