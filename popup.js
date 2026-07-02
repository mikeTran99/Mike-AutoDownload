const ROUTES = [
  { platform: "facebook", strategy: "so9", hosts: ["facebook.com", "fb.watch"], url: "https://so9.vn/9downloader/facebook" },
  { platform: "tiktok", strategy: "so9", hosts: ["tiktok.com", "vm.tiktok.com"], url: "https://so9.vn/9downloader/tiktok" },
  { platform: "instagram", strategy: "so9", hosts: ["instagram.com"], url: "https://so9.vn/9downloader/insta" },
  { platform: "douyin", strategy: "so9", hosts: ["douyin.com"], url: "https://so9.vn/9downloader/douyin" }
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
  lastCrawlSource: "",
  lastCrawlTime: 0,
  running: false,
  paused: false
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
  themeToggle: document.getElementById("themeToggle")
};

init();

function init() {
  chrome.storage.local.get([
    "downloadFolder",
    "queue",
    "logs",
    "runState",
    "theme",
    "savedReelLinks",
    "savedReelItems",
    "lastCrawlSource",
    "lastCrawlTime",
    "lastCrawlMax",
    "lastMinViews"
  ], (data) => {
    els.folder.value = data.downloadFolder || "SO9-Downloads";
    els.channelUrl.value = data.lastCrawlSource || "https://www.tiktok.com/@tvmlb55";
    els.maxReels.value = data.lastCrawlMax || 50;
    els.minViews.value = data.lastMinViews || 0;
    state.queue = data.queue || [];
    state.logs = data.logs || [];
    state.savedReelLinks = data.savedReelLinks || [];
    state.savedReelItems = data.savedReelItems || state.savedReelLinks.map((link) => ({ link, views: 0, viewText: "" }));
    state.lastCrawlSource = data.lastCrawlSource || "";
    state.lastCrawlTime = data.lastCrawlTime || 0;
    state.running = data.runState?.running || false;
    state.paused = data.runState?.paused || false;
    if (data.theme === "light") document.documentElement.classList.add("light-theme");
    render();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATE_UPDATED") {
      Object.assign(state, message.state);
      render();
    }
  });

  els.file.addEventListener("change", handleFileUpload);
  els.importText.addEventListener("click", handleManualImport);
  els.crawl.addEventListener("click", crawlChannelVideos);
  els.loadSaved.addEventListener("click", loadSavedReelsToQueue);
  els.folder.addEventListener("change", saveFolder);
  els.start.addEventListener("click", startRun);
  els.pause.addEventListener("click", togglePause);
  els.stop.addEventListener("click", stopRun);
  els.clear.addEventListener("click", clearQueue);
  els.exportLog.addEventListener("click", exportLogs);
  els.themeToggle.addEventListener("click", toggleTheme);
}

async function toggleTheme() {
  const isLight = document.documentElement.classList.toggle("light-theme");
  await chrome.storage.local.set({ theme: isLight ? "light" : "dark" });
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const queue = buildQueueFromText(text);

  state.queue = queue;
  addLog(`Đã nạp ${queue.length} link từ file ${file.name}`, "info");
  await persist();
  render();
}

async function handleManualImport() {
  const text = els.manualLinks.value.trim();
  if (!text) {
    addLog("Chưa có link để nạp.", "warn");
    await persist();
    render();
    return;
  }

  const queue = buildQueueFromText(text);
  state.queue = queue;
  addLog(`Đã nạp ${queue.length} link từ ô nhập tay`, "info");
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
    return {
      id: `${Date.now()}-${index}`,
      link,
      status: supported ? "pending" : "unsupported",
      platform: route?.platform || "unknown",
      strategy: route?.strategy || "",
      downloaderUrl: route?.url || "",
      telegramWebUrl: route?.telegramWebUrl || "",
      permissionOrigin: route?.permissionOrigin || "",
      message: route?.message || (supported ? "Chờ xử lý" : "Không hỗ trợ domain này")
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
  const channel = normalizeChannelUrl(els.channelUrl.value);
  const maxCount = normalizeMaxReels(els.maxReels.value);
  const minViews = normalizeMinViews(els.minViews.value);

  if (!channel.url) {
    addLog("Vui lòng nhập link kênh Facebook hoặc TikTok hợp lệ.", "warn");
    await persist();
    render();
    return;
  }

  els.channelUrl.value = channel.url;
  els.maxReels.value = maxCount;
  els.minViews.value = minViews;
  els.crawl.disabled = true;
  addLog(`Đang mở kênh ${channel.label} để quét tối đa ${maxCount} video, view tối thiểu ${formatNumber(minViews)}.`, "info");
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
      folder
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
    addLog(`Đã đưa ${state.queue.length} link ${channel.label} vào danh sách tải.`, "info");
    await chrome.storage.local.set({ logs: state.logs });
  } catch (error) {
    addLog(`Quét kênh thất bại: ${error.message || error}`, "error");
    await persist();
  } finally {
    els.crawl.disabled = false;
    render();
  }
}

