/* =========================================================
   1acrefarms — storefront logic
   PACKS  = our own printed packs (from the SKU Master sheet,
            "1acrefarms catalogue 2026-09-23", 49 SKUs). Fixed MRPs.
   MORE_SECTIONS = the wider pantry, made to order: price &
            sizes confirmed on WhatsApp.
   Checkout = WhatsApp order. Free delivery; pay on delivery or UPI by pincode + order value (PAYMENT below).
   ========================================================= */

const WHATSAPP_NUMBER = "917899929779"; // 91 (India) + 7899929779 — WhatsApp Business number

// Vijayadashami offer (approved by Bhargav 11-10-2026): WhatsApp + website only, 20–26 Oct 2026 (IST).
// Prices follow the Rule of Nine and keep ≥18 % profit (see memory: discount guardrails). MRP never changes.
// It switches itself on and off by date; ?offerpreview=1 shows it early for checking.
const OFFER = {
  start: Date.parse("2026-10-20T00:00:00+05:30"),
  end: Date.parse("2026-10-27T00:00:00+05:30"),
  label: "Vijayadashami offer · 20–26 Oct",
  prices: { "TURM@540": 324, "KPAS@540": 405, "CBEL@540": 189, "TBEL@540": 405 },
};
const offerOn = () => /[?&]offerpreview=1/.test(location.search) || (Date.now() >= OFFER.start && Date.now() < OFFER.end);
const offerPrice = (p, sku) => (offerOn() && OFFER.prices[`${p.code}@${sku.g}`]) || null;
const sellPrice = (p, sku) => offerPrice(p, sku) || sku.mrp;

// Delivery is free on every order (Bhargav 11-10-2026: the MRP already carries ~₹75 of delivery).
// Payment rule (Bhargav 11-10-2026): pay on delivery for small orders, UPI in advance for big ones,
// by delivery pincode. First version, built on distance + courier cover until we have our own
// delivered / returned data; then Bhargav's RTO model replaces these lists.
const PAYMENT = {
  codCap: { home: 999, rest: 599 },        // highest order value (₹) that can be paid on delivery
  homePrefixes: ["50", "51", "52", "53"],   // Telangana + Andhra Pradesh: our home market, short transit
  // Long-transit areas: J&K + Ladakh (18, 19), Sikkim (737), Andaman & Nicobar (744),
  // North-East (78, 79), Lakshadweep (68255x).
  upiOnlyPrefixes: ["18", "19", "737", "744", "78", "79", "68255"],
  upiOnlyPincodes: [],                       // pincodes with no pay-on-delivery courier (fill from Shiprocket)
};
function paymentFor(pin, total) {
  if (!/^[1-9][0-9]{5}$/.test(pin)) return null;
  const starts = (list) => list.some((x) => pin.startsWith(x));
  if (PAYMENT.upiOnlyPincodes.includes(pin) || starts(PAYMENT.upiOnlyPrefixes)) return { cod: false, why: "area" };
  const cap = starts(PAYMENT.homePrefixes) ? PAYMENT.codCap.home : PAYMENT.codCap.rest;
  return total <= cap ? { cod: true, cap } : { cod: false, why: "value", cap };
}
let pin = "";
try { pin = localStorage.getItem("oneacre_pin") || ""; } catch (e) {}
let payChoice = "upi";

// soft "kraft" tile colours, cycled across products
const MEDIA = ["#e9e2d2","#e7efd9","#f6e3cf","#fdf3da","#f3ddd6","#eef2e6","#f1e8d6","#f6e7cf"];

// ---------------------------------------------------------
// Our packs — one row per product, one entry per SKU (net g, MRP ₹).
// MRPs follow the Rule of Nine (every MRP's digits sum to 9).
// live:true = printed and in the first batch; everything else is pre-order.
// ---------------------------------------------------------
const MAKER = {
  mfd: "Manufactured &amp; Marketed By",
  packed: "Packed &amp; Marketed By",
  address: "1acrefarms, Flat No. 202, Prudhvi Exotica, D.No. 13-1-375/7/A, Srinivasa Nagar, Narasaraopet, Palnadu Dist., A.P. 522601",
};
const IMPORTED = "Declared on the pack for each lot";

