/**
 * Drive I/O promotion used by the popup, options page, and export panel.
 * Cards never block a feature, never open a tab on their own, and never ask for permissions.
 */
const DRIVE_IO_URL = "https://www.driveio.io/standalone-plans/copy-folder-in-google-drive-extension";

/**
 * Tracked Drive I/O URL for one placement.
 * @param {string} placement
 * @returns {string}
 */
function driveIoLink(placement) {
  return DRIVE_IO_URL
    + "?utm_source=threadledger&utm_medium=chrome_extension&utm_campaign=free_tools&utm_content="
    + encodeURIComponent(placement);
}

/**
 * Headline, body, and URL for a known placement.
 * @param {string} placement
 * @returns {{url: string, headline: string, body: string, markdown: string}}
 */
function getPromo(placement) {
  const url = driveIoLink(placement);
  const copy = {
    popup_footer: {
      headline: "Need to copy whole folders in Google Drive?",
      body: "Drive I/O copies folders with every subfolder and file in one click. From the makers of ThreadLedger."
    },
    export_success: {
      headline: "Starting the next matter?",
      body: "Copy your whole case or client folder template in Google Drive in one click with Drive I/O."
    },
    options_about: {
      headline: "From the makers of Drive I/O",
      body: "Drive I/O copies entire Google Drive folders, keeping structure and files, for law firms, agencies and teams."
    },
    readme: {
      headline: "Drive I/O",
      body: "copies entire Google Drive folders, keeping structure and files, for law firms, agencies and teams."
    }
  };
  const item = copy[placement] || copy.readme;
  const markdown = placement === "readme"
    ? "[Drive I/O](" + url + ") " + item.body
    : "[" + item.headline + "](" + url + ") — " + item.body;
  return { url: url, headline: item.headline, body: item.body, markdown: markdown };
}

/**
 * Render a small card with the Drive I/O name, one line of text, and a new-tab link.
 * @param {string} placement
 * @returns {HTMLElement}
 */
function createPromoCard(placement) {
  const promo = getPromo(placement);
  const card = document.createElement("aside");
  card.className = "threadledger-promo";
  card.setAttribute("aria-label", promo.headline);
  card.style.cssText = "border:1px solid #e0e0e0;background:#fafafa;border-radius:8px;padding:10px 12px;margin-top:12px;font:13px/1.45 Arial,Helvetica,sans-serif;color:#3c4043;";
  const name = document.createElement("div");
  name.className = "threadledger-promo-name";
  name.textContent = "Drive I/O";
  name.style.cssText = "font-weight:600;color:#202124;margin:0 0 2px;";
  const line = document.createElement("p");
  line.className = "threadledger-promo-line";
  line.textContent = promo.body;
  line.style.cssText = "margin:0 0 6px;";
  const link = document.createElement("a");
  link.className = "threadledger-promo-link";
  link.href = promo.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Try Drive I/O";
  link.style.cssText = "color:#1a73e8;font-weight:600;text-decoration:none;";
  card.append(name, line, link);
  return card;
}
