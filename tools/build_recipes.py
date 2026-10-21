#!/usr/bin/env python3
"""Build the recipe pages: /recipes/ (a list) and /recipes/<slug>/ for each recipe.

Why: Google indexes the homepage and the pack pages only. A crawlable page per recipe ("thati
bellam coffee", "bellam paramannam", "chimmili", "pasupu paalu") with Recipe structured data gives
people more ways to find us, and each recipe links to the pack it is made with.

Copy: the approved November social posts. Ingredients, steps and tips are exactly as rendered on
the post images (docs/marketing/social/month_2026-11/month_specs.json). The English lede and the
Telugu and Hindi lines are the approved captions (calendar_2026-10-22_to_11-24.json) without the
emoji and the date-bound words ("tomorrow"). Anything that is not in that copy is marked ADDED.
Plain recipe text only: no claim words and no health or benefit talk, checked on every build.

docs/ is not in git, so the copy lives here. When docs/ is present, the build warns if the approved
copy has changed since, and refreshes /assets/recipes/<slug>.png from the post's feed.png render.

Run from the repo root:
  python3 tools/build_pages.py     # packs, sitemap, homepage links AND these recipe pages
  python3 tools/build_recipes.py   # only the recipe pages
"""
import html
import json
import re
import shutil
import struct
import subprocess
import sys

sys.dont_write_bytecode = True  # no tools/__pycache__ left in the repo
import build_pages as bp  # noqa: E402

ROOT = bp.ROOT
SITE = bp.SITE
SOCIAL = ROOT / "docs" / "marketing" / "social"
SPECS = SOCIAL / "month_2026-11" / "month_specs.json"
CALENDAR = SOCIAL / "month_2026-11" / "calendar_2026-10-22_to_11-24.json"
IMG_LIMIT = 400_000  # bytes, per recipe image

# Stricter than build_pages.BANNED: claim words in English, Telugu and Hindi, plus any health,
# benefit or remedy talk. Run over the whole generated page (text, meta tags and JSON-LD).
# Hindi nukta letters (ज़, फ़) are listed both precomposed and with a combining nukta.
CLAIMS = re.compile(
    r"natural|\bpure|100\s*%|no[- ]added|tradition|chemical|organic|health|authentic|premium|fresh|"
    r"immun|digest|detox|remed|medic|\bheal|\bcur(?:e|es|ed|ing)\b|wellness|benefit|nutri|vitamin|"
    r"antioxid|inflam|\bcough|\bcold\b|\bflu\b|good for you|superfood|boost|goodness|wholesome|"
    r"సహజ|శుద్ధ|స్వచ్ఛ|నేచురల్|ఆర్గానిక్|ఫ్రెష్|సాంప్రదాయ|సంప్రదాయ|సేంద్రి|సేంద్రీ|ఆరోగ్య|ప్రీమియం|"
    r"తాజా|రసాయన|అసలైన|రోగనిరోధ|జలుబు|దగ్గు|జీర్ణ|ఔషధ|"
    r"प्राकृतिक|नेचुरल|शुद्ध|पारंपरिक|परंपरा|जैविक|ऑर्गेनिक|सेहत|स्वस्थ|स्वास्थ्य|प्रीमियम|"
    "ताज़ा|ताज़ा|ताजा|केमिकल|रसायन|असली|इम्यु|इम्यू|प्रतिरक्षा|सर्दी|खांसी|खाँसी|पाचन|औषध|"
    "फ़ायद|फ़ायद|फायद",
    re.I)
# A 10-digit Indian mobile number in the visible text (the footer's wa.me link is an href, not text).
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")

