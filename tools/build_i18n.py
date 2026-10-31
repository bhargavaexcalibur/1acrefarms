#!/usr/bin/env python3
"""Pages in the 22 languages of the Eighth Schedule: /<code>/ (a home per language) and
/<code>/<pack-slug>/ for every live pack, plus the language menu and hreflang links on every page.

Why: Google reads the site from outside India, so text that changes with the visitor's location is
invisible to search. One URL per language is what ranks ("ହଳଦୀ" finds /or/turmeric-powder/). The
menu lets anyone pick a language, and a small banner suggests one when the phone is set to it.
Nothing ever switches language by itself.

Source of truth: tools/i18n/source_en.json (written by `export`) holds every English string to
translate. tools/i18n/<code>.json holds, per key: src (the English it was translated from), t (the
translation) and back (a BLIND back-translation into English, made without seeing the source).
A key is used only when it passes every check:
  - src still equals today's English (otherwise it is stale and waits for re-translation);
  - every number in the English (prices, grams, days) appears unchanged in t;
  - "1acrefarms" is kept as written;
  - the back-translation passes the claim filter (build_recipes.CLAIMS + build_guides.RISKY), so
    no "natural", "pure", "fresh", health talk etc. sneaks in through a translation.
A page is built only when all its keys pass. A new product, or a changed English line, therefore
never breaks the build: it shows up under "PENDING" in the output until it is translated.

Labels stay in English on purpose: ingredients, net quantity, FSSAI number, maker address and the
nutrition table are printed on the pack in English, and the site must match the pack.

Run from the repo root:
  python3 tools/build_pages.py            # whole site, these pages included
  python3 tools/build_i18n.py export      # refresh tools/i18n/source_en.json for translators
  python3 tools/build_i18n.py status      # what is translated, stale or pending, per language
  python3 tools/build_i18n.py todo <code> <out.json>     # what a language still needs, for a translator
  python3 tools/build_i18n.py merge <code> <in.json>     # {key: translation} into tools/i18n/<code>.json
  python3 tools/build_i18n.py blind <code> <out.json> [--new]   # translations without English, for the back-check
  python3 tools/build_i18n.py merge-back <code> <in.json>

Recipes and guides (and their hubs) are translated whole, piece by piece: see tools/i18n_pages.py.
"""
import html
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no tools/__pycache__ left in the repo
import build_pages as bp  # noqa: E402
import build_recipes as br  # noqa: E402
import build_guides as bg  # noqa: E402
import i18n_pages as ip  # noqa: E402

ROOT = bp.ROOT
SITE = bp.SITE
I18N = ROOT / "tools" / "i18n"
e = br.e

DEVA = ("Noto Sans Devanagari", "Noto+Sans+Devanagari:wght@400;500;600")
# code (URL + lang attribute), hreflang (ISO 639-1 only; Google ignores other codes), native name,
# English name, (font family, Google Fonts spec), text direction
LANGS = [
    ("as", "as", "অসমীয়া", "Assamese", ("Noto Sans Bengali", "Noto+Sans+Bengali:wght@400;500;600"), "ltr"),
    ("bn", "bn", "বাংলা", "Bengali", ("Noto Sans Bengali", "Noto+Sans+Bengali:wght@400;500;600"), "ltr"),
    ("brx", None, "बर'", "Bodo", DEVA, "ltr"),
    ("doi", None, "डोगरी", "Dogri", DEVA, "ltr"),
    ("gu", "gu", "ગુજરાતી", "Gujarati", ("Noto Sans Gujarati", "Noto+Sans+Gujarati:wght@400;500;600"), "ltr"),
    ("hi", "hi", "हिन्दी", "Hindi", DEVA, "ltr"),
    ("kn", "kn", "ಕನ್ನಡ", "Kannada", ("Noto Sans Kannada", "Noto+Sans+Kannada:wght@400;500;600"), "ltr"),
    ("ks", "ks", "کٲشُر", "Kashmiri", ("Noto Nastaliq Urdu", "Noto+Nastaliq+Urdu:wght@400;600"), "rtl"),
    ("kok", None, "कोंकणी", "Konkani", DEVA, "ltr"),
    ("mai", None, "मैथिली", "Maithili", DEVA, "ltr"),
    ("ml", "ml", "മലയാളം", "Malayalam", ("Noto Sans Malayalam", "Noto+Sans+Malayalam:wght@400;500;600"), "ltr"),
    ("mni", None, "ꯃꯤꯇꯩꯂꯣꯟ", "Manipuri", ("Noto Sans Meetei Mayek", "Noto+Sans+Meetei+Mayek:wght@400;600"), "ltr"),
    ("mr", "mr", "मराठी", "Marathi", DEVA, "ltr"),
    ("ne", "ne", "नेपाली", "Nepali", DEVA, "ltr"),
    ("or", "or", "ଓଡ଼ିଆ", "Odia", ("Noto Sans Oriya", "Noto+Sans+Oriya:wght@400;500;600"), "ltr"),
    ("pa", "pa", "ਪੰਜਾਬੀ", "Punjabi", ("Noto Sans Gurmukhi", "Noto+Sans+Gurmukhi:wght@400;500;600"), "ltr"),
    ("sa", "sa", "संस्कृतम्", "Sanskrit", DEVA, "ltr"),
    ("sat", None, "ᱥᱟᱱᱛᱟᱲᱤ", "Santali", ("Noto Sans Ol Chiki", "Noto+Sans+Ol+Chiki:wght@400;600"), "ltr"),
    ("sd", "sd", "سنڌي", "Sindhi", ("Noto Naskh Arabic", "Noto+Naskh+Arabic:wght@400;600"), "rtl"),
    ("ta", "ta", "தமிழ்", "Tamil", ("Noto Sans Tamil", "Noto+Sans+Tamil:wght@400;500;600"), "ltr"),
    ("te", "te", "తెలుగు", "Telugu", ("Noto Sans Telugu", "Noto+Sans+Telugu:wght@400;500;600"), "ltr"),
    ("ur", "ur", "اردو", "Urdu", ("Noto Nastaliq Urdu", "Noto+Nastaliq+Urdu:wght@400;600"), "rtl"),
]
LANG = {c: dict(code=c, hreflang=h, native=n, english=en, font=f, dir=d) for c, h, n, en, f, d in LANGS}
# The rare scripts in the menu itself, so their names render on phones without those fonts.
MENU_FONTS = ("https://fonts.googleapis.com/css2?family=Noto+Sans+Ol+Chiki&family=Noto+Sans+Meetei+Mayek"
              "&text=" + "".join(sorted(set("ᱥᱟᱱᱛᱟᱲᱤꯃꯤꯇꯩꯂꯣꯟ"))) + "&display=swap")

