/**
 * ThreadLedger parser.
 * Pure functions for dates, message fields, the health check, and exports.
 * Loaded before content.js. No Chrome APIs and no network calls.
 */
/* exported DEFAULT_SETTINGS, THREADLEDGER_NOTICE, normalizeSettings, queryFirst,
   queryAll, listMessageElements, parseGmailDate, parseMessageElement, parseThread,
   selfTest, escapeCsvField, exportColumns, recordsToCsv, recordsToTsv,
   recordsToMarkdown, subjectSlug, exportFilename, buildAiPrompt, formatNowIso,
   mergeNotes, isEmail, firstLine, stripQuotedText */

var DEFAULT_SETTINGS = {
  firstLineLength: 200,
  includeQuoted: false,
  dateFormat: "iso",
  categories: ["Admission", "Deadline", "Payment", "Threat", "Agreement"]
};

var THREADLEDGER_NOTICE = "Exported locally by ThreadLedger. Verify against the original Gmail thread before relying on it.";

var MONTHS = {
  jan: 1, january: 1, enero: 1, ene: 1, janvier: 1, janv: 1, januar: 1, janeiro: 1,
  feb: 2, february: 2, febrero: 2, fevrier: 2, februar: 2, fevereiro: 2, fev: 2,
  mar: 3, march: 3, marzo: 3, mars: 3, marz: 3, marco: 3,
  apr: 4, april: 4, abril: 4, avril: 4, avr: 4,
  may: 5, mayo: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junio: 6, juin: 6, juni: 6, junho: 6,
  jul: 7, july: 7, julio: 7, juillet: 7, juil: 7, juli: 7, julho: 7,
  aug: 8, august: 8, agosto: 8, aout: 8, ago: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, septembre: 9, setembro: 9, set: 9,
  oct: 10, october: 10, octubre: 10, octobre: 10, oktober: 10, outubro: 10, out: 10,
  nov: 11, november: 11, noviembre: 11, novembre: 11, novembro: 11,
  dec: 12, december: 12, diciembre: 12, decembre: 12, dezember: 12, dezembro: 12, dez: 12, dic: 12
};

var DRAFT_WORDS = {
  draft: true,
  borrador: true,
  brouillon: true,
  entwurf: true,
  rascunho: true
};

var REMOVED_EXACT = {
  "this message has been removed": true,
  "this message was removed": true,
  "message removed": true,
  "mensaje eliminado": true,
  "este mensaje fue eliminado": true,
  "message supprime": true,
  "ce message a ete supprime": true,
  "nachricht geloscht": true,
  "diese nachricht wurde geloscht": true,
  "mensagem removida": true,
  "esta mensagem foi removida": true
};

var SELF_LABELS = { me: true, yo: true, moi: true, ich: true, eu: true };

var WROTE_PATTERNS = [
  /^on .+ wrote:$/,
  /^el .+ escribio:$/,
  /^le .+ a ecrit\s*:$/,
  /^am .+ schrieb.+:$/,
  /^em .+ escreveu:$/,
  /^den .+ skrev.+:$/
];

/**
 * Lowercase a string and remove accents.
 * @param {string} value
 * @returns {string}
 */
function foldText(value) {
  return String(value || "")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Pad a number to two digits.
 * @param {number} value
 * @returns {string}
 */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Return true when the value looks like an email address.
 * @param {string} value
 * @returns {boolean}
 */
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/**
 * Fill missing settings and keep only the supported choices.
 * @param {object} raw
 * @returns {{firstLineLength: number, includeQuoted: boolean, dateFormat: string, categories: string[]}}
 */
function normalizeSettings(raw) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  const length = Number(settings.firstLineLength);
  settings.firstLineLength = length === 100 || length === 200 || length === 500 ? length : 200;
  settings.includeQuoted = Boolean(settings.includeQuoted);
  settings.dateFormat = settings.dateFormat === "local" ? "local" : "iso";
  const source = Array.isArray(settings.categories) ? settings.categories : DEFAULT_SETTINGS.categories;
  settings.categories = source
    .map(function (item) { return String(item || "").trim().slice(0, 40); })
    .filter(Boolean)
    .slice(0, 40);
  if (!settings.categories.length) settings.categories = DEFAULT_SETTINGS.categories.slice();
  return settings;
}

/**
 * Return the first element that matches a selector in the list.
 * @param {ParentNode} root
 * @param {string[]} selectorList
 * @returns {Element|null}
 */
function queryFirst(root, selectorList) {
  if (!root || !selectorList) return null;
  for (let i = 0; i < selectorList.length; i += 1) {
    try {
      const found = root.querySelector(selectorList[i]);
      if (found) return found;
    } catch (err) {
      // Try the next fallback when a selector is not supported.
    }
  }
  return null;
}

/**
 * Return elements matching any selector, without duplicates.
 * @param {ParentNode} root
 * @param {string[]} selectorList
 * @returns {Element[]}
 */
function queryAll(root, selectorList) {
  const out = [];
  const seen = new Set();
  if (!root || !selectorList) return out;
  for (let i = 0; i < selectorList.length; i += 1) {
    let nodes;
    try {
      nodes = root.querySelectorAll(selectorList[i]);
    } catch (err) {
      continue;
    }
    for (let n = 0; n < nodes.length; n += 1) {
      if (!seen.has(nodes[n])) {
        seen.add(nodes[n]);
        out.push(nodes[n]);
      }
    }
  }
  return out;
}

