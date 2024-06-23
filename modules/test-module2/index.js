export default class TestModule2 {
    static name = 'TestModule2'
    static version = '1.0'
    static dependencies = ['IOHook']

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.after.push(function (msg, data) {
            console.log('send_message.after', msg, data);
        });
        IOHook.handle_message.after.push(function (data) {
            console.log('handle_message.after', data);
        });
    }
}
