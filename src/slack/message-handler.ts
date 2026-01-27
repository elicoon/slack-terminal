/**
 * Message handler for Slack Terminal
 * Routes incoming Slack messages to terminals or handles slash commands
 */

import { SlackClient, SlackMessage } from './client';
import { isAuthorizedUser } from './auth';
import { TerminalManager } from '../terminal/manager';
import { OutputCapture } from '../terminal/output-capture';

/**
 * Configuration for the message handler
 */
export interface MessageHandlerConfig {
    /** The whitelisted Slack user ID */
    allowedUserId: string;
    /** The channel ID to listen in (optional - if not set, listens to all channels) */
    channelId?: string;
}

/**
 * Slash command names supported by the handler
 */
export type SlashCommand = 'list' | 'close' | 'closeall' | 'clear' | 'more' | 'kill' | 'status';

/**
 * Result of parsing a message for slash commands
 */
export interface ParsedMessage {
    /** Whether the message is a slash command */
    isCommand: boolean;
    /** The command name if isCommand is true */
    command?: SlashCommand;
    /** The remaining text after the command (arguments) */
    args?: string;
    /** The original text if not a command */
    text: string;
}

/**
 * Parse a message to detect slash commands
 * @param text - The message text to parse
 * @returns Parsed message result
 */
export function parseMessage(text: string): ParsedMessage {
    const trimmed = text.trim();

    if (!trimmed.startsWith('/')) {
        return { isCommand: false, text: trimmed };
    }

    // Extract command and args
    const spaceIndex = trimmed.indexOf(' ');
    const commandPart = spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : trimmed.substring(spaceIndex + 1).trim();

    // Remove the leading slash and lowercase
    const commandName = commandPart.substring(1).toLowerCase();

    // Check if it's a valid command
    const validCommands: SlashCommand[] = ['list', 'close', 'closeall', 'clear', 'more', 'kill', 'status'];
    if (validCommands.includes(commandName as SlashCommand)) {
        return {
            isCommand: true,
            command: commandName as SlashCommand,
            args: args || undefined,
            text: trimmed,
        };
    }

    // Not a recognized command - treat as regular text
    return { isCommand: false, text: trimmed };
}

/**
 * Message handler class that routes Slack messages to terminals
 */
export class MessageHandler {
    private slackClient: SlackClient;
    private terminalManager: TerminalManager;
    private config: MessageHandlerConfig;

    constructor(
        slackClient: SlackClient,
        terminalManager: TerminalManager,
        config: MessageHandlerConfig
    ) {
        this.slackClient = slackClient;
        this.terminalManager = terminalManager;
        this.config = config;
    }

    /**
     * Handle an incoming Slack message event
     * @param event - The Slack message event
     */
    async handleMessage(event: SlackMessage): Promise<void> {
        console.log(`[MessageHandler] handleMessage called - user: ${event.user}, channel: ${event.channel}, threadTs: ${event.threadTs}, text: "${event.text}"`);

        // Step 1: Check if user is authorized
        if (!isAuthorizedUser(event.user, this.config.allowedUserId)) {
            console.log(`[MessageHandler] Unauthorized user ${event.user} (allowed: ${this.config.allowedUserId})`);
            return;
        }
        console.log(`[MessageHandler] User authorized`);

        // Step 2: Check if we should listen to this channel
        if (this.config.channelId && event.channel !== this.config.channelId) {
            console.log(`[MessageHandler] Ignoring message from channel ${event.channel} (configured: ${this.config.channelId})`);
            return;
        }
        console.log(`[MessageHandler] Channel matched`);

        // Step 3: Determine if this is a thread message or new terminal request
        if (event.threadTs) {
            console.log(`[MessageHandler] Routing to handleThreadMessage (threadTs: ${event.threadTs})`);
            await this.handleThreadMessage(event);
        } else {
            console.log(`[MessageHandler] Routing to handleNewTerminalRequest (new thread)`);
            await this.handleNewTerminalRequest(event);
        }
    }

