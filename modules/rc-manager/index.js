export default class RCManager {
    static name = 'RCManager'
    static version = '1.0'
    static dependencies = ['IOHook', 'WebSocketFactory']
    static description = '(Library) This module provides features for creating custom RC trigger logic.'
    watchers = []

    get_rc(game_id) {
        const {WebSocketFactory} = DWEM.Modules;
        return new Promise(resolve => {
            const socket = WebSocketFactory.create((data) => {
                WebSocketFactory.handle_login_cookie(data);
                if (data.msg === 'login_success') {
                    socket.send(JSON.stringify({msg: 'get_rc', game_id}));
                } else if (data.msg === 'rcfile_contents') {
                    resolve(data.contents);
                }
            });
            socket.onopen = () => {
                WebSocketFactory.login(socket);
            }
        });
    }

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.after.push(async (msg, data) => {
            if (msg === 'play') {
                const contents = await this.get_rc(data.game_id);
                for (const watcher of this.watchers) {
                    try {
                        watcher(contents);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        });
    }
}
