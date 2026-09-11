import { t } from "./i18n.js";


const JOB_STATE_KEY = "jobState";
const JOB_SCHEMA_VERSION = 1;
const RUNNER_ALARM = "mike-automation-runner";
const MAX_ITEM_ATTEMPTS = 2;

// Thứ tự nguồn tải cho từng nền tảng. "native" = đọc URL video ngay trên trang gốc
// (dùng phiên đăng nhập Chrome hiện tại); còn lại là trang downloader bên thứ ba.
// Nguồn nào lỗi thì chuyển sang nguồn kế tiếp.
const BACKENDS = {
  facebook: ["native", "https://so9.vn/9downloader/facebook", "https://snapsave.app/"],
  tiktok: ["https://so9.vn/9downloader/tiktok", "native", "https://snaptik.app/", "https://ssstik.io/"],
  instagram: ["https://so9.vn/9downloader/insta", "https://snapinsta.app/"],
  douyin: ["https://so9.vn/9downloader/douyin", "https://snapdouyin.app/"],
  // YouTube trong trình duyệt chỉ lấy được bản progressive 360p (itag 18) có tiếng; các mức cao hơn cần ghép stream (không hỗ trợ).
  youtube: ["native", "https://en1.savefrom.net/"],
  bilibili: ["https://snapany.com/bilibili"]
};

