const EXTENSION_KIND = Object.freeze({
  mp4: "video", webm: "video", mov: "video", m4v: "video", avi: "video", mkv: "video", ogv: "video",
  mp3: "audio", m4a: "audio", aac: "audio", ogg: "audio", opus: "audio", flac: "audio", wav: "audio",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image", svg: "image",
  vtt: "subtitle", srt: "subtitle"
});

const MIME_EXTENSION = Object.freeze({
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v",
  "video/x-msvideo": "avi", "video/x-matroska": "mkv", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/aac": "aac", "audio/ogg": "ogg", "audio/opus": "opus", "audio/flac": "flac",
  "audio/x-flac": "flac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "text/vtt": "vtt", "application/x-subrip": "srt",
  "application/srt": "srt"
});

const DEFAULT_EXTENSION = Object.freeze({ video: "mp4", audio: "mp3", image: "jpg", subtitle: "vtt" });
const BLOCKED_EXTENSION = /^(?:m3u8?|mpd|ts|m4s|html?|xhtml|json|log|txt|js|css|exe|zip)$/;
const BLOCKED_MIME = /(?:mpegurl|dash\+xml|^video\/mp2t$)/;

function httpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch (_) {
    return null;
  }
}

function extensionOf(value) {
  const path = String(value || "").split(/[?#]/, 1)[0];
  return /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() || "";
}

function cleanMime(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function mediaInput(value, fallbackKind = "") {
  return typeof value === "string" ? { url: value, kindHint: fallbackKind } : { ...value, kindHint: value?.kindHint || fallbackKind };
}

export function classifyMedia(input = {}) {
  const { url: rawUrl, mime: rawMime, kindHint } = mediaInput(input);
  const url = httpUrl(rawUrl);
  if (!url) return "";
  const extension = extensionOf(url.pathname);
  const mime = cleanMime(rawMime);
  if (BLOCKED_EXTENSION.test(extension) || BLOCKED_MIME.test(mime)) return "";
  const extensionKind = EXTENSION_KIND[extension] || "";
  const mimeKind = EXTENSION_KIND[MIME_EXTENSION[mime]] || (/^(video|audio|image)\/[a-z0-9.+-]+$/.exec(mime)?.[1] || "");
  if (mimeKind) return extensionKind && extensionKind !== mimeKind ? "" : mimeKind;
  if (mime && !["application/octet-stream", "binary/octet-stream"].includes(mime)) {
    return mime === "text/plain" && extension === "srt" ? "subtitle" : "";
  }
  if (extensionKind) return extensionKind;
  return !extension && DEFAULT_EXTENSION[kindHint] ? kindHint : "";
}

export function getMediaExtension(input, fallbackKind = "") {
  const candidate = mediaInput(input, fallbackKind);
  const kind = classifyMedia(candidate);
  if (!kind) return "";
  const extension = extensionOf(httpUrl(candidate.url).pathname);
  return EXTENSION_KIND[extension] === kind ? extension : MIME_EXTENSION[cleanMime(candidate.mime)] || DEFAULT_EXTENSION[kind];
}

function isHost(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function normalizeSourceUrl(value) {
  const url = httpUrl(value);
  if (!url) return "";
  // Preserve the spelling and encoding of each retained query value: signatures can depend on it.
  const kept = url.search.slice(1).split("&").filter((part) => {
    let key;
    try { key = decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " ")).toLowerCase(); }
    catch (_) { return true; }
    if (/^utm_/.test(key) || ["fbclid", "gclid", "dclid", "msclkid", "igshid", "igsh"].includes(key)) return false;
    if (isHost(url.hostname, "facebook.com") && ["mibextid", "ref", "refsrc"].includes(key)) return false;
    if (isHost(url.hostname, "tiktok.com") && ["_t", "_r", "is_from_webapp", "sender_device"].includes(key)) return false;
    if ((isHost(url.hostname, "youtube.com") || isHost(url.hostname, "youtu.be")) && ["si", "feature"].includes(key)) return false;
    return true;
  });
  url.search = kept.join("&");
  return url.href;
}

function pageIdentity(url) {
  const host = url.hostname;
  const path = url.pathname;
  if (isHost(host, "facebook.com")) {
    const id = /\/(?:reel|videos)\/(\d+)/.exec(path)?.[1] || url.searchParams.get("v") || url.searchParams.get("fbid");
    if (id && /^\d+$/.test(id)) return `facebook:${id}`;
  }
  if (isHost(host, "tiktok.com")) {
    const id = /\/(?:video|photo)\/(\d+)/.exec(path)?.[1];
    if (id) return `tiktok:${id}`;
  }
  if (isHost(host, "instagram.com")) {
    const id = /\/(?:p|reels?|tv)\/([a-zA-Z0-9_-]+)/.exec(path)?.[1];
    if (id) return `instagram:${id}`;
  }
  if (isHost(host, "douyin.com")) {
    const id = /\/(?:video|note)\/(\d+)/.exec(path)?.[1] || url.searchParams.get("modal_id") || url.searchParams.get("aweme_id");
    if (id && /^\d+$/.test(id)) return `douyin:${id}`;
  }
  if (isHost(host, "youtube.com") || isHost(host, "youtu.be")) {
    const id = isHost(host, "youtu.be") ? path.split("/")[1] : /\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]+)/.exec(path)?.[1] || url.searchParams.get("v");
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return `youtube:${id}`;
  }
  return url.href;
}

