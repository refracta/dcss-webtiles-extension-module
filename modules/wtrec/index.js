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

        // Declare updateCursor as a variable first
        let updateCursor;
        
        const updateUI = (originalSleep, adjustedSleep) => {
            currentMsgDisplay.textContent = `Current msg: ${data[currentIndex].msg}`;
            currentIndexDisplay.textContent = `Current index: ${currentIndex}`;
            totalLengthDisplay.textContent = `Total length: ${data.length}`;
            progressDisplay.textContent = `Progress: ${((currentIndex / data.length) * 100).toFixed(2)}%`;
            sleepTimeDisplay.textContent = `Sleep: ${originalSleep.toFixed(2)}ms (Adjusted: ${adjustedSleep.toFixed(2)}ms)`;
            
            // Update cursor position if available
            if (updateCursor) {
                updateCursor();
            }
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

        const showBarCheckbox = document.createElement('input');
        showBarCheckbox.type = 'checkbox';
        showBarCheckbox.checked = true;
        showBarCheckbox.onchange = () => {
            progressContainer.style.display = showBarCheckbox.checked ? '' : 'none';
        };
        uiContainer.appendChild(document.createElement('br'));
        uiContainer.appendChild(showBarCheckbox);
        uiContainer.appendChild(document.createTextNode(' Show progress '));

        const lobbyButton = document.createElement('button');
        lobbyButton.textContent = 'Go Lobby';
        lobbyButton.onclick = () => { location.href = '/'; };
        uiContainer.appendChild(lobbyButton);

        const leftButton = document.createElement('button');
        leftButton.textContent = '<<';
        leftButton.onclick = async () => {
            const newIndex = Math.max(0, currentIndex - stepSize);
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
        uiContainer.appendChild(leftButton);

        const rightButton = document.createElement('button');
        rightButton.textContent = '>>';
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

        // Create new progress bar
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 90vw;
            height: 140px;
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            z-index: 10001;
            overflow: visible;
        `;
        
        // HP graph canvas
        const hpCanvas = document.createElement('canvas');
        hpCanvas.width = window.innerWidth * 0.9;
        hpCanvas.height = 60;
        hpCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 60px;
            pointer-events: none;
        `;
        progressContainer.appendChild(hpCanvas);
        const hpCtx = hpCanvas.getContext('2d');
        
        // Label container
        const labelContainer = document.createElement('div');
        labelContainer.style.cssText = `
            position: absolute;
            top: 60px;
            left: 0;
            width: 100%;
            height: 40px;
            pointer-events: none;
        `;
        progressContainer.appendChild(labelContainer);
        
        // Canvas for rendering segments
        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth * 0.9;
        canvas.height = 40;
        canvas.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
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
                            const startX = (barStartIndex / data.length) * hpCanvas.width;
                            const endX = (i / data.length) * hpCanvas.width;
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
                            
                            // Add a thin black outline for clarity
                            hpCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                            hpCtx.lineWidth = 0.5;
                            hpCtx.strokeRect(startX, hpCanvas.height - effectiveHeight, barWidth, effectiveHeight);
                            
                            
                            hpChangeCount++;
                        }
                        
                        lastHp = hpData[i];
                        barStartIndex = i;
                    }
                }
            }
            
            
            // Draw the final bar
            if (lastHp && data.length > barStartIndex) {
                const startX = (barStartIndex / data.length) * hpCanvas.width;
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
                
                // Add a thin black outline for clarity
                hpCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                hpCtx.lineWidth = 0.5;
                hpCtx.strokeRect(startX, hpCanvas.height - effectiveHeight, barWidth, effectiveHeight);
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
            
            segments.forEach((seg, idx) => {
                const x = (seg.start / data.length) * canvas.width;
                const width = ((seg.end - seg.start + 1) / data.length) * canvas.width;
                
                // Draw segment
                ctx.fillStyle = seg.place ? getPlaceColor(seg.place, seg.depth || 0) : '#222';
                ctx.fillRect(x, 0, width, canvas.height);
                
                // Draw black divider
                if (idx > 0) {
                    ctx.fillStyle = 'black';
                    ctx.fillRect(x, 0, 2, canvas.height);
                }
                
                // Add place label
                if (width > 15) { // Show labels for smaller segments too
                    const label = document.createElement('div');
                    label.style.cssText = `
                        position: absolute;
                        left: ${(x / canvas.width) * 100}%;
                        top: 20px;
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
            white-space: nowrap;
            pointer-events: none;
            display: none;
        `;
        cursor.appendChild(tooltip);
        
        // HP display element (separate from cursor for better z-index control)
        const hpDisplay = document.createElement('div');
        hpDisplay.style.cssText = `
            position: absolute;
            top: 5px;
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
        
        // Update cursor position
        updateCursor = () => {
            const percent = currentIndex / data.length;
            cursor.style.left = (percent * 100) + '%';
            
            // Update tooltip - find from segments which is more reliable
            let foundPlace = false;
            for (const seg of segments) {
                if (currentIndex >= seg.start && currentIndex <= seg.end) {
                    if (seg.place) {
                        tooltip.textContent = (seg.depth && seg.depth !== 0) ? `${seg.place}:${seg.depth}` : seg.place;
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
                        const depth = data[i].depth;
                        tooltip.textContent = (depth && depth !== 0) ? `${data[i].place}:${depth}` : data[i].place;
                        tooltip.style.display = 'block';
                        foundPlace = true;
                        break;
                    }
                }
            }
            
            // Show unknown if still not found
            if (!foundPlace) {
                tooltip.textContent = '(Unknown)';
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
            white-space: nowrap;
            pointer-events: none;
            display: none;
            z-index: 11;
        `;
        progressContainer.appendChild(hoverTooltip);
        
        // Mouse move handler for tooltip preview
        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const hoverIndex = Math.floor(percent * data.length);
            
            // Update hover tooltip position
            hoverTooltip.style.left = (percent * 100) + '%';
            hoverTooltip.style.transform = 'translateX(-50%)';
            
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
            
            if (hoverPlace) {
                hoverTooltip.textContent = (hoverDepth && hoverDepth !== 0) ? `${hoverPlace}:${hoverDepth}` : hoverPlace;
            } else {
                hoverTooltip.textContent = '(Unknown)';
            }
            hoverTooltip.style.display = 'block';
        };
        
        // Hide hover tooltip when mouse leaves
        canvas.onmouseleave = () => {
            hoverTooltip.style.display = 'none';
        };
        
        // Click handler
        canvas.onclick = async (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const targetIndex = Math.floor(percent * data.length);
            
            // Pause playback during seeking
            const wasPlaying = isPlaying;
            isPlaying = false;
            abortSleep = true;
            
            try {
                await seekToIndex(targetIndex);
            } catch (e) {
                console.error('Error during seeking:', e);
                // Ensure seeking flag is reset even on error
                window.isSeeking = false;
            } finally {
                // Always restore playback state
                if (wasPlaying) {
                    isPlaying = true;
                }
                manualStep = true;
                
                // Force abort sleep again to ensure playback resumes
                abortSleep = true;
            }
        };
        
        // Window resize handler
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth * 0.9;
            hpCanvas.width = window.innerWidth * 0.9;
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
