import JSZip from 'https://cdn.skypack.dev/jszip';

// TODO: https://github.com/crawl/crawl/blob/master/crawl-ref/source/sound.h#L41

export default class SoundSupport {
    static name = 'SoundSupport';
    static version = '0.1';
    static dependencies = ['RCManager', 'IOHook', 'SiteInformation'];
    static description = '(Beta) This module implements sound features in the webtiles environment. You can use it by adding a sound pack to the RC configuration.';

    constructor() {
        this.dbName = 'SoundPackDB';
        this.storeName = 'soundPacks';
        this.soundManager = new SoundManager();
        this.initDB();
    }

    initDB() {
        const request = indexedDB.open(this.dbName, 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
                db.createObjectStore(this.storeName, {keyPath: 'url'});
            }
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
        };

        request.onsuccess = (event) => {
            this.db = event.target.result;
        };
    }

    #getSoundConfig(rcfile) {
        let soundOn = Array.from(rcfile.matchAll(/^(?!\s*#).*sound_on\s*=\s*(\S+)\s*/gm));
        soundOn = soundOn.pop()?.[1];
        soundOn = soundOn === 'true';

        let soundFadeTime = Array.from(rcfile.matchAll(/^(?!\s*#).*sound_fade_time\s*=\s*(\S+)\s*/gm));
        soundFadeTime = soundFadeTime.pop()?.[1];
        if (soundFadeTime && !isNaN(soundFadeTime)) {
            soundFadeTime = parseFloat(soundFadeTime);
        } else {
            soundFadeTime = 0.5;
        }

        let soundVolume = Array.from(rcfile.matchAll(/^(?!\s*#).*sound_volume\s*=\s*(\S+)\s*/gm));
        soundVolume = soundVolume.pop()?.[1];
        if (soundVolume && !isNaN(soundVolume)) {
            soundVolume = parseFloat(soundVolume);
        } else {
            soundVolume = 1;
        }

        let oneSDLSoundChannel = Array.from(rcfile.matchAll(/^(?!\s*#).*one_SDL_sound_channel\s*=\s*(\S+)\s*/gm));
        oneSDLSoundChannel = oneSDLSoundChannel.pop()?.[1];
        oneSDLSoundChannel = oneSDLSoundChannel === 'true';

        const soundPackConfig = rcfile.match(/^(?!\s*#).*sound_pack\s*\+=\s*.+/gm);
        const soundPackConfigList = [];
        if (soundPackConfig) {
            for (const line of soundPackConfig) {
                const config = line.split('+=')[1].trim().split(/:(?!\/\/)/);
                const url = config[0];
                const matchFiles = config.length > 1 ? JSON.parse(config[1]) : [];
                soundPackConfigList.push({url, matchFiles});
            }
        }

        let soundDebug = Array.from(rcfile.matchAll(/^(?!\s*#).*sound_debug\s*=\s*(\S+)\s*/gm));
        soundDebug = soundDebug.pop()?.[1];
        soundDebug = soundDebug === 'true';

        return {
            soundOn, soundVolume, soundFadeTime, oneSDLSoundChannel, soundPackConfigList, soundDebug
        };
    }

    #getMatchResult(rcfile, soundFilePath = '') {
        const matches = rcfile.match(/^(?!\s*#).*sound\s*[+^]=\s*.+|^(?!\s*#).*sound_file_path\s*=\s*.+/gm);
        const matchData = [];
        if (matches) {
            for (const line of matches) {
                if (line.includes('sound_file_path')) {
                    soundFilePath = line.split('=')[1].trim();
                    if (soundFilePath.length > 0 && !soundFilePath.endsWith('/')) {
                        soundFilePath += '/';
                    }
                } else {
                    try {
                        const config = line.split(/[+^]=/)[1].trim().split(/(?<!\\):/);
                        let [regex, path] = config;
                        regex = new RegExp(regex);
                        path = (soundFilePath + path).replaceAll('\\', '/');
                        matchData.push({regex, path});
                    } catch (e) {
                        console.error(`Invalid sound line: `, line, e);
                    }
                }
            }
        }
        return {matchData, soundFilePath};
    }

    waitInputMode() {
        const {IOHook} = DWEM.Modules;
        return new Promise(resolve => {
            const initMatch = (data) => {
                if (data.msg === 'input_mode') {
                    IOHook.handle_message.after.removeHandler('sound-support-init-match');
                    resolve();
                }
            }
            IOHook.handle_message.after.addHandler('sound-support-init-match', initMatch);
        });
    }

    sendMessage(text) {
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message({
            msg: 'msgs', messages: [{text}]
        });
    }

    sendChatMessage(content) {
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message({msg: 'chat', content});
    }

    async getSoundPacks() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);

            const request = objectStore.getAll();

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                console.error('Error listing sound packs:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    async registerSoundPack() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip';
            input.onchange = async (event) => {
                const file = event.target.files[0];
                if (file) {
                    const url = `local://${file.name}`;
                    try {
                        await this.saveSoundPack(url, file);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }
            };
            input.click();
        });
    }

    async clearSoundPacks() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const request = objectStore.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                console.error('Error clearing sound packs:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    async loadSoundPacks() {
        let {
            soundOn, soundVolume, soundFadeTime, oneSDLSoundChannel, soundPackConfigList
        } = this.soundConfig;
        if (!soundOn) {
            return;
        }
        this.soundManager.volume = soundVolume;
        this.soundManager.fadeTime = soundFadeTime;
        let totalBytes = 0;
        let totalMatchData = 0;
        for (let config of soundPackConfigList) {
            let localSoundPack;
            try {
                localSoundPack = await this.getSoundPack(config.url);
            } catch (e) {
                this.sendMessage(`<cyan>[SoundSupport]</cyan> Download sound pack: ${config.url}`);
                try {
                    await this.downloadSoundPack(config.url, function (data) {
                        console.log(data);
                    });
                    localSoundPack = await this.getSoundPack(config.url);
                } catch (e) {
                    this.sendMessage(`<cyan>[SoundSupport]</cyan> <red>${e.message}</red>`);
                    continue;
                }
            }
            config.files = localSoundPack.files;
            config.soundPack = localSoundPack.soundPack;
            totalBytes += config.soundPack.size;
            const blobToText = blob => new Promise(resolve => {
                let reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsText(blob);
            });
            let txtFiles = Object.keys(config.files);
            if (config.matchFiles.length === 0) {
                txtFiles = txtFiles.filter(e => e.endsWith('.txt'));
            } else {
                txtFiles = config.matchFiles.filter(e => txtFiles.includes(e));
            }
            txtFiles = await Promise.all(txtFiles.map(key => blobToText(config.files[key])));
            let allMatchData = [];
            let soundFilePath = '';
            for (const txt of txtFiles) {
                const matchResult = this.#getMatchResult(txt, soundFilePath);
                soundFilePath = matchResult.soundFilePath;
                const {matchData} = matchResult;
                allMatchData = [...allMatchData, ...matchData];
            }
            totalMatchData += allMatchData.length;
            config.matchData = allMatchData;
        }
        soundPackConfigList = soundPackConfigList.filter(config => config.soundPack);
        let totalMegaBytes = totalBytes / (1024 * 1024);
        this.sendMessage(`<cyan>[SoundSupport]</cyan> ${soundPackConfigList.length} sound pack (${Math.floor(totalMegaBytes * 10) / 10} MB), ${totalMatchData} match data loaded successfully.`);
    }

    onLoad() {
        const {RCManager, IOHook, SiteInformation} = DWEM.Modules;

        // TODO: Migrate to CommandManager
        IOHook.send_message.before.addHandler('sound-support-commander', (msg, data) => {
            if (msg === 'chat_msg') {
                const {text} = data;
                if (text.startsWith('/SoundSupport')) {
                    const args = text.split(' ').slice();
                    (async () => {
                        if (args[1] === 'list') {
                            try {
                                const soundPacks = await this.getSoundPacks();
                                const soundPackList = soundPacks.map((pack, index) => `[${index + 1}] ${pack.url}`).join('<br>');
                                this.sendChatMessage(`<b>[SoundSupport]</b> Local Sound Packs:<br>${soundPackList}`);
                            } catch (error) {
                                this.sendChatMessage(`<b>[SoundSupport]</b> Error listing sound packs: ${error.message}`);
                            }
                        } else if (args[1] === 'register') {
                            try {
                                await this.registerSoundPack();
                                this.sendChatMessage(`<b>[SoundSupport]</b> Sound pack registered successfully.`);
                            } catch (error) {
                                this.sendChatMessage(`<b>[SoundSupport]</b> Error registering sound pack: ${error.message}`);
                            }
                        } else if (args[1] === 'remove') {
                            try {
                                await this.removeSoundPack(args[2]);
                                this.sendChatMessage(`<b>[SoundSupport]</b> Sound pack removed: ${args[2]}`);
                            } catch (error) {
                                this.sendChatMessage(`<b>[SoundSupport]</b> Error removing sound pack: ${error.message}`);
                            }
                        } else if (args[1] === 'clear') {
                            try {
                                await this.clearSoundPacks();
                                this.sendChatMessage(`<b>[SoundSupport]</b> All sound packs cleared.`);
                            } catch (error) {
                                this.sendChatMessage(`<b>[SoundSupport]</b> Error clearing sound packs: ${error.message}`);
                            }
                        } else if (args[1] === 'volume') {
                            const newVolume = parseFloat(args[2]);
                            if (!isNaN(newVolume) && newVolume >= 0 && newVolume <= 1) {
                                this.soundManager.volume = newVolume;
                                this.sendChatMessage(`<b>[SoundSupport]</b> Sound volume set to ${newVolume}`);
                            } else {
                                this.sendChatMessage(`<b>[SoundSupport]</b> Invalid volume value. Please provide a number between 0 and 1.`);
                            }
                        } else if (args[1] === 'reload') {
                            for (const config of this.soundConfig.soundPackConfigList) {
                                await this.removeSoundPack(config.url);
                            }
                            await this.loadSoundPacks();
                        } else if (args[1] === 'test') {
                            const text = args.slice(2).join(' ');
                            IOHook.handle_message({
                                msg: 'msgs', messages: [{
                                    text
                                }]
                            });
                        } else {
                            this.sendChatMessage(`<b>[SoundSupport v${SoundSupport.version}]</b><br>
                                /SoundSupport list: List all local sound packs<br>
                                /SoundSupport register: Register local sound pack<br>
                                /SoundSupport remove [URL]: Remove local sound pack<br>
                                /SoundSupport clear: Clear all local sound packs<br>
                                /SoundSupport volume [0-1]: Set sound volume<br>
                                /SoundSupport reload: Force reload sound pack<br>
                                /SoundSupport test [message]: Output a message for sound testing
                            `);
                        }
                    })();
                    return true;
                }
            }
        });
        RCManager.addHandler('sound-support-rc-handler', async (msg, data) => {
            if (msg === 'play') {
                const queue = [];
                IOHook.handle_message.after.addHandler('sound-support-save-msgs', (data) => {
                    if (data.msg === 'msgs') {
                        queue.push(data);
                    }
                });
                await this.waitInputMode();
                this.soundConfig = this.#getSoundConfig(data.contents);
                await this.loadSoundPacks();
                const handleSoundMessage = async (data) => {
                    const {messages} = data;
                    for (const message of messages.filter(m => m.text)) {
                        const rawText = message.text.replace(/<.+?>/g, '');
                        for (const config of this.soundConfig.soundPackConfigList) {
                            const {files, matchData} = config;
                            const {path, regex} = matchData.find(data => rawText.match(data.regex)) || {};
                            const file = files[path];
                            if (file) {
                                if (this.soundConfig.soundDebug) {
                                    console.log(`${rawText}\n\tregex: ${regex}\n\tpath: ${path} (${file.size} bytes)`);
                                }
                                let audioBuffer;
                                if (file.audioBuffer) {
                                    audioBuffer = files[path].audioBuffer;
                                } else {
                                    file.audioBuffer = audioBuffer = await this.soundManager.blobToAudioBuffer(file);
                                }
                                if (this.soundConfig.oneSDLSoundChannel) {
                                    this.soundManager.stop();
                                }
                                this.soundManager.play(audioBuffer);
                                break;
                            } else if (path) {
                                console.error('No match file:', data);
                            } else {
                                if (this.soundConfig.soundDebug) {
                                    console.log(`${rawText}`);
                                }
                            }
                        }
                    }
                }
                IOHook.handle_message.after.removeHandler('sound-support-save-msgs');

                if (SiteInformation.current_hash !== '#lobby') {
                    IOHook.handle_message.after.addHandler('sound-support-sound-handler', async (data) => {
                        if (data.msg === 'msgs' && data.messages) {
                            handleSoundMessage(data);
                        }
                    });
                    for (const data of queue) {
                        handleSoundMessage(data);
                    }
                }
            } else if (msg === 'go_lobby') {
                IOHook.handle_message.after.removeHandler('sound-support-sound-handler');
            }
        });
    }

    async downloadSoundPack(url, progressCallback) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const contentLength = response.headers.get('content-length');
        if (!contentLength) {
            throw new Error('Content-Length response header unavailable');
        }

        const total = parseInt(contentLength, 10);
        let loaded = 0;

        const reader = response.body.getReader();
        let chunks = [];

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            const progress = (loaded / total) * 100;
            progressCallback({loaded, total, progress});
        }

        const blob = new Blob(chunks);
        await this.saveSoundPack(url, blob);
    }

    async saveSoundPack(url, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const request = objectStore.put({url: url, soundPack: blob});

            request.onsuccess = () => {
                console.log('Sound pack saved successfully');
                resolve();
            };

            request.onerror = (event) => {
                console.error('Error saving sound pack:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    async removeSoundPack(url) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const request = objectStore.delete(url);

            request.onsuccess = () => {
                console.log('Sound pack removed successfully');
                resolve();
            };

            request.onerror = (event) => {
                console.error('Error removing sound pack:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    async getSoundPack(url) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);

            const request = objectStore.get(url);

            request.onsuccess = async (event) => {
                if (event.target.result) {
                    try {
                        const soundPack = event.target.result.soundPack;
                        const arrayBuffer = await soundPack.arrayBuffer();
                        const zip = new JSZip();
                        const unzipped = await zip.loadAsync(arrayBuffer);
                        const files = {};

                        await Promise.all(Object.keys(unzipped.files).map(async (relativePath) => {
                            const file = unzipped.files[relativePath];
                            files[relativePath] = await file.async('blob');
                        }));

                        resolve({soundPack, files});
                    } catch (error) {
                        console.error('Error unzipping sound pack:', error);
                        reject(error);
                    }
                } else {
                    reject('Sound pack not found');
                }
            };

            request.onerror = (event) => {
                console.error('Error getting sound pack:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }
}


class SoundManager {
    constructor(options = {fadeTime: 0, volume: 1}) {
        this.context = new AudioContext();
        this.fadeTime = options.fadeTime;
        this.volume = options.volume;
    }

    blobToAudioBuffer(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onloadend = () => {
                this.context.decodeAudioData(reader.result)
                    .then(audioBuffer => {
                        resolve(audioBuffer);
                    })
                    .catch(error => {
                        reject(error);
                    });
            };

            reader.onerror = (error) => {
                reject(error);
            };

            reader.readAsArrayBuffer(blob);
        });
    }

    play(buffer) {
        const gainNode = this.context.createGain();
        gainNode.gain.value = this.volume;

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);

        gainNode.connect(this.context.destination);
        source.start(0);

        this.previousData = {source, gainNode}
    }

    stop() {
        if (this.previousData) {
            const {gainNode} = this.previousData;
            gainNode.gain.linearRampToValueAtTime(this.volume, this.context.currentTime);
            gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + this.fadeTime);
        }
    }
}
