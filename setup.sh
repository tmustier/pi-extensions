#!/bin/bash
# Setup script for pi-extensions
# Copies context files and symlinks extension to ~/.pi/agent/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="$HOME/.pi/agent"

echo "Setting up pi-extensions..."

# Create directories
mkdir -p "$PI_AGENT_DIR/extensions"

# Copy context files (don't overwrite existing)
for file in AGENTS.md CLAUDE.md CODEX.md GEMINI.md; do
    if [ -f "$SCRIPT_DIR/context/$file" ]; then
        if [ -f "$PI_AGENT_DIR/$file" ]; then
            echo "  $file already exists, skipping (won't overwrite your config)"
        else
            cp "$SCRIPT_DIR/context/$file" "$PI_AGENT_DIR/$file"
            echo "  Copied $file"
        fi
    fi
done

# Symlink provider-context extension
if [ -L "$PI_AGENT_DIR/extensions/provider-context.ts" ]; then
    echo "  provider-context.ts already linked"
else
    ln -sf "$SCRIPT_DIR/provider-context.ts" "$PI_AGENT_DIR/extensions/provider-context.ts"
    echo "  Linked provider-context.ts"
fi

echo ""
echo "Done! Your context files are in $PI_AGENT_DIR/"
echo "Edit them to customize your agent guidelines."
echo ""
echo "Files:"
ls -la "$PI_AGENT_DIR"/*.md 2>/dev/null || echo "  (no .md files yet)"
