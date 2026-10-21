"""Generate the app icon / tray icons / .ico (and optionally the default character).

Two modes:

    python tools/make-assets.py                     # legacy vector pet (fallback)
    python tools/make-assets.py --photo <file.png>  # brand assets from a portrait

`--photo` also rewrites `assets/default.png`, i.e. the built-in default role, so
the same source drives the icon, the tray and the character shown on first run.

The photo is expected to be a pre-cut sticker (transparent background). Soft
edges that were composited over white are un-matted when numpy is available; the
script still works without it (edges keep a faint white halo).
"""
import argparse
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
BUILD = os.path.join(ROOT, "build")

INK = (32, 49, 112, 255)
WHITE = (255, 255, 255, 255)
BLUSH = (255, 178, 193, 210)
DROP = (86, 170, 255, 255)

# Brand colours (kept in sync with app/tokens.css --accent / --blush).
RING = (255, 143, 190, 255)
RING_SOFT = (255, 214, 231, 255)
CHARACTER = 610


# --------------------------------------------------------------------- legacy
def draw_pet(size, padding_ratio=0.06, badge=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p = int(size * padding_ratio)
    w = size - p * 2

    # face
    d.ellipse((p, p + w * 0.18, p + w, p + w), fill=WHITE, outline=INK, width=max(2, size // 64))
    # ears
    ear = w * 0.22
    d.polygon([(p + w * 0.12, p + w * 0.34), (p + w * 0.22, p + w * 0.02), (p + w * 0.42, p + w * 0.24)],
              fill=WHITE, outline=INK)
    d.polygon([(p + w * 0.88, p + w * 0.34), (p + w * 0.78, p + w * 0.02), (p + w * 0.58, p + w * 0.24)],
              fill=WHITE, outline=INK)
    # eyes
    eye = max(3, int(w * 0.07))
    cy = p + w * 0.48
    d.ellipse((p + w * 0.30, cy - eye, p + w * 0.30 + eye * 2, cy + eye), fill=INK)
    d.ellipse((p + w * 0.56, cy - eye, p + w * 0.56 + eye * 2, cy + eye), fill=INK)
    # blush
    d.ellipse((p + w * 0.22, p + w * 0.62, p + w * 0.36, p + w * 0.70), fill=BLUSH)
    d.ellipse((p + w * 0.64, p + w * 0.62, p + w * 0.78, p + w * 0.70), fill=BLUSH)
    # mouth
    d.arc((p + w * 0.44, p + w * 0.56, p + w * 0.56, p + w * 0.70), 20, 160, fill=INK, width=max(2, size // 96))
    if badge:
        cx, cy2, r = int(p + w * 0.86), int(p + w * 0.84), max(3, int(w * 0.12))
        d.polygon([(cx, cy2 - int(r * 2.2)), (cx - r, cy2), (cx + r, cy2)], fill=DROP)
        d.ellipse((cx - r, cy2 - r, cx + r, cy2 + r), fill=DROP)
    return img


# ---------------------------------------------------------------------- photo
def unmatte_white(img):
    """Recover straight colour from a premultiplied PNG.

    Cut-out exports usually store `rgb` already multiplied by alpha. Recovering
    straight colour as `rgb / a` removes the dark rim that the soft edge would
    otherwise show on the desktop; treating the file as "matted on white"
    instead (`(rgb - (1-a)*255) / a`) is what turns those edges black.
    """
    try:
        import numpy as np
    except ImportError:
        print("numpy not available: keeping the original premultiplied colour")
        return img
    arr = np.asarray(img).astype(np.float32)
    alpha = arr[..., 3:4] / 255.0
    rgb = arr[..., :3]
    safe = np.clip(alpha, 1e-3, 1.0)
    straight = rgb / safe
    out = np.concatenate([np.clip(straight, 0, 255), arr[..., 3:4]], axis=2)
    # Snap near-opaque pixels back to fully opaque so the subject never ghosts.
    out[..., 3] = np.where(out[..., 3] >= 240, 255, out[..., 3])
    return Image.fromarray(out.astype("uint8"), "RGBA")


def subject_box(img, threshold=12):
    box = img.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()
    return box or (0, 0, img.width, img.height)


def load_character(path):
    """Return the 610x610 transparent character used as the default role."""
    img = Image.open(path).convert("RGBA")
    img = unmatte_white(img)
    side = max(img.size)
    canvas = img
    if img.size != (CHARACTER, CHARACTER):
        canvas = Image.new("RGBA", (CHARACTER, CHARACTER), (0, 0, 0, 0))
        scale = min(CHARACTER / side, CHARACTER / side)
        resized = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        canvas.alpha_composite(resized, ((CHARACTER - resized.width) // 2, (CHARACTER - resized.height) // 2))
    return canvas


def face_crop(img, tight=0.72):
    """Square crop centred on the upper part of the subject (the face)."""
    x0, y0, x1, y1 = subject_box(img)
    w, h = x1 - x0, y1 - y0
    side = int(max(w, h) * tight)
    cx = (x0 + x1) // 2
    cy = int(y0 + h * 0.40)
    left = max(0, min(img.width - side, cx - side // 2))
    top = max(0, min(img.height - side, cy - side // 2))
    return img.crop((left, top, left + side, top + side))


def round_badge(crop, size, ring_ratio=0.045, shadow=True):
    """Circular avatar with a soft brand gradient, ring and drop shadow, exactly `size` px."""
    margin = max(2, round(size * 0.06)) if shadow else 0
    inner = size - margin * 2
    d_size = inner * 4  # supersample for smooth edges

    # Soft gradient disc behind the photo so its transparent background reads as
    # a designed backdrop instead of showing the shadow through.
    grad = Image.new("RGBA", (d_size, d_size), (0, 0, 0, 0))
    top, bottom = (255, 226, 238), (228, 240, 255)
    for y in range(d_size):
        t = y / max(1, d_size - 1)
        grad.paste(
            (round(top[0] + (bottom[0] - top[0]) * t),
             round(top[1] + (bottom[1] - top[1]) * t),
             round(top[2] + (bottom[2] - top[2]) * t), 255),
            (0, y, d_size, y + 1),
        )
    disc = Image.new("L", (d_size, d_size), 0)
    ImageDraw.Draw(disc).ellipse((0, 0, d_size - 1, d_size - 1), fill=255)
    grad.putalpha(disc)

    square = crop.resize((d_size, d_size), Image.LANCZOS)
    avatar = Image.alpha_composite(grad, square)
    avatar.putalpha(disc)

    ring_w = max(2, int(d_size * ring_ratio))
    draw = ImageDraw.Draw(avatar)
    # Draw the ring so its outer edge sits on the circle itself (no white sliver).
    draw.ellipse((0, 0, d_size - 1, d_size - 1), outline=RING, width=ring_w)
    inset = ring_w + max(1, ring_w // 3)
    draw.ellipse((inset, inset, d_size - 1 - inset, d_size - 1 - inset),
                 outline=(255, 255, 255, 120), width=max(1, ring_w // 4))
    avatar = avatar.resize((inner, inner), Image.LANCZOS)

    if not shadow:
        return avatar

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    blur = max(1, margin / 2.0)
    sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((margin // 2, margin, size - 1 - margin // 2, size - 1),
                               fill=(32, 49, 112, 80))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(avatar, (margin, margin))
    return canvas


def photo_assets(path):
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)

    source = Image.open(path).convert("RGBA")
    character = load_character(path)
    character.save(os.path.join(ASSETS, "default.png"))
    print("wrote default.png (%dx%d)" % character.size)

    icon = round_badge(face_crop(character, 1.0), 256)
    icon.save(os.path.join(ASSETS, "icon.png"))
    icon.resize((256, 256), Image.LANCZOS).save(
        os.path.join(BUILD, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    round_badge(face_crop(character, 0.72), 32, ring_ratio=0.12).save(os.path.join(ASSETS, "tray.png"))
    round_badge(face_crop(character, 0.78), 64, ring_ratio=0.08).save(os.path.join(ASSETS, "tray@2x.png"))
    print("wrote icon.png (%dx%d), icon.ico, tray.png, tray@2x.png" % icon.size)
    print("source:", path, source.size)


def vector_assets():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    icon = draw_pet(256, 0.04)
    icon.save(os.path.join(ASSETS, "icon.png"))
    # electron-builder wants a multi-resolution .ico (256px maximum) as the
    # Windows executable icon / installer icon.
    icon.save(
        os.path.join(BUILD, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    tray_img = draw_pet(32, 0.0)
    tray_img.save(os.path.join(ASSETS, "tray.png"))
    # Windows tray reads 16px well; keep a larger source for HiDPI
    draw_pet(64, 0.02).save(os.path.join(ASSETS, "tray@2x.png"))
    print("wrote icon.png, icon.ico, tray.png, tray@2x.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photo", help="portrait PNG used for the icon, tray and default character")
    args = parser.parse_args()
    if args.photo:
        photo_assets(args.photo)
    else:
        vector_assets()


if __name__ == "__main__":
    main()