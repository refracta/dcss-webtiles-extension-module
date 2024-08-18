import JSZip from 'https://cdn.skypack.dev/jszip';

export default class WTRec {
    static name = 'WTRec'
    static version = '0.1'
    static dependencies = ['IOHook']
    static description = '(Beta) This module provides features for webtiles game recoding.'

    async downloadWTRec() {
        const zip = new JSZip();
        for (let i = 0; i < this.resources.length; i++) {
            const resource = this.resources[i];
            const blob = this.blobs[i];
            zip.file(resource, blob);
        }
        zip.file("wtrec.json", JSON.stringify({version: WTRec.version, data: this.data}));
        const zipBlob = await zip.generateAsync({type: "blob"});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = 'wtrec.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    playWTRec() {
        const {IOHook} = DWEM.Modules;
        const sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            let zip = new JSZip();
            zip = await zip.loadAsync(file);
            const files = Object.values(zip.files)
                .filter(file => !file.dir && file.name !== 'wtrec.json');
            const blobs = await Promise.all(files.map(file => file.async('blob')));
            const blobURLs = blobs.map(blob => URL.createObjectURL(blob));
            const fileMap = files.map((file, index) => ({[file.name]: blobURLs[index]}))
                .reduce((a, e) => ({...a, ...e}));

            const wtrec = JSON.parse(await zip.files['wtrec.json'].async('string'));
            const {data} = wtrec;
            for (let i = 0; i < data.length; i++) {
                const current = data[i];
                if (current.wtrec.type === 'receive') {
                    try {
                        if (current.msg === 'game_client') {
                            // if safe_mode == true
                            this.safeMode = false;
                            this.gitVersion = data[i + 1].text.split('-g').pop();
                            this.safeResourcePath = `https://cdn.jsdelivr.net/gh/crawl/crawl@${this.gitVersion}/crawl-ref/source/webserver/game_data/static/`;
                            // await fetch(this.safeResourcePath + 'game.js');

                            let content = current.content;
                            let config = files.map((file, i) => {
                                if (file.name.endsWith('.js')) {
                                    const name = file.name.split(/[\/.]/)[3];
                                    return {[name]: this.safeMode ? this.safeResourcePath + name : blobURLs[i] + '#'};
                                } else {
                                    return {};
                                }
                            }).reduce((a, r) => ({...a, ...r}), {});
                            console.log(config);

                            content = content.replace('require.config', `require.config({paths: ${JSON.stringify(config)}});\n`);
                            content = content.replace(`game-${current.version}/game`, `./game`);
                            const matches = content.match(/\/gamedata\/[a-f0-9]{40}\/[^\s"']+/g);
                            for (const match of matches) {
                                const url = fileMap[match];
                                content = content.replace(match, url);
                            }
                            current.content = content;
                            console.log(content);
                        } else {
                            console.log(current);
                        }
                        IOHook.handle_message(current);
                    } catch (e) {
                        console.error(e, current);
                    }
                }
                if (i + 1 < data.length) {
                    const next = data[i + 1];
                    await sleep(next.wtrec.timing - current.wtrec.timing);
                }
            }
        }
        input.click();
    }

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.send_message.before.addHandler('wtrec', (msg, data) => {
            console.log(msg)
            if (msg === 'play') {
                this.data = [];
                this.isRecording = true;
                this.startTime = new Date().getTime();
            }
            if (this.isRecording && data) {
                if (['go_lobby', 'login', 'token_login', 'change_password', 'forget_login_cookie', 'start_change_email', 'change_email', 'set_login_cookie', 'pong'].includes(data.msg)) {
                    return;
                }
                const currentTime = new Date().getTime();
                const timing = currentTime - this.startTime;
                this.data.push({...JSON.parse(JSON.stringify(data)), wtrec: {type: 'send', timing}});
            }
        })
        IOHook.handle_message.before.addHandler('wtrec', (data) => {
            if (this.isRecording && data) {
                if (['login_cookie', 'html', 'ping'].includes(data.msg)) {
                    return;
                }
                const currentTime = new Date().getTime();
                const timing = currentTime - this.startTime;
                this.data.push({...JSON.parse(JSON.stringify(data)), wtrec: {type: 'receive', timing}});
            }
            if (data.msg === 'game_client') {
                const container = document.createElement('div');
                container.innerHTML = data.content;
                const script = container.querySelector('script').textContent;
                this.version = data.version;
                this.keyPath = `game-${this.version}`;
                this.valuePath = `/gamedata/${this.version}`;
                this.styles = Array.from(container.querySelectorAll('link'))
                    .map(link => link.getAttribute('href'));
                this.images = Array.from(container.querySelectorAll('img'))
                    .map(link => link.getAttribute('src'));
            } else if (data.msg === 'version') {
                this.sources = Object.keys(require.s.contexts._.defined);
                this.sources = this.sources
                    .filter(path => path.startsWith(this.keyPath))
                    .map(path => path.replace(this.keyPath, this.valuePath) + '.js');
                this.resources = [...this.sources, ...this.styles, ...this.images];
                (async () => {
                    this.blobs = await Promise.all(this.resources.map(r => fetch(r).then(r => r.blob())));
                })();
            }
        }, 999);
    }
}
