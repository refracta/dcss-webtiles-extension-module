import JSZip from 'https://cdn.skypack.dev/jszip@3.10.1';

// TODO: https://github.com/crawl/crawl/blob/master/crawl-ref/source/sound.h#L41

export default class SoundSupport {
    static name = 'SoundSupport';
    static version = '0.1';
    static dependencies = ['RCManager', 'IOHook', 'SiteInformation', 'CommandManager'];
    static description = '(Beta) This module implements sound features in the webtiles environment. You can use it by adding a sound pack to the RC configuration.';

    constructor() {
        this.dbName = 'SoundPackDB';
        this.storeName = 'soundPacks';
        this.soundManager = new SoundManager();
        this.currentBgmPath = null;
        this.currentBgmPlace = null;
        this.currentBgmDepth = null;

        this._playerPlace = null;
        this._playerDepthRaw = null;
        this._playerDepth = null;
        this._playerOrbHeld = false;
        this._bgmContextKey = null;
        this._bgmRequestId = 0;
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
        const {RCManager} = DWEM.Modules;
        const soundOn = RCManager.getRCOption(rcfile, 'sound_on', 'boolean');
        const soundFadeTime = RCManager.getRCOption(rcfile, 'sound_fade_time', 'float', 0.5);
        const soundVolume = RCManager.getRCOption(rcfile, 'sound_volume', 'float', 1);
        const bgmVolume = RCManager.getRCOption(rcfile, 'bgm_volume', 'float', soundVolume);
        const oneSDLSoundChannel = RCManager.getRCOption(rcfile, 'one_SDL_sound_channel', 'boolean');
        const soundDebug = RCManager.getRCOption(rcfile, 'sound_debug', 'boolean');

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

        return {
            soundOn,
            soundVolume,
            bgmVolume,
            soundFadeTime,
            oneSDLSoundChannel,
            soundPackConfigList,
            soundDebug,
            dwemBgmData: [],
            dwemBgmTriggerData: [],
            fileIndex: {}
        };
    }

    #getMatchResult(rcfile, soundFilePath = '') {
        const matchData = [];
        const bgmData = [];
        const bgmTriggerData = [];

        const lines = rcfile.split(/\r?\n/);
        for (let rawLine of lines) {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) {
                continue;
            }

            const parsedPath = this._parseSoundFilePath(trimmedLine);
            if (parsedPath !== null) {
                soundFilePath = parsedPath;
                continue;
            }

            if (trimmedLine.startsWith('dwem_bgm_trigger')) {
                const parsed = this._parseBgmArgs(trimmedLine);
                if (!parsed) {
                    console.error(`Invalid dwem_bgm_trigger line: `, rawLine);
                    continue;
                }
                const weight = parseFloat(parsed.weightText);
                if (!Number.isFinite(weight) || weight < 0) {
                    console.error(`Invalid dwem_bgm_trigger weight: `, rawLine);
                    continue;
                }
                const triggerName = this._stripQuotes(parsed.nameText).trim();
                const path = this._buildAudioPath(soundFilePath, parsed.pathText);
                bgmTriggerData.push({trigger: triggerName.toLowerCase(), weight, path});
                continue;
            }

            if (trimmedLine.startsWith('dwem_bgm')) {
                const parsed = this._parseBgmArgs(trimmedLine);
                if (!parsed) {
                    console.error(`Invalid dwem_bgm line: `, rawLine);
                    continue;
                }
                const weight = parseFloat(parsed.weightText);
                if (!Number.isFinite(weight) || weight < 0) {
                    console.error(`Invalid dwem_bgm weight: `, rawLine);
                    continue;
                }
                const placeToken = this._stripQuotes(parsed.nameText).trim();
                const placeParsed = this._parsePlaceWithDepth(placeToken);
                const place = placeParsed.place;
                const placeKey = this._normalizePlaceKey(place);
                const path = this._buildAudioPath(soundFilePath, parsed.pathText);
                bgmData.push({
                    place,
                    placeKey,
                    depth: placeParsed.depth,
                    weight,
                    path
                });
                continue;
            }

            if (!/^\s*sound\s*[+^]=\s*.+$/.test(trimmedLine)) {
                continue;
            }

