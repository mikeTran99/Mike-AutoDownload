let runLock = false;
let crawlLock = false;
let paused = false;
let stopped = false;
let activeTabId = null;
let activeDownloadIds = new Set();

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    appendLog(error.message || String(error), "error");
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

async function handleMessage(message) {
  if (message.type === "START_RUN") {
    if (runLock) return { ok: false, error: "Đang có tiến trình chạy." };
    runLock = true;
    paused = false;
    stopped = false;
    runQueue(message.folder).finally(() => {
      runLock = false;
      paused = false;
      stopped = false;
      activeTabId = null;
      publishState();
    });
    return { ok: true };
  }

  if (message.type === "CRAWL_CHANNEL_VIDEOS" || message.type === "CRAWL_FACEBOOK_REELS") {
    if (crawlLock) return { ok: false, error: "Đang có tiến trình quét kênh Facebook/TikTok." };
    crawlLock = true;
    try {
      return await crawlChannelVideos(message.channelUrl, message.maxCount, message.folder, message.minViews);
    } finally {
      crawlLock = false;
      await publishState();
    }
  }

  if (message.type === "PAUSE_RUN") {
    paused = true;
    await appendLog("Đã tạm dừng tiến trình.", "warn");
    await publishState();
    return { ok: true };
  }

  if (message.type === "RESUME_RUN") {
    paused = false;
    await appendLog("Đã tiếp tục tiến trình.", "info");
    await publishState();
    return { ok: true };
  }

  if (message.type === "STOP_RUN") {
    stopped = true;
    paused = false;
    await abortActiveWork();
    await appendLog("Đã yêu cầu dừng tiến trình.", "warn");
    await publishState();
    return { ok: true };
  }

  return { ok: false, error: "Unknown message type" };
}

async function crawlChannelVideos(channelUrl, maxCount, folder, minViews) {
  const platform = detectCrawlPlatform(channelUrl);
  if (platform === "facebook") {
    return await crawlFacebookReels(channelUrl, maxCount, folder, minViews);
  }
  if (platform === "tiktok") {
    return await crawlTikTokProfile(channelUrl, maxCount, folder, minViews);
  }
  throw new Error("Chỉ hỗ trợ quét kênh Facebook hoặc TikTok.");
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
    await appendLog(`Đang cuộn và lấy tối đa ${limit} link Reels.`, "info");
    await appendLog(`Ngưỡng view tối thiểu: ${formatNumber(minimumViews)}.`, "info");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: crawlFacebookReelsInPage,
      args: [limit, minimumViews]
    });

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
    await appendLog(`Đang cuộn và lấy tối đa ${limit} link video TikTok.`, "info");
    await appendLog(`Ngưỡng view tối thiểu: ${formatNumber(minimumViews)}.`, "info");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: crawlTikTokVideosInPage,
      args: [limit, minimumViews]
    });

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

async function startRunQueueAfterCrawl(folder) {
  if (runLock) {
    await appendLog("Tiến trình tải đang chạy, link vừa quét đã được lưu vào queue.", "warn");
    return;
  }

  runLock = true;
  paused = false;
  stopped = false;
  await appendLog("Tự động tải lần lượt các link vừa quét.", "info");

  runQueue(folder).finally(() => {
    runLock = false;
    paused = false;
    stopped = false;
    activeTabId = null;
    publishState();
  });
}

