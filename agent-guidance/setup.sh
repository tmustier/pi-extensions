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
    if [ -f "$CLAUDE_FILE" ] || [ -L "$CLAUDE_FILE" ]; then
        echo ""
        echo "  ⚠️  No AGENTS.md found in $PI_AGENT_DIR/"
        echo "     You have an existing CLAUDE.md - if you want that guidance"
        echo "     to apply across all models, it should be in AGENTS.md."
        echo ""
        read -p "     Copy CLAUDE.md content to AGENTS.md? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp "$CLAUDE_FILE" "$AGENTS_FILE"
            echo "     Copied CLAUDE.md → AGENTS.md"
            echo "     CLAUDE.md kept for Claude-specific guidance (edit as needed)."
        else
            # Create placeholder
            cat > "$AGENTS_FILE" << 'EOF'
# AGENTS.md

Universal guidelines for all AI models.

<!-- Add your cross-model guidance here -->
EOF
            echo "     Created placeholder AGENTS.md."
        fi
        echo ""
    else
        # No CLAUDE.md either, create placeholder
        cat > "$AGENTS_FILE" << 'EOF'
# AGENTS.md

Universal guidelines for all AI models.

<!-- Add your cross-model guidance here -->
EOF
        echo ""
        echo "  ⚠️  No AGENTS.md found in $PI_AGENT_DIR/"
        echo "     Created a placeholder; add your cross-model guidance there."
        echo ""
    fi
fi

# Symlink extension
target="$PI_AGENT_DIR/extensions/agent-guidance.ts"
if [ -L "$target" ]; then
    echo "  agent-guidance.ts already linked"
else
    ln -sf "$SCRIPT_DIR/agent-guidance.ts" "$target"
    echo "  Linked agent-guidance.ts"
fi

# Ask about symlinking template provider files
echo ""
echo "  Template provider files available: CLAUDE.md, CODEX.md, GEMINI.md"
echo "  These provide starter guidance for each model provider."
echo ""
read -p "  Symlink template files to $PI_AGENT_DIR/? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
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
else
    echo "  Skipped. You can create your own provider files or symlink later:"
    echo "    ln -s $SCRIPT_DIR/templates/CLAUDE.md $PI_AGENT_DIR/"
fi

echo ""
echo "Done!"
