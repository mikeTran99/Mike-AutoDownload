# Kế hoạch cải tiến Mike-Autodownload → v2.0.0 (public release)

> Ghi chú 04/10/2026: tài liệu này giữ lại lịch sử kế hoạch tháng 09. Một số trạng thái hoàn thành và nhận định về repo mẫu chưa khớp implementation đã kiểm tra. Xem [báo cáo rà soát và kế hoạch nâng cấp hiện tại](AUDIT_AND_UPGRADE_PLAN_2026-10-04.md) cùng `tools/audit-current-runtime.mjs` để dùng baseline và bằng chứng mới.

Ngày lập: 2026-09-11. Baseline: commit `0d75983` (v1.2.1) — trùng 100% với repo GitHub `mikeTran99/Mike-AutoDownload`.

## 1. So sánh ba bản

| | Version 2 (`KINGAUTOMATIONAI`) | GitHub v1.2.1 = code hiện tại |
|---|---|---|
| Nguồn tải | SO9 only | SO9 + direct `.mp4/.webm` + media-page scan + Telegram Web |
| Crawler FB Reels / TikTok | Có | Có (đã gộp lại 2026-05-12) |
| UI | Popup + tab ghim (`openPinnedDashboard`) | Side panel, dark/light, neumorphism |
| Icon | 1 SVG | PNG 16/32/48/128 |
| Permissions | cố định | + `sidePanel`, `optional_host_permissions` `*://*/*` |
| Tài liệu | README ngắn, không dấu | README + USER_GUIDE + PDF |
| Kích thước | 2 343 dòng | 3 601 dòng |

Kết luận: V2 là tập con của bản hiện tại. Ý tưởng duy nhất đáng lấy lại: nút **"Mở trong tab"** (tab ghim) cho người không quen side panel.

## 1b. Học gì từ G-Labs Video Downloader (duckmartians)

G-Labs là **app desktop Electron + yt-dlp đóng gói, mã nguồn đóng** (repo chỉ có README + 7 ảnh). Không có code để tham khảo; chỉ học **tính năng và cách trình bày**. Extension chạy trong Chrome nên có lợi thế riêng: dùng sẵn phiên đăng nhập của người dùng (không cần import cookie), không cần engine ngoài.

| Tính năng G-Labs | Làm được trên extension? | Cách làm | Ưu tiên |
|---|---|---|---|
| Xem trước kênh rồi tick chọn video | **Có** | Crawler trả list → bảng có checkbox + view + thumbnail → "Thêm mục đã chọn". Hiện tại crawler đổ thẳng vào queue. | ★★★ |
| Queue song song 1–10 luồng | **Có, giới hạn 1–3** | `runQueue` chạy N `processItem` đồng thời qua N tab nền. SO9 có thể rate-limit → mặc định 1, cho chỉnh trong Options. | ★★★ |
| Chống tải trùng (lịch sử) | **Có** | `downloadHistory` trong storage (link → filename, time). Bỏ qua khi nạp queue, có nút "Tải lại". | ★★★ |
| Retry từng mục / retry all | **Có** | Đã có ở Phase 0. | ★★★ |
| Lọc trạng thái + chọn hàng + "chạy mục chọn" | **Có** | Tabs lọc trên queue list; checkbox mỗi hàng. | ★★ |
| % tiến độ, tốc độ, ETA từng mục | **Có** | `chrome.downloads.search({id})` mỗi 1s khi item đang tải → `bytesReceived/totalBytes`. | ★★ |
| Xuất CSV (UTF-8 BOM) | **Có** | 20 dòng cạnh "Xuất log". | ★★ |
| Lịch sử tải có thể xem/xóa | **Có** | Tab "Lịch sử" trong side panel. | ★★ |
| Đa ngôn ngữ (6) | **VI + EN** | `_locales/` + `chrome.i18n`. | ★ |
| README song ngữ + screenshot | **Có** | `README.md` EN + `README.vi.md`, thư mục `docs/screenshots/`. | ★★★ |
| Engine tự cập nhật | **Không** (không nạp code từ xa — vi phạm CWS) | Thay bằng: selector SO9 gom một chỗ + nút "Kiểm tra SO9" + thông báo lỗi cụ thể. Tuỳ chọn: backend dự phòng thứ 2 khi SO9 lỗi. | ★★ |
| Cookies theo nền tảng | **Không cần** | Extension dùng sẵn session Chrome. | — |
| Proxy pool | **Không** | Ngoài phạm vi extension. | — |
| YouTube + 1.800 site | **Không** | SO9 chỉ có 4 trang (`/youtube`, `/twitter` đều 404). Giữ đúng 4 nền tảng + Telegram + direct URL, nói rõ trong README. | — |
| MP3 / chọn độ phân giải | **Chỉ nếu SO9 hiển thị** | Content-script đọc tất cả nút tải trên SO9 (HD/SD/MP3) → chọn theo Options. | ★ |

