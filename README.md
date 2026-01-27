# Slack Terminal

A VS Code extension that relays terminal commands between Slack and VS Code's integrated terminal. Control your development machine from your phone via Slack.

## Features

- **Full terminal control from Slack** - Send any command, receive output
- **Thread-based sessions** - Each Slack thread gets its own terminal
- **Smart output handling** - Long outputs sent as file attachments
- **Interactive prompt detection** - Handles `[y/n]` prompts, password inputs
- **Claude Code compatible** - Run Claude Code sessions from your phone

## Quick Start

1. Install the extension
2. Create a Slack App with Socket Mode enabled
3. Configure your tokens in VS Code settings
4. Send a message in your configured channel

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
  "slackTerminal.channelId": "C0ABCD..."
}
```

## Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app
3. Enable Socket Mode (Settings > Socket Mode)
4. Add Bot Token Scopes:
   - `chat:write`
   - `files:write`
   - `channels:history`
5. Install to workspace
6. Copy App Token and Bot Token to VS Code settings

## Security

- Only messages from your configured user ID are processed
- Unknown users are silently ignored
- Tokens are stored in VS Code settings (consider using a secrets manager)

## Status Bar

- 🟢 Connected
- 🟡 Reconnecting
- 🔴 Disconnected

## License

MIT
