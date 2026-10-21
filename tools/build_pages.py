#!/usr/bin/env python3
"""Build one static page per pack (/turmeric-powder/ etc.) and refresh sitemap.xml.

Why: the shop on index.html is drawn by app.js, so Google sees one page and ranks us only for
"1acrefarms". A crawlable page per pack, with its Telugu/Hindi names, origin, price and Product
structured data, lets people find us for "konda pasupu", "thati bellam", "palm jaggery" and so on.

Facts come from app.js (names, origins, MRPs, shelf life, PACK_FACTS nutrition) and from the
approved social copy (Telugu/Hindi lines). Plain facts only: no claim words, no health claims.

Run from the repo root:  python3 tools/build_pages.py
Packs with live_from in the future are skipped until that date (IST), so re-running on or after
31 Oct 2026 adds the chilli and cashew pages by itself. Also rewrites the PACK-LINKS block in
index.html so the homepage links to every live page in plain HTML.
"""
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://1acrefarms.co.in"
WA = "917899929779"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TODAY = dt.datetime.now(IST).date()

MAKER = {
    "mfd": "Manufactured &amp; Marketed By",
    "packed": "Packed &amp; Marketed By",
}
ADDRESS = ("1acrefarms, Flat No. 202, Prudhvi Exotica, D.No. 13-1-375/7/A, Srinivasa Nagar, "
           "Narasaraopet, Palnadu Dist., A.P. 522601")
BANNED = re.compile(r"\b(natural|pure|100%|no added|traditional|chemical[- ]free|organic|healthy|"
                    r"authentic|premium|fresh)\b", re.I)

TURMERIC_USES = [
    "A pinch in dal, sambar, rasam, curries and pulihora.",
    "Add it on a low flame so it does not burn.",
    "Use a dry spoon and keep the zip shut after use.",
]
JAGGERY_TIP = "If it sets hard, grate it."

