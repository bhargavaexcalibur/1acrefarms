#!/usr/bin/env python3
"""1:1, 4:3 and 16:9 versions of the recipe cards for Google recipe results (07-11-2026).
Same generator pieces (lockup, titles, footer, recipe body) and the same approved spec text as the 4:5 cards;
only the arrangement changes: titles column + recipe body side by side on wide canvases.
Usage: python3 tools/make_recipe_wide_cards.py OUT_DIR '{"<post id>": "<slug>", ...}' [slug ...]
then save OUT_DIR/<slug>-<16x9|4x3|1x1>.png as assets/recipes/<slug>-<tag>.jpg under 300 KB (build_recipes lists them)."""
import html, json, subprocess, sys
from pathlib import Path

SOC = Path("/Users/bhargava/1acrefarms/docs/marketing/social")
sys.path.insert(0, str(SOC / "month_2026-11"))
sys.dont_write_bytecode = True
import make_post_v2_month as mp  # noqa: E402

OUT = Path(sys.argv[1])
SIZES = {"16x9": (1600, 900), "4x3": (1200, 900), "1x1": (1200, 1200)}


def body(spec, s, iw_base, pack_below=False):
    hide = mp.opts(spec)[1]
    k = spec["product"]
    img, en, te, hi, mrp, offer, origin = mp.P[k]
    ing = "".join(f'<li style="margin-top:{int(8*s)}px">{html.escape(t)}</li>' for t in spec["ingredients"])
    steps = "".join(f'<li style="margin-top:{int(10*s)}px;padding-left:{int(6*s)}px">{html.escape(t)}</li>' for t in spec["steps"])
    iw = int(iw_base * s)
    ih = int(iw * 1122 / 800)
    meta = html.escape(spec.get("meta", ""))
    box = (f'<div style="flex:1;background:var(--surface);border:1px solid var(--line);border-radius:{int(22*s)}px;'
           f'box-shadow:0 14px 40px rgba(40,50,30,.08);padding:{int(28*s)}px {int(32*s)}px;color:var(--ink);text-align:left">'
           f'<div class="eyebrow" style="color:var(--gold);font-size:{int(20*s)}px">You need</div>'
           f'<ul style="list-style:none;font-size:{int(27*s)}px;line-height:1.3;margin-top:{int(4*s)}px">{ing}</ul>'
           f'<div class="eyebrow" style="color:var(--gold);font-size:{int(20*s)}px;margin-top:{int(20*s)}px">Method</div>'
           f'<ol style="font-size:{int(26*s)}px;line-height:1.32;padding-left:{int(30*s)}px;margin-top:{int(2*s)}px">{steps}</ol>'
           + (f'<div style="font-size:{int(21*s)}px;color:var(--ink-soft);margin-top:{int(14*s)}px">{meta}</div>' if meta else "")
           + '</div>')
    pack = (f'<div style="flex:none;display:flex;flex-direction:column;align-items:center;text-align:center">'
            f'<img src="{mp.pack_img(k)}" style="width:{iw}px;height:{ih}px;object-fit:cover;border-radius:{int(12*s)}px;'
            f'border:2px solid rgba(223,174,85,.6);box-shadow:0 24px 50px rgba(40,50,30,.25)">'
            f'<div class="eyebrow" style="color:var(--gold);font-size:{int(18*s)}px;margin-top:{int(16*s)}px">Made with</div>'
            f'<div class="te" style="font-size:{int(28*s)}px;font-weight:600;color:var(--green);margin-top:{int(4*s)}px">{te}</div>'
            f'<div class="hi" style="font-size:{int(21*s)}px;font-weight:500;color:var(--green)">{mp.SA[k]}</div>'
            f'<div style="font-size:{int(24*s)}px;font-weight:600;color:var(--ink)">{en}</div>'
            f'<div style="font-size:{int(21*s)}px;color:var(--ink-soft);margin-top:{int(4*s)}px">540 g{"" if hide else f" · MRP ₹{mrp}"}</div></div>')
    return box, pack


