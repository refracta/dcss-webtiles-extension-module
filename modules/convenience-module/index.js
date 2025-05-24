export default class ConvenienceModule {
    static name = 'ConvenienceModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'CommandManager'];
    static description = '(Beta) This module provides convenience features.';

    getRCConfig(rcfile) {
        const {RCManager} = DWEM.Modules;
        const showGoldStatus = RCManager.getRCOption(rcfile, 'show_gold_status', 'boolean', false);
        const disableClearChat = RCManager.getRCOption(rcfile, 'disable_clear_chat', 'boolean', false);
        const redirectChat = RCManager.getRCOption(rcfile, 'redirect_chat', 'boolean', false);
        const inputTimeoutMS = RCManager.getRCOption(rcfile, 'input_timeout_ms', 'float', 0);
        return {
            showGoldStatus, disableClearChat, redirectChat, inputTimeoutMS
        };
    }

    onLoad() {
        const {IOHook, RCManager, CommandManager} = DWEM.Modules;
       /*
                    const {SourceMapperRegistry: SMR} = DWEM;

                    const {IOHook, RCManager} = DWEM.Modules;
                    IOHook.send_message.before.addHandler('convenience-module', (msg, data) => {
                        console.log(msg, data)
                        this.lastSendTime = Date.now();
                    });

                    function injectSendKey() {
                        send_keycode = function (code) {

                    if(DWEM.Modules.ConvenienceModule.lastReceiveTime - DWEM.Modules.ConvenienceModule.lastSendTime > 15){
                        return;
                    }
                    DWEM.Modules.ConvenienceModule.lastSendTime = Date.now();

                    socket.send('{"msg":"key","keycode":' + code + '}');
                }
            }

            const injectSendKeyMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSendKey.toString()}()`);
            SMR.add('client', injectSendKeyMapper);

            IOHook.handle_message.before.addHandler('convenience-module', (data) => {
                this.lastReceiveTime = Date.now();
                console.log(this.lastReceiveTime - this.lastSendTime);
            });
        */

        RCManager.addHandlers('convenience-module', async (msg, data) => {
            if (msg === 'play') {
                let {
                    showGoldStatus, disableClearChat, redirectChat
                } = this.getRCConfig(data.contents);
                this.disableClearChat = disableClearChat;
                this.showGoldStatus = showGoldStatus;
                this.redirectChat = redirectChat;
                if (this.showGoldStatus) {
                    IOHook.handle_message.before.addHandler('convenience-module-show-gold-status', (data) => {
                        if (data.msg === 'player') {
                            if (this?.player?.god !== 'Gozag' && this?.player?.gold !== undefined && data.status) {
                                data.status = [...data.status.filter(s => !s.isCustomStatus), {
                                    light: `Gold (${this.player.gold})`,
                                    text: 'gold',
                                    desc: 'The amount of gold you own.',
                                    col: 14,
                                    isCustomStatus: true
                                }];
                            }
                        }
                    });
                    IOHook.handle_message.after.addHandler('convenience-module-show-gold-status', (data) => {
                        if (data.gold !== undefined && this?.player?.status) {
                            IOHook.handle_message({msg: 'player', status: this.player.status});
                        }
                    });
                }
                if (this.redirectChat) {
                    IOHook.handle_message.after.addHandler('convenience-module-chat-redirect', (data) => {
                        if (data.msg === 'chat' && data.content) {
                            const container = document.createElement('div');
                            container.innerHTML = data.content;
                            const sender = container.querySelector('.chat_sender').textContent;
                            const message = container.querySelector('.chat_msg').textContent;
                            IOHook.handle_message({
                                msg: 'msgs', messages: [{
                                    'text': ('<cyan>' + sender + ': ' + '<white>' + message + '')
                                }]
                            });
                        }
                    });
                }
            } else if (msg === 'go_lobby') {
                // TODO
                setTimeout(_ => {
                    this.disableClearChat = this.showGoldStatus = this.redirectChat = false;
                },100);
                IOHook.handle_message.before.removeHandler('convenience-module-show-gold-status');
                IOHook.handle_message.after.removeHandler('convenience-module-show-gold-status');
                IOHook.handle_message.after.removeHandler('convenience-module-chat-redirect');
            }
        });

        const {SourceMapperRegistry: SMR} = DWEM;

        function injectDisableChatClear() {
            originalClear = clear
            const {ConvenienceModule} = DWEM.Modules;
            clear = function () {
                if (!ConvenienceModule.disableClearChat) {
                    originalClear();
                }
            }
        }

        const disableClearChatMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectDisableChatClear.toString()}()`);
        SMR.add('chat', disableClearChatMapper, -1);

        function injectShowGoldStatus() {
            DWEM.Modules.ConvenienceModule.player = player;
        }

        const showGoldStatusMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectShowGoldStatus.toString()}()`);
        SMR.add('./player', showGoldStatusMapper);

        IOHook.handle_message.after.addHandler('convenience-module', (data) => {
            if (!(this.autoReconnect && this.lastSessionData)) {
                return;
            }
            if (data.msg === 'go_lobby') {
                if (this.lastSessionData.msg === 'play') {
                    location.hash = `play-${this.lastSessionData.game_id}`;
                }
            } else if (data.msg === 'lobby_entry' && data.username === this.lastSessionData.username) {
                location.hash = `watch-${this.lastSessionData.username}`;
            }
        });

        IOHook.handle_message.before.addHandler('convenience-module', (data) => {
            if (data.msg === 'game_ended' && this.autoReconnect && this.lastSessionData) {
                return true;
            }
        });

        IOHook.send_message.after.addHandler('convenience-module', (msg, data) => {
            if (msg === 'play') {
                this.lastSessionData = data;
            } else if (msg === 'watch') {
                this.lastSessionData = data;
            }
        });

        CommandManager.addCommand('/arc', [], () => {
            this.autoReconnect = !this.autoReconnect;
            IOHook.handle_message({
                msg: 'chat',
                content: `Auto reconnect mode is ${this.autoReconnect ? 'enabled' : 'disabled'}.`
            });
        });

    }
}