PACKS = [
    dict(code="TURM", slug="turmeric-powder", section="spices", crumb="Turmeric",
         name="Turmeric Powder", local="Pasupu", te="పసుపు", hi="हल्दी", hi_tr="Haldi",
         note="Farm-sourced · sun-dried · stone-ground", origin="Grown in Palnadu &amp; Guntur",
         pack="turmeric-540g.jpg", by="mfd", shelf=12, ingredients="Turmeric (Curcuma longa).",
         g=540, mrp=396, category="Spices > Turmeric powder",
         title="Turmeric Powder (Pasupu) 540 g from Palnadu &amp; Guntur | 1acrefarms",
         desc="Pasupu (haldi) from Palnadu and Guntur, sun-dried and stone-ground, in a 540 g pack. "
              "MRP ₹396 incl. of all taxes. Order online or on WhatsApp. Free delivery on 2+ packs.",
         lede="Turmeric powder from Palnadu and Guntur. Sun-dried, stone-ground and packed in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరు పసుపు. ఎండలో ఆరబెట్టి, రాతి తిరగలిలో పట్టిన పొడి. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="पलनाडु और गुंटूर की हल्दी, धूप में सुखाकर पत्थर की चक्की में पिसी। नरसरावपेट में पैक।",
         uses=TURMERIC_USES),
    dict(code="KPAS", slug="hill-turmeric-powder", section="spices", crumb="Turmeric",
         name="Hill Turmeric Powder", local="Konda Pasupu", te="కొండ పసుపు", hi="पहाड़ी हल्दी", hi_tr="Pahadi Haldi",
         note="Whole hill turmeric fingers, packed as fine powder", origin="Araku &amp; Maredumilli hills",
         pack="hill-turmeric-540g.jpg", by="mfd", shelf=12, ingredients="Turmeric (Curcuma longa).",
         g=540, mrp=495, category="Spices > Turmeric powder",
         title="Hill Turmeric Powder (Konda Pasupu) 540 g from Araku | 1acrefarms",
         desc="Konda pasupu: hill turmeric from the Araku and Maredumilli hills, packed as fine powder in a "
              "540 g pack. MRP ₹495 incl. of all taxes. Free delivery on 2+ packs.",
         lede="Konda pasupu: hill turmeric from the Araku and Maredumilli hills. Whole hill turmeric fingers, "
              "packed as fine powder in Narasaraopet.",
         te_line="అరకు, మారేడుమిల్లి కొండల నుంచి కొండ పసుపు. కొండ పసుపు కొమ్ములను నరసరావుపేటలో మెత్తని పొడిగా ప్యాక్ చేస్తాం.",
         hi_line="अरकू और मारेडुमिल्ली की पहाड़ियों से पहाड़ी हल्दी। साबुत पहाड़ी हल्दी, नरसरावपेट में बारीक पाउडर के रूप में पैक।",
         uses=["Use it wherever you use turmeric: dal, sambar, curries and pulihora."] + TURMERIC_USES[1:]),
    dict(code="SANN", slug="sannam-chilli-powder", section="spices", crumb="Chilli",
         live_from=dt.date(2026, 10, 31),
         name="Sannam Chilli Powder", local="Sannam Kaaram", te="సన్నం కారం", hi="सन्नम मिर्च पाउडर", hi_tr="Lal Mirch",
         note="Whole sun-dried chillies, packed as fine powder", origin="Grown in Palnadu &amp; Guntur",
         pack="sannam-540g.jpg", by="mfd", shelf=12, ingredients="Sannam red chillies (Capsicum annuum).",
         g=540, mrp=306, category="Spices > Chilli powder",
         title="Sannam Chilli Powder (Sannam Kaaram) 540 g | 1acrefarms",
         desc="Sannam kaaram: red chilli powder from whole sun-dried Sannam chillies grown in Palnadu, 540 g. "
              "MRP ₹306 incl. of all taxes. Free delivery on 2+ packs.",
         lede="Sannam kaaram: whole sun-dried Sannam chillies, grown in Palnadu and Guntur and packed as fine "
              "powder in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరులో పండిన సన్నం మిరపకాయలు. ఎండబెట్టిన మిరపకాయలను మెత్తని కారంగా ప్యాక్ చేస్తాం.",
         hi_line="पलनाडु और गुंटूर में उगी सन्नम मिर्च। धूप में सूखी साबुत मिर्च, बारीक पाउडर के रूप में पैक।",
         uses=["Use in curries, chutneys, podis and pickles.", "Add it to hot oil on a low flame.",
               "Use a dry spoon and keep the zip shut after use."]),
    dict(code="TEJA", slug="teja-chilli-powder", section="spices", crumb="Chilli",
         live_from=dt.date(2026, 10, 31),
         name="Teja Chilli Powder", local="Teja Kaaram", te="తేజ కారం", hi="तेजा मिर्च पाउडर", hi_tr="Lal Mirch",
         note="Extra hot · sun-dried · stone-ground", origin="Grown in Palnadu &amp; Guntur",
         pack="teja-540g.jpg", by="mfd", shelf=12, ingredients="Teja red chillies (Capsicum annuum).",
         g=540, mrp=342, category="Spices > Chilli powder",
         title="Teja Chilli Powder (Teja Kaaram) 540 g, extra hot | 1acrefarms",
         desc="Teja kaaram: extra hot red chilli powder, sun-dried and stone-ground, 540 g. MRP ₹342 incl. of "
              "all taxes. Free delivery on 2+ packs.",
         lede="Teja kaaram: extra hot Teja chillies grown in Palnadu and Guntur, sun-dried and stone-ground, "
              "packed in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరులో పండిన తేజ మిరపకాయల కారం. చాలా కారంగా ఉంటుంది. ఎండబెట్టి, రాతి తిరగలిలో పట్టినది.",
         hi_line="पलनाडु और गुंटूर की तेजा मिर्च का पाउडर। बहुत तीखा। धूप में सुखाकर पत्थर की चक्की में पिसा।",
         uses=["A little goes a long way: start with less than you would of milder chilli powder.",
               "Use in curries, chutneys, podis and pickles.", "Use a dry spoon and keep the zip shut after use."]),
    dict(code="CBEL", slug="cane-jaggery", section="jaggery", crumb="Jaggery",
         name="Cane Jaggery", local="Cheruku Bellam", te="చెరుకు బెల్లం", hi="गन्ने का गुड़", hi_tr="Gud",
         note="Village desi · dark · slow-boiled", origin="Chittoor &amp; Anakapalli cane belts",
         pack="cane-jaggery-540g.jpg", by="packed", shelf=9, ingredients="Sugarcane jaggery.",
         g=540, mrp=234, category="Sweeteners > Jaggery",
         title="Cane Jaggery (Cheruku Bellam) 540 g from Anakapalli &amp; Chittoor | 1acrefarms",
         desc="Cheruku bellam (gud): dark, slow-boiled cane jaggery from the Chittoor and Anakapalli cane belts, "
              "540 g. MRP ₹234 incl. of all taxes. Free delivery on 2+ packs.",
         lede="Cheruku bellam: dark, slow-boiled village desi cane jaggery from the Chittoor and Anakapalli "
              "cane belts, packed in Narasaraopet.",
         te_line="చిత్తూరు, అనకాపల్లి నుంచి చెరుకు బెల్లం. ముదురు రంగు, నెమ్మదిగా మరిగించిన పల్లె బెల్లం. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="चित्तूर और अनकापल्ली का गन्ने का गुड़। गहरे रंग का, धीमी आँच पर पकाया गाँव का गुड़। नरसरावपेट में पैक।",
         uses=["Sweeten payasam, pongal, chikki and laddu.", "Stir a little into tea, coffee or panakam.",
               JAGGERY_TIP]),
    dict(code="TBEL", slug="palm-jaggery", section="jaggery", crumb="Jaggery",
         name="Palm Jaggery", local="Thati Bellam", te="తాటి బెల్లం", hi="ताड़ का गुड़", hi_tr="Taad Gud",
         note="Village desi · palmyra sap", origin="From the Godavari delta",
         pack="palm-jaggery-540g.jpg", by="packed", shelf=9, ingredients="Palmyra palm jaggery.",
         g=540, mrp=495, category="Sweeteners > Jaggery",
         title="Palm Jaggery (Thati Bellam) 540 g from the Godavari delta | 1acrefarms",
         desc="Thati bellam (taad gud): palm jaggery from the Godavari delta, made from palmyra sap, 540 g. "
              "MRP ₹495 incl. of all taxes. Free delivery on 2+ packs.",
         lede="Thati bellam: palm jaggery from the Godavari delta, made from palmyra sap. Packed in Narasaraopet.",
         te_line="గోదావరి డెల్టా నుంచి తాటి బెల్లం, తాటి నీరాతో చేసినది. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="गोदावरी डेल्टा से ताड़ का गुड़, ताड़ के रस से बना। नरसरावपेट में पैक।",
         uses=["Make palm jaggery coffee or tea.", "Sweeten payasam, paramannam and sunnundalu.", JAGGERY_TIP]),
    dict(code="CASH", slug="cashew-kernels", section="nuts", crumb="Nuts",
         live_from=dt.date(2026, 10, 31),
         name="Cashew Kernels", local="Jeedipappu", te="జీడిపప్పు", hi="काजू", hi_tr="Kaju",
         note="Whole kernels · plain · unsalted", origin="Chirala · Bapatla · Vizag coast",
         pack="cashew-540g.jpg", by="packed", shelf=6, ingredients="Cashew kernels (Anacardium occidentale).",
         allergen="Contains cashew (tree nut).", g=540, mrp=891, category="Nuts > Cashew",
         title="Cashew Kernels (Jeedipappu) 540 g, whole and unsalted | 1acrefarms",
         desc="Jeedipappu (kaju): whole, plain, unsalted cashew kernels from the Chirala, Bapatla and Vizag "
              "coast, 540 g. MRP ₹891 incl. of all taxes. Free delivery on 2+ packs.",
         lede="Jeedipappu: whole, plain, unsalted cashew kernels from the Chirala, Bapatla and Vizag coast, "
              "packed in Narasaraopet.",
         te_line="చీరాల, బాపట్ల, విశాఖ తీరం నుంచి జీడిపప్పు. పూర్తి పప్పులు, ఉప్పు లేకుండా.",
         hi_line="चीराला, बापटला और विशाखापत्तनम तट से काजू। साबुत, सादे, बिना नमक।",
         uses=["Eat as they are, or toast lightly in a dry pan.", "Add to payasam, pulao, upma and sweets.",
               "Keep the zip shut after use."]),
]


