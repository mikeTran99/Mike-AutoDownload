// Read-only audit probes. No browser, network, real downloads, or source-file writes.
// Known baseline syntax defects may be repaired IN MEMORY only with the explicit flag.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as mediaPolicy from "../src/shared/media-policy.js";
import { collectPageMedia, selectMediaCandidate } from "../src/shared/media-scanner.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerPath = "src/background/service-worker.js";
const workerRaw = await readFile(path.join(root, workerPath), "utf8");
const contentRaw = await readFile(path.join(root, "src/content/content-script.js"), "utf8");
const report = { node: process.version, syntax: [], syntaxRepairsInMemory: [], probes: [] };

async function javaScriptFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await javaScriptFiles(filename));
    else if (entry.name.endsWith(".js")) result.push(filename);
  }
  return result.sort();
}

for (const filename of await javaScriptFiles(path.join(root, "src"))) {
  const source = await readFile(filename, "utf8");
  const module = /^\s*(?:import|export)\s/m.test(source);
  const checked = spawnSync(process.execPath, [module ? "--input-type=module" : "--input-type=commonjs", "--check"], {
    input: source, encoding: "utf8"
  });
  report.syntax.push({
    file: path.relative(root, filename).replaceAll("\\", "/"),
    mode: module ? "module" : "classic",
    status: checked.status === 0 && !checked.error ? "pass" : "finding",
    ...(checked.status === 0 && !checked.error ? {} : { diagnostic: String(checked.error || checked.stderr).trim() })
  });
}

let worker = workerRaw;
const knownInvalidLevel = String.raw`\"info\"`;
if (report.syntax.some((entry) => entry.status !== "pass")) {
  if (!process.argv.includes("--allow-baseline-syntax-repair")) {
    report.note = "Logic probes skipped. Use --allow-baseline-syntax-repair for the three documented in-memory corrections; source files stay unchanged.";
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    worker = workerRaw.split("\n").map((line, index) => {
      if (!line.includes(knownInvalidLevel)) return line;
      assert.match(line, /if \(!statsOnly\) await appendLog/);
      report.syntaxRepairsInMemory.push(index + 1);
      return line.replace(knownInvalidLevel, '"info"');
    }).join("\n");
  }
}

function event() {
  const listeners = new Set();
  return { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) };
}

function context(initial = {}, source = worker) {
  const store = structuredClone(initial);
  const closedTabs = [];
  let runNumber = 0;
  const chrome = {
    runtime: {
      id: "mike-audit-fixture", lastError: null,
      onMessage: event(), onStartup: event(), onInstalled: event(),
      sendMessage: async () => {}, getURL: (name) => `chrome-extension://mike-audit-fixture/${name}`
    },
    storage: { local: {
      get: async (keys) => structuredClone(Object.fromEntries(keys.map((key) => [key, store[key]]))),
      set: async (patch) => Object.assign(store, structuredClone(patch))
    } },
    alarms: { onAlarm: event(), create: async () => {}, clear: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    notifications: { create: async () => {} },
    downloads: { onCreated: event(), onChanged: event(), onDeterminingFilename: event() },
    tabs: { create: async ({ url }) => ({ id: 7, url }), get: async () => ({ url: "https://so9.vn/9downloader/tiktok" }), remove: async (id) => { closedTabs.push(id); } },
    scripting: { executeScript: async () => [{ result: {
      items: [{ link: "https://www.instagram.com/reel/fixture/", views: 1000 }]
    } }] }
  };
  const sandbox = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder,
    ...mediaPolicy, selectMediaCandidate,
    crypto: { randomUUID: () => `fixture-run-${++runNumber}` },
    t: (text) => text, channelFolderName: () => "fixture",
    document: { title: "Fixture", scripts: [], querySelectorAll: () => [], querySelector: () => null },
    location: { href: "https://example.org/page", hostname: "example.org" },
    performance: { getEntriesByType: () => [] }
  });
  sandbox.collectPageMedia = vm.runInContext("(" + collectPageMedia.toString() + ")", sandbox);
  const prepared = source.replace(/^import .*;\r?\n/gm, "")
    .replace("const workerReady = initializeWorkerState();", "const workerReady = Promise.resolve();")
    .replace(/^workerReady\.then\(\(\) => resumePersistedJob[^\n]+\r?\n/m, "");
  vm.runInContext(prepared, sandbox, { filename: source === contentRaw ? "content-script.audit.js" : "service-worker.audit.js" });
  return { sandbox, store, closedTabs, evaluate: (code) => vm.runInContext(code, sandbox) };
}

async function probe(id, name, expected, run) {
  try {
    const actual = await run();
    let status = "pass";
    try { assert.deepEqual(actual, expected); } catch { status = "finding"; }
    report.probes.push({ id, name, status, expected, actual });
  } catch (error) {
    report.probes.push({ id, name, status: "probe_error", error: error.message });
  }
}