    /**
     * Handle a message in an existing thread
     */
    private async handleThreadMessage(event: SlackMessage): Promise<void> {
        const threadTs = event.threadTs!;
        const parsed = parseMessage(event.text);
        console.log(`[MessageHandler] handleThreadMessage - threadTs: ${threadTs}, isCommand: ${parsed.isCommand}, command: ${parsed.command}, text: "${parsed.text}"`);

        if (parsed.isCommand) {
            console.log(`[MessageHandler] Handling slash command: /${parsed.command}`);
            await this.handleCommand(parsed.command!, event.channel, threadTs);
        } else {
            console.log(`[MessageHandler] Sending text to terminal: "${parsed.text}"`);
            const sent = this.terminalManager.sendInput(threadTs, parsed.text);
            console.log(`[MessageHandler] sendInput result: ${sent}`);
            if (!sent) {
                console.log(`[MessageHandler] No terminal found for thread ${threadTs}`);
                await this.slackClient.sendMessage(
                    event.channel,
                    'No terminal session for this thread. Start a new terminal by sending a message outside a thread.',
                    threadTs
                );
            }
        }
    }

    /**
     * Handle a new terminal request (message not in a thread)
     */
    private async handleNewTerminalRequest(event: SlackMessage): Promise<void> {
        const parsed = parseMessage(event.text);
        console.log(`[MessageHandler] handleNewTerminalRequest - ts: ${event.ts}, isCommand: ${parsed.isCommand}, text: "${parsed.text}"`);

        // For non-thread messages, /status and /list work without a terminal
        if (parsed.isCommand) {
            console.log(`[MessageHandler] Handling top-level command: /${parsed.command}`);
            if (parsed.command === 'status') {
                await this.handleStatusCommand(event.channel, event.ts);
                return;
            }
            if (parsed.command === 'list') {
                await this.handleListCommand(event.channel, event.ts);
                return;
            }
            if (parsed.command === 'closeall') {
                await this.handleCloseAllCommand(event.channel, event.ts);
                return;
            }
            // Other commands need a thread context
            await this.slackClient.sendMessage(
                event.channel,
                `The /${parsed.command} command must be used in a thread with an active terminal.`,
                event.ts
            );
            return;
        }

        // Create a new terminal - the message ts becomes the thread ts
        console.log(`[MessageHandler] Creating new terminal for thread ${event.ts}`);
        const session = this.terminalManager.createTerminal(event.ts, event.channel);
        console.log(`[MessageHandler] Terminal created: ${session.terminal.name}`);

        // Reply in a thread to acknowledge
        console.log(`[MessageHandler] Sending "Terminal created" acknowledgment`);
        await this.slackClient.sendMessage(
            event.channel,
            'Terminal created. Send commands in this thread.',
            event.ts
        );

        // Send the initial command to the terminal using the manager's sendInput for proper \r handling
        console.log(`[MessageHandler] Sending initial command to terminal: "${parsed.text}"`);
        this.terminalManager.sendInput(event.ts, parsed.text);
        console.log(`[MessageHandler] Initial command sent`);
    }

    /**
     * Handle a slash command
     */
    private async handleCommand(
        command: SlashCommand,
        channel: string,
        threadTs: string
    ): Promise<void> {
        switch (command) {
            case 'list':
                await this.handleListCommand(channel, threadTs);
                break;
            case 'close':
                await this.handleCloseCommand(channel, threadTs);
                break;
            case 'closeall':
                await this.handleCloseAllCommand(channel, threadTs);
                break;
            case 'clear':
                await this.handleClearCommand(channel, threadTs);
                break;
            case 'more':
                await this.handleMoreCommand(channel, threadTs);
                break;
            case 'kill':
                await this.handleKillCommand(channel, threadTs);
                break;
            case 'status':
                await this.handleStatusCommand(channel, threadTs);
                break;
        }
    }

