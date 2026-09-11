import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertLocalFileExists,
  fromRoot,
  readManifest,
  readProjectFile
} from "./helpers/project.mjs";

const EXPECTED_BRAND = "Mike-Autodownload";
const EXPECTED_PERMISSIONS = [
  "alarms",
  "downloads",
  "notifications",
  "scripting",
  "sidePanel",
  "storage",
  "tabs"
];
const EXPECTED_REQUIRED_HOSTS = [
  "https://*.savefrom.net/*",
  "https://*.youtube.com/*",
  "https://facebook.com/*",
  "https://snapany.com/*",
  "https://snapdouyin.app/*",
  "https://snapinsta.app/*",
  "https://snapsave.app/*",
  "https://snaptik.app/*",
  "https://so9.vn/*",
  "https://ssstik.io/*",
  "https://tiktok.com/*",
  "https://www.facebook.com/*",
  "https://www.tiktok.com/*",
  "https://youtu.be/*"
];

test("manifest is a valid MV3 entry point with the supported Chrome baseline", async () => {
  const manifest = await readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, EXPECTED_BRAND);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.parseInt(manifest.minimum_chrome_version, 10) >= 114, "sidePanel requires Chrome 114 or newer");
  assert.equal(manifest.background?.type, "module");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
  assert.equal(manifest.action?.default_title, EXPECTED_BRAND);
  assert.equal(manifest.side_panel?.default_path, "popup.html");
  assert.equal(manifest.options_page, "options.html");

  assert.deepEqual([...(manifest.permissions || [])].sort(), EXPECTED_PERMISSIONS, "Permission changes require an explicit contract review");

  const packageJson = JSON.parse(await readProjectFile("package.json"));
  assert.equal(packageJson.version, manifest.version, "package.json and manifest.json versions must stay in sync");
});

test("manifest references only project-local files that exist", async () => {
  const manifest = await readManifest();
  const references = new Set([
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => [
      ...(entry.js || []),
      ...(entry.css || [])
    ])
  ].filter(Boolean));

  assert.ok(references.size > 0, "Manifest should reference extension assets");
  for (const reference of references) {
    await assertLocalFileExists(reference, "manifest asset");
  }
});

const DOWNLOADER_SITES = [
  "https://so9.vn/9downloader/*",
  "https://snaptik.app/*",
  "https://ssstik.io/*",
  "https://snapsave.app/*",
  "https://snapinsta.app/*",
  "https://snapdouyin.app/*",
  "https://*.savefrom.net/*",
  "https://snapany.com/*"
];

test("content script injection stays restricted to the declared downloader sites", async () => {
  const manifest = await readManifest();
  const contentScripts = manifest.content_scripts || [];
  assert.ok(contentScripts.length > 0, "SO9 content script registration is required");

  const matches = contentScripts.flatMap((entry) => entry.matches || []);
  assert.ok(matches.includes("https://so9.vn/9downloader/*"));
  assert.ok(matches.every((match) => DOWNLOADER_SITES.includes(match)), `Unexpected content-script match: ${matches.join(", ")}`);
  assert.ok(matches.every((match) => !/^https?:\/\/\*\//.test(match)), "No all-hosts content-script injection");
  assert.ok(contentScripts.some((entry) => entry.js?.includes("content-script.js")));
});

test("host access never grants clear-text HTTP or all-URL injection", async () => {
  const manifest = await readManifest();
  const requiredHosts = manifest.host_permissions || [];
  const optionalHosts = manifest.optional_host_permissions || [];
  const allHosts = [...requiredHosts, ...optionalHosts];

  assert.ok(requiredHosts.includes("https://so9.vn/*"), "SO9 host access is required");
  assert.deepEqual([...requiredHosts].sort(), EXPECTED_REQUIRED_HOSTS, "Required host access must stay minimal and reviewed");
  assert.ok(allHosts.every((pattern) => !pattern.startsWith("http://")), "HTTP host permissions are not allowed");
  assert.ok(!allHosts.includes("<all_urls>"), "<all_urls> is too broad for this extension");
  assert.deepEqual(optionalHosts, ["https://*/*"], "Generic page scanning must remain optional and HTTPS-only");
});

test("declared PNG icons exist and have the declared dimensions", async () => {
  const manifest = await readManifest();
  const icons = manifest.icons || {};
  assert.deepEqual(Object.keys(icons).sort((a, b) => Number(a) - Number(b)), ["16", "32", "48", "128"]);
  assert.deepEqual(manifest.action?.default_icon, icons, "Toolbar and extension icons must stay in sync");

  for (const [declaredSize, relativePath] of Object.entries(icons)) {
    const bytes = await readFile(fromRoot(relativePath));
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${relativePath} is not a PNG`);
    assert.equal(bytes.readUInt32BE(16), Number(declaredSize), `${relativePath} has the wrong width`);
    assert.equal(bytes.readUInt32BE(20), Number(declaredSize), `${relativePath} has the wrong height`);
  }
});
