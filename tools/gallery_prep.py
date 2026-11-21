#!/usr/bin/env python3
"""Pack-page photo galleries: web copies of our REAL pack photos (Shiva 21-11-2026, Bhargava: "add more pics to website
too"). Reads the source photos from docs/ (on Bhargava's Mac only; docs/ is not in the repo) and writes, per pack:

  assets/packs/gallery/<slug>/<nn>-<kind>.jpg     longest side <= 1200 px, quality 80, progressive
  assets/packs/gallery/<slug>/<nn>-<kind>-t.jpg   thumbnail, longest side 240 px, quality 72

plus tools/gallery.json, which tools/build_pages.py and build_i18n.py read to draw the gallery. Every copy is re-encoded
from pixels only, so no EXIF / location data reaches the site. Nothing here is drawn or generated: studio back shots,
crops of the printed pouch and shop photos. Re-run after adding a photo; the build never reads docs/.

    python3 -B tools/gallery_prep.py
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs" / "marketing"
OUT = ROOT / "assets" / "packs" / "gallery"
MANIFEST = ROOT / "tools" / "gallery.json"
SLUG = {"TURM": "turmeric-powder", "KPAS": "hill-turmeric-powder", "SANN": "sannam-chilli-powder",
        "TEJA": "teja-chilli-powder", "CASH": "cashew-kernels", "CBEL": "cane-jaggery", "TBEL": "palm-jaggery"}
# kind = the ui.g_<kind> alt-text label. Order = order on the page (the front pack photo stays first, outside this list).
KINDS = ("back", "closeup", "story", "nutrition", "care", "angle", "shelf", "stocked")


def sources(code):
    """[(kind, source path)] for one pack; a missing optional shop photo is simply left out."""
    v3 = DOCS / "amazon" / "v3_veduka_2026-11-13" / f"1AF-{code}-0540_BACK.jpg"
    more = DOCS / "images_more_21-11"
    jio = DOCS / "jiomart" / "images"
    if code == "CBEL":
        crops = [("closeup", jio / "1AF-CBEL-0540_7-front-closeup.jpg"), ("story", jio / "1AF-CBEL-0540_11-story-panel.jpg"),
                 ("nutrition", jio / "1AF-CBEL-0540_13-nutrition-table.jpg"), ("care", jio / "1AF-CBEL-0540_12-storage-care.jpg")]
    elif code == "TBEL":
        crops = [("closeup", jio / "1AF-TBEL-0540_6-front-closeup.jpg"), ("story", jio / "1AF-TBEL-0540_7-story-panel.jpg"),
                 ("nutrition", jio / "1AF-TBEL-0540_8-nutrition-table.jpg"), ("care", jio / "1AF-TBEL-0540_9-storage-care.jpg")]
    else:
        crops = [(k, more / f"1AF-{code}-0540_{n}.jpg") for k, n in
                 (("closeup", "11-front-closeup"), ("story", "12-story"), ("nutrition", "13-nutrition"), ("care", "14-maker-storage"))]
    shop = DOCS / "photography" / "shop_2026-11-20" / "channels" / "website" / code
    extra = []
    for kind, stem in (("angle", "_angle"), ("shelf", "_on-our-shop-shelf"), ("stocked", "_stocked-in-our-shop")):
        hits = sorted(shop.glob(f"{code}{stem}*.jpg")) if shop.is_dir() else []
        if hits:
            extra.append((kind, hits[0]))
    out = [("back", v3)] + crops + extra
    missing = [str(p) for _, p in out if not p.exists()]
    if missing:
        sys.exit(f"{code}: missing source photo(s): {missing}")
    return out


def save(im, path, longest, quality):
    im = im.convert("RGB")
    im.thumbnail((longest, longest), Image.LANCZOS)
    clean = Image.new("RGB", im.size)
    clean.paste(im)  # pixels only: no EXIF, ICC or other metadata carried over
    clean.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return clean.size


def main():
    manifest = {}
    for code, slug in SLUG.items():
        d = OUT / slug
        d.mkdir(parents=True, exist_ok=True)
        rows = []
        for i, (kind, src) in enumerate(sources(code), 1):
            assert kind in KINDS, kind
            name = f"{i:02d}-{kind}"
            with Image.open(src) as im:
                w, h = save(im, d / f"{name}.jpg", 1200, 80)
                tw, th = save(im, d / f"{name}-t.jpg", 240, 72)
            rows.append({"kind": kind, "src": f"/assets/packs/gallery/{slug}/{name}.jpg",
                         "thumb": f"/assets/packs/gallery/{slug}/{name}-t.jpg", "w": w, "h": h, "tw": tw, "th": th})
        manifest[code] = rows
        print(code, len(rows), "photos:", ", ".join(r["kind"] for r in rows))
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print("wrote", MANIFEST.relative_to(ROOT))


if __name__ == "__main__":
    main()