/**
 * Keep message nodes that are not nested inside another message node.
 * @param {ParentNode} root
 * @param {{message: string[]}} selectors
 * @returns {Element[]}
 */
function listMessageElements(root, selectors) {
  if (!root || !selectors) return [];
  const nodes = queryAll(root, selectors.message || []);
  return nodes.filter(function (node) {
    const nested = nodes.some(function (other) {
      return other !== node && other.contains(node);
    });
    return !nested && isMessageLike(node);
  });
}

/**
 * Decide whether a node is a message rather than a generic list row.
 * @param {Element} el
 * @returns {boolean}
 */
function isMessageLike(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.hasAttribute("data-message-id") || el.hasAttribute("data-legacy-message-id")) return true;
  if (el.getAttribute("role") === "listitem" && el.querySelector("[email], time, [data-message-body]")) return true;
  return false;
}

/**
 * Map a Gmail tooltip date to local ISO parts.
 * Month names cover English (US and UK), Spanish, French, German, and Portuguese.
 * @param {string} raw
 * @returns {{ok: boolean, isoDate: string, time: string, dateSort: string, year: number, month: number, day: number, hour: number, minute: number, second: number, original: string}}
 */
function parseGmailDate(raw) {
  const original = String(raw || "").replace(/[\u00a0\u202f\u2009]/g, " ").trim();
  if (!original) return emptyDate("");
  const isoLead = original.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (isoLead) {
    return finishDate(original, Number(isoLead[1]), Number(isoLead[2]), Number(isoLead[3]), Number(isoLead[4] || 0), Number(isoLead[5] || 0), Number(isoLead[6] || 0));
  }
  let working = original;
  let hour = 0;
  let minute = 0;
  let second = 0;
  const timeMatch = working.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (timeMatch) {
    const parsedHour = applyAmPm(Number(timeMatch[1]), timeMatch[4] || "");
    const parsedMinute = Number(timeMatch[2]);
    const parsedSecond = timeMatch[3] ? Number(timeMatch[3]) : 0;
    if (parsedHour <= 23 && parsedMinute <= 59 && parsedSecond <= 59) {
      hour = parsedHour;
      minute = parsedMinute;
      second = parsedSecond;
      working = working.replace(timeMatch[0], " ");
    }
  }
  const yearFirst = working.match(/\b(\d{4})([./-])(\d{1,2})\2(\d{1,2})\b/);
  if (yearFirst) {
    return finishDate(original, Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]), hour, minute, second);
  }
  const folded = foldText(working).replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
  const monthHit = findMonthToken(folded);
  const yearMatch = folded.match(/\b(?:19|20)\d{2}\b/);
  if (monthHit && yearMatch) {
    const day = findDayNumber(folded, monthHit.token, yearMatch[0]);
    if (day) return finishDate(original, Number(yearMatch[0]), monthHit.month, day, hour, minute, second);
  }
  const numeric = working.match(/\b(\d{1,2})([./-])(\d{1,2})\2(\d{4})\b/);
  if (numeric) {
    const first = Number(numeric[1]);
    const secondNumber = Number(numeric[3]);
    const year = Number(numeric[4]);
    let month = first;
    let day = secondNumber;
    if (first > 12) {
      day = first;
      month = secondNumber;
    } else if (secondNumber > 12) {
      month = first;
      day = secondNumber;
    } else if (numeric[2] === ".") {
      day = first;
      month = secondNumber;
    }
    return finishDate(original, year, month, day, hour, minute, second);
  }
  return emptyDate(original);
}

/**
 * Build a failed date result and keep the original tooltip text.
 * @param {string} original
 * @returns {{ok: boolean, isoDate: string, time: string, dateSort: string, year: number, month: number, day: number, hour: number, minute: number, second: number, original: string}}
 */
function emptyDate(original) {
  return {
    ok: false,
    isoDate: "",
    time: "",
    dateSort: "",
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    original: original || ""
  };
}

/**
 * Validate calendar parts and format them in the user's local offset.
 * @param {string} original
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @returns {{ok: boolean, isoDate: string, time: string, dateSort: string, year: number, month: number, day: number, hour: number, minute: number, second: number, original: string}}
 */
function finishDate(original, year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return emptyDate(original);
  }
  const stamp = new Date(year, month - 1, day, hour, minute, second);
  if (stamp.getFullYear() !== year || stamp.getMonth() !== month - 1 || stamp.getDate() !== day) {
    return emptyDate(original);
  }
  const isoDate = year + "-" + pad2(month) + "-" + pad2(day);
  const time = pad2(hour) + ":" + pad2(minute) + ":" + pad2(second);
  return {
    ok: true,
    isoDate: isoDate,
    time: time,
    dateSort: isoDate + "T" + time + formatOffset(stamp),
    year: year,
    month: month,
    day: day,
    hour: hour,
    minute: minute,
    second: second,
    original: original
  };
}

/**
 * Find the longest month token in a folded date string.
 * @param {string} folded
 * @returns {{month: number, token: string}|null}
 */
function findMonthToken(folded) {
  const tokens = folded.split(/[^a-z]+/);
  let best = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || !MONTHS[token]) continue;
    if (!best || token.length > best.token.length) best = { month: MONTHS[token], token: token };
  }
  return best;
}

