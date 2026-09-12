import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readProjectFile, extractFunction } from "./helpers/project.mjs";

test("YouTube channel links normalize to the videos/shorts tab in popup and worker alike", async () => {
  for (const file of ["popup.js", "service-worker.js"]) {
    const source = await readProjectFile(file);
    const normalize = vm.runInNewContext(`(function (value) { ${extractFunction(source, "normalizeYouTubeChannelUrl")} })`, { URL });
    assert.equal(normalize("youtube.com/@BlenderOfficial"), "https://www.youtube.com/@BlenderOfficial/videos", file);
    assert.equal(normalize("https://m.youtube.com/@BlenderOfficial/shorts?x=1"), "https://www.youtube.com/@BlenderOfficial/shorts", file);
    assert.equal(normalize("https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg/videos"), "https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg/videos", file);
    assert.equal(normalize("https://www.youtube.com/watch?v=abc"), "", file);
    assert.equal(normalize("https://www.tiktok.com/@x"), "", file);
  }
});

test("worker dispatches YouTube crawls and post-processes ages into postedAt", async () => {
  const worker = await readProjectFile("service-worker.js");
  assert.match(extractFunction(worker, "detectCrawlPlatform"), /normalizeYouTubeChannelUrl/);
  assert.match(extractFunction(worker, "crawlChannelVideos"), /platform === "youtube"/);
  assert.match(extractFunction(worker, "crawlYouTubeChannel"), /parseRelativeAge\(item\.ageText/);
  assert.match(extractFunction(worker, "crawlYouTubeVideosInPage"), /yt-lockup-view-model/);
});
