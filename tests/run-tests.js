/**
 * Browser assertions for the ThreadLedger parser.
 * Open tests/parse.test.html over http so the fixtures can load.
 */
const results = [];

/**
 * Record one assertion without stopping the rest of the suite.
 * @param {string} name
 * @param {function(): (void|Promise<void>)} fn
 * @returns {Promise<void>}
 */
async function check(name, fn) {
  try {
    await fn();
    results.push({ name: name, ok: true });
  } catch (err) {
    results.push({ name: name, ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/**
 * Throw when a condition is false.
 * @param {boolean} condition
 * @param {string} message
 * @returns {void}
 */
function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

/**
 * Load a saved Gmail HTML fixture.
 * @param {string} name
 * @returns {Promise<Document>}
 */
async function loadFixture(name) {
  const response = await fetch("fixtures/" + name);
  if (!response.ok) throw new Error("Could not load " + name);
  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Parse a fixture with the production SELECTORS object.
 * @param {Document} doc
 * @param {object} [options]
 * @returns {{rows: object[], subject: string, dateHeader: string}}
 */
function parseFixture(doc, options) {
  return parseThread(doc, globalThis.THREADLEDGER_SELECTORS, options || {});
}

/**
 * Run the suite and write the results into the page.
 * @returns {Promise<void>}
 */
async function main() {
  const selectors = globalThis.THREADLEDGER_SELECTORS;
  assert(selectors && selectors.message && selectors.message.length >= 3, "SELECTORS missing");

  const expanded = parseFixture(await loadFixture("expanded-message.html"));
  const quoted = parseFixture(await loadFixture("quoted-text.html"));
  const quotedKept = parseFixture(await loadFixture("quoted-text.html"), { includeQuoted: true });
  const collapsed = parseFixture(await loadFixture("collapsed-message.html"));
  const spanish = parseFixture(await loadFixture("spanish-date.html"));
  const french = parseFixture(await loadFixture("french-date.html"));
  const german = parseFixture(await loadFixture("german-date.html"));
  const portuguese = parseFixture(await loadFixture("portuguese-date.html"));
  const uk = parseFixture(await loadFixture("uk-date.html"));
  const badDate = parseFixture(await loadFixture("bad-date.html"));
  const files = parseFixture(await loadFixture("attachments.html"));
  const me = parseFixture(await loadFixture("me-sender.html"), { accountEmail: "caseworker@firm.example" });
  const meUnresolved = parseFixture(await loadFixture("me-sender.html"));
  const placeholders = parseFixture(await loadFixture("draft-removed.html"), { accountEmail: "caseworker@firm.example" });
  const calendar = parseFixture(await loadFixture("calendar-forward.html"));
  const special = parseFixture(await loadFixture("special-chars.html"));
  const longLine = parseFixture(await loadFixture("long-line.html"), { firstLineLength: 100 });
  const longKept = parseFixture(await loadFixture("long-line.html"), { firstLineLength: 500 });
  const multi = parseFixture(await loadFixture("multi-good.html"));
  const broken = parseFixture(await loadFixture("broken-layout.html"));
  const localDate = parseFixture(await loadFixture("expanded-message.html"), { dateFormat: "local" });

  await check("expanded message reads the sender email", function () {
    assert(expanded.rows.length === 1, "expected 1 row");
    assert(expanded.rows[0].fromEmail === "alice@example.com", expanded.rows[0].fromEmail);
  });
  await check("expanded message reads the sender name", function () {
    assert(expanded.rows[0].fromName === "Alice Adams", expanded.rows[0].fromName);
  });
  await check("expanded message reads to, cc, and bcc", function () {
    assert(expanded.rows[0].to === "Bob Blake <bob@example.com>", expanded.rows[0].to);
    assert(expanded.rows[0].cc === "Cara Cole <cara@example.com>", expanded.rows[0].cc);
    assert(expanded.rows[0].bcc === "Dee Dunn <dee@example.com>", expanded.rows[0].bcc);
  });
  await check("US tooltip becomes an ISO date and 24-hour time", function () {
    assert(expanded.rows[0].date === "2025-11-13", expanded.rows[0].date);
    assert(expanded.rows[0].time === "15:04:00", expanded.rows[0].time);
    assert(expanded.rows[0].dateSort.indexOf("2025-11-13T15:04:00") === 0, expanded.rows[0].dateSort);
  });
  await check("original Gmail date text is kept", function () {
    assert(expanded.rows[0].dateOriginal === "Thu, Nov 13, 2025, 3:04 PM", expanded.rows[0].dateOriginal);
  });
  await check("thread subject is kept when the message subject matches", function () {
    assert(expanded.subject === "Rent dispute", expanded.subject);
    assert(expanded.rows[0].subject === "Rent dispute", expanded.rows[0].subject);
  });
  await check("quoted reply history is removed from the first line", function () {
    assert(expanded.rows[0].firstLine === "Please see the attached invoice.", expanded.rows[0].firstLine);
    assert(expanded.rows[0].firstLine.indexOf("Old quoted text") === -1, expanded.rows[0].firstLine);
  });
  await check("a link in the new text sets the links flag", function () {
    assert(expanded.rows[0].links === "Yes" && expanded.rows[0].hasLinks === true, expanded.rows[0].links);
  });
  await check("attachment file name is listed", function () {
    assert(expanded.rows[0].attachments === "invoice.pdf", expanded.rows[0].attachments);
  });
  await check("quote blocks and wrote-lines are stripped", function () {
    assert(quoted.rows[0].firstLine === "The new sentence is here.", quoted.rows[0].firstLine);
    assert(quoted.rows[0].firstLine.indexOf("Old quoted text") === -1, "quote remained");
    assert(quoted.rows[0].firstLine.toLowerCase().indexOf("escribi") === -1, quoted.rows[0].firstLine);
  });
  await check("include quoted text keeps the reply history", function () {
    assert(quotedKept.rows[0].firstLine.indexOf("wrote:") !== -1, quotedKept.rows[0].firstLine);
    assert(quotedKept.rows[0].firstLine !== quoted.rows[0].firstLine, "quoted mode matched stripped mode");
  });
  await check("collapsed message still has sender, date, snippet, and link", function () {
    assert(collapsed.rows[0].fromEmail === "nina@example.com", collapsed.rows[0].fromEmail);
    assert(collapsed.rows[0].date === "2025-11-13", collapsed.rows[0].date);
    assert(collapsed.rows[0].time === "09:15:00", collapsed.rows[0].time);
    assert(collapsed.rows[0].firstLine.indexOf("Collapsed preview") === 0, collapsed.rows[0].firstLine);
    assert(collapsed.rows[0].links === "Yes", collapsed.rows[0].links);
  });
  await check("Spanish month name and p. m. parse", function () {
    assert(spanish.rows[0].date === "2025-11-13", spanish.rows[0].date + " / " + spanish.rows[0].dateOriginal);
    assert(spanish.rows[0].time === "15:04:00", spanish.rows[0].time);
  });
  await check("French month name parses", function () {
    assert(french.rows[0].date === "2025-11-13", french.rows[0].date + " / " + french.rows[0].dateOriginal);
    assert(french.rows[0].time === "15:04:00", french.rows[0].time);
  });
  await check("German month name and dotted numeric date parse", function () {
    assert(german.rows.length === 2, "expected 2 german rows");
    assert(german.rows[0].date === "2025-11-13" && german.rows[0].time === "15:04:00", german.rows[0].dateOriginal);
    assert(german.rows[1].date === "2025-11-13" && german.rows[1].time === "15:04:00", german.rows[1].dateOriginal);
  });
  await check("Portuguese month name parses", function () {
    assert(portuguese.rows[0].date === "2025-11-13", portuguese.rows[0].dateOriginal);
    assert(portuguese.rows[0].time === "15:04:00", portuguese.rows[0].time);
  });
  await check("UK day-month date parses", function () {
    assert(uk.rows[0].date === "2025-11-13" && uk.rows[0].time === "15:04:00", uk.rows[0].dateOriginal);
  });
  await check("unparsed date keeps the raw tooltip and blanks the ISO cell", function () {
    assert(badDate.rows[0].date === "", badDate.rows[0].date);
    assert(badDate.rows[0].time === "", "time should be blank");
    assert(badDate.rows[0].dateOriginal === "sometime yesterday", badDate.rows[0].dateOriginal);
    assert(badDate.rows[0].firstLine === "Still here.", badDate.rows[0].firstLine);
  });
  await check("file chips and inline images are listed, emoji images are not", function () {
    assert(files.rows[0].attachments === "contract.pdf; photo.png; inline image", files.rows[0].attachments);
    assert(files.rows[0].attachments.indexOf("emoji.png") === -1, files.rows[0].attachments);
  });
  await check("me and yo resolve to the account email", function () {
    assert(me.rows[0].fromEmail === "caseworker@firm.example", me.rows[0].fromEmail);
    assert(me.rows[0].fromName === "me", me.rows[0].fromName);
    assert(me.rows[1].fromEmail === "caseworker@firm.example", me.rows[1].fromEmail);
    assert(me.rows[2].fromEmail === "real@example.com", me.rows[2].fromEmail);
  });
  await check("me stays me when the account email is not on the page", function () {
    assert(meUnresolved.rows[0].fromEmail === "me", meUnresolved.rows[0].fromEmail);
  });
  await check("drafts and removed placeholders are labeled", function () {
    assert(placeholders.rows[0].fromName === "Draft — Pat", placeholders.rows[0].fromName);
    assert(placeholders.rows[0].fromEmail === "caseworker@firm.example", placeholders.rows[0].fromEmail);
    assert(placeholders.rows[0].firstLine === "Please hold this draft.", placeholders.rows[0].firstLine);
    assert(placeholders.rows[1].fromName === "Removed", placeholders.rows[1].fromName);
    assert(placeholders.rows[1].kind === "removed", placeholders.rows[1].kind);
  });
  await check("calendar invite and forward each produce one row", function () {
    assert(calendar.rows.length === 2, "expected 2 rows");
    assert(calendar.rows[0].subject === "Invitation: Hearing on Friday", calendar.rows[0].subject);
    assert(calendar.rows[0].attachments === "inline image", calendar.rows[0].attachments);
    assert(calendar.rows[1].subject === "Fwd: Signed lease", calendar.rows[1].subject);
    assert(calendar.rows[1].firstLine === "Forwarding the signed lease.", calendar.rows[1].firstLine);
  });
  await check("quotes, commas, Arabic, and emoji survive in CSV", function () {
    const about = { subject: special.subject, count: special.rows.length, exportedAt: "2026-11-13T15:00:00-08:00" };
    const csv = recordsToCsv(special.rows, about, exportColumns("Date (ISO)"));
    assert(csv.charCodeAt(0) === 0xFEFF, "missing BOM");
    assert(csv.slice(1).indexOf("#,") === 0, csv.slice(0, 40));
    assert(csv.indexOf('"He said ""hello"", then left"') !== -1, "quote escape failed");
    assert(csv.indexOf('"Case, re: lease"') !== -1, "subject was not quoted");
    assert(csv.indexOf("مرحبا، هذا أول سطر 😀") !== -1, "rtl or emoji dropped");
    assert(csv.indexOf("driveio") === -1, "promo leaked into csv");
    assert(csv.indexOf(THREADLEDGER_NOTICE) !== -1, "notice missing");
    assert(csv.indexOf("Messages exported") > csv.indexOf("From email"), "about block should follow the table");
  });
  await check("markdown puts the about block above the timeline", function () {
    const about = { subject: expanded.subject, count: expanded.rows.length, exportedAt: "2026-11-13T15:00:00-08:00" };
    const markdown = recordsToMarkdown(expanded.rows, about);
    assert(markdown.indexOf(THREADLEDGER_NOTICE) !== -1, "notice missing");
    assert(markdown.indexOf(THREADLEDGER_NOTICE) < markdown.indexOf("## Timeline"), "about is not first");
    assert(markdown.indexOf("alice@example.com") !== -1, markdown);
    assert(markdown.indexOf("driveio") === -1, "promo leaked into markdown");
  });
  await check("Sheets TSV starts with the header row", function () {
    const tsv = recordsToTsv(expanded.rows, { subject: "Rent dispute", count: 1, exportedAt: "2026-11-13T15:00:00-08:00" }, exportColumns("Date (ISO)"), true);
    assert(tsv.indexOf("#\tDate (ISO)\tTime\t") === 0, tsv.split("\n")[0]);
    assert(tsv.indexOf("alice@example.com") !== -1, "sender missing");
  });
  await check("AI prompt carries the table and does not call a service", function () {
    const tsv = recordsToTsv(expanded.rows, {}, exportColumns("Date (ISO)"), false);
    const prompt = buildAiPrompt(tsv, DEFAULT_SETTINGS.categories);
    assert(prompt.indexOf("Admission") !== -1, "categories missing");
    assert(prompt.indexOf("From email") !== -1, "header missing");
    assert(prompt.indexOf("https://") === -1, "prompt should not contain a URL");
  });
  await check("first line length follows the setting", function () {
    assert(longLine.rows[0].firstLine.length === 100, String(longLine.rows[0].firstLine.length));
    assert(longLine.rows[0].firstLine.indexOf("END") === -1, "truncated line kept the ending");
    assert(longKept.rows[0].firstLine.indexOf("END") !== -1, "500-character setting dropped the ending");
  });
  await check("local date format is not the ISO cell", function () {
    assert(localDate.rows[0].date !== "2025-11-13", localDate.rows[0].date);
    assert(localDate.rows[0].date.indexOf("2025") !== -1, localDate.rows[0].date);
    assert(localDate.rows[0].dateSort.indexOf("2025-11-13T15:04:00") === 0, localDate.rows[0].dateSort);
    assert(localDate.dateHeader === "Date (local)", localDate.dateHeader);
  });
  await check("export file name uses the subject slug and export date", function () {
    assert(exportFilename("Rent dispute", new Date(2026, 10, 13), "csv") === "ThreadLedger-rent-dispute-2026-11-13.csv", exportFilename("Rent dispute", new Date(2026, 10, 13), "csv"));
  });
  await check("self-test passes a complete thread and fails a broken layout", function () {
    assert(multi.rows.length === 10, "expected 10 good rows");
    assert(selfTest(multi.rows).ok === true, "good thread failed");
    assert(broken.rows.length === 4, "expected 4 broken rows");
    assert(broken.rows[0].fromEmail === "" && broken.rows[0].date === "", "broken row was parsed");
    assert(selfTest(broken.rows).ok === false, "broken layout passed");
    const nine = multi.rows.slice(0, 9).concat([broken.rows[0]]);
    const eight = multi.rows.slice(0, 8).concat([broken.rows[0], broken.rows[1]]);
    assert(selfTest(nine).ok === true, "90 percent should pass");
    assert(selfTest(eight).ok === false, "80 percent should fail");
    assert(selfTest([]).ok === false, "empty thread should fail");
  });
  await check("Drive I/O link is tracked and the card opens in a new tab", function () {
    const url = driveIoLink("popup_footer");
    assert(url.indexOf("utm_source=threadledger") !== -1, url);
    assert(url.indexOf("utm_content=popup_footer") !== -1, url);
    const promo = getPromo("export_success");
    assert(promo.headline === "Starting the next matter?", promo.headline);
    const card = createPromoCard("options_about");
    const link = card.querySelector("a");
    assert(link.textContent === "Try Drive I/O", link.textContent);
    assert(link.rel === "noopener", link.rel);
    assert(link.target === "_blank", link.target);
    assert(card.textContent.indexOf("Drive I/O") !== -1, card.textContent);
  });

  const failed = results.filter(function (item) { return !item.ok; });
  const summary = document.getElementById("summary");
  const list = document.getElementById("results");
  summary.textContent = (results.length - failed.length) + " passed, " + failed.length + " failed, " + results.length + " total.";
  document.documentElement.dataset.threadledger = failed.length ? "fail" : "pass";
  document.title = failed.length ? "FAIL ThreadLedger parse tests" : "PASS ThreadLedger parse tests";
  results.forEach(function (item) {
    const li = document.createElement("li");
    li.className = item.ok ? "pass" : "fail";
    li.textContent = (item.ok ? "Pass: " : "Fail: ") + item.name + (item.error ? " — " + item.error : "");
    list.appendChild(li);
  });
}

main().catch(function (err) {
  document.getElementById("summary").textContent = "The suite crashed: " + err.message;
  document.documentElement.dataset.threadledger = "fail";
  document.title = "FAIL ThreadLedger parse tests";
});
