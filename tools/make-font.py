"""Build the bundled UI font subset from Noto Sans SC (OFL 1.1).

Source on this machine: C:\\Windows\\Fonts\\NotoSansSC-VF.ttf
Output: assets/fonts/DeskPetSans-Regular.woff2 / DeskPetSans-Semibold.woff2

The subset covers ASCII, GB2312 level 1+2, CJK punctuation and every
non-ASCII character used by the app's HTML/JS/CSS, so normal UI text and
user-entered phrases stay on the bundled font while rare glyphs fall back
to the system font stack.

Run:  python tools/make-font.py
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")
SOURCE = os.environ.get("DESKPET_FONT_SRC", r"C:\Windows\Fonts\NotoSansSC-VF.ttf")


def gb2312_chars():
    chars = set()
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(bytes([b1, b2]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return chars


def app_chars():
    chars = set()
    for folder in ("app", "lib"):
        base = os.path.join(ROOT, folder)
        for name in os.listdir(base):
            if not name.endswith((".html", ".css", ".js")):
                continue
            with open(os.path.join(base, name), encoding="utf-8", errors="ignore") as fh:
                chars.update(ch for ch in fh.read() if ord(ch) > 0x7F)
    return chars


def charset():
    chars = set(chr(i) for i in range(0x20, 0x7F))
    chars.update(gb2312_chars())
    chars.update(chr(i) for i in range(0x2000, 0x2070))
    chars.update(chr(i) for i in range(0x3000, 0x3040))
    chars.update(chr(i) for i in range(0xFF00, 0xFFF0))
    chars.update("·—…“”‘’《》【】「」『』、。，！？；：（）〔〕％℃")
    chars.update(app_chars())
    return "".join(sorted(chars))


def build(weight, family_suffix, out_name):
    font = TTFont(SOURCE)
    instantiateVariableFont(font, {"wght": weight}, inplace=True, updateFontNames=False)

    # Rename the modified font so it never claims the upstream family name.
    family = "DeskPet Sans"
    full = family + " " + family_suffix
    ps = "DeskPetSans-" + family_suffix
    for rec in font["name"].names:
        try:
            value = rec.toUnicode()
        except Exception:
            continue
        if rec.nameID in (1, 4, 6, 16, 17):
            if rec.nameID == 1:
                new = family
            elif rec.nameID == 4:
                new = full
            elif rec.nameID == 6:
                new = ps
            elif rec.nameID == 16:
                new = family
            else:
                new = family_suffix
            rec.string = new

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.drop_tables += ["BASE"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=charset())
    subsetter.subset(font)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, out_name)
    font.flavor = "woff2"
    font.save(path)
    print("wrote", path, os.path.getsize(path), "bytes")


def main():
    if not os.path.exists(SOURCE):
        sys.exit("font source not found: " + SOURCE)
    print("charset size:", len(charset()))
    build(400, "Regular", "DeskPetSans-Regular.woff2")
    build(600, "Semibold", "DeskPetSans-Semibold.woff2")


if __name__ == "__main__":
    main()
