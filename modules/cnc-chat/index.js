import html2canvas from './html2canvas.min.js';

export default class CNCChat {
    static name = 'CNCChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'WebSocketFactory', 'CNCUserinfo', 'SiteInformation'];
    static description = '(Beta) This module provides extended chat features.';
    entrypoint = 'https://chat.nemelex.cards'

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
            image.setAttribute('style', 'margin-left:1%; margin-right:1%; max-width:98%; max-height:180px; cursor: pointer;');

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
                const left = (screen.width - width) / 2;
                const top = (screen.height - height) / 2;
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
            POPUP: '.ui-popup-inner:last',
            STATS: '#stats',
            MINIMAP: '#minimap_block'
        },
        captureMenu: async (selector) => {
            const target = document.querySelector(selector);
            const scrollerShade = document.querySelector('.scroller-shade');
            scrollerShade.setAttribute('data-html2canvas-ignore', true);
            const backgroundColor = target.style.backgroundColor;
            target.style.backgroundColor = 'black';
            const canvas = await html2canvas(target);
            target.style.backgroundColor = backgroundColor;
            return canvas;
        },
        captureGame: (lineOfSight = 7) => {
            const {cell_width, cell_height, cols, rows, ctx} = this.dungeon_renderer;
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
        }
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

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
            DWEM.Modules.CNCChat.receive_message = receive_message;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);

        function rendererInjector() {
            DWEM.Modules.CNCChat.dungeon_renderer = renderer;
        }

        const rendererMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${rendererInjector.toString()}()`);
        SMR.add('./dungeon_renderer', rendererMapper);
    }
}
