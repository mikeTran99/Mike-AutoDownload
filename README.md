<p align="center"><img src="docs/logo.png" alt="Mike-Autodownload" width="160"></p>

# Mike-Autodownload

<p align="center">
  <a href="https://github.com/mikeTran99/Mike-AutoDownload/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/mikeTran99/Mike-AutoDownload?label=release&color=1e40af"></a>
  <a href="https://github.com/mikeTran99/Mike-AutoDownload/actions/workflows/checks.yml"><img alt="Checks" src="https://github.com/mikeTran99/Mike-AutoDownload/actions/workflows/checks.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-c9a227"></a>
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white">
</p>

**Tiếng Việt** · [English](#english)


Mike-Autodownload là Chrome Extension Manifest V3 giúp tải hàng loạt media mà trang công khai cung cấp (video, audio, ảnh và phụ đề) từ Facebook, TikTok, Instagram, Douyin qua SO9 Downloader, quét profile/kênh công khai đa nền tảng và tải direct media hợp lệ mà người dùng có quyền truy cập.

## Tài liệu sử dụng

- Hướng dẫn chi tiết: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Bản PDF: [docs/pdf/Mike-Autodownload-Huong-dan-su-dung.pdf](docs/pdf/Mike-Autodownload-Huong-dan-su-dung.pdf)
- Lịch sử thay đổi: [docs/PROJECT_HISTORY.md](docs/PROJECT_HISTORY.md)
- Chính sách quyền riêng tư: [PRIVACY.md](PRIVACY.md)

## Tính năng chính

- Đọc link từ file `.txt`, `.csv` hoặc ô dán link thủ công.
- Ô Số lượng quét kênh không còn chặn 500: nhập số nguyên dương hoặc để trống để lấy toàn bộ link trang tải được. Instagram hỗ trợ cả `/p/mã/` và `/tên_tài_khoản/p/mã/`.
- Tự phân loại Facebook, TikTok, Instagram, Douyin và tải theo chuỗi dự phòng: đọc URL video ngay trên trang gốc (phiên Chrome đang đăng nhập) → SO9 Downloader → site dự phòng (snaptik.app, ssstik.io, snapsave.app, snapinsta.app, snapdouyin.app). Nguồn nào lỗi tự chuyển nguồn kế tiếp.
- Quét Facebook Reels, TikTok profile, Instagram Reels, Douyin profile và kênh YouTube (Videos/Shorts, kèm ngày đăng, subscriber), lọc theo số view tối thiểu, hỗ trợ để trống số lượng để lấy toàn bộ video tìm thấy, lưu danh sách đã quét và đưa vào queue tải.
- YouTube: đọc bản progressive 360p/720p có tiếng từ trang gốc, dự phòng savefrom.net (giới hạn của trình duyệt: không ghép luồng 1080p). Bilibili: qua snapany.com.
- **Dashboard nghiên cứu kênh** (cho reup & phân tích đối thủ): follower, view trung bình/trung vị, tỉ lệ video viral (≥3× trung vị), nhịp đăng video/tuần, thứ & giờ đăng hiệu quả, hashtag dùng nhiều, top 10 video kèm caption/thumbnail/ngày đăng/view mỗi ngày, đánh dấu video MỚI từ lần quét trước và ĐÃ TẢI; sparkline tăng trưởng; bảng so sánh nhiều kênh; nút "Tải top 10 chưa tải", "Quét lại tất cả"; chế độ **Chỉ thống kê** không đưa vào hàng đợi; xuất CSV đầy đủ.
- Lịch sử tải: link đã tải thành công được nhớ, nạp lại sẽ tự đánh dấu "Đã tải trước" để không reup trùng.
- Giao diện song ngữ Việt/Anh, đổi bằng nút EN/VI trên Side Panel và trang Cài đặt.
- Hỗ trợ Telegram Web cho video mà Chrome user hiện tại đã đăng nhập và có quyền xem.
- Tải trực tiếp media công khai (video, audio, ảnh, phụ đề) khi URL và metadata cung cấp đủ bằng chứng loại tệp.
- Quét trang media đã được cấp quyền để tìm video, audio, ảnh, track phụ đề và metadata trực tiếp; trang mơ hồ hiện danh sách để người dùng chọn.
- Xác minh media theo identity, MIME, extension, byte và URL tải; không nhận HTML, log hoặc playlist giả dạng video.
- Tiến độ tải từng file (%, dung lượng, tốc độ), số link còn lại hiện trên icon Chrome, tuỳ chọn tách thư mục theo kênh, xuất CSV hàng đợi, lọc log theo mức.
- Quản lý hàng đợi cho lô lớn: nạp thêm nhiều đợt không trùng, lọc theo trạng thái, bỏ từng link, dọn link đã xong, chỉ vẽ 150 mục mỗi lần; tạm dừng/tiếp tục/dừng, xuất log, lưu file vào thư mục con trong Downloads.
- Nút Liên hệ (✉) mở Facebook, Gmail và mã QR Telegram của tác giả.
- Lưu trạng thái job bền vững và phục hồi an toàn khi service worker của MV3 được Chrome tạm dừng.

## Cài đặt nhanh

1. Tải bản mới nhất tại [Releases](https://github.com/mikeTran99/Mike-AutoDownload/releases/latest) (file zip) hoặc clone repo này.
2. Mở Chrome và vào `chrome://extensions`.
3. Bật `Developer mode`.
4. Bấm `Load unpacked`.
5. Chọn thư mục `src` (thư mục chứa `manifest.json`).
6. Ghim icon `Mike-Autodownload` trên thanh công cụ Chrome.

Extension yêu cầu Chrome 114 trở lên vì sử dụng Side Panel API. Sau khi sửa `manifest.json`, hãy reload unpacked extension trong `chrome://extensions`.

Chrome không cho extension ghi vào một folder tùy ý ngoài Downloads. Hãy nhập thư mục con, ví dụ `SO9-Downloads`; file sẽ nằm trong `Downloads/SO9-Downloads`. Trang media quét trực tiếp chỉ hỗ trợ HTTPS; link file video HTTP do người dùng nhập trực tiếp vẫn được phân loại riêng và có thể bị máy chủ từ chối.

## Giới hạn an toàn

Không cam kết tương thích mọi website hoặc mọi trình duyệt. Bản này nhắm Chrome desktop 114+; trình duyệt Chromium khác cần kiểm tra hỗ trợ Side Panel và API extension. Không hỗ trợ Firefox/Safari/mobile trong bản build này. Nguồn ký hạn, phụ thuộc header, tách riêng audio/video hoặc chống tải có thể không tải được; tiện ích không ghép track hay giả lập quyền truy cập.

Extension chỉ hỗ trợ nội dung công khai, direct video URL, hoặc nội dung mà tài khoản Chrome hiện tại được phép xem. Dự án không bypass DRM, paywall, login, blob stream, HLS/DASH segment stitching, hạn chế Telegram, quyền riêng tư, hoặc nội dung bạn không có quyền tải.

## Cấu trúc dự án

```
src/                  Extension (Load unpacked chọn thư mục này)
  manifest.json
  background/         service-worker.js — hàng đợi, crawler, chuỗi nguồn tải, thống kê
  content/            content-script.js — thao tác trang downloader (SO9, snaptik, ...)
  popup/              Side Panel (popup.html, popup.js)
  options/            Trang cài đặt
  shared/             i18n.js (VI/EN), analytics.js (phân tích kênh), styles.css
  icons/  assets/  _locales/
docs/                 Hướng dẫn, PDF, kế hoạch, lịch sử
tests/                node --test (hợp đồng MV3, i18n, analytics, thống kê)
tools/                Sinh PDF hướng dẫn
```

## Kiểm tra kỹ thuật

Sau khi sửa code, chạy:

```powershell
npm run check
```

Nếu sửa `src/manifest.json`, icon, hoặc `src/background/service-worker.js`, hãy reload lại unpacked extension trong `chrome://extensions`.

---

## English

**Mike-Autodownload** is a Chrome (Manifest V3) side-panel extension for batch-downloading permitted video, audio, image and subtitle media from Facebook, TikTok, Instagram, Douyin, YouTube (progressive), Bilibili and Telegram Web, plus a channel research dashboard for re-uploaders and competitor analysis.

- **Download chain per platform**: native page JSON → SO9 → fallback sites (snaptik, ssstik, snapsave, snapinsta, snapdouyin, savefrom, snapany). Fails over automatically.
- **Channel crawler**: Facebook Reels, TikTok, Instagram Reels, Douyin, YouTube — with view filter, unlimited mode, per-item progress and a persistent job that survives service-worker restarts.
- **Direct media scan**: user-selected video, audio, image, subtitle and cover assets with canonical history, per-item retry and persistent queue checkpoints.
- **Research dashboard**: followers/subscribers, median & average views, viral outliers (≥3× median), posts per week, best weekday/hour, top hashtags, top 10 with NEW/DONE badges, growth sparklines, multi-channel comparison, stats-only mode, CSV export.
- **Queue for large batches**: append + dedupe, status filters, prune, per-item remove, download history so nothing is re-uploaded twice, optional per-channel subfolders.
- **Bilingual UI** (Vietnamese/English toggle), dark/light theme.

Install: download the zip from [Releases](https://github.com/mikeTran99/Mike-AutoDownload/releases/latest), unzip, open `chrome://extensions` → Developer mode → **Load unpacked** → pick the unzipped folder (or `src/` when cloning). Requires Chrome 114+.

Limits: no DRM/paywall/login bypass, no HLS/DASH stitching (YouTube is capped at the 360p progressive stream), only content the signed-in user may access. Not intended for the Chrome Web Store because of YouTube downloading. License: MIT.
