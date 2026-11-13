/**
 * ThreadLedger content script.
 * Reads the Gmail thread already on screen, expands it, and opens a local table.
 * Every selector lives in SELECTORS. Prefer ARIA, labels, and data attributes.
 */
const SELECTORS = {
  main: [
    'div[role="main"]',
    '[role="main"]'
  ],
  subject: [
    "h2[data-thread-perm-id]",
    "h2[data-legacy-thread-id]",
    '[role="main"] h2',
    "h2[data-thread-id]"
  ],
  threadId: [
    "[data-thread-id]",
    "h2[data-legacy-thread-id]",
    "h2[data-thread-perm-id]"
  ],
  message: [
    "[data-message-id]",
    "[data-legacy-message-id]",
    '[role="list"] > [role="listitem"]'
  ],
  sender: [
    '[data-field="from"] [email]',
    "header [email]",
    "span[email]",
    "[data-hovercard-id][name]",
    "[email]",
    '[data-field="from"] [name]',
    "header [name]",
    "span[name]"
  ],
  date: [
    "time[title]",
    "time[datetime]",
    "[data-tooltip]",
    "span[title]",
    "[alt]"
  ],
  body: [
    "[data-message-body]",
    '[aria-label="Message body"]',
    "div.a3s.aiL",
    "div.a3s",
    "div.ii.gt"
  ],
  snippet: [
    "[data-snippet]",
    "span.y2"
  ],
  quote: [
    ".gmail_quote",
    ".gmail_extra",
    ".gmail_attr",
    "blockquote.gmail_quote",
    '[data-quoted="true"]'
  ],
  attachment: [
    "[data-attachment-name]",
    '[aria-label="Attachments"] li',
    "[download_url]",
    "span.aV3"
  ],
  toolbar: [
    '[gh="mtb"]',
    'div[role="main"] [role="toolbar"]',
    'div[gh="tm"]',
    ".G-atb",
    ".iH .G-tF"
  ],
  older: [
    "[data-threadledger-older]",
    '[aria-label*="older message" i]',
    '[aria-label*="mensaje" i][aria-label*="antiguo" i]',
    '[aria-label*="messages plus anciens" i]',
    '[aria-label*="ältere" i]',
    '[aria-label*="mensagens mais antigas" i]'
  ],
  accountEmail: [
    'a[aria-label*="Google Account"]',
    'a[aria-label*="Cuenta de Google"]',
    'a[aria-label*="Compte Google"]',
    'a[aria-label*="Google-Konto"]',
    'a[aria-label*="Conta do Google"]',
    'a[href*="SignOutOptions"]',
    "[data-email]"
  ]
};

const MAX_MESSAGES = 2000;
const BATCH_SIZE = 25;
const HEALTH_TEXT = "Gmail's layout may have changed. Results may be incomplete. Check for a ThreadLedger update.";
const OLDER_RE = /(\d[\d.\s,]*)\s+(older messages?|mensajes? m[aá]s antiguos?|messages? plus anciens?|[aä]ltere nachrichten|mensagens? mais antigas)/i;

let activeRun = null;
let panelState = null;
let saveTimer = 0;
let scanTimer = 0;

/**
 * Wait for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Yield so a long thread does not freeze Gmail.
 * @returns {Promise<void>}
 */
function idle() {
  return new Promise(function (resolve) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(function () { resolve(); }, { timeout: 500 });
    else setTimeout(resolve, 50);
  });
}

/**
 * Poll until a condition is true or the timeout expires.
 * @param {function(): boolean} fn
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  return new Promise(function (resolve) {
    function tick() {
      let done = false;
      try { done = Boolean(fn()); } catch (err) { done = false; }
      if (done || Date.now() - start >= timeoutMs) resolve(done);
      else setTimeout(tick, 50);
    }
    tick();
  });
}

/**
 * Read one or more local storage keys.
 * @param {string[]} keys
 * @returns {Promise<object>}
 */
function storageGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, function (data) { resolve(data || {}); });
  });
}

/**
 * Write local storage keys.
 * @param {object} values
 * @returns {Promise<void>}
 */
function storageSet(values) {
  return new Promise(function (resolve) {
    chrome.storage.local.set(values, function () { resolve(); });
  });
}

/**
 * Thread id from the Gmail hash, ignoring a compose query.
 * @param {string} [hash]
 * @returns {string}
 */
