#!/bin/bash

# Path to your AppImage (adjust if needed)
APPIMAGE_PATH="/home/nikhil/Desktop/crisp_app/crispDesktop/dist/shakra-ai-interview-1.0.0.AppImage"
DESKTOP_FILE="$HOME/.local/share/applications/shakra-ai-interview.desktop"

# Create the desktop entry
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=Shakra AI Interview
Comment=AI-powered interview platform with security monitoring
Exec="$APPIMAGE_PATH" %u
Icon=utilities-terminal
Type=Application
Categories=Utility;Development;
MimeType=x-scheme-handler/shakra-app;
StartupNotify=true
NoDisplay=false
EOF

# Make it executable
chmod +x "$DESKTOP_FILE"

# Update database and register mimetype
update-desktop-database ~/.local/share/applications
xdg-mime default shakra-ai-interview.desktop x-scheme-handler/shakra-app

echo "✅ Registered AppImage at $APPIMAGE_PATH"
echo "✅ Created $DESKTOP_FILE"
echo "✅ Mime-type x-scheme-handler/shakra-app set to shakra-ai-interview.desktop"