/**
 * Pick the day number after the month token and year are removed.
 * @param {string} folded
 * @param {string} monthToken
 * @param {string} year
 * @returns {number}
 */
function findDayNumber(folded, monthToken, year) {
  const rest = folded
    .replace(new RegExp("\\b" + monthToken + "\\b"), " ")
    .replace(year, " ");
  const nums = rest.match(/\b\d{1,2}\b/g) || [];
  for (let i = 0; i < nums.length; i += 1) {
    const day = Number(nums[i]);
    if (day >= 1 && day <= 31) return day;
  }
  return 0;
}

/**
 * Convert a 12-hour clock to 24-hour using an optional am/pm marker.
 * @param {number} hour
 * @param {string} marker
 * @returns {number}
 */
function applyAmPm(hour, marker) {
  if (!marker) return hour;
  if (hour > 12) return hour;
  const pm = marker.toLowerCase().charAt(0) === "p";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/**
 * Format a Date's local timezone offset as ±HH:MM.
 * @param {Date} date
 * @returns {string}
 */
function formatOffset(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 * @param {Date} date
 * @returns {string}
 */
function formatYmd(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/**
 * Format a Date as local ISO 8601 with a numeric offset.
 * @param {Date} date
 * @returns {string}
 */
function formatNowIso(date) {
  const stamp = date || new Date();
  const time = pad2(stamp.getHours()) + ":" + pad2(stamp.getMinutes()) + ":" + pad2(stamp.getSeconds());
  return formatYmd(stamp) + "T" + time + formatOffset(stamp);
}

/**
 * Choose the date and time strings shown in the table.
 * @param {string} raw
 * @param {"iso"|"local"} dateFormat
 * @returns {{date: string, time: string, dateSort: string, dateOriginal: string}}
 */
function buildDateFields(raw, dateFormat) {
  const parsed = parseGmailDate(raw);
  if (!parsed.ok) {
    return { date: "", time: "", dateSort: "", dateOriginal: raw || "" };
  }
  if (dateFormat === "local") {
    const stamp = new Date(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
    return {
      date: stamp.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
      time: stamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      dateSort: parsed.dateSort,
      dateOriginal: raw || ""
    };
  }
  return {
    date: parsed.isoDate,
    time: parsed.time,
    dateSort: parsed.dateSort,
    dateOriginal: raw || ""
  };
}

/**
 * Map a header label in English, Spanish, French, German, or Portuguese.
 * @param {string} text
 * @returns {string}
 */
function labelKey(text) {
  const token = foldText(text || "").replace(/:$/, "").trim();
  if (!token || token.length > 24) return "";
  const map = {
    from: "from", de: "from", von: "from", da: "from", od: "from",
    to: "to", para: "to", an: "to", a: "to",
    cc: "cc",
    bcc: "bcc", cci: "bcc", cco: "bcc",
    date: "date", fecha: "date", datum: "date", data: "date",
    subject: "subject", asunto: "subject", objet: "subject", betreff: "subject", assunto: "subject"
  };
  return map[token] || "";
}

/**
 * Read a name and email from one sender or recipient node.
 * @param {Element} node
 * @returns {{name: string, email: string}}
 */
function personFromNode(node) {
  const email = (node.getAttribute("email") || node.getAttribute("data-hovercard-id") || "").trim();
  let name = (node.getAttribute("name") || "").trim();
  if (!name) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 120 && text.toLowerCase() !== email.toLowerCase()) name = text;
  }
  return { name: name, email: email };
}

/**
 * Read people from a container, preferring email attributes.
 * @param {Element} container
 * @returns {{name: string, email: string}[]}
 */
function peopleFrom(container) {
  if (!container) return [];
  const nodes = [];
  if (container.matches && container.matches("[email], [data-hovercard-id]")) nodes.push(container);
  if (container.querySelectorAll) {
    const nested = container.querySelectorAll("[email], [data-hovercard-id]");
    for (let i = 0; i < nested.length; i += 1) nodes.push(nested[i]);
  }
  const people = [];
  const seen = new Set();
  for (let i = 0; i < nodes.length; i += 1) {
    const person = personFromNode(nodes[i]);
    const key = (person.email || person.name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  if (people.length) return people;
  return emailsInText(container.innerText || container.textContent || "");
}

/**
 * Drop a person who is already the sender.
 * @param {{name: string, email: string}[]} list
 * @param {string} email
 * @returns {{name: string, email: string}[]}
 */
function excludeEmail(list, email) {
  if (!email) return list;
  const target = email.toLowerCase();
  return list.filter(function (person) {
    return (person.email || "").toLowerCase() !== target;
  });
}

/**
 * Format one person as Name <email>.
 * @param {{name: string, email: string}} person
 * @returns {string}
 */
function formatPerson(person) {
  if (!person) return "";
  const name = person.name || "";
  const email = person.email || "";
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return name + " <" + email + ">";
  return email || name;
}

/**
 * Join people with semicolons so the value stays in one spreadsheet cell.
 * @param {{name: string, email: string}[]} list
 * @returns {string}
 */
function formatPeople(list) {
  return (list || []).map(formatPerson).filter(Boolean).join("; ");
}

/**
 * Pull bare email addresses out of a text blob.
 * @param {string} text
 * @returns {{name: string, email: string}[]}
 */
function emailsInText(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const people = [];
  const seen = new Set();
  for (let i = 0; i < matches.length; i += 1) {
    const email = matches[i];
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name: "", email: email });
  }
  return people;
}

/**
 * Find the sender node, skipping recipients and the message body.
 * @param {Element} messageEl
 * @param {object} selectors
 * @param {Element|null} bodyEl
 * @returns {Element|null}
 */
function findSenderElement(messageEl, selectors, bodyEl) {
  const candidates = queryAll(messageEl, selectors.sender || []);
  for (let i = 0; i < candidates.length; i += 1) {
    const node = candidates[i];
    if (bodyEl && bodyEl.contains(node)) continue;
    const field = node.closest("[data-field]");
    if (field) {
      const key = labelKey(field.getAttribute("data-field") || "");
      if (key && key !== "from") continue;
    }
    const cell = node.closest("td, th");
    if (cell) {
      const row = cell.parentElement;
      const labelCell = row && row.children ? row.children[0] : null;
      if (labelCell && labelCell !== cell) {
        const key = labelKey(labelCell.textContent || "");
        if (key && key !== "from") continue;
      }
    }
    return node;
  }
  return null;
}

/**
 * Read from, to, cc, bcc, the labeled date, and a per-message subject.
 * @param {Element} messageEl
 * @param {object} selectors
 * @param {Element|null} bodyEl
 * @returns {{fromName: string, fromEmail: string, to: string, cc: string, bcc: string, dateText: string, subject: string}}
 */
function readPeople(messageEl, selectors, bodyEl) {
  const buckets = { from: [], to: [], cc: [], bcc: [] };
  let dateText = "";
  let subject = "";
  let sawRecipientLabel = false;
  const rows = messageEl.querySelectorAll("tr");
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (bodyEl && bodyEl.contains(row)) continue;
    const cells = [];
    for (let c = 0; c < row.children.length; c += 1) {
      const tag = row.children[c].tagName;
      if (tag === "TD" || tag === "TH") cells.push(row.children[c]);
    }
    if (cells.length < 2) continue;
    const key = labelKey(cells[0].textContent || "");
    if (!key) continue;
    if (key === "date") dateText = dateText || (cells[1].innerText || cells[1].textContent || "").trim();
    else if (key === "subject") subject = subject || (cells[1].innerText || cells[1].textContent || "").trim();
    else {
      if (key !== "from") sawRecipientLabel = true;
      if (!buckets[key].length) buckets[key] = peopleFrom(cells[1]);
    }
  }
  const fields = messageEl.querySelectorAll("[data-field]");
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (bodyEl && bodyEl.contains(field)) continue;
    const key = labelKey(field.getAttribute("data-field") || "");
    if (!key) continue;
    if (key === "date") dateText = dateText || (field.innerText || field.textContent || "").trim();
    else if (key === "subject") subject = subject || (field.innerText || field.textContent || "").trim();
    else if (!buckets[key].length) {
      if (key !== "from") sawRecipientLabel = true;
      buckets[key] = peopleFrom(field);
    }
  }
  if (!buckets.from.length) {
    const sender = findSenderElement(messageEl, selectors, bodyEl);
    if (sender) buckets.from = [personFromNode(sender)];
  }
  if (!sawRecipientLabel && !buckets.to.length && !buckets.cc.length && !buckets.bcc.length) {
    const fromEmail = buckets.from[0] ? buckets.from[0].email : "";
    const pool = peopleFrom(messageEl).filter(function (person) {
      const inBody = bodyEl && person.email && bodyEl.textContent && bodyEl.textContent.indexOf(person.email) !== -1;
      return !inBody;
    });
    buckets.to = excludeEmail(pool, fromEmail);
  }
  const from = buckets.from[0] || { name: "", email: "" };
  return {
    fromName: from.name || "",
    fromEmail: from.email || "",
    to: formatPeople(excludeEmail(buckets.to, from.email)),
    cc: formatPeople(excludeEmail(buckets.cc, from.email)),
    bcc: formatPeople(excludeEmail(buckets.bcc, from.email)),
    dateText: dateText,
    subject: subject
  };
}

