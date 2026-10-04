import test from "node:test";
import assert from "node:assert/strict";

// A missing module produces a feature assertion, so the first red run remains actionable.
const policy = await import("../src/shared/media-policy.js").catch(() => ({}));

test("direct media classification refuses playlists and unsupported schemes", () => {
  assert.equal(typeof policy.classifyMedia, "function", "direct media classification is available");
  const cases = [
    [{ url: "https://cdn.example/movie.MP4?signature=keep" }, "video"],
    [{ url: "https://cdn.example/song.mp3" }, "audio"],
    [{ url: "https://cdn.example/photo.avif" }, "image"],
    [{ url: "https://cdn.example/captions.vtt" }, "subtitle"],
    [{ url: "https://cdn.example/content", mime: "video/mp4; codecs=avc1" }, "video"],
    [{ url: "https://cdn.example/content", kindHint: "image" }, "image"],
    [{ url: "https://cdn.example/content" }, ""],
    [{ url: "blob:https://example.com/123", kindHint: "video" }, ""],
    [{ url: "data:video/mp4;base64,AA" }, ""],
    [{ url: "https://cdn.example/stream.m3u8", mime: "video/mp4" }, ""],
    [{ url: "https://cdn.example/stream.mpd", kindHint: "video" }, ""],
    [{ url: "https://cdn.example/chunk.ts", mime: "video/mp2t" }, ""],
    [{ url: "https://cdn.example/chunk.m4s", mime: "video/mp4" }, ""],
    [{ url: "https://cdn.example/movie.mp4", mime: "application/vnd.apple.mpegurl" }, ""],
    [{ url: "https://cdn.example/movie.mp4", mime: "application/dash+xml" }, ""],
    [{ url: "https://cdn.example/movie.mp4", mime: "text/html" }, ""],
    [{ url: "https://cdn.example/report.log", kindHint: "video" }, ""]
  ];
  for (const [input, expected] of cases) assert.equal(policy.classifyMedia(input), expected, JSON.stringify(input));
});

test("media filename extensions come from positive media evidence", () => {
  assert.equal(typeof policy.getMediaExtension, "function", "media extension selection is available");
  assert.equal(policy.getMediaExtension("https://cdn.example/clip.WEBM?token=abc"), "webm");
  assert.equal(policy.getMediaExtension({ url: "https://cdn.example/item", mime: "audio/mpeg" }), "mp3");
  assert.equal(policy.getMediaExtension({ url: "https://cdn.example/item", kindHint: "image" }), "jpg");
  assert.equal(policy.getMediaExtension("https://cdn.example/item", "audio"), "mp3");
  assert.equal(policy.getMediaExtension("https://cdn.example/stream.m3u8", "video"), "");
  assert.equal(policy.getMediaExtension("blob:https://example.com/123", "video"), "");
});

test("source normalization removes tracking while retaining download authorization and Telegram routes", () => {
  assert.equal(typeof policy.normalizeSourceUrl, "function", "source normalization is available");
  assert.equal(policy.normalizeSourceUrl("https://cdn.example/video.mp4?token=abc&expires=123&signature=A%2BB&utm_source=share&fbclid=tracking"), "https://cdn.example/video.mp4?token=abc&expires=123&signature=A%2BB");
  assert.equal(policy.normalizeSourceUrl("https://web.telegram.org/k/?utm_source=share#@public_channel/42"), "https://web.telegram.org/k/#@public_channel/42");
  assert.equal(policy.normalizeSourceUrl("https://cdn.example/file?X-Amz-Signature=abc&X-Amz-Credential=keep&Policy=keep&Key-Pair-Id=keep"), "https://cdn.example/file?X-Amz-Signature=abc&X-Amz-Credential=keep&Policy=keep&Key-Pair-Id=keep");
  assert.equal(policy.normalizeSourceUrl("blob:https://example.com/123"), "");
});