function threadKeyFromHash(hash) {
  const clean = String(hash == null ? location.hash : hash).replace(/^#/, "").split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  const id = decodeURIComponent(parts[parts.length - 1]);
  return id.length >= 6 ? id : "";
}

/**
 * Return the open conversation id.
 * @returns {string}
 */
function threadIdFromLocation() {
  const fromHash = threadKeyFromHash(location.hash);
  if (fromHash) return fromHash;
  const node = queryFirst(document, SELECTORS.threadId);
  if (!node) return "";
  return node.getAttribute("data-thread-id")
    || node.getAttribute("data-legacy-thread-id")
    || node.getAttribute("data-thread-perm-id")
    || "";
}

/**
 * Return true when this run is still looking at the same conversation.
 * @param {{threadId: string}} run
 * @returns {boolean}
 */
function sameThread(run) {
  return Boolean(run && run.threadId && run.threadId === threadKeyFromHash(location.hash));
}

/**
 * Return true when a single conversation is open.
 * @returns {boolean}
 */
function isThreadView() {
  if (!threadKeyFromHash(location.hash)) return false;
  return listMessageElements(document, SELECTORS).length > 0;
}

/**
 * Read the account address from the Gmail account switcher.
 * @returns {string}
 */
function readAccountEmail() {
  const nodes = queryAll(document, SELECTORS.accountEmail);
  for (let i = 0; i < nodes.length; i += 1) {
    const blob = [
      nodes[i].getAttribute("aria-label") || "",
      nodes[i].getAttribute("data-email") || "",
      nodes[i].getAttribute("title") || ""
    ].join(" ");
    const match = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return match[0];
  }
  return "";
}

/**
 * Read the conversation subject from the heading or the document title.
 * @returns {string}
 */
function readThreadSubject() {
  const heading = queryFirst(document, SELECTORS.subject);
  if (heading) {
    const text = (heading.innerText || heading.textContent || "").trim();
    if (text) return text;
  }
  return String(document.title || "")
    .replace(/\s[-–—]\s+[^\-–—]+@[^\s]+\s[-–—]\s+Gmail\s*$/i, "")
    .trim();
}

/**
 * Find the scrollable ancestor of a node.
 * @param {Element} el
 * @returns {Element}
 */
function scrollParent(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const overflow = style.overflow + style.overflowY;
    if (/(auto|scroll)/.test(overflow) && node.scrollHeight > node.clientHeight + 20) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Move the thread scroller. Returns false at the end.
 * @param {number} direction
 * @returns {boolean}
 */
function scrollThread(direction) {
  const messages = listMessageElements(document, SELECTORS);
  const anchor = messages[0] || queryFirst(document, SELECTORS.main);
  if (!anchor) return false;
  const scroller = scrollParent(anchor);
  const before = scroller.scrollTop;
  const delta = Math.max(180, scroller.clientHeight * 0.75) * direction;
  scroller.scrollTop = Math.max(0, before + delta);
  return scroller.scrollTop !== before;
}

/**
 * Return the control that loads folded older messages.
 * @returns {Element|null}
 */
function findOlderControl() {
  const scope = queryFirst(document, SELECTORS.main) || document.body;
  const selectors = SELECTORS.older || [];
  for (let i = 0; i < selectors.length; i += 1) {
    let nodes;
    try { nodes = scope.querySelectorAll(selectors[i]); } catch (err) { continue; }
    for (let n = 0; n < nodes.length; n += 1) {
      const blob = (nodes[n].getAttribute("aria-label") || "") + " " + (nodes[n].textContent || "");
      if (OLDER_RE.test(blob)) return clickable(nodes[n]);
    }
  }
  const buttons = scope.querySelectorAll('[role="button"], button');
  for (let i = 0; i < buttons.length; i += 1) {
    const blob = (buttons[i].getAttribute("aria-label") || "") + " " + (buttons[i].innerText || "");
    if (OLDER_RE.test(blob)) return buttons[i];
  }
  return null;
}

/**
 * Click the node, or the nearest button that contains it.
 * @param {Element} node
 * @returns {Element}
 */
function clickable(node) {
  if (node.getAttribute("role") === "button" || node.tagName === "BUTTON") return node;
  return node.closest('[role="button"], button') || node;
}

/**
 * Return true when a message is still folded.
 * @param {Element} message
 * @returns {boolean}
 */
function isCollapsed(message) {
  if (message.getAttribute("aria-expanded") === "true") return false;
  if (message.querySelector('[aria-expanded="true"]')) return false;
  if (message.getAttribute("aria-expanded") === "false") return true;
  if (message.querySelector('[aria-expanded="false"]')) return true;
  return !findBody(message, SELECTORS);
}

/**
 * Find the control that expands one message.
 * @param {Element} message
 * @returns {Element}
 */
function expandControl(message) {
  if (message.getAttribute("aria-expanded") === "false") return message;
  return message.querySelector('[aria-expanded="false"]')
    || message.querySelector('[role="button"]')
    || message;
}

/**
 * Estimate how many messages the thread contains.
 * @returns {number}
 */
function estimateTotal() {
  const older = findOlderControl();
  let hidden = 0;
  if (older) {
    const text = (older.getAttribute("aria-label") || "") + " " + (older.innerText || "");
    const match = text.match(/(\d[\d.\s,]*)/);
    if (match) hidden = Number(match[1].replace(/[^\d]/g, "")) || 0;
  }
  const inDom = listMessageElements(document, SELECTORS).length;
  const total = hidden > inDom ? hidden : Math.max(inDom, hidden);
  return Math.min(MAX_MESSAGES, total || inDom);
}

/**
 * Keep the best parse of each message while Gmail scrolls and recycles rows.
 * @param {object} settings
 * @returns {{harvest: function(): void, count: function(): number, finish: function(): object[]}}
 */
function createCollector(settings) {
  const accountEmail = readAccountEmail();
  const threadSubject = readThreadSubject();
  const order = [];
  const map = new Map();
  function harvest() {
    const messages = listMessageElements(document, SELECTORS);
    for (let i = 0; i < messages.length && order.length < MAX_MESSAGES; i += 1) {
      const row = parseMessageElement(messages[i], SELECTORS, {
        firstLineLength: settings.firstLineLength,
        includeQuoted: settings.includeQuoted,
        dateFormat: settings.dateFormat,
        accountEmail: accountEmail,
        threadSubject: threadSubject
      });
      const id = row.id || "row-" + row.fromEmail + "-" + row.dateOriginal + "-" + row.firstLine.slice(0, 24);
      row.id = id;
      const previous = map.get(id);
      if (!previous) {
        map.set(id, row);
        order.push(id);
        continue;
      }
      const richer = (row.firstLine || "").length > (previous.firstLine || "").length
        || (row.dateSort && !previous.dateSort)
        || (row.fromEmail && !previous.fromEmail)
        || (row.attachments && !previous.attachments);
      if (richer) {
        row.category = previous.category;
        row.notes = previous.notes;
        map.set(id, row);
      }
    }
  }
  return {
    harvest: harvest,
    count: function () { return order.length; },
    finish: function () {
      return order.slice(0, MAX_MESSAGES).map(function (id, index) {
        const row = map.get(id);
        row.index = index + 1;
        return row;
      });
    }
  };
}

/**
 * Expand folded messages in batches, then yield with requestIdleCallback.
 * @param {{cancelled: boolean, capped: boolean, threadId: string}} run
 * @param {{harvest: function(): void}} collector
 * @returns {Promise<void>}
 */
async function expandAll(run, collector) {
  const older = findOlderControl();
  if (older && sameThread(run) && !run.cancelled) {
    older.click();
    await waitUntil(function () { return !findOlderControl() || run.cancelled || !sameThread(run); }, 4000);
    await idle();
  }
  const tried = new WeakSet();
  let expanded = 0;
  let loops = 0;
  let stagnant = 0;
  while (expanded < MAX_MESSAGES && loops < 5000 && stagnant < 5) {
    loops += 1;
    if (run.cancelled || !sameThread(run)) return;
    const collapsed = listMessageElements(document, SELECTORS).filter(function (el) {
      return isCollapsed(el) && !tried.has(el);
    });
    if (!collapsed.length) {
      collector.harvest();
      stagnant = scrollThread(1) ? 0 : stagnant + 1;
      await idle();
      continue;
    }
    stagnant = 0;
    const batch = collapsed.slice(0, BATCH_SIZE);
    for (let i = 0; i < batch.length; i += 1) {
      if (run.cancelled || !sameThread(run)) return;
      const message = batch[i];
      tried.add(message);
      try { message.scrollIntoView({ block: "center", inline: "nearest" }); } catch (err) { /* keep going */ }
      expandControl(message).click();
      await waitUntil(function () { return !isCollapsed(message); }, 1200);
      expanded += 1;
      const total = Math.max(estimateTotal(), expanded);
      showToast("Expanding " + Math.min(expanded, total) + " of " + total + "…");
    }
    collector.harvest();
    await idle();
  }
  if (expanded >= MAX_MESSAGES) run.capped = true;
}

/**
 * Scroll the thread and keep harvesting so virtualized rows are included.
 * @param {{cancelled: boolean, threadId: string}} run
 * @param {{harvest: function(): void, count: function(): number, finish: function(): object[]}} collector
 * @returns {Promise<object[]>}
 */
async function collectAll(run, collector) {
  const first = listMessageElements(document, SELECTORS)[0];
  if (first) scrollParent(first).scrollTop = 0;
  let stagnant = 0;
  let loops = 0;
  while (loops < 500 && stagnant < 4 && collector.count() < MAX_MESSAGES) {
    loops += 1;
    if (!sameThread(run)) break;
    if (run.cancelled && loops > 1) break;
    const before = collector.count();
    collector.harvest();
    showToast("Reading " + collector.count() + " messages…");
    const moved = scrollThread(1);
    stagnant = !moved && collector.count() === before ? stagnant + 1 : 0;
    await idle();
  }
  if (sameThread(run)) collector.harvest();
  if (first) {
    try { first.scrollIntoView({ block: "start" }); } catch (err) { /* ignore */ }
  }
  return collector.finish();
}

/**
 * Show or update the progress toast.
 * @param {string} text
 * @returns {void}
 */
function showToast(text) {
  let toast = document.querySelector('[data-threadledger="toast"]');
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "threadledger-toast";
    toast.dataset.threadledger = "toast";
    toast.setAttribute("role", "status");
    const label = document.createElement("span");
    label.dataset.threadledger = "toast-text";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "threadledger-toast-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () {
      if (activeRun) activeRun.cancelled = true;
    });
    toast.append(label, cancel);
    document.body.appendChild(toast);
  }
  toast.querySelector('[data-threadledger="toast-text"]').textContent = text;
}

