# Project History

## 2026-05-10
- User confirmed `Mike-AutomationAI` is working smoothly after the latest extension update.
- Logo was updated from `E:\3_JOBS\MechaMike.jpg` into PNG extension icons under `icons/`.
- SO9 automation was refactored to reduce manual work and avoid the previous `USER_CANCELED` failure path:
  - prepare link on SO9 first,
  - prefer direct `chrome.downloads.download`,
  - arm download listeners before fallback clicking SO9 final download controls.
- Keep this state as the baseline for future fixes.

## 2026-05-10 Direct Media Upgrade
- Added a safe direct-media path beside the SO9 flow.
- Direct file links such as `.mp4`, `.m4v`, `.mov`, and `.webm` can be downloaded with Chrome Download API.
- Generic web pages can be scanned only after Chrome grants host permission, and only for public/page-exposed direct video URLs.
- HLS/DASH, blob streams, DRM, paywall/login bypass, and unauthorized adult/copyright-site downloading are intentionally unsupported.

## 2026-05-10 Telegram Web Upgrade
- Deleted old packaged artifacts from `dist/`.
- Added Telegram Web support for authorized private media:
  - accepts `https://web.telegram.org/...` links,
  - converts private `https://t.me/c/<chat>/<message>` links to Telegram Web deep links,
  - opens the Telegram Web video surface and clicks the visible Telegram download/save control when available.
- This does not bypass Telegram login, encryption, chat permissions, disabled downloads/forwarding, or account access controls.

## 2026-05-10 UI/UX Upgrade
- Upgraded the popup and options UI to a premium 3D Luxury (Neumorphism) aesthetic.
- Added a Light/Dark Mode toggle (saved to `chrome.storage.local`).
- Applied a "Royal Blue & Gold" color scheme for buttons, icons, and headings.
- Cleaned up the old packaged artifacts from `dist/`.

## 2026-09-11 Channel Stats Dashboard (v1.6.0)
- After each crawl the worker reads the profile header (followers/likes via `readProfileHeaderInPage`) and aggregates per-channel stats (`recordChannelStats` → `storage.channelStats`, last 50 channels, 30-point history).
- Popup panel "Thống kê kênh": followers, videos, total/avg views, top 5 with bars, delta vs previous crawl, CSV export.

## 2026-09-11 YouTube/Bilibili + Bilingual UI (v1.5.0)
- YouTube route: native progressive formats (itag 18/22) from the watch page, then savefrom.net (hidden `a.link-download` with audio). Bilibili route: snapany.com (direct bilivideo mp4).
- `i18n.js`: Vietnamese→English pattern dictionary applied at render time; EN/VI toggle in popup and options; `_locales` for the short manifest description.
- Shortened manifest description and popup subtitle.

## 2026-09-11 Backend Fallback Chain (v1.4.0)
- Download chain per platform (`BACKENDS` in `service-worker.js`): native page JSON (`browser_native_hd_url`, `playAddr`, `video_url`) → SO9 → alternative downloader sites. Failures fall through to the next source.
- Content script scoring prefers HD/no-watermark links and skips MP3/photo buttons on the alternative sites.

## 2026-09-11 Rebrand to Mike-Autodownload
- Extension renamed from `Mike-AutomationAI` to `Mike-Autodownload` across manifest, UI, docs, PDF, tests and tooling.
- New logo (`docs/logo.png`) → regenerated `icons/mike-*.png` with circular transparent mask; removed unused `icon-128.svg`.
- Removed the media-capture panel and `webRequest` permission.

## 2026-05-12 Channel Crawler Upgrade
- Reintroduced the Version 2 Facebook Reels / TikTok profile crawler into the current Mike-AutomationAI build.
- Added popup controls for channel URL, maximum videos, minimum view filter, saved crawler count, and loading the latest saved crawl.
- Crawler output is stored as normal SO9 queue items and keeps the current direct-download-first SO9 automation path.
