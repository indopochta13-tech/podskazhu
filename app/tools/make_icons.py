"""Генератор иконок приложения: тёмно-зелёный квадрат с микрофоном."""
import struct
import zlib
from pathlib import Path

BG = (63, 92, 78)
FG = (244, 246, 244)
OUT = Path(__file__).resolve().parent.parent / "public"


def rounded_rect(x, y, cx, cy, hw, hh, r):
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    dx = max(dx, 0.0)
    dy = max(dy, 0.0)
    inside = min(max(abs(x - cx) - (hw - r), abs(y - cy) - (hh - r)), 0.0)
    return (dx * dx + dy * dy) ** 0.5 + inside - r


def ring(x, y, cx, cy, radius, thickness):
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    return abs(d - radius) - thickness / 2


def coverage(fn, x, y, step):
    hits = 0.0
    for sy in (-step / 3, 0.0, step / 3):
        for sx in (-step / 3, 0.0, step / 3):
            if fn(x + sx, y + sy) <= 0:
                hits += 1
    return hits / 9.0


def build(size):
    s = float(size)
    step = 1.0
    cx = cy = s / 2

    def bg(x, y):
        return rounded_rect(x, y, cx, cy, s * 0.5, s * 0.5, s * 0.235)

    body_hw = s * 0.082
    body_hh = s * 0.152
    body_cy = cy - s * 0.085

    def mic_body(x, y):
        return rounded_rect(x, y, cx, body_cy, body_hw, body_hh, body_hw)

    arc_r = s * 0.175
    arc_t = s * 0.048
    arc_cy = body_cy + s * 0.03

    def mic_arc(x, y):
        if y < arc_cy:
            return 1.0
        return ring(x, y, cx, arc_cy, arc_r, arc_t)

    def stem(x, y):
        return rounded_rect(x, y, cx, arc_cy + arc_r + s * 0.055, arc_t / 2, s * 0.055, arc_t / 2)

    rows = []
    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            a_bg = coverage(bg, x, y, step)
            if a_bg <= 0:
                row += bytes((0, 0, 0, 0))
                continue
            a_fg = max(
                coverage(mic_body, x, y, step),
                coverage(mic_arc, x, y, step),
                coverage(stem, x, y, step),
            )
            r = round(BG[0] * (1 - a_fg) + FG[0] * a_fg)
            g = round(BG[1] * (1 - a_fg) + FG[1] * a_fg)
            b = round(BG[2] * (1 - a_fg) + FG[2] * a_fg)
            row += bytes((r, g, b, round(255 * a_bg)))
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"{path.name}: {len(png)} байт")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size, names in ((192, ["icon-192.png"]), (512, ["icon-512.png"]), (180, ["apple-touch-icon.png"])):
        rows = build(size)
        for name in names:
            write_png(OUT / name, rows, size)


if __name__ == "__main__":
    main()
