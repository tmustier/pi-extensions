# Releasing

This repo hosts multiple extensions. Releases are per extension, not per repo.

## Tag Format

Use `extension-name/vX.Y.Z` (example: `usage-extension/v0.1.2`).

## Changelog entries

Each package sets `pi.changelogPath` to `./UPDATE_NOTES.md`. Pi 1.5 and later
show entries newer than the last seen version, so skipped releases can add up.

- Write short notes about meaningful behaviour changes or required actions, with
  a link to the pull request or issue. Keep implementation detail in `CHANGELOG.md`.
- Use released package versions in `## [x.y.z]` headings. When no notice is needed,
  leave out the entry. Empty headings and Unreleased sections are not notices.
- In the root bundle and Arcade, include only changes affecting every extension.
  Pi cannot filter notes by loaded extensions. Standalone packages have their own
  notes, which do not appear through the root bundle.
- Release changes from the same day as one version to avoid repeated notices.

## Steps

1. Update `CHANGELOG.md` and review `UPDATE_NOTES.md` using the guidance above.
2. Optionally refresh compatibility notes in the extension README.
3. Bump the extension version in its `package.json` and bump the repo version in the root `package.json` (ensure it is not marked `private` when publishing).
4. Run the extension tests and inspect the exact npm package contents before publishing:

```bash
npm test --prefix <extension-dir>
mkdir -p /tmp/pi-release-pack
npm pack --json --pack-destination /tmp/pi-release-pack ./<extension-dir>
npm pack --json --pack-destination /tmp/pi-release-pack .
```

Check the JSON file lists and package sizes. The root tarball must not contain any nested `node_modules` directories from package-local development installs.

5. Publish to npm (both packages):

```bash
# Extension-specific package
cd <extension-dir>
npm publish --access public

# Repo-wide pi-extensions package
cd <repo-root>
npm publish --access public
```

6. Tag and push the release:

```bash
git tag -a usage-extension/v0.1.2 -m "usage-extension v0.1.2"
git push origin usage-extension/v0.1.2
```

7. Create a GitHub release from the tag. Use the changelog entry, and add any detail that is too long for the changelog.

