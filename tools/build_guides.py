#!/usr/bin/env python3
"""Build the buyer guides: /learn/ (a list) and /learn/<slug>/ for each guide.

Why: people search "turmeric adulteration test at home" far more than they search for a brand. A
plain, useful answer page brings them to the site, and each guide links to the packs it is about.

Facts: every test and rule on a guide comes from a source listed on that guide ("sources"), checked
on 28-10-2026: FSSAI's Manual of Methods for testing common adulterants (2019), FSSAI's turmeric
standard (free from added colouring matter incl. lead chromate, and from foreign starch) and the
Stanford-led lead chromate studies. FSSAI's manual runs the iodine starch test only on spices OTHER
than turmeric, because turmeric is starchy itself; the guide says so instead of repeating the myth.

Copy: the recipe pages' claim filter (build_recipes.CLAIMS) runs over the whole page, plus RISKY
below: no "real/genuine/fake", no "safe/toxic/harm" talk, nothing said about our own turmeric
beyond the pack facts. Adulteration is described in general, never tied to any seller.

Run from the repo root:
  python3 tools/build_pages.py     # packs, sitemap, homepage links, recipes AND these guides
  python3 tools/build_guides.py    # only the guide pages
"""
import json
import re
import sys

sys.dont_write_bytecode = True  # no tools/__pycache__ left in the repo
import build_pages as bp  # noqa: E402
import build_recipes as br  # noqa: E402

ROOT = bp.ROOT
SITE = bp.SITE
e = br.e

RISKY = re.compile(r"\breal\b|\breally\b|genuine|\bfake|\bsafe\b|unsafe|toxic|poison|cancer|\bharm|danger|"
                   r"guarantee|certified|lab[- ]tested", re.I)

WATER_GLASS_SVG = """<svg class="gd-glasses" viewBox="0 0 340 236" role="img" aria-labelledby="gd-glass-title" xmlns="http://www.w3.org/2000/svg">
            <title id="gd-glass-title">Two glasses of water after the turmeric check. Left: pale yellow water with the powder settled at the bottom. Right: strong yellow water with yellow trails running down from the powder.</title>
            <defs>
              <clipPath id="gd-in-a"><path d="M33 28 H137 L127 186 Q127 192 121 192 H49 Q43 192 43 186 Z"/></clipPath>
              <clipPath id="gd-in-b"><path d="M203 28 H307 L297 186 Q297 192 291 192 H219 Q213 192 213 186 Z"/></clipPath>
            </defs>
            <g clip-path="url(#gd-in-a)">
              <rect x="30" y="52" width="110" height="142" fill="#f5e7b0"/>
              <path d="M30 170 Q55 163 85 168 T140 166 V196 H30 Z" fill="#c98a2c"/>
              <path d="M30 176 Q60 171 90 175 T140 174 V196 H30 Z" fill="#b5761f"/>
            </g>
            <g clip-path="url(#gd-in-b)">
              <rect x="200" y="52" width="110" height="142" fill="#f2c218"/>
              <path d="M232 52 C236 90 226 120 234 186" stroke="#e0a400" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>
              <path d="M258 52 C254 84 264 128 256 186" stroke="#e8ad00" stroke-width="4" fill="none" stroke-linecap="round" opacity=".75"/>
              <path d="M282 52 C286 96 276 136 281 186" stroke="#e0a400" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".7"/>
              <path d="M200 179 Q228 175 256 178 T310 177 V196 H200 Z" fill="#c98a2c"/>
            </g>
            <path d="M33 28 H137 L127 186 Q127 192 121 192 H49 Q43 192 43 186 Z" fill="none" stroke="#6c7060" stroke-width="1.6"/>
            <path d="M203 28 H307 L297 186 Q297 192 291 192 H219 Q213 192 213 186 Z" fill="none" stroke="#6c7060" stroke-width="1.6"/>
            <path d="M44 40 L52 172" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
            <path d="M214 40 L222 172" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".45"/>
            <text x="85" y="218" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#1f2419">Pale yellow</text>
            <text x="255" y="218" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#1f2419">Strong yellow</text>
          </svg>"""

