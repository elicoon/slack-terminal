/**
 * Output Capture - Buffers and batches terminal output
 *
 * VS Code's Terminal API doesn't provide direct output capture.
 * This module works with the onDidWriteTerminalData event (when available)
 * or a PTY-based approach to capture terminal output.
 *
 * Features:
 * - Batches output at configurable intervals (default 500ms)
 * - Tracks last truncated output for /more command
 * - Calls callback with batched output
 * - Strips ANSI escape codes for cleaner Slack display
 */

import * as vscode from 'vscode';

export interface OutputCaptureOptions {
    /** Batch interval in milliseconds (default: 500) */
    batchDelayMs?: number;
    /** Maximum characters before truncation (default: 2000) */
    truncateAt?: number;
}

export interface BatchedOutput {
    /** The output text (may be truncated) */
    text: string;
    /** Whether the output was truncated */
    truncated: boolean;
    /** The full output if it was truncated */
    fullText?: string;
    /** Thread ID this output belongs to */
    threadId?: string;
}

export type OutputCallback = (threadId: string, output: BatchedOutput) => void;

/**
 * Manages output capture for a single terminal session
 */
class TerminalOutputBuffer {
    private buffer: string = '';
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private lastTruncatedOutput: string | null = null;

    constructor(
        private threadId: string,
        private batchDelayMs: number,
        private truncateAt: number,
        private onBatch: (output: BatchedOutput) => void
    ) {}

    /**
     * Append data to the buffer and schedule batch
     */
    append(data: string): void {
        this.buffer += data;
        this.scheduleBatch();
    }

    /**
     * Force flush the buffer immediately
     */
    flush(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        if (this.buffer.length > 0) {
            this.emitBatch();
        }
    }

    /**
     * Get the last truncated output for /more command
     */
    getLastTruncatedOutput(): string | null {
        return this.lastTruncatedOutput;
    }

    /**
     * Clear the last truncated output
     */
    clearLastTruncatedOutput(): void {
        this.lastTruncatedOutput = null;
    }

    /**
     * Clear all state
     */
    clear(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.buffer = '';
        this.lastTruncatedOutput = null;
    }

    private scheduleBatch(): void {
        if (this.batchTimer) {
            return; // Already scheduled
        }

        this.batchTimer = setTimeout(() => {
            this.batchTimer = null;
            this.emitBatch();
        }, this.batchDelayMs);
    }

    private emitBatch(): void {
        if (this.buffer.length === 0) {
            return;
        }

        const fullText = this.buffer;
        this.buffer = '';

        // Clean ANSI escape codes for better readability in Slack
        const cleanedText = this.stripAnsiCodes(fullText);

        if (cleanedText.length <= this.truncateAt) {
            // Output fits within limit
            this.onBatch({
                text: cleanedText,
                truncated: false,
                threadId: this.threadId
            });
        } else {
            // Output exceeds limit - truncate and store full version
            this.lastTruncatedOutput = cleanedText;

            const truncatedText = cleanedText.slice(0, this.truncateAt);
            const remainingChars = cleanedText.length - this.truncateAt;

            this.onBatch({
                text: `${truncatedText}\n\n... (${remainingChars} more characters, use /more for full output)`,
                truncated: true,
                fullText: cleanedText,
                threadId: this.threadId
            });
        }
    }

    /**
     * Strip ANSI escape codes from text
     */
    private stripAnsiCodes(text: string): string {
        // ANSI escape code pattern
        const ansiPattern = /\x1b\[[0-9;]*[a-zA-Z]/g;
        // Other control sequences
        const controlPattern = /\x1b[PX^_].*?\x1b\\/g;
        const oscPattern = /\x1b\].*?(?:\x07|\x1b\\)/g;

        return text
            .replace(ansiPattern, '')
            .replace(controlPattern, '')
            .replace(oscPattern, '')
            .replace(/\r/g, ''); // Remove carriage returns
    }
}

/**
 * OutputCapture - Manages output capture for multiple terminal sessions
 *
 * Usage:
 * 1. Create instance with options
 * 2. Call onOutput() to register callback
 * 3. Call startCapture(terminal, threadId) for each terminal
 * 4. Call stopCapture(threadId) when done
 */
export class OutputCapture {
    private buffers: Map<string, TerminalOutputBuffer> = new Map();
    private batchDelayMs: number;
    private truncateAt: number;
    private callback: OutputCallback | null = null;
    private disposables: vscode.Disposable[] = [];
    private terminalMap: Map<vscode.Terminal, string> = new Map(); // terminal -> threadId

