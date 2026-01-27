# Slack Terminal

A VS Code extension that relays terminal commands between Slack and VS Code's integrated terminal. Control your development machine from your phone via Slack.

## Features

- **Full terminal control from Slack** - Send any command, receive output
- **Thread-based sessions** - Each Slack thread gets its own terminal
- **Smart output handling** - Long outputs sent as file attachments
- **Interactive prompt detection** - Handles `[y/n]` prompts, password inputs
- **Claude Code compatible** - Run Claude Code sessions from your phone
- **ANSI rendering** - Terminal output cleaned for readable Slack messages

## Quick Start

1. Install the extension
2. Create a Slack App with Socket Mode enabled (see [detailed setup guide](docs/SETUP.md))
3. Configure your tokens in VS Code settings
4. Send a message in your configured channel

## Example Usage

Here's a typical workflow using Slack Terminal from your phone:

**1. Start a terminal session**
```
You (in #dev-terminal channel): git status
```
The bot creates a new terminal and replies in a thread with the output:
```
Bot: On branch main
     Your branch is up to date with 'origin/main'.
     nothing to commit, working tree clean
```

**2. Continue in the thread**

All replies in the thread go to the same terminal:
```
You (in thread): npm run build
Bot: > myapp@1.0.0 build
     > tsc && vite build
     ✓ built in 1.24s
```

**3. Handle long output**

If output exceeds 2000 characters, it's sent as a file attachment. Use `/more` to get the full untruncated output:
```
You: cat package.json
Bot: [output truncated, 847 chars hidden]
     {...partial output...}

You: /more
Bot: 📎 full-output.txt
```

**4. Run interactive commands**
```
You: claude
Bot: > claude
     ╭─────────────────────────────────────╮
     │ Welcome to Claude Code!             │
     ╰─────────────────────────────────────╯
     > What would you like to do?

You: help me refactor the auth module
Bot: I'll help you refactor...
```

**5. Control the session**
```
You: /kill          # Send Ctrl+C to stop current process
You: /clear         # Clear the terminal screen
You: /close         # Close this terminal session
```

**6. Manage multiple sessions**

Start a new terminal by sending a message outside any thread:
```
You (in channel): docker logs -f myapp    # Creates new terminal + thread
You (in channel): top                      # Creates another terminal + thread
You: /list                                 # Shows all active sessions
```

## Slack Commands

| Command | Action |
|---------|--------|
| `/list` | Show all active terminal sessions |
| `/close` | Close the terminal for this thread |
| `/closeall` | Close all terminals |
| `/clear` | Clear terminal screen |
| `/more` | Get full output of last truncated response |
| `/kill` | Send SIGINT (Ctrl+C) to current process |
| `/status` | Check if extension is connected |

Messages without `/` prefix are sent directly to the terminal as input.

## Configuration

Add to your VS Code settings:

```json
{
  "slackTerminal.appToken": "xapp-...",
  "slackTerminal.botToken": "xoxb-...",
  "slackTerminal.allowedUserId": "U12345",
  "slackTerminal.channelId": "C0ABCD...",
  "slackTerminal.truncateAt": 2000,
  "slackTerminal.batchDelayMs": 500,
  "slackTerminal.autoConnect": false
}
```

| Setting | Description |
|---------|-------------|
| `appToken` | Socket Mode token (starts with `xapp-`) |
| `botToken` | Bot OAuth token (starts with `xoxb-`) |
| `allowedUserId` | Your Slack user ID (whitelist) |
| `channelId` | Channel to listen in |
| `truncateAt` | Character limit before sending as file (default: 2000) |
| `batchDelayMs` | Output batching interval in ms (default: 500) |
| `autoConnect` | Connect automatically on VS Code startup |

## Slack App Setup

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions.

**Quick version:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app
3. Enable Socket Mode (Settings > Socket Mode)
4. Add Bot Token Scopes: `chat:write`, `files:write`, `channels:history`
5. Subscribe to Events: `message.channels`
6. Install to workspace
7. Copy App Token and Bot Token to VS Code settings
8. Invite the bot to your channel (`/invite @botname`)

## Architecture

```
Slack (Phone) ──WebSocket──> SlackClient ──> MessageHandler ──> TerminalManager
                                                                      │
Slack (Phone) <──messages─── SlackClient <── OutputCapture <──────────┘
```

- **SlackClient**: Socket Mode connection, message sending
- **MessageHandler**: Routes messages, handles `/commands`
- **TerminalManager**: Maps threads to VS Code terminals
- **OutputCapture**: Batches and truncates terminal output

## Development

```bash
npm install        # Install dependencies
npm run compile    # Build TypeScript
npm run watch      # Watch mode for development
npm test           # Run tests
```

Press F5 in VS Code to launch the Extension Development Host with the test workspace.

## Security

- Only messages from your configured user ID are processed
- Unknown users are silently ignored
- Tokens are stored in VS Code settings (consider using a secrets manager for production)

## Status Bar

The extension shows connection status in the VS Code status bar:
- 🟢 Connected
- 🟡 Reconnecting
- 🔴 Disconnected

## License

MIT
