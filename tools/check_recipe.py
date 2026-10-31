#!/usr/bin/env python3
"""Check one or more tools/recipes/<slug>.json files before they go into the build.

Runs the build's own recipe standard (build_recipes.check_recipe: intro length, step/tip/variation/
FAQ counts, approved card text inside the full recipe), the claim filters (build_recipes.CLAIMS and
build_guides.RISKY) over every string, the card generator's banned words, and the card's fit.
Usage (repo root):  python3 tools/check_recipe.py tools/recipes/*.json
"""
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp  # noqa: E402
import build_recipes as br  # noqa: E402
import build_guides as bg  # noqa: E402

KEYS = ["slug", "post", "name", "gloss", "te", "hi", "te_tr", "hi_tr", "alt", "eyebrow", "title", "desc", "approved",
        "intro", "quick", "te_line", "hi_line", "te_more", "hi_more", "times", "time_note", "yields", "groups", "steps",
        "tips", "variations", "serving", "storage", "faq", "packs", "category", "keywords", "card"]
CARD_PRODUCTS = {"turmeric-powder": "pasupu", "hill-turmeric-powder": "konda", "cane-jaggery": "cheruku",
                 "palm-jaggery": "thati", "sannam-chilli-powder": "sannam", "teja-chilli-powder": "teja",
                 "cashew-kernels": "cashew"}
CARD_BANNED = ["natural", "pure", "100%", "no added", "nothing added", "traditional", "chemical-free",
               "chemical free", "organic", "healthy", "authentic", "premium", "fresh"]


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, (list, tuple)):
        for v in o:
            yield from strings(v)


def check(path):
    p = []
    r = json.loads(Path(path).read_text(encoding="utf-8"))
    p += [f"missing key {k}" for k in KEYS if k not in r]
    if p:
        return p
    if Path(path).stem != r["slug"]:
        p.append("file name must be <slug>.json")
    if not r["post"].startswith("2026-12_recipe-"):
        p.append("post must be 2026-12_recipe-<slug>")
    for s in r["packs"] + r.get("also", []):
        if s not in br.PACK_BY_SLUG:
            p.append(f"unknown pack {s}")
    if r["card"].get("product") != CARD_PRODUCTS.get(r["packs"][0]):
        p.append(f"card.product must be {CARD_PRODUCTS.get(r['packs'][0])!r} (the first pack)")
    if "<em>" not in r["card"].get("en", ""):
        p.append("card.en needs one <em>word</em>")
    a = r["approved"]
    if not 3 <= len(a["ingredients"]) <= 5 or len(a["steps"]) != 4:
        p.append("card: 3-5 ingredient lines and exactly 4 steps")
    if any(len(x) > 110 for x in a["steps"]) or len(a["meta"]) > 90:
        p.append("card text too long (steps <= 110 chars, meta <= 90)")
    if len(r["title"]) > 65 or not r["title"].endswith(" | 1acrefarms"):
        p.append("title: <= 65 chars, ends ' | 1acrefarms'")
    try:
        r2 = json.loads(json.dumps(r))
        missing = br.approved_inside(r2)
        p += [f"approved text not in full recipe: {m}" for m in missing]
        words = len(" ".join(r["intro"]).split())
        if len(r["intro"]) != 2 or not 60 <= words <= 120:
            p.append(f"intro: 2 paragraphs, 60-120 words (has {words})")
        for key, lo, hi in (("steps", 8, 12), ("tips", 3, 5), ("variations", 2, 4), ("faq", 3, 4)):
            if not lo <= len(r[key]) <= hi:
                p.append(f"{key}: {len(r[key])} (want {lo}-{hi})")
        prep, cook, total = r["times"]
        if total < prep + cook:
            p.append("total time < prep + cook")
    except Exception as err:  # noqa: BLE001
        p.append(f"structure error: {err!r}")
    for s in strings({k: v for k, v in r.items() if k not in ("slug", "post", "packs", "also", "card")}):
        for rx in (br.CLAIMS, bg.RISKY):
            hit = rx.search(s)
            if hit:
                p.append(f"claim/risky word {hit.group(0)!r} in: {s[:80]}")
        if br.PHONE.search(s):
            p.append(f"phone number in: {s[:80]}")
        if "<" in s or ">" in s:
            p.append(f"markup in: {s[:80]}")
    card_text = json.dumps([r["card"]["en"], r["eyebrow"], a], ensure_ascii=False).lower()
    p += [f"card banned word {b!r}" for b in CARD_BANNED if b in card_text]
    return p


def main():
    bad = 0
    for path in sys.argv[1:]:
        probs = check(path)
        print(f"{path}: {'OK' if not probs else ''}")
        for x in probs:
            print("   -", x)
        bad += bool(probs)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
