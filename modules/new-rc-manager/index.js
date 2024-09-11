export default class NewRCManager {
    static name = 'NewRCManager'
    static version = '1.0'
    static dependencies = ['IOHook', 'WebSocketFactory']
    static description = '(Library) This module provides features for creating custom RC trigger logic.'


    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.before.addHandler('rc2-manager', (msg, data) => {
            if (msg === 'play' || msg === 'watch') {
                this.session = data;
            }
        });

        IOHook.handle_message.before.addHandler('rc2-manager', (data) => {
            if (data.delayed) {
                return;
            }
            if (this.session && data.msg === 'game_client') {
                if (this.session.game_id) {
                    socket.send(JSON.stringify({msg: 'get_rc', game_id: this.session.game_id}));
                }
                this.queue = [data];
            } else if (this.session && data.msg === 'rcfile_contents') {
                console.log(data);
                setTimeout(async _ => {
                    const copyQueue = this.queue;
                    this.queue = null;
                    for (const d of copyQueue) {
                        console.log('replay', d);
                        IOHook.handle_message({...d, delayed: true});
                        if (['game_client'].includes(d.msg)) {
                            await new Promise(resolve => {
                                require([`game-${d.version}/game`], (cv) => {
                                    console.log(cv);
                                    resolve(cv);
                                });
                            })
                        }
                    }
                }, 100);
                return true;
            } else if (this.queue) {
                const now = Date.now();
                if (this.prev) {
                    console.log(this.prev - now, data)
                }
                this.queue.push(data);
                this.prev = now;
                return true;
            }
        });
        // Play > get_rc faster
        // Watch > Estimate

    }
}
