// This function is serialized by chrome.scripting: keep every dependency inside it.
export function collectPageMedia() {
  const candidates = [];
  const seen = new Set();
  const page = new URL(location.href);
  const host = page.hostname.replace(/^www\./, "");
  const isYouTube = host === "youtube.com" || host === "youtu.be";
  const isSuno = host === "suno.com" || host === "suno.ai";
  const mediaId = isYouTube
    ? page.searchParams.get("v") || page.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || (host === "youtu.be" ? page.pathname.slice(1) : "")
    : isSuno ? page.pathname.match(/\/song\/([^/?]+)/)?.[1] || "" : "";
  let sawStream = false;
  let sawBlob = false;
  const kinds = { mp4:"video", m4v:"video", mov:"video", webm:"video", mkv:"video",
    mp3:"audio", m4a:"audio", aac:"audio", wav:"audio", flac:"audio", ogg:"audio", opus:"audio",
    jpg:"image", jpeg:"image", png:"image", gif:"image", webp:"image", avif:"image",
    vtt:"subtitle", srt:"subtitle" };
  function add(raw, meta = {}) {
    if (!raw || candidates.length >= 1000) return;
    let url;
    try { url = new URL(raw, page.href); } catch { return; }
    if (url.protocol === "blob:") { sawBlob = true; return; }
    if (!["http:", "https:"].includes(url.protocol)) return;
    const mime = String(meta.mime || "").toLowerCase().split(";")[0];
    if (/\.(m3u8|mpd|m4s|ts)(?:$|[?#])/i.test(url.href) || /mpegurl|dash\+xml/i.test(mime)) { sawStream = true; return; }
    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const kind = kinds[extension] || (/^(video|audio|image)\//.exec(mime)?.[1]) ||
      (/vtt|subrip/.test(mime) ? "subtitle" : "") || meta.kind || "";
    if (!kind || seen.has(url.href)) return;
    seen.add(url.href);
    const title = String(meta.label || document.title || "media").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 100);
    const fallback = {video:"mp4",audio:"mp3",image:"jpg",subtitle:"vtt"}[kind];
    const ext = extension && kinds[extension] ? extension : fallback;
    const original = url.pathname.split("/").pop();
    const quality = Number(meta.height || 0);
    candidates.push({
      url: url.href, kind, mime, mediaId: meta.mediaId || "", assetId: meta.assetId || url.href,
      groupId: meta.groupId || "", quality, qualityLabel: quality ? quality + "p" : "",
      filename: meta.filename || (extension && kinds[extension] ? original : title + "." + ext),
      label: title, source: meta.source || "page", score: quality,
      evidence: meta.evidence || (kinds[extension] ? "extension" : mime ? "mime" : "dom")
    });
  }
  function text(el) {
    return el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || el?.textContent || "";
  }
  function isAd(el) { return Boolean(el.closest?.('[data-ad], [data-ad-slot], .advertisement, [aria-label="Advertisement"]')); }
  for (const kind of ["video", "audio"]) {
    let index = 0;
    for (const el of document.querySelectorAll(kind)) {
      if (isAd(el)) continue;
      const meta = {kind, label:text(el), mime:el.type || "", height:el.videoHeight || 0,
        groupId:kind + "-" + index++, source:kind, evidence:"dom"};
      add(el.currentSrc || el.src, meta);
      for (const source of el.querySelectorAll("source[src]")) add(source.src, {...meta, mime:source.type || meta.mime});
      if (kind === "video") add(el.poster, {kind:"image", label:text(el), source:"poster"});
    }
  }
  for (const el of document.querySelectorAll("track[src]")) {
    add(el.src, {kind:"subtitle", mime:"text/vtt", label:el.label || el.srclang || "subtitle", source:"track"});
  }
  for (const el of document.querySelectorAll("img")) {
    if (isAd(el) || Math.min(el.naturalWidth || 0, el.naturalHeight || 0) < 160) continue;
    add(el.currentSrc || el.src, {kind:"image", label:el.alt || text(el), source:"image", evidence:"dom"});
  }
  for (const el of document.querySelectorAll("a[href]")) {
    if (!isAd(el)) add(el.href, {label:text(el), filename:el.getAttribute("download") || "", source:"anchor"});
  }
  // Parse JSON data only. Never evaluate page JavaScript or decode signatures.
  function jsonObject(source, start) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); } catch { return null; }
      }
    }
    return null;
  }
  let visited = 0;
  function walk(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 20 || ++visited > 20000) return;
    const id = String(value.id || value.video_id || value.videoId || value.aweme_id || "");
    if (isSuno && mediaId && id === mediaId) {
      for (const key of ["audio_url", "video_url", "image_url", "image_large_url"]) {
        add(value[key], {kind:key.startsWith("audio")?"audio":key.startsWith("video")?"video":"image",
          label:value.title || "Suno", mediaId:id, source:"suno-json", evidence:"structured"});
      }
    } else if (!isYouTube && !isSuno) {
      // JSON video data is shown for explicit preview; unrelated objects stay distinct.
      for (const key of ["browser_native_hd_url", "browser_native_sd_url", "playAddr", "video_url", "audio_url"]) {
        if (typeof value[key] === "string") add(value[key], {kind:key === "audio_url"?"audio":"video",
          mediaId:id, label:value.title || "", groupId:id, source:"json", evidence:"structured"});
      }
    }
    for (const child of Object.values(value)) if (child && typeof child === "object") walk(child, depth + 1);
  }
  let scriptBytes = 0;
  for (const script of [...document.scripts].slice(0, 100)) {
    const source = script.textContent || "";
    if (source.length > 1000000 || (scriptBytes += source.length) > 4000000) continue;
    if (isYouTube && mediaId) {
      const marker = source.indexOf("ytInitialPlayerResponse");
      const start = marker < 0 ? -1 : source.indexOf("{", marker);
      const data = start < 0 ? null : jsonObject(source, start);
      if (data?.videoDetails?.videoId !== mediaId) continue;
      for (const format of data.streamingData?.formats || []) {
        // formats contains progressive muxed files; adaptiveFormats is deliberately excluded.
        if (!format.url || format.signatureCipher || format.cipher ||
          !(format.audioChannels || [18,22].includes(format.itag))) continue;
        add(format.url, {kind:"video", mime:format.mimeType, height:format.height, mediaId,
          label:data.videoDetails.title, groupId:mediaId, source:"youtube-progressive", evidence:"structured"});
      }
    } else {
      try { walk(JSON.parse(source)); } catch {
        const start = source.indexOf("{");
        if (start >= 0) walk(jsonObject(source, start));
      }
    }
  }
  return {
    candidates, mediaId, title:document.title || "", sourceUrl:page.href,
    blockedReason: candidates.length ? "" : sawStream ? "Trang chỉ cung cấp HLS/DASH; chưa có file media trực tiếp."
      : sawBlob ? "Trang dùng blob; hãy dùng nút xuất/tải chính thức của trang." : "Không tìm thấy file media trực tiếp."
  };
}

export function selectMediaCandidate(candidates, request = {}) {
  let choices = candidates.filter((item) => item?.url && !/^(blob|data):/.test(item.url) &&
    !/\.(m3u8|mpd|ts|m4s)(?:$|[?#])/i.test(item.url));
  if (request.mediaId) choices = choices.filter((item) => item.mediaId === request.mediaId);
  if (request.mediaKind) choices = choices.filter((item) => (item.kind || "video") === request.mediaKind);
  if (request.assetId) choices = choices.filter((item) => item.assetId === request.assetId);
  const groups = new Set(choices.map((item) => item.mediaId || item.groupId || item.url));
  if (groups.size !== 1) return null;
  return choices.sort((a,b) => (b.quality || 0) - (a.quality || 0))[0] || null;
}
