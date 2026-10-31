# Translating the 1acrefarms site

`source_en.json` has every English string (`en`) with a `note` on where it appears. Each language has
`<code>.json`:

```json
{"_lang": "hi", "strings": {"ui.add": {"src": "<the English, copied exactly>", "t": "<translation>", "back": "<blind back-translation>"}}}
```

- `src` must be the English **exactly** as in source_en.json (the build uses it to spot stale lines).
- `t` is the translation. `back` is filled later by a different translator who never sees the English.

## Rules for every translation

1. **Plain, everyday language**, the way a friendly shopkeeper would write to a customer in that
   language. Not word-for-word. Short sentences.
2. **Keep exactly as written:** every number in Western digits 0-9 (never native digits), `₹`, `g`,
   `MRP`, `UPI`, `WhatsApp`, `FSSAI`, `1acrefarms` (all lowercase, one word, never translated or
   transliterated). Titles end with ` | 1acrefarms`.
3. **Place names** are names: write them in the target script (Palnadu, Guntur, Araku, Maredumilli,
   Chittoor, Anakapalli, Godavari, Narasaraopet, Chirala, Bapatla, Visakhapatnam, Andhra Pradesh,
   Bharat, South India).
4. **Product names:** the everyday name in that language (Hindi: हल्दी पाउडर, गन्ने का गुड़, काजू).
   The bracket in the English (Pasupu, Konda Pasupu, Sannam Kaaram, Teja Kaaram, Cheruku Bellam,
   Thati Bellam, Jeedipappu) is the Telugu name: write it in the target script in the bracket.
5. **Never add claim words**, even if the sentence sounds nicer: no word meaning natural, pure,
   organic, fresh, healthy, health, traditional, premium, authentic, real, genuine, chemical,
   100%, "no added", benefit, or any health or medical idea. Add nothing that is not in the English;
   drop nothing that is. "Village desi" = from the village, local/desi; never "pure" or "natural".
6. No HTML, no markdown, no surrounding quotes. Keep `·` separators where the English has them.
7. **Script:** Devanagari for hi, mr, ne, sa, brx, doi, kok, mai; Bengali-Assamese script for bn, as;
   Meetei Mayek for mni; Ol Chiki for sat; Perso-Arabic for ur, ks (Nastaliq style) and sd (Arabic
   Sindhi letters); the own script for gu, pa (Gurmukhi), or, ta, te, kn, ml.

Check your file with `python3 tools/build_i18n.py status` from the repo root: it lists any line whose
numbers, brand name or words break the rules ("no back-translation" is expected until the back step).

## Recipes and guides (`seg.*` keys)

These pieces come from the recipe and guide pages (see `tools/i18n_pages.py`). Same rules as above, plus:

8. **Markers.** `⟦1⟧…⟦/1⟧` wrap words that keep a link or bold style: keep both markers, around the
   words that mean the same in your sentence (word order may change). `⟦#1⟧` stands for something
   kept as it is (a Telugu or Hindi name, a picture): keep it, once. Every marker in the English must
   appear exactly once in the translation, and add none.
9. **Recipes.** Keep every quantity's digits and fractions as written (½, ¾, 1–2, 10–15). Cooking
   words (cup, tbsp, tsp, ghee, decoction, tumbler, davara) may use the everyday word in your
   language. Dish names: write them in your script and add your language's own name in brackets
   only if one is in common use.
10. **Guides.** Translate exactly, without making anything sound more alarming or more reassuring
    than the English: never add words meaning safe, unsafe, harmful, dangerous, toxic, poison, fake,
    genuine, real, guaranteed, certified or lab-tested. Keep FSSAI, NABL, FoSCoS, DART and "Food
    Safety Connect" in Latin letters.
11. Names in the text such as "Sona Masoori", "Nagula Chavithi" and "Anakapalli" are names: write
    them in your script.