/**
 * Read the full date tooltip, falling back to a labeled date cell.
 * @param {Element} messageEl
 * @param {object} selectors
 * @param {string} tableDate
 * @returns {string}
 */
function readDateRaw(messageEl, selectors, tableDate) {
  if (tableDate && parseGmailDate(tableDate).ok) return tableDate.trim();
  const candidates = queryAll(messageEl, selectors.date || []);
  let fallback = tableDate ? tableDate.trim() : "";
  for (let i = 0; i < candidates.length; i += 1) {
    const node = candidates[i];
    if (node.closest && node.closest("[data-message-body]")) continue;
    const tip = node.getAttribute("title")
      || node.getAttribute("data-tooltip")
      || node.getAttribute("datetime")
      || node.getAttribute("alt")
      || "";
    if (tip && parseGmailDate(tip).ok) return tip.trim();
    if (!fallback && tip) fallback = tip.trim();
  }
  return fallback;
}

/**
 * Find the message body element.
 * @param {Element} messageEl
 * @param {object} selectors
 * @returns {Element|null}
 */
function findBody(messageEl, selectors) {
  const found = queryFirst(messageEl, selectors.body || []);
  if (found) return found;
  let best = null;
  let bestLen = 40;
  const nodes = messageEl.querySelectorAll("div, blockquote");
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.querySelector("[email], time")) continue;
    const len = (node.innerText || node.textContent || "").trim().length;
    if (len > bestLen) {
      best = node;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Remove quoted-reply nodes from a cloned body.
 * @param {Element} root
 * @param {object} selectors
 * @returns {void}
 */
function removeQuoteNodes(root, selectors) {
  const selectorsToTry = selectors.quote || [];
  for (let i = 0; i < selectorsToTry.length; i += 1) {
    let nodes;
    try {
      nodes = root.querySelectorAll(selectorsToTry[i]);
    } catch (err) {
      continue;
    }
    for (let n = nodes.length - 1; n >= 0; n -= 1) nodes[n].remove();
  }
}

/**
 * Return true when a short block is an "On … wrote:" introduction.
 * @param {string} text
 * @returns {boolean}
 */
function matchesWroteIntro(text) {
  const folded = foldText(text).replace(/\s+/g, " ").trim();
  if (!folded || folded.length > 280) return false;
  for (let i = 0; i < WROTE_PATTERNS.length; i += 1) {
    if (WROTE_PATTERNS[i].test(folded)) return true;
  }
  return false;
}

/**
 * Remove "On … wrote:" blocks and a blockquote that follows one.
 * @param {Element} root
 * @returns {void}
 */
function removeWroteIntros(root) {
  const elements = root.querySelectorAll("*");
  const doomed = [];
  for (let i = 0; i < elements.length; i += 1) {
    const node = elements[i];
    const own = [];
    for (let c = 0; c < node.childNodes.length; c += 1) {
      if (node.childNodes[c].nodeType === 3) own.push(node.childNodes[c].textContent || "");
    }
    const ownText = own.join(" ").trim();
    const whole = (node.textContent || "").trim();
    if (matchesWroteIntro(ownText) || (node.children.length === 0 && matchesWroteIntro(whole))) {
      doomed.push(node);
    }
  }
  for (let i = 0; i < doomed.length; i += 1) {
    const node = doomed[i];
    const next = node.nextElementSibling;
    if (next && next.tagName === "BLOCKQUOTE") next.remove();
    node.remove();
  }
}

/**
 * Drop lines that are only traditional > quotes.
 * @param {string} text
 * @returns {string}
 */
function stripAngleQuoteLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(function (line) { return !/^\s*>/.test(line); })
    .join("\n")
    .trim();
}

