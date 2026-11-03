import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { createViewer } from "../files-widget/viewer.ts";
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

function createSearchViewer(t) {
  const root = mkdtempSync(join(tmpdir(), "files-widget-search-"));
  const path = process.env.PATH;
  // Use the raw-file fallback, independent of installed syntax highlighters.
  process.env.PATH = "";
  t.after(() => {
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  });
  const filePath = join(root, "search.txt");
  const lines = Array.from({ length: 80 }, (_, i) => `row ${i + 1}${[5, 35, 65].includes(i) ? " needle" : ""}`);
  writeFileSync(filePath, lines.join("\n"));
  const theme = { bold: text => text, fg: (_color, text) => text, bg: (_color, text) => text };
  const viewer = createViewer({ getRoot: () => root, projectCwd: root }, theme, () => {});
  viewer.setFile({ name: "search.txt", path: filePath, isDirectory: false });
  viewer.render(120);
  viewer.handleInput("/");
  for (const char of "needle") viewer.handleInput(char);
  return viewer;
}

test("viewer Enter confirms search and n/N navigate retained matches with wraparound", (t) => {
  const viewer = createSearchViewer(t);
  assert.match(viewer.render(120)[0], /\/needle█/);
  viewer.handleInput("\r");
  const first = viewer.render(120);
  assert.match(first[0], /\[1\/3\]/);
  assert.doesNotMatch(first[0], /█/);
  assert.match(first.at(-1), /n\/N: next\/prev match/);

  viewer.handleInput("n");
  const second = viewer.render(120);
  assert.match(second[0], /\[2\/3\]/);
  assert.match(second[2], /row 33$/);
  assert.notEqual(second[2], first[2]);
  viewer.handleInput("N");
  assert.equal(viewer.render(120)[2], first[2]);
  viewer.handleInput("N");
  assert.match(viewer.render(120)[0], /\[3\/3\]/);
  viewer.handleInput("n");
  assert.match(viewer.render(120)[0], /\[1\/3\]/);
});

test("viewer Escape cancels editing or clears confirmed search before closing", (t) => {
  const viewer = createSearchViewer(t);
  for (const confirm of [false, true]) {
    if (confirm) viewer.handleInput("\r");
    assert.deepEqual(viewer.handleInput("\x1b"), { type: "none" });
    const cleared = viewer.render(120);
    assert.doesNotMatch(cleared[0], /needle|\[\d\/\d\]/);
    viewer.handleInput("n");
    viewer.handleInput("N");
    assert.deepEqual(viewer.render(120), cleared);
    if (!confirm) {
      viewer.handleInput("/");
      for (const char of "needle") viewer.handleInput(char);
    }
  }
  assert.deepEqual(viewer.handleInput("\x1b"), { type: "close" });
});
