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
        location.hash = 'wtrec';
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
            const fileMap = files.map((file, index) => ({[file.name]: blobURLs[index]})).reduce((a, e) => ({...a, ...e}));
            const config = files
                .map((file, i) => file.name.endsWith('.js') ?
                    {[`${file.name.split(/[\/.]/)[3]}`]: blobURLs[i] + '#'} : {})
                .reduce((a, r) => ({...a, ...r}), {});
            const wtrec = JSON.parse(await zip.files['wtrec.json'].async('string'));
            const {data} = wtrec;
            for (let i = 0; i < data.length; i++) {
                const current = data[i];
                if (current.wtrec.type === 'receive') {
                    try {
                        if (current.msg === 'game_client') {
                            let content = current.content;
                            content = content.replace('require.config', `require.config({paths: ${JSON.stringify(config)}});\n`);
                            content = content.replace(`game-${current.version}/game`, `./game`);
                            const container = document.createElement('div');
                            container.innerHTML = content;
                            const links = Array.from(container.querySelectorAll('link'));
                            links.map(link => {
                                const href = link.getAttribute('href');
                                const url = fileMap[href];
                                if (url) {
                                    link.setAttribute('href', url);
                                }
                            });
                            const images = Array.from(container.querySelectorAll('img'));
                            images.map(image => {
                                const src = image.getAttribute('src');
                                const url = fileMap[src];
                                if (url) {
                                    image.setAttribute('src', url);
                                }
                            });
                            current.content = container.innerHTML;
                            console.log(current.content)
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
            if (msg === 'play') {
                this.data = [];
                this.isRecording = true;
                this.startTime = new Date().getTime();
            }
            if (this.isRecording && data) {
                // filter ping / pong / login_cookie
                const currentTime = new Date().getTime();
                const timing = currentTime - this.startTime;
                this.data.push({...JSON.parse(JSON.stringify(data)), wtrec: {type: 'send', timing}});
            }
        })
        IOHook.handle_message.before.addHandler('wtrec', (data) => {
            if (this.isRecording && data) {
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

                // this.blobURLs = this.blobs.map(b => URL.createObjectURL(b));
                //
                // URL.createObjectURL(this.blobs[i])
                // this.config = this.sources
                //     .map((r, i) => ({[`${r.split(/[\/.]/)[3]}`]: this.blobURLs[i] + '#'}))
                //     .reduce((a, r) => ({...a, ...r}), {});
                /*
                require.config({
    paths: DWEM.Modules.WTRec.config
});
{
    version: '0.1'
    resources:
    data: []
}

wtrec.json
{
    version: '0.1',
    data:
}
resources/*
resources/tiles.json // compatibility mode
record_wtrec = true

playWTRec();
                 */
            }
        }, 999);
    }
}