# Fields
#   packs     the pack box (packs_label, packs_note) and the pack pages that link back to this guide
#   figure    svg (inline drawing) or packs (the pack photos, side by side), with label + caption
#   sections  [(id, heading, html)] in order; html is written here (trusted), text inside is checked
#   faq       [(question, answer)] plain text · sources [(label, url)]
GUIDES = [
    dict(
        slug="turmeric-adulteration-test",
        name="How to check turmeric powder at home",
        short="How to check turmeric powder at home",
        names='<span lang="te">పసుపు</span> · <span lang="hi">हल्दी</span> · <span lang="sa">हरिद्रा</span> · Pasupu · Haldi',
        eyebrow="Guide · turmeric",
        title="Turmeric Adulteration Test at Home (Haldi, Pasupu) | 1acrefarms",
        desc="How to check turmeric powder (haldi, pasupu) at home: the water check, what it misses, "
             "why the iodine test does not work on turmeric, and when you need a lab.",
        published="2026-10-28",
        tile_line="The water check, two tests to skip, and when you need a lab.",
        intro=[
            "FSSAI's standard says turmeric powder must be free from added colouring matter, including "
            "lead chromate, and from foreign starch. Its testing manual lists what inspectors check "
            "turmeric for: added dyes such as metanil yellow, lead salts, and chalk powder.",
            "Some of this you can check in your kitchen, and some only a lab can find. This guide covers "
            "both, plus two popular tests that do not work for turmeric. Try them on any turmeric you "
            "buy, ours included.",
        ],
        quick="Sprinkle a teaspoon of turmeric on a glass of water and let it settle without stirring. "
              "Turmeric sinks and leaves the water pale yellow; water that turns strong yellow straight "
              "away points to added colour. This check cannot find lead chromate or chalk, so for a sure "
              "answer, use a food testing lab. Skip the iodine test: turmeric is starchy to begin with.",
        te_line="ఒక గ్లాసు నీటిపై చెంచా పసుపు చల్లి, కలపకుండా అలాగే ఉంచండి. పసుపు అడుగుకు చేరి, నీళ్లు "
                "లేత పసుపు రంగులో ఉంటాయి. నీళ్లు వెంటనే ముదురు పసుపు రంగులోకి మారితే, రంగు కలిపి "
                "ఉండొచ్చు. లెడ్ క్రోమేట్, సుద్ద పొడిని ఈ పరీక్ష పట్టుకోలేదు; వాటికి ల్యాబ్ పరీక్ష కావాలి. "
                "పసుపులో ముందునుంచే పిండిపదార్థం ఉంటుంది కాబట్టి అయోడిన్ పరీక్ష పసుపుకు పనికిరాదు.",
        hi_line="एक गिलास पानी पर एक चम्मच हल्दी छिड़कें और बिना हिलाए छोड़ दें। हल्दी नीचे बैठ जाती है "
                "और पानी हल्का पीला रहता है। अगर पानी तुरंत गहरा पीला हो जाए, तो रंग मिलाया गया हो सकता "
                "है। लेड क्रोमेट और चॉक पाउडर इस जाँच में नहीं पकड़े जाते, उनके लिए लैब टेस्ट ज़रूरी है। "
                "हल्दी में पहले से स्टार्च होता है, इसलिए आयोडीन टेस्ट हल्दी पर काम नहीं करता।",
        figure=dict(
            svg=WATER_GLASS_SVG,
            label="The water check",
            caption="Left: the powder has settled and the water is pale yellow. Right: strong yellow "
                    "trails ran from the powder as it sank, and the water turned deep yellow. That one "
                    "is worth a lab test."),
        packs=["turmeric-powder", "hill-turmeric-powder"],
        packs_label="Our turmeric",
        packs_note='Try these checks on ours too. If anything looks off, <a href="{wa}" target="_blank" '
                   'rel="noopener">WhatsApp us</a> a photo with the batch number from the pack.',
        sections=[
            ("what", "What FSSAI checks turmeric for", """            <dl class="gd-dl">
              <dt>Added dyes</dt>
              <dd>Such as metanil yellow, which can make dull turmeric look brighter. FSSAI does not allow added colour in turmeric.</dd>
              <dt>Lead chromate and other lead salts</dt>
              <dd>Lead chromate is a yellow pigment used in paint. Stanford-led studies published in 2019 and 2024 found it in turmeric from parts of South Asia. FSSAI does not allow it in turmeric at all.</dd>
              <dt>Chalk powder</dt>
              <dd>A cheap white powder that adds weight.</dd>
              <dt>Foreign starch</dt>
              <dd>Flour or starch from other crops. FSSAI's standard rules it out too.</dd>
            </dl>"""),
            ("water-check", "Check 1: the water glass", """            <ol class="rcp-steps">
              <li id="step-1">Fill a clear glass with water at room temperature.</li>
              <li id="step-2">Sprinkle one level teaspoon of turmeric powder on top. Do not stir.</li>
              <li id="step-3">Watch the first minute as the powder sinks. Look for coloured trails running down from it.</li>
              <li id="step-4">Leave it for 15 to 20 minutes. Then hold the glass against a white wall or a sheet of paper and look at the water above the settled powder.</li>
            </ol>
            <div class="gd-results">
              <div class="gd-result">
                <p class="gd-result-head">Pale yellow water, powder at the bottom</p>
                <p>No sign of added dye.</p>
              </div>
              <div class="gd-result gd-result-warn">
                <p class="gd-result-head">Strong yellow trails, or deep yellow water within minutes</p>
                <p>Possible added colour. Stop using that batch and get it tested.</p>
              </div>
            </div>
            <p><strong>Why it works.</strong> Turmeric's own yellow, curcumin, hardly dissolves in water, so the powder sinks and only tints the water. Dyes such as metanil yellow dissolve easily and colour the water fast.</p>
            <p><strong>What it misses.</strong> Lead chromate and chalk do not dissolve in water either, so turmeric mixed with them can pass this check. Only a lab test can rule them out.</p>
            <p class="gd-note">Very fine powder can keep the water cloudy for a while. Cloudy is fine; a clear, strong yellow is what to look for.</p>"""),
            ("whole", "Check 2: if you buy whole turmeric", """            <p>Snap a finger of dried turmeric in half. Turmeric is yellow-orange right through, so the inside should look much like the outside. A bright yellow skin over a pale or dull core can mean colour was added to the surface. Ask the seller about it, or get it tested.</p>"""),
            ("skip", "Two tests to skip", """            <div class="gd-skip">
              <h3>The iodine test</h3>
              <p>Iodine turns blue-black when it meets starch, and it is often suggested for spotting flour in turmeric. But turmeric is starchy itself, so it turns blue-black either way. That is why FSSAI's own manual uses the iodine test for powdered spices other than turmeric.</p>
            </div>
            <div class="gd-skip">
              <h3>Acid tests at home</h3>
              <p>FSSAI's tests for lead, metanil yellow and chalk in turmeric use concentrated hydrochloric or sulphuric acid. These acids burn skin and eyes. They belong in a lab, not a kitchen.</p>
            </div>"""),
            ("lab", "For a sure answer: a food testing lab", """            <p>A NABL-accredited food testing lab can test turmeric for lead and for added colours. Ask the lab how much sample it needs, keep the powder in its sealed pack or a clean sealed bag, and note the batch number printed on the pack. FSSAI publishes a list of notified food testing labs on its website.</p>"""),
            ("pack", "Read the pack before you buy", """            <ul class="rcp-bullets">
              <li>An FSSAI licence or registration number. You can look it up on FSSAI's FoSCoS website.</li>
              <li>The name and address of whoever made or packed it.</li>
              <li>Net quantity, MRP, a batch or lot number, and a best-before date.</li>
              <li>Where it was grown. Turmeric from different regions differs in colour, so a named region helps you compare like with like.</li>
            </ul>"""),
            ("store", "Keep it well", """            <ul class="rcp-bullets">
              <li>Keep the pack zipped shut, or move the powder to a dry, airtight jar.</li>
              <li>Use a dry spoon. A damp spoon is what makes turmeric lumpy.</li>
              <li>Keep it out of direct sunlight, which fades the colour.</li>
              <li>Use it within the best-before date on the pack.</li>
            </ul>"""),
        ],
        faq=[
            ("Is very bright yellow turmeric a bad sign?",
             "Not by itself. Colour changes with the variety, where it was grown and how it was dried and "
             "ground, so turmerics differ a lot. What matters is colour that leaves the powder too easily, "
             "as in the water check."),
            ("Can the water check show that turmeric has no lead?",
             "No. Lead chromate does not dissolve in water, so the water check cannot see it. Only a lab "
             "test can."),
            ("Why does turmeric go lumpy?",
             "Moisture. A wet spoon or an open pack lets the powder take in water. Break the lumps with a "
             "dry spoon and keep the pack sealed."),
            ("What should I do if a check looks wrong?",
             "Stop using that batch, keep the pack, and contact the seller with the batch number. You can "
             "also report it to FSSAI through its Food Safety Connect app. If it is ours, WhatsApp us a "
             "photo of the pack and the glass."),
        ],
        sources=[
            ("Forsyth et al., lead chromate pigments added to turmeric in Bangladesh, Environmental Research (2019)",
             "https://doi.org/10.1016/j.envres.2019.108722"),
            ("FSSAI: Manual of Methods for testing common adulterants (2019), section IV, Spices and condiments",
             "https://fssai.gov.in/upload/uploadfiles/files/Manual_Methods_Testing_Adulterants_18_10_2019.pdf"),
            ("FSSAI: DART, Detect Adulteration with Rapid Test (household tests)",
             "https://www.fssai.gov.in/book-details.php?bkid=201"),
            ("Forsyth et al., Evidence of turmeric adulteration with lead chromate across South Asia, "
             "Science of the Total Environment (2024)",
             "https://doi.org/10.1016/j.scitotenv.2024.175003"),
        ],
    ),
    dict(
        slug="cane-vs-palm-jaggery",
        name="Cane jaggery or palm jaggery: which to use",
        short="Cane jaggery or palm jaggery",
        names='<span lang="te">చెరుకు బెల్లం</span> · <span lang="te">తాటి బెల్లం</span> · '
              '<span lang="hi">गन्ने का गुड़</span> · <span lang="hi">ताड़ का गुड़</span> · '
              '<span lang="sa">इक्षुगुडः</span> · <span lang="sa">तालगुडः</span>',
        eyebrow="Guide · jaggery",
        title="చెరుకు బెల్లం vs తాటి బెల్లం · Cane vs Palm Jaggery | 1acrefarms",
        desc="చెరుకు బెల్లం, తాటి బెల్లం తేడా. Cane jaggery (cheruku bellam) vs palm jaggery (thati bellam): "
             "what each is made from, how they differ, which to use, and how to store them.",
        published="2026-10-31",
        modified="2026-11-07",  # Sanskrit names beside the Telugu heading
        tile_line="What each is made from, how they taste, and which to use where. With a Telugu section.",
        intro=[
            "Bellam in a Telugu kitchen usually means one of two things: cheruku bellam, made from sugarcane "
            "juice, or thati bellam, made from the sap of the palmyra palm. FSSAI treats them as two "
            "separate products, each with its own standard.",
            "They can look alike in a lump, but they taste different and suit different dishes. Here is how "
            "to tell them apart, which to use where, and how to keep them. There is a full Telugu section "
            "further down.",
        ],
        quick="Cane jaggery (cheruku bellam) is boiled-down sugarcane juice with a mellow, caramel "
              "sweetness: the one for payasam, pongal and chimmili. Palm jaggery (thati bellam) is "
              "boiled-down palmyra sap, darker and deeper in taste: a favourite in filter coffee and tea. "
              "You can swap one for the other gram for gram; start with a little less palm jaggery. Keep "
              "both in an airtight jar.",
        te_line="చెరుకు బెల్లాన్ని చెరుకు రసంతో, తాటి బెల్లాన్ని తాటి నీరాతో చేస్తారు. పరమాన్నం, పొంగలి, "
                "చిమ్మిలికి చెరుకు బెల్లం; కాఫీ, టీకి తాటి బెల్లం బాగుంటుంది. రెండింటినీ గాలి చొరబడని "
                "డబ్బాలో ఉంచండి.",
        hi_line="गन्ने का गुड़ गन्ने के रस से और ताड़ का गुड़ ताड़ के रस से बनता है। खीर, पोंगल और तिल के "
                "लड्डू के लिए गन्ने का गुड़, कॉफ़ी और चाय के लिए ताड़ का गुड़ अच्छा रहता है। दोनों को हवाबंद "
                "डिब्बे में रखें।",
        figure=dict(
            packs=["cane-jaggery", "palm-jaggery"],
            label="Our two jaggeries",
            caption="Left: cane jaggery from the Chittoor and Anakapalli cane belts. Right: palm jaggery "
                    "from the Godavari delta. Both packed in Narasaraopet."),
        packs=["cane-jaggery", "palm-jaggery"],
        packs_label="Our jaggery",
        packs_note="",
        sections=[
            ("glance", "At a glance", """            <div class="gd-table-wrap">
              <table class="gd-table">
                <thead>
                  <tr><th></th><th>Cane jaggery<span lang="te">చెరుకు బెల్లం</span><span lang="sa">इक्षुगुडः</span></th><th>Palm jaggery<span lang="te">తాటి బెల్లం</span><span lang="sa">तालगुडः</span></th></tr>
                </thead>
                <tbody>
                  <tr><th>Made from</th><td>Juice pressed out of sugarcane</td><td>Sap of the palmyra palm (thati neera)</td></tr>
                  <tr><th>Made by</th><td>Boiling the juice down until it sets</td><td>Boiling the sap down until it sets</td></tr>
                  <tr><th>FSSAI standard</th><td>"Cane jaggery or cane gur": moisture up to 7%</td><td>"Gur or jaggery" from palmyra, date or coconut palm: moisture up to 10%</td></tr>
                  <tr><th>Colour</th><td>Golden to dark brown</td><td>Dark brown</td></tr>
                  <tr><th>Taste</th><td>Mellow, caramel sweetness</td><td>Deeper, slightly smoky sweetness</td></tr>
                  <tr><th>Good for</th><td>Payasam, pongal, paramannam, chimmili, chikki, laddu</td><td>Filter coffee, tea, payasam, sunnundalu</td></tr>
                </tbody>
              </table>
            </div>"""),
            ("where", "Where they come from", """            <p>Cane jaggery is made wherever sugarcane grows: the juice is pressed out of the cane and boiled down in open pans. In Andhra Pradesh, Anakapalli has the second largest jaggery market in India.</p>
            <p>Palm jaggery is made from the sap of the palmyra palm, thati chettu in Telugu. The sap is called neera, or thati neera, and it is boiled down until it sets.</p>"""),
            ("which", "Which one to use", """            <ul class="rcp-bullets">
              <li>Payasam, sweet pongal and <a href="/recipes/paramannam/">bellam paramannam</a>: cane jaggery.</li>
              <li><a href="/recipes/chimmili/">Chimmili</a>, chikki and laddu: cane jaggery.</li>
              <li>Filter coffee and tea: palm jaggery. Its deeper taste stands up to the decoction; try our <a href="/recipes/palm-jaggery-coffee/">palm jaggery coffee</a>.</li>
              <li><a href="/recipes/pasupu-paalu/">Pasupu paalu</a>: either one, as you like it.</li>
            </ul>"""),
            ("swap", "Swapping one for the other", """            <p>Use the same weight. Palm jaggery tastes stronger, so start with a little less and add more to taste.</p>
            <p>In milk, coffee or tea, add either jaggery after the milk is off the boil, so the milk does not split.</p>"""),
            ("store", "Keeping it well", """            <ul class="rcp-bullets">
              <li>Keep jaggery in an airtight jar in a cool, dry place.</li>
              <li>Use a dry spoon or knife. Jaggery takes in moisture from the air and turns sticky.</li>
              <li>If it sets hard, grate it.</li>
              <li>Use it within the best-before date on the pack.</li>
            </ul>"""),
            ("telugu", "తెలుగులో: చెరుకు బెల్లం (इक्षुगुडः), తాటి బెల్లం (तालगुडः)", """            <div class="gd-te" lang="te">
              <p>చెరుకు బెల్లాన్ని చెరుకు రసాన్ని మరిగించి చేస్తారు. తాటి బెల్లాన్ని తాటి నీరాను మరిగించి చేస్తారు. FSSAI ఈ రెండింటికీ వేర్వేరు ప్రమాణాలు పెట్టింది: చెరుకు బెల్లంలో తేమ 7% వరకు, తాటి బెల్లంలో 10% వరకు ఉండొచ్చు.</p>
              <p>రుచిలో కూడా తేడా ఉంటుంది. చెరుకు బెల్లం తీపి తేలికగా, పాకం రుచితో ఉంటుంది. తాటి బెల్లం రంగు ముదురుగా, రుచి లోతుగా, కొంచెం పొగ రుచితో ఉంటుంది.</p>
              <ul class="rcp-bullets">
                <li>పరమాన్నం, పొంగలి, చిమ్మిలి, చిక్కీ, లడ్డూలకు: చెరుకు బెల్లం.</li>
                <li>ఫిల్టర్ కాఫీ, టీకి: తాటి బెల్లం.</li>
                <li>ఒకదానికి బదులు మరొకటి అదే బరువుతో వాడొచ్చు. తాటి బెల్లం రుచి ఎక్కువ కాబట్టి కొంచెం తక్కువతో మొదలుపెట్టండి.</li>
                <li>పాలు, కాఫీ, టీలో బెల్లం వేసేటప్పుడు పాలు మరగడం ఆగాక వేయండి; లేకపోతే పాలు విరిగిపోవచ్చు.</li>
                <li>గాలి చొరబడని డబ్బాలో ఉంచి, పొడి చెంచాతో వాడండి. గట్టిపడితే తురుముకోండి.</li>
              </ul>
              <p>అనకాపల్లిలో దేశంలోనే రెండో అతిపెద్ద బెల్లం మార్కెట్ ఉంది.</p>
            </div>"""),
        ],
        faq=[
            ("Is palm jaggery the same as karupatti?",
             "Yes. Karupatti is the Tamil name for jaggery made from palmyra sap. In Telugu it is thati "
             "bellam, and in Hindi taad ka gud."),
            ("Is gud the same as jaggery?",
             "Yes. Gud, or gur, is the Hindi word for jaggery, and bellam is the Telugu one. On its own it "
             "usually means cane jaggery."),
            ("Why has my jaggery gone sticky?",
             "It has taken in moisture from the air, which happens faster in humid weather. Move it to an "
             "airtight jar and use a dry spoon."),
            ("Can I use palm jaggery in payasam?",
             "Yes. It gives a darker colour and a deeper taste. Add it off the heat, as you would cane "
             "jaggery."),
        ],
        sources=[
            ("FSSAI: Food Products Standards regulations, chapter 2.8 (sweetening agents), 2.8.4 Gur or "
             "jaggery and Cane jaggery or cane gur",
             "https://www.fssai.gov.in/upload/uploadfiles/files/Chapter%202_8%20(Sweetening%20agents%20including%20Honey).pdf"),
            ("Anakapalli district, Government of Andhra Pradesh: district profile",
             "https://anakapalli.ap.gov.in/"),
        ],
    ),
]