def is_live(p):
    return not p.get("live_from") or TODAY >= p["live_from"]


def pack_facts():
    src = (ROOT / "app.js").read_text(encoding="utf-8")
    m = re.search(r"^const PACK_FACTS = (\{.*\});\s*$", src, re.M)
    if not m:
        sys.exit("PACK_FACTS not found in app.js")
    return json.loads(m.group(1))


def check_mrps(packs):
    """Stop if an MRP here differs from app.js, so a price change can't leave pages stale."""
    src = (ROOT / "app.js").read_text(encoding="utf-8")
    for p in packs:
        m = re.search(r'code: "%s".*?skus: \[(.*?)\] \}' % p["code"], src, re.S)
        live = re.search(r"\[(\d+), (\d+), true\]", m.group(1)) if m else None
        if not live or (int(live.group(1)), int(live.group(2))) != (p["g"], p["mrp"]):
            sys.exit(f"MRP/size for {p['code']} does not match app.js live sku: {live and live.groups()}")


def text_of(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s))


def wa_link(p):
    msg = f"Hi 1acrefarms! I'd like to order {p['name']} ({p['local']}) {p['g']} g."
    return f"https://wa.me/{WA}?text={quote(msg)}"


def nutrition(p, facts):
    f = facts.get(p["code"])
    if not f:
        return ""
    rows = []
    for label, per100, per_serve, rda in f["rows"]:
        sub = ' class="sub"' if re.match(r"^(Total sugars|Added sugars|Saturated fat|Trans fat)$", label) else ""
        rows.append(f'<tr{sub}><th scope="row">{label}</th><td>{per100}</td><td>{per_serve}</td><td>{rda}</td></tr>')
    servings = round(p["g"] / f["serve"])
    return f"""<div class="nutri">
          <p class="nutri-serve">Serving size {f['serve']} g ({f['hh']}) · Servings per pack: {servings}</p>
          <table>
            <thead><tr><th scope="col"><span class="vh">Nutrient</span></th><th scope="col">per 100 g</th><th scope="col">per serve</th><th scope="col">%RDA</th></tr></thead>
            <tbody>{''.join(rows)}</tbody>
          </table>
          <p class="nutri-note">%RDA = share of the Recommended Dietary Allowance per serve, on a 2000 kcal adult diet. {f['src']}</p>
        </div>"""


