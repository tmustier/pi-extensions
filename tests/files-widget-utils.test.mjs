import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hasCommand } from "../files-widget/utils.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "files-widget-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createFile(path, mode = 0o755) {
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, mode);
}

test("POSIX lookup accepts executable files and executable symlinks", (t) => {
  const root = fixture(t);
  createFile(join(root, "present"));
  symlinkSync(join(root, "present"), join(root, "linked"));

  assert.equal(hasCommand("present", { platform: "linux", path: root }), true);
  assert.equal(hasCommand("linked", { platform: "linux", path: root }), true);
});

test("POSIX lookup rejects missing, non-executable, and directory entries", (t) => {
  const root = fixture(t);
  createFile(join(root, "not-executable"), 0o644);
  mkdirSync(join(root, "directory"));

  assert.equal(hasCommand("missing", { platform: "linux", path: root }), false);
  assert.equal(hasCommand("not-executable", { platform: "linux", path: root }), false);
  assert.equal(hasCommand("directory", { platform: "linux", path: root }), false);
});

test("POSIX treats quotes in PATH entries literally", (t) => {
  const root = fixture(t);
  createFile(join(root, "present"));

  assert.equal(hasCommand("present", { platform: "linux", path: `"${root}"` }), false);
});

test("Windows lookup searches cwd before PATH and applies PATHEXT", (t) => {
  const root = fixture(t);
  const cwd = join(root, "cwd");
  const pathDirectory = join(root, "path");
  mkdirSync(cwd);
  mkdirSync(pathDirectory);
  createFile(join(cwd, "from-cwd.RUN"), 0o644);
  createFile(join(pathDirectory, "from-path.RUN"), 0o644);

  const options = { platform: "win32", cwd, path: pathDirectory, pathExt: ".RUN;.EXE" };
  assert.equal(hasCommand("from-cwd", options), true);
  assert.equal(hasCommand("from-path", options), true);
  assert.equal(hasCommand("from-cwd.EXE", options), false);
  assert.equal(hasCommand("missing", options), false);
});

test("Windows strips matching quotes around search directories", (t) => {
  const root = fixture(t);
  const pathDirectory = join(root, "quoted path");
  mkdirSync(pathDirectory);
  createFile(join(pathDirectory, "present.EXE"), 0o644);

  assert.equal(hasCommand("present", {
    platform: "win32",
    cwd: join(root, "empty-cwd"),
    path: `"${pathDirectory}"`,
    pathExt: ".EXE",
  }), true);
});