async function loadSavedReelsToQueue() {
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
    if (!url.hostname.toLowerCase().endsWith("facebook.com")) return "";
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
    if (!url.hostname.toLowerCase().endsWith("tiktok.com")) return "";
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

function normalizeChannelUrl(value) {
  const facebookUrl = normalizeFacebookChannelUrl(value);
  if (facebookUrl) return { url: facebookUrl, platform: "facebook", label: "Facebook" };

  const tiktokUrl = normalizeTikTokChannelUrl(value);
  if (tiktokUrl) return { url: tiktokUrl, platform: "tiktok", label: "TikTok" };

  return { url: "", platform: "", label: "" };
}

function normalizeMaxReels(value) {
  return Math.max(1, Math.min(500, Number.parseInt(value, 10) || 50));
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
  return value
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/") || "SO9-Downloads";
}

async function startRun() {
  await startQueuedDownload("Bắt đầu tải lần lượt các link trong danh sách.");
}

async function startQueuedDownload(message) {
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
  await chrome.runtime.sendMessage({ type: "START_RUN", folder });
}

async function ensureDirectMediaPermissions() {
  const origins = [...new Set(state.queue
    .filter((item) => (item.status === "pending" || item.status === "failed") && needsHostPermission(item))
    .map((item) => item.permissionOrigin)
    .filter(Boolean))];

  if (!origins.length) return true;
  if (!chrome.permissions?.request) return false;

  return await new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)));
  });
}

function needsHostPermission(item) {
  return item.strategy === "direct-media" || item.strategy === "telegram-private";
}

async function togglePause() {
  await chrome.runtime.sendMessage({ type: state.paused ? "RESUME_RUN" : "PAUSE_RUN" });
}

async function stopRun() {
  await chrome.runtime.sendMessage({ type: "STOP_RUN" });
}

async function clearQueue() {
  if (state.running) return;
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
  });
}

function addLog(message, level = "info") {
  state.logs.unshift({ time: Date.now(), message, level });
  state.logs = state.logs.slice(0, 300);
}

async function persist() {
  await chrome.storage.local.set({
    queue: state.queue,
    logs: state.logs,
    savedReelLinks: state.savedReelLinks,
    savedReelItems: state.savedReelItems,
    lastCrawlSource: state.lastCrawlSource,
    lastCrawlTime: state.lastCrawlTime,
    lastCrawlMax: normalizeMaxReels(els.maxReels.value),
    lastMinViews: normalizeMinViews(els.minViews.value),
    runState: { running: state.running, paused: state.paused }
  });
}

function render() {
  const success = state.queue.filter((item) => item.status === "success").length;
  const failed = state.queue.filter((item) => item.status === "failed" || item.status === "unsupported").length;

  els.total.textContent = String(state.queue.length);
  els.success.textContent = String(success);
  els.failed.textContent = String(failed);

  els.start.disabled = state.running || state.queue.length === 0;
  els.loadSaved.disabled = state.running || state.savedReelLinks.length === 0;
  els.pause.disabled = !state.running;
  els.pause.textContent = state.paused ? "Tiếp tục" : "Tạm dừng";
  els.stop.disabled = !state.running;
  els.clear.disabled = state.running;

  els.badge.className = `status-badge ${state.running ? (state.paused ? "paused" : "running") : "idle"}`;
  els.badge.textContent = state.running ? (state.paused ? "Tạm dừng" : "Đang chạy") : "Sẵn sàng";
  els.savedCount.textContent = `Đã lưu ${state.savedReelLinks.length} link`;
  els.lastCrawl.textContent = state.lastCrawlTime
    ? `Lần quét gần nhất: ${new Date(state.lastCrawlTime).toLocaleString()}`
    : "Chưa quét kênh nào.";

  renderQueue();
  renderLogs();
}

function renderQueue() {
  if (!state.queue.length) {
    els.queue.className = "queue-list empty";
    els.queue.textContent = "Chưa có link nào được tải lên.";
    return;
  }

  els.queue.className = "queue-list";
  els.queue.innerHTML = state.queue.map((item) => `
    <article class="queue-item">
      <strong title="${escapeHtml(item.link)}">${escapeHtml(item.link)}</strong>
      <div class="queue-meta">
        <span class="platform">${escapeHtml(item.platform)}</span>
        ${renderViewBadge(item)}
        <span class="${statusClass(item.status)}">${statusLabel(item.status)}</span>
      </div>
      <small>${escapeHtml(item.message || "")}</small>
    </article>
  `).join("");
}

function renderViewBadge(item) {
  if (!item.viewText && !item.views) return "";
  const label = item.viewText || formatNumber(item.views);
  return `<span class="view-badge">View: ${escapeHtml(label)}</span>`;
}

function renderLogs() {
  els.logs.innerHTML = state.logs.map((log) => `
    <article class="log-item">
      <strong class="${log.level === "error" ? "fail" : log.level === "warn" ? "warn" : ""}">${escapeHtml(log.message)}</strong>
      <div class="log-meta">
        <span>${new Date(log.time).toLocaleTimeString()}</span>
        <span>${escapeHtml(log.level)}</span>
      </div>
    </article>
  `).join("");
}

function statusLabel(status) {
  return {
    pending: "Chờ tải",
    running: "Đang tải",
    success: "Thành công",
    failed: "Thất bại",
    unsupported: "Không hỗ trợ"
  }[status] || status;
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
