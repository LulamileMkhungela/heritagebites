#!/usr/bin/env python3
"""
Builder for the Heritage Bites brand bitmaps.

Run by hand when the logo changes; its output is committed, because browsers,
phones and social scrapers all need real files. Kept in the repository so the
icons can be regenerated rather than lost.

Usage:
    python3 scripts/build-brand-assets.py <logo.png>

Input is the supplied artwork: white line art on a transparent background.

## What it produces, and why each file exists

    public/img/logo-badge.png        the whole badge, white on transparent
    public/img/logo-badge-ink.png    the same in ink, for light surfaces
    public/img/social-card.jpg       1200×630, the picture a pasted link shows
    public/favicon.ico               16/32/48, for browsers that still ask for it
    public/favicon-16.png            browser tab, small
    public/favicon-32.png            browser tab, standard
    public/apple-touch-icon.png      180×180, iOS home screen (no transparency)
    public/icon-192.png              manifest / Android home screen
    public/icon-512.png              manifest, splash and store listings
    public/icon-maskable-512.png     Android adaptive icon, extra safe margin

## Two decisions worth knowing

1. **The icons are not the whole badge.** At 16px the ring of lettering turns to
   mush and the tab shows a grey smudge. The badge is engraved, so the pot —
   the one shape that stays legible at 16px — is isolated from the artwork by
   connected-component analysis (it is a distinct, large, solid group) and set
   on an ink tile. The full badge is used wherever there is room: the header, the
   footer, the 404 page and the social card.

2. **The tile is ink, not transparent.** The artwork is white: white on a
   transparent page disappears in a light browser tab, and recoloured dark it
   disappears in a dark one. An ink disc is legible against both, which is the
   only way one icon can be right in both themes.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
IMG = PUBLIC / "img"

INK = (22, 16, 12)
BONE = (246, 241, 231)
OCHRE = (224, 165, 46)

# The site's own typefaces, converted from public/fonts to TTF by the caller's
# environment (they ship as woff2, which Pillow cannot read).
FRAUNCES = "/tmp/fraunces700.ttf"
MANROPE = "/tmp/manrope600.ttf"
MONO = "/tmp/plexmono500.ttf"


def trimmed(logo: Image.Image, padding: float = 0.02) -> Image.Image:
    """The artwork without its transparent margin, plus a hair of breathing room."""
    art = logo.crop(logo.getbbox())
    side = int(max(art.size) * (1 + padding * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((side - art.width) // 2, (side - art.height) // 2))
    return canvas


def recoloured(art: Image.Image, rgb) -> Image.Image:
    """Keep the shape, change the colour: white artwork → ink artwork."""
    out = Image.new("RGBA", art.size, rgb + (0,))
    out.putalpha(art.getchannel("A"))
    return out


def isolate_pot(art: Image.Image) -> Image.Image:
    """
    The pot and its lid, lifted out of the badge.

    The artwork is a single engraving, so the pot has to be found the way a
    person finds it: the biggest solid cluster near the middle that is not the
    frame. Two traps, both found by looking at the first attempt:

      * the outer ring is the single largest component and sits dead centre, so a
        naive "largest central piece" picks the frame and then the crop is the
        whole badge — a smudge at 16px, the exact thing the icons are meant to
        avoid. Anything within reach of the canvas edge, or wider than 60% of the
        art, is therefore rejected before the size is even considered;
      * the lid and the contents are separate components, so the pot is grown by
        absorbing small neighbours that sit inside its own bounding box — but
        only small ones, so the growth cannot creep back out to the ring.
    """
    import numpy as np
    from scipy import ndimage

    alpha = np.array(art.getchannel("A")) > 60
    labels, count = ndimage.label(alpha)
    h, w = alpha.shape
    total = float(alpha.sum())

    def bbox(label):
        ys, xs = np.where(labels == label)
        return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())

    boxes = {label: bbox(label) for label in range(1, count + 1)}
    areas = {label: float((labels == label).sum()) for label in range(1, count + 1)}

    # Reject the frame, the arched lettering and anything touching the edge.
    def is_frame(label):
        x0, x1, y0, y1 = boxes[label]
        too_wide = (x1 - x0) > 0.6 * w
        too_tall = (y1 - y0) > 0.6 * h
        touches_edge = x0 < 0.04 * w or x1 > 0.96 * w or y0 < 0.04 * h or y1 > 0.96 * h
        return too_wide or too_tall or touches_edge

    def centrality(label):
        x0, x1, y0, y1 = boxes[label]
        return ((x0 + x1) / 2 / w, (y0 + y1) / 2 / h)

    candidates = [
        label
        for label in sorted(areas, key=areas.get, reverse=True)
        if areas[label] > 0.01 * total and not is_frame(label)
    ]
    if not candidates:
        raise SystemExit("could not find the pot in this artwork — check the input")

    pot = next(
        (
            label
            for label in candidates
            if 0.25 < centrality(label)[0] < 0.75 and 0.3 < centrality(label)[1] < 0.7
        ),
        candidates[0],
    )

    keep = labels == pot
    x0, x1, y0, y1 = boxes[pot]
    pad_x, pad_y = 0.12 * (x1 - x0), 0.10 * (y1 - y0)

    # Absorb the lid and small in-box pieces (steam, rim dashes, contents).
    for label in candidates:
        if label == pot:
            continue
        if areas[label] > 0.6 * areas[pot]:
            continue  # a big neighbour is another part of the badge, not the pot
        bx0, bx1, by0, by1 = boxes[label]
        if bx0 >= x0 - pad_x and bx1 <= x1 + pad_x and by0 >= y0 - pad_y and by1 <= y1 + pad_y:
            keep |= labels == label
            x0, x1 = min(x0, bx0), max(x1, bx1)
            y0, y1 = min(y0, by0), max(y1, by1)

    cut = art.copy()
    cut.putalpha(Image.fromarray((keep * 255).astype("uint8")))
    pot_img = cut.crop((x0, y0, x1 + 1, y1 + 1))

    side = int(max(pot_img.size) * 1.06)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(pot_img, ((side - pot_img.width) // 2, (side - pot_img.height) // 2))
    print(f"  pot: component {pot}, {int(areas[pot])} px, box {pot_img.size}, art {art.size}")
    return square


def save_png(image: Image.Image, path: Path, size: int) -> None:
    """
    Write a web-weight PNG.

    The artwork is white line art, so it has one colour and a soft edge: an
    8-colour palette keeps the edges and drops the truecolour data, which is the
    difference between 200 KB and 60 KB for the same picture. The badge is shown
    at 44px in the header, so 512px is already more than a 3× screen can use.
    """
    resized = image.resize((size, size), Image.LANCZOS)
    resized.quantize(colors=8, method=Image.FASTOCTREE).save(path, optimize=True)


def tile(mark: Image.Image, size: int, inset: float = 0.09, rounded: bool = True) -> Image.Image:
    """The mark on an ink tile, drawn at 4× and reduced so the curves stay clean."""
    big = size * 4
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        [0, 0, big - 1, big - 1],
        radius=int(big * 0.22) if rounded else 0,
        fill=INK + (255,),
    )
    inner = int(big * (1 - inset * 2))
    canvas.alpha_composite(mark.resize((inner, inner), Image.LANCZOS), ((big - inner) // 2, (big - inner) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def social_card(badge: Image.Image) -> Image.Image:
    """
    The picture WhatsApp, Facebook, Slack and LinkedIn show for a pasted link.

    A logo alone tells a stranger nothing, so the card carries the badge and the
    four facts that decide whether someone taps: what the food is, what it costs,
    where it goes, and when the kitchen cooks.
    """
    W, H = 1200, 630
    card = Image.new("RGB", (W, H), INK)

    # A soft warm glow behind the badge, so the card is not a flat black sheet.
    glow = Image.new("RGB", (W, H), INK)
    gdraw = ImageDraw.Draw(glow)
    for i in range(30, 0, -1):
        r = 300 + i * 12
        gdraw.ellipse([330 - r, H // 2 - r, 330 + r, H // 2 + r], fill=(INK[0] + i, INK[1] + i // 2, INK[2]))
    card = Image.blend(card, glow.filter(ImageFilter.GaussianBlur(80)), 0.6)
    draw = ImageDraw.Draw(card)

    draw.rounded_rectangle([28, 28, W - 28, H - 28], radius=28, outline=OCHRE, width=2)

    badge_h = 372
    art = badge.resize((badge_h, badge_h), Image.LANCZOS)
    card.paste(art, (86, (H - badge_h) // 2), art)

    x = 86 + badge_h + 58
    title = ImageFont.truetype(FRAUNCES, 74)
    kicker = ImageFont.truetype(MONO, 23)
    body = ImageFont.truetype(MANROPE, 30)
    small = ImageFont.truetype(MONO, 22)

    draw.text((x, 126), "HERITAGE BITES", font=kicker, fill=OCHRE)
    draw.text((x, 168), "Every Bite", font=title, fill=BONE)
    draw.text((x, 246), "Tells a Story", font=title, fill=BONE)

    draw.text((x, 356), "South African plates · R100–R130", font=body, fill=BONE)
    draw.text((x, 398), "Delivered in Rosebank & Sandton", font=body, fill=(246, 241, 231))
    draw.text((x, 444), "Thursdays & Fridays · 12:00–13:30", font=small, fill=OCHRE)

    draw.rounded_rectangle([x, 496, x + 300, 546], radius=26, fill=OCHRE)
    draw.text((x + 28, 509), "Order online", font=ImageFont.truetype(MANROPE, 26), fill=INK)
    return card


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    logo = Image.open(Path(sys.argv[1])).convert("RGBA")
    badge = trimmed(logo)
    pot = isolate_pot(badge)

    IMG.mkdir(parents=True, exist_ok=True)

    white = badge.resize((512, 512), Image.LANCZOS)
    save_png(white, IMG / "logo-badge.png", 512)
    save_png(recoloured(white, INK), IMG / "logo-badge-ink.png", 512)

    # Icons: the pot, on ink, at every size a browser or phone asks for.
    tile(pot, 512).save(PUBLIC / "icon-512.png", optimize=True)
    tile(pot, 512, inset=0.18).save(PUBLIC / "icon-maskable-512.png", optimize=True)
    tile(pot, 192).save(PUBLIC / "icon-192.png", optimize=True)
    # iOS composites transparency onto black, so the home-screen icon is opaque.
    tile(pot, 180, rounded=False).convert("RGB").save(PUBLIC / "apple-touch-icon.png", optimize=True)
    tile(pot, 32).save(PUBLIC / "favicon-32.png", optimize=True)
    tile(pot, 16).save(PUBLIC / "favicon-16.png", optimize=True)
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    tile(pot, 48).save(PUBLIC / "favicon.ico", format="ICO", sizes=ico_sizes)

    social_card(badge).save(IMG / "social-card.jpg", quality=92, optimize=True, progressive=True)

    outputs = [
        IMG / "logo-badge.png",
        IMG / "logo-badge-ink.png",
        IMG / "social-card.jpg",
        PUBLIC / "favicon.ico",
        PUBLIC / "favicon-32.png",
        PUBLIC / "favicon-16.png",
        PUBLIC / "apple-touch-icon.png",
        PUBLIC / "icon-192.png",
        PUBLIC / "icon-512.png",
        PUBLIC / "icon-maskable-512.png",
    ]
    for path in outputs:
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