/**
 * Read text from a node that is not on screen, keeping block breaks.
 * innerText is blank for those copies, which is how quote stripping works.
 * @param {Node} el
 * @returns {string}
 */
function manualText(el) {
  if (!el) return "";
  const blocks = { DIV: true, P: true, BLOCKQUOTE: true, LI: true, TR: true, H1: true, H2: true, H3: true, TABLE: true, UL: true, OL: true };
  function walk(node) {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    if (node.tagName === "BR") return "\n";
    let text = "";
    for (let i = 0; i < node.childNodes.length; i += 1) text += walk(node.childNodes[i]);
    if (blocks[node.tagName]) return text.replace(/[ \t]+\n/g, "\n") + "\n";
    return text;
  }
  return walk(el);
}

/**
 * Read visible text while keeping line breaks.
 * @param {Element} el
 * @returns {string}
 */
function textFromElement(el) {
  if (!el) return "";
  let raw = "";
  try { raw = el.innerText || ""; } catch (err) { raw = ""; }
  if (!String(raw).trim()) raw = manualText(el);
  return String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Return body text with Gmail quote history removed.
 * @param {Element} bodyEl
 * @param {object} selectors
 * @returns {string}
 */
function stripQuotedText(bodyEl, selectors) {
  const clone = bodyEl.cloneNode(true);
  removeQuoteNodes(clone, selectors);
  removeWroteIntros(clone);
  return stripAngleQuoteLines(textFromElement(clone));
}

/**
 * Return the first non-empty line, cut to maxLen characters.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function firstLine(text, maxLen) {
  const limit = maxLen || 200;
  const lines = String(text || "").split(/\r?\n/);
  let line = "";
  for (let i = 0; i < lines.length; i += 1) {
    const cleaned = lines[i].replace(/\s+/g, " ").trim();
    if (cleaned) {
      line = cleaned;
      break;
    }
  }
  if (line.length <= limit) return line;
  return line.slice(0, limit);
}

/**
 * Read the body, or a same-origin frame, or the collapsed snippet.
 * @param {Element} messageEl
 * @param {Element|null} bodyEl
 * @param {object} selectors
 * @param {boolean} includeQuoted
 * @returns {string}
 */
function messageText(messageEl, bodyEl, selectors, includeQuoted) {
  if (bodyEl) {
    if (includeQuoted) return textFromElement(bodyEl);
    return stripQuotedText(bodyEl, selectors);
  }
  const frame = messageEl.querySelector("iframe");
  if (frame) {
    try {
      if (frame.contentDocument && frame.contentDocument.body) {
        return textFromElement(frame.contentDocument.body);
      }
    } catch (err) {
      // A cross-origin frame is skipped. The row is still produced.
    }
  }
  const snippet = queryFirst(messageEl, selectors.snippet || []);
  if (snippet) return textFromElement(snippet);
  return "";
}

/**
 * Return true when the visible body contains a real link.
 * @param {Element} bodyEl
 * @param {object} selectors
 * @param {boolean} includeQuoted
 * @returns {boolean}
 */
function hasLinksIn(bodyEl, selectors, includeQuoted) {
  const root = includeQuoted ? bodyEl : bodyEl.cloneNode(true);
  if (!includeQuoted) {
    removeQuoteNodes(root, selectors);
    removeWroteIntros(root);
  }
  const links = root.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i += 1) {
    const href = links[i].getAttribute("href") || "";
    if (/^(https?:|mailto:)/i.test(href)) return true;
  }
  return false;
}

