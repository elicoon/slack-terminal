import * as vscode from 'vscode';
import { getConfig, hasRequiredTokens, validateConfig, SlackTerminalConfig } from './config';
import { SlackClient, SlackMessage, ConnectionStatus } from './slack/client';
import { isAuthorizedUser } from './slack/auth';

interface TerminalManager {
    getOrCreateTerminal(threadId: string): vscode.Terminal;
    getTerminal(threadId: string): vscode.Terminal | undefined;
    closeTerminal(threadId: string): boolean;
    closeAllTerminals(): void;
    listTerminals(): string[];
    sendInput(threadId: string, text: string): void;
    sendInterrupt(threadId: string): void;
    on(event: 'output', handler: (threadId: string, output: string) => void): void;
    on(event: 'exit', handler: (threadId: string, exitCode: number | undefined) => void): void;
    dispose(): void;
}

interface MessageHandler {
    handleMessage(message: SlackMessage): Promise<void>;
    dispose(): void;
}

// Connection state enum
enum ConnectionState {
    Disconnected = 'disconnected',
    Connecting = 'connecting',
    Connected = 'connected',
    Reconnecting = 'reconnecting',
}

// Global state
let slackClient: SlackClient | undefined;
let terminalManager: TerminalManager | undefined;
let messageHandler: MessageHandler | undefined;
let statusBarItem: vscode.StatusBarItem;
let connectionState: ConnectionState = ConnectionState.Disconnected;
let outputChannel: vscode.OutputChannel;

/**
 * Activates the Slack Terminal extension.
 */
export function activate(context: vscode.ExtensionContext): void {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Slack Terminal');
    context.subscriptions.push(outputChannel);

    log('Slack Terminal extension activating...');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.command = 'slackTerminal.connect';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Register connect command
    const connectCommand = vscode.commands.registerCommand(
        'slackTerminal.connect',
        handleConnect
    );
    context.subscriptions.push(connectCommand);

    // Register disconnect command
    const disconnectCommand = vscode.commands.registerCommand(
        'slackTerminal.disconnect',
        handleDisconnect
    );
    context.subscriptions.push(disconnectCommand);

    // Load config and auto-connect if configured
    const config = getConfig();
    if (config.autoConnect && hasRequiredTokens(config)) {
        log('Auto-connect enabled, attempting connection...');
        handleConnect();
    } else if (hasRequiredTokens(config)) {
        log('Tokens configured but auto-connect disabled. Use "Slack Terminal: Connect" to connect.');
    } else {
        log('No tokens configured. Set slackTerminal.appToken and slackTerminal.botToken in settings.');
    }

    log('Slack Terminal extension activated');
}

/**
 * Deactivates the extension and cleans up resources.
 */
export function deactivate(): void {
    log('Slack Terminal extension deactivating...');

    // Disconnect and cleanup
    cleanup();

    log('Slack Terminal extension deactivated');
}

/**
 * Handles the connect command.
 */
async function handleConnect(): Promise<void> {
    if (connectionState === ConnectionState.Connected) {
        vscode.window.showInformationMessage('Slack Terminal is already connected');
        return;
    }

    if (connectionState === ConnectionState.Connecting) {
        vscode.window.showInformationMessage('Slack Terminal is connecting...');
        return;
    }

    const config = getConfig();

    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
        const message = `Configuration errors:\n${errors.join('\n')}`;
        vscode.window.showErrorMessage(message);
        log(`Configuration validation failed: ${errors.join(', ')}`);

        // Offer to open settings
        const openSettings = await vscode.window.showErrorMessage(
            'Slack Terminal configuration is incomplete. Would you like to open settings?',
            'Open Settings'
        );
        if (openSettings) {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'slackTerminal'
            );
        }
        return;
    }

    try {
        setConnectionState(ConnectionState.Connecting);
        log('Connecting to Slack...');

        // Create and connect Slack client
        slackClient = await createSlackClient(config);

        // Create terminal manager
        terminalManager = await createTerminalManager(config);

        // Create message handler
        messageHandler = await createMessageHandler(config, slackClient, terminalManager);

        // Set up event listeners
        setupEventListeners(config);

        // Connect to Slack
        await slackClient.connect();

        setConnectionState(ConnectionState.Connected);
        log('Connected to Slack successfully');
        vscode.window.showInformationMessage('Slack Terminal connected');

    } catch (error) {
        setConnectionState(ConnectionState.Disconnected);
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Connection failed: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
        cleanup();
    }
}

/**
 * Handles the disconnect command.
 */
