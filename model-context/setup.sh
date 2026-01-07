#!/bin/bash
# Setup script for model-context extension
# Symlinks context files and extension to ~/.pi/agent/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="$HOME/.pi/agent"

echo "Setting up model-context..."

# Create directories
mkdir -p "$PI_AGENT_DIR/extensions"

# Symlink context files from templates/
for file in AGENTS.md CLAUDE.md CODEX.md GEMINI.md; do
    target="$PI_AGENT_DIR/$file"
    source="$SCRIPT_DIR/templates/$file"
    
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

# Symlink extension
target="$PI_AGENT_DIR/extensions/model-context.ts"
if [ -L "$target" ]; then
    echo "  model-context.ts already linked"
else
    ln -sf "$SCRIPT_DIR/model-context.ts" "$target"
    echo "  Linked model-context.ts"
fi

echo ""
echo "Done! Context files symlinked to $PI_AGENT_DIR/"
echo "Edit files in $SCRIPT_DIR/templates/ to customize."
