export default class IOHook {
    static name = 'IOHook'
    static version = '1.0'
    static description = '(Library) This module allows users to add hooks before and after sending and receiving WebSocket data.'

    handle_message = function (msg) {
    }
    send_message = function (msg, data) {
    }

    constructor() {
        function addHandler(identifier, handler, priority = 0) {
            this.handlers.push({identifier, handler, priority});
            this.handlers.sort((h1, h2) => h1.priority - h2.priority);
        }

        function removeHandler(identifier) {
            for (let i = this.handlers.length - 1; i >= 0; i--) {
                if (this.handlers[i].identifier === identifier) {
                    this.handlers.splice(i, 1);
                }
            }
        }

        this.handle_message.before = {addHandler, removeHandler, handlers: []};
        this.handle_message.after = {addHandler, removeHandler, handlers: []};
        this.send_message.before = {addHandler, removeHandler, handlers: []};
        this.send_message.after = {addHandler, removeHandler, handlers: []};
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function handle_message_hooker() {
            const original_handle_message = handle_message;
            const {IOHook} = DWEM.Modules;

            handle_message = function (msg) {
                let cancel = false;
                for (const {handler} of IOHook.handle_message.before.handlers) {
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
                for (const {handler} of IOHook.handle_message.after.handlers) {
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
                for (const {handler} of DWEM.Modules.IOHook.send_message.before.handlers) {
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
                for (const {handler} of DWEM.Modules.IOHook.send_message.after.handlers) {
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
