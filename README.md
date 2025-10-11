# Security Agent App

An Electron application with React and TypeScript for monitoring system processes and detecting blocked applications during interviews.

## Features

- **Process Monitoring**: Real-time monitoring of system processes
- **Blocked Application Detection**: Automatically detects and alerts about restricted applications
- **Detailed Process Stats**: Comprehensive process monitoring dashboard with:
  - System overview (CPU usage, memory usage, uptime)
  - Blocked applications list with PIDs
  - Recent processes table with CPU/memory usage
  - Real-time updates every 3 seconds
- **Tray Integration**: Runs in system tray with context menu
- **WebSocket Server**: Broadcasts monitoring data on port 8765
- **Security Focused**: Built with security best practices for interview environments

## Process Monitoring Dashboard

The app includes a comprehensive process monitoring window that displays:

- **System Overview**: Total processes, CPU usage, memory usage, and system uptime
- **Blocked Applications**: List of detected restricted applications with their process IDs
- **Process Table**: Detailed view of top processes by memory usage, including:
  - Process name and PID
  - CPU and memory consumption
  - Process status
  - Expandable/collapsible view

## Blocked Applications

The system monitors for these restricted applications:
- AI assistants (ChatGPT, Claude, Copilot, Gemini)
- Remote access tools (AnyDesk, TeamViewer, Chrome Remote)
- Communication apps (Telegram, WhatsApp, Discord, Slack)
- And more configurable in the code

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
