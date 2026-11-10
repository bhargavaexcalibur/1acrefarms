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
    dict(
        slug="hill-turmeric-vs-turmeric",
        name="Hill turmeric (konda pasupu) or turmeric: the difference",
        short="Hill turmeric or turmeric",
        names='<span lang="te">కొండ పసుపు</span> · <span lang="te">పసుపు</span> · '
              '<span lang="hi">पहाड़ी हल्दी</span> · <span lang="hi">हल्दी</span> · '
              '<span lang="sa">गिरिहरिद्राचूर्णम्</span> · <span lang="sa">हरिद्राचूर्णम्</span> · Konda Pasupu · Pasupu',
        eyebrow="Guide · turmeric",
        title="కొండ పసుపు vs మైదాన పసుపు · Hill vs Plains Turmeric | 1acrefarms",
        desc="కొండ పసుపు, మైదాన పసుపు మధ్య తేడా. Konda pasupu (hill turmeric) vs plains turmeric: where each grows, "
             "how each is dried, what curcumin is, cooking and storage.",
        published="2026-11-09",
        tile_line="Where each grows, how it is dried, what curcumin is, and how to compare two. With a Telugu section.",
        intro=[
            "Konda pasupu means hill turmeric: turmeric grown in hill country. In Andhra Pradesh that includes "
            "the agency hills of the Eastern Ghats around Araku Valley, Chintapalle and Paderu, where most "
            "tribal farmers grow turmeric. Plains turmeric grows on farmland in districts such as Guntur.",
            "FSSAI's standard for turmeric powder is the same wherever it grew. What changes is the place, "
            "the variety, and how it is grown and dried. This guide covers each of those, what curcumin is, "
            "how to cook with each and how to compare two turmerics fairly. There is a Telugu section "
            "further down.",
        ],
        quick="Hill turmeric (konda pasupu) grows in hill country, such as the Eastern Ghats around Araku, "
              "where most tribal farmers grow it. Plains turmeric grows on farmland in districts such as "
              "Guntur. Both are boiled, dried and ground, and FSSAI holds both to the same "
              "standard. Curcumin, the yellow pigment in turmeric, changes with variety, soil, climate and "
              "processing, so the word hill or plains does not tell you how much a turmeric has. Cook with "
              "both the same way.",
        te_line="కొండ పసుపు తూర్పు కనుమల కొండల్లో, అరకు చుట్టుపక్కల పండుతుంది; అక్కడి గిరిజన రైతుల్లో "
                "ఎక్కువమంది పసుపు పండిస్తారు. మైదాన పసుపు గుంటూరు లాంటి జిల్లాల్లోని పొలాల్లో పండుతుంది. "
                "రెండింటినీ ఉడకబెట్టి, ఎండబెట్టి, పొడి చేస్తారు; FSSAI ప్రమాణం రెండింటికీ ఒకటే. పసుపుకు "
                "రంగు ఇచ్చే కర్కుమిన్ శాతం పసుపు రకం, నేల, వాతావరణం, తయారీ విధానాన్ని బట్టి మారుతుంది, కాబట్టి \"కొండ\" "
                "లేదా \"మైదానం\" అనే మాట అది ఎంత ఉందో చెప్పదు. రెండింటినీ వంటల్లో ఒకేలా వాడండి.",
        hi_line="पहाड़ी हल्दी पूर्वी घाट की पहाड़ियों में, अरकू के आसपास उगती है, जहाँ के ज़्यादातर आदिवासी किसान "
                "हल्दी उगाते हैं। मैदानी हल्दी गुंटूर जैसे ज़िलों के खेतों में उगती है। दोनों को उबालकर, "
                "सुखाकर पीसा जाता है, और FSSAI का मानक दोनों के लिए एक ही है। हल्दी को पीला रंग देने वाले "
                "करक्यूमिन की मात्रा किस्म, मिट्टी, जलवायु और प्रोसेसिंग से बदलती है, इसलिए सिर्फ़ \"पहाड़ी\" या \"मैदानी\" "
                "शब्द से पता नहीं चलता कि उसमें कितना है। दोनों को खाने में एक ही तरह इस्तेमाल करें।",
        figure=dict(
            packs=["hill-turmeric-powder", "turmeric-powder"],
            label="Our two turmerics",
            caption="Left: hill turmeric from the Araku and Maredumilli hills. Right: turmeric grown in "
                    "Palnadu and Guntur. Both packed in Narasaraopet."),
        packs=["turmeric-powder", "hill-turmeric-powder"],
        packs_label="Our turmeric",
        packs_note="Both packs list one ingredient, turmeric (Curcuma longa), and name where it was grown.",
        sections=[
            ("glance", "At a glance", """            <div class="gd-table-wrap">
              <table class="gd-table">
                <thead>
                  <tr><th></th><th>Hill turmeric<span lang="te">కొండ పసుపు</span><span lang="sa">गिरिहरिद्राचूर्णम्</span></th><th>Plains turmeric<span lang="te">మైదాన పసుపు</span><span lang="sa">हरिद्राचूर्णम्</span></th></tr>
                </thead>
                <tbody>
                  <tr><th>Where it grows</th><td>Hill country, such as the Paderu agency hills of the Eastern Ghats: Araku Valley, Chintapalle and Paderu</td><td>Farmland in districts such as Guntur</td></tr>
                  <tr><th>Who grows it</th><td>Most tribal farmers in the Paderu agency</td><td>Farms in Guntur district, where turmeric is one of the commercial crops, with cotton, chillies and tobacco</td></tr>
                  <tr><th>In the ground</th><td>The old local variety has often been left for 2 to 3 seasons, up to 18 to 24 months; newer varieties such as Roma are dug after one season</td><td>ICAR-IISR's general guide: a well-managed crop is ready in 7 to 9 months, usually dug between January and March</td></tr>
                  <tr><th>After digging</th><td>Boiled and dried by hand, which takes a lot of labour and firewood</td><td>The usual steps: boiled, sun-dried, then polished by hand or by machine</td></tr>
                  <tr><th>FSSAI standard</th><td colspan="2">The same one for both: at least 2% curcuminoids on a dry basis, and added colour is not allowed</td></tr>
                  <tr><th>Our pack says</th><td>Araku and Maredumilli hills. Whole hill turmeric fingers, packed as fine powder</td><td>Grown in Palnadu and Guntur. Sun-dried, stone-ground</td></tr>
                </tbody>
              </table>
            </div>
            <p class="gd-note">The rows above describe each region in general, from the sources at the end of this page. Only the last row is about our packs.</p>"""),
            ("where", "Where each grows", """            <p><strong>Hill turmeric.</strong> ICAR-IISR's report on the Paderu agency, the tribal hill country of the Eastern Ghats that takes in Araku Valley, Chintapalle and Paderu, says turmeric is grown there by most tribal farmers.</p>
            <p><strong>Plains turmeric.</strong> Guntur district lists turmeric among its commercial crops, with cotton, chillies and tobacco. Duggirala, in Guntur, has a turmeric processing cluster that makes processed turmeric and turmeric powder. In 2022, Guntur district was divided into three districts: Guntur, Palnadu and Bapatla.</p>
            <p>Turmeric can be grown either way: ICAR-IISR says it can be grown rain-fed or irrigated, from sea level up to 1,500 m.</p>
            <p>Our <a href="/hill-turmeric-powder/">hill turmeric</a> comes from the Araku and Maredumilli hills, and our <a href="/turmeric-powder/">turmeric</a> is grown in Palnadu and Guntur. Both are packed in Narasaraopet.</p>"""),
            ("grown", "How each is grown and dried", """            <p><strong>In the hills.</strong> ICAR-IISR's Paderu report says tribal farmers there have grown a local variety called Chayapasupu, or Chintapalle Local, for ages. It has been common practice to leave it in the ground for two or three seasons, up to 18 to 24 months, before digging. From 2011-12, ICAR-IISR and the Horticultural Research Station at Chintapalle tested varieties for the hill zone and brought in Roma and IISR Pragati, which are dug after one season. The report says tribal farmers boil and dry their turmeric by hand, which takes a lot of labour and firewood; the project gave four farmer producer organisations turmeric boilers and polishers.</p>
            <p><strong>The usual steps.</strong> ICAR-IISR's turmeric guide describes how the crop is handled after it is dug:</p>
            <ol class="rcp-steps">
              <li id="step-1">Dig it when the leaves dry and turn light brown to yellowish. A well-managed crop is ready seven to nine months after planting, usually between January and March.</li>
              <li id="step-2">Separate the fingers from the bulbs and boil them within 3 or 4 days of digging, in water until soft: 45 to 60 minutes for fingers and 90 minutes for bulbs. Boiling takes away the raw smell, cuts the drying time and gives an even colour.</li>
              <li id="step-3">Dry them in the sun in layers 5 to 7 cm deep, heaped and covered at night. It may take 10 to 12 days for the moisture to fall below 12%.</li>
              <li id="step-4">Polish off the rough, dull, scaly skin by rubbing, by hand or in a turning drum.</li>
              <li id="step-5">Grind the dried turmeric into powder. FSSAI allows turmeric powder up to 10% moisture.</li>
            </ol>
            <p class="gd-note">Fingers are the side branches of the turmeric rhizome, usually 2.5 to 7.5 cm long; bulbs are the shorter, thicker central rhizome. Our hill turmeric pack says whole hill turmeric fingers, packed as fine powder. Our turmeric pack says sun-dried and stone-ground.</p>"""),
            ("curcumin", "Curcumin, and how they look", """            <p>Curcumin is the yellow pigment in turmeric, ICAR-IISR says. FSSAI measures a turmeric powder's colouring power as its curcuminoid content, and asks for at least 2% on a dry basis. That standard is the same for hill and plains turmeric.</p>
            <p>Curcumin changes from one turmeric to the next:</p>
            <ul class="rcp-bullets">
              <li><strong>Variety.</strong> ICAR-IISR's 2022 turmeric guide lists its own varieties from 4.3% curcumin (Suvarna) to 6.5% (IISR Prabha).</li>
              <li><strong>Soil and climate.</strong> ICAR-IISR notes that turmeric from different regions differs in quality because of soil, climate and farming practice. Its Paderu report calls curcumin content highly sensitive to changes in the growing environment.</li>
              <li><strong>Processing.</strong> Handling and processing after harvest add to the differences, and boiling too long or too short affects the quality of the dried turmeric.</li>
            </ul>
            <p class="gd-note">So the word hill or plains on a pack does not tell you a turmeric's curcumin content. A food testing lab can measure the curcuminoid content of a batch.</p>
            <p><strong>How they look.</strong> Colour varies too. ICAR-IISR describes its varieties' rhizomes as ranging from reddish yellow to deep orange. Processing counts as well: boiling evens out the colour, drying in too thin a layer can spoil it, and polishing by hand leaves a rough, dull surface.</p>"""),
            ("cook", "Cooking with each, and keeping it", """            <ul class="rcp-bullets">
              <li>Use either one wherever you use turmeric: dal, sambar, rasam, curries and pulihora.</li>
              <li>Add it on a low flame so it does not burn.</li>
              <li>To swap one for the other, start with the amount you usually use and adjust to taste.</li>
              <li>Try either one in <a href="/recipes/pasupu-annam/">pasupu annam</a>, <a href="/recipes/nimmakaya-pulihora/">nimmakaya pulihora</a>, <a href="/recipes/tomato-pappu/">tomato pappu</a> or <a href="/recipes/pasupu-paalu/">pasupu paalu</a>.</li>
            </ul>
            <p><strong>Keeping it well.</strong></p>
            <ul class="rcp-bullets">
              <li>Keep the pack zipped shut, or move the powder to a dry, airtight jar.</li>
              <li>Use a dry spoon every time.</li>
              <li>Store it in a cool, dry place, away from light.</li>
              <li>Use it within the best-before date on the pack.</li>
            </ul>"""),
            ("compare", "How to compare two turmerics fairly", """            <ol class="rcp-steps">
              <li id="cmp-1">Compare powder with powder. FSSAI allows whole turmeric up to 12% moisture and powder up to 10%, so the two are held to different limits.</li>
              <li id="cmp-2">Read both packs: where it was grown, the batch or lot number, the best-before date and the FSSAI licence or registration number. Note the batch numbers, so you know which lots you compared.</li>
              <li id="cmp-3">Do the water check on both, side by side, with the same amount in the same kind of glass. The steps are in <a href="/learn/turmeric-adulteration-test/">how to check turmeric powder at home</a>.</li>
              <li id="cmp-4">Cook the same dish with each, with the same amount, and compare the colour and taste.</li>
              <li id="cmp-5">Do not judge curcumin by colour alone. A brighter yellow is not a measurement; a food testing lab can measure curcuminoid content.</li>
            </ol>"""),
            ("telugu", "తెలుగులో: తేడా ఏమిటి?", """            <div class="gd-te" lang="te">
              <p><strong>కొండ పసుపు</strong> <span lang="sa">गिरिहरिद्राचूर्णम्</span> · <strong>మైదాన పసుపు</strong> <span lang="sa">हरिद्राचूर्णम्</span></p>
              <p>కొండ పసుపు అంటే కొండ ప్రాంతాల్లో పండే పసుపు. తూర్పు కనుమల్లోని పాడేరు ఏజెన్సీలో (అరకు లోయ, చింతపల్లి, పాడేరు) గిరిజన రైతుల్లో ఎక్కువమంది పసుపు పండిస్తారు. అక్కడి రైతులు చాలా కాలంగా ఛాయ పసుపు (చింతపల్లి లోకల్) అనే పాత రకాన్ని పండిస్తున్నారు. దాన్ని రెండు మూడు సీజన్లు, 18 నుంచి 24 నెలల వరకు, తవ్వకుండా భూమిలోనే ఉంచడం అక్కడ మామూలు. 2011-12 నుంచి ICAR-IISR, చింతపల్లి ఉద్యాన పరిశోధన స్థానం రెండూ కలిసి కొండ ప్రాంతానికి తగిన రకాలను పరీక్షించి, రోమా, IISR ప్రగతి అనే కొత్త రకాలను ప్రవేశపెట్టాయి; ఇవి ఒక్క సీజన్‌లోనే తవ్వకానికి వస్తాయి.</p>
              <p>మైదాన ప్రాంతాల పసుపు గుంటూరు లాంటి జిల్లాల్లో పండుతుంది. గుంటూరు జిల్లాలో పత్తి, మిరప, పొగాకుతో పాటు పసుపు కూడా ఒక వాణిజ్య పంట. గుంటూరు జిల్లా దుగ్గిరాలలో పసుపు ప్రాసెసింగ్ క్లస్టర్ ఉంది. 2022లో గుంటూరు జిల్లాను గుంటూరు, పల్నాడు, బాపట్ల అనే మూడు జిల్లాలుగా విభజించారు.</p>
              <p>తవ్విన పసుపు కొమ్ములను, దుంపలను వేరు చేసి, మెత్తబడే వరకు నీటిలో ఉడకబెడతారు. తర్వాత 10 నుంచి 12 రోజులు ఎండలో ఆరబెట్టి, పాలిష్ చేసి, పొడి చేస్తారు. ఉడకబెట్టడం వల్ల పచ్చి వాసన పోతుంది, త్వరగా ఆరుతుంది, రంగు అంతటా ఒకేలా వస్తుంది. పాడేరు ఏజెన్సీలో గిరిజన రైతులు ఉడకబెట్టడం, ఆరబెట్టడం చేతితోనే చేస్తారు; దానికి శ్రమ, కట్టెలు ఎక్కువగా పడతాయి.</p>
              <p>FSSAI ప్రమాణం ప్రకారం పసుపు పొడిలో తేమ లేని బరువు లెక్కన కర్కుమినాయిడ్లు కనీసం 2% ఉండాలి, ఏ రంగూ కలపకూడదు, తేమ 10% మించకూడదు. ఈ ప్రమాణం కొండ పసుపుకు, మైదాన పసుపుకు ఒకటే.</p>
              <p>కర్కుమిన్ పసుపులో ఉండే పసుపు రంగు పదార్థం. దీని శాతం రకం, నేల, వాతావరణం, సాగు, తయారీ పద్ధతులను బట్టి మారుతుంది. ICAR-IISR రకాల్లోనే కర్కుమిన్ 4.3% నుంచి 6.5% వరకు ఉంది. కాబట్టి ప్యాక్ మీద "కొండ" లేదా "మైదానం" అనే మాట కర్కుమిన్ ఎంతో చెప్పదు. రంగును బట్టి మాత్రమే దాన్ని అంచనా వేయకండి; ఒక బ్యాచ్‌లో ఎంత ఉందో ఫుడ్ టెస్టింగ్ ల్యాబ్ కొలవగలదు.</p>
              <ul class="rcp-bullets">
                <li>పసుపు వేసే ప్రతి వంటలో రెండింటినీ వాడొచ్చు: పప్పు, సాంబారు, రసం, కూరలు, పులిహోర.</li>
                <li>మాడిపోకుండా సన్నని మంటపై వేయండి.</li>
                <li>రెండింటినీ పోల్చాలంటే: పొడిని పొడితోనే పోల్చండి. ప్యాక్ మీద పండిన ప్రాంతం, బ్యాచ్ నంబర్, బెస్ట్ బిఫోర్ తేదీ, FSSAI నంబర్ చూడండి. రెండింటికీ పక్కపక్కనే <a href="/learn/turmeric-adulteration-test/">నీటి పరీక్ష</a> చేయండి.</li>
                <li>తడి లేని చెంచా వాడండి, ప్యాక్ జిప్ మూసి ఉంచండి. చల్లని, పొడి చోట, వెలుతురు తగలకుండా ఉంచండి.</li>
              </ul>
              <p>మా కొండ పసుపు అరకు, మారేడుమిల్లి కొండల నుంచి వస్తుంది. మా మైదాన ప్రాంత పసుపు పల్నాడు, గుంటూరులో పండినది. రెండూ నరసరావుపేటలో ప్యాక్ చేసినవి.</p>
            </div>"""),
        ],
        faq=[
            ("What is konda pasupu?",
             "Konda pasupu is Telugu for hill turmeric: turmeric grown in hill country. In Andhra Pradesh it "
             "grows in the Eastern Ghats, for example in the Paderu agency around Araku Valley and "
             "Chintapalle, where most tribal farmers grow turmeric."),
            ("Is hill turmeric different from regular turmeric?",
             "FSSAI holds all turmeric powder to the same standard, wherever it grew. Hill and plains "
             "turmeric can differ in where they grow, the varieties grown, and how they are grown and dried. In "
             "the Paderu hills, for example, an old local variety has often been left in the ground for up to "
             "two years."),
            ("Does hill turmeric have more curcumin?",
             "The word hill alone does not tell you. Curcumin changes with the variety, the soil and climate, "
             "and how the turmeric was boiled and dried. A food testing lab can measure the curcuminoid "
             "content of a batch."),
            ("What are the types of turmeric (haldi) in India?",
             "ICAR-IISR says India grows many turmeric cultivars, mostly known by the name of the place where "
             "they are grown, such as Duggirala, Mydukur, Tekkurpet and Amalapuram. It has also released "
             "improved varieties such as IISR Prabha, IISR Prathibha and IISR Pragati."),
            ("Can I use hill turmeric instead of regular turmeric?",
             "Yes. Use it wherever you use turmeric, start with the amount you usually use, and add it on a "
             "low flame so it does not burn."),
        ],
        sources=[
            ("FSSAI: Food Products Standards regulations, chapter 2.9 (Version 4, 01.08.2025), "
             "2.9.18 Turmeric (Haldi)",
             "https://www.fssai.gov.in/upload/uploadfiles/files/Chapter%202_9_Salt_Spices_Condiments%20and%20related%20products.pdf"),
            ("ICAR-Indian Institute of Spices Research: Turmeric, extension pamphlet (March 2022), on the "
             "Spices Board India website",
             "https://indianspices.com/sites/default/files/185.%20Institute%20Publication-Turmeric%20Extension%20Pamphlet%20-%20March%202022.pdf"),
            ("ICAR-Indian Institute of Spices Research: Spices Varieties of ICAR-IISR (2022), preface",
             "https://spices.res.in/sites/default/files/IISR%20Varieties-Booklet%20-%20Final.pdf"),
            ("ICAR-Indian Institute of Spices Research: Value chain model for promotion of spice farming "
             "systems in Paderu tribal agency area, Visakhapatnam",
             "https://spices.res.in/storage/app/public/pdfs/GENERAL/17ENG.pdf"),
            ("Guntur district, Government of Andhra Pradesh: about the district",
             "https://guntur.ap.gov.in/about-district/"),
        ],
    ),
    dict(
        slug="chilli-powder-adulteration-test",
        name="How to check chilli powder at home",
        short="How to check chilli powder at home",
        names='<span lang="te">సన్నం కారం</span> · <span lang="te">తేజ కారం</span> · '
              '<span lang="hi">सन्नम मिर्च पाउडर</span> · <span lang="hi">तेजा मिर्च पाउडर</span> · '
              '<span lang="sa">सन्नम-रक्तमरिचचूर्णम्</span> · <span lang="sa">तेजा-रक्तमरिचचूर्णम्</span> · '
              'Kaaram · Lal mirch',
        eyebrow="Guide · chilli powder",
        title="కారం కల్తీ · Chilli Powder Adulteration Test | 1acrefarms",
        desc="కారం కల్తీని ఇంట్లోనే ఎలా గుర్తించాలి. How to check chilli powder at home: the water glass, rub and "
             "iodine tests, what they miss, and when you need a lab.",
        published="2026-11-09",
        tile_line="The water glass, the rub test, the iodine test, and when you need a lab. With a Telugu section.",
        intro=[
            "FSSAI's standard says chilli powder must be dry and free from dirt, added colouring matter, "
            "flavouring matter and mineral oil. Its testing manual has methods for finding brick powder, "
            "added starch, added colour, colours that dissolve in oil, and the dyes Sudan III and "
            "Rhodamine B.",
            "Some of this you can check in your kitchen with a glass of water, your fingers and a few drops "
            "of iodine. Some, like Sudan dyes, only a lab can find. This guide covers both. Try the checks "
            "on any chilli powder you buy.",
        ],
        quick="Sprinkle a teaspoon of chilli powder on a glass of water and do not stir. Colour streaks "
              "running down at once point to added colour, and bits still floating after the powder sinks "
              "point to sawdust or bran. Rub the sediment: grit points to brick powder or sand, a soapy feel "
              "to soapstone. Iodine turning the powder blue points to added starch. Dyes such as Sudan I do "
              "not show in water; for those, use a lab.",
        te_line="ఒక గ్లాసు నీటిపై చెంచా కారం చల్లి, కలపకుండా ఉంచండి. వెంటనే రంగు గీతలు కిందికి దిగితే రంగు "
                "కలిపి ఉండొచ్చు. పొడి అడుగుకు చేరాక కూడా పైన తేలేవి రంపపు పొట్టు లేదా తవుడు కావచ్చు. "
                "అడుగున మిగిలినదాన్ని వేళ్లతో రుద్దండి: గరుకుగా ఉంటే ఇటుక పొడి లేదా ఇసుక కావచ్చు, సబ్బులా "
                "నునుపుగా ఉంటే బలపం రాయి కావచ్చు. అయోడిన్ చుక్కలతో నీలం రంగు వస్తే పిండిపదార్థం కలిపి "
                "ఉండొచ్చు. సూడాన్ I వంటి రంగులు నీటి పరీక్షలో కనిపించవు; వాటికి ల్యాబ్ పరీక్ష కావాలి.",
        hi_line="एक गिलास पानी पर एक चम्मच लाल मिर्च पाउडर छिड़कें और बिना हिलाए छोड़ दें। अगर तुरंत रंग की "
                "धारियाँ नीचे उतरें, तो रंग मिलाया गया हो सकता है। पाउडर बैठने के बाद भी ऊपर तैरते कण बुरादा "
                "या चोकर हो सकते हैं। तली में बचे हिस्से को उँगलियों से रगड़ें: किरकिरा लगे तो ईंट का चूरा या "
                "रेत, साबुन जैसा चिकना लगे तो सोपस्टोन हो सकता है। आयोडीन की बूँदों से नीला रंग आए तो स्टार्च "
                "मिलाया गया हो सकता है। सूडान I जैसे रंग पानी की जाँच में नहीं दिखते, उनके लिए लैब टेस्ट ज़रूरी है।",
        figure=dict(
            packs=["sannam-chilli-powder", "teja-chilli-powder"],
            label="Our two chilli powders",
            caption="Left: Sannam chilli powder. Right: Teja chilli powder. Both from chillies grown in "
                    "Palnadu and Guntur, sun-dried and packed in Andhra Pradesh."),
        packs=["sannam-chilli-powder", "teja-chilli-powder"],
        packs_label="Our chilli powder",
        packs_note="Both are grown in Palnadu and Guntur and packed in Andhra Pradesh.",
        sections=[
            ("what", "What FSSAI checks chilli powder for", """            <dl class="gd-dl">
              <dt>Added colour</dt>
              <dd>FSSAI's chilli powder standard does not allow added colouring matter. FSSAI's tests look for colours that dissolve in water, colours that dissolve in oil, and the dyes Sudan III and Rhodamine B.</dd>
              <dt>Sudan dyes</dt>
              <dd>Sudan I is used to colour oils, fats, waxes, and shoe and floor polish. The Indian Standard on quick tests for adulterants says Sudan III, much used in wax polishes, has been used to make chilli pods shine, and so finds its way into chilli powder.</dd>
              <dt>Brick powder, sand, salt, talc and soapstone</dt>
              <dd>FSSAI's household tests list these for chilli powder. The Indian Standard says brick powder is mixed in to increase bulk.</dd>
              <dt>Starch</dt>
              <dd>FSSAI's manual tests powdered spices other than turmeric for added starch. The Indian Standard notes that colour is also added to chilli powder to hide added starch.</dd>
              <dt>Sawdust and bran</dt>
              <dd>Both float on water, which is how FSSAI's household tests spot them.</dd>
            </dl>"""),
            ("water-check", "Check 1: the water glass and the rub test", """            <ol class="rcp-steps">
              <li id="step-1">Fill a clear glass with water at room temperature.</li>
              <li id="step-2">Sprinkle one teaspoon of chilli powder on top. Do not stir.</li>
              <li id="step-3">Watch the first minute. Look for coloured streaks running down from the powder.</li>
              <li id="step-4">Leave it until most of the powder has sunk. Look at the surface for bits still floating.</li>
              <li id="step-5">Pour off most of the water and rub the sediment at the bottom between your fingers.</li>
            </ol>
            <div class="gd-table-wrap">
              <table class="gd-table">
                <thead>
                  <tr><th>What you see or feel</th><th>What it can point to</th></tr>
                </thead>
                <tbody>
                  <tr><th>Colour streaks running down at once</th><td>Added colour that dissolves in water</td></tr>
                  <tr><th>Bits still floating after the powder sinks</th><td>Sawdust or bran</td></tr>
                  <tr><th>Sediment that feels gritty</th><td>Brick powder or sand</td></tr>
                  <tr><th>White sediment that feels soapy and smooth</th><td>Soapstone</td></tr>
                </tbody>
              </table>
            </div>
            <div class="gd-results">
              <div class="gd-result">
                <p class="gd-result-head">None of these</p>
                <p>No sign of what this check can find.</p>
              </div>
              <div class="gd-result gd-result-warn">
                <p class="gd-result-head">Any one of these</p>
                <p>Possible adulteration. Stop using that batch and get it tested.</p>
              </div>
            </div>
            <p><strong>Why it works.</strong> Colours that dissolve in water leave the powder and run down as streaks. Brick powder is heavy and settles to the bottom, while sawdust and bran float.</p>
            <p><strong>What it misses.</strong> Dyes that do not dissolve in water stay in the powder. Sudan I is one: it does not dissolve in water, and it is used to colour oils, fats and waxes. Chilli powder coloured with such dyes can pass this check. Only a lab test can rule them out.</p>
            <p class="gd-note">Wash your hands after the rub test, before you touch your eyes.</p>"""),
            ("iodine", "Check 2: the iodine test for starch", """            <p>FSSAI's manual uses the iodine test for powdered spices other than turmeric, so chilli powder can take it. <a href="/learn/turmeric-adulteration-test/">Our turmeric guide</a> explains why turmeric is left out.</p>
            <ol class="rcp-steps">
              <li id="iodine-1">Put half a teaspoon of chilli powder on a white saucer.</li>
              <li id="iodine-2">Add a few drops of tincture of iodine from a chemist.</li>
              <li id="iodine-3">Look at the colour where the drops land.</li>
              <li id="iodine-4">Throw that powder away afterwards.</li>
            </ol>
            <div class="gd-results">
              <div class="gd-result">
                <p class="gd-result-head">No blue colour</p>
                <p>No sign of added starch.</p>
              </div>
              <div class="gd-result gd-result-warn">
                <p class="gd-result-head">A blue colour</p>
                <p>Points to added starch. Stop using that batch and get it tested. On red powder a faint change is hard to judge, so if you are not sure, let a lab decide.</p>
              </div>
            </div>
            <p><strong>Why it works.</strong> Iodine turns blue when it meets starch.</p>"""),
            ("lab", "Leave these to a lab", """            <div class="gd-skip">
              <h3>Acid and solvent tests at home</h3>
              <p>The methods in FSSAI's manual for brick powder, added colour, oil-soluble colours, Sudan III and Rhodamine B in chilli powder use strong acids and solvents such as chloroform, petroleum ether, hexane and acetone. The acids can cause burns, and several of the solvents catch fire easily. They belong in a lab, not a kitchen.</p>
            </div>
            <p>For a sure answer, send a sample to a NABL-accredited food testing lab. Ask it to test for added colours, including Sudan dyes, and against FSSAI's chilli powder standard. Its limits include moisture up to 11%, total ash up to 8%, and ash insoluble in dilute hydrochloric acid up to 1.3%, all by weight, with both ash limits on a dry basis. Keep the powder in its sealed pack or a clean sealed bag, and note the batch number printed on the pack.</p>"""),
            ("pack", "Read the pack before you buy", """            <ul class="rcp-bullets">
              <li>An FSSAI licence or registration number.</li>
              <li>The name and address of whoever made or packed it.</li>
              <li>Net quantity, a batch or lot number, and a best-before date.</li>
              <li>The ingredients. FSSAI allows up to 2% edible vegetable oil by weight in chilli powder, but only if the label says which oil and how much.</li>
              <li>Where it was grown, and the chilli variety if named. Our <a href="/sannam-chilli-powder/">Sannam</a> and <a href="/teja-chilli-powder/">Teja</a> packs say Palnadu and Guntur.</li>
            </ul>"""),
            ("store", "Keep it well", """            <ul class="rcp-bullets">
              <li>Keep the pack zipped shut, or move the powder to a dry, airtight jar.</li>
              <li>Use a dry spoon, and keep the jar away from steam from the stove.</li>
              <li>Keep it in a cool, dry place, out of direct sunlight.</li>
              <li>Use it within the best-before date on the pack, in dishes such as <a href="/recipes/vellulli-kaaram/">vellulli kaaram</a>, <a href="/recipes/gongura-pachadi/">gongura pachadi</a> or <a href="/recipes/tomato-pachadi/">tomato pachadi</a>.</li>
            </ul>"""),
            ("telugu", "తెలుగులో: ఇంట్లోనే కల్తీ పరీక్ష", """            <div class="gd-te" lang="te">
              <p>FSSAI ప్రమాణం ప్రకారం కారం ఎండి ఉండాలి; అందులో మట్టి, అదనంగా కలిపిన రంగు, రుచి కోసం కలిపే పదార్థాలు, మినరల్ ఆయిల్ ఉండకూడదు. FSSAI పరీక్షలు కారంలో వెతికే కల్తీలు: ఇటుక పొడి, ఇసుక, ఉప్పు, టాల్క్, బలపం రాయి, రంపపు పొట్టు, తవుడు, పిండిపదార్థం, రంగులు.</p>
              <ul class="rcp-bullets">
                <li>నీటి గ్లాసు పరీక్ష: ఒక గ్లాసు నీటిపై చెంచా కారం చల్లండి, కలపకండి. వెంటనే రంగు గీతలు కిందికి దిగితే, నీటిలో కరిగే రంగు కలిపి ఉండొచ్చు.</li>
                <li>పొడి అడుగుకు చేరాక కూడా పైన ఏదైనా తేలుతూ ఉంటే, అది రంపపు పొట్టు లేదా తవుడు కావచ్చు.</li>
                <li>రుద్దే పరీక్ష: చాలావరకు నీళ్లు ఒంపేసి, అడుగున మిగిలినదాన్ని వేళ్లతో రుద్దండి. గరుకుగా తగిలితే ఇటుక పొడి లేదా ఇసుక కావచ్చు; తెల్లగా, సబ్బులా నునుపుగా ఉంటే బలపం రాయి కావచ్చు. తర్వాత, కళ్లు ముట్టుకునే ముందు చేతులు కడుక్కోండి.</li>
                <li>అయోడిన్ పరీక్ష: తెల్లని సాసర్‌లో అర చెంచా కారం వేసి, కొన్ని చుక్కల టింక్చర్ అయోడిన్ వేయండి. నీలం రంగు వస్తే పిండిపదార్థం కలిపి ఉండొచ్చు. FSSAI మాన్యువల్ ఈ పరీక్షను పసుపు తప్ప మిగతా మసాలా పొడులకు వాడుతుంది; కారం వాటిలో ఒకటి. పరీక్ష తర్వాత ఆ పొడిని పారేయండి.</li>
                <li>సూడాన్ I వంటి రంగులు నీటిలో కరగవు, కాబట్టి నీటి పరీక్షలో కనిపించవు. వాటికి ల్యాబ్ పరీక్ష కావాలి. ఆమ్లాలు, ద్రావకాలతో చేసే పరీక్షలు ఇంట్లో చేయకండి. కచ్చితమైన సమాధానం కోసం NABL గుర్తింపు ఉన్న ఫుడ్ టెస్టింగ్ ల్యాబ్‌కు శాంపిల్ పంపండి.</li>
                <li>కొనేముందు ప్యాక్‌పై FSSAI నంబర్, తయారు చేసినవారి లేదా ప్యాక్ చేసినవారి పేరు, చిరునామా, నికర బరువు, బ్యాచ్ నంబర్, బెస్ట్-బిఫోర్ తేదీ చూడండి. FSSAI కారంలో బరువులో 2% వరకు వంట నూనె కలపడానికి అనుమతిస్తుంది, కానీ ఏ నూనె, ఎంత అనేది ప్యాక్‌పై రాసి ఉండాలి.</li>
                <li>ప్యాక్‌ను జిప్ మూసి, చల్లని పొడి చోట, ఎండ తగలకుండా ఉంచండి. తడి లేని చెంచాతో వాడండి.</li>
              </ul>
            </div>"""),
        ],
        faq=[
            ("How do I check chilli powder for brick powder at home?",
             "Put a teaspoon of chilli powder in a glass of water and let it settle. Pour off most of the "
             "water and rub the sediment between your fingers: grit points to brick powder or sand, and a "
             "white residue that feels soapy and smooth points to soapstone."),
            ("Can the water test detect Sudan dye in chilli powder?",
             "No. Sudan I does not dissolve in water, so it cannot run out as streaks. FSSAI's manual tests "
             "for Sudan III and for oil-soluble colours with solvents such as hexane and petroleum ether, so "
             "those tests need a lab."),
            ("Does the iodine test work on chilli powder?",
             "Yes. FSSAI's manual uses the iodine test for powdered spices other than turmeric, and chilli "
             "powder is one of them. A blue colour points to added starch."),
            ("Is bright red chilli powder a sign of adulteration?",
             "Colour alone does not tell you. The water check looks for colour that leaves the powder and "
             "runs down as streaks, not for how red the powder looks, and a lab can test for added colours."),
            ("What should I do if a check looks wrong?",
             "Stop using that batch and keep the pack. Contact the seller with the batch number, or send a "
             "sample to a NABL-accredited food testing lab for a sure answer."),
        ],
        sources=[
            ("FSSAI: Food Products Standards regulations, chapter 2.9 (Version 4, 01.08.2025), 2.9.3 "
             "Chillies and Capsicum (Lal Mirchi) powder",
             "https://www.fssai.gov.in/upload/uploadfiles/files/Chapter%202_9_Salt_Spices_Condiments%20and%20related%20products.pdf"),
            ("FSSAI (Eat Right India): DART, Detect Adulteration with Rapid Test, household and sensory tests",
             "https://eatrightindia.gov.in/dart/"),
            ("FSSAI: Manual of Methods for testing common adulterants (2019), section IV, Spices and condiments",
             "https://fssai.gov.in/upload/uploadfiles/files/Manual_Methods_Testing_Adulterants_18_10_2019.pdf"),
            ("BIS: IS 15642 (Parts 1 and 2): 2006, Quick methods for detection of adulterants/contaminants "
             "in common food products",
             "https://law.resource.org/pub/in/bis/S06/is.15642.1-2.2006.pdf"),
            ("PubChem (NCBI) compound record: Sudan I, solubility and uses",
             "https://pubchem.ncbi.nlm.nih.gov/compound/13297"),
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
              <span class="po-te"><span lang="te">{p['te']}</span> · <span lang="sa">{p['sa']}</span> · {p['local']}</span>{br.po_price(p)}
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
