import { t, initLang, setLang, getLang, applyDom } from "./i18n.js";
import { formatCompact, sparklineSvg, VIRAL_MULTIPLIER } from "./analytics.js";

const ROUTES = [
  { platform: "facebook", strategy: "so9", hosts: ["facebook.com", "fb.watch"], url: "https://so9.vn/9downloader/facebook" },
  { platform: "tiktok", strategy: "so9", hosts: ["tiktok.com", "vm.tiktok.com"], url: "https://so9.vn/9downloader/tiktok" },
  { platform: "instagram", strategy: "so9", hosts: ["instagram.com"], url: "https://so9.vn/9downloader/insta" },
  { platform: "douyin", strategy: "so9", hosts: ["douyin.com"], url: "https://so9.vn/9downloader/douyin" },
  { platform: "youtube", strategy: "so9", hosts: ["youtube.com", "youtu.be"], url: "https://en1.savefrom.net/" },
  { platform: "bilibili", strategy: "so9", hosts: ["bilibili.com", "b23.tv"], url: "https://snapany.com/bilibili" }
];

const TELEGRAM_WEB_ORIGIN = "https://web.telegram.org/*";
const DIRECT_VIDEO_PATTERN = /\.(mp4|m4v|mov|webm)(?:$|[?#])/i;
const STREAMING_PLAYLIST_PATTERN = /\.(m3u8|mpd)(?:$|[?#])/i;
const RESTRICTED_GENERIC_HOSTS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "brazzers.com",
  "onlyfans.com"
];

const state = {
  queue: [],
  logs: [],
  savedReelLinks: [],
  savedReelItems: [],
  channelStats: {},
  downloadHistory: {},
  queueFilter: "all",
  queueLimit: 150,
  lastCrawlSource: "",
  lastCrawlTime: 0,
  running: false,
  paused: false,
  crawling: false
};

const els = {
  channelUrl: document.getElementById("channelUrl"),
  maxReels: document.getElementById("maxReels"),
  minViews: document.getElementById("minViews"),
  crawl: document.getElementById("crawlBtn"),
  loadSaved: document.getElementById("loadSavedBtn"),
  savedCount: document.getElementById("savedCountChip"),
  lastCrawl: document.getElementById("lastCrawlInfo"),
  file: document.getElementById("linkFile"),
  manualLinks: document.getElementById("manualLinks"),
  importText: document.getElementById("importTextBtn"),
  folder: document.getElementById("downloadFolder"),
  start: document.getElementById("startBtn"),
  pause: document.getElementById("pauseBtn"),
  stop: document.getElementById("stopBtn"),
  clear: document.getElementById("clearBtn"),
  exportLog: document.getElementById("exportLogBtn"),
  queue: document.getElementById("queueList"),
  logs: document.getElementById("logList"),
  total: document.getElementById("totalCount"),
  success: document.getElementById("successCount"),
  failed: document.getElementById("failedCount"),
  badge: document.getElementById("runBadge"),
  themeToggle: document.getElementById("themeToggle"),
  langToggle: document.getElementById("langToggle"),
  statsList: document.getElementById("statsList"),
  prune: document.getElementById("pruneBtn"),
  queueFilters: document.getElementById("queueFilters"),
  queueMore: document.getElementById("queueMoreBtn"),
  contact: document.getElementById("contactBtn"),
  contactDialog: document.getElementById("contactDialog"),
  contactClose: document.getElementById("contactClose"),
  contactQr: document.getElementById("contactQr"),
  copyEmail: document.getElementById("copyEmailBtn"),
  contactVersion: document.getElementById("contactVersion"),
  statsOnly: document.getElementById("statsOnly"),
  statsCompare: document.getElementById("statsCompare"),
  recrawlAll: document.getElementById("recrawlAllBtn"),
  exportStats: document.getElementById("exportStatsBtn"),
  clearStats: document.getElementById("clearStatsBtn"),
  clearData: document.getElementById("clearDataBtn")
};

initLang().then(() => {
  applyDom();
  init();
});

function init() {
  chrome.storage.local.get([
    "downloadFolder",
    "queue",
    "logs",
    "runState",
    "theme",
    "savedReelLinks",
    "savedReelItems",
    "channelStats",
    "downloadHistory",
    "lastStatsOnly",
    "lastCrawlSource",
    "lastCrawlTime",
    "lastCrawlMax",
    "lastMinViews"
  ], (data) => {
    state.downloadHistory = data.downloadHistory || {};
    els.statsOnly.checked = Boolean(data.lastStatsOnly);
    els.contactVersion.textContent = `v${chrome.runtime.getManifest().version}`;
    els.folder.value = data.downloadFolder || "SO9-Downloads";
    els.channelUrl.value = data.lastCrawlSource || "";
    els.maxReels.value = data.lastCrawlMax === null || data.lastCrawlMax === undefined || data.lastCrawlMax === ""
      ? ""
      : data.lastCrawlMax;
    els.minViews.value = data.lastMinViews || 0;
    state.queue = data.queue || [];
    state.logs = data.logs || [];
    state.savedReelLinks = data.savedReelLinks || [];
    state.savedReelItems = data.savedReelItems || state.savedReelLinks.map((link) => ({ link, views: 0, viewText: "" }));
    state.channelStats = data.channelStats || {};
    state.lastCrawlSource = data.lastCrawlSource || "";
    state.lastCrawlTime = data.lastCrawlTime || 0;
    state.running = data.runState?.running || false;
    state.paused = data.runState?.paused || false;
    if (data.theme === "light") document.documentElement.classList.add("light-theme");
    scheduleRender();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATE_UPDATED") {
      Object.assign(state, message.state);
      scheduleRender();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.queue) state.queue = changes.queue.newValue || [];
    if (changes.logs) state.logs = changes.logs.newValue || [];
    if (changes.savedReelLinks) state.savedReelLinks = changes.savedReelLinks.newValue || [];
    if (changes.savedReelItems) state.savedReelItems = changes.savedReelItems.newValue || [];
    if (changes.channelStats) state.channelStats = changes.channelStats.newValue || {};
    if (changes.downloadHistory) state.downloadHistory = changes.downloadHistory.newValue || {};
    if (changes.lastCrawlSource) state.lastCrawlSource = changes.lastCrawlSource.newValue || "";
    if (changes.lastCrawlTime) state.lastCrawlTime = changes.lastCrawlTime.newValue || 0;
    if (changes.runState) {
      state.running = Boolean(changes.runState.newValue?.running);
      state.paused = Boolean(changes.runState.newValue?.paused);
    }
    scheduleRender();
  });

  els.file.addEventListener("change", handleFileUpload);
  els.importText.addEventListener("click", handleManualImport);
  els.crawl.addEventListener("click", crawlChannelVideos);
  els.maxReels.addEventListener("input", () => els.maxReels.setCustomValidity(""));
  els.loadSaved.addEventListener("click", loadSavedReelsToQueue);
  els.folder.addEventListener("change", saveFolder);
  els.start.addEventListener("click", startRun);
  els.pause.addEventListener("click", togglePause);
  els.stop.addEventListener("click", stopRun);
  els.clear.addEventListener("click", clearQueue);
  els.exportLog.addEventListener("click", exportLogs);
  els.themeToggle.addEventListener("click", toggleTheme);
  els.langToggle.addEventListener("click", toggleLang);
  els.exportStats.addEventListener("click", exportStatsCsv);
  els.prune.addEventListener("click", pruneQueue);
  els.statsOnly.addEventListener("change", () => chrome.storage.local.set({ lastStatsOnly: els.statsOnly.checked }));
  els.recrawlAll.addEventListener("click", recrawlAllChannels);
  els.statsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "queue-top") queueTopFromChannel(button.dataset.source);
    if (button.dataset.action === "recrawl") recrawlChannel(button.dataset.source);
  });
  els.copyEmail.addEventListener("click", async (event) => {
    event.preventDefault();
    await navigator.clipboard.writeText("tlmtrung.ntt.it@gmail.com").catch(() => {});
    els.copyEmail.textContent = t("Đã sao chép");
    setTimeout(() => { els.copyEmail.textContent = t("Sao chép"); }, 1500);
  });
  els.queueFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.queueFilter = button.dataset.filter;
    state.queueLimit = 150;
    render();
  });
  els.queueMore.addEventListener("click", () => {
    state.queueLimit += 150;
    render();
  });
  els.queue.addEventListener("click", (event) => {
    const button = event.target.closest("button.remove");
    if (button) removeQueueItem(button.dataset.id);
  });
  els.contact.addEventListener("click", () => els.contactDialog.showModal());
  els.contactClose.addEventListener("click", () => els.contactDialog.close());
  els.contactDialog.addEventListener("click", (event) => {
    if (event.target === els.contactDialog) els.contactDialog.close();
  });
  // Ảnh QR Telegram: thử assets/telegram-qr.png rồi .jpg; không có file nào thì ẩn ô QR.
  const qrSources = ["assets/telegram-qr.png", "assets/telegram-qr.jpg"];
  const tryNextQr = () => {
    const next = qrSources.shift();
    if (next) els.contactQr.src = next;
    else els.contactQr.closest("figure").classList.add("missing");
  };
  els.contactQr.addEventListener("error", tryNextQr);
  if (!els.contactQr.getAttribute("src") || (els.contactQr.complete && !els.contactQr.naturalWidth)) tryNextQr();
  els.clearStats.addEventListener("click", clearStats);
  els.clearData.addEventListener("click", clearAllData);
}

