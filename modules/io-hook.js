export default class IOHook {
    static name = 'IOHook'
    static version = '1.0'

    handle_message = {before: [], after: []}
    send_message = {before: [], after: []}

    onLoad() {
        const {SourceMapperRegistry: SMR} = DEM;

        function handle_message_hooker() {
            const original_handle_message = handle_message;
            handle_message = function (msg) {
                for (const handler of DEM.Modules.IOHook.handle_message.before) {
                    try {
                        handler(msg);
                    } catch (e) {
                        console.error(e);
                    }
                }
                original_handle_message(msg);
                for (const handler of DEM.Modules.IOHook.handle_message.after) {
                    try {
                        handler(msg);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        }

        const handleMessageMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${handle_message_hooker.toString()}()`);
        SMR.add('client', handleMessageMapper);

        function send_message_hooker() {
            const original_send_message = send_message;
            send_message = function (msg, data) {
                for (const handler of DEM.Modules.IOHook.send_message.before) {
                    try {
                        handler(msg, data);
                    } catch (e) {
                        console.error(e);
                    }
                }
                original_send_message(msg, data);
                for (const handler of DEM.Modules.IOHook.send_message.after) {
                    try {
                        handler(msg, data);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        }

        const sendMessageMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${send_message_hooker.toString()}()`);
        SMR.add('comm', sendMessageMapper);
    }
}
