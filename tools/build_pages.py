#!/usr/bin/env python3
"""Build one static page per pack (/turmeric-powder/ etc.) and refresh sitemap.xml.

Why: the shop on index.html is drawn by app.js, so Google sees one page and ranks us only for
"1acrefarms". A crawlable page per pack, with its Telugu/Hindi names, origin, price and Product
structured data, lets people find us for "konda pasupu", "thati bellam", "palm jaggery" and so on.
Every Telugu name on the site has its Sanskrit name (sa) beside it, after the Hindi (Bhargava
05-11-2026: "wherever there is Telugu there should be Sanskrit"); the names were blind back-checked.

Facts come from app.js (names, origins, MRPs, shelf life, PACK_FACTS nutrition) and from the
approved social copy (Telugu/Hindi lines). Plain facts only: no claim words, no health claims.

Run from the repo root:  python3 tools/build_pages.py
Packs with live_from in the future are skipped until that date (IST), so re-running on or after
31 Oct 2026 adds the chilli and cashew pages by itself. Also rewrites the PACK-LINKS block in
index.html so the homepage links to every live page in plain HTML.

The same run also rebuilds the recipe pages (/recipes/ and /recipes/<slug>/) through
tools/build_recipes.py, and the buyer guides (/learn/ and /learn/<slug>/) through tools/build_guides.py.
Both reuse this file's header, footer and head links, and list their pages in sitemap.xml. So one
command regenerates the whole crawlable layer:  python3 tools/build_pages.py

Direct orders on this website: ONE switch, CHECKOUT_LIVE below (False = Amazon.in only, byte-identical to before).
The same run writes the checkout page /checkout/ (tools/build_checkout.py, hidden while the switch is off) and keeps
app.js, styles.css, index.html and policies.html in step with the switch. What can be ordered and at what price:
checkout-worker/src/catalogue.json. Switching on: python3 tools/switch_on.py (dry run first).
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
# Footer addresses (Bhargava 09-11-2026: "lets keep adding both places wherever possible"): the walk-in shop
# (Shop 7, as on Justdial) and the registered office, each labelled. Never the flat/door number here.
# ADDRESS above is the maker address printed on the pouch ("Pack details") and stays as printed.
# build_i18n.address_line() puts in the translated labels (ui.addr_*); the addresses stay in English.
SHOP_ADDRESS = ("Shop No. 7, Ground Floor, Ponnapati&rsquo;s Hi Street, Opp. NSP Office, Near PWD Colony, "
                "Narasaraopet, Andhra Pradesh 522601")
OFFICE_ADDRESS = "Srinivasa Nagar 1st Line, Narasaraopet, Andhra Pradesh 522601"
ADDR_LABELS = {"shop": "Shop (walk in)", "hours": "Mon-Sat 9 am-7 pm", "office": "Registered office"}


def footer_addr(lab=None, en=lambda s: s):
    """The footer's two addresses; lab: the labels (English by default), en: wraps each English address."""
    lab = lab or ADDR_LABELS
    return (f'    <p class="footer-addr"><b>{lab["shop"]}:</b> {en(SHOP_ADDRESS)} &middot; '
            f'<span class="addr-hours">{lab["hours"]}</span><br>'
            f'<b>{lab["office"]}:</b> {en(OFFICE_ADDRESS)}</p>\n')


FOOTER_ADDR = footer_addr()

# FSSAI. FSSAI_REG is the packing unit's registration, printed on every pouch beside the FSSAI logo (the logo file is
# a byte copy of print/fssai-logo-official.svg, the mark on the pouch; never the PLACEHOLDER png).
# FSSAI_ECOM_LIC is the FSSAI Central licence for our own e-commerce sales. It stays EMPTY until FoSCoS shows the
# licence GRANTED; then it holds the real 14-digit number only. Never a placeholder, "applied for" or a made-up number:
# while it is empty nothing about it renders anywhere. Once set, it renders one line after Pack details on every
# product page (English and the 22 languages) and a labelled entry in the footer base, kept apart from
# "FSSAI Reg. No. (packing unit)". index.html and policies.html are hand-written: add it there by hand (see the
# GRANT DAY comments in both); main() stops the build until both carry the number.
FSSAI_REG = "20126161000590"
FSSAI_ECOM_LIC = ""
FSSAI_ECOM_LIC_LABEL = "FSSAI Lic. No."  # final wording is set on grant day
# Owner's dated decision (Bhargava, 11-11-2026, typed to Shiva and confirmed to the SEO & Web session) to open direct
# orders BEFORE the Central licence is granted (filing 14-11). It only lets CHECKOUT_LIVE = True build without
# FSSAI_ECOM_LIC; pages keep showing "FSSAI Reg. No. 20126161000590" alone until the licence number is set. The Worker
# needs the same date in wrangler.toml [vars] PRE_GRANT_OWNER_GO. Empty it once the licence is granted and set.
PRE_GRANT_OWNER_GO = "2026-11-11"
if PRE_GRANT_OWNER_GO and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", PRE_GRANT_OWNER_GO):
    sys.exit(f"PRE_GRANT_OWNER_GO must be empty or YYYY-MM-DD, not {PRE_GRANT_OWNER_GO!r}")
if FSSAI_ECOM_LIC and not re.fullmatch(r"\d{14}", FSSAI_ECOM_LIC):
    sys.exit(f"FSSAI_ECOM_LIC must be empty or exactly 14 digits (the granted licence number), not {FSSAI_ECOM_LIC!r}")
FSSAI_LOGO = '<img class="fssai-logo" src="/assets/fssai-logo.svg" alt="FSSAI logo" width="41" height="20" />'
FSSAI_ROW = f"<dt>FSSAI</dt><dd>{FSSAI_LOGO} Reg. No. {FSSAI_REG}</dd>"


def ecom_lic_line():
    """The e-commerce licence line after Pack details; nothing at all until FSSAI_ECOM_LIC is set."""
    return f'\n        <p class="pdp-lic">{FSSAI_ECOM_LIC_LABEL} {FSSAI_ECOM_LIC}</p>' if FSSAI_ECOM_LIC else ""


# =====================================================================================================================
# DIRECT ORDERS ON THIS WEBSITE: ONE SWITCH.
#   CHECKOUT_LIVE = False  Amazon.in only, exactly as before: every page is byte-identical to the Amazon-only build.
#                          The checkout page /checkout/ is still written, but hidden (noindex, not in sitemap.xml,
#                          linked from nowhere), so it can be tried against the TEST Worker.
#   CHECKOUT_LIVE = True   ONLY on the day the FSSAI Central licence is granted (with the E-commerce kind of business),
#                          and ONLY through tools/switch_on.py, which checks every gate first and then flips this line.
#                          Each pack sold here (checkout-worker/src/catalogue.json "sellable") gets "Add to cart" and
#                          "Buy now" beside its Amazon.in button, "MRP / incl. of all taxes / Free delivery on orders
#                          placed with us" and the direct-order terms; every page header gets a cart link with the item
#                          count; the home cards (app.js) get Add to cart; policies.html says direct orders are open;
#                          /checkout/ becomes indexable and goes into sitemap.xml. Amazon.in stays on every page.
#   main() refuses True while both FSSAI_ECOM_LIC and PRE_GRANT_OWNER_GO are empty. Rollback = False, run this build, push (and in the Worker,
#   GATEWAY_ORDER = "none"): see docs/marketing/checkout-plan/switch-on-runbook.md.
CHECKOUT_LIVE = False