test("social page identity survives share aliases without collapsing carousel assets or variants", () => {
  assert.equal(typeof policy.canonicalMediaKey, "function", "canonical media identity is available");
  const cases = [
    ["https://m.facebook.com/reel/123?mibextid=share", "facebook:123|video|0|default"],
    ["https://www.facebook.com/watch/?v=123&ref=share", "facebook:123|video|0|default"],
    ["https://www.facebook.com/example/videos/123/", "facebook:123|video|0|default"],
    ["https://www.tiktok.com/@oldname/video/456?_t=share&_r=1", "tiktok:456|video|0|default"],
    ["https://www.instagram.com/reel/ABC123/?igsh=share", "instagram:ABC123|video|0|default"],
    ["https://www.instagram.com/p/ABC123/?utm_source=share", "instagram:ABC123|video|0|default"],
    ["https://www.douyin.com/video/789?share=1", "douyin:789|video|0|default"],
    ["https://www.douyin.com/?modal_id=789", "douyin:789|video|0|default"],
    ["https://youtu.be/AbCd123?si=share", "youtube:AbCd123|video|0|default"],
    ["https://www.youtube.com/shorts/AbCd123?feature=share", "youtube:AbCd123|video|0|default"],
    ["https://www.youtube.com/watch?v=AbCd123&t=30", "youtube:AbCd123|video|0|default"],
    [{ link: "https://instagram.com/p/ABC123/", mediaKind: "image", assetIndex: 1, quality: "Original" }, "instagram:ABC123|image|1|original"],
    [{ link: "https://instagram.com/p/ABC123/", mediaKind: "image", assetIndex: 2, quality: "Original" }, "instagram:ABC123|image|2|original"],
    [{ link: "https://instagram.com/p/ABC123/", mediaKind: "audio", assetId: "track", variant: "high" }, "instagram:ABC123|audio|track|high"],
    ["https://cdn.example/photo.jpg?token=abc&utm_medium=social", "https://cdn.example/photo.jpg?token=abc|image|0|default"],
    ["https://web.telegram.org/k/#@public_channel/42", "https://web.telegram.org/k/#@public_channel/42|video|0|default"],
    ["javascript:alert(1)", ""]
  ];
  for (const [input, expected] of cases) assert.equal(policy.canonicalMediaKey(input), expected, JSON.stringify(input));
});

const downloadedVideo = {
  id: 7, state: "complete", filename: "C:\\Downloads\\clip.mp4", mime: "video/mp4",
  url: "https://cdn.example/clip.mp4?token=keep", finalUrl: "https://cdn.example/clip.mp4?token=keep",
  danger: "safe", fileSize: 1234, totalBytes: 1234, byExtensionId: "extension-id"
};

test("download validation requires the expected actual media type and a safe nonempty file", () => {
  assert.equal(typeof policy.validateMediaDownload, "function", "download validation is available");
  const good = policy.validateMediaDownload(downloadedVideo, { expectedKind: "video" });
  assert.equal(good.ok, true);
  assert.equal(good.kind, "video");
  assert.equal(good.extension, "mp4");
  const badCases = [
    [{ filename: "C:\\Downloads\\debug.log", mime: "text/plain" }, "video"],
    [{ filename: "C:\\Downloads\\debug.log", mime: "video/mp4" }, "video"],
    [{ filename: "C:\\Downloads\\renamed.mp4", mime: "text/plain" }, "video"],
    [{ filename: "C:\\Downloads\\playlist.m3u8", mime: "application/vnd.apple.mpegurl" }, "video"],
    [{ url: "https://cdn.example/chunk.ts" }, "video"],
    [{ url: "blob:https://example.com/123" }, "video"],
    [{ mime: "video/x-unknown" }, "video"],
    [{ filename: "C:\\Downloads\\photo.jpg", mime: "image/jpeg" }, "video"],
    [{ filename: "C:\\Downloads\\clip.mp4", mime: "video/mp4" }, "audio"],
    [{ filename: "C:\\Downloads\\image", mime: "image/jpeg" }, "image"],
    [{ fileSize: 0 }, "video"],
    [{ totalBytes: 0 }, "video"],
    [{ state: undefined, fileSize: 0 }, "video"],
    [{ danger: "uncommon" }, "video"],
    [{ state: "interrupted", error: "NETWORK_FAILED" }, "video"]
  ];
  for (const [patch, expectedKind] of badCases) {
    const result = policy.validateMediaDownload({ ...downloadedVideo, ...patch }, { expectedKind });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.ok(result.reason, "failed validation includes a reason");
  }
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, mime: "application/octet-stream" }).ok, true);
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, state: "in_progress", mime: "", fileSize: -1, totalBytes: -1 }).ok, true);
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, filename: "photo.avif", mime: "image/avif" }, { expectedKind: "image" }).ok, true);
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, filename: "song.flac", mime: "audio/flac" }, { expectedKind: "audio" }).ok, true);
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, filename: "captions.srt", mime: "text/plain" }, { expectedKind: "subtitle" }).ok, true);
});

