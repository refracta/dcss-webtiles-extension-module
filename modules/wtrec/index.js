import JSZip from 'https://cdn.skypack.dev/jszip@3.10.1';

export default class WTRec {
    static name = 'WTRec'
    static version = '0.1'
    static dependencies = ['IOHook', 'CommandManager', 'RCManager']
    static description = '(Beta) This module provides features for webtiles game recording.'

    // --- IndexedDB helpers ---
    generateSessionName(username, ts) {
        const d = ts ? new Date(ts) : new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const nameTs = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
        const player = (username || '').trim() || 'player';
        return `${player}__${nameTs}`;
    }

    async openDB() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('dwem-wtrec', 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('sessions')) {
                    const store = db.createObjectStore('sessions', {keyPath: 'name'});
                    store.createIndex('createdAt', 'createdAt', {unique: false});
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this._dbPromise;
    }

    async saveSession(session) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore('sessions').put(session);
        });
    }

    async listSessions() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readonly');
            const store = tx.objectStore('sessions');
            const req = store.getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => a.createdAt - b.createdAt);
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    async getSession(name) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readonly');
            const req = tx.objectStore('sessions').get(name);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async deleteSession(name) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore('sessions').delete(name);
        });
    }

    // Approximate byte size of a session (messages + resources)
    async estimateSessionSize(session) {
        let bytes = 0;
        try {
            const json = JSON.stringify({version: WTRec.version, data: session.data});
            bytes += new Blob([json]).size;
        } catch (e) {}
        if (Array.isArray(session.blobs)) {
            for (const b of session.blobs) {
                try { bytes += b?.size || 0; } catch (e) {}
            }
        }
        return bytes;
    }

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
        link.download = 'wtrec.wtrec';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Build a downloadable zip from a stored session
    async buildZipFromSession(session) {
        const zip = new JSZip();
        if (Array.isArray(session.resources) && Array.isArray(session.blobs) && session.resources.length === session.blobs.length) {
            for (let i = 0; i < session.resources.length; i++) {
                zip.file(session.resources[i], session.blobs[i]);
            }
        }
        zip.file('wtrec.json', JSON.stringify({version: WTRec.version, data: session.data}));
        return zip.generateAsync({type: 'blob'});
    }

    async playWTRec(file, opts = {}) {
        const {IOHook} = DWEM.Modules;
        const {startTime = 0, autoplay = true, speed = 10} = opts;
        await new Promise(resolve => {
            require(['jquery', 'jquery-ui'], resolve);
        })
        const sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // State message classification
        const stateMessageTypes = {
            critical: ['player', 'map', 'ui_state', 'options', 'game_state'],
            menu: ['menu', 'close_menu', 'close_all_menus', 'update_menu', 'update_menu_items'],
            display: ['cursor', 'minimap_data', 'layout', 'view_data'],
            inventory: ['inv', 'equip', 'item_def', 'update_inv'],
            messages: ['msgs', 'text']
        };

        const isStateMessage = (msg) => {
            if (!msg || !msg.msg) return false;
            return Object.values(stateMessageTypes).flat().includes(msg.msg);
        };

        const isCriticalStateMessage = (msg) => {
            return stateMessageTypes.critical.includes(msg.msg);
        };

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

        // Build message indices for fast lookups
        const messageIndex = {
            player: [],
            map: [],
            menu: [],
            close_menu: [],
            close_all_menus: [],
            update_menu: [],
            ui_state: [],
            cursor: [],
            minimap_data: [],
            inv: [],
            msgs: [],
            options: []
        };

        // Index all messages by type
        data.forEach((msg, idx) => {
            if (msg.msg && messageIndex[msg.msg] !== undefined) {
                messageIndex[msg.msg].push(idx);
            }
        });

        // Helper to find last message of type before index
        const findLastBefore = (indices, targetIdx) => {
            for (let i = indices.length - 1; i >= 0; i--) {
                if (indices[i] < targetIdx) {
                    return indices[i];
                }
            }
            return -1;
        };

        // Create state checkpoints for efficient seeking
        const stateCheckpoints = new Map();
        const checkpointInterval = 1000; // Every 1000 messages

        // Build checkpoints during initial scan
        for (let i = 0; i < data.length; i += checkpointInterval) {
            const checkpoint = {
                index: i,
                lastPlayer: findLastBefore(messageIndex.player, i + 1),
                lastMap: findLastBefore(messageIndex.map, i + 1),
                lastUiState: findLastBefore(messageIndex.ui_state, i + 1),
                lastOptions: findLastBefore(messageIndex.options, i + 1),
                lastInv: findLastBefore(messageIndex.inv, i + 1),
                lastMinimap: findLastBefore(messageIndex.minimap_data, i + 1),
                lastCursor: findLastBefore(messageIndex.cursor, i + 1),
                activeMenus: [] // Will track open menus at this point
            };

            // Track menu state up to this checkpoint
            let menuStack = [];
            for (let j = 0; j <= i && j < data.length; j++) {
                const msg = data[j];
                if (msg.msg === 'menu') {
                    menuStack.push(j);
                } else if (msg.msg === 'close_menu' && menuStack.length > 0) {
                    menuStack.pop();
                } else if (msg.msg === 'close_all_menus') {
                    menuStack = [];
                }
            }
            checkpoint.activeMenus = [...menuStack];

            stateCheckpoints.set(i, checkpoint);
        };

        // Enhanced seeking function with state reconstruction
        const seekToIndex = async (targetIndex, skipMessages = false) => {
            // Validate target index
            targetIndex = Math.max(0, Math.min(targetIndex, data.length - 1));

            // Prevent seeking if already seeking
            if (window.isSeeking) {
                console.warn('Already seeking, ignoring request');
                return;
            }

            // Remember playing state before seeking
            const wasPlayingBeforeSeek = isPlaying;
            isPlaying = false; // Pause during seek
            abortSleep = true; // Abort current sleep

            // Reset reachedLobby if seeking backwards
            if (targetIndex < currentIndex && reachedLobby) {
                reachedLobby = false;
                console.log('Reset reachedLobby flag');
            }

            window.isSeeking = true;

            // Show loading indicator
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 5px;
                z-index: 10002;
            `;
            loadingDiv.textContent = 'Seeking...';
            document.body.appendChild(loadingDiv);

            try {
                // Use setTimeout to let UI update
                await new Promise(resolve => setTimeout(resolve, 0));

            // Clear current state - use safe messages only
            try {
                IOHook.handle_message({msg: 'close_all_menus'});
            } catch (e) {}

            try {
                IOHook.handle_message({msg: 'map', clear: true});
            } catch (e) {}

            // Force clear any lingering UI elements
            try {
                if (window.menu_stack) {
                    window.menu_stack = [];
                }
                $('.menu').remove();
                $('.ui-popup').remove();
                $('#normal').show();
                $('#crt').hide();
            } catch (e) {
                // Ignore errors if elements don't exist
            }

            // Helper function to safely apply a message
            const safeApplyMessage = (msg) => {
                if (!msg || !msg.msg) return;

                try {
                    // Filter out problematic messages
                    if (msg.msg === 'game_client' ||
                        msg.msg === 'version' ||
                        msg.msg === 'html' ||
                        msg.msg === 'ping' ||
                        msg.msg === 'pong') {
                        return;
                    }

                    // Ensure message has valid structure
                    const safeCopy = JSON.parse(JSON.stringify(msg));

                    // For player messages, ensure stats are properly updated
                    if (safeCopy.msg === 'player') {
                        // Ensure numeric values are properly set
                        const numericFields = ['hp', 'hp_max', 'mp', 'mp_max', 'str', 'str_max',
                                               'int', 'int_max', 'dex', 'dex_max', 'ac', 'ev', 'sh',
                                               'xl', 'progress', 'gold', 'depth', 'time', 'turn'];

                        for (const field of numericFields) {
                            if (safeCopy[field] !== undefined && safeCopy[field] !== null) {
                                safeCopy[field] = Number(safeCopy[field]) || 0;
                            }
                        }
                    }

                    IOHook.handle_message(safeCopy);
                } catch (e) {
                    // Silently ignore errors during state reconstruction
                    if (this.debugMode) {
                        console.warn('Failed to apply message during seek:', msg.msg, e);
                    }
                }
            };

            // Find nearest checkpoint
            const checkpointIndex = Math.floor(targetIndex / checkpointInterval) * checkpointInterval;
            const checkpoint = stateCheckpoints.get(checkpointIndex);

            if (checkpoint) {
                // Apply critical state from checkpoint
                const statesToApply = [];

                if (checkpoint.lastPlayer >= 0) {
                    statesToApply.push({idx: checkpoint.lastPlayer, msg: data[checkpoint.lastPlayer]});
                }
                if (checkpoint.lastMap >= 0) {
                    statesToApply.push({idx: checkpoint.lastMap, msg: data[checkpoint.lastMap]});
                }
                if (checkpoint.lastUiState >= 0) {
                    statesToApply.push({idx: checkpoint.lastUiState, msg: data[checkpoint.lastUiState]});
                }
                if (checkpoint.lastOptions >= 0) {
                    statesToApply.push({idx: checkpoint.lastOptions, msg: data[checkpoint.lastOptions]});
                }
                if (checkpoint.lastInv >= 0) {
                    statesToApply.push({idx: checkpoint.lastInv, msg: data[checkpoint.lastInv]});
                }

                // Apply states in chronological order
                statesToApply.sort((a, b) => a.idx - b.idx);

                for (const {msg} of statesToApply) {
                    safeApplyMessage(msg);
                }

                // Replay from checkpoint to target, only critical state messages
                // Skip non-critical messages during seeking for performance
                const criticalTypes = ['player', 'map', 'ui_state', 'options', 'inv', 'equip'];
                const maxIterations = 10000; // Prevent infinite loops
                let iterations = 0;

                for (let i = checkpointIndex; i < targetIndex && i < data.length && iterations < maxIterations; i++) {
                    iterations++;
                    const msg = data[i];
                    if (msg && msg.msg && criticalTypes.includes(msg.msg)) {
                        safeApplyMessage(msg);
                    }

                    // Yield periodically to prevent blocking
                    if (iterations % 100 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }

                if (iterations >= maxIterations) {
                    console.warn('Seeking stopped: maximum iterations reached');
                }
            } else {
                // No checkpoint, replay critical state messages from start
                const criticalTypes = ['player', 'map', 'ui_state', 'options', 'inv', 'equip'];
                const maxIterations = 10000;
                let iterations = 0;

                for (let i = 0; i < targetIndex && i < data.length && iterations < maxIterations; i++) {
                    iterations++;
                    const msg = data[i];
                    if (msg && msg.msg && criticalTypes.includes(msg.msg)) {
                        safeApplyMessage(msg);
                    }

                    // Yield periodically to prevent blocking
                    if (iterations % 100 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }

                if (iterations >= maxIterations) {
                    console.warn('Seeking stopped: maximum iterations reached');
                }
            }

            // Find and apply the last complete menu state if any menu is active
            const lastMenuIdx = findLastBefore(messageIndex.menu, targetIndex);
            if (lastMenuIdx >= 0) {
                // Check if this menu should still be open
                let menuClosed = false;
                for (let i = lastMenuIdx + 1; i < targetIndex; i++) {
                    if (data[i].msg === 'close_menu' || data[i].msg === 'close_all_menus') {
                        menuClosed = true;
                        break;
                    }
                }

                if (!menuClosed) {
                    // Re-apply the menu and all its updates
                    safeApplyMessage(data[lastMenuIdx]);

                    // Apply all menu updates after this menu
                    for (let i = lastMenuIdx + 1; i < targetIndex && i < data.length; i++) {
                        const msg = data[i];
                        if (msg && msg.msg && (msg.msg === 'update_menu' || msg.msg === 'update_menu_items')) {
                            safeApplyMessage(msg);
                        }
                    }
                }
            }

            // Update current index
            currentIndex = targetIndex;
            updateUI(0, 0);

            // Force cursor update with a small delay to ensure UI is ready
            await new Promise(resolve => setTimeout(resolve, 50));
            updateCursor();

            } catch (e) {
                console.error('Error during seeking:', e);
            } finally {
                // Remove loading indicator and reset seeking flag
                loadingDiv.remove();
                window.isSeeking = false;

                // Final cursor update to ensure it's correct
                updateCursor();

                // Restore playing state if it was playing before seek
                if (wasPlayingBeforeSeek) {
                    isPlaying = true;
                    console.log('Restoring playback after seek');
                }

                // Always force wake up the playback loop after seeking
                abortSleep = true;
                manualStep = true;
            }
        };

        let startIndex = data.findIndex(d => d.wtrec && d.wtrec.timing >= startTime);
        if (startIndex === -1) startIndex = 0;
        const gameClientIndex = data.findIndex(d => d.msg === 'game_client');
        const warmupIndex = Math.max(0, startIndex - 100);
        let fastForwardTargets = [];
        if (gameClientIndex !== -1) fastForwardTargets.push(gameClientIndex);
        if (warmupIndex > (fastForwardTargets[fastForwardTargets.length - 1] || -1)) fastForwardTargets.push(warmupIndex);
        if (startIndex > (fastForwardTargets[fastForwardTargets.length - 1] || -1)) fastForwardTargets.push(startIndex);
        let fastForwardIdx = 0;
        let fastForwardUntil = fastForwardTargets[fastForwardIdx] ?? null;
        currentIndex = 0;

        const segments = [];
        const markers = [];
        const hpData = [];
        let maxHp = 0;
        let lastHpInfo = null;
        let segStart = 0;
        let curPlace = null;
        let curDepth = null;
        let firstPlaceFound = false;

        for (let i = 0; i < data.length; i++) {
            const m = data[i];
            if (m.msg === 'player') {
                // Collect HP data - handle all HP-related fields
                if (m.hp !== undefined || m.hp_max !== undefined || m.poison_survival !== undefined) {
                    // Update lastHpInfo with new values, keeping previous values for missing fields
                    if (!lastHpInfo) {
                        lastHpInfo = {
                            hp: 0,
                            hp_max: 0,
                            poison_survival: 0,
                            real_hp_max: 0
                        };
                    }

                    // Update only the fields that are present
                    if (m.hp !== undefined) lastHpInfo.hp = Number(m.hp) || 0;
                    if (m.hp_max !== undefined) lastHpInfo.hp_max = Number(m.hp_max) || 0;
                    if (m.poison_survival !== undefined) lastHpInfo.poison_survival = Number(m.poison_survival) || 0;
                    if (m.real_hp_max !== undefined) lastHpInfo.real_hp_max = Number(m.real_hp_max) || 0;

                    hpData[i] = {...lastHpInfo}; // Store a copy
                    maxHp = Math.max(maxHp, lastHpInfo.real_hp_max || lastHpInfo.hp_max);
                } else if (lastHpInfo) {
                    // If no HP info but we have previous HP data, use that
                    hpData[i] = {...lastHpInfo};
                }

                if (m.place !== undefined) {
                    const combo = `${m.place}-${m.depth || 0}`;

                    // If this is the first place found and we have an unknown segment
                    if (!firstPlaceFound && i > 0) {
                        segments.push({start: 0, end: i - 1, place: null, depth: null});
                        firstPlaceFound = true;
                    }

                    if (curPlace === null) {
                        curPlace = combo;
                        curDepth = m.depth || null;
                        segStart = i;
                    } else if (curPlace !== combo) {
                        segments.push({start: segStart, end: i - 1, place: curPlace.split('-')[0], depth: curDepth});
                        curPlace = combo;
                        curDepth = m.depth || null;
                        segStart = i;
                    }

                    if (!firstPlaceFound) {
                        firstPlaceFound = true;
                    }
                }
            }
            if (m.msg === 'game_ended' || m.msg === 'go_lobby') {
                markers.push(i);
            }
        }

        // Handle the case where no place was ever found
        if (!firstPlaceFound && data.length > 0) {
            segments.push({start: 0, end: data.length - 1, place: null, depth: null});
        } else if (curPlace !== null) {
            segments.push({start: segStart, end: data.length - 1, place: curPlace.split('-')[0], depth: curDepth});
        }

        // UI creation
        const uiContainer = document.createElement('div');
        uiContainer.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            z-index: 10000;
            background: linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(20, 20, 20, 0.9) 100%);
            color: white;
            padding: 8px;
            border-radius: 5px;
            font-size: 10px;
            width: 180px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.1);
            font-family: monospace;
        `;

        // Create title
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            font-size: 11px;
            font-weight: bold;
            margin-bottom: 6px;
            text-align: center;
            color: #00ff00;
            text-shadow: 0 0 3px rgba(0, 255, 0, 0.5);
        `;
        titleDiv.textContent = 'WTREC Player';
        uiContainer.appendChild(titleDiv);

        // Create status section
        const statusSection = document.createElement('div');
        statusSection.style.cssText = `
            background: rgba(0, 0, 0, 0.5);
            padding: 5px;
            border-radius: 3px;
            margin-bottom: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const currentMsgDisplay = document.createElement('div');
        currentMsgDisplay.style.marginBottom = '2px';
        const currentIndexDisplay = document.createElement('div');
        currentIndexDisplay.style.marginBottom = '2px';
        const totalLengthDisplay = document.createElement('div');
        totalLengthDisplay.style.marginBottom = '2px';
        const progressDisplay = document.createElement('div');
        progressDisplay.style.cssText = `
            margin-bottom: 2px;
            font-weight: bold;
            color: #ffff00;
        `;
        const sleepTimeDisplay = document.createElement('div');
        sleepTimeDisplay.style.cssText = 'color: #888; line-height: 1.2;';

        // Declare updateCursor as a variable first
        let updateCursor;

        const updateUI = (originalSleep, adjustedSleep) => {
            currentMsgDisplay.textContent = `Current msg: ${data[currentIndex].msg}`;
            currentIndexDisplay.textContent = `Current index: ${currentIndex}`;
            totalLengthDisplay.textContent = `Total length: ${data.length}`;
            progressDisplay.textContent = `Progress: ${((currentIndex / data.length) * 100).toFixed(2)}%`;
            sleepTimeDisplay.innerHTML = `Sleep: ${originalSleep.toFixed(0)}ms<br><span style="color:#888; font-size: 9px">(Adjusted: ${adjustedSleep.toFixed(0)}ms)</span>`;

            // Update cursor position if available
            if (updateCursor) {
                updateCursor();
            }
        };

        updateUI(0, 0);

        statusSection.appendChild(currentMsgDisplay);
        statusSection.appendChild(currentIndexDisplay);
        statusSection.appendChild(totalLengthDisplay);
        statusSection.appendChild(progressDisplay);
        statusSection.appendChild(sleepTimeDisplay);
        uiContainer.appendChild(statusSection);

        // Create controls section
        const controlsSection = document.createElement('div');
        controlsSection.style.cssText = `
            background: rgba(0, 0, 0, 0.5);
            padding: 5px;
            border-radius: 3px;
            margin-bottom: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const playPauseButton = document.createElement('button');
        playPauseButton.style.cssText = `
            width: 100%;
            padding: 3px;
            margin-bottom: 5px;
            background: #2a2a2a;
            border: 1px solid #444;
            color: white;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 10px;
        `;
        playPauseButton.onmouseover = () => playPauseButton.style.background = '#3a3a3a';
        playPauseButton.onmouseout = () => playPauseButton.style.background = '#2a2a2a';
        playPauseButton.innerHTML = isPlaying ? '⏸ Pause <span style="color:#888; font-size: 9px">(Space)</span>' : '▶ Play <span style="color:#888; font-size: 9px">(Space)</span>';
        playPauseButton.title = 'Play/Pause (Space)';
        playPauseButton.onclick = () => {
            isPlaying = !isPlaying;
            playPauseButton.innerHTML = isPlaying ? '⏸ Pause <span style="color:#888; font-size: 9px">(Space)</span>' : '▶ Play <span style="color:#888; font-size: 9px">(Space)</span>';
            if (isPlaying) {
                // Reset reachedLobby if at the end and trying to play
                if ((reachedLobby || currentIndex >= data.length - 1) && currentIndex < data.length - 1) {
                    reachedLobby = false;
                    console.log('Reset reachedLobby, resuming playback');
                }
                abortSleep = true;
                manualStep = true;
            }
        };
        controlsSection.appendChild(playPauseButton);

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
        const speedControl = document.createElement('div');
        speedControl.style.cssText = 'margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between;';
        speedControl.innerHTML = '<span>Speed <span style="color:#888; font-size: 9px">(X/C)</span>:</span>';
        speedInput.style.cssText = 'width: 45px; background: #1a1a1a; border: 1px solid #444; color: white; padding: 2px; border-radius: 3px; font-size: 10px;';
        speedControl.appendChild(speedInput);
        controlsSection.appendChild(speedControl);

        const stepInput = document.createElement('input');
        stepInput.type = 'number';
        stepInput.value = stepSize;
        stepInput.min = '1';
        stepInput.onchange = () => {
            stepSize = parseInt(stepInput.value, 10);
        };

        const stepControl = document.createElement('div');
        stepControl.style.cssText = 'margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between;';
        stepControl.innerHTML = '<span>Step:</span>';
        stepInput.style.cssText = 'width: 45px; background: #1a1a1a; border: 1px solid #444; color: white; padding: 2px; border-radius: 3px; font-size: 10px;';
        stepControl.appendChild(stepInput);
        controlsSection.appendChild(stepControl);

        // Navigation buttons
        const navButtons = document.createElement('div');
        navButtons.style.cssText = 'display: flex; gap: 3px; margin-bottom: 5px;';

        const buttonStyle = `
            flex: 1;
            padding: 3px;
            background: #2a2a2a;
            border: 1px solid #444;
            color: white;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 10px;
        `;

        const leftButton = document.createElement('button');
        leftButton.style.cssText = buttonStyle;
        leftButton.innerHTML = '◀◀ <span style="color:#888; font-size: 9px">(←)</span>';
        leftButton.title = 'Step Backward (← Arrow)';
        leftButton.onmouseover = () => leftButton.style.background = '#3a3a3a';
        leftButton.onmouseout = () => leftButton.style.background = '#2a2a2a';
        leftButton.onclick = async () => {
            const newIndex = Math.max(0, currentIndex - stepSize);
            const wasPlaying = isPlaying;
            isPlaying = false;
            abortSleep = true;

            // Reset reachedLobby if going backwards
            if (newIndex < currentIndex && reachedLobby) {
                reachedLobby = false;
                console.log('Reset reachedLobby flag (left button)');
            }

            await seekToIndex(newIndex);

            if (wasPlaying) {
                isPlaying = true;
            }
            manualStep = true;
            progressBar.value = currentIndex;
        };
        navButtons.appendChild(leftButton);

        const rightButton = document.createElement('button');
        rightButton.style.cssText = buttonStyle;
        rightButton.innerHTML = '<span style="color:#888; font-size: 9px">(→)</span> ▶▶';
        rightButton.title = 'Step Forward (→ Arrow)';
        rightButton.onmouseover = () => rightButton.style.background = '#3a3a3a';
        rightButton.onmouseout = () => rightButton.style.background = '#2a2a2a';
        rightButton.onclick = async () => {
            const newIndex = Math.min(data.length - 1, currentIndex + stepSize);
            const wasPlaying = isPlaying;
            isPlaying = false;
            abortSleep = true;

            await seekToIndex(newIndex);

            if (wasPlaying) {
                isPlaying = true;
            }
            manualStep = true;
            progressBar.value = currentIndex;
        };
        navButtons.appendChild(rightButton);
        controlsSection.appendChild(navButtons);

        const lobbyButton = document.createElement('button');
        lobbyButton.style.cssText = buttonStyle + 'width: 100%;';
        lobbyButton.textContent = '🏠 Go to Lobby';
        lobbyButton.onclick = () => { location.href = '/'; };
        lobbyButton.onmouseover = () => lobbyButton.style.background = '#3a3a3a';
        lobbyButton.onmouseout = () => lobbyButton.style.background = '#2a2a2a';
        controlsSection.appendChild(lobbyButton);

        uiContainer.appendChild(controlsSection);

        // Create help section (collapsible)
        const helpSection = document.createElement('div');
        helpSection.style.cssText = `
            background: rgba(0, 0, 0, 0.5);
            padding: 0;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            overflow: hidden;
            transition: all 0.3s;
        `;

        const helpTitle = document.createElement('div');
        helpTitle.style.cssText = `
            padding: 5px;
            cursor: pointer;
            background: rgba(40, 40, 40, 0.5);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 10px;
        `;
        helpTitle.innerHTML = '<span>⌨️ Keyboard Shortcuts</span><span id="help-toggle">▼</span>';

        const helpContent = document.createElement('div');
        helpContent.style.cssText = `
            padding: 5px;
            display: none;
            font-size: 9px;
            line-height: 1.4;
        `;
        helpContent.innerHTML = `
            <div style="margin-bottom: 4px"><b>Space</b> - Play/Pause</div>
            <div style="margin-bottom: 4px"><b>← / →</b> - Step backward/forward</div>
            <div style="margin-bottom: 4px"><b>X / C</b> - Decrease/Increase speed</div>
            <div style="margin-bottom: 4px"><b>0-9</b> - Jump to 0%-90% position</div>
            <div style="margin-bottom: 4px"><b>P</b> - Toggle progress bar</div>
            <div style="margin-bottom: 4px"><b>H</b> - Toggle this UI</div>
            <div style="margin-bottom: 4px"><b>Click bar</b> - Seek to position</div>
        `;

        helpTitle.onclick = () => {
            const isOpen = helpContent.style.display === 'block';
            helpContent.style.display = isOpen ? 'none' : 'block';
            document.getElementById('help-toggle').textContent = isOpen ? '▼' : '▲';
        };

        helpSection.appendChild(helpTitle);
        helpSection.appendChild(helpContent);
        uiContainer.appendChild(helpSection);

        document.body.appendChild(uiContainer);
        $(uiContainer).draggable();

        document.body.tabIndex = 0;
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
            if (e.key === ' ') {
                e.preventDefault();
                playPauseButton.onclick();
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
            } else if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                progressContainer.style.display = progressContainer.style.display === 'none' ? '' : 'none';
            } else if (e.key === 'h' || e.key === 'H') {
                e.preventDefault();
                uiContainer.style.display = uiContainer.style.display === 'none' ? '' : 'none';
            } else if (e.key >= '0' && e.key <= '9') {
                e.preventDefault();
                // Calculate target position (0 = 0%, 1 = 10%, ..., 9 = 90%)
                const percent = parseInt(e.key) * 0.1;
                const targetIndex = Math.floor(percent * data.length);
                // Reset reachedLobby if seeking from the end
                if (reachedLobby && targetIndex < currentIndex) {
                    reachedLobby = false;
                }
                seekToIndex(targetIndex);
            }
        });

        // Create new progress bar
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            position: fixed;
            bottom: 10px;
            left: 50%;
            transform: translateX(-50%);
            width: calc(100vw - 30px);
            height: 65px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 5px;
            padding: 5px;
            z-index: 10001;
            overflow: visible;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
        `;

        // HP graph canvas
        const hpCanvas = document.createElement('canvas');
        hpCanvas.width = window.innerWidth - 54; // 30px container margin + 10px container padding + 4px border + 10px canvas margin
        hpCanvas.height = 25; // HP bar height
        hpCanvas.style.cssText = `
            position: absolute;
            top: 5px;
            left: 5px;
            width: calc(100% - 10px);
            height: 25px;
            cursor: pointer;
        `;
        progressContainer.appendChild(hpCanvas);
        const hpCtx = hpCanvas.getContext('2d');

        // Label container
        const labelContainer = document.createElement('div');
        labelContainer.style.cssText = `
            position: absolute;
            top: 30px;
            left: 5px;
            width: calc(100% - 10px);
            height: 40px;
            pointer-events: none;
        `;
        progressContainer.appendChild(labelContainer);

        // Canvas for rendering segments
        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth - 54; // 30px container margin + 10px container padding + 4px border + 10px canvas margin
        canvas.height = 40;
        canvas.style.cssText = `
            position: absolute;
            top: 30px;
            left: 5px;
            width: calc(100% - 10px);
            height: 40px;
            cursor: pointer;
        `;
        progressContainer.appendChild(canvas);

        const ctx = canvas.getContext('2d');

        // Color generator
        function getPlaceColor(place, depth) {
            let hash = 0;
            for (let i = 0; i < place.length; i++) {
                hash = ((hash << 5) - hash) + place.charCodeAt(i);
                hash = hash & hash;
            }
            const hue = Math.abs(hash) % 360;
            const lightness = Math.max(60 - (depth * 4), 20);
            const saturation = Math.min(60 + (depth * 3), 85);
            return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        }

        // Draw HP graph
        function drawHpGraph() {
            hpCtx.clearRect(0, 0, hpCanvas.width, hpCanvas.height);

            // Draw background
            hpCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            hpCtx.fillRect(0, 0, hpCanvas.width, hpCanvas.height);

            // Draw background grid
            hpCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            hpCtx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = (i / 4) * hpCanvas.height;
                hpCtx.beginPath();
                hpCtx.moveTo(0, y);
                hpCtx.lineTo(hpCanvas.width, y);
                hpCtx.stroke();
            }

            // Draw HP bars for every HP change
            let lastHp = null;
            let barStartIndex = 0;
            let hpChangeCount = 0;

            for (let i = 0; i < data.length; i++) {
                if (hpData[i]) {
                    // Check if HP changed
                    if (!lastHp || hpData[i].hp !== lastHp.hp || hpData[i].hp_max !== lastHp.hp_max) {
                        // Draw bar for the previous HP value range
                        if (lastHp && i > barStartIndex) {
                            const startX = Math.floor((barStartIndex / data.length) * hpCanvas.width);
                            const endX = Math.ceil((i / data.length) * hpCanvas.width);
                            const barWidth = Math.max(1, endX - startX); // Ensure minimum width

                            const hpHeight = (lastHp.hp / maxHp) * hpCanvas.height;
                            const hpMaxHeight = ((lastHp.real_hp_max || lastHp.hp_max) / maxHp) * hpCanvas.height;
                            const poisonSurvivalHeight = (lastHp.poison_survival / maxHp) * hpCanvas.height;

                            // Draw max HP background (darker)
                            hpCtx.fillStyle = 'rgba(50, 50, 50, 0.8)';
                            hpCtx.fillRect(startX, hpCanvas.height - hpMaxHeight, barWidth, hpMaxHeight);

                            // Draw poison bar if poisoned
                            if (lastHp.poison_survival < lastHp.hp) {
                                // Purple bar for poison damage
                                hpCtx.fillStyle = 'rgba(128, 0, 255, 0.6)';
                                hpCtx.fillRect(startX, hpCanvas.height - hpHeight, barWidth, hpHeight - poisonSurvivalHeight);
                            }

                            // Draw current HP (or poison survival) with colors
                            const effectiveHp = Math.min(lastHp.hp, lastHp.poison_survival);
                            const effectiveHeight = (effectiveHp / maxHp) * hpCanvas.height;
                            const hpPercent = effectiveHp / (lastHp.real_hp_max || lastHp.hp_max);

                            if (hpPercent > 0.75) {
                                hpCtx.fillStyle = '#00ff00'; // Bright green
                            } else if (hpPercent > 0.5) {
                                hpCtx.fillStyle = '#ffff00'; // Bright yellow
                            } else if (hpPercent > 0.25) {
                                hpCtx.fillStyle = '#ff8800'; // Bright orange
                            } else {
                                hpCtx.fillStyle = '#ff0000'; // Bright red
                            }
                            hpCtx.fillRect(startX, hpCanvas.height - effectiveHeight, barWidth, effectiveHeight);


                            hpChangeCount++;
                        }

                        lastHp = hpData[i];
                        barStartIndex = i;
                    }
                }
            }


            // Draw the final bar
            if (lastHp && data.length > barStartIndex) {
                const startX = Math.floor((barStartIndex / data.length) * hpCanvas.width);
                const endX = hpCanvas.width;
                const barWidth = endX - startX;

                const hpHeight = (lastHp.hp / maxHp) * hpCanvas.height;
                const hpMaxHeight = ((lastHp.real_hp_max || lastHp.hp_max) / maxHp) * hpCanvas.height;
                const poisonSurvivalHeight = (lastHp.poison_survival / maxHp) * hpCanvas.height;

                // Draw max HP background (darker)
                hpCtx.fillStyle = 'rgba(50, 50, 50, 0.8)';
                hpCtx.fillRect(startX, hpCanvas.height - hpMaxHeight, barWidth, hpMaxHeight);

                // Draw poison bar if poisoned
                if (lastHp.poison_survival < lastHp.hp) {
                    // Purple bar for poison damage
                    hpCtx.fillStyle = 'rgba(128, 0, 255, 0.6)';
                    hpCtx.fillRect(startX, hpCanvas.height - hpHeight, barWidth, hpHeight - poisonSurvivalHeight);
                }

                // Draw current HP (or poison survival) with colors
                const effectiveHp = Math.min(lastHp.hp, lastHp.poison_survival);
                const effectiveHeight = (effectiveHp / maxHp) * hpCanvas.height;
                const hpPercent = effectiveHp / (lastHp.real_hp_max || lastHp.hp_max);

                if (hpPercent > 0.75) {
                    hpCtx.fillStyle = '#00ff00'; // Bright green
                } else if (hpPercent > 0.5) {
                    hpCtx.fillStyle = '#ffff00'; // Bright yellow
                } else if (hpPercent > 0.25) {
                    hpCtx.fillStyle = '#ff8800'; // Bright orange
                } else {
                    hpCtx.fillStyle = '#ff0000'; // Bright red
                }
                hpCtx.fillRect(startX, hpCanvas.height - effectiveHeight, barWidth, effectiveHeight);
            }

            // Draw scale labels
            hpCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            hpCtx.font = '10px monospace';
            hpCtx.textAlign = 'right';
            hpCtx.fillText(maxHp.toString(), 35, 10);
            hpCtx.fillText('0', 35, hpCanvas.height - 2);
        }

        // Draw segments and labels
        function drawSegments() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            labelContainer.innerHTML = '';

            // Draw background for progress bar
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            segments.forEach((seg, idx) => {
                const x = Math.floor((seg.start / data.length) * canvas.width);
                let width;

                // Calculate width to prevent gaps
                if (idx < segments.length - 1) {
                    const nextX = Math.floor((segments[idx + 1].start / data.length) * canvas.width);
                    width = nextX - x;
                } else {
                    width = canvas.width - x;
                }

                // Draw segment
                ctx.fillStyle = seg.place ? getPlaceColor(seg.place, seg.depth || 0) : '#222';
                ctx.fillRect(x, 0, width, canvas.height);

                // Add place label
                if (width > 15) { // Show labels for smaller segments too
                    const label = document.createElement('div');
                    label.style.cssText = `
                        position: absolute;
                        left: ${(x / canvas.width) * 100}%;
                        top: 50%;
                        color: white;
                        font-size: 10px;
                        padding: 2px 4px;
                        background: rgba(0, 0, 0, 0.8);
                        border-radius: 2px;
                        white-space: nowrap;
                        transform: translateY(-50%);
                        border-left: 2px solid ${seg.place ? getPlaceColor(seg.place, seg.depth || 0) : '#666'};
                    `;
                    if (seg.place) {
                        label.textContent = (seg.depth && seg.depth !== 0) ? `${seg.place}:${seg.depth}` : seg.place;
                    } else {
                        label.textContent = '(Unknown)';
                        label.style.fontStyle = 'italic';
                        label.style.opacity = '0.7';
                    }

                    // Center label in segment if it fits
                    const labelText = seg.place ? ((seg.depth && seg.depth !== 0) ? `${seg.place}:${seg.depth}` : seg.place) : '(Unknown)';
                    const labelWidth = labelText.length * 7 + 10; // More accurate estimate
                    if (labelWidth < width) {
                        label.style.left = `${((x + width/2) / canvas.width) * 100}%`;
                        label.style.transform = 'translateX(-50%) translateY(-50%)';
                    }

                    // Ensure label doesn't overlap with cursor
                    label.style.zIndex = '8';

                    labelContainer.appendChild(label);
                }
            });

            // Draw markers
            markers.forEach(idx => {
                const x = (idx / data.length) * canvas.width;
                ctx.fillStyle = 'white';
                ctx.fillRect(x, 0, 2, canvas.height);
            });
        }

        // Cursor element
        const cursor = document.createElement('div');
        cursor.style.cssText = `
            position: absolute;
            top: 0;
            width: 3px;
            height: 100%;
            background: red;
            box-shadow: 0 0 10px red;
            pointer-events: none;
            z-index: 10;
        `;
        progressContainer.appendChild(cursor);

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: absolute;
            bottom: 105%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
            pointer-events: none;
            display: none;
        `;
        cursor.appendChild(tooltip);

        // HP display element (separate from cursor for better z-index control)
        const hpDisplay = document.createElement('div');
        hpDisplay.style.cssText = `
            position: absolute;
            top: 17.5px;
            transform: translateY(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.5);
            font-size: 12px;
            font-weight: bold;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            z-index: 20;
            display: none;
        `;

        // Index display element
        const indexDisplay = document.createElement('div');
        indexDisplay.style.cssText = `
            position: absolute;
            top: 50px;
            transform: translateY(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.5);
            font-size: 12px;
            font-weight: bold;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            z-index: 20;
            display: none;
        `;
        progressContainer.appendChild(hpDisplay);
        progressContainer.appendChild(indexDisplay);

        // Update cursor position
        updateCursor = () => {
            const percent = currentIndex / data.length;
            cursor.style.left = (percent * 100) + '%';

            // Update tooltip - find from segments which is more reliable
            let foundPlace = false;
            let currentPlace = null;
            let currentDepth = null;
            for (const seg of segments) {
                if (currentIndex >= seg.start && currentIndex <= seg.end) {
                    if (seg.place) {
                        currentPlace = seg.place;
                        currentDepth = seg.depth;
                        tooltip.textContent = (seg.depth && seg.depth !== 0) ? `${seg.place}:${seg.depth}` : seg.place;
                        tooltip.style.color = getPlaceColor(seg.place, seg.depth || 0);
                        tooltip.style.display = 'block';
                        foundPlace = true;
                        break;
                    }
                }
            }

            // Fallback to searching through data if segment lookup fails
            if (!foundPlace) {
                for (let i = currentIndex; i >= 0; i--) {
                    if (data[i] && data[i].msg === 'player' && data[i].place) {
                        currentPlace = data[i].place;
                        currentDepth = data[i].depth;
                        const depth = data[i].depth;
                        tooltip.textContent = (depth && depth !== 0) ? `${data[i].place}:${depth}` : data[i].place;
                        tooltip.style.color = getPlaceColor(data[i].place, depth || 0);
                        tooltip.style.display = 'block';
                        foundPlace = true;
                        break;
                    }
                }
            }

            // Show unknown if still not found
            if (!foundPlace) {
                tooltip.textContent = '(Unknown)';
                tooltip.style.color = '#666';
                tooltip.style.display = 'block';
            }

            // Draw current position indicator on HP graph
            drawHpGraph();
            const x = (currentIndex / data.length) * hpCanvas.width;
            hpCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            hpCtx.lineWidth = 2;
            hpCtx.beginPath();
            hpCtx.moveTo(x, 0);
            hpCtx.lineTo(x, hpCanvas.height);
            hpCtx.stroke();

            // Update HP display element
            let currentHp = null;
            for (let i = currentIndex; i >= 0; i--) {
                if (hpData[i]) {
                    currentHp = hpData[i];
                    break;
                }
            }
            if (currentHp) {
                const hpText = `${currentHp.hp}/${currentHp.hp_max}`;
                hpDisplay.textContent = hpText;
                hpDisplay.style.display = 'block';

                // Position HP display
                let displayX = (percent * progressContainer.clientWidth);
                const displayWidth = hpDisplay.offsetWidth;

                // Keep display within bounds
                if (displayX - displayWidth/2 < 0) {
                    displayX = displayWidth/2;
                } else if (displayX + displayWidth/2 > progressContainer.clientWidth) {
                    displayX = progressContainer.clientWidth - displayWidth/2;
                }

                hpDisplay.style.left = (displayX - displayWidth/2) + 'px';

                // Color the text based on HP percentage
                const hpPercent = currentHp.hp / (currentHp.real_hp_max || currentHp.hp_max);
                if (hpPercent > 0.75) {
                    hpDisplay.style.color = '#00ff00';
                } else if (hpPercent > 0.5) {
                    hpDisplay.style.color = '#ffff00';
                } else if (hpPercent > 0.25) {
                    hpDisplay.style.color = '#ff8800';
                } else {
                    hpDisplay.style.color = '#ff0000';
                }

                // Show poison indicator if poisoned
                if (currentHp.poison_survival < currentHp.hp) {
                    hpDisplay.textContent = `${currentHp.hp}/${currentHp.hp_max} (→${currentHp.poison_survival})`;
                }
            } else {
                hpDisplay.style.display = 'none';
            }

            // Update index display
            indexDisplay.textContent = `#${currentIndex}`;
            indexDisplay.style.display = 'block';

            // Position index display to follow cursor
            let indexDisplayX = (percent * progressContainer.clientWidth);
            const indexDisplayWidth = indexDisplay.offsetWidth || 80;

            // Keep display within bounds
            if (indexDisplayX - indexDisplayWidth/2 < 0) {
                indexDisplayX = indexDisplayWidth/2;
            } else if (indexDisplayX + indexDisplayWidth/2 > progressContainer.clientWidth) {
                indexDisplayX = progressContainer.clientWidth - indexDisplayWidth/2;
            }

            indexDisplay.style.left = (indexDisplayX - indexDisplayWidth/2) + 'px';
        };

        // Create hover tooltip separate from cursor tooltip
        const hoverTooltip = document.createElement('div');
        hoverTooltip.style.cssText = `
            position: absolute;
            bottom: 105%;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
            pointer-events: none;
            display: none;
            z-index: 11;
        `;
        progressContainer.appendChild(hoverTooltip);

        // Create hover HP display (similar to regular HP display)
        const hoverHpDisplay = document.createElement('div');
        hoverHpDisplay.style.cssText = `
            position: absolute;
            top: 17.5px;
            transform: translateY(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.5);
            font-size: 12px;
            font-weight: bold;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            display: none;
            z-index: 20;
        `;

        // Create hover index display
        const hoverIndexDisplay = document.createElement('div');
        hoverIndexDisplay.style.cssText = `
            position: absolute;
            top: 50px;
            transform: translateY(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.5);
            font-size: 12px;
            font-weight: bold;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            z-index: 20;
            display: none;
        `;
        progressContainer.appendChild(hoverHpDisplay);
        progressContainer.appendChild(hoverIndexDisplay);

        // Create hover cursor line (similar to regular cursor)
        const hoverCursor = document.createElement('div');
        hoverCursor.style.cssText = `
            position: absolute;
            top: 0;
            width: 2px;
            height: 100%;
            background: yellow;
            box-shadow: 0 0 5px yellow;
            pointer-events: none;
            z-index: 9;
            display: none;
        `;
        progressContainer.appendChild(hoverCursor);

        // Common mouse move handler for both canvas and HP canvas
        const handleMouseMove = (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const hoverIndex = Math.floor(percent * data.length);

            // Update hover tooltip position
            hoverTooltip.style.left = (percent * 100) + '%';
            hoverTooltip.style.transform = 'translateX(-50%)';

            // Update hover cursor position
            hoverCursor.style.left = (percent * 100) + '%';
            hoverCursor.style.display = 'block';

            // Update hover HP display position (same as play display)
            let hoverDisplayX = (percent * progressContainer.clientWidth);
            const hoverHpWidth = hoverHpDisplay.offsetWidth || 80;

            // Keep display within bounds
            if (hoverDisplayX - hoverHpWidth/2 < 0) {
                hoverDisplayX = hoverHpWidth/2;
            } else if (hoverDisplayX + hoverHpWidth/2 > progressContainer.clientWidth) {
                hoverDisplayX = progressContainer.clientWidth - hoverHpWidth/2;
            }

            hoverHpDisplay.style.left = (hoverDisplayX - hoverHpWidth/2) + 'px';
            hoverHpDisplay.style.right = 'auto';

            // Find which segment the mouse is over
            let hoverPlace = null;
            let hoverDepth = null;

            for (const seg of segments) {
                if (hoverIndex >= seg.start && hoverIndex <= seg.end) {
                    hoverPlace = seg.place;
                    hoverDepth = seg.depth;
                    break;
                }
            }

            // Find HP at hover position
            let hoverHp = null;
            for (let i = hoverIndex; i >= 0; i--) {
                if (hpData[i]) {
                    hoverHp = hpData[i];
                    break;
                }
            }

            // Build tooltip text (without HP)
            let tooltipText = '';
            if (hoverPlace) {
                tooltipText = (hoverDepth && hoverDepth !== 0) ? `${hoverPlace}:${hoverDepth}` : hoverPlace;
                hoverTooltip.style.color = getPlaceColor(hoverPlace, hoverDepth || 0);
            } else {
                tooltipText = '(Unknown)';
                hoverTooltip.style.color = '#666';
            }

            hoverTooltip.textContent = tooltipText;
            hoverTooltip.style.display = 'block';

            // Update hover HP display
            if (hoverHp) {
                const hpText = `${hoverHp.hp}/${hoverHp.hp_max}`;
                hoverHpDisplay.textContent = hpText;
                hoverHpDisplay.style.display = 'block';

                // Color based on HP percentage
                const hpPercent = hoverHp.hp / (hoverHp.real_hp_max || hoverHp.hp_max);
                if (hpPercent > 0.75) {
                    hoverHpDisplay.style.color = '#00ff00';
                } else if (hpPercent > 0.5) {
                    hoverHpDisplay.style.color = '#ffff00';
                } else if (hpPercent > 0.25) {
                    hoverHpDisplay.style.color = '#ff8800';
                } else {
                    hoverHpDisplay.style.color = '#ff0000';
                }

                // Show poison indicator if poisoned
                if (hoverHp.poison_survival < hoverHp.hp) {
                    hoverHpDisplay.textContent = `${hoverHp.hp}/${hoverHp.hp_max} (→${hoverHp.poison_survival})`;
                }
            } else {
                hoverHpDisplay.style.display = 'none';
            }

            // Update hover index display
            hoverIndexDisplay.textContent = `#${hoverIndex}`;
            hoverIndexDisplay.style.display = 'block';

            // Position hover index display (same as play display)
            let hoverIndexDisplayX = (percent * progressContainer.clientWidth);
            const hoverIndexDisplayWidth = hoverIndexDisplay.offsetWidth || 80;

            // Keep display within bounds
            if (hoverIndexDisplayX - hoverIndexDisplayWidth/2 < 0) {
                hoverIndexDisplayX = hoverIndexDisplayWidth/2;
            } else if (hoverIndexDisplayX + hoverIndexDisplayWidth/2 > progressContainer.clientWidth) {
                hoverIndexDisplayX = progressContainer.clientWidth - hoverIndexDisplayWidth/2;
            }

            hoverIndexDisplay.style.left = (hoverIndexDisplayX - hoverIndexDisplayWidth/2) + 'px';
            hoverIndexDisplay.style.right = 'auto';

            // Draw hover line on HP graph
            drawHpGraph();
            const hoverX = (hoverIndex / data.length) * hpCanvas.width;
            hpCtx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            hpCtx.lineWidth = 1;
            hpCtx.beginPath();
            hpCtx.moveTo(hoverX, 0);
            hpCtx.lineTo(hoverX, hpCanvas.height);
            hpCtx.stroke();

            // Redraw current position line
            const currentX = (currentIndex / data.length) * hpCanvas.width;
            hpCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            hpCtx.lineWidth = 2;
            hpCtx.beginPath();
            hpCtx.moveTo(currentX, 0);
            hpCtx.lineTo(currentX, hpCanvas.height);
            hpCtx.stroke();
        };

        // Common mouse leave handler
        const handleMouseLeave = () => {
            hoverTooltip.style.display = 'none';
            hoverHpDisplay.style.display = 'none';
            hoverIndexDisplay.style.display = 'none';
            hoverCursor.style.display = 'none';
            // Redraw HP graph without hover line
            drawHpGraph();
            updateCursor();
        };

        // Common click handler
        const handleClick = async (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const targetIndex = Math.floor(percent * data.length);

            // seekToIndex will handle playing state management
            await seekToIndex(targetIndex);
        };

        // Apply handlers to both canvas and HP canvas
        canvas.onmousemove = handleMouseMove;
        canvas.onmouseleave = handleMouseLeave;
        canvas.onclick = handleClick;

        hpCanvas.onmousemove = handleMouseMove;
        hpCanvas.onmouseleave = handleMouseLeave;
        hpCanvas.onclick = handleClick;

        // Window resize handler
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth - 54; // 30px container margin + 10px container padding + 4px border + 10px canvas margin
            hpCanvas.width = window.innerWidth - 54; // 30px container margin + 10px container padding + 4px border + 10px canvas margin
            drawSegments();
            drawHpGraph();
            updateCursor();
        });

        document.body.appendChild(progressContainer);
        drawSegments();
        drawHpGraph();
        updateCursor();

        // Update references for compatibility
        let progressBar = {
            value: currentIndex,
            set oninput(fn) {} // Dummy setter
        };
        let cursorDiv = {
            style: {
                set left(val) { updateCursor(); }
            }
        };

        while (currentIndex < data.length) {
            // Check if seeking is in progress and wait for it to complete
            if (window.isSeeking) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }

            // If not playing and not manual step, wait
            if (!isPlaying && !manualStep) {
                await sleep(100);
                continue;
            }

            // Check if reached end
            if (reachedLobby || currentIndex >= data.length - 1) {
                if (reachedLobby) {
                    console.log('Reached lobby, pausing playback');
                } else {
                    console.log('Reached end of replay, pausing playback');
                }
                isPlaying = false;
                playPauseButton.innerHTML = '▶ Play <span style="color:#888; font-size: 9px">(Space)</span>';
                await sleep(100);
                continue;
            }

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
                        if (current.msg !== 'go_lobby') {
                            IOHook.handle_message(current);
                        }
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
                const fastMode = fastForwardUntil !== null && currentIndex < fastForwardUntil;
                const adjustedSleep = fastMode ? 0 : Math.min(originalSleep / currentSpeed, 1000 * 2);

                updateUI(originalSleep, adjustedSleep);

                manualStep = false; // Reset manual step flag
                abortSleep = false;
                const sleepPromise = sleep(adjustedSleep);
                await Promise.race([sleepPromise, new Promise((resolve) => {
                    const interval = setInterval(() => {
                        if (abortSleep || window.isSeeking) {
                            clearInterval(interval);
                            resolve();
                        }
                    }, 10);
                })]);

                // Check if we were interrupted by seeking
                if (window.isSeeking) {
                    // Wait for seeking to complete
                    while (window.isSeeking) {
                        await sleep(10);
                    }
                    // Reset abort flag after seeking completes
                    abortSleep = false;
                    continue; // Don't increment, let the seek operation set currentIndex
                }

                if (!manualStep) {
                    currentIndex = nextIndex;
                }
                progressBar.value = currentIndex;
                updateCursor();
                if (fastMode && currentIndex >= fastForwardUntil) {
                    fastForwardIdx++;
                    fastForwardUntil = fastForwardTargets[fastForwardIdx] ?? null;
                }
                if (reachedLobby) {
                    // Already handled in main loop
                }
            }
        }
    }

    async playWTRecByInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.wtrec';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (file) {
                // Check if file is 10MB or larger (10 * 1024 * 1024 bytes)
                if (file.size >= 10 * 1024 * 1024) {
                    this.playWTRec(file);
                } else {
                    alert(`File is too small (${(file.size / 1024 / 1024).toFixed(2)}MB). Please select a file that is 10MB or larger.`);
                }
            }
        };
        input.click();
    }


    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        const {IOHook} = DWEM.Modules;
        // Recording via RCManager (record_wtrec = true)
        const {RCManager, CommandManager} = DWEM.Modules;

        // Internal recording state
        this._rec = {
            enabled: false,
            data: [],
            startTime: 0,
            version: null,
            keyPath: null,
            valuePath: null,
            styles: [],
            images: [],
            sources: [],
            resources: [],
            blobs: [],
            username: null,
            name: null,
            createdAt: 0
        };

        const skipSend = new Set(['go_lobby', 'login', 'token_login', 'change_password', 'forget_login_cookie', 'start_change_email', 'change_email', 'set_login_cookie', 'pong']);
        const skipRecv = new Set(['login_cookie', 'html', 'ping', 'set_game_links']);

        // Hook outgoing
        IOHook.send_message.before.addHandler('wtrec', (msg, data) => {
            if (msg === 'play' || msg === 'watch') {
                // fresh start for each game
                this._rec.data = [{msg, ...(data || {}), wtrec: {type: 'send', timing: 0}}];
                this._rec.startTime = new Date().getTime();
                this._rec.username = data?.username || RCManager?.session?.username || this._rec.username;
                this._rec.createdAt = Date.now();
                // pre-generate file name
                const d = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const nameTs = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
                const player = this._rec.username || 'player';
                this._rec.name = `${player}__${nameTs}`;
            }
            // Capture username from login flow even if we skip logging it
            if (msg === 'login' && data?.username) {
                this._rec.username = data.username;
                if (!this._rec.name || this._rec.name.startsWith('player__')) {
                    this._rec.name = this.generateSessionName(this._rec.username, this._rec.createdAt || Date.now());
                }
            }
            if (this._rec.startTime && data && !skipSend.has(data.msg)) {
                const currentTime = new Date().getTime();
                const timing = currentTime - this._rec.startTime;
                const clone = {...JSON.parse(JSON.stringify(data))};
                this._rec.data.push({...clone, wtrec: {type: 'send', timing}});
            }
        });

        // Hook incoming
        IOHook.handle_message.before.addHandler('wtrec', (data) => {
            if (data && !skipRecv.has(data.msg)) {
                // Fallback init if play/watch wasn't observed
                if (!this._rec.startTime) {
                    this._rec.data = [];
                    this._rec.startTime = Date.now();
                    this._rec.createdAt = Date.now();
                    this._rec.username = this._rec.username || RCManager?.session?.username || DWEM.Modules.SiteInformation?.current_user || 'player';
                    this._rec.name = this.generateSessionName(this._rec.username, this._rec.createdAt);
                }
                // Try to capture player name from player message structure
                if (data.msg === 'player') {
                    const candidate = data.name || data.username || data.player || data.char || null;
                    if (candidate && !this._rec.username) {
                        this._rec.username = String(candidate);
                    }
                    if (candidate && (this._rec.name?.startsWith?.('player__') || !this._rec.name)) {
                        this._rec.name = this.generateSessionName(String(candidate), this._rec.createdAt || Date.now());
                    }
                }
                if (this._rec.startTime) {
                    const currentTime = new Date().getTime();
                    const timing = currentTime - this._rec.startTime;
                    try {
                        const clone = {...JSON.parse(JSON.stringify(data))};
                        this._rec.data.push({...clone, wtrec: {type: 'receive', timing}});
                    } catch (e) {}
                }
            }
            if (data?.msg === 'game_client') {
                try {
                    const container = document.createElement('div');
                    container.innerHTML = data.content;
                    this._rec.version = data.version;
                    this._rec.keyPath = `game-${this._rec.version}`;
                    this._rec.valuePath = `/gamedata/${this._rec.version}`;
                    this._rec.styles = Array.from(container.querySelectorAll('link')).map(link => link.getAttribute('href'));
                    this._rec.images = Array.from(container.querySelectorAll('img')).map(link => link.getAttribute('src'));
                } catch (e) {}
            } else if (data?.msg === 'version') {
                try {
                    const all = Object.keys(require.s.contexts._.defined);
                    this._rec.sources = all
                        .filter(p => p.startsWith(this._rec.keyPath))
                        .map(p => p.replace(this._rec.keyPath, this._rec.valuePath) + '.js');
                    this._rec.resources = [...this._rec.sources, ...this._rec.styles, ...this._rec.images];
                    (async () => {
                        try {
                            this._rec.blobs = await Promise.all(this._rec.resources.map(r => fetch(r).then(r => r.blob()).catch(() => null)));
                        } catch (e) {}
                    })();
                } catch (e) {}
            } else if (this._rec.enabled && (data?.msg === 'go_lobby' || data?.msg === 'game_ended')) {
                // finalize and persist
                (async () => {
                    try {
                        // Always recompute final name from best-known username
                        const finalName = this.generateSessionName(this._rec.username || DWEM.Modules.SiteInformation?.current_user, this._rec.createdAt || Date.now());
                        const session = {
                            name: finalName,
                            createdAt: this._rec.createdAt || Date.now(),
                            username: this._rec.username,
                            version: this._rec.version,
                            resources: Array.isArray(this._rec.resources) ? this._rec.resources : [],
                            blobs: Array.isArray(this._rec.blobs) ? this._rec.blobs.map(b => b || new Blob()) : [],
                            data: Array.isArray(this._rec.data) ? this._rec.data : []
                        };
                        await this.saveSession(session);
                        const size = await this.estimateSessionSize(session);
                        DWEM.Modules.CommandManager?.sendChatMessage?.(`/wtrec saved: ${session.name} (${session.data.length} msgs, ${(size/1024/1024).toFixed(2)}MB)`);
                    } catch (e) {
                        console.error('WTRec save error', e);
                    } finally {
                        // reset per game
                        this._rec.data = [];
                        this._rec.startTime = 0;
                        this._rec.resources = [];
                        this._rec.blobs = [];
                        this._rec.name = null;
                        this._rec.createdAt = 0;
                    }
                })();
            }
        }, 999);

        // RCManager wiring: enable/disable by rc option
        RCManager?.addHandlers?.('WTRec', {
            onGameInitialize: (rcfile) => {
                try {
                    const enabled = RCManager.getRCOption(rcfile, 'record_wtrec', 'boolean', false);
                    this._rec.enabled = !!enabled;
                    if (this._rec.enabled) {
                        this._rec.username = RCManager?.session?.username || this._rec.username;
                    }
                } catch (e) {
                    this._rec.enabled = false;
                }
            },
            onGameEnd: () => {
                // If something left, the go_lobby handler above will persist; ensure reset
                this._rec.startTime = 0;
                this._rec.data = [];
                this._rec.resources = [];
                this._rec.blobs = [];
                this._rec.name = null;
                this._rec.createdAt = 0;
            }
        }, 0);

        // Add /wtrec commands via CommandManager
        const registerCommands = () => {
            const CM = DWEM.Modules.CommandManager;
            if (!CM?.addCommand) return false;
            // /wtrec list
            CM.addCommand('/wtrec list', [], async () => {
                try {
                    const sessions = await this.listSessions();
                    const estimates = await (navigator.storage?.estimate?.() || Promise.resolve({}));
                    const usage = estimates.usage || 0;
                    const quota = estimates.quota || 0;
                    const rows = await Promise.all(sessions.map(async (s, i) => {
                        const size = await this.estimateSessionSize(s);
                        return `#${i} ${s.name} - ${s.data?.length || 0} msgs, ${(size/1024/1024).toFixed(2)}MB`;
                    }));
                    const remain = Math.max(quota - usage, 0);
                    const footer = `Quota: ${(quota/1024/1024).toFixed(2)}MB, Used: ${(usage/1024/1024).toFixed(2)}MB, Free: ${(remain/1024/1024).toFixed(2)}MB`;
                    CM.sendChatMessage((rows.length ? rows.join('<br>') : '(no sessions)') + '<br>' + footer);
                } catch (e) {
                    CM.sendChatMessage('Failed to list wtrec sessions');
                }
            }, {module: WTRec.name, description: 'List recorded sessions'});

            // helper: resolve name or index
            const resolveTargets = async (arg) => {
                const all = await this.listSessions();
                if (!arg || arg === 'all') return all.map(s => s.name);
                const idx = Number.isInteger(+arg) ? parseInt(arg, 10) : NaN;
                if (!isNaN(idx)) {
                    const target = all[idx];
                    return target ? [target.name] : [];
                }
                const byName = all.find(s => s.name === arg);
                return byName ? [byName.name] : [];
            };

            // /wtrec download [all|name|index]
            CM.addCommand('/wtrec download', ['string?'], async (target) => {
                const names = await resolveTargets(target || 'all');
                if (!names.length) { CM.sendChatMessage('No matching wtrec session'); return; }
                for (const name of names) {
                    try {
                        const session = await this.getSession(name);
                        if (!session) continue;
                        const blob = await this.buildZipFromSession(session);
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${name}.wtrec`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    } catch (e) { console.error(e); }
                }
                CM.sendChatMessage(`Downloaded ${names.length} session(s).`);
            }, {module: WTRec.name, description: 'Download wtrec zip', argDescriptions: ['all|name|index']});

            // /wtrec delete [all|name|index]
            CM.addCommand('/wtrec delete', ['string?'], async (target) => {
                const names = await resolveTargets(target || 'all');
                if (!names.length) { CM.sendChatMessage('No matching wtrec session'); return; }
                for (const name of names) {
                    try { await this.deleteSession(name); } catch (e) { console.error(e); }
                }
                CM.sendChatMessage(`Deleted ${names.length} session(s).`);
            }, {module: WTRec.name, description: 'Delete recorded sessions', argDescriptions: ['all|name|index']});

            // /wtrec status
            CM.addCommand('/wtrec status', [], async () => {
                try {
                    const rec = this._rec || {};
                    const running = !!rec.startTime;
                    const count = Array.isArray(rec.data) ? rec.data.length : 0;
                    const resCount = Array.isArray(rec.resources) ? rec.resources.length : 0;
                    const blobsReady = Array.isArray(rec.blobs) ? rec.blobs.filter(Boolean).length : 0;
                    const estimates = await (navigator.storage?.estimate?.() || Promise.resolve({}));
                    const usage = estimates.usage || 0;
                    const quota = estimates.quota || 0;
                    const remain = Math.max(quota - usage, 0);
                    const lines = [
                        `enabled: ${rec.enabled ? 'yes' : 'no'}`,
                        `recording: ${running ? 'yes' : 'no'}`,
                        `name: ${rec.name || '(pending)'}`,
                        `user: ${rec.username || '(unknown)'}`,
                        `messages: ${count}`,
                        `resources: ${resCount} (fetched: ${blobsReady})`,
                        `createdAt: ${rec.createdAt ? new Date(rec.createdAt).toISOString() : '-'}`,
                        `quota: ${(quota/1024/1024).toFixed(2)}MB, used: ${(usage/1024/1024).toFixed(2)}MB, free: ${(remain/1024/1024).toFixed(2)}MB`
                    ];
                    CM.sendChatMessage(lines.join('<br>'));
                } catch (e) {
                    CM.sendChatMessage('Failed to show wtrec status');
                }
            }, {module: WTRec.name, description: 'Show current wtrec recording status'});

            // /wtrec (help for this module)
            CM.addCommand('/wtrec', [], () => {
                const cmds = CM.getCommandsByModule(WTRec.name);
                const html = `<b>WTRec Commands</b><br>` + CM.generateHelpHTML(cmds);
                CM.sendChatMessage(html);
            }, {module: WTRec.name, description: 'Show WTRec command help', aliases: ['/wtrec help']});
            return true;
        };

        // Try immediate registration; if not yet available, retry shortly
        if (!registerCommands()) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (registerCommands() || attempts > 20) {
                    clearInterval(timer);
                }
            }, 250);
        }

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
        let wtrecUrl = params.get('wtrec_url');
        if(!wtrecUrl?.startsWith('https://wtrec.nemelex.cards')) {
            wtrecUrl = false;
        }
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