UI = {
    "ui.nav_packs": ("Our Packs", "header menu link"),
    "ui.shop_all": ("Shop all packs", "header button"),
    "ui.home": ("Home", "breadcrumb"),
    "ui.lang": ("Language", "label of the language menu"),
    "ui.read_in": ("Read this page in <this language>", "banner offering this language; write the language's own name"),
    "ui.not_now": ("Not now", "closes that banner"),
    "ui.per_g": ("per g", "after a price, e.g. '₹0.73 per g'"),
    "ui.tax": ("Incl. of all taxes · In stock · Dispatched within 2 working days", "under the MRP"),
    "ui.add": ("Add to order", "button"),
    "ui.wa": ("Order on WhatsApp", "button"),
    "ui.amazon": ("Buy on Amazon", "button to our Amazon.in listing; write 'Amazon' in Latin letters exactly"),
    "ui.f_from": ("From", "label: where the product comes from"),
    "ui.f_pack": ("Pack", "label"),
    "ui.f_delivery": ("Delivery", "label"),
    "ui.f_delivery_v": ("Free on 2 or more packs · ₹81 for one pack", "delivery charges"),
    "ui.f_pay": ("Pay", "label"),
    "ui.f_pay_v": ("UPI, or pay on delivery where available", "payment options"),
    "ui.how_to_use": ("How to use", "heading"),
    "ui.pack_details": ("Pack details", "heading"),
    "ui.as_printed": ("As printed on the pack, in English.", "note above the legal pack details, which stay in English"),
    "ui.ship_h": ("Delivery, payment and returns", "heading"),
    "ui.ship_p": ("Orders are packed and dispatched within 2 working days of confirmation, and usually arrive 2 "
                  "to 7 days after dispatch. Delivery is free on 2 or more packs and ₹81 for a single pack, "
                  "anywhere we deliver in India. Pay by UPI, or pay on delivery for orders up to ₹999 in South "
                  "India and ₹599 elsewhere. If a pack arrives damaged or has a quality problem, we replace it "
                  "or refund you in full.", "policy summary; keep every number exactly"),
    "ui.read_policies": ("Read our policies (in English)", "link to the policies page"),
    "ui.other_packs": ("Our other packs", "heading"),
    "ui.translated": ("Translated from English. Spotted a mistake?", "small note at the end of the page"),
    "ui.wa_us": ("WhatsApp us", "link after that note"),
    "ui.order_note": ("Orders are placed in our shop, which is in English.", "note next to the order buttons"),
    "ui.l_title": ("Turmeric, chilli powder, jaggery and cashew from Bharat", "browser tab title of the language home page; '| 1acrefarms' is added"),
    "ui.l_desc": ("Village desi turmeric, chilli powder, jaggery and cashew in 540 g packs, packed in "
                  "Narasaraopet, Andhra Pradesh. Order online or on WhatsApp. Free delivery on 2 or more packs.",
                  "search result description of the language home page"),
    "ui.l_eyebrow": ("Village desi foods from Bharat", "small line above the main heading"),
    "ui.l_lede": ("Turmeric, chilli powder, jaggery and cashew in 540 g packs, packed in Narasaraopet, Andhra "
                  "Pradesh. Order online or on WhatsApp. Delivery is free on 2 or more packs.", "intro paragraph"),
    "ui.l_packs": ("Our packs", "heading above the packs"),
    "ui.see_pack": ("See the pack", "link on each pack card"),
}
PACK_FIELDS = {
    "name": "the product name in this language (the H1 and in lists); keep it short",
    "title": "browser tab / Google title; keep '540 g' and end with ' | 1acrefarms'; at most ~60 characters",
    "desc": "Google description; keep the MRP and every number",
    "lede": "intro sentence under the heading",
    "origin": "where it comes from (place names stay as names)",
    "note": "short facts line about the pack",
}