    /**
     * /list - Show all active terminal sessions
     */
    private async handleListCommand(channel: string, threadTs: string): Promise<void> {
        const sessions = this.terminalManager.getAllSessions();

        if (sessions.length === 0) {
            await this.slackClient.sendMessage(channel, 'No active terminal sessions.', threadTs);
            return;
        }

        const lines = sessions.map((session, index) => {
            const age = this.formatDuration(Date.now() - session.createdAt.getTime());
            return `${index + 1}. \`slack-${session.threadTs}\` (${age} old)`;
        });

        await this.slackClient.sendMessage(
            channel,
            `*Active terminals (${sessions.length}):*\n${lines.join('\n')}`,
            threadTs
        );
    }

    /**
     * /close - Close the terminal for this thread
     */
    private async handleCloseCommand(channel: string, threadTs: string): Promise<void> {
        const closed = this.terminalManager.closeTerminal(threadTs);

        if (closed) {
            await this.slackClient.sendMessage(channel, 'Terminal closed.', threadTs);
        } else {
            await this.slackClient.sendMessage(
                channel,
                'No terminal found for this thread.',
                threadTs
            );
        }
    }

    /**
     * /closeall - Close all terminals
     */
    private async handleCloseAllCommand(channel: string, threadTs: string): Promise<void> {
        const count = this.terminalManager.closeAllTerminals();

        if (count === 0) {
            await this.slackClient.sendMessage(channel, 'No terminals to close.', threadTs);
        } else {
            await this.slackClient.sendMessage(
                channel,
                `Closed ${count} terminal${count === 1 ? '' : 's'}.`,
                threadTs
            );
        }
    }

    /**
     * /clear - Clear terminal screen
     */
    private async handleClearCommand(channel: string, threadTs: string): Promise<void> {
        const cleared = this.terminalManager.clearTerminal(threadTs);

        if (cleared) {
            await this.slackClient.sendMessage(channel, 'Terminal cleared.', threadTs);
        } else {
            await this.slackClient.sendMessage(
                channel,
                'No terminal found for this thread.',
                threadTs
            );
        }
    }

    /**
     * /more - Get full output of last truncated response
     */
    private async handleMoreCommand(channel: string, threadTs: string): Promise<void> {
        const outputCapture = this.terminalManager.getOutputCapture();
        const lastOutput = outputCapture.getLastOutput(threadTs);

        if (!lastOutput) {
            await this.slackClient.sendMessage(
                channel,
                'No stored output for this thread.',
                threadTs
            );
            return;
        }

        // Upload the full output as a file
        await this.slackClient.uploadFile(
            channel,
            lastOutput,
            'full-output.md',
            threadTs
        );
    }

    /**
     * /kill - Send SIGINT (Ctrl+C) to current process
     */
    private async handleKillCommand(channel: string, threadTs: string): Promise<void> {
        const killed = this.terminalManager.sendSigint(threadTs);

        if (killed) {
            await this.slackClient.sendMessage(channel, 'Sent SIGINT (Ctrl+C).', threadTs);
        } else {
            await this.slackClient.sendMessage(
                channel,
                'No terminal found for this thread.',
                threadTs
            );
        }
    }

    /**
     * /status - Check connection status
     */
    private async handleStatusCommand(channel: string, threadTs: string): Promise<void> {
        const status = this.slackClient.status;
        const sessionCount = this.terminalManager.getAllSessions().length;

        const statusEmoji = status === 'connected' ? ':large_green_circle:' :
                           status === 'reconnecting' ? ':large_yellow_circle:' :
                           ':red_circle:';

        await this.slackClient.sendMessage(
            channel,
            `${statusEmoji} *Status:* ${status}\n*Active terminals:* ${sessionCount}`,
            threadTs
        );
    }

    /**
     * Format a duration in milliseconds to a human-readable string
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }
}
