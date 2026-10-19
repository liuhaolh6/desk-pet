"""Generate icon.png (256), tray.png (32) and build/icon.ico for the app.

Run:  python tools/make-assets.py
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
BUILD = os.path.join(ROOT, "build")

INK = (32, 49, 112, 255)
WHITE = (255, 255, 255, 255)
BLUSH = (255, 178, 193, 210)
DROP = (86, 170, 255, 255)


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


def main():
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
    print("wrote icon.png, icon.ico, tray.png")


if __name__ == "__main__":
    main()