def plain(s):
    return re.sub(r"\s+", " ", bp.text_of(s)).strip()


def source():
    """Every English string to translate: {key: (text, note)}."""
    out = dict(UI)
    for p in bp.PACKS:
        k = f"pack.{p['code']}"
        out[f"{k}.name"] = (f"{p['name']} ({p['local']})", PACK_FIELDS["name"] + "; the bracket is the Telugu name, keep or adapt")
        for f in ("title", "desc", "lede", "origin", "note"):
            out[f"{k}.{f}"] = (plain(p[f]), PACK_FIELDS[f])
        for i, u in enumerate(p["uses"]):
            out[f"{k}.use{i}"] = (plain(u), "one 'how to use' line")
    for base, f in content_files():
        for key, row in ip.sources(f.read_text(encoding="utf-8"), base).items():
            out.setdefault(key, row)
    return out


def content_files():
    """[(English path, file)] of the recipe and guide pages, hubs first."""
    out = []
    for d in ("recipes", "learn"):
        for f in sorted((ROOT / d).rglob("index.html")):
            out.append((url_of(f), f))
    return out


def content_keys(f):
    return list(ip.sources(f.read_text(encoding="utf-8"), "").keys())


def export():
    I18N.mkdir(exist_ok=True)
    data = {k: {"en": t, "note": n} for k, (t, n) in source().items()}
    (I18N / "source_en.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote tools/i18n/source_en.json with", len(data), "strings")


NUM = re.compile(r"\d+(?:[.,]\d+)?")


def problem(key, src, row):
    """Why a translated key cannot be used, or None."""
    if not isinstance(row, dict) or not row.get("t"):
        return "missing"
    if row.get("src") != src:
        return "stale"
    t, back = row["t"], row.get("back") or ""
    missing = [n for n in NUM.findall(src) if n not in NUM.findall(t)]
    if missing:
        return f"numbers changed {missing}"
    if "1acrefarms" in src and "1acrefarms" not in t:
        return "brand name changed"
    if "<" in t or ">" in t:
        return "markup in translation"
    if sorted(ip.MARK.findall(src)) != sorted(ip.MARK.findall(t)) or t.count("⟦") != len(ip.MARK.findall(t)):
        return "markers changed"
    for rx in (br.CLAIMS, bg.RISKY):
        hit = rx.search(t)
        if hit:
            return f"claim word {hit.group(0)!r}"
    if not back.strip():
        return "no back-translation"
    for rx in (br.CLAIMS, bg.RISKY):
        for hit in rx.finditer(back):
            if hit.group(0).lower() == "cold" and re.search(r"\b(cool|chill|cold|temperature)", src, re.I):
                continue  # "cool evening", "chilled": temperature, not the illness
            return f"claim word in back-translation {hit.group(0)!r}"
    return None


def load(code):
    f = I18N / f"{code}.json"
    if not f.exists():
        return {}
    return json.loads(f.read_text(encoding="utf-8")).get("strings", {})


def usable(code, src):
    rows = load(code)
    ok, bad = {}, {}
    for k, (text, _) in src.items():
        why = problem(k, text, rows.get(k))
        if why:
            bad[k] = why
        else:
            ok[k] = rows[k]["t"]
    return ok, bad


def pack_keys(p):
    k = f"pack.{p['code']}"
    return [f"{k}.{f}" for f in ("name", "title", "desc", "lede", "origin", "note")] + \
           [f"{k}.use{i}" for i in range(len(p["uses"]))]


OPTIONAL = {"ui.amazon"}  # newer strings: English is shown until translated
PAGE_UI = [k for k in UI if not k.startswith("ui.l_") and k not in OPTIONAL] + ["ui.see_pack"]
HOME_UI = [k for k in UI if k not in OPTIONAL]


