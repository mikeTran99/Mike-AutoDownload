import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  assertAppearsInOrder,
  extractFunction,
  fromRoot,
  readManifest,
  readProjectFile
} from "./helpers/project.mjs";

const RUNTIME_FILES = ["popup.js", "service-worker.js", "content-script.js", "options.js"];
const EXPECTED_BRAND = "Mike-AutomationAI";

test("all extension JavaScript passes the Node syntax parser", () => {
  for (const relativePath of RUNTIME_FILES) {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["--check", fromRoot(relativePath)], {
        encoding: "utf8",
        stdio: "pipe"
      });
    }, `${relativePath} has invalid JavaScript syntax`);
  }
});

test("MV3 job state is persisted and has restart recovery hooks", async () => {
  const worker = await readProjectFile("service-worker.js");
  const updateJobState = extractFunction(worker, "updateJobState");
  const handleMessage = extractFunction(worker, "handleMessage");

  assert.match(worker, /const JOB_STATE_KEY\s*=\s*["']jobState["']/);
  assert.match(worker, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(worker, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(worker, /chrome\.alarms\.onAlarm\.addListener/);
  assert.match(worker, /resumePersistedJob\s*\(/);
  assert.match(updateJobState, /chrome\.storage\.local\.set/);
  assert.match(updateJobState, /JOB_STATE_KEY/);
  assert.match(handleMessage, /runLock\s*\|\|\s*crawlLock/, "Downloader and crawler must be mutually exclusive");
  assert.match(handleMessage, /!runLock\s*&&\s*crawlLock/, "A long crawl must be cancellable from the UI");
  assert.match(handleMessage, /crawlCancelRequested\s*=\s*true/);
});

test("primary UI and documentation surfaces keep the current brand", async () => {
  const [manifest, popupHtml, optionsHtml, readme, userGuide] = await Promise.all([
    readManifest(),
    readProjectFile("popup.html"),
    readProjectFile("options.html"),
    readProjectFile("README.md"),
    readProjectFile("docs/USER_GUIDE.md")
  ]);

  assert.equal(manifest.name, EXPECTED_BRAND);
  assert.equal(manifest.action?.default_title, EXPECTED_BRAND);
  assert.match(popupHtml, /<title>\s*Mike-AutomationAI\s*<\/title>/i);
  assert.match(optionsHtml, /<title>[^<]*Mike-AutomationAI[^<]*<\/title>/i);
  assert.match(readme, /^# Mike-AutomationAI\s*$/m);
  assert.match(userGuide, /^# [^\n]*Mike-AutomationAI\s*$/m);
});

test("SO9 path prefers a direct URL and arms fallback listeners before clicking", async () => {
  const worker = await readProjectFile("service-worker.js");
  const processSo9Item = extractFunction(worker, "processSo9Item");
  const fallbackWatcher = extractFunction(worker, "waitForDownloadTriggered");

  assertAppearsInOrder(processSo9Item, [
    "prepared.directUrl",
    "downloadDirectUrl(",
    "prepared.canFallbackClick",
    "waitForDownloadTriggered("
  ], "SO9 direct-download preference");
  assert.match(processSo9Item, /prepared\.directUrl\s*&&\s*!prepared\.isBlobUrl/);
  assertAppearsInOrder(fallbackWatcher, [
    "onDeterminingFilename.addListener",
    "onCreated.addListener",
    "onChanged.addListener",
    "triggerDownload"
  ], "SO9 fallback listener setup");
});

test("fallback downloads are correlated before they can be claimed or renamed", async () => {
  const worker = await readProjectFile("service-worker.js");
  const fallbackWatcher = extractFunction(worker, "waitForDownloadTriggered");
  const matcher = extractFunction(worker, "matchesTriggeredDownload");
  const validator = extractFunction(worker, "validateDownloadedItem");
  const filenameListener = extractFunction(fallbackWatcher, "onDeterminingFilename");

  assertAppearsInOrder(fallbackWatcher, [
    "searchDownloads({ state: \"in_progress\" })",
    "matchesTriggeredDownload(",
    "onDeterminingFilename.addListener"
  ], "fallback download correlation");
  assertAppearsInOrder(filenameListener, [
    "!claimDownload(downloadItem)",
    "suggest()",
    "return"
  ], "unrelated download filename handling");
  assert.match(matcher, /knownIds\.has\(downloadItem\.id\)/);
  assert.match(matcher, /downloadItem\.startTime/);
  assert.match(matcher, /downloadItem\.byExtensionId/);
  assert.match(matcher, /expectedHosts\.some/);
  assert.match(validator, /mime\.startsWith\(["']text\/html["']\)/);
  assert.match(validator, /mime\.startsWith\(["']image\/["']\)/);
  assert.match(validator, /totalBytes\s*===\s*0/);
});

test("timeouts and stop requests cancel tracked Chrome downloads", async () => {
  const worker = await readProjectFile("service-worker.js");
  const directWaiter = extractFunction(worker, "waitForDownloadId");
  const fallbackWatcher = extractFunction(worker, "waitForDownloadTriggered");
  const abortActiveWork = extractFunction(worker, "abortActiveWork");

  assert.match(directWaiter, /setTimeout[\s\S]*cancelDownload\(downloadId\)/);
  assert.match(fallbackWatcher, /shouldCancel[\s\S]*cancelDownload\(watchedId\)/);
  assert.match(fallbackWatcher, /const stopPoll\s*=\s*setInterval/);
  assert.match(fallbackWatcher, /clearInterval\(stopPoll\)/);
  assert.match(abortActiveWork, /activeDownloadIds[\s\S]*cancelDownload/);
  assert.match(abortActiveWork, /activeDownloadIds\.clear\(\)/);
});

test("legacy queue items can derive missing optional host permissions", async () => {
  const popup = await readProjectFile("popup.js");
  const permissionBlock = extractFunction(popup, "ensureDirectMediaPermissions");

  assert.match(permissionBlock, /item\.permissionOrigin\s*\|\|\s*derivePermissionOrigin\(item\)/);
  assert.match(popup, /function derivePermissionOrigin\(item\)/);
  assert.match(popup, /return TELEGRAM_WEB_ORIGIN/);
});

test("channel crawling supports unlimited multi-platform collection", async () => {
  const [popup, worker, popupHtml, guide] = await Promise.all([
    readProjectFile("popup.js"),
    readProjectFile("service-worker.js"),
    readProjectFile("popup.html"),
    readProjectFile("docs/USER_GUIDE.md")
  ]);
  const normalizeMaxReels = extractFunction(popup, "normalizeMaxReels");
  const normalizeChannelUrl = extractFunction(popup, "normalizeChannelUrl");
  const detectRoute = extractFunction(popup, "detectRoute");
  const migrateQueueEntries = extractFunction(popup, "migrateQueueEntries");
  const dispatch = extractFunction(worker, "crawlChannelVideos");
  const migrateQueueItem = extractFunction(worker, "migrateQueueItem");
  const directMediaProcessor = extractFunction(worker, "processDirectMediaPage");
  const facebookCrawler = extractFunction(worker, "crawlFacebookReelsInPage");
  const tiktokCrawler = extractFunction(worker, "crawlTikTokVideosInPage");
  const publicCrawler = extractFunction(worker, "crawlPublicVideoLinksInPage");

  assert.match(normalizeMaxReels, /if\s*\(!raw\)\s*return\s+null/);
  assert.match(normalizeChannelUrl, /normalizeInstagramChannelUrl/);
  assert.match(normalizeChannelUrl, /normalizeDouyinChannelUrl/);
  assert.match(detectRoute, /detectStoryRoute\(url, hostname\)/);
  assert.match(popup, /function detectStoryRoute\(url, hostname\)/);
  assert.match(popup, /function detectInstagramMediaRoute\(url, hostname\)/);
  assert.match(popup, /story_fbid/);
  assert.match(migrateQueueEntries, /item\.strategy\s*!==\s*"so9"/);
  assert.match(migrateQueueItem, /strategy:\s*"direct-media"/);
  assert.match(directMediaProcessor, /isStoryPageItem\(item\)/);
  assert.match(directMediaProcessor, /prepareStoryVideoSurface/);
  assert.match(directMediaProcessor, /waitForDirectMediaCandidate/);
  assert.match(dispatch, /platform === "instagram"/);
  assert.match(dispatch, /platform === "douyin"/);
  assert.match(facebookCrawler, /const unlimited\s*=\s*limit\s*===\s*null/);
  assert.match(tiktokCrawler, /const unlimited\s*=\s*limit\s*===\s*null/);
  assert.match(publicCrawler, /const unlimited\s*=\s*limit\s*===\s*null/);
  assert.match(publicCrawler, /instagram\.com/);
  assert.match(publicCrawler, /douyin\.com/);
  assert.match(facebookCrawler, /staleScrolls\s*>=\s*6/);
  assert.match(tiktokCrawler, /staleScrolls\s*>=\s*7/);
  assert.match(popupHtml, /Facebook \/ TikTok \/ Instagram \/ Douyin/i);
  assert.match(popupHtml, /placeholder="Toàn bộ"/i);
  assert.match(guide, /để trống để quét toàn bộ/i);
});

test("SO9 preparation and final fallback click remain separate content-script commands", async () => {
  const contentScript = await readProjectFile("content-script.js");
  const prepareDownload = extractFunction(contentScript, "prepareDownload");
  const clickFinalDownload = extractFunction(contentScript, "clickFinalDownload");

  assert.match(contentScript, /PREPARE_DOWNLOAD\s*:\s*\(\)\s*=>\s*prepareDownload/);
  assert.match(contentScript, /CLICK_FINAL_DOWNLOAD\s*:\s*\(\)\s*=>\s*clickFinalDownload/);
  assert.match(prepareDownload, /waitForDownloadCandidate/);
  assert.doesNotMatch(prepareDownload, /clickFinalDownload\s*\(/, "Preparation must not invoke the final fallback click");
  assert.match(clickFinalDownload, /clickLikeHuman\s*\(/);
});

test("each SO9 and Telegram click helper performs exactly one click activation", async () => {
  const [contentScript, worker] = await Promise.all([
    readProjectFile("content-script.js"),
    readProjectFile("service-worker.js")
  ]);
  const helpers = [
    ["clickLikeHuman", extractFunction(contentScript, "clickLikeHuman")],
    ["clickTelegramVideoPreview", extractFunction(worker, "clickTelegramVideoPreview")],
    ["clickVisibleTelegramDownloadControl", extractFunction(worker, "clickVisibleTelegramDownloadControl")]
  ];
  const activationPattern = /dispatchEvent\s*\(\s*new MouseEvent\s*\(\s*["']click["']|\.click(?:\?\.)?\s*\(/g;

  for (const [name, body] of helpers) {
    const activations = body.match(activationPattern) || [];
    assert.equal(activations.length, 1, `${name} must activate its target exactly once`);
  }
});

test("direct-media code retains explicit blob/data and HLS/DASH rejection", async () => {
  const [worker, popup, userGuide] = await Promise.all([
    readProjectFile("service-worker.js"),
    readProjectFile("popup.js"),
    readProjectFile("docs/USER_GUIDE.md")
  ]);
  const runtime = `${worker}\n${popup}`;

  assert.match(runtime, /\^blob:/i, "Runtime must explicitly reject blob URLs");
  assert.match(runtime, /\^data:/i, "Runtime must explicitly reject data URLs");
  assert.match(runtime, /m3u8\|mpd/i, "Runtime must explicitly reject HLS/DASH playlists");
  assert.match(userGuide, /không ghép HLS\/DASH/i);
  assert.match(userGuide, /không tải blob stream/i);
});

test("runtime contains no remote-code or stream-stitching primitives", async () => {
  const sources = await Promise.all(RUNTIME_FILES.map(readProjectFile));
  const runtime = sources.join("\n");
  const forbidden = [
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "new Function"],
    [/\bWebAssembly\.(?:compile|instantiate)/, "WebAssembly runtime compilation"],
    [/\bnew\s+MediaSource\s*\(/, "MediaSource stitching"],
    [/\.addSourceBuffer\s*\(/, "SourceBuffer stitching"],
    [/EXT-X-(?:KEY|MAP|MEDIA-SEQUENCE)/i, "HLS segment parsing"],
    [/\b(?:widevine|playready|fairplay)\b/i, "DRM integration"],
    [/\bffmpeg\b/i, "media segment processing"]
  ];

  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(runtime, pattern, `${label} is outside this project's safety scope`);
  }
});

test("HTML pages do not load executable code from remote origins", async () => {
  const pages = await Promise.all(["popup.html", "options.html"].map(readProjectFile));
  for (const page of pages) {
    assert.doesNotMatch(page, /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i);

    const inlineScripts = page.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of inlineScripts) {
      assert.equal(match[1].trim(), "", "Keep extension scripts in local JavaScript files");
    }
  }
});