# time: (shown, ISO 8601) or None · yields: (label, shown, schema.org recipeYield)
# packs: the "Made with" box · also: packs named in one "Sweeten it with" line
RECIPES = [
    dict(
        slug="palm-jaggery-coffee", post="2026-10-28_recipe-palm-coffee",
        name="Palm Jaggery Coffee",
        gloss="Thati Bellam Coffee",       # the Telugu name in Latin letters
        te="తాటి బెల్లం కాఫీ", hi="ताड़ के गुड़ वाली कॉफ़ी",
        te_tr="Thati Bellam Coffee",
        hi_tr="Taad Ke Gud Wali Coffee",   # ADDED: transliteration of the approved Hindi name
        alt=[],
        eyebrow="Recipe · 5 minutes",
        title="Palm Jaggery Coffee (Thati Bellam Coffee) Recipe | 1acrefarms",
        desc="Palm jaggery coffee (thati bellam coffee), the Andhra way: filter coffee decoction and hot "
             "milk, with grated palm jaggery stirred in off the heat. Ready in 5 minutes.",
        lede="Palm jaggery coffee, the Andhra way. Boil the milk, add it to the decoction, then stir in "
             "grated palm jaggery off the heat. Froth it between tumbler and davara.",
        te_line="పాలు మరిగించి డికాషన్‌లో కలపండి, స్టవ్ ఆపాక తురిమిన తాటి బెల్లం వేసి కలపండి. "
                "టంబ్లర్, దవరాతో నురుగు వచ్చేలా ఆడించండి.",
        hi_line="दूध उबालकर डिकॉक्शन में मिलाएँ, फिर आँच बंद करके कसा हुआ ताड़ का गुड़ घोलें। "
                "टंबलर और दवरा से झाग बनाएँ।",
        time=("5 minutes", "PT5M"),
        yields=("Makes", "1 tumbler", "1 tumbler"),  # ADDED: 1 cup milk + 2 tbsp decoction is one tumbler
        ingredients=["1 cup milk", "2 tbsp filter coffee decoction", "1–2 tsp grated palm jaggery"],
        steps=["Bring the milk to a boil.",
               "Pour the decoction into a tumbler and add the hot milk.",
               "Stir in the palm jaggery off the heat.",
               "Pour between tumbler and davara to froth."],
        tip="Add jaggery after the milk is off the boil so it does not split.",
        packs=["palm-jaggery"],
        category="Drink",                                                     # ADDED (schema only)
        keywords="thati bellam coffee, palm jaggery coffee, filter coffee, Andhra coffee",  # ADDED
    ),
    dict(
        slug="paramannam", post="2026-11-05_recipe-paramannam",
        name="Bellam Paramannam",
        gloss="Jaggery Rice Kheer",        # ADDED: English gloss
        te="బెల్లం పరమాన్నం", hi="गुड़ वाली खीर",
        te_tr="Bellam Paramannam",
        hi_tr="Gud Wali Kheer",            # ADDED: transliteration of the approved Hindi name
        alt=["Paramannam"],
        eyebrow="Diwali recipe · serves 4",
        title="Bellam Paramannam (Jaggery Rice Kheer) Recipe | 1acrefarms",
        desc="Bellam paramannam for Diwali: rice cooked in milk till creamy, grated cane jaggery stirred "
             "in off the heat, finished with ghee-fried cashews and cardamom. Serves 4.",
        lede="A Diwali favourite: bellam paramannam. Cook rice in milk till creamy, rest it 5 minutes, "
             "then stir in grated cane jaggery. Finish with ghee-fried cashews and cardamom.",
        te_line="బియ్యాన్ని పాలలో మెత్తగా ఉడికించి, 5 నిమిషాలు ఆగి, తురిమిన చెరుకు బెల్లం కలపండి. "
                "నెయ్యిలో వేయించిన జీడిపప్పు, యాలకుల పొడి వేయండి.",
        hi_line="चावल को दूध में गाढ़ा होने तक पकाएँ, 5 मिनट रुकें, फिर कसा हुआ गन्ने का गुड़ मिलाएँ। "
                "घी में भुने काजू और इलायची डालें।",
        time=("About 35 minutes", "PT35M"),  # ADDED: the approved 30 min on the stove + 5 min rest
        yields=("Serves", "4", "4 servings"),
        ingredients=["½ cup rice", "4 cups milk", "¾ cup grated cane jaggery", "2 tbsp ghee · 10 cashews",
                     "½ tsp cardamom powder"],
        steps=["Cook the washed rice in the milk on a low flame till soft and creamy, about 30 minutes. "
               "Stir often.",
               "Switch off and let it rest 5 minutes.",
               "Stir in the jaggery till it melts.",
               "Fry the cashews in ghee; add with the cardamom."],
        tip="Jaggery goes in off the heat so the milk does not split.",
        packs=["cane-jaggery"],
        category="Dessert",                                                   # ADDED (schema only)
        keywords="bellam paramannam, paramannam, jaggery rice kheer, gud wali kheer, Diwali sweet",  # ADDED
    ),
    dict(
        slug="chimmili", post="2026-11-12_recipe-chimmili",
        name="Chimmili for Nagula Chavithi",
        gloss="Sesame Jaggery Balls",      # ADDED: English gloss
        te="నాగుల చవితికి చిమ్మిలి", hi="नागुल चविति के लिए तिल-गुड़ के लड्डू",
        te_tr="Nuvvula Chimmili",          # ADDED: the usual Telugu name (nuvvulu = sesame)
        hi_tr="Til-Gud Ke Laddoo",         # ADDED: transliteration of the approved Hindi name
        alt=["Chimmili", "చిమ్మిలి", "तिल-गुड़ के लड्डू"],
        eyebrow="Nagula Chavithi recipe",
        title="Chimmili (Sesame Jaggery Balls) for Nagula Chavithi | 1acrefarms",
        desc="Chimmili for Nagula Chavithi: roasted sesame ground coarsely and pulsed with grated cane "
             "jaggery and cardamom, then shaped into small balls. Makes about 12.",
        lede="Chimmili for Nagula Chavithi. Make chimmili at home: roast sesame till it crackles, grind "
             "coarsely, pulse with grated cane jaggery and cardamom, shape into balls.",
        te_line="ఇంట్లోనే చిమ్మిలి: నువ్వులు చిటపటలాడే వరకు వేయించి, బరకగా పొడి చేసి, తురిమిన చెరుకు "
                "బెల్లం, యాలకుల పొడితో కలిపి ఉండలు చేయండి.",
        hi_line="घर पर तिल-गुड़ के लड्डू: तिल को चटकने तक भूनें, दरदरा पीसें, कसा हुआ गन्ने का गुड़ और "
                "इलायची मिलाकर लड्डू बनाएँ।",
        time=None,                         # not in the approved copy, so left out
        yields=("Makes", "About 12", "About 12 balls"),
        ingredients=["1 cup white sesame seeds", "¾ cup grated cane jaggery", "¼ tsp cardamom powder"],
        steps=["Dry-roast the sesame on a low flame till it crackles and turns light golden. Cool.",
               "Grind the sesame coarsely in short pulses.",
               "Add the jaggery and cardamom; pulse till it comes together.",
               "Shape into small balls."],
        meta="Makes about 12 · keeps a week in an airtight jar.",
        tip="Keeps a week in an airtight jar.",
        packs=["cane-jaggery"],
        category="Sweet",                                                     # ADDED (schema only)
        keywords="chimmili, nuvvula chimmili, sesame jaggery balls, til gud laddoo, Nagula Chavithi",  # ADDED
    ),
    dict(
        slug="pasupu-paalu", post="2026-11-16_recipe-pasupu-paalu",
        name="Warm Pasupu Paalu",
        gloss="Turmeric Milk",             # ADDED: English gloss
        te="పసుపు పాలు", hi="हल्दी वाला दूध",
        te_tr="Pasupu Paalu",
        hi_tr="Haldi Wala Doodh",          # ADDED: transliteration of the approved Hindi name
        alt=["Haldi Doodh"],               # from the approved hashtag #HaldiDoodh
        eyebrow="Karthika Somavaram · 5 minutes",
        title="Pasupu Paalu (Turmeric Milk) Recipe | 1acrefarms",
        desc="Pasupu paalu (haldi doodh), a warm cup for a Karthika Somavaram evening: milk simmered with "
             "turmeric and a pinch of pepper, with a spoon of jaggery. Ready in 5 minutes.",
        lede="Karthika Somavaram evening: a warm cup of pasupu paalu. Simmer milk with turmeric and a pinch "
             "of pepper, switch off, then stir in a spoon of jaggery.",
        te_line="పాలలో పసుపు, చిటికెడు మిరియాల పొడి వేసి మరిగించి, స్టవ్ ఆపాక చెంచా బెల్లం కలపండి.",
        hi_line="दूध में हल्दी और चुटकी भर काली मिर्च उबालें, आँच बंद करके एक चम्मच गुड़ मिलाएँ।",
        time=("5 minutes", "PT5M"),
        yields=("Makes", "1 cup", "1 cup"),  # ADDED: from the approved 1 cup milk
        ingredients=["1 cup milk", "¼ tsp turmeric powder", "A pinch of black pepper",
                     "1 tsp grated palm or cane jaggery"],
        steps=["Warm the milk with the turmeric and pepper; simmer 2 minutes.",
               "Switch off and wait a minute.",
               "Stir in the jaggery and serve warm."],
        tip="Strain through a fine sieve if you like it smooth.",
        packs=["turmeric-powder", "hill-turmeric-powder"],
        also=["palm-jaggery", "cane-jaggery"],  # ADDED: one "sweeten it with" line; the recipe uses either
        category="Drink",                                                     # ADDED (schema only)
        keywords="pasupu paalu, turmeric milk, haldi doodh, Karthika Somavaram",  # ADDED
    ),
]

