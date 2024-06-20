export default class LegacyModuleSupport {
    static name = 'LegacyModuleSupport';
    static version = '1.0';
    static dependencies = [];

    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;
        function disableMessage() {
            const original_receive_message = receive_message;
            receive_message = function (data) {
                try {
                    const msg = $("<div>").append(data.content);
                    const text = $(msg).find('.chat_msg').text();
                    if (text.startsWith(`{"rc"`) || text.startsWith(`{"msg"`)) {
                        if (JSON.parse(text).cmd) {
                            return;
                        }
                    }
                } catch (e) {
                }
                original_receive_message(data);
            }
            comm.register_handlers({
                "chat": receive_message
            });
        }

        const handleMessageMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${disableMessage.toString()}()`);
        SMR.add('chat', handleMessageMapper);
    }
}