export function canonicalMediaKey(input) {
  const item = typeof input === "string" ? { link: input } : input || {};
  const source = normalizeSourceUrl(item.sourceUrl || item.pageUrl || item.link || item.url || item.downloadUrl || item.mediaUrl);
  if (!source) return "";
  const requestedKind = item.mediaKind || item.kind || item.expectedKind;
  const kind = DEFAULT_EXTENSION[requestedKind] ? requestedKind : classifyMedia({ url: item.downloadUrl || item.mediaUrl || item.url || source, mime: item.mime, kindHint: item.kindHint }) || "video";
  const asset = String(item.assetId ?? item.assetIndex ?? "0");
  const variant = String(item.variant || item.quality || "default").trim().toLowerCase();
  return `${pageIdentity(new URL(source))}|${kind}|${encodeURIComponent(asset)}|${encodeURIComponent(variant)}`;
}

export function validateMediaDownload(item, { expectedKind = "video" } = {}) {
  const fail = (reason) => ({ ok: false, reason, kind: "", extension: "" });
  if (!item) return fail("DOWNLOAD_NOT_FOUND");
  if (item.state === "interrupted") return fail("DOWNLOAD_INTERRUPTED");
  if (item.danger && !["safe", "accepted", "allowlistedByPolicy"].includes(item.danger)) return fail("DOWNLOAD_DANGER");
  const sizes = [item.totalBytes, item.fileSize].filter((size) => typeof size === "number" && Number.isFinite(size));
  if (item.state !== "in_progress" && sizes.includes(0)) return fail("DOWNLOAD_EMPTY");
  if (item.state === "complete" && !sizes.some((size) => size > 0)) return fail("DOWNLOAD_EMPTY");
  const extension = extensionOf(item.filename);
  const kind = EXTENSION_KIND[extension] || "";
  if (!kind || (expectedKind && kind !== expectedKind)) return fail("DOWNLOAD_MISMATCH");
  const mime = cleanMime(item.mime);
  const mimeKind = EXTENSION_KIND[MIME_EXTENSION[mime]] || "";
  const untyped = !mime || ["application/octet-stream", "binary/octet-stream"].includes(mime);
  const plainSubtitle = mime === "text/plain" && kind === "subtitle" && extension === "srt";
  if (BLOCKED_MIME.test(mime) || (!untyped && !plainSubtitle && mimeKind !== kind)) return fail("DOWNLOAD_MISMATCH");
  for (const rawUrl of [item.url, item.finalUrl].filter(Boolean)) {
    const url = httpUrl(rawUrl);
    if (!url || BLOCKED_EXTENSION.test(extensionOf(url.pathname))) return fail("DOWNLOAD_MISMATCH");
  }
  return { ok: true, reason: "", kind, extension };
}

function exactDownloadUrl(value) {
  const url = httpUrl(value);
  if (!url) return "";
  url.hash = "";
  return url.href;
}