def plan(live):
    """{code: {"ui": {...}, "packs": [p, ...]}} for every language with a usable home page."""
    src = source()
    content = [(base, content_keys(f)) for base, f in content_files()]
    out, pending = {}, {}
    for code in LANG:
        ok, bad = usable(code, src)
        if any(k in bad for k in HOME_UI):
            pending[code] = sorted({bad[k] for k in HOME_UI if k in bad})
            continue
        packs = [p for p in live if all(k in ok for k in pack_keys(p))]
        miss = [p["code"] for p in live if p not in packs]
        pages = [base for base, keys in content if all(k in ok for k in keys)]
        miss_pages = [base for base, _ in content if base not in pages]
        why = []
        if miss:
            why.append(f"packs not translated: {', '.join(miss)}")
        if miss_pages:
            why.append(f"{len(miss_pages)} recipe/guide pages not translated")
        if why:
            pending[code] = why
        out[code] = {"t": ok, "packs": packs, "pages": pages}
    return out, pending


# ---------- shared bits for every page ----------

def page_path(url):
    """'/hi/turmeric-powder/' -> ('hi', '/turmeric-powder/'); English paths -> ('en', path)."""
    m = re.match(r"^/([a-z]{2,3})(/.*)$", url)
    if m and m.group(1) in LANG:
        return m.group(1), m.group(2)
    return "en", url


def alternates(base, langs_for):
    """[(code, url)] for the English base path, in menu order: English first."""
    out = [("en", base)]
    for code in LANG:
        if code in langs_for:
            out.append((code, langs_for[code]))
    return out


def lang_menu(current, alts, cta):
    """The header language menu; cta = {code: 'Read this page in ...'} for the suggestion banner."""
    items = []
    for code, url in alts:
        name = "English" if code == "en" else LANG[code]["native"]
        sub = "" if code == "en" else f' <span class="lm-en">{LANG[code]["english"]}</span>'
        cur = ' aria-current="true"' if code == current else ""
        data = f' data-cta="{e(cta[code])}"' if code in cta else ""
        lang = "en" if code == "en" else code
        items.append(f'<li><a href="{url}" lang="{lang}" hreflang="{lang}"{data}{cur}>{e(name)}{sub}</a></li>')
    label = "English" if current == "en" else LANG[current]["native"]
    return (f'<details class="lang-menu"><summary aria-label="Language"><svg viewBox="0 0 24 24" aria-hidden="true">'
            f'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 '
            f'8.6 8.2 12s1.3 6.4 3.8 9"/></svg><span>{e(label)}</span></summary>'
            f'<ul>{"".join(items)}</ul></details>')


def hreflang_links(alts):
    """Only for pages that really exist in other languages; never point at a fallback page."""
    if len(alts) < 2:
        return ""
    rows = [f'<link rel="alternate" hreflang="en-IN" href="{SITE}{alts[0][1]}" />',
            f'<link rel="alternate" hreflang="x-default" href="{SITE}{alts[0][1]}" />']
    for code, url in alts[1:]:
        if LANG[code]["hreflang"]:
            rows.append(f'<link rel="alternate" hreflang="{LANG[code]["hreflang"]}-IN" href="{SITE}{url}" />')
    return "\n  ".join(rows)


BANNER_JS = """<script>
(function () {
  var lang = document.documentElement.lang.split("-")[0], key = "lang-banner-off";
  try { if (localStorage.getItem(key)) return; } catch (e) {}
  var prefs = (navigator.languages || [navigator.language || ""]).map(function (l) { return l.toLowerCase().split("-")[0]; });
  if (prefs[0] === lang) return;
  var links = document.querySelectorAll(".lang-menu a[data-cta]"), pick = null;
  for (var i = 0; i < prefs.length && !pick; i++) {
    if (prefs[i] === "en") break;
    for (var j = 0; j < links.length; j++) if (links[j].lang === prefs[i] && prefs[i] !== lang) { pick = links[j]; break; }
  }
  if (!pick) return;
  var bar = document.createElement("div");
  bar.className = "lang-banner"; bar.lang = pick.lang;
  if (pick.lang === "ur" || pick.lang === "ks" || pick.lang === "sd") bar.dir = "rtl";
  var a = document.createElement("a"); a.href = pick.href; a.textContent = pick.getAttribute("data-cta");
  var x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Close");
  x.onclick = function () { bar.remove(); try { localStorage.setItem(key, "1"); } catch (e) {} };
  bar.appendChild(a); bar.appendChild(x); document.body.appendChild(bar);
})();
</script>"""


def inject(page, current, alts, cta, same=None):
    """Add the menu, hreflang links and banner script to a built page (idempotent).
    alts: where the menu goes per language; same: the true translations of this page (hreflang)."""
    page = re.sub(r"\n  <!-- I18N:HEAD -->.*?<!-- /I18N:HEAD -->", "", page, flags=re.S)
    page = re.sub(r"<!-- I18N:BANNER -->.*?<!-- /I18N:BANNER -->\n", "", page, flags=re.S)
    links = hreflang_links(alts if same is None else same)
    links = f"\n  {links}" if links else ""
    head = f'\n  <!-- I18N:HEAD -->{links}\n  <link href="{html.escape(MENU_FONTS)}" rel="stylesheet" />\n  <!-- /I18N:HEAD -->'
    page = page.replace("</head>", head + "\n</head>", 1)
    menu = lang_menu(current, alts, cta)
    page, n = re.subn(r"<!--LANG-->.*?<!--/LANG-->|<!--LANG-->", f"<!--LANG-->{menu}<!--/LANG-->", page, count=1, flags=re.S)
    if n != 1:
        sys.exit("language menu marker <!--LANG--> missing")
    return page.replace("</body>", f"<!-- I18N:BANNER -->\n{BANNER_JS}\n<!-- /I18N:BANNER -->\n</body>", 1)


