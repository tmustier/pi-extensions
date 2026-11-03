# Releasing

This repo hosts multiple extensions. Releases are per extension, not per repo.

## Tag Format

Use `extension-name/vX.Y.Z` (example: `usage-extension/v0.1.2`).

## Changelog entries

Pi 1.5.0 and later show each package's new `UPDATE_NOTES.md` entries when Pi starts after an update. A user sees every entry newer than the version they last saw, so a user who skips releases can see several entries at once. Keep the release history in `CHANGELOG.md`, and write startup notes for that screen:

- Write one plain sentence per change, saying what a user notices. Add a second sentence only when the user needs it, e.g. to know about a changed default.
- Leave out how the fix works, internal names and measurements from startup notes. Keep that detail in the changelog, pull request or GitHub release notes.
- End each bullet with one link to the pull request or issue.
- Release changes from the same day as one version, so users see one entry instead of several.

Each extension package sets `pi.changelogPath` to `./UPDATE_NOTES.md`, rather than Pi's default `CHANGELOG.md`. The root bundle and Arcade show notes only for changes that affect every extension in that package. Pi cannot filter a package's notes by the extensions a user loads. A standalone extension package has its own notes, which do not appear when it is loaded through the root bundle.

## Steps

1. Update the extension's `CHANGELOG.md`. Review its `UPDATE_NOTES.md` for a short
   user-facing startup note when the release changes behaviour or requires action.
   Use released package versions in `## [x.y.z]` headings, and skip internal,
   metadata-only or otherwise unimportant changes. Keep the full changelog.
   Pi shows notes for the installed package, not each loaded extension. In the
   root and Arcade `UPDATE_NOTES.md` files, include only changes that affect every
   extension in that package. Do not copy individual extension notes into them.
   Do not add empty version headings or an Unreleased section. Check whether a
   standalone package needs its own note even when the root bundle stays silent.
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

