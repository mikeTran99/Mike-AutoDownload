import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { runtime } from "./helpers/runtime.mjs";

const existingItem = { id: "existing", link: "https://example.org/existing.mp4", platform: "direct", strategy: "direct-url", status: "pending" };

function message(c, value, sender = { id: c.chrome.runtime.id }) {
  return new Promise((resolve) => c.chrome.runtime.onMessage.emit(value, sender, resolve));
}

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => { for (const listener of listeners) listener(...args); }
  };
}

function completeTabs(c, url) {
  c.chrome.tabs.onUpdated = event();
  c.chrome.tabs.onRemoved = event();
  c.chrome.tabs.get = (id, callback) => {
    const tab = { id, url, status: "complete" };
    callback?.(tab);
    return Promise.resolve(tab);
  };
}

function job(patch = {}) {
  return {
    schemaVersion: 1, runId: "fixture-run", status: "running", folder: "fixture",
    itemIds: ["existing"], nextIndex: 0, activeItemId: "existing", activeTabId: 7,
    activeTabUrl: "https://so9.vn/9downloader/tiktok", activeDownloadIds: [41],
    stage: "downloading", deadlineAt: Date.now() + 2000, startedAt: Date.now(),
    updatedAt: Date.now(), mediaKind: "video", ...patch
  };
}

function video(patch = {}) {
  return {
    id: 41, state: "complete", filename: "fixture/clip.mp4", mime: "video/mp4",
    url: "https://cdn.example.org/clip.mp4", finalUrl: "https://cdn.example.org/clip.mp4",
    totalBytes: 100, fileSize: 100, danger: "safe", startTime: new Date().toISOString(),
    ...patch
  };
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail(description);
}

test("simultaneous START_RUN messages accept one job and create one download", async () => {
  const c = await runtime({ queue: [existingItem] });
  const replies = await Promise.all([message(c, { type: "START_RUN" }), message(c, { type: "START_RUN" })]);
  assert.equal(replies.filter((reply) => reply.ok).length, 1);
  await c.evaluate("runnerPromise");
  assert.equal(c.downloads.length, 1);
  assert.equal(c.store.queue[0].status, "success");
  assert.equal(c.store.jobState.status, "idle");
});