/**
 * Remove the progress toast.
 * @returns {void}
 */
function removeToast() {
  const toast = document.querySelector('[data-threadledger="toast"]');
  if (toast) toast.remove();
}

/**
 * Show the layout-health warning on the Gmail page.
 * @returns {void}
 */
function showHealthBanner() {
  let banner = document.querySelector('[data-threadledger="banner"]');
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "threadledger-banner";
    banner.dataset.threadledger = "banner";
    banner.setAttribute("role", "alert");
    const text = document.createElement("span");
    text.textContent = HEALTH_TEXT;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "threadledger-banner-close";
    close.textContent = "Dismiss";
    close.addEventListener("click", function () { banner.remove(); });
    banner.append(text, close);
    document.body.appendChild(banner);
  }
}

/**
 * Remove the layout-health warning.
 * @returns {void}
 */
function removeHealthBanner() {
  const banner = document.querySelector('[data-threadledger="banner"]');
  if (banner) banner.remove();
}

/**
 * Find a toolbar inside the open conversation.
 * @returns {Element|null}
 */
function findToolbar() {
  const messages = listMessageElements(document, SELECTORS);
  if (!messages.length) return null;
  const main = messages[0].closest('[role="main"]') || document.body;
  for (let i = 0; i < SELECTORS.toolbar.length; i += 1) {
    let nodes;
    try { nodes = main.querySelectorAll(SELECTORS.toolbar[i]); } catch (err) { continue; }
    if (nodes.length) return nodes[0];
  }
  return null;
}

