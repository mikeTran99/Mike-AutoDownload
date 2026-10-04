# Mike-Autodownload: benchmark và đối chiếu năng lực

Ngày đo: **04/10/2026, Asia/Saigon**. Báo cáo này đo mã local và đối chiếu tài liệu gốc của bốn công cụ tham chiếu; không chạy phần mềm của đối thủ.

**Kết quả có thể chứng minh:** các lỗi logic đã có probe tái hiện chuyển từ 9 finding sang 9 pass; policy mới phân biệt asset/variant, không nhận file log hay playlist là video. Trên máy đo, merge 5.000 bản ghi direct thông thường có median **17,39 ms**, p95 **19,33 ms**. Một queue 5.000 URL có chuỗi ký dài đạt **17.945.561 byte JSON**, vượt quota mặc định của Chrome. Vì vậy, giới hạn số item cần đi cùng giới hạn dung lượng.

Chưa có cơ sở để nói Mike-Autodownload nhanh hơn, tương thích rộng hơn hoặc đáng tin hơn mọi downloader trên Internet. Các phép đo dưới đây không đo tốc độ tải mạng, thành công trên nền tảng thật, chất lượng media, rendering Side Panel hoặc chi phí `chrome.storage`.

## 1. Phương pháp và khả năng tái lập

Harness: `tools/benchmark-media.mjs`, không dùng dependency ngoài Node; không truy cập mạng, không tạo download và không ghi sửa source. Chạy:

```powershell
node tools/benchmark-media.mjs --self-test
node --expose-gc tools/benchmark-media.mjs --iterations=100
node tools/audit-current-runtime.mjs
node --test tests/worker-regressions.test.mjs tests/media-runtime.test.mjs tests/media-policy.test.mjs
```

| Thuộc tính | Lần đo 1 |
|---|---|
| Thời điểm UTC | 2026-10-04T10:09:02.180Z |
| Node / V8 | v24.16.0 / 13.6.233.17-node.49 |
| Hệ điều hành | Windows, win32 10.0.26300 x64 |
| CPU | Intel Core i5-12450HX, 12 logical CPU |
| RAM | 16.890.322.944 byte |
| Mỗi corpus | 5.000 bản ghi đầu vào; 10 lượt warmup, 100 lượt đo mỗi cách |
| Thứ tự | Đảo raw/policy luân phiên từng lượt; GC trước mỗi corpus, ngoài timer |
| Policy SHA-256 | `c1d3ec936e91ee025504f3a958c2bbb5ff70b6e71dbef560ec7755be00f22720` |

Median là trung vị (trung bình hai mẫu giữa khi số mẫu chẵn); p95 dùng nearest rank. Timer chỉ bao quanh hàm merge. Giá trị byte là UTF-8 của `JSON.stringify`, không phải heap Chrome hay toàn bộ storage. Máy vẫn dùng cho công việc phát triển; tải nền, JIT và GC có thể ảnh hưởng độ dao động. Giữ corpus và hash source khi so sánh các lần sau.

Harness kiểm đầu ra bằng kỳ vọng literal trước khi đo: cách raw giữ item đầu tiên của cùng link; policy giữ hai ảnh khác nhau của cùng carousel; năm corpus có đúng số row/duplicate/history skip mong đợi. Các self-check đã được chạy red trước khi bổ sung implementation harness rồi chạy green.

## 2. CPU và dung lượng queue

Đối chứng `rawLinkMap` là cách append rồi dedupe bằng **chuỗi link nguyên vẹn**, giữ item đầu tiên, cắt ở 5.000. Đây là thuật toán đơn giản để đo chi phí làm việc bổ sung; nó không thực hiện đúng cùng hợp đồng với policy mới, không đại diện tốc độ của một sản phẩm đối thủ.