# What can be ordered here and at what price: ONE file, shared with the checkout Worker and the checkout page.
CATALOGUE_JSON = ROOT / "checkout-worker" / "src" / "catalogue.json"


def load_catalogue():
    """{code: row} from checkout-worker/src/catalogue.json; stops the build on a malformed row (the same rules as
    catalogueProblems() in checkout-worker/src/pricing.js)."""
    if not CATALOGUE_JSON.exists():
        sys.exit("checkout-worker/src/catalogue.json is missing")
    rows = json.loads(CATALOGUE_JSON.read_text(encoding="utf-8")).get("packs") or []
    bad, out = [], {}
    for r in rows:
        code = r.get("code", "")
        ok = (re.fullmatch(r"[A-Z]{4}", code) and code not in out and r.get("sku") == f"1AF-{code}-0540"
              and r.get("grams") == 540 and isinstance(r.get("mrp"), int) and not isinstance(r.get("mrp"), bool)
              and r["mrp"] > 0 and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", r.get("slug", ""))
              and str(r.get("name", "")).strip() and re.fullmatch(r"(\d{8})?", r.get("hsn", "x"))
              and re.fullmatch(r"[a-z0-9-]+\.jpg", r.get("image", "")) and isinstance(r.get("sellable"), bool))
        if not ok:
            bad.append(code or "?")
        out[code] = r
    if bad or not out:
        sys.exit(f"checkout-worker/src/catalogue.json: malformed pack row(s): {', '.join(bad) or 'no packs'}")
    return out


CATALOGUE = load_catalogue()


def direct(p):
    """True when this pack can be ordered on this website right now (the switch is on and the pack is sellable)."""
    return CHECKOUT_LIVE and CATALOGUE.get(p["code"], {}).get("sellable") is True


# The short delivery and returns terms, shared with the checkout page and the order e-mail: TERMS in
# checkout-worker/src/seller.js (one 'key: "text",' per line). Its figures = policies.html (checked by the Worker tests,
# and by main() while CHECKOUT_LIVE).
SELLER_JS = ROOT / "checkout-worker" / "src" / "seller.js"


def seller_terms():
    src = SELLER_JS.read_text(encoding="utf-8")
    m = re.search(r"^export const TERMS = Object\.freeze\(\{\n(.*?)\n\}\);", src, re.S | re.M)
    if not m:
        sys.exit("TERMS not found in checkout-worker/src/seller.js")
    out = {}
    for line in m.group(1).split("\n"):
        mm = re.fullmatch(r'\s+(\w+): ("(?:[^"\\]|\\.)*"),', line)
        if not mm:
            sys.exit(f"checkout-worker/src/seller.js TERMS: cannot read {line.strip()[:60]!r} (one 'key: \"text\",' per line)")
        out[mm.group(1)] = json.loads(mm.group(2))
    return out


# Direct-order labels. build_i18n shows them on the language pages as OPTIONAL keys ui.<key> (English, marked
# lang="en", until translated). Plain facts: no urgency, no discount, nothing pre-ticked.
DIRECT_LABELS = {"add_to_cart": "Add to cart", "buy_now": "Buy now",
                 "free_delivery": "Free delivery on orders placed with us", "cart": "Cart",
                 "cart_added": "Added to your cart", "cart_full": "Your cart already has the most we can send in one order"}
CHECKOUT_PATH = "/checkout/"


def checkout_href(lang=None, **params):
    """/checkout/ with ?lang= for a language page and ?add= / ?buy= for a pack (already escaped for an attribute)."""
    q = ([f"lang={lang}"] if lang and lang != "en" else []) + [f"{k}={v}" for k, v in params.items()]
    return CHECKOUT_PATH + ("?" + "&amp;".join(q) if q else "")


def direct_btns(p, lab=None, attrs=None, lang=None):
    """"Add to cart" and "Buy now", after the Amazon.in button, for a pack sold here. lab: label HTML per key (English by
    default); attrs: plain (escaped) text for data-added / data-full."""
    if not direct(p):
        return ""
    lab = lab or DIRECT_LABELS
    attrs = attrs or {k: html.escape(v, quote=True) for k, v in DIRECT_LABELS.items()}
    code = p["code"]
    return (f'\n          <a class="btn btn-green" href="{checkout_href(lang, add=code)}" rel="nofollow" data-cart-add="{code}" '
            f'data-added="{attrs["cart_added"]}" data-full="{attrs["cart_full"]}">{lab["add_to_cart"]}</a>'
            f'\n          <a class="btn btn-wa" href="{checkout_href(lang, buy=code)}" rel="nofollow">{lab["buy_now"]}</a>')


def free_line(p, label=None):
    """Under "Incl. of all taxes", for a pack sold here."""
    return f'\n        <p class="pdp-free">{label or DIRECT_LABELS["free_delivery"]}</p>' if direct(p) else ""


CART_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
             'stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 10.4a1.5 1.5 0 0 0 1.5 1.1h8.3a1.5 1.5 0 0 0 '
             '1.5-1.1L20.5 8H6"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>')


def cart_link(label=DIRECT_LABELS["cart"], href=CHECKOUT_PATH):
    """The header's cart link (count filled in by /checkout/cart.js from this browser's cart)."""
    return (f'<a class="cart-btn nav-cart" href="{href}">{CART_ICON}<span class="nav-cart-label">{label}</span>'
            f'<span class="cart-count" data-cart-count hidden></span></a><script type="module" src="/checkout/cart.js"></script>')


# Seller identity in every footer (CP (E-Commerce) Rules 2020 r.4(2), r.4(4)): the legal name, and the customer care and
# grievance officer with designation, phone and email. build_i18n.legal_lines() swaps in the translated labels (OPTIONAL
# keys ui.grievance, ui.care_officer, ui.proprietor, ui.call_wa, ui.legal_name); the name, phone, email, GSTIN and FSSAI
# numbers stay in English. In legal_name, ⟦#1⟧ is the owner's name and ⟦#2⟧ the brand (markers, so a translation can
# put them in its own word order). The address lines and their labels above are on hold: leave them as they are.
LEGAL_NAME = "Bhargava Reddy Medikonda"
# Non-breaking spaces: the number never wraps mid-number, and build_recipes.check_copy's PHONE guard (meant for recipe and
# guide body copy, "the footer's wa.me link is an href, not text") does not stop every recipe page over this footer line.
CARE_PHONE = "+91&nbsp;78999&nbsp;29779"
CARE_EMAIL = "1acrefarmsindia@gmail.com"
LEGAL_LABELS = {"grievance": "Grievance officer", "care_officer": "Customer care and grievance officer",
                "proprietor": "Proprietor", "call_wa": "call or WhatsApp",
                "legal_name": "⟦#1⟧, sole proprietor, trading as ⟦#2⟧"}


