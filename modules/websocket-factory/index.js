export default class WebSocketFactory {
    static name = 'WebSocketFactory'
    static version = '1.0'
    static description = '(Library) This module simulates a WebSocket that replicates the user\'s session.'

    login(socket) {
        if (this.get_login_cookie()) {
            socket.send(JSON.stringify({
                msg: "token_login",
                cookie: this.get_login_cookie()
            }));
            socket.send(JSON.stringify({
                msg: "set_login_cookie",
            }));
        }
    }

    handle_login_cookie(data) {
        if (data.msg === 'login_cookie') {
            this.set_login_cookie(data);
        }
    }

    create(handle_message) {
        function enqueue_messages(msgtext) {
            if (msgtext.match(/^{/)) {
                let msgobj;
                try {
                    msgobj = eval("(" + msgtext + ")");
                } catch (e) {
                    return;
                }
                let msgs = msgobj.msgs;
                if (msgs == null)
                    msgs = [msgobj];
                for (let i in msgs) {
                    handle_message(msgs[i]);
                }
            }
        }

        let socket;
        let inflater = null;
        if ('Uint8Array' in window && 'Blob' in window && 'FileReader' in window && 'ArrayBuffer' in window && this.inflate_works_on_ua() && !$.cookie('no-compression')) {
            inflater = new Inflater();
        }
        if (inflater)
            socket = new WebSocket(socket_server);
        else
            socket = new WebSocket(socket_server, 'no-compression');
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (msg) => {
            if (inflater && msg.data instanceof ArrayBuffer) {
                let data = new Uint8Array(msg.data.byteLength + 4);
                data.set(new Uint8Array(msg.data), 0);
                data.set([
                    0,
                    0,
                    255,
                    255
                ], msg.data.byteLength);
                let decompressed = inflater.append(data);
                if (decompressed === -1) {
                    console.error('Decompression error!');
                    let x = inflater.append(data);
                }
                this.decode_utf8(decompressed, function (s) {
                    enqueue_messages(s);
                });
                return;
            }
            enqueue_messages(msg.data);
        };
        return socket;
    }

    ready = new Promise(resolve => {
        this.readyResolver = resolve;
    });

    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function clientInjectSource() {
            const {WebSocketFactory} = DWEM.Modules;
            WebSocketFactory.inflate_works_on_ua = inflate_works_on_ua;
            WebSocketFactory.get_login_cookie = get_login_cookie;
            WebSocketFactory.set_login_cookie = set_login_cookie;
            WebSocketFactory.decode_utf8 = decode_utf8;
            DWEM.Modules.WebSocketFactory.readyResolver();
        }

        const clientMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${clientInjectSource.toString()}()`);
        SMR.add('client', clientMapper);
    }
}