let runLock = false;
let crawlLock = false;
let crawlCancelRequested = false;
let paused = false;
let stopped = false;
let activeTabId = null;
let activeDownloadIds = new Set();
let currentRunId = "";
let runnerPromise = null;
let storageMutationChain = Promise.resolve();
let currentJob = createIdleJobState();

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  workerReady.then(() => handleMessage(message, sender)).then(sendResponse).catch((error) => {
    appendLog(error.message || String(error), "error");
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

chrome.runtime.onStartup.addListener(() => {
  workerReady.then(() => resumePersistedJob("Chrome vừa khởi động")).catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  workerReady.then(() => resumePersistedJob("Extension vừa được cập nhật")).catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RUNNER_ALARM) return;
  workerReady.then(() => resumePersistedJob("Alarm phục hồi worker")).catch(console.error);
});

const workerReady = initializeWorkerState();
workerReady.then(() => resumePersistedJob("Worker được khởi tạo")).catch(console.error);

async function handleMessage(message, sender = {}) {
  if (message.type === "START_RUN") {
    if (runLock || crawlLock) {
      return { ok: false, error: crawlLock ? "Đang quét kênh, vui lòng chờ hoàn tất." : "Đang có tiến trình chạy." };
    }
    return await startNewRun(message.folder);
  }

  if (message.type === "CRAWL_CHANNEL_VIDEOS" || message.type === "CRAWL_FACEBOOK_REELS") {
    if (runLock || crawlLock) {
      return {
        ok: false,
        error: runLock
          ? "Không thể quét kênh khi danh sách đang được tải."
          : "Đang có tiến trình quét profile/kênh."
      };
    }
    crawlLock = true;
    crawlCancelRequested = false;
    try {
      return await crawlChannelVideos(message.channelUrl, message.maxCount, message.folder, message.minViews);
    } catch (error) {
      if (crawlCancelRequested) return { ok: false, error: "Đã dừng quét kênh/profile." };
      throw error;
    } finally {
      crawlLock = false;
      crawlCancelRequested = false;
      await publishState();
    }
  }

  if (message.type === "PAUSE_RUN") {
    if (!runLock) return { ok: false, error: "Không có tiến trình để tạm dừng." };
    paused = true;
    await updateJobState({ status: "paused" });
    await appendLog("Đã tạm dừng tiến trình.", "warn");
    await publishState();
    return { ok: true };
  }

  if (message.type === "RESUME_RUN") {
    if (!runLock) return { ok: false, error: "Không có tiến trình để tiếp tục." };
    paused = false;
    await updateJobState({ status: "running" });
    await ensureRunnerAlarm();
    await appendLog("Đã tiếp tục tiến trình.", "info");
    await publishState();
    launchRunner(currentJob.folder, currentJob.runId);
    return { ok: true };
  }

  if (message.type === "STOP_RUN") {
    if (!runLock && crawlLock) {
      crawlCancelRequested = true;
      await abortActiveWork();
      await appendLog("Đã yêu cầu dừng quét kênh/profile.", "warn");
      await publishState();
      return { ok: true };
    }
    if (!runLock) return { ok: true };
    stopped = true;
    paused = false;
    await updateJobState({ status: "stopping", cancelRequested: true });
    await abortActiveWork();
    await appendLog("Đã yêu cầu dừng tiến trình.", "warn");
    await publishState();
    return { ok: true };
  }

  return { ok: false, error: "Unknown message type" };
}

function createIdleJobState() {
  return {
    schemaVersion: JOB_SCHEMA_VERSION,
    runId: "",
    status: "idle",
    folder: "SO9-Downloads",
    itemIds: [],
    nextIndex: 0,
    activeItemId: "",
    activeTabId: null,
    activeTabUrl: "",
    activeDownloadIds: [],
    stage: "idle",
    deadlineAt: 0,
    attempt: 0,
    cancelRequested: false,
    startedAt: 0,
    updatedAt: Date.now()
  };
}

function normalizeJobState(value) {
  if (!value || value.schemaVersion !== JOB_SCHEMA_VERSION) return createIdleJobState();
  return {
    ...createIdleJobState(),
    ...value,
    itemIds: Array.isArray(value.itemIds) ? value.itemIds.filter(Boolean) : [],
    activeDownloadIds: Array.isArray(value.activeDownloadIds)
      ? value.activeDownloadIds.filter((id) => Number.isInteger(id))
      : []
  };
}

async function initializeWorkerState() {
  const data = await chrome.storage.local.get([JOB_STATE_KEY]);
  currentJob = normalizeJobState(data[JOB_STATE_KEY]);
  const resumable = ["running", "paused", "stopping"].includes(currentJob.status) && currentJob.runId;

  runLock = Boolean(resumable);
  paused = currentJob.status === "paused";
  stopped = currentJob.status === "stopping" || Boolean(currentJob.cancelRequested);
  currentRunId = resumable ? currentJob.runId : "";
  activeTabId = resumable && Number.isInteger(currentJob.activeTabId) ? currentJob.activeTabId : null;
  activeDownloadIds = new Set(resumable ? currentJob.activeDownloadIds : []);

  await chrome.storage.local.set({
    runState: { running: runLock, paused },
    [JOB_STATE_KEY]: currentJob
  });
}

function serializeStorageMutation(task) {
  const operation = storageMutationChain.then(task, task);
  storageMutationChain = operation.catch(() => {});
  return operation;
}

async function updateJobState(patch) {
  return await serializeStorageMutation(async () => {
    currentJob = normalizeJobState({
      ...currentJob,
      ...patch,
      schemaVersion: JOB_SCHEMA_VERSION,
      updatedAt: Date.now()
    });
    await chrome.storage.local.set({
      [JOB_STATE_KEY]: currentJob,
      runState: { running: currentJob.status !== "idle", paused: currentJob.status === "paused" }
    });
    return currentJob;
  });
}

async function ensureRunnerAlarm() {
  await chrome.alarms.create(RUNNER_ALARM, { periodInMinutes: 1 });
}

async function clearRunnerAlarm() {
  try {
    await chrome.alarms.clear(RUNNER_ALARM);
  } catch (_) {
    // A missing alarm is already the desired state.
  }
}

async function startNewRun(folder) {
  const data = await chrome.storage.local.get(["queue", "downloadFolder"]);
  let queueChanged = false;
  const queue = (data.queue || []).map((item) => {
    const migrated = migrateQueueItem(item);
    queueChanged ||= migrated !== item;
    return migrated;
  });
  if (queueChanged) await chrome.storage.local.set({ queue });

  const itemIds = queue
    .filter((item) => item.status === "pending" || item.status === "failed")
    .map((item) => item.id);

  if (!itemIds.length) return { ok: false, error: "Không có link hợp lệ để tải." };

  currentRunId = crypto.randomUUID();
  runLock = true;
  paused = false;
  stopped = false;
  activeTabId = null;
  activeDownloadIds.clear();

  await updateJobState({
    ...createIdleJobState(),
    runId: currentRunId,
    status: "running",
    folder: sanitizeFolder(folder || data.downloadFolder || "SO9-Downloads"),
    itemIds,
    startedAt: Date.now(),
    updatedAt: Date.now()
  });
  await ensureRunnerAlarm();
  launchRunner(currentJob.folder, currentRunId);
  await publishState();
  return { ok: true, runId: currentRunId };
}

function migrateQueueItem(item) {
  if (!item || item.strategy !== "so9") return item;

  try {
    const url = new URL(item.link);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    const isInstagram = hostname === "instagram.com";
    const isFacebook = hostname === "facebook.com";
    const isInstagramMedia = isInstagram && (/^\/stories\//.test(path) || /^\/(?:[a-z0-9._]+\/)?(?:p|reel|tv)\/[^/?#]+\/?$/.test(path));
    const isFacebookStory = isFacebook && (path.startsWith("/stories/") || (path === "/story.php" && url.searchParams.has("story_fbid")));
    if (!isInstagramMedia && !isFacebookStory) return item;

    return {
      ...item,
      platform: isInstagramMedia ? (path.startsWith("/stories/") ? "instagram-story" : "instagram-media") : "facebook-story",
      strategy: "direct-media",
      permissionOrigin: "",
      message: "Quét trang để tìm URL video trực tiếp công khai"
    };
  } catch (_) {
    return item;
  }
}

function launchRunner(folder, runId) {
  if (runnerPromise || !runId || runId !== currentJob.runId) return;

  runnerPromise = runQueue(folder, runId)
    .catch(async (error) => {
      await appendLog(`Tiến trình gặp lỗi hệ thống: ${error.message || error}`, "error");
      await finishRun(runId, true);
    })
    .finally(() => {
      runnerPromise = null;
      publishState().catch(() => {});
    });
}

async function resumePersistedJob(reason) {
  if (!runLock || !currentJob.runId) return;

  if (currentJob.status === "stopping" || currentJob.cancelRequested) {
    await abortActiveWork();
    if (currentJob.activeItemId) {
      await updateItem(currentJob.activeItemId, {
        status: "pending",
        message: "Đã dừng trước khi hoàn tất"
      });
    }
    await appendLog("Đã hoàn tất yêu cầu dừng sau khi worker được phục hồi.", "warn");
    await finishRun(currentJob.runId, true);
    return;
  }

  if (currentJob.status === "paused") return;
  await ensureRunnerAlarm();
  if (!runnerPromise) {
    await appendLog(`${reason}: tiếp tục tiến trình đang lưu.`, "info");
    launchRunner(currentJob.folder, currentJob.runId);
  }
}

async function finishRun(runId, wasStopped = false) {
  if (!runId || currentJob.runId !== runId) return;
  runLock = false;
  paused = false;
  stopped = false;
  activeTabId = null;
  activeDownloadIds.clear();
  currentRunId = "";
  await updateJobState(createIdleJobState());
  await clearRunnerAlarm();
  if (wasStopped) await publishState();
}

async function crawlChannelVideos(channelUrl, maxCount, folder, minViews) {
  const platform = detectCrawlPlatform(channelUrl);
  if (platform === "facebook") {
    return await crawlFacebookReels(channelUrl, maxCount, folder, minViews);
  }
  if (platform === "tiktok") {
    return await crawlTikTokProfile(channelUrl, maxCount, folder, minViews);
  }
  if (platform === "instagram") {
    return await crawlInstagramProfile(channelUrl, maxCount, folder, minViews);
  }
  if (platform === "douyin") {
    return await crawlDouyinProfile(channelUrl, maxCount, folder, minViews);
  }
  throw new Error("Chỉ hỗ trợ quét kênh Facebook, TikTok, Instagram hoặc Douyin.");
}

function assertCrawlActive() {
  if (crawlCancelRequested) throw new Error("CRAWL_STOPPED: Đã dừng quét kênh/profile.");
}

async function crawlFacebookReels(channelUrl, maxCount, folder, minViews) {
  const sourceUrl = normalizeFacebookChannelUrl(channelUrl);
  const limit = normalizeMaxCount(maxCount);
  const minimumViews = normalizeMinViews(minViews);

  if (!sourceUrl) {
    throw new Error("Link kênh Facebook Reels không hợp lệ.");
  }

  await appendLog(`Đang mở kênh Facebook: ${sourceUrl}`, "info");
  const tab = await chrome.tabs.create({ url: sourceUrl, active: true });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, 45000);
    await sleep(2500);
    await appendLog(limit === null
      ? "Đang cuộn để lấy toàn bộ link Reels tìm thấy trên kênh."
      : `Đang cuộn và lấy tối đa ${limit} link Reels.`, "info");
    await appendLog(`Ngưỡng view tối thiểu: ${formatNumber(minimumViews)}.`, "info");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: crawlFacebookReelsInPage,
      args: [limit, minimumViews]
    });
    assertCrawlActive();

    const payload = result?.result || {};
    if (payload.blocked) {
      throw new Error(payload.message || "Facebook đang chặn hoặc yêu cầu đăng nhập/checkpoint.");
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const links = items.map((item) => item.link);
    const skipped = Number(payload.skipped || 0);
    const skippedByView = Number(payload.skippedByView || 0);
    const missingView = Number(payload.missingView || 0);
    if (!items.length) {
      throw new Error("Không tìm thấy link Reels nào trên kênh sau khi cuộn.");
    }

    const lastCrawlTime = Date.now();
    const queue = items.map((item, index) => ({
      id: `crawl-${lastCrawlTime}-${index}`,
      link: item.link,
      views: item.views || 0,
      viewText: item.viewText || "",
      status: "pending",
      platform: "facebook",
      strategy: "so9",
      downloaderUrl: "https://so9.vn/9downloader/facebook",
      message: item.viewText || item.views ? `View: ${item.viewText || formatNumber(item.views)}` : "Chờ xử lý"
    }));

    await chrome.storage.local.set({
      savedReelLinks: links,
      savedReelItems: items,
      lastCrawlSource: sourceUrl,
      lastCrawlTime,
      lastCrawlMax: limit,
      lastMinViews: minimumViews,
      lastCrawlPlatform: "facebook",
      queue
    });

    await appendLog(`Đã lấy được ${links.length} link Reels, bỏ qua ${skipped} link trùng/không hợp lệ.`, "info");
    await appendLog(`Đã bỏ qua ${skippedByView} video dưới ngưỡng view.`, "info");
    await appendLog(`${missingView} video không đọc được view.`, minimumViews > 0 && missingView > 0 ? "warn" : "info");
    await appendLog(`Đã đưa ${queue.length} link Facebook vào danh sách tải.`, "info");
    assertCrawlActive();
    await startRunQueueAfterCrawl(folder);
    return { ok: true, links, items, skipped, skippedByView, missingView, lastCrawlTime };
  } catch (error) {
    await appendLog(`Quét kênh thất bại: ${error.message || error}`, "error");
    throw error;
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function crawlTikTokProfile(channelUrl, maxCount, folder, minViews) {
  const sourceUrl = normalizeTikTokChannelUrl(channelUrl);
  const limit = normalizeMaxCount(maxCount);
  const minimumViews = normalizeMinViews(minViews);

  if (!sourceUrl) {
    throw new Error("Link kênh TikTok không hợp lệ.");
  }

  await appendLog(`Đang mở kênh TikTok: ${sourceUrl}`, "info");
  const tab = await chrome.tabs.create({ url: sourceUrl, active: true });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, 45000);
    await sleep(4500);
    await appendLog(limit === null
      ? "Đang cuộn để lấy toàn bộ link video TikTok tìm thấy trên kênh."
      : `Đang cuộn và lấy tối đa ${limit} link video TikTok.`, "info");
    await appendLog(`Ngưỡng view tối thiểu: ${formatNumber(minimumViews)}.`, "info");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: crawlTikTokVideosInPage,
      args: [limit, minimumViews]
    });
    assertCrawlActive();

    const payload = result?.result || {};
    if (payload.blocked) {
      throw new Error(payload.message || "TikTok đang chặn hoặc yêu cầu xác minh.");
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const links = items.map((item) => item.link);
    const skipped = Number(payload.skipped || 0);
    const skippedByView = Number(payload.skippedByView || 0);
    const missingView = Number(payload.missingView || 0);
    if (!items.length) {
      throw new Error("Không tìm thấy link video TikTok nào trên kênh sau khi cuộn.");
    }

    const lastCrawlTime = Date.now();
    const queue = items.map((item, index) => ({
      id: `crawl-${lastCrawlTime}-${index}`,
      link: item.link,
      views: item.views || 0,
      viewText: item.viewText || "",
      status: "pending",
      platform: "tiktok",
      strategy: "so9",
      downloaderUrl: "https://so9.vn/9downloader/tiktok",
      message: item.viewText || item.views ? `View: ${item.viewText || formatNumber(item.views)}` : "Chờ xử lý"
    }));

    await chrome.storage.local.set({
      savedReelLinks: links,
      savedReelItems: items,
      lastCrawlSource: sourceUrl,
      lastCrawlTime,
      lastCrawlMax: limit,
      lastMinViews: minimumViews,
      lastCrawlPlatform: "tiktok",
      queue
    });

    await appendLog(`Đã lấy được ${links.length} link TikTok, bỏ qua ${skipped} link trùng/không hợp lệ.`, "info");
    await appendLog(`Đã bỏ qua ${skippedByView} video TikTok dưới ngưỡng view.`, "info");
    await appendLog(`${missingView} video TikTok không đọc được view.`, minimumViews > 0 && missingView > 0 ? "warn" : "info");
    await appendLog(`Đã đưa ${queue.length} link TikTok vào danh sách tải.`, "info");
    assertCrawlActive();
    await startRunQueueAfterCrawl(folder);
    return { ok: true, links, items, skipped, skippedByView, missingView, lastCrawlTime };
  } catch (error) {
    await appendLog(`Quét kênh TikTok thất bại: ${error.message || error}`, "error");
    throw error;
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function crawlInstagramProfile(channelUrl, maxCount, folder, minViews) {
  const sourceUrl = normalizeInstagramChannelUrl(channelUrl);
  if (!sourceUrl) {
    throw new Error("Link profile Instagram không hợp lệ.");
  }

  return await crawlPublicProfile({
    sourceUrl,
    maxCount,
    folder,
    minViews,
    platform: "instagram",
    label: "Instagram",
    itemLabel: "video Instagram",
    downloaderUrl: "https://so9.vn/9downloader/insta",
    pageFunction: crawlPublicVideoLinksInPage,
    waitAfterLoadMs: 3500,
    blockedMessage: "Instagram yêu cầu đăng nhập hoặc không expose danh sách video công khai."
  });
}

async function crawlDouyinProfile(channelUrl, maxCount, folder, minViews) {
  const sourceUrl = normalizeDouyinChannelUrl(channelUrl);
  if (!sourceUrl) {
    throw new Error("Link profile Douyin không hợp lệ.");
  }

  return await crawlPublicProfile({
    sourceUrl,
    maxCount,
    folder,
    minViews,
    platform: "douyin",
    label: "Douyin",
    itemLabel: "video Douyin",
    downloaderUrl: "https://so9.vn/9downloader/douyin",
    pageFunction: crawlPublicVideoLinksInPage,
    waitAfterLoadMs: 4000,
    blockedMessage: "Douyin yêu cầu đăng nhập/xác minh hoặc không expose danh sách video công khai."
  });
}

async function crawlPublicProfile({
  sourceUrl,
  maxCount,
  folder,
  minViews,
  platform,
  label,
  itemLabel,
  downloaderUrl,
  pageFunction,
  waitAfterLoadMs,
  blockedMessage
}) {
  const limit = normalizeMaxCount(maxCount);
  const minimumViews = normalizeMinViews(minViews);
  await appendLog(`Đang mở profile ${label}: ${sourceUrl}`, "info");
  const tab = await chrome.tabs.create({ url: sourceUrl, active: true });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, 45000);
    await sleep(waitAfterLoadMs);
    await appendLog(limit === null
      ? `Đang cuộn để lấy toàn bộ ${itemLabel} tìm thấy trên profile.`
      : `Đang cuộn và lấy tối đa ${limit} ${itemLabel}.`, "info");
    await appendLog(`Ngưỡng view tối thiểu: ${formatNumber(minimumViews)}.`, "info");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFunction,
      args: [limit, minimumViews, platform]
    });
    assertCrawlActive();

    const payload = result?.result || {};
    if (payload.blocked) {
      throw new Error(payload.message || blockedMessage);
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const links = items.map((item) => item.link);
    const skipped = Number(payload.skipped || 0);
    const skippedByView = Number(payload.skippedByView || 0);
    const missingView = Number(payload.missingView || 0);
    if (!items.length) {
      throw new Error(`Không tìm thấy ${itemLabel} nào trên profile sau khi cuộn.`);
    }

    const lastCrawlTime = Date.now();
    const queue = items.map((item, index) => ({
      id: `crawl-${lastCrawlTime}-${index}`,
      link: item.link,
      views: item.views || 0,
      viewText: item.viewText || "",
      status: "pending",
      platform,
      strategy: "so9",
      downloaderUrl,
      message: item.viewText || item.views ? `View: ${item.viewText || formatNumber(item.views)}` : "Chờ xử lý"
    }));

    await chrome.storage.local.set({
      savedReelLinks: links,
      savedReelItems: items,
      lastCrawlSource: sourceUrl,
      lastCrawlTime,
      lastCrawlMax: limit,
      lastMinViews: minimumViews,
      lastCrawlPlatform: platform,
      queue
    });

    await appendLog(`Đã lấy được ${links.length} ${itemLabel}, bỏ qua ${skipped} link trùng/không hợp lệ.`, "info");
    await appendLog(`Đã bỏ qua ${skippedByView} video dưới ngưỡng view.`, "info");
    await appendLog(`${missingView} video không đọc được view.`, minimumViews > 0 && missingView > 0 ? "warn" : "info");
    await appendLog(`Đã đưa ${queue.length} link ${label} vào danh sách tải.`, "info");
    assertCrawlActive();
    await startRunQueueAfterCrawl(folder);
    return { ok: true, links, items, skipped, skippedByView, missingView, lastCrawlTime };
  } catch (error) {
    await appendLog(`Quét profile ${label} thất bại: ${error.message || error}`, "error");
    throw error;
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function startRunQueueAfterCrawl(folder) {
  if (runLock) {
    await appendLog("Tiến trình tải đang chạy, link vừa quét đã được lưu vào queue.", "warn");
    return;
  }
  await appendLog("Tự động tải lần lượt các link vừa quét.", "info");
  const result = await startNewRun(folder);
  if (!result.ok) throw new Error(result.error || "Không thể khởi động danh sách vừa quét.");
}

function crawlFacebookReelsInPage(limit, minViews) {
  const unlimited = limit === null || limit === undefined || String(limit).trim() === "";
  const maxCount = unlimited ? Number.MAX_SAFE_INTEGER : Number(limit);
  if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new Error("Số lượng phải là số nguyên dương hoặc để trống.");
  const minimumViews = Math.max(0, Number(minViews) || 0);
  const items = new Map();
  let skipped = 0;
  let skippedByView = 0;
  let missingView = 0;
  let staleScrolls = 0;
  let lastSize = 0;

  const pageText = String(document.body?.innerText || "").toLowerCase();
  if (
    pageText.includes("log in") ||
    pageText.includes("đăng nhập") ||
    pageText.includes("checkpoint") ||
    location.href.includes("/login") ||
    location.href.includes("checkpoint")
  ) {
    return {
      blocked: true,
      message: "Facebook yêu cầu đăng nhập hoặc checkpoint trước khi quét link."
    };
  }

  return new Promise((resolve) => {
    const collect = () => {
      const anchors = [
        ...Array.from(document.querySelectorAll("a[href]")),
        ...Array.from(document.querySelectorAll('[role="link"][href]'))
      ];

      for (const anchor of anchors) {
        const href = anchor.href;
        const normalized = normalizeReelUrl(href);
        if (!normalized) {
          if (String(href || "").includes("/reel")) skipped += 1;
          continue;
        }

        if (items.has(normalized)) {
          skipped += 1;
          continue;
        }

        const viewInfo = extractViewInfo(anchor);
        if (!viewInfo && minimumViews > 0) {
          missingView += 1;
          continue;
        }

        const views = viewInfo?.views || 0;
        if (viewInfo && minimumViews > 0 && views < minimumViews) {
          skippedByView += 1;
          continue;
        }

        items.set(normalized, {
          link: normalized,
          views,
          viewText: viewInfo?.viewText || "",
          platform: "facebook",
          downloaderUrl: "https://so9.vn/9downloader/facebook"
        });
        if (!unlimited && items.size >= maxCount) break;
      }
    };

    const tick = () => {
      collect();

      if ((!unlimited && items.size >= maxCount) || staleScrolls >= 6) {
        resolve({
          items: unlimited ? Array.from(items.values()) : Array.from(items.values()).slice(0, maxCount),
          skipped,
          skippedByView,
          missingView
        });
        return;
      }

      if (items.size === lastSize) {
        staleScrolls += 1;
      } else {
        staleScrolls = 0;
        lastSize = items.size;
      }

      window.scrollBy({ top: Math.max(700, window.innerHeight * 1.35), behavior: "smooth" });
      setTimeout(tick, 1600);
    };

    tick();
  });

  function normalizeReelUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (!url.hostname.includes("facebook.com")) return "";

      const decodedPath = decodeURIComponent(url.pathname);
      const match = decodedPath.match(/\/reels?\/(\d+)/i) || decodedPath.match(/\/watch\/?\?v=(\d+)/i);
      const id = match?.[1] || url.searchParams.get("v");
      if (!id || !/^\d{5,}$/.test(id)) return "";
      return `https://www.facebook.com/reel/${id}`;
    } catch (_) {
      return "";
    }
  }

  function extractViewInfo(anchor) {
    const containers = [];
    let node = anchor;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (node.innerText) containers.push(node.innerText);
      node = node.parentElement;
    }

    const text = containers
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    return parseViewText(text);
  }

  function parseViewText(text) {
    const raw = String(text || "");
    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();

    const patterns = [
      /(\d+(?:[.,]\d+)?)\s*(k|m|nghin|ngan|trieu)\s*(?:views?|luot xem|view)?/i,
      /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:views?|luot xem)/i
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) continue;

      const valueText = match[1];
      const suffix = match[2] || "";
      const value = parseLocalizedNumber(valueText, Boolean(suffix));
      if (!Number.isFinite(value)) continue;

      const multiplier = suffix === "k" || suffix === "nghin" || suffix === "ngan"
        ? 1000
        : suffix === "m" || suffix === "trieu"
          ? 1000000
          : 1;
      const views = Math.round(value * multiplier);
      if (views <= 0) continue;

      return {
        views,
        viewText: formatCompactViews(views)
      };
    }

    return null;
  }

  function parseLocalizedNumber(valueText, hasSuffix) {
    const text = String(valueText || "").trim();
    if (hasSuffix) {
      return Number.parseFloat(text.replace(",", "."));
    }
    return Number.parseInt(text.replace(/[.,]/g, ""), 10);
  }

  function formatCompactViews(value) {
    if (value >= 1000000) {
      return `${trimDecimal(value / 1000000)}M`;
    }
    if (value >= 1000) {
      return `${trimDecimal(value / 1000)}K`;
    }
    return String(value);
  }

  function trimDecimal(value) {
    return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
  }
}

