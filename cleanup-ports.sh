#!/bin/bash

# Cleanup script for Security Agent App
# This script kills any processes using ports 8765-8766

echo "🧹 Cleaning up Security Agent App ports..."

# Kill processes on port 8765
if lsof -ti:8765 > /dev/null 2>&1; then
    echo "Killing processes on port 8765..."
    lsof -ti:8765 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Kill processes on port 8766 (alternative port)
if lsof -ti:8766 > /dev/null 2>&1; then
    echo "Killing processes on port 8766..."
    lsof -ti:8766 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Kill any remaining security-agent-app processes
if pgrep -f "security-agent-app" > /dev/null 2>&1; then
    echo "Killing remaining security-agent-app processes..."
    pkill -f "security-agent-app" 2>/dev/null || true
    sleep 1
fi

echo "✅ Port cleanup completed!"
echo "You can now run: npm run dev"



