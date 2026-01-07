#!/bin/bash
# Setup script for agent-guidance extension
# Symlinks context files and extension to ~/.pi/agent/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="$HOME/.pi/agent"

echo "Setting up agent-guidance..."

# Create directories
mkdir -p "$PI_AGENT_DIR/extensions"

# Check for AGENTS.md and create placeholder if needed
AGENTS_FILE="$PI_AGENT_DIR/AGENTS.md"
CLAUDE_FILE="$PI_AGENT_DIR/CLAUDE.md"

if [ ! -f "$AGENTS_FILE" ]; then
    # Create placeholder AGENTS.md
    cat > "$AGENTS_FILE" << 'EOF'
# AGENTS.md

Universal guidelines for all AI models.

<!-- Add your cross-model guidance here -->
EOF
    
    if [ -f "$CLAUDE_FILE" ] || [ -L "$CLAUDE_FILE" ]; then
        echo ""
        echo "  ⚠️  No AGENTS.md found in $PI_AGENT_DIR/"
        echo "     Created a placeholder."
        echo "     You have an existing CLAUDE.md - if you want that guidance"
        echo "     to apply across all models, move it to AGENTS.md."
        echo ""
    else
        echo ""
        echo "  ⚠️  No AGENTS.md found in $PI_AGENT_DIR/"
        echo "     Created a placeholder; add your cross-model guidance there."
        echo ""
    fi
fi

# Symlink provider-specific context files from templates/
for file in CLAUDE.md CODEX.md GEMINI.md; do
    target="$PI_AGENT_DIR/$file"
    source="$SCRIPT_DIR/templates/$file"
    
    if [ -f "$source" ]; then
        if [ -L "$target" ]; then
            echo "  $file already linked"
        elif [ -f "$target" ]; then
            echo "  $file exists as file, skipping (keeping your version)"
        else
            ln -sf "$source" "$target"
            echo "  Linked $file"
        fi
    fi
done

# Symlink extension
target="$PI_AGENT_DIR/extensions/agent-guidance.ts"
if [ -L "$target" ]; then
    echo "  agent-guidance.ts already linked"
else
    ln -sf "$SCRIPT_DIR/agent-guidance.ts" "$target"
    echo "  Linked agent-guidance.ts"
fi

echo ""
echo "Done! Context files symlinked to $PI_AGENT_DIR/"
echo "Edit files in $SCRIPT_DIR/templates/ to customize."
