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
# Full pack label block (FSSAI query 4): front studio photo + printed back + side photo, each a display copy linking to
# the full-size file. tools/label.json = {CODE: {front|back|angle: {src, w, h, mid, mw, mh}}}.
LABEL = ROOT / "tools" / "label.json"
SLUG = {"TURM": "turmeric-powder", "KPAS": "hill-turmeric-powder", "SANN": "sannam-chilli-powder",
        "TEJA": "teja-chilli-powder", "CASH": "cashew-kernels", "CBEL": "cane-jaggery", "TBEL": "palm-jaggery"}
# kind = the ui.g_<kind> alt-text label. Order = order on the page (the front pack photo stays first, outside this list).
KINDS = ("back", "closeup", "story", "nutrition", "care", "angle", "shelf", "stocked")


def sources(code):
    """[(kind, source path)] for one pack; a missing optional shop photo is simply left out."""
    # The PRINTED back exactly as on the pouch, customer-care panel included (FSSAI query 4, 26-11-2026: the officer must
    # see the whole label). The Amazon copy one folder up has that panel masked for Amazon's rules; never use it here.
    v3 = DOCS / "amazon" / "v3_veduka_2026-11-13" / "_backs_unredacted" / f"1AF-{code}-0540_BACK.jpg"
    more = DOCS / "images_more_21-11"
    jio = DOCS / "jiomart" / "images"
    if code == "CBEL":
        crops = [("closeup", jio / "1AF-CBEL-0540_7-front-closeup.jpg"), ("story", jio / "1AF-CBEL-0540_11-story-panel.jpg"),
                 ("nutrition", jio / "1AF-CBEL-0540_13-nutrition-table.jpg"), ("care", jio / "1AF-CBEL-0540_12-storage-care.jpg")]
    elif code == "TBEL":
        crops = [("closeup", jio / "1AF-TBEL-0540_6-front-closeup.jpg"), ("story", jio / "1AF-TBEL-0540_7-story-panel.jpg"),
                 ("nutrition", jio / "1AF-TBEL-0540_8-nutrition-table.jpg"), ("care", jio / "1AF-TBEL-0540_9-storage-care.jpg")]
    else:
        # No maker/storage crop here: it was cut from the masked Amazon back. The full printed back above shows that panel.
        crops = [(k, more / f"1AF-{code}-0540_{n}.jpg") for k, n in
                 (("closeup", "11-front-closeup"), ("story", "12-story"), ("nutrition", "13-nutrition"))]
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
    manifest, labels = {}, {}
    for old in OUT.glob("*/*.jpg"):  # a dropped photo must not linger on the site
        old.unlink()
    for code, slug in SLUG.items():
        d = OUT / slug
        d.mkdir(parents=True, exist_ok=True)
        rows = []
        label = {}
        # studio MAIN photo of the pouch front (white background, Veduka 13-11); cane jaggery from the sharper 4000 px file
        front = (DOCS.resolve().parent.parent / "print" / "photos-veduka" / "2026-11-11" / "CBEL_MAIN_DSC09384_v17B_4000px.jpg"
                 if code == "CBEL" else DOCS / "amazon" / "v3_veduka_2026-11-13" / f"1AF-{code}-0540_MAIN.jpg")
        with Image.open(front) as im:
            fw, fh = save(im, d / "00-front.jpg", 1600, 85)
            mw, mh = save(im, d / "00-front-m.jpg", 900, 82)
        label["front"] = {"src": f"/assets/packs/gallery/{slug}/00-front.jpg", "w": fw, "h": fh,
                          "mid": f"/assets/packs/gallery/{slug}/00-front-m.jpg", "mw": mw, "mh": mh}
        for kind, src in sources(code):
            assert kind in KINDS, kind
            name = f"{KINDS.index(kind) + 1:02d}-{kind}"  # fixed number per kind: file names never shift when one is dropped
            with Image.open(src) as im:
                # the back at its native size (about 1600 px) and higher quality, so every printed line stays readable
                w, h = save(im, d / f"{name}.jpg", *((max(im.size), 88) if kind == "back" else (1200, 80)))
                if kind in ("back", "angle"):  # display copy for the Full pack label block
                    mw, mh = save(im, d / f"{name}-m.jpg", 900, 82)
                    label[kind] = {"src": f"/assets/packs/gallery/{slug}/{name}.jpg", "w": w, "h": h,
                                   "mid": f"/assets/packs/gallery/{slug}/{name}-m.jpg", "mw": mw, "mh": mh}
                tw, th = save(im, d / f"{name}-t.jpg", 240, 72)
            rows.append({"kind": kind, "src": f"/assets/packs/gallery/{slug}/{name}.jpg",
                         "thumb": f"/assets/packs/gallery/{slug}/{name}-t.jpg", "w": w, "h": h, "tw": tw, "th": th})
        manifest[code] = rows
        labels[code] = label
        print(code, len(rows), "photos:", ", ".join(r["kind"] for r in rows))
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    LABEL.write_text(json.dumps(labels, indent=1) + "\n", encoding="utf-8")
    print("wrote", MANIFEST.relative_to(ROOT), "and", LABEL.relative_to(ROOT))


if __name__ == "__main__":
    main()
