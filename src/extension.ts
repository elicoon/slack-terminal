import * as vscode from 'vscode';
import { getConfig, hasRequiredTokens, validateConfig, SlackTerminalConfig } from './config';
import { SlackClient, SlackMessage, ConnectionStatus } from './slack/client';
import { isAuthorizedUser } from './slack/auth';
import { TerminalManager } from './terminal/manager';
import { OutputCapture } from './terminal/output-capture';
import { MessageHandler } from './slack/message-handler';

// Connection state enum
enum ConnectionState {
    Disconnected = 'disconnected',
    Connecting = 'connecting',
    Connected = 'connected',
    Reconnecting = 'reconnecting',
}

// Global state
let slackClient: SlackClient | null = null;
let terminalManager: TerminalManager | undefined;
let outputCapture: OutputCapture | undefined;
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

        // Create Slack client
        slackClient = new SlackClient(config.appToken, config.botToken);

        // Create terminal manager
        terminalManager = createTerminalManager(config);

        // Create message handler
        messageHandler = createMessageHandler(config, slackClient, terminalManager);

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
    // Clear message handler reference
    messageHandler = undefined;

    // Close all terminals
    if (terminalManager) {
        try {
            terminalManager.closeAllTerminals();
        } catch (e) {
            log(`Error closing terminals: ${e}`);
        }
        terminalManager = undefined;
    }

    // Dispose output capture
    if (outputCapture) {
        try {
            outputCapture.dispose();
        } catch (e) {
            log(`Error disposing output capture: ${e}`);
        }
        outputCapture = undefined;
    }

    // Disconnect Slack client
    if (slackClient) {
        try {
            await slackClient.disconnect();
        } catch (e) {
            log(`Error disconnecting Slack client: ${e}`);
        }
        slackClient = null;
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
        if (!isAuthorizedUser(message.user, config.allowedUserId)) {
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

    // Handle connection status changes
    slackClient.on('statusChange', (status: ConnectionStatus) => {
        switch (status) {
            case 'connected':
                setConnectionState(ConnectionState.Connected);
                log('Slack connection established');
                break;
            case 'disconnected':
                setConnectionState(ConnectionState.Disconnected);
                log('Slack connection lost');
                break;
            case 'reconnecting':
                setConnectionState(ConnectionState.Reconnecting);
                log('Reconnecting to Slack...');
                break;
        }
    });

    slackClient.on('error', (error: Error) => {
        log(`Slack client error: ${error.message}`);
    });

    // Handle terminal output via OutputCapture callback
    console.log(`[Extension] Setting up outputCapture callback, outputCapture exists: ${!!outputCapture}`);
    if (outputCapture) {
        outputCapture.onOutput(async (threadId, batchedOutput) => {
            console.log(`[Extension] outputCapture.onOutput FIRED - threadId: ${threadId}, text length: ${batchedOutput.text.length}, truncated: ${batchedOutput.truncated}`);
            console.log(`[Extension] Output preview: ${batchedOutput.text.substring(0, 200).replace(/\n/g, '\\n')}...`);

            if (!slackClient) {
                console.log(`[Extension] No slackClient, cannot send output`);
                return;
            }

            try {
                if (batchedOutput.truncated && batchedOutput.fullText) {
                    console.log(`[Extension] Sending truncated output as file attachment`);
                    await slackClient.uploadFile(
                        config.channelId,
                        batchedOutput.fullText,
                        'output.md',
                        threadId
                    );
                } else {
                    console.log(`[Extension] Sending output as regular message`);
                    await slackClient.sendMessage(
                        config.channelId,
                        '```\n' + batchedOutput.text + '\n```',
                        threadId
                    );
                }
                console.log(`[Extension] Output sent to Slack successfully`);
            } catch (error) {
                console.error(`[Extension] Error sending output to Slack:`, error);
                log(`Error sending output to Slack: ${error}`);
            }
        });
        console.log(`[Extension] outputCapture.onOutput callback registered`);
    } else {
        console.warn(`[Extension] WARNING: outputCapture is null/undefined, output capture will not work!`);
    }

    // Handle terminal close events via VS Code API
    const terminalCloseListener = vscode.window.onDidCloseTerminal(async (terminal) => {
        if (!terminalManager || !slackClient) return;

        // Find the thread ID for this terminal
        const sessions = terminalManager.getAllSessions();
        const session = sessions.find(s => s.terminal === terminal);

        if (session) {
            try {
                await slackClient.sendMessage(
                    config.channelId,
                    'Terminal closed',
                    session.threadTs
                );
            } catch (error) {
                log(`Error sending exit notification: ${error}`);
            }

            // Clean up the session
            terminalManager.onTerminalClosed(terminal);
        }
    });

    // Store listener for cleanup (would need to add to a disposables array)
    // For now, this listener will persist until extension deactivates
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

// Factory functions

function createOutputCapture(config: SlackTerminalConfig): OutputCapture {
    outputCapture = new OutputCapture({
        batchDelayMs: config.batchDelayMs,
        truncateAt: config.truncateAt,
    });
    return outputCapture;
}

function createTerminalManager(config: SlackTerminalConfig): TerminalManager {
    const capture = createOutputCapture(config);
    return new TerminalManager({
        outputCapture: capture,
    });
}

function createMessageHandler(
    config: SlackTerminalConfig,
    client: SlackClient,
    terminals: TerminalManager
): MessageHandler {
    return new MessageHandler(client, terminals, {
        allowedUserId: config.allowedUserId,
        channelId: config.channelId,
    });
}