# ---------- language pages ----------

def head(code, title, desc, url, og_type, og_image, ld):
    L = LANG[code]
    json.loads(ld)
    return f"""<!DOCTYPE html>
<html lang="{code}" dir="{L['dir']}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}" />
  <link rel="canonical" href="{SITE}{url}" />
  <meta property="og:type" content="{og_type}" />
  <meta property="og:site_name" content="1acrefarms" />
  <meta property="og:url" content="{SITE}{url}" />
  <meta property="og:title" content="{e(title)}" />
  <meta property="og:description" content="{e(desc)}" />
  <meta property="og:image" content="{og_image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
{ld}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family={L['font'][1]}&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
  <style>html[lang="{code}"] body {{ font-family: "Inter", "{L['font'][0]}", system-ui, sans-serif; }}</style>
</head>"""


LTR_BITS = re.compile(r"₹\s?\d[\d,.]*|\d[\d,.]*\s?g\b|\d[\d,.]*\+?")


def x(code, s):
    """Escaped body text; on right-to-left pages prices, weights and counts stay left-to-right."""
    out = e(s)
    if LANG[code]["dir"] == "rtl":
        out = LTR_BITS.sub(lambda m: f'<bdi dir="ltr">{m.group(0)}</bdi>', out)
    return out


def header(t, code):
    return bp.HEADER.replace('href="/#spices">Our Packs</a>', f'href="/{code}/#packs">{x(code, t["ui.nav_packs"])}</a>') \
        .replace('<li><a href="/#story">Our Story</a></li>\n', "") \
        .replace('href="/#spices">Shop all packs</a>', f'href="/{code}/#packs">{x(code, t["ui.shop_all"])}</a>')


def translated_note(t, code):
    return (f'<p class="i18n-note">{x(code, t["ui.translated"])} <a href="https://wa.me/{bp.WA}" target="_blank" '
            f'rel="noopener">{x(code, t["ui.wa_us"])}</a></p>')


def pack_card(code, t, p):
    k = f"pack.{p['code']}"
    return f"""        <a class="pdp-other" href="/{code}/{p['slug']}/">
          <img src="/assets/packs/{p['pack']}" alt="{e(t[k + '.name'])}, {p['g']} g" width="800" height="1122" loading="lazy" />
          <span class="po-name">{x(code, t[k + '.name'])}</span>
          <span class="po-te" lang="en">{p['name']}</span>
          <span class="po-price">MRP ₹{p['mrp']} · {p['g']} g</span>
        </a>"""


def amazon_btn(code, t, p):
    # A newer string than the rest: until it is translated, the button stays in English.
    if "ui.amazon" in t:
        return bp.amazon_btn(p, x(code, t["ui.amazon"]))
    return bp.amazon_btn(p, "Buy on Amazon", ' lang="en" dir="ltr"')


