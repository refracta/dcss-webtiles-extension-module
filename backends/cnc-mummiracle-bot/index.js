import * as fs from 'fs';
import {Client, GatewayIntentBits} from 'discord.js';
import OpenAI from 'openai';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const openai = new OpenAI({
    apiKey: config.openAIAPIKey
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let userSessions = {};

const cleanOldMessages = () => {
    const now = Date.now();
    for (const username in userSessions) {
        const session = userSessions[username];
        if (now - session.lastMessageTime > 30 * 60 * 1000) {
            delete userSessions[username];
        }
    }
};

setInterval(cleanOldMessages, 60 * 1000);

client.login(config.discordToken).then(() => {
    console.log('Bot is online');
}).catch(console.error);

async function createNewThread(username, userMessage) {
    const thread = await openai.beta.threads.create({
        messages: [
            {
                role: 'user',
                content: userMessage,
            }
        ]
    });

    userSessions[username] = {
        threadId: thread.id,
        lastMessageTime: Date.now()
    };
}

async function runThread(threadId, userMessage, assistantId) {
    try {
        await openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage
        });

        const run = await openai.beta.threads.runs.createAndPoll(threadId, {
            assistant_id: assistantId
        });

        const messages = await openai.beta.threads.messages.list(threadId, {
            run_id: run.id
        });

        const message = messages.data.pop();

        if (message && message.content[0].type === "text") {
            let {text} = message.content[0];
            const {annotations} = text;
            if (annotations && annotations.length > 0) {
                for (let annotation of annotations) {
                    const {file_citation} = annotation;
                    if (file_citation) {
                        const citedFile = await openai.files.retrieve(file_citation.file_id);

                        const filenameWithoutExtension = citedFile.filename.split('.').slice(0, -1).join('.');
                        text.value = text.value.replace(annotation.text, ` (${filenameWithoutExtension})`);
                    }
                }
            }

            return text.value;
        } else {
            return "No valid response received from the assistant.";
        }
    } catch (error) {
        console.error('Error running the thread or processing messages:', error);
        return 'An error occurred while processing your request.';
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    let {content, author} = message;
    const username = author.username;
    const msgSplit = content.split(': ~');
    if (msgSplit.length > 1) {
        content = '~' + msgSplit.slice(1).join(': ~');
    }

    if (content.match(/^~[^~]/)) {
        let msg = content.slice(1).trim();
        const smartMode = config?.adminList?.includes(username) && msg.startsWith('!');
        if (smartMode) {
            msg = content.slice(1).trim();
        }
        if (msg.startsWith('clear')) {
            delete userSessions[username];
            await message.reply({content: 'Your session cleared!'});
            return;
        }
        console.log(`[${username} (${smartMode})] ${content}`);
        if (!userSessions[username] || Date.now() - userSessions[username].lastMessageTime > 30 * 60 * 1000) {
            await createNewThread(username, msg);
        }
        const channelName = message.channel.name;
        const smartModeSuffix = smartMode ? '-smart' : '';
        let assistantId = config.assistants[channelName + smartModeSuffix] ? config.assistants[channelName + smartModeSuffix] : config.assistants['default' + smartModeSuffix];

        let reply = await runThread(userSessions[username].threadId, msg, assistantId);
        if (smartMode) {
            reply = '!🤓! ' + reply;
        }
        console.log(reply);
        userSessions[username].lastMessageTime = Date.now();

        for (let i = 0; i < reply.length; i += 2000) {
            const chunk = reply.slice(i, i + 2000);
            await message.reply({content: chunk});
        }
    }
});
