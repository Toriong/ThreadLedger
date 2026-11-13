/**
 * Draw the ledger icon on a canvas and offer PNG downloads.
 * Open icons/generate-icons.html in a browser.
 */

/**
 * Return true when a point is inside a rounded rectangle.
 * @param {number} px
 * @param {number} py
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @param {number} radius
 * @returns {boolean}
 */
function inRoundRect(px, py, left, top, right, bottom, radius) {
  if (px < left || px > right || py < top || py > bottom) return false;
  const cx = Math.min(Math.max(px, left + radius), right - radius);
  const cy = Math.min(Math.max(py, top + radius), bottom - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Paint one icon size and return a PNG blob.
 * @param {number} size
 * @returns {Promise<Blob>}
 */
function drawIcon(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const scale = size / 128;
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 128, 28);
  ctx.fillStyle = "#1a73e8";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(28, 22, 72, 84, 6);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(28, 22, 72, 84);
  ctx.fillStyle = "#e8f0fe";
  ctx.fillRect(28, 22, 72, 18);
  ctx.strokeStyle = "#1a73e8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  [40, 56, 72, 88].forEach(function (y) {
    ctx.moveTo(28, y);
    ctx.lineTo(100, y);
  });
  ctx.moveTo(50, 22);
  ctx.lineTo(50, 106);
  ctx.stroke();
  ctx.restore();
  const stage = document.getElementById("stage");
  const wrap = document.createElement("div");
  const label = document.createElement("div");
  label.textContent = size + " px";
  wrap.append(label, canvas);
  stage.appendChild(wrap);
  return new Promise(function (resolve) {
    canvas.toBlob(function (blob) { resolve(blob); }, "image/png");
  });
}

/**
 * Add a download link for one generated icon.
 * @param {number} size
 * @param {Blob} blob
 * @returns {void}
 */
function addDownload(size, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "icon" + size + ".png";
  link.textContent = "Download icon" + size + ".png";
  document.getElementById("stage").appendChild(link);
  document.getElementById("stage").appendChild(document.createElement("br"));
}

/**
 * Draw every packaged size.
 * @returns {Promise<void>}
 */
async function main() {
  const sizes = [16, 32, 48, 128];
  for (let i = 0; i < sizes.length; i += 1) {
    const blob = await drawIcon(sizes[i]);
    addDownload(sizes[i], blob);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  main();
});