def pack_page(code, t, p, packs, facts):
    k = f"pack.{p['code']}"
    url = f"/{code}/{p['slug']}/"
    ld = json.loads(bp.product_ld(p, facts))
    prod, crumbs = ld["@graph"]
    prod.update({"@id": SITE + url + "#product", "name": f"{t[k + '.name']} {p['g']} g", "description": t[k + ".lede"],
                 "inLanguage": code})
    prod["offers"]["url"] = SITE + url
    crumbs["itemListElement"] = [
        {"@type": "ListItem", "position": 1, "name": t["ui.home"], "item": f"{SITE}/{code}/"},
        {"@type": "ListItem", "position": 2, "name": t[k + ".name"], "item": SITE + url}]
    uses = "\n".join(f"          <li>{x(code, t[f'{k}.use{i}'])}</li>" for i in range(len(p["uses"])))
    allergen = f"<dt>Allergen</dt><dd>{p['allergen']}</dd>" if p.get("allergen") else ""
    row = facts.get(p["code"], {})
    storage = f"<dt>Storage</dt><dd>{row['storage']}</dd>" if row.get("storage") else ""
    others = "\n".join(pack_card(code, t, q) for q in packs if q is not p)
    return head(code, t[k + ".title"], t[k + ".desc"], url, "product", f"{SITE}/assets/packs/{p['pack']}",
                json.dumps(ld, ensure_ascii=False, indent=2)) + f"""
<body class="pdp-page i18n-page">
{header(t, code)}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/{code}/">{x(code, t['ui.home'])}</a> <span aria-hidden="true">›</span> <span aria-current="page">{x(code, t[k + '.name'])}</span></nav>

    <section class="pdp">
      <div class="pdp-media">
        <div class="pack-media"><img src="/assets/packs/{p['pack']}" alt="{e(t[k + '.name'])}, {p['g']} g" width="800" height="1122" /></div>
      </div>
      <div class="pdp-info">
        <p class="eyebrow">{x(code, t[k + '.origin'])}</p>
        <h1>{x(code, t[k + '.name'])}</h1>
        <p class="pdp-names" lang="en">{p['name']} ({p['local']}) · <span lang="te">{p['te']}</span> · <span lang="hi">{p['hi']}</span></p>
        <p class="pdp-lede">{x(code, t[k + '.lede'])}</p>
        <div class="price-row">
          <span class="mrp"><small>MRP</small> ₹{p['mrp']}</span>
          <span class="upp">{x(code, f"{p['g']} g")} · {x(code, f"₹{p['mrp'] / p['g']:.2f}")} {x(code, t['ui.per_g'])}</span>
        </div>
        <p class="tax">{x(code, t['ui.tax'])}</p>
        <div class="pdp-actions">{amazon_btn(code, t, p)}
          <a class="btn {'btn-wa' if bp.amazon_link(p) else 'btn-primary'}" href="/?add=pk-{p['code'].lower()}@{p['g']}#{p['section']}">{x(code, t['ui.add'])}</a>
          <a class="btn btn-wa" href="{bp.wa_link(p)}" target="_blank" rel="noopener">{x(code, t['ui.wa'])}</a>
        </div>
        <p class="i18n-order-note">{x(code, t['ui.order_note'])}</p>
        <ul class="pdp-facts">
          <li><span>{x(code, t['ui.f_from'])}</span>{x(code, t[k + '.origin'])}</li>
          <li><span>{x(code, t['ui.f_pack'])}</span>{x(code, t[k + '.note'])}</li>
          <li><span>{x(code, t['ui.f_delivery'])}</span>{x(code, t['ui.f_delivery_v'])}</li>
          <li><span>{x(code, t['ui.f_pay'])}</span>{x(code, t['ui.f_pay_v'])}</li>
        </ul>
      </div>
    </section>

    <section class="pdp-more">
      <div>
        <h2>{x(code, t['ui.how_to_use'])}</h2>
        <ul>
{uses}
        </ul>
      </div>
      <div lang="en" dir="ltr">
        <h2>{x(code, t['ui.pack_details'])}</h2>
        <p class="i18n-legal-note">{x(code, t['ui.as_printed'])}</p>
        <dl class="pdp-dl">
          <dt>Ingredients</dt><dd>{p['ingredients']}</dd>
          {allergen}
          <dt>Net quantity</dt><dd>{p['g']} g · SKU 1AF-{p['code']}-{p['g']:04d}</dd>
          <dt>Best before</dt><dd>{p['shelf']} months from packing</dd>
          {f"<dt>Use by</dt><dd>{p['use_by']} months from packing</dd>" if p.get('use_by') else ""}
          {storage}
          <dt>{bp.MAKER[p['by']]}</dt><dd>{bp.ADDRESS}</dd>
          <dt>FSSAI</dt><dd>Reg. 20126161000590</dd>
          <dt>Country of origin</dt><dd>India</dd>
          <dt>Customer care</dt><dd>WhatsApp +91 78999 29779 · 1acrefarmsindia@gmail.com</dd>
        </dl>
      </div>
      <div lang="en" dir="ltr">
        <h2>Nutritional information</h2>
        {bp.nutrition(p, facts)}
      </div>
    </section>

    <section class="pdp-ship">
      <h2>{x(code, t['ui.ship_h'])}</h2>
      <p>{x(code, t['ui.ship_p'])} <a href="/policies.html#shipping">{x(code, t['ui.read_policies'])}</a></p>
    </section>

    <section class="pdp-others">
      <h2>{x(code, t['ui.other_packs'])}</h2>
      <div class="pdp-other-grid">
{others}
      </div>
    </section>
    {translated_note(t, code)}
  </main>

{bp.footer(packs)}
</body>
</html>
"""


def home_page(code, t, packs, pages=()):
    url = f"/{code}/"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": SITE + url + "#page", "name": t["ui.l_title"], "url": SITE + url,
         "inLanguage": code, "publisher": {"@id": f"{SITE}/#business"},
         "mainEntity": {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i, "url": f"{SITE}/{code}/{p['slug']}/",
              "name": t[f"pack.{p['code']}.name"]} for i, p in enumerate(packs, 1)]}},
    ]}, ensure_ascii=False, indent=2)
    cards = "\n".join(pack_card(code, t, p) for p in packs)
    return head(code, f"{t['ui.l_title']} | 1acrefarms", t["ui.l_desc"], url, "website",
                f"{SITE}/assets/og-image.jpg", ld) + f"""
<body class="pdp-page i18n-page">
{header(t, code)}

  <main class="container">
    <section class="i18n-home">
      <p class="eyebrow">{x(code, t['ui.l_eyebrow'])}</p>
      <h1><span class="one">1</span>acrefarms<span class="tm">™</span></h1>
      <p class="i18n-motto" lang="en">Let the soil breathe again.</p>
      <p class="pdp-lede">{x(code, t['ui.l_lede'])}</p>
    </section>

    <section class="pdp-others" id="packs">
      <h2>{x(code, t['ui.l_packs'])}</h2>
      <div class="pdp-other-grid">
{cards}
      </div>
    </section>{more_links(code, t, pages)}
    {translated_note(t, code)}
  </main>

{bp.footer(packs)}
</body>
</html>
"""