async function handleDisconnect(): Promise<void> {
    if (connectionState === ConnectionState.Disconnected) {
        vscode.window.showInformationMessage('Slack Terminal is not connected');
        return;
    }

    log('Disconnecting from Slack...');

    try {
        await cleanup();
        vscode.window.showInformationMessage('Slack Terminal disconnected');
        log('Disconnected from Slack');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Disconnect error: ${errorMessage}`);
        vscode.window.showErrorMessage(`Error during disconnect: ${errorMessage}`);
    }
}

/**
 * Cleans up all resources.
 */
async function cleanup(): Promise<void> {
    // Dispose message handler
    if (messageHandler) {
        try {
            messageHandler.dispose();
        } catch (e) {
            log(`Error disposing message handler: ${e}`);
        }
        messageHandler = undefined;
    }

    // Close all terminals
    if (terminalManager) {
        try {
            terminalManager.closeAllTerminals();
            terminalManager.dispose();
        } catch (e) {
            log(`Error closing terminals: ${e}`);
        }
        terminalManager = undefined;
    }

    // Disconnect Slack client
    if (slackClient) {
        try {
            await slackClient.disconnect();
        } catch (e) {
            log(`Error disconnecting Slack client: ${e}`);
        }
        slackClient = undefined;
    }

    setConnectionState(ConnectionState.Disconnected);
}

/**
 * Sets up event listeners for the Slack client.
 */
function setupEventListeners(config: SlackTerminalConfig): void {
    if (!slackClient || !terminalManager || !messageHandler) {
        return;
    }

    // Handle incoming Slack messages
    slackClient.on('message', async (message: SlackMessage) => {
        log(`Received message from ${message.user}: ${message.text?.substring(0, 50)}...`);

        // Security check: only allow configured user
        if (message.user !== config.allowedUserId) {
            log(`Ignoring message from unauthorized user: ${message.user}`);
            return;
        }

        // Only process messages in configured channel
        if (message.channel !== config.channelId) {
            log(`Ignoring message from other channel: ${message.channel}`);
            return;
        }

        try {
            await messageHandler!.handleMessage(message);
        } catch (error) {
            log(`Error handling message: ${error}`);
        }
    });

    // Handle connection events
    slackClient.on('connected', () => {
        setConnectionState(ConnectionState.Connected);
        log('Slack connection established');
    });

    slackClient.on('disconnected', () => {
        setConnectionState(ConnectionState.Disconnected);
        log('Slack connection lost');
    });

    slackClient.on('reconnecting', () => {
        setConnectionState(ConnectionState.Reconnecting);
        log('Reconnecting to Slack...');
    });

    slackClient.on('error', (error: Error) => {
        log(`Slack client error: ${error.message}`);
    });

    // Handle terminal output
    terminalManager.on('output', async (threadId: string, output: string) => {
        if (!slackClient) return;

        try {
            const threadTs = threadId; // threadId is the Slack thread timestamp

            if (output.length > config.truncateAt) {
                // Send as file attachment for long output
                await slackClient.uploadFile(
                    config.channelId,
                    output,
                    'output.md',
                    threadTs
                );
            } else {
                // Send as regular message
                await slackClient.sendMessage(
                    config.channelId,
                    '```\n' + output + '\n```',
                    threadTs
                );
            }
        } catch (error) {
            log(`Error sending output to Slack: ${error}`);
        }
    });

    // Handle terminal exit
    terminalManager.on('exit', async (threadId: string, exitCode: number | undefined) => {
        if (!slackClient) return;

        try {
            const message = exitCode !== undefined
                ? `Terminal exited with code ${exitCode}`
                : 'Terminal closed';

            await slackClient.sendMessage(
                config.channelId,
                message,
                threadId
            );
        } catch (error) {
            log(`Error sending exit notification: ${error}`);
        }
    });
}

/**
 * Updates the status bar based on connection state.
 */
function updateStatusBar(): void {
    switch (connectionState) {
        case ConnectionState.Connected:
            statusBarItem.text = '$(check) Slack Terminal: Connected';
            statusBarItem.backgroundColor = undefined;
            statusBarItem.tooltip = 'Click to disconnect';
            statusBarItem.command = 'slackTerminal.disconnect';
            break;
        case ConnectionState.Connecting:
            statusBarItem.text = '$(sync~spin) Slack Terminal: Connecting...';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.tooltip = 'Connecting to Slack...';
            statusBarItem.command = undefined;
            break;
        case ConnectionState.Reconnecting:
            statusBarItem.text = '$(sync~spin) Slack Terminal: Reconnecting';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.tooltip = 'Reconnecting to Slack...';
            statusBarItem.command = undefined;
            break;
        case ConnectionState.Disconnected:
        default:
            statusBarItem.text = '$(circle-slash) Slack Terminal: Disconnected';
            statusBarItem.backgroundColor = undefined;
            statusBarItem.tooltip = 'Click to connect';
            statusBarItem.command = 'slackTerminal.connect';
            break;
    }
}

/**
 * Sets the connection state and updates the status bar.
 */
function setConnectionState(state: ConnectionState): void {
    connectionState = state;
    updateStatusBar();
}

/**
 * Logs a message to the output channel.
 */
function log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

// Factory functions - these will be replaced with actual implementations
// once the other modules are created

async function createSlackClient(config: SlackTerminalConfig): Promise<SlackClient> {
    // TODO: Import and instantiate the actual SlackClient from ./slack/client
    // For now, throw an error indicating the module needs to be implemented

    // When implemented, this will look like:
    // const { SlackClient } = await import('./slack/client');
    // return new SlackClient(config.appToken, config.botToken);

    throw new Error(
        'SlackClient not yet implemented. ' +
        'Waiting for src/slack/client.ts to be created.'
    );
}

async function createTerminalManager(config: SlackTerminalConfig): Promise<TerminalManager> {
    // TODO: Import and instantiate the actual TerminalManager from ./terminal/manager
    // For now, throw an error indicating the module needs to be implemented

    // When implemented, this will look like:
    // const { TerminalManager } = await import('./terminal/manager');
    // return new TerminalManager(config);

    throw new Error(
        'TerminalManager not yet implemented. ' +
        'Waiting for src/terminal/manager.ts to be created.'
    );
}

async function createMessageHandler(
    config: SlackTerminalConfig,
    client: SlackClient,
    terminals: TerminalManager
): Promise<MessageHandler> {
    // TODO: Import and instantiate the actual MessageHandler from ./slack/message-handler
    // For now, throw an error indicating the module needs to be implemented

    // When implemented, this will look like:
    // const { MessageHandler } = await import('./slack/message-handler');
    // return new MessageHandler(config, client, terminals);

    throw new Error(
        'MessageHandler not yet implemented. ' +
        'Waiting for src/slack/message-handler.ts to be created.'
    );
}