async function clearAllData() {
  if (state.running || state.crawling) {
    addLog("Không thể xóa dữ liệu khi đang chạy.", "warn");
    render();
    return;
  }
  if (!confirm(t("Bạn có chắc chắn muốn xóa toàn bộ dữ liệu cũ (link đã lưu, danh sách tải, log, thông tin quét kênh)?"))) return;
  
  state.queue = [];
  state.logs = [];
  state.savedReelLinks = [];
  state.savedReelItems = [];
  state.lastCrawlSource = "";
  state.lastCrawlTime = 0;
  els.channelUrl.value = "";
  els.maxReels.value = "";
  els.minViews.value = "";
  
  await chrome.storage.local.remove([
    "queue", 
    "logs", 
    "savedReelLinks", 
    "savedReelItems", 
    "lastCrawlSource", 
    "lastCrawlTime", 
    "lastCrawlMax", 
    "lastMinViews"
  ]);
  
  await persist();
  render();
}

async function toggleLang() {
  await setLang(getLang() === "vi" ? "en" : "vi");
  applyDom();
  render();
}

async function toggleTheme() {
  const isLight = document.documentElement.classList.toggle("light-theme");
  await chrome.storage.local.set({ theme: isLight ? "light" : "dark" });
}

async function handleFileUpload(event) {
  if (state.running) return;
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const added = appendToQueue(buildQueueFromText(text));

  addLog(`Đã nạp ${added.added} link từ file ${file.name}, bỏ qua ${added.duplicates} link trùng`, "info");
  event.target.value = "";
  await persist();
  render();
}

// Nạp thêm vào hàng đợi hiện có, bỏ link đã có (kể cả đã tải xong) để chạy lô lớn nhiều đợt không trùng.
function appendToQueue(items) {
  const known = new Set(state.queue.map((item) => item.link));
  let added = 0;
  let duplicates = 0;
  for (const item of items) {
    if (known.has(item.link)) {
      duplicates += 1;
      continue;
    }
    known.add(item.link);
    state.queue.push(item);
    added += 1;
  }
  return { added, duplicates };
}

async function removeQueueItem(id) {
  if (state.running) return;
  state.queue = state.queue.filter((item) => item.id !== id);
  await persist();
  render();
}