function crawlFacebookReelsInPage(limit, minViews) {
  const maxCount = Math.max(1, Math.min(500, Number(limit) || 50));
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
        if (minimumViews > 0 && views < minimumViews) {
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
        if (items.size >= maxCount) break;
      }
    };

    const tick = () => {
      collect();

      if (items.size >= maxCount || staleScrolls >= 6) {
        resolve({
          items: Array.from(items.values()).slice(0, maxCount),
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
  const maxCount = Math.max(1, Math.min(500, Number(limit) || 50));
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
        if (items.size >= maxCount) break;
      }
    };

    const tick = () => {
      collect();

      if (items.size >= maxCount || staleScrolls >= 7) {
        resolve({
          items: Array.from(items.values()).slice(0, maxCount),
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

function detectCrawlPlatform(value) {
  if (normalizeFacebookChannelUrl(value)) return "facebook";
  if (normalizeTikTokChannelUrl(value)) return "tiktok";
  return "";
}

function normalizeMaxCount(value) {
  return Math.max(1, Math.min(500, Number.parseInt(value, 10) || 50));
}

function normalizeMinViews(value) {
  const normalized = String(value || "0").replace(/[^\d]/g, "");
  return Math.max(0, Number.parseInt(normalized, 10) || 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

async function runQueue(folder) {
  await chrome.storage.local.set({ runState: { running: true, paused: false } });
  await appendLog("Bắt đầu xử lý danh sách link.", "info");
  await publishState();

  const data = await chrome.storage.local.get(["queue", "timeoutSeconds", "downloadFolder"]);
  const timeoutMs = (data.timeoutSeconds || 90) * 1000;
  const downloadFolder = sanitizeFolder(folder || data.downloadFolder || "SO9-Downloads");
  let queue = data.queue || [];

  for (const item of queue) {
    if (stopped) break;
    while (paused && !stopped) {
      await sleep(600);
    }
    if (stopped || item.status === "unsupported" || item.status === "success") continue;

    queue = await updateItem(item.id, {
      status: "running",
      message: "Đang mở trang downloader"
    });
    await appendLog(`Đang xử lý ${item.platform}: ${item.link}`, "info");

    try {
      const result = await processItem(item, downloadFolder, timeoutMs);
      queue = await updateItem(item.id, {
        status: "success",
        message: result.filename ? `Đã tải: ${result.filename}` : "Đã hoàn tất"
      });
      await appendLog(`Thành công: ${item.link}`, "info");
    } catch (error) {
      if (stopped) {
        queue = await updateItem(item.id, {
          status: "pending",
          message: "Đã dừng trước khi hoàn tất"
        });
        break;
      }

      const message = formatDownloadError(error);
      queue = await updateItem(item.id, {
        status: "failed",
        message
      });
      await appendLog(`Thất bại: ${item.link} - ${message}`, "error");
    }
  }

  await chrome.storage.local.set({ runState: { running: false, paused: false }, queue });
  await appendLog(stopped ? "Tiến trình đã dừng." : "Đã xử lý xong danh sách.", stopped ? "warn" : "info");
  notify("Mike-AutomationAI", stopped ? "Tiến trình đã dừng." : "Đã xử lý xong danh sách link.");
  await publishState();
}

async function processItem(item, downloadFolder, timeoutMs) {
  if (item.strategy === "direct-url") {
    await appendLog("Đang tải link video trực tiếp bằng Chrome API.", "info");
    return await downloadDirectUrl(item.link, downloadFolder, "", timeoutMs);
  }

  if (item.strategy === "direct-media") {
    return await processDirectMediaPage(item, downloadFolder, timeoutMs);
  }

  if (item.strategy === "telegram-private") {
    return await processTelegramItem(item, downloadFolder, timeoutMs);
  }

  return await processSo9Item(item, downloadFolder, timeoutMs);
}

async function processSo9Item(item, downloadFolder, timeoutMs) {
  const tab = await chrome.tabs.create({ url: item.downloaderUrl, active: false });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, timeoutMs);
    await appendLog("Đã mở SO9 downloader ở chế độ nền.", "info");

    const prepared = await sendContentMessageWithRetry(tab.id, {
      type: "PREPARE_DOWNLOAD",
      link: item.link
    }, Math.min(90000, timeoutMs));

    await appendLog("Đã nhập link và tạo file trên SO9.", "info");

    if (prepared.directUrl && !prepared.isBlobUrl) {
      await appendLog("Đang tải bằng Chrome API.", "info");
      return await downloadDirectUrl(prepared.directUrl, downloadFolder, prepared.filename, timeoutMs);
    }

    if (prepared.canFallbackClick) {
      await appendLog("Fallback click nút tải SO9.", "warn");
      return await waitForDownloadTriggered(downloadFolder, timeoutMs, async () => {
        await sendContentMessageWithRetry(tab.id, { type: "CLICK_FINAL_DOWNLOAD" }, 15000);
      });
    }

    throw new Error(prepared.pageError || "SO9 đã xử lý link nhưng không trả về URL hoặc nút tải.");
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function processDirectMediaPage(item, downloadFolder, timeoutMs) {
  const tab = await chrome.tabs.create({ url: item.link, active: false });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, Math.min(timeoutMs, 45000));
    await appendLog("Đang quét video trực tiếp trên trang.", "info");

    const scan = await scanDirectMediaPage(tab.id);
    const candidate = chooseBestMediaCandidate(scan.candidates || []);
    if (!candidate) {
      throw new Error(scan.blockedReason || "Không tìm thấy URL video trực tiếp. Trang có thể dùng blob, HLS/DASH, DRM, đăng nhập hoặc cơ chế không cho tải tự động.");
    }

    const qualityText = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : "";
    await appendLog(`Đã tìm thấy video trực tiếp${qualityText}.`, "info");
    return await downloadDirectUrl(candidate.url, downloadFolder, candidate.filename, timeoutMs);
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function processTelegramItem(item, downloadFolder, timeoutMs) {
  const telegramUrl = item.telegramWebUrl || item.link;
  const tab = await chrome.tabs.create({ url: telegramUrl, active: true });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, Math.min(timeoutMs, 60000));
    await appendLog("Đã mở Telegram Web. Hãy đảm bảo Chrome đã đăng nhập Telegram và bạn có quyền xem video.", "info");

    const scan = await waitForTelegramCandidate(tab.id, Math.max(timeoutMs, 120000));
    const candidate = scan.candidate || {};
    const qualityText = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : "";
    if (!scan.hasDownloadControl) {
      throw new Error("Telegram Web không hiển thị nút tải/lưu cho video này. Tool không bypass hạn chế tải hoặc quyền riêng tư của Telegram.");
    }

    await appendLog(`Đang click nút tải Telegram Web${qualityText}.`, "info");
    return await waitForDownloadTriggered(downloadFolder, timeoutMs, async () => {
      await clickTelegramDownloadControl(tab.id);
    });
  } finally {
    if (activeTabId === tab.id) activeTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab can be closed by the user; ignore cleanup failure.
    }
  }
}

async function waitForTelegramCandidate(tabId, timeoutMs) {
  const startedAt = Date.now();
  let preparedPreview = false;
  let lastScan = null;

  while (Date.now() - startedAt < timeoutMs) {
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

    await sleep(900);
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
  target.dispatchEvent(new MouseEvent("click", eventOptions));
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
  target.dispatchEvent(new MouseEvent("click", eventOptions));
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendContentMessage(tabId, message, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!String(error.message || error).includes("Receiving end does not exist")) break;
      await sleep(900);
    }
  }
  throw lastError;
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

async function downloadDirectUrl(url, downloadFolder, suggestedName, timeoutMs) {
  const filename = buildDownloadFilename(downloadFolder, suggestedName, url);
  const id = await chromeDownload({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  activeDownloadIds.add(id);

  try {
    return await waitForDownloadId(id, timeoutMs);
  } finally {
    activeDownloadIds.delete(id);
  }
}

function waitForDownloadTriggered(downloadFolder, timeoutMs, triggerDownload) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let watchedId = null;
    let settled = false;

    const timer = setTimeout(() => cleanupReject(new Error("Hết thời gian chờ file tải về.")), timeoutMs);

    function cleanup() {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
      return true;
    }

    function cleanupReject(error) {
      if (cleanup()) reject(error);
    }

    function onDeterminingFilename(downloadItem, suggest) {
      if (Date.now() - startedAt > timeoutMs) return;
      if (watchedId && downloadItem.id !== watchedId) return;
      const originalName = getBaseName(downloadItem.filename) || `so9-${Date.now()}.mp4`;
      suggest({ filename: `${downloadFolder}/${sanitizeFilename(originalName)}`, conflictAction: "uniquify" });
    }

    function onCreated(downloadItem) {
      if (Date.now() - startedAt > timeoutMs || watchedId) return;
      watchedId = downloadItem.id;
      activeDownloadIds.add(downloadItem.id);
    }

    function onChanged(delta) {
      if (watchedId && delta.id !== watchedId) return;
      if (delta.error) {
        activeDownloadIds.delete(delta.id);
        cleanupReject(new Error(`Chrome báo lỗi tải file: ${delta.error.current}`));
      }
      if (delta.state?.current === "complete") {
        activeDownloadIds.delete(delta.id);
        chrome.downloads.search({ id: delta.id }, (items) => {
          const item = items?.[0];
          if (cleanup()) resolve({ id: delta.id, filename: item?.filename || "" });
        });
      }
      if (delta.state?.current === "interrupted") {
        activeDownloadIds.delete(delta.id);
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

function waitForDownloadId(downloadId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => cleanupReject(new Error("Hết thời gian chờ file tải về.")), timeoutMs);

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

    function resolveFromSearch() {
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items?.[0];
        if (!item) return;
        if (item.state === "complete" && cleanup()) {
          resolve({ id: downloadId, filename: item.filename || "" });
        }
        if (item.state === "interrupted") {
          cleanupReject(new Error(`Chrome báo lỗi tải file: ${item.error || "interrupted"}`));
        }
      });
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

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Trang downloader tải quá lâu."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function updateItem(id, patch) {
  const data = await chrome.storage.local.get(["queue"]);
  const queue = (data.queue || []).map((item) => item.id === id ? { ...item, ...patch } : item);
  await chrome.storage.local.set({ queue });
  await publishState();
  return queue;
}

async function appendLog(message, level = "info") {
  const data = await chrome.storage.local.get(["logs"]);
  const logs = [{ time: Date.now(), message, level }, ...(data.logs || [])].slice(0, 300);
  await chrome.storage.local.set({ logs });
  await publishState();
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
  await chrome.storage.local.set({ runState: { running: runLock, paused } });
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
}

function cancelDownload(id) {
  return new Promise((resolve) => {
    chrome.downloads.cancel(id, () => resolve());
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
  if (!/\.[a-z0-9]{2,6}$/i.test(filename)) filename += ".mp4";
  return `${downloadFolder}/${filename}`;
}

function getBaseName(value) {
  return String(value || "").split(/[\\/]/).pop() || "";
}

function sanitizeFilename(value) {
  return String(value || "so9-download.mp4")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "so9-download.mp4";
}

function sanitizeFolder(value) {
  return String(value || "SO9-Downloads")
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/") || "SO9-Downloads";
}

function formatDownloadError(error) {
  const message = error.message || String(error);
  if (message.includes("USER_CANCELED")) {
    return "Chrome báo USER_CANCELED. Đã thử tải tự động; hãy kiểm tra Chrome không bật hỏi nơi lưu file và không đóng tab SO9 khi automation đang chạy.";
  }
  return message;
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/mike-128.png",
    title,
    message
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
