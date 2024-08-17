export default class CNCPublicChat {
    static name = 'CNCPublicChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'WebSocketFactory', 'CNCUserinfo', 'SiteInformation'];
    static description = '(Beta) This module provides CNC server public chat.';
    botName = 'CNCPublicChat'

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function chatInjector() {
            $("#chat_input").unbind("keydown", chat_message_send);

            function new_chat_message_send(e) {
                // The Enter key sends a message.
                if (e.which == 13) {
                    var content = $("#chat_input").val();
                    e.preventDefault();
                    e.stopPropagation();
                    if (content != "") {
                        const current_hash = DWEM.Modules.SiteInformation.current_hash;
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
                $("#spectator_list").html("&nbsp;");
                $("#chat_history").html("");
                const current_hash = DWEM.Modules.SiteInformation.current_hash;
                if (current_hash === '#lobby') {
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
                const current_hash = DWEM.Modules.SiteInformation.current_hash;
                if (current_hash === '#lobby') {
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

            const originalClear = clear;
            clear = function () {
                if (DWEM.Modules.SiteInformation.current_hash !== '#lobby') {
                    originalClear();
                }
            }
            DWEM.Modules.CNCPublicChat.focus = focus;
            DWEM.Modules.CNCPublicChat.toggle = toggle;
            DWEM.Modules.CNCPublicChat.toggle_entire_chat = toggle_entire_chat;
            DWEM.Modules.CNCPublicChat.receive_message = receive_message;
            DWEM.Modules.CNCPublicChat.update_spectators = update_spectators;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);

        const {IOHook, WebSocketFactory, CNCUserinfo, CNCPublicChat} = DWEM.Modules;

        (async () => {
            await WebSocketFactory.ready;
            this.socket = WebSocketFactory.create((data) => {
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
                        return null;
                    })();
                    if (jsonMessage) {
                        if (jsonMessage.msg === 'discord') {
                            senderTag.innerHTML = `<span style="color: #5865f2">ⓓ</span>${jsonMessage.sender}`
                            messageTag.textContent = jsonMessage.text;
                            messageTag.style.whiteSpace = 'pre';
                        }
                    }
                    data.content = container.innerHTML;
                    CNCPublicChat.receive_message(data);
                } else if (data.msg === 'update_spectators' && DWEM.Modules.SiteInformation.current_hash === '#lobby') {
                    CNCUserinfo.patchUpdateSpectators(data);
                    this.lastSpectatorsData = data;
                    CNCPublicChat.update_spectators(data);
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
