/**
 * ThreadLedger service worker.
 * Downloads use a data: URL. Blob URLs created in a service worker are not
 * reliable for chrome.downloads, and this extension does not add an offscreen
 * document or any permission beyond the manifest.
 */

/**
 * Percent-encode text as a data URL the downloads API can save.
 * @param {string} mime
 * @param {string} text
 * @returns {string}
 */
function toDataUrl(mime, text) {
  return "data:" + mime + ";charset=utf-8," + encodeURIComponent(text);
}

/**
 * Keep a download name inside the user's Downloads folder.
 * @param {string} filename
 * @returns {string}
 */
function safeFilename(filename) {
  const base = String(filename || "ThreadLedger.txt").split(/[/\\]/).pop();
  return base.replace(/[^A-Za-z0-9._ -]+/g, "-") || "ThreadLedger.txt";
}

/**
 * Save a text file the content script already built.
 * @param {{filename?: string, mime?: string, text?: string}} message
 * @returns {Promise<{ok: boolean, downloadId?: number, error?: string}>}
 */
function downloadText(message) {
  const filename = safeFilename(message.filename);
  const mime = message.mime || "text/plain";
  const url = toDataUrl(mime, String(message.text == null ? "" : message.text));
  return new Promise(function (resolve) {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
      conflictAction: "uniquify"
    }, function (downloadId) {
      const err = chrome.runtime.lastError;
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true, downloadId: downloadId });
    });
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "THREADLEDGER_DOWNLOAD") return;
  downloadText(message).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
