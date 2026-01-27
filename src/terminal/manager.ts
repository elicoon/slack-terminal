/**
 * Terminal manager interface and types
 * Manages VS Code terminals mapped to Slack threads
 */

import * as vscode from 'vscode';
import { OutputCapture } from './output-capture';

export interface TerminalSession {
    terminal: vscode.Terminal;
    threadTs: string;
    channel: string;
    createdAt: Date;
}

export interface TerminalManagerConfig {
    outputCapture: OutputCapture;
}

export class TerminalManager {
    private terminals: Map<string, TerminalSession> = new Map();
    private outputCapture: OutputCapture;

    constructor(config: TerminalManagerConfig) {
        this.outputCapture = config.outputCapture;
    }

    /**
     * Create a new terminal for a Slack thread
     * @param threadTs - The thread timestamp ID
     * @param channel - The Slack channel ID
     * @returns The created terminal session
     */
    createTerminal(threadTs: string, channel: string): TerminalSession {
        const terminal = vscode.window.createTerminal({
            name: `slack-${threadTs}`,
        });

        const session: TerminalSession = {
            terminal,
            threadTs,
            channel,
            createdAt: new Date(),
        };

        this.terminals.set(threadTs, session);
        terminal.show();

        return session;
    }

    /**
     * Get a terminal session by thread ID
     * @param threadTs - The thread timestamp ID
     * @returns The terminal session or undefined
     */
    getTerminal(threadTs: string): TerminalSession | undefined {
        return this.terminals.get(threadTs);
    }

    /**
     * Check if a terminal exists for a thread
     * @param threadTs - The thread timestamp ID
     * @returns true if terminal exists
     */
    hasTerminal(threadTs: string): boolean {
        return this.terminals.has(threadTs);
    }

    /**
     * Send input to a terminal
     * @param threadTs - The thread timestamp ID
     * @param text - The text to send
     * @returns true if sent, false if terminal not found
     */
    sendInput(threadTs: string, text: string): boolean {
        const session = this.terminals.get(threadTs);
        if (!session) {
            return false;
        }
        session.terminal.sendText(text);
        return true;
    }

    /**
     * Close a terminal by thread ID
     * @param threadTs - The thread timestamp ID
     * @returns true if closed, false if not found
     */
    closeTerminal(threadTs: string): boolean {
        const session = this.terminals.get(threadTs);
        if (!session) {
            return false;
        }
        session.terminal.dispose();
        this.terminals.delete(threadTs);
        this.outputCapture.clearOutput(threadTs);
        return true;
    }

    /**
     * Close all terminals
     * @returns Number of terminals closed
     */
    closeAllTerminals(): number {
        const count = this.terminals.size;
        for (const [threadTs, session] of this.terminals) {
            session.terminal.dispose();
            this.outputCapture.clearOutput(threadTs);
        }
        this.terminals.clear();
        return count;
    }

    /**
     * Send SIGINT (Ctrl+C) to a terminal
     * @param threadTs - The thread timestamp ID
     * @returns true if sent, false if not found
     */
    sendSigint(threadTs: string): boolean {
        const session = this.terminals.get(threadTs);
        if (!session) {
            return false;
        }
        // Send Ctrl+C character
        session.terminal.sendText('\x03', false);
        return true;
    }

    /**
     * Clear a terminal screen
     * @param threadTs - The thread timestamp ID
     * @returns true if cleared, false if not found
     */
    clearTerminal(threadTs: string): boolean {
        const session = this.terminals.get(threadTs);
        if (!session) {
            return false;
        }
        // Send Ctrl+L to clear screen
        session.terminal.sendText('\x0c', false);
        return true;
    }

    /**
     * Get all active terminal sessions
     * @returns Array of active sessions
     */
    getAllSessions(): TerminalSession[] {
        return Array.from(this.terminals.values());
    }

    /**
     * Get the output capture instance
     */
    getOutputCapture(): OutputCapture {
        return this.outputCapture;
    }

    /**
     * Handle terminal close event
     * @param terminal - The terminal that was closed
     */
    onTerminalClosed(terminal: vscode.Terminal): void {
        for (const [threadTs, session] of this.terminals) {
            if (session.terminal === terminal) {
                this.terminals.delete(threadTs);
                this.outputCapture.clearOutput(threadTs);
                break;
            }
        }
    }
}
