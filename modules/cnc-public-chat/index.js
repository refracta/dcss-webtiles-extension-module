export default class CNCPublicChat {
    static name = 'CNCPublicChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'WebSocketFactory', 'CNCUserinfo', 'SiteInformation'];
    static description = '(Beta) This module provides CNC server public chat.';
    botName = 'CNCPublicChat'

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function chatInjector() {
            const {SiteInformation} = DWEM.Modules;
            $("#chat_input").unbind("keydown", chat_message_send);

            function new_chat_message_send(e) {
                // The Enter key sends a message.
                if (e.which == 13) {
                    var content = $("#chat_input").val();
                    e.preventDefault();
                    e.stopPropagation();
                    if (content != "") {
                        const current_hash = SiteInformation.current_hash;
                        if (current_hash === '#lobby' || content.startsWith(' ')) {
                            DWEM.Modules.CNCPublicChat.socket.send(JSON.stringify({msg: 'chat_msg', text: content}));
                        } else {
                            comm.send_message("chat_msg", {
                                text: content
                            });
                        }
                        $("#chat_input").val("");
                        $('#chat_history_container').scrollTop($('#chat_history_container')[0].scrollHeight);
                        message_history.unshift(content)
                        if (message_history.length > history_limit)
                            message_history.length = history_limit;
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
                        if (history_pos == -1)
                            unsent_message = cur_line;
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
                        } else
                            message = message_history[--history_pos];
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
            DWEM.Modules.CNCPublicChat.receive_message = receive_message = function (data, is_raw_message) {
                var msg = $("<div>").append(data.content);
                var histcon = $('#chat_history_container')[0];
                var atBottom = Math.abs(histcon.scrollHeight - histcon.scrollTop
                    - histcon.clientHeight) < 1.0;
                if (!is_raw_message) {
                    msg.find(".chat_msg").html(linkify(msg.find(".chat_msg").text()));
                }
                $("#chat_history").append(msg.html() + "<br>");
                if (atBottom)
                    histcon.scrollTop = histcon.scrollHeight;
                if ($("#chat_body").css("display") === "none" && !data.meta) {
                    new_message_count++;
                    update_message_count();
                }
                $(document).trigger("chat_message", [data.content]);
            };
            DWEM.Modules.CNCPublicChat.update_spectators = update_spectators;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);

        const {IOHook, WebSocketFactory, CNCUserinfo, CNCPublicChat} = DWEM.Modules;

        (async () => {
            await WebSocketFactory.ready;
            this.socket = WebSocketFactory.create(async (data) => {
                WebSocketFactory.handle_login_cookie(data);
                if (data.msg === 'chat') {
                    const container = document.createElement('div');
                    container.innerHTML = data.content;
                    const senderTag = container.querySelector('.chat_sender');
                    const sender = senderTag.textContent;
                    senderTag.textContent = '§' + senderTag.textContent;
                    const messageTag = container.querySelector('.chat_msg');
                    const message = messageTag.textContent;
                    const jsonMessage = (() => {
                        try {
                            if (sender === this.botName) {
                                return JSON.parse(message);
                            }
                        } catch (e) {

                        }
                    })();
                    let isRawMessage = false;
                    if (jsonMessage) {
                        if (jsonMessage.msg === 'discord') {
                            senderTag.innerHTML = `<span style="color: #5865f2">ⓓ</span>${jsonMessage.sender}`
                            messageTag.textContent = jsonMessage.text;
                            messageTag.style.whiteSpace = 'pre-line';
                        } else if (jsonMessage.msg === 'discord-attachment') {
                            senderTag.innerHTML = `<span style="color: #5865f2">ⓓ</span>${jsonMessage.sender}`;
                            isRawMessage = true;
                            if (jsonMessage.contentType && jsonMessage.contentType.startsWith('image/')) {
                                const image = new Image();
                                image.src = jsonMessage.url;
                                image.setAttribute('style', 'margin-left:1%; margin-right:1%; max-width:98%; max-height:180px')
                                const histcon = $('#chat_history_container')[0];
                                const atBottom = Math.abs(histcon.scrollHeight - histcon.scrollTop - histcon.clientHeight) < 1.0;
                                if (atBottom) {
                                    image.onload = () => {
                                        histcon.scrollTop = histcon.scrollHeight;
                                    };
                                }
                                messageTag.innerHTML = `<br>`;
                                messageTag.append(image);
                            } else {
                                messageTag.innerHTML = `<a href="${jsonMessage.url}">[FILE URL]</a>`;
                            }
                        }
                    } else {
                        senderTag.innerHTML = `<a style="text-decoration: none" href="${location.origin}#watch-${sender}">${senderTag.textContent}</a>`
                    }
                    data.content = container.innerHTML;
                    CNCPublicChat.receive_message(data, isRawMessage);
                } else if (data.msg === 'update_spectators') {
                    CNCUserinfo.patchUpdateSpectators(data);
                    this.lastSpectatorsData = data;
                    if (DWEM.Modules.SiteInformation.current_hash === '#lobby') {
                        CNCPublicChat.update_spectators(data);
                    }
                } else if (data.msg === 'watching_started') {
                    CNCPublicChat.receive_message({
                        msg: 'chat',
                        content: `<span class="chat_sender">[Connected to ${this.botName}]</span> <span class="chat_msg">When you chat in the lobby or enter a message after a space character, it will be sent to the public chat.</span>`
                    });
                } else if (data.msg === 'go_lobby') {
                    CNCPublicChat.receive_message({
                        msg: 'chat',
                        content: `<span class="chat_sender">[Disconnected from ${this.botName}]</span> <span class="chat_msg">Reconnecting automatically when possible.</span>`
                    });
                } else if (data.msg === 'lobby_entry' && data.username === this.botName) {
                    this.socket.send(JSON.stringify({msg: 'watch', username: this.botName}));
                } else if (data.msg === 'ping') {
                    this.socket.send(JSON.stringify({msg: 'pong'}));
                }
            });
            this.socket.onopen = (event) => {
                this.socket.send(JSON.stringify({msg: 'watch', username: this.botName}));
            }
        })();

        IOHook.handle_message.after.addHandler('cnc-public-chat', (data) => {
            if (data.msg === 'login_cookie') {
                WebSocketFactory.login(this.socket);
            } else if (data.msg === 'go_lobby' && this.lastSpectatorsData) {
                CNCPublicChat.update_spectators(this.lastSpectatorsData);
                CNCPublicChat.focus();
            }
        });

        IOHook.handle_message.before.addHandler('cnc-public-chat', (data) => {
            if (data.msg === 'lobby_entry' && data.username === this.botName) {
                return true;
            }
        });
    }
}