test("failed START_RUN storage rolls back its reservation so a later start can succeed", async () => {
  const c = await runtime({ queue: [existingItem] });
  const save = c.chrome.storage.local.set;
  let failOnce = true;
  c.chrome.storage.local.set = async (patch) => {
    if (failOnce && patch.jobState?.status === "running") {
      failOnce = false;
      throw new Error("fixture quota failure");
    }
    return await save(patch);
  };
  const rejected = await message(c, { type: "START_RUN" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /fixture quota failure/);
  assert.equal(c.store.jobState.status, "idle");
  assert.equal(c.downloads.length, 0);
  const accepted = await message(c, { type: "START_RUN" });
  assert.equal(accepted.ok, true, accepted.error);
  await c.evaluate("runnerPromise");
  assert.equal(c.downloads.length, 1);
  assert.equal(c.store.queue[0].status, "success");
});

for (const [downloadState, expectedStatus] of [["complete", "success"], ["interrupted", "failed"]]) {
  test(`restart recovers a ${downloadState} download and closes its owned provider tab`, async () => {
    const c = await runtime({ queue: [{ ...existingItem, status: "running" }], jobState: job() });
    completeTabs(c, "https://so9.vn/9downloader/tiktok");
    c.downloads.push(video({ state: downloadState, ...(downloadState === "interrupted" ? { error: "NETWORK_FAILED" } : {}) }));
    await c.evaluate("initializeWorkerState()");
    await c.evaluate('resumePersistedJob("fixture restart")');
    await c.evaluate("runnerPromise");
    assert.equal(c.store.queue[0].status, expectedStatus);
    assert.deepEqual(c.closedTabs, [7]);
    assert.equal(c.downloads.length, 1, "Recovery must reuse the existing download");
    assert.equal(c.store.jobState.status, "idle");
    assert.equal(c.chrome.downloads.onChanged.size, 0);
  });
}

test("recovery leaves a former owned tab open after the user navigates it elsewhere", async () => {
  const c = await runtime({ queue: [{ ...existingItem, status: "running" }], jobState: job() });
  completeTabs(c, "https://unrelated.example.org/user-page");
  c.downloads.push(video());
  await c.evaluate("initializeWorkerState()");
  await c.evaluate('(async () => recoverActiveItem(await getQueueItem("existing"), "fixture", 1000, "fixture-run"))()');
  assert.equal(c.store.queue[0].status, "success");
  assert.deepEqual(c.closedTabs, []);
});

test("alternate-provider recovery uses the saved download context without creating a duplicate", async () => {
  const provider = "https://snaptik.app/";
  const url = "https://snaptik.app/download/clip.mp4";
  const c = await runtime({
    queue: [{ ...existingItem, status: "running" }],
    jobState: job({ activeDownloadIds: [], activeTabUrl: provider, stage: "waiting-fallback-download",
      downloadContext: { expectedHosts: ["snaptik.app"], expectedUrls: [url], triggeredAt: Date.now() - 100, mediaKind: "video" } })
  });
  completeTabs(c, provider);
  c.downloads.push(video({ url, finalUrl: url, referrer: provider }));
  await c.evaluate("initializeWorkerState()");
  const recovered = await c.evaluate('(async () => recoverActiveItem(await getQueueItem("existing"), "fixture", 1000, "fixture-run"))()');
  assert.equal(recovered.handled, true);
  assert.equal(c.store.queue[0].status, "success");
  assert.deepEqual(c.closedTabs, [7]);
  assert.equal(c.downloads.length, 1);
});

test("provider fallback saves context and arms listeners before a fast click download while ignoring a log export", async () => {
  const provider = "https://snaptik.app/";
  const c = await runtime({ queue: [{ ...existingItem, status: "running" }], jobState: job({ activeDownloadIds: [], activeTabId: null }) });
  completeTabs(c, provider);
  await c.evaluate("initializeWorkerState()");
  let clicks = 0;
  let suggestedMedia;
  c.chrome.tabs.sendMessage = (tabId, command, callback) => {
    if (command.type === "PREPARE_DOWNLOAD") {
      callback({ ok: true, result: { canFallbackClick: true } });
      return;
    }
    assert.equal(command.type, "CLICK_FINAL_DOWNLOAD");
    clicks += 1;
    assert.equal(c.chrome.downloads.onCreated.size, 1);
    assert.equal(c.chrome.downloads.onChanged.size, 1);
    assert.equal(c.chrome.downloads.onDeterminingFilename.size, 1);
    assert.deepEqual(c.store.jobState.downloadContext.expectedHosts, ["snaptik.app"]);
    assert.equal(c.store.jobState.downloadContext.mediaKind, "video");
    assert.ok(c.store.jobState.downloadContext.triggeredAt > 0);
    const log = video({ id: 90, byExtensionId: c.chrome.runtime.id, filename: "so9-log.txt", mime: "text/plain",
      url: "blob:chrome-extension://fixture/export", finalUrl: "blob:chrome-extension://fixture/export" });
    c.chrome.downloads.onDeterminingFilename.emit(log, (suggestion) => assert.equal(suggestion, undefined, "An unrelated export must not be renamed"));
    c.chrome.downloads.onCreated.emit(log);
    const media = video({ url: "https://snaptik.app/download/clip.mp4", finalUrl: "https://snaptik.app/download/clip.mp4", referrer: provider });
    c.downloads.push(media);
    c.chrome.downloads.onDeterminingFilename.emit(media, (suggestion) => { suggestedMedia = suggestion; });
    c.chrome.downloads.onCreated.emit(media);
    c.chrome.downloads.onChanged.emit({ id: media.id, state: { current: "complete" } });
    callback({ ok: true, result: {} });
  };
  const result = await c.evaluate('(async () => processSo9Item(await getQueueItem("existing"), "fixture", Date.now() + 1500, "fixture-run", "https://snaptik.app/"))()');
  assert.equal(result.id, 41);
  assert.equal(clicks, 1);
  assert.equal(suggestedMedia.filename, "fixture/clip.mp4");
  assert.deepEqual(c.closedTabs, [7]);
  assert.equal(c.chrome.downloads.onCreated.size, 0);
  assert.equal(c.chrome.downloads.onChanged.size, 0);
  assert.equal(c.chrome.downloads.onDeterminingFilename.size, 0);
});

test("STOP_RUN cancels an active fallback download and a restarted stopping job returns its item to pending", async () => {
  const c = await runtime({ queue: [{ ...existingItem, status: "running" }], jobState: job({ activeDownloadIds: [] }) });
  completeTabs(c, "https://so9.vn/9downloader/tiktok");
  await c.evaluate("initializeWorkerState()");
  const cancelled = [];
  c.chrome.downloads.cancel = (id, callback) => { cancelled.push(id); callback(); };
  c.sandbox.fixtureTrigger = () => {
    const media = video({ state: "in_progress", url: "https://so9.vn/clip.mp4", finalUrl: "https://so9.vn/clip.mp4" });
    c.downloads.push(media);
    c.chrome.downloads.onCreated.emit(media);
  };
  const waiting = c.evaluate('waitForDownloadTriggered({ downloadFolder: "fixture", timeoutMs: 1500, runId: "fixture-run", expectedHosts: ["so9.vn"], triggerDownload: fixtureTrigger })');
  const rejected = assert.rejects(waiting, /RUN_STOPPED/);
  await waitFor(() => c.store.jobState.activeDownloadIds.includes(41), "The fallback event should checkpoint its download ID");
  assert.equal((await message(c, { type: "STOP_RUN" })).ok, true);
  await rejected;
  assert.ok(cancelled.includes(41));
  assert.deepEqual(c.closedTabs, [7]);
  assert.equal(c.chrome.downloads.onCreated.size, 0);
  assert.equal(c.chrome.downloads.onChanged.size, 0);
  const restarted = await runtime(c.store);
  await restarted.evaluate("initializeWorkerState()");
  restarted.chrome.runtime.onStartup.emit();
  await waitFor(() => restarted.store.jobState.status === "idle", "Startup should finish the persisted stop request");
  assert.equal(restarted.store.queue[0].status, "pending");
  assert.equal(restarted.downloads.length, 0);
});

test("QUEUE_APPEND preserves existing items and applies canonical duplicate and download history checks", async () => {
  const c = await runtime({ queue: [{ ...existingItem, link: "https://www.instagram.com/reel/ABC123/" }],
    downloadHistory: { "https://www.tiktok.com/@old/video/456?_t=share": { time: 1, filename: "fixture/done.mp4" } } });
  const reply = await message(c, { type: "QUEUE_APPEND", items: [
    { ...existingItem, id: "duplicate", link: "https://www.instagram.com/p/ABC123/?igsh=share" },
    { ...existingItem, id: "downloaded", link: "https://www.tiktok.com/@new/video/456?_r=1" },
    { ...existingItem, id: "new", link: "https://example.org/new.mp4" }
  ] });
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(c.store.queue.map((item) => [item.id, item.status]), [["existing", "pending"], ["downloaded", "skipped"], ["new", "pending"]]);
});

test("simultaneous QUEUE_APPEND messages retain both panels' new items", async () => {
  const c = await runtime({ queue: [existingItem] });
  const replies = await Promise.all([message(c, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "one", link: "https://example.org/one.mp4" }] }),
    message(c, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "two", link: "https://example.org/two.mp4" }] })]);
  assert.ok(replies.every((reply) => reply.ok));
  assert.deepEqual(c.store.queue.map((item) => item.id).sort(), ["existing", "one", "two"]);
});