| Corpus 5.000 input | Raw median / p95 (ms) | Policy median / p95 (ms) | Row raw → policy | JSON output policy (byte) |
|---|---:|---:|---:|---:|
| Direct duy nhất; signature giả 96 ký tự | 0,39 / 0,50 | 17,39 / 19,33 | 5.000 → 5.000 | 3.545.561 |
| 2.000 cũ + 3.000 mới, gồm 1.500 alias share | 0,63 / 1,29 | 28,49 / 51,61 | 5.000 → 3.500 | 1.549.561 |
| 1.000 post, mỗi post 5 ảnh carousel | 0,25 / 0,42 | 36,59 / 49,87 | 1.000 → 5.000 | 2.266.681 |
| 1.000 cũ + 4.000 mới, history khớp 1.000 | 0,73 / 1,23 | 65,88 / 95,83 | 5.000 → 5.000 | 3.582.561 |
| Direct duy nhất; signature giả 1.536 ký tự | 1,00 / 1,80 | 117,96 / 186,29 | 5.000 → 5.000 | 17.945.561 |

Mỗi bản ghi có id/link/kind/status/title/caption/subfolder/createdAt; caption là hai câu tiếng Việt cố định. Tất cả URL benchmark thuộc `.example`, signature chỉ là ký tự `S`; không dùng token thật. Corpus carousel thêm `assetIndex`. Corpus history có 1.000 entry `{time, filename}`. Đây là dữ liệu có kiểm soát, không phải mẫu phân bố thực tế của mọi nền tảng.

Policy tốn CPU hơn đối chứng raw vì parse URL, tạo identity theo nền tảng, phân biệt asset/variant, áp dụng history và giữ trạng thái cũ. Các phép đo không chứng minh raw là lựa chọn hợp lệ: raw bỏ lọt 1.500 alias đã có trong queue, gộp mất 4.000 ảnh khác nhau của carousel, và giữ 1.000 item đã tải ở trạng thái pending. Policy dedupe alias, giữ đủ ảnh và đánh dấu 1.000 history match là `skipped`.

Đã lặp lại cùng command, corpus, máy và source hash ở **2026-10-04T10:10:03.731Z**, vẫn 100 lượt/cách. Dung lượng và mọi kết quả correctness giống hệt lần đầu:

| Corpus | Policy median / p95 lần 2 (ms) |
|---|---:|
| Direct duy nhất | 17,16 / 19,27 |
| Alias share | 31,81 / 54,27 |
| Carousel | 32,47 / 50,90 |
| History | 68,81 / 109,71 |
| Signature dài | 147,47 / 193,43 |

Hai lần đo cho direct thông thường gần nhau; corpus nhiều history hoặc URL dài dao động rõ hơn. Không chọn một mẫu nhanh nhất làm lời hứa độ trễ. Kết quả đề xuất cap dựa vào correctness và dung lượng, không dựa vào một tuyên bố tăng tốc so với raw hoặc đối thủ.

### Giới hạn được đề xuất từ số liệu

- Giữ cap **5.000 row cho lần bổ sung**; queue đã tồn tại vượt cap được giữ lại, không xóa job đang chạy hoặc lịch sử trạng thái để đạt một con số.
- Runtime hiện đã có gate queue **4 MiB** trước persistence và giữ queue cũ, đồng thời từ chối URL media dài hơn 8.192 ký tự thay vì cắt mất chữ ký. Mốc **6 MiB** có thể được cân nhắc sau khi đo toàn bộ `storage.local` (history/stats/log/job chiếm phần còn lại); đây chưa phải SLA. Kiểm tra quota thực bằng `getBytesInUse`, vì các key khác cũng chiếm chỗ. Chrome quy định `storage.local` mặc định **10.485.760 byte**, đo từ JSON giá trị cộng độ dài key; write vượt quota bị từ chối. [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage).
- URL ký dài làm tăng cả link lẫn canonical key; cân nhắc key hash từ identity, URL ngắn hạn trong session, hoặc kho có index theo asset. Không bỏ signature/query authorization để tiết kiệm byte: thao tác đó có thể làm URL tải hỏng.
- Khi UI nhập nhiều mục, xử lý theo batch khoảng **1.000** và đo storage/rendering riêng trước khi tăng. Chưa đo được thông lượng downloader hoặc concurrency; giữ provider fallback **1**. Không sao chép mức 5/10 luồng được tác giả công cụ desktop quảng cáo thành cấu hình của extension.

