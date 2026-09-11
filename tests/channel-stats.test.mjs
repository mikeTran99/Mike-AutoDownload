import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readProjectFile, extractFunction } from "./helpers/project.mjs";

function fakeDocument({ host, selectors = {}, meta = {}, bodyText = "" }) {
  const el = (textContent) => (textContent === undefined ? null : { textContent, getAttribute: () => null });
  return {
    location: { hostname: host },
    document: {
      body: { innerText: bodyText },
      querySelector(selector) {
        for (const [key, value] of Object.entries(meta)) {
          if (selector.includes(`"${key}"`)) return { getAttribute: () => value };
        }
        for (const [key, value] of Object.entries(selectors)) {
          if (selector.includes(key)) return el(value);
        }
        return null;
      }
    }
  };
}

test("profile header reader parses TikTok, Instagram and Facebook follower counts", async () => {
  const source = await readProjectFile("service-worker.js");
  const run = (ctx) => vm.runInNewContext(`(function () { ${extractFunction(source, "readProfileHeaderInPage")} })()`, ctx);

  const tiktok = run(fakeDocument({ host: "www.tiktok.com", selectors: { "user-title": "Mike", "followers-count": "1.2M", "likes-count": "35.4M" } }));
  assert.equal(tiktok.name, "Mike");
  assert.equal(tiktok.followers, 1200000);
  assert.equal(tiktok.likes, 35400000);

  const instagram = run(fakeDocument({ host: "www.instagram.com", meta: { "og:title": "Mike (@mike) • Instagram", "og:description": "12.5K Followers, 300 Following, 88 Posts - See Instagram photos" } }));
  assert.equal(instagram.name, "Mike");
  assert.equal(instagram.followers, 12500);

  const facebook = run(fakeDocument({ host: "www.facebook.com", selectors: { h1: "Trang Mike" }, bodyText: "Trang Mike\n2,3 Tr người theo dõi • 150 N lượt thích" }));
  assert.equal(facebook.followers, 2300000);
  assert.equal(facebook.likes, 150000);
});

test("channel stats aggregate views, keep top 5 and a bounded history", async () => {
  const source = await readProjectFile("service-worker.js");
  const store = { channelStats: {} };
  const ctx = {
    chrome: { storage: { local: { get: async () => ({ channelStats: store.channelStats }), set: async (patch) => Object.assign(store, patch) } } },
    MAX_CHANNEL_STATS: 50,
    MAX_STATS_HISTORY: 30
  };
  const record = vm.runInNewContext(`(async function (sourceUrl, platform, result) { ${extractFunction(source, "recordChannelStats")} })`, ctx);
  const items = Array.from({ length: 8 }, (_, i) => ({ link: `https://t/v${i}`, views: (i + 1) * 1000, viewText: `${i + 1}K` }));

  await record("https://www.tiktok.com/@mike", "tiktok", { items, profile: { name: "Mike", followers: 500 }, lastCrawlTime: 1 });
  await record("https://www.tiktok.com/@mike", "tiktok", { items, profile: { name: "Mike", followers: 650 }, lastCrawlTime: 2 });

  const entry = store.channelStats["https://www.tiktok.com/@mike"];
  assert.equal(entry.videoCount, 8);
  assert.equal(entry.totalViews, 36000);
  assert.equal(entry.avgViews, 4500);
  assert.equal(entry.top.map((video) => video.views).join(","), "8000,7000,6000,5000,4000");
  assert.equal(entry.followers, 650);
  assert.equal(entry.history.length, 2);
  assert.equal(entry.history[0].followers, 500);
});
