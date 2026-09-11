import test from "node:test";
import assert from "node:assert/strict";
import { t } from "../src/shared/i18n.js";

test("i18n translates exact, templated and nested Vietnamese messages", () => {
  assert.equal(t("Tạm dừng", "en"), "Pause");
  assert.equal(t("Đã lưu 12 link", "en"), "12 links saved");
  assert.equal(t("Đang xử lý tiktok: https://t", "en"), "Processing tiktok: https://t");
  assert.equal(
    t("Thất bại: https://x.com/1 - DOWNLOAD_MISMATCH: Máy chủ trả về nội dung không phải video.", "en"),
    "Failed: https://x.com/1 - DOWNLOAD_MISMATCH: The server returned non-video content."
  );
  assert.equal(t("snaptik.app thất bại: Không tìm thấy ô nhập link.. Thử nguồn tiếp theo.", "en"), "snaptik.app failed: Link input box not found.. Trying the next source.");
  assert.equal(t("Chuỗi lạ", "en"), "Chuỗi lạ", "unknown strings pass through");
  assert.equal(t("Tạm dừng", "vi"), "Tạm dừng");
});