function crawlTikTokVideosInPage(limit, minViews) {
  const unlimited = limit === null || limit === undefined || String(limit).trim() === "";
  const maxCount = unlimited ? Number.MAX_SAFE_INTEGER : Number(limit);
  if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new Error("Số lượng phải là số nguyên dương hoặc để trống.");
  const minimumViews = Math.max(0, Number(minViews) || 0);
  const items = new Map();
  let skipped = 0;
  let skippedByView = 0;
  let missingView = 0;
  let staleScrolls = 0;
  let lastSize = 0;

  const pageText = String(document.body?.innerText || "").toLowerCase();
  if (
    location.href.includes("/login") ||
    pageText.includes("captcha") ||
    pageText.includes("verify") ||
    pageText.includes("xác minh") ||
    pageText.includes("too many attempts")
  ) {
    return {
      blocked: true,
      message: "TikTok yêu cầu đăng nhập, captcha hoặc xác minh trước khi quét link."
    };
  }

  return new Promise((resolve) => {
    const collect = () => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));

      for (const anchor of anchors) {
        const normalized = normalizeTikTokVideoUrl(anchor.href);
        if (!normalized) {
          skipped += 1;
          continue;
        }

        if (items.has(normalized)) {
          skipped += 1;
          continue;
        }

        const viewInfo = extractTikTokViewInfo(anchor);
        if (!viewInfo && minimumViews > 0) {
          missingView += 1;
          continue;
        }

        const views = viewInfo?.views || 0;
        if (minimumViews > 0 && views < minimumViews) {
          skippedByView += 1;
          continue;
        }

        items.set(normalized, {
          link: normalized,
          views,
          viewText: viewInfo?.viewText || "",
          platform: "tiktok",
          downloaderUrl: "https://so9.vn/9downloader/tiktok"
        });
        if (!unlimited && items.size >= maxCount) break;
      }
    };

    const tick = () => {
      collect();

      if ((!unlimited && items.size >= maxCount) || staleScrolls >= 7) {
        resolve({
          items: unlimited ? Array.from(items.values()) : Array.from(items.values()).slice(0, maxCount),
          skipped,
          skippedByView,
          missingView
        });
        return;
      }

      if (items.size === lastSize) {
        staleScrolls += 1;
      } else {
        staleScrolls = 0;
        lastSize = items.size;
      }

      window.scrollBy({ top: Math.max(900, window.innerHeight * 1.5), behavior: "smooth" });
      setTimeout(tick, 1700);
    };

    tick();
  });

  function normalizeTikTokVideoUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (!url.hostname.includes("tiktok.com")) return "";
      const decodedPath = decodeURIComponent(url.pathname);
      const match = decodedPath.match(/\/(@[^/]+)\/video\/(\d+)/i);
      if (!match) return "";
      return `https://www.tiktok.com/${match[1]}/video/${match[2]}`;
    } catch (_) {
      return "";
    }
  }

  function extractTikTokViewInfo(anchor) {
    const texts = [];
    const directViewNode = anchor.querySelector('[data-e2e*="video-views"], strong, span');
    if (directViewNode?.innerText) texts.push(directViewNode.innerText);
    if (anchor.getAttribute("aria-label")) texts.push(anchor.getAttribute("aria-label"));
    if (anchor.innerText) texts.push(anchor.innerText);

    let node = anchor;
    for (let depth = 0; node && depth < 7; depth += 1) {
      if (node.getAttribute?.("aria-label")) texts.push(node.getAttribute("aria-label"));
      const viewNode = node.querySelector?.('[data-e2e*="video-views"], strong[data-e2e], span[data-e2e*="video-views"]');
      if (viewNode?.innerText) texts.push(viewNode.innerText);
      if (node.innerText) texts.push(node.innerText);
      node = node.parentElement;
    }

    for (const text of texts) {
      const parsed = parseTikTokViewText(text);
      if (parsed) return parsed;
    }

    return null;
  }

  function parseTikTokViewText(text) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return null;
    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();

    const preferred = normalized.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m|b|nghin|ngan|trieu|ty)?\s*(?:views?|luot xem|view)/i);
    const looseTokens = [...normalized.matchAll(/(^|[^\d])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m|b|nghin|ngan|trieu|ty)?(?=$|[^\w])/gi)];
    const match = preferred || looseTokens
      .map((item) => [item[0], item[2], item[3] || ""])
      .find((item) => {
        const value = parseViewNumber(item[1], Boolean(item[2]));
        return Number.isFinite(value) && value > 0;
      });

    if (!match) return null;
    const valueText = match[1];
    const suffix = match[2] || "";
    const base = parseViewNumber(valueText, Boolean(suffix));
    if (!Number.isFinite(base) || base <= 0) return null;
    const views = Math.round(base * viewMultiplier(suffix));
    return {
      views,
      viewText: cleanViewText(raw, valueText, suffix, views)
    };
  }

  function parseViewNumber(valueText, hasSuffix) {
    const text = String(valueText || "").trim();
    if (hasSuffix) return Number.parseFloat(text.replace(",", "."));
    return Number.parseInt(text.replace(/[.,]/g, ""), 10);
  }

  function viewMultiplier(suffix) {
    if (suffix === "k" || suffix === "nghin" || suffix === "ngan") return 1000;
    if (suffix === "m" || suffix === "trieu") return 1000000;
    if (suffix === "b" || suffix === "ty") return 1000000000;
    return 1;
  }

  function cleanViewText(raw, valueText, suffix, views) {
    if (suffix) return `${valueText}${suffix.toUpperCase()}`;
    if (/^\d{1,3}([.,]\d{3})+$/.test(valueText) || /^\d+$/.test(valueText)) return valueText;
    return String(views);
  }
}