            try {
                const config = trimmedLine.split(/[+^]=/)[1].trim().split(/(?<!\\):/);
                let [regex, path] = config;
                regex = new RegExp(regex);
                path = this._buildAudioPath(soundFilePath, path);
                matchData.push({regex, path});
            } catch (e) {
                console.error(`Invalid sound line: `, rawLine, e);
            }
        }

        return {matchData, bgmData, bgmTriggerData, soundFilePath};
    }

    _stripQuotes(text) {
        const trimmed = (text || '').trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
            || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    _parseSoundFilePath(line) {
        const match = line.match(/^sound_file_path\s*=\s*(.*?)\s*$/);
        if (!match) {
            return null;
        }
        let path = match[1].trim();
        const hashIndex = path.indexOf('#');
        if (hashIndex >= 0) {
            path = path.slice(0, hashIndex).trim();
        }
        path = this._stripQuotes(path).trim();
        if (path.length > 0 && !path.endsWith('/')) {
            path += '/';
        }
        return path;
    }

    _buildAudioPath(basePath, filePath) {
        let normalizedBase = this._stripQuotes(basePath || '').trim();
        let normalizedFile = this._stripQuotes(filePath || '').replaceAll('\\', '/').trim();
        const hashIndex = normalizedFile.indexOf('#');
        if (hashIndex >= 0) {
            normalizedFile = normalizedFile.slice(0, hashIndex).trim();
        }
        if (normalizedFile.startsWith('./')) {
            normalizedFile = normalizedFile.slice(2);
        }

        if (!normalizedBase) {
            return normalizedFile;
        }
        if (!normalizedBase.endsWith('/')) {
            normalizedBase += '/';
        }
        return `${normalizedBase}${normalizedFile}`;
    }

    _parseParenArgs(line) {
        const openIdx = line.indexOf('(');
        const closeIdx = line.lastIndexOf(')');
        if (openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx) {
            return null;
        }
        const body = line.substring(openIdx + 1, closeIdx);
        const parts = [];
        let current = '';
        let quote = null;
        let escaping = false;

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (escaping) {
                current += ch;
                escaping = false;
                continue;
            }
            if (ch === '\\') {
                current += ch;
                escaping = true;
                continue;
            }
            if (quote) {
                current += ch;
                if (ch === quote) {
                    quote = null;
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                // Only treat quotes as delimiters at the start of an argument.
                // This avoids breaking unquoted apostrophes like "Spider's Nest".
                if (current.trim().length === 0) {
                    quote = ch;
                }
                current += ch;
                continue;
            }
            if (ch === ',') {
                parts.push(current);
                current = '';
                continue;
            }
            current += ch;
        }
        parts.push(current);
        return parts;
    }

    _parseBgmArgs(line) {
        const parts = this._parseParenArgs(line);
        if (!parts || parts.length < 3) {
            return null;
        }
        return {
            nameText: parts[0].trim(),
            weightText: parts[1].trim(),
            pathText: parts.slice(2).join(',').trim()
        };
    }

    _parsePlaceWithDepth(placeText) {
        const trimmed = (placeText || '').trim();
        const match = trimmed.match(/^(.*)\s*:\s*([0-9]+)$/);
        if (!match) {
            return {place: trimmed, depth: null};
        }
        return {
            place: match[1].trim(),
            depth: parseInt(match[2], 10)
        };
    }

    _normalizePlaceKey(placeText) {
        let s = (placeText || '').trim().toLowerCase();
        s = s.replace(/[’]/g, "'");
        s = s.replace(/'s\b/g, '');
        s = s.replace(/'/g, '');
        s = s.replace(/\s+/g, ' ');
        if (s.startsWith('the ')) {
            s = s.slice(4);
        } else if (s.startsWith('an ')) {
            s = s.slice(3);
        } else if (s.startsWith('a ')) {
            s = s.slice(2);
        }
        return s.trim();
    }

    _normalizeDepthRaw(depth) {
        const parsed = parseInt(depth, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        return parsed;
    }

    _normalizeDepth(depth) {
        const parsed = parseInt(depth, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }
        return parsed;
    }

    _pickWeighted(entries) {
        let totalWeight = 0;
        for (const item of entries) {
            totalWeight += item.weight;
        }
        if (!totalWeight) {
            return null;
        }
        const random = Math.random() * totalWeight;
        let sum = 0;
        for (const item of entries) {
            sum += item.weight;
            if (random <= sum) {
                return item;
            }
        }
        return entries[entries.length - 1] || null;
    }

    _findBgmCandidates(placeKey, depth) {
        const candidates = [];
        for (const bgm of this.soundConfig.dwemBgmData || []) {
            if (bgm.placeKey !== placeKey) {
                continue;
            }
            if (bgm.depth === null) {
                candidates.push(bgm);
                continue;
            }
            if (depth !== null && bgm.depth === depth) {
                candidates.push(bgm);
            }
        }
        return candidates;
    }

    _resolveBgmBlob(soundPath) {
        if (!soundPath || !this.soundConfig || !this.soundConfig.fileIndex) {
            return null;
        }
        const normalized = this._buildAudioPath('', soundPath).replace(/^\/+/, '');
        const direct = this.soundConfig.fileIndex[normalized];
        if (direct) {
            return direct;
        }
        const basename = normalized.split('/').pop();
        if (!basename) {
            return null;
        }
        const keys = Object.keys(this.soundConfig.fileIndex);
        const matchKey = keys.find((key) => key === basename || key.endsWith(`/${basename}`));
        return matchKey ? this.soundConfig.fileIndex[matchKey] : null;
    }

    _stopBgm() {
        // Cancel any in-flight async bgm loads so they can't restart playback after we stop.
        this._bgmRequestId++;
        this.currentBgmPath = null;
        this.currentBgmPlace = null;
        this.currentBgmDepth = null;
        this._bgmContextKey = null;
        this.soundManager.stopBgm?.();
    }

    async _setBgm(soundPath) {
        const requestId = ++this._bgmRequestId;
        if (this.currentBgmPath === soundPath && this.soundManager.currentlyLoopingBgm) {
            return;
        }
        const selected = this._resolveBgmBlob(soundPath);
        if (!selected) {
            if (this.soundConfig.soundDebug) {
                console.warn(`[SoundSupport][BGM] Missing file: ${soundPath}`);
            }
            return;
        }
        let audioBuffer = selected.audioBuffer;
        if (!audioBuffer) {
            audioBuffer = selected.audioBuffer = await this.soundManager.blobToAudioBuffer(selected);
        }
        if (requestId !== this._bgmRequestId) {
            return;
        }
        this.currentBgmPath = soundPath;
        this.soundManager.playLoop(audioBuffer);
    }

    _playBgmTrigger(triggerName, rawData) {
        const triggerKey = String(triggerName || '').trim().toLowerCase();
        if (!triggerKey) {
            return;
        }
        const candidates = (this.soundConfig.dwemBgmTriggerData || []).filter((e) => e.trigger === triggerKey);
        const currentPath = this.currentBgmPath;
        const selected = this._pickWeighted(candidates);

        if (this.soundConfig.soundDebug) {
            const candidateList = candidates.map((entry) => ({
                trigger: entry.trigger,
                weight: entry.weight,
                path: entry.path
            }));
            console.log(
                `[SoundSupport][BGM] Trigger="${triggerName}"\n` +
                `  rawPlace=${JSON.stringify(rawData?.place)} rawDepth=${JSON.stringify(rawData?.depth)}\n` +
                `  candidates=${JSON.stringify(candidateList)}\n` +
                `  selected=${selected?.path ?? 'none'}\n` +
                `  current=${currentPath ?? 'none'}`
            );
        }

        if (!selected) {
            return;
        }
        if (currentPath === selected.path && this.soundManager.currentlyLoopingBgm) {
            return;
        }
        this._setBgm(selected.path);
    }

    _handlePlayerMessage(data) {
        if (!data || data.msg !== 'player') {
            return;
        }

        const prevPlace = this._playerPlace;
        const prevDepthRaw = this._playerDepthRaw;
        const prevOrbHeld = this._playerOrbHeld;

        if (typeof data.place === 'string') {
            const placeParsed = this._parsePlaceWithDepth(this._stripQuotes(data.place));
            if (placeParsed.place) {
                this._playerPlace = placeParsed.place;
            }
            if ((data.depth === undefined || data.depth === null) && placeParsed.depth !== null) {
                const rawDepth = this._normalizeDepthRaw(placeParsed.depth);
                if (rawDepth !== null) {
                    this._playerDepthRaw = rawDepth;
                    this._playerDepth = this._normalizeDepth(rawDepth);
                }
            }
        }
        if (data.depth !== undefined && data.depth !== null) {
            const rawDepth = this._normalizeDepthRaw(data.depth);
            if (rawDepth !== null) {
                this._playerDepthRaw = rawDepth;
                this._playerDepth = this._normalizeDepth(rawDepth);
            }
        }

        const statusList = Array.isArray(data.status) ? data.status : (Array.isArray(data.statuses) ? data.statuses : null);
        if (statusList) {
            let orbHeld = false;
            for (const entry of statusList) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                const lightRaw = entry.light ?? entry.text ?? '';
                const descRaw = entry.desc ?? '';
                const light = String(lightRaw).replace(/<[^>]*>/g, '').trim();
                const desc = String(descRaw).replace(/<[^>]*>/g, '').trim();
                const col = parseInt(entry.col, 10);
                const descLower = desc.toLowerCase();
                const isCharlatanOrb = descLower.includes("charlatan");

                // Orb trigger condition (confirmed by user):
                // status.light === "Orb" with col === 13 indicates the player is actually holding the Orb.
                if (light.toLowerCase() === 'orb' && col === 13 && !isCharlatanOrb) {
                    orbHeld = true;
                }
            }
            this._playerOrbHeld = orbHeld;
        }

        if (!this._playerPlace) {
            return;
        }

        if (!prevOrbHeld && this._playerOrbHeld) {
            this._bgmContextKey = 'trigger:orb';
            this._playBgmTrigger('Orb', data);
            return;
        }

        // While holding the Orb of Zot, suppress all BGM transitions except explicit end-of-game handling.
        if (this._playerOrbHeld) {
            return;
        }

        if (this._playerPlace === prevPlace && this._playerDepthRaw === prevDepthRaw) {
            return;
        }

        this._playBgmForPlace(this._playerPlace, this._playerDepthRaw, data);
    }

    _playBgmForPlace(place, depthRaw, rawData) {
        const placeKey = this._normalizePlaceKey(place);
        const depthParsed = this._normalizeDepthRaw(depthRaw);
        const normalizedDepth = this._normalizeDepth(depthParsed);
        const isStartGame = placeKey === 'dungeon' && depthParsed === 0;
        const contextKey = isStartGame ? `${placeKey}:0` : (normalizedDepth !== null ? `${placeKey}:${normalizedDepth}` : placeKey);
        if (contextKey === this._bgmContextKey) {
            return;
        }

        this._bgmContextKey = contextKey;
        this.currentBgmPlace = place;
        this.currentBgmDepth = isStartGame ? 0 : normalizedDepth;

        if (isStartGame) {
            this._playBgmTrigger('StartGame', rawData);
            return;
        }

        const candidates = this._findBgmCandidates(placeKey, normalizedDepth);
        const currentPath = this.currentBgmPath;
        const selected = this._pickWeighted(candidates);

        if (this.soundConfig.soundDebug) {
            const candidateList = candidates.map((entry) => ({
                place: entry.depth !== null ? `${entry.place}:${entry.depth}` : entry.place,
                weight: entry.weight,
                path: entry.path
            }));
            console.log(
                `[SoundSupport][BGM] Place="${place}" depth=${normalizedDepth} (raw=${depthParsed})\n` +
                `  rawPlace=${JSON.stringify(rawData?.place)} rawDepth=${JSON.stringify(rawData?.depth)}\n` +
                `  candidates=${JSON.stringify(candidateList)}\n` +
                `  selected=${selected?.path ?? 'none'}\n` +
                `  current=${currentPath ?? 'none'}`
            );
        }

        if (!selected) {
            this.currentBgmPath = null;
            this.soundManager.stopBgm?.();
            return;
        }
        if (currentPath === selected.path && this.soundManager.currentlyLoopingBgm) {
            return;
        }
        this._setBgm(selected.path);
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
            soundOn, soundVolume, bgmVolume, soundFadeTime, oneSDLSoundChannel, soundPackConfigList
        } = this.soundConfig;
        if (!soundOn) {
            return;
        }
        this.soundManager.volume = soundVolume;
        this.soundManager.bgmVolume = bgmVolume;
        this.soundManager.fadeTime = soundFadeTime;
        this._stopBgm();
        this._playerPlace = null;
        this._playerDepthRaw = null;
        this._playerDepth = null;
        this._playerOrbHeld = false;
        this.soundConfig.dwemBgmData = [];
        this.soundConfig.dwemBgmTriggerData = [];
        this.soundConfig.fileIndex = {};
        let totalBytes = 0;
        let totalMatchData = 0;
        let totalBgmData = 0;
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
            let allBgmData = [];
            let allBgmTriggerData = [];
            let soundFilePath = '';
            for (const txt of txtFiles) {
                const matchResult = this.#getMatchResult(txt, soundFilePath);
                soundFilePath = matchResult.soundFilePath;
                const {matchData} = matchResult;
                allMatchData = [...allMatchData, ...matchData];
                allBgmData = [...allBgmData, ...matchResult.bgmData];
                allBgmTriggerData = [...allBgmTriggerData, ...matchResult.bgmTriggerData];
            }
            totalMatchData += allMatchData.length;
            config.matchData = allMatchData;
            config.dwemBgmData = allBgmData;
            config.dwemBgmTriggerData = allBgmTriggerData;
            totalBgmData += allBgmData.length;
            this.soundConfig.dwemBgmData.push(...allBgmData);
            this.soundConfig.dwemBgmTriggerData.push(...allBgmTriggerData);
            for (const [path, file] of Object.entries(config.files)) {
                if (!this.soundConfig.fileIndex[path]) {
                    this.soundConfig.fileIndex[path] = file;
                }
            }
            if (config.files['sound-pack-info']) {
                const soundPackInfo = await blobToText(config.files['sound-pack-info']);
                this.sendMessage(`<cyan>[SoundSupport]</cyan> ${soundPackInfo.trim()}`);
            }
        }
        soundPackConfigList = soundPackConfigList.filter(config => config.soundPack);
        let totalMegaBytes = totalBytes / (1024 * 1024);
        this.sendMessage(`<cyan>[SoundSupport]</cyan> ${soundPackConfigList.length} sound pack (${Math.floor(totalMegaBytes * 10) / 10} MB), ${totalMatchData} sound + ${totalBgmData} bgm data loaded successfully.`);
    }

    onLoad() {
        const {RCManager, IOHook, SiteInformation, CommandManager} = DWEM.Modules;

        CommandManager.addCommand('/SoundSupport list', [], async () => {
            try {
                const soundPacks = await this.getSoundPacks();
                const soundPackList = soundPacks.map((pack, index) => `[${index + 1}] ${pack.url}`).join('<br>');
                this.sendChatMessage(`<b>[SoundSupport]</b> Local Sound Packs:<br>${soundPackList}`);
            } catch (error) {
                this.sendChatMessage(`<b>[SoundSupport]</b> Error listing sound packs: ${error.message}`);
            }
        }, {
            module: SoundSupport.name,
            description: 'List all local sound packs',
            aliases: ['/ss list']
        });

        CommandManager.addCommand('/SoundSupport register', [], async () => {
            try {
                await this.registerSoundPack();
                this.sendChatMessage(`<b>[SoundSupport]</b> Sound pack registered successfully.`);
            } catch (error) {
                this.sendChatMessage(`<b>[SoundSupport]</b> Error registering sound pack: ${error.message}`);
            }
        }, {
            module: SoundSupport.name,
            description: 'Register local sound pack',
            aliases: ['/ss register']
        });

        CommandManager.addCommand('/SoundSupport remove', ['string'], async (url) => {
            try {
                await this.removeSoundPack(url);
                this.sendChatMessage(`<b>[SoundSupport]</b> Sound pack removed: ${url}`);
            } catch (error) {
                this.sendChatMessage(`<b>[SoundSupport]</b> Error removing sound pack: ${error.message}`);
            }
        }, {
            module: SoundSupport.name,
            description: 'Remove local sound pack',
            argDescriptions: ['URL'],
            aliases: ['/ss remove']
        });

        CommandManager.addCommand('/SoundSupport clear', [], async () => {
            try {
                await this.clearSoundPacks();
                this.sendChatMessage(`<b>[SoundSupport]</b> All sound packs cleared.`);
            } catch (error) {
                this.sendChatMessage(`<b>[SoundSupport]</b> Error clearing sound packs: ${error.message}`);
            }
        }, {
            module: SoundSupport.name,
            description: 'Clear all local sound packs',
            aliases: ['/ss clear']
        });

        CommandManager.addCommand('/SoundSupport volume', ['float'], async (vol) => {
            const newVolume = parseFloat(vol);
            if (!isNaN(newVolume) && newVolume >= 0 && newVolume <= 1) {
                this.soundManager.volume = newVolume;
                this.sendChatMessage(`<b>[SoundSupport]</b> Sound volume set to ${newVolume}`);
            } else {
                this.sendChatMessage(`<b>[SoundSupport]</b> Invalid volume value. Please provide a number between 0 and 1.`);
            }
        }, {
            module: SoundSupport.name,
            description: 'Set sound volume',
            argDescriptions: ['0-1'],
            aliases: ['/ss volume', '/sv']
        });

        CommandManager.addCommand('/SoundSupport reload', [], async () => {
            for (const config of this.soundConfig.soundPackConfigList) {
                await this.removeSoundPack(config.url);
            }
            await this.loadSoundPacks();
        }, {
            module: SoundSupport.name,
            description: 'Force reload sound pack',
            aliases: ['/ss reload']
        });

        CommandManager.addCommand('/SoundSupport test', ['text'], async (text) => {
            IOHook.handle_message({
                msg: 'msgs', messages: [{ text }]
            });
        }, {
            module: SoundSupport.name,
            description: 'Output a message for sound testing',
            argDescriptions: ['message'],
            aliases: ['/ss test']
        });

        CommandManager.addCommand('/SoundSupport', [], () => {
            const list = CommandManager.getCommandsByModule(SoundSupport.name).filter(c => c.command !== '/SoundSupport');
            const html = `<b>[SoundSupport]</b><br>` + CommandManager.generateHelpHTML(list);
            CommandManager.sendChatMessage(html);
        }, {
            module: SoundSupport.name,
            description: 'Show SoundSupport commands',
            aliases: ['/ss']
        });
        RCManager.addHandlers('sound-support-rc-handler', {
            onGameInitialize: (rcfile) => {
                const queue = [];
                IOHook.handle_message.before.addHandler('sound-support-save-msgtests', (data) => {
                                     console.log(data);

                });
                IOHook.handle_message.before.addHandler('sound-support-save-msgs', (data) => {
                    if (data.msg === 'msgs' || data.msg === 'player' || data.msg === 'go_lobby' || data.msg === 'game_ended') {
                        queue.push(JSON.parse(JSON.stringify(data)));
                    }
                });
                this.soundConfig = this.#getSoundConfig(rcfile);
                this._stopBgm();
                this._playerPlace = null;
                this._playerDepthRaw = null;
                this._playerDepth = null;
                this._playerOrbHeld = false;
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
                const handleBgmMessage = (data) => {
                    if (data.msg === 'player') {
                        this._handlePlayerMessage(data);
                    } else if (data.msg === 'game_ended') {
                        this._bgmContextKey = 'trigger:endgame';
                        this._playBgmTrigger('EndGame', data);
                    } else if (data.msg === 'go_lobby') {
                        this._stopBgm();
                        this._playerPlace = null;
                        this._playerDepthRaw = null;
                        this._playerDepth = null;
                        this._playerOrbHeld = false;
                    }
                };
                this.loadSoundPacks().then(() => {
                    IOHook.handle_message.before.removeHandler('sound-support-save-msgs');
                    if (SiteInformation.current_hash !== '#lobby') {
                        IOHook.handle_message.before.addHandler('sound-support-sound-handler', (data) => {
                            if (data.msg === 'msgs' && data.messages) {
                                handleSoundMessage(data);
                            }
                        }, 1);
                        IOHook.handle_message.before.addHandler('sound-support-bgm-handler', (data) => {
                            if (data.msg === 'player' || data.msg === 'go_lobby' || data.msg === 'game_ended') {
                                handleBgmMessage(data);
                            }
                        }, 1);
                        for (const data of queue) {
                            if (data.msg === 'msgs' && data.messages) {
                                handleSoundMessage(data);
                            } else if (data.msg === 'player' || data.msg === 'go_lobby' || data.msg === 'game_ended') {
                                handleBgmMessage(data);
                            }
                        }
                    }
                });
            },
            onGameEnd: () => {
                IOHook.handle_message.before.removeHandler('sound-support-sound-handler');
                IOHook.handle_message.before.removeHandler('sound-support-bgm-handler');
                this._stopBgm();
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
    constructor(options = {fadeTime: 0, volume: 1, bgmVolume: 1}) {
        this.context = new AudioContext();
        this.fadeTime = options.fadeTime;
        this.volume = options.volume;
        this.bgmVolume = options.bgmVolume;
        this.loopData = null;
        this.currentlyLoopingBgm = false;
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

    stopBgm() {
        if (!this.loopData) {
            return;
        }
        const {source} = this.loopData;
        source.stop(0);
        this.loopData = null;
        this.currentlyLoopingBgm = false;
    }

    playLoop(buffer) {
        if (this.loopData) {
            this.stopBgm();
        }
        const gainNode = this.context.createGain();
        gainNode.gain.value = this.bgmVolume;

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gainNode);
        gainNode.connect(this.context.destination);
        source.start(0);

        this.loopData = {source, gainNode};
        this.currentlyLoopingBgm = true;
    }
}
