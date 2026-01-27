# slack-terminal Design Document

**Date:** 2026-01-26
**Status:** Ready for implementation

---

## Overview

A VS Code extension that relays terminal commands between Slack and VS Code's integrated terminal. Enables full terminal control from your phone via Slack, including Claude Code sessions.

**Key principle:** No difference between sending a message on Slack and typing in VS Code's terminal.

---

## Requirements Summary

| Requirement | Decision |
|-------------|----------|
| Terminal location | VS Code integrated terminal panel |
| Session model | Each Slack thread = own terminal |
| Output handling | Smart truncation, long output as .md file attachments |
| Security | Slack user ID whitelist |
| Session persistence | Tied to VS Code lifecycle |
| Interactive prompts | Detect and forward to Slack |
| Architecture | VS Code Extension + Slack Socket Mode |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Desktop                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                 VS Code                            │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │         Slack Terminal Extension            │  │  │
│  │  │  ┌─────────────┐    ┌──────────────────┐   │  │  │
│  │  │  │ Slack Socket│    │ Terminal Manager │   │  │  │
│  │  │  │   Mode      │◄──►│                  │   │  │  │
│  │  │  │ Connection  │    │ Thread → Terminal│   │  │  │
│  │  │  └─────────────┘    └──────────────────┘   │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │                         │                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │  │
│  │  │Terminal 1│  │Terminal 2│  │Terminal 3│  ...   │  │
│  │  │(thread-a)│  │(thread-b)│  │(thread-c)│        │  │
│  │  └──────────┘  └──────────┘  └──────────┘        │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │ WebSocket (Socket Mode)
                           ▼
                    ┌─────────────┐
                    │    Slack    │
                    └─────────────┘
                           ▲
                           │
                    ┌─────────────┐
                    │ Your Phone  │
                    └─────────────┘
```

---

## Message Flow

### Starting a new session
1. You send a message in the Slack channel (not in a thread)
2. Extension receives it, verifies your user ID
3. Creates a new VS Code terminal named `slack-<thread_ts>`
4. Terminal appears in VS Code's terminal panel
5. Your message is sent to the terminal as input
6. Extension replies in a thread: "Terminal created. Send commands in this thread."

### Sending commands
1. You reply in the thread with a command (e.g., `git status`)
2. Extension routes it to the mapped terminal
3. Command is written to terminal's stdin
4. Output is captured and sent back to the thread

### Output handling
- Output streams to Slack in near real-time
- Messages batched every 500ms to avoid rate limits
- If output exceeds 2000 chars, send as `.md` file attachment
- Keeps chat readable, full content always accessible

### Interactive prompts
- Extension watches for common prompt patterns (`[y/n]`, `password:`, `(yes/no)`)
- When detected, sends: `⚠️ Prompt detected: "Continue? [y/n]"`
- Your next message is sent as input to the prompt

---

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

---

## Project Structure

```
slack-terminal/
├── package.json              # Extension manifest
├── tsconfig.json
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── src/
│   ├── extension.ts          # Entry point, activation
│   ├── slack/
│   │   ├── client.ts         # Socket Mode connection
│   │   ├── auth.ts           # User ID whitelist check
│   │   └── message-handler.ts# Route messages to terminals
│   ├── terminal/
│   │   ├── manager.ts        # Create/track/destroy terminals
│   │   ├── output-capture.ts # Capture & buffer output
│   │   └── prompt-detector.ts# Detect interactive prompts
│   └── config.ts             # Settings management
├── .env.example              # Template for tokens
└── docs/
    └── design.md             # This document
```

---

## Configuration

**VS Code settings:**
```json
{
  "slackTerminal.appToken": "xapp-...",      // Socket Mode token
  "slackTerminal.botToken": "xoxb-...",      // Bot token for posting
  "slackTerminal.allowedUserId": "U12345",   // Your Slack user ID
  "slackTerminal.channelId": "C0ABCD...",    // Channel to listen in
  "slackTerminal.truncateAt": 2000,          // Chars before file attachment
  "slackTerminal.batchDelayMs": 500          // Output batching interval
}
```

**Extension activation:**
- On VS Code startup (if configured)
- Or via command palette: "Slack Terminal: Connect"

**Status bar:** Shows 🟢 Connected | 🟡 Reconnecting | 🔴 Disconnected

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Slack disconnects | Auto-reconnect with exponential backoff |
| VS Code closes | Sessions lost; notify threads on restart |
| Terminal exits | Notify thread; new message starts fresh session |
| Rate limited | Queue messages, drain slowly |
| Unknown user | Silently ignore |

---

## Slack App Setup

Required scopes:
- `chat:write` - Send messages
- `files:write` - Upload file attachments
- `channels:history` - Read channel messages (or `groups:history` for private)
- `app_mentions:read` - Optional, for @mentions

Socket Mode must be enabled in the Slack app settings.

---

## Implementation Plan

### Phase 1: Project Setup
1. Create directory `C:\Users\Eli\projects\slack-terminal`
2. Initialize VS Code extension scaffolding
3. Create GitHub repo `slack-terminal`
4. Set up TypeScript, ESLint, basic structure

### Phase 2: Slack Connection
1. Implement Socket Mode client
2. Add authentication (user ID whitelist)
3. Basic message receiving and responding
4. Status bar indicator

### Phase 3: Terminal Management
1. Create terminals mapped to thread IDs
2. Send input to terminals
3. Capture terminal output
4. Output batching and file attachments for long output

### Phase 4: Commands & Polish
1. Implement `/list`, `/close`, `/kill`, etc.
2. Interactive prompt detection
3. Reconnection logic
4. Session recovery notifications

### Phase 5: Testing & Documentation
1. End-to-end testing (see verification steps below)
2. README with setup instructions
3. Publish to VS Code marketplace (optional)

---

## Verification Steps

1. **Connection test**
   - Start extension, verify 🟢 in status bar
   - Send `/status` from Slack → should respond

2. **Basic command test**
   - Send `echo "hello"` → terminal opens, response in thread

3. **Output handling test**
   - Small output → inline
   - Large output → .md file attachment

4. **Interactive prompt test**
   - Run command with prompt → detect and forward
   - Reply → input sent to terminal

5. **Claude Code test**
   - Send `claude` → start session
   - Interact via thread → long responses as attachments

6. **Cleanup test**
   - `/close` → terminal closes
   - `/list` → shows empty

---

## Dependencies

- `@slack/socket-mode` - Slack Socket Mode client
- `@slack/web-api` - Slack Web API for posting messages/files
- `vscode` - VS Code extension API
