/**
 * Options page. Settings and notes never leave this browser.
 */

/**
 * Write a short saved or error note.
 * @param {string} text
 * @returns {void}
 */
function setSaved(text) {
  document.getElementById("saved").textContent = text;
}

/**
 * Read the form into a settings object.
 * @returns {object}
 */
function readForm() {
  const selected = document.querySelector('input[name="length"]:checked');
  return normalizeSettings({
    firstLineLength: selected ? Number(selected.value) : 200,
    includeQuoted: document.getElementById("quoted").checked,
    dateFormat: document.getElementById("date-format").value,
    categories: document.getElementById("categories").value.split(/\r?\n/)
  });
}

/**
 * Fill the form from saved settings.
 * @param {object} settings
 * @returns {void}
 */
function writeForm(settings) {
  const length = String(settings.firstLineLength);
  const radio = document.querySelector('input[name="length"][value="' + length + '"]');
  if (radio) radio.checked = true;
  document.getElementById("quoted").checked = settings.includeQuoted;
  document.getElementById("date-format").value = settings.dateFormat;
  document.getElementById("categories").value = settings.categories.join("\n");
}

/**
 * Save the form to local storage.
 * @returns {void}
 */
function saveForm() {
  const settings = readForm();
  chrome.storage.local.set({ threadledgerSettings: settings }, function () {
    if (chrome.runtime.lastError) setSaved("Could not save settings.");
    else setSaved("Saved on this device.");
  });
}

/**
 * Load settings, wire the form, and show the about card.
 * @returns {void}
 */
function initOptions() {
  document.getElementById("about").appendChild(createPromoCard("options_about"));
  chrome.storage.local.get(["threadledgerSettings"], function (data) {
    writeForm(normalizeSettings(data.threadledgerSettings));
    document.getElementById("settings").addEventListener("change", saveForm);
    document.getElementById("categories").addEventListener("input", saveForm);
  });
  document.getElementById("clear").addEventListener("click", function () {
    const sure = confirm("Delete saved categories and notes for every thread on this device?");
    if (!sure) return;
    chrome.storage.local.remove("threadledgerNotes", function () {
      if (chrome.runtime.lastError) setSaved("Could not clear notes.");
      else setSaved("Saved notes cleared.");
    });
  });
}

document.addEventListener("DOMContentLoaded", initOptions);