function crawlPublicVideoLinksInPage(limit, minViews, platform) {
  const unlimited = limit === null || limit === undefined || String(limit).trim() === "";
  const maxCount = unlimited ? Number.MAX_SAFE_INTEGER : Number(limit);
  if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new Error("Số lượng phải là số nguyên dương hoặc để trống.");
  const minimumViews = Math.max(0, Number(minViews) || 0);
  const items = new Map();
  let skipped = 0;
  let skippedByView = 0;
  let missingView = 0;
  let staleScrolls = 0;
  let lastSize = 0;
  const staleLimit = platform === "instagram" ? 8 : 9;
  const bodyText = String(document.body?.innerText || "").toLowerCase();
  const hasVideoAnchors = () => [...document.querySelectorAll("a[href]")].some((anchor) => normalizeVideoUrl(anchor.href));

  if (
    (platform === "instagram" && /\/accounts\/login|\/accounts\/emailsignup/i.test(location.pathname) && !hasVideoAnchors()) ||
    (platform === "douyin" && /captcha|验证码|安全验证|verify/i.test(bodyText) && !hasVideoAnchors())
  ) {
    return {
      blocked: true,
      message: platform === "instagram"
        ? "Instagram yêu cầu đăng nhập hoặc không expose danh sách video công khai."
        : "Douyin yêu cầu đăng nhập/xác minh trước khi quét video."
    };
  }

  return new Promise((resolve) => {
    const collect = () => {
      for (const anchor of document.querySelectorAll("a[href]")) {
        const normalized = normalizeVideoUrl(anchor.href);
        if (!normalized) continue;
        if (items.has(normalized)) {
          skipped += 1;
          continue;
        }

        const viewInfo = extractViewInfo(anchor);
        if (!viewInfo && minimumViews > 0) {
          missingView += 1;
          continue;
        }

        const views = viewInfo?.views || 0;
        if (minimumViews > 0 && views < minimumViews) {
          skippedByView += 1;
          continue;
        }

        items.set(normalized, {
          link: normalized,
          views,
          viewText: viewInfo?.viewText || "",
          platform,
          downloaderUrl: platform === "instagram"
            ? "https://so9.vn/9downloader/insta"
            : "https://so9.vn/9downloader/douyin"
        });
        if (!unlimited && items.size >= maxCount) break;
      }
    };

    const finish = () => resolve({
      items: unlimited ? Array.from(items.values()) : Array.from(items.values()).slice(0, maxCount),
      skipped,
      skippedByView,
      missingView
    });

    const tick = () => {
      collect();
      if ((!unlimited && items.size >= maxCount) || staleScrolls >= staleLimit) {
        finish();
        return;
      }

      if (items.size === lastSize) {
        staleScrolls += 1;
      } else {
        staleScrolls = 0;
        lastSize = items.size;
      }

      window.scrollBy({ top: Math.max(850, window.innerHeight * 1.45), behavior: "smooth" });
      setTimeout(tick, platform === "instagram" ? 1900 : 1800);
    };

    tick();
  });

  function normalizeVideoUrl(href) {
    try {
      const url = new URL(href, location.origin);
      const hostname = url.hostname.toLowerCase();
      if (platform === "instagram") {
        if (!(hostname === "instagram.com" || hostname.endsWith(".instagram.com"))) return "";
        const match = decodeURIComponent(url.pathname).match(/^\/(?:[a-z0-9._]+\/)?(reel|p|tv)\/([a-z0-9_-]+)\/?$/i);
        if (!match) return "";
        return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
      }

      if (!(hostname === "douyin.com" || hostname.endsWith(".douyin.com"))) return "";
      const match = decodeURIComponent(url.pathname).match(/^\/video\/(\d+)/i);
      if (!match) return "";
      return `https://www.douyin.com/video/${match[1]}`;
    } catch (_) {
      return "";
    }
  }

  function extractViewInfo(anchor) {
    const texts = [];
    let node = anchor;
    for (let depth = 0; node && depth < 7; depth += 1) {
      if (node.getAttribute?.("aria-label")) texts.push(node.getAttribute("aria-label"));
      if (node.innerText) texts.push(node.innerText);
      node = node.parentElement;
    }

    const raw = texts.join(" ").replace(/\s+/g, " ").trim();
    if (!raw) return null;
    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();
    const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(k|m|b|wan|yi|nghin|ngan|trieu|ty|万|亿)?\s*(?:views?|luot xem|view|播放|点赞|likes?)?/i);
    if (!match || (!match[2] && !/(?:views?|luot xem|view|播放|点赞|likes?)/i.test(match[0]))) return null;

    const value = Number.parseFloat(match[1].replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return null;
    const suffix = String(match[2] || "").toLowerCase();
    const multiplier = ["k", "nghin", "ngan"].includes(suffix)
      ? 1000
      : ["m", "trieu", "wan", "万"].includes(suffix)
        ? 1000000
        : ["b", "ty", "yi", "亿"].includes(suffix)
          ? 1000000000
          : 1;
    const views = Math.round(value * multiplier);
    return { views, viewText: suffix ? `${match[1]}${suffix.toUpperCase()}` : String(views) };
  }
}

function normalizeFacebookChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "facebook.com" || hostname.endsWith(".facebook.com"))) return "";
    url.protocol = "https:";
    url.hostname = "www.facebook.com";
    if (!url.pathname.includes("/reels")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/reels/`;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeTikTokChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))) return "";
    url.protocol = "https:";
    const match = decodeURIComponent(url.pathname).match(/\/(@[^/?#]+)/);
    if (!match) return "";
    url.hostname = "www.tiktok.com";
    url.pathname = `/${match[1]}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeInstagramChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "instagram.com" || hostname.endsWith(".instagram.com"))) return "";

    const parts = url.pathname.split("/").filter(Boolean);
    const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories", "tv"]);
    const username = decodeURIComponent(parts[0] || "");
    if (parts.length !== 1 || reserved.has(username.toLowerCase()) || !/^[a-z0-9._]+$/i.test(username)) return "";

    url.protocol = "https:";
    url.hostname = "www.instagram.com";
    url.pathname = `/${username}/`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeDouyinChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "douyin.com" || hostname.endsWith(".douyin.com"))) return "";

    const match = decodeURIComponent(url.pathname).match(/^\/user\/([^/?#]+)/i);
    if (!match) return "";

    url.protocol = "https:";
    url.hostname = "www.douyin.com";
    url.pathname = `/user/${encodeURIComponent(match[1])}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function detectCrawlPlatform(value) {
  if (normalizeFacebookChannelUrl(value)) return "facebook";
  if (normalizeTikTokChannelUrl(value)) return "tiktok";
  if (normalizeInstagramChannelUrl(value)) return "instagram";
  if (normalizeDouyinChannelUrl(value)) return "douyin";
  return "";
}

function normalizeMaxCount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Số lượng phải là số nguyên dương hợp lệ, hoặc để trống để lấy toàn bộ.");
  return parsed;
}

function normalizeMinViews(value) {
  const normalized = String(value || "0").replace(/[^\d]/g, "");
  return Math.max(0, Number.parseInt(normalized, 10) || 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

async function runQueue(folder, runId) {
  if (!runId || currentJob.runId !== runId) return;
  await appendLog(currentJob.nextIndex > 0 || currentJob.activeItemId
    ? "Tiếp tục xử lý danh sách link."
    : "Bắt đầu xử lý danh sách link.", "info");
  await publishState();

  const settings = await chrome.storage.local.get(["timeoutSeconds", "downloadFolder"]);
  const timeoutMs = Math.max(20000, Math.min(300000, Number(settings.timeoutSeconds || 90) * 1000));
  const downloadFolder = sanitizeFolder(folder || settings.downloadFolder || "SO9-Downloads");
  const itemIds = [...currentJob.itemIds];

  while (currentJob.nextIndex < itemIds.length && currentJob.runId === runId) {
    if (stopped || currentJob.cancelRequested) break;
    while (paused && !stopped && currentJob.runId === runId) {
      await sleep(500);
    }
    if (stopped || currentJob.runId !== runId) break;

    const index = currentJob.nextIndex;
    const itemId = itemIds[index];
    let item = await getQueueItem(itemId);
    if (!item || item.status === "unsupported" || item.status === "success") {
      await advanceJob(index + 1);
      continue;
    }

    const recovered = await recoverActiveItem(item, downloadFolder, timeoutMs, runId);
    if (recovered?.handled) {
      await advanceJob(index + 1);
      continue;
    }
    item = await getQueueItem(itemId) || item;

    const deadlineAt = Date.now() + timeoutMs;
    await updateJobState({
      activeItemId: item.id,
      nextIndex: index,
      deadlineAt,
      attempt: 1,
      stage: "preparing",
      activeTabId: null,
      activeTabUrl: "",
      activeDownloadIds: []
    });
    await updateItem(item.id, { status: "running", message: "Đang chuẩn bị tải" });
    await appendLog(`Đang xử lý ${item.platform}: ${item.link}`, "info");

    try {
      const result = await processItemWithRetry(item, downloadFolder, deadlineAt, runId);
      await updateItem(item.id, {
        status: "success",
        message: result.filename ? `Đã tải: ${result.filename}` : "Đã hoàn tất"
      });
      await appendLog(`Thành công: ${item.link}`, "info");
    } catch (error) {
      if (stopped || currentJob.cancelRequested || currentJob.runId !== runId) {
        await updateItem(item.id, { status: "pending", message: "Đã dừng trước khi hoàn tất" });
        break;
      }

      const message = formatDownloadError(error);
      await updateItem(item.id, { status: "failed", message });
      await appendLog(`Thất bại: ${item.link} - ${message}`, "error");
    }

    await advanceJob(index + 1);
  }

  const wasStopped = stopped || currentJob.cancelRequested;
  await appendLog(wasStopped ? "Tiến trình đã dừng." : "Đã xử lý xong danh sách.", wasStopped ? "warn" : "info");
  notify("Mike-Autodownload", wasStopped ? "Tiến trình đã dừng." : "Đã xử lý xong danh sách link.");
  await finishRun(runId, wasStopped);
  await publishState();
}

async function getQueueItem(id) {
  const data = await chrome.storage.local.get(["queue"]);
  return (data.queue || []).find((item) => item.id === id) || null;
}

async function advanceJob(nextIndex) {
  activeTabId = null;
  activeDownloadIds.clear();
  await updateJobState({
    nextIndex,
    activeItemId: "",
    activeTabId: null,
    activeTabUrl: "",
    activeDownloadIds: [],
    deadlineAt: 0,
    attempt: 0,
    stage: "queued"
  });
}

async function recoverActiveItem(item, downloadFolder, timeoutMs, runId) {
  if (currentJob.activeItemId !== item.id) return { handled: false };

  const downloadId = currentJob.activeDownloadIds[0];
  if (Number.isInteger(downloadId)) {
    await appendLog(`Đang đối chiếu download #${downloadId} sau khi worker được phục hồi.`, "info");
    try {
      const deadlineAt = currentJob.deadlineAt > Date.now()
        ? currentJob.deadlineAt
        : Date.now() + Math.min(timeoutMs, 30000);
      const result = await waitForDownloadId(downloadId, remainingMs(deadlineAt), runId);
      await updateItem(item.id, {
        status: "success",
        message: result.filename ? `Đã tải: ${result.filename}` : "Đã hoàn tất"
      });
      await appendLog(`Đã phục hồi download thành công: ${item.link}`, "info");
      await untrackActiveDownload(downloadId);
      return { handled: true };
    } catch (error) {
      await untrackActiveDownload(downloadId);
      await updateItem(item.id, {
        status: "failed",
        message: formatDownloadError(error)
      });
      await appendLog(`Download phục hồi thất bại: ${item.link} - ${formatDownloadError(error)}`, "error");
      return { handled: true };
    }
  }

  if (currentJob.stage === "waiting-fallback-download" || currentJob.stage === "waiting-telegram-download") {
    const expectedHosts = currentJob.stage.includes("telegram")
      ? ["web.telegram.org", "telegram.org"]
      : ["so9.vn"];
    const recentDownloads = await searchDownloads({ orderBy: ["-startTime"], limit: 50 });
    const candidate = recentDownloads.find((download) => matchesTriggeredDownload(download, {
      knownIds: new Set(),
      startedAt: Math.max(currentJob.startedAt || 0, (currentJob.updatedAt || 0) - 5000),
      expectedHosts
    }));
    if (candidate) {
      await trackActiveDownload(candidate.id);
      try {
        const recoveryDeadline = currentJob.deadlineAt > Date.now()
          ? currentJob.deadlineAt
          : Date.now() + Math.min(timeoutMs, 30000);
        const result = candidate.state === "complete"
          ? validateDownloadedItem(candidate)
          : await waitForDownloadId(candidate.id, remainingMs(recoveryDeadline), runId);
        await updateItem(item.id, {
          status: "success",
          message: result.filename ? `Đã tải: ${result.filename}` : "Đã hoàn tất"
        });
        await appendLog(`Đã phục hồi download fallback: ${item.link}`, "info");
      } catch (error) {
        await updateItem(item.id, { status: "failed", message: formatDownloadError(error) });
        await appendLog(`Download fallback phục hồi thất bại: ${item.link} - ${formatDownloadError(error)}`, "error");
      } finally {
        await untrackActiveDownload(candidate.id);
      }
      return { handled: true };
    }
  }

  await closeOwnedTab(currentJob.activeTabId, currentJob.activeTabUrl);
  await updateItem(item.id, { status: "pending", message: "Đã phục hồi sau khi worker khởi động lại" });
  await updateJobState({
    activeItemId: "",
    activeTabId: null,
    activeTabUrl: "",
    stage: "queued",
    deadlineAt: 0,
    attempt: 0
  });
  return { handled: false };
}

async function processItemWithRetry(item, downloadFolder, deadlineAt, runId) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt += 1) {
    assertRunActive(runId);
    await updateJobState({ attempt, stage: "preparing" });
    try {
      return await processItem(item, downloadFolder, deadlineAt, runId);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt >= MAX_ITEM_ATTEMPTS || remainingMs(deadlineAt) < 5000) break;
      await appendLog(`Thử lại lần ${attempt + 1}/${MAX_ITEM_ATTEMPTS}: ${formatDownloadError(error)}`, "warn");
      await sleepWithCancellation(Math.min(1200 * attempt, remainingMs(deadlineAt) - 1000), runId);
    }
  }
  throw lastError;
}