// What is printed on each pack's back panel: storage line and nutrition table, exported from
// print/make_pouch_masters.py (the artwork generator) on 11-10-2026, so the site matches the pouch.
// Per 100 g / per serve / %RDA per serve. Regenerate from that script if the artwork changes.
const PACK_FACTS = {"TURM":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":5,"hh":"1 heaped tsp","rows":[["Energy","316 kcal","16 kcal","0.8%"],["Protein","7.7 g","0.4 g","–"],["Carbohydrate","49.2 g","2.5 g","–"],["Total sugars","1.2 g","0.1 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","5.0 g","0.3 g","0.4%"],["Saturated fat","1.6 g","0.1 g","0.4%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","24 mg","1.2 mg","0.1%"],["Dietary fibre","21.4 g","1.1 g","–"],["Iron","46 mg","2.3 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (G033). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"KPAS":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":5,"hh":"1 heaped tsp","rows":[["Energy","316 kcal","16 kcal","0.8%"],["Protein","7.7 g","0.4 g","–"],["Carbohydrate","49.2 g","2.5 g","–"],["Total sugars","1.2 g","0.1 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","5.0 g","0.3 g","0.4%"],["Saturated fat","1.6 g","0.1 g","0.4%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","24 mg","1.2 mg","0.1%"],["Dietary fibre","21.4 g","1.1 g","–"],["Iron","46 mg","2.3 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (G033). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"SANN":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":5,"hh":"1 heaped tsp","rows":[["Energy","289 kcal","14 kcal","0.7%"],["Protein","12.7 g","0.6 g","–"],["Carbohydrate","29.5 g","1.5 g","–"],["Total sugars","4.7 g","0.2 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","6.4 g","0.3 g","0.5%"],["Saturated fat","1.1 g","0.1 g","0.3%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","19 mg","1.0 mg","0%"],["Dietary fibre","31.1 g","1.6 g","–"],["Iron","6.2 mg","0.3 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (G022, dry red chillies). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"TEJA":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":5,"hh":"1 heaped tsp","rows":[["Energy","289 kcal","14 kcal","0.7%"],["Protein","12.7 g","0.6 g","–"],["Carbohydrate","29.5 g","1.5 g","–"],["Total sugars","4.7 g","0.2 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","6.4 g","0.3 g","0.5%"],["Saturated fat","1.1 g","0.1 g","0.3%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","19 mg","1.0 mg","0%"],["Dietary fibre","31.1 g","1.6 g","–"],["Iron","6.2 mg","0.3 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (G022, dry red chillies). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"CBEL":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":10,"hh":"2 tsp","rows":[["Energy","348 kcal","35 kcal","1.7%"],["Protein","1.9 g","0.2 g","–"],["Carbohydrate","84.9 g","8.5 g","–"],["Total sugars","84.3 g","8.4 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","0.2 g","0 g","0%"],["Saturated fat","0.1 g","0 g","0%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","25 mg","2.5 mg","0.1%"],["Iron","4.6 mg","0.5 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (I001). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"TBEL":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":10,"hh":"2 tsp","rows":[["Energy","352 kcal","35 kcal","1.8%"],["Protein","1.4 g","0.1 g","–"],["Carbohydrate","86.2 g","8.6 g","–"],["Total sugars","73.9 g","7.4 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","0.2 g","0 g","0%"],["Saturated fat","0.1 g","0 g","0%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","25 mg","2.5 mg","0.1%"],["Iron","8.0 mg","0.8 mg","–"]],"src":"Values: Vengaiah et al. 2017 (ICAR), palmyra jaggery; sodium: IFCT 2017 jaggery. Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"CASH":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","591 kcal","177 kcal","8.9%"],["Protein","18.8 g","5.6 g","–"],["Carbohydrate","25.5 g","7.6 g","–"],["Total sugars","3.1 g","0.9 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","45.2 g","13.6 g","20%"],["Saturated fat","7.8 g","2.3 g","11%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","9.0 mg","2.7 mg","0.1%"],["Dietary fibre","3.9 g","1.2 g","–"],["Iron","6.0 mg","1.8 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H005, cashew nut). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"WALN":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","689 kcal","207 kcal","10%"],["Protein","14.9 g","4.5 g","–"],["Carbohydrate","10.1 g","3.0 g","–"],["Total sugars","3.2 g","1.0 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","64.3 g","19.3 g","29%"],["Saturated fat","5.2 g","1.6 g","7.1%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","1.3 mg","0.4 mg","0%"],["Dietary fibre","5.4 g","1.6 g","–"],["Iron","3.2 mg","1.0 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H021, walnut). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"ALMD":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","638 kcal","191 kcal","9.6%"],["Protein","18.4 g","5.5 g","–"],["Carbohydrate","3.0 g","0.9 g","–"],["Total sugars","2.2 g","0.7 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","58.5 g","17.5 g","26%"],["Saturated fat","4.4 g","1.3 g","5.9%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","1.5 mg","0.5 mg","0%"],["Dietary fibre","13.1 g","3.9 g","–"],["Iron","4.6 mg","1.4 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H001, almond). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"PIST":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","560 kcal","168 kcal","8.4%"],["Protein","23.4 g","7.0 g","–"],["Carbohydrate","15.8 g","4.7 g","–"],["Total sugars","7.9 g","2.4 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","42.5 g","12.7 g","19%"],["Saturated fat","4.0 g","1.2 g","5.5%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","6.9 mg","2.1 mg","0.1%"],["Dietary fibre","10.6 g","3.2 g","–"],["Iron","4.5 mg","1.4 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H018, pistachio nuts). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"PUMP":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","618 kcal","185 kcal","9.3%"],["Protein","30.2 g","9.1 g","–"],["Carbohydrate","10.7 g","3.2 g","–"],["Total sugars","1.4 g","0.4 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","49.1 g","14.7 g","22%"],["Saturated fat","8.7 g","2.6 g","12%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","7.0 mg","2.1 mg","0.1%"],["Dietary fibre","6.0 g","1.8 g","–"],["Iron","8.8 mg","2.6 mg","–"]],"src":"Values: USDA FoodData Central (seeds, pumpkin and squash seed kernels, dried). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"SUNF":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":30,"hh":"a handful","rows":[["Energy","610 kcal","183 kcal","9.1%"],["Protein","23.5 g","7.1 g","–"],["Carbohydrate","6.8 g","2.1 g","–"],["Total sugars","2.8 g","0.8 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","51.9 g","15.6 g","23%"],["Saturated fat","6.2 g","1.8 g","8.4%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","1.9 mg","0.6 mg","0%"],["Dietary fibre","10.8 g","3.2 g","–"],["Iron","5.8 mg","1.8 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H020, sunflower seeds). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"FLAX":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Store cool, dry; reseal after use.","serve":15,"hh":"1 tbsp","rows":[["Energy","492 kcal","74 kcal","3.7%"],["Protein","18.6 g","2.8 g","–"],["Carbohydrate","11.0 g","1.6 g","–"],["Total sugars","0.6 g","0.1 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","35.7 g","5.4 g","8.0%"],["Saturated fat","3.0 g","0.4 g","2.0%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","33 mg","4.9 mg","0.2%"],["Dietary fibre","26.2 g","3.9 g","–"],["Iron","5.4 mg","0.8 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (H014, linseeds). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"KORR":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Airtight jar once opened.","serve":50,"hh":"1/4 cup","rows":[["Energy","332 kcal","166 kcal","8.3%"],["Protein","12.3 g","6.2 g","–"],["Carbohydrate","60.9 g","30.4 g","–"],["Total sugars","1.3 g","0.7 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","4.3 g","2.1 g","3.2%"],["Saturated fat","0.2 g","0.1 g","0.5%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","3.0 mg","1.5 mg","0.1%"]],"src":"Values: NIN-ICMR Nutritive Value of Indian Foods; sugars, SFA, Na: IFCT 2017 (A017). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"RAGI":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Airtight jar once opened.","serve":50,"hh":"1/4 cup","rows":[["Energy","336 kcal","168 kcal","8.4%"],["Protein","7.2 g","3.6 g","–"],["Carbohydrate","66.8 g","33.4 g","–"],["Total sugars","0.3 g","0.2 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","1.9 g","1.0 g","1.4%"],["Saturated fat","0.3 g","0.2 g","0.7%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","4.8 mg","2.4 mg","0.1%"],["Dietary fibre","11.2 g","5.6 g","–"],["Iron","4.6 mg","2.3 mg","–"],["Calcium","364 mg","182 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (A010, ragi). Energy calculated per FSS (Labelling & Display) Regulations, 2020."},"RAJM":{"storage":"3-layer metallised pouch keeps out light, air and moisture. Airtight jar once opened.","serve":50,"hh":"1/4 cup","rows":[["Energy","323 kcal","162 kcal","8.1%"],["Protein","19.9 g","10.0 g","–"],["Carbohydrate","48.6 g","24.3 g","–"],["Total sugars","1.5 g","0.8 g","–"],["Added sugars","0 g","0 g","0%"],["Total fat","1.8 g","0.9 g","1.3%"],["Saturated fat","0.3 g","0.1 g","0.6%"],["Trans fat","0 g","0 g","0%"],["Cholesterol","0 mg","0 mg","–"],["Sodium","10 mg","5.2 mg","0.3%"],["Dietary fibre","16.6 g","8.3 g","–"],["Iron","6.1 mg","3.1 mg","–"]],"src":"Values: ICMR-NIN Indian Food Composition Tables 2017 (B020, rajmah, red). Energy calculated per FSS (Labelling & Display) Regulations, 2020."}};


