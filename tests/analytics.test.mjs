import test from "node:test";
import assert from "node:assert/strict";
import { postedAtFromLink, computeChannelMetrics, extractHashtags, median, sparklineSvg, formatCompact } from "../src/shared/analytics.js";

test("posted time is decoded from TikTok/Douyin/Instagram ids and absent for Facebook", () => {
  assert.equal(new Date(postedAtFromLink("https://www.tiktok.com/@x/video/7106594312292453675", "tiktok")).toISOString().slice(0, 10), "2022-06-07");
  assert.equal(new Date(postedAtFromLink("https://www.instagram.com/p/B-pZ5DYnO8Q/", "instagram")).toISOString().slice(0, 7), "2020-04");
  assert.equal(postedAtFromLink("https://www.facebook.com/reel/123", "facebook"), 0);
  assert.equal(postedAtFromLink("https://www.tiktok.com/@x/video/1", "tiktok"), 0, "implausible ids are rejected");
});

test("channel metrics: median, outliers, new/undownloaded counts, hashtags, posting cadence", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const day = 86400000;
  const items = [
    { link: "a", views: 1000, caption: "#reup #viral", postedAt: now - 1 * day },
    { link: "b", views: 2000, caption: "#reup", postedAt: now - 3 * day },
    { link: "c", views: 3000, caption: "", postedAt: now - 8 * day },
    { link: "d", views: 20000, caption: "#viral #trend", postedAt: now - 15 * day },
    { link: "e", views: 0, caption: "", postedAt: 0 }
  ];
  const m = computeChannelMetrics(items, { previousLinks: new Set(["a", "b"]), downloadedLinks: new Set(["d"]), now });
  assert.equal(m.medianViews, 2500);
  assert.equal(m.viralCount, 1);
  assert.equal(m.top[0].link, "d");
  assert.equal(m.top[0].outlier, 8);
  assert.equal(m.top[0].downloaded, true);
  assert.equal(m.newCount, 3);
  assert.equal(m.notDownloadedCount, 3);
  assert.equal(m.postsPerWeek, 2);
  assert.deepEqual(m.hashtags.map((tag) => tag.tag), ["#reup", "#viral", "#trend"]);
  assert.equal(m.top[0].viewsPerDay, Math.round(20000 / 15));
});

test("helpers", () => {
  assert.deepEqual(extractHashtags("Hi #Việt_Nam #ok"), ["#việt_nam", "#ok"]);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), 0);
  assert.equal(formatCompact(1250000), "1.3M");
  assert.match(sparklineSvg([1, 2, 3]), /<svg class="sparkline up"/);
  assert.equal(sparklineSvg([1]), "");
});