async function pruneQueue() {
  if (state.running || state.crawling) return;
  const before = state.queue.length;
  state.queue = state.queue.filter((item) => !["success", "unsupported", "skipped"].includes(item.status));
  addLog(`Đã dọn ${before - state.queue.length} link đã xong/không hỗ trợ khỏi hàng đợi.`, "info");
  await persist();
  render();
}

async function handleManualImport() {
  if (state.running) return;
  const text = els.manualLinks.value.trim();
  if (!text) {
    addLog("Chưa có link để nạp.", "warn");
    await persist();
    render();
    return;
  }

  const added = appendToQueue(buildQueueFromText(text));
  addLog(`Đã nạp ${added.added} link từ ô nhập tay, bỏ qua ${added.duplicates} link trùng`, "info");
  els.manualLinks.value = "";
  await persist();
  render();
}

function buildQueueFromText(text) {
  const links = extractLinks(text);
  return buildQueueFromLinks(links);
}

function buildQueueFromLinks(links) {
  const queue = links.map((link, index) => {
    const route = detectRoute(link);
    const supported = route && route.status !== "unsupported";
    const downloadedBefore = supported && Boolean(state.downloadHistory[link]);
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      link,
      status: downloadedBefore ? "skipped" : supported ? "pending" : "unsupported",
      platform: route?.platform || "unknown",
      strategy: route?.strategy || "",
      downloaderUrl: route?.url || "",
      telegramWebUrl: route?.telegramWebUrl || "",
      permissionOrigin: route?.permissionOrigin || "",
      message: downloadedBefore ? "Đã tải trước đó, bỏ qua" : route?.message || (supported ? "Chờ xử lý" : "Không hỗ trợ domain này")
    };
  });
  return queue;
}

function buildQueueFromReelItems(items) {
  return items.map((item, index) => {
    const route = detectRoute(item.link);
    return {
      id: `${Date.now()}-${index}`,
      link: item.link,
      views: item.views || 0,
      viewText: item.viewText || "",
      status: "pending",
      platform: item.platform || route?.platform || "facebook",
      strategy: item.strategy || route?.strategy || "so9",
      downloaderUrl: item.downloaderUrl || route?.url || "https://so9.vn/9downloader/facebook",
      telegramWebUrl: route?.telegramWebUrl || "",
      permissionOrigin: route?.permissionOrigin || "",
      message: item.viewText || item.views ? `View: ${item.viewText || formatNumber(item.views)}` : "Chờ xử lý"
    };
  });
}

async function crawlChannelVideos() {
  if (state.running || state.crawling) return;
  const channel = normalizeChannelUrl(els.channelUrl.value);
  const maxCount = normalizeMaxReels(els.maxReels.value);
  const minViews = normalizeMinViews(els.minViews.value);

  if (Number.isNaN(maxCount) || els.maxReels.validity.badInput) {
    els.maxReels.setCustomValidity("Nhập số nguyên dương hợp lệ, hoặc để trống để lấy toàn bộ.");
    els.maxReels.reportValidity();
    return;
  }

  if (!channel.url) {
    addLog("Vui lòng nhập link kênh Facebook, TikTok, Instagram hoặc Douyin hợp lệ.", "warn");
    await persist();
    render();
    return;
  }

  const permissionGranted = await ensureChannelPermission(channel);
  if (!permissionGranted) {
    addLog("Chrome chưa cấp quyền đọc trang cho profile này.", "warn");
    await persist();
    render();
    return;
  }

  els.channelUrl.value = channel.url;
  els.maxReels.value = maxCount ?? "";
  els.minViews.value = minViews;
  state.crawling = true;
  const crawlMode = maxCount === null ? "toàn bộ video tìm thấy" : `tối đa ${formatNumber(maxCount)} video`;
  addLog(`Đang mở kênh ${channel.label} để quét ${crawlMode}, view tối thiểu ${formatNumber(minViews)}.`, "info");
  await persist();
  render();

  try {
    const folder = normalizeFolder(els.folder.value || "SO9-Downloads");
    els.folder.value = folder;
    await chrome.storage.local.set({ downloadFolder: folder });

    const response = await chrome.runtime.sendMessage({
      type: "CRAWL_CHANNEL_VIDEOS",
      channelUrl: channel.url,
      maxCount,
      minViews,
      folder,
      statsOnly: els.statsOnly.checked
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Không thể quét kênh video.");
    }

    state.savedReelItems = response.items || (response.links || []).map((link) => ({ link, views: 0, viewText: "" }));
    state.savedReelLinks = response.links || state.savedReelItems.map((item) => item.link);
    state.lastCrawlSource = channel.url;
    state.lastCrawlTime = response.lastCrawlTime || Date.now();

    const latest = await chrome.storage.local.get(["queue", "runState"]);
    state.queue = latest.queue || buildQueueFromReelItems(state.savedReelItems);
    state.running = latest.runState?.running || false;
    state.paused = latest.runState?.paused || false;
    addLog(els.statsOnly.checked
      ? `Đã thống kê ${state.savedReelItems.length} video của kênh ${channel.label}.`
      : `Đã đưa ${state.queue.length} link ${channel.label} vào danh sách tải.`, "info");
    await chrome.storage.local.set({ logs: state.logs });
  } catch (error) {
    const message = error.message || String(error);
    addLog(message.includes("Đã dừng quét")
      ? message
      : `Quét kênh thất bại: ${message}`, message.includes("Đã dừng quét") ? "warn" : "error");
    await persist();
  } finally {
    state.crawling = false;
    render();
  }
}

async function loadSavedReelsToQueue() {
  if (state.running || state.crawling) return;
  const data = await chrome.storage.local.get(["savedReelLinks", "savedReelItems", "lastCrawlSource", "lastCrawlTime"]);
  const links = data.savedReelLinks || [];
  const items = data.savedReelItems || links.map((link) => ({ link, views: 0, viewText: "" }));

  if (!items.length) {
    addLog("Chưa có link video nào được lưu local.", "warn");
    await persist();
    render();
    return;
  }

  state.savedReelItems = items;
  state.savedReelLinks = items.map((item) => item.link);
  state.lastCrawlSource = data.lastCrawlSource || state.lastCrawlSource;
  state.lastCrawlTime = data.lastCrawlTime || state.lastCrawlTime;
  state.queue = buildQueueFromReelItems(items);
  addLog(`Đã nạp ${state.queue.length} link video đã lưu vào danh sách tải.`, "info");
  await persist();
  await startQueuedDownload("Tự động tải lần lượt các link đã lưu.");
  render();
}

function extractLinks(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches.map((item) => item.replace(/[),.;]+$/g, "")))];
}