def clean(page):
    """An English page as its builder wrote it: no language menu, hreflang links or banner."""
    page = re.sub(r"\n  <!-- I18N:HEAD -->.*?<!-- /I18N:HEAD -->", "", page, flags=re.S)
    page = re.sub(r"<!-- I18N:BANNER -->.*?<!-- /I18N:BANNER -->\n", "", page, flags=re.S)
    return re.sub(r"<!--LANG-->.*?<!--/LANG-->", "<!--LANG-->", page, flags=re.S)


SITE_PATH = re.compile(r'(?<=")(%s)?(/(?:[a-z0-9-]+/)*)(?=["#])' % re.escape(SITE))


def localize(page, code, local):
    """Point links at this language's version of a page wherever one exists (local: English paths)."""
    def fix(m):
        site, path = m.group(1) or "", m.group(2)
        if path == "/" and page[m.end():m.end() + 1] == "#":
            return m.group(0)  # /#story etc. are sections of the English home
        return f"{site}/{code}{path}" if path in local else m.group(0)
    return SITE_PATH.sub(fix, page)


def content_page(code, t, base, english):
    """A recipe or guide page (or their hub) in this language, from the English page."""
    L = LANG[code]
    page = ip.translate(clean(english), lambda s: t[ip.key_of(s)], lambda s: x(code, s))
    page = page.replace('<html lang="en-IN">', f'<html lang="{code}" dir="{L["dir"]}">', 1)
    page = page.replace('\n  <meta property="og:locale" content="en_IN" />', "", 1)
    page = page.replace('"inLanguage": "en-IN"', f'"inLanguage": "{code}"')
    page = page.replace('<link rel="stylesheet" href="/styles.css" />',
                        f'<link href="https://fonts.googleapis.com/css2?family={L["font"][1]}&display=swap" rel="stylesheet" />\n'
                        f'  <link rel="stylesheet" href="/styles.css" />\n'
                        f'  <style>html[lang="{code}"] body {{ font-family: "Inter", "{L["font"][0]}", system-ui, sans-serif; }}</style>', 1)
    if page.count(bp.HEADER) != 1:
        sys.exit(f"header not found in {base}")
    page = page.replace(bp.HEADER, header(t, code))
    page = page.replace('<body class="pdp-page rcp-page', '<body class="pdp-page i18n-page rcp-page', 1)
    return page.replace("  </main>", f"    {translated_note(t, code)}\n  </main>", 1)


def more_links(code, t, pages):
    """Recipes and guides links for a language home, labelled with their hub headings."""
    links = []
    for base, en in (("/recipes/", "Recipes with turmeric and jaggery"), ("/learn/", "Guides")):
        if base in pages and ip.key_of(en) in t:
            links.append(f'<a class="btn btn-wa" href="/{code}{base}">{x(code, t[ip.key_of(en)])}</a>')
    return f'\n    <section class="i18n-more">{"".join(links)}</section>' if links else ""


# ---------- build ----------

def english_files(live):
    files = [ROOT / "index.html"]  # policies.html has no header menu
    files += [ROOT / p["slug"] / "index.html" for p in live]
    for d in ("recipes", "learn"):
        files += sorted((ROOT / d).rglob("index.html"))
    return [f for f in files if f.exists()]


def url_of(path):
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def sitemap_rows(live):
    langs, _ = plan(live)
    rows = []
    for code, d in langs.items():
        rows.append((f"{SITE}/{code}/", "weekly", "0.6"))
        rows += [(f"{SITE}/{code}/{p['slug']}/", "weekly", "0.7") for p in d["packs"]]
        rows += [(f"{SITE}/{code}{base}", "monthly", "0.6") for base in d["pages"]]
    return rows


