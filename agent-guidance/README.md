# agent-guidance

Loads different context files based on the current model's provider, supplementing Pi's core `AGENTS.md` loading with provider-specific additions.

## How It Works

```mermaid
flowchart TB
    subgraph Global ["~/.pi/agent/"]
        G_AGENTS[AGENTS.md]
        G_CLAUDE[CLAUDE.md]
        G_CODEX[CODEX.md]
        G_GEMINI[GEMINI.md]
    end
    
    subgraph Repo ["project/"]
        R_AGENTS[AGENTS.md]
        R_CLAUDE[CLAUDE.md]
    end
    
    subgraph Core ["Pi Core"]
        LOAD[Load all AGENTS.md files<br/>global → parent dirs → cwd]
    end
    
    subgraph Ext ["agent-guidance extension"]
        CHECK{Which provider?}
        ADD_C[+ CLAUDE.md files]
        ADD_X[+ CODEX.md files]
        ADD_G[+ GEMINI.md files]
    end
    
    G_AGENTS --> LOAD
    R_AGENTS --> LOAD
    LOAD --> CHECK
    
    CHECK -->|Anthropic| ADD_C
    CHECK -->|OpenAI| ADD_X
    CHECK -->|Google| ADD_G
    
    G_CLAUDE -.-> ADD_C
    R_CLAUDE -.-> ADD_C
    G_CODEX -.-> ADD_X
    G_GEMINI -.-> ADD_G
    
    ADD_C --> PROMPT[System Prompt]
    ADD_X --> PROMPT
    ADD_G --> PROMPT
```

**What gets loaded:**

| Provider | Files Loaded |
|----------|-------------|
| Anthropic | `~/.pi/agent/AGENTS.md` + `project/AGENTS.md` + `~/.pi/agent/CLAUDE.md` + `project/CLAUDE.md` |
| OpenAI | `~/.pi/agent/AGENTS.md` + `project/AGENTS.md` + `~/.pi/agent/CODEX.md` |
| Google | `~/.pi/agent/AGENTS.md` + `project/AGENTS.md` + `~/.pi/agent/GEMINI.md` |

**Deduplication:** If a directory only has `CLAUDE.md` (no `AGENTS.md`), Pi core loads it as fallback. The extension skips loading it again to avoid duplication.

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
