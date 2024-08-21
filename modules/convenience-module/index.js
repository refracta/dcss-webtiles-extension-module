export default class ConvenienceModule {
    static name = 'ConvenienceModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager'];
    static description = '(Beta) This module provides convenience features.';

    getRCConfig(rcfile) {
        let showGoldStatus = Array.from(rcfile.matchAll(/^(?!\s*#).*show_gold_status\s*=\s*(\S+)\s*/gm));
        showGoldStatus = showGoldStatus.pop()?.[1];
        showGoldStatus = showGoldStatus === 'true';

        let disableClearChat = Array.from(rcfile.matchAll(/^(?!\s*#).*disable_clear_chat\s*=\s*(\S+)\s*/gm));
        disableClearChat = disableClearChat.pop()?.[1];
        disableClearChat = disableClearChat === 'true';

        let redirectChat = Array.from(rcfile.matchAll(/^(?!\s*#).*redirect_chat\s*=\s*(\S+)\s*/gm));
        redirectChat = redirectChat.pop()?.[1];
        redirectChat = redirectChat === 'true';

        return {
            showGoldStatus, disableClearChat, redirectChat
        };
    }

    onLoad() {
        const {IOHook, RCManager} = DWEM.Modules;
        RCManager.addHandler('convenience-module', async (msg, data) => {
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
                    // TODO: Unknown message type: player
                    IOHook.handle_message({msg: 'player', status: this?.player?.status || []});
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
                this.disableClearChat = this.showGoldStatus = this.redirectChat = false;
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
    }
}
