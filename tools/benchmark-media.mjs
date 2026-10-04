// Native, deterministic queue microbenchmark. No network, browser, or source-file writes.
import assert from "node:assert/strict";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mergeQueueItems } from "../src/shared/media-policy.js";

const implementation = {
  rawMerge(existing, incoming, limit = 5000) {
    const result = new Map();
    for (const item of [...existing, ...incoming]) if (!result.has(item.link)) result.set(item.link, item);
    return [...result.values()].slice(0, limit);
  },
  summarize(samples) {
    const values = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return {
      medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1], minMs: values[0], maxMs: values.at(-1)
    };
  },
  corpora() {
    const item = (index, link, fields = {}) => ({
      id: `fixture-${index}`, link, mediaKind: "video", status: "pending", title: `Media công khai giả lập ${index}`,
      caption: "Dữ liệu kiểm thử cố định, không phải nội dung tải từ nền tảng. ".repeat(2),
      subfolder: "benchmark", createdAt: 1700000000000, ...fields
    });
    const direct = (index, signature = "S".repeat(96)) => `https://cdn.example/media/${index}.mp4?signature=${signature}&expires=2000000000`;
    const unique = Array.from({ length: 5000 }, (_, index) => item(index, direct(index)));
    const trackedExisting = Array.from({ length: 2000 }, (_, index) => item(index, `https://youtube.com/watch?v=asset${index}`, { status: index % 5 === 0 ? "success" : "pending" }));
    const trackedIncoming = Array.from({ length: 3000 }, (_, index) => item(2000 + index, index < 1500 ? `https://youtu.be/asset${index}?si=tracking` : `https://youtube.com/watch?v=asset${index + 500}`));
    const carousel = Array.from({ length: 5000 }, (_, index) => item(index, `https://instagram.com/p/post${Math.floor(index / 5)}/`, { mediaKind: "image", assetIndex: index % 5 + 1 }));
    const history = Object.fromEntries(unique.slice(1000, 2000).map((entry) => [entry.link, { time: 1700000000000, filename: "benchmark.mp4" }]));
    return [
      { name: "unique-direct", existing: [], incoming: unique, history: {}, expectedRawRows: 5000, expectedPolicy: { rows: 5000, added: 5000, duplicates: 0, historySkipped: 0 } },
      { name: "social-share-aliases", existing: trackedExisting, incoming: trackedIncoming, history: {}, expectedRawRows: 5000, expectedPolicy: { rows: 3500, added: 1500, duplicates: 1500, historySkipped: 0 } },
      { name: "carousel-assets", existing: [], incoming: carousel, history: {}, expectedRawRows: 1000, expectedPolicy: { rows: 5000, added: 5000, duplicates: 0, historySkipped: 0 } },
      { name: "history-matches", existing: unique.slice(0, 1000), incoming: unique.slice(1000), history, expectedRawRows: 5000, expectedPolicy: { rows: 5000, added: 3000, duplicates: 0, historySkipped: 1000 } },
      { name: "long-signed-urls", existing: [], incoming: Array.from({ length: 5000 }, (_, index) => item(index, direct(index, "S".repeat(1536)))), history: {}, expectedRawRows: 5000, expectedPolicy: { rows: 5000, added: 5000, duplicates: 0, historySkipped: 0 } }
    ];
  }
};
assert.equal(typeof implementation.rawMerge, "function", "the raw-link comparison is implemented");
assert.equal(typeof implementation.summarize, "function", "the timing summary is implemented");
assert.deepEqual(implementation.rawMerge([{ id: "first", link: "https://example.org/a.mp4" }], [{ id: "second", link: "https://example.org/a.mp4" }]).map((item) => item.id), ["first"]);
assert.deepEqual(implementation.summarize([10, 1, 8, 3, 4, 2, 5, 6, 7, 9]), { medianMs: 5.5, p95Ms: 10, minMs: 1, maxMs: 10 });
const assetFixture = [
  { id: "one", link: "https://instagram.com/p/fixture/", mediaKind: "image", assetIndex: 1 },
  { id: "two", link: "https://instagram.com/p/fixture/", mediaKind: "image", assetIndex: 2 }
];
assert.equal(implementation.rawMerge([], assetFixture).length, 1, "raw-link deduplication loses separate carousel assets");
assert.equal(mergeQueueItems([], assetFixture).items.length, 2, "canonical merge retains separate carousel assets");
assert.equal(typeof implementation.corpora, "function", "the controlled 5,000-row benchmark inputs are implemented");
for (const corpus of implementation.corpora()) {
  assert.equal(corpus.existing.length + corpus.incoming.length, 5000, corpus.name);
  const policy = mergeQueueItems(corpus.existing, corpus.incoming, { history: corpus.history });
  const raw = implementation.rawMerge(corpus.existing, corpus.incoming);
  assert.deepEqual({ rows: policy.items.length, added: policy.added, duplicates: policy.duplicates, historySkipped: policy.historySkipped }, corpus.expectedPolicy, corpus.name);
  assert.equal(raw.length, corpus.expectedRawRows, corpus.name);
}
if (process.argv.includes("--self-test")) {
  console.log("Benchmark self-checks passed: raw-link behavior, literal median/p95, and five corpus outcomes.");
} else {
  const countArgument = process.argv.find((value) => value.startsWith("--iterations="));
  const iterations = Number(countArgument?.split("=", 2)[1] || 100);
  assert.ok(Number.isInteger(iterations) && iterations >= 10 && iterations <= 1000, "iterations must be an integer from 10 to 1000");
  const warmups = 10;
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const policySource = await readFile(new URL("../src/shared/media-policy.js", import.meta.url));
  const report = {
    measuredAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model || "unknown",
    logicalCpus: os.cpus().length, totalRamBytes: os.totalmem(), iterations, warmups,
    gcAvailable: typeof globalThis.gc === "function", policySha256: createHash("sha256").update(policySource).digest("hex"),
    scope: "Queue merge CPU time only; excludes DOM, rendering, browser storage, network and downloads.",
    rawComparison: "Test-only raw-link Map append; it has different correctness semantics and is not an equivalent implementation.",
    byteMetric: "UTF-8 JSON serialization, not Chrome heap or complete storage usage.", cases: []
  };
  let checksum = 0;
  for (const corpus of implementation.corpora()) {
    const operations = {
      rawLinkMap: () => implementation.rawMerge(corpus.existing, corpus.incoming),
      canonicalPolicy: () => mergeQueueItems(corpus.existing, corpus.incoming, { history: corpus.history }).items
    };
    const samples = Object.fromEntries(Object.keys(operations).map((name) => [name, []]));
    for (let iteration = 0; iteration < warmups; iteration += 1) for (const operation of Object.values(operations)) checksum += operation().length;
    globalThis.gc?.();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const names = iteration % 2 === 0 ? ["rawLinkMap", "canonicalPolicy"] : ["canonicalPolicy", "rawLinkMap"];
      for (const name of names) {
        const start = performance.now();
        const result = operations[name]();
        const elapsed = performance.now() - start;
        samples[name].push(elapsed);
        checksum += result.length;
      }
    }
    const current = mergeQueueItems(corpus.existing, corpus.incoming, { history: corpus.history });
    const raw = operations.rawLinkMap();
    report.cases.push({
      name: corpus.name, inputRows: corpus.existing.length + corpus.incoming.length,
      existingRows: corpus.existing.length, incomingRows: corpus.incoming.length, historyEntries: Object.keys(corpus.history).length,
      inputJsonBytes: bytes({ existing: corpus.existing, incoming: corpus.incoming, history: corpus.history }),
      rawLinkMap: { ...implementation.summarize(samples.rawLinkMap), rows: raw.length, outputJsonBytes: bytes(raw) },
      canonicalPolicy: { ...implementation.summarize(samples.canonicalPolicy), rows: current.items.length, outputJsonBytes: bytes(current.items),
        added: current.added, duplicates: current.duplicates, historySkipped: current.historySkipped, limitSkipped: current.limitSkipped }
    });
  }
  report.checksum = checksum;
  console.log(JSON.stringify(report, null, 2));
}
