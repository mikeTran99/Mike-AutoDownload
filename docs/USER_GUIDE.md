# Hướng Dẫn Sử Dụng Mike-AutomationAI

Phiên bản tài liệu: 1.0

Ngày cập nhật: 2026-07-02

Áp dụng cho extension: Mike-AutomationAI 1.2.0

## 1. Tổng quan

Mike-AutomationAI là Chrome Extension Manifest V3 dùng để tải hàng loạt video theo danh sách link. Extension tự nhận diện nền tảng, đưa link Facebook/TikTok/Instagram/Douyin vào SO9 Downloader, ưu tiên tải bằng Chrome Download API khi SO9 trả về URL trực tiếp, và chỉ dùng thao tác click nút tải cuối của SO9 khi các listener tải file đã được gắn sẵn.

Extension phù hợp cho các tác vụ:

- Tải hàng loạt link Facebook, TikTok, Instagram, Douyin qua SO9.
- Quét kênh Facebook Reels hoặc TikTok profile, lọc theo view tối thiểu, rồi tự động đưa link hợp lệ vào danh sách tải.
- Tải video Telegram Web mà tài khoản Chrome hiện tại đã đăng nhập và có quyền xem.
- Tải link video công khai dạng `.mp4`, `.m4v`, `.mov`, `.webm`.
- Quét một trang media công khai để tìm URL video trực tiếp, sau khi bạn cấp quyền cho Chrome.

## 2. Nguyên tắc sử dụng có trách nhiệm

Bạn chỉ nên tải nội dung mà bạn sở hữu, được chủ sở hữu cho phép, hoặc được phép tải theo điều khoản của nền tảng. Mike-AutomationAI không được thiết kế để vượt qua bảo vệ nội dung.

Extension không hỗ trợ và không có ý định hỗ trợ:

- Bypass DRM, paywall, đăng nhập, captcha, checkpoint, quyền riêng tư, mã hóa, hoặc giới hạn tải/forward.
- Ghép HLS/DASH segment, tải blob stream, tách stream bị bảo vệ, hoặc lấy nội dung từ tài khoản không có quyền truy cập.
- Tự động tải nội dung adult/restricted hoặc nội dung có dấu hiệu vi phạm bản quyền.

## 3. Yêu cầu trước khi dùng

- Trình duyệt Chrome hoặc trình duyệt Chromium có hỗ trợ extension Manifest V3.
- Kết nối internet ổn định.
- Thư mục dự án chứa file `manifest.json`.
- SO9 Downloader truy cập được tại `https://so9.vn/9downloader/...`.
- Với Facebook/TikTok crawler: Chrome nên đăng nhập tài khoản có quyền xem kênh cần quét nếu kênh không hoàn toàn công khai.
- Với Telegram Web: Chrome phải đăng nhập Telegram Web và tài khoản phải có quyền xem video.

## 4. Cài đặt extension

1. Tải source code Mike-AutomationAI về máy, hoặc clone từ GitHub.
2. Giải nén nếu bạn tải file ZIP.
3. Mở Chrome.
4. Vào `chrome://extensions`.
5. Bật công tắc `Developer mode`.
6. Bấm `Load unpacked`.
7. Chọn đúng thư mục chứa file `manifest.json`.
8. Kiểm tra extension hiện tên `Mike-AutomationAI`.
9. Ghim icon extension trên thanh công cụ Chrome để mở nhanh popup.

Nếu bạn cập nhật source code, hãy quay lại `chrome://extensions` và bấm nút reload của extension. Việc reload đặc biệt cần thiết khi thay đổi `manifest.json`, icon, hoặc `service-worker.js`.

## 5. Cấu hình Chrome nên dùng

Để automation chạy mượt hơn:

- Vào Chrome Settings > Downloads.
- Tắt tùy chọn hỏi nơi lưu từng file nếu Chrome đang bật cấu hình này.
- Để Chrome lưu file vào thư mục Downloads mặc định.
- Không đóng tab SO9, Telegram Web, Facebook, TikTok khi automation đang chạy.
- Khi Chrome hỏi quyền đọc một website cho link ngoài SO9, chỉ bấm cho phép nếu bạn tin tưởng trang và có quyền tải nội dung đó.

