const timeoutInput = document.getElementById("timeoutSeconds");
const folderInput = document.getElementById("downloadFolder");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const themeToggle = document.getElementById("themeToggle");

chrome.storage.local.get(["timeoutSeconds", "downloadFolder", "theme"], (data) => {
  timeoutInput.value = data.timeoutSeconds || 90;
  folderInput.value = data.downloadFolder || "SO9-Downloads";
  if (data.theme === "light") document.documentElement.classList.add("light-theme");
});

saveBtn.addEventListener("click", async () => {
  const timeoutSeconds = Math.max(20, Math.min(300, Number(timeoutInput.value) || 90));
  const downloadFolder = normalizeFolder(folderInput.value || "SO9-Downloads");
  timeoutInput.value = timeoutSeconds;
  folderInput.value = downloadFolder;
  await chrome.storage.local.set({ timeoutSeconds, downloadFolder });
  saveStatus.textContent = "Đã lưu cài đặt.";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 1800);
});

themeToggle.addEventListener("click", async () => {
  const isLight = document.documentElement.classList.toggle("light-theme");
  await chrome.storage.local.set({ theme: isLight ? "light" : "dark" });
});

function normalizeFolder(value) {
  return value
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\\/]+/g, "/") || "SO9-Downloads";
}
