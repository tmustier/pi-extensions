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

echo ""
echo "Done!"
echo ""
echo "Template provider files available in $SCRIPT_DIR/templates/:"
echo "  - CLAUDE.md (Anthropic)"
echo "  - CODEX.md  (OpenAI)"
echo "  - GEMINI.md (Google)"
echo ""
echo "To install:"
echo "  ln -s $SCRIPT_DIR/templates/CLAUDE.md $PI_AGENT_DIR/"
echo "  ln -s $SCRIPT_DIR/templates/CODEX.md $PI_AGENT_DIR/"
echo "  ln -s $SCRIPT_DIR/templates/GEMINI.md $PI_AGENT_DIR/"
echo ""
echo "Or all at once:"
echo "  ln -s $SCRIPT_DIR/templates/*.md $PI_AGENT_DIR/"
