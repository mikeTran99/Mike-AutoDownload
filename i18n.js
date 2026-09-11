// Dịch giao diện VI ⇄ EN lúc hiển thị. Nguồn (storage, log, message) luôn là tiếng Việt;
// từ điển dưới đây ánh xạ mẫu tiếng Việt → tiếng Anh, `{}` là phần thay đổi (số, link, tên site...).
// Chuỗi không có trong từ điển được trả về nguyên bản.

export const LANGS = ["vi", "en"];

const EN = {
  // ---- popup.html / options.html
  "Video Batch Downloader": "Video Batch Downloader",
  "Tải video hàng loạt, quét kênh và tải link trực tiếp": "Batch downloads, channel crawling and direct links",
  "Đổi giao diện": "Toggle theme",
  "Đổi ngôn ngữ": "Switch language",
  "Quét kênh video": "Crawl channel videos",
  "Đã lưu {} link": "{} links saved",
  "Link kênh Facebook / TikTok / Instagram / Douyin": "Facebook / TikTok / Instagram / Douyin channel link",
  "Ví dụ: https://www.tiktok.com/@username hoặc https://www.instagram.com/username/": "e.g. https://www.tiktok.com/@username or https://www.instagram.com/username/",
  "Số lượng": "Count",
  "Toàn bộ": "All",
  "Số nguyên dương, hoặc để trống để lấy toàn bộ.": "Positive integer, or leave blank for all.",
  "View tối thiểu": "Minimum views",
  "Ví dụ: 1000, 10000, 100000": "e.g. 1000, 10000, 100000",
  "Quét link video": "Crawl video links",
  "Tải link đã quét": "Download saved links",
  "Xóa dữ liệu cũ": "Clear old data",
  "Tải link lên": "Add links",
  "TXT / CSV / Dán link": "TXT / CSV / Paste",
  "Tải file link": "Upload link file",
  ".txt, .csv hoặc file có chứa URL": ".txt, .csv or any file containing URLs",
  "Dán link vào đây, mỗi dòng một link": "Paste links here, one per line",
  "Nạp link": "Import links",
  "Thư mục tải về": "Download folder",
  "Ví dụ: SO9-Downloads": "e.g. SO9-Downloads",
  "Lưu trong Downloads của Chrome, ví dụ Downloads/SO9-Downloads.": "Saved inside Chrome's Downloads, e.g. Downloads/SO9-Downloads.",
  "Tổng link": "Total",
  "Thành công": "Success",
  "Thất bại": "Failed",
  "Chạy automation": "Run automation",
  "Tạm dừng": "Pause",
  "Tiếp tục": "Resume",
  "Dừng": "Stop",
  "Danh sách link": "Link list",
  "Xóa": "Clear",
  "Log trạng thái": "Status log",
  "Xuất log": "Export log",
  "Cài đặt Mike-Autodownload": "Mike-Autodownload Settings",
  "Thời gian đợi mỗi link (giây)": "Timeout per link (seconds)",
  "Giá trị từ 20 đến 300 giây.": "Between 20 and 300 seconds.",
  "Thư mục con trong Downloads": "Subfolder inside Downloads",
  "Lưu cài đặt": "Save settings",
  "Đã lưu cài đặt.": "Settings saved.",
  "Không thể lưu: {}": "Could not save: {}",

  "Dọn link xong": "Prune finished",
  "Bỏ link đã tải xong và link không hỗ trợ": "Remove finished and unsupported links",
  "Tất cả": "All",
  "Không có link nào trong bộ lọc này.": "No links match this filter.",
  "Xem thêm": "Show more",
  "Bỏ link này": "Remove this link",
  "Đã nạp {} link từ file {}, bỏ qua {} link trùng": "Imported {} links from file {}, skipped {} duplicates",
  "Đã nạp {} link từ ô nhập tay, bỏ qua {} link trùng": "Imported {} links from the text box, skipped {} duplicates",
  "Đã dọn {} link đã xong/không hỗ trợ khỏi hàng đợi.": "Pruned {} finished/unsupported links from the queue.",
  "Liên hệ": "Contact",
  "Liên hệ Mike": "Contact Mike",
  "Đóng": "Close",
  "Góp ý, báo lỗi hoặc đặt tính năng mới cho Mike-Autodownload.": "Feedback, bug reports or feature requests for Mike-Autodownload.",
  "Telegram · quét mã QR để nhắn tin": "Telegram · scan the QR code to message me",
  "Thống kê kênh": "Channel stats",
  "Xuất CSV": "Export CSV",
  "Chưa có thống kê. Quét một kênh để bắt đầu.": "No stats yet. Crawl a channel to begin.",
  "Xóa toàn bộ thống kê kênh?": "Clear all channel stats?",
  "So với lần quét trước:": "Since last crawl:",
  "follower": "followers",
  "view": "views",
  "Follower": "Followers",
  "Video quét": "Videos",
  "Tổng view": "Total views",
  "View TB": "Avg views",
  "Không đọc được view của video nào.": "No video view counts could be read.",

  // ---- popup.js
  "Sẵn sàng": "Ready",
  "Đang chạy": "Running",
  "Đang quét": "Crawling",
  "Chờ tải": "Queued",
  "Đang tải": "Downloading",
  "Không hỗ trợ": "Unsupported",
  "Chưa quét kênh nào.": "No channel crawled yet.",
  "Lần quét gần nhất: {}": "Last crawl: {}",
  "Chưa có link nào được tải lên.": "No links added yet.",
  "Không thể xóa dữ liệu khi đang chạy.": "Cannot clear data while running.",
  "Bạn có chắc chắn muốn xóa toàn bộ dữ liệu cũ (link đã lưu, danh sách tải, log, thông tin quét kênh)?": "Clear all old data (saved links, queue, logs, crawl info)?",
  "Bạn có chắc chắn muốn xóa toàn bộ danh sách tải và log không?": "Clear the whole queue and log?",
  "Đã nạp {} link từ file {}": "Imported {} links from file {}",
  "Chưa có link để nạp.": "No links to import.",
  "Đã nạp {} link từ ô nhập tay": "Imported {} links from the text box",
  "Không hỗ trợ domain này": "Domain not supported",
  "Nhập số nguyên dương hợp lệ, hoặc để trống để lấy toàn bộ.": "Enter a positive integer, or leave blank for all.",
  "Vui lòng nhập link kênh Facebook, TikTok, Instagram hoặc Douyin hợp lệ.": "Enter a valid Facebook, TikTok, Instagram or Douyin channel link.",
  "Chrome chưa cấp quyền đọc trang cho profile này.": "Chrome has not granted page access for this profile.",
  "toàn bộ video tìm thấy": "all videos found",
  "tối đa {} video": "up to {} videos",
  "Đang mở kênh {} để quét {}, view tối thiểu {}.": "Opening {} channel to crawl {}, minimum views {}.",
  "Không thể quét kênh video.": "Could not crawl the channel.",
  "Đã đưa {} link {} vào danh sách tải.": "Added {} {} links to the queue.",
  "Đã dừng quét": "Crawl stopped",
  "Quét kênh thất bại: {}": "Channel crawl failed: {}",
  "Chưa có link video nào được lưu local.": "No saved video links yet.",
  "Đã nạp {} link video đã lưu vào danh sách tải.": "Loaded {} saved links into the queue.",
  "Tự động tải lần lượt các link đã lưu.": "Downloading saved links one by one.",
  "Đây là link profile; hãy dán vào ô Quét kênh để lấy toàn bộ video.": "This is a profile link; paste it into Crawl channel to collect all videos.",
  "Chờ xử lý qua SO9": "Queued for downloader sites",
  "Chờ xử lý": "Queued",
  "Domain này không hỗ trợ tải tự động.": "This domain does not support automatic download.",
  "Tải trực tiếp file video": "Direct video file download",
  "HLS/DASH cần ghép stream; không hỗ trợ trong bản an toàn này.": "HLS/DASH needs stream stitching; not supported in this safe build.",
  "Chỉ quét trang media HTTPS để bảo vệ quyền truy cập.": "Only HTTPS media pages are scanned.",
  "Tìm URL video trực tiếp trên trang": "Find a direct video URL on the page",
  "Quét story để tìm URL video trực tiếp công khai": "Scan the story for a public direct video URL",
  "Quét trang Instagram để tìm URL video trực tiếp công khai": "Scan the Instagram page for a public direct video URL",
  "Quét trang để tìm URL video trực tiếp công khai": "Scan the page for a public direct video URL",
  "Tải video Telegram Web đang hiển thị": "Download the Telegram Web video on screen",
  "Mở private link trên Telegram Web rồi tải video đang hiển thị": "Open the private link in Telegram Web, then download the visible video",
  "Chỉ hỗ trợ link web.telegram.org hoặc private link dạng t.me/c/chat/message.": "Only web.telegram.org links or private t.me/c/chat/message links are supported.",
  "Thư mục tải về: Downloads/{}": "Download folder: Downloads/{}",
  "Bắt đầu tải lần lượt các link trong danh sách.": "Downloading queued links one by one.",
  "Chrome chưa cấp quyền đọc trang cho link ngoài SO9/Telegram.": "Chrome has not granted page access for links outside SO9/Telegram.",
  "Không thể bắt đầu tiến trình tải.": "Could not start the download run.",
  "Không thể thay đổi trạng thái tiến trình.": "Could not change the run state.",
  "Không thể dừng tiến trình.": "Could not stop the run.",
  "View: {}": "Views: {}",

  // ---- service-worker.js
  "Chrome vừa khởi động": "Chrome just started",
  "Extension vừa được cập nhật": "Extension was just updated",
  "Alarm phục hồi worker": "Worker recovery alarm",
  "Worker được khởi tạo": "Worker initialised",
  "Đang quét kênh, vui lòng chờ hoàn tất.": "A crawl is running, please wait.",
  "Đang có tiến trình chạy.": "A run is already in progress.",
  "Không thể quét kênh khi danh sách đang được tải.": "Cannot crawl while the queue is downloading.",
  "Đang có tiến trình quét profile/kênh.": "A profile/channel crawl is already running.",
  "Đã dừng quét kênh/profile.": "Channel/profile crawl stopped.",
  "Không có tiến trình để tạm dừng.": "Nothing to pause.",
  "Đã tạm dừng tiến trình.": "Run paused.",
  "Không có tiến trình để tiếp tục.": "Nothing to resume.",
  "Đã tiếp tục tiến trình.": "Run resumed.",
  "Đã yêu cầu dừng quét kênh/profile.": "Stop requested for the crawl.",
  "Đã yêu cầu dừng tiến trình.": "Stop requested for the run.",
  "Không có link hợp lệ để tải.": "No valid links to download.",
  "Tiến trình gặp lỗi hệ thống: {}": "System error in the run: {}",
  "Đã dừng trước khi hoàn tất": "Stopped before completion",
  "Đã hoàn tất yêu cầu dừng sau khi worker được phục hồi.": "Stop request completed after the worker recovered.",
  "{}: tiếp tục tiến trình đang lưu.": "{}: resuming the saved run.",
  "Chỉ hỗ trợ quét kênh Facebook, TikTok, Instagram hoặc Douyin.": "Only Facebook, TikTok, Instagram or Douyin channels can be crawled.",
  "CRAWL_STOPPED: Đã dừng quét kênh/profile.": "CRAWL_STOPPED: Crawl stopped.",
  "Link kênh Facebook Reels không hợp lệ.": "Invalid Facebook Reels channel link.",
  "Đang mở kênh Facebook: {}": "Opening Facebook channel: {}",
  "Đang cuộn để lấy toàn bộ link Reels tìm thấy trên kênh.": "Scrolling to collect every Reels link on the channel.",
  "Đang cuộn và lấy tối đa {} link Reels.": "Scrolling to collect up to {} Reels links.",
  "Ngưỡng view tối thiểu: {}.": "Minimum views: {}.",
  "Facebook đang chặn hoặc yêu cầu đăng nhập/checkpoint.": "Facebook is blocking or requires login/checkpoint.",
  "Không tìm thấy link Reels nào trên kênh sau khi cuộn.": "No Reels links found on the channel after scrolling.",
  "Đã lấy được {} link Reels, bỏ qua {} link trùng/không hợp lệ.": "Collected {} Reels links, skipped {} duplicate/invalid.",
  "Đã bỏ qua {} video dưới ngưỡng view.": "Skipped {} videos below the view threshold.",
  "{} video không đọc được view.": "{} videos had unreadable view counts.",
  "Đã đưa {} link Facebook vào danh sách tải.": "Added {} Facebook links to the queue.",
  "Link kênh TikTok không hợp lệ.": "Invalid TikTok channel link.",
  "Đang mở kênh TikTok: {}": "Opening TikTok channel: {}",
  "Đang cuộn để lấy toàn bộ link video TikTok tìm thấy trên kênh.": "Scrolling to collect every TikTok video link on the channel.",
  "Đang cuộn và lấy tối đa {} link video TikTok.": "Scrolling to collect up to {} TikTok video links.",
  "TikTok đang chặn hoặc yêu cầu xác minh.": "TikTok is blocking or requires verification.",
  "Không tìm thấy link video TikTok nào trên kênh sau khi cuộn.": "No TikTok video links found on the channel after scrolling.",
  "Đã lấy được {} link TikTok, bỏ qua {} link trùng/không hợp lệ.": "Collected {} TikTok links, skipped {} duplicate/invalid.",
  "Đã bỏ qua {} video TikTok dưới ngưỡng view.": "Skipped {} TikTok videos below the view threshold.",
  "{} video TikTok không đọc được view.": "{} TikTok videos had unreadable view counts.",
  "Đã đưa {} link TikTok vào danh sách tải.": "Added {} TikTok links to the queue.",
  "Quét kênh TikTok thất bại: {}": "TikTok crawl failed: {}",
  "Link profile Instagram không hợp lệ.": "Invalid Instagram profile link.",
  "Instagram yêu cầu đăng nhập hoặc không expose danh sách video công khai.": "Instagram requires login or does not expose a public video list.",
  "Link profile Douyin không hợp lệ.": "Invalid Douyin profile link.",
  "Douyin yêu cầu đăng nhập/xác minh hoặc không expose danh sách video công khai.": "Douyin requires login/verification or does not expose a public video list.",
  "Đang mở profile {}: {}": "Opening {} profile: {}",
  "Đang cuộn để lấy toàn bộ {} tìm thấy trên profile.": "Scrolling to collect every {} on the profile.",
  "Đang cuộn và lấy tối đa {} {}.": "Scrolling to collect up to {} {}.",
  "Không tìm thấy {} nào trên profile sau khi cuộn.": "No {} found on the profile after scrolling.",
  "Đã lấy được {} {}, bỏ qua {} link trùng/không hợp lệ.": "Collected {} {}, skipped {} duplicate/invalid.",
  "Quét profile {} thất bại: {}": "{} profile crawl failed: {}",
  "Tiến trình tải đang chạy, link vừa quét đã được lưu vào queue.": "A run is in progress; crawled links were saved to the queue.",
  "Tự động tải lần lượt các link vừa quét.": "Downloading crawled links one by one.",
  "Không thể khởi động danh sách vừa quét.": "Could not start the crawled queue.",
  "Số lượng phải là số nguyên dương hoặc để trống.": "Count must be a positive integer or blank.",
  "Facebook yêu cầu đăng nhập hoặc checkpoint trước khi quét link.": "Facebook requires login or checkpoint before crawling.",
  "TikTok yêu cầu đăng nhập, captcha hoặc xác minh trước khi quét link.": "TikTok requires login, captcha or verification before crawling.",
  "Douyin yêu cầu đăng nhập/xác minh trước khi quét video.": "Douyin requires login/verification before crawling.",
  "Số lượng phải là số nguyên dương hợp lệ, hoặc để trống để lấy toàn bộ.": "Count must be a valid positive integer, or blank for all.",
  "Tiếp tục xử lý danh sách link.": "Resuming the link queue.",
  "Bắt đầu xử lý danh sách link.": "Starting the link queue.",
  "Đang chuẩn bị tải": "Preparing download",
  "Đang xử lý {}: {}": "Processing {}: {}",
  "Đã tải: {}": "Downloaded: {}",
  "Đã hoàn tất": "Completed",
  "Thành công: {}": "Success: {}",
  "Thất bại: {} - {}": "Failed: {} - {}",
  "Tiến trình đã dừng.": "Run stopped.",
  "Đã xử lý xong danh sách.": "Queue finished.",
  "Đã xử lý xong danh sách link.": "Link queue finished.",
  "Đang đối chiếu download #{} sau khi worker được phục hồi.": "Checking download #{} after worker recovery.",
  "Đã phục hồi download thành công: {}": "Recovered download succeeded: {}",
  "Download phục hồi thất bại: {} - {}": "Recovered download failed: {} - {}",
  "Đã phục hồi download fallback: {}": "Recovered fallback download: {}",
  "Download fallback phục hồi thất bại: {} - {}": "Recovered fallback download failed: {} - {}",
  "Đã phục hồi sau khi worker khởi động lại": "Recovered after worker restart",
  "Thử lại lần {}/{}: {}": "Retry {}/{}: {}",
  "Đang tải link video trực tiếp bằng Chrome API.": "Downloading the direct video link with the Chrome API.",
  "Đang đọc URL video ngay trên trang gốc.": "Reading the video URL from the original page.",
  "{} thất bại: {}. Thử nguồn tiếp theo.": "{} failed: {}. Trying the next source.",
  "Hết thời gian trước khi thử nguồn tải.": "Timed out before trying a download source.",
  "Trang gốc": "Original page",
  "Đã mở {} ở chế độ nền.": "Opened {} in the background.",
  "Đã nhập link và tạo file trên {}.": "Submitted the link and generated the file on {}.",
  "Đang tải bằng Chrome API.": "Downloading with the Chrome API.",
  "Fallback click nút tải trên {}.": "Fallback: clicking the download button on {}.",
  "{} đã xử lý link nhưng không trả về URL hoặc nút tải.": "{} processed the link but returned no URL or download button.",
  "Đang bắt URL video trực tiếp từ {}.": "Capturing the direct video URL from the {}.",
  "trang Instagram": "Instagram page",
  "story": "story",
  "trang media": "media page",
  "Đang quét video trực tiếp trên trang.": "Scanning the page for a direct video.",
  "Không tìm thấy URL video trực tiếp. Trang có thể dùng blob, HLS/DASH, DRM, đăng nhập hoặc cơ chế không cho tải tự động.": "No direct video URL found. The page may use blob, HLS/DASH, DRM, login or anti-download measures.",
  "Đã tìm thấy video trực tiếp{}.": "Found a direct video{}.",
  "Đã mở Telegram Web. Hãy đảm bảo Chrome đã đăng nhập Telegram và bạn có quyền xem video.": "Opened Telegram Web. Make sure Chrome is logged in to Telegram and you may view the video.",
  "Telegram Web không hiển thị nút tải/lưu cho video này. Tool không bypass hạn chế tải hoặc quyền riêng tư của Telegram.": "Telegram Web shows no download/save button for this video. The tool does not bypass Telegram restrictions or privacy.",
  "Đang click nút tải Telegram Web{}.": "Clicking the Telegram Web download button{}.",
  "Telegram Web chưa đăng nhập. Hãy đăng nhập Telegram Web trong Chrome rồi chạy lại.": "Telegram Web is not logged in. Log in to Telegram Web in Chrome and run again.",
  "Đã mở preview video Telegram để lấy nguồn tải.": "Opened the Telegram video preview to get the source.",
  "Telegram Web có video đang hiển thị nhưng không có nút tải/lưu khả dụng. Tool không bypass hạn chế tải hoặc quyền riêng tư của Telegram.": "Telegram Web shows a video but no usable download/save button. The tool does not bypass Telegram restrictions or privacy.",
  "Không tìm thấy video Telegram đang hiển thị. Hãy mở đúng tin nhắn video trong Telegram Web rồi chạy lại.": "No visible Telegram video found. Open the video message in Telegram Web and run again.",
  "Không tìm thấy nút tải Telegram Web.": "Telegram Web download button not found.",
  "Telegram Web đang render media nhưng chưa expose video source. Hãy mở/phát video rồi chạy lại.": "Telegram Web is rendering media but has not exposed the video source. Open/play the video and run again.",
  "Telegram Web không có nút tải/lưu khả dụng cho video này.": "Telegram Web has no usable download/save button for this video.",
  "Trang chỉ expose HLS/DASH playlist; bản này không ghép stream thành video.": "The page only exposes an HLS/DASH playlist; this build does not stitch streams.",
  "Trang dùng blob stream; không có URL file video trực tiếp để Chrome tải.": "The page uses a blob stream; there is no direct file URL for Chrome to download.",
  "Trang SO9 không phản hồi trong thời gian cho phép.": "The downloader page did not respond in time.",
  "Trang SO9 không phản hồi sau khi nhập link.": "The downloader page did not respond after the link was submitted.",
  "Content script không thể thao tác trang.": "The content script could not operate the page.",
  "DOWNLOAD_TIMEOUT: Hết thời gian chờ file tải về.": "DOWNLOAD_TIMEOUT: Timed out waiting for the file.",
  "RUN_STOPPED: Tiến trình đã được yêu cầu dừng.": "RUN_STOPPED: The run was asked to stop.",
  "Chrome báo lỗi tải file: {}": "Chrome reported a download error: {}",
  "File tải về bị gián đoạn.": "The download was interrupted.",
  "Không còn tìm thấy download #{}.": "Download #{} no longer exists.",
  "DOWNLOAD_NOT_FOUND: Chrome không trả về thông tin file tải.": "DOWNLOAD_NOT_FOUND: Chrome returned no download info.",
  "DOWNLOAD_MISMATCH: Máy chủ trả về {}.": "DOWNLOAD_MISMATCH: The server returned {}.",
  "nội dung không phải video": "non-video content",
  "DOWNLOAD_MISMATCH: File tải về không phải định dạng video.": "DOWNLOAD_MISMATCH: The downloaded file is not a video format.",
  "DOWNLOAD_EMPTY: File tải về rỗng.": "DOWNLOAD_EMPTY: The downloaded file is empty.",
  "DOWNLOAD_DANGER: Chrome đánh dấu file ở trạng thái {}.": "DOWNLOAD_DANGER: Chrome flagged the file as {}.",
  "INVALID_DOWNLOAD_URL: URL tải về không hợp lệ.": "INVALID_DOWNLOAD_URL: Invalid download URL.",
  "INVALID_DOWNLOAD_URL: Chỉ hỗ trợ URL HTTP hoặc HTTPS trực tiếp.": "INVALID_DOWNLOAD_URL: Only direct HTTP/HTTPS URLs are supported.",
  "ITEM_TIMEOUT: Đã hết thời gian xử lý link.": "ITEM_TIMEOUT: The link timed out.",
  "RUN_REPLACED: Tiến trình đã được thay thế hoặc kết thúc.": "RUN_REPLACED: The run was replaced or has ended.",
  "Chrome không trả về download id.": "Chrome returned no download id.",
  "SO9 báo link không hợp lệ hoặc không thể tải link này.": "The downloader reported the link as invalid or not downloadable.",
  "Trang downloader tải quá lâu.": "The downloader page took too long to load.",
  "RUN_STOPPED: Tab đã đóng theo yêu cầu dừng.": "RUN_STOPPED: The tab was closed on stop request.",
  "Tab xử lý đã bị đóng trước khi tải xong.": "The working tab was closed before the download finished.",
  "Chrome báo USER_CANCELED. Đã thử tải tự động; hãy kiểm tra Chrome không bật hỏi nơi lưu file và không đóng tab SO9 khi automation đang chạy.": "Chrome reported USER_CANCELED. Make sure Chrome is not asking where to save files and do not close the downloader tab while automation runs.",
  "Bị gián đoạn, sẽ tải lại": "Interrupted, will retry",

  // ---- content-script.js
  "Không tìm thấy ô nhập link.": "Link input box not found.",
  "Không tìm thấy nút tải xuống.": "Download button not found.",
  "Không tìm thấy nút tải file cuối trên trang downloader.": "Final download button not found on the downloader page.",
  "Trang downloader chưa tạo được file tải xuống trong thời gian chờ.": "The downloader did not produce a file in time.",
  "Trang downloader báo link không hợp lệ hoặc không thể tải link này.": "The downloader reported the link as invalid or not downloadable."
};