/**
 * Return true when the text is emoji and nothing else.
 * @param {string} text
 * @returns {boolean}
 */
function isEmojiOnly(text) {
  const stripped = String(text || "").replace(/\s/g, "");
  if (!stripped) return false;
  return /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(stripped);
}

/**
 * Return true for emoji images that should not be listed as attachments.
 * @param {Element} img
 * @returns {boolean}
 */
function isEmojiImage(img) {
  if (img.hasAttribute("data-emoji")) return true;
  if (/\bemoji\b/i.test(String(img.className || ""))) return true;
  const alt = img.getAttribute("alt") || "";
  if (alt && isEmojiOnly(alt)) return true;
  return false;
}

/**
 * Pull a file name out of Gmail's download_url attribute.
 * @param {string} value
 * @returns {string}
 */
function nameFromDownloadUrl(value) {
  const parts = String(value || "").split(":");
  for (let i = 0; i < parts.length; i += 1) {
    if (/^[^/\\]+\.[A-Za-z0-9]{1,8}$/.test(parts[i])) return parts[i];
  }
  return "";
}

/**
 * List attachment file names and inline images.
 * @param {Element} messageEl
 * @param {Element|null} bodyEl
 * @param {object} selectors
 * @param {boolean} includeQuoted
 * @returns {string}
 */
function readAttachments(messageEl, bodyEl, selectors, includeQuoted) {
  const names = [];
  const seen = new Set();
  function add(name) {
    const clean = String(name || "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(clean);
  }
  const nodes = queryAll(messageEl, selectors.attachment || []);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (bodyEl && bodyEl.contains(node) && node.tagName === "IMG") continue;
    const fromUrl = nameFromDownloadUrl(node.getAttribute("download_url") || "");
    if (fromUrl) add(fromUrl);
    else add(node.getAttribute("data-attachment-name") || node.getAttribute("aria-label") || node.textContent || "");
  }
  if (bodyEl) {
    const imageRoot = includeQuoted ? bodyEl : bodyEl.cloneNode(true);
    if (!includeQuoted) removeQuoteNodes(imageRoot, selectors);
    const images = imageRoot.querySelectorAll("img");
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      if (isEmojiImage(img)) continue;
      const width = Number(img.getAttribute("width") || 0);
      const height = Number(img.getAttribute("height") || 0);
      if (width && height && width <= 2 && height <= 2) continue;
      names.push("inline image");
    }
  }
  return names.join("; ");
}

/**
 * Look for a short Draft or Removed badge outside the body.
 * @param {Element} el
 * @returns {string}
 */
function exactBadge(el) {
  const leaves = el.querySelectorAll("span, div, td");
  for (let i = 0; i < leaves.length; i += 1) {
    const node = leaves[i];
    if (node.children.length) continue;
    if (node.closest("[data-message-body]")) continue;
    const token = foldText(node.textContent || "").trim();
    if (DRAFT_WORDS[token]) return "draft";
    if (REMOVED_EXACT[token]) return "removed";
  }
  return "";
}

/**
 * Classify a normal message, a draft, or a removed placeholder.
 * @param {Element} el
 * @returns {"message"|"draft"|"removed"}
 */
function detectKind(el) {
  const state = foldText(el.getAttribute("data-message-state") || el.getAttribute("data-placeholder") || "");
  if (state === "draft" || el.getAttribute("data-draft") === "true") return "draft";
  if (state === "removed" || el.getAttribute("data-removed") === "true") return "removed";
  const aria = foldText(el.getAttribute("aria-label") || "").trim();
  if (DRAFT_WORDS[aria]) return "draft";
  if (REMOVED_EXACT[aria]) return "removed";
  const badge = exactBadge(el);
  if (badge) return badge;
  const sample = foldText(el.innerText || el.textContent || "").trim();
  if (sample.length <= 180 && REMOVED_EXACT[sample]) return "removed";
  return "message";
}

/**
 * Return true for Gmail's localized "me" sender label.
 * @param {string} name
 * @returns {boolean}
 */
function isSelfLabel(name) {
  return Boolean(SELF_LABELS[foldText(name || "").trim()]);
}

/**
 * Resolve a "me" sender and label drafts or removed placeholders.
 * @param {string} fromName
 * @param {string} fromEmail
 * @param {string} accountEmail
 * @param {string} kind
 * @returns {{fromName: string, fromEmail: string}}
 */
function resolveSender(fromName, fromEmail, accountEmail, kind) {
  let name = fromName || "";
  let email = (fromEmail || "").trim();
  if (isSelfLabel(name) && !isEmail(email)) {
    email = isEmail(accountEmail) ? accountEmail : "me";
  }
  if (kind === "draft") {
    const plain = foldText(name).trim();
    name = name && !DRAFT_WORDS[plain] && !SELF_LABELS[plain] ? "Draft — " + name : "Draft";
    if (!isEmail(email) && isEmail(accountEmail)) email = accountEmail;
  }
  if (kind === "removed") name = "Removed";
  return { fromName: name, fromEmail: email };
}

