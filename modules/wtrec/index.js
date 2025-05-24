import JSZip from 'https://cdn.skypack.dev/jszip@3.10.1';

export default class WTRec {
    static name = 'WTRec'
    static version = '0.1'
    static dependencies = ['IOHook']
    static description = '(Beta) This module provides features for webtiles game recording.'

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

    async playWTRec(file, opts = {}) {
        const {IOHook} = DWEM.Modules;
        const {startTime = 0, autoplay = true, speed = 10} = opts;
        await new Promise(resolve => {
            require(['jquery', 'jquery-ui'], resolve);
        })
        const sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

        let currentIndex = 0;
        let currentSpeed = speed;
        let isPlaying = autoplay;
        let stepSize = 100;
        let abortSleep = false;
        let manualStep = false;
        let reachedLobby = false;

        let zip = new JSZip();
        zip = await zip.loadAsync(file);
        const wtrec = JSON.parse(await zip.files['wtrec.json'].async('string'));

        let files = Object.values(zip.files);

        if (files.length === 1 && wtrec.type === 'server') {
            const resource = await fetch(wtrec.resourcePath).then(r => r.blob());
            zip = new JSZip();
            zip = await zip.loadAsync(resource);
            files = Object.values(zip.files).filter(file => !file.dir);
        } else {
            files = files.filter(file => !file.dir && file.name !== 'wtrec.json');
        }

        const blobs = await Promise.all(files.map(file => file.async('blob')));
        const blobURLs = blobs.map(blob => URL.createObjectURL(blob));
        const fileMap = files.map((file, index) => ({[file.name]: blobURLs[index]}))
            .reduce((a, e) => ({...a, ...e}));

        const {data} = wtrec;
        currentIndex = data.findIndex(d => d.wtrec && d.wtrec.timing >= startTime);
        if (currentIndex === -1) currentIndex = 0;

        const segments = [];
        const markers = [];
        let segStart = 0;
        let curPlace = null;
        let curDepth = null;
        for (let i = 0; i < data.length; i++) {
            const m = data[i];
            if (m.msg === 'player' && m.place !== undefined && m.depth !== undefined) {
                const combo = `${m.place}-${m.depth}`;
                if (curPlace === null) {
                    curPlace = combo;
                    curDepth = m.depth;
                    segStart = i;
                } else if (curPlace !== combo) {
                    segments.push({start: segStart, end: i - 1, place: curPlace.split('-')[0], depth: curDepth});
                    curPlace = combo;
                    curDepth = m.depth;
                    segStart = i;
                }
            }
            if (m.msg === 'game_ended' || m.msg === 'go_lobby') {
                markers.push(i);
            }
        }
        if (curPlace !== null) {
            segments.push({start: segStart, end: data.length - 1, place: curPlace.split('-')[0], depth: curDepth});
        }

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
        speedInput.value = currentSpeed;
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
        stepInput.value = stepSize;
        stepInput.min = '1';
        stepInput.style.width = '50px';
        stepInput.onchange = () => {
            stepSize = parseInt(stepInput.value, 10);
        };
        uiContainer.appendChild(document.createTextNode(' Step size: '));
        uiContainer.appendChild(stepInput);

        const lobbyButton = document.createElement('button');
        lobbyButton.textContent = 'Go Lobby';
        lobbyButton.onclick = () => { location.href = '/'; };
        uiContainer.appendChild(lobbyButton);

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

        document.body.tabIndex = 0;
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
            if (e.key === ' ') {
                e.preventDefault();
                isPlaying = !isPlaying;
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                leftButton.onclick();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                rightButton.onclick();
            } else if (e.key === 'x') {
                e.preventDefault();
                currentSpeed = Math.max(0.1, parseFloat((currentSpeed - 0.1).toFixed(1)));
                speedInput.value = currentSpeed;
                abortSleep = true;
            } else if (e.key === 'c') {
                e.preventDefault();
                currentSpeed = parseFloat((currentSpeed + 0.1).toFixed(1));
                speedInput.value = currentSpeed;
                abortSleep = true;
            }
        });

        const progressContainer = document.createElement('div');
        progressContainer.style.position = 'fixed';
        progressContainer.style.bottom = '10px';
        progressContainer.style.left = '50%';
        progressContainer.style.transform = 'translateX(-50%)';
        progressContainer.style.width = '95vw';
        progressContainer.style.zIndex = '10000';
        progressContainer.style.backgroundColor = 'rgba(0,0,0,0.7)';
        progressContainer.style.padding = '5px';
        progressContainer.style.borderRadius = '5px';
        progressContainer.style.boxSizing = 'border-box';

        const segContainer = document.createElement('div');
        segContainer.style.position = 'absolute';
        segContainer.style.top = 0;
        segContainer.style.left = 0;
        segContainer.style.height = '100%';
        segContainer.style.width = '100%';
        segContainer.style.pointerEvents = 'none';
        progressContainer.appendChild(segContainer);

        function hashColor(str, depth) {
            let h = 0;
            for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
            const l = Math.max(30 - depth * 2, 10);
            return `hsl(${h},70%,${l}%)`;
        }

        segments.forEach(seg => {
            const div = document.createElement('div');
            const startPct = seg.start / data.length * 100;
            const widthPct = (seg.end - seg.start + 1) / data.length * 100;
            div.style.position = 'absolute';
            div.style.left = startPct + '%';
            div.style.width = widthPct + '%';
            div.style.top = 0;
            div.style.bottom = 0;
            div.style.backgroundColor = seg.place ? hashColor(seg.place, seg.depth) : 'black';
            segContainer.appendChild(div);
        });

        markers.forEach(idx => {
            const mk = document.createElement('div');
            mk.style.position = 'absolute';
            mk.style.left = (idx / data.length * 100) + '%';
            mk.style.width = '2px';
            mk.style.top = 0;
            mk.style.bottom = 0;
            mk.style.backgroundColor = 'white';
            segContainer.appendChild(mk);
        });

        const progressBar = document.createElement('input');
        progressBar.type = 'range';
        progressBar.min = 0;
        progressBar.max = data.length - 1;
        progressBar.value = currentIndex;
        progressBar.style.width = '100%';
        progressBar.oninput = () => {
            IOHook.handle_message({msg: 'map', clear: true});
            IOHook.handle_message({msg: 'close_all_menus'});
            currentIndex = parseInt(progressBar.value, 10);
            manualStep = true;
            abortSleep = true;
            updateUI(0, 0);
        };
        progressContainer.appendChild(progressBar);

        document.body.appendChild(progressContainer);

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
                        } else if (current.msg === 'go_lobby') {
                            reachedLobby = true;
                        } else {
                            console.log(current);
                        }
                        IOHook.handle_message(current);
                        if (current.msg === 'game_client') {
                            await new Promise(resolve => {
                                require([`game`], (game) => {
                                    const images = Array.from(document.querySelectorAll('#game img'));
                                    const imagePromises = images.map(image => image.complete ? Promise.resolve() : new Promise(r => image.onload = r));
                                    Promise.all(imagePromises).then(resolve);
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.error(e, current);
                }

                const originalSleep = next.wtrec.timing - current.wtrec.timing;
                const adjustedSleep = Math.min(originalSleep / currentSpeed, 1000 * 2);

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
                progressBar.value = currentIndex;
                if (reachedLobby) {
                    break;
                }
            } else {
                await sleep(100);
            }
        }
    }

    async playWTRecByInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.wtrec';
        input.onchange = async (event) => {
            this.playWTRec(event.target.files[0]);
        };
        input.click();
    }


    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        const {IOHook} = DWEM.Modules;
        /* IOHook.send_message.before.addHandler('wtrec', (msg, data) => {
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
        }, 999); */

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

        const params = new URLSearchParams(location.search);
        const wtrecUrl = params.get('wtrec_url');
        if (wtrecUrl) {
            const wtrecTime = parseInt(params.get('wtrec_time') || '0', 10);
            const autoplay = params.get('wtrec_autoplay') !== 'false';
            const speed = parseFloat(params.get('wtrec_speed') || '10');
            fetch(wtrecUrl)
                .then(r => r.blob())
                .then(b => this.playWTRec(b, {startTime: wtrecTime, autoplay, speed}));
        }
    }
}
