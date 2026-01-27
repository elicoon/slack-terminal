import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('elicoon.slack-terminal'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('elicoon.slack-terminal');
        if (ext) {
            await ext.activate();
            assert.ok(ext.isActive);
        }
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('slackTerminal.connect'));
        assert.ok(commands.includes('slackTerminal.disconnect'));
    });
});
