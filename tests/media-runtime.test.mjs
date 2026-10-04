import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./helpers/runtime.mjs";

function element(props = {}) {
  return { getAttribute: () => "", querySelectorAll: () => [], closest: () => null, ...props };
}

test("page scanner exposes audio, cover images and subtitle tracks as separate assets", async () => {
  const c = await runtime();
  const items = {
    video: [element({ currentSrc: "https://cdn.example.org/main.mp4", videoHeight: 480, poster: "https://cdn.example.org/cover.jpg" })],
    audio: [element({ currentSrc: "https://cdn.example.org/song.mp3" })],
    "track[src]": [element({ src: "https://cdn.example.org/en.vtt", kind: "subtitles", srclang: "en" })],
    img: [element({ currentSrc: "https://cdn.example.org/image.webp", naturalWidth: 1000, naturalHeight: 800 })]
  };
  c.sandbox.document.querySelectorAll = (selector) => items[selector] || [];
  const result = c.json("collectDirectMediaCandidates()");
  assert.deepEqual([...new Set(result.candidates.map((v) => v.kind))].sort(), ["audio", "image", "subtitle", "video"]);
});

test("playing video URL without extension is retained with DOM evidence", async () => {
  const c = await runtime();
  c.sandbox.document.querySelectorAll = (selector) => selector === "video"
    ? [element({ currentSrc: "https://cdn.example.org/play?id=7", videoWidth: 1280, videoHeight: 720 })] : [];
  assert.equal(c.json("collectDirectMediaCandidates()").candidates[0]?.kind, "video");
});

test("selection requires requested identity before ranking quality", async () => {
  const c = await runtime();
  const result = c.json('chooseBestMediaCandidate([{url:"https://cdn.example.org/target.mp4",mediaId:"target",kind:"video",quality:480},{url:"https://cdn.example.org/ad.mp4",mediaId:"ad",kind:"video",quality:1080}],{mediaId:"target"})');
  assert.equal(result?.url, "https://cdn.example.org/target.mp4");
});

test("unscoped multiple assets require selection rather than guessing by resolution", async () => {
  const c = await runtime();
  assert.equal(c.evaluate('chooseBestMediaCandidate([{url:"https://cdn.example.org/a.mp4",kind:"video",quality:480},{url:"https://cdn.example.org/b.mp4",kind:"video",quality:1080}])'), null);
});

test("YouTube structured player data checks video ID and accepts progressive formats in any field order", async () => {
  const c = await runtime();
  c.sandbox.location = { href: "https://www.youtube.com/watch?v=target", hostname: "www.youtube.com" };
  c.sandbox.document.scripts = [{ textContent: "var ytInitialPlayerResponse = " + JSON.stringify({
    videoDetails: { videoId: "target", title: "My Video" },
    streamingData: { formats: [
      { url: "https://rr.googlevideo.com/videoplayback?id=target&sig=a", mimeType: 'video/mp4; codecs="avc1, mp4a"', itag: 18, height: 360, audioChannels: 2 },
      { itag: 22, signatureCipher: "encrypted", mimeType: "video/mp4", height: 720 }
    ], adaptiveFormats: [{ url: "https://rr.googlevideo.com/videoplayback?id=seg", mimeType: "video/mp4", height: 1080 }] }
  }) + ";" }];
  const result = c.json("collectDirectMediaCandidates()");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].mediaId, "target");
  assert.equal(result.candidates[0].quality, 360);
});

test("Suno song JSON scopes audio and cover to the song ID in the page URL", async () => {
  const c = await runtime();
  c.sandbox.location = { href: "https://suno.com/song/target-song", hostname: "suno.com" };
  c.sandbox.document.scripts = [{ type: "application/json", textContent: JSON.stringify({ songs: [
    { id: "ad-song", audio_url: "https://cdn.example.org/ad.mp3" },
    { id: "target-song", title: "Song", audio_url: "https://cdn.example.org/song.mp3", image_url: "https://cdn.example.org/cover.png" }
  ] }) }];
  const result = c.json("collectDirectMediaCandidates()");
  assert.deepEqual(result.candidates.map((v) => v.kind).sort(), ["audio", "image"]);
  assert.ok(result.candidates.every((v) => v.mediaId === "target-song"));
});