def build(live):
    facts = bp.pack_facts()
    langs, pending = plan(live)
    cta = {code: d["t"]["ui.read_in"] for code, d in langs.items()}
    # language versions of each English path
    versions = {"/": {c: f"/{c}/" for c in langs}}
    for p in live:
        versions[f"/{p['slug']}/"] = {c: f"/{c}/{p['slug']}/" for c, d in langs.items() if p in d["packs"]}
    english = {base: f.read_text(encoding="utf-8") for base, f in content_files()}
    for base in english:
        versions[base] = {c: f"/{c}{base}" for c, d in langs.items() if base in d["pages"]}
    # write the language pages
    written = 0
    for code, d in langs.items():
        t, packs = d["t"], d["packs"]
        local = {"/"} | {f"/{p['slug']}/" for p in packs} | set(d["pages"])
        pages = {f"/{code}/": home_page(code, t, packs, d["pages"])}
        for p in packs:
            pages[f"/{code}/{p['slug']}/"] = pack_page(code, t, p, packs, facts)
        for base in d["pages"]:
            pages[f"/{code}{base}"] = content_page(code, t, base, english[base])
        for url, body in pages.items():
            base = "/" if url == f"/{code}/" else url[len(code) + 1:]
            alts = alternates(base, versions.get(base, {}))
            body = inject(localize(body, code, local), code, alts, cta)
            out = ROOT / url.strip("/") / "index.html"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(body, encoding="utf-8")
            written += 1
    # remove pages of languages or packs that are no longer usable
    for code in LANG:
        d = ROOT / code
        if not d.is_dir():
            continue
        keep = {f"/{code}/"} | {f"/{code}/{p['slug']}/" for p in langs.get(code, {}).get("packs", [])} | \
            {f"/{code}{base}" for base in langs.get(code, {}).get("pages", [])}
        for f in d.rglob("index.html"):
            if url_of(f) not in keep:
                f.unlink()
    # menu + hreflang on every English page (other languages or the language home as fallback)
    homes = {c: f"/{c}/" for c in langs}
    for f in english_files(live):
        url = url_of(f)
        same = alternates(url, versions.get(url, {}))
        menu = alternates(url, {**homes, **versions.get(url, {})})
        f.write_text(inject(f.read_text(encoding="utf-8"), "en", menu, cta, same), encoding="utf-8")
    print(f"wrote {written} language pages in {len(langs)} languages")
    for code, why in pending.items():
        print(f"PENDING {code} ({LANG[code]['english']}): {'; '.join(why)[:160]}")


def status():
    live = [p for p in bp.PACKS if bp.is_live(p)]
    src = source()
    for code in LANG:
        ok, bad = usable(code, src)
        kinds = {}
        for why in bad.values():
            kinds[why.split(" ")[0]] = kinds.get(why.split(" ")[0], 0) + 1
        print(f"{code:4} {LANG[code]['english']:10} usable {len(ok):3}/{len(src)}  " +
              ", ".join(f"{k} {n}" for k, n in sorted(kinds.items())))
        for k, why in list(bad.items())[:3]:
            if why not in ("missing", "no back-translation"):
                print(f"       {k}: {why}")
    _ = live


def todo(code, out):
    """Write {key: {en, note}} of everything this language still needs (missing or stale)."""
    src = source()
    _, bad = usable(code, src)
    data = {k: {"en": src[k][0], "note": src[k][1]} for k, why in bad.items() if why in ("missing", "stale")}
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{code}: {len(data)} strings to translate -> {out}")


def merge(code, path):
    """Merge {key: translation} into tools/i18n/<code>.json, with src from today's English."""
    src = source()
    f = I18N / f"{code}.json"
    doc = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"_lang": code, "strings": {}}
    n = 0
    for k, t in json.loads(Path(path).read_text(encoding="utf-8")).items():
        if k in src and isinstance(t, str) and t.strip():
            old = doc["strings"].get(k, {})
            row = {"src": src[k][0], "t": t.strip()}
            if old.get("t") == row["t"] and old.get("src") == row["src"] and old.get("back"):
                row["back"] = old["back"]
            doc["strings"][k] = row
            n += 1
    f.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{code}: merged {n} translations")


def blind(code, out, only_new=False):
    """Write only the translations (no English) for a blind back-translation."""
    rows = load(code)
    data = {k: r["t"] for k, r in rows.items() if r.get("t") and not (only_new and r.get("back"))}
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(data)} lines to {out}")


def merge_back(code, path):
    """Merge {key: back-translation} into tools/i18n/<code>.json (only for unchanged translations)."""
    f = I18N / f"{code}.json"
    doc = json.loads(f.read_text(encoding="utf-8"))
    back = json.loads(Path(path).read_text(encoding="utf-8"))
    n = 0
    for k, b in back.items():
        if k in doc["strings"] and isinstance(b, str) and b.strip():
            doc["strings"][k]["back"] = b.strip()
            n += 1
    f.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{code}: merged {n} back-translations")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "export":
        export()
    elif cmd == "blind":
        blind(sys.argv[2], sys.argv[3], "--new" in sys.argv)
    elif cmd == "todo":
        todo(sys.argv[2], sys.argv[3])
    elif cmd == "merge":
        merge(sys.argv[2], sys.argv[3])
    elif cmd == "merge-back":
        merge_back(sys.argv[2], sys.argv[3])
    elif cmd == "status":
        status()
    else:
        live = [p for p in bp.PACKS if bp.is_live(p)]
        build(live)


if __name__ == "__main__":
    main()
