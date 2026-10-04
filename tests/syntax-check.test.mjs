import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fromRoot } from "./helpers/project.mjs";

const packageInfo = JSON.parse(await readFile(fromRoot("package.json"), "utf8"));
const moduleFiles = [
  "background/service-worker.js",
  "popup/popup.js",
  "options/options.js",
  "shared/i18n.js",
  "shared/analytics.js"
];
const validFiles = Object.fromEntries(moduleFiles.map((filename) => [filename,
  'export const fixture = await Promise.resolve(1);\nthrow new Error("Syntax checks must not execute modules");\n'
]));
validFiles["content/content-script.js"] = 'const legacyNumber = 010;\nthrow new Error("Syntax checks must not execute scripts");\n';

async function checkFixture(t, overrides = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "mike-syntax-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify(packageInfo));
  for (const [filename, source] of Object.entries({ ...validFiles, ...overrides })) {
    const absolutePath = path.join(fixtureRoot, "src", filename);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source);
  }
  await mkdir(path.join(fixtureRoot, "tools"));
  try {
    await copyFile(fromRoot("tools/check-syntax.mjs"), path.join(fixtureRoot, "tools/check-syntax.mjs"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Run the configured command, including its exit status, rather than inspecting its text.
  const result = spawnSync(packageInfo.scripts["check:syntax"], {
    cwd: fixtureRoot,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}` }
  });
  assert.ifError(result.error);
  return { ...result, output: `${result.stdout}\n${result.stderr}`.replaceAll("\\", "/") };
}

function assertRejected(result, filename) {
  assert.notEqual(result.status, 0, `${filename} must cause the configured check to fail`);
  assert.match(result.output, /SyntaxError/, "A parse error should explain the failure");
  assert.ok(result.output.includes(`src/${filename}`), `The diagnostic must identify src/${filename}`);
}

test("syntax command accepts valid modules and classic scripts without executing them", async (t) => {
  const result = await checkFixture(t);
  assert.equal(result.status, 0, result.output);
});

test("syntax command fails for malformed escaped quotes in a module", async (t) => {
  const filename = "background/service-worker.js";
  const result = await checkFixture(t, {
    [filename]: String.raw`import "../shared/i18n.js";
await appendLog(\"info\", "fixture");`
  });
  assertRejected(result, filename);
});

test("syntax command fails for invalid classic-script syntax", async (t) => {
  const filename = "content/content-script.js";
  assertRejected(await checkFixture(t, { [filename]: "const broken = ;" }), filename);
});

test("syntax command rejects module exports in content scripts", async (t) => {
  const filename = "content/content-script.js";
  assertRejected(await checkFixture(t, { [filename]: "export const fixture = 1;" }), filename);
});

test("syntax command rejects top-level return in browser content scripts", async (t) => {
  const filename = "content/content-script.js";
  assertRejected(await checkFixture(t, { [filename]: "return;" }), filename);
});

for (const filename of moduleFiles) {
  test(`syntax command enforces module syntax for ${filename} without import or export`, async (t) => {
    assertRejected(await checkFixture(t, { [filename]: "with ({}) {}" }), filename);
  });
}

test("syntax command recursively checks additional JavaScript files", async (t) => {
  const filename = "shared/nested/new-feature.js";
  assertRejected(await checkFixture(t, { [filename]: "const broken = ;" }), filename);
});