function detectRoute(link) {
  try {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const storyRoute = detectStoryRoute(url, hostname);
    if (storyRoute) return storyRoute;
    const instagramMediaRoute = detectInstagramMediaRoute(url, hostname);
    if (instagramMediaRoute) return instagramMediaRoute;
    if (normalizeInstagramChannelUrl(url.href)) {
      return {
        platform: "instagram",
        strategy: "channel",
        status: "unsupported",
        message: "Đây là link profile; hãy dán vào ô Quét kênh để lấy toàn bộ video."
      };
    }
    if (normalizeDouyinChannelUrl(url.href)) {
      return {
        platform: "douyin",
        strategy: "channel",
        status: "unsupported",
        message: "Đây là link profile; hãy dán vào ô Quét kênh để lấy toàn bộ video."
      };
    }
    const route = ROUTES.find((item) => item.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)));
    if (route) return { ...route, message: "Chờ xử lý qua SO9" };

    const telegramRoute = detectTelegramRoute(url, hostname);
    if (telegramRoute) return telegramRoute;

    if (isRestrictedGenericHost(hostname)) {
      return {
        platform: "restricted",
        strategy: "unsupported",
        status: "unsupported",
        message: "Domain này không hỗ trợ tải tự động."
      };
    }

    if (DIRECT_VIDEO_PATTERN.test(url.pathname + url.search)) {
      return {
        platform: "direct",
        strategy: "direct-url",
        message: "Tải trực tiếp file video"
      };
    }

    if (STREAMING_PLAYLIST_PATTERN.test(url.pathname + url.search)) {
      return {
        platform: "stream",
        strategy: "unsupported",
        status: "unsupported",
        message: "HLS/DASH cần ghép stream; không hỗ trợ trong bản an toàn này."
      };
    }

    if (url.protocol !== "https:") {
      return {
        platform: "media-page",
        strategy: "unsupported",
        status: "unsupported",
        message: "Chỉ quét trang media HTTPS để bảo vệ quyền truy cập."
      };
    }

    return {
      platform: "media-page",
      strategy: "direct-media",
      permissionOrigin: getPermissionOrigin(url),
      message: "Tìm URL video trực tiếp trên trang"
    };
  } catch (_) {
    return null;
  }
}

function detectStoryRoute(url, hostname) {
  const path = url.pathname.toLowerCase();
  const isInstagramStory = (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) &&
    /^\/stories(?:\/|$)/.test(path);
  const isFacebookStory = (hostname === "facebook.com" || hostname.endsWith(".facebook.com")) &&
    (/^\/stories(?:\/|$)/.test(path) || (path === "/story.php" && url.searchParams.has("story_fbid")));

  if (!isInstagramStory && !isFacebookStory) return null;
  return {
    platform: isInstagramStory ? "instagram-story" : "facebook-story",
    strategy: "direct-media",
    permissionOrigin: isInstagramStory ? getPermissionOrigin(url) : "",
    message: "Quét story để tìm URL video trực tiếp công khai"
  };
}