async function processItem(item, downloadFolder, deadlineAt, runId) {
  assertRunActive(runId);
  if (item.strategy === "direct-url") {
    await appendLog("Đang tải link video trực tiếp bằng Chrome API.", "info");
    return await downloadDirectUrl(item.link, downloadFolder, "", deadlineAt, runId);
  }

  if (item.strategy === "direct-media") {
    return await processDirectMediaPage(item, downloadFolder, deadlineAt, runId);
  }

  if (item.strategy === "telegram-private") {
    return await processTelegramItem(item, downloadFolder, deadlineAt, runId);
  }

  return await processPlatformItem(item, downloadFolder, deadlineAt, runId);
}

async function processPlatformItem(item, downloadFolder, deadlineAt, runId) {
  const chain = BACKENDS[item.platform] || [item.downloaderUrl];
  let lastError = null;

  for (const backend of chain) {
    assertRunActive(runId);
    if (remainingMs(deadlineAt) < 5000) break;
    try {
      if (backend === "native") {
        await appendLog("Đang đọc URL video ngay trên trang gốc.", "info");
        return await processDirectMediaPage(item, downloadFolder, deadlineAt, runId);
      }
      return await processSo9Item(item, downloadFolder, deadlineAt, runId, backend);
    } catch (error) {
      lastError = error;
      if (/RUN_(?:STOPPED|REPLACED)|USER_CANCELED|PERMISSION/.test(error?.message || "")) throw error;
      await appendLog(`${backendLabel(backend)} thất bại: ${formatDownloadError(error)}. Thử nguồn tiếp theo.`, "warn");
    }
  }

  throw lastError || new Error("Hết thời gian trước khi thử nguồn tải.");
}

function backendLabel(backend) {
  if (backend === "native") return "Trang gốc";
  try {
    return new URL(backend).hostname.replace(/^www\./, "");
  } catch (_) {
    return backend;
  }
}

async function processSo9Item(item, downloadFolder, deadlineAt, runId, backendUrl = item.downloaderUrl) {
  const site = backendLabel(backendUrl);
  const tab = await chrome.tabs.create({ url: backendUrl, active: false });
  await trackActiveTab(tab.id, backendUrl, "loading-so9");

  try {
    await waitForTabComplete(tab.id, remainingMs(deadlineAt), runId);
    await appendLog(`Đã mở ${site} ở chế độ nền.`, "info");
    await updateJobState({ stage: "preparing-so9" });

    const prepared = await sendContentMessageWithRetry(tab.id, {
      type: "PREPARE_DOWNLOAD",
      link: item.link
    }, Math.min(90000, remainingMs(deadlineAt)));

    await appendLog(`Đã nhập link và tạo file trên ${site}.`, "info");

    if (prepared.directUrl && !prepared.isBlobUrl) {
      await appendLog("Đang tải bằng Chrome API.", "info");
      return await downloadDirectUrl(prepared.directUrl, downloadFolder, prepared.filename, deadlineAt, runId);
    }

    if (prepared.canFallbackClick) {
      await appendLog(`Fallback click nút tải trên ${site}.`, "warn");
      await updateJobState({ stage: "waiting-fallback-download" });
      return await waitForDownloadTriggered({
        downloadFolder,
        timeoutMs: remainingMs(deadlineAt),
        runId,
        expectedHosts: [site],
        triggerDownload: async () => {
          await sendContentMessageWithRetry(tab.id, { type: "CLICK_FINAL_DOWNLOAD" }, Math.min(15000, remainingMs(deadlineAt)));
        }
      });
    }

    throw new Error(prepared.pageError || `${site} đã xử lý link nhưng không trả về URL hoặc nút tải.`);
  } finally {
    await closeTrackedTab(tab.id);
  }
}

async function processDirectMediaPage(item, downloadFolder, deadlineAt, runId) {
  const storyPage = isStoryPageItem(item);
  const tab = await chrome.tabs.create({ url: item.link, active: storyPage });
  await trackActiveTab(tab.id, item.link, "loading-media-page");

  try {
    await waitForTabComplete(tab.id, Math.min(remainingMs(deadlineAt), 45000), runId);
    const captureLabel = item.platform === "instagram-media" ? "trang Instagram" : storyPage ? "story" : "trang media";
    await appendLog(storyPage ? `Đang bắt URL video trực tiếp từ ${captureLabel}.` : "Đang quét video trực tiếp trên trang.", "info");
    await updateJobState({ stage: "scanning-media-page" });

    if (storyPage) await prepareStoryVideoSurface(tab.id);
    const { scan, candidate } = await waitForDirectMediaCandidate(tab.id, deadlineAt, runId, storyPage ? 20000 : 5000);
    if (!candidate) {
      throw new Error(scan.blockedReason || "Không tìm thấy URL video trực tiếp. Trang có thể dùng blob, HLS/DASH, DRM, đăng nhập hoặc cơ chế không cho tải tự động.");
    }

    const qualityText = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : "";
    await appendLog(`Đã tìm thấy video trực tiếp${qualityText}.`, "info");
    return await downloadDirectUrl(candidate.url, downloadFolder, candidate.filename, deadlineAt, runId);
  } finally {
    await closeTrackedTab(tab.id);
  }
}

function isStoryPageItem(item) {
  if (item?.platform === "instagram-story" || item?.platform === "facebook-story" || item?.platform === "instagram-media") return true;
  try {
    const url = new URL(item?.link || "");
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    return (hostname === "instagram.com" && (/^\/stories\//.test(path) || /^\/(?:[a-z0-9._]+\/)?(?:p|reel|tv)\/[^/?#]+\/?$/.test(path))) ||
      (hostname === "facebook.com" && (path.startsWith("/stories/") || (path === "/story.php" && url.searchParams.has("story_fbid"))));
  } catch (_) {
    return false;
  }
}

async function waitForDirectMediaCandidate(tabId, deadlineAt, runId, maxWaitMs) {
  const pollDeadline = Math.min(deadlineAt, Date.now() + maxWaitMs);
  let scan = { candidates: [], blockedReason: "" };

  while (Date.now() < pollDeadline) {
    assertRunActive(runId);
    scan = await scanDirectMediaPage(tabId);
    const candidate = chooseBestMediaCandidate(scan.candidates || []);
    if (candidate) return { scan, candidate };

    const remaining = pollDeadline - Date.now();
    if (remaining <= 0) break;
    await sleepWithCancellation(Math.min(900, remaining), runId);
  }

  return { scan, candidate: null };
}

async function prepareStoryVideoSurface(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: clickStoryPlaybackControl
    });
  } catch (_) {
    // The story may already be playing or may require an explicit user gesture.
  }
}

function clickStoryPlaybackControl() {
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.visibility !== "hidden" && style.display !== "none";
  };

  const video = [...document.querySelectorAll("video")].find(isVisible);
  if (video) {
    video.muted = true;
    const playback = video.play?.();
    playback?.catch?.(() => {});
    return { ok: true, action: "play-video" };
  }

  const controls = [...document.querySelectorAll("button, [role='button']")]
    .filter(isVisible)
    .filter((element) => /\b(play|phat|xem)\b/i.test([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className
    ].filter(Boolean).join(" ")));
  const control = controls[0];
  if (control) {
    control.click?.();
    return { ok: true, action: "click-play" };
  }
  return { ok: false };
}

async function processTelegramItem(item, downloadFolder, deadlineAt, runId) {
  const telegramUrl = item.telegramWebUrl || item.link;
  const tab = await chrome.tabs.create({ url: telegramUrl, active: true });
  await trackActiveTab(tab.id, telegramUrl, "loading-telegram");

  try {
    await waitForTabComplete(tab.id, Math.min(remainingMs(deadlineAt), 60000), runId);
    await appendLog("Đã mở Telegram Web. Hãy đảm bảo Chrome đã đăng nhập Telegram và bạn có quyền xem video.", "info");
    await updateJobState({ stage: "scanning-telegram" });

    const scan = await waitForTelegramCandidate(tab.id, remainingMs(deadlineAt), runId);
    const candidate = scan.candidate || {};
    const qualityText = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : "";
    if (!scan.hasDownloadControl) {
      throw new Error("Telegram Web không hiển thị nút tải/lưu cho video này. Tool không bypass hạn chế tải hoặc quyền riêng tư của Telegram.");
    }

    await appendLog(`Đang click nút tải Telegram Web${qualityText}.`, "info");
    await updateJobState({ stage: "waiting-telegram-download" });
    return await waitForDownloadTriggered({
      downloadFolder,
      timeoutMs: remainingMs(deadlineAt),
      runId,
      expectedHosts: ["web.telegram.org", "telegram.org"],
      triggerDownload: async () => {
        await clickTelegramDownloadControl(tab.id);
      }
    });
  } finally {
    await closeTrackedTab(tab.id);
  }
}