if (!report.note) {
  await probe("A02", "Unrelated log export must not be claimed as the requested media", false, () => {
    const c = context();
    return c.evaluate(`matchesTriggeredDownload({
      id: 99, byExtensionId: chrome.runtime.id, startTime: new Date().toISOString(),
      url: "blob:chrome-extension://mike-audit-fixture/export", filename: "so9-log.txt"
    }, { knownIds: new Set(), startedAt: Date.now(), expectedHosts: ["so9.vn"] })`);
  });

  await probe("A03", "Text and playlists must fail video validation", { text: false, playlist: false }, () => {
    const c = context();
    return JSON.parse(c.evaluate(`JSON.stringify(Object.fromEntries([
      ["text", "text/plain", "log.txt"], ["playlist", "application/vnd.apple.mpegurl", "master.m3u8"]
    ].map(([name, mime, filename]) => {
      try { validateDownloadedItem({ state: "complete", mime, filename, totalBytes: 100, fileSize: 100, danger: "safe" }); return [name, true]; }
      catch { return [name, false]; }
    })))`));
  });

  await probe("A03b", "A CDN playlist must not be treated as a direct media file", false, () => {
    const c = context({}, contentRaw);
    return c.evaluate('isDirectMediaUrl("https://cdn.example.org/media/master.m3u8")');
  });

  await probe("A04", "Higher resolution must not override requested media identity", "https://cdn.example.org/target-480p.mp4", () => {
    const c = context();
    return c.evaluate(`chooseBestMediaCandidate([
      { url: "https://cdn.example.org/target-480p.mp4", quality: 480, score: 580, mediaId: "requested" },
      { url: "https://cdn.example.org/advert-1080p.mp4", quality: 1080, score: 1180, mediaId: "advert" }
    ], { mediaId: "requested" }).url`);
  });

  await probe("A05", "A playing direct video with an extensionless URL must be discoverable", 1, () => {
    const c = context();
    const video = {
      currentSrc: "https://cdn.example.org/videoplayback?id=fixture", src: "",
      videoWidth: 1280, videoHeight: 720, getAttribute: () => null, querySelectorAll: () => []
    };
    c.sandbox.document.querySelectorAll = (selector) => selector === "video" ? [video] : [];
    return c.evaluate("collectDirectMediaCandidates().candidates.length");
  });

  await probe("A06", "A channel scan must retain the existing queue and deduplicate history", { retainedOldQueue: true, historyItemStatus: "skipped" }, async () => {
    const c = context({
      queue: [{ id: "existing", link: "https://example.org/old.mp4", status: "pending" }],
      downloadHistory: { "https://www.instagram.com/reel/fixture/": { time: 1, filename: "fixture.mp4" } }
    });
    c.evaluate('waitForTabComplete = async () => {}; sleep = async () => {}; readProfileHeader = async () => ({ name: "fixture" }); startRunQueueAfterCrawl = async () => {};');
    await c.evaluate(`crawlPublicProfile({ sourceUrl: "https://www.instagram.com/fixture/reels/",
      maxCount: 10, folder: "fixture", minViews: 0, platform: "instagram", label: "Instagram",
      itemLabel: "video", downloaderUrl: "https://so9.vn/9downloader/insta", pageFunction: () => {},
      waitAfterLoadMs: 0, blockedMessage: "blocked" })`);
    return {
      retainedOldQueue: c.store.queue.some((item) => item.id === "existing"),
      historyItemStatus: c.store.queue.find((item) => item.link.endsWith("/fixture/"))?.status
    };
  });

  await probe("A07", "Successful download recovery must close its owned provider tab", true, async () => {
    const c = context({ queue: [{ id: "active", link: "https://example.org/fixture.mp4", status: "running" }] });
    c.evaluate(`currentJob = { ...createIdleJobState(), runId: "fixture", status: "running",
      activeItemId: "active", activeTabId: 7, activeTabUrl: "https://so9.vn/9downloader/tiktok", activeDownloadIds: [11] };
      currentRunId = "fixture"; runLock = true;
      waitForDownloadId = async () => ({ id: 11, filename: "fixture.mp4" });`);
    await c.evaluate('recoverActiveItem({ id: "active", link: "https://example.org/fixture.mp4" }, "fixture", 90000, "fixture")');
    return c.closedTabs.includes(7);
  });

  await probe("A08", "Concurrent START_RUN requests must start at most one job", 1, async () => {
    const c = context({ queue: [{ id: "fixture", link: "https://example.org/fixture.mp4", status: "pending" }] });
    c.evaluate("launchRunner = () => {}; publishState = async () => {};");
    const responses = await c.evaluate('Promise.all([handleMessage({ type: "START_RUN" }), handleMessage({ type: "START_RUN" })])');
    return responses.filter((response) => response.ok).length;
  });

  await probe("A11", "Douyin Chinese count units must use 10,000 and 100,000,000", { followers: 12000, likes: 120000000 }, () => {
    const c = context();
    c.sandbox.location.hostname = "www.douyin.com";
    c.sandbox.document.body = { innerText: "粉丝 1.2万 获赞 1.2亿" };
    c.sandbox.document.querySelector = () => null;
    return JSON.parse(c.evaluate('JSON.stringify((({ followers, likes }) => ({ followers, likes }))(readProfileHeaderInPage()))'));
  });

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.syntax.some((entry) => entry.status !== "pass") || report.probes.some((entry) => entry.status !== "pass") ? 1 : 0;
}
