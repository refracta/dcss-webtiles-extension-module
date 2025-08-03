// Separate GIF rendering logic to avoid game state corruption
export class GifRenderer {
    constructor() {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    
    renderStateToCanvas(stateData, los = 7) {
        // Set canvas size based on LOS
        const cellSize = 32; // Default cell size
        const size = (los * 2 + 1) * cellSize;
        this.offscreenCanvas.width = size;
        this.offscreenCanvas.height = size;
        
        // Clear canvas
        this.offscreenCtx.fillStyle = 'black';
        this.offscreenCtx.fillRect(0, 0, size, size);
        
        // Render map cells if available
        if (stateData.map && stateData.map.cells) {
            const centerX = los;
            const centerY = los;
            
            for (const cell of stateData.map.cells) {
                const x = centerX + cell.x;
                const y = centerY + cell.y;
                
                if (x >= 0 && x <= los * 2 && y >= 0 && y <= los * 2) {
                    this.renderCell(x * cellSize, y * cellSize, cell, cellSize);
                }
            }
        }
        
        // Return a copy of the canvas
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = this.offscreenCanvas.width;
        resultCanvas.height = this.offscreenCanvas.height;
        const resultCtx = resultCanvas.getContext('2d');
        resultCtx.drawImage(this.offscreenCanvas, 0, 0);
        
        return resultCanvas;
    }
    
    renderCell(x, y, cell, size) {
        // Simple cell rendering - just draw colored rectangles
        // This avoids using the game's renderer which might be in an inconsistent state
        
        if (cell.g && cell.g.ch) {
            // Draw glyph
            this.offscreenCtx.fillStyle = cell.g.col || 'white';
            this.offscreenCtx.font = `${size * 0.8}px monospace`;
            this.offscreenCtx.textAlign = 'center';
            this.offscreenCtx.textBaseline = 'middle';
            this.offscreenCtx.fillText(cell.g.ch, x + size/2, y + size/2);
        }
        
        // Draw background if needed
        if (cell.bg) {
            this.offscreenCtx.fillStyle = `rgba(${cell.bg.r}, ${cell.bg.g}, ${cell.bg.b}, 0.5)`;
            this.offscreenCtx.fillRect(x, y, size, size);
        }
    }
}