async function waitForTelegramCandidate(tabId, timeoutMs, runId) {
  const startedAt = Date.now();
  let preparedPreview = false;
  let lastScan = null;

  while (Date.now() - startedAt < timeoutMs) {
    assertRunActive(runId);
    lastScan = await scanTelegramPage(tabId);

    if (lastScan.needsLogin) {
      throw new Error("Telegram Web chưa đăng nhập. Hãy đăng nhập Telegram Web trong Chrome rồi chạy lại.");
    }

    const candidate = chooseBestTelegramCandidate(lastScan.candidates || []);
    if (lastScan.hasDownloadControl) {
      return {
        candidate,
        hasDownloadControl: true
      };
    }

    if (!preparedPreview && Date.now() - startedAt > 3500) {
      preparedPreview = true;
      const prepared = await prepareTelegramVideoSurface(tabId);
      if (prepared.clicked) {
        await appendLog("Đã mở preview video Telegram để lấy nguồn tải.", "info");
      }
    }

    await sleepWithCancellation(900, runId);
  }

  if (lastScan?.candidates?.length) {
    throw new Error("Telegram Web có video đang hiển thị nhưng không có nút tải/lưu khả dụng. Tool không bypass hạn chế tải hoặc quyền riêng tư của Telegram.");
  }

  throw new Error(lastScan?.blockedReason || "Không tìm thấy video Telegram đang hiển thị. Hãy mở đúng tin nhắn video trong Telegram Web rồi chạy lại.");
}

async function scanTelegramPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectTelegramVideoCandidates
  });
  return result?.result || { candidates: [], blockedReason: "" };
}

async function prepareTelegramVideoSurface(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickTelegramVideoPreview
  });
  return result?.result || { clicked: false };
}

async function clickTelegramDownloadControl(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickVisibleTelegramDownloadControl
  });

  if (!result?.result?.ok) {
    throw new Error(result?.result?.error || "Không tìm thấy nút tải Telegram Web.");
  }
}

function chooseBestTelegramCandidate(candidates) {
  return candidates
    .filter((candidate) => candidate?.url && !/^data:/i.test(candidate.url) && !/\.(m3u8|mpd)(?:$|[?#])/i.test(candidate.url))
    .sort((a, b) => {
      const qualityDiff = (b.quality || 0) - (a.quality || 0);
      if (qualityDiff) return qualityDiff;
      const blobDiff = Number(Boolean(b.isBlobUrl)) - Number(Boolean(a.isBlobUrl));
      if (blobDiff) return blobDiff;
      const areaDiff = (b.area || 0) - (a.area || 0);
      if (areaDiff) return areaDiff;
      return (b.score || 0) - (a.score || 0);
    })[0] || null;
}

function collectTelegramVideoCandidates() {
  const directVideoPattern = /\.(mp4|m4v|mov|webm)(?:$|[?#])/i;
  const candidates = [];
  const seen = new Set();
  const text = String(document.body?.innerText || "");
  const normalizedText = normalizeText(text);
  const needsLogin = /log in|login|phone number|qr code|sign in|dang nhap|đăng nhập/i.test(normalizedText) &&
    !document.querySelector("video");

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();
  }

  function toAbsoluteUrl(raw) {
    if (!raw) return "";
    try {
      return new URL(raw, location.href).href;
    } catch (_) {
      return "";
    }
  }

  function getElementText(element) {
    return [
      element?.innerText,
      element?.textContent,
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      element?.getAttribute?.("download"),
      element?.dataset?.quality,
      element?.dataset?.resolution
    ].filter(Boolean).join(" ");
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isDownloadControl(element) {
    const textValue = normalizeText([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("download"),
      element.className
    ].filter(Boolean).join(" "));
    const hasDownloadText = /\b(download|save|tai xuong|luu)\b/.test(textValue);
    const isNavigation = /\b(close|back|search|menu|forward|share|copy|delete)\b/.test(textValue);
    return isVisible(element) && hasDownloadText && !isNavigation;
  }

  function inferQuality(url, label, width, height) {
    const textValue = `${url} ${label || ""} ${width || ""}x${height || ""}`;
    const values = [...textValue.matchAll(/\b(2160|1440|1080|720|576|480|360|240)p\b/gi)].map((match) => Number(match[1]));
    const dimensionMatch = textValue.match(/\b\d{3,4}x(\d{3,4})\b/i);
    if (dimensionMatch) values.push(Number(dimensionMatch[1]));
    if (height) values.push(Number(height));
    const quality = Math.max(0, ...values.filter(Number.isFinite));
    return { quality, qualityLabel: quality ? `${quality}p` : "" };
  }

  function inferFilename(url, label) {
    try {
      const parsed = new URL(url);
      const rawName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      if (/\.[a-z0-9]{2,6}$/i.test(rawName)) return rawName;
    } catch (_) {
      // Fall back to a generated Telegram filename.
    }

    const labelName = String(label || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
    return `${labelName || "telegram-video"}-${Date.now()}.mp4`;
  }

  function addCandidate(rawUrl, meta = {}) {
    const url = toAbsoluteUrl(rawUrl);
    if (!url || seen.has(url)) return;

    const isBlobUrl = /^blob:/i.test(url);
    const isDirectVideo = directVideoPattern.test(url) || /^video\//i.test(meta.mime || "");
    if (!isBlobUrl && !isDirectVideo) return;

    seen.add(url);
    const label = meta.label || "";
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
    const quality = inferQuality(url, label, width, height);

    candidates.push({
      url,
      filename: meta.filename || inferFilename(url, label),
      quality: quality.quality,
      qualityLabel: quality.qualityLabel,
      area: width * height,
      duration: Number(meta.duration || 0),
      mime: meta.mime || "",
      isBlobUrl,
      source: meta.source || "telegram",
      score: (quality.quality || 0) + (width * height / 1000) + (isBlobUrl ? 80 : 40)
    });
  }

  for (const video of document.querySelectorAll("video")) {
    const rect = video.getBoundingClientRect();
    addCandidate(video.currentSrc || video.src, {
      label: getElementText(video) || document.title,
      mime: video.type || "",
      width: video.videoWidth || rect.width || video.getAttribute("width"),
      height: video.videoHeight || rect.height || video.getAttribute("height"),
      duration: video.duration,
      source: "telegram-video"
    });

    for (const source of video.querySelectorAll("source[src]")) {
      addCandidate(source.src, {
        label: getElementText(source) || getElementText(video) || document.title,
        mime: source.type || "",
        width: video.videoWidth || rect.width,
        height: video.videoHeight || rect.height,
        duration: video.duration,
        source: "telegram-source"
      });
    }
  }

  for (const anchor of document.querySelectorAll("a[href]")) {
    addCandidate(anchor.href, {
      label: getElementText(anchor) || document.title,
      filename: anchor.getAttribute("download") || "",
      source: "telegram-anchor"
    });
  }

  for (const entry of performance.getEntriesByType("resource")) {
    addCandidate(entry.name, {
      label: entry.name,
      source: "telegram-performance"
    });
  }

  const hasDownloadControl = [...document.querySelectorAll("a[href], button, [role='button']")]
    .some(isDownloadControl);

  let blockedReason = "";
  if (!candidates.length && !needsLogin && document.querySelector("canvas")) {
    blockedReason = "Telegram Web đang render media nhưng chưa expose video source. Hãy mở/phát video rồi chạy lại.";
  }

  return {
    candidates,
    needsLogin,
    hasDownloadControl,
    blockedReason,
    title: document.title || ""
  };
}

function clickTelegramVideoPreview() {
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 12 && rect.height > 12 && style.visibility !== "hidden" && style.display !== "none";
  }

  function textOf(element) {
    return [
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className
    ].filter(Boolean).join(" ").toLowerCase();
  }

  const selectors = [
    "video",
    "button[aria-label*='Play' i]",
    "[role='button'][aria-label*='Play' i]",
    "[class*='video' i]",
    "[class*='media' i][role='button']",
    "[class*='media' i] button",
    "[class*='play' i]"
  ];

  const candidates = [...document.querySelectorAll(selectors.join(","))]
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = textOf(element);
      let score = rect.width * rect.height;
      if (/video|play|media/.test(text)) score += 250000;
      if (/download|close|back|search|menu|emoji|send/.test(text)) score -= 500000;
      return { element, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const target = candidates[0]?.element;
  if (!target) return { clicked: false };

  target.scrollIntoView?.({ block: "center", inline: "center" });
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventOptions = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new MouseEvent("mouseover", eventOptions));
  target.dispatchEvent(new MouseEvent("mousemove", eventOptions));
  target.dispatchEvent(new MouseEvent("mousedown", eventOptions));
  target.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  target.click?.();
  return { clicked: true };
}

function clickVisibleTelegramDownloadControl() {
  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.visibility !== "hidden" && style.display !== "none";
  }

  function scoreControl(element) {
    const text = normalizeText([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("download"),
      element.className
    ].filter(Boolean).join(" "));
    const rect = element.getBoundingClientRect();
    let score = 0;
    if (/\b(download|save|tai xuong|luu)\b/.test(text)) score += 1000;
    if (element.hasAttribute("download")) score += 600;
    if (element.tagName.toLowerCase() === "a" && element.getAttribute("href")) score += 200;
    if (/\b(close|back|search|menu|forward|share|copy|delete)\b/.test(text)) score -= 2000;
    score += Math.min(120, rect.width + rect.height);
    return score;
  }

  const controls = [...document.querySelectorAll("a[href], button, [role='button']")]
    .filter(isVisible)
    .map((element) => ({ element, score: scoreControl(element) }))
    .filter((item) => item.score > 800)
    .sort((a, b) => b.score - a.score);

  const target = controls[0]?.element;
  if (!target) {
    return { ok: false, error: "Telegram Web không có nút tải/lưu khả dụng cho video này." };
  }

  target.scrollIntoView?.({ block: "center", inline: "center" });
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventOptions = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new MouseEvent("mouseover", eventOptions));
  target.dispatchEvent(new MouseEvent("mousemove", eventOptions));
  target.dispatchEvent(new MouseEvent("mousedown", eventOptions));
  target.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  target.click?.();
  return { ok: true };
}

async function scanDirectMediaPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectDirectMediaCandidates
  });
  return result?.result || { candidates: [], blockedReason: "" };
}

