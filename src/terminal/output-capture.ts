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
 * - Uses virtual terminal renderer to show what's actually visible
 *   (handles cursor movements, line clearing, etc. for TUI apps like Claude Code)
 */

import * as vscode from 'vscode';
import { TerminalRenderer } from './terminal-renderer';

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
    private lastSentScreen: string = '';  // Track last sent content to avoid duplicates
    private renderer: TerminalRenderer;

    constructor(
        private threadId: string,
        private batchDelayMs: number,
        private truncateAt: number,
        private onBatch: (output: BatchedOutput) => void
    ) {
        // Create a virtual terminal renderer to process escape sequences
        // and show what's actually visible (not raw output with all overwrites)
        this.renderer = new TerminalRenderer({ cols: 120, rows: 50 });
    }

    /**
     * Append data to the buffer and schedule batch
     */
    append(data: string): void {
        console.log(`[TerminalOutputBuffer] append called for thread ${this.threadId} - data length: ${data.length}, current buffer length: ${this.buffer.length}`);
        this.buffer += data;
        // Also write to the renderer to process escape sequences
        this.renderer.write(data);
        console.log(`[TerminalOutputBuffer] Buffer now has ${this.buffer.length} chars, scheduling batch`);
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
        this.lastSentScreen = '';
        this.renderer.clear();
    }

    private scheduleBatch(): void {
        if (this.batchTimer) {
            console.log(`[TerminalOutputBuffer] Batch already scheduled for thread ${this.threadId}`);
            return; // Already scheduled
        }

        console.log(`[TerminalOutputBuffer] Scheduling batch for thread ${this.threadId} in ${this.batchDelayMs}ms`);
        this.batchTimer = setTimeout(() => {
            console.log(`[TerminalOutputBuffer] Batch timer fired for thread ${this.threadId}`);
            this.batchTimer = null;
            this.emitBatch();
        }, this.batchDelayMs);
    }

    private emitBatch(): void {
        console.log(`[TerminalOutputBuffer] emitBatch called for thread ${this.threadId}, buffer length: ${this.buffer.length}`);

        if (this.buffer.length === 0) {
            console.log(`[TerminalOutputBuffer] Buffer empty, nothing to emit`);
            return;
        }

        // Clear the raw buffer (we've already written to the renderer)
        this.buffer = '';

        // Get what's actually visible on the virtual terminal screen
        // This properly handles cursor movements, line clearing, screen updates, etc.
        // so TUI apps like Claude Code show the collapsed view with "Ctrl+O to open"
        // instead of exposing all the hidden expanded content
        const renderedText = this.renderer.getScreen();
        console.log(`[TerminalOutputBuffer] Rendered screen text length: ${renderedText.length}`);

        if (renderedText.length === 0) {
            console.log(`[TerminalOutputBuffer] Rendered text empty, nothing to emit`);
            return;
        }

        // Skip if the screen content hasn't changed since last send
        // This prevents duplicate messages when TUI apps do redraws without visible changes
        if (renderedText === this.lastSentScreen) {
            console.log(`[TerminalOutputBuffer] Screen unchanged, skipping duplicate message`);
            return;
        }
        this.lastSentScreen = renderedText;

        if (renderedText.length <= this.truncateAt) {
            console.log(`[TerminalOutputBuffer] Output fits within limit (${this.truncateAt}), calling onBatch`);
            this.onBatch({
                text: renderedText,
                truncated: false,
                threadId: this.threadId
            });
        } else {
            console.log(`[TerminalOutputBuffer] Output exceeds limit, truncating and calling onBatch`);
            this.lastTruncatedOutput = renderedText;

            const truncatedText = renderedText.slice(0, this.truncateAt);
            const remainingChars = renderedText.length - this.truncateAt;

            this.onBatch({
                text: `${truncatedText}\n\n... (${remainingChars} more characters, use /more for full output)`,
                truncated: true,
                fullText: renderedText,
                threadId: this.threadId
            });
        }
        console.log(`[TerminalOutputBuffer] onBatch callback completed`);
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
        console.log(`[OutputCapture] onOutput callback registered`);
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
                console.log(`[OutputCapture] Emitting output for thread ${threadId}: ${output.text.substring(0, 100)}...`);
                if (this.callback) {
                    this.callback(threadId, output);
                }
            }
        );
        this.buffers.set(threadId, buffer);
        this.terminalMap.set(terminal, threadId);

        // Use the terminal data write event if available (VS Code 1.93+)
        // Note: This API may not be available in all VS Code versions
        const hasTerminalDataApi = 'onDidWriteTerminalData' in vscode.window;
        const apiType = typeof (vscode.window as any).onDidWriteTerminalData;
        console.log(`[OutputCapture] Starting capture for thread ${threadId}, onDidWriteTerminalData available: ${hasTerminalDataApi}, type: ${apiType}`);

        if (hasTerminalDataApi && apiType === 'function') {
            try {
                console.log(`[OutputCapture] Attempting to register onDidWriteTerminalData handler...`);
                const writeHandler = (vscode.window as any).onDidWriteTerminalData(
                    (event: { terminal: vscode.Terminal; data: string }) => {
                        // Log ALL terminal data events to debug
                        console.log(`[OutputCapture] RAW terminal data event - terminal name: ${event.terminal.name}, data length: ${event.data.length}`);

                        const tid = this.terminalMap.get(event.terminal);
                        console.log(`[OutputCapture] Terminal map lookup - found tid: ${tid}, expected threadId: ${threadId}`);

                        if (tid && tid === threadId) {
                            console.log(`[OutputCapture] MATCH! Appending data for thread ${threadId}: ${event.data.substring(0, 50).replace(/\n/g, '\\n')}...`);
                            buffer.append(event.data);
                        } else {
                            console.log(`[OutputCapture] No match - tid=${tid}, threadId=${threadId}, terminalMap size=${this.terminalMap.size}`);
                        }
                    }
                );
                this.disposables.push(writeHandler);
                console.log(`[OutputCapture] Registered writeHandler SUCCESS, terminalMap now has ${this.terminalMap.size} entries`);
            } catch (error) {
                console.error(`[OutputCapture] ERROR registering onDidWriteTerminalData handler:`, error);
            }
        } else {
            console.warn(`[OutputCapture] onDidWriteTerminalData API not available or not callable (hasApi: ${hasTerminalDataApi}, type: ${apiType})`);
        }

        console.log(`[OutputCapture] startCapture completed for thread ${threadId}`);
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