let currentLang = "vi";
const compiled = Object.entries(EN)
  .filter(([vi]) => vi.includes("{}"))
  .map(([vi, en]) => {
    const parts = vi.split("{}").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return { en, regex: new RegExp(`^${parts.join("([\\s\\S]*?)")}$`) };
  });

export function getLang() {
  return currentLang;
}

export async function initLang() {
  const data = await chrome.storage.local.get(["lang"]);
  currentLang = LANGS.includes(data.lang) ? data.lang : "vi";
  return currentLang;
}

export async function setLang(lang) {
  currentLang = LANGS.includes(lang) ? lang : "vi";
  await chrome.storage.local.set({ lang: currentLang });
  return currentLang;
}

export function t(text, lang = currentLang) {
  const source = String(text ?? "");
  if (lang !== "en" || !source) return source;
  if (EN[source]) return EN[source];
  for (const entry of compiled) {
    const match = source.match(entry.regex);
    if (!match) continue;
    let index = 0;
    return entry.en.replace(/\{\}/g, () => t(match[++index], lang));
  }
  return source;
}

// Dịch text node + placeholder/title/aria-label trong DOM; giữ bản gốc tiếng Việt để đổi ngược lại.
const originals = new WeakMap();
const ATTRS = ["placeholder", "title", "aria-label"];

export function applyDom(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const trimmed = node.nodeValue.trim();
    if (!trimmed || node.parentElement?.closest("script, style")) continue;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const vi = originals.get(node);
    node.nodeValue = vi.replace(vi.trim(), t(vi.trim()));
  }
  for (const element of root.querySelectorAll(ATTRS.map((attr) => `[${attr}]`).join(","))) {
    let store = originals.get(element);
    if (!store) originals.set(element, (store = {}));
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      if (!(attr in store)) store[attr] = element.getAttribute(attr);
      element.setAttribute(attr, t(store[attr]));
    }
  }
}
