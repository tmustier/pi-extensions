# extending-pi

Guide for extending Pi — decide between Agent Skills, extensions, prompt templates, themes, context files, custom models/providers, and Pi packages, then create and package them.

The skill emphasizes Pi's extension-first architecture: when changing Pi behavior, inspect the extension docs, examples, and installed types/source before considering a Pi internal patch.

Includes nested Agent Skills:
- **skill-creator** — detailed guidance for creating Agent Skills

## Installation

```bash
pi install git:github.com/tmustier/pi-extensions
```

Or symlink for local development:

```bash
ln -s /path/to/pi-extensions/extending-pi ~/.pi/agent/skills/extending-pi
```
