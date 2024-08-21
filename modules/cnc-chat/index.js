export default class CNCChat {
    static name = 'CNCChat';
    static version = '0.1';
    static dependencies = ['IOHook', 'WebSocketFactory', 'CNCUserinfo', 'SiteInformation'];
    static description = '(Beta) This module provides extended chat features.';
    botName = 'CNCChat'

    parse(content) {
        const container = document.createElement('div');
        container.innerHTML = content;
        const sender = container.querySelector('.chat_sender')?.textContent;
        const message = container.querySelector('.chat_msg')?.textContent;
        let json;
        try {
            json = JSON.parse(message);
        } catch (e) {

        }
        return {sender, message, json};
    }

    htmlify(chat) {
        const container = document.createElement('div');
        if (chat.rawSender !== undefined) {
            container.innerHTML = chat.rawSender;
        } else if (chat.sender !== undefined) {
            const sender = document.createElement('span');
            sender.classList.add('chat_sender');
            sender.textContent = chat.sender;
            container.append(sender);
        }
        const seperator = document.createTextNode(chat.separator === undefined ? ': ' : chat.separator);
        container.append(seperator);
        if (chat.rawMessage !== undefined) {
            container.innerHTML += chat.rawMessage;
        } else if (chat.message !== undefined) {
            const message = document.createElement('span');
            message.classList.add('chat_msg');
            message.textContent = chat.message;
            container.append(message);
        }
        return container.innerHTML;
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function chatInjector() {
            receive_message = function (data, is_raw_message) {
                var msg = $("<div>").append(data.content);
                var histcon = $('#chat_history_container')[0];
                var atBottom = Math.abs(histcon.scrollHeight - histcon.scrollTop
                    - histcon.clientHeight) < 1.0;
                if (!is_raw_message) {
                    msg.find(".chat_msg").html(linkify(msg.find(".chat_msg").text()));
                }
                $("#chat_history").append(msg.html() + "<br>");
                if (atBottom)
                    histcon.scrollTop = histcon.scrollHeight;
                if ($("#chat_body").css("display") === "none" && !data.meta) {
                    new_message_count++;
                    update_message_count();
                }
                $(document).trigger("chat_message", [data.content]);
            };
            DWEM.Modules.CNCChat.receive_message = receive_message;
        }

        const receiveMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${chatInjector.toString()}()`);
        SMR.add('chat', receiveMapper);
    }
}