function chooseBestMediaCandidate(candidates) {
  return candidates
    .filter((candidate) => candidate?.url && isDownloadableVideoCandidate(candidate))
    .sort((a, b) => {
      const qualityDiff = (b.quality || 0) - (a.quality || 0);
      if (qualityDiff) return qualityDiff;
      const mp4Diff = Number(/\.mp4(?:$|[?#])/i.test(b.url)) - Number(/\.mp4(?:$|[?#])/i.test(a.url));
      if (mp4Diff) return mp4Diff;
      return (b.score || 0) - (a.score || 0);
    })[0] || null;
}

function isDownloadableVideoCandidate(candidate) {
  if (/^blob:|^data:/i.test(candidate.url)) return false;
  if (/\.(m3u8|mpd)(?:$|[?#])/i.test(candidate.url)) return false;
  return /\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(candidate.url) || /^video\//i.test(candidate.mime || "");
}

function collectDirectMediaCandidates() {
  const directVideoPattern = /\.(mp4|m4v|mov|webm)(?:$|[?#])/i;
  const streamPattern = /\.(m3u8|mpd)(?:$|[?#])/i;
  const seen = new Set();
  const candidates = [];
  let sawBlob = false;
  let sawStream = false;

  function toAbsoluteUrl(raw) {
    if (!raw) return "";
    try {
      return new URL(raw, location.href).href;
    } catch (_) {
      return "";
    }
  }

  function getText(element) {
    return [
      element?.innerText,
      element?.textContent,
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      element?.getAttribute?.("download"),
      element?.getAttribute?.("label"),
      element?.dataset?.quality,
      element?.dataset?.resolution
    ].filter(Boolean).join(" ");
  }

  function inferQuality(url, label, width, height) {
    const text = `${url} ${label || ""} ${width || ""}x${height || ""}`;
    const values = [...text.matchAll(/\b(2160|1440|1080|720|576|480|360|240)p\b/gi)].map((match) => Number(match[1]));
    const dimensionMatch = text.match(/\b\d{3,4}x(\d{3,4})\b/i);
    if (dimensionMatch) values.push(Number(dimensionMatch[1]));
    if (height) values.push(Number(height));
    const quality = Math.max(0, ...values.filter(Number.isFinite));
    return {
      quality,
      qualityLabel: quality ? `${quality}p` : ""
    };
  }

  function inferFilename(url, label) {
    try {
      const parsed = new URL(url);
      const raw = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      if (/\.[a-z0-9]{2,6}$/i.test(raw)) return raw;
    } catch (_) {
      // Fall through to label-based fallback.
    }

    const safeLabel = String(label || "direct-media")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    return `${safeLabel || "direct-media"}.mp4`;
  }

  function looksLikeDirectVideo(url, mime) {
    if (!url || /^data:/i.test(url)) return false;
    if (/^blob:/i.test(url)) {
      sawBlob = true;
      return false;
    }
    if (streamPattern.test(url)) {
      sawStream = true;
      return false;
    }
    return directVideoPattern.test(url) || /^video\//i.test(mime || "");
  }

  function addCandidate(rawUrl, meta = {}) {
    const url = toAbsoluteUrl(rawUrl);
    if (!looksLikeDirectVideo(url, meta.mime)) return;
    if (seen.has(url)) return;
    seen.add(url);

    const label = meta.label || "";
    const quality = inferQuality(url, label, meta.width, meta.height);
    candidates.push({
      url,
      filename: meta.filename || inferFilename(url, label),
      quality: quality.quality,
      qualityLabel: quality.qualityLabel,
      mime: meta.mime || "",
      source: meta.source || "page",
      score: (quality.quality || 0) + (directVideoPattern.test(url) ? 100 : 40)
    });
  }

  for (const video of document.querySelectorAll("video")) {
    addCandidate(video.currentSrc || video.src, {
      label: getText(video),
      mime: video.type || "",
      width: video.videoWidth || video.getAttribute("width"),
      height: video.videoHeight || video.getAttribute("height"),
      source: "video"
    });

    for (const source of video.querySelectorAll("source[src]")) {
      addCandidate(source.src, {
        label: getText(source) || getText(video),
        mime: source.type || "",
        width: video.videoWidth || source.getAttribute("width"),
        height: video.videoHeight || source.getAttribute("height"),
        source: "source"
      });
    }
  }

  for (const source of document.querySelectorAll("source[src]")) {
    addCandidate(source.src, {
      label: getText(source),
      mime: source.type || "",
      source: "source"
    });
  }

  for (const anchor of document.querySelectorAll("a[href]")) {
    addCandidate(anchor.href, {
      label: getText(anchor),
      filename: anchor.getAttribute("download") || "",
      source: "anchor"
    });
  }

  const dataAttributes = ["src", "href", "video", "url", "file", "media"];
  for (const element of document.querySelectorAll("[data-src], [data-href], [data-video], [data-url], [data-file], [data-media]")) {
    for (const name of dataAttributes) {
      addCandidate(element.dataset?.[name], {
        label: getText(element),
        source: `data-${name}`
      });
    }
  }

  // JSON nhúng trong <script> của Facebook (browser_native_hd_url), TikTok (playAddr), Instagram (video_url).
  // ponytail: lấy theo thứ tự xuất hiện; trang video đơn thường đặt video chính trước tiên.
  const scriptText = [...document.scripts].map((script) => script.textContent || "").join("\n");
  const jsonKeyPattern = /"(browser_native_hd_url|browser_native_sd_url|playAddr|video_url)"\s*:\s*"(https?:[^"]+)"/g;
  const keyQuality = { browser_native_hd_url: "1080p", browser_native_sd_url: "480p", playAddr: "720p", video_url: "720p" };
  const pageTitle = (document.title || "video").replace(/\s*[|\-\u2013]\s*(Facebook|TikTok|Instagram|Douyin|YouTube|Bilibili|哔哩哔哩).*$/i, "").slice(0, 80);
  for (const match of scriptText.matchAll(/"itag"\s*:\s*(18|22)\s*,[^{}]*?"url"\s*:\s*"(https:[^"]+googlevideo\.com[^"]+)"/g)) {
    addCandidate(match[2].replace(/\\u0026/g, "&"), {
      label: `${pageTitle} ${match[1] === "22" ? "720p" : "360p"}`,
      filename: `${pageTitle}.mp4`,
      mime: "video/mp4",
      source: "script-youtube"
    });
  }
  for (const match of scriptText.matchAll(jsonKeyPattern)) {
    const url = match[2].replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\"/g, '"');
    addCandidate(url, {
      label: `${pageTitle} ${keyQuality[match[1]]}`,
      filename: `${pageTitle}.mp4`,
      mime: "video/mp4",
      source: `script-${match[1]}`
    });
  }

  for (const entry of performance.getEntriesByType("resource")) {
    addCandidate(entry.name, {
      label: entry.name,
      source: "performance"
    });
    if (streamPattern.test(entry.name)) sawStream = true;
    if (/^blob:/i.test(entry.name)) sawBlob = true;
  }

  let blockedReason = "";
  if (!candidates.length && sawStream) {
    blockedReason = "Trang chỉ expose HLS/DASH playlist; bản này không ghép stream thành video.";
  } else if (!candidates.length && sawBlob) {
    blockedReason = "Trang dùng blob stream; không có URL file video trực tiếp để Chrome tải.";
  }

  return {
    candidates,
    blockedReason,
    title: document.title || ""
  };
}

async function sendContentMessageWithRetry(tabId, message, timeoutMs) {
  let lastError;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    try {
      return await sendContentMessage(tabId, message, remaining);
    } catch (error) {
      lastError = error;
      if (!String(error.message || error).includes("Receiving end does not exist")) break;
      const backoff = Math.min(900, timeoutMs - (Date.now() - startedAt));
      if (backoff <= 0) break;
      await sleep(backoff);
    }
  }
  throw lastError || new Error("Trang SO9 không phản hồi trong thời gian cho phép.");
}

function sendContentMessage(tabId, message, timeoutMs) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(async () => {
      const pageError = await detectDownloaderPageError(tabId);
      reject(new Error(pageError || "Trang SO9 không phản hồi sau khi nhập link."));
    }, timeoutMs);
  });

  const send = new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Content script không thể thao tác trang."));
        return;
      }
      resolve(response.result || {});
    });
  });

  return Promise.race([send, timeout]).finally(() => clearTimeout(timerId));
}

async function downloadDirectUrl(url, downloadFolder, suggestedName, deadlineAt, runId) {
  const parsedUrl = parseHttpUrl(url);
  assertRunActive(runId);
  const filename = buildDownloadFilename(downloadFolder, suggestedName, url);
  await updateJobState({ stage: "starting-direct-download" });
  const id = await chromeDownload({
    url: parsedUrl.href,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  await trackActiveDownload(id);

  try {
    return await waitForDownloadId(id, remainingMs(deadlineAt), runId);
  } catch (error) {
    if (isTimeoutError(error) || stopped || currentJob.cancelRequested) {
      await cancelDownload(id);
    }
    throw error;
  } finally {
    await untrackActiveDownload(id);
  }
}

async function waitForDownloadTriggered({ downloadFolder, timeoutMs, triggerDownload, runId, expectedHosts = [] }) {
  assertRunActive(runId);
  const knownIds = new Set((await searchDownloads({ state: "in_progress" })).map((item) => item.id));

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let watchedId = null;
    let settled = false;
    let trackingPromise = Promise.resolve();

    const timer = setTimeout(() => cleanupReject(new Error("DOWNLOAD_TIMEOUT: Hết thời gian chờ file tải về."), true), timeoutMs);
    const stopPoll = setInterval(() => {
      if (stopped || currentJob.cancelRequested || currentJob.runId !== runId) {
        cleanupReject(new Error("RUN_STOPPED: Tiến trình đã được yêu cầu dừng."), true);
      }
    }, 250);

    function cleanup() {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      clearInterval(stopPoll);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
      return true;
    }

    function cleanupReject(error, shouldCancel = false) {
      if (!cleanup()) return;
      const cancelPromise = shouldCancel && Number.isInteger(watchedId)
        ? cancelDownload(watchedId)
        : Promise.resolve();
      Promise.resolve(trackingPromise)
        .then(() => cancelPromise)
        .then(() => Number.isInteger(watchedId) ? untrackActiveDownload(watchedId) : undefined)
        .finally(() => reject(error));
    }

    function claimDownload(downloadItem) {
      if (watchedId) return downloadItem.id === watchedId;
      if (!matchesTriggeredDownload(downloadItem, { knownIds, startedAt, expectedHosts })) return false;
      watchedId = downloadItem.id;
      activeDownloadIds.add(downloadItem.id);
      trackingPromise = trackActiveDownload(downloadItem.id);
      return true;
    }

    function onDeterminingFilename(downloadItem, suggest) {
      if (Date.now() - startedAt > timeoutMs || !claimDownload(downloadItem)) {
        suggest();
        return;
      }
      const originalName = getBaseName(downloadItem.filename) || `so9-${Date.now()}.mp4`;
      suggest({ filename: `${downloadFolder}/${sanitizeFilename(originalName)}`, conflictAction: "uniquify" });
    }

    function onCreated(downloadItem) {
      if (Date.now() - startedAt > timeoutMs) return;
      claimDownload(downloadItem);
    }

    function onChanged(delta) {
      if (!watchedId || delta.id !== watchedId) return;
      if (delta.error) {
        cleanupReject(new Error(`Chrome báo lỗi tải file: ${delta.error.current}`));
      }
      if (delta.state?.current === "complete") {
        Promise.resolve(trackingPromise)
          .then(() => searchDownloads({ id: delta.id }))
          .then((items) => validateDownloadedItem(items[0]))
          .then(async (result) => {
            await untrackActiveDownload(delta.id);
            if (cleanup()) resolve(result);
          })
          .catch((error) => cleanupReject(error));
      }
      if (delta.state?.current === "interrupted") {
        cleanupReject(new Error("File tải về bị gián đoạn."));
      }
    }

    chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);

    Promise.resolve()
      .then(triggerDownload)
      .catch(cleanupReject);
  });
}

