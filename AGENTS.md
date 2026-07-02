# Mike-AutomationAI Project Rules

## Project Context
- This repository is a Chrome Manifest V3 extension named `Mike-AutomationAI`.
- The extension batch-downloads Facebook, TikTok, Instagram, and Douyin video links through SO9 Downloader pages.
- The current working directory is `D:\autodowload`.
- The current logo source is `E:\3_JOBS\MechaMike.jpg`; extension icons are generated under `icons/mike-16.png`, `icons/mike-32.png`, `icons/mike-48.png`, and `icons/mike-128.png`.

## Current Known Good State
- On 2026-05-10 Asia/Saigon, the user confirmed the tool is working smoothly after the logo and SO9 automation fixes.
- Keep the extension name as `Mike-AutomationAI`.
- Do not restore any legacy branding from the pre-`Mike-AutomationAI` build.
- Keep the current SO9 automation architecture:
  - `content-script.js` prepares the SO9 page and returns a download candidate.
  - `service-worker.js` prefers `chrome.downloads.download` for direct URLs.
  - Fallback SO9 final-button click is only used after download listeners are armed.
- Direct-media support is limited to public/direct video URLs or page-exposed direct video URLs for content the user is allowed to download.
- Do not add DRM, paywall, login, blob-stream, HLS/DASH segment stitching, or copyright/adult-site bypass behavior.
- Telegram support is limited to Telegram Web content the current Chrome user is already logged in and authorized to view. Do not add account bypass, encryption bypass, private data extraction, or behavior that circumvents Telegram permissions/restrictions.

## Verification Notes
- Static checks to run after edits:
  - `node --check popup.js`
  - `node --check service-worker.js`
  - `node --check content-script.js`
  - `node --check options.js`
  - parse `manifest.json`
  - run the legacy-branding `rg` check against runtime/docs files, excluding project rule/history files to avoid false positives.
- Chrome automation cannot open `chrome://extensions/` in this environment because browser policy blocks it. Ask the user to reload the unpacked extension manually when manifest, icon, or service worker changes require a reload.
- For live verification, test one public TikTok URL and confirm the popup queue ends in `Thanh cong`, without manual input or manual click on SO9.

## Change Discipline
- Keep changes scoped to the requested extension behavior.
- Do not replace the MV3 extension with a framework app unless explicitly requested.
- Preserve Vietnamese UI copy unless the task asks to rewrite it.
- Use `apply_patch` for tracked file edits.
