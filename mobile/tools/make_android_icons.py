"""Иконки Android: обычная, адаптивная (передний слой) и белая для шторки уведомлений."""
import struct
import zlib
from pathlib import Path

BG = (63, 92, 78)
FG = (244, 246, 244)
ANDROID = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"

# Плотности экранов Android: имя папки → размер иконки запуска
LAUNCHER = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
# Передний слой адаптивной иконки рисуется крупнее: система его обрежет маской
FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
NOTIFY = {
    "drawable-mdpi": 24,
    "drawable-hdpi": 36,
    "drawable-xhdpi": 48,
    "drawable-xxhdpi": 72,
    "drawable-xxxhdpi": 96,
}


def rounded_rect(x, y, cx, cy, hw, hh, r):
    dx = max(abs(x - cx) - (hw - r), 0.0)
    dy = max(abs(y - cy) - (hh - r), 0.0)
    inside = min(max(abs(x - cx) - (hw - r), abs(y - cy) - (hh - r)), 0.0)
    return (dx * dx + dy * dy) ** 0.5 + inside - r


def ring(x, y, cx, cy, radius, thickness):
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    return abs(d - radius) - thickness / 2


def coverage(fn, x, y):
    hits = 0.0
    for sy in (-0.33, 0.0, 0.33):
        for sx in (-0.33, 0.0, 0.33):
            if fn(x + sx, y + sy) <= 0:
                hits += 1
    return hits / 9.0


def mic_shapes(size, scale, cx, cy):
    """Микрофон: корпус, дуга и ножка. scale задаёт долю иконки под рисунок."""
    s = size * scale
    body_hw = s * 0.082
    body_hh = s * 0.152
    body_cy = cy - s * 0.085
    arc_r = s * 0.175
    arc_t = s * 0.048
    arc_cy = body_cy + s * 0.03

    def body(x, y):
        return rounded_rect(x, y, cx, body_cy, body_hw, body_hh, body_hw)

    def arc(x, y):
        if y < arc_cy:
            return 1.0
        return ring(x, y, cx, arc_cy, arc_r, arc_t)

    def stem(x, y):
        return rounded_rect(x, y, cx, arc_cy + arc_r + s * 0.055, arc_t / 2, s * 0.055, arc_t / 2)

    return body, arc, stem


def build_launcher(size):
    """Квадрат со скруглением и микрофоном — для старых Android без адаптивных иконок."""
    cx = cy = size / 2
    body, arc, stem = mic_shapes(size, 1.0, cx, cy)

    def bg(x, y):
        return rounded_rect(x, y, cx, cy, size * 0.5, size * 0.5, size * 0.235)

    rows = []
    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            a_bg = coverage(bg, x, y)
            if a_bg <= 0:
                row += bytes((0, 0, 0, 0))
                continue
            a_fg = max(coverage(body, x, y), coverage(arc, x, y), coverage(stem, x, y))
            row += bytes((
                round(BG[0] * (1 - a_fg) + FG[0] * a_fg),
                round(BG[1] * (1 - a_fg) + FG[1] * a_fg),
                round(BG[2] * (1 - a_fg) + FG[2] * a_fg),
                round(255 * a_bg),
            ))
        rows.append(bytes(row))
    return rows


def build_foreground(size):
    """Только микрофон на прозрачном фоне: фон даёт отдельный слой адаптивной иконки."""
    cx = cy = size / 2
    body, arc, stem = mic_shapes(size, 0.62, cx, cy)

    rows = []
    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            a = max(coverage(body, x, y), coverage(arc, x, y), coverage(stem, x, y))
            row += bytes((FG[0], FG[1], FG[2], round(255 * a))) if a > 0 else bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def build_notify(size):
    """Белый силуэт: Android сам красит иконку уведомления в акцентный цвет."""
    cx = cy = size / 2
    body, arc, stem = mic_shapes(size, 0.92, cx, cy)

    rows = []
    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            a = max(coverage(body, x, y), coverage(arc, x, y), coverage(stem, x, y))
            row += bytes((255, 255, 255, round(255 * a))) if a > 0 else bytes((0, 0, 0, 0))
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def main():
    for folder, size in LAUNCHER.items():
        rows = build_launcher(size)
        write_png(ANDROID / folder / "ic_launcher.png", rows, size)
        write_png(ANDROID / folder / "ic_launcher_round.png", rows, size)

    for folder, size in FOREGROUND.items():
        write_png(ANDROID / folder / "ic_launcher_foreground.png", build_foreground(size), size)

    for folder, size in NOTIFY.items():
        write_png(ANDROID / folder / "ic_stat_notify.png", build_notify(size), size)

    # Магазину нужна крупная иконка 512×512 для карточки приложения
    store = Path(__file__).resolve().parent.parent / "store"
    write_png(store / "icon-512.png", build_launcher(512), 512)

    print("иконки готовы: запуск, адаптивная, уведомления, 512 для карточки RuStore")


if __name__ == "__main__":
    main()
