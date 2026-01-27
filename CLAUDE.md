# slack-terminal - CLAUDE.md

## Overview

VS Code extension that relays terminal commands between Slack and VS Code's integrated terminal. Enables full terminal control from your phone via Slack, including Claude Code sessions.

**Key principle:** No difference between sending a message on Slack and typing in VS Code's terminal.

## Project Structure

```
slack-terminal/
├── src/
│   ├── extension.ts          # Entry point, activation, event wiring
│   ├── config.ts             # Settings management & validation
│   ├── slack/
│   │   ├── client.ts         # Socket Mode connection, send/upload
│   │   ├── auth.ts           # User ID whitelist check
│   │   ├── message-handler.ts# Route messages, handle slash commands
│   │   └── index.ts          # Exports
│   └── terminal/
│       ├── manager.ts        # Create/track/destroy terminals
│       ├── output-capture.ts # Buffer & batch terminal output
│       ├── prompt-detector.ts# Detect [y/n], password prompts
│       └── terminal-renderer.ts # ANSI rendering utilities
├── out/                      # Compiled JS (gitignored)
├── test-workspace/           # Test workspace with settings for F5
├── .vscode/
│   ├── launch.json           # F5 debug configuration
│   ├── tasks.json            # Build tasks
│   └── settings.json         # Dev settings (has tokens - gitignored)
├── docs/
│   ├── design.md             # Original design document
│   └── SETUP.md              # Slack app setup instructions
├── package.json              # Extension manifest & config schema
└── tsconfig.json
```

## Architecture

```
Slack (Phone)
    ↓ WebSocket (Socket Mode)
SlackClient (client.ts)
    ↓ message events
MessageHandler (message-handler.ts)
    ↓ routes to
TerminalManager (manager.ts) → VS Code Terminals
    ↓ output via
OutputCapture (output-capture.ts)
    ↓ batched output
SlackClient.sendMessage() / uploadFile()
    ↓
Slack (Phone)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point. Creates SlackClient, TerminalManager, MessageHandler. Wires events. |
| `src/slack/client.ts` | Socket Mode connection. Emits 'message', 'statusChange', 'error' events. |
| `src/slack/message-handler.ts` | Parses messages, handles /commands, routes text to terminals. |
| `src/terminal/manager.ts` | Maps thread IDs to VS Code terminals. sendInput(), closeTerminal(), etc. |
| `src/terminal/output-capture.ts` | Batches output every 500ms, truncates at 2000 chars, stores for /more. |
| `src/terminal/terminal-renderer.ts` | ANSI escape sequence processing for clean Slack output. |

## Message Flow

1. **New message (not in thread)** → Creates terminal, starts thread, sends command
2. **Message in thread** → Routes to existing terminal OR handles slash command
3. **Terminal output** → Batched, sent to thread (or as file if >2000 chars)

## Slash Commands

| Command | Handler Location |
|---------|------------------|
| `/list` | message-handler.ts:handleListCommand |
| `/close` | message-handler.ts:handleCloseCommand |
| `/closeall` | message-handler.ts:handleCloseAllCommand |
| `/clear` | message-handler.ts:handleClearCommand |
| `/more` | message-handler.ts:handleMoreCommand |
| `/kill` | message-handler.ts:handleKillCommand |
| `/status` | message-handler.ts:handleStatusCommand |

## Development

```bash
npm run compile    # Build TypeScript
npm run watch      # Watch mode
npm test           # Run tests
F5 in VS Code      # Launch Extension Development Host
```

**Windows note:** Use PowerShell or Git Bash. `find` command differs from Unix.

## Configuration (package.json contributes.configuration)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| slackTerminal.appToken | string | "" | Socket Mode token (xapp-...) |
| slackTerminal.botToken | string | "" | Bot OAuth token (xoxb-...) |
| slackTerminal.allowedUserId | string | "" | Whitelisted Slack user ID |
| slackTerminal.channelId | string | "" | Channel to listen in |
| slackTerminal.truncateAt | number | 2000 | Chars before file attachment |
| slackTerminal.batchDelayMs | number | 500 | Output batching interval |
| slackTerminal.autoConnect | boolean | false | Connect on startup |

## Event Wiring (extension.ts:setupEventListeners)

- `slackClient.on('message')` → auth check → messageHandler.handleMessage()
- `slackClient.on('statusChange')` → updates status bar
- `outputCapture.onOutput()` → sends to Slack (message or file)
- `vscode.window.onDidCloseTerminal` → notifies Slack thread

## Common Issues

1. **"Configuration errors"** - Settings not in Extension Dev Host. Use test-workspace/.vscode/settings.json
2. **No messages received** - Check Event Subscriptions in Slack app (message.channels)
3. **Bot doesn't respond** - Verify bot is invited to channel (`/invite @botname`)
4. **Output not appearing** - Check OutputCapture callback wiring in extension.ts

## Testing

1. F5 to launch Extension Development Host (opens test-workspace)
2. Extension auto-connects if autoConnect: true
3. Send message in Slack channel
4. Check Output panel → "Slack Terminal" for logs
