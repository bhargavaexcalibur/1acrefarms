#!/usr/bin/env python3
"""Build the recipe pages: /recipes/ (a list) and /recipes/<slug>/ for each recipe.

Why: Google indexes the homepage and the pack pages only. A crawlable page per recipe ("thati
bellam coffee", "bellam paramannam", "chimmili", "pasupu paalu") with Recipe and FAQ structured
data gives people more ways to find us, and each recipe links to the pack it is made with.

Copy: each recipe starts from the approved November social post (docs/marketing/social/
month_2026-11/month_specs.json for ingredients, steps and the tip; calendar_2026-10-22_to_11-24.json
for the English, Telugu and Hindi captions). The approved text is kept verbatim inside the fuller
recipe: every approved ingredient is an ingredient line, every approved step sentence sits inside a
method step, the approved tip is a tip, and the approved captions are the "In short" lines.
Everything else is plain home-cooking detail, marked ADDED below. No claim words and no health,
nutrition or benefit talk: checked on every build.

docs/ is not in git, so the copy lives here. When docs/ is present, the build warns if the approved
copy has changed or is no longer inside the page, and refreshes /assets/recipes/<slug>.png from the
post's feed.png render.

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
    r"\bsleep|sooth|ayurved|throat|"
    r"సహజ|శుద్ధ|స్వచ్ఛ|నేచురల్|ఆర్గానిక్|ఫ్రెష్|సాంప్రదాయ|సంప్రదాయ|సేంద్రి|సేంద్రీ|ఆరోగ్య|ప్రీమియం|"
    r"తాజా|రసాయన|అసలైన|రోగనిరోధ|జలుబు|దగ్గు|జీర్ణ|ఔషధ|"
    r"प्राकृतिक|नेचुरल|शुद्ध|पारंपरिक|परंपरा|जैविक|ऑर्गेनिक|सेहत|स्वस्थ|स्वास्थ्य|प्रीमियम|"
    "ताज़ा|ताज़ा|ताजा|केमिकल|रसायन|असली|इम्यु|इम्यू|प्रतिरक्षा|सर्दी|खांसी|खाँसी|पाचन|औषध|"
    "फ़ायद|फ़ायद|फायद",
    re.I)
# A 10-digit Indian mobile number in the visible text (the footer's wa.me link is an href, not text).
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")

# Fields
#   approved   exact copy of the month_specs.json entry (checked); the page shows the fuller recipe
#   quick      the approved English caption (after the emoji); te_line / hi_line the approved
#              Telugu / Hindi captions; te_more / hi_more one ADDED line each
#   times      (prep, cook, total) in minutes · yields (label, shown, schema.org recipeYield)
#   groups     [(heading or None, [(ingredient, note), ...])]; ingredient text stays verbatim
#   packs      the "Made with" box · also: packs named in one "Sweeten it with" line
RECIPES = [
    dict(
        slug="palm-jaggery-coffee", post="2026-10-28_recipe-palm-coffee",
        name="Palm Jaggery Coffee",
        gloss="Thati Bellam Coffee",       # the Telugu name in Latin letters
        te="తాటి బెల్లం కాఫీ", hi="ताड़ के गुड़ वाली कॉफ़ी",
        te_tr="Thati Bellam Coffee",
        hi_tr="Taad Ke Gud Wali Coffee",   # ADDED: transliteration of the approved Hindi name
        alt=[],
        eyebrow="Recipe · filter coffee",
        title="Palm Jaggery Coffee (Thati Bellam Coffee) Recipe | 1acrefarms",
        desc="Palm jaggery coffee (thati bellam coffee), the Andhra way: filter decoction, hot milk and "
             "grated palm jaggery stirred in off the heat. Step-by-step method, tips and FAQs.",
        approved=dict(
            ingredients=["1 cup milk", "2 tbsp filter coffee decoction", "1–2 tsp grated palm jaggery"],
            steps=["Bring the milk to a boil.",
                   "Pour the decoction into a tumbler and add the hot milk.",
                   "Stir in the palm jaggery off the heat.",
                   "Pour between tumbler and davara to froth."],
            meta="Add jaggery after the milk is off the boil so it does not split."),
        # ADDED (everything below except quick / te_line / hi_line and the verbatim approved text)
        intro=[
            "Filter coffee is how many Telugu homes start the day: a strong decoction dripped through a "
            "steel filter, topped up with hot milk and frothed between a tumbler and davara. This version "
            "is sweetened with grated palm jaggery (thati bellam) in place of sugar.",
            "Palm jaggery gives the cup a deep, slightly smoky caramel sweetness that sits well with the "
            "bitterness of the decoction. Once the decoction is ready it takes about 5 minutes, and it "
            "suits a slow morning as much as an evening break.",
        ],
        quick="Boil the milk, add it to the decoction, then stir in grated palm jaggery off the heat. "
              "Froth it between tumbler and davara.",
        te_line="పాలు మరిగించి డికాషన్‌లో కలపండి, స్టవ్ ఆపాక తురిమిన తాటి బెల్లం వేసి కలపండి. "
                "టంబ్లర్, దవరాతో నురుగు వచ్చేలా ఆడించండి.",
        hi_line="दूध उबालकर डिकॉक्शन में मिलाएँ, फिर आँच बंद करके कसा हुआ ताड़ का गुड़ घोलें। "
                "टंबलर और दवरा से झाग बनाएँ।",
        te_more="ఒక కప్పు పాలకు రెండు పెద్ద చెంచాల డికాషన్, ఒకటి రెండు చిన్న చెంచాల తాటి బెల్లం సరిపోతుంది.",
        hi_more="एक कप दूध में दो बड़े चम्मच डिकॉक्शन और एक-दो छोटे चम्मच ताड़ का गुड़ काफ़ी है।",
        times=(15, 5, 20),
        time_note="5 minutes if your decoction is already made.",
        yields=("Makes", "1 tumbler", "1 tumbler"),
        groups=[
            ("For the decoction", [                                           # ADDED group
                ("2 tbsp filter coffee powder", "enough decoction for 2–3 cups"),
                ("½ cup water, just off the boil", ""),
            ]),
            ("For the coffee", [
                ("1 cup milk", "about 240 ml"),
                ("2 tbsp filter coffee decoction", "from above; 3 tbsp for a stronger cup"),
                ("1–2 tsp grated palm jaggery", "to taste"),
            ]),
        ],
        steps=[
            "Make the decoction: put 2 tbsp filter coffee powder in the top chamber of a South Indian "
            "coffee filter, set the perforated press on it and pour in ½ cup water just off the boil. "
            "Cover and leave it to drip for 10–15 minutes.",
            "While it drips, grate the palm jaggery finely so it dissolves in seconds.",
            "Pour the milk into a small saucepan and set it on medium heat.",
            "Bring the milk to a boil. As soon as it froths up the sides of the pan, switch off the heat.",
            "Pour the decoction into a tumbler and add the hot milk. Use 2 tbsp decoction for a mild cup "
            "and 3 tbsp for a strong one.",
            "Let it stand for about a minute, so the milk is just off the boil.",
            "Stir in the palm jaggery off the heat. Keep stirring for 20–30 seconds, until no grains are "
            "left at the bottom of the tumbler.",
            "Taste, and add a little more jaggery if you like it sweeter.",
            "Pour between tumbler and davara to froth. Hold the tumbler high and pour into the davara, "
            "then back again, 3–4 times, until a light foam sits on top.",
            "Serve straight away, in the tumbler set inside the davara.",
        ],
        tips=[
            "Add jaggery after the milk is off the boil so it does not split.",
            "Grate the jaggery finely: fine shreds dissolve in seconds, while lumps sink and stay at the "
            "bottom of the tumbler.",
            "Palm jaggery has a deep, slightly smoky sweetness, so start with 1 tsp and add more to taste.",
            "A steel tumbler and davara keep the coffee hot and make frothing easy; a mug and a jug work too.",
        ],
        variations=[
            "Cane jaggery: use the same amount of grated cane jaggery for a lighter, caramel-like sweetness.",
            "Palm jaggery tea: make your usual milk tea, switch off the heat, wait a minute, then stir in "
            "the palm jaggery the same way.",
            "No coffee filter: dissolve 1 tsp instant coffee in 2 tbsp hot water and use it in place of "
            "the decoction.",
        ],
        serving="Serve hot after a breakfast of idli, dosa or upma, or in the evening with biscuits or "
                "murukulu.",
        storage="Make each cup as you need it; coffee reheated after the jaggery goes in can split. Keep "
                "extra decoction covered at room temperature and use it within the day.",
        faq=[
            ("Why did my coffee curdle when I added palm jaggery?",
             "Jaggery stirred into milk that is still boiling can make it split. Take the milk off the "
             "heat, let it stand for about a minute, then stir in the grated jaggery."),
            ("Can I use cane jaggery instead of palm jaggery?",
             "Yes. Use the same amount of grated cane jaggery. The coffee tastes lighter and more like "
             "caramel, while palm jaggery gives a deeper, slightly smoky cup."),
            ("How much palm jaggery should I add to one cup of coffee?",
             "1 to 2 tsp of grated palm jaggery for 1 cup of milk and 2 tbsp of decoction. Start with 1 tsp, "
             "taste, and add more if you like."),
            ("Can I make palm jaggery coffee without a coffee filter?",
             "Yes. Dissolve 1 tsp instant coffee in 2 tbsp hot water, use it in place of the decoction and "
             "follow the same steps."),
        ],
        packs=["palm-jaggery"],
        category="Drink",
        keywords="thati bellam coffee, palm jaggery coffee, filter coffee, Andhra coffee",
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
        desc="Bellam paramannam for Diwali: rice slow-cooked in milk and sweetened with cane jaggery off "
             "the heat, finished with ghee-fried cashews. Step-by-step method, tips and FAQs. Serves 4.",
        approved=dict(
            ingredients=["½ cup rice", "4 cups milk", "¾ cup grated cane jaggery", "2 tbsp ghee · 10 cashews",
                         "½ tsp cardamom powder"],
            steps=["Cook the washed rice in the milk on a low flame till soft and creamy, about 30 minutes. "
                   "Stir often.",
                   "Switch off and let it rest 5 minutes.",
                   "Stir in the jaggery till it melts.",
                   "Fry the cashews in ghee; add with the cardamom."],
            meta="Jaggery goes in off the heat so the milk does not split."),
        intro=[
            "Paramannam is the rice-and-milk sweet that Telugu homes cook for festivals and pujas: rice "
            "simmered slowly in milk until soft and creamy, then sweetened. Bellam paramannam, made with "
            "jaggery, is a common naivedyam at Diwali, Sankranti and Varalakshmi Vratham, offered at the "
            "puja and then shared at the festive meal.",
            "Cane jaggery turns it a light caramel colour and gives a rounder, toffee-like sweetness. "
            "Ghee-fried cashews and a little cardamom finish it. This recipe serves 4.",
        ],
        quick="Cook rice in milk till creamy, rest it 5 minutes, then stir in grated cane jaggery. "
              "Finish with ghee-fried cashews and cardamom.",
        te_line="బియ్యాన్ని పాలలో మెత్తగా ఉడికించి, 5 నిమిషాలు ఆగి, తురిమిన చెరుకు బెల్లం కలపండి. "
                "నెయ్యిలో వేయించిన జీడిపప్పు, యాలకుల పొడి వేయండి.",
        hi_line="चावल को दूध में गाढ़ा होने तक पकाएँ, 5 मिनट रुकें, फिर कसा हुआ गन्ने का गुड़ मिलाएँ। "
                "घी में भुने काजू और इलायची डालें।",
        te_more="బెల్లం వేశాక మళ్ళీ స్టవ్ మీద పెట్టకండి, పాలు విరిగిపోతాయి.",
        hi_more="गुड़ डालने के बाद खीर को दोबारा आँच पर न रखें, वरना दूध फट सकता है।",
        times=(10, 40, 55),
        time_note="Total includes the 5-minute rest before the jaggery goes in.",
        yields=("Serves", "4", "4 servings"),
        groups=[
            ("For the paramannam", [
                ("½ cup rice", "sona masoori or another short-grain rice, about 100 g"),
                ("4 cups milk", "about 1 litre; whole milk gives the creamiest result"),
                ("¾ cup grated cane jaggery", "lightly packed; up to 2 tbsp more if you like it sweeter"),
            ]),
            ("To finish", [
                ("2 tbsp ghee", ""),
                ("10 cashews", "halved"),
                ("1 tbsp raisins (optional)", ""),                               # ADDED
                ("½ tsp cardamom powder", "or the crushed seeds of 4–5 pods"),
            ]),
        ],
        steps=[
            "Wash the rice in 2–3 changes of water until the water runs almost clear, then drain it well.",
            "Pour the milk into a heavy-bottomed pan and bring it to a boil on medium heat, about 8–10 "
            "minutes. Stir now and then so it does not catch at the bottom.",
            "Add the drained rice to the boiling milk and turn the heat to low.",
            "Cook the washed rice in the milk on a low flame till soft and creamy, about 30 minutes. "
            "Stir often, scraping the bottom and sides of the pan each time.",
            "Check the rice: a grain should mash easily between your fingers, and the milk should have "
            "thickened slightly. For a creamier paramannam, lightly mash a few grains against the side of "
            "the pan.",
            "Switch off and let it rest 5 minutes. This brings the milk below the boil, so the jaggery "
            "will not split it.",
            "Stir in the jaggery till it melts, about 1–2 minutes, keeping the pan off the heat.",
            "Taste, and stir in a little more grated jaggery if you want it sweeter.",
            "Heat the ghee in a small pan on medium-low heat.",
            "Fry the cashews in ghee; add with the cardamom. Stir the cashews until golden, about 1 minute, "
            "adding the raisins for the last few seconds until they puff up. Pour the nuts and ghee into "
            "the paramannam, sprinkle in the cardamom powder and stir.",
            "Serve warm. Paramannam thickens as it stands; loosen it with a few spoons of warm milk, off "
            "the heat, if needed.",
        ],
        tips=[
            "Jaggery goes in off the heat so the milk does not split.",
            "Use a heavy-bottomed pan and scrape the bottom each time you stir; milk catches easily during "
            "the long simmer.",
            "Cook the rice until fully soft before the jaggery goes in; the grains do not soften further "
            "once it is sweetened.",
            "Grate the jaggery finely so it melts in the hot milk without going back on the stove.",
        ],
        variations=[
            "Palm jaggery: use the same amount of grated palm jaggery for a darker colour and a deeper, "
            "smoky sweetness.",
            "Pesarapappu paramannam: dry-roast 2 tbsp split moong dal until light golden, wash it and cook "
            "it with the rice.",
            "Coconut: fry 2 tbsp thin slivers of dry coconut in the ghee along with the cashews.",
        ],
        serving="Serve warm as naivedyam at the Diwali or Lakshmi puja, then as the sweet at the festive "
                "meal. Some like it chilled the next day.",
        storage="Keep leftovers covered in the fridge and eat within 2 days. It sets thick when chilled; "
                "stir in a little warm milk, off the heat, before serving.",
        faq=[
            ("Why did my paramannam curdle after adding jaggery?",
             "Jaggery stirred into milk that is still on the heat or boiling can make it split. Switch off, "
             "let the paramannam rest for about 5 minutes, then stir in the grated jaggery."),
            ("Can I use palm jaggery instead of cane jaggery?",
             "Yes. Use the same amount of grated palm jaggery (thati bellam). The paramannam turns darker "
             "and tastes deeper and slightly smoky."),
            ("Which rice is best for paramannam?",
             "A short-grain rice such as sona masoori cooks soft and creamy in milk. Long-grain basmati "
             "keeps its grains separate and gives a thinner paramannam."),
            ("How do I fix paramannam that has become too thick?",
             "Stir in a few spoons of warm milk, off the heat, until it loosens. It thickens as it cools, so "
             "stop when it is a little thinner than you want."),
        ],
        packs=["cane-jaggery"],
        category="Dessert",
        keywords="bellam paramannam, paramannam, jaggery rice kheer, gud wali kheer, Diwali sweet",
    ),
    dict(
        slug="chimmili", post="2026-11-12_recipe-chimmili",
        name="Chimmili for Nagula Chavithi",
        gloss="Sesame Jaggery Balls",      # ADDED: English gloss
        te="నాగుల చవితికి చిమ్మిలి", hi="नागुल चविति के लिए तिल-गुड़ के लड्डू",
        te_tr="Nuvvula Chimmili",          # ADDED: the usual Telugu name (nuvvulu = sesame)
        hi_tr="Til-Gud Ke Laddoo",         # ADDED: transliteration of the approved Hindi name
        alt=["Chimmili", "చిమ్మిలి", "तिल-गुड़ के लड्डू"],
        eyebrow="Nagula Chavithi recipe · makes about 12",
        title="Chimmili (Sesame Jaggery Balls) for Nagula Chavithi | 1acrefarms",
        desc="Chimmili for Nagula Chavithi: roasted sesame and cane jaggery shaped into small balls. "
             "Step-by-step method, tips and FAQs. Makes about 12 and keeps a week.",
        approved=dict(
            ingredients=["1 cup white sesame seeds", "¾ cup grated cane jaggery", "¼ tsp cardamom powder"],
            steps=["Dry-roast the sesame on a low flame till it crackles and turns light golden. Cool.",
                   "Grind the sesame coarsely in short pulses.",
                   "Add the jaggery and cardamom; pulse till it comes together.",
                   "Shape into small balls."],
            meta="Makes about 12 · keeps a week in an airtight jar."),
        intro=[
            "Chimmili is a small Telugu sweet of roasted sesame and jaggery, ground coarsely and rolled into "
            "balls. It is one of the offerings made on Nagula Chavithi in Karthika masam, along with "
            "chalimidi and the milk poured at the snake anthill (putta). Sesame and jaggery sweets like it "
            "are made again at Sankranti.",
            "Roasted sesame gives it a nutty, toasty taste, and cane jaggery a caramel sweetness. The texture "
            "is soft and a little crumbly, and each ball is gone in two bites. This recipe makes about 12.",
        ],
        quick="Make chimmili at home: roast sesame till it crackles, grind coarsely, pulse with grated cane "
              "jaggery and cardamom, shape into balls.",
        te_line="ఇంట్లోనే చిమ్మిలి: నువ్వులు చిటపటలాడే వరకు వేయించి, బరకగా పొడి చేసి, తురిమిన చెరుకు "
                "బెల్లం, యాలకుల పొడితో కలిపి ఉండలు చేయండి.",
        hi_line="घर पर तिल-गुड़ के लड्डू: तिल को चटकने तक भूनें, दरदरा पीसें, कसा हुआ गन्ने का गुड़ और "
                "इलायची मिलाकर लड्डू बनाएँ।",
        te_more="నువ్వులు గోరువెచ్చగా ఉన్నప్పుడే బెల్లంతో కలిపి, త్వరగా ఉండలు చుట్టండి.",
        hi_more="तिल हल्के गरम रहते ही गुड़ के साथ पीसें और जल्दी से लड्डू बाँध लें।",
        times=(15, 10, 30),
        time_note="Total includes 5 minutes for the roasted sesame to cool.",
        yields=("Makes", "About 12", "About 12 balls"),
        groups=[
            (None, [
                ("1 cup white sesame seeds", "about 150 g"),
                ("¾ cup grated cane jaggery", "lightly packed; soft jaggery binds best"),
                ("¼ tsp cardamom powder", ""),
                ("1 tsp ghee, for greasing your palms", ""),                     # ADDED
            ]),
        ],
        steps=[
            "Grate the jaggery and measure out the sesame before you start; once the sesame is roasted, "
            "the rest moves quickly.",
            "Heat a heavy kadai or pan on low heat for a minute. Add the sesame; no oil or ghee is needed.",
            "Dry-roast the sesame on a low flame till it crackles and turns light golden. Stir all the time; "
            "the seeds start to pop and smell nutty after 4–6 minutes. Do not let them turn brown.",
            "Tip the sesame onto a wide plate straight away so it stops browning. Cool it for about "
            "5 minutes, until it is just warm to the touch.",
            "Grind the sesame coarsely in short pulses. Use the small jar of the mixer and pulse 3–4 times, "
            "a second or two at a time; stop while you can still see broken seeds.",
            "Add the jaggery and cardamom; pulse till it comes together. This takes 4–6 more short pulses; "
            "scrape down the sides once. A pinch pressed between your fingers should hold its shape.",
            "If the mixture is too dry to hold, add 1–2 tsp more grated jaggery and pulse once or twice "
            "again.",
            "Tip the mixture into a bowl and grease your palms lightly with ghee.",
            "Shape into small balls. Take a heaped tablespoon at a time, press it firmly in your fist, then "
            "roll it smooth. Work quickly while the mixture is still warm, as it turns crumbly when it cools.",
            "Leave the balls on a plate until they cool completely, about 15 minutes, then store them in an "
            "airtight jar.",
        ],
        tips=[
            "Roast on a low flame and keep stirring; sesame goes from golden to burnt quickly, and burnt "
            "sesame tastes bitter.",
            "Grind in short pulses only; long runs turn sesame into an oily paste.",
            "Shape while the mixture is warm. If it turns crumbly, pulse it once more with a teaspoon of "
            "grated jaggery.",
            "Soft jaggery binds best. If yours is hard, grate it finely so it blends in evenly.",
        ],
        variations=[
            "Palm jaggery: use the same amount of grated palm jaggery for darker chimmili with a smoky "
            "sweetness.",
            "Black sesame (nalla nuvvulu): roast and grind it the same way for darker, stronger-tasting balls.",
            "Peanut or coconut: pulse in 2 tbsp roasted peanuts or grated dry coconut with the jaggery.",
            "Without a mixer: pound the warm sesame and jaggery together in a stone mortar (rolu) until the "
            "mixture holds, then shape.",
        ],
        serving="On Nagula Chavithi morning, offer chimmili with milk at the snake anthill (putta) or in "
                "your puja, then share them as prasadam. They also go well with evening tea.",
        storage="Keeps a week in an airtight jar. Store the jar at room temperature, in a dry place.",
        faq=[
            ("Why is my chimmili not holding together?",
             "The sesame may be under-ground, or the mixture may have cooled. Pulse it once more with "
             "1–2 tsp extra grated jaggery and shape it while it is still warm."),
            ("Why does my chimmili taste bitter?",
             "The sesame was roasted too dark. Roast it on a low flame only until it crackles and turns light "
             "golden, then tip it onto a plate at once so it stops browning."),
            ("Can I use palm jaggery instead of cane jaggery?",
             "Yes. Use the same amount of grated palm jaggery (thati bellam). The chimmili will be darker, "
             "with a deeper, slightly smoky sweetness."),
            ("When is Nagula Chavithi in 2026?",
             "Nagula Chavithi falls on Friday, 13 November 2026, in Karthika masam, a few days after "
             "Deepavali. Chimmili, chalimidi and milk are among the offerings made at the snake anthill "
             "(putta) that morning."),
        ],
        packs=["cane-jaggery"],
        category="Sweet",
        keywords="chimmili, nuvvula chimmili, sesame jaggery balls, til gud laddoo, Nagula Chavithi",
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
        desc="Pasupu paalu (haldi doodh): warm milk simmered with turmeric and a pinch of pepper, "
             "sweetened with jaggery off the heat. Step-by-step method, tips and FAQs.",
        approved=dict(
            ingredients=["1 cup milk", "¼ tsp turmeric powder", "A pinch of black pepper",
                         "1 tsp grated palm or cane jaggery"],
            steps=["Warm the milk with the turmeric and pepper; simmer 2 minutes.",
                   "Switch off and wait a minute.",
                   "Stir in the jaggery and serve warm."],
            meta="Strain through a fine sieve if you like it smooth."),
        intro=[
            "Pasupu paalu is warm milk simmered with a little turmeric and a pinch of black pepper, then "
            "sweetened with jaggery. It is an everyday cup in many Telugu homes, made on cool evenings and "
            "often through Karthika masam, the month of Somavaram (Monday) pujas and evening lamps.",
            "The turmeric turns the milk golden and gives it an earthy, slightly bitter edge, the pepper adds "
            "a little heat, and the jaggery rounds it off with a caramel sweetness. This recipe makes one cup "
            "in about 5 minutes.",
        ],
        quick="Simmer milk with turmeric and a pinch of pepper, switch off, then stir in a spoon of jaggery.",
        te_line="పాలలో పసుపు, చిటికెడు మిరియాల పొడి వేసి మరిగించి, స్టవ్ ఆపాక చెంచా బెల్లం కలపండి.",
        hi_line="दूध में हल्दी और चुटकी भर काली मिर्च उबालें, आँच बंद करके एक चम्मच गुड़ मिलाएँ।",
        te_more="మెత్తగా కావాలంటే సన్నని జల్లెడతో వడకట్టండి.",
        hi_more="एक कप दूध में चौथाई छोटा चम्मच हल्दी काफ़ी है; चाहें तो बारीक छलनी से छान लें।",
        times=(1, 4, 5),
        time_note="",
        yields=("Makes", "1 cup", "1 cup"),
        groups=[
            (None, [
                ("1 cup milk", "about 240 ml"),
                ("¼ tsp turmeric powder", "Turmeric Powder or Hill Turmeric Powder"),
                ("A pinch of black pepper", "powdered or crushed"),
                ("1 tsp grated palm or cane jaggery", "or to taste"),
                ("A pinch of cardamom powder (optional)", ""),                    # ADDED
            ]),
        ],
        steps=[
            "Pour the milk into a small steel saucepan.",
            "Add the turmeric and pepper (and the cardamom, if using) and stir until no specks of turmeric "
            "float on top. They mix in more evenly before the milk is heated.",
            "Set the pan on medium-low heat. Warm the milk with the turmeric and pepper; simmer 2 minutes. "
            "Once small bubbles appear around the edge, turn the heat to low and let it bubble gently.",
            "Stir now and then and keep an eye on the pan, as milk rises fast once it boils. If it starts to "
            "climb, lift the pan off the heat for a few seconds.",
            "It is ready when the milk is an even golden yellow and the raw smell of turmeric has gone.",
            "Switch off and wait a minute. The milk drops just below the boil, so the jaggery will not "
            "split it.",
            "For a smooth cup, pour the milk through a fine sieve into a tumbler or mug.",
            "Stir in the jaggery and serve warm. Stir for 20–30 seconds, until it dissolves, and taste for "
            "sweetness.",
        ],
        tips=[
            "Strain through a fine sieve if you like it smooth.",
            "Add the jaggery only after switching off; jaggery stirred into boiling milk can split it.",
            "Use a steel pan and spoon; turmeric stains plastic and wood.",
            "Making more? Use the same amounts for each cup of milk.",
        ],
        variations=[
            "Hill turmeric: use Hill Turmeric Powder (konda pasupu) in place of turmeric powder, in the same "
            "amount.",
            "Palm or cane jaggery: palm jaggery gives a deeper, slightly smoky sweetness; cane jaggery a "
            "lighter, caramel one.",
            "Milder cup: leave out the pepper and add a pinch of cardamom powder instead.",
        ],
        serving="Serve warm in a tumbler or mug, on a cool evening or after the Karthika Somavaram puja.",
        storage="Make it as you need it and drink it warm. Reheating after the jaggery is in can split the "
                "milk.",
        faq=[
            ("Why did my pasupu paalu curdle?",
             "Jaggery stirred into milk that is still boiling can make it split. Switch off the heat, wait "
             "about a minute, then stir in the grated jaggery."),
            ("How much turmeric should I use for one cup of milk?",
             "¼ tsp turmeric powder for 1 cup (about 240 ml) of milk. More than that makes the taste sharp "
             "and earthy."),
            ("Can I skip the black pepper?",
             "Yes. The pepper adds a little heat to the taste; leave it out, or use a pinch of cardamom "
             "instead, for a milder cup."),
            ("Should I use palm jaggery or cane jaggery?",
             "Either works, 1 tsp grated per cup. Palm jaggery tastes deeper and slightly smoky; cane jaggery "
             "is lighter and more like caramel."),
        ],
        packs=["turmeric-powder", "hill-turmeric-powder"],
        also=["palm-jaggery", "cane-jaggery"],  # ADDED: one "sweeten it with" line; the recipe uses either
        category="Drink",
        keywords="pasupu paalu, turmeric milk, haldi doodh, Karthika Somavaram",
    ),
]

PACK_BY_SLUG = {p["slug"]: p for p in bp.PACKS}


def e(s):
    return html.escape(s, quote=True)


def iso(minutes):
    h, m = divmod(minutes, 60)
    return "PT" + (f"{h}H" if h else "") + (f"{m}M" if m or not h else "")


def items(r):
    return [text for _, group in r["groups"] for text, _ in group]


def sentences(text):
    """Approved step text split into sentences, without the closing full stop."""
    return [s.rstrip(".") for s in re.split(r"(?<=\.)\s+", text.strip()) if s]


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


def approved_inside(r):
    """Where the approved text is missing from the fuller recipe (works without docs/)."""
    a, missing = r["approved"], []
    shown = set(items(r))
    missing += [f"ingredient {part!r}" for line in a["ingredients"] for part in line.split(" · ")
                if part not in shown]
    steps = " ".join(r["steps"])
    missing += [f"step {s!r}" for step in a["steps"] for s in sentences(step) if s not in steps]
    extra = " ".join(r["tips"] + [r["storage"], f"{r['yields'][0]} {r['yields'][1]}"]).lower()
    missing += [f"tip {part!r}" for part in a["meta"].rstrip(".").split(" · ") if part.lower() not in extra]
    return missing


def check_against_social():
    """Warn (don't stop) if the approved copy in docs/ changed since this file was written."""
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
            drift += [k for k in ("ingredients", "steps", "meta") if s[k] != r["approved"][k]]
            drift += [k for k in ("te", "hi") if s[k] != r[k]]
        if c:
            en, te, hi = c["caption"].split("\n")[:3]
            for label, line, ours in (("en", en, r["quick"]), ("te", te, r["te_line"]), ("hi", hi, r["hi_line"])):
                if emoji.split(line, 1)[-1].strip() not in ours:
                    drift.append(f"caption {label}")
        if drift:
            print(f"WARNING {r['slug']}: approved copy changed or differs ({', '.join(drift)}); check {r['post']}")


def check_recipe(r):
    """Stop the build if a recipe falls below the page standard or loses its approved text."""
    words = len(" ".join(r["intro"]).split())
    problems = []
    if len(r["intro"]) != 2 or not 60 <= words <= 120:
        problems.append(f"intro should be 2 paragraphs, 60-120 words (has {len(r['intro'])}, {words})")
    for key, lo, hi in (("steps", 8, 12), ("tips", 3, 5), ("variations", 2, 4), ("faq", 3, 4)):
        if not lo <= len(r[key]) <= hi:
            problems.append(f"{key}: {len(r[key])} (want {lo}-{hi})")
    prep, cook, total = r["times"]
    if total < prep + cook:
        problems.append("total time is less than prep + cook")
    problems += approved_inside(r)
    if problems:
        sys.exit(f"{r['slug']}: " + "; ".join(problems))


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


def crumbs_ld(*links):
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i, "name": n, "item": u}
                            for i, (n, u) in enumerate(links, 1)],
    }


