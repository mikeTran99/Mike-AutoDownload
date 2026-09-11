# Mike-Autodownload Project Rules

## Project Context
- This repository is a Chrome Manifest V3 extension named `Mike-Autodownload`.
- The extension batch-downloads Facebook, TikTok, Instagram, and Douyin video links through SO9 Downloader pages.
- The current working directory is `D:\autodowload`.
- Layout: runtime lives in `src/` (manifest, background/, content/, popup/, options/, shared/, icons/, assets/, _locales/); docs in `docs/`; tests in `tests/`; tooling in `tools/`.
- Logo artwork: `docs/logo.png` (512px). Extension icons are generated from it under `src/icons/mike-16.png`, `icons/mike-32.png`, `icons/mike-48.png`, and `icons/mike-128.png` (circular mask, transparent corners).

## Current Known Good State
- On 2026-05-10 Asia/Saigon, the user confirmed the tool is working smoothly after the logo and SO9 automation fixes.
- Keep the extension name as `Mike-Autodownload`.
- Do not restore any legacy branding (`Mike-AutomationAI`, `KINGAUTOMATIONAI`, `SO9 Luxury Downloader`).
- Keep the current SO9 automation architecture:
  - `src/content/content-script.js` prepares the downloader page and returns a download candidate.
  - `src/background/service-worker.js` prefers `chrome.downloads.download` for direct URLs.
  - Fallback SO9 final-button click is only used after download listeners are armed.
- Direct-media support is limited to public/direct video URLs or page-exposed direct video URLs for content the user is allowed to download.
- Do not add DRM, paywall, login, blob-stream, HLS/DASH segment stitching, or copyright/adult-site bypass behavior.
- Telegram support is limited to Telegram Web content the current Chrome user is already logged in and authorized to view. Do not add account bypass, encryption bypass, private data extraction, or behavior that circumvents Telegram permissions/restrictions.

## Verification Notes
- Static checks to run after edits: `npm run check` (syntax of every file under `src/` + `node --test tests/`).
- Chrome automation cannot open `chrome://extensions/` in this environment because browser policy blocks it. Ask the user to reload the unpacked extension manually when manifest, icon, or service worker changes require a reload.
- For live verification, test one public TikTok URL and confirm the popup queue ends in `Thanh cong`, without manual input or manual click on SO9.

## Change Discipline
- Keep changes scoped to the requested extension behavior.
- Do not replace the MV3 extension with a framework app unless explicitly requested.
- Preserve Vietnamese UI copy unless the task asks to rewrite it.
- Use `apply_patch` for tracked file edits.