## 3. Hồi quy logic và giới hạn xác minh

Lần kiểm chạy khi viết báo cáo:

| Gate | Baseline trong báo cáo audit | Mã sau nâng cấp |
|---|---|---|
| Cú pháp toàn `src` | Worker có ba token lỗi, cần sửa trong memory để chạy logic probes | 8/8 file parse; không sửa trong memory |
| Audit A02/A03/A03b/A04/A05/A06/A07/A08/A11 | 9/9 finding | 9/9 pass |
| Policy + scanner + worker behavioral suite | Các probe baseline tái hiện vấn đề; chưa có đủ bộ regression mới | 42/42 pass: 15 policy, 6 scanner, 21 worker |

Sau hai lần benchmark, đã chạy thêm `npm run check`: **81/81 test pass**, syntax **8/8 file pass** ở snapshot đó; `node --check tools/benchmark-media.mjs`, harness self-check và `git diff --check` cũng pass. Số test có thể tăng khi tác vụ chính bổ sung gate browser; kết quả này là lần chạy ghi nhận, không phải cam kết mọi thay đổi tương lai vẫn green.

Baseline và bước sửa có mô tả tại `docs/AUDIT_AND_UPGRADE_PLAN_2026-10-04.md`. Các gate mới kiểm log export không bị claim, playlist bị từ chối cả trên CDN, chọn đúng identity trước chất lượng, URL extensionless có DOM evidence, merge/history, Start đồng thời, recovery/cleanup, Stop, khóa queue, health check, command sender và checkpoint crawl.

Đây là **tỷ lệ pass của fixture**, không phải tỷ lệ thành công tải video trên Internet. Worker được chạy với Chrome API doubles; scanner dùng DOM/metadata fixtures. Việc MIME, đuôi file, danger và byte count đều hợp lệ chưa chứng minh cấu trúc container hoặc toàn bộ nội dung media được kiểm. Mike-Autodownload chưa có phép kiểm tương đương đọc lại container/độ dài như README Suno-Downloader mô tả.

Báo cáo này chưa tính kết quả browser E2E đang do tác vụ chính thực hiện. Cần lưu riêng browser version, extension source hash, URL fixture thật, byte nhận được và screenshot UI; TikTok/SO9 hoặc Suno live chỉ được đánh dấu đạt khi đường chạy đó đã tải được và queue hiện `Thành công`.

## 4. Đối chiếu công cụ tham chiếu bằng nguồn gốc

Đã đọc nguồn chính thức ngày 04/10/2026. Không tải/chạy binary, không đo tốc độ hay tỷ lệ thành công của bốn công cụ này.

