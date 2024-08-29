export default class CNCPublicChat {
    static name = 'CNCPublicChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'WebSocketFactory', 'CNCUserinfo', 'CNCChat', 'SiteInformation'];
    static description = '(Beta) This module provides CNC server public chat.';
    botName = 'CNCPublicChat'

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function chatInjector() {
            const {SiteInformation, CNCPublicChat} = DWEM.Modules;
            $("#chat_input").unbind("keydown", chat_message_send);

            function new_chat_message_send(e) {
                // The Enter key sends a message.
                if (e.which == 13) {
                    var content = $("#chat_input").val();
                    e.preventDefault();
                    e.stopPropagation();
                    if (content != "") {
                        if (SiteInformation.current_hash === '#lobby' || content.startsWith(' ')) {
                            DWEM.Modules.CNCPublicChat.socket.send(JSON.stringify({msg: 'chat_msg', text: content.trim()}));
                        } else {
                            comm.send_message("chat_msg", {
                                text: content
                            });
                        }
                        $("#chat_input").val("");
                        $('#chat_history_container').scrollTop($('#chat_history_container')[0].scrollHeight);
                        message_history.unshift(content)
                        if (message_history.length > history_limit) message_history.length = history_limit;
                        history_pos = -1;
                        unsent_message = ""
                    }
                    return false;
                }
                // Up arrow to access message history.
                else if (e.which == 38 && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    var lim = Math.min(message_history.length, history_limit)
                    if (message_history.length && history_pos < lim - 1) {
                        /* Save any unsent input line before reading history so it can
                         * be reloaded after going past the beginning of message
                         * history with down arrow. */
                        var cur_line = $("#chat_input").val()
                        if (history_pos == -1) unsent_message = cur_line;
                        $("#chat_input").val(message_history[++history_pos]);
                    }
                }
                // Down arrow to access message history and any unsent message.
                else if (e.which == 40 && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (message_history.length && history_pos > -1) {
                        if (history_pos == 0) {
                            message = unsent_message;
                            history_pos--;
                        } else message = message_history[--history_pos];
                        $("#chat_input").val(message);
                    }
                }
                // Esc key or F12 again to return to game.
                else if (e.which == 27 || e.which == 123) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle();
                    $(document.activeElement).blur();
                }
                return true;
            }

            clear = function () {
                if (SiteInformation.current_hash === '#lobby') {
                    return;
                }
                $("#spectator_list").html("&nbsp;");
                $("#chat_history").html("");
                if (SiteInformation.current_hash === '#lobby') {
                    $("#spectator_count").html("0 users");
                    if (CNCPublicChat.lastSpectatorsData) {
                        CNCPublicChat.update_spectators(CNCPublicChat.lastSpectatorsData);
                    }
                } else {
                    $("#spectator_count").html("0 spectators");
                }
                new_message_count = 0;
                update_message_count();
            }

            update_spectators = function (data) {
                delete data["msg"];
                $.extend(spectators, data);
                if (SiteInformation.current_hash === '#lobby') {
                    $("#spectator_count").html(data.count + " users");
                } else {
                    $("#spectator_count").html(data.count + " spectators");
                }
                $("#spectator_list").html(data.names);
                $(document).trigger("spectators_changed", [spectators]);
            }

            comm.register_handlers({
                "update_spectators": update_spectators
            });

            $("#chat_input").bind("keydown", new_chat_message_send);

            reset_visibility(true);
            reset_visibility = function (in_game) {
            }

            DWEM.Modules.CNCPublicChat.focus = focus;
            DWEM.Modules.CNCPublicChat.toggle = toggle;
            DWEM.Modules.CNCPublicChat.toggle_entire_chat = toggle_entire_chat;
            DWEM.Modules.CNCPublicChat.update_spectators = update_spectators;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);

        const {IOHook, WebSocketFactory, CNCUserinfo, CNCChat, CNCPublicChat} = DWEM.Modules;

        (async () => {
            await WebSocketFactory.ready;
            this.socket = WebSocketFactory.create(async (data) => {
                WebSocketFactory.handle_login_cookie(data);
                if (data.msg === 'chat') {
                    const {sender, message, json} = CNCChat.Parser.parse(data.content);
                    const container = document.createElement('div');
                    const senderSpan = document.createElement('span');
                    senderSpan.classList.add('chat_sender');
                    let messageSpan = document.createElement('span');
                    messageSpan.classList.add('chat_msg');

                    if (message && message.match(new RegExp(`${CNCChat.API.Entrypoint}/entities/\\d{1,}`))) {
                        const data = await fetch(message).then(r => r.json());
                        if (data.type === 'game' || data.type === 'menu') {
                            const anchor = document.createElement('a');
                            anchor.textContent = `§${sender}'s ${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`;
                            anchor.style.textDecoration = "none";
                            anchor.href = "javascript:void(0);";
                            anchor.onclick = (event) => {
                                DWEM.Modules.CNCUserinfo.open(sender, event);
                            };
                            senderSpan.append(anchor);
                            const image = CNCChat.Image.create(data.file);
                            messageSpan.append(image);
                            CNCChat.receive_message({msg: 'chat', rawContent: container});
                        } else if (data.type === 'item') {
                            const anchor = document.createElement('a');
                            anchor.textContent = `§${sender}'s Item`;
                            anchor.style.textDecoration = "none";
                            anchor.href = "javascript:void(0);";
                            anchor.onclick = (event) => {
                                DWEM.Modules.CNCUserinfo.open(sender, event);
                            };
                            senderSpan.append(anchor);
                            const imageContainer = CNCChat.Image.create(data.file);
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
                            CNCChat.receive_message({msg: 'chat', rawContent: container});
                        }
                    } else if (json && json.sender) {
                        senderSpan.innerHTML = `<span style="color: #5865f2">ⓓ</span>${json.sender}`;
                        if (json.msg === 'discord') {
                            messageSpan.style.whiteSpace = 'pre-line';
                            messageSpan.innerHTML = CNCChat.linkify(json.text);
                        } else if (json.msg === 'discord-attachment') {
                            if (json.contentType && json.contentType.startsWith('image/')) {
                                const image = CNCChat.Image.create(json.url);
                                messageSpan.append(image);
                            } else {
                                messageSpan.innerHTML = `<a href="${json.url}">[FILE URL]</a>`;
                            }
                        }
                    } else {
                        senderSpan.innerHTML = `<a style="text-decoration: none" href="javascript:void(0);" onclick="DWEM.Modules.CNCUserinfo.open('${sender}', event);">§${sender}</a>`;
                        messageSpan.innerHTML = CNCChat.linkify(message);
                    }

                    container.append(senderSpan);
                    container.append(document.createTextNode(': '));
                    container.append(messageSpan);
                    CNCChat.receive_message({rawContent: container});

                } else if (data.msg === 'update_spectators') {
                    CNCUserinfo.patchUpdateSpectators(data);
                    this.lastSpectatorsData = data;
                    if (DWEM.Modules.SiteInformation.current_hash === '#lobby') {
                        CNCPublicChat.update_spectators(data);
                    }
                } else if (data.msg === 'watching_started') {
                    const content = CNCChat.Parser.htmlify({
                        sender: `[Connected to ${this.botName}]`,
                        separator: ' ',
                        message: 'When you chat in the lobby or enter a message after a space character, it will be sent to the public chat.'
                    });
                    CNCChat.receive_message({
                        msg: 'chat', content
                    });
                } else if (data.msg === 'go_lobby') {
                    const content = CNCChat.Parser.htmlify({
                        sender: `[Disconnected from ${this.botName}]`,
                        separator: ' ',
                        message: 'Reconnecting automatically when possible.'
                    });
                    CNCChat.receive_message({
                        msg: 'chat', content
                    });
                } else if (data.msg === 'lobby_entry' && data.username === this.botName) {
                    this.socket.send(JSON.stringify({msg: 'watch', username: this.botName}));
                } else if (data.msg === 'ping') {
                    this.socket.send(JSON.stringify({msg: 'pong'}));
                }
            });
            this.socket.ready = new Promise(resolve => {
                this.socket.readyResolver = resolve;
            });
            this.socket.onopen = (event) => {
                this.socket.readyResolver();
                this.socket.send(JSON.stringify({msg: 'watch', username: this.botName}));
            }
        })();

        IOHook.handle_message.after.addHandler('cnc-public-chat', async (data) => {
            if (data.msg === 'login_cookie') {
                await this.socket.ready;
                WebSocketFactory.login(this.socket);
            } else if (data.msg === 'go_lobby' && this.lastSpectatorsData) {
                CNCPublicChat.update_spectators(this.lastSpectatorsData);
                CNCPublicChat.focus();
                document.querySelector('#chat')?.focus_trap?.deactivate();
            }
        });

        IOHook.handle_message.before.addHandler('cnc-public-chat', (data) => {
            if (data.msg === 'lobby_entry' && data.username === this.botName) {
                return true;
            }
        });

        // Migrate to CommandManager
        IOHook.send_message.before.addHandler('cnc-public-chat-commander', (msg, data) => {
            if (msg === 'chat_msg') {
                const {text} = data;
                if (text.startsWith('/game') || text.startsWith('/g')) {
                    (async () => {
                        const los = parseInt(text.split(' ').pop()) || 7;
                        const canvas = await CNCChat.Snapshot.captureGame(los);
                        const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                        const {url} = await CNCChat.API.upload({file, type: 'game'}).then(r => r.json());
                        this.socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                    })();
                    return true;
                } else if (text.startsWith('/menu') || text.startsWith('/m')) {
                    (async () => {
                        const canvas = await CNCChat.Snapshot.captureMenu(CNCChat.Snapshot.Menu.POPUP);
                        const file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                        const {url} = await CNCChat.API.upload({file, type: 'menu'}).then(r => r.json());
                        this.socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
                    })();
                    return true;
                }
            }
        });
        CNCChat.handleRightClickItem = (url) => {
            this.socket.send(JSON.stringify({msg: 'chat_msg', text: url}));
        }
    }
}
