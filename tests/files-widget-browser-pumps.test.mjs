import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };

// Renamed copies keep the production import graph unchanged. Slow I/O exposes
// enqueueing from one directory while another member of its batch still runs.
async function exercise(source, fixture, label) {
  const copy = join(repo, "files-widget", `.browser-pumps-${label}-${process.pid}.ts`);
  const active = { scan: 0, count: 0 };
  const maximum = { scan: 0, count: 0 };
  let missingScanActivity = 0;
  let browser;
  let lastRender = Date.now();
  const probe = {
    enter(kind) { maximum[kind] = Math.max(maximum[kind], ++active[kind]); },
    exit(kind) { active[kind]--; },
    async readdir(path, options) {
      await sleep(path.endsWith("d01") ? 180 : 5);
      if (browser && !browser.render(180)[0].includes("scanning")) missingScanActivity++;
      return readdir(path, options);
    },
    async stat(path) { await sleep(180); return stat(path); },
  };
  const key = `browser-pumps-${label}-${process.pid}`;
  globalThis[key] = probe;
  let instrumented = `const probe = globalThis[${JSON.stringify(key)}];\n${source}`
    .replace("await readdir(node.path,", "await probe.readdir(node.path,")
    .replace("const fileStat = await stat(node.path)", "const fileStat = await probe.stat(node.path)");
  for (const [name, kind] of [["processScanBatch", "scan"], ["processLineCountBatch", "count"]]) {
    instrumented = instrumented.replace(`async function ${name}(): Promise<void> {`, `async function ${name}(): Promise<void> {
      probe.enter(${JSON.stringify(kind)});
      try { await ${name}Body(); } finally { probe.exit(${JSON.stringify(kind)}); }
    }
    async function ${name}Body(): Promise<void> {`);
  }
  writeFileSync(copy, instrumented);
  try {
    const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
    const { createFileBrowser } = await jiti.import(copy);
    browser = createFileBrowser(fixture, new Set(), theme, () => {}, () => {}, () => { lastRender = Date.now(); });
    const deadline = Date.now() + 10000;
    while (true) {
      await sleep(20);
      const header = browser.render(180)[0];
      if (!active.scan && !active.count && !/scanning|counts/.test(header) && Date.now() - lastRender > 250) break;
      assert.ok(Date.now() < deadline, `${label}: pumps failed to drain`);
    }
    // Search exposes nested descendants even when directories are collapsed.
    browser.handleInput("/");
    browser.handleInput("\r");
    const collapsed = browser.render(180);
    browser.handleInput("/");
    browser.handleInput("txt");
    browser.handleInput("\r");
    const searched = browser.render(180);
    return { maximum, missingScanActivity, collapsed, searched };
  } finally {
    browser?.handleInput("q");
    rmSync(copy, { force: true });
    delete globalThis[key];
  }
}

test("browser pumps serialize batches and preserve the rendered non-git tree", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "browser-pumps-"));
  try {
    for (let i = 0; i < 6; i++) {
      const dir = join(fixture, `d0${i}`);
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, "file.txt"), "one\ntwo\n");
      writeFileSync(join(dir, "nested", "deep.txt"), "nested\n");
    }
    writeFileSync(join(fixture, "root.txt"), "root\n");
    symlinkSync("d00", join(fixture, "linked-dir"));
    symlinkSync("root.txt", join(fixture, "linked-file.txt"));
    symlinkSync("../..", join(fixture, "d00", "nested", "cycle"));
    const current = readFileSync(join(repo, "files-widget", "browser.ts"), "utf8");
    const actual = await exercise(current, fixture, "current");
    console.log("current:", JSON.stringify({ maximum: actual.maximum, missingScanActivity: actual.missingScanActivity }));
    assert.deepEqual(actual.maximum, { scan: 1, count: 1 });
    assert.equal(actual.missingScanActivity, 0, "scanning must remain visible during in-flight I/O");
    assert.ok(actual.collapsed.some(line => line.includes("linked-dir") && line.includes("↗")));
    assert.ok(actual.collapsed.some(line => line.includes("linked-file.txt") && line.includes("↗")));
    assert.ok(actual.searched.some(line => line.includes("deep.txt")), "search must include nested descendants");
    if (process.env.BROWSER_BATCH_BASELINE) {
      const baseline = execFileSync("git", ["show", `${process.env.BROWSER_BATCH_BASELINE}:files-widget/browser.ts`], { cwd: repo, encoding: "utf8" });
      const before = await exercise(baseline, fixture, "baseline");
      console.log("baseline:", JSON.stringify({ maximum: before.maximum, missingScanActivity: before.missingScanActivity }));
      assert.ok(before.maximum.scan > 1, "baseline must reproduce overlapping scan batches");
      assert.ok(before.maximum.count > 1, "baseline must reproduce overlapping count batches");
      assert.deepEqual(actual.collapsed, before.collapsed);
      assert.deepEqual(actual.searched, before.searched);
      console.log("old/new collapsed and nested-search renders: identical (nested directories, file/directory symlinks, ancestor cycle)");
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