## 6. Giao diện popup

Popup gồm các vùng chính:

- `Quét kênh video`: nhập link Facebook/TikTok, số lượng video cần quét, view tối thiểu, nút quét và nút tải lại link đã quét.
- `Tải link lên`: chọn file `.txt`/`.csv` hoặc dán link thủ công.
- `Thư mục tải về`: nhập thư mục con trong Downloads, ví dụ `SO9-Downloads`.
- `Chỉ số`: tổng link, số link thành công, số link thất bại/không hỗ trợ.
- `Nút điều khiển`: `Chạy automation`, `Tạm dừng`, `Tiếp tục`, `Dừng`.
- `Danh sách link`: hiện từng link, nền tảng, view nếu có, trạng thái và thông điệp chi tiết.
- `Log trạng thái`: hiện các bước đang chạy, lỗi nếu có, và nút `Xuất log`.
- Nút đổi giao diện sang chế độ sáng/tối được lưu trong Chrome local storage.

## 7. Trang cài đặt

Mở trang Options của extension để cấu hình:

- `Thời gian đợi mỗi link`: số giây tối đa đợi mỗi link, từ 20 đến 300 giây. Mặc định là 90 giây.
- `Thư mục con trong Downloads`: thư mục mặc định extension sẽ lưu file vào.

Thư mục sẽ được làm sạch ký tự không hợp lệ. Ví dụ `SO9:Downloads` sẽ được đổi thành `SO9-Downloads`.

## 8. Chuẩn bị file link

Extension có thể đọc URL từ file `.txt`, `.csv`, hoặc file văn bản có chứa URL. Bạn có thể mỗi dòng một link, hoặc đặt URL trong cột CSV. Extension sẽ tự trích xuất các chuỗi bắt đầu bằng `http://` hoặc `https://`, đồng thời loại link trùng lặp.

Ví dụ nội dung file:

```text
https://www.tiktok.com/@example/video/1234567890
https://www.facebook.com/reel/1234567890
https://www.instagram.com/reel/example/
https://www.douyin.com/video/1234567890
https://example.com/video.mp4
```

Nên tránh để chú thích dính liền vào cuối URL. Nếu cần ghi chú, hãy để cách link bằng khoảng trắng hoặc xuống dòng riêng.

## 9. Tải hàng loạt bằng file

1. Bấm icon `Mike-AutomationAI`.
2. Trong vùng `Tải link lên`, bấm khu `Tải file link`.
3. Chọn file `.txt` hoặc `.csv`.
4. Kiểm tra `Tổng link` và `Danh sách link`.
5. Nhập thư mục tải về, ví dụ `SO9-Downloads`.
6. Bấm `Chạy automation`.
7. Theo dõi `Log trạng thái` và cột trạng thái của từng link.
8. Khi xong, mở `Downloads/SO9-Downloads` để kiểm tra file.

Với Facebook, TikTok, Instagram và Douyin, extension sẽ mở SO9 tương ứng ở nền. Với link video trực tiếp, extension tải bằng Chrome Download API. Với trang media ngoài SO9, Chrome có thể hỏi quyền đọc website trước khi quét video.

## 10. Tải bằng cách dán link thủ công

1. Mở popup extension.
2. Dán danh sách link vào ô `Dán link vào đây, mỗi dòng một link`.
3. Bấm `Nạp link`.
4. Kiểm tra queue.
5. Bấm `Chạy automation`.

Cách này phù hợp khi bạn chỉ có vài link hoặc muốn test nhanh một link public.

## 11. Quét kênh Facebook Reels