PACK_BY_SLUG = {p["slug"]: p for p in bp.PACKS}


def amazon(p):
    """The order link for a pack: its Amazon.in listing while buyable, otherwise our Amazon store (Amazon.in only)."""
    a = bp.amazon_link(p)
    if a:
        return f'<a class="rcp-amazon" href="{a}" target="_blank" rel="noopener">Buy on Amazon</a>'
    return f'<a class="rcp-amazon" href="{bp.AMAZON_STORE}" target="_blank" rel="noopener">Our Amazon store</a>'


def links_by_pack():
    """{pack slug: [(url, short name)]} for the pack pages' guide links."""
    out = {}
    for g in GUIDES:
        for s in g["packs"]:
            out.setdefault(s, []).append((f"/learn/{g['slug']}/", g["short"]))
    return out


def article_ld(g, url):
    return {
        "@type": "Article",
        "@id": url + "#article",
        "headline": g["name"],
        "description": g["desc"],
        "image": [f"{SITE}/assets/og-image.jpg"],
        "inLanguage": "en-IN",
        "datePublished": g["published"],
        "dateModified": g.get("modified", g["published"]),  # set "modified" when the guide's own data changes
        "author": {"@type": "Organization", "@id": f"{SITE}/#business", "name": "1acrefarms", "url": f"{SITE}/"},
        "publisher": {"@id": f"{SITE}/#business"},
        "mainEntityOfPage": url,
        "citation": [u for _, u in g["sources"]],
    }


