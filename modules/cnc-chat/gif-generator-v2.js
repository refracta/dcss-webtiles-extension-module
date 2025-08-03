// GIF generator that properly handles renderer dependencies
export class GifGeneratorV2 {
    constructor(dungeonRenderer) {
        this.dungeonRenderer = dungeonRenderer;
    }
    
    async generateGif(gameStateData, los = 7) {
        const frames = [];
        
        // Save current state
        const savedState = this.saveCurrentState();
        
        try {
            // Process frames
            const frameCount = Math.min(gameStateData.length, 20);
            const startIdx = Math.max(0, gameStateData.length - frameCount);
            
            for (let i = startIdx; i < gameStateData.length; i++) {
                const stateData = gameStateData[i];
                
                // Apply game state
                this.applyGameState(stateData);
                
                // Force re-render
                this.forceRender();
                
                // Wait a bit for rendering
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Capture frame
                const frameCanvas = await this.captureFrame(los);
                frames.push(frameCanvas.toDataURL('image/png'));
            }
            
        } finally {
            // Restore original state
            this.restoreState(savedState);
        }
        
        return frames;
    }
    
    saveCurrentState() {
        // Save everything we'll modify
        const state = {
            mapKnowledge: {},
            player: window.player ? JSON.parse(JSON.stringify(window.player)) : null,
            viewCenter: this.dungeonRenderer.view_center ? 
                {...this.dungeonRenderer.view_center} : null,
            view: this.dungeonRenderer.view ? 
                {...this.dungeonRenderer.view} : null
        };
        
        // Save map knowledge
        if (window.map_knowledge) {
            for (const key in window.map_knowledge) {
                if (window.map_knowledge.hasOwnProperty(key)) {
                    state.mapKnowledge[key] = JSON.parse(JSON.stringify(window.map_knowledge[key]));
                }
            }
        }
        
        return state;
    }
    
    applyGameState(stateData) {
        // Clear and apply map knowledge
        if (window.map_knowledge) {
            for (const key in window.map_knowledge) {
                delete window.map_knowledge[key];
            }
        } else {
            window.map_knowledge = {};
        }
        
        // Apply new map data
        if (stateData.map && stateData.map.cells) {
            for (const cell of stateData.map.cells) {
                const key = cell.x + ',' + cell.y;
                window.map_knowledge[key] = { t: cell };
            }
        }
        
        // Apply stored map_knowledge
        if (stateData.map_knowledge) {
            for (const key in stateData.map_knowledge) {
                window.map_knowledge[key] = stateData.map_knowledge[key];
            }
        }
        
        // Update player position
        if (stateData.player) {
            window.player = stateData.player;
            if (stateData.player.pos && this.dungeonRenderer.set_view_center) {
                this.dungeonRenderer.set_view_center(stateData.player.pos.x, stateData.player.pos.y);
            }
        }
    }
    
    async captureFrame(los) {
        // Get cell size
        let cellSize = 32;
        if (this.dungeonRenderer.cell_width) {
            cellSize = this.dungeonRenderer.cell_width;
        }
        
        const size = (los * 2 + 1) * cellSize;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Calculate source area
        const view = this.dungeonRenderer.view;
        const viewCenter = this.dungeonRenderer.view_center;
        
        if (view && viewCenter && this.dungeonRenderer.element) {
            const sourceX = (viewCenter.x - view.x - los) * cellSize;
            const sourceY = (viewCenter.y - view.y - los) * cellSize;
            
            // Copy from renderer canvas
            ctx.drawImage(this.dungeonRenderer.element, 
                sourceX, sourceY, size, size,
                0, 0, size, size);
        } else {
            // Fallback: black frame
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, size, size);
        }
        
        return canvas;
    }
    
    restoreState(state) {
        // Clear current map knowledge
        if (window.map_knowledge) {
            for (const key in window.map_knowledge) {
                delete window.map_knowledge[key];
            }
        }
        
        // Restore saved map knowledge
        for (const key in state.mapKnowledge) {
            window.map_knowledge[key] = state.mapKnowledge[key];
        }
        
        // Restore player
        if (state.player) {
            window.player = state.player;
        }
        
        // Restore view
        if (state.viewCenter && this.dungeonRenderer.set_view_center) {
            this.dungeonRenderer.set_view_center(state.viewCenter.x, state.viewCenter.y);
        }
        
        // Force final render
        this.forceRender();
    }
    
    forceRender() {
        // Clear canvas
        if (this.dungeonRenderer.ctx && this.dungeonRenderer.element) {
            this.dungeonRenderer.ctx.fillStyle = 'black';
            this.dungeonRenderer.ctx.fillRect(0, 0, 
                this.dungeonRenderer.element.width, 
                this.dungeonRenderer.element.height);
        }
        
        console.log('Force render:', {
            view: this.dungeonRenderer.view,
            rows: this.dungeonRenderer.rows,
            cols: this.dungeonRenderer.cols,
            mapKnowledgeKeys: Object.keys(window.map_knowledge || {}).length
        });
        
        // Render all visible cells
        const view = this.dungeonRenderer.view;
        let renderedCount = 0;
        if (view && this.dungeonRenderer.render_loc) {
            for (let cy = view.y; cy < view.y + this.dungeonRenderer.rows; cy++) {
                for (let cx = view.x; cx < view.x + this.dungeonRenderer.cols; cx++) {
                    const key = cx + ',' + cy;
                    if (window.map_knowledge && window.map_knowledge[key]) {
                        try {
                            this.dungeonRenderer.render_loc(cx, cy, window.map_knowledge[key]);
                            renderedCount++;
                        } catch (e) {
                            console.error(`Render error at ${cx},${cy}:`, e);
                        }
                    }
                }
            }
        }
        console.log('Rendered cells:', renderedCount);
    }
}