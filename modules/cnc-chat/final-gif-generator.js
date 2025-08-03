// Final GIF generator that saves and restores complete game state
export class FinalGifGenerator {
    constructor(captureGame) {
        this.captureGame = captureGame;
        this.IOHook = window.DWEM?.Modules?.IOHook;
        this.CNCChat = window.DWEM?.Modules?.CNCChat;
    }
    
    async generateGif(gameStateData, los = 7) {
        if (!this.IOHook) {
            throw new Error('IOHook module not found');
        }
        
        const frames = [];
        
        // Block problematic messages during replay
        let isReplaying = true;
        const replayHandler = (data) => {
            if (!isReplaying) return false;
            
            // Block UI-related messages
            if (data.msg === 'ui_state' || 
                data.msg === 'update_menu' || 
                data.msg === 'menu' || 
                data.msg === 'close_menu' ||
                data.msg === 'msgs') {
                return true;
            }
            
            return false;
        };
        
        // Add blocker
        this.IOHook.handle_message.before.addHandler('gif-replay-blocker', replayHandler, 99999);
        
        try {
            // Save current map_knowledge
            const originalMapKnowledge = {};
            if (window.map_knowledge) {
                for (const key in window.map_knowledge) {
                    originalMapKnowledge[key] = JSON.parse(JSON.stringify(window.map_knowledge[key]));
                }
            }
            
            // Create map_knowledge_prime (without monsters and player)
            const mapKnowledgePrime = {};
            for (const key in originalMapKnowledge) {
                const cell = JSON.parse(JSON.stringify(originalMapKnowledge[key]));
                if (cell.t) {
                    // Remove monster data
                    if (cell.t.mon) {
                        delete cell.t.mon;
                    }
                    // Remove player data (@)
                    if (cell.t.fg && cell.t.fg.value === 64) { // @ character
                        delete cell.t.fg;
                    }
                    // Also check for player in mcache
                    if (cell.t.mcache && Array.isArray(cell.t.mcache)) {
                        cell.t.mcache = cell.t.mcache.filter(item => {
                            // Remove player-related cache entries
                            return !(item && item.value === 64);
                        });
                    }
                    // Remove any other player-related overlays
                    if (cell.t.player) {
                        delete cell.t.player;
                    }
                }
                mapKnowledgePrime[key] = cell;
            }
            
            // Get the last few frames
            const frameCount = Math.min(gameStateData.length, 20);
            const startIdx = Math.max(0, gameStateData.length - frameCount);
            
            // First, render clean background with map_knowledge_prime (no monsters)
            window.map_knowledge = {};
            for (const key in mapKnowledgePrime) {
                window.map_knowledge[key] = JSON.parse(JSON.stringify(mapKnowledgePrime[key]));
            }
            
            // Wait for clean background render
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Now apply each state and capture
            for (let i = startIdx; i < gameStateData.length; i++) {
                const stateData = gameStateData[i];
                
                // Apply messages
                if (stateData.player) {
                    this.IOHook.handle_message(stateData.player);
                }
                if (stateData.map) {
                    this.IOHook.handle_message(stateData.map);
                }
                
                // Apply stored map_knowledge if available
                if (stateData.map_knowledge) {
                    for (const key in stateData.map_knowledge) {
                        window.map_knowledge[key] = JSON.parse(JSON.stringify(stateData.map_knowledge[key]));
                    }
                }
                
                // Short wait for rendering
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Capture frame
                const canvas = await this.captureGame(los);
                frames.push(canvas.toDataURL('image/png'));
            }
            
            // Restore original map_knowledge
            window.map_knowledge = originalMapKnowledge;
            
        } finally {
            isReplaying = false;
            // Remove blocker
            this.IOHook.handle_message.before.removeHandler('gif-replay-blocker');
            
            // Send a single map refresh to restore display
            if (window.comm && window.comm.send_message) {
                // Request current game state refresh
                window.comm.send_message('key', { keycode: 12 }); // Ctrl+L (redraw)
            }
        }
        
        return frames;
    }
}