import { readFile } from "node:fs/promises";
import vm from "node:vm";

function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => { for (const fn of listeners) fn(...args); },
    get size() { return listeners.size; }
  };
}

export async function runtime(initial = {}) {
  const store = structuredClone(initial);
  const closedTabs = [];
  const downloads = [];
  const chrome = {
    runtime: { id: "fixture", lastError: null, onMessage: event(), onStartup: event(),
      onInstalled: event(), sendMessage: async () => {}, getURL: (p) => "chrome-extension://fixture/" + p },
    storage: { local: {
      get: async (keys) => structuredClone(Object.fromEntries(keys.map((key) => [key, store[key]]))),
      set: async (patch) => Object.assign(store, structuredClone(patch)),
      remove: async (keys) => { for (const key of keys) delete store[key]; }
    } },
    alarms: { onAlarm: event(), create: async () => {}, clear: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    notifications: { create: async () => {} },
    permissions: { contains: async () => true },
    downloads: {
      onCreated: event(), onChanged: event(), onDeterminingFilename: event(),
      search: (query, callback) => callback(downloads.filter((item) => !query.id || item.id === query.id)),
      cancel: (id, callback) => callback(),
      download: (options, callback) => {
        const id = downloads.length + 1;
        downloads.push({ id, ...options, finalUrl: options.url, state: "complete", mime: "video/mp4", fileSize: 100 });
        callback(id);
      }
    },
    tabs: { create: async ({ url }) => ({ id: 7, url }), get: async () => ({ url: "https://example.org/page" }),
      remove: async (id) => { closedTabs.push(id); } },
    scripting: { executeScript: async () => [{ result: { items: [] } }] }
  };
  const sandbox = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, TextEncoder,
    crypto: { randomUUID: () => crypto.randomUUID() },
    t: (v) => v, channelFolderName: () => "fixture",
    document: { title: "Fixture", scripts: [], querySelectorAll: () => [], querySelector: () => null },
    location: { href: "https://example.org/page", hostname: "example.org" },
    performance: { getEntriesByType: () => [] },
    fetch: async () => ({ ok: true, status: 200, text: async () => "<html></html>" })
  });
  for (const name of ["media-policy", "media-scanner"]) {
    try {
      const source = await readFile(new URL("../../src/shared/" + name + ".js", import.meta.url), "utf8");
      const exports = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
      Object.assign(sandbox, exports);
      if (exports.collectPageMedia) {
        sandbox.collectPageMedia = vm.runInContext("(" + exports.collectPageMedia.toString() + ")", sandbox);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let source = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  source = source.replace(/^import .*;\r?\n/gm, "")
    .replace("const workerReady = initializeWorkerState();", "const workerReady = Promise.resolve();")
    .replace(/^workerReady\.then\(\(\) => resumePersistedJob[^\n]+\r?\n/m, "");
  vm.runInContext(source, sandbox);
  return { sandbox, store, closedTabs, chrome, downloads,
    evaluate: (code) => vm.runInContext(code, sandbox),
    json: (code) => JSON.parse(vm.runInContext("JSON.stringify(" + code + ")", sandbox)) };
}
