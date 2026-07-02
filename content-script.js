let lastDownloadElement = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    PREPARE_DOWNLOAD: () => prepareDownload(message.link),
    CLICK_FINAL_DOWNLOAD: () => clickFinalDownload(),
    FILL_AND_DOWNLOAD: () => legacyFillAndDownload(message.link)
  };

  const handler = handlers[message.type];
  if (!handler) return false;

  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

async function prepareDownload(link) {
  lastDownloadElement = null;

  const input = await waitForElement(findInput, 25000, "Không tìm thấy ô nhập link.");
  await typeLikeHuman(input, link);

  const button = findDownloadButton(input);
  if (!button) {
    throw new Error("Không tìm thấy nút tải xuống.");
  }

  clickLikeHuman(button);
  const candidate = await waitForDownloadCandidate(60000);
  lastDownloadElement = candidate.element || null;

  return serializeCandidate(candidate);
}

async function clickFinalDownload() {
  const candidate = lastDownloadElement && isVisible(lastDownloadElement)
    ? buildCandidate(lastDownloadElement)
    : await waitForDownloadCandidate(15000);

  if (!candidate?.element) {
    throw new Error("Không tìm thấy nút tải file cuối trên SO9.");
  }

  clickLikeHuman(candidate.element);
  return serializeCandidate(candidate);
}

async function legacyFillAndDownload(link) {
  const result = await prepareDownload(link);
  if (result.canFallbackClick) {
    await clickFinalDownload();
  }
  return result;
}

function findInput() {
  const so9Input = document.querySelector(".download-input-field input[type='text'], .download-input-field textarea");
  if (so9Input && isVisible(so9Input) && !so9Input.disabled) return so9Input;

  const inputs = [...document.querySelectorAll("input, textarea")];
  return inputs.find((input) => {
    const type = (input.getAttribute("type") || "").toLowerCase();
    const placeholder = normalizeText(input.getAttribute("placeholder") || "");
    return type !== "hidden" && !input.disabled && (
      placeholder.includes("link") ||
      placeholder.includes("url") ||
      input.tagName.toLowerCase() === "textarea" ||
      input.offsetParent !== null
    );
  }) || null;
}

function findDownloadButton(input) {
  const so9Button = input.closest(".download-input-field")?.querySelector(".origin-button, button");
  if (so9Button && isVisible(so9Button)) return so9Button;

  const formButton = input.closest("form")?.querySelector("button, input[type='submit'], [role='button']");
  if (formButton && isVisible(formButton)) return formButton;

  const nearbyButton = findNearbyDownloadButton(input);
  if (nearbyButton) return nearbyButton;

  return findButtonInScope(document);
}

function findButtonInScope(scope) {
  const candidates = [...scope.querySelectorAll("button, input[type='submit'], a, [role='button']")];
  return candidates.find((element) => {
    const text = normalizeText(getElementText(element));
    return isVisible(element) && /(tai\s*xuong|\bdownload\b|get\s*link|submit)/i.test(text);
  }) || null;
}

function findNearbyDownloadButton(input) {
  const inputRect = input.getBoundingClientRect();
  const candidates = [...document.querySelectorAll("button, input[type='submit'], [role='button']")]
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = normalizeText(getElementText(element));
      const verticalDistance = Math.abs(rect.top - inputRect.bottom);
      const horizontalOverlap = Math.min(rect.right, inputRect.right) - Math.max(rect.left, inputRect.left);
      return { element, text, verticalDistance, horizontalOverlap };
    })
    .filter((item) => {
      const hasDownloadText = /(tai\s*xuong|\bdownload\b|get\s*link|submit)/i.test(item.text);
      return hasDownloadText && item.verticalDistance < 180 && item.horizontalOverlap > 0;
    })
    .sort((a, b) => a.verticalDistance - b.verticalDistance);

  return candidates[0]?.element || null;
}

async function waitForDownloadCandidate(timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pageError = detectPageError();
    if (pageError) {
      throw new Error(pageError);
    }

    const candidate = findDownloadCandidate();
    if (candidate) return candidate;
    await sleep(700);
  }

  throw new Error("SO9 chưa tạo được file tải xuống trong thời gian chờ.");
}

function findDownloadCandidate() {
  const elements = [...document.querySelectorAll("a[href], button, [role='button']")]
    .filter(isVisible)
    .map(buildCandidate)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return elements[0] || null;
}

