/**
 * Slack Socket Mode Client
 * Handles WebSocket connection to Slack and message relay
 */

import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { EventEmitter } from 'events';

/**
 * Connection status for the Slack client
 */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/**
 * Incoming message event from Slack
 */
export interface SlackMessage {
    /** The text content of the message */
    text: string;
    /** The channel ID where the message was posted */
    channel: string;
    /** The user ID who sent the message */
    user: string;
    /** The thread timestamp (if message is in a thread) */
    threadTs?: string;
    /** The message timestamp (used as thread parent if starting new thread) */
    ts: string;
    /** The channel type (channel, im, mpim, etc.) */
    channelType?: string;
}

/**
 * Events emitted by SlackClient
 */
export interface SlackClientEvents {
    message: (message: SlackMessage) => void;
    statusChange: (status: ConnectionStatus) => void;
    error: (error: Error) => void;
}

/**
 * Slack Socket Mode client with WebSocket connection management
 * Uses EventEmitter pattern for incoming messages
 */
export class SlackClient extends EventEmitter {
    private socketClient: SocketModeClient;
    private webClient: WebClient;
    private _status: ConnectionStatus = 'disconnected';

    /**
     * Creates a new SlackClient instance
     * @param appToken - Socket Mode app token (xapp-...)
     * @param botToken - Bot OAuth token (xoxb-...)
     */
    constructor(appToken: string, botToken: string) {
        super();

        // Socket Mode client for receiving events
        this.socketClient = new SocketModeClient({
            appToken,
            // Auto-reconnect is built into @slack/socket-mode
        });

        // Web API client for sending messages and uploading files
        this.webClient = new WebClient(botToken);

        this.setupEventHandlers();
    }

    /**
     * Current connection status
     */
    get status(): ConnectionStatus {
        return this._status;
    }

    /**
     * Set up event handlers for the Socket Mode client
     */
    private setupEventHandlers(): void {
        // Connection events
        this.socketClient.on('connected', () => {
            this.updateStatus('connected');
        });

        this.socketClient.on('connecting', () => {
            if (this._status !== 'disconnected') {
                this.updateStatus('reconnecting');
            }
        });

        this.socketClient.on('disconnected', () => {
            this.updateStatus('disconnected');
        });

        this.socketClient.on('reconnecting', () => {
            this.updateStatus('reconnecting');
        });

        // Handle incoming message events
        this.socketClient.on('message', async ({ event, ack }) => {
            // Acknowledge the event first
            await ack();

            // Ignore bot messages and message subtypes (edits, deletes, etc.)
            if (event.bot_id || event.subtype) {
                return;
            }

            // Extract message data
            const message: SlackMessage = {
                text: event.text || '',
                channel: event.channel,
                user: event.user,
                threadTs: event.thread_ts,
                ts: event.ts,
                channelType: event.channel_type,
            };

            this.emit('message', message);
        });

        // Handle errors
        this.socketClient.on('error', (error) => {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        });
    }

    /**
     * Update connection status and emit event
     */
    private updateStatus(status: ConnectionStatus): void {
        if (this._status !== status) {
            this._status = status;
            this.emit('statusChange', status);
        }
    }

    /**
     * Connect to Slack via Socket Mode
     * Auto-reconnect with exponential backoff is handled by @slack/socket-mode
     */
    async connect(): Promise<void> {
        try {
            await this.socketClient.start();
        } catch (error) {
            this.updateStatus('disconnected');
            throw error;
        }
    }

    /**
     * Disconnect from Slack
     */
    async disconnect(): Promise<void> {
        await this.socketClient.disconnect();
        this.updateStatus('disconnected');
    }

    /**
     * Send a message to a Slack channel
     * @param channel - Channel ID to send to
     * @param text - Message text
     * @param threadTs - Optional thread timestamp to reply in thread
     */
    async sendMessage(channel: string, text: string, threadTs?: string): Promise<void> {
        await this.webClient.chat.postMessage({
            channel,
            text,
            thread_ts: threadTs,
            // Unfurl links disabled to keep messages clean
            unfurl_links: false,
            unfurl_media: false,
        });
    }

    /**
     * Upload a file to a Slack channel
     * Used for long outputs that would be too long for a message
     * @param channel - Channel ID to upload to
     * @param content - File content as string
     * @param filename - Name for the file
     * @param threadTs - Optional thread timestamp to share in thread
     */
    async uploadFile(
        channel: string,
        content: string,
        filename: string,
        threadTs?: string
    ): Promise<void> {
        await this.webClient.files.uploadV2({
            channel_id: channel,
            content,
            filename,
            thread_ts: threadTs,
        });
    }

    /**
     * Add a reaction to a message (useful for acknowledging commands)
     * @param channel - Channel ID
     * @param timestamp - Message timestamp
     * @param emoji - Emoji name without colons
     */
    async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
        try {
            await this.webClient.reactions.add({
                channel,
                timestamp,
                name: emoji,
            });
        } catch {
            // Ignore reaction errors (e.g., already reacted)
        }
    }

    // Event emitter type overrides for better TypeScript support
    on<K extends keyof SlackClientEvents>(event: K, listener: SlackClientEvents[K]): this {
        return super.on(event, listener);
    }

    emit<K extends keyof SlackClientEvents>(event: K, ...args: Parameters<SlackClientEvents[K]>): boolean {
        return super.emit(event, ...args);
    }

    off<K extends keyof SlackClientEvents>(event: K, listener: SlackClientEvents[K]): this {
        return super.off(event, listener);
    }
}
