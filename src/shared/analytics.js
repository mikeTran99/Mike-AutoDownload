// Phân tích kênh cho người làm reup / nghiên cứu đối thủ. Thuần hàm, dùng chung cho service worker và popup.

const INSTAGRAM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INSTAGRAM_EPOCH_MS = 1314220021721n;
const MIN_POST_MS = Date.UTC(2010, 0, 1);
export const VIRAL_MULTIPLIER = 3;

// TikTok/Douyin: 32 bit cao của ID video là Unix giây. Instagram: shortcode → ID snowflake, (id >> 23) + epoch.
// Facebook không mã hoá thời gian trong ID → 0.
export function postedAtFromLink(link, platform) {
  try {
    const path = new URL(link).pathname;
    if (platform === "tiktok" || platform === "douyin") {
      const id = path.match(/\/video\/(\d{15,})/)?.[1];
      return id ? sane(Number(BigInt(id) >> 32n) * 1000) : 0;
    }
    if (platform === "instagram") {
      const code = path.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,12})/)?.[1];
      if (!code) return 0;
      let id = 0n;
      for (const char of code) id = id * 64n + BigInt(INSTAGRAM_ALPHABET.indexOf(char));
      return sane(Number((id >> 23n) + INSTAGRAM_EPOCH_MS));
    }
  } catch (_) {
    // ignore malformed links
  }
  return 0;
}

function sane(ms) {
  return ms >= MIN_POST_MS && ms <= Date.now() + 86400000 ? ms : 0;
}

export function extractHashtags(text) {
  return [...String(text || "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => `#${match[1].toLowerCase()}`);
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// items: [{ link, views, viewText, caption, postedAt, thumbnail }]
// previousLinks: Set link của lần quét trước → đếm video mới. downloadedLinks: Set link đã tải → đếm chưa tải.
export function computeChannelMetrics(items, { previousLinks = new Set(), downloadedLinks = new Set(), now = Date.now() } = {}) {
  const withViews = items.filter((item) => Number(item.views) > 0);
  const views = withViews.map((item) => Number(item.views));
  const totalViews = views.reduce((sum, value) => sum + value, 0);
  const medianViews = median(views);
  const avgViews = views.length ? Math.round(totalViews / views.length) : 0;

  const scored = items.map((item) => {
    const outlier = medianViews && item.views ? Number((item.views / medianViews).toFixed(1)) : 0;
    const ageDays = item.postedAt ? Math.max(1, (now - item.postedAt) / 86400000) : 0;
    return {
      ...item,
      outlier,
      viewsPerDay: ageDays && item.views ? Math.round(item.views / ageDays) : 0,
      isNew: previousLinks.size > 0 && !previousLinks.has(item.link),
      downloaded: downloadedLinks.has(item.link)
    };
  });

  const viralCount = scored.filter((item) => item.outlier >= VIRAL_MULTIPLIER).length;
  const dated = scored.filter((item) => item.postedAt);
  const spanDays = dated.length > 1 ? Math.max(1, (Math.max(...dated.map((item) => item.postedAt)) - Math.min(...dated.map((item) => item.postedAt))) / 86400000) : 0;

  return {
    videoCount: items.length,
    totalViews,
    avgViews,
    medianViews,
    maxViews: views.length ? Math.max(...views) : 0,
    viralCount,
    viralRate: withViews.length ? Math.round(viralCount / withViews.length * 100) : 0,
    newCount: scored.filter((item) => item.isNew).length,
    notDownloadedCount: scored.filter((item) => !item.downloaded && item.views > 0).length,
    postsPerWeek: spanDays ? Number((dated.length / spanDays * 7).toFixed(1)) : 0,
    datedCount: dated.length,
    bestWeekday: bestBucket(dated, (item) => new Date(item.postedAt).getDay()),
    bestHour: bestBucket(dated, (item) => new Date(item.postedAt).getHours()),
    hashtags: topHashtags(items),
    top: [...scored].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10)
  };
}

// Nhóm theo khoá (thứ/giờ), trả nhóm có view trung bình cao nhất với ít nhất 2 video.
function bestBucket(items, keyOf) {
  const buckets = new Map();
  for (const item of items) {
    if (!(item.views > 0)) continue;
    const key = keyOf(item);
    const bucket = buckets.get(key) || { key, count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += item.views;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].filter((bucket) => bucket.count >= 2)
    .map((bucket) => ({ key: bucket.key, count: bucket.count, avgViews: Math.round(bucket.total / bucket.count) }))
    .sort((a, b) => b.avgViews - a.avgViews);
  return ranked[0] || null;
}

export function topHashtags(items, limit = 8) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of new Set(extractHashtags(item.caption))) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

export function formatCompact(value) {
  const number = Number(value) || 0;
  if (number >= 1e9) return `${(number / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(number);
}

// Đường xu hướng (sparkline) SVG inline từ dãy số; không cần thư viện chart.
export function sparklineSvg(values, { width = 120, height = 28 } = {}) {
  const points = values.filter(Number.isFinite);
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = points[points.length - 1] >= points[0];
  return `<svg class="sparkline ${rising ? "up" : "down"}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(" ")}"/></svg>`;
}

// "2 days ago" / "3 tuần trước" (YouTube) → mốc thời gian tuyệt đối; không nhận ra → 0.
const AGE_UNITS = {
  second: 1000, giay: 1000, minute: 60000, phut: 60000, hour: 3600000, gio: 3600000,
  day: 86400000, ngay: 86400000, week: 604800000, tuan: 604800000,
  month: 2592000000, thang: 2592000000, year: 31536000000, nam: 31536000000
};

export function parseRelativeAge(text, now = Date.now()) {
  const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  const match = normalized.match(/(\d+)\s*(second|minute|hour|day|week|month|year|giay|phut|gio|ngay|tuan|thang|nam)s?\b/);
  if (!match) return 0;
  return now - Number(match[1]) * AGE_UNITS[match[2]];
}

// Tên thư mục con theo kênh: bỏ ký tự cấm của Windows, tối đa 40 ký tự.
export function channelFolderName(name, url = "") {
  let base = String(name || "").trim();
  if (!base || /^https?:/i.test(base)) {
    try {
      base = new URL(url).pathname.split("/").filter(Boolean).find((part) => !["reels", "videos", "shorts", "video"].includes(part)) || "";
    } catch (_) {
      base = "";
    }
  }
  return base.replace(/[<>:"/\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 40);
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} KB`;
  return `${value} B`;
}
