/**
 * Terminal Renderer - Emulates terminal display to capture what's actually visible
 *
 * Claude Code CLI and other TUI applications use escape sequences to:
 * - Move cursor, clear lines, overwrite content
 * - Show collapsed views with "Ctrl+O to open"
 *
 * Simply stripping ANSI codes reveals ALL text ever written.
 * This renderer maintains a virtual screen buffer and outputs what would
 * actually be visible on a real terminal.
 */

export interface RendererOptions {
    /** Terminal width in columns (default: 120) */
    cols?: number;
    /** Terminal height in rows (default: 50) */
    rows?: number;
}

/**
 * Virtual terminal renderer that processes escape sequences
 * and maintains what's actually visible on screen
 */
export class TerminalRenderer {
    private cols: number;
    private rows: number;
    private buffer: string[][];  // 2D screen buffer [row][col]
    private cursorX: number = 0;
    private cursorY: number = 0;
    private savedCursorX: number = 0;
    private savedCursorY: number = 0;
    private scrollTop: number = 0;
    private scrollBottom: number;

    constructor(options: RendererOptions = {}) {
        this.cols = options.cols ?? 120;
        this.rows = options.rows ?? 50;
        this.scrollBottom = this.rows - 1;
        this.buffer = this.createEmptyBuffer();
    }

