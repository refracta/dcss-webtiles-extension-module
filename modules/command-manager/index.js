export default class CommandManager {
    static name = 'CommandManager'
    static version = '1.0'
    static dependencies = ['IOHook']
    static description = '(Library, Alpha) This module provides features for creating commands.'

    // AutoComplete

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.before.addHandler('command-manager', (msg, data) => {
            if (msg === 'chat_msg') {
                if (data.text === '/test') {
                    // trim().startsWith()
                    console.log('/test');
                    return true;
                }
            }
        });
    }
}