const PACK_SECTIONS = [
  {
    id: "spices", eyebrow: "Spices", chip: "Spices",
    title: "Turmeric &amp; chilli, sun-dried and stone-ground",
    blurb: "Spice powders from Palnadu, Guntur and the Araku hills.",
    products: [
      { code: "TURM", name: "Turmeric Powder", te: "పసుపు", tr: "Pasupu", note: "Farm-sourced · sun-dried · stone-ground",
        origin: "Grown in Palnadu &amp; Guntur", pack: "assets/packs/turmeric-540g.jpg", by: "mfd", shelf: 12,
        ingredients: "Turmeric (Curcuma longa).",
        skus: [[270, 198], [540, 396, true], [1080, 702]] },
      { code: "KPAS", name: "Hill Turmeric Powder", te: "కొండ పసుపు", tr: "Konda Pasupu", note: "Whole hill turmeric fingers, packed as fine powder",
        origin: "Araku &amp; Maredumilli hills", pack: "assets/packs/hill-turmeric-540g.jpg", by: "mfd", shelf: 12,
        ingredients: "Turmeric (Curcuma longa).",
        skus: [[270, 252], [540, 495, true], [1080, 900]] },
      { code: "SANN", name: "Sannam Chilli Powder", te: "సన్నం కారం", tr: "Sannam Kaaram", note: "Whole sun-dried chillies, packed as fine powder",
        origin: "Grown in Palnadu &amp; Guntur", pack: "assets/packs/sannam-540g.jpg", by: "mfd", shelf: 12,
        ingredients: "Sannam red chillies (Capsicum annuum).",
        skus: [[180, 135], [270, 180], [540, 306, true]] },
      { code: "TEJA", name: "Teja Chilli Powder", te: "తేజ కారం", tr: "Teja Kaaram", note: "Extra hot · sun-dried · stone-ground",
        origin: "Grown in Palnadu &amp; Guntur", pack: "assets/packs/teja-540g.jpg", by: "mfd", shelf: 12,
        ingredients: "Teja red chillies (Capsicum annuum).",
        skus: [[180, 144], [270, 198], [540, 342, true]] },
    ],
  },
  {
    id: "jaggery", eyebrow: "Jaggery", chip: "Jaggery",
    title: "Desi jaggery, instead of white sugar",
    blurb: "Dark desi cane jaggery and palm jaggery from village makers in Andhra Pradesh.",
    products: [
      { code: "CBEL", name: "Cane Jaggery", te: "చెరుకు బెల్లం", tr: "Cheruku Bellam", note: "Village desi · dark · slow-boiled",
        origin: "Chittoor &amp; Anakapalli cane belts", pack: "assets/packs/cane-jaggery-540g.jpg", by: "packed", shelf: 9,
        ingredients: "Sugarcane jaggery.",
        skus: [[270, 108], [540, 234, true], [1080, 369]] },
      { code: "TBEL", name: "Palm Jaggery", te: "తాటి బెల్లం", tr: "Thati Bellam", note: "Village desi · palmyra sap",
        origin: "From the Godavari delta", pack: "assets/packs/palm-jaggery-540g.jpg", by: "packed", shelf: 9,
        ingredients: "Palmyra palm jaggery.",
        skus: [[270, 225], [540, 495, true], [1080, 711]] },
    ],
  },
  {
    id: "nuts", eyebrow: "Nuts", chip: "Nuts",
    title: "Whole kernels, plain and unsalted",
    blurb: "Cashews from the Andhra coast, plus walnuts, almonds and pistachios from select orchards.",
    products: [
      { code: "CASH", name: "Cashew Kernels", te: "జీడిపప్పు", tr: "Jeedipappu", note: "Whole kernels · plain · unsalted",
        origin: "Chirala · Bapatla · Vizag coast", pack: "assets/packs/cashew-540g.jpg", by: "packed", shelf: 6,
        ingredients: "Cashew kernels (Anacardium occidentale).", allergen: "Contains cashew (tree nut).",
        skus: [[90, 180], [180, 324], [270, 477], [540, 891, true]] },
      { code: "WALN", name: "Walnut Kernels", te: "అక్రోటు", tr: "Akrotu", note: "Kernels · plain",
        origin: "Sourced from select orchards", country: IMPORTED, by: "packed", shelf: 6,
        ingredients: "Walnut kernels (Juglans regia).", allergen: "Contains walnut (tree nut).",
        skus: [[90, 198], [180, 360], [270, 522], [540, 981]] },
      { code: "ALMD", name: "Almond Kernels", te: "బాదం", tr: "Badam", note: "Kernels · plain",
        origin: "Sourced from select orchards", country: IMPORTED, by: "packed", shelf: 6,
        ingredients: "Almond kernels (Prunus amygdalus).", allergen: "Contains almond (tree nut).",
        skus: [[90, 171], [180, 297], [270, 432], [540, 801]] },
      { code: "PIST", name: "Pistachio Kernels", te: "పిస్తా", tr: "Pista", note: "Shelled green kernels",
        origin: "Sourced from select orchards", country: IMPORTED, by: "packed", shelf: 6,
        ingredients: "Pistachio kernels (Pistacia vera).", allergen: "Contains pistachio (tree nut).",
        skus: [[90, 351], [180, 666], [270, 981], [540, 1899]] },
    ],
  },
  {
    id: "seeds", eyebrow: "Seeds", chip: "Seeds",
    title: "Everyday seeds",
    blurb: "Pumpkin, sunflower and flax seeds for salads, podis and breakfast bowls.",
    products: [
      { code: "PUMP", name: "Pumpkin Seeds", te: "గుమ్మడి గింజలు", tr: "Gummadi Ginjalu", note: "Kernels",
        origin: "Sourced from select farms", country: IMPORTED, by: "packed", shelf: 6,
        ingredients: "Pumpkin seed kernels (Cucurbita sp.).",
        skus: [[90, 126], [180, 225], [270, 315], [540, 567]] },
      { code: "SUNF", name: "Sunflower Seeds", te: "పొద్దుతిరుగుడు గింజలు", tr: "Poddu Tirugudu Ginjalu", note: "Hulled kernels",
        origin: "Grown in Rayalaseema", by: "packed", shelf: 6,
        ingredients: "Sunflower seed kernels (Helianthus annuus).",
        skus: [[90, 90], [180, 135], [270, 189], [540, 324]] },
      { code: "FLAX", name: "Flax Seeds", te: "అవిసె గింజలు", tr: "Avise Ginjalu", note: "Whole linseed",
        origin: "Sourced from select farms", country: IMPORTED, by: "packed", shelf: 6,
        ingredients: "Flax seeds / linseed (Linum usitatissimum).",
        skus: [[90, 72], [180, 99], [270, 135], [540, 207]] },
    ],
  },
  {
    id: "millets", eyebrow: "Millets &amp; rajma", chip: "Millets",
    title: "Millets &amp; hill rajma",
    blurb: "Foxtail millet from Rayalaseema, ragi from Uttarandhra, and rajma from the Araku hills.",
    products: [
      { code: "KORR", name: "Foxtail Millet", te: "కొర్రలు", tr: "Korralu", note: "Village desi · siridhanyam",
        origin: "Grown in Rayalaseema", by: "packed", shelf: 6,
        ingredients: "Foxtail Millet (Setaria italica).",
        skus: [[1080, 261]] },
      { code: "RAGI", name: "Finger Millet", te: "రాగులు", tr: "Ragulu", note: "Village desi · siridhanyam",
        origin: "Grown in Uttarandhra", by: "packed", shelf: 6,
        ingredients: "Finger Millet / Ragi (Eleusine coracana).",
        skus: [[1080, 180]] },
      { code: "RAJM", name: "Red Kidney Beans", te: "రాజ్మా", tr: "Rajma", note: "Whole beans",
        origin: "Grown in the Araku hills", by: "packed", shelf: 9,
        ingredients: "Rajma / red kidney beans (Phaseolus vulgaris).",
        skus: [[1080, 405]] },
    ],
  },
];

