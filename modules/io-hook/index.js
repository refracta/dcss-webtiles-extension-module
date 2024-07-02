export default class IOHook {
    static name = 'IOHook'
    static version = '1.0'
    static description = '(Library) This module allows users to add hooks before and after sending and receiving WebSocket data.'

    handle_message = {before: [], after: []}
    send_message = {before: [], after: []}

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function handle_message_hooker() {
            const original_handle_message = handle_message;
            const {IOHook} = DWEM.Modules;
            handle_message = function (msg) {
                let cancel = false;
                for (const handler of DWEM.Modules.IOHook.handle_message.before) {
                    try {
                        cancel = cancel || handler(msg);
                    } catch (e) {
                        console.error(e);
                    }
                }
                if (cancel) {
                    return;
                }
                original_handle_message(msg);
                for (const handler of DWEM.Modules.IOHook.handle_message.after) {
                    try {
                        handler(msg);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
            handle_message.before = IOHook.handle_message.before;
            handle_message.after = IOHook.handle_message.after;
            IOHook.handle_message = handle_message;
        }

        const handleMessageMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${handle_message_hooker.toString()}()`);
        SMR.add('client', handleMessageMapper);

        function send_message_hooker() {
            const original_send_message = send_message;
            const {IOHook} = DWEM.Modules;
            send_message = function (msg, data) {
                let cancel = false;
                for (const handler of DWEM.Modules.IOHook.send_message.before) {
                    try {
                        cancel = cancel || handler(msg, data);
                    } catch (e) {
                        console.error(e);
                    }
                }
                if (cancel) {
                    return;
                }
                original_send_message(msg, data);
                for (const handler of DWEM.Modules.IOHook.send_message.after) {
                    try {
                        handler(msg, data);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
            send_message.before = IOHook.send_message.before;
            send_message.after = IOHook.send_message.after;
            IOHook.send_message = send_message;
        }

        const sendMessageMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${send_message_hooker.toString()}()`);
        SMR.add('comm', sendMessageMapper);
    }
}
