export default class RCManager {
    static name = 'RCManager'
    static version = '1.0'
    static dependencies = ['IOHook', 'WebSocketFactory']
    static description = '(Library) This module provides features for creating custom RC trigger logic.'
    handlers = []

    addHandler(identifier, handler, priority = 0) {
        this.handlers.push({identifier, handler, priority});
        this.handlers.sort((h1, h2) => h2.priority - h1.priority);
    }

    removeHandler(identifier) {
        for (let i = this.handlers.length - 1; i >= 0; i--) {
            if (this.handlers[i].identifier === identifier) {
                this.handlers.splice(i, 1);
            }
        }
    }

    get_rc(game_id) {
        const {WebSocketFactory} = DWEM.Modules;
        return new Promise(resolve => {
            const socket = WebSocketFactory.create((data) => {
                WebSocketFactory.handle_login_cookie(data);
                if (data.msg === 'login_success') {
                    socket.send(JSON.stringify({msg: 'get_rc', game_id}));
                } else if (data.msg === 'rcfile_contents') {
                    socket.close();
                    resolve({contents: data.contents, game_id});
                }
            });
            socket.onopen = () => {
                WebSocketFactory.login(socket);
            }
        });
    }

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.after.addHandler('rc-manager', async (msg, data) => {
            if (msg === 'play') {
                const rc = await this.get_rc(data.game_id);
                for (const {handler} of this.handlers) {
                    try {
                        handler(msg, rc);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        });
        IOHook.handle_message.after.addHandler('rc-manager', async (data) => {
            if (data.msg === 'go_lobby') {
                for (const {handler} of this.handlers) {
                    try {
                        handler(data.msg);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        });
    }
}
