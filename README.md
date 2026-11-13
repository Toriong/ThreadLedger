# ThreadLedger

ThreadLedger is a free Chrome extension that turns one open Gmail conversation into a table with one row per message. A 400-message thread stays 400 rows, with the date, time, sender, recipients, CC, subject, attachments, and the first line of the body. You can copy it into Google Sheets or download it as CSV or Markdown.

It reads only the Gmail page already open in your browser. It does not use Google OAuth, the Gmail API, a server, analytics, or telemetry. Message text never leaves the computer.

Demo GIF: record `docs/threadledger-demo.gif` before publishing. It should show a long Gmail thread, the Inventory this thread button, the “Expanding 37 of 412…” toast with Cancel, the results table, and a paste into Google Sheets. That GIF is not in this repository yet.

## Load it unpacked

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked and choose this folder (the one that contains `manifest.json`).
4. Pin ThreadLedger. The options page opens on a fresh install.
5. Open one Gmail conversation. Use the button on the thread, or the toolbar icon.

Reload the extension from `chrome://extensions` after you change a file.

## How to use it

1. Open a single Gmail conversation. The inbox list is not a thread.
2. Click **Inventory this thread**. The extension expands folded messages in batches of 25, shows progress, and stops at 2,000 messages. Cancel leaves the rows already read.
3. Filter the table, then type a Category or Notes. Those edits are saved for that thread in Chrome’s local storage.
4. **Copy for Google Sheets** copies a header row and tab-separated cells.
5. **Download CSV** saves `ThreadLedger-<subject>-<YYYY-MM-DD>.csv` as UTF-8 with a BOM, using RFC 4180 quoting.
6. **Download Markdown timeline** saves one dated bullet per message.
7. **Copy AI categorizing prompt** copies instructions plus the table so you can paste them into Gemini or ChatGPT yourself. ThreadLedger never calls an AI service.

Copy and download include every message, not only the filtered rows. An About block records the subject, the number of messages, the export time, and this line:

> Exported locally by ThreadLedger. Verify against the original Gmail thread before relying on it.

That block sits above the Markdown timeline and after a blank line in CSV and Sheets copies. It is not mixed into the evidence columns, and there is no promotional text in those rows.

Your own messages labeled “me” (also yo, moi, ich, eu) use the address shown in the Gmail account switcher when that address is on the page. Drafts and removed placeholders stay in the table, labeled Draft or Removed. Calendar invites, forwards, and inline images each stay one row. Inline images are listed as “inline image”.

## Privacy

ThreadLedger reads the conversation you already have open: sender, recipients, CC, BCC when Gmail is showing it, the date tooltip, subject, attachment names, and the first line of the visible body. Quoted reply history is skipped unless you turn that on in options.

Nothing is uploaded. There is no account, no sign-in, and no tracking. Categories and notes stay in `chrome.storage.local` on this device. Downloads and clipboard copies stay on the machine. The Drive I/O link at the bottom of the popup, in options, and after a successful export opens only when you click it, and the link does not contain email content.

## Why it needs no Google security review

Google’s CASA assessment applies to apps that use restricted Gmail API scopes and OAuth. ThreadLedger does not request a Google token, does not call the Gmail API, and does not send mailbox data to a server. The content script runs only on `https://mail.google.com/*` and reads the DOM of the tab you opened. That is also why the manifest does not use the `tabs` permission, `<all_urls>`, or remote code.

## Selector maintenance

Gmail’s class names are generated and change without notice. Every query is in the `SELECTORS` object at the top of `content.js`. Each field has several fallbacks. The preferred hooks are ARIA roles, `aria-label` text, the `email` attribute, and `data-message-id`, `data-legacy-message-id`, or `data-thread-id`. Class names are only the last fallback.

`parse.js` holds the parsing functions and is loaded before `content.js`, so the same code runs in the extension and in the tests. After a thread is parsed, `selfTest` in `parse.js` checks that at least 90% of rows have a sender email and a parsed date. If not, the Gmail page and the results panel show:

> Gmail's layout may have changed. Results may be incomplete. Check for a ThreadLedger update.

The same result is stored under `threadledgerHealth` in `chrome.storage.local`. The popup shows the latest pass or failure.

When Gmail changes:

1. Inventory a thread you can check by hand.
2. See which column went blank.
3. Update that key in `SELECTORS`. Keep a stable attribute first and a class name last.
4. Reload the extension, inventory the thread again, and confirm the popup health check passes.
5. Open `tests/parse.test.html` with a local web server and confirm the fixture page still passes. The fixtures are small HTML snippets in `tests/fixtures/` that use the same ARIA and data attributes.

```bash
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/tests/parse.test.html`. The title switches to PASS or FAIL.

Regenerate icons with `python3 icons/generate_icons.py`, or open `icons/generate-icons.html`. The source drawing is `icons/icon.svg`.

## Chrome Web Store checklist

Single purpose: ThreadLedger extracts the open Gmail conversation into a one-message-per-row timeline so you can copy or download it. It does not read other sites and it does not send mail.

Permission justifications:

- `storage` — save the first-line length, quote setting, date format, category suggestions, per-thread notes, the last export, and the health-check result on this device.
- `downloads` — save the CSV or Markdown file when you click Download. Nothing is downloaded on its own.
- `activeTab` — the popup talks to the Gmail tab you are looking at when you click the icon. It is not used to read other sites.
- `clipboardWrite` — copy the Sheets table or the categorizing prompt when you click those buttons.
- Host permission `https://mail.google.com/*` — the content script runs only on Gmail so it can read the open conversation and add the Inventory button.

Privacy policy URL: publish the Privacy section above at a public HTTPS address and paste that URL into the store listing. This repository does not host one for you.

Screenshots at 1280×800:

1. A Gmail thread with the Inventory this thread button.
2. The expanding toast, including Cancel.
3. The results table with category and notes.
4. The options page, including the privacy text.
5. The CSV opened in a spreadsheet, with one row per message.

Also provide the 128 px icon already in `icons/icon128.png`. In the store’s privacy form, say that the extension does not collect user data and that email content is processed locally.

Data handling: no account, no remote code, no analytics. The only network request ThreadLedger can cause is the Drive I/O page, and only after a click on that link.

[Drive I/O](https://www.driveio.io/standalone-plans/copy-folder-in-google-drive-extension?utm_source=threadledger&utm_medium=chrome_extension&utm_campaign=free_tools&utm_content=readme) copies entire Google Drive folders, keeping structure and files, for law firms, agencies and teams.
