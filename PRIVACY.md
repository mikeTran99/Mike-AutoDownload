# Chính sách quyền riêng tư — Mike-Autodownload

Ngày hiệu lực: 04/10/2026

Mike-Autodownload là tiện ích Chrome hỗ trợ người dùng tải video, âm thanh và ảnh mà họ có quyền truy cập và được phép tải. Tiện ích không được thiết kế để vượt qua DRM, paywall, đăng nhập, quyền riêng tư, hạn chế tải xuống hoặc cơ chế bảo vệ nội dung.

## Dữ liệu được xử lý

Tiện ích có thể xử lý các dữ liệu sau khi người dùng chủ động sử dụng tính năng tương ứng:

- URL video, trang hoặc kênh do người dùng nhập hay yêu cầu quét.
- Danh sách chờ tải, trạng thái xử lý, thiết lập thư mục, giới hạn số lượng/lượt xem và nhật ký vận hành.
- Thông tin kỹ thuật cần thiết để nhận diện tệp tải xuống, chẳng hạn URL tệp, tên tệp, trạng thái và mã tải xuống của Chrome.
- Nội dung video và liên kết hiển thị trên Telegram Web mà tài khoản Chrome hiện tại đã đăng nhập và được phép xem.

Danh sách chờ, thiết lập và nhật ký được lưu cục bộ bằng `chrome.storage.local` trong hồ sơ Chrome của người dùng. Tiện ích không có máy chủ phân tích riêng và không bán dữ liệu cá nhân.

## Dịch vụ bên thứ ba

Đối với liên kết Facebook, TikTok, Instagram hoặc Douyin được hỗ trợ qua SO9, tiện ích mở trang tải xuống của SO9 và điền liên kết mà người dùng đã cung cấp. Vì vậy, SO9 có thể nhận URL đó và các dữ liệu kỹ thuật thông thường của một lượt truy cập web theo chính sách riêng của SO9.

Đối với tính năng Telegram, tiện ích mở `https://web.telegram.org/` trong hồ sơ Chrome hiện tại. Telegram xử lý dữ liệu theo chính sách riêng của Telegram. Tiện ích chỉ thao tác với nội dung đang hiển thị mà người dùng đã được cấp quyền xem; tiện ích không thu thập thông tin đăng nhập và không vượt qua quyền truy cập Telegram.

Đối với trang media HTTPS khác, chế độ quét trang xin quyền truy cập origin khi người dùng bắt đầu thao tác. Quyền này được dùng để tìm URL media trực tiếp do trang cung cấp trong DOM hoặc metadata. Tiện ích không theo dõi toàn bộ mạng nền và không hỗ trợ blob stream, ghép HLS/DASH, DRM hoặc nội dung cần vượt qua đăng nhập.


## Mục đích sử dụng quyền Chrome

- `downloads`: tạo, theo dõi, đặt tên và hủy lượt tải do tiện ích khởi tạo.
- `storage`: lưu cục bộ cài đặt, danh sách chờ, tiến trình và nhật ký.
- `tabs`: mở và đóng các trang SO9, trang kênh, trang media hoặc Telegram phục vụ thao tác người dùng đã yêu cầu.
- `scripting`: quét nội dung trang trên các origin đã khai báo hoặc được người dùng cấp quyền.
- `alarms`: đánh thức service worker để kiểm tra và khôi phục an toàn job đang xử lý sau khi Chrome tạm dừng worker.
- `notifications`: thông báo khi danh sách tải hoàn tất hoặc bị dừng.
- `sidePanel`: hiển thị giao diện điều khiển trong Side Panel của Chrome.
- Quyền host bắt buộc cho SO9, Facebook, TikTok, YouTube và các trang downloader dự phòng (snaptik.app, ssstik.io, snapsave.app, snapinsta.app, snapdouyin.app, savefrom.net, snapany.com): mở trang, nhập link và đọc kết quả tải; không đọc cookie hay nội dung khác.
- Quyền host HTTPS tùy chọn: được yêu cầu khi người dùng chọn quét profile Instagram/Douyin, xử lý trang media trực tiếp hoặc Telegram Web. Tiện ích không yêu cầu quyền HTTP rộng.

## Chia sẻ, lưu giữ và xóa dữ liệu



Tiện ích không bán dữ liệu, không dùng dữ liệu cho quảng cáo và không chia sẻ dữ liệu với bên thứ ba ngoài việc điều hướng hoặc gửi URL đến dịch vụ được nêu ở trên để thực hiện yêu cầu tải của người dùng.

Dữ liệu cục bộ được giữ trong hồ sơ Chrome cho đến khi người dùng xóa danh sách/nhật ký, xóa dữ liệu tiện ích hoặc gỡ tiện ích. Các tệp đã tải xuống nằm trong thư mục tải xuống do người dùng lựa chọn và phải được xóa bằng công cụ quản lý tệp của hệ điều hành nếu không còn cần thiết.

## Kiểm soát của người dùng

Người dùng có thể từ chối quyền host tùy chọn, dừng tiến trình, xóa danh sách và nhật ký hoặc gỡ tiện ích bất kỳ lúc nào. Khi quyền host tùy chọn bị từ chối, tính năng phụ thuộc vào origin đó sẽ không hoạt động nhưng các tính năng khác vẫn có thể tiếp tục sử dụng.

## Thay đổi chính sách

Nếu cách xử lý dữ liệu thay đổi, chính sách này sẽ được cập nhật cùng mã nguồn và ngày hiệu lực mới trước khi phát hành phiên bản liên quan.