function detectInstagramMediaRoute(url, hostname) {
  if (!(hostname === "instagram.com" || hostname.endsWith(".instagram.com"))) return null;
  if (!/^\/(?:[a-z0-9._]+\/)?(?:p|reel|tv)\/[^/?#]+\/?$/i.test(url.pathname)) return null;
  return {
    platform: "instagram-media",
    strategy: "direct-media",
    permissionOrigin: getPermissionOrigin(url),
    message: "Quét trang Instagram để tìm URL video trực tiếp công khai"
  };
}

function isRestrictedGenericHost(hostname) {
  return RESTRICTED_GENERIC_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function detectTelegramRoute(url, hostname) {
  if (hostname === "web.telegram.org") {
    return {
      platform: "telegram",
      strategy: "telegram-private",
      telegramWebUrl: url.href,
      permissionOrigin: TELEGRAM_WEB_ORIGIN,
      message: "Tải video Telegram Web đang hiển thị"
    };
  }

  if (hostname === "t.me" || hostname === "telegram.me") {
    const converted = convertPrivateTelegramLink(url);
    if (converted) {
      return {
        platform: "telegram",
        strategy: "telegram-private",
        telegramWebUrl: converted,
        permissionOrigin: TELEGRAM_WEB_ORIGIN,
        message: "Mở private link trên Telegram Web rồi tải video đang hiển thị"
      };
    }

    return {
      platform: "telegram",
      strategy: "unsupported",
      status: "unsupported",
      message: "Chỉ hỗ trợ link web.telegram.org hoặc private link dạng t.me/c/chat/message."
    };
  }

  return null;
}

function convertPrivateTelegramLink(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "c" || !/^\d+$/.test(parts[1] || "") || !/^\d+$/.test(parts[2] || "")) {
    return "";
  }

  return `https://web.telegram.org/k/#-100${parts[1]}_${parts[2]}`;
}

function getPermissionOrigin(url) {
  return `${url.protocol}//${url.hostname}/*`;
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
    // Chấp nhận /username/ hoặc /username/reels/ ; luôn quét trên tab Reels vì trang profile chỉ hiện lưới bài viết.
    const validTail = parts.length === 1 || (parts.length === 2 && /^(reels|reels\/)$/i.test(parts[1]));
    if (!validTail || reserved.has(username.toLowerCase()) || !/^[a-z0-9._]+$/i.test(username)) return "";

    url.protocol = "https:";
    url.hostname = "www.instagram.com";
    url.pathname = `/${username}/reels/`;
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

function normalizeChannelUrl(value) {
  const facebookUrl = normalizeFacebookChannelUrl(value);
  if (facebookUrl) return { url: facebookUrl, platform: "facebook", label: "Facebook" };

  const tiktokUrl = normalizeTikTokChannelUrl(value);
  if (tiktokUrl) return { url: tiktokUrl, platform: "tiktok", label: "TikTok" };

  const instagramUrl = normalizeInstagramChannelUrl(value);
  if (instagramUrl) {
    return {
      url: instagramUrl,
      platform: "instagram",
      label: "Instagram",
      permissionOrigin: getPermissionOrigin(new URL(instagramUrl))
    };
  }

  const douyinUrl = normalizeDouyinChannelUrl(value);
  if (douyinUrl) {
    return {
      url: douyinUrl,
      platform: "douyin",
      label: "Douyin",
      permissionOrigin: getPermissionOrigin(new URL(douyinUrl))
    };
  }

  return { url: "", platform: "", label: "" };
}

function normalizeMaxReels(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function normalizeMinViews(value) {
  const normalized = String(value || "0").replace(/[^\d]/g, "");
  return Math.max(0, Number.parseInt(normalized, 10) || 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

async function saveFolder() {
  const folder = normalizeFolder(els.folder.value || "SO9-Downloads");
  els.folder.value = folder;
  await chrome.storage.local.set({ downloadFolder: folder });
  addLog(`Thư mục tải về: Downloads/${folder}`, "info");
  await persist();
  render();
}

function normalizeFolder(value) {
  const segments = String(value || "")
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/")
    .split("/")
    .map((segment) => segment.trim().replace(/[. ]+$/g, ""))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ? `_${segment}` : segment)
    .join("/");
  return segments || "SO9-Downloads";
}

async function startRun() {
  await startQueuedDownload("Bắt đầu tải lần lượt các link trong danh sách.");
}

async function startQueuedDownload(message) {
  if (state.running || state.crawling) return;
  state.queue = migrateQueueEntries(state.queue);
  if (!state.queue.some((item) => item.status === "pending" || item.status === "failed")) {
    addLog("Không có link hợp lệ để tải.", "warn");
    await persist();
    render();
    return;
  }

  const granted = await ensureDirectMediaPermissions();
  if (!granted) {
    addLog("Chrome chưa cấp quyền đọc trang cho link ngoài SO9/Telegram.", "warn");
    await persist();
    render();
    return;
  }

  const folder = normalizeFolder(els.folder.value || "SO9-Downloads");
  els.folder.value = folder;
  await chrome.storage.local.set({ downloadFolder: folder });
  addLog(message, "info");
  await persist();
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_RUN", folder });
    if (!response?.ok) throw new Error(response?.error || "Không thể bắt đầu tiến trình tải.");
    state.running = true;
    state.paused = false;
    scheduleRender();
  } catch (error) {
    addLog(error.message || String(error), "error");
    await persist();
    render();
  }
}

function migrateQueueEntries(queue) {
  return (queue || []).map((item) => {
    const route = detectRoute(item.link);
    if (!route || route.status === "unsupported" || route.strategy === "channel") return item;
    if (item.strategy !== "so9" || route.strategy !== "direct-media") return item;
    return {
      ...item,
      platform: route.platform,
      strategy: route.strategy,
      permissionOrigin: route.permissionOrigin || "",
      message: route.message
    };
  });
}

async function ensureDirectMediaPermissions() {
  const origins = [...new Set(state.queue
    .filter((item) => (item.status === "pending" || item.status === "failed") && needsHostPermission(item))
    .map((item) => item.permissionOrigin || derivePermissionOrigin(item))
    .filter(Boolean))];

  if (!origins.length) return true;
  if (!chrome.permissions?.request) return false;

  return await new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)));
  });
}

async function ensureChannelPermission(channel) {
  if (!channel.permissionOrigin || channel.platform === "facebook" || channel.platform === "tiktok") return true;
  if (!chrome.permissions?.request) return false;

  return await new Promise((resolve) => {
    chrome.permissions.request({ origins: [channel.permissionOrigin] }, (granted) => resolve(Boolean(granted)));
  });
}

function needsHostPermission(item) {
  return item.strategy === "direct-media" || item.strategy === "telegram-private";
}

function derivePermissionOrigin(item) {
  if (item.strategy === "telegram-private") return TELEGRAM_WEB_ORIGIN;
  if (item.strategy !== "direct-media") return "";

  try {
    const url = new URL(item.link);
    if (url.protocol !== "https:") return "";
    return getPermissionOrigin(url);
  } catch (_) {
    return "";
  }
}

async function togglePause() {
  try {
    const response = await chrome.runtime.sendMessage({ type: state.paused ? "RESUME_RUN" : "PAUSE_RUN" });
    if (!response?.ok) throw new Error(response?.error || "Không thể thay đổi trạng thái tiến trình.");
  } catch (error) {
    addLog(error.message || String(error), "error");
    render();
  }
}

async function stopRun() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_RUN" });
    if (!response?.ok) throw new Error(response?.error || "Không thể dừng tiến trình.");
  } catch (error) {
    addLog(error.message || String(error), "error");
    render();
  }
}

async function clearQueue() {
  if (state.running || state.crawling) return;
  if (state.queue.length && !confirm(t("Bạn có chắc chắn muốn xóa toàn bộ danh sách tải và log không?"))) return;
  state.queue = [];
  state.logs = [];
  await persist();
  render();
}

function exportLogs() {
  const content = state.logs
    .map((log) => `[${new Date(log.time).toLocaleString()}] ${log.level.toUpperCase()} ${log.message}`)
    .join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `${normalizeFolder(els.folder.value)}/so9-log-${Date.now()}.txt`,
    saveAs: false
  }).catch(() => {}).finally(() => URL.revokeObjectURL(url));
}

