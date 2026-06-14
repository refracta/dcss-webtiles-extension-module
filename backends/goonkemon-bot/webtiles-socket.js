import WebSocket from "websocket/lib/W3CWebSocket.js";

const textDecoder = new TextDecoder('utf-8');

export {WebSocket};

export function createWebtilesSocket(socketServer, {handleMessage, logger = console} = {}) {
    const socket = new WebSocket(socketServer, "no-compression");
    socket.binaryType = "arraybuffer";

    socket.onmessage = msg => {
        const text = typeof msg.data === 'string'
            ? msg.data
            : textDecoder.decode(msg.data);
        enqueueMessages(text, handleMessage, logger);
    };

    return socket;
}

function enqueueMessages(msgText, handleMessage, logger) {
    if (!msgText.match(/^{/)) {
        handleMessage?.(msgText);
        return;
    }

    let msgObj;
    try {
        msgObj = JSON.parse(msgText);
    } catch (error) {
        try {
            msgObj = eval("(" + msgText + ")");
        } catch (fallbackError) {
            logger.error("Parsing error:", fallbackError);
            logger.error("Source message:", msgText);
            return;
        }
    }

    const messages = msgObj.msgs == null ? [msgObj] : msgObj.msgs;
    for (const message of messages) {
        handleMessage?.(message);
    }
}
