import { t, initLang, setLang, getLang, applyDom } from "./i18n.js";

const timeoutInput = document.getElementById("timeoutSeconds");
const folderInput = document.getElementById("downloadFolder");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const themeToggle = document.getElementById("themeToggle");
const langToggle = document.getElementById("langToggle");

initLang().then(() => {
  applyDom();
  langToggle.textContent = getLang() === "vi" ? "EN" : "VI";
});

langToggle.addEventListener("click", async () => {
  await setLang(getLang() === "vi" ? "en" : "vi");
  applyDom();
  langToggle.textContent = getLang() === "vi" ? "EN" : "VI";
});

chrome.storage.local.get(["timeoutSeconds", "downloadFolder", "theme"], (data) => {
  timeoutInput.value = data.timeoutSeconds || 90;
  folderInput.value = data.downloadFolder || "SO9-Downloads";
  if (data.theme === "light") document.documentElement.classList.add("light-theme");
});

saveBtn.addEventListener("click", async () => {
  try {
    const timeoutSeconds = Math.max(20, Math.min(300, Number(timeoutInput.value) || 90));
    const downloadFolder = normalizeFolder(folderInput.value || "SO9-Downloads");
    timeoutInput.value = timeoutSeconds;
    folderInput.value = downloadFolder;
    await chrome.storage.local.set({ timeoutSeconds, downloadFolder });
    saveStatus.textContent = t("Đã lưu cài đặt.");
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 1800);
  } catch (error) {
    saveStatus.textContent = t(`Không thể lưu: ${error.message || error}`);
  }
});

themeToggle.addEventListener("click", async () => {
  const isLight = document.documentElement.classList.toggle("light-theme");
  await chrome.storage.local.set({ theme: isLight ? "light" : "dark" });
});

function normalizeFolder(value) {
  const folder = String(value || "")
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/")
    .split("/")
    .map((segment) => segment.trim().replace(/[. ]+$/g, ""))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ? `_${segment}` : segment)
    .join("/");
  return folder || "SO9-Downloads";
}