function addLog(message, level = "info") {
  state.logs.unshift({ time: Date.now(), message, level });
  state.logs = state.logs.slice(0, 300);
}

async function persist() {
  const lastCrawlMax = normalizeMaxReels(els.maxReels.value);
  await chrome.storage.local.set({
    queue: state.queue,
    logs: state.logs,
    savedReelLinks: state.savedReelLinks,
    savedReelItems: state.savedReelItems,
    lastCrawlSource: state.lastCrawlSource,
    lastCrawlTime: state.lastCrawlTime,
    ...(Number.isNaN(lastCrawlMax) || els.maxReels.validity.badInput ? {} : { lastCrawlMax }),
    lastMinViews: normalizeMinViews(els.minViews.value)
  });
}

let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function render() {
  const success = state.queue.filter((item) => item.status === "success").length;
  const failed = state.queue.filter((item) => item.status === "failed" || item.status === "unsupported").length;

  els.total.textContent = String(state.queue.length);
  els.success.textContent = String(success);
  els.failed.textContent = String(failed);

  els.start.disabled = state.running || state.crawling || state.queue.length === 0;
  els.loadSaved.disabled = state.running || state.crawling || state.savedReelLinks.length === 0;
  els.pause.disabled = !state.running;
  els.pause.textContent = t(state.paused ? "Tiếp tục" : "Tạm dừng");
  els.langToggle.textContent = getLang() === "vi" ? "EN" : "VI";
  els.stop.disabled = !state.running && !state.crawling;
  els.clear.disabled = state.running || state.crawling;
  els.clearData.disabled = state.running || state.crawling;
  els.crawl.disabled = state.running || state.crawling;
  els.file.disabled = state.running || state.crawling;
  els.importText.disabled = state.running || state.crawling;
  els.manualLinks.disabled = state.running || state.crawling;
  els.folder.disabled = state.running || state.crawling;
  els.channelUrl.disabled = state.running || state.crawling;
  els.maxReels.disabled = state.running || state.crawling;
  els.minViews.disabled = state.running || state.crawling;

  const badgeState = state.crawling ? "crawling" : state.running ? (state.paused ? "paused" : "running") : "idle";
  els.badge.className = `status-badge ${badgeState}`;
  els.badge.textContent = t(state.crawling ? "Đang quét" : state.running ? (state.paused ? "Tạm dừng" : "Đang chạy") : "Sẵn sàng");
  els.savedCount.textContent = t(`Đã lưu ${state.savedReelLinks.length} link`);
  els.lastCrawl.textContent = t(state.lastCrawlTime
    ? `Lần quét gần nhất: ${new Date(state.lastCrawlTime).toLocaleString()}`
    : "Chưa quét kênh nào.");

  renderQueue();
  renderLogs();
  renderStats();
}

function sortedStats() {
  return Object.values(state.channelStats || {}).sort((a, b) => (b.lastCrawlTime || 0) - (a.lastCrawlTime || 0));
}

const WEEKDAYS = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

function renderStats() {
  const channels = sortedStats();
  els.exportStats.disabled = !channels.length;
  els.clearStats.disabled = !channels.length;
  els.recrawlAll.disabled = !channels.length || state.running || state.crawling;
  renderCompare(channels);

  if (!channels.length) {
    els.statsList.className = "stats-list empty";
    els.statsList.textContent = t("Chưa có thống kê. Quét một kênh để bắt đầu.");
    return;
  }

  els.statsList.className = "stats-list";
  els.statsList.innerHTML = channels.map(renderChannelCard).join("");
}