def grievance_link(label=LEGAL_LABELS["grievance"]):
    """First link of the footer's Policies column."""
    return f'        <a href="/policies.html#seller">{label}</a>\n'


def footer_care(lab=None, en=lambda s: s):
    """The footer's customer care and grievance officer line; lab: the labels, en: wraps each English value."""
    lab = lab or LEGAL_LABELS
    return (f'    <p class="footer-legal"><b>{lab["care_officer"]}:</b> {en(LEGAL_NAME)}, {lab["proprietor"]} &middot; '
            f'<a href="tel:+917899929779">{en(CARE_PHONE)}</a> ({lab["call_wa"]}) &middot; '
            f'<a href="mailto:{CARE_EMAIL}">{en(CARE_EMAIL)}</a></p>\n')


def legal_name_en():
    return LEGAL_LABELS["legal_name"].replace("⟦#1⟧", LEGAL_NAME).replace("⟦#2⟧", "1acrefarms")


def footer_base(legal=None):
    """The footer's last line; legal: the legal name, already rendered (English by default)."""
    fssai = (f"FSSAI Reg. No. (packing unit) {FSSAI_REG} &middot; {FSSAI_ECOM_LIC_LABEL} {FSSAI_ECOM_LIC}"
             if FSSAI_ECOM_LIC else f"FSSAI Reg. No. {FSSAI_REG}")
    return (f'    <p class="footer-base">© {TODAY.year} {legal or legal_name_en()} &middot; 1acrefarms.co.in &middot; '
            f'GSTIN 37BHKPR3386Q1Z8 &middot; {fssai} &middot; Made in India</p>\n')


GRIEVANCE_LINK = grievance_link()
FOOTER_CARE = footer_care()

# A pack that cannot be ordered online yet (not buyable on Amazon.in; the website takes no orders yet): say so plainly.
# build_i18n shows NOT_ONLINE on the language pages as the OPTIONAL key ui.not_online. The language pages have no
# "Orders, delivery and returns" section, so the two SHIP_ lines are English-page only.
NOT_ONLINE = "Not available to order online yet."
SHIP_AMAZON = ("Our packs are sold on Amazon.in. Delivery, payment and returns for those orders follow Amazon.in&rsquo;s "
               "terms, shown on each listing. For a question about the pack itself, see Customer care above.")
SHIP_NOT_ONLINE = ("This pack is not available to order online yet. Some of our other packs are sold on Amazon.in; delivery, "
                   "payment and returns for those orders follow Amazon.in&rsquo;s terms, shown on each listing. "
                   "For a question about this pack, see Customer care above.")
# While CHECKOUT_LIVE, the "Orders, delivery and returns" section of a pack page says, per pack, "Order here", "Order on
# Amazon.in" or both (from direct() and amazon_link()). The direct terms are seller.js TERMS (the checkout page and the
# order e-mail say the same), so their figures are policies.html's; main() checks that too.
SHIP_HERE_INTRO = ("You pay only the MRP printed on the pack, which includes GST; delivery is free anywhere in India. "
                   "Prepaid only: UPI, debit or credit card, net banking or wallet; no cash on delivery.")
SHIP_HERE_LINKS = ('Full terms: <a href="/policies.html#shipping">shipping and delivery</a>, '
                   '<a href="/policies.html#returns">cancellation, returns and refunds</a>.')
SHIP_AMAZON_TOO = ("This pack is also sold on Amazon.in. Delivery, payment and returns for orders placed there follow "
                   "Amazon.in&rsquo;s terms, shown on the listing.")
SHIP_AMAZON_ONLY = ("This pack can be ordered on Amazon.in only for now. Delivery, payment and returns for those orders follow "
                    "Amazon.in&rsquo;s terms, shown on the listing. For a question about the pack itself, see Customer care above.")
SHIP_NOT_ONLINE_LIVE = "This pack is not available to order online yet. For a question about this pack, see Customer care above."
SHIP_HEADS = {"here": "Order here", "amazon": "Order on Amazon.in"}


def ship_here():
    t = seller_terms()
    return " ".join([SHIP_HERE_INTRO, html.escape(t["delivery"], quote=False), html.escape(t["returns"], quote=False),
                     SHIP_HERE_LINKS])


def ship_html(p):
    """The inside of the "Orders, delivery and returns" section."""
    here, amz = direct(p), bool(amazon_link(p))
    if not CHECKOUT_LIVE:
        return f"      <p>{SHIP_AMAZON if amz else SHIP_NOT_ONLINE}</p>"
    parts = []
    if here:
        parts += [f"      <h3>{SHIP_HEADS['here']}</h3>", f"      <p>{ship_here()}</p>"]
    if amz:
        parts += [f"      <h3>{SHIP_HEADS['amazon']}</h3>", f"      <p>{SHIP_AMAZON_TOO if here else SHIP_AMAZON_ONLY}</p>"]
    if not parts:
        parts = [f"      <p>{SHIP_NOT_ONLINE_LIVE}</p>"]
    return "\n".join(parts)


BANNED = re.compile(r"\b(natural|pure|100%|no added|traditional|chemical[- ]free|organic|healthy|"
                    r"authentic|premium|fresh)\b", re.I)

TURMERIC_USES = [
    "A pinch in dal, sambar, rasam, curries and pulihora.",
    "Add it on a low flame so it does not burn.",
    "Use a dry spoon and keep the zip shut after use.",
]
JAGGERY_TIP = "If it sets hard, grate it."

