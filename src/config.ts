import * as vscode from 'vscode';

/**
 * Configuration interface for the Slack Terminal extension.
 */
export interface SlackTerminalConfig {
    /** Slack App Token for Socket Mode (xapp-...) */
    appToken: string;
    /** Slack Bot Token for posting messages (xoxb-...) */
    botToken: string;
    /** Slack User ID allowed to send commands */
    allowedUserId: string;
    /** Slack Channel ID to listen in */
    channelId: string;
    /** Character limit before sending output as file attachment */
    truncateAt: number;
    /** Output batching interval in milliseconds */
    batchDelayMs: number;
    /** Automatically connect on VS Code startup */
    autoConnect: boolean;
}

/**
 * Loads the Slack Terminal configuration from VS Code settings.
 * @returns The current configuration
 */
export function getConfig(): SlackTerminalConfig {
    const config = vscode.workspace.getConfiguration('slackTerminal');

    return {
        appToken: config.get<string>('appToken', ''),
        botToken: config.get<string>('botToken', ''),
        allowedUserId: config.get<string>('allowedUserId', ''),
        channelId: config.get<string>('channelId', ''),
        truncateAt: config.get<number>('truncateAt', 2000),
        batchDelayMs: config.get<number>('batchDelayMs', 500),
        autoConnect: config.get<boolean>('autoConnect', false),
    };
}

/**
 * Checks if the required tokens are configured.
 * @param config The configuration to check
 * @returns true if both appToken and botToken are set
 */
export function hasRequiredTokens(config: SlackTerminalConfig): boolean {
    return config.appToken.length > 0 && config.botToken.length > 0;
}

/**
 * Validates the configuration and returns any errors.
 * @param config The configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateConfig(config: SlackTerminalConfig): string[] {
    const errors: string[] = [];

    if (!config.appToken) {
        errors.push('App Token (xapp-...) is required');
    } else if (!config.appToken.startsWith('xapp-')) {
        errors.push('App Token should start with "xapp-"');
    }

    if (!config.botToken) {
        errors.push('Bot Token (xoxb-...) is required');
    } else if (!config.botToken.startsWith('xoxb-')) {
        errors.push('Bot Token should start with "xoxb-"');
    }

    if (!config.allowedUserId) {
        errors.push('Allowed User ID is required for security');
    } else if (!config.allowedUserId.startsWith('U')) {
        errors.push('User ID should start with "U"');
    }

    if (!config.channelId) {
        errors.push('Channel ID is required');
    } else if (!config.channelId.startsWith('C') && !config.channelId.startsWith('G')) {
        errors.push('Channel ID should start with "C" (public) or "G" (private)');
    }

    if (config.truncateAt < 100) {
        errors.push('Truncate limit should be at least 100 characters');
    }

    if (config.batchDelayMs < 100) {
        errors.push('Batch delay should be at least 100ms');
    }

    return errors;
}
