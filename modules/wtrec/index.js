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

    async playWTRec() {
        await new Promise(resolve => {
            require(['jquery', 'jquery-ui'], resolve);
        });

        const {IOHook} = DWEM.Modules;
        const sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';

        let currentIndex = 0;
        let currentSpeed = 1;
        let isPlaying = true;
        let stepSize = 1;
        let abortSleep = false;
        let manualStep = false;

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

            // UI creation
            const uiContainer = document.createElement('div');
            uiContainer.style.position = 'fixed';
            uiContainer.style.top = '10px';
            uiContainer.style.left = '10px';
            uiContainer.style.zIndex = '10000';
            uiContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            uiContainer.style.color = 'white';
            uiContainer.style.padding = '10px';
            uiContainer.style.borderRadius = '5px';
            uiContainer.style.fontSize = '12px';
            uiContainer.style.width = '200px';

            const currentMsgDisplay = document.createElement('div');
            const currentIndexDisplay = document.createElement('div');
            const totalLengthDisplay = document.createElement('div');
            const progressDisplay = document.createElement('div');
            const sleepTimeDisplay = document.createElement('div');

            const updateUI = (originalSleep, adjustedSleep) => {
                currentMsgDisplay.textContent = `Current msg: ${data[currentIndex].msg}`;
                currentIndexDisplay.textContent = `Current index: ${currentIndex}`;
                totalLengthDisplay.textContent = `Total length: ${data.length}`;
                progressDisplay.textContent = `Progress: ${((currentIndex / data.length) * 100).toFixed(2)}%`;
                sleepTimeDisplay.textContent = `Sleep: ${originalSleep.toFixed(2)}ms (Adjusted: ${adjustedSleep.toFixed(2)}ms)`;
            };

            updateUI(0, 0);

            uiContainer.appendChild(currentMsgDisplay);
            uiContainer.appendChild(currentIndexDisplay);
            uiContainer.appendChild(totalLengthDisplay);
            uiContainer.appendChild(progressDisplay);
            uiContainer.appendChild(sleepTimeDisplay);

            const playPauseButton = document.createElement('button');
            playPauseButton.textContent = 'Play/Pause';
            playPauseButton.onclick = () => {
                isPlaying = !isPlaying;
            };
            uiContainer.appendChild(playPauseButton);

            const speedInput = document.createElement('input');
            speedInput.type = 'number';
            speedInput.value = 1;
            speedInput.min = '0.1';
            speedInput.step = '0.1';
            speedInput.style.width = '50px';
            speedInput.onchange = () => {
                currentSpeed = parseFloat(speedInput.value);
                abortSleep = true; // Abort the current sleep
            };
            uiContainer.appendChild(document.createTextNode(' Speed: '));
            uiContainer.appendChild(speedInput);

            const stepInput = document.createElement('input');
            stepInput.type = 'number';
            stepInput.value = 1;
            stepInput.min = '1';
            stepInput.style.width = '50px';
            stepInput.onchange = () => {
                stepSize = parseInt(stepInput.value, 10);
            };
            uiContainer.appendChild(document.createTextNode(' Step size: '));
            uiContainer.appendChild(stepInput);

            const leftButton = document.createElement('button');
            leftButton.textContent = '<<';
            leftButton.onclick = () => {
                IOHook.handle_message({msg: 'map', clear: true});
                IOHook.handle_message({msg: 'close_all_menus'});
                currentIndex = Math.max(0, currentIndex - stepSize);
                manualStep = true;
                abortSleep = true; // Abort the current sleep
                updateUI(0, 0);
            };
            uiContainer.appendChild(leftButton);

            const rightButton = document.createElement('button');
            rightButton.textContent = '>>';
            rightButton.onclick = () => {
                IOHook.handle_message({msg: 'map', clear: true});
                IOHook.handle_message({msg: 'close_all_menus'});
                currentIndex = Math.min(data.length - 1, currentIndex + stepSize);
                manualStep = true;
                abortSleep = true;
                updateUI(0, 0);
            };
            uiContainer.appendChild(rightButton);

            document.body.appendChild(uiContainer);
            $(uiContainer).draggable();

            while (currentIndex < data.length) {
                if (isPlaying || manualStep) {
                    const current = data[currentIndex];
                    const nextIndex = Math.min(currentIndex + 1, data.length - 1);
                    const next = data[nextIndex];

                    try {
                        if (current.wtrec.type === 'receive') {
                            if (current.msg === 'game_client') {
                                this.safeMode = false;
                                for (let j = currentIndex + 1; j < data.length; j++) {
                                    if (data[j].msg === 'version') {
                                        this.gitVersion = data[j].text.split('-g').pop();
                                        break;
                                    }
                                }
                                this.safeResourcePath = `https://cdn.jsdelivr.net/gh/crawl/crawl@${this.gitVersion}/crawl-ref/source/webserver/game_data/static/`;
                                let content = current.content;
                                let config = files.map((file, i) => {
                                    if (file.name.endsWith('.js')) {
                                        const name = file.name.split(/[\/.]/)[3];
                                        return {[name]: this.safeMode ? this.safeResourcePath + name : blobURLs[i] + '#'};
                                    } else {
                                        return {};
                                    }
                                }).reduce((a, r) => ({...a, ...r}), {});

                                content = content.replace('require.config', `require.config({paths: ${JSON.stringify(config)}});\n`);
                                content = content.replace(/game-[a-f0-9]{40}\/game/, `./game`);
                                const matches = content.match(/\/gamedata\/[a-f0-9]{40}\/[^\s"']+/g);
                                const fileKeys = Object.keys(fileMap);
                                for (const match of matches) {
                                    let url = fileMap[match];
                                    if (!url) {
                                        const file = match.split('/').pop();
                                        const matchFile = fileKeys.find(f => f.endsWith(file));
                                        url = fileMap[matchFile];
                                    }
                                    content = content.replace(match, url);
                                }
                                current.content = content;
                                console.log(content);
                            } else if (current.msg === 'options') {
                                this.inited = true;
                            } else {
                                console.log(current);
                            }
                            IOHook.handle_message(current);
                        }
                    } catch (e) {
                        console.error(e, current);
                    }

                    const originalSleep = next.wtrec.timing - current.wtrec.timing;
                    const adjustedSleep = originalSleep / currentSpeed;

                    updateUI(originalSleep, adjustedSleep);

                    manualStep = false; // Reset manual step flag
                    abortSleep = false;
                    const sleepPromise = sleep(adjustedSleep);
                    await Promise.race([sleepPromise, new Promise((resolve) => {
                        const interval = setInterval(() => {
                            if (abortSleep) {
                                clearInterval(interval);
                                resolve();
                            }
                        }, 10);
                    })]);

                    if (!manualStep) {
                        currentIndex = nextIndex;
                    }
                } else {
                    await sleep(100);
                }
            }
        };
        input.click();
    }


    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function injectSource1() {
            console.log('hello');
        }

        const myMapper1 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource1.toString()}()`);
        MR.matchers['my-matcher'] = {
            'test': ({module}) => {
                console.log(module)
                return false;
            }
        };
        SMR.add('my-matcher:test', myMapper1);

        const {IOHook} = DWEM.Modules;
        IOHook.send_message.before.addHandler('wtrec', (msg, data) => {
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

        require.config({
            paths: {
                'jquery-ui': 'https://code.jquery.com/ui/1.12.1/jquery-ui.min'
            },
            shim: {
                'jquery-ui': {
                    deps: ['jquery'],
                    exports: '$'
                }
            }
        });
    }
}