test("queue mutation messages reject changes while a persisted job owns the queue", async () => {
  const c = await runtime({ queue: [existingItem], jobState: job({ status: "paused" }), downloadHistory: { keep: { time: 1 } } });
  await c.evaluate("initializeWorkerState()");
  for (const command of [{ type: "QUEUE_CLEAR" }, { type: "QUEUE_REMOVE", id: "existing" }, { type: "QUEUE_PRUNE" },
    { type: "QUEUE_RETRY", id: "existing" }, { type: "QUEUE_APPEND", items: [] }, { type: "CLEAR_LOCAL_DATA" }]) {
    const reply = await message(c, command);
    assert.equal(reply.ok, false, command.type);
    assert.match(reply.error, /BUSY|đang|chạy|quét|tiến trình/i, command.type);
  }
  assert.deepEqual(c.store.queue, [existingItem]);
  assert.deepEqual(c.store.downloadHistory, { keep: { time: 1 } });
});

test("profile crawl appends discoveries and skips canonical history matches without replacing the queue", async () => {
  const sourceUrl = "https://www.instagram.com/fixture/reels/";
  const c = await runtime({ queue: [existingItem], downloadHistory: {
    "https://www.instagram.com/p/ABC123/?igsh=share": { time: 1, filename: "fixture/done.mp4" }
  } });
  completeTabs(c, sourceUrl);
  c.chrome.scripting.executeScript = async () => [{ result: { items: [
    { link: "https://www.instagram.com/reel/ABC123/", views: 1000 },
    { link: "https://www.instagram.com/reel/NEW456/", views: 2000 }
  ] } }];
  // End at queue creation; downloading is verified separately through START_RUN and Chrome events.
  c.evaluate("startRunQueueAfterCrawl = async () => {};");
  const result = await c.evaluate('crawlPublicProfile({ sourceUrl: "https://www.instagram.com/fixture/reels/", maxCount: 10, folder: "fixture", minViews: 0, platform: "instagram", label: "Instagram", itemLabel: "video", downloaderUrl: "https://so9.vn/9downloader/insta", pageFunction: () => {}, waitAfterLoadMs: 0, blockedMessage: "blocked" })');
  assert.equal(result.ok, true);
  assert.equal(c.store.queue.length, 3);
  assert.equal(c.store.queue[0].id, "existing");
  assert.equal(c.store.queue.find((item) => item.link.includes("ABC123")).status, "skipped");
  assert.equal(c.store.queue.find((item) => item.link.includes("NEW456")).status, "pending");
  assert.deepEqual(c.closedTabs, [7]);
});

