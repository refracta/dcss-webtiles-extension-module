import * as fs from 'fs';
import {GoonkemonBot} from "./goonkemon.js";
import {startGoonkemonHttpServer} from './server.js';

const configPath = process.env.GOONKEMON_CONFIG || 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const bot = new GoonkemonBot({
    ...config,
    websocket: process.env.GOONKEMON_WEBSOCKET || config.websocket,
    username: process.env.GOONKEMON_USERNAME || config.username,
    password: process.env.GOONKEMON_PASSWORD || config.password,
    email: process.env.GOONKEMON_EMAIL || config.email,
    publicChatUsername: process.env.GOONKEMON_PUBLIC_CHAT_USERNAME || config.publicChatUsername
});
const httpServer = startGoonkemonHttpServer(bot, {
    ...config,
    httpHost: process.env.GOONKEMON_HTTP_HOST || config.httpHost,
    httpPort: process.env.GOONKEMON_HTTP_PORT || config.httpPort,
    allowedOrigins: process.env.GOONKEMON_ALLOWED_ORIGINS
        ? process.env.GOONKEMON_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
        : config.allowedOrigins
});

function stop() {
    bot.stop();
    httpServer.close();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await bot.runForever();
