export default class ConvenienceModule {
    static name = 'ConvenienceModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager'];
    static description = '(Beta) This module provides convenience features.';

    getRCConfig(rcfile) {
        let showGoldStatus = Array.from(rcfile.matchAll(/^(?!\s*#).*show_gold_status\s*=\s*(\S+)\s*/gm));
        showGoldStatus = showGoldStatus.pop()?.[1];
        showGoldStatus = showGoldStatus === 'true';

        let disableChatClear = Array.from(rcfile.matchAll(/^(?!\s*#).*disable_chat_clear\s*=\s*(\S+)\s*/gm));
        disableChatClear = disableChatClear.pop()?.[1];
        disableChatClear = disableChatClear === 'true';

        let chatRedirection = Array.from(rcfile.matchAll(/^(?!\s*#).*chat_redirection\s*=\s*(\S+)\s*/gm));
        chatRedirection = chatRedirection.pop()?.[1];
        chatRedirection = chatRedirection === 'true';

        return {
            showGoldStatus, disableChatClear, chatRedirection
        };
    }

    onLoad() {
        const {IOHook, RCManager} = DWEM.Modules;
        RCManager.addHandler('convenience-module', async (msg, data) => {
            if (msg === 'play') {
                let {
                    showGoldStatus, disableChatClear, chatRedirection
                } = this.getRCConfig(data.contents);
                this.disableChatClear = disableChatClear;
                this.showGoldStatus = showGoldStatus;
                this.chatRedirection = chatRedirection;
                if (this.showGoldStatus) {
                    IOHook.handle_message.before.addHandler('convenience-module-show-gold-status', (data) => {
                        if (data.msg === 'player') {
                            if (this.player.god !== 'Gozag' && data.status) {
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
                        if (data.gold !== undefined && this.player.status) {
                            IOHook.handle_message({msg: 'player', status: this.player.status});
                        }
                    });
                    IOHook.handle_message({msg: 'player', status: this.player.status || []});
                }
                if (this.chatRedirection) {
                    IOHook.handle_message.after.addHandler('convenience-module-chat-redirect', (data) => {
                        if (data.msg === 'chat') {
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
                this.disableChatClear = this.showGoldStatus = this.chatRedirection = false;
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
                if (!ConvenienceModule.disableChatClear) {
                    originalClear();
                }
            }
        }

        const disableChatClearMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectDisableChatClear.toString()}()`);
        SMR.add('chat', disableChatClearMapper, -1);

        function injectShowGoldStatus() {
            DWEM.Modules.ConvenienceModule.player = player;
        }

        const showGoldStatusMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectShowGoldStatus.toString()}()`);
        SMR.add('./player', showGoldStatusMapper);
    }
}
