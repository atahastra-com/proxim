#!/usr/bin/env python3
"""Regenerate the Proxim OS / Atahastra branding PNGs from atahastra-logo.png.

Outputs are committed (gen/), so a build never needs Pillow or the fonts.
Run on any machine with Pillow and the Poppins font:
    python3 distro/branding/make-assets.py
Override fonts with PROXIM_FONT_LIGHT / PROXIM_FONT_MEDIUM.
"""
import base64, io, math, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'atahastra-logo.png')
OUT = os.path.join(HERE, 'gen')
GF = '/usr/share/fonts/truetype/sand-box/google/Poppins'
FONT_LIGHT = os.environ.get('PROXIM_FONT_LIGHT', f'{GF}/Poppins-Light.ttf')
FONT_MED = os.environ.get('PROXIM_FONT_MEDIUM', f'{GF}/Poppins-Medium.ttf')

NAME = 'Proxim OS'
VENDOR = 'ATAHASTRA'
TEXT = (240, 242, 247, 255)      # wordmark: near-white
SUB = (150, 155, 168, 255)       # vendor line: silver grey

os.makedirs(OUT, exist_ok=True)


def mark():
    """The logo trimmed to its strokes, on a transparent square."""
    im = Image.open(SRC).convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(box)
    side = max(im.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return sq


def fit(im, size, pad=0.0):
    inner = round(size * (1 - 2 * pad))
    small = im.resize((inner, inner), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(small, ((size - inner) // 2, (size - inner) // 2))
    return out


def text(s, font, px, fill, spacing=0.0):
    f = ImageFont.truetype(font, px)
    widths = [f.getlength(c) for c in s]
    track = px * spacing
    w = math.ceil(sum(widths) + track * (len(s) - 1)) + 4
    asc, desc = f.getmetrics()
    im = Image.new('RGBA', (w, asc + desc + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 2
    for c, cw in zip(s, widths):
        d.text((x, 2), c, font=f, fill=fill)
        x += cw + track
    return im.crop(im.getchannel('A').getbbox())


def stack(parts, gaps, width=None, height=None):
    """Center images vertically in a column."""
    w = width or max(p.width for p in parts)
    h = sum(p.height for p in parts) + sum(gaps)
    H = height or h
    out = Image.new('RGBA', (w, H), (0, 0, 0, 0))
    y = (H - h) // 2
    for i, p in enumerate(parts):
        out.alpha_composite(p, ((w - p.width) // 2, y))
        y += p.height + (gaps[i] if i < len(gaps) else 0)
    return out


def save(im, name):
    im.save(os.path.join(OUT, name), optimize=True)


M = mark()

# Icon theme sizes (the plain mark).
for s in (16, 24, 32, 48, 64, 96, 128, 256):
    save(fit(M, s, 0.04), f'proxim-logo-{s}.png')

# Text lockup, square, for Settings > About ($LOGO-text*) at 256.
def lockup(scale):
    m = fit(M, round(128 * scale))
    t = text(NAME, FONT_LIGHT, round(34 * scale), TEXT)
    v = text(VENDOR, FONT_MED, round(12 * scale), SUB, spacing=0.42)
    return m, t, v

m, t, v = lockup(1)
save(stack([m, t, v], [10, 10], 256, 256), 'proxim-logo-text-256.png')

# About page emblem (Debian's gnome-control-center reads
# /usr/share/icons/vendor/scalable/emblems/emblem-vendor.svg). An SVG
# wrapper around a 2x PNG so it stays crisp; natural size 240x190.
m, t, v = lockup(2)
big = stack([m, t, v], [20, 20], 480, 380)
buf = io.BytesIO(); big.save(buf, format='PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
with open(os.path.join(OUT, 'proxim-about.svg'), 'w') as fh:
    fh.write('<svg xmlns="http://www.w3.org/2000/svg" '
             'xmlns:xlink="http://www.w3.org/1999/xlink" '
             'width="240" height="190" viewBox="0 0 240 190">'
             f'<image width="240" height="190" xlink:href="data:image/png;base64,{b64}"/>'
             '</svg>\n')

# GDM login screen: horizontal lockup (GDM scales it to its logo slot).
gm = fit(M, 96)
gt = text(NAME, FONT_LIGHT, 44, TEXT)
g = Image.new('RGBA', (gm.width + 18 + gt.width, 96), (0, 0, 0, 0))
g.alpha_composite(gm, (0, 0))
g.alpha_composite(gt, (gm.width + 18, (96 - gt.height) // 2))
save(g, 'proxim-gdm.png')

# Debian's vendor-logos alternative set (/usr/share/images/vendor-logos),
# which kos-whitelabel points at ours: GDM's Debian default logo and other
# Debian bits read these names.
def hlockup(h):
    m = fit(M, h)
    t = text(NAME, FONT_LIGHT, round(h * 0.46), TEXT)
    out = Image.new('RGBA', (m.width + round(h * 0.19) + t.width, h), (0, 0, 0, 0))
    out.alpha_composite(m, (0, 0))
    out.alpha_composite(t, (m.width + round(h * 0.19), (h - t.height) // 2))
    return out

def svg_wrap(im, name):
    b = io.BytesIO(); im.save(b, format='PNG', optimize=True)
    w, h = im.width // 2, im.height // 2
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write('<svg xmlns="http://www.w3.org/2000/svg" '
                 'xmlns:xlink="http://www.w3.org/1999/xlink" '
                 f'width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
                 f'<image width="{w}" height="{h}" xlink:href="data:image/png;base64,'
                 f'{base64.b64encode(b.getvalue()).decode()}"/></svg>\n')

for s in (64, 128, 256):
    save(fit(M, s), f'vendor-logo-{s}.png')
    save(hlockup(s), f'vendor-logo-text-{s}.png')
svg_wrap(fit(M, 256), 'vendor-logo.svg')
svg_wrap(hlockup(128), 'vendor-logo-text.svg')

# GRUB menu background (only seen if the hidden menu is opened):
# plain black instead of Debian's desktop-grub art.
save(Image.new('RGB', (640, 480), (0, 0, 0)), 'grub-bg.png')

# Plymouth boot splash pieces.
save(fit(M, 150), 'splash-logo.png')
save(text(NAME, FONT_LIGHT, 26, TEXT), 'splash-name.png')
save(text(VENDOR, FONT_MED, 12, SUB, spacing=0.5), 'splash-vendor.png')

# Apple-style offline update progress bar (240x6 rounded pill track + fill).
BAR_W, BAR_H = 240, 6
for fname, rgba in (('splash-bar-bg.png', (255, 255, 255, 46)),
                    ('splash-bar-fill.png', (255, 255, 255, 245))):
    big = Image.new('RGBA', (BAR_W * 4, BAR_H * 4), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, BAR_W * 4 - 1, BAR_H * 4 - 1),
        radius=BAR_H * 2,
        fill=rgba,
    )
    save(big.resize((BAR_W, BAR_H), Image.LANCZOS), fname)

# iOS-style activity spinner: 12 rounded spokes, one frame per step.
SS = 4                         # supersample
S = 32
for i in range(12):
    big = Image.new('RGBA', (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    c = S * SS / 2
    for k in range(12):
        ang = (k * 30 - 90) * math.pi / 180
        age = (i - k) % 12          # 0 = brightest spoke
        a = round(255 * max(0.18, 1 - age / 12 * 1.0))
        r1, r2 = c * 0.48, c * 0.92
        wdt = c * 0.17
        x1, y1 = c + r1 * math.cos(ang), c + r1 * math.sin(ang)
        x2, y2 = c + r2 * math.cos(ang), c + r2 * math.sin(ang)
        d.line((x1, y1, x2, y2), fill=(235, 238, 245, a), width=round(wdt))
        for (x, y) in ((x1, y1), (x2, y2)):
            d.ellipse((x - wdt / 2, y - wdt / 2, x + wdt / 2, y + wdt / 2), fill=(235, 238, 245, a))
    save(big.resize((S, S), Image.LANCZOS), f'spinner-{i:02d}.png')

print('wrote', OUT)