PACKS = [
    dict(code="TURM", seo_en="Turmeric Powder (Pasupu, Haldi) 540 g", slug="turmeric-powder", section="spices", crumb="Turmeric",
         name="Turmeric Powder", local="Pasupu", te="పసుపు", hi="हल्दी", sa="हरिद्राचूर्णम्", hi_tr="Haldi",
         note="Farm-sourced · sun-dried · stone-ground", origin="Grown in Palnadu &amp; Guntur",
         pack="turmeric-540g.jpg", by="mfd", shelf=9, use_by=12, ingredients="Turmeric (Curcuma longa).",
         g=540, mrp=396, category="Spices > Turmeric powder",
         title="Turmeric Powder (Pasupu) 540 g from Palnadu &amp; Guntur | 1acrefarms",
         desc="Pasupu (haldi) from Palnadu and Guntur, sun-dried and stone-ground, in a 540 g pack. "
              "MRP ₹396 incl. of all taxes.",
         lede="Turmeric powder from Palnadu and Guntur. Sun-dried, stone-ground and packed in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరు పసుపు. ఎండలో ఆరబెట్టి, రాతి తిరగలిలో పట్టిన పొడి. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="पलनाडु और गुंटूर की हल्दी, धूप में सुखाकर पत्थर की चक्की में पिसी। नरसरावपेट में पैक।",
         uses=TURMERIC_USES),
    dict(code="KPAS", seo_en="Hill Turmeric Powder (Konda Pasupu)", slug="hill-turmeric-powder", section="spices", crumb="Turmeric",
         name="Hill Turmeric Powder", local="Konda Pasupu", te="కొండ పసుపు", hi="पहाड़ी हल्दी", sa="गिरिहरिद्राचूर्णम्", hi_tr="Pahadi Haldi",
         note="Whole hill turmeric fingers, packed as fine powder", origin="Araku &amp; Maredumilli hills",
         pack="hill-turmeric-540g.jpg", by="mfd", shelf=9, use_by=12, ingredients="Turmeric (Curcuma longa).",
         g=540, mrp=495, category="Spices > Turmeric powder",
         title="Hill Turmeric Powder (Konda Pasupu) 540 g from Araku | 1acrefarms",
         desc="Konda pasupu: hill turmeric from the Araku and Maredumilli hills, packed as fine powder in a "
              "540 g pack. MRP ₹495 incl. of all taxes.",
         lede="Konda pasupu: hill turmeric from the Araku and Maredumilli hills. Whole hill turmeric fingers, "
              "packed as fine powder in Narasaraopet.",
         te_line="అరకు, మారేడుమిల్లి కొండల నుంచి కొండ పసుపు. కొండ పసుపు కొమ్ములను నరసరావుపేటలో మెత్తని పొడిగా ప్యాక్ చేస్తాం.",
         hi_line="अरकू और मारेडुमिल्ली की पहाड़ियों से पहाड़ी हल्दी। साबुत पहाड़ी हल्दी, नरसरावपेट में बारीक पाउडर के रूप में पैक।",
         uses=["Use it wherever you use turmeric: dal, sambar, curries and pulihora."] + TURMERIC_USES[1:]),
    dict(code="SANN", seo_en="Sannam Chilli Powder 540 g", slug="sannam-chilli-powder", section="spices", crumb="Chilli",
         live_from=dt.date(2026, 10, 31),
         name="Sannam Chilli Powder", local="Sannam Kaaram", te="సన్నం కారం", hi="सन्नम मिर्च पाउडर", sa="सन्नम-रक्तमरिचचूर्णम्", hi_tr="Lal Mirch",
         note="Whole sun-dried chillies, packed as fine powder", origin="Grown in Palnadu &amp; Guntur",
         pack="sannam-540g.jpg", by="mfd", shelf=9, use_by=12, ingredients="Sannam red chillies (Capsicum annuum).",
         g=540, mrp=495, category="Spices > Chilli powder",
         title="Sannam Chilli Powder (Sannam Kaaram) 540 g | 1acrefarms",
         desc="Sannam kaaram: red chilli powder from whole sun-dried Sannam chillies grown in Palnadu, 540 g. "
              "MRP ₹495 incl. of all taxes.",
         lede="Sannam kaaram: whole sun-dried Sannam chillies, grown in Palnadu and Guntur and packed as fine "
              "powder in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరులో పండిన సన్నం మిరపకాయలు. ఎండబెట్టిన మిరపకాయలను మెత్తని కారంగా ప్యాక్ చేస్తాం.",
         hi_line="पलनाडु और गुंटूर में उगी सन्नम मिर्च। धूप में सूखी साबुत मिर्च, बारीक पाउडर के रूप में पैक।",
         uses=["Use in curries, chutneys, podis and pickles.", "Add it to hot oil on a low flame.",
               "Use a dry spoon and keep the zip shut after use."]),
    dict(code="TEJA", seo_en="Teja Chilli Powder (Extra Hot) 540 g", slug="teja-chilli-powder", section="spices", crumb="Chilli",
         live_from=dt.date(2026, 10, 31),
         name="Teja Chilli Powder", local="Teja Kaaram", te="తేజ కారం", hi="तेजा मिर्च पाउडर", sa="तेजा-रक्तमरिचचूर्णम्", hi_tr="Lal Mirch",
         note="Extra hot · sun-dried · stone-ground", origin="Grown in Palnadu &amp; Guntur",
         pack="teja-540g.jpg", by="mfd", shelf=9, use_by=12, ingredients="Teja red chillies (Capsicum annuum).",
         g=540, mrp=495, category="Spices > Chilli powder",
         title="Teja Chilli Powder (Teja Kaaram) 540 g, extra hot | 1acrefarms",
         desc="Teja kaaram: extra hot red chilli powder, sun-dried and stone-ground, 540 g. MRP ₹495 incl. of "
              "all taxes.",
         lede="Teja kaaram: extra hot Teja chillies grown in Palnadu and Guntur, sun-dried and stone-ground, "
              "packed in Narasaraopet.",
         te_line="పల్నాడు, గుంటూరులో పండిన తేజ మిరపకాయల కారం. చాలా కారంగా ఉంటుంది. ఎండబెట్టి, రాతి తిరగలిలో పట్టినది.",
         hi_line="पलनाडु और गुंटूर की तेजा मिर्च का पाउडर। बहुत तीखा। धूप में सुखाकर पत्थर की चक्की में पिसा।",
         uses=["A little goes a long way: start with less than you would of milder chilli powder.",
               "Use in curries, chutneys, podis and pickles.", "Use a dry spoon and keep the zip shut after use."]),
    dict(code="CBEL", seo_en="Cheruku Bellam (Cane Jaggery) 540 g", slug="cane-jaggery", section="jaggery", crumb="Jaggery",
         name="Cane Jaggery", local="Cheruku Bellam", te="చెరుకు బెల్లం", hi="गन्ने का गुड़", sa="इक्षुगुडः", hi_tr="Gud",
         note="Village desi · dark · slow-boiled", origin="Chittoor &amp; Anakapalli cane belts",
         pack="cane-jaggery-540g.jpg", by="packed", shelf=9, use_by=12, ingredients="Sugarcane jaggery.",
         g=540, mrp=234, category="Sweeteners > Jaggery",
         title="Cane Jaggery (Cheruku Bellam) 540 g from Anakapalli &amp; Chittoor | 1acrefarms",
         desc="Cheruku bellam (gud): dark, slow-boiled cane jaggery from the Chittoor and Anakapalli cane belts, "
              "540 g. MRP ₹234 incl. of all taxes.",
         lede="Cheruku bellam: dark, slow-boiled village desi cane jaggery from the Chittoor and Anakapalli "
              "cane belts, packed in Narasaraopet.",
         te_line="చిత్తూరు, అనకాపల్లి నుంచి చెరుకు బెల్లం. ముదురు రంగు, నెమ్మదిగా మరిగించిన పల్లె బెల్లం. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="चित्तूर और अनकापल्ली का गन्ने का गुड़। गहरे रंग का, धीमी आँच पर पकाया गाँव का गुड़। नरसरावपेट में पैक।",
         uses=["Sweeten payasam, pongal, chikki and laddu.", "Stir a little into tea, coffee or panakam.",
               JAGGERY_TIP]),
    dict(code="TBEL", seo_en="Thati Bellam (Palm Jaggery) 540 g", slug="palm-jaggery", section="jaggery", crumb="Jaggery",
         name="Palm Jaggery", local="Thati Bellam", te="తాటి బెల్లం", hi="ताड़ का गुड़", sa="तालगुडः", hi_tr="Taad Gud",
         note="Village desi · palmyra sap", origin="From the Godavari delta",
         pack="palm-jaggery-540g.jpg", by="packed", shelf=9, use_by=12, ingredients="Palmyra palm jaggery.",
         g=540, mrp=495, category="Sweeteners > Jaggery",
         title="Palm Jaggery (Thati Bellam) 540 g from the Godavari delta | 1acrefarms",
         desc="Thati bellam (taad gud): palm jaggery from the Godavari delta, made from palmyra sap, 540 g. "
              "MRP ₹495 incl. of all taxes.",
         lede="Thati bellam: palm jaggery from the Godavari delta, made from palmyra sap. Packed in Narasaraopet.",
         te_line="గోదావరి డెల్టా నుంచి తాటి బెల్లం, తాటి నీరాతో చేసినది. నరసరావుపేటలో ప్యాక్ చేసినది.",
         hi_line="गोदावरी डेल्टा से ताड़ का गुड़, ताड़ के रस से बना। नरसरावपेट में पैक।",
         uses=["Make palm jaggery coffee or tea.", "Sweeten payasam, paramannam and sunnundalu.", JAGGERY_TIP]),
    dict(code="CASH", seo_en="Jeedipappu (Cashew Kernels) 540 g", slug="cashew-kernels", section="nuts", crumb="Nuts",
         live_from=dt.date(2026, 10, 31),
         name="Cashew Kernels", local="Jeedipappu", te="జీడిపప్పు", hi="काजू", sa="काजूतकम्", hi_tr="Kaju",
         note="Whole kernels · plain · unsalted", origin="Chirala · Bapatla · Vizag coast",
         pack="cashew-540g.jpg", by="packed", shelf=9, use_by=12, ingredients="Cashew kernels (Anacardium occidentale).",
         allergen="Contains cashew (tree nut).", g=540, mrp=891, category="Nuts > Cashew",
         title="Cashew Kernels (Jeedipappu) 540 g, whole and unsalted | 1acrefarms",
         desc="Jeedipappu (kaju): whole, plain, unsalted cashew kernels from the Chirala, Bapatla and Vizag "
              "coast, 540 g. MRP ₹891 incl. of all taxes.",
         lede="Jeedipappu: whole, plain, unsalted cashew kernels from the Chirala, Bapatla and Vizag coast, "
              "packed in Narasaraopet.",
         te_line="చీరాల, బాపట్ల, విశాఖ తీరం నుంచి జీడిపప్పు. పూర్తి పప్పులు, ఉప్పు లేకుండా.",
         hi_line="चीराला, बापटला और विशाखापत्तनम तट से काजू। साबुत, सादे, बिना नमक।",
         uses=["Eat as they are, or toast lightly in a dry pan.", "Add to payasam, pulao, upma and sweets.",
               "Keep the zip shut after use."]),
]