function renderCompare(channels) {
  els.statsCompare.hidden = channels.length < 2;
  if (channels.length < 2) return;
  const rows = [...channels].sort((a, b) => (b.metrics?.avgViews || 0) - (a.metrics?.avgViews || 0)).map((channel) => {
    const m = channel.metrics || {};
    return `<tr>
      <td title="${escapeHtml(channel.sourceUrl)}">${escapeHtml(channel.name || channel.sourceUrl)}</td>
      <td>${escapeHtml(channel.followersText || (channel.followers ? formatCompact(channel.followers) : "—"))}</td>
      <td>${formatCompact(m.avgViews || 0)}</td>
      <td>${formatCompact(m.medianViews || 0)}</td>
      <td>${m.viralRate || 0}%</td>
      <td>${m.postsPerWeek || "—"}</td>
      <td>${m.newCount || 0}</td>
    </tr>`;
  }).join("");
  els.statsCompare.innerHTML = `<table>
    <thead><tr>
      <th>${escapeHtml(t("Kênh"))}</th><th>${escapeHtml(t("Follower"))}</th><th>${escapeHtml(t("View TB"))}</th>
      <th>${escapeHtml(t("Trung vị"))}</th><th>${escapeHtml(t("Viral"))}</th><th>${escapeHtml(t("Video/tuần"))}</th><th>${escapeHtml(t("Mới"))}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderChannelCard(channel) {
  const m = channel.metrics || { top: channel.top || [], hashtags: [] };
  const followerHistory = (channel.history || []).map((point) => point.followers).filter((value) => value > 0);
  const viewHistory = (channel.history || []).map((point) => point.avgViews ?? point.totalViews).filter((value) => value > 0);
  const previous = channel.history?.length > 1 ? channel.history[channel.history.length - 2] : null;
  const maxTop = m.top?.[0]?.views || 1;
  const insights = [];
  if (m.bestWeekday) insights.push(`📅 ${t("Đăng hiệu quả")}: ${t(WEEKDAYS[m.bestWeekday.key])}${m.bestHour ? ` · ${m.bestHour.key}h` : ""} (${t("TB")} ${formatCompact(m.bestWeekday.avgViews)} view)`);
  if (m.postsPerWeek) insights.push(`⏱ ${m.postsPerWeek} ${t("video/tuần")}`);
  if (channel.likesText) insights.push(`❤ ${escapeHtml(channel.likesText)} ${t("lượt thích")}`);
  for (const tag of m.hashtags || []) insights.push(`${escapeHtml(tag.tag)} ×${tag.count}`);

  const top = (m.top || []).map((video, index) => `
    <a href="${escapeHtml(video.link)}" target="_blank" rel="noopener" title="${escapeHtml(video.caption || video.link)}">
      <i>#${index + 1}</i>
      ${video.thumbnail ? `<img class="thumb" src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}
      <span class="cap">
        <em>${escapeHtml(video.caption || shortLink(video.link))}</em>
        <span class="bar"><b style="width:${Math.max(3, Math.round((video.views || 0) / maxTop * 100))}%"></b></span>
        <span class="meta">${video.postedAt ? escapeHtml(relativeTime(video.postedAt)) : ""}${video.viewsPerDay ? ` · ${formatCompact(video.viewsPerDay)} view/${t("ngày")}` : ""}${video.isNew ? `<span class="badge new">${t("MỚI")}</span>` : ""}${video.downloaded ? `<span class="badge done">${t("ĐÃ TẢI")}</span>` : ""}</span>
      </span>
      <span class="views">${escapeHtml(video.viewText || formatCompact(video.views))}${video.outlier >= VIRAL_MULTIPLIER ? `<span class="badge viral">×${video.outlier}</span>` : video.outlier ? `<small>×${video.outlier}</small>` : ""}</span>
    </a>`).join("");

  return `
    <article class="stats-card">
      <div class="stats-head">
        <strong><a href="${escapeHtml(channel.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(channel.name || channel.sourceUrl)}</a></strong>
        <span class="platform">${escapeHtml(channel.platform)} · ${new Date(channel.lastCrawlTime).toLocaleDateString()}</span>
      </div>
      <div class="stats-kpis">
        <div><span>${escapeHtml(channel.followersText || (channel.followers ? formatCompact(channel.followers) : "—"))}</span><small>${escapeHtml(t("Follower"))}</small>${sparklineSvg(followerHistory, { width: 60, height: 18 })}</div>
        <div><span>${formatCompact(m.avgViews || 0)}</span><small>${escapeHtml(t("View TB"))}</small>${sparklineSvg(viewHistory, { width: 60, height: 18 })}</div>
        <div><span>${formatCompact(m.medianViews || 0)}</span><small>${escapeHtml(t("Trung vị"))}</small></div>
        <div><span>${m.videoCount || channel.videoCount || 0}</span><small>${escapeHtml(t("Video quét"))}</small></div>
        <div class="hot"><span>${m.viralCount || 0}</span><small>${escapeHtml(t("Viral"))} ≥${VIRAL_MULTIPLIER}× (${m.viralRate || 0}%)</small></div>
        <div><span>${m.postsPerWeek || "—"}</span><small>${escapeHtml(t("Video/tuần"))}</small></div>
        <div class="fresh"><span>${m.newCount || 0}</span><small>${escapeHtml(t("Mới từ lần trước"))}</small></div>
        <div><span>${m.notDownloadedCount ?? "—"}</span><small>${escapeHtml(t("Chưa tải"))}</small></div>
      </div>
      ${insights.length ? `<div class="stats-insight">${insights.map((text) => `<span class="chip">${text}</span>`).join("")}</div>` : ""}
      <div class="stats-top">${top || `<small>${escapeHtml(t("Không đọc được view của video nào."))}</small>`}</div>
      ${previous ? `<div class="stats-trend">${escapeHtml(t("So với lần quét trước:"))} ${trendChip(channel.followers - (previous.followers || 0), t("follower"))} ${trendChip((m.avgViews || 0) - (previous.avgViews || 0), t("view TB"))}</div>` : ""}
      <div class="stats-actions">
        <button type="button" class="primary" data-action="queue-top" data-source="${escapeHtml(channel.sourceUrl)}" ${state.running ? "disabled" : ""}>${escapeHtml(t("Tải top 10 chưa tải"))}</button>
        <button type="button" data-action="recrawl" data-source="${escapeHtml(channel.sourceUrl)}" ${state.running || state.crawling ? "disabled" : ""}>${escapeHtml(t("Quét lại"))}</button>
      </div>
    </article>`;
}

function relativeTime(timestamp) {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days < 1) return t("hôm nay");
  if (days < 30) return `${days} ${t("ngày trước")}`;
  if (days < 365) return `${Math.floor(days / 30)} ${t("tháng trước")}`;
  return `${Math.floor(days / 365)} ${t("năm trước")}`;
}

async function queueTopFromChannel(sourceUrl) {
  const channel = state.channelStats[sourceUrl];
  if (!channel || state.running) return;
  const picks = (channel.metrics?.top || channel.top || [])
    .filter((video) => video.views > 0 && !state.downloadHistory[video.link])
    .slice(0, 10)
    .map((video) => ({ ...video, platform: channel.platform }));
  if (!picks.length) {
    addLog("Không còn video top nào chưa tải.", "warn");
    await persist();
    render();
    return;
  }
  const added = appendToQueue(buildQueueFromReelItems(picks));
  addLog(`Đã thêm ${added.added} video top của ${channel.name || sourceUrl} vào danh sách tải, bỏ qua ${added.duplicates} link trùng.`, "info");
  await persist();
  render();
}

async function recrawlChannel(sourceUrl) {
  if (state.running || state.crawling) return;
  els.channelUrl.value = sourceUrl;
  els.statsOnly.checked = true;
  await crawlChannelVideos();
}

// Quét lại tuần tự mọi kênh đã lưu ở chế độ chỉ thống kê — cập nhật follower/view/video mới cho cả danh sách theo dõi.
async function recrawlAllChannels() {
  if (state.running || state.crawling) return;
  const sources = sortedStats().map((channel) => channel.sourceUrl);
  if (!sources.length) return;
  if (!confirm(t("Quét lại {} kênh đã lưu? Mỗi kênh mở một tab và cuộn để cập nhật số liệu.").replace("{}", sources.length))) return;
  els.statsOnly.checked = true;
  for (const source of sources) {
    if (state.running) break;
    els.channelUrl.value = source;
    await crawlChannelVideos();
  }
  addLog(`Đã quét lại ${sources.length} kênh.`, "info");
  await persist();
  render();
}

