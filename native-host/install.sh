#!/bin/bash
# Install the native messaging host for Immersive Translate
# Usage: ./install.sh <chrome-extension-id>

set -e

HOST_DIR="$HOME/.immersive-translate"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

if [ -z "$1" ]; then
  echo "Usage: ./install.sh <chrome-extension-id>"
  echo ""
  echo "To find your extension ID:"
  echo "  1. Go to chrome://extensions"
  echo "  2. Enable 'Developer mode'"
  echo "  3. Find 'Immersive Translate' extension"
  echo "  4. Copy the ID shown under the extension name"
  echo ""
  echo "Example: ./install.sh iacmhfglonaadhphllbjfejcabjcplph"
  exit 1
fi

EXT_ID="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure host directory exists (no spaces in path)
mkdir -p "$HOST_DIR"

# Copy the latest translate.py to the host directory
cp "$SCRIPT_DIR/translate.py" "$HOST_DIR/translate.py"
chmod +x "$HOST_DIR/translate.py"

# Write the native messaging manifest
mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_DIR/com.immersive.translate.json" << EOF
{
  "name": "com.immersive.translate",
  "description": "Immersive Translate - Native Messaging Host",
  "path": "$HOST_DIR/translate.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "Installation complete!"
echo "  Manifest: $MANIFEST_DIR/com.immersive.translate.json"
echo "  Host:     $HOST_DIR/translate.py"
echo "  Extension: $EXT_ID"
echo ""
echo "Next steps:"
echo "  1. Completely quit and restart Chrome"
echo "  2. Go to chrome://extensions and reload the extension"
echo "  3. Refresh the page you want to translate"