def wide(spec, w, h):
    """Titles column (lockup, names, button) | recipe box | pack."""
    s = 0.92 if w >= 1600 else 0.8
    box, pack = body(spec, s, 250 if w >= 1600 else 190)
    left_w = int(w * (0.33 if w >= 1600 else 0.36))
    left = (f'<div style="flex:none;width:{left_w}px;height:100%;display:flex;flex-direction:column;align-items:center;'
            f'justify-content:space-between;padding:{int(10*s)}px 0">'
            f'<div style="width:100%;display:flex;flex-direction:column;align-items:center">{mp.lockup(s, False)}'
            f'{mp.titles(spec, s, False)}</div>{mp.footer(s, False, mp.opts(spec)[0])}</div>')
    right = (f'<div style="flex:1;display:flex;gap:{int(26*s)}px;align-items:center;min-width:0">{box}{pack}</div>')
    return (f'<div class="canvas" style="background:var(--bg);flex-direction:row;gap:{int(44*s)}px;align-items:stretch;'
            f'padding:{int(56*s)}px {int(56*s)}px">{left}{right}</div>')


def square(spec, w, h):
    """The 4:5 layout, a little smaller, on a 1200 x 1200 canvas."""
    s = 0.86
    box, pack = body(spec, s, 220)
    inner = (f'<div style="margin:auto 0;width:100%;display:flex;gap:{int(30*s)}px;align-items:center;text-align:left">{box}{pack}</div>')
    return (f'<div class="canvas" style="background:var(--bg);padding:{int(54*s)}px {int(64*s)}px {int(50*s)}px">'
            f'{mp.lockup(s, False)}{mp.titles(spec, s, False).replace("margin-top:"+str(int(64*s))+"px", "margin-top:"+str(int(34*s))+"px")}'
            f'{inner}{mp.footer(s, False, mp.opts(spec)[0])}</div>')


def page(spec, w, h, fn):
    css = mp.BASE_CSS.replace("WIDTH", str(w)).replace("HEIGHT", str(h))
    # overflow probe: mark the page if anything spills past the canvas
    probe = ("<script>document.fonts.ready.then(()=>setTimeout(()=>{const c=document.querySelector('.canvas');"
             "let bad=c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1;"
             "document.querySelectorAll('.canvas *').forEach(e=>{const r=e.getBoundingClientRect();"
             "if(r.width&&(r.bottom>" + str(h) + "+1||r.right>" + str(w) + "+1))bad=true;});"
             "document.title=bad?'OVERFLOW':'OK';},300));</script>")
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>-</title>{mp.FONTS}<style>{css}</style></head>'
            f'<body>{fn(spec, w, h)}{mp.FIT_JS}{probe}</body></html>')


def main():
    specs = json.loads((SOC / "recipes" / "specs.json").read_text(encoding="utf-8"))
    specs += [x for x in json.loads((SOC / "month_2026-11" / "month_specs.json").read_text(encoding="utf-8"))
              if x.get("template") == "recipe"]
    slug_of = json.loads(sys.argv[2])  # {post id: slug}
    only = set(sys.argv[3:])
    OUT.mkdir(parents=True, exist_ok=True)
    for sp in specs:
        slug = slug_of.get(sp["id"])
        if not slug or (only and slug not in only):
            continue
        mp.check(sp)
        for tag, (w, h) in SIZES.items():
            src = OUT / f"{slug}-{tag}.html"
            src.write_text(page(sp, w, h, square if tag == "1x1" else wide), encoding="utf-8")
            png = OUT / f"{slug}-{tag}.png"
            subprocess.run([mp.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}",
                            "--force-device-scale-factor=1", "--user-data-dir=/tmp/1af-wide",
                            "--allow-file-access-from-files", "--virtual-time-budget=8000",
                            f"--screenshot={png}", src.as_uri()], check=True, capture_output=True, timeout=120)
            dom = subprocess.run([mp.CHROME, "--headless=new", "--disable-gpu", f"--window-size={w},{h}",
                                  "--user-data-dir=/tmp/1af-wide", "--allow-file-access-from-files",
                                  "--virtual-time-budget=8000", "--dump-dom", src.as_uri()],
                                 capture_output=True, text=True, timeout=120).stdout
            print(slug, tag, "OVERFLOW" if "<title>OVERFLOW" in dom else "ok")


if __name__ == "__main__":
    main()
