import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getGitStatus } from "../files-widget/git.ts";

test("git status keeps unusual paths and renames intact", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "files-widget-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root });
  git("init", "-q");
  for (const name of ["a b.txt", "café.txt", "plain.txt"]) writeFileSync(join(root, name), `${name}\n`.repeat(20));
  git("add", ".");
  git("commit", "-qm", "init");
  git("rm", "-q", "a b.txt");
  writeFileSync(join(root, "café.txt"), "y\n");
  git("mv", "plain.txt", "new name.txt");

  assert.deepEqual(
    Object.fromEntries(await getGitStatus(root)),
    { "a b.txt": "D", "café.txt": "M", "new name.txt": "R" },
  );
});