/**
 * Put the inventory button in the toolbar, or float it if the toolbar is missing.
 * @returns {void}
 */
function ensureButton() {
  let button = document.querySelector('[data-threadledger="launch"]');
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.dataset.threadledger = "launch";
    button.textContent = "Inventory this thread";
    button.addEventListener("click", function () { startInventory(); });
  }
  const toolbar = findToolbar();
  if (toolbar) {
    button.className = "threadledger-btn";
    if (button.parentElement !== toolbar) toolbar.appendChild(button);
  } else {
    button.className = "threadledger-btn threadledger-fab";
    if (button.parentElement !== document.body) document.body.appendChild(button);
  }
}

/**
 * Remove the inventory button when the conversation is closed.
 * @returns {void}
 */
function removeLaunchers() {
  const button = document.querySelector('[data-threadledger="launch"]');
  if (button) button.remove();
}

/**
 * Disable the inventory button while a run is in progress.
 * @param {boolean} busy
 * @returns {void}
 */
function setButtonBusy(busy) {
  const button = document.querySelector('[data-threadledger="launch"]');
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Reading thread…" : "Inventory this thread";
}

/**
 * Copy text, with a textarea fallback for the Gmail page.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw err;
  }
}

/**
 * Remember the latest export for the popup.
 * @param {string} format
 * @param {number} count
 * @param {string} subject
 * @returns {Promise<void>}
 */
function rememberExport(format, count, subject) {
  return storageSet({
    threadledgerLastExport: {
      at: new Date().toISOString(),
      format: format,
      count: count,
      subject: subject || ""
    }
  });
}

/**
 * Show the Drive I/O card once a copy or download has succeeded.
 * @param {ShadowRoot} shadow
 * @returns {void}
 */
function showExportPromo(shadow) {
  const slot = shadow.querySelector("[data-threadledger-promo]");
  if (!slot || slot.childElementCount) return;
  slot.appendChild(createPromoCard("export_success"));
}

/**
 * Build the About metadata for an export.
 * @returns {{subject: string, count: number, exportedAt: string}}
 */
function currentAbout() {
  return {
    subject: panelState.subject || "",
    count: panelState.rows.length,
    exportedAt: formatNowIso(new Date())
  };
}

/**
 * Columns for the open panel, honoring the date-format setting.
 * @returns {{key: string, header: string}[]}
 */
function currentColumns() {
  const header = panelState.settings.dateFormat === "local" ? "Date (local)" : "Date (ISO)";
  return exportColumns(header);
}

/**
 * Write a short status line in the panel.
 * @param {string} text
 * @param {boolean} isError
 * @returns {void}
 */