| Công cụ và snapshot | Năng lực được tài liệu mô tả | Mức bằng chứng / hệ quả cho Mike |
|---|---|---|
| **yt-dlp**, `51bab8a0116f4d8004c315706d809782607d5847` | CLI audio/video, nhiều extractor, lựa chọn format, audio riêng, subtitle, thumbnail, archive; ffmpeg cho merge và post-processing | Source engine công khai; breadth được README mô tả. Học cách tách extractor/format/history và kiểm format; không suy ra website đang chạy ổn từ việc có tên trong danh sách. [README cố định commit](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/README.md), [danh sách và giới hạn hỗ trợ](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/supportedsites.md). |
| **Video DownloadHelper**, website hiện tại | Browser extension phát hiện video/audio; tài liệu quảng bá MP4, HLS/DASH và subtitle ở premium, hơn 1.000 website; không cần phần mềm ngoài | Đây là mô tả của nhà sản xuất, chưa đo độc lập. Phạm vi stream rộng hơn scope direct hiện tại của Mike. [Trang chính thức](https://downloadhelper.net/). |
| **VDH CoApp**, `f3736cee7013d4f9003884d9f8077c4c16d2ee4f` | Native messaging, file writing, player launch và ffmpeg ở companion cũ | Repo đã archive; README nói **VDH v10 không còn cần companion**. Không gọi repo này là source engine extension hiện tại. `aclap-dev/video-downloadhelper` trả 404 khi kiểm. [README cố định commit](https://github.com/aclap-dev/vdhcoapp/blob/f3736cee7013d4f9003884d9f8077c4c16d2ee4f/README.md). |
| **Suno-Downloader**, `b54f5d83085edddb3e213f41ab7b7dba80c49295` | Scan song/playlist/profile/explore, chọn bài, original/conversion, cover, history; tác giả mô tả kiểm container trước success và 1–5 lượt song song | Snapshot tree chỉ có hai README và bảy PNG screenshot, không có source engine. Các tính năng là **tác giả mô tả**, chưa xác minh code hoặc chạy thật. Học preview, chọn asset và phân biệt original/conversion; không tuyên bố cùng mức kiểm file. [README cố định commit](https://github.com/duckmartians/Suno-Downloader/blob/b54f5d83085edddb3e213f41ab7b7dba80c49295/README.md). |
| **G-Labs Video Downloader**, `64e00133fd0bce0555bfdbea822b391470d42f05` | Tác giả mô tả nhiều platform/1.800+ sites, MP4/MP3/JPG/SRT nhiều output, preview playlist/channel, history theo format, retry và 1–10 lượt song song | Snapshot tree chỉ có hai README và bảy PNG, không có source engine. Không xác định được engine/thư viện từ các file đó. Học preview, nhiều output và history theo variant; không dùng con số website hoặc luồng làm benchmark đã kiểm chứng. [README cố định commit](https://github.com/duckmartians/G-Labs-Video-Downloader/blob/64e00133fd0bce0555bfdbea822b391470d42f05/README.md). |

Không áp dụng rubric brand/studio chín chiều của skill `benchmark-methodology` cho engine phần mềm. Dùng thực hành đo và kiểm correctness của skill `benchmark`/`benchmark-optimization-loop`; không tạo composite score, không biến tự mô tả thành chứng minh ưu thế kỹ thuật.

## 5. Gate chất lượng tiếp theo

| Rủi ro thực tế | Bằng chứng hiện có | Việc còn phải đo |
|---|---|---|
| Claim nhầm file hoặc asset | Matcher exact URL ưu tiên candidate; filename/MIME/kind/danger/byte fixtures pass | Live direct/fallback cùng lúc export log; URL redirect/provider thay đổi |
| Payload hỏng nhưng header đúng | Có kiểm MIME/extension/byte count; không kiểm container | Byte/hash hoặc parser file hợp lệ nếu thêm native/offscreen đường phù hợp, trong scope direct |
| Queue quá lớn | CPU/JSON byte của 5 corpus ở trên | Quota toàn storage, persistence latency và Side Panel rendering ở 1k/5k |
| DOM/API nền tảng đổi | YouTube progressive và Suno identity có fixture | Smoke test public cho từng adapter/provider được công bố hỗ trợ |
| Độ bền MV3 | Concurrency/recovery/Stop/checkpoint fixtures pass | Kill/reload worker thật trong browser, owned-tab cleanup và không tải trùng |

Phạm vi giữ nguyên: direct HTTP(S) công khai hoặc do trang người dùng có quyền xem cung cấp; không DRM/paywall/login bypass, blob-stream, ghép HLS/DASH hoặc vượt hạn chế Telegram. Các chức năng stream/conversion rộng của công cụ khác là khác biệt phạm vi, không phải lý do mở rộng đường bypass trong extension này.