test("download matching never claims an unrelated extension download or referrer", () => {
  assert.equal(typeof policy.matchesDownloadSource, "function", "download source matching is available");
  const options = { downloadUrl: "https://cdn.example/clip.mp4?token=keep", expectedKind: "video", extensionId: "extension-id" };
  assert.equal(policy.matchesDownloadSource(downloadedVideo, options), true);
  assert.equal(policy.matchesDownloadSource({ ...downloadedVideo, url: "https://other.example/movie.mp4", finalUrl: "https://other.example/movie.mp4" }, options), false);
  assert.equal(policy.matchesDownloadSource({ ...downloadedVideo, filename: "debug.log", mime: "text/plain" }, options), false);
  assert.equal(policy.matchesDownloadSource({ ...downloadedVideo, byExtensionId: "another-extension" }, options), false);
  assert.equal(policy.matchesDownloadSource(downloadedVideo, { expectedUrls: ["https://cdn.example/clip.mp4?token=keep"], expectedKind: "video" }), true);
  assert.equal(policy.matchesDownloadSource(downloadedVideo, { allowedHosts: ["cdn.example"], expectedKind: "video" }), true);
  assert.equal(policy.matchesDownloadSource({ ...downloadedVideo, url: "https://cdn.example.evil/movie.mp4", finalUrl: "https://cdn.example.evil/movie.mp4", referrer: "https://cdn.example/page" }, { allowedHosts: ["cdn.example"] }), false);
  assert.equal(policy.matchesDownloadSource(downloadedVideo, { downloadUrl: "https://cdn.example/clip.mp4?token=different" }), false);
});

test("an explicit download URL cannot claim a different asset on an allowed CDN", () => {
  assert.equal(policy.matchesDownloadSource(downloadedVideo, {
    expectedUrls: ["https://cdn.example/different.mp4"], allowedHosts: ["cdn.example"]
  }), false);
});

test("a source page match cannot override an explicit different media candidate", () => {
  assert.equal(policy.matchesDownloadSource(downloadedVideo, {
    sourceUrl: downloadedVideo.url, expectedUrls: ["https://cdn.example/different.mp4"], allowedHosts: ["cdn.example"]
  }), false);
});

test("completed downloads allow an unknown Chrome size when another byte count is positive", () => {
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, fileSize: -1 }).ok, true);
});

test("completed downloads require positive byte evidence instead of two unknown sizes", () => {
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, fileSize: -1, totalBytes: -1 }).ok, false);
  assert.equal(policy.validateMediaDownload({ ...downloadedVideo, fileSize: undefined, totalBytes: undefined }).ok, false);
});

test("queue merge deduplicates canonical assets while retaining previous job state", () => {
  assert.equal(typeof policy.mergeQueueItems, "function", "safe queue merging is available");
  const existing = [{ id: "success-id", link: "https://youtube.com/watch?v=asset", status: "success", filename: "kept.mp4" }];
  const incoming = [
    { id: "duplicate-id", link: "https://youtu.be/asset?si=share", status: "pending" },
    { id: "image-1", link: "https://instagram.com/p/carousel/", mediaKind: "image", assetIndex: 1 },
    { id: "image-2", link: "https://instagram.com/p/carousel/", mediaKind: "image", assetIndex: 2 },
    { id: "image-1-again", link: "https://instagram.com/p/carousel/?igsh=share", mediaKind: "image", assetIndex: 1 },
    { id: "past", link: "https://tiktok.com/@new/video/123" },
    { id: "invalid", link: "javascript:alert(1)" }
  ];
  const result = policy.mergeQueueItems(existing, incoming, { history: { "https://tiktok.com/@old/video/123?utm_source=share": { time: 123, filename: "past.mp4" } } });
  assert.deepEqual(result.items.map((item) => item.id), ["success-id", "image-1", "image-2", "past"]);
  assert.equal(result.items[0].status, "success");
  assert.equal(result.items[0].filename, "kept.mp4");
  assert.equal(result.items[1].status, "pending");
  assert.equal(result.items[3].status, "skipped", "historical downloads remain visible as skipped rows");
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 4);
  assert.equal(result.duplicates, 2);
  assert.equal(result.historySkipped, 1);
  assert.equal(result.invalid, 1);
  assert.equal(existing.length, 1, "existing input is not mutated");
  assert.equal(incoming.length, 6, "incoming input is not mutated");
});

