/**
 * Popup for the open Gmail tab. It never reads message bodies itself.
 */

/**
 * Return true for a Gmail URL.
 * @param {string} url
 * @returns {boolean}
 */
function isGmailUrl(url) {
  try {
    return new URL(url).hostname === "mail.google.com";
  } catch (err) {
    return false;
  }
}

/**
 * Return true when the hash looks like one open conversation.
 * @param {string} url
 * @returns {boolean}
 */
function isGmailThreadUrl(url) {
  if (!isGmailUrl(url)) return false;
  const hash = new URL(url).hash.replace(/^#/, "").split("?")[0];
  const parts = hash.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  return decodeURIComponent(parts[parts.length - 1]).length >= 6;
}

/**
 * Format the saved export for the status line.
 * @param {object|undefined} record
 * @returns {string}
 */
function exportLine(record) {
  if (!record || !record.at) return "No exports yet.";
  const when = new Date(record.at);
  const stamp = Number.isNaN(when.getTime())
    ? record.at
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const labels = { csv: "CSV", markdown: "Markdown", sheets: "Google Sheets", prompt: "AI prompt" };
  return "Last export: " + (labels[record.format] || record.format) + " · " + stamp + " · " + record.count + " messages";
}

/**
 * Format the saved health check.
 * @param {object|undefined} health
 * @returns {string}
 */
function healthLine(health) {
  if (!health || !health.checkedAt) return "No health check yet. Inventory a thread to run one.";
  if (health.ok) {
    return "Health check passed (" + health.good + " of " + health.total + " messages had a sender and a date).";
  }
  return "Gmail's layout may have changed. Results may be incomplete. Check for a ThreadLedger update. ("
    + health.good + " of " + health.total + " parsed.)";
}

/**
 * Fill the popup from the active tab and local storage.
 * @returns {Promise<void>}
 */
async function initPopup() {
  const inventory = document.getElementById("inventory");
  const hint = document.getElementById("hint");
  const exportNode = document.getElementById("export");
  const healthNode = document.getElementById("health");
  document.getElementById("promo").appendChild(createPromoCard("popup_footer"));
  document.getElementById("options").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });
  const stored = await chrome.storage.local.get(["threadledgerLastExport", "threadledgerHealth"]);
  exportNode.textContent = exportLine(stored.threadledgerLastExport);
  healthNode.textContent = healthLine(stored.threadledgerHealth);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : "";
  if (isGmailThreadUrl(url)) {
    inventory.hidden = false;
    hint.textContent = "This tab has a conversation open.";
    inventory.addEventListener("click", function () {
      chrome.tabs.sendMessage(tab.id, { type: "THREADLEDGER_INVENTORY" }, function () {
        if (chrome.runtime.lastError) {
          hint.textContent = "Reload the Gmail tab so ThreadLedger can see the conversation.";
          return;
        }
        hint.textContent = "Reading the thread in the Gmail tab.";
      });
    });
  } else if (isGmailUrl(url)) {
    hint.textContent = "Open one conversation, then inventory it.";
  } else {
    hint.textContent = "Open Gmail to use ThreadLedger.";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  initPopup().catch(function () {
    document.getElementById("hint").textContent = "ThreadLedger could not read this tab.";
  });
});