PACK_BY_SLUG = {p["slug"]: p for p in bp.PACKS}


def e(s):
    return html.escape(s, quote=True)


def ingredient_lines(r):
    """The post image packs two items on one line ("2 tbsp ghee · 10 cashews"); list them apart."""
    return [part for line in r["ingredients"] for part in line.split(" · ")]


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit(f"{path} is not a PNG")
    return struct.unpack(">II", head[16:24])


def refresh_image(r):
    """Copy the post's feed.png render to /assets/recipes/<slug>.png (when docs/ is here and newer)."""
    dst = ROOT / "assets" / "recipes" / f"{r['slug']}.png"
    src = SOCIAL / "posts_v2" / r["post"] / "feed.png"
    if src.exists() and (not dst.exists() or src.stat().st_mtime > dst.stat().st_mtime):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        if dst.stat().st_size > IMG_LIMIT:
            subprocess.run(["sips", "-Z", "960", str(dst)], check=True, capture_output=True)
        print("copied", src.relative_to(ROOT), "->", dst.relative_to(ROOT), f"({dst.stat().st_size // 1024} KB)")
    if not dst.exists():
        sys.exit(f"missing {dst.relative_to(ROOT)} and no render at {src.relative_to(ROOT)}")
    if dst.stat().st_size > IMG_LIMIT:
        sys.exit(f"{dst.relative_to(ROOT)} is over {IMG_LIMIT // 1000} KB; shrink it with: sips -Z 960 {dst}")
    return png_size(dst)


