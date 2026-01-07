# agent-guidance

Loads different context files based on the current model's provider, supplementing Pi's core `AGENTS.md` loading with provider-specific additions.

## How It Works

```mermaid
flowchart TB
    subgraph Sources ["Your Config Files"]
        direction LR
        AGENTS["AGENTS.md<br/>(universal)"]:::core
        CLAUDE["CLAUDE.md"]:::ext
        CODEX["CODEX.md"]:::ext
        GEMINI["GEMINI.md"]:::ext
    end

    AGENTS --> CORE["Pi Core loads AGENTS.md"]:::core
    
    CORE --> EXT{"agent-guidance<br/>checks provider"}:::ext
    
    EXT -->|Anthropic| C["+ CLAUDE.md"]:::ext
    EXT -->|OpenAI| X["+ CODEX.md"]:::ext
    EXT -->|Google| G["+ GEMINI.md"]:::ext
    
    C --> PROMPT["System Prompt"]
    X --> PROMPT
    G --> PROMPT

    classDef core fill:#4a9eff,stroke:#2171c7,color:#fff
    classDef ext fill:#10b981,stroke:#059669,color:#fff
```

<sub>🔵 Pi Core &nbsp;&nbsp; 🟢 agent-guidance extension</sub>

**Files are loaded from multiple locations:** `~/.pi/agent/` (global) and `project/` (local), walking up parent directories.

## Install

```bash
./setup.sh
```

This symlinks:
- Template context files to `~/.pi/agent/`
- The extension to `~/.pi/agent/extensions/`

Edit files in `templates/` to customize your guidelines.

## Configuration (Optional)

Create `~/.pi/agent/provider-context.json` to customize mappings:

```json
{
  "providers": {
    "anthropic": ["CLAUDE.md"],
    "openai": ["CODEX.md", "OPENAI.md"]
  },
  "models": {
    "claude-3-5-sonnet*": ["CLAUDE-3-5.md"],
    "o1*": ["O1.md"]
  }
}
```

## Templates

- `templates/AGENTS.md` - Universal guidelines for all models
- `templates/CLAUDE.md` - Claude-specific guidelines
- `templates/CODEX.md` - OpenAI/Codex guidelines (adapted from [steipete/agent-scripts](https://github.com/steipete/agent-scripts))
- `templates/GEMINI.md` - Gemini-specific guidelines