# Our Amazon.in listings (tools/amazon.json, refreshed by tools/amazon_check.py). A pack gets a
# "Buy on Amazon" button only while a shopper can actually buy it there.
AMAZON = json.loads((ROOT / "tools" / "amazon.json").read_text(encoding="utf-8"))
# Our Amazon Brand Store (live 05-11-2026). It lists our in-stock packs straight from the catalogue, so a
# newly stocked pack shows at once; the seller search page (s?me=) waits for Amazon's search index (TURM was
# missing there for hours on 06-11) and carries other brands' sponsored results.
AMAZON_STORE = AMAZON.get("store") or f"https://www.amazon.in/s?me={AMAZON['seller']}"


def amazon_link(p):
    row = AMAZON["packs"].get(p["code"], {})
    return f"https://www.amazon.in/dp/{row['asin']}" if row.get("buyable") else None


# 08-11-2026: no price on the site until the pack is buyable on Amazon.in (or, while CHECKOUT_LIVE, orderable here)
def shows_price(p):
    return bool(amazon_link(p)) or direct(p)


def amazon_btn(p, label, lang=""):
    """The first button on a pack page while the pack is buyable on Amazon; label is already escaped."""
    a = amazon_link(p)
    return f'\n          <a class="btn btn-primary" href="{a}" target="_blank" rel="noopener"{lang}>{label}</a>' if a else ""


def order_btn(p, buy_label="Buy on Amazon", store_label="Our Amazon store", lang=""):
    """The one order button on a pack page (Amazon.in only, until the FSSAI central licence): the listing while
    the pack is buyable there, otherwise our Amazon store. Labels are already escaped."""
    if amazon_link(p):
        return amazon_btn(p, buy_label, lang)
    return f'\n          <a class="btn btn-primary" href="{AMAZON_STORE}" target="_blank" rel="noopener"{lang}>{store_label}</a>'


def seo_title(p):
    """The English pack page's <title> and og:title: Telugu, then Sanskrit, then English (Bhargava 05-11-2026:
    "wherever there is Telugu there should be Sanskrit"; titles past 64 characters accepted on 06-11).
    English pages only: the language pages keep their translated pack.<CODE>.title (p['title'])."""
    return f"{p['te']} · {p['sa']} · {p['seo_en']} | 1acrefarms"


def page_desc(p):
    """Meta description: plain facts, plus where to order only while the pack is buyable on Amazon.in."""
    desc = p["desc"] if shows_price(p) else re.sub(r"\s*MRP ₹[\d,]+ incl\. of all taxes\.", "", p["desc"])
    where = (" Order on 1acrefarms.co.in or Amazon.in." if amazon_link(p) else " Order on 1acrefarms.co.in.") if direct(p) \
        else (" Order on Amazon.in." if amazon_link(p) else "")
    return desc + where


def is_live(p):
    return not p.get("live_from") or TODAY >= p["live_from"]


def pack_facts():
    src = (ROOT / "app.js").read_text(encoding="utf-8")
    m = re.search(r"^const PACK_FACTS = (\{.*\});\s*$", src, re.M)
    if not m:
        sys.exit("PACK_FACTS not found in app.js")
    return json.loads(m.group(1))


def check_catalogue():
    """Stop if checkout-worker/src/catalogue.json (what the checkout sells, at what price) differs from the pack pages."""
    by_code = {p["code"]: p for p in PACKS}
    for code, r in CATALOGUE.items():
        p = by_code.get(code)
        if not p:
            sys.exit(f"catalogue.json has {code}, which has no pack in tools/build_pages.py PACKS")
        want = {"mrp": p["mrp"], "grams": p["g"], "slug": p["slug"], "image": p["pack"], "name": p["name"]}
        got = {k: r.get(k) for k in want}
        if got != want:
            sys.exit(f"catalogue.json {code} = {got}, but the pack page has {want}")
    missing = [c for c in by_code if c not in CATALOGUE]
    if missing:
        sys.exit(f"catalogue.json has no row for {', '.join(missing)}")


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


VIDEOS_JSON = ROOT / "assets" / "video" / "videos.json"  # {name: {"secs", "date"}}, from docs/marketing/video/make_videos.py --web
VIDEOS = json.loads(VIDEOS_JSON.read_text(encoding="utf-8")) if VIDEOS_JSON.exists() else {}


def video_html(name, cls):
    """A muted, click-to-play video with its poster frame; no text, so language pages need no new strings."""
    if name not in VIDEOS:
        return ""
    return (f'<video class="{cls}" src="/assets/video/{name}.mp4" poster="/assets/video/{name}.jpg" '
            f'width="960" height="540" controls muted playsinline preload="none"></video>' + youtube_link(name))