1. Dán link page/profile Facebook vào ô `Link kênh Facebook / TikTok`.
2. Extension sẽ tự chuẩn hóa đường dẫn sang khu Reels nếu hợp lệ.
3. Nhập `Số lượng`, từ 1 đến 500.
4. Nhập `View tối thiểu` nếu muốn lọc, ví dụ `10000`.
5. Bấm `Quét link video`.
6. Extension mở Facebook, cuộn trang, thu thập Reels, bỏ qua link trùng lặp và video dưới ngưỡng view.
7. Link hợp lệ được lưu local, đưa vào queue và chạy tải qua SO9.

Nếu Facebook yêu cầu đăng nhập, checkpoint, hoặc chặn cuộn trang, hãy xử lý yêu cầu đó trong Chrome rồi chạy lại.

## 12. Quét kênh TikTok profile

1. Dán link profile TikTok, ví dụ `https://www.tiktok.com/@example`.
2. Nhập số lượng video cần quét.
3. Nhập view tối thiểu nếu cần.
4. Bấm `Quét link video`.
5. Extension mở profile, cuộn trang, đọc link video, đọc view nếu TikTok render được, và đưa link hợp lệ vào queue tải.

Nếu TikTok hiện captcha, yêu cầu xác minh, hoặc không render view, kết quả có thể thiếu link hoặc hiện cảnh báo trong log. Hãy đăng nhập/hoàn thành xác minh trên Chrome trước khi quét lại.

## 13. Tải lại link đã quét

Nút `Tải link đã quét` nạp lại danh sách Facebook/TikTok gần nhất đã lưu trong `chrome.storage.local`, đưa link vào queue và bắt đầu tải. Nút này hữu ích khi lần tải trước bị dừng giữa chừng hoặc bạn muốn tải lại danh sách vừa quét.

## 14. Telegram Web

Telegram được hỗ trợ trong phạm vi nội dung mà tài khoản Chrome hiện tại có quyền xem.

Các link hợp lệ:

- Link `https://web.telegram.org/...` đang mở đúng tin nhắn/video.
- Private link dạng `https://t.me/c/<chat>/<message>`. Extension sẽ chuyển sang deep link Telegram Web.

Cách dùng:

1. Đăng nhập Telegram Web trong Chrome.
2. Đảm bảo tin nhắn video nằm trong chat/channel mà bạn có quyền xem.
3. Dán link Telegram vào popup hoặc đưa vào file link.
4. Khi Chrome hỏi quyền đọc `web.telegram.org`, bấm cho phép nếu bạn đồng ý.
5. Extension mở Telegram Web, tìm video/nút tải lưu hiện có, và click nút tải nếu Telegram cung cấp.

Nếu Telegram không có nút tải/lưu, video bị giới hạn forward/download, hoặc Telegram render bằng cơ chế không expose video source, extension sẽ báo thất bại. Đây là giới hạn có chủ đích, không phải lỗi cần bypass.

## 15. Link video trực tiếp và trang media công khai

Link kết thúc bằng `.mp4`, `.m4v`, `.mov`, `.webm` sẽ được tải trực tiếp nếu server cho phép.

Với một trang web bất kỳ có chứa video công khai:

1. Dán URL trang vào queue.
2. Chrome sẽ hỏi quyền đọc trang đó.
3. Nếu bạn có quyền tải nội dung, bấm cho phép.
4. Extension quét thẻ `video`, `source`, link tải trực tiếp và resource đã tải trong trang.
5. Nếu tìm thấy URL video trực tiếp, extension tải bằng Chrome Download API.

Extension không ghép HLS/DASH playlist (`.m3u8`, `.mpd`) và không tải blob stream.

## 16. Ý nghĩa trạng thái

| Trạng thái | Ý nghĩa |
| --- | --- |
| `Chờ tải` | Link hợp lệ và đang chờ đến lượt xử lý. |
| `Đang tải` | Extension đang mở SO9/trang nguồn hoặc đang đợi Chrome tải file. |
| `Thành công` | Chrome đã hoàn tất file tải về. |
| `Thất bại` | Link đã thử xử lý nhưng gặp lỗi. Xem thông điệp và log. |
| `Không hỗ trợ` | Domain/loại link nằm ngoài phạm vi an toàn của extension. |

Badge trên đầu popup:

