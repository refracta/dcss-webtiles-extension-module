// Separate GIF generation logic to avoid corrupting game state
export class GifGenerator {
    constructor(dungeonRenderer, mapKnowledge) {
        this.dungeonRenderer = dungeonRenderer;
        this.mapKnowledge = mapKnowledge;
    }
    
    async generateGif(gameStateData, los = 7) {
        const frames = [];
        
        // Create a separate canvas for GIF rendering
        const gifCanvas = document.createElement('canvas');
        
        // Get cell size from renderer
        let cellSize = 32; // default
        if (this.dungeonRenderer.cell_width) {
            cellSize = this.dungeonRenderer.cell_width;
        } else if (this.dungeonRenderer.scaled_size) {
            const scaled = this.dungeonRenderer.scaled_size();
            cellSize = scaled.width;
        }
        
        const viewSize = (los * 2 + 1) * cellSize;
        
        // Ensure renderer has element (canvas)
        if (!this.dungeonRenderer.element) {
            throw new Error('Dungeon renderer does not have an element');
        }
        
        gifCanvas.width = this.dungeonRenderer.element.width;
        gifCanvas.height = this.dungeonRenderer.element.height;
        const gifCtx = gifCanvas.getContext('2d');
        
        // Save original renderer state
        const originalElement = this.dungeonRenderer.element;
        const originalCtx = this.dungeonRenderer.ctx;
        
        // Save original map_knowledge
        const originalMapKnowledge = {};
        const getAllKeys = () => {
            const keys = [];
            if (window.map_knowledge) {
                for (let key in window.map_knowledge) {
                    if (window.map_knowledge.hasOwnProperty(key)) {
                        keys.push(key);
                        originalMapKnowledge[key] = JSON.parse(JSON.stringify(window.map_knowledge[key]));
                    }
                }
            }
            return keys;
        };
        const allKeys = getAllKeys();
        
        // Ensure map_knowledge exists
        if (!window.map_knowledge) {
            window.map_knowledge = {};
        }
        
        try {
            // Switch renderer to GIF canvas
            this.dungeonRenderer.element = gifCanvas;
            this.dungeonRenderer.ctx = gifCtx;
            
            // Process frames
            const frameCount = Math.min(gameStateData.length, 20);
            const startIdx = Math.max(0, gameStateData.length - frameCount);
            
            for (let i = startIdx; i < gameStateData.length; i++) {
                const stateData = gameStateData[i];
                
                // Clear canvas
                gifCtx.fillStyle = 'black';
                gifCtx.fillRect(0, 0, gifCanvas.width, gifCanvas.height);
                
                // Ensure map_knowledge exists
                if (!window.map_knowledge) {
                    window.map_knowledge = {};
                }
                
                // Clear map_knowledge
                for (const key of allKeys) {
                    delete window.map_knowledge[key];
                }
                
                // Apply state data to map_knowledge
                if (stateData.map && stateData.map.cells) {
                    for (const cell of stateData.map.cells) {
                        const key = cell.x + ',' + cell.y;
                        window.map_knowledge[key] = { t: cell };
                    }
                }
                
                // Apply k value
                if (stateData.k) {
                    for (const key in stateData.k) {
                        window.map_knowledge[key] = stateData.k[key];
                    }
                }
                
                // Set view center
                if (stateData.player && stateData.player.pos) {
                    this.dungeonRenderer.set_view_center(stateData.player.pos.x, stateData.player.pos.y);
                }
                
                // Ensure renderer has required properties
                if (!this.dungeonRenderer.rows || !this.dungeonRenderer.cols) {
                    // Set default view size
                    this.dungeonRenderer.rows = 17;
                    this.dungeonRenderer.cols = 33;
                }
                
                // Render visible cells
                const view = this.dungeonRenderer.view;
                console.log('Rendering frame', i, 'view:', view, 'rows:', this.dungeonRenderer.rows, 'cols:', this.dungeonRenderer.cols);
                
                let renderedCells = 0;
                for (let cy = view.y; cy < view.y + this.dungeonRenderer.rows; cy++) {
                    for (let cx = view.x; cx < view.x + this.dungeonRenderer.cols; cx++) {
                        const key = cx + ',' + cy;
                        if (window.map_knowledge[key] && window.map_knowledge[key].t) {
                            try {
                                this.dungeonRenderer.render_loc(cx, cy, window.map_knowledge[key]);
                                renderedCells++;
                            } catch (e) {
                                // Skip cells that fail to render
                                console.warn(`Failed to render cell at ${cx},${cy}:`, e);
                            }
                        }
                    }
                }
                console.log('Rendered cells:', renderedCells);
                
                // Extract the relevant portion for the frame
                const frameCanvas = document.createElement('canvas');
                frameCanvas.width = viewSize;
                frameCanvas.height = viewSize;
                const frameCtx = frameCanvas.getContext('2d');
                
                // Calculate source position
                const playerX = stateData.player && stateData.player.pos ? stateData.player.pos.x : 0;
                const playerY = stateData.player && stateData.player.pos ? stateData.player.pos.y : 0;
                const sourceX = (playerX - view.x - los) * cellSize;
                const sourceY = (playerY - view.y - los) * cellSize;
                
                // Copy the relevant portion
                frameCtx.drawImage(gifCanvas, sourceX, sourceY, viewSize, viewSize, 0, 0, viewSize, viewSize);
                
                frames.push(frameCanvas.toDataURL('image/png'));
            }
            
        } finally {
            // Restore original renderer state
            this.dungeonRenderer.element = originalElement;
            this.dungeonRenderer.ctx = originalCtx;
            
            // Restore original map_knowledge
            if (window.map_knowledge) {
                for (const key of allKeys) {
                    delete window.map_knowledge[key];
                }
            }
            for (const key in originalMapKnowledge) {
                if (!window.map_knowledge) {
                    window.map_knowledge = {};
                }
                window.map_knowledge[key] = originalMapKnowledge[key];
            }
            
            // Force re-render of current view
            // Clear the canvas first
            originalCtx.fillStyle = 'black';
            originalCtx.fillRect(0, 0, originalElement.width, originalElement.height);
            
            // Re-render all visible cells
            const view = this.dungeonRenderer.view;
            if (view) {
                for (let cy = view.y; cy < view.y + this.dungeonRenderer.rows; cy++) {
                    for (let cx = view.x; cx < view.x + this.dungeonRenderer.cols; cx++) {
                        const key = cx + ',' + cy;
                        if (window.map_knowledge && window.map_knowledge[key]) {
                            try {
                                this.dungeonRenderer.render_loc(cx, cy, window.map_knowledge[key]);
                            } catch (e) {
                                // Ignore individual cell render errors during restoration
                            }
                        }
                    }
                }
            }
        }
        
        return frames;
    }
}