function buildCandidate(element) {
  const href = getElementHref(element);
  const normalizedText = normalizeText(getElementText(element));
  const containerText = normalizeText(getNearbyContainerText(element));
  const hasResultContext = containerText.includes("file tai xuong") ||
    containerText.includes("tai xuong") && containerText.includes("so9");
  const isDirect = isDirectMediaUrl(href);
  const isBlob = href.startsWith("blob:");
  const isPlainInitialButton = /^tai\s*xuong$/.test(normalizedText) && !hasResultContext && !href;

  if (isPlainInitialButton) return null;

  let score = 0;
  if (isDirect) score += 120;
  if (isBlob) score += 90;
  if (hasResultContext) score += 60;
  if (normalizedText.includes("download") || normalizedText.includes("tai xuong")) score += 30;
  if (element.hasAttribute("download")) score += 25;
  if (element.querySelector("svg,img")) score += 10;

  if (score < 50) return null;

  return {
    element,
    directUrl: isDirect && !isBlob ? href : "",
    filename: getSuggestedFilename(element, href),
    isBlobUrl: isBlob,
    canFallbackClick: true,
    score
  };
}

function serializeCandidate(candidate) {
  return {
    directUrl: candidate.directUrl || "",
    filename: candidate.filename || "",
    isBlobUrl: Boolean(candidate.isBlobUrl),
    canFallbackClick: Boolean(candidate.canFallbackClick),
    pageError: ""
  };
}

function getElementHref(element) {
  const rawHref = element.getAttribute("href") || element.dataset?.href || "";
  if (!rawHref) return "";
  try {
    return new URL(rawHref, location.href).href;
  } catch (_) {
    return rawHref;
  }
}

function getSuggestedFilename(element, href) {
  const downloadName = element.getAttribute("download") || "";
  if (downloadName) return downloadName;

  try {
    const url = new URL(href, location.href);
    const fileName = url.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(fileName.split("?")[0] || "");
  } catch (_) {
    return "";
  }
}

function getNearbyContainerText(element) {
  let current = element;
  for (let depth = 0; current && depth < 7; depth += 1) {
    const text = current.innerText || current.textContent || "";
    if (text && normalizeText(text).includes("file tai xuong")) return text;
    current = current.parentElement;
  }
  return element.closest("main, section, article, form, div")?.innerText || "";
}

function isDirectMediaUrl(href) {
  if (!href) return false;
  if (href.startsWith("blob:")) return true;
  try {
    const url = new URL(href, location.href);
    const pathname = url.pathname.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    return /\.(mp4|mov|webm|m4v|mkv|jpg|jpeg|png|webp)(\?|$)/i.test(pathname) ||
      (hostname.includes("cdn") && /\/(video|videos|media|downloader|download)\//i.test(pathname));
  } catch (_) {
    return false;
  }
}

function detectPageError() {
  const text = normalizeText(document.body.innerText || "");
  const invalidPatterns = [
    "link khong hop le",
    "khong hop le",
    "hay thu lai",
    "invalid link",
    "not valid"
  ];
  const matched = invalidPatterns.find((pattern) => text.includes(pattern));
  if (!matched) return "";
  return "SO9 báo link không hợp lệ hoặc không thể tải link này.";
}

async function typeLikeHuman(input, value) {
  clickLikeHuman(input);
  input.focus();
  input.select?.();
  document.execCommand?.("delete");
  setNativeValue(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));

  setNativeValue(input, value);
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: "insertFromPaste"
  }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(120);
}

function setNativeValue(input, value) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
}

function clickLikeHuman(element) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventOptions = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  element.dispatchEvent(new MouseEvent("mouseover", eventOptions));
  element.dispatchEvent(new MouseEvent("mousemove", eventOptions));
  element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
  element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  element.dispatchEvent(new MouseEvent("click", eventOptions));
  element.click?.();
}

function waitForElement(getter, timeoutMs, errorMessage) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const element = getter();
      if (element) {
        clearInterval(timer);
        resolve(element);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(errorMessage));
      }
    }, 300);
  });
}

function getElementText(element) {
  return [
    element.innerText,
    element.textContent,
    element.value,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("download")
  ].filter(Boolean).join(" ");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
