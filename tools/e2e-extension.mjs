import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const moduleIndex = process.argv.indexOf("--playwright");
const playwrightPath = moduleIndex >= 0 ? process.argv[moduleIndex + 1] : process.env.CODEX_PLAYWRIGHT_PATH || "playwright";
const { chromium } = require(playwrightPath);
const executableIndex = process.argv.indexOf("--executable");
const executablePath = executableIndex >= 0 ? process.argv[executableIndex + 1] : undefined;
const output = path.join(root, "docs", "qa");
const tempRoot = path.join(root, "tmp");
await mkdir(output, { recursive: true });
await mkdir(tempRoot, { recursive: true });
const profile = await mkdtemp(path.join(tempRoot, "chromium-media-"));
const report = { browser: "", profile: "isolated temporary Chromium profile", checks: [], ui: [], liveTikTok: null };
const errors = [];
const fixtureFiles = {
  "/movie.mp4": { mime: "video/mp4", bytes: Buffer.from([0,0,0,24,102,116,121,112,109,112,52,50,0,0,0,0,109,112,52,50,105,115,111,109]) },
  "/song.mp3": { mime: "audio/mpeg", bytes: Buffer.from("ID3fixture audio byte transport") },
  "/cover.png": { mime: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=", "base64") },
  "/captions.vtt": { mime: "text/vtt", bytes: Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nFixture subtitle\n") },
  "/bad.mp4": { mime: "text/html", bytes: Buffer.from("<html>Authentication required</html>") },
  "/master.m3u8": { mime: "application/vnd.apple.mpegurl", bytes: Buffer.from("#EXTM3U\nsegment.ts\n") }
};
const server = createServer((request, response) => {
  const item = fixtureFiles[new URL(request.url, "http://localhost").pathname];
  if (!item) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": item.mime, "Content-Length": item.bytes.length });
  response.end(item.bytes);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = "http://127.0.0.1:" + server.address().port;
let context;
try {
  const extension = path.join(root, "src");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, acceptDownloads: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
    downloadsPath: path.join(profile, "downloads")
  });
  report.browser = context.browser()?.version() || "Chromium";
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // Playwright's allowAndName replaces filenames with GUIDs. Use Chromium's normal
  // allow mode to exercise the actual extension's filename and MIME validation.
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: path.join(profile, "downloads"), eventsEnabled: true
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("chrome-extension://" + extensionId + "/popup/popup.html");
  await page.waitForSelector("#scanMediaBtn");
  async function waitForQueueFinished(count, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => chrome.storage.local.get(["queue", "runState", "logs", "downloadHistory"]));
      if (state.queue?.length === count && !state.runState?.running &&
        state.queue.every((item) => ["success", "failed", "unsupported"].includes(item.status))) return state;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Queue did not finish within " + timeout + " ms");
  }
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, "popup-" + width + ".png"), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "Horizontal overflow at " + width);
    report.ui.push({ width, horizontalOverflow: overflow });
  }
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.locator("#manualLinks").fill(Object.keys(fixtureFiles).filter((name) => name !== "/master.m3u8").map((name) => fixtureOrigin + name).join("\n"));
  await page.locator("#importTextBtn").click();
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 5);
  report.checks.push({ name: "UI imports five media URLs", ok: true });
  await page.locator("#startBtn").click();
  const state = await waitForQueueFinished(5);
  report.transportState = state;
  report.downloads = await page.evaluate(() => chrome.downloads.search({}));
  for (const kind of ["video","audio","image","subtitle"]) {
    const item = state.queue.find((entry) => entry.mediaKind === kind && !entry.link.endsWith("/bad.mp4"));
    assert.equal(item?.status, "success", kind + " Chrome API download must finish");
    report.checks.push({ name: "Chrome download transport " + kind, ok: true });
  }
  assert.equal(state.queue.find((item) => item.link.endsWith("/bad.mp4")).status, "failed");
  report.checks.push({ name: "HTML payload named .mp4 fails validation", ok: true });
  assert.equal(Object.keys(state.downloadHistory).length, 4);
  report.checks.push({ name: "Only validated media enters history", ok: true });
  await page.locator("#manualLinks").fill(fixtureOrigin + "/song.mp3");
  await page.locator("#importTextBtn").click();
  assert.equal(await page.locator(".queue-item").count(), 5);
  report.checks.push({ name: "Repeated UI import preserves queue without duplicate", ok: true });
  const scan = { sourceUrl: "https://example.org/fixture", candidates: [
    { url:"https://cdn.example.org/movie.mp4", kind:"video", filename:"Video 720p.mp4", qualityLabel:"720p", source:"fixture" },
    { url:"https://cdn.example.org/song.mp3", kind:"audio", filename:"Audio.mp3", source:"fixture" },
    { url:"https://cdn.example.org/cover.jpg", kind:"image", filename:"Cover.jpg", source:"fixture" },
    { url:"https://cdn.example.org/sub.vtt", kind:"subtitle", filename:"Sub.vtt", source:"fixture" }
  ] };
  await page.evaluate(async (scan) => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) => message.type === "SCAN_MEDIA_PAGE" ? Promise.resolve({ ok:true, scan }) : original(message);
    chrome.permissions.request = async () => true;
  }, scan);
  await page.locator("#manualLinks").fill("https://example.org/fixture");
  await page.locator("#scanMediaBtn").click();
  await page.waitForSelector("#mediaDialog[open]");
  await page.locator('.media-choice input[data-index="1"]').check();
  await page.locator('.media-choice input[data-index="2"]').check();
  await page.screenshot({ path: path.join(output, "media-selection.png") });
  await page.locator("#mediaAddBtn").click();
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 7);
  const choices = await page.evaluate(() => chrome.storage.local.get(["queue"]));
  assert.deepEqual(choices.queue.slice(-2).map((item) => item.mediaKind), ["audio","image"]);
  report.checks.push({ name: "Preview UI selects only checked audio and image (scan response fixture)", ok: true });
  await page.locator("#themeToggle").click();
  await page.screenshot({ path: path.join(output, "popup-light.png"), fullPage:true });
  report.checks.push({ name: "Light theme and media dialog render", ok: true });
  const liveIndex = process.argv.indexOf("--live-tiktok");
  if (liveIndex >= 0) {
    const link = process.argv[liveIndex + 1];
    await page.evaluate(() => chrome.runtime.sendMessage({ type:"QUEUE_CLEAR" }));
    await page.locator("#manualLinks").fill(link);
    await page.locator("#importTextBtn").click();
    await page.locator("#startBtn").click();
    const live = await waitForQueueFinished(1, 120000);
    report.liveTikTok = { link, queue:live.queue, logs:live.logs };
  }
  assert.deepEqual(errors, []);
  report.checks.push({ name: "Popup has no uncaught JavaScript errors", ok: true });
  report.notes = [
    "Uses real MV3 worker, popup, storage and Chrome Downloads API in isolated Chromium.",
    "Local binary fixture transport tests metadata validation; MP4/MP3 fixtures are not playable content.",
    "Preview scanner response is a fixture; live site extraction is tested separately.",
    "Screenshots have no previous committed baseline; visual regression verdict is inconclusive.",
    "This is not verification of every website or of the user's existing Chrome profile."
  ];
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  report.consoleErrors = errors;
  await writeFile(path.join(output, "e2e-result.json"), JSON.stringify(report, null, 2) + "\n");
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
  // Check resolved target before recursive deletion on Windows.
  if (path.resolve(profile).startsWith(path.resolve(tempRoot) + path.sep)) await rm(profile, {recursive:true,force:true});
}
console.log(JSON.stringify(report, null, 2));
