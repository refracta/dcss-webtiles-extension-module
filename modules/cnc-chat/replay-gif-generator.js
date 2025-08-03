// GIF generator that replays game states using IOHook messages
export class ReplayGifGenerator {
    constructor(dungeonRenderer, captureGame) {
        this.dungeonRenderer = dungeonRenderer;
        this.captureGame = captureGame;
    }
    
    async generateGif(gameStateData, los = 7) {
        const frames = [];
        
        // Save current message handlers
        const originalHandlers = this.saveHandlers();
        
        // Install temporary handler that blocks all UI updates
        let isReplaying = true;
        const replayHandler = (data) => {
            if (!isReplaying) return false;
            
            // Block UI-related messages that cause errors
            if (data.msg === 'ui_state' || 
                data.msg === 'update_menu' || 
                data.msg === 'menu' || 
                data.msg === 'close_menu' ||
                data.msg === 'msgs') {
                return true; // Block these messages
            }
            
            return false; // Let other messages through
        };
        
        // Get IOHook from DWEM modules
        const IOHook = window.DWEM?.Modules?.IOHook;
        if (!IOHook) {
            throw new Error('IOHook module not found');
        }
        
        // Add with very high priority to block before other handlers
        IOHook.handle_message.before.addHandler('gif-replay-blocker', replayHandler, 99999);
        
        try {
            // Process frames
            const frameCount = Math.min(gameStateData.length, 15);
            const startIdx = Math.max(0, gameStateData.length - frameCount);
            
            // Save current state
            const savedState = {
                mapKnowledge: {},
                k: null,
                player: window.player ? JSON.parse(JSON.stringify(window.player)) : null
            };
            
            // Save original map_knowledge
            if (window.map_knowledge) {
                for (const key in window.map_knowledge) {
                    savedState.mapKnowledge[key] = JSON.parse(JSON.stringify(window.map_knowledge[key]));
                }
            }
            
            const CNCChat = window.DWEM?.Modules?.CNCChat;
            if (CNCChat && CNCChat.k) {
                savedState.k = JSON.parse(JSON.stringify(CNCChat.k));
            }
            
            // Clear everything to start fresh
            if (window.map_knowledge) {
                for (const key in window.map_knowledge) {
                    delete window.map_knowledge[key];
                }
            }
            
            // Replay from the beginning to build up proper state
            for (let i = 0; i < gameStateData.length; i++) {
                const stateData = gameStateData[i];
                
                // Apply k value updates
                if (stateData.k && CNCChat) {
                    CNCChat.k = stateData.k;
                }
                
                // Apply state messages - these will accumulate naturally
                if (stateData.player) {
                    IOHook.handle_message(stateData.player);
                }
                if (stateData.map) {
                    IOHook.handle_message(stateData.map);
                }
                
                // Only capture frames for the ones we want
                if (i >= startIdx) {
                    // Wait for render
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Capture frame
                    const canvas = await this.captureGame(los);
                    frames.push(canvas.toDataURL('image/png'));
                }
            }
            
            // Restore original state
            if (window.map_knowledge) {
                for (const key in window.map_knowledge) {
                    delete window.map_knowledge[key];
                }
                for (const key in savedState.mapKnowledge) {
                    window.map_knowledge[key] = savedState.mapKnowledge[key];
                }
            }
            
            if (CNCChat && savedState.k) {
                CNCChat.k = savedState.k;
            }
            
            if (savedState.player) {
                window.player = savedState.player;
                // Re-apply player message to restore view
                IOHook.handle_message(savedState.player);
            }
            
            // Force re-render the entire view
            if (this.dungeonRenderer) {
                // Clear canvas first
                if (this.dungeonRenderer.ctx && this.dungeonRenderer.element) {
                    this.dungeonRenderer.ctx.fillStyle = 'black';
                    this.dungeonRenderer.ctx.fillRect(0, 0, 
                        this.dungeonRenderer.element.width, 
                        this.dungeonRenderer.element.height);
                }
                
                // Trigger update_cells event to let the renderer handle it properly
                if (this.dungeonRenderer.element) {
                    const cells = [];
                    const view = this.dungeonRenderer.view;
                    if (view) {
                        for (let cy = view.y; cy < view.y + this.dungeonRenderer.rows; cy++) {
                            for (let cx = view.x; cx < view.x + this.dungeonRenderer.cols; cx++) {
                                cells.push({x: cx, y: cy});
                            }
                        }
                    }
                    // Trigger the update_cells event which the renderer listens to
                    $(this.dungeonRenderer.element).trigger('update_cells', [cells]);
                }
            }
            
        } finally {
            isReplaying = false;
            // Remove temporary handler
            IOHook.handle_message.before.removeHandler('gif-replay-blocker');
        }
        
        return frames;
    }
    
    saveHandlers() {
        // This would save current handlers if needed
        return {};
    }
}