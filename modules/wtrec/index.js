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
                const criticalTypes = ['player', 'map', 'ui_state', 'options', 'inv'];
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
                const criticalTypes = ['player', 'map', 'ui_state', 'options', 'inv'];
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
            updateCursor();
            
            } catch (e) {
                console.error('Error during seeking:', e);
            } finally {
                // Remove loading indicator and reset seeking flag
                loadingDiv.remove();
                window.isSeeking = false;
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
        let segStart = 0;
        let curPlace = null;
        let curDepth = null;
        let firstPlaceFound = false;
        
        for (let i = 0; i < data.length; i++) {
            const m = data[i];
            if (m.msg === 'player' && m.place !== undefined) {
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
            await seekToIndex(newIndex);
            manualStep = true;
            abortSleep = true; // Abort the current sleep
            progressBar.value = currentIndex;
        };
        uiContainer.appendChild(leftButton);

        const rightButton = document.createElement('button');
        rightButton.textContent = '>>';
        rightButton.onclick = async () => {
            const newIndex = Math.min(data.length - 1, currentIndex + stepSize);
            await seekToIndex(newIndex);
            manualStep = true;
            abortSleep = true;
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
            height: 80px;
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            z-index: 10001;
            overflow: visible;
        `;
        
        // Label container
        const labelContainer = document.createElement('div');
        labelContainer.style.cssText = `
            position: absolute;
            top: 0;
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
            bottom: 0;
            width: 3px;
            height: 40px;
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
        
        // Update cursor position
        updateCursor = () => {
            const percent = currentIndex / data.length;
            cursor.style.left = (percent * 100) + '%';
            
            // Update tooltip
            for (let i = currentIndex; i >= 0; i--) {
                if (data[i].msg === 'player' && data[i].place) {
                    const depth = data[i].depth;
                    tooltip.textContent = (depth && depth !== 0) ? `${data[i].place}:${depth}` : data[i].place;
                    tooltip.style.display = 'block';
                    break;
                }
            }
        };
        
        // Mouse move handler for tooltip preview
        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const hoverIndex = Math.floor(percent * data.length);
            
            // Find place at hover position
            for (let i = hoverIndex; i >= 0; i--) {
                if (data[i].msg === 'player' && data[i].place) {
                    const place = data[i].place;
                    const depth = data[i].depth;
                    tooltip.textContent = (depth && depth !== 0) ? `${place}:${depth}` : place;
                    tooltip.style.display = 'block';
                    break;
                }
            }
        };
        
        // Click handler
        canvas.onclick = async (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const targetIndex = Math.floor(percent * data.length);
            
            await seekToIndex(targetIndex);
            manualStep = true;
            abortSleep = true;
        };
        
        // Window resize handler
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth * 0.9;
            drawSegments();
            updateCursor();
        });
        
        document.body.appendChild(progressContainer);
        drawSegments();
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