def check_against_social():
    """Warn (don't stop) if the approved copy in docs/ no longer matches what these pages say."""
    if not SPECS.exists():
        return
    specs = {s["id"]: s for s in json.loads(SPECS.read_text(encoding="utf-8"))}
    cal = {c["id"]: c for c in json.loads(CALENDAR.read_text(encoding="utf-8"))} if CALENDAR.exists() else {}
    emoji = re.compile(r"[☀-➿\U0001F000-\U0001FAFF]\s*")
    for r in RECIPES:
        s, c, drift = specs.get(r["post"]), cal.get(r["post"]), []
        if not s:
            drift.append("post not in month_specs.json")
        else:
            drift += [k for k in ("ingredients", "steps", "te", "hi") if s[k] != r[k]]
            if s["meta"] != r.get("meta", r["tip"]):
                drift.append("meta/tip")
        if c:
            en, te, hi = c["caption"].split("\n")[:3]
            for label, line, ours in (("en", en, r["lede"]), ("te", te, r["te_line"]), ("hi", hi, r["hi_line"])):
                if emoji.split(line, 1)[-1].strip() not in ours:
                    drift.append(f"caption {label}")
        if drift:
            print(f"WARNING {r['slug']}: approved copy changed or differs ({', '.join(drift)}); check {r['post']}")


def check_copy(name, page):
    hit = CLAIMS.search(page)
    if hit:
        sys.exit(f"Claim word in {name}: {hit.group(0)!r}")
    text = re.sub(r"<[^>]+>", " ", page)
    phone = PHONE.search(text)
    if phone:
        sys.exit(f"Phone number in the text of {name}: {phone.group(0)!r}")
    title = html.unescape(re.search(r"<title>(.*?)</title>", page).group(1))
    if len(title) > 65:
        print(f"WARNING {name}: title is {len(title)} characters")


def head(title, desc, url, og_type, og_title, og_image, ld):
    json.loads(ld)  # stop here if the JSON-LD is not valid JSON
    return f"""<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="{og_type}" />
  <meta property="og:site_name" content="1acrefarms" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{e(og_title)}" />
  <meta property="og:description" content="{e(desc)}" />
  <meta property="og:image" content="{og_image}" />
  <meta property="og:locale" content="en_IN" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
{ld}
  </script>
{bp.HEAD_ASSETS}
</head>"""


def crumbs_ld(*items):
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i, "name": n, "item": u}
                            for i, (n, u) in enumerate(items, 1)],
    }


