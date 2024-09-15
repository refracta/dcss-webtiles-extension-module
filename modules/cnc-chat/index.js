import html2canvas from './html2canvas.min.js';
import gifshot from 'https://cdn.skypack.dev/gifshot';

export default class CNCChat {
    static name = 'CNCChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation', 'CNCUserinfo', 'SiteInformation'];
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

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;
        const {IOHook, RCManager, CNCChat} = DWEM.Modules;

        function chatInjector() {
            receive_message = function (data) {
                var histcon = $('#chat_history_container')[0];
                var atBottom = Math.abs(histcon.scrollHeight - histcon.scrollTop
                    - histcon.clientHeight) < 1.0;
                if (!data.rawContent) {
                    var msg = $("<div>").append(data.content);
                    msg.find(".chat_msg").html(linkify(msg.find(".chat_msg").text()));
                    $("#chat_history").append(msg.html() + "<br>");
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
        }

        const rendererMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${rendererInjector.toString()}()`);
        SMR.add('./dungeon_renderer', rendererMapper);

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

        this.mapQueue = [];
        this.mapQueueSize = 30;
        this.prerenderSize = 10;
        IOHook.handle_message.after.addHandler('cnc-chat-gif', (data) => {
            if (data.msg === 'map') {
                this.mapQueue.push(JSON.parse(JSON.stringify(data)));
                if (this.mapQueue.length > this.mapQueueSize) {
                    this.mapQueue = this.mapQueue.slice(-this.mapQueueSize);
                }
            }
        });
        // Migrate to CommandManager
        IOHook.send_message.before.addHandler('cnc-chat-commander', (msg, data) => {
            if (msg === 'chat_msg') {
                const {text} = data;
                if (text.startsWith('/ggif')) {
                    (async () => {
                        const los = parseInt(text.split(' ').pop()) || 7;
                        const frames = [];
                        const mapQueueCopy = [...this.mapQueue];
                        let canvasWidth, canvasHeight;
                        if (mapQueueCopy.length > this.prerenderSize) {
                            for (let i = 0; i < this.prerenderSize; i++) {
                                IOHook.handle_message(mapQueueCopy[i]);
                            }
                        }
                        const start = mapQueueCopy.length > this.prerenderSize ? this.prerenderSize : 0;
                        for (let i = start; i < mapQueueCopy.length; i++) {
                            IOHook.handle_message(mapQueueCopy[i]);
                            const canvas = await CNCChat.Snapshot.captureGame(los);
                            if (!canvasWidth || !canvasHeight) {
                                canvasWidth = canvas.width;
                                canvasHeight = canvas.height;
                            }
                            const dataURL = canvas.toDataURL('image/png');
                            frames.push(dataURL);
                        }
                        gifshot.createGIF(
                            {
                                images: frames,
                                interval: 0.2,
                                gifWidth: canvasWidth,
                                gifHeight: canvasHeight,
                                sampleInterval: 1, // Improves quality by reducing skipped pixels
                                numWorkers: 4,     // Speeds up processing with multiple web workers
                            },
                            async (obj) => {
                                if (!obj.error) {
                                    const image = obj.image;
                                    const response = await fetch(image);
                                    const gifBlob = await response.blob();
                                    const {url} = await CNCChat.API.upload({
                                        file: gifBlob,
                                        type: 'game',
                                    }).then((r) => r.json());
                                    socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                                } else {
                                    console.error('Error creating GIF:', obj.error);
                                }
                            }
                        );
                    })();
                    return true;
                } else if (text.startsWith('/ggame') || text.startsWith('/gg')) {
                    (async () => {
                        const los = parseInt(text.split(' ').pop()) || 7;
                        const canvas = await this.Snapshot.captureGame(los);
                        const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                        const {url} = await this.API.upload({file, type: 'game'}).then(r => r.json());
                        socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                    })();
                    return true;
                } else if (text.startsWith('/mmenu') || text.startsWith('/mm')) {
                    (async () => {
                        const canvas = await this.Snapshot.captureMenu(this.Snapshot.Menu.POPUP);
                        const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                        const {url} = await this.API.upload({file, type: 'menu'}).then(r => r.json());
                        socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                    })();
                    return true;
                } else if (text.startsWith('/eentity') || text.startsWith('/ee')) {
                    (async () => {
                        // socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                    })();
                    return true;
                }
            }
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