def pack_figure(slugs):
    """The pack photos side by side, each with its name under it."""
    cells = "\n".join(f"""            <a href="/{PACK_BY_SLUG[s]['slug']}/">
              <img src="/assets/packs/{PACK_BY_SLUG[s]['pack']}" alt="{PACK_BY_SLUG[s]['name']} {PACK_BY_SLUG[s]['g']} g pack" width="800" height="1122" />
              <span>{PACK_BY_SLUG[s]['name']}<br /><span lang="te">{PACK_BY_SLUG[s]['te']}</span> · <span lang="sa">{PACK_BY_SLUG[s]['sa']}</span></span>
            </a>""" for s in slugs)
    return f"""<div class="gd-packfig">
{cells}
          </div>"""


def our_packs(g):
    wa = f"https://wa.me/{bp.WA}"
    cards = []
    for slug in g["packs"]:
        p = PACK_BY_SLUG[slug]
        cards.append(f"""          <div class="rcp-pack">
            <a href="/{p['slug']}/"><img src="/assets/packs/{p['pack']}" alt="{p['name']} {p['g']} g pack" width="800" height="1122" loading="lazy" /></a>
            <div>
              <a class="po-name" href="/{p['slug']}/">{p['name']}</a>
              <span class="po-te"><span lang="te">{p['te']}</span> · <span lang="sa">{p['sa']}</span> · {p['local']}</span>
              <span class="po-price">MRP ₹{p['mrp']} · {p['g']} g</span>
              <span class="rcp-pack-links">{amazon(p)}<a href="/{p['slug']}/">See the pack</a></span>
            </div>
          </div>""")
    note = f"""\n          <p class="rcp-also">{g['packs_note'].format(wa=wa)}</p>""" if g["packs_note"] else ""
    return f"""        <div class="rcp-made">
          <p class="eyebrow">{e(g['packs_label'])}</p>
{chr(10).join(cards)}
{note}
        </div>"""