test("worker rejects text, playlists, wrong media types, unsafe and empty completed downloads", async () => {
  const c = await runtime();
  for (const patch of [
    { filename: "fixture/log.txt", mime: "text/plain" },
    { filename: "fixture/renamed.mp4", mime: "text/plain" },
    { filename: "fixture/master.m3u8", mime: "application/vnd.apple.mpegurl" },
    { filename: "fixture/photo.jpg", mime: "image/jpeg" },
    { fileSize: 0 }, { danger: "uncommon" }
  ]) {
    c.sandbox.fixtureDownload = video(patch);
    assert.throws(() => c.evaluate('validateDownloadedItem(fixtureDownload, "video")'), /DOWNLOAD_(?:MISMATCH|EMPTY|DANGER)/, JSON.stringify(patch));
  }
});

test("worker accepts audio and image downloads only for their requested media type", async () => {
  const c = await runtime();
  for (const [kind, filename, mime, url] of [
    ["audio", "fixture/song.flac", "audio/flac", "https://cdn.example.org/song.flac"],
    ["image", "fixture/photo.avif", "image/avif", "https://cdn.example.org/photo.avif"]
  ]) {
    c.sandbox.fixtureDownload = video({ filename, mime, url, finalUrl: url });
    const result = c.evaluate(`validateDownloadedItem(fixtureDownload, ${JSON.stringify(kind)})`);
    assert.equal(result.filename, filename);
    assert.throws(() => c.evaluate('validateDownloadedItem(fixtureDownload, "video")'), /DOWNLOAD_MISMATCH/);
  }
});

