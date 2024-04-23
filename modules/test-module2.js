export default class TestModule2 {
    static name = 'TestModule2'
    static version = '1.0'
    static dependencies = ['IOHook']

    onLoad() {
        const {IOHook} = DEM.Modules;
        IOHook.send_message.before.push(function (msg, data) {
            console.log(msg, data);
        });
    }
}