const MORE_SECTIONS = [
  {
    id: "more-grains",
    eyebrow: "Rice & more millets",
    title: "Village grains & forgotten millets",
    blurb: "Village rice varieties and the millets (siridhanyalu) our grandparents grew.",
    products: [
      { name: "Sona Masuri Rice",            unit: "1 kg / 5 kg",  emoji: "🍚" },
      { name: "Brown Rice",                  unit: "1 kg",         emoji: "🍚" },
      { name: "Red Rice",                    unit: "1 kg",         emoji: "🍚", tag: "Village" },
      { name: "Little Millet (Samalu)",      unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Barnyard Millet (Udalu)",     unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Kodo Millet (Arikelu)",       unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Pearl Millet (Sajjalu)",      unit: "1 kg",         emoji: "🌾" },
      { name: "Poha (Atukulu)",              unit: "500 g",        emoji: "🥣" },
      { name: "Whole Wheat",                 unit: "1 kg / 5 kg",  emoji: "🌾" },
    ],
  },
  {
    id: "pulses",
    eyebrow: "Pulses & legumes",
    title: "Everyday dals",
    blurb: "The dals and desi legumes your kitchen runs on.",
    products: [
      { name: "Toor Dal (Kandi Pappu)",   unit: "500 g / 1 kg", emoji: "🟡" },
      { name: "Moong Dal (Pesara Pappu)", unit: "500 g / 1 kg", emoji: "🟢" },
      { name: "Urad Dal (Minapa Pappu)",  unit: "500 g / 1 kg", emoji: "⚪" },
      { name: "Chana Dal",                unit: "500 g / 1 kg", emoji: "🟡" },
      { name: "Masoor Dal",               unit: "500 g / 1 kg", emoji: "🟠" },
      { name: "Horse Gram (Ulavalu)",     unit: "500 g / 1 kg", emoji: "🟤", tag: "Village" },
      { name: "Cowpea (Bobbarlu)",        unit: "500 g / 1 kg", emoji: "🫘" },
    ],
  },
  {
    id: "podis",
    eyebrow: "More spices & podis",
    title: "Andhra spices &amp; podis",
    blurb: "Whole spices, tamarind and the Andhra podis.",
    products: [
      { name: "Coriander (Dhania)",      unit: "250 g",  emoji: "🌿" },
      { name: "Cumin (Jeera)",           unit: "200 g",  emoji: "🟤" },
      { name: "Black Pepper",            unit: "100 g",  emoji: "⚫" },
      { name: "Mustard Seeds",           unit: "200 g",  emoji: "🟡" },
      { name: "Dry Ginger (Sonti)",      unit: "100 g",  emoji: "🫚" },
      { name: "Tamarind",                unit: "500 g",  emoji: "🟤" },
      { name: "Idli Karam Podi",         unit: "200 g",  emoji: "🥣", tag: "Small batch" },
      { name: "Curry-leaf Podi",         unit: "200 g",  emoji: "🥣" },
      { name: "Flaxseed Podi",           unit: "200 g",  emoji: "🥣" },
    ],
  },
  {
    id: "oils",
    eyebrow: "Chekku oils",
    title: "Wood-pressed oils",
    blurb: "Chekku / ganuga oils, pressed in small batches.",
    products: [
      { name: "Groundnut Oil",                unit: "1 litre", emoji: "🫗" },
      { name: "Sesame / Gingelly Oil",        unit: "1 litre", emoji: "🫗", tag: "Nuvvula nune" },
      { name: "Coconut Oil",                  unit: "1 litre", emoji: "🥥" },
      { name: "Sunflower Oil",                unit: "1 litre", emoji: "🌻" },
    ],
  },
  {
    id: "honey-ghee",
    eyebrow: "Honey &amp; ghee",
    title: "Forest honey &amp; ghee",
    blurb: "Forest honey from the hills, and cow ghee.",
    products: [
      { name: "Forest Honey",               unit: "500 g",  emoji: "🍯", tag: "Forest" },
      { name: "Cow Ghee",                   unit: "500 ml", emoji: "🧈" },
    ],
  },
  {
    id: "dried",
    eyebrow: "Dried fruit &amp; more seeds",
    title: "Dried fruit &amp; seeds",
    blurb: "Dried fruit and edible seeds.",
    products: [
      { name: "Dried Fig",            unit: "200 g", emoji: "🫐" },
      { name: "Dried Mango",          unit: "200 g", emoji: "🥭" },
      { name: "Dried Lemon Slices",   unit: "100 g", emoji: "🍋" },
      { name: "Dates",                unit: "500 g", emoji: "🌴" },
      { name: "Chia Seeds",           unit: "200 g", emoji: "⚫" },
      { name: "Sesame Seeds (Nuvvulu)",unit: "200 g",emoji: "⚪" },
    ],
  },
  {
    id: "teas",
    eyebrow: "Herbal teas &amp; botanicals",
    title: "Caffeine-free, flower &amp; leaf",
    blurb: "Edible flowers and leaves, dried for teas and infusions.",
    products: [
      { name: "Butterfly Pea (Blue Tea)", unit: "50 g",  emoji: "🌸", tag: "House blend" },
      { name: "Dried Rose Petals",        unit: "50 g",  emoji: "🌹" },
      { name: "Chamomile",                unit: "50 g",  emoji: "🌼" },
      { name: "Hibiscus",                 unit: "50 g",  emoji: "🌺" },
      { name: "Lemongrass",               unit: "50 g",  emoji: "🌿" },
      { name: "Moringa Leaf Powder",      unit: "100 g", emoji: "🍃" },
      { name: "Tulsi Leaf",               unit: "50 g",  emoji: "🌿" },
    ],
  },
  {
    id: "pickles",
    eyebrow: "Pickles &amp; preserves",
    title: "Small-batch Andhra pickles",
    blurb: "Avakaya, gongura and more — made in small batches with our own chillies.",
    products: [
      { name: "Mango Avakaya",     unit: "250 g / 500 g", emoji: "🥭", tag: "Andhra classic" },
      { name: "Gongura Pickle",    unit: "250 g / 500 g", emoji: "🫙" },
      { name: "Lemon Pickle",      unit: "250 g / 500 g", emoji: "🍋" },
      { name: "Tomato Pickle",     unit: "250 g / 500 g", emoji: "🍅" },
      { name: "Garlic Pickle",     unit: "250 g",         emoji: "🧄" },
      { name: "Red Chilli Pickle", unit: "250 g",         emoji: "🌶️" },
    ],
  },
  {
    id: "care",
    eyebrow: "Home &amp; care",
    title: "Care, beyond the kitchen",
    blurb: "Village ways to wash and bathe, made from plants.",
    products: [
      { name: "Soap Nuts (Kunkudukayalu)",  unit: "250 g", emoji: "🟤", tag: "Plant wash" },
      { name: "Karakkaya",                  unit: "250 g", emoji: "🌰" },
      { name: "Shikakai (Seekakaya)",       unit: "200 g", emoji: "🌿" },
      { name: "Hibiscus Hair Powder",       unit: "100 g", emoji: "🌺" },
      { name: "Sunnipindi (Bath Powder)",   unit: "200 g", emoji: "🛁", tag: "Village" },
      { name: "Neem Powder",                unit: "100 g", emoji: "🌿" },
    ],
  },
  {
    id: "soil",
    eyebrow: "For your soil",
    title: "Feed your soil like we feed ours",
    blurb: "Vermicompost and farm inputs for your garden.",
    products: [
      { name: "Vermicompost",           unit: "5 kg / 25 kg", emoji: "🪱", tag: "Our own" },
      { name: "Vermiwash",              unit: "1 litre",      emoji: "🧴" },
      { name: "Neem Cake",              unit: "1 kg",         emoji: "🌿" },
      { name: "Jeevamrutham",           unit: "5 litres",     emoji: "🪣" },
      { name: "Dried Cow-dung Cakes",   unit: "Pack of 12",   emoji: "🟤" },
    ],
  },
];


// ---------------------------------------------------------
// Engine — usually no need to edit below.
// ---------------------------------------------------------

const slug = (s) => s.toLowerCase().replace(/&amp;/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const inr = (n) => "₹" + n.toLocaleString("en-IN");
const qtyLabel = (g) => g + " g";   // keep the sums-to-nine numbers as printed (1080 g, not 1.08 kg)
// Legal Metrology (Packaged Commodities) r.6(11): per g below 1 kg, per kg from 1 kg, 2 decimals.
const unitPrice = (g, mrp) => g >= 1000 ? `₹${(mrp / (g / 1000)).toFixed(2)} per kg` : `₹${(mrp / g).toFixed(2)} per g`;
const skuCode = (p, g) => `1AF-${p.code}-${String(g).padStart(4, "0")}`;

// Category photos for the made-to-order range (cycled). Add more anytime.
const CATEGORY_IMAGES = {
  "more-grains": ["assets/products/grains-1.jpg","assets/products/grains-2.jpg","assets/products/grains-3.jpg"],
  pulses: ["assets/products/pulses-1.jpg","assets/products/pulses-2.jpg"],
  podis: ["assets/products/spices-1.jpg","assets/products/spices-2.jpg"],
  oils: ["assets/products/oils-1.jpg","assets/products/oils-2.jpg"],
  "honey-ghee": ["assets/products/sweeteners-2.jpg","assets/products/sweeteners-3.jpg"],
  dried: ["assets/products/dried-1.jpg","assets/products/dried-3.jpg"],
  teas: ["assets/products/teas-1.jpg","assets/products/teas-2.jpg"],
  pickles: ["assets/products/pickles-1.jpg","assets/products/pickles-2.jpg"],
  care: ["assets/products/care-1.jpg","assets/products/care-2.jpg"],
  soil: ["assets/products/soil-1.jpg","assets/products/soil-2.jpg"],
};

const PRODUCTS = {};
PACK_SECTIONS.forEach((s) => s.products.forEach((p) => {
  p.id = "pk-" + p.code.toLowerCase();
  p.skus = p.skus.map(([g, mrp, live]) => ({ g, mrp, live: !!live }));
  p.live = p.skus.some((k) => k.live);
  p.sel = (p.skus.find((k) => k.live) || p.skus[0]).g;   // default size = the printed one
  PRODUCTS[p.id] = p;
}));
let _mi = 0;
MORE_SECTIONS.forEach((s) => {
  const imgs = CATEGORY_IMAGES[s.id] || [];
  s.products.forEach((p, i) => {
    p.id = s.id + "-" + slug(p.name);
    p.media = MEDIA[_mi++ % MEDIA.length];
    if (!p.img && imgs.length) p.img = imgs[i % imgs.length];
    PRODUCTS[p.id] = p;
  });
});

// ---- Order state (persisted). Key = productId, or productId@grams for packs ----
let cart = {};
try { cart = JSON.parse(localStorage.getItem("oneacre_cart_v2") || "{}"); } catch (e) { cart = {}; }
const saveCart = () => { try { localStorage.setItem("oneacre_cart_v2", JSON.stringify(cart)); } catch (e) {} };
function lineOf(key) {
  const [id, g] = key.split("@");
  const p = PRODUCTS[id]; if (!p) return null;
  const sku = g ? p.skus.find((k) => k.g === +g) : null;
  if (g && !sku) return null;
  return { p, sku };
}

const VISIBLE_PER_SECTION = 6; // made-to-order cards shown before "Show all"

const CHIP_LABELS = {
  "more-grains": "Rice & Millets", pulses: "Pulses", podis: "Podis", oils: "Oils",
  "honey-ghee": "Honey & Ghee", dried: "Dried Fruit", teas: "Herbal Teas",
  pickles: "Pickles", care: "Home & Care", soil: "For Your Soil",
};

function renderChipNav() {
  const nav = document.getElementById("chipNav");
  if (!nav) return;
  nav.innerHTML =
    PACK_SECTIONS.map((s) => `<a class="chip" href="#${s.id}" data-chip="${s.id}">${s.chip}</a>`).join("") +
    `<span class="chip-sep" aria-hidden="true"></span>` +
    MORE_SECTIONS.map((s) => `<a class="chip chip-more" href="#${s.id}" data-chip="${s.id}">${CHIP_LABELS[s.id] || s.eyebrow}</a>`).join("");
}

function sectionHead(s) {
  return `
        <div class="section-head">
          <div>
            <p class="eyebrow">${s.eyebrow}</p>
            <h2>${s.title}</h2>
          </div>
          <p>${s.blurb}</p>
        </div>`;
}

function renderCatalog() {
  const root = document.getElementById("catalog");
  const packs = PACK_SECTIONS.map((s) => `
    <section class="section" id="${s.id}">
      <div class="container">${sectionHead(s)}
        <div class="grid grid-packs">${s.products.map(packCard).join("")}</div>
      </div>
    </section>`).join("");
  const divider = `
    <section class="more-intro" id="pantry">
      <div class="container">
        <p class="eyebrow">Made to order</p>
        <h2>More from the pantry</h2>
        <p>Small batches we pack on request. Add what you need and we'll confirm price, sizes and availability on WhatsApp.</p>
      </div>
    </section>`;
  const more = MORE_SECTIONS.map((s) => {
    const extra = s.products.length - VISIBLE_PER_SECTION;
    const showAll = extra > 0
      ? `<div class="show-all-row"><button class="show-all" data-showall="${s.id}">Show all ${s.products.length} →</button></div>`
      : "";
    return `
    <section class="section" id="${s.id}">
      <div class="container">${sectionHead(s)}
        <div class="grid" data-grid="${s.id}">${s.products.map((p, i) => moreCard(p, i >= VISIBLE_PER_SECTION)).join("")}</div>
        ${showAll}
      </div>
    </section>`;
  }).join("");
  root.innerHTML = packs + divider + more;
}

function packMedia(p) {
  if (p.pack) {
    const g = p.skus.find((k) => k.live).g;
    return `<div class="pack-media"><img src="${p.pack}" alt="${p.name} ${g} g pack — front" loading="lazy" width="800" height="1122" /></div>
      <p class="pack-caption"><b>New pack</b> · shown: ${g} g</p>`;
  }
  // No printed pack yet: a plain name tile in the pack colours (no stand-in photo).
  return `<div class="pack-media pack-tile">
      <span class="pt-brand"><span class="one">1</span>acrefarms</span>
      <span class="pt-name">${p.name}</span>
      <span class="pt-te" lang="te">${p.te}</span>
      <span class="pt-origin">${p.origin}</span>
    </div>
    <p class="pack-caption">Pack in print</p>`;
}

function nutritionTable(p, sku) {
  const f = PACK_FACTS[p.code];
  if (!f) return "";
  const body = f.rows.map(([label, per100, perServe, rda]) => {
    const sub = /^(Total sugars|Added sugars|Saturated fat|Trans fat)$/.test(label) ? ' class="sub"' : "";
    return `<tr${sub}><th scope="row">${label}</th><td>${per100}</td><td>${perServe}</td><td>${rda}</td></tr>`;
  }).join("");
  return `<div class="nutri">
      <p class="nutri-title">Nutritional information</p>
      <p class="nutri-serve">Serving size ${f.serve} g (${f.hh}) · Servings per pack: ${Math.round(sku.g / f.serve)}</p>
      <table>
        <thead><tr><th scope="col"><span class="vh">Nutrient</span></th><th scope="col">per 100 g</th><th scope="col">per serve</th><th scope="col">%RDA</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="nutri-note">%RDA = share of the Recommended Dietary Allowance per serve, on a 2000 kcal adult diet. ${f.src}</p>
    </div>`;
}

function packCard(p) {
  const sku = p.skus.find((k) => k.g === p.sel);
  const sizes = p.skus.length > 1
    ? `<div class="sizes" role="radiogroup" aria-label="Pack size">${p.skus.map((k) =>
        `<button class="size${k.g === p.sel ? " on" : ""}" role="radio" aria-checked="${k.g === p.sel}" data-size="${p.id}@${k.g}">${qtyLabel(k.g)}</button>`).join("")}</div>`
    : `<div class="sizes"><span class="size on solo">${qtyLabel(sku.g)}</span></div>`;
  const status = sku.live
    ? `<span class="avail live">First batch · packing now</span>`
    : `<span class="avail pre">Pre-order · pack in print</span>`;
  const by = MAKER[p.by];
  return `
    <article class="card pack-card" id="${p.id}">
      <div class="card-media-wrap">${packMedia(p)}</div>
      <div class="card-body">
        <h3 class="card-name">${p.name}</h3>
        <p class="card-te"><span lang="te">${p.te}</span> · ${p.tr}</p>
        <p class="card-note">${p.note}</p>
        <p class="card-origin">${p.origin}</p>
        ${sizes}
        <div class="price-row">
          ${offerPrice(p, sku)
            ? `<span class="mrp offer"><small>MRP</small> <s>${inr(sku.mrp)}</s> ${inr(offerPrice(p, sku))}</span>
               <span class="save">Save ${inr(sku.mrp - offerPrice(p, sku))}</span>`
            : `<span class="mrp"><small>MRP</small> ${inr(sku.mrp)}</span>`}
          <span class="upp">${unitPrice(sku.g, sku.mrp)}</span>
        </div>
        ${offerPrice(p, sku) ? `<p class="offer-tag">${OFFER.label} · on WhatsApp &amp; this website</p>` : ""}
        <p class="tax">Incl. of all taxes · ${status}</p>
        <div class="card-foot"><button class="add-btn block" data-add="${p.id}@${sku.g}">Add ${qtyLabel(sku.g)} +</button></div>
        <details class="facts">
          <summary>Product details</summary>
          <dl>
            <dt>Ingredients</dt><dd>${p.ingredients}</dd>
            ${p.allergen ? `<dt>Allergen</dt><dd>${p.allergen}</dd>` : ""}
            <dt>Net quantity</dt><dd>${qtyLabel(sku.g)} · SKU ${skuCode(p, sku.g)}</dd>
            <dt>Best before</dt><dd>${p.shelf} months from packing</dd>
            ${PACK_FACTS[p.code] ? `<dt>Storage</dt><dd>${PACK_FACTS[p.code].storage}</dd>` : ""}
            <dt>${by}</dt><dd>${MAKER.address}</dd>
            <dt>Country of origin</dt><dd>${p.country || "India"}</dd>
            <dt>Customer care</dt><dd>WhatsApp +91 78999 29779 · 1acrefarmsindia@gmail.com</dd>
          </dl>
          ${nutritionTable(p, sku)}
        </details>
      </div>
    </article>`;
}

function moreCard(p, hidden) {
  const tag = p.tag ? `<span class="card-tag">${p.tag}</span>` : "";
  const media = p.img
    ? `<div class="card-media has-photo" style="background:${p.media};background-image:url('${p.img}')"></div>`
    : `<div class="card-media" style="background:${p.media}"><span class="card-emoji">${p.emoji}</span></div>`;
  return `
    <article class="card${hidden ? " hidden-extra" : ""}">
      <div class="card-media-wrap">${media}${tag}</div>
      <div class="card-body">
        <h3 class="card-name">${p.name}</h3>
        <p class="card-unit">${p.unit || ""} · price on request</p>
        <div class="card-foot"><button class="add-btn block ghost" data-add="${p.id}">Add to enquiry +</button></div>
      </div>
    </article>`;
}

function rerenderPack(id) {
  const el = document.getElementById(id);
  const open = el.querySelector("details.facts")?.open;
  el.outerHTML = packCard(PRODUCTS[id]);
  if (open) document.querySelector(`#${id} details.facts`).open = true;
}

function addToCart(key) { if (!lineOf(key)) return; cart[key] = (cart[key] || 0) + 1; saveCart(); renderCart(); bump(); }
function setQty(key, d) { cart[key] = (cart[key] || 0) + d; if (cart[key] <= 0) delete cart[key]; saveCart(); renderCart(); }
function cartCount() { return Object.values(cart).reduce((a, b) => a + b, 0); }

function renderCart() {
  Object.keys(cart).forEach((k) => { if (!lineOf(k)) delete cart[k]; });
  const n = cartCount();
  document.getElementById("cartCount").textContent = n;
  const bar = document.getElementById("orderBar");
  if (bar) {
    bar.classList.toggle("visible", n > 0);
    document.getElementById("obCount").textContent = n + (n === 1 ? " item" : " items");
  }
  const items = document.getElementById("cartItems");
  const keys = Object.keys(cart);
  let total = 0, priced = 0, enquiry = 0;
  if (!keys.length) {
    items.innerHTML = `<div class="cart-empty">Your order is empty.<br>Add something from the village.</div>`;
  } else {
    items.innerHTML = keys.map((key) => {
      const { p, sku } = lineOf(key);
      const q = cart[key];
      let media, unit, price = "";
      if (sku) {
        total += sellPrice(p, sku) * q; priced += q;
        media = p.pack
          ? `<div class="cart-line-media pack" style="background-image:url('${p.pack}')"></div>`
          : `<div class="cart-line-media pack-mini">${p.te}</div>`;
        unit = `${qtyLabel(sku.g)} · ${sku.live ? "first batch" : "pre-order"}`;
        price = `<div class="cart-line-price">${inr(sellPrice(p, sku) * q)}</div>`;
      } else {
        enquiry += q;
        media = p.img
          ? `<div class="cart-line-media" style="background:${p.media};background-image:url('${p.img}')"></div>`
          : `<div class="cart-line-media" style="background:${p.media}">${p.emoji}</div>`;
        unit = `${p.unit || ""} · price on request`;
      }
      return `
        <div class="cart-line">
          ${media}
          <div class="cart-line-info">
            <div class="cart-line-name">${p.name}</div>
            <div class="cart-line-unit">${unit}</div>
            <div class="qty">
              <button data-dec="${key}" aria-label="One less">−</button><span>${q}</span><button data-inc="${key}" aria-label="One more">+</button>
            </div>
          </div>
          ${price}
        </div>`;
    }).join("");
  }
  const tot = document.getElementById("cartTotal");
  if (tot) {
    tot.hidden = !priced;
    tot.innerHTML = `<div class="ct-row"><span>Packs (${offerOn() ? "offer prices" : "MRP"}, incl. of all taxes)</span><span>${inr(total)}</span></div>
      <div class="ct-row"><span>Delivery</span><span class="ct-free">Free</span></div>
      <div class="ct-row ct-grand"><span>Total to pay${enquiry ? " for packs" : ""}</span><strong>${inr(total)}</strong></div>`;
  }
  renderPay(total, priced, keys.length);
  const note = document.getElementById("cartNote");
  if (note) note.textContent = enquiry
    ? "Free delivery across India. We'll confirm prices for made-to-order items on WhatsApp before you pay."
    : "Free delivery across India. We confirm every order on WhatsApp before dispatch.";
}

function renderPay(total, priced, lines) {
  const box = document.getElementById("cartPin");
  const res = document.getElementById("pinResult");
  const btn = document.getElementById("checkoutBtn");
  if (!box) { btn.disabled = !lines; return; }
  box.hidden = !lines;
  const input = document.getElementById("pinInput");
  if (input && input.value !== pin) input.value = pin;
  const pay = paymentFor(pin, total);
  const choose = document.getElementById("payChoice");
  if (!pay) {
    res.textContent = pin.length ? "Please enter a valid 6-digit pincode." : "Enter your pincode to see payment options.";
    res.className = "pin-result";
    choose.hidden = true;
    btn.disabled = true;
    return;
  }
  btn.disabled = !lines;
  if (!priced) {                        // only made-to-order items: price comes later
    res.textContent = `Free delivery to ${pin}. We'll confirm the price and payment on WhatsApp.`;
    res.className = "pin-result ok"; choose.hidden = true; return;
  }
  if (pay.cod) {
    res.textContent = `Free delivery to ${pin}. Pay on delivery or by UPI.`;
    res.className = "pin-result ok";
    choose.hidden = false;
    choose.querySelectorAll("input").forEach((r) => { r.checked = r.value === payChoice; });
  } else {
    res.textContent = pay.why === "area"
      ? `Free delivery to ${pin}. For this pincode we take payment by UPI before dispatch.`
      : `Free delivery to ${pin}. Pay on delivery is for orders up to ${inr(pay.cap)} in your area, so this order is paid by UPI before dispatch.`;
    res.className = "pin-result upi";
    choose.hidden = true;
  }
}

function bump() {
  const c = document.getElementById("cartCount");
  c.animate([{ transform: "scale(1)" }, { transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 280 });
  openCart();
}

const drawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("cartOverlay");
function openCart() { drawer.classList.add("open"); overlay.classList.add("open"); }
function closeCart() { drawer.classList.remove("open"); overlay.classList.remove("open"); }

function checkout() {
  const keys = Object.keys(cart);
  if (!keys.length) return;
  const lines = ["Hi 1acrefarms! 🌿 I'd like to order:", ""];
  let total = 0, enquiry = false;
  keys.forEach((key) => {
    const { p, sku } = lineOf(key); const q = cart[key];
    if (sku) {
      const each = sellPrice(p, sku);
      total += each * q;
      lines.push(`• ${q} × ${p.name} ${qtyLabel(sku.g)} @ ${inr(each)}${offerPrice(p, sku) ? ` (offer; MRP ${inr(sku.mrp)})` : ""} = ${inr(each * q)}${sku.live ? "" : " (pre-order)"} [${skuCode(p, sku.g)}]`);
    } else {
      enquiry = true;
      lines.push(`• ${q} × ${p.name}${p.unit ? " (" + p.unit + ")" : ""} — price on request`);
    }
  });
  if (total) lines.push("", `Packs total (${offerOn() ? OFFER.label : "MRP"}): ${inr(total)}`, "Delivery: Free", `Total to pay: ${inr(total)}`);
  const pay = paymentFor(pin, total);
  lines.push("", `Delivery pincode: ${pin}`);
  if (total && pay) lines.push(`Payment: ${pay.cod ? (payChoice === "cod" ? "Pay on delivery" : "UPI (please send your UPI details)") : "UPI before dispatch (please send your UPI details)"}`);
  lines.push("", enquiry ? "Please confirm prices for the made-to-order items, and availability." : "Please confirm availability.",
             "", "Name:", "Address:", "Notes:");
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
}

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  const size = e.target.closest("[data-size]");
  const showall = e.target.closest("[data-showall]");
  if (add) addToCart(add.dataset.add);
  if (inc) setQty(inc.dataset.inc, +1);
  if (dec) setQty(dec.dataset.dec, -1);
  if (size) {
    const [id, g] = size.dataset.size.split("@");
    PRODUCTS[id].sel = +g; rerenderPack(id);
    document.querySelector(`[data-size="${id}@${g}"]`)?.focus();
  }
  if (showall) {
    const id = showall.dataset.showall;
    document.querySelectorAll(`[data-grid="${id}"] .hidden-extra`).forEach((el) => el.classList.remove("hidden-extra"));
    showall.closest(".show-all-row").remove();
  }
});
const pinInput = document.getElementById("pinInput");
if (pinInput) pinInput.addEventListener("input", () => {
  pin = pinInput.value.replace(/[^0-9]/g, "").slice(0, 6);
  if (pinInput.value !== pin) pinInput.value = pin;
  try { localStorage.setItem("oneacre_pin", pin); } catch (e) {}
  renderCart();
});
const payBox = document.getElementById("payChoice");
if (payBox) payBox.addEventListener("change", (e) => { if (e.target.name === "pay") payChoice = e.target.value; });
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("cartClose").addEventListener("click", closeCart);
document.getElementById("checkoutBtn").addEventListener("click", checkout);
document.getElementById("orderBar").addEventListener("click", openCart);
overlay.addEventListener("click", closeCart);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });

document.getElementById("footerWhatsapp").href = `https://wa.me/${WHATSAPP_NUMBER}`;
const ctaWa = document.getElementById("ctaWhatsapp");
if (ctaWa) ctaWa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi 1acrefarms! Please add me to your harvest updates.")}`;
document.getElementById("year").textContent = new Date().getFullYear();

// highlight active category chip while scrolling
const chipObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) {
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.chip === en.target.id));
    }
  });
}, { rootMargin: "-20% 0px -70% 0px" });

renderChipNav();
renderCatalog();
renderCart();
document.querySelectorAll(".section[id]").forEach((s) => chipObserver.observe(s));

/* ---------------------------------------------------------
   NEW PACK PRINTED? Add its front to assets/packs/, set "pack"
   on the product and mark the printed size live:true in "skus".
   PRICE CHANGE? Edit the MRP in "skus" — keep the Rule of Nine.
   --------------------------------------------------------- */