    private createEmptyBuffer(): string[][] {
        return Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => ' ')
        );
    }

    /**
     * Process raw terminal output and update the virtual screen
     */
    write(data: string): void {
        let i = 0;
        while (i < data.length) {
            const char = data[i];

            // Handle escape sequences
            if (char === '\x1b') {
                const result = this.parseEscapeSequence(data, i);
                i = result.nextIndex;
                continue;
            }

            // Handle control characters
            if (char === '\r') {
                this.cursorX = 0;
                i++;
                continue;
            }

            if (char === '\n') {
                this.lineFeed();
                i++;
                continue;
            }

            if (char === '\b') {
                if (this.cursorX > 0) this.cursorX--;
                i++;
                continue;
            }

            if (char === '\t') {
                // Tab to next 8-column stop
                this.cursorX = Math.min(this.cols - 1, (Math.floor(this.cursorX / 8) + 1) * 8);
                i++;
                continue;
            }

            // Regular printable character
            if (char >= ' ') {
                this.putChar(char);
            }
            i++;
        }
    }

    private putChar(char: string): void {
        if (this.cursorX >= this.cols) {
            // Auto-wrap
            this.cursorX = 0;
            this.lineFeed();
        }
        if (this.cursorY < this.rows && this.cursorX < this.cols) {
            this.buffer[this.cursorY][this.cursorX] = char;
        }
        this.cursorX++;
    }

    private lineFeed(): void {
        if (this.cursorY >= this.scrollBottom) {
            // Scroll up
            this.scrollUp();
        } else {
            this.cursorY++;
        }
    }

    private scrollUp(): void {
        // Remove top line within scroll region, add empty line at bottom
        for (let y = this.scrollTop; y < this.scrollBottom; y++) {
            this.buffer[y] = this.buffer[y + 1];
        }
        this.buffer[this.scrollBottom] = Array.from({ length: this.cols }, () => ' ');
    }

    private parseEscapeSequence(data: string, start: number): { nextIndex: number } {
        if (start + 1 >= data.length) {
            return { nextIndex: start + 1 };
        }

        const nextChar = data[start + 1];

        // CSI sequence: ESC [
        if (nextChar === '[') {
            return this.parseCSI(data, start + 2);
        }

        // OSC sequence: ESC ]
        if (nextChar === ']') {
            return this.parseOSC(data, start + 2);
        }

        // Other escape sequences
        switch (nextChar) {
            case '7': // Save cursor
                this.savedCursorX = this.cursorX;
                this.savedCursorY = this.cursorY;
                return { nextIndex: start + 2 };
            case '8': // Restore cursor
                this.cursorX = this.savedCursorX;
                this.cursorY = this.savedCursorY;
                return { nextIndex: start + 2 };
            case 'D': // Index (line feed)
                this.lineFeed();
                return { nextIndex: start + 2 };
            case 'M': // Reverse index
                if (this.cursorY > this.scrollTop) {
                    this.cursorY--;
                }
                return { nextIndex: start + 2 };
            case 'c': // Reset
                this.reset();
                return { nextIndex: start + 2 };
            default:
                return { nextIndex: start + 2 };
        }
    }

    private parseCSI(data: string, start: number): { nextIndex: number } {
        // Collect parameters
        let params = '';
        let i = start;

        // Collect parameter bytes (0x30-0x3F)
        while (i < data.length && data[i] >= '0' && data[i] <= '?') {
            params += data[i];
            i++;
        }

        // Collect intermediate bytes (0x20-0x2F)
        while (i < data.length && data[i] >= ' ' && data[i] <= '/') {
            i++;
        }

        // Final byte (0x40-0x7E)
        if (i >= data.length) {
            return { nextIndex: i };
        }

        const finalByte = data[i];
        i++;

        // Parse numeric parameters
        const numParams = params.split(';').map(p => parseInt(p) || 0);

        switch (finalByte) {
            case 'A': // Cursor up
                this.cursorY = Math.max(0, this.cursorY - (numParams[0] || 1));
                break;
            case 'B': // Cursor down
                this.cursorY = Math.min(this.rows - 1, this.cursorY + (numParams[0] || 1));
                break;
            case 'C': // Cursor forward
                this.cursorX = Math.min(this.cols - 1, this.cursorX + (numParams[0] || 1));
                break;
            case 'D': // Cursor backward
                this.cursorX = Math.max(0, this.cursorX - (numParams[0] || 1));
                break;
            case 'E': // Cursor next line
                this.cursorX = 0;
                this.cursorY = Math.min(this.rows - 1, this.cursorY + (numParams[0] || 1));
                break;
            case 'F': // Cursor previous line
                this.cursorX = 0;
                this.cursorY = Math.max(0, this.cursorY - (numParams[0] || 1));
                break;
            case 'G': // Cursor horizontal absolute
                this.cursorX = Math.min(this.cols - 1, Math.max(0, (numParams[0] || 1) - 1));
                break;
            case 'H': // Cursor position
            case 'f':
                this.cursorY = Math.min(this.rows - 1, Math.max(0, (numParams[0] || 1) - 1));
                this.cursorX = Math.min(this.cols - 1, Math.max(0, (numParams[1] || 1) - 1));
                break;
            case 'J': // Erase in display
                this.eraseInDisplay(numParams[0] || 0);
                break;
            case 'K': // Erase in line
                this.eraseInLine(numParams[0] || 0);
                break;
            case 'L': // Insert lines
                this.insertLines(numParams[0] || 1);
                break;
            case 'M': // Delete lines
                this.deleteLines(numParams[0] || 1);
                break;
            case 'P': // Delete characters
                this.deleteChars(numParams[0] || 1);
                break;
            case 'S': // Scroll up
                for (let n = 0; n < (numParams[0] || 1); n++) {
                    this.scrollUp();
                }
                break;
            case 'T': // Scroll down
                for (let n = 0; n < (numParams[0] || 1); n++) {
                    this.scrollDown();
                }
                break;
            case 'X': // Erase characters
                this.eraseChars(numParams[0] || 1);
                break;
            case 'd': // Vertical position absolute
                this.cursorY = Math.min(this.rows - 1, Math.max(0, (numParams[0] || 1) - 1));
                break;
            case 'r': // Set scroll region
                this.scrollTop = Math.max(0, (numParams[0] || 1) - 1);
                this.scrollBottom = Math.min(this.rows - 1, (numParams[1] || this.rows) - 1);
                this.cursorX = 0;
                this.cursorY = 0;
                break;
            case 's': // Save cursor position
                this.savedCursorX = this.cursorX;
                this.savedCursorY = this.cursorY;
                break;
            case 'u': // Restore cursor position
                this.cursorX = this.savedCursorX;
                this.cursorY = this.savedCursorY;
                break;
            case 'm': // SGR (styling) - ignore, we don't need colors
            case 'h': // Set mode - ignore
            case 'l': // Reset mode - ignore
            case 'n': // Device status report - ignore
            case 'c': // Device attributes - ignore
                break;
        }

        return { nextIndex: i };
    }

    private parseOSC(data: string, start: number): { nextIndex: number } {
        // OSC sequences end with BEL (\x07) or ST (ESC \)
        let i = start;
        while (i < data.length) {
            if (data[i] === '\x07') {
                return { nextIndex: i + 1 };
            }
            if (data[i] === '\x1b' && i + 1 < data.length && data[i + 1] === '\\') {
                return { nextIndex: i + 2 };
            }
            i++;
        }
        return { nextIndex: i };
    }

    private eraseInDisplay(mode: number): void {
        switch (mode) {
            case 0: // Erase from cursor to end of screen
                this.clearLine(this.cursorY, this.cursorX, this.cols);
                for (let y = this.cursorY + 1; y < this.rows; y++) {
                    this.clearLine(y, 0, this.cols);
                }
                break;
            case 1: // Erase from start to cursor
                for (let y = 0; y < this.cursorY; y++) {
                    this.clearLine(y, 0, this.cols);
                }
                this.clearLine(this.cursorY, 0, this.cursorX + 1);
                break;
            case 2: // Erase entire screen
            case 3: // Erase entire screen and scrollback
                for (let y = 0; y < this.rows; y++) {
                    this.clearLine(y, 0, this.cols);
                }
                break;
        }
    }

    private eraseInLine(mode: number): void {
        switch (mode) {
            case 0: // Erase from cursor to end of line
                this.clearLine(this.cursorY, this.cursorX, this.cols);
                break;
            case 1: // Erase from start of line to cursor
                this.clearLine(this.cursorY, 0, this.cursorX + 1);
                break;
            case 2: // Erase entire line
                this.clearLine(this.cursorY, 0, this.cols);
                break;
        }
    }

    private clearLine(y: number, startX: number, endX: number): void {
        if (y < 0 || y >= this.rows) return;
        for (let x = startX; x < Math.min(endX, this.cols); x++) {
            this.buffer[y][x] = ' ';
        }
    }

    private eraseChars(count: number): void {
        for (let i = 0; i < count && this.cursorX + i < this.cols; i++) {
            this.buffer[this.cursorY][this.cursorX + i] = ' ';
        }
    }

    private insertLines(count: number): void {
        for (let n = 0; n < count; n++) {
            // Shift lines down
            for (let y = this.scrollBottom; y > this.cursorY; y--) {
                this.buffer[y] = this.buffer[y - 1];
            }
            this.buffer[this.cursorY] = Array.from({ length: this.cols }, () => ' ');
        }
    }

    private deleteLines(count: number): void {
        for (let n = 0; n < count; n++) {
            // Shift lines up
            for (let y = this.cursorY; y < this.scrollBottom; y++) {
                this.buffer[y] = this.buffer[y + 1];
            }
            this.buffer[this.scrollBottom] = Array.from({ length: this.cols }, () => ' ');
        }
    }

    private deleteChars(count: number): void {
        const row = this.buffer[this.cursorY];
        for (let x = this.cursorX; x < this.cols; x++) {
            if (x + count < this.cols) {
                row[x] = row[x + count];
            } else {
                row[x] = ' ';
            }
        }
    }

    private scrollDown(): void {
        // Shift lines down, add empty at top
        for (let y = this.scrollBottom; y > this.scrollTop; y--) {
            this.buffer[y] = this.buffer[y - 1];
        }
        this.buffer[this.scrollTop] = Array.from({ length: this.cols }, () => ' ');
    }

    private reset(): void {
        this.buffer = this.createEmptyBuffer();
        this.cursorX = 0;
        this.cursorY = 0;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
    }

    /**
     * Get the current screen contents as a string
     * Trims trailing whitespace from each line and removes empty trailing lines
     */
    getScreen(): string {
        const lines: string[] = [];

        for (let y = 0; y < this.rows; y++) {
            const line = this.buffer[y].join('').trimEnd();
            lines.push(line);
        }

        // Remove trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        return lines.join('\n');
    }

    /**
     * Clear the screen buffer
     */
    clear(): void {
        this.reset();
    }

    /**
     * Resize the terminal
     */
    resize(cols: number, rows: number): void {
        const newBuffer = Array.from({ length: rows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => {
                if (y < this.rows && x < this.cols) {
                    return this.buffer[y][x];
                }
                return ' ';
            })
        );
        this.cols = cols;
        this.rows = rows;
        this.buffer = newBuffer;
        this.cursorX = Math.min(this.cursorX, cols - 1);
        this.cursorY = Math.min(this.cursorY, rows - 1);
        this.scrollBottom = rows - 1;
    }
}
