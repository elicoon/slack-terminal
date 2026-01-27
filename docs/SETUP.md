# Slack Terminal Setup Guide

## Prerequisites

- VS Code 1.85.0+
- Node.js 18+
- A Slack workspace where you can create apps

## Slack App Setup

### 1. Create the App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: `Terminal Relay` (or any name)
4. Select your workspace
5. Click **Create App**

### 2. Enable Socket Mode

1. In left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to ON
3. Create an App-Level Token:
   - Name: `socket-token`
   - Scope: `connections:write`
4. Click **Generate**
5. **Save the `xapp-...` token**

### 3. Add Bot Permissions

1. Click **OAuth & Permissions** in left sidebar
2. Scroll to **Bot Token Scopes**
3. Add these scopes:
   - `chat:write` - Send messages
   - `files:write` - Upload file attachments
   - `channels:history` - Read channel messages

### 4. Install to Workspace

1. Scroll up on OAuth & Permissions page
2. Click **Install to Workspace**
3. Click **Allow**
4. **Save the `xoxb-...` Bot User OAuth Token**

### 5. Enable Event Subscriptions

1. Click **Event Subscriptions** in left sidebar
2. Toggle **Enable Events** to ON
3. Expand **Subscribe to bot events**
4. Add: `message.channels`
5. Click **Save Changes**

### 6. Get Your IDs

**Your User ID:**
1. In Slack, click your profile picture
2. Click **Profile**
3. Click **...** menu → **Copy member ID**

**Channel ID:**
1. Right-click the channel → **View channel details**
2. Scroll to bottom, copy the Channel ID

### 7. Invite Bot to Channel

In your channel, type:
```
/invite @Terminal Relay
```

## Extension Configuration

### Option A: VS Code Settings

1. Open VS Code Settings (Ctrl+,)
2. Search for "slackTerminal"
3. Fill in:
   - App Token: `xapp-...`
   - Bot Token: `xoxb-...`
   - Allowed User ID: `U...`
   - Channel ID: `C...`

### Option B: settings.json

Add to your VS Code settings.json:
```json
{
  "slackTerminal.appToken": "xapp-...",
  "slackTerminal.botToken": "xoxb-...",
  "slackTerminal.allowedUserId": "U...",
  "slackTerminal.channelId": "C...",
  "slackTerminal.autoConnect": true
}
```

## Usage

1. Run command **"Slack Terminal: Connect"** or click the status bar
2. Status bar shows: 🟢 Connected
3. Send a command in your Slack channel: `echo hello`
4. A terminal opens in VS Code, output appears in Slack thread
5. Reply in thread to send more commands

## Commands

| Slack Command | Action |
|---------------|--------|
| `/status` | Check connection status |
| `/list` | List active terminals |
| `/close` | Close current terminal |
| `/closeall` | Close all terminals |
| `/kill` | Send Ctrl+C (SIGINT) |
| `/clear` | Clear terminal screen |
| `/more` | Get full output (if truncated) |

## Troubleshooting

### "Configuration errors" on connect
- Verify all 4 required settings are filled in
- App token must start with `xapp-`
- Bot token must start with `xoxb-`
- User ID must start with `U`
- Channel ID must start with `C` or `G`

### Bot doesn't respond to messages
- Check Event Subscriptions are enabled with `message.channels`
- Verify bot is invited to the channel
- Check the Output panel (View → Output → "Slack Terminal")

### Connection keeps disconnecting
- Socket Mode has automatic reconnection built-in
- Check your network connection
- Verify app tokens haven't been revoked

### Output not appearing in Slack
- Check for errors in Output panel
- Verify `chat:write` and `files:write` scopes are added
- Long output (>2000 chars) is sent as file attachment