function trendChip(delta, unit) {
  if (!delta) return `<span>±0 ${escapeHtml(unit)}</span>`;
  const sign = delta > 0 ? "+" : "−";
  return `<span class="${delta > 0 ? "up" : "down"}">${sign}${escapeHtml(formatNumber(Math.abs(delta)))} ${escapeHtml(unit)}</span>`;
}

function shortLink(link) {
  try {
    const url = new URL(link);
    return url.pathname.split("/").filter(Boolean).slice(-2).join("/") || url.hostname;
  } catch (_) {
    return link;
  }
}

function exportStatsCsv() {
  const rows = [["channel", "platform", "name", "followers", "likes", "videos", "total_views", "avg_views", "median_views", "viral_count", "viral_rate_pct", "posts_per_week", "best_weekday", "best_hour", "new_since_last", "hashtags", "last_crawl",
    "top1", "top1_views", "top1_caption", "top2", "top2_views", "top2_caption", "top3", "top3_views", "top3_caption"]];
  for (const channel of sortedStats()) {
    const m = channel.metrics || {};
    const top = m.top || channel.top || [];
    rows.push([
      channel.sourceUrl, channel.platform, channel.name, channel.followers, channel.likes, channel.videoCount,
      channel.totalViews, channel.avgViews, m.medianViews ?? "", m.viralCount ?? "", m.viralRate ?? "", m.postsPerWeek ?? "",
      m.bestWeekday ? WEEKDAYS[m.bestWeekday.key] : "", m.bestHour ? m.bestHour.key : "", m.newCount ?? "",
      (m.hashtags || []).map((tag) => `${tag.tag}(${tag.count})`).join(" "), new Date(channel.lastCrawlTime).toISOString(),
      top[0]?.link || "", top[0]?.views || "", top[0]?.caption || "", top[1]?.link || "", top[1]?.views || "", top[1]?.caption || "", top[2]?.link || "", top[2]?.views || "", top[2]?.caption || ""
    ]);
  }
  const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mike-autodownload-stats-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearStats() {
  if (!confirm(t("Xóa toàn bộ thống kê kênh?"))) return;
  state.channelStats = {};
  await chrome.storage.local.remove(["channelStats"]);
  render();
}

function renderQueue() {
  const counts = { all: state.queue.length, pending: 0, running: 0, success: 0, failed: 0 };
  for (const item of state.queue) {
    const key = item.status === "unsupported" ? "failed" : item.status === "skipped" ? "success" : item.status;
    if (key in counts) counts[key] += 1;
  }
  for (const button of els.queueFilters.querySelectorAll("button[data-filter]")) {
    const key = button.dataset.filter;
    button.classList.toggle("active", key === state.queueFilter);
    button.textContent = `${t(button.dataset.label || (button.dataset.label = button.textContent.trim()))} ${counts[key]}`;
  }
  els.prune.disabled = state.running || state.crawling || !state.queue.some((item) => ["success", "unsupported", "skipped"].includes(item.status));

  const visible = state.queueFilter === "all"
    ? state.queue
    : state.queue.filter((item) => state.queueFilter === "failed"
      ? item.status === "failed" || item.status === "unsupported"
      : state.queueFilter === "success" ? item.status === "success" || item.status === "skipped" : item.status === state.queueFilter);

  if (!visible.length) {
    els.queue.className = "queue-list empty";
    els.queue.textContent = t(state.queue.length ? "Không có link nào trong bộ lọc này." : "Chưa có link nào được tải lên.");
    els.queueMore.hidden = true;
    return;
  }

  // ponytail: chỉ vẽ tối đa queueLimit mục để hàng đợi vài nghìn link không làm treo panel.
  const shown = visible.slice(0, state.queueLimit);
  els.queueMore.hidden = shown.length >= visible.length;
  els.queueMore.textContent = `${t("Xem thêm")} (${visible.length - shown.length})`;
  els.queue.className = "queue-list";
  els.queue.innerHTML = shown.map((item) => `
    <article class="queue-item">
      ${state.running ? "" : `<button class="ghost remove" type="button" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Bỏ link này"))}">✕</button>`}
      <strong title="${escapeHtml(item.link)}">${escapeHtml(item.link)}</strong>
      <div class="queue-meta">
        <span class="platform">${escapeHtml(item.platform)}</span>
        ${renderViewBadge(item)}
        <span class="${statusClass(item.status)}">${statusLabel(item.status)}</span>
      </div>
      <small>${escapeHtml(t(item.message || ""))}</small>
    </article>
  `).join("");
}

function renderViewBadge(item) {
  if (!item.viewText && !item.views) return "";
  const label = item.viewText || formatNumber(item.views);
  return `<span class="view-badge">${escapeHtml(t(`View: ${label}`))}</span>`;
}

function renderLogs() {
  els.logs.innerHTML = state.logs.map((log) => `
    <article class="log-item">
      <strong class="${log.level === "error" ? "fail" : log.level === "warn" ? "warn" : ""}">${escapeHtml(t(log.message))}</strong>
      <div class="log-meta">
        <span>${new Date(log.time).toLocaleTimeString()}</span>
        <span>${escapeHtml(log.level)}</span>
      </div>
    </article>
  `).join("");
}

function statusLabel(status) {
  return t({
    pending: "Chờ tải",
    running: "Đang tải",
    success: "Thành công",
    failed: "Thất bại",
    unsupported: "Không hỗ trợ",
    skipped: "Đã tải trước"
  }[status] || status);
}

function statusClass(status) {
  if (status === "success") return "ok";
  if (status === "failed" || status === "unsupported") return "fail";
  if (status === "running") return "warn";
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