**Thương hiệu**: giữ nguyên `Mike-Autodownload`, icon MechaMike, tông Royal Blue & Gold, side panel. Không dùng tên/ảnh/bố cục G-Labs; chỉ lấy ý tưởng tính năng.

## 2. Lỗi thật tìm thấy trong code (ưu tiên sửa trước khi public)

| # | Vấn đề | Vị trí | Hậu quả |
|---|---|---|---|
| B1 | **Deadlock `runState`**: `runLock` nằm trong RAM service worker, `runState.running` nằm trong storage. SW bị Chrome kill (idle 30s, crash, reload) → storage kẹt `running:true`, popup khóa nút Start, nút "Xóa dữ liệu" cũng bị chặn khi `running`. | `service-worker.js:1`, `popup.js:init`, `clearAllData` | Người dùng phải gỡ/cài lại extension |
| B2 | **SW chết khi Pause**: `while (paused) await sleep(600)` chỉ dùng `setTimeout`, không gọi API Chrome → sau 30s SW bị kill, mất toàn bộ tiến trình. | `service-worker.js:runQueue` | Pause > 30s = mất queue đang chạy |
| B3 | Không có `chrome.runtime.onStartup`/`onInstalled` reset state. | `service-worker.js` | Kết hợp B1 |
| B4 | Code trùng lặp giữa popup và SW: `normalizeFacebookChannelUrl`, `normalizeTikTokChannelUrl`, `normalizeMinViews`, `formatNumber`, `sanitizeFolder`/`normalizeFolder`. Sửa một nơi quên nơi kia. | `popup.js`, `service-worker.js`, `options.js` | Bug lệch hành vi |
| B5 | Không có retry cho item failed; không có nút "Chạy lại link lỗi". | `runQueue` | Phải nạp lại file |
| B6 | `AGENTS.md` lộ đường dẫn máy cá nhân (`D:\autodowload`, `E:\3_JOBS\MechaMike.jpg`). | `AGENTS.md` | Không chuyên nghiệp khi public |
| B7 | Binary PDF nằm trong repo (`output/pdf/`), `icon-128.svg` không dùng. | root | Repo nặng, rác |
| B8 | Inline `style="..."` trong HTML, hardcode tiếng Việt toàn bộ. | `popup.html`, `options.html` | Khó i18n |
| B9 | Không lint, không test, không CI, không LICENSE, không CHANGELOG, không release zip. | root | Không đạt chuẩn open-source |
| B10 | Phụ thuộc 100% vào DOM `so9.vn` (selector). SO9 đổi giao diện = chết toàn bộ FB/TikTok/IG/Douyin, log chỉ báo timeout chung chung. | `content-script.js` | Khó chẩn đoán |

## 3. Kế hoạch theo phase

### Phase 0 — Sửa lỗi nền tảng (bắt buộc, ~1 ngày)

- [x] **B1/B2/B3**: bản `main` đã có job state bền vững + `alarms` resume (phiên trước) — thay thế hoàn toàn fix keepalive/GET_STATE của worktree. (2026-09-11)
- [x] **B5**: Phát hiện `runQueue` đã tự chạy lại item `failed` khi bấm Start → không thêm nút; log báo số link lỗi sẽ thử lại. (2026-09-11)
- [x] **B10 một phần — chuỗi nguồn dự phòng**: `BACKENDS` = native (JSON trong trang gốc) → SO9 → snaptik/ssstik/snapsave/snapinsta/snapdouyin. (2026-09-11)

