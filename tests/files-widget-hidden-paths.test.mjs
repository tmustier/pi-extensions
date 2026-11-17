import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
const { buildFileTreeFromPaths, flattenTree, getIgnoredNames } = await jiti.import("../files-widget/file-tree.ts");
const { createFileBrowser } = await jiti.import("../files-widget/browser.ts");
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "files-widget-hidden-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, path) {
  const parts = path.split("/");
  parts.pop();
  mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, path), "test\n");
}

function search(browser, query) {
  browser.handleInput("/");
  browser.handleInput(query);
  browser.handleInput("\r");
  return browser.render(180).slice(2).filter(line => !line.includes("(no files")).join("\n");
}

async function waitFor(browser, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate(browser.render(180).join("\n"))) return;
    await sleep(25);
  }
  assert.fail("browser did not render the expected paths before timeout");
}

test("git file trees include dotfiles and nested hidden directories but keep explicit exclusions", t => {
  const root = fixture(t);
  const visible = [".github/workflows/check.yml", ".config/.nested/settings.json", ".gitignore"];
  const excluded = [".git/config", "node_modules/pkg/index.js", ".cache/data", ".env"];
  for (const path of [...visible, ...excluded]) write(root, path);
  const status = new Map([[visible[0], "M"]]);
  const stats = new Map([[visible[0], { additions: 2, deletions: 1 }]]);
  const tree = buildFileTreeFromPaths(root, [...visible, ...excluded], status, stats, getIgnoredNames(), new Set());
  const nodes = flattenTree(tree, 0, true, true).map(({ node }) => node);
  for (const path of visible) assert.ok(nodes.some(node => node.path === join(root, path)), path);
  for (const path of excluded) assert.ok(!nodes.some(node => node.path === join(root, path)), path);
  assert.equal(nodes.find(node => node.name === "check.yml").gitStatus, "M");
  assert.equal(nodes.find(node => node.name === ".github").hasChangedChildren, true);
  assert.equal(nodes.find(node => node.name === ".github").totalAdditions, 2);
});

test("non-git browsing scans and searches hidden paths while excluding generated directories", async t => {
  const root = fixture(t);
  for (const path of [".github/.nested/check.yml", ".gitignore", ".git/config", "node_modules/pkg/index.js", ".cache/data"]) write(root, path);
  const browser = createFileBrowser(root, new Set(), theme, () => {}, () => {}, () => {});
  t.after(() => browser.handleInput("q"));
  await waitFor(browser, output => output.includes(".github") && !/scanning|counts/.test(output));
  const listing = browser.render(180).join("\n");
  assert.ok(listing.includes(".gitignore"));
  assert.ok(!listing.includes("node_modules"));
  assert.ok(!listing.includes(".cache"));
  assert.ok(search(browser, "check.yml").includes("check.yml"));
  assert.ok(!search(browser, "config").includes("config"));
});

test("git polling adds newly created hidden directories and dotfiles", async t => {
  const root = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "status.showUntrackedFiles", "all");
  write(root, "seed.txt");
  git("add", "seed.txt");
  const browser = createFileBrowser(root, new Set(), theme, () => {}, () => {}, () => {});
  t.after(() => browser.handleInput("q"));
  await waitFor(browser, output => output.includes("seed.txt") && !/scanning|counts/.test(output));
  write(root, ".github/.nested/check.yml");
  write(root, ".hidden-file");
  await waitFor(browser, output => output.includes(".github") && output.includes(".hidden-file"));
  assert.ok(search(browser, "check.yml").includes("check.yml"));
});