def recipe_ld(r, url):
    prep, cook, total = r["times"]
    names = [r["gloss"], r["te"], r["hi"], r["te_tr"], r["hi_tr"]] + r["alt"]
    return {
        "@type": "Recipe",
        "@id": url + "#recipe",
        "name": r["name"],
        "alternateName": list(dict.fromkeys(n for n in names if n != r["name"])),
        "description": r["intro"][0],
        "image": [f"{SITE}/assets/recipes/{r['slug']}.png"],
        "author": {"@type": "Organization", "@id": f"{SITE}/#business", "name": "1acrefarms", "url": f"{SITE}/"},
        "recipeCuisine": "Andhra / Telugu",
        "recipeCategory": r["category"],
        "keywords": r["keywords"],
        "prepTime": iso(prep),
        "cookTime": iso(cook),
        "totalTime": iso(total),
        "recipeYield": r["yields"][2],
        "recipeIngredient": items(r),
        "recipeInstructions": [{"@type": "HowToStep", "position": i, "text": s, "url": f"{url}#step-{i}"}
                               for i, s in enumerate(r["steps"], 1)],
    }


def faq_ld(r, url):
    return {
        "@type": "FAQPage",
        "@id": url + "#faq",
        "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                       for q, a in r["faq"]],
    }


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
    label, shown, _ = r["yields"]
    when = f"{label} {shown}" if label == "Serves" or shown.lower().startswith("about") else f"{r['times'][2]} minutes"
    return f"""        <a class="rcp-tile" href="/recipes/{r['slug']}/">
          <img src="/assets/recipes/{r['slug']}.png" alt="{e(r['name'])} recipe card" width="{r['_w']}" height="{r['_h']}" loading="lazy" />
          <span class="rt-name">{e(r['name'])}</span>
          <span class="rt-names"><span lang="te">{r['te']}</span> · <span lang="hi">{r['hi']}</span></span>
          <span class="rt-line">With {p['name']} · {when.lower()}</span>
        </a>"""


