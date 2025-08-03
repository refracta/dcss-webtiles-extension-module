// Simpler GIF generation that doesn't rely on complex renderer state
export class SimpleGifGenerator {
    constructor() {
        this.cellSize = 32;
    }
    
    async generateGif(gameStateData, los = 7) {
        const frames = [];
        const viewSize = (los * 2 + 1) * this.cellSize;
        
        // Process frames
        const frameCount = Math.min(gameStateData.length, 20);
        const startIdx = Math.max(0, gameStateData.length - frameCount);
        
        for (let i = startIdx; i < gameStateData.length; i++) {
            const stateData = gameStateData[i];
            
            // Create frame canvas
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = viewSize;
            frameCanvas.height = viewSize;
            const ctx = frameCanvas.getContext('2d');
            
            // Black background
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, viewSize, viewSize);
            
            // Get player position for centering
            let centerX = 0, centerY = 0;
            if (stateData.player && stateData.player.pos) {
                centerX = stateData.player.pos.x;
                centerY = stateData.player.pos.y;
            }
            
            // Render cells
            if (stateData.map && stateData.map.cells) {
                for (const cell of stateData.map.cells) {
                    // Calculate relative position
                    const relX = cell.x - centerX + los;
                    const relY = cell.y - centerY + los;
                    
                    // Skip if outside view
                    if (relX < 0 || relX > los * 2 || relY < 0 || relY > los * 2) {
                        continue;
                    }
                    
                    const pixelX = relX * this.cellSize;
                    const pixelY = relY * this.cellSize;
                    
                    // Draw cell background
                    if (cell.bg) {
                        // Simple color based on tile type
                        const bgValue = cell.bg.value || 0;
                        if (bgValue > 0) {
                            // Floor tiles - gray
                            ctx.fillStyle = '#444444';
                            ctx.fillRect(pixelX, pixelY, this.cellSize, this.cellSize);
                        }
                    }
                    
                    // Draw monsters/items
                    if (cell.mon) {
                        ctx.fillStyle = 'red';
                        ctx.fillRect(pixelX + 4, pixelY + 4, this.cellSize - 8, this.cellSize - 8);
                    }
                    
                    // Draw player
                    if (cell.x === centerX && cell.y === centerY) {
                        ctx.fillStyle = 'white';
                        ctx.fillRect(pixelX + 8, pixelY + 8, this.cellSize - 16, this.cellSize - 16);
                    }
                    
                    // Draw walls
                    if (cell.dngn_overlay && cell.dngn_overlay[0]) {
                        const overlay = cell.dngn_overlay[0];
                        if (overlay >= 0x100) { // Wall tiles typically have higher values
                            ctx.fillStyle = '#888888';
                            ctx.fillRect(pixelX, pixelY, this.cellSize, this.cellSize);
                        }
                    }
                }
            }
            
            // Add turn number
            ctx.fillStyle = 'yellow';
            ctx.font = '16px monospace';
            ctx.fillText(`Turn ${i - startIdx + 1}`, 10, 20);
            
            frames.push(frameCanvas.toDataURL('image/png'));
        }
        
        return frames;
    }
}