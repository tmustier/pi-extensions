# Releasing

This repo hosts multiple extensions. Releases are per extension, not per repo.

## Tag Format

Use `extension-name/vX.Y.Z` (example: `usage-extension/v0.1.2`).

## Steps

1. Update the extension's `CHANGELOG.md`.
2. Optionally refresh compatibility notes in the extension README.
3. Tag and push the release:

```bash
git tag -a usage-extension/v0.1.2 -m "usage-extension v0.1.2"
git push origin usage-extension/v0.1.2
```

4. Create a GitHub release from the tag and paste the notes from the changelog.

