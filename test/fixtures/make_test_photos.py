"""Generate realistic-ish phone photos of an action figure for end-to-end tests.

Outputs (in this directory):
  figure_front.jpg          - clawed hero figure on a wooden table in front of a wall (portrait 1536x2048)
  figure_front_exif6.jpg    - same photo stored rotated with EXIF Orientation=6 (like an iPhone)
  figure_back.jpg           - the back of the same figure
  figure_busy.jpg           - figure in front of a cluttered, patterned background (hard case)
  truth_front.png           - ground-truth mask for figure_front.jpg
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = Path(__file__).parent
W, H = 1536, 2048
random.seed(7)


def wood_table_and_wall(w, h, busy=False):
    img = Image.new("RGB", (w, h))
    px = img.load()
    horizon = int(h * 0.56)
    for y in range(h):
        for x in range(w):
            if y < horizon:
                # warm painted wall with soft vignette lighting
                light = 1.0 - 0.25 * (abs(x - w * 0.55) / w) - 0.15 * (y / horizon)
                base = (226, 216, 196)
                px[x, y] = tuple(int(c * light) for c in base)
            else:
                t = (y - horizon) / (h - horizon)
                grain = math.sin(x * 0.045 + math.sin(y * 0.01) * 3 + y * 0.004) * 12 + math.sin(x * 0.31) * 4
                light = 0.8 + 0.3 * t
                base = (160 + grain, 108 + grain * 0.7, 62 + grain * 0.4)
                px[x, y] = tuple(max(0, min(255, int(c * light))) for c in base)
    d = ImageDraw.Draw(img)
    if busy:
        # colourful clutter: posters, blocks and a patterned rug
        for i in range(26):
            x0 = random.randint(0, w)
            y0 = random.randint(0, horizon)
            s = random.randint(60, 260)
            col = random.choice([(220, 60, 60), (60, 140, 220), (240, 200, 40), (70, 180, 90), (150, 80, 200)])
            if abs(x0 - w / 2) < 420:
                continue
            d.rectangle([x0, y0, x0 + s, y0 + s * 1.3], fill=col, outline=(40, 40, 40), width=6)
        for yy in range(horizon, h, 90):
            for xx in range(0, w, 90):
                if ((xx // 90) + (yy // 90)) % 2 == 0:
                    d.rectangle([xx, yy, xx + 90, yy + 90], fill=(120, 70, 40))
    return img, horizon


def draw_figure(back=False):
    """Draw the figure on a transparent layer; returns (rgba, mask)."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = W // 2
    yellow = (246, 196, 26, 255)
    blue = (28, 62, 170, 255)
    dark = (30, 30, 38, 255)
    skin = (232, 180, 140, 255)
    silver = (214, 220, 230, 255)
    # legs
    d.rounded_rectangle([cx - 150, 1180, cx - 30, 1640], 40, fill=blue)
    d.rounded_rectangle([cx + 30, 1180, cx + 150, 1640], 40, fill=blue)
    d.rounded_rectangle([cx - 175, 1560, cx - 20, 1680], 30, fill=dark)  # boots
    d.rounded_rectangle([cx + 20, 1560, cx + 175, 1680], 30, fill=dark)
    # torso
    d.polygon([(cx - 210, 640), (cx + 210, 640), (cx + 150, 1200), (cx - 150, 1200)], fill=yellow)
    d.rectangle([cx - 150, 1100, cx + 150, 1200], fill=blue)  # trunks
    d.rectangle([cx - 160, 1080, cx + 160, 1110], fill=(200, 40, 40, 255))  # belt
    if not back:
        d.polygon([(cx - 120, 700), (cx, 1000), (cx + 120, 700), (cx + 60, 700), (cx, 880), (cx - 60, 700)], fill=blue)
    # arms held away from the body (so there is a visible gap)
    d.polygon([(cx - 210, 650), (cx - 300, 660), (cx - 400, 1080), (cx - 320, 1100), (cx - 250, 820)], fill=yellow)
    d.polygon([(cx + 210, 650), (cx + 300, 660), (cx + 400, 1080), (cx + 320, 1100), (cx + 250, 820)], fill=yellow)
    d.ellipse([cx - 420, 1060, cx - 300, 1170], fill=blue)  # gloves
    d.ellipse([cx + 300, 1060, cx + 420, 1170], fill=blue)
    # claws
    for k in (-1, 0, 1):
        for side in (-1, 1):
            bx = cx + side * 360 + k * 32
            d.polygon([(bx - 9, 1150), (bx + 9, 1150), (bx + 4 + side * 20, 1420), (bx - 2 + side * 20, 1420)], fill=silver)
    # head + mask with pointy "ears"
    d.ellipse([cx - 115, 380, cx + 115, 660], fill=skin if not back else dark)
    d.polygon([(cx - 115, 520), (cx - 200, 300), (cx - 60, 420), (cx + 60, 420), (cx + 200, 300), (cx + 115, 520)], fill=dark)
    if not back:
        d.polygon([(cx - 110, 470), (cx + 110, 470), (cx + 100, 560), (cx - 100, 560)], fill=yellow)
        d.ellipse([cx - 80, 490, cx - 30, 525], fill=(255, 255, 255, 255))
        d.ellipse([cx + 30, 490, cx + 80, 525], fill=(255, 255, 255, 255))
        d.arc([cx - 50, 560, cx + 50, 630], 20, 160, fill=dark, width=8)
    # simple shading: darker right side
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.rectangle([cx + 40, 0, W, H], fill=60)
    shade = shade.filter(ImageFilter.GaussianBlur(120))
    alpha = layer.split()[3]
    darker = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    darker.putalpha(ImageChops.multiply(shade, alpha))
    layer = Image.alpha_composite(layer, darker)
    mask = alpha.point(lambda a: 255 if a > 127 else 0)
    return layer, mask


def compose(bg, fig, mask, horizon):
    # contact shadow under the feet
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).ellipse([W // 2 - 260, 1630, W // 2 + 260, 1720], fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(25))
    black = Image.new("RGB", (W, H), (20, 12, 6))
    bg = Image.composite(black, bg, sh)
    out = bg.convert("RGBA")
    out = Image.alpha_composite(out, fig.filter(ImageFilter.GaussianBlur(1.2)))
    out = out.convert("RGB")
    # sensor noise
    noise = Image.effect_noise((W, H), 10).convert("RGB")
    out = Image.blend(out, ImageChops.add(out, noise, scale=2.0, offset=-64), 0.25)
    return out


def main():
    bg, horizon = wood_table_and_wall(W, H)
    fig, mask = draw_figure()
    front = compose(bg.copy(), fig, mask, horizon)
    front.save(OUT / "figure_front.jpg", quality=88)
    mask.save(OUT / "truth_front.png")

    # iPhone-style: pixels stored landscape, EXIF says rotate 90° CW to display
    rotated = front.transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif()
    exif[0x0112] = 6
    rotated.save(OUT / "figure_front_exif6.jpg", quality=88, exif=exif.tobytes())

    figb, _ = draw_figure(back=True)
    compose(bg.copy(), figb, mask, horizon).save(OUT / "figure_back.jpg", quality=88)

    busy, hz = wood_table_and_wall(W, H, busy=True)
    compose(busy, fig, mask, hz).save(OUT / "figure_busy.jpg", quality=88)
    print("wrote", sorted(p.name for p in OUT.glob("*.jpg")))


if __name__ == "__main__":
    main()