/**
 * Parse one message element into a table row.
 * @param {Element} el
 * @param {object} selectors
 * @param {object} options
 * @returns {object}
 */
function parseMessageElement(el, selectors, options) {
  const opts = options || {};
  const kind = detectKind(el);
  const bodyEl = findBody(el, selectors);
  const people = readPeople(el, selectors, bodyEl);
  const resolved = resolveSender(people.fromName, people.fromEmail, opts.accountEmail || "", kind);
  const dates = buildDateFields(readDateRaw(el, selectors, people.dateText), opts.dateFormat === "local" ? "local" : "iso");
  const includeQuoted = Boolean(opts.includeQuoted);
  const maxLen = Number(opts.firstLineLength);
  const limit = maxLen === 100 || maxLen === 200 || maxLen === 500 ? maxLen : 200;
  const text = messageText(el, bodyEl, selectors, includeQuoted);
  let linked = false;
  if (bodyEl) linked = hasLinksIn(bodyEl, selectors, includeQuoted);
  else {
    const snippet = queryFirst(el, selectors.snippet || []);
    if (snippet) linked = Boolean(snippet.querySelector("a[href]"));
  }
  const threadSubject = opts.threadSubject || "";
  let subject = threadSubject;
  if (people.subject && people.subject.trim() && people.subject.trim() !== threadSubject) {
    subject = people.subject.trim();
  }
  return {
    index: opts.index || 0,
    id: el.getAttribute("data-message-id") || el.getAttribute("data-legacy-message-id") || el.id || "",
    kind: kind,
    date: dates.date,
    time: dates.time,
    dateSort: dates.dateSort,
    dateOriginal: dates.dateOriginal,
    fromName: resolved.fromName,
    fromEmail: resolved.fromEmail,
    to: people.to,
    cc: people.cc,
    bcc: people.bcc,
    subject: subject,
    attachments: readAttachments(el, bodyEl, selectors, includeQuoted),
    firstLine: firstLine(text, limit),
    hasLinks: linked,
    links: linked ? "Yes" : "No",
    category: "",
    notes: ""
  };
}

/**
 * Parse every message under a thread root.
 * @param {ParentNode} root
 * @param {object} selectors
 * @param {object} options
 * @returns {{rows: object[], subject: string, dateHeader: string}}
 */
function parseThread(root, selectors, options) {
  const opts = Object.assign({
    firstLineLength: 200,
    includeQuoted: false,
    dateFormat: "iso",
    accountEmail: "",
    threadSubject: ""
  }, options || {});
  const subjectEl = queryFirst(root, (selectors && selectors.subject) || []);
  const threadSubject = opts.threadSubject || (subjectEl ? (subjectEl.innerText || subjectEl.textContent || "").trim() : "");
  const messages = listMessageElements(root, selectors).slice(0, 2000);
  const rows = messages.map(function (el, index) {
    return parseMessageElement(el, selectors, {
      firstLineLength: opts.firstLineLength,
      includeQuoted: opts.includeQuoted,
      dateFormat: opts.dateFormat,
      accountEmail: opts.accountEmail,
      threadSubject: threadSubject,
      index: index + 1
    });
  });
  return {
    rows: rows,
    subject: threadSubject,
    dateHeader: opts.dateFormat === "local" ? "Date (local)" : "Date (ISO)"
  };
}

/**
 * Pass when at least 90% of rows have a sender email and a parsed date.
 * @param {object[]} rows
 * @returns {{ok: boolean, total: number, good: number, rate: number}}
 */
function selfTest(rows) {
  const list = rows || [];
  const total = list.length;
  if (!total) return { ok: false, total: 0, good: 0, rate: 0 };
  let good = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (isEmail(list[i].fromEmail) && list[i].dateSort) good += 1;
  }
  const rate = good / total;
  return { ok: rate >= 0.9, total: total, good: good, rate: rate };
}

/**
 * Escape one CSV field using RFC 4180 rules.
 * @param {string|number|boolean|null|undefined} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/**
 * Keep a TSV cell on one line so Sheets stays in columns.
 * @param {string|number|boolean|null|undefined} value
 * @returns {string}
 */