def tile(g):
    return f"""        <a class="gd-tile" href="/learn/{g['slug']}/">
          <span class="eyebrow">{e(g['eyebrow'])}</span>
          <span class="gd-tile-name">{e(g['name'])}</span>
          <span class="gd-tile-line">{e(g['tile_line'])}</span>
          <span class="gd-tile-go">Read the guide</span>
        </a>"""


def guide_page(g, live):
    url = f"{SITE}/learn/{g['slug']}/"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        article_ld(g, url),
        br.faq_ld(g, url),
        br.crumbs_ld(("Home", f"{SITE}/"), ("Guides", f"{SITE}/learn/"), (g["name"], url)),
    ]}, ensure_ascii=False, indent=2)
    intro = "\n".join(f"          <p>{e(p)}</p>" for p in g["intro"])
    sections = "\n\n".join(f"""          <section class="rcp-section gd-section" id="{sid}">
            <h2>{e(head)}</h2>
{body}
          </section>""" for sid, head, body in g["sections"])
    faq = "\n".join(f"""          <div class="rcp-qa">
            <h3>{e(q)}</h3>
            <p>{e(a)}</p>
          </div>""" for q, a in g["faq"])
    sources = "\n".join(f'              <li><a href="{u}" target="_blank" rel="noopener">{e(label)}</a></li>'
                        for label, u in g["sources"])
    fig = g["figure"]
    return br.head(g["title"], g["desc"], url, "article", f"{g['name']} · 1acrefarms",
                   f"{SITE}/assets/og-image.jpg", ld) + f"""
<body class="pdp-page rcp-page gd-page">
{bp.HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/learn/">Guides</a> <span aria-hidden="true">›</span> <span aria-current="page">{e(g['short'])}</span></nav>

    <article>
      <header class="rcp-hero">
        <div class="rcp-hero-text">
          <p class="eyebrow">{e(g['eyebrow'])}</p>
          <h1>{e(g['name'])}</h1>
          <p class="pdp-names">{g['names']}</p>
          <div class="rcp-intro">
{intro}
          </div>
        </div>
        <figure class="rcp-card gd-figure">
          {fig.get('svg') or pack_figure(fig['packs'])}
          <figcaption><span>{e(fig['label'])}</span>{e(fig['caption'])}</figcaption>
        </figure>
      </header>

      <section class="rcp-quick" aria-label="In short">
        <p class="eyebrow">In short</p>
        <p>{e(g['quick'])}</p>
        <p class="pdp-lang" lang="te">{g['te_line']}</p>
        <p class="pdp-lang" lang="hi">{g['hi_line']}</p>
      </section>

      <div class="rcp-body gd-body">
        <div class="rcp-rest">
{sections}

          <section class="rcp-section rcp-faq">
            <h2>Questions</h2>
{faq}
          </section>

          <section class="rcp-section gd-sources">
            <h2>Sources</h2>
            <ul>
{sources}
            </ul>
          </section>
        </div>

        <aside class="rcp-aside">
{our_packs(g)}
        </aside>
      </div>
    </article>
  </main>

{bp.footer(live)}
</body>
</html>
"""