def recipe_ld(r, url):
    ld = {
        "@type": "Recipe",
        "@id": url + "#recipe",
        "name": r["name"],
        "alternateName": [r["gloss"], r["te"], r["hi"], r["te_tr"], r["hi_tr"]] + r["alt"],
        "description": r["lede"],
        "image": [f"{SITE}/assets/recipes/{r['slug']}.png"],
        "author": {"@type": "Organization", "@id": f"{SITE}/#business", "name": "1acrefarms", "url": f"{SITE}/"},
        "recipeCuisine": "Andhra / Telugu",
        "recipeCategory": r["category"],
        "keywords": r["keywords"],
        "recipeYield": r["yields"][2],
        "recipeIngredient": ingredient_lines(r),
        "recipeInstructions": [{"@type": "HowToStep", "position": i, "text": s, "url": f"{url}#step-{i}"}
                               for i, s in enumerate(r["steps"], 1)],
    }
    if r["time"]:
        ld["totalTime"] = r["time"][1]
    # dedupe alternate names while keeping order
    ld["alternateName"] = list(dict.fromkeys(n for n in ld["alternateName"] if n != r["name"]))
    return ld


def made_with(r):
    cards = []
    for slug in r["packs"]:
        p = PACK_BY_SLUG[slug]
        cards.append(f"""          <div class="rcp-pack">
            <a href="/{p['slug']}/"><img src="/assets/packs/{p['pack']}" alt="{p['name']} {p['g']} g pack" width="800" height="1122" loading="lazy" /></a>
            <div>
              <a class="po-name" href="/{p['slug']}/">{p['name']}</a>
              <span class="po-te"><span lang="te">{p['te']}</span> · {p['local']}</span>
              <span class="po-price">MRP ₹{p['mrp']} · {p['g']} g</span>
              <span class="rcp-pack-links"><a href="/{p['slug']}/">See the pack</a><a href="/?add=pk-{p['code'].lower()}@{p['g']}#{p['section']}">Add to order</a></span>
            </div>
          </div>""")
    also = ""
    if r.get("also"):
        links = " or ".join(f'<a href="/{s}/">{PACK_BY_SLUG[s]["name"]}</a>' for s in r["also"])
        also = f'\n          <p class="rcp-also">Sweeten it with {links}.</p>'
    return f"""        <div class="rcp-made">
          <p class="eyebrow">Made with</p>
{chr(10).join(cards)}{also}
        </div>"""


def tile(r):
    p = PACK_BY_SLUG[r["packs"][0]]
    # "serves 4" / "makes about 12" when that says more than the time, else "5 minutes"
    if r["time"] and r["yields"][0] != "Serves":
        when = r["time"][0]
    else:
        when = f"{r['yields'][0]} {r['yields'][1]}"
    return f"""        <a class="rcp-tile" href="/recipes/{r['slug']}/">
          <img src="/assets/recipes/{r['slug']}.png" alt="{e(r['name'])} recipe card" width="{r['_w']}" height="{r['_h']}" loading="lazy" />
          <span class="rt-name">{e(r['name'])}</span>
          <span class="rt-names"><span lang="te">{r['te']}</span> · <span lang="hi">{r['hi']}</span></span>
          <span class="rt-line">With {p['name']} · {when.lower()}</span>
        </a>"""


