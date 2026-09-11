<p align="center"><img src="docs/logo.png" alt="Mike-Autodownload" width="160"></p>

# Mike-Autodownload

Mike-Autodownload là Chrome Extension Manifest V3 giúp tải hàng loạt video từ Facebook, TikTok, Instagram, Douyin qua SO9 Downloader, quét profile/kênh công khai đa nền tảng và tải các video trực tiếp hợp lệ mà người dùng có quyền truy cập.

## Tài liệu sử dụng

- Hướng dẫn chi tiết: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Bản PDF: [output/pdf/Mike-Autodownload-Huong-dan-su-dung.pdf](output/pdf/Mike-Autodownload-Huong-dan-su-dung.pdf)
- Chính sách quyền riêng tư: [PRIVACY.md](PRIVACY.md)

## Tính năng chính

- Đọc link từ file `.txt`, `.csv` hoặc ô dán link thủ công.
- Ô Số lượng quét kênh không còn chặn 500: nhập số nguyên dương hoặc để trống để lấy toàn bộ link trang tải được. Instagram hỗ trợ cả `/p/mã/` và `/tên_tài_khoản/p/mã/`.
- Tự phân loại Facebook, TikTok, Instagram, Douyin và tải theo chuỗi dự phòng: đọc URL video ngay trên trang gốc (phiên Chrome đang đăng nhập) → SO9 Downloader → site dự phòng (snaptik.app, ssstik.io, snapsave.app, snapinsta.app, snapdouyin.app). Nguồn nào lỗi tự chuyển nguồn kế tiếp.
- Quét Facebook Reels, TikTok profile, Instagram profile và Douyin profile, lọc theo số view tối thiểu, hỗ trợ để trống số lượng để lấy toàn bộ video tìm thấy, lưu danh sách đã quét và đưa vào queue tải.
- YouTube: đọc bản progressive 360p/720p có tiếng từ trang gốc, dự phòng savefrom.net (giới hạn của trình duyệt: không ghép luồng 1080p). Bilibili: qua snapany.com.
- Thống kê kênh sau mỗi lần quét: follower/subscriber, số video, tổng view, view trung bình, top 5 video theo view, so sánh với lần quét trước; xuất CSV.
- Giao diện song ngữ Việt/Anh, đổi bằng nút EN/VI trên Side Panel và trang Cài đặt.
- Hỗ trợ Telegram Web cho video mà Chrome user hiện tại đã đăng nhập và có quyền xem.
- Tải trực tiếp link video công khai `.mp4`, `.m4v`, `.mov`, `.webm`.
- Quét trang media đã được cấp quyền để tìm URL video trực tiếp công khai.
- Quản lý hàng đợi cho lô lớn: nạp thêm nhiều đợt không trùng, lọc theo trạng thái, bỏ từng link, dọn link đã xong, chỉ vẽ 150 mục mỗi lần; tạm dừng/tiếp tục/dừng, xuất log, lưu file vào thư mục con trong Downloads.
- Nút Liên hệ (✉) mở Facebook, Gmail và mã QR Telegram của tác giả.
- Lưu trạng thái job bền vững và phục hồi an toàn khi service worker của MV3 được Chrome tạm dừng.

## Cài đặt nhanh

1. Tải hoặc clone repo này về máy.
2. Mở Chrome và vào `chrome://extensions`.
3. Bật `Developer mode`.
4. Bấm `Load unpacked`.
5. Chọn thư mục chứa file `manifest.json`.
6. Ghim icon `Mike-Autodownload` trên thanh công cụ Chrome.

Extension yêu cầu Chrome 114 trở lên vì sử dụng Side Panel API. Sau khi sửa `manifest.json`, hãy reload unpacked extension trong `chrome://extensions`.

Chrome không cho extension ghi vào một folder tùy ý ngoài Downloads. Hãy nhập thư mục con, ví dụ `SO9-Downloads`; file sẽ nằm trong `Downloads/SO9-Downloads`. Trang media quét trực tiếp chỉ hỗ trợ HTTPS; link file video HTTP do người dùng nhập trực tiếp vẫn được phân loại riêng và có thể bị máy chủ từ chối.

## Giới hạn an toàn

Không cam kết tương thích mọi website hoặc mọi trình duyệt. Bản này nhắm Chrome desktop 114+; trình duyệt Chromium khác cần kiểm tra hỗ trợ Side Panel và API extension. Không hỗ trợ Firefox/Safari/mobile trong bản build này. Nguồn ký hạn, phụ thuộc header, tách riêng audio/video hoặc chống tải có thể không tải được; tiện ích không ghép track hay giả lập quyền truy cập.

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
