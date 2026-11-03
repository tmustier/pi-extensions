# Releasing

This repo hosts multiple extensions. Releases are per extension, not per repo.

## Tag Format

Use `extension-name/vX.Y.Z` (example: `usage-extension/v0.1.2`).

## Changelog entries

Pi 1.5.0 and later shows each package's new changelog entries when Pi starts after the package updates. A user sees every entry newer than the version they last saw, so a user who skips releases sees several entries at once. Write entries for that screen:

- Write one plain sentence per change, saying what a user notices. Add a second sentence only when the user needs it, e.g. to know about a changed default.
- Leave out how the fix works, internal names and measurements. Put those in the pull request and the GitHub release notes.
- End each bullet with one link to the pull request or issue.
- Release changes from the same day as one version, so users see one entry instead of several.

Pi reads `CHANGELOG.md` from each package root by default, so no `pi.changelogPath` setting is needed.

## Steps

1. Update the extension's `CHANGELOG.md`.
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