def product_ld(p, facts):
    url = f"{SITE}/{p['slug']}/"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Product",
                "@id": url + "#product",
                "name": f"{p['name']} ({p['local']}) {p['g']} g",
                "alternateName": [p["local"], p["te"], p["hi"], p["hi_tr"]],
                "description": text_of(p["lede"]),
                "image": [f"{SITE}/assets/packs/{p['pack']}"],
                "sku": f"1AF-{p['code']}-{p['g']:04d}",
                "brand": {"@type": "Brand", "name": "1acrefarms"},
                "category": p["category"],
                "countryOfOrigin": {"@type": "Country", "name": "India"},
                "weight": {"@type": "QuantitativeValue", "value": p["g"], "unitCode": "GRM"},
                "offers": {
                    "@type": "Offer",
                    "url": url,
                    "priceCurrency": "INR",
                    "price": str(p["mrp"]),
                    "availability": "https://schema.org/InStock",
                    "itemCondition": "https://schema.org/NewCondition",
                    "seller": {"@type": "Organization", "@id": f"{SITE}/#business", "name": "1acrefarms"},
                    "shippingDetails": {
                        "@type": "OfferShippingDetails",
                        "shippingRate": {"@type": "MonetaryAmount", "value": "81", "currency": "INR"},
                        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "IN"},
                        "deliveryTime": {
                            "@type": "ShippingDeliveryTime",
                            "handlingTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 2, "unitCode": "DAY"},
                            "transitTime": {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 7, "unitCode": "DAY"},
                        },
                    },
                },
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": p["crumb"], "item": f"{SITE}/#{p['section']}"},
                    {"@type": "ListItem", "position": 3, "name": p["name"], "item": url},
                ],
            },
        ],
    }
    return json.dumps(ld, ensure_ascii=False, indent=2)


HEADER = """  <header class="header" id="top">
    <nav class="nav container">
      <a href="/" class="brand" aria-label="1acrefarms home">
        <svg class="logo-mark" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="24" cy="24" r="20.4" stroke="currentColor" stroke-width="1.9"/>
          <path d="M19 34 H29" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M24 34 V19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M24 20C19.741 19.592 16.842 16.137 17.251 11.957C21.438 12.281 24.337 15.735 24 20Z" fill="currentColor"/>
          <path d="M24 18.5C23.663 14.235 26.562 10.78 30.749 10.457C31.158 14.637 28.259 18.092 24 18.5Z" fill="currentColor"/>
        </svg>
        <span class="brand-text">
          <span class="brand-name"><span class="one">1</span>acrefarms<span class="tm">™</span></span>
          <span class="brand-est">Bharat</span>
        </span>
      </a>
      <ul class="nav-links">
        <li><a href="/#spices">Our Packs</a></li>
        <li><a href="/#story">Our Story</a></li>
      </ul>
      <a class="btn btn-green nav-shop" href="/#spices">Shop all packs</a>
    </nav>
  </header>"""