- `Sẵn sàng`: không có tiến trình đang chạy.
- `Đang chạy`: queue đang được xử lý.
- `Tạm dừng`: tiến trình đang được giữ lại và có thể tiếp tục.

## 17. Điều khiển tiến trình

- `Chạy automation`: bắt đầu xử lý các link `Chờ tải` hoặc `Thất bại`.
- `Tạm dừng`: tạm dừng trước link tiếp theo. Link đang xử lý có thể cần đợi hoàn tất hoặc timeout.
- `Tiếp tục`: chạy tiếp queue đã tạm dừng.
- `Dừng`: dừng tiến trình, đóng tab đang mở và hủy download đang theo dõi nếu có.
- `Xóa`: xóa queue và log, chỉ khả dụng khi không đang chạy.
- `Xuất log`: lưu file log `.txt` vào thư mục tải về đã chọn.

## 18. Nơi file được lưu

Chrome chỉ cho extension lưu file bên trong thư mục Downloads của Chrome. Nếu bạn nhập `SO9-Downloads`, file sẽ nằm trong:

```text
Downloads/SO9-Downloads
```

Tên file sẽ được lấy từ SO9, URL trực tiếp, hoặc tên gợi ý của trang. Ký tự không hợp lệ trên hệ điều hành sẽ được thay bằng dấu gạch ngang. Nếu trùng tên, Chrome sẽ tự thêm hậu tố theo `conflictAction: uniquify`.

## 19. Lỗi thường gặp và cách xử lý

| Hiện tượng | Cách xử lý |
| --- | --- |
| Chrome báo `USER_CANCELED` | Tắt tùy chọn hỏi nơi lưu từng file trong Chrome Downloads và chạy lại. |
| SO9 báo link không hợp lệ | Kiểm tra link còn truy cập công khai, đúng nền tảng, không phải link đã xóa/riêng tư. |
| Hết thời gian chờ file | Tăng timeout trong Options, kiểm tra internet, thử lại vào lúc SO9 ổn định hơn. |
| Queue hiện `Không hỗ trợ` | Link thuộc domain/loại stream nằm ngoài phạm vi an toàn. |
| Telegram báo chưa đăng nhập | Đăng nhập Telegram Web trong Chrome rồi chạy lại. |
| Telegram không có nút tải | Nội dung có thể bị giới hạn tải/forward hoặc Telegram không expose video source. |
| Quét Facebook/TikTok thất bại | Đăng nhập, xử lý captcha/checkpoint, mở lại kênh trong Chrome và thử quét lại. |
| Không thấy file trong folder mong muốn | Kiểm tra thư mục Downloads mặc định của Chrome và tên thư mục con đã nhập. |
| Chrome không hỏi quyền đọc trang | Kiểm tra link có phải trang media ngoài SO9 không; reload extension nếu vừa cập nhật manifest. |
| Giao diện vẫn là bản cũ sau khi cập nhật | Vào `chrome://extensions` và bấm reload extension. |

## 20. Checklist test nhanh sau khi cài đặt

1. Mở popup, thấy tên `Mike-AutomationAI` và badge `Sẵn sàng`.
2. Dán một link TikTok public vào ô nhập tay.
3. Bấm `Nạp link`.
4. Nhập thư mục tải về `SO9-Downloads`.
5. Bấm `Chạy automation`.
6. Chờ đến khi queue hiện `Thành công`.
7. Mở Downloads và kiểm tra file nằm trong `SO9-Downloads`.
8. Bấm `Xuất log` nếu cần gửi log để hỗ trợ.

## 21. Bảo trì và kiểm tra cho người phát triển

Sau khi sửa code, nên chạy các lệnh:

```powershell
node --check popup.js
node --check service-worker.js
node --check content-script.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

Khi public repo, nên kiểm tra thêm:

- Không có token, cookie, secret, private key, file tải về cá nhân.
- Không khôi phục tên/branding cũ trước `Mike-AutomationAI`.
- Không thêm logic bypass DRM, paywall, login, Telegram permission, blob stream, HLS/DASH segment stitching.