function setStatus(text, isError) {
  if (!panelState || !panelState.shadow) return;
  const status = panelState.shadow.querySelector("[data-threadledger-status]");
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = isError ? "error" : "ok";
}

/**
 * Categories already used anywhere on this device, plus the defaults.
 * @returns {string[]}
 */
function suggestionList() {
  const values = [];
  const seen = new Set();
  function add(value) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    values.push(text);
  }
  (panelState.settings.categories || []).forEach(add);
  const notes = panelState.notes || {};
  Object.keys(notes).forEach(function (threadId) {
    const bucket = notes[threadId] || {};
    Object.keys(bucket).forEach(function (id) { add(bucket[id] && bucket[id].category); });
  });
  panelState.rows.forEach(function (row) { add(row.category); });
  return values;
}

/**
 * Refresh the category suggestion list.
 * @returns {void}
 */
function fillSuggestions() {
  const list = panelState.shadow.getElementById("tl-cats");
  if (!list) return;
  list.replaceChildren();
  suggestionList().forEach(function (value) {
    const option = document.createElement("option");
    option.value = value;
    list.appendChild(option);
  });
}

/**
 * Save category and notes for this thread.
 * @returns {void}
 */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    const bucket = {};
    panelState.rows.forEach(function (row) {
      if (row.category || row.notes) bucket[row.id] = { category: row.category || "", notes: row.notes || "" };
    });
    storageGet(["threadledgerNotes"]).then(function (data) {
      const notes = data.threadledgerNotes || {};
      notes[panelState.threadId] = bucket;
      panelState.notes = notes;
      fillSuggestions();
      return storageSet({ threadledgerNotes: notes });
    }).catch(function () { setStatus("Could not save notes on this device.", true); });
  }, 200);
}

/**
 * Return true when a row matches the search box and sender filter.
 * @param {object} row
 * @param {string} query
 * @param {string} sender
 * @returns {boolean}
 */
function rowVisible(row, query, sender) {
  if (sender && row.fromEmail !== sender) return false;
  if (!query) return true;
  const blob = [
    row.date, row.time, row.dateOriginal, row.fromName, row.fromEmail, row.to, row.cc, row.bcc,
    row.subject, row.attachments, row.firstLine, row.links, row.category, row.notes, row.kind
  ].join("\n").toLowerCase();
  return blob.indexOf(query) !== -1;
}

/**
 * Sort row objects. Empty dates stay at the bottom when sorting by date ascending.
 * @param {object[]} rows
 * @param {string} key
 * @param {string} direction
 * @returns {object[]}
 */
function sortRows(rows, key, direction) {
  const mul = direction === "desc" ? -1 : 1;
  return rows.slice().sort(function (a, b) {
    let cmp = 0;
    if (key === "index") cmp = a.index - b.index;
    else if (key === "date") {
      if (!a.dateSort && !b.dateSort) cmp = a.index - b.index;
      else if (!a.dateSort) cmp = 1;
      else if (!b.dateSort) cmp = -1;
      else cmp = a.dateSort.localeCompare(b.dateSort) || (a.index - b.index);
    } else {
      cmp = String(a[key] == null ? "" : a[key]).localeCompare(String(b[key] == null ? "" : b[key]), undefined, {
        numeric: true,
        sensitivity: "base"
      }) || (a.index - b.index);
    }
    return cmp * mul;
  });
}

/**
 * Rows currently shown in the table.
 * @returns {object[]}
 */
function visibleRows() {
  const query = panelState.query.trim().toLowerCase();
  return sortRows(
    panelState.rows.filter(function (row) { return rowVisible(row, query, panelState.sender); }),
    panelState.sortKey,
    panelState.sortDir
  );
}

/**
 * Create an element with an optional class and text.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Draw the table body from the current filter and sort.
 * @returns {void}
 */
