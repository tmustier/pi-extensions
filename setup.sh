#!/bin/bash
# Setup script for pi-extensions
# Symlinks context files and extension to ~/.pi/agent/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="$HOME/.pi/agent"

echo "Setting up pi-extensions..."

# Create directories
mkdir -p "$PI_AGENT_DIR/extensions"

# Symlink context files
for file in AGENTS.md CLAUDE.md CODEX.md GEMINI.md; do
    target="$PI_AGENT_DIR/$file"
    source="$SCRIPT_DIR/context/$file"
    
    if [ -f "$source" ]; then
        if [ -L "$target" ]; then
            echo "  $file already linked"
        elif [ -f "$target" ]; then
            echo "  $file exists as file, replacing with symlink"
            rm "$target"
            ln -sf "$source" "$target"
            echo "  Linked $file"
        else
            ln -sf "$source" "$target"
            echo "  Linked $file"
        fi
    fi
done

# Symlink provider-context extension
target="$PI_AGENT_DIR/extensions/provider-context.ts"
if [ -L "$target" ]; then
    echo "  provider-context.ts already linked"
else
    ln -sf "$SCRIPT_DIR/extensions/provider-context.ts" "$target"
    echo "  Linked provider-context.ts"
fi

echo ""
echo "Done! Context files symlinked to $PI_AGENT_DIR/"
echo "Edit files in $SCRIPT_DIR/context/ to customize."
echo ""
echo "Files:"
ls -la "$PI_AGENT_DIR"/*.md 2>/dev/null || echo "  (no .md files)"