test("queue merge respects stored canonical history keys and bounds additions", () => {
  assert.equal(typeof policy.mergeQueueItems, "function", "safe queue merging is available");
  const canonicalHistory = { "instagram:carousel|image|1|default": { time: 123 } };
  const result = policy.mergeQueueItems([], [
    { link: "https://instagram.com/p/carousel/", mediaKind: "image", assetIndex: 1 },
    { link: "https://instagram.com/p/carousel/", mediaKind: "image", assetIndex: 2 },
    { link: "https://instagram.com/p/carousel/", mediaKind: "image", assetIndex: 3 }
  ], { history: canonicalHistory, limit: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].status, "skipped");
  assert.equal(result.items[1].assetIndex, 2);
  assert.equal(result.historySkipped, 1);
  assert.equal(result.limitSkipped, 1);
  const arrayHistory = policy.mergeQueueItems([], ["https://youtu.be/past", "https://youtu.be/new"], { history: ["https://youtube.com/watch?v=past"] });
  assert.equal(arrayHistory.historySkipped, 1);
  assert.equal(arrayHistory.items[0].status, "skipped");
  assert.equal(arrayHistory.items[1].link, "https://youtu.be/new");
  const bounded = policy.mergeQueueItems([], Array.from({ length: 5001 }, (_, index) => ({ link: `https://cdn.example/${index}.mp4` })));
  assert.equal(bounded.items.length, 5000);
  assert.equal(bounded.limitSkipped, 1);
});

test("queue migration retains prior failures and prefers a completed duplicate over a pending row", () => {
  const result = policy.mergeQueueItems([
    { id: "old-pending", link: "https://youtube.com/watch?v=asset", status: "pending" },
    { id: "old-success", link: "https://youtu.be/asset", status: "success", filename: "kept.mp4" },
    { id: "old-unsupported", link: "not a URL", status: "unsupported", message: "keep reason" },
    { id: "old-failed", link: "https://cdn.example/song.mp3", status: "failed" },
    { id: "old-running", link: "https://cdn.example/other.mp4", status: "running" }
  ], [{ id: "new-pending", link: "https://youtu.be/asset", status: "pending" }]);
  assert.deepEqual(result.items.map((item) => [item.id, item.status]), [
    ["old-success", "success"], ["old-unsupported", "unsupported"], ["old-failed", "failed"], ["old-running", "running"]
  ]);
  assert.equal(result.items[1].message, "keep reason");
  assert.equal(result.duplicates, 1);
});

test("a smaller new queue cap never truncates the existing queue", () => {
  const result = policy.mergeQueueItems([
    { id: "running", link: "https://cdn.example/1.mp4", status: "running" },
    { id: "failed", link: "https://cdn.example/2.mp4", status: "failed" }
  ], [{ id: "new", link: "https://cdn.example/3.mp4" }], { limit: 1 });
  assert.deepEqual(result.items.map((item) => item.id), ["running", "failed"]);
  assert.equal(result.limitSkipped, 1);
});

test("compact counts parse locale units without NaN or negative statistics", () => {
  assert.equal(typeof policy.parseCompactCount, "function", "compact count parsing is available");
  const cases = [
    ["1.2K", 1200], ["1,2k", 1200], ["2.5M views", 2500000], ["3B", 3000000000],
    ["4 thousand", 4000], ["1,5 triệu lượt xem", 1500000], ["2 tỷ lượt xem", 2000000000],
    ["2,5 nghìn", 2500], ["1.5万", 15000], ["2亿", 200000000],
    ["1,234", 1234], ["1.234", 1234], ["12 345", 12345], ["12 months", 12],
    [123, 123], ["0", 0], ["-3K", 0], ["unavailable", 0], [NaN, 0], [Infinity, 0]
  ];
  for (const [input, expected] of cases) assert.equal(policy.parseCompactCount(input), expected, String(input));
});
