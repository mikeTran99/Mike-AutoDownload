# Mike-AutomationAI

Mike-AutomationAI là Chrome Extension Manifest V3 giúp tải hàng loạt video từ Facebook, TikTok, Instagram, Douyin qua SO9 Downloader, quét kênh Facebook/TikTok và tải các video trực tiếp hợp lệ mà người dùng có quyền truy cập.

## Tài liệu sử dụng

- Hướng dẫn chi tiết: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Bản PDF: [output/pdf/Mike-AutomationAI-Huong-dan-su-dung.pdf](output/pdf/Mike-AutomationAI-Huong-dan-su-dung.pdf)

## Tính năng chính

- Đọc link từ file `.txt`, `.csv` hoặc ô dán link thủ công.
- Tự phân loại Facebook, TikTok, Instagram, Douyin và mở đúng trang SO9 Downloader.
- Quét Facebook Reels và TikTok profile, lọc theo số view tối thiểu, lưu danh sách đã quét và đưa vào queue tải.
- Hỗ trợ Telegram Web cho video mà Chrome user hiện tại đã đăng nhập và có quyền xem.
- Tải trực tiếp link video công khai `.mp4`, `.m4v`, `.mov`, `.webm`.
- Quét trang media đã được cấp quyền để tìm URL video trực tiếp công khai.
- Quản lý queue, tạm dừng/tiếp tục/dừng, xuất log và lưu file vào thư mục con trong Downloads.

## Cài đặt nhanh

1. Tải hoặc clone repo này về máy.
2. Mở Chrome và vào `chrome://extensions`.
3. Bật `Developer mode`.
4. Bấm `Load unpacked`.
5. Chọn thư mục chứa file `manifest.json`.
6. Ghim icon `Mike-AutomationAI` trên thanh công cụ Chrome.

Chrome không cho extension ghi vào một folder tùy ý ngoài Downloads. Hãy nhập thư mục con, ví dụ `SO9-Downloads`; file sẽ nằm trong `Downloads/SO9-Downloads`.

## Giới hạn an toàn

Extension chỉ hỗ trợ nội dung công khai, direct video URL, hoặc nội dung mà tài khoản Chrome hiện tại được phép xem. Dự án không bypass DRM, paywall, login, blob stream, HLS/DASH segment stitching, hạn chế Telegram, quyền riêng tư, hoặc nội dung bạn không có quyền tải.

## Kiểm tra kỹ thuật

Sau khi sửa code, chạy:

```powershell
node --check popup.js
node --check service-worker.js
node --check content-script.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

Nếu sửa `manifest.json`, icon, hoặc `service-worker.js`, hãy reload lại unpacked extension trong `chrome://extensions`.
