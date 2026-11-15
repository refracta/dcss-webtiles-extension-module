import WebSocket from "websocket/lib/W3CWebSocket.js";
import Inflater from "./inflate.js";
import {terminateSocket, watchSocket} from './socket-watchdog.js';

export default class WebsocketFactory {
    static inflater = new Inflater();
    static text_decoder = new TextDecoder('utf-8');

    static decode_utf8(bufs, callback) {
        if (this.text_decoder)
            callback(this.text_decoder.decode(bufs));
        else {
            // this approach is only a fallback for older browsers because the
            // order of the callback isn't guaranteed, so messages can get
            // queued out of order. TODO: maybe just fall back on uncompressed
            // sockets instead?
            const b = new Blob([bufs]);
            const f = new FileReader();
            f.onload = function (e) {
                callback(e.target.result)
            }
            f.readAsText(b, "UTF-8");
        }
    }

    static enqueue_messages(msgtext, handle_message) {
        if (msgtext.match(/^{/)) {
            // JSON message
            var msgobj;
            try {
                // Can't use JSON.parse here, because 0.11 and older send
                // invalid JSON messages
                msgobj = eval("(" + msgtext + ")");
            } catch (e) {
                console.error("Parsing error:", e);
                console.error("Source message:", msgtext);
                return;
            }
            let msgs = msgobj.msgs;
            if (msgs == null)
                msgs = [msgobj];
            for (const i in msgs) {
                handle_message?.(msgs[i]);
            }
        } else {
            // Javascript code
            handle_message?.(msgtext);
        }
    }

    static create(socket_server, {use_inflater, handle_message, ...watchdogOptions}) {
        let socket;
        if (use_inflater)
            socket = new WebSocket(socket_server);
        else
            socket = new WebSocket(socket_server, "no-compression");
        socket.binaryType = "arraybuffer";
        watchSocket(socket, watchdogOptions);

        const fail = error => {
            console.error(new Date().toISOString(), `[${watchdogOptions.label || 'websocket'}] message handler failed`, error.message || error);
            terminateSocket(socket, 'message handler failed');
        };
        const dispatch = data => {
            try {
                Promise.resolve(handle_message?.(data)).catch(fail);
            } catch (error) {
                fail(error);
            }
        };

        socket.onmessage = function (msg) {
            try {
                if (use_inflater && msg.data instanceof ArrayBuffer) {
                    const data = new Uint8Array(msg.data.byteLength + 4);
                    data.set(new Uint8Array(msg.data), 0);
                    data.set([0, 0, 255, 255], msg.data.byteLength);
                    const decompressed = WebsocketFactory.inflater.append(data);
                    if (decompressed === -1) {
                        console.error("Decompression error!");
                        const x = WebsocketFactory.inflater.append(data);
                    }
                    WebsocketFactory.decode_utf8(decompressed, function (s) {
                        WebsocketFactory.enqueue_messages(s, dispatch);
                    });
                    return;
                }

                WebsocketFactory.enqueue_messages(msg.data, dispatch);
            } catch (error) {
                fail(error);
            }
        };

        return socket;
    }
}