def video_ld(name, title, desc):
    """schema.org VideoObject (title and description reuse strings the page already has)."""
    v = VIDEOS[name]
    return {"@type": "VideoObject", "name": title, "description": desc,
            "thumbnailUrl": [f"{SITE}/assets/video/{name}.jpg"], "contentUrl": f"{SITE}/assets/video/{name}.mp4",
            "uploadDate": v["date"] + ("T00:00:00+05:30" if len(v["date"]) == 10 else ""), "duration": f"PT{round(v['secs'])}S"}


# More videos on a pack page, shown right after its pack video. Real footage only, no text on the page, and the
# VideoObject reuses strings the page already has (name + pack note), so the language pages need nothing new.
# jaggery-unit: Bhargav's own footage of the cane jaggery unit we buy from, filmed 05-10-2026
# (docs/marketing/video/make_unit_video.py); he OK'd posting it everywhere on 05-11-2026.
PACK_EXTRA_VIDEOS = {"cane-jaggery": ["jaggery-unit"]}


def pack_video_names(p):
    return [n for n in [f"pack-{p['slug']}", *PACK_EXTRA_VIDEOS.get(p["slug"], ())] if n in VIDEOS]


def pack_videos_html(p):
    return "\n        ".join(video_html(n, "pack-video") for n in pack_video_names(p))


def pack_videos_ld(p):
    """One VideoObject per video on the pack page; a single one stays a plain object, as before."""
    lds = [video_ld(n, f"{p['name']} ({p['local']}) {p['g']} g", text_of(p["lede"])) if n == f"pack-{p['slug']}"
           else video_ld(n, f"{p['name']} ({p['local']})", text_of(p["note"])) for n in pack_video_names(p)]
    return {"subjectOf": lds[0] if len(lds) == 1 else lds} if lds else {}


def product_ld(p, facts):
    url = f"{SITE}/{p['slug']}/"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Product",
                "@id": url + "#product",
                "name": f"{p['name']} ({p['local']}) {p['g']} g",
                "alternateName": [p["local"], p["te"], p["hi"], p["sa"], p["hi_tr"]],
                "description": text_of(p["lede"]),
                "image": [f"{SITE}/assets/packs/{p['pack']}"],
                **pack_videos_ld(p),
                "sku": f"1AF-{p['code']}-{p['g']:04d}",
                "brand": {"@type": "Brand", "name": "1acrefarms"},
                "category": p["category"],
                "countryOfOrigin": {"@type": "Country", "name": "India"},
                "weight": {"@type": "QuantitativeValue", "value": p["g"], "unitCode": "GRM"},
                # Product-snippet markup, not merchant-listing markup: the website itself does not sell
                # (Amazon.in only since 06-11-2026), so no shipping or return policy here. The Offer is the
                # Amazon.in one, shown only while the pack is buyable there; Amazon sells at the MRP (checked
                # 05-11-2026: 495 / 234 / 495), which is the price this page shows.
                **({"offers": {
                    "@type": "Offer",
                    "url": amazon_link(p),
                    "priceCurrency": "INR",
                    "price": str(p["mrp"]),
                    "availability": "https://schema.org/InStock",
                    "itemCondition": "https://schema.org/NewCondition",
                    "seller": {"@type": "Organization", "@id": f"{SITE}/#business", "name": "1acrefarms"},
                }} if amazon_link(p) else {}),
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": p["name"], "item": url},
                ],
            },
        ],
    }
    return json.dumps(ld, ensure_ascii=False, indent=2)


HEADER_AMAZON_ONLY = """  <header class="header" id="top">
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
        <li class="nav-more"><a href="/recipes/">Recipes</a></li>
        <li class="nav-more"><a href="/learn/">Guides</a></li>
      </ul>
      <!--LANG-->
      <a class="btn btn-green nav-shop" href="/#spices">Shop all packs</a>
    </nav>
  </header>"""
# While CHECKOUT_LIVE every header gets the cart link right after the language menu (build_i18n localises it).
HEADER = HEADER_AMAZON_ONLY.replace("      <!--LANG-->\n", f"      <!--LANG-->\n      {cart_link()}\n", 1) \
    if CHECKOUT_LIVE else HEADER_AMAZON_ONLY


RECIPES_LINK = '        <a href="/recipes/">Recipes</a>'
GUIDES_LINK = '        <a href="/learn/">Guides</a>'
# Google review line in every footer (Bhargava 06-11-2026). Our Business Profile's own write-a-review link;
# fixed wording, no stars/reward. build_i18n swaps in the translation (ui.review) or drops the line.
REVIEW_URL = "https://g.page/r/CSwkMxt_n2McEAI/review"
REVIEW_LINE = '    <p class="footer-review"><a href="https://g.page/r/CSwkMxt_n2McEAI/review" target="_blank" rel="noopener">Bought our packs? Review us on Google</a></p>\n'
STORE_LINK = f'        <a href="{AMAZON_STORE}" target="_blank" rel="noopener">Our Amazon store</a>'


# Social icons for the shared footer (06-11-2026: site <-> YouTube/Instagram linked). translate="no" keeps the
# icon links out of the 22-language segment translation, so no language page needs new strings.
SOCIAL = """        <div class="footer-social" translate="no">
          <a href="https://www.instagram.com/1acrefarms/" aria-label="1acrefarms on Instagram" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" stroke="none"/></svg>
          </a>
          <a href="https://www.youtube.com/@1acrefarms" aria-label="1acrefarms on YouTube" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>
          </a>
          <a href="https://www.facebook.com/profile.php?id=61591924785096" aria-label="1acrefarms on Facebook" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/></svg>
          </a>
          <a href="https://www.linkedin.com/company/1acrefarms/" aria-label="1acrefarms on LinkedIn" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
          </a>
        </div>"""

# Our videos on YouTube (tools/youtube.json, {"videos": {name: {"video": url, "short": url}}}), written by the
# nightly YouTube routine. A page's video gets a small "▶ YouTube" link to the same video there.
# No aria-label on it: i18n_pages extracts every alt/aria-label inside <main> as a segment (translate="no" or not),
# which would make the language copies of that page stale. title= is not extracted.
YT_JSON = ROOT / "tools" / "youtube.json"
YT = json.loads(YT_JSON.read_text(encoding="utf-8")).get("videos", {}) if YT_JSON.exists() else {}


def youtube_link(name):
    v = YT.get(name, {})
    url = v.get("video") or v.get("short")
    return (f'\n<p class="yt-watch" translate="no"><a href="{url}" target="_blank" rel="noopener" '
            f'title="Watch on YouTube">&#9654; YouTube</a></p>') if url else ""