def footer(live):
    links = "\n".join(f'        <a href="/{q["slug"]}/">{q["name"]}</a>' for q in live)
    return f"""  <footer class="footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="brand-name"><span class="one">1</span>acrefarms<span class="tm">™</span></span>
        <p>Let the soil breathe again. Village desi turmeric and jaggery from Andhra Pradesh, packed in Narasaraopet.</p>
      </div>
      <div class="footer-col">
        <h4>Shop</h4>
{links}
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <a href="https://wa.me/{WA}" target="_blank" rel="noopener">WhatsApp us</a>
        <a href="mailto:1acrefarmsindia@gmail.com">Email us</a>
        <a href="/#story">Our story</a>
      </div>
      <div class="footer-col">
        <h4>Policies</h4>
        <a href="/policies.html#shipping">Shipping &amp; delivery</a>
        <a href="/policies.html#returns">Returns &amp; refunds</a>
        <a href="/policies.html#privacy">Privacy</a>
        <a href="/policies.html#terms">Terms of sale</a>
      </div>
    </div>
    <p class="footer-base">© {TODAY.year} 1acrefarms &middot; GSTIN 37BHKPR3386Q1Z8 &middot; FSSAI Reg. 20126161000590 &middot; Made in India</p>
  </footer>"""


def page(p, live, facts):
    url = f"{SITE}/{p['slug']}/"
    img = f"/assets/packs/{p['pack']}"
    others = [q for q in live if q is not p]
    others_html = "\n".join(f"""        <a class="pdp-other" href="/{q['slug']}/">
          <img src="/assets/packs/{q['pack']}" alt="{q['name']} {q['g']} g pack" width="800" height="1122" loading="lazy" />
          <span class="po-name">{q['name']}</span>
          <span class="po-te"><span lang="te">{q['te']}</span> · {q['local']}</span>
          <span class="po-price">₹{q['mrp']} · {q['g']} g</span>
        </a>""" for q in others)
    uses = "\n".join(f"          <li>{u}</li>" for u in p["uses"])
    allergen = f"<dt>Allergen</dt><dd>{p['allergen']}</dd>" if p.get("allergen") else ""
    facts_row = facts.get(p["code"], {})
    storage = f"<dt>Storage</dt><dd>{facts_row['storage']}</dd>" if facts_row.get("storage") else ""
    per_g = f"₹{p['mrp'] / p['g']:.2f} per g"
    body = f"""<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{p['title']}</title>
  <meta name="description" content="{html.escape(p['desc'], quote=True)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="1acrefarms" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{p['name']} ({p['local']}) {p['g']} g · 1acrefarms" />
  <meta property="og:description" content="{html.escape(p['desc'], quote=True)}" />
  <meta property="og:image" content="{SITE}{img}" />
  <meta property="og:locale" content="en_IN" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
{product_ld(p, facts)}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,500;1,600&family=Noto+Sans+Telugu:wght@500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
</head>
<body class="pdp-page">
{HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/#{p['section']}">{p['crumb']}</a> <span aria-hidden="true">›</span> <span aria-current="page">{p['name']}</span></nav>

    <section class="pdp">
      <div class="pdp-media">
        <div class="pack-media"><img src="{img}" alt="{p['name']} ({p['local']}) {p['g']} g pack, front" width="800" height="1122" /></div>
      </div>
      <div class="pdp-info">
        <p class="eyebrow">{p['origin']}</p>
        <h1>{p['name']} <span class="pdp-local">({p['local']})</span></h1>
        <p class="pdp-names"><span lang="te">{p['te']}</span> · <span lang="hi">{p['hi']}</span> · {p['local']} · {p['hi_tr']}</p>
        <p class="pdp-lede">{p['lede']}</p>
        <div class="price-row">
          <span class="mrp"><small>MRP</small> ₹{p['mrp']}</span>
          <span class="upp">{p['g']} g · {per_g}</span>
        </div>
        <p class="tax">Incl. of all taxes · In stock · Dispatched within 2 working days</p>
        <div class="pdp-actions">
          <a class="btn btn-primary" href="/?add=pk-{p['code'].lower()}@{p['g']}#{p['section']}">Add to order</a>
          <a class="btn btn-wa" href="{wa_link(p)}" target="_blank" rel="noopener">Order on WhatsApp</a>
        </div>
        <ul class="pdp-facts">
          <li><span>From</span>{p['origin']}</li>
          <li><span>Pack</span>{p['note']}</li>
          <li><span>Delivery</span>Free on 2 or more packs · ₹81 for one pack</li>
          <li><span>Pay</span>UPI, or pay on delivery where available</li>
        </ul>
        <p class="pdp-lang" lang="te">{p['te_line']}</p>
        <p class="pdp-lang" lang="hi">{p['hi_line']}</p>
      </div>
    </section>

    <section class="pdp-more">
      <div>
        <h2>How to use</h2>
        <ul>
{uses}
        </ul>
      </div>
      <div>
        <h2>Pack details</h2>
        <dl class="pdp-dl">
          <dt>Ingredients</dt><dd>{p['ingredients']}</dd>
          {allergen}
          <dt>Net quantity</dt><dd>{p['g']} g · SKU 1AF-{p['code']}-{p['g']:04d}</dd>
          <dt>Best before</dt><dd>{p['shelf']} months from packing</dd>
          {storage}
          <dt>{MAKER[p['by']]}</dt><dd>{ADDRESS}</dd>
          <dt>FSSAI</dt><dd>Reg. 20126161000590</dd>
          <dt>Country of origin</dt><dd>India</dd>
          <dt>Customer care</dt><dd>WhatsApp +91 78999 29779 · 1acrefarmsindia@gmail.com</dd>
        </dl>
      </div>
      <div>
        <h2>Nutritional information</h2>
        {nutrition(p, facts)}
      </div>
    </section>

    <section class="pdp-ship">
      <h2>Delivery, payment and returns</h2>
      <p>Orders are packed and dispatched within 2 working days of confirmation, and usually arrive 2 to 7 days after dispatch. Delivery is free on 2 or more packs and ₹81 for a single pack, anywhere we deliver in India. Pay by UPI, or pay on delivery for orders up to ₹999 in South India and ₹599 elsewhere. If a pack arrives damaged or has a quality problem, we replace it or refund you in full. <a href="/policies.html#shipping">Read our policies</a>.</p>
    </section>

    <section class="pdp-others">
      <h2>Our other packs</h2>
      <div class="pdp-other-grid">
{others_html}
      </div>
    </section>
  </main>

{footer(live)}
</body>
</html>
"""
    for chunk in (p["title"], p["desc"], p["lede"], p["note"], " ".join(p["uses"])):
        if BANNED.search(text_of(chunk)):
            sys.exit(f"Banned claim word in {p['code']}: {BANNED.search(text_of(chunk)).group(0)!r}")
    return body


