import html2canvas from './html2canvas.min.js';
import gifshot from 'https://cdn.skypack.dev/gifshot@0.4.5';

export default class CNCChat {
    static name = 'CNCChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation', 'CNCUserinfo', 'SiteInformation', 'CommandManager'];
    static description = '(Beta) This module provides extended chat features.';
    API = {
        Entrypoint: 'https://chat.nemelex.cards',
        upload: async (data) => {
            const {SiteInformation} = DWEM.Modules;

            const formData = new FormData();
            formData.append('file', data.file);
            formData.append('data', JSON.stringify({
                ...data,
                user: SiteInformation.current_user
            }));

            return await fetch(`${this.API.Entrypoint}/upload`, {
                method: 'POST',
                body: formData,
            });
        },
        generateGif: async (los = 7) => {
            const CNCChat = DWEM.Modules.CNCChat;

            // Check renderer availability
            let renderer = CNCChat.dungeon_renderer || window._dwem_dungeon_renderer;
            if (!renderer || !renderer.element) {
                throw new Error('Dungeon renderer not available. Make sure you are in game, not in lobby.');
            }

            // Get stored game state data
            const gameStateData = [...CNCChat.gameStateQueue];
            if (gameStateData.length === 0) {
                throw new Error('No game state data available for GIF creation');
            }

            // Generate frames
            const frames = await CNCChat.generateGif(gameStateData, los);

            if (frames.length === 0) {
                throw new Error('No frames generated');
            }

            // Get dimensions from first frame
            const img = new Image();
            img.src = frames[0];
            await new Promise(resolve => img.onload = resolve);

            // Create GIF
            return new Promise((resolve, reject) => {
                gifshot.createGIF(
                    {
                        images: frames,
                        interval: 0.2,
                        gifWidth: img.width,
                        gifHeight: img.height,
                        sampleInterval: 1,
                        numWorkers: 4,
                    },
                    async (obj) => {
                        if (!obj.error) {
                            const response = await fetch(obj.image);
                            const gifBlob = await response.blob();
                            resolve(gifBlob);
                        } else {
                            reject(new Error('Error creating GIF: ' + obj.error));
                        }
                    }
                );
            });
        }
    }

    ChatHistory = {
        isBottom: () => {
            const chatContainer = document.getElementById('chat_history_container');
            return Math.abs(chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < 1.0;
        },
        scrollToBottom: () => {
            const chatContainer = document.getElementById('chat_history_container');
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    Parser = {
        parse: (content) => {
            const container = document.createElement('div');
            container.innerHTML = content;
            const sender = container.querySelector('.chat_sender')?.textContent;
            const message = container.querySelector('.chat_msg')?.textContent;
            let json;
            try {
                json = JSON.parse(message);
            } catch (e) {

            }
            return {sender, message, json};
        },
        htmlify: (chat) => {
            const container = document.createElement('div');
            if (chat.sender !== undefined) {
                const sender = document.createElement('span');
                sender.classList.add('chat_sender');
                sender.textContent = chat.sender;
                container.append(sender);
            }
            const seperator = document.createTextNode(chat.separator === undefined ? ': ' : chat.separator);
            container.append(seperator);
            if (chat.message !== undefined) {
                const message = document.createElement('span');
                message.classList.add('chat_msg');
                message.textContent = chat.message;
                container.append(message);
            }
            return container.innerHTML;
        }
    }

    Animation = {
        add: (element, duration) => {
            duration = duration || 500;

            element.style.transition = `opacity ${duration}ms, max-height ${duration}ms`;
            element.style.opacity = 0;
            element.style.maxHeight = element.scrollHeight + 'px';

            setTimeout(() => {
                element.style.maxHeight = '0px';
            }, 10);

            setTimeout(() => {
                element.style.opacity = 1;
                element.style.maxHeight = element.scrollHeight + 'px';
            }, duration);
        }
    }

    Image = {
        create: (url) => {
            const isBottom = this.ChatHistory.isBottom();

            const container = document.createElement('div');
            const image = new Image();
            image.src = url;
            image.setAttribute('style', 'margin-left:1%; margin-right:1%; max-width:98%; max-height:180px; cursor: pointer; display: none;');

            const loadingSpan = document.createElement('span');
            loadingSpan.style.marginLeft = '2%';
            let loadingText = 'ℹ️ Loading image.';
            loadingSpan.textContent = loadingText;
            let dot = 0;
            const loadingInterval = setInterval(() => {
                loadingSpan.textContent = loadingText + '.'.repeat(dot++);
                dot = dot < 15 ? dot : 0;
            }, 1000);
            this.Animation.add(loadingSpan);
            container.append(loadingSpan);
            image.onclick = () => {
                this.Image.openImage(image.src);
            };
            image.onload = () => {
                image.style.display = '';
                if (isBottom) {
                    this.ChatHistory.scrollToBottom();
                }
                loadingSpan.remove();
                clearInterval(loadingInterval);
            };
            image.onerror = () => {
                loadingSpan.textContent = 'ℹ️ Failed to load the image.';
                clearInterval(loadingInterval);
            };
            container.append(image);
            return container;
        }
        , openImage: (url) => {
            const img = new Image();
            img.src = url;

            img.onload = function () {
                const {width, height} = img;
                const left = window.screenX + (window.innerWidth - width) / 2;
                const top = window.screenY + (window.innerHeight - height) / 2;
                const imagePopup = window.open("", "_blank", `width=${width},height=${height},left=${left},top=${top},resizable=yes`);
                imagePopup.document.write(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>Image viewer</title>
                    <style>
                        body {
                            margin: 0;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            background-color: #000;
                        }
                        img {
                            max-width: 100%;
                            max-height: 100%;
                            cursor: pointer;
                        }
                    </style>
                </head>
                <body>
                    <img src="${url}" alt="Image" onclick="window.close();" />
                </body>
                </html>
                `);

                imagePopup.document.close();
            };

            img.onerror = function () {
                alert("Failed to load the image.");
            };
        }
    }
    Snapshot = {
        Menu: {
            POPUP: '.ui-popup-inner',
            STATS: '#stats',
            MINIMAP: '#minimap_block'
        },
        captureMenu: async (selector) => {
            let target = document.querySelectorAll(selector);
            target = target[target.length - 1];
            const scrollerShade = document.querySelector('.scroller-shade');
            scrollerShade.setAttribute('data-html2canvas-ignore', true);
            return await html2canvas(target, {backgroundColor: 'black'});
        },
        captureGame: (lineOfSight = 7) => {
            let {cell_width, cell_height, cols, rows, ctx} = this.dungeon_renderer;
            if (this.dungeon_renderer.scaled_size) {
                const {width, height} = this.dungeon_renderer.scaled_size();
                cell_width = width;
                cell_height = height;
            }
            const widthAdjustment = cols % 2 === 0 ? 1 : 0;
            const heightAdjustment = rows % 2 === 1 ? -1 : 0;
            const halfCols = (cols - 1 + widthAdjustment) / 2;
            const halfRows = (rows + heightAdjustment) / 2;
            const startWidthRange = (((halfCols - lineOfSight) * cell_width));
            const startHeightRange = (((halfRows - lineOfSight) * cell_height));
            const widthArea = ((lineOfSight * 2) + 1) * cell_width;
            const heightArea = ((lineOfSight * 2) + 1) * cell_height;
            const imageData = ctx.getImageData(startWidthRange, startHeightRange, widthArea, heightArea);
            const canvas = document.createElement('canvas');
            canvas.width = widthArea;
            canvas.height = heightArea;
            const context = canvas.getContext("2d");
            context.putImageData(imageData, 0, 0);
            return canvas;
        },
        download: (url, filename = 'snapshot.png') => {
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    getRCConfig(rcfile) {
        let useClickToSendChat = Array.from(rcfile.matchAll(/^(?!\s*#).*lab_use_click_to_send_chat\s*=\s*(\S+)\s*/gm));
        useClickToSendChat = useClickToSendChat.pop()?.[1];
        useClickToSendChat = useClickToSendChat === 'true';

        return {
            useClickToSendChat
        };
    }

    // GIF generation methods (from FinalGifGenerator)
    async generateGif(gameStateData, los = 7) {
        const IOHook = DWEM.Modules.IOHook;
        if (!IOHook) {
            throw new Error('IOHook module not found');
        }

        const frames = [];

        // Block problematic messages during replay
        let isReplaying = true;
        const replayHandler = (data) => {
            if (!isReplaying) return false;

            // Block UI-related messages
            const blockedMessages = [
                'ui_state', 'update_menu', 'menu',
                'close_menu', 'msgs'
            ];

            return blockedMessages.includes(data.msg);
        };

        // Add blocker
        IOHook.handle_message.before.addHandler('gif-replay-blocker', replayHandler, 99999);

        try {
            // Save current map_knowledge
            const originalMapKnowledge = this.saveMapKnowledge();

            // Create clean background (without monsters and player)
            const mapKnowledgePrime = this.createCleanMapKnowledge(originalMapKnowledge);

            // Get frame range
            const frameCount = Math.min(gameStateData.length, 20);
            const startIdx = Math.max(0, gameStateData.length - frameCount);

            // Render clean background first
            this.applyMapKnowledge(mapKnowledgePrime);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Apply each state and capture frames
            for (let i = startIdx; i < gameStateData.length; i++) {
                const stateData = gameStateData[i];

                // Apply game state
                this.applyGameState(stateData, IOHook);

                // Wait for rendering
                await new Promise(resolve => setTimeout(resolve, 50));

                // Capture frame
                const canvas = await this.Snapshot.captureGame(los);
                frames.push(canvas.toDataURL('image/png'));
            }

            // Restore original map_knowledge
            this.applyMapKnowledge(originalMapKnowledge);

        } finally {
            isReplaying = false;
            // Remove blocker
            IOHook.handle_message.before.removeHandler('gif-replay-blocker');

            // Refresh display
            this.refreshDisplay();
        }

        return frames;
    }

    saveMapKnowledge() {
        const saved = {};

        // Use the injected k
        const mapKnowledge = this.k;

        if (mapKnowledge && typeof mapKnowledge === 'object') {
            // k is an array in map_knowledge.js
            if (mapKnowledge.length !== undefined) {
                for (let i = 0; i < mapKnowledge.length; i++) {
                    if (mapKnowledge[i] && mapKnowledge[i].x !== undefined && mapKnowledge[i].y !== undefined) {
                        const key = mapKnowledge[i].x + ',' + mapKnowledge[i].y;
                        saved[key] = JSON.parse(JSON.stringify(mapKnowledge[i]));
                    }
                }
            }
        }

        return saved;
    }

    createCleanMapKnowledge(original) {
        const clean = {};

        for (const key in original) {
            const cell = JSON.parse(JSON.stringify(original[key]));

            if (cell.t) {
                // Remove monster data
                if (cell.t.mon) {
                    delete cell.t.mon;
                }

                // Remove player data (@)
                if (cell.t.fg && cell.t.fg.value === 64) {
                    delete cell.t.fg;
                }

                // Remove player in mcache
                if (cell.t.mcache && Array.isArray(cell.t.mcache)) {
                    cell.t.mcache = cell.t.mcache.filter(item => {
                        return !(item && item.value === 64);
                    });
                }

                // Remove other player-related overlays
                if (cell.t.player) {
                    delete cell.t.player;
                }
            }

            clean[key] = cell;
        }

        return clean;
    }

    applyMapKnowledge(mapKnowledge) {
        // Clear existing k array
        if (this.k && this.k.length !== undefined) {
            this.k.length = 0;

            // Apply new data to k array
            for (const key in mapKnowledge) {
                const cell = mapKnowledge[key];
                if (cell && cell.x !== undefined && cell.y !== undefined) {
                    const idx = this.makeKey(cell.x, cell.y);
                    this.k[idx] = cell;
                }
            }
        }
    }

    makeKey(x, y) {
        // Zig-zag encode X and Y.
        x = (x << 1) ^ (x >> 31);
        y = (y << 1) ^ (y >> 31);

        // Interleave the bits of X and Y.
        x &= 0xFFFF;
        x = (x | (x << 8)) & 0x00FF00FF;
        x = (x | (x << 4)) & 0x0F0F0F0F;
        x = (x | (x << 2)) & 0x33333333;
        x = (x | (x << 1)) & 0x55555555;

        y &= 0xFFFF;
        y = (y | (y << 8)) & 0x00FF00FF;
        y = (y | (y << 4)) & 0x0F0F0F0F;
        y = (y | (y << 2)) & 0x33333333;
        y = (y | (y << 1)) & 0x55555555;

        var result = x | (y << 1);
        return result;
    }

    applyGameState(stateData, IOHook) {
        // Apply player message
        if (stateData.player) {
            IOHook.handle_message(stateData.player);
        }

        // Apply map message
        if (stateData.map) {
            IOHook.handle_message(stateData.map);
        }

        // Apply stored map_knowledge if available
        if (stateData.map_knowledge) {
            this.applyMapKnowledge(stateData.map_knowledge);
        }
    }

    refreshDisplay() {
        if (window.comm && window.comm.send_message) {
            // Request current game state refresh (Ctrl+L)
            window.comm.send_message('key', { keycode: 12 });
        }
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;
        const {IOHook, RCManager, CNCChat, CommandManager} = DWEM.Modules;

        function chatInjector() {
            receive_message = function (data) {
                var histcon = $('#chat_history_container')[0];
                var atBottom = Math.abs(histcon.scrollHeight - histcon.scrollTop
                    - histcon.clientHeight) < 1.0;
                if (!data.rawContent) {
                    var msg = $("<div>").append(data.content);
                    msg.find(".chat_msg").html(linkify(msg.find(".chat_msg").text()));
                    $("#chat_history").append(msg.html() + "<br>");
                    // PROJECT_A
                } else {
                    $("#chat_history").append(data.rawContent);
                }
                if (atBottom)
                    histcon.scrollTop = histcon.scrollHeight;
                if ($("#chat_body").css("display") === "none" && !data.meta) {
                    new_message_count++;
                    update_message_count();
                }
                $(document).trigger("chat_message", [data.content]);
            };
            comm.register_handlers({
                "chat": receive_message
            });
            DWEM.Modules.CNCChat.receive_message = receive_message;
            DWEM.Modules.CNCChat.linkify = linkify;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);

        function rendererInjector() {
            DWEM.Modules.CNCChat.dungeon_renderer = renderer;
            // Also store on window for easier access
            window._dwem_dungeon_renderer = renderer;
        }

        const rendererMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${rendererInjector.toString()}()`);
        SMR.add('./dungeon_renderer', rendererMapper);

        function mapKnowledgeInjector() {
            Object.defineProperty(DWEM.Modules.CNCChat, 'k', {
                get: function () {
                    return k;
                },
                set: function (newK) {
                    k = newK;
                },
                enumerable: true,
                configurable: true
            });
        }

        const mapKnowledgeMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${mapKnowledgeInjector.toString()}()`);
        SMR.add('./map_knowledge', mapKnowledgeMapper);

        function menuInjector() {
            const {CNCChat} = DWEM.Modules;
            const original_item_click_handler = item_click_handler;
            item_click_handler = function (event) {
                if (CNCChat.useClickToSendChat && event.which !== 1) {
                    return;
                }
                original_item_click_handler.apply(this, [event]);
            }
        }

        const menuMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${menuInjector.toString()}()`);
        SMR.add('./menu', menuMapper);

        RCManager.addHandlers('cnc-chat', async (msg, data) => {
            if (msg === 'play') {
                const {useClickToSendChat} = this.getRCConfig(data.contents);
                this.useClickToSendChat = useClickToSendChat;
            } else if (msg === 'go_lobby') {
                this.useClickToSendChat = false;
            }
        });

        IOHook.handle_message.after.addHandler('cnc-chat', (data) => {
            if (data.msg === 'menu') {
                this.items = Array.from(data.items || []);
                if (this.useClickToSendChat && this.items) {
                    for (const item of this.items) {
                        const element = item.elem.get(0);
                        element.addEventListener('mousedown', async (event) => {
                            const canvas = element.querySelector('canvas');
                            const item = element.textContent;
                            const rgbColor = window.getComputedStyle(element).color;
                            const rgbValues = rgbColor.match(/\d+/g).map(Number);
                            const color = '#' + rgbValues.map((value) => {
                                const hex = value.toString(16);
                                return hex.length === 1 ? '0' + hex : hex;
                            }).join('');
                            const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                            const {url} = await this.API.upload({
                                file,
                                type: 'item',
                                item,
                                color
                            }).then(r => r.json());
                            if (event.which === 2) {
                                socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                            } else if (event.which === 3) {
                                this?.handleRightClickItem?.(url);
                            }
                        });
                    }
                }
            }
        }, 999);

        // Enhanced game state recording for GIF generation
        this.gameStateQueue = [];
        this.gameStateQueueSize = 30; // Store more frames for better GIFs
        this.currentGameState = {};

        // Store complete game state snapshots
        IOHook.handle_message.after.addHandler('cnc-chat-state-recorder', (data) => {
            // Update current game state based on message type
            switch (data.msg) {
                case 'player':
                    this.currentGameState.player = JSON.parse(JSON.stringify(data));
                    break;
                case 'map':
                    this.currentGameState.map = JSON.parse(JSON.stringify(data));

                    // Save map_knowledge using the injected k property
                    this.currentGameState.map_knowledge = {};

                    if (this.k && this.k.length !== undefined) {
                        // k is an array in map_knowledge.js
                        for (let i = 0; i < this.k.length; i++) {
                            if (this.k[i] && this.k[i].x !== undefined && this.k[i].y !== undefined) {
                                const key = this.k[i].x + ',' + this.k[i].y;
                                this.currentGameState.map_knowledge[key] = JSON.parse(JSON.stringify(this.k[i]));
                            }
                        }
                    }

                    break;
                case 'ui_state':
                    this.currentGameState.ui_state = JSON.parse(JSON.stringify(data));
                    break;
                case 'msgs':
                    this.currentGameState.msgs = JSON.parse(JSON.stringify(data));
                    break;
                case 'options':
                    this.currentGameState.options = JSON.parse(JSON.stringify(data));
                    break;
            }

            // Store complete state snapshot when map updates (main game tick)
            if (data.msg === 'map') {
                const stateSnapshot = {
                    ...JSON.parse(JSON.stringify(this.currentGameState)),
                    timestamp: Date.now(),
                    dungeon_level: window.current_level,
                };


                this.gameStateQueue.push(stateSnapshot);

                // Maintain queue size limit
                if (this.gameStateQueue.length > this.gameStateQueueSize) {
                    this.gameStateQueue = this.gameStateQueue.slice(-this.gameStateQueueSize);
                }
            }
        });
        CommandManager.addCommand('/ggif', ['integer?'], async (los = 7) => {
            try {
                // Generate GIF using API
                const gifBlob = await CNCChat.API.generateGif(los);

                // Upload and send
                const {url} = await CNCChat.API.upload({
                    file: gifBlob,
                    type: 'game',
                }).then((r) => r.json());

                socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
            } catch (error) {
                console.error('Error during GIF generation:', error);
            }

        }, {
            module: CNCChat.name,
            description: 'Capture game to GIF with stored game states',
            argDescriptions: ['los (line of sight radius, default: 7)']
        });

        const captureGame = async (los = 7) => {
            const canvas = await this.Snapshot.captureGame(los);
            const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const {url} = await this.API.upload({file, type: 'game'}).then(r => r.json());
            socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
        };
        CommandManager.addCommand('/ggame', ['integer?'], captureGame, {
            module: CNCChat.name,
            description: 'Capture game screenshot',
            argDescriptions: ['los (line of sight radius, default: 7)'],
            aliases: ['/gg']
        });
        const captureMenu = async () => {
            const canvas = await this.Snapshot.captureMenu(this.Snapshot.Menu.POPUP);
            const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const {url} = await this.API.upload({file, type: 'menu'}).then(r => r.json());
            socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
        };
        CommandManager.addCommand('/mmenu', [], captureMenu, {
            module: CNCChat.name,
            description: 'Capture popup menu',
            aliases: ['/mm']
        });

        IOHook.handle_message.before.addHandler('cnc-chat-parser', (data) => {
            if (data.msg === 'chat') {
                const {sender, message} = this.Parser.parse(data.content);
                if (message && message.match(new RegExp(`${this.API.Entrypoint}/entities/\\d{1,}`))) {
                    (async () => {
                        const data = await fetch(message).then(r => r.json());
                        if (data.type === 'game' || data.type === 'menu') {
                            const container = document.createElement('div');
                            const senderSpan = document.createElement('span');
                            senderSpan.textContent = `${sender}'s ${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`;
                            senderSpan.classList.add('chat_sender');
                            // PROJECT_A: Apply colorful username
                            if (DWEM.Modules.CNCUserinfo) {
                                senderSpan.innerHTML = DWEM.Modules.CNCUserinfo.applyColorfulUsername(senderSpan.innerHTML, sender);
                            }
                            let messageSpan = document.createElement('span');
                            messageSpan.classList.add('chat_msg');
                            const image = this.Image.create(data.file);
                            messageSpan.append(image);
                            container.append(senderSpan);
                            container.append(document.createTextNode(': '));
                            container.append(messageSpan);
                            this.receive_message({msg: 'chat', rawContent: container});
                        } else if (data.type === 'item') {
                            const container = document.createElement('div');
                            const senderSpan = document.createElement('span');
                            senderSpan.textContent = `${sender}'s Item`;
                            senderSpan.classList.add('chat_sender');
                            // PROJECT_A: Apply colorful username
                            if (DWEM.Modules.CNCUserinfo) {
                                senderSpan.innerHTML = DWEM.Modules.CNCUserinfo.applyColorfulUsername(senderSpan.innerHTML, sender);
                            }
                            let messageSpan = document.createElement('span');
                            messageSpan.classList.add('chat_msg');
                            const imageContainer = this.Image.create(data.file);
                            imageContainer.style.display = 'flex';
                            imageContainer.style.alignItems = 'center';
                            const image = imageContainer.querySelector('img');
                            image.style.maxWidth = '32px';
                            image.style.maxHeight = '32px';
                            const itemSpan = document.createElement('span');
                            itemSpan.style.color = data.color;
                            itemSpan.style.marginLeft = '0.5em';
                            itemSpan.textContent = data.item;
                            imageContainer.append(itemSpan);
                            messageSpan.append(imageContainer);
                            container.append(senderSpan);
                            container.append(document.createTextNode(': '));
                            container.append(messageSpan);
                            this.receive_message({msg: 'chat', rawContent: container});
                        }
                    })();
                    return true;
                }
            }
        });

    }
}