function waitForDownloadId(downloadId, timeoutMs, runId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!cleanup()) return;
      cancelDownload(downloadId)
        .finally(() => reject(new Error("DOWNLOAD_TIMEOUT: Hết thời gian chờ file tải về.")));
    }, timeoutMs);

    function cleanup() {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      return true;
    }

    function cleanupReject(error) {
      if (cleanup()) reject(error);
    }

    async function resolveFromSearch() {
      try {
        if (runId) assertRunActive(runId, { allowStopping: true });
        const items = await searchDownloads({ id: downloadId });
        const item = items[0];
        if (!item) {
          cleanupReject(new Error(`Không còn tìm thấy download #${downloadId}.`));
          return;
        }
        if (item.state === "complete") {
          const result = validateDownloadedItem(item);
          if (cleanup()) resolve(result);
        } else if (item.state === "interrupted") {
          cleanupReject(new Error(`Chrome báo lỗi tải file: ${item.error || "interrupted"}`));
        }
      } catch (error) {
        cleanupReject(error);
      }
    }

    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      if (delta.error) {
        cleanupReject(new Error(`Chrome báo lỗi tải file: ${delta.error.current}`));
      }
      if (delta.state?.current === "complete") {
        resolveFromSearch();
      }
      if (delta.state?.current === "interrupted") {
        cleanupReject(new Error("File tải về bị gián đoạn."));
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);
    resolveFromSearch();
  });
}

function matchesTriggeredDownload(downloadItem, { knownIds, startedAt, expectedHosts }) {
  if (!downloadItem || knownIds.has(downloadItem.id)) return false;
  const started = Date.parse(downloadItem.startTime || "");
  if (Number.isFinite(started) && started < startedAt - 1500) return false;
  if (downloadItem.byExtensionId && downloadItem.byExtensionId !== chrome.runtime.id) return false;
  if (downloadItem.byExtensionId === chrome.runtime.id) return true;

  const hosts = [downloadItem.referrer, downloadItem.url, downloadItem.finalUrl]
    .map(getHostname)
    .filter(Boolean);
  return expectedHosts.some((expected) => hosts.some((host) => host === expected || host.endsWith(`.${expected}`)));
}

function validateDownloadedItem(item) {
  if (!item) throw new Error("DOWNLOAD_NOT_FOUND: Chrome không trả về thông tin file tải.");
  if (item.state === "interrupted") {
    throw new Error(`Chrome báo lỗi tải file: ${item.error || "interrupted"}`);
  }

  const mime = String(item.mime || "").toLowerCase();
  const filename = String(item.filename || "");
  if (mime.startsWith("text/html") || mime.startsWith("image/")) {
    throw new Error(`DOWNLOAD_MISMATCH: Máy chủ trả về ${mime || "nội dung không phải video"}.`);
  }
  if (/\.(html?|xhtml|jpe?g|png|gif|webp|svg)(?:$|[?#])/i.test(filename)) {
    throw new Error("DOWNLOAD_MISMATCH: File tải về không phải định dạng video.");
  }
  if (item.totalBytes === 0 || item.fileSize === 0) {
    throw new Error("DOWNLOAD_EMPTY: File tải về rỗng.");
  }
  if (item.danger && !["safe", "accepted", "allowlistedByPolicy"].includes(item.danger)) {
    throw new Error(`DOWNLOAD_DANGER: Chrome đánh dấu file ở trạng thái ${item.danger}.`);
  }

  return {
    id: item.id,
    filename,
    mime,
    totalBytes: item.totalBytes,
    finalUrl: item.finalUrl || item.url || ""
  };
}

function searchDownloads(query) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search(query, (items) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(items || []);
    });
  });
}

function parseHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error("INVALID_DOWNLOAD_URL: URL tải về không hợp lệ.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("INVALID_DOWNLOAD_URL: Chỉ hỗ trợ URL HTTP hoặc HTTPS trực tiếp.");
  }
  return parsed;
}

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function remainingMs(deadlineAt) {
  const remaining = Math.floor(Number(deadlineAt || 0) - Date.now());
  if (remaining <= 0) throw new Error("ITEM_TIMEOUT: Đã hết thời gian xử lý link.");
  return remaining;
}

function assertRunActive(runId, options = {}) {
  if (!runId || currentJob.runId !== runId) {
    throw new Error("RUN_REPLACED: Tiến trình đã được thay thế hoặc kết thúc.");
  }
  if (!options.allowStopping && (stopped || currentJob.cancelRequested || currentJob.status === "stopping")) {
    throw new Error("RUN_STOPPED: Tiến trình đã được yêu cầu dừng.");
  }
}

function isTimeoutError(error) {
  return /(?:TIMEOUT|hết thời gian|tải quá lâu)/i.test(error?.message || String(error));
}

function isRetryableError(error) {
  const message = error?.message || String(error);
  if (/RUN_(?:STOPPED|REPLACED)|USER_CANCELED|PERMISSION|INVALID_DOWNLOAD_URL|DOWNLOAD_(?:MISMATCH|DANGER|EMPTY)|đăng nhập|captcha|checkpoint|không hợp lệ|không hỗ trợ/i.test(message)) {
    return false;
  }
  return /TIMEOUT|NETWORK_|SERVER_|Receiving end does not exist|không phản hồi|tải quá lâu|bị gián đoạn|không tìm thấy/i.test(message);
}

async function sleepWithCancellation(ms, runId) {
  const endAt = Date.now() + Math.max(0, ms);
  while (Date.now() < endAt) {
    assertRunActive(runId);
    await sleep(Math.min(250, endAt - Date.now()));
  }
}

async function trackActiveTab(tabId, tabUrl, stage) {
  activeTabId = tabId;
  await updateJobState({ activeTabId: tabId, activeTabUrl: tabUrl || "", stage });
}

async function closeTrackedTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (_) {
    // The user may have closed the tab first.
  }
  if (activeTabId === tabId) activeTabId = null;
  if (currentJob.activeTabId === tabId) {
    await updateJobState({ activeTabId: null, activeTabUrl: "" });
  }
}

async function closeOwnedTab(tabId, expectedUrl) {
  if (!Number.isInteger(tabId)) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const expectedHost = getHostname(expectedUrl);
    const actualHost = getHostname(tab?.url || tab?.pendingUrl || "");
    if (expectedHost && actualHost && actualHost !== expectedHost && !actualHost.endsWith(`.${expectedHost}`)) return;
    await chrome.tabs.remove(tabId);
  } catch (_) {
    // Missing or user-closed tabs require no cleanup.
  }
  if (activeTabId === tabId) activeTabId = null;
}

async function trackActiveDownload(downloadId) {
  activeDownloadIds.add(downloadId);
  await updateJobState({
    activeDownloadIds: [...new Set([...(currentJob.activeDownloadIds || []), downloadId])],
    stage: "downloading"
  });
}

async function untrackActiveDownload(downloadId) {
  activeDownloadIds.delete(downloadId);
  if (currentJob.status === "idle") return;
  await updateJobState({
    activeDownloadIds: (currentJob.activeDownloadIds || []).filter((id) => id !== downloadId)
  });
}

function chromeDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!downloadId) {
        reject(new Error("Chrome không trả về download id."));
        return;
      }
      resolve(downloadId);
    });
  });
}

async function detectDownloaderPageError(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = String(document.body?.innerText || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "d")
          .toLowerCase();
        const invalidPatterns = [
          "link khong hop le",
          "khong hop le",
          "hay thu lai",
          "invalid link",
          "not valid"
        ];
        return invalidPatterns.some((pattern) => text.includes(pattern))
          ? "SO9 báo link không hợp lệ hoặc không thể tải link này."
          : "";
      }
    });
    return result?.result || "";
  } catch (_) {
    return "";
  }
}

function waitForTabComplete(tabId, timeoutMs, runId = "") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Trang downloader tải quá lâu."));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error(stopped ? "RUN_STOPPED: Tab đã đóng theo yêu cầu dừng." : "Tab xử lý đã bị đóng trước khi tải xong."));
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        cleanup();
        reject(new Error(lastError.message));
        return;
      }
      try {
        if (runId) assertRunActive(runId);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (tab.status === "complete") {
        cleanup();
        resolve();
      }
    });
  });
}

async function updateItem(id, patch) {
  return await serializeStorageMutation(async () => {
    const data = await chrome.storage.local.get(["queue"]);
    const queue = (data.queue || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    await chrome.storage.local.set({ queue });
    return queue;
  });
}

async function appendLog(message, level = "info") {
  await serializeStorageMutation(async () => {
    const data = await chrome.storage.local.get(["logs"]);
    const logs = [{ time: Date.now(), message, level }, ...(data.logs || [])].slice(0, 300);
    await chrome.storage.local.set({ logs });
  });
}

async function publishState() {
  const data = await chrome.storage.local.get([
    "queue",
    "logs",
    "runState",
    "savedReelLinks",
    "savedReelItems",
    "lastCrawlSource",
    "lastCrawlTime"
  ]);
  const state = {
    queue: data.queue || [],
    logs: data.logs || [],
    savedReelLinks: data.savedReelLinks || [],
    savedReelItems: data.savedReelItems || [],
    lastCrawlSource: data.lastCrawlSource || "",
    lastCrawlTime: data.lastCrawlTime || 0,
    running: runLock,
    paused
  };
  chrome.runtime.sendMessage({ type: "STATE_UPDATED", state }).catch(() => {});
}

async function abortActiveWork() {
  if (activeTabId) {
    try {
      await chrome.tabs.remove(activeTabId);
    } catch (_) {
      // Ignore tab cleanup failures.
    }
    activeTabId = null;
  }

  await Promise.all([...activeDownloadIds].map((id) => cancelDownload(id)));
  activeDownloadIds.clear();
  if (currentJob.status !== "idle") {
    await updateJobState({
      activeTabId: null,
      activeTabUrl: "",
      activeDownloadIds: []
    });
  }
}

function cancelDownload(id) {
  return new Promise((resolve) => {
    chrome.downloads.cancel(id, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function buildDownloadFilename(downloadFolder, suggestedName, url) {
  const fallbackName = (() => {
    try {
      const parsed = new URL(url);
      return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    } catch (_) {
      return "";
    }
  })();

  let filename = sanitizeFilename(suggestedName || fallbackName || `so9-${Date.now()}.mp4`);
  if (/\.(?:html?|xhtml|jpe?g|png|gif|webp|svg)$/i.test(filename)) {
    filename = filename.replace(/\.[^.]+$/i, "");
  }
  if (!/\.[a-z0-9]{2,6}$/i.test(filename)) filename += ".mp4";
  return `${downloadFolder}/${filename}`;
}

function getBaseName(value) {
  return String(value || "").split(/[\\/]/).pop() || "";
}

function sanitizeFilename(value) {
  let filename = String(value || "so9-download.mp4")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 180) || "so9-download.mp4";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`;
  return filename;
}

function sanitizeFolder(value) {
  const folder = String(value || "")
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/")
    .split("/")
    .map((segment) => segment.trim().replace(/[. ]+$/g, ""))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ? `_${segment}` : segment)
    .join("/");
  return folder || "SO9-Downloads";
}

function formatDownloadError(error) {
  const message = error.message || String(error);
  if (message.includes("USER_CANCELED")) {
    return "Chrome báo USER_CANCELED. Đã thử tải tự động; hãy kiểm tra Chrome không bật hỏi nơi lưu file và không đóng tab SO9 khi automation đang chạy.";
  }
  return message;
}

function notify(title, message) {
  chrome.storage.local.get(["lang"]).then((data) => chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/mike-128.png",
    title,
    message: t(message, data.lang)
  })).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
