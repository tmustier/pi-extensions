import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { loadFileContent } from "../files-widget/file-viewer.ts";

test("Markdown is rendered by glow from the file, not from standard input", { skip: process.platform === "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "files-widget-viewer-"));
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  });
  // Like glow, this reads standard input instead of the file whenever input is piped in.
  writeFileSync(join(root, "glow"), '#!/bin/sh\nif [ -c /dev/stdin ]; then echo "rendered from file"; else cat; fi\n');
  chmodSync(join(root, "glow"), 0o755);
  writeFileSync(join(root, "README.md"), "# Title\n");
  process.env.PATH = `${root}${delimiter}${path}`;

  assert.deepEqual(loadFileContent(join(root, "README.md"), root, false, false, 80), {
    lines: ["rendered from file", ""],
    renderedMarkdown: true,
  });
});