def footer(live):
    links = "\n".join([f'        <a href="/{q["slug"]}/">{q["name"]}</a>' for q in live] + [STORE_LINK, RECIPES_LINK, GUIDES_LINK])
    return f"""  <footer class="footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="brand-name"><span class="one">1</span>acrefarms<span class="tm">™</span></span>
        <p>Let the soil breathe again. Village desi turmeric, chilli, jaggery and cashew from Andhra Pradesh, packed in Narasaraopet.</p>
{SOCIAL}
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
{GRIEVANCE_LINK}        <a href="/policies.html#shipping">Shipping &amp; delivery</a>
        <a href="/policies.html#returns">Returns &amp; refunds</a>
        <a href="/policies.html#privacy">Privacy</a>
        <a href="/policies.html#terms">Terms of sale</a>
      </div>
    </div>
{REVIEW_LINE}{FOOTER_ADDR}{FOOTER_CARE}{footer_base()}  </footer>"""


HEAD_ASSETS = """  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,600&family=Noto+Sans+Telugu:wght@500;600&family=Noto+Sans+Devanagari:wght@500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />"""


def po_price(q):
    """The MRP line of an "other packs" tile, only while that pack is buyable on Amazon.in."""
    return f"\n          <span class=\"po-price\">MRP ₹{q['mrp']} · {q['g']} g</span>" if shows_price(q) else ""


def page(p, live, facts, guides=(), recipes=()):
    """guides: [(url, name)] of buyer guides about this pack (build_guides.links_by_pack())."""
    url = f"{SITE}/{p['slug']}/"
    img = f"/assets/packs/{p['pack']}"
    others = [q for q in live if q is not p]
    others_html = "\n".join(f"""        <a class="pdp-other" href="/{q['slug']}/">
          <img src="/assets/packs/{q['pack']}" alt="{q['name']} {q['g']} g pack" width="800" height="1122" loading="lazy" />
          <span class="po-name">{q['name']}</span>
          <span class="po-te"><span lang="te">{q['te']}</span> · <span lang="sa">{q['sa']}</span> · {q['local']}</span>{po_price(q)}
        </a>""" for q in others)
    uses = "\n".join(f"          <li>{u}</li>" for u in p["uses"])
    guide_links = "".join(f'\n        <p class="pdp-guide"><span>Guide</span><a href="{u}">{n}</a></p>' for u, n in guides)
    if recipes:
        label = "Recipe" if len(recipes) == 1 else "Recipes"
        guide_links += (f'\n        <p class="pdp-guide"><span>{label}</span>' +
                        " · ".join(f'<a href="{u}">{n}</a>' for u, n in recipes) + "</p>")
    allergen = f"<dt>Allergen</dt><dd>{p['allergen']}</dd>" if p.get("allergen") else ""
    facts_row = facts.get(p["code"], {})
    storage = f"<dt>Storage</dt><dd>{facts_row['storage']}</dd>" if facts_row.get("storage") else ""
    per_g = f"₹{p['mrp'] / p['g']:.2f} per g"
    price_block = f"""
        <div class="price-row">
          <span class="mrp"><small>MRP</small> ₹{p['mrp']}</span>
          <span class="upp">{p['g']} g · {per_g}</span>
        </div>
        <p class="tax">Incl. of all taxes</p>{free_line(p)}""" if shows_price(p) else ""
    status = "" if amazon_link(p) or direct(p) else f'\n        <p class="pdp-status">{NOT_ONLINE}</p>'
    body = f"""<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(seo_title(p), quote=False)}</title>
  <meta name="description" content="{html.escape(page_desc(p), quote=True)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="1acrefarms" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{html.escape(seo_title(p), quote=True)}" />
  <meta property="og:description" content="{html.escape(page_desc(p), quote=True)}" />
  <meta property="og:image" content="{SITE}{img}" />
  <meta property="og:locale" content="en_IN" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
{product_ld(p, facts)}
  </script>
{HEAD_ASSETS}
</head>
<body class="pdp-page">
{HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/#{p['section']}">{p['crumb']}</a> <span aria-hidden="true">›</span> <span aria-current="page">{p['name']}</span></nav>

    <section class="pdp">
      <div class="pdp-media">
        <div class="pack-media"><img src="{img}" alt="{p['name']} ({p['local']}) {p['g']} g pack, front" width="800" height="1122" /></div>
        {pack_videos_html(p)}
      </div>
      <div class="pdp-info">
        <p class="eyebrow">{p['origin']}</p>
        <h1>{p['name']} <span class="pdp-local">({p['local']})</span></h1>
        <p class="pdp-names"><span lang="te">{p['te']}</span> · <span lang="hi">{p['hi']}</span> · <span lang="sa">{p['sa']}</span> · {p['local']} · {p['hi_tr']}</p>
        <p class="pdp-lede">{p['lede']}</p>{price_block}{status}
        <div class="pdp-actions" id="order">{order_btn(p)}{direct_btns(p)}
        </div>
        <ul class="pdp-facts">
          <li><span>From</span>{p['origin']}</li>
          <li><span>Pack</span>{p['note']}</li>
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
        </ul>{guide_links}
      </div>
      <div>
        <h2>Pack details</h2>
        <dl class="pdp-dl">
          <dt>Ingredients</dt><dd>{p['ingredients']}</dd>
          {allergen}
          <dt>Net quantity</dt><dd>{p['g']} g · SKU 1AF-{p['code']}-{p['g']:04d}</dd>
          <dt>Best before</dt><dd>{p['shelf']} months from packing</dd>
          {f"<dt>Use by</dt><dd>{p['use_by']} months from packing</dd>" if p.get('use_by') else ""}
          {storage}
          <dt>{MAKER[p['by']]}</dt><dd>{ADDRESS}</dd>
          {FSSAI_ROW}
          <dt>Country of origin</dt><dd>India</dd>
          <dt>Customer care</dt><dd>WhatsApp +91 78999 29779 · 1acrefarmsindia@gmail.com</dd>
        </dl>{ecom_lic_line()}
      </div>
      <div>
        <h2>Nutritional information</h2>
        {nutrition(p, facts)}
      </div>
    </section>

    <section class="pdp-ship">
      <h2>Orders, delivery and returns</h2>
{ship_html(p)}
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
    for chunk in (p["title"], seo_title(p), page_desc(p), p["lede"], p["note"], " ".join(p["uses"]), ship_html(p)):
        if BANNED.search(text_of(chunk)):
            sys.exit(f"Banned claim word in {p['code']}: {BANNED.search(text_of(chunk)).group(0)!r}")
    return body


# Sitemap <lastmod>: a URL's date changes only when its page body changes (tools/lastmod.json: url -> {hash, date}).
# The hash skips what changes without the page changing: the footer year and the I18N head/menu/banner blocks
# (GA tag, hreflang links, language menu). The same file keeps each recipe's datePublished (first git commit).
LASTMOD_JSON = ROOT / "tools" / "lastmod.json"
LASTMOD = json.loads(LASTMOD_JSON.read_text(encoding="utf-8")) if LASTMOD_JSON.exists() else {}
LASTMOD.setdefault("urls", {})
LASTMOD.setdefault("recipe_published", {})


def save_lastmod():
    LASTMOD_JSON.write_text(json.dumps(LASTMOD, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def page_file(url):
    path = url[len(SITE):].lstrip("/")
    return ROOT / (path + "index.html" if path == "" or path.endswith("/") else path)


def body_hash(text):
    import hashlib
    text = re.sub(r"<!-- I18N:HEAD -->.*?<!-- /I18N:HEAD -->", "", text, flags=re.S)
    text = re.sub(r"<!-- I18N:BANNER -->.*?<!-- /I18N:BANNER -->", "", text, flags=re.S)
    text = re.sub(r"<!--LANG-->.*?<!--/LANG-->", "", text, flags=re.S)
    text = re.sub(r"©\s*\d{4}", "©", text)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def lastmod(url):
    """The day this URL's page body last changed (today for a new or changed page)."""
    f = page_file(url)
    if not f.exists():
        return TODAY.isoformat()
    h = body_hash(f.read_text(encoding="utf-8"))
    row = LASTMOD["urls"].get(url)
    if not row or row.get("hash") != h:
        row = LASTMOD["urls"][url] = {"hash": h, "date": TODAY.isoformat()}
    return row["date"]


