# Publishing Agent Skills for Pi

To share with Pi users, make the skill installable with `pi install` from an npm package, git repository, or local path.

Pi can load skills from either:

1. A `package.json` `pi.skills` manifest, or
2. The conventional `skills/` directory.

Pi does not use `.skill` archives.

`pi update` updates non-pinned npm and git installs. Pinned refs/versions and local paths are not auto-updated.

## Minimal package.json

```json
{
  "name": "my-agent-skills",
  "keywords": ["pi-package"],
  "pi": { "skills": ["./skills"] }
}
```

## Install examples

```bash
pi install npm:<package>
pi install git:github.com/org/repo
pi install ./local/path
```

Use `pi config` if the user needs to enable, disable, or filter resources after installation.

Agent Skills can also be shared as normal directories or repositories for other compatible clients.