def hub_page(live):
    url = f"{SITE}/learn/"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": url + "#page", "name": "Guides", "url": url,
         "publisher": {"@id": f"{SITE}/#business"},
         "mainEntity": {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i, "url": f"{SITE}/learn/{g['slug']}/", "name": g["name"]}
             for i, g in enumerate(GUIDES, 1)]}},
        br.crumbs_ld(("Home", f"{SITE}/"), ("Guides", url)),
    ]}, ensure_ascii=False, indent=2)
    tiles = "\n".join(tile(g) for g in GUIDES)
    desc = "Plain answers to what buyers ask us, starting with how to check turmeric powder at home."
    return br.head("Buyer Guides for Turmeric & Jaggery | 1acrefarms", desc, url,
                   "website", "Guides · 1acrefarms", f"{SITE}/assets/og-image.jpg", ld) + f"""
<body class="pdp-page rcp-page gd-page">
{bp.HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <span aria-current="page">Guides</span></nav>

    <section class="rcp-hub">
      <p class="eyebrow">Know what you buy</p>
      <h1>Guides</h1>
      <p class="pdp-lede">Plain answers to what buyers ask us, with the sources behind them.</p>
      <div class="gd-grid">
{tiles}
      </div>
    </section>
  </main>

{bp.footer(live)}
</body>
</html>
"""


def sitemap_rows():
    """Rows for build_pages.sitemap(): the guide list, then each guide."""
    return [(f"{SITE}/learn/", "monthly", "0.6")] + [
        (f"{SITE}/learn/{g['slug']}/", "monthly", "0.7") for g in GUIDES]


def check_copy(name, page):
    br.check_copy(name, page)
    text = re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", " ", page, flags=re.S))
    hit = RISKY.search(text)
    if hit:
        sys.exit(f"Risky word in {name}: {hit.group(0)!r}")


def build(live):
    live_slugs = {p["slug"] for p in live}
    for g in GUIDES:
        missing = [s for s in g["packs"] if s not in live_slugs]
        if missing:
            sys.exit(f"{g['slug']} links to packs that are not live: {missing}")
        words = len(" ".join(g["intro"]).split())
        if len(g["intro"]) != 2 or not 50 <= words <= 120:
            sys.exit(f"{g['slug']}: intro should be 2 paragraphs, 50-120 words (has {words})")
    pages = {ROOT / "learn" / "index.html": hub_page(live)}
    for g in GUIDES:
        pages[ROOT / "learn" / g["slug"] / "index.html"] = guide_page(g, live)
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