function sanitizeTsvField(value) {
  return String(value == null ? "" : value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

/**
 * Column order for the table, the clipboard, and files.
 * @param {string} dateHeader
 * @returns {{key: string, header: string}[]}
 */
function exportColumns(dateHeader) {
  return [
    { key: "index", header: "#" },
    { key: "date", header: dateHeader || "Date (ISO)" },
    { key: "time", header: "Time" },
    { key: "dateOriginal", header: "Original date text" },
    { key: "fromName", header: "From name" },
    { key: "fromEmail", header: "From email" },
    { key: "to", header: "To" },
    { key: "cc", header: "CC" },
    { key: "bcc", header: "BCC" },
    { key: "subject", header: "Subject" },
    { key: "attachments", header: "Attachments" },
    { key: "firstLine", header: "First line" },
    { key: "links", header: "Links" },
    { key: "category", header: "Category" },
    { key: "notes", header: "Notes" }
  ];
}

/**
 * Metadata that sits beside the evidence table, not inside it.
 * @param {{subject?: string, count?: number, exportedAt?: string}} about
 * @returns {string[][]}
 */
function aboutLines(about) {
  const meta = about || {};
  return [
    ["About", ""],
    ["Subject", meta.subject || ""],
    ["Messages exported", String(meta.count == null ? "" : meta.count)],
    ["Export time", meta.exportedAt || ""],
    ["Notice", THREADLEDGER_NOTICE]
  ];
}

/**
 * Build a UTF-8 CSV with a BOM. The About block follows a blank line.
 * @param {object[]} rows
 * @param {object} about
 * @param {{key: string, header: string}[]} columns
 * @returns {string}
 */
function recordsToCsv(rows, about, columns) {
  const cols = columns || exportColumns("Date (ISO)");
  const lines = [cols.map(function (col) { return escapeCsvField(col.header); }).join(",")];
  for (let i = 0; i < rows.length; i += 1) {
    lines.push(cols.map(function (col) { return escapeCsvField(rows[i][col.key]); }).join(","));
  }
  lines.push("");
  const meta = aboutLines(about);
  for (let i = 0; i < meta.length; i += 1) {
    lines.push(meta[i].map(escapeCsvField).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * Build tab-separated text that pastes into Google Sheets columns.
 * @param {object[]} rows
 * @param {object} about
 * @param {{key: string, header: string}[]} columns
 * @param {boolean} includeAbout
 * @returns {string}
 */
function recordsToTsv(rows, about, columns, includeAbout) {
  const cols = columns || exportColumns("Date (ISO)");
  const lines = [cols.map(function (col) { return sanitizeTsvField(col.header); }).join("\t")];
  for (let i = 0; i < rows.length; i += 1) {
    lines.push(cols.map(function (col) { return sanitizeTsvField(rows[i][col.key]); }).join("\t"));
  }
  if (includeAbout === false) return lines.join("\n");
  lines.push("");
  const meta = aboutLines(about);
  for (let i = 0; i < meta.length; i += 1) {
    lines.push(meta[i].map(sanitizeTsvField).join("\t"));
  }
  return lines.join("\n");
}

/**
 * Build a one-line-per-message timeline with the About block at the top.
 * @param {object[]} rows
 * @param {object} about
 * @returns {string}
 */
function recordsToMarkdown(rows, about) {
  const meta = about || {};
  const lines = [
    "# ThreadLedger",
    "",
    "## About",
    "",
    "- Subject: " + (meta.subject || ""),
    "- Messages exported: " + String(meta.count == null ? rows.length : meta.count),
    "- Export time: " + (meta.exportedAt || ""),
    "- " + THREADLEDGER_NOTICE,
    "",
    "## Timeline",
    ""
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const who = row.fromEmail ? row.fromName + " <" + row.fromEmail + ">" : row.fromName;
    const bits = [
      [row.date, row.time].filter(Boolean).join(" ") || "undated",
      who,
      row.to ? "To: " + row.to : "",
      row.cc ? "CC: " + row.cc : "",
      row.bcc ? "BCC: " + row.bcc : "",
      row.subject ? "Subject: " + row.subject : "",
      row.attachments ? "Attachments: " + row.attachments : "",
      row.category ? "Category: " + row.category : "",
      row.notes ? "Notes: " + row.notes : "",
      row.firstLine || ""
    ].filter(Boolean).map(function (bit) { return String(bit).replace(/\s+/g, " ").trim(); });
    lines.push("- " + bits.join(" — "));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Turn a subject into a safe file-name slug.
 * @param {string} subject
 * @returns {string}
 */
function subjectSlug(subject) {
  const slug = foldText(subject)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "thread";
}

/**
 * Build ThreadLedger-<subject>-<YYYY-MM-DD>.<ext> using the local export date.
 * @param {string} subject
 * @param {Date} date
 * @param {string} extension
 * @returns {string}
 */
function exportFilename(subject, date, extension) {
  const ext = String(extension || "csv").replace(/^\./, "");
  return "ThreadLedger-" + subjectSlug(subject) + "-" + formatYmd(date || new Date()) + "." + ext;
}

/**
 * Build a prompt the user can paste into their own AI tool. This function does not call one.
 * @param {string} tsv
 * @param {string[]} categories
 * @returns {string}
 */
function buildAiPrompt(tsv, categories) {
  const labels = (categories && categories.length ? categories : DEFAULT_SETTINGS.categories).join(", ");
  return [
    "You are organizing one Gmail thread into a case timeline.",
    "The table below is tab-separated, with one message per row.",
    "Fill in the Category column only. Prefer one of these labels when it fits: " + labels + ".",
    "You may use a short new label when none of those fit.",
    "Do not change any other column. Do not invent senders, dates, or facts that are not in the row.",
    "If a row does not clearly fit a category, leave Category blank.",
    "Reply with the full table, including the header row, and nothing else.",
    "",
    tsv
  ].join("\n");
}

/**
 * Copy saved category and notes onto matching message ids.
 * @param {object[]} rows
 * @param {object} bucket
 * @returns {object[]}
 */
function mergeNotes(rows, bucket) {
  const saved = bucket || {};
  return rows.map(function (row) {
    const extra = saved[row.id] || {};
    return Object.assign({}, row, {
      category: extra.category || "",
      notes: extra.notes || ""
    });
  });
}