function renderTable() {
  const shadow = panelState.shadow;
  const body = shadow.querySelector("tbody");
  const shown = visibleRows();
  body.replaceChildren();
  shadow.querySelector("[data-threadledger-count]").textContent = "Showing " + shown.length + " of " + panelState.rows.length;
  if (!shown.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = currentColumns().length;
    cell.textContent = panelState.rows.length
      ? "No messages match this filter."
      : "No messages were found in this thread.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }
  shown.forEach(function (record) {
    const row = document.createElement("tr");
    currentColumns().forEach(function (column) {
      const cell = document.createElement("td");
      cell.dir = "auto";
      if (column.key === "category" || column.key === "notes") {
        const input = document.createElement("input");
        input.type = "text";
        input.value = record[column.key] || "";
        input.setAttribute("aria-label", column.header + " for message " + record.index);
        if (column.key === "category") input.setAttribute("list", "tl-cats");
        input.addEventListener("input", function () {
          record[column.key] = input.value;
          scheduleSave();
        });
        cell.appendChild(input);
      } else {
        cell.textContent = record[column.key] == null ? "" : String(record[column.key]);
      }
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

/**
 * Rebuild the sender filter from the rows.
 * @param {HTMLSelectElement} select
 * @returns {void}
 */
function fillSenders(select) {
  const current = panelState.sender;
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All senders";
  select.appendChild(all);
  const seen = new Set();
  panelState.rows.forEach(function (row) {
    if (!row.fromEmail || seen.has(row.fromEmail)) return;
    seen.add(row.fromEmail);
    const option = document.createElement("option");
    option.value = row.fromEmail;
    option.textContent = row.fromName ? row.fromName + " <" + row.fromEmail + ">" : row.fromEmail;
    select.appendChild(option);
  });
  select.value = current;
}

/**
 * Copy or download, then show the success card only when it worked.
 * @param {string} kind
 * @returns {Promise<void>}
 */
async function runExport(kind) {
  const columns = currentColumns();
  const about = currentAbout();
  const rows = panelState.rows;
  try {
    if (kind === "sheets") {
      await copyText(recordsToTsv(rows, about, columns, true));
      await rememberExport("sheets", rows.length, panelState.subject);
      setStatus("Copied " + rows.length + " rows for Google Sheets.");
    } else if (kind === "prompt") {
      const tsv = recordsToTsv(rows, about, columns, false);
      await copyText(buildAiPrompt(tsv, panelState.settings.categories));
      await rememberExport("prompt", rows.length, panelState.subject);
      setStatus("Copied a categorizing prompt. Paste it into your own AI tool. ThreadLedger does not call one.");
    } else if (kind === "csv" || kind === "markdown") {
      const isCsv = kind === "csv";
      const text = isCsv ? recordsToCsv(rows, about, columns) : recordsToMarkdown(rows, about);
      const filename = exportFilename(panelState.subject, new Date(), isCsv ? "csv" : "md");
      const response = await chrome.runtime.sendMessage({
        type: "THREADLEDGER_DOWNLOAD",
        filename: filename,
        mime: isCsv ? "text/csv" : "text/markdown",
        text: text
      });
      if (!response || !response.ok) {
        setStatus((response && response.error) || "Download failed.", true);
        return;
      }
      await rememberExport(kind, rows.length, panelState.subject);
      setStatus("Download started: " + filename);
    }
    showExportPromo(panelState.shadow);
  } catch (err) {
    setStatus("Could not finish that export.", true);
  }
}

/**
 * Close the results panel.
 * @returns {void}
 */
function closePanel() {
  const host = document.querySelector('[data-threadledger="panel-host"]');
  if (host) host.remove();
  panelState = null;
}

/**
 * Styles for the shadow-DOM panel. Gmail's CSS cannot reach inside the shadow root.
 * @returns {string}
 */
function panelCss() {
  return [
    ":host { all: initial; }",
    ".tl-backdrop { position: fixed; inset: 0; background: rgba(32,33,36,.45); display: flex; align-items: stretch; justify-content: center; padding: 16px; box-sizing: border-box; font-family: 'Google Sans', Roboto, Arial, sans-serif; color: #202124; }",
    ".tl-panel { background: #fff; width: min(1120px, 100%); display: flex; flex-direction: column; border-radius: 8px; box-shadow: 0 8px 28px rgba(60,64,67,.28); overflow: hidden; }",
    ".tl-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 14px 16px 10px; border-bottom: 1px solid #dadce0; }",
    ".tl-header h1 { font-size: 18px; line-height: 1.3; margin: 0 0 4px; font-weight: 500; }",
    ".tl-privacy, .tl-footer { color: #5f6368; font-size: 12px; line-height: 1.45; margin: 0; }",
    ".tl-close, .tl-tools button, .tl-tools select, .tl-tools input { font: inherit; }",
    ".tl-close { border: 1px solid #dadce0; background: #fff; color: #3c4043; border-radius: 4px; padding: 6px 10px; cursor: pointer; }",
    ".tl-note { margin: 10px 16px 0; background: #fef7e0; color: #8a4b00; border-radius: 4px; padding: 8px 10px; font-size: 13px; }",
    ".tl-note.bad { background: #fce8e6; color: #c5221f; }",
    ".tl-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; }",
    ".tl-tools input[type='search'] { flex: 1 1 180px; border: 1px solid #dadce0; border-radius: 4px; padding: 7px 8px; min-width: 160px; }",
    ".tl-tools select { border: 1px solid #dadce0; border-radius: 4px; padding: 7px 8px; background: #fff; max-width: 240px; }",
    ".tl-tools button { border: 1px solid #dadce0; background: #fff; color: #1a73e8; border-radius: 4px; padding: 7px 10px; cursor: pointer; font-weight: 500; }",
    ".tl-tools button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }",
    ".tl-tools button:hover, .tl-close:hover { background: #f6fafe; }",
    ".tl-tools button.primary:hover { background: #1765cc; }",
    ".tl-count { color: #5f6368; font-size: 12px; }",
    ".tl-status { min-height: 18px; padding: 0 16px 8px; font-size: 12px; color: #188038; }",
    ".tl-status[data-tone='error'] { color: #c5221f; }",
    ".tl-tablewrap { flex: 1; overflow: auto; border-top: 1px solid #dadce0; }",
    "table { width: 100%; border-collapse: collapse; font-size: 12.5px; }",
    "th { position: sticky; top: 0; background: #f8f9fa; text-align: left; z-index: 1; border-bottom: 1px solid #dadce0; }",
    "th button { all: unset; cursor: pointer; display: block; width: 100%; padding: 8px; font-weight: 600; box-sizing: border-box; }",
    "td { border-bottom: 1px solid #f1f3f4; padding: 6px 8px; vertical-align: top; max-width: 280px; }",
    "td input { width: 100%; box-sizing: border-box; border: 1px solid #dadce0; border-radius: 4px; padding: 4px 6px; font: inherit; }",
    ".tl-footer { padding: 10px 16px 12px; border-top: 1px solid #dadce0; }",
    ".tl-promo { padding: 0 16px 12px; }"
  ].join("\n");
}

/**
 * Open the results table in a shadow root.
 * @param {object[]} rows
 * @param {object} settings
 * @param {object} flags
 * @returns {void}
 */
function openPanel(rows, settings, flags) {
  closePanel();
  const host = document.createElement("div");
  host.dataset.threadledger = "panel-host";
  host.style.all = "initial";
  host.style.display = "block";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  const shadow = host.attachShadow({ mode: "open" });
  panelState = {
    rows: rows,
    settings: settings,
    notes: flags.notes || {},
    threadId: flags.threadId,
    threadKey: location.hash,
    subject: flags.subject || "",
    sortKey: "index",
    sortDir: "asc",
    query: "",
    sender: "",
    shadow: shadow
  };
  const style = document.createElement("style");
  style.textContent = panelCss();
  const backdrop = el("div", "tl-backdrop");
  const panel = el("div", "tl-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "tl-title");
  panel.tabIndex = -1;
  const header = el("div", "tl-header");
  const titles = el("div", "");
  titles.append(el("h1", "", "ThreadLedger"));
  titles.querySelector("h1").id = "tl-title";
  titles.append(el("p", "tl-privacy", "ThreadLedger reads this open Gmail thread in your browser. Nothing is uploaded, tracked, or sent to a server."));
  const close = el("button", "tl-close", "Close");
  close.type = "button";
  close.addEventListener("click", closePanel);
  header.append(titles, close);
  panel.appendChild(header);
  if (flags.partial) panel.appendChild(el("div", "tl-note", "Stopped early. The table shows the messages read so far."));
  if (flags.capped) panel.appendChild(el("div", "tl-note", "Stopped at 2,000 messages."));
  if (flags.health && !flags.health.ok) panel.appendChild(el("div", "tl-note bad", HEALTH_TEXT));
  const tools = el("div", "tl-tools");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search all columns";
  search.setAttribute("aria-label", "Search all columns");
  search.addEventListener("input", function () {
    panelState.query = search.value;
    renderTable();
  });
  const sender = document.createElement("select");
  sender.setAttribute("aria-label", "Filter by sender");
  sender.addEventListener("change", function () {
    panelState.sender = sender.value;
    renderTable();
  });
  const count = el("span", "tl-count", "");
  count.setAttribute("data-threadledger-count", "1");
  tools.append(search, sender, count);
  [
    ["Copy for Google Sheets", "sheets", true],
    ["Download CSV", "csv", false],
    ["Download Markdown timeline", "markdown", false],
    ["Copy AI categorizing prompt", "prompt", false]
  ].forEach(function (item) {
    const button = el("button", item[2] ? "primary" : "", item[0]);
    button.type = "button";
    button.addEventListener("click", function () { runExport(item[1]); });
    tools.appendChild(button);
  });
  panel.appendChild(tools);
  const hint = el("p", "tl-privacy", "Copy and download include every message, not just the filtered view. Category and notes are saved on this device for this thread.");
  hint.style.padding = "0 16px";
  panel.appendChild(hint);
  const status = el("div", "tl-status", "");
  status.setAttribute("data-threadledger-status", "1");
  panel.appendChild(status);
  const wrap = el("div", "tl-tablewrap");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  currentColumns().forEach(function (column) {
    const th = document.createElement("th");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = column.key === "date" ? "date" : column.key;
    button.textContent = column.header;
    button.addEventListener("click", function () {
      const key = column.key === "date" ? "date" : column.key;
      panelState.sortDir = panelState.sortKey === key && panelState.sortDir === "asc" ? "desc" : "asc";
      panelState.sortKey = key;
      thead.querySelectorAll("button").forEach(function (other) {
        other.textContent = other.dataset.label;
      });
      button.textContent = button.dataset.label + (panelState.sortDir === "asc" ? " ▲" : " ▼");
      renderTable();
    });
    button.dataset.label = column.header;
    th.appendChild(button);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  wrap.appendChild(table);
  panel.appendChild(wrap);
  const datalist = document.createElement("datalist");
  datalist.id = "tl-cats";
  panel.appendChild(datalist);
  const promo = el("div", "tl-promo");
  promo.setAttribute("data-threadledger-promo", "1");
  panel.appendChild(promo);
  panel.appendChild(el("p", "tl-footer", "All data stays in this browser. ThreadLedger does not send email content anywhere. Exported locally by ThreadLedger. Verify against the original Gmail thread before relying on it."));
  backdrop.appendChild(panel);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) closePanel();
  });
  shadow.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePanel();
  });
  shadow.append(style, backdrop);
  document.body.appendChild(host);
  fillSenders(sender);
  fillSuggestions();
  renderTable();
  search.focus();
}

/**
 * Expand the open thread, parse it, and show the table.
 * @returns {Promise<void>}
 */
async function startInventory() {
  if (activeRun) {
    showToast("Already reading this thread…");
    return;
  }
  const run = {
    cancelled: false,
    capped: false,
    threadId: threadKeyFromHash(location.hash),
    token: Date.now()
  };
  activeRun = run;
  setButtonBusy(true);
  try {
    if (!isThreadView()) {
      showToast("Open a single Gmail conversation first.");
      await sleep(1800);
      return;
    }
    const stored = await storageGet(["threadledgerSettings", "threadledgerNotes"]);
    const settings = normalizeSettings(stored.threadledgerSettings);
    const collector = createCollector(settings);
    showToast("Reading this thread…");
    await expandAll(run, collector);
    if (!sameThread(run)) return;
    showToast(run.cancelled ? "Stopped. Reading messages already opened…" : "Reading messages…");
    let rows = await collectAll(run, collector);
    if (!sameThread(run)) return;
    const threadId = threadIdFromLocation() || run.threadId || "thread";
    const notes = stored.threadledgerNotes || {};
    rows = mergeNotes(rows, notes[threadId]);
    const health = selfTest(rows);
    await storageSet({
      threadledgerHealth: {
        ok: health.ok,
        total: health.total,
        good: health.good,
        rate: health.rate,
        checkedAt: new Date().toISOString(),
        threadId: threadId
      }
    });
    if (health.ok) removeHealthBanner();
    else showHealthBanner();
    openPanel(rows, settings, {
      partial: run.cancelled,
      capped: Boolean(run.capped),
      health: health,
      threadId: threadId,
      subject: readThreadSubject(),
      notes: notes
    });
  } catch (err) {
    showToast("ThreadLedger could not read this thread.");
    await sleep(2000);
  } finally {
    if (activeRun === run) {
      activeRun = null;
      removeToast();
      setButtonBusy(false);
    }
  }
}

/**
 * Leave cleanly when the conversation changes.
 * @returns {void}
 */
function onLocationChange() {
  if (activeRun && !sameThread(activeRun)) activeRun.cancelled = true;
  if (panelState && threadKeyFromHash(panelState.threadKey) !== threadKeyFromHash(location.hash)) closePanel();
  scheduleScan();
}

/**
 * Add or remove the inventory button after Gmail redraws.
 * @returns {void}
 */
function scanThreadChrome() {
  if (!document.body) return;
  if (isThreadView()) ensureButton();
  else removeLaunchers();
}

/**
 * Debounce Gmail's single-page redraws.
 * @returns {void}
 */
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanThreadChrome, 300);
}

/**
 * Start from the popup without waiting for the whole inventory to finish.
 * @param {object} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {function} sendResponse
 * @returns {boolean|undefined}
 */
function onRuntimeMessage(message, sender, sendResponse) {
  if (!message || message.type !== "THREADLEDGER_INVENTORY") return;
  startInventory();
  sendResponse({ ok: true, started: true });
  return false;
}

/**
 * Watch Gmail's navigation and listen for the popup.
 * @returns {void}
 */
function bootstrap() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    return;
  }
  window.addEventListener("hashchange", onLocationChange);
  window.addEventListener("popstate", onLocationChange);
  const observer = new MutationObserver(function () { scheduleScan(); });
  observer.observe(document.body, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  scheduleScan();
}

globalThis.THREADLEDGER_SELECTORS = SELECTORS;
if (!globalThis.THREADLEDGER_UNDER_TEST && !globalThis.THREADLEDGER_BOOTED) {
  globalThis.THREADLEDGER_BOOTED = true;
  bootstrap();
}