def ingredients_html(r):
    out = []
    for heading, group in r["groups"]:
        if heading:
            out.append(f'          <h3 class="rcp-group">{e(heading)}</h3>')
        lis = "\n".join(
            f"            <li>{e(text)}" + (f' <span class="rcp-note">{e(note)}</span>' if note else "") + "</li>"
            for text, note in group)
        out.append(f'          <ul class="rcp-ing">\n{lis}\n          </ul>')
    return "\n".join(out)


def bullets(lines):
    return "\n".join(f"            <li>{e(x)}</li>" for x in lines)


def recipe_page(r, live):
    url = f"{SITE}/recipes/{r['slug']}/"
    img = f"/assets/recipes/{r['slug']}.png"
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        recipe_ld(r, url),
        faq_ld(r, url),
        crumbs_ld(("Home", f"{SITE}/"), ("Recipes", f"{SITE}/recipes/"), (r["name"], url)),
    ]}, ensure_ascii=False, indent=2)
    prep, cook, total = r["times"]
    facts = "\n".join(f"          <li><span>{k}</span>{v}</li>" for k, v in (
        ("Prep", f"{prep} min"), ("Cook", f"{cook} min"), ("Total", f"{total} min"), r["yields"][:2]))
    note = f'\n        <p class="rcp-time-note">{e(r["time_note"])}</p>' if r["time_note"] else ""
    intro = "\n".join(f"          <p>{e(p)}</p>" for p in r["intro"])
    steps = "\n".join(f'            <li id="step-{i}">{e(s)}</li>' for i, s in enumerate(r["steps"], 1))
    faq = "\n".join(f"""          <div class="rcp-qa">
            <h3>{e(q)}</h3>
            <p>{e(a)}</p>
          </div>""" for q, a in r["faq"])
    more = "\n".join(tile(q) for q in RECIPES if q is not r)
    return head(r["title"], r["desc"], url, "article", f"{r['name']} ({r['gloss']}) · 1acrefarms",
                f"{SITE}{img}", ld) + f"""
<body class="pdp-page rcp-page">
{bp.HEADER}

  <main class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/recipes/">Recipes</a> <span aria-hidden="true">›</span> <span aria-current="page">{e(r['name'])}</span></nav>

    <article>
      <header class="rcp-hero">
        <div class="rcp-hero-text">
          <p class="eyebrow">{e(r['eyebrow'])}</p>
          <h1>{e(r['name'])} <span class="pdp-local">({e(r['gloss'])})</span></h1>
          <p class="pdp-names"><span lang="te">{r['te']}</span> · <span lang="hi">{r['hi']}</span> · {e(r['te_tr'])} · {e(r['hi_tr'])}</p>
          <div class="rcp-intro">
{intro}
          </div>
          <ul class="pdp-facts rcp-facts">
{facts}
          </ul>{note}
        </div>
        <figure class="rcp-card">
          <img src="{img}" alt="{e(r['name'])}: the recipe card from 1acrefarms, with ingredients and method" width="{r['_w']}" height="{r['_h']}" />
          <figcaption><span>The recipe card</span>Save it or send it to family. <a href="{img}">Open full size</a></figcaption>
        </figure>
      </header>

      <section class="rcp-quick" aria-label="In short">
        <p class="eyebrow">In short</p>
        <p>{e(r['quick'])}</p>
        <p class="pdp-lang" lang="te">{r['te_line']} {r['te_more']}</p>
        <p class="pdp-lang" lang="hi">{r['hi_line']} {r['hi_more']}</p>
      </section>

      <div class="rcp-body">
        <section class="rcp-section rcp-ingredients">
          <h2>Ingredients <span class="rcp-yield">{r['yields'][0].lower()} {r['yields'][1].lower()}</span></h2>
{ingredients_html(r)}
        </section>

        <aside class="rcp-aside">
{made_with(r)}
        </aside>

        <div class="rcp-rest">
          <section class="rcp-section">
            <h2>Method</h2>
            <ol class="rcp-steps">
{steps}
            </ol>
          </section>

          <section class="rcp-section">
            <h2>Tips</h2>
            <ul class="rcp-bullets">
{bullets(r['tips'])}
            </ul>
          </section>

          <section class="rcp-section">
            <h2>Variations</h2>
            <ul class="rcp-bullets">
{bullets(r['variations'])}
            </ul>
          </section>

          <section class="rcp-section rcp-two">
            <div>
              <h2>Serving</h2>
              <p>{e(r['serving'])}</p>
            </div>
            <div>
              <h2>Storage</h2>
              <p>{e(r['storage'])}</p>
            </div>
          </section>

          <section class="rcp-section rcp-faq">
            <h2>Questions</h2>
{faq}
          </section>
        </div>
      </div>
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
        check_recipe(r)
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