def sitemap(live):
    urls = [(f"{SITE}/", "weekly", "1.0")]
    urls += [(f"{SITE}/{p['slug']}/", "weekly", "0.9") for p in live]
    urls += [(f"{SITE}/policies.html", "monthly", "0.3")]
    rows = "\n".join(f"""  <url>
    <loc>{u}</loc>
    <lastmod>{TODAY.isoformat()}</lastmod>
    <changefreq>{f}</changefreq>
    <priority>{pr}</priority>
  </url>""" for u, f, pr in urls)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{rows}
</urlset>
"""


def pack_links_block(live):
    links = "\n".join(f'        <a href="/{p["slug"]}/">{p["name"]}</a>' for p in live)
    return f"<!-- PACK-LINKS:START (tools/build_pages.py) -->\n{links}\n        <!-- PACK-LINKS:END -->"


def main():
    facts = pack_facts()
    live = [p for p in PACKS if is_live(p)]
    check_mrps(live)
    for p in live:
        out = ROOT / p["slug"] / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(page(p, live, facts), encoding="utf-8")
        print("wrote", out.relative_to(ROOT))
    (ROOT / "sitemap.xml").write_text(sitemap(live), encoding="utf-8")
    print("wrote sitemap.xml with", len(live) + 2, "urls")
    idx = ROOT / "index.html"
    src = idx.read_text(encoding="utf-8")
    new, n = re.subn(r"<!-- PACK-LINKS:START.*?PACK-LINKS:END -->", pack_links_block(live), src, flags=re.S)
    if n != 1:
        sys.exit("PACK-LINKS block not found exactly once in index.html")
    idx.write_text(new, encoding="utf-8")
    print("refreshed PACK-LINKS in index.html:", ", ".join(p["slug"] for p in live))


if __name__ == "__main__":
    main()