def git_first_date(*args):
    """Date (YYYY-MM-DD) of the first commit matching `git log args`, or None."""
    import subprocess
    try:
        out = subprocess.run(["git", "log", "--reverse", "--format=%ad", "--date=short", *args], cwd=ROOT,
                             capture_output=True, text=True, timeout=30).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return None
    return out[0] if out else None


def sitemap(live, extra=()):
    """extra: (url, changefreq, priority) rows from other generators (the recipe and guide pages)."""
    urls = [(f"{SITE}/", "weekly", "1.0")]
    urls += [(f"{SITE}/{p['slug']}/", "weekly", "0.9") for p in live]
    urls += list(extra)
    urls += [(f"{SITE}/policies.html", "monthly", "0.3")]
    if CHECKOUT_LIVE:  # hidden (noindex, not listed) until direct orders are open
        urls += [(f"{SITE}{CHECKOUT_PATH}", "monthly", "0.3")]
    rows = "\n".join(f"""  <url>
    <loc>{u}</loc>
    <lastmod>{lastmod(u)}</lastmod>
    <changefreq>{f}</changefreq>
    <priority>{pr}</priority>
  </url>""" for u, f, pr in urls)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{rows}
</urlset>
"""


def pack_links_block(live):
    links = "\n".join([f'        <a href="/{p["slug"]}/">{p["name"]}</a>' for p in live] + [STORE_LINK, RECIPES_LINK, GUIDES_LINK])
    return f"<!-- PACK-LINKS:START (tools/build_pages.py) -->\n{links}\n        <!-- PACK-LINKS:END -->"


def main():
    # build_recipes imports this module for HEADER/footer(); register the running script under its
    # module name first so that import reuses it instead of loading a second copy.
    sys.modules.setdefault("build_pages", sys.modules[__name__])
    sys.dont_write_bytecode = True  # no tools/__pycache__ left in the repo
    import build_recipes
    import build_guides
    import build_i18n
    import build_checkout
    facts = pack_facts()
    live = [p for p in PACKS if is_live(p)]
    check_mrps(live)
    check_catalogue()
    if CHECKOUT_LIVE and not (FSSAI_ECOM_LIC or PRE_GRANT_OWNER_GO):
        sys.exit("CHECKOUT_LIVE = True needs the granted FSSAI Central licence in FSSAI_ECOM_LIC, or the owner's dated "
                 "PRE_GRANT_OWNER_GO decision (run tools/switch_on.py: it checks every gate)")
    for chunk in (NOT_ONLINE, SHIP_AMAZON, SHIP_NOT_ONLINE, FOOTER_CARE, footer_base(), *LEGAL_LABELS.values(),
                  *DIRECT_LABELS.values(), SHIP_HERE_INTRO, SHIP_AMAZON_TOO, SHIP_AMAZON_ONLY, SHIP_NOT_ONLINE_LIVE,
                  *SHIP_HEADS.values(), *seller_terms().values()):
        if BANNED.search(text_of(chunk)):
            sys.exit(f"Banned claim word in the footer/order lines: {BANNED.search(text_of(chunk)).group(0)!r}")
    if CHECKOUT_LIVE:  # the direct-order terms on the pack pages must carry policies.html's own figures
        pol = text_of((ROOT / "policies.html").read_text(encoding="utf-8"))
        for fig in sorted(set(re.findall(r"\d+–\d+ (?:working )?days", ship_here()))):
            if fig not in pol:
                sys.exit(f"Direct-order terms say {fig!r} but policies.html does not: fix checkout-worker/src/seller.js TERMS")
    if FSSAI_ECOM_LIC:  # grant day: the hand-written pages must carry the same number (see their GRANT DAY comments)
        stale = [f for f in ("index.html", "policies.html") if FSSAI_ECOM_LIC not in (ROOT / f).read_text(encoding="utf-8")]
        if stale:
            sys.exit(f"FSSAI_ECOM_LIC is set but not yet added by hand to {', '.join(stale)} (see the GRANT DAY comments)")
    build_checkout.hand_written()  # app.js, styles.css, index.html, policies.html follow CHECKOUT_LIVE (after every check that
    # can stop the build, so a stopped build never leaves them half switched)
    for p in live:
        out = ROOT / p["slug"] / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(page(p, live, facts, build_guides.links_by_pack().get(p["slug"], ()),
                            build_recipes.links_by_pack().get(p["slug"], ())), encoding="utf-8")
        print("wrote", out.relative_to(ROOT))
    idx = ROOT / "index.html"
    src = idx.read_text(encoding="utf-8")
    new, n = re.subn(r"<!-- PACK-LINKS:START.*?PACK-LINKS:END -->", pack_links_block(live), src, flags=re.S)
    if n != 1:
        sys.exit("PACK-LINKS block not found exactly once in index.html")
    idx.write_text(new, encoding="utf-8")
    js = ROOT / "app.js"
    amz = {p["code"]: AMAZON["packs"][p["code"]]["asin"] for p in live if amazon_link(p)}
    src, n = re.subn(r"^const AMAZON = .*$", lambda _: f"const AMAZON = {json.dumps(amz)};  // buyable on Amazon.in; written by tools/build_pages.py",
                     js.read_text(encoding="utf-8"), count=1, flags=re.M)
    if n != 1:
        sys.exit("const AMAZON line not found in app.js")
    js.write_text(src, encoding="utf-8")
    print("app.js AMAZON:", ", ".join(amz) or "none")
    print("refreshed PACK-LINKS in index.html:", ", ".join(p["slug"] for p in live))
    build_recipes.build(live)
    build_guides.build(live)
    build_i18n.build(live)  # adds the language menu + hreflang to every page above
    build_checkout.build(live)  # /checkout/: the page, its modules (lib/) and its strings (i18n/), hidden until live
    # sitemap last: each URL's lastmod comes from its finished page (see lastmod())
    extra = build_recipes.sitemap_rows() + build_guides.sitemap_rows() + build_i18n.sitemap_rows(live)
    (ROOT / "sitemap.xml").write_text(sitemap(live, extra), encoding="utf-8")
    save_lastmod()
    print("wrote sitemap.xml with", len(live) + 2 + len(extra) + (1 if CHECKOUT_LIVE else 0), "urls")


if __name__ == "__main__":
    main()
