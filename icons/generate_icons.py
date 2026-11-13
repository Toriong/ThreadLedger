#!/usr/bin/env python3
"""Draw the ThreadLedger ledger icon at 16, 32, 48, and 128 pixels."""

import struct
import zlib
from pathlib import Path

BLUE = (26, 115, 232, 255)
WHITE = (255, 255, 255, 255)
PALE = (232, 240, 254, 255)
SIZES = (16, 32, 48, 128)


def in_round_rect(px, py, left, top, right, bottom, radius):
    """Return True when a sample point sits inside a rounded rectangle."""
    if px < left or px > right or py < top or py > bottom:
        return False
    cx = min(max(px, left + radius), right - radius)
    cy = min(max(py, top + radius), bottom - radius)
    dx = px - cx
    dy = py - cy
    return dx * dx + dy * dy <= radius * radius


def pixel(size, x, y):
    """Color one pixel of the ledger glyph, with a few samples per pixel."""
    scale = size / 128
    red = green = blue = alpha = 0
    samples = 0
    for sy in range(4):
        for sx in range(4):
            samples += 1
            px = (x + (sx + 0.5) / 4) / scale
            py = (y + (sy + 0.5) / 4) / scale
            if not in_round_rect(px, py, 0, 0, 128, 128, 28):
                continue
            color = BLUE
            if in_round_rect(px, py, 28, 22, 100, 106, 6):
                color = PALE if py < 40 else WHITE
                on_rule = (
                    abs(px - 50) <= 1
                    or abs(py - 40) <= 1
                    or abs(py - 56) <= 1
                    or abs(py - 72) <= 1
                    or abs(py - 88) <= 1
                )
                if on_rule:
                    color = BLUE
            red += color[0] * color[3]
            green += color[1] * color[3]
            blue += color[2] * color[3]
            alpha += color[3]
    if alpha == 0:
        return (0, 0, 0, 0)
    return (round(red / alpha), round(green / alpha), round(blue / alpha), round(alpha / samples))


def png_bytes(size):
    """Encode an RGBA PNG."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(size, x, y))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def main():
    """Write icon16.png, icon32.png, icon48.png, and icon128.png beside this script."""
    folder = Path(__file__).resolve().parent
    for size in SIZES:
        path = folder / f"icon{size}.png"
        path.write_bytes(png_bytes(size))
        print(path.name, path.stat().st_size)


if __name__ == "__main__":
    main()