    constructor(options: OutputCaptureOptions = {}) {
        this.batchDelayMs = options.batchDelayMs ?? 500;
        this.truncateAt = options.truncateAt ?? 2000;
    }

    /**
     * Register a callback to receive batched output
     */
    onOutput(callback: OutputCallback): void {
        this.callback = callback;
    }

    /**
     * Start capturing output for a terminal
     *
     * @param terminal - The VS Code terminal to capture
     * @param threadId - The Slack thread ID
     */
    startCapture(terminal: vscode.Terminal, threadId: string): void {
        // Create buffer for this thread
        const buffer = new TerminalOutputBuffer(
            threadId,
            this.batchDelayMs,
            this.truncateAt,
            (output) => {
                if (this.callback) {
                    this.callback(threadId, output);
                }
            }
        );
        this.buffers.set(threadId, buffer);
        this.terminalMap.set(terminal, threadId);

        // Use the terminal data write event if available (VS Code 1.93+)
        // Note: This API may not be available in all VS Code versions
        if ('onDidWriteTerminalData' in vscode.window) {
            const writeHandler = (vscode.window as any).onDidWriteTerminalData(
                (event: { terminal: vscode.Terminal; data: string }) => {
                    const tid = this.terminalMap.get(event.terminal);
                    if (tid && tid === threadId) {
                        buffer.append(event.data);
                    }
                }
            );
            this.disposables.push(writeHandler);
        }
    }

    /**
     * Stop capturing output for a thread
     */
    stopCapture(threadId: string): void {
        const buffer = this.buffers.get(threadId);
        if (buffer) {
            buffer.flush();
            buffer.clear();
            this.buffers.delete(threadId);
        }

        // Remove from terminal map
        for (const [terminal, tid] of this.terminalMap) {
            if (tid === threadId) {
                this.terminalMap.delete(terminal);
                break;
            }
        }
    }

    /**
     * Manually append output to a thread's buffer
     * Use this when automatic capture isn't available
     */
    appendOutput(threadId: string, data: string): void {
        const buffer = this.buffers.get(threadId);
        if (buffer) {
            buffer.append(data);
        }
    }

    /**
     * Get the last truncated output for a thread (for /more command)
     */
    getLastTruncatedOutput(threadId: string): string | null {
        const buffer = this.buffers.get(threadId);
        return buffer?.getLastTruncatedOutput() ?? null;
    }

    /**
     * Clear the last truncated output for a thread
     */
    clearLastTruncatedOutput(threadId: string): void {
        const buffer = this.buffers.get(threadId);
        buffer?.clearLastTruncatedOutput();
    }

    /**
     * Force flush output buffer for a thread
     */
    flushBuffer(threadId: string): void {
        const buffer = this.buffers.get(threadId);
        buffer?.flush();
    }

    /**
     * Store output for a thread (legacy method for compatibility)
     */
    storeOutput(threadId: string, output: string): void {
        let buffer = this.buffers.get(threadId);
        if (!buffer) {
            buffer = new TerminalOutputBuffer(
                threadId,
                this.batchDelayMs,
                this.truncateAt,
                (out) => {
                    if (this.callback) {
                        this.callback(threadId, out);
                    }
                }
            );
            this.buffers.set(threadId, buffer);
        }
        // Store directly as last truncated output for /more retrieval
        buffer.append(output);
        buffer.flush();
    }

    /**
     * Get the last output for a thread (legacy method)
     */
    getLastOutput(threadId: string): string | null {
        return this.getLastTruncatedOutput(threadId);
    }

    /**
     * Clear stored output for a thread (legacy method)
     */
    clearOutput(threadId: string): void {
        const buffer = this.buffers.get(threadId);
        if (buffer) {
            buffer.clear();
            this.buffers.delete(threadId);
        }
    }

    /**
     * Clear all stored outputs
     */
    clearAll(): void {
        for (const buffer of this.buffers.values()) {
            buffer.clear();
        }
        this.buffers.clear();
        this.terminalMap.clear();
    }

    /**
     * Update configuration options
     */
    updateOptions(options: OutputCaptureOptions): void {
        if (options.batchDelayMs !== undefined) {
            this.batchDelayMs = options.batchDelayMs;
        }
        if (options.truncateAt !== undefined) {
            this.truncateAt = options.truncateAt;
        }
    }

    /**
     * Clean up all resources
     */
    dispose(): void {
        this.clearAll();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