test("backend health reports a plain HTTP 200 homepage as reachable without claiming a working downloader", async () => {
  const c = await runtime({ queue: [existingItem] });
  const reply = await message(c, { type: "CHECK_BACKENDS" });
  assert.equal(reply.ok, true);
  assert.ok(reply.results.length > 0);
  for (const result of reply.results) {
    assert.equal(result.status, 200);
    assert.equal(result.reachable, true);
    assert.equal(result.form, false);
    assert.equal(result.ok, false);
    assert.equal(result.level, "reachable");
  }
  assert.deepEqual(c.store.queue, [existingItem]);
});

test("backend health distinguishes a downloader form from a CAPTCHA response", async () => {
  const c = await runtime();
  c.sandbox.fetch = async (url) => ({ ok: true, status: 200, text: async () =>
    '<input type="url" placeholder="Video link"><button type="submit">Download</button>' +
    (url.endsWith("/tiktok") ? '<div>CAPTCHA required</div>' : "") });
  const reply = await message(c, { type: "CHECK_BACKENDS" });
  const form = reply.results.find((result) => result.site.endsWith("/facebook"));
  const blocked = reply.results.find((result) => result.site.endsWith("/tiktok"));
  assert.equal(form.ok, true);
  assert.equal(form.level, "form");
  assert.equal(blocked.reachable, true);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.level, "blocked");
});

test("backend health aborts stalled requests and returns failures for every provider", async () => {
  const c = await runtime();
  // Advance only the request deadline; the real AbortController and fetch rejection still run.
  c.sandbox.setTimeout = (callback) => setTimeout(callback, 1);
  c.sandbox.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("fixture request aborted")), { once: true });
  });
  const reply = await message(c, { type: "CHECK_BACKENDS" });
  assert.equal(reply.ok, true);
  assert.ok(reply.results.length > 0);
  for (const result of reply.results) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.error, /fixture request aborted/);
  }
});

test("foreign extensions and webpage content scripts cannot issue UI job or queue commands", async () => {
  const c = await runtime({ queue: [existingItem], downloadHistory: { keep: { time: 1 } } });
  for (const sender of [{ id: "foreign-extension" }, { id: c.chrome.runtime.id, tab: { id: 7 }, url: "https://example.org/page" }]) {
    for (const command of [{ type: "START_RUN" }, { type: "QUEUE_CLEAR" }, { type: "CLEAR_LOCAL_DATA" },
      { type: "CHECK_BACKENDS" }, { type: "CRAWL_CHANNEL_VIDEOS", channelUrl: "https://www.instagram.com/fixture/reels/" }]) {
      assert.equal((await message(c, command, sender)).ok, false, `${sender.id}: ${command.type}`);
    }
  }
  assert.deepEqual(c.store.queue, [existingItem]);
  assert.deepEqual(c.store.downloadHistory, { keep: { time: 1 } });
  assert.equal(c.downloads.length, 0);
  assert.equal(c.store.crawlJob, undefined);
});

test("the extension popup opened in a browser tab may send UI queue commands", async () => {
  const c = await runtime({ queue: [existingItem] });
  const sender = { id: c.chrome.runtime.id, tab: { id: 99 }, url: "chrome-extension://fixture/popup/popup.html" };
  const reply = await message(c, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "from-popup-tab", link: "https://example.org/from-popup-tab.mp4" }] }, sender);
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(c.store.queue.map((item) => item.id), ["existing", "from-popup-tab"]);
});