export function matchesDownloadSource(item, {
  sourceUrl = "", downloadUrl = "", expectedUrls = [], allowedHosts = [], expectedKind = "video", extensionId = ""
} = {}) {
  if (!validateMediaDownload(item, { expectedKind }).ok) return false;
  if (extensionId && item.byExtensionId && item.byExtensionId !== extensionId) return false;
  const actualUrls = [item.url, item.finalUrl].map(exactDownloadUrl).filter(Boolean);
  const explicitUrls = [downloadUrl, ...expectedUrls].map(exactDownloadUrl).filter(Boolean);
  if (downloadUrl || expectedUrls.length) return actualUrls.some((url) => explicitUrls.includes(url));
  const source = exactDownloadUrl(sourceUrl);
  if (source && actualUrls.includes(source)) return true;
  const hosts = allowedHosts.map((host) => String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "")).filter(Boolean);
  return actualUrls.some((url) => hosts.some((host) => isHost(new URL(url).hostname, host)));
}

function historyKeys(history) {
  const entries = history instanceof Set ? [...history] : Array.isArray(history) ? history : Object.keys(history || {});
  return new Set(entries.map((entry) => {
    const value = typeof entry === "string" ? entry : entry?.canonicalKey;
    return value && /\|(video|audio|image|subtitle)\|[^|]*\|[^|]*$/.test(value) ? value : canonicalMediaKey(entry);
  }).filter(Boolean));
}

export function mergeQueueItems(existing = [], incoming = [], { history = [], limit = 5000 } = {}) {
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(5000, Math.floor(Number(limit)))) : 5000;
  const result = { items: [], added: 0, skipped: 0, duplicates: 0, historySkipped: 0, limitSkipped: 0, invalid: 0 };
  const seen = new Set();
  const existingPositions = new Map();
  const downloaded = historyKeys(history);
  const records = (values) => Array.isArray(values) ? values : [];
  const asItem = (value) => typeof value === "string" ? { link: value } : value;
  for (const value of records(existing)) {
    const item = asItem(value);
    const key = canonicalMediaKey(item);
    if (key && existingPositions.has(key)) {
      const position = existingPositions.get(key);
      if ((!result.items[position].status || result.items[position].status === "pending") && item.status && item.status !== "pending") {
        result.items[position] = { ...item, canonicalKey: key };
      }
      continue;
    }
    if (!item) continue;
    if (key) {
      existingPositions.set(key, result.items.length);
      seen.add(key);
    }
    result.items.push(key ? { ...item, canonicalKey: key } : { ...item });
  }
  for (const value of records(incoming)) {
    const item = asItem(value);
    const key = canonicalMediaKey(item);
    let skipped = "";
    if (!key) skipped = "invalid";
    else if (seen.has(key)) skipped = "duplicates";
    else if (result.items.length >= maximum) skipped = "limitSkipped";
    else if (downloaded.has(key)) skipped = "historySkipped";
    if (skipped) {
      if (skipped === "historySkipped") {
        result.items.push({ ...item, canonicalKey: key, status: "skipped", message: "Đã tải trước đó" });
        seen.add(key);
      }
      result[skipped] += 1;
      result.skipped += 1;
      continue;
    }
    result.items.push({ ...item, canonicalKey: key, status: item.status || "pending" });
    seen.add(key);
    result.added += 1;
  }
  return result;
}

export function parseCompactCount(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0;
  const text = String(value || "").trim().toLowerCase();
  const match = /(-?\d[\d.,\s]*)/.exec(text);
  if (!match || match[1].startsWith("-")) return 0;
  const rest = text.slice(match.index + match[0].length).trim();
  const unit = /^(thousand|million|billion|nghìn|ngàn|triệu|tỷ|tỉ|[kmb])(?=$|[^\p{L}\p{N}_])|^([万亿])/u.exec(rest);
  const suffix = unit?.[1] || unit?.[2] || "";
  const multipliers = { k: 1e3, thousand: 1e3, "nghìn": 1e3, "ngàn": 1e3, m: 1e6, million: 1e6, "triệu": 1e6, b: 1e9, billion: 1e9, "tỷ": 1e9, "tỉ": 1e9, "万": 1e4, "亿": 1e8 };
  let number = match[1].replace(/\s/g, "");
  if (!suffix && /^\d{1,3}(?:[.,]\d{3})+$/.test(number)) number = number.replace(/[.,]/g, "");
  else if (number.includes(",") && number.includes(".")) {
    const decimal = Math.max(number.lastIndexOf(","), number.lastIndexOf("."));
    number = `${number.slice(0, decimal).replace(/[.,]/g, "")}.${number.slice(decimal + 1)}`;
  } else number = number.replace(",", ".");
  const count = Number(number) * (multipliers[suffix] || 1);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
}