### Phase 1 — Dọn cấu trúc, không đổi hành vi (~1 ngày)

- [ ] **B4**: Tạo `shared/url.js` (ES module) chứa route detection + normalize + format. SW đã là `"type": "module"`; đổi `popup.html`/`options.html` sang `<script type="module">`. Xóa bản trùng.
- [ ] **B10**: Tách `content-script.js` thành adapter SO9 có `detectPageError()` trả thông báo cụ thể ("SO9 đổi giao diện — không tìm thấy ô nhập link") thay vì timeout chung. Giữ selector ở một chỗ `SO9_SELECTORS`.
- [ ] **B8**: Chuyển inline style vào `styles.css`.
- [ ] Nút "Mở trong tab" (lấy `openPinnedDashboard` từ V2, ~10 dòng).

### Phase 2 — Chuẩn open-source (~1 ngày)

- [x] `LICENSE` (MIT). (2026-09-12) — CHANGELOG = `docs/PROJECT_HISTORY.md`; CONTRIBUTING/SECURITY thêm khi có người đóng góp.
- [x] `.github/workflows/checks.yml` (npm run check). (2026-09-11)
- [ ] ~~`.github/workflows/ci.yml`:~~ `node --check` 4 file + parse manifest + ESLint (`eslint:recommended`, env webextensions). Nhẹ, không cần `npm install` nặng.
- [x] `.github/workflows/release.yml`: tag `v*` (2026-09-12) → zip đúng file runtime (loại `docs/`, `tools/`, `.github/`, `AGENTS.md`) → GitHub Release. Chuẩn release (G-Labs chỉ có asset, body trống — ta làm đủ):
  - Asset: `Mike-Autodownload-v2.0.0.zip` (~100 KB, không `.crx` vì Chrome chặn cài ngoài CWS) + `Huong-dan-su-dung.pdf`.
  - Body sinh từ mục tương ứng trong `CHANGELOG.md` + 5 bước "Load unpacked" + ảnh side panel.
  - Tên release: `Mike-Autodownload v2.0.0` (không dùng kiểu "Download Here").
  - README mục **Cài đặt** trỏ thẳng tới `/releases/latest`, kèm badge version.
- [ ] `package.json` tối thiểu chỉ để chạy ESLint + script `zip`. Không bundler.
- [ ] **B7**: Xóa `output/pdf/` khỏi git (đính vào Release asset), xóa `icon-128.svg`. Thêm `output/` vào `.gitignore`.
- [ ] **B6**: Viết lại `AGENTS.md` → `CLAUDE.md`/`AGENTS.md` không chứa đường dẫn cá nhân; chuyển `PROJECT_HISTORY.md` vào `CHANGELOG.md`.
- [x] README song ngữ + badge. (2026-09-12) — [ ] ảnh screenshot side panel (bạn chụp từ Chrome thật).
- [x] Bump `2.0.0`. (2026-09-12)

### Phase 3 — "Mạnh mẽ" (học từ G-Labs, ~3 ngày) → v2.1.0

Thứ tự theo giá trị/công sức:

- [~] **Xem trước kênh** = dashboard top 10 + "Tải top 10 chưa tải" (2026-09-11); tick chọn từng video: chưa. `CRAWL_CHANNEL_VIDEOS` trả `items` → panel "Kết quả quét" (checkbox, view, link rút gọn, chọn tất cả / lọc view) → "Thêm vào danh sách". Bỏ hành vi tự đổ vào queue.
- [x] **Lịch sử + chống trùng** (2026-09-11): `downloadHistory[link] = {filename, time, platform}` ghi khi success; khi nạp queue đánh dấu `status: "skipped"` kèm nút "Tải lại"; tab Lịch sử có xoá.
- [ ] **Queue song song**: Options `concurrency` 1–3; `runQueue` dùng pool N worker, mỗi worker giữ tab riêng (`activeTabIds: Set`). Stop huỷ tất cả.
- [x] **Tiến độ từng mục** (2026-09-12): trong `waitForDownloadId` poll `chrome.downloads.search` 1s/lần → `updateItem({progress, bytes, speed})`; popup vẽ thanh %.
- [x] Lọc trạng thái + Xuất CSV queue (2026-09-12); chọn hàng/chạy mục chọn: chưa.
- [x] **Kiểm tra nguồn tải** trong Options (2026-09-12): mở 4 trang SO9 nền, chạy `detectPageError` + tìm ô nhập → báo trang nào hỏng. Thay cho "engine tự cập nhật".
- [ ] `test/url.test.js` bằng `node --test` cho `shared/url.js`. Không framework.