def recipe_page(r, live):
    url = f"{SITE}/recipes/{r['slug']}/"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        recipe_ld(r, url),
        crumbs_ld(("Home", f"{SITE}/"), ("Recipes", f"{SITE}/recipes/"), (r["name"], url)),
    ]}, ensure_ascii=False, indent=2)
    facts = []
    if r["time"]:
        facts.append(f"<li><span>Time</span>{r['time'][0]}</li>")
    facts.append(f"<li><span>{r['yields'][0]}</span>{r['yields'][1]}</li>")
    facts.append("<li><span>Made with</span>" + " · ".join(
        f'<a href="/{s}/">{PACK_BY_SLUG[s]["name"]}</a>' for s in r["packs"]) + "</li>")
    facts = "\n".join(f"          {f}" for f in facts)
    ingredients = "\n".join(f"            <li>{e(i)}</li>" for i in ingredient_lines(r))
    steps = "\n".join(f'            <li id="step-{i}">{e(s)}</li>' for i, s in enumerate(r["steps"], 1))
    more = "\n".join(tile(q) for q in RECIPES if q is not r)
    return head(r["title"], r["desc"], url, "article", f"{r['name']} ({r['gloss']}) · 1acrefarms",
                f"{SITE}/assets/recipes/{r['slug']}.png", ld) + f"""
<body class="pdp-page rcp-page">
{bp.HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/recipes/">Recipes</a> <span aria-hidden="true">›</span> <span aria-current="page">{e(r['name'])}</span></nav>

    <article class="rcp">
      <div class="rcp-main">
        <p class="eyebrow">{r['eyebrow']}</p>
        <h1>{e(r['name'])} <span class="pdp-local">({e(r['gloss'])})</span></h1>
        <p class="pdp-names"><span lang="te">{r['te']}</span> · <span lang="hi">{r['hi']}</span> · {r['te_tr']} · {r['hi_tr']}</p>
        <p class="pdp-lede">{e(r['lede'])}</p>
        <p class="pdp-lang" lang="te">{r['te_line']}</p>
        <p class="pdp-lang" lang="hi">{r['hi_line']}</p>
        <ul class="pdp-facts rcp-facts">
{facts}
        </ul>

        <section class="rcp-section">
          <h2>Ingredients</h2>
          <ul class="rcp-ing">
{ingredients}
          </ul>
        </section>

        <section class="rcp-section">
          <h2>Method</h2>
          <ol class="rcp-steps">
{steps}
          </ol>
          <p class="rcp-tip"><b>Tip</b>{e(r['tip'])}</p>
        </section>
      </div>

      <aside class="rcp-aside">
{made_with(r)}
        <figure class="rcp-card">
          <img src="/assets/recipes/{r['slug']}.png" alt="{e(r['name'])} recipe card from 1acrefarms" width="{r['_w']}" height="{r['_h']}" loading="lazy" />
        </figure>
      </aside>
    </article>

    <section class="rcp-more">
      <h2>More recipes</h2>
      <div class="rcp-grid">
{more}
      </div>
      <p class="rcp-all"><a href="/recipes/">All recipes</a></p>
    </section>
  </main>

{bp.footer(live)}
</body>
</html>
"""


def hub_page(live):
    url = f"{SITE}/recipes/"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": url + "#page", "name": "Recipes", "url": url,
         "publisher": {"@id": f"{SITE}/#business"},
         "mainEntity": {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i, "url": f"{SITE}/recipes/{r['slug']}/", "name": r["name"]}
             for i, r in enumerate(RECIPES, 1)]}},
        crumbs_ld(("Home", f"{SITE}/"), ("Recipes", url)),
    ]}, ensure_ascii=False, indent=2)
    tiles = "\n".join(tile(r) for r in RECIPES)
    desc = ("Home recipes made with 1acrefarms turmeric and jaggery: palm jaggery coffee, bellam paramannam, "
            "chimmili for Nagula Chavithi and pasupu paalu.")
    return head("Turmeric & Jaggery Recipes (Pasupu, Bellam) | 1acrefarms", desc, url, "website",
                "Recipes · 1acrefarms", f"{SITE}/assets/og-image.jpg", ld) + f"""
<body class="pdp-page rcp-page">
{bp.HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <span aria-current="page">Recipes</span></nav>

    <section class="rcp-hub">
      <p class="eyebrow">From an Andhra kitchen</p>
      <h1>Recipes with turmeric and jaggery</h1>
      <p class="pdp-lede">Home recipes made with our pasupu and bellam. Each one links to the pack it uses.</p>
      <div class="rcp-grid">
{tiles}
      </div>
    </section>
  </main>

{bp.footer(live)}
</body>
</html>
"""


def sitemap_rows():
    """Rows for build_pages.sitemap(): the recipe list, then each recipe."""
    return [(f"{SITE}/recipes/", "monthly", "0.6")] + [
        (f"{SITE}/recipes/{r['slug']}/", "monthly", "0.7") for r in RECIPES]


def build(live):
    check_against_social()
    live_slugs = {p["slug"] for p in live}
    for r in RECIPES:
        missing = [s for s in r["packs"] + r.get("also", []) if s not in live_slugs]
        if missing:
            sys.exit(f"{r['slug']} links to packs that are not live: {missing}")
        r["_w"], r["_h"] = refresh_image(r)
    pages = {ROOT / "recipes" / "index.html": hub_page(live)}
    for r in RECIPES:
        pages[ROOT / "recipes" / r["slug"] / "index.html"] = recipe_page(r, live)
    for path, body in pages.items():
        check_copy(path.relative_to(ROOT), body)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        print("wrote", path.relative_to(ROOT))


def main():
    live = [p for p in bp.PACKS if bp.is_live(p)]
    bp.check_mrps(live)
    build(live)


if __name__ == "__main__":
    main()
