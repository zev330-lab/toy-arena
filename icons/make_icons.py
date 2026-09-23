"""Generate Toy Arena app icons (run: python3 icons/make_icons.py).

A comic starburst with two toy silhouettes squaring off and a lightning bolt,
on purple rays. Outputs icon-192/512, a maskable 512 and the 180px apple-touch-icon.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent
S = 1024
INK = (26, 16, 48)


def star(cx, cy, r_out, r_in, n, rot=0.0):
    pts = []
    for i in range(n * 2):
        a = rot + math.pi * i / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def outlined(d, pts, fill, width):
    d.polygon(pts, fill=INK)
    # shrink toward the centroid for the fill so the ink border stays even
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    inner = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        L = math.hypot(dx, dy) or 1
        inner.append((x - dx / L * width, y - dy / L * width))
    d.polygon(inner, fill=fill)


def figure(d, cx, base_y, h, color, facing):
    """Chunky action-figure silhouette (head, torso, raised fist)."""
    u = h / 10
    parts = [
        ("ellipse", [cx - 1.3 * u, base_y - 10 * u, cx + 1.3 * u, base_y - 7.4 * u]),
        ("poly", [(cx - 2.2 * u, base_y - 7.2 * u), (cx + 2.2 * u, base_y - 7.2 * u), (cx + 1.6 * u, base_y - 3.4 * u), (cx - 1.6 * u, base_y - 3.4 * u)]),
        ("poly", [(cx - 1.6 * u, base_y - 3.6 * u), (cx - 0.2 * u, base_y - 3.6 * u), (cx - 0.5 * u, base_y), (cx - 1.9 * u, base_y)]),
        ("poly", [(cx + 0.2 * u, base_y - 3.6 * u), (cx + 1.6 * u, base_y - 3.6 * u), (cx + 1.9 * u, base_y), (cx + 0.5 * u, base_y)]),
        # punching arm toward the opponent
        ("poly", [(cx + facing * 1.6 * u, base_y - 7.0 * u), (cx + facing * 4.6 * u, base_y - 7.6 * u), (cx + facing * 4.8 * u, base_y - 6.2 * u), (cx + facing * 1.8 * u, base_y - 5.4 * u)]),
        ("ellipse", [cx + facing * 4.3 * u - 1.0 * u, base_y - 8.0 * u, cx + facing * 4.3 * u + 1.0 * u, base_y - 5.8 * u]),
        # other arm down
        ("poly", [(cx - facing * 1.8 * u, base_y - 7.0 * u), (cx - facing * 2.9 * u, base_y - 6.6 * u), (cx - facing * 2.6 * u, base_y - 3.6 * u), (cx - facing * 1.7 * u, base_y - 4.2 * u)]),
    ]
    for pad, col in ((0.45 * u, INK), (0, color)):
        for kind, geo in parts:
            if kind == "ellipse":
                x0, y0, x1, y1 = geo
                d.ellipse([x0 - pad, y0 - pad, x1 + pad, y1 + pad], fill=col)
            else:
                cxp = sum(p[0] for p in geo) / len(geo)
                cyp = sum(p[1] for p in geo) / len(geo)
                grown = []
                for x, y in geo:
                    dx, dy = x - cxp, y - cyp
                    L = math.hypot(dx, dy) or 1
                    grown.append((x + dx / L * pad, y + dy / L * pad))
                d.polygon(grown, fill=col)


def draw(size, safe=1.0):
    img = Image.new("RGB", (S, S), (42, 26, 143))
    d = ImageDraw.Draw(img)
    # rays
    for i in range(24):
        a0 = i * 2 * math.pi / 24
        a1 = a0 + math.pi / 24
        col = (75, 59, 255) if i % 2 == 0 else (42, 26, 143)
        d.polygon([(S / 2, S / 2), (S / 2 + math.cos(a0) * S, S / 2 + math.sin(a0) * S), (S / 2 + math.cos(a1) * S, S / 2 + math.sin(a1) * S)], fill=col)
    # halftone dots
    for y in range(0, S, 36):
        for x in range(0, S, 36):
            r = 5
            d.ellipse([x - r, y - r, x + r, y + r], fill=(60, 45, 180))
    k = safe
    c = S / 2
    outlined(d, star(c, c + 10 * k, 470 * k, 330 * k, 14, 0.12), (255, 210, 63), 22 * k)
    outlined(d, star(c, c + 10 * k, 340 * k, 260 * k, 14, 0.35), (255, 138, 31), 18 * k)
    figure(d, c - 215 * k, c + 290 * k, 520 * k, (255, 61, 61), 1)
    figure(d, c + 215 * k, c + 290 * k, 520 * k, (45, 125, 255), -1)
    bolt = [(c + 30 * k, c - 330 * k), (c - 70 * k, c - 60 * k), (c + 5 * k, c - 60 * k), (c - 60 * k, c + 160 * k), (c + 90 * k, c - 120 * k), (c + 10 * k, c - 120 * k), (c + 80 * k, c - 330 * k)]
    d.polygon([(x + 10, y + 10) for x, y in bolt], fill=INK)
    d.polygon(bolt, fill=(255, 240, 120), outline=INK, width=int(14 * k))
    return img.resize((size, size), Image.LANCZOS)


def main():
    draw(512).save(OUT / "icon-512.png", optimize=True)
    draw(192).save(OUT / "icon-192.png", optimize=True)
    draw(180).save(OUT / "apple-touch-icon.png", optimize=True)
    draw(512, safe=0.78).save(OUT / "icon-maskable-512.png", optimize=True)
    print("icons written")


if __name__ == "__main__":
    main()