### Phase 4 — Tùy chọn (chỉ khi có nhu cầu)

- [ ] i18n `_locales/vi`, `_locales/en` qua `chrome.i18n`.
- [ ] Chọn chất lượng (HD/SD/MP3) nếu SO9 hiển thị nhiều nút.
- [ ] Options: cho người dùng sắp xếp/tắt từng nguồn trong `BACKENDS`.

## Site downloader thay thế SO9 (khảo sát 2026-09-11)

| Site | Nền tảng | Trạng thái | Dùng |
|---|---|---|---|
| snaptik.app | TikTok | sống, có ô `name=url`, không captcha | ✔ |
| ssstik.io | TikTok | sống, không captcha | ✔ |
| musicaldown.com, savett.cc, tikdown.org | TikTok | sống, không captcha | dự bị |
| snapsave.app | Facebook | sống, không captcha | ✔ |
| snapinsta.app | Instagram | curl bị chặn, trình duyệt thật vào được | ✔ (thử) |
| snapdouyin.app | Douyin | sống, không captcha | ✔ |
| savefrom.net, x2download.app | đa nền tảng | sống | dự bị |
| fdown.net, fdownloader.net, igram.world, sssinstagram.com, fastdl.app, taivideo.net, snaptik.vn | — | Cloudflare Turnstile / reCAPTCHA | ✘ |
- [ ] Chrome Web Store: privacy policy page (GitHub Pages), screenshot 1280×800, mô tả.

## 4. Skill tham khảo áp dụng ở đâu

| Skill / repo | Dùng cho |
|---|---|
| `ponytail` (DietrichGebert) | Toàn bộ: không bundler, không framework, không dependency ngoài ESLint |
| `mattpocock/skills` → `codebase-design` | Phase 1: tách `shared/url.js`, adapter SO9 |
| `mattpocock/skills` → `code-review`, `diagnosing-bugs` | Review PR Phase 0 (B1, B2 là bug lifecycle MV3) |
| `mattpocock/skills` → `tdd` | Phase 3: `node --test` cho `shared/url.js` |
| `wdm0006/python-skills` → `keeping-git-repos-clean`, `running-github-actions-efficiently`, `managing-releases` | Phase 2: `.gitignore`, CI nhẹ, release theo tag |
| `usestrix/strix` → `find-security-vulnerabilities-in-code` | Trước public: rà `executeScript`, `innerHTML`, `optional_host_permissions` |
| `Graphify-Labs/graphify` | `/graphify` sau Phase 1 để sinh sơ đồ kiến trúc cho README |
| `microsoft/markitdown` | Chuyển USER_GUIDE ↔ PDF/HTML nếu bỏ script Python `tools/generate_user_guide_pdf.py` |
| `system_prompts_leaks`, `x1xhlol` | Chỉ tham khảo cách viết `AGENTS.md` súc tích, có "known good state" |

## 5. Checklist trước khi push public

- [ ] `git grep -n "D:\\\\\|E:\\\\\|Users\\\\"` không còn kết quả
- [ ] Load unpacked, chạy 1 link TikTok công khai → `Thành công` không cần thao tác tay
- [ ] Pause 60s rồi Resume → tiến trình còn sống (kiểm B2)
- [ ] Reload extension giữa chừng → mở lại popup, nút Start không bị khóa (kiểm B1)
- [ ] CI xanh, Release zip cài được