test("owned crawl checkpoints persist across worker interruption and reject reports from another tab", async (t) => {
  const sourceUrl = "https://www.instagram.com/fixture/reels/";
  const c = await runtime({ queue: [existingItem] });
  completeTabs(c, sourceUrl);
  c.evaluate("sleep = async () => {};");
  let releasePage;
  c.chrome.scripting.executeScript = () => new Promise((resolve) => { releasePage = resolve; });
  const crawl = message(c, { type: "CRAWL_CHANNEL_VIDEOS", channelUrl: sourceUrl, maxCount: 10, minViews: 0, statsOnly: true });
  t.after(async () => {
    releasePage?.([{ result: { blocked: true, message: "fixture interrupted after checkpoint" } }]);
    await crawl;
  });
  await waitFor(() => releasePage && c.store.crawlJob?.tabId === 7, "The active crawl should checkpoint ownership before page collection");
  const first = { link: "https://www.instagram.com/reel/ABC123/", views: 1000 };
  const second = { link: "https://www.instagram.com/reel/NEW456/", views: 2000 };
  assert.equal((await message(c, { type: "CRAWL_CHECKPOINT", items: [first] }, { id: c.chrome.runtime.id, tab: { id: 99 } })).ok, false);
  assert.deepEqual(c.store.crawlJob.items, []);
  assert.equal((await message(c, { type: "CRAWL_CHECKPOINT", items: [first] }, { id: c.chrome.runtime.id, tab: { id: 7 } })).ok, true);
  assert.equal((await message(c, { type: "CRAWL_CHECKPOINT", items: [first, second] }, { id: c.chrome.runtime.id, tab: { id: 7 } })).ok, true);
  assert.deepEqual(c.store.crawlJob.items.map((item) => item.link), [first.link, second.link]);
  const checkpoint = structuredClone(c.store);
  releasePage([{ result: { blocked: true, message: "fixture interrupted after checkpoint" } }]);
  assert.equal((await crawl).ok, false);

  const restarted = await runtime(checkpoint);
  completeTabs(restarted, sourceUrl);
  await restarted.evaluate("initializeWorkerState()");
  assert.equal(restarted.store.crawlJob.status, "interrupted");
  assert.deepEqual(restarted.store.savedReelLinks, [first.link, second.link]);
  assert.deepEqual(restarted.store.savedReelItems.map((item) => item.link), [first.link, second.link]);
  assert.deepEqual(restarted.store.queue, [existingItem]);
  assert.deepEqual(restarted.closedTabs, [7]);
  const appended = await message(restarted, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "after-restart", link: "https://example.org/after-restart.mp4" }] });
  assert.equal(appended.ok, true, appended.error);
  assert.equal(restarted.store.queue.length, 2);
});

test("failed initial crawl checkpoint storage releases the crawl lock for the next job", async () => {
  const c = await runtime({ queue: [existingItem] });
  const save = c.chrome.storage.local.set;
  c.chrome.storage.local.set = async (patch) => {
    if (patch.crawlJob?.status === "running") throw new Error("fixture crawl quota failure");
    return await save(patch);
  };
  const rejected = await message(c, { type: "CRAWL_CHANNEL_VIDEOS", channelUrl: "https://www.instagram.com/fixture/reels/" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /fixture crawl quota failure/);
  const started = await message(c, { type: "START_RUN" });
  assert.equal(started.ok, true, started.error);
  await c.evaluate("runnerPromise");
  assert.equal(c.downloads.length, 1);
  assert.equal(c.store.queue[0].status, "success");
});

test("a rejected queue storage write does not poison later serialized commands", async () => {
  const c = await runtime({ queue: [existingItem] });
  const save = c.chrome.storage.local.set;
  let failOnce = true;
  c.chrome.storage.local.set = async (patch) => {
    if (failOnce && patch.queue) {
      failOnce = false;
      throw new Error("fixture queue quota failure");
    }
    return await save(patch);
  };
  const first = await message(c, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "failed", link: "https://example.org/failed.mp4" }] });
  assert.equal(first.ok, false);
  assert.match(first.error, /fixture queue quota failure/);
  assert.deepEqual(c.store.queue, [existingItem]);
  const next = await message(c, { type: "QUEUE_APPEND", items: [{ ...existingItem, id: "next", link: "https://example.org/next.mp4" }] });
  assert.equal(next.ok, true, next.error);
  assert.deepEqual(c.store.queue.map((item) => item.id), ["existing", "next"]);
});
