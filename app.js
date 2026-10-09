/* =========================================================
   1acrefarms — storefront logic
   PACKS  = our own printed packs (from the SKU Master sheet,
            "1acrefarms catalogue 2026-09-23", 49 SKUs). Fixed MRPs.
   MORE_SECTIONS = the wider pantry, made to order: price &
            sizes confirmed on WhatsApp.
   Checkout = WhatsApp order, pay on delivery.
   ========================================================= */

const WHATSAPP_NUMBER = "917899929779"; // 91 (India) + 7899929779 — WhatsApp Business number

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
      { code: "CBEL", name: "Cane Jaggery Powder", te: "చెరుకు బెల్లం", tr: "Cheruku Bellam", note: "Village desi · dark · slow-boiled",
        origin: "Chittoor &amp; Anakapalli cane belts", pack: "assets/packs/cane-jaggery-540g.jpg", by: "packed", shelf: 9,
        ingredients: "Sugarcane jaggery.",
        skus: [[270, 108], [540, 234, true], [1080, 369]] },
      { code: "TBEL", name: "Palm Jaggery Powder", te: "తాటి బెల్లం", tr: "Thati Bellam", note: "Village desi · palmyra sap",
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
          <span class="mrp"><small>MRP</small> ${inr(sku.mrp)}</span>
          <span class="upp">${unitPrice(sku.g, sku.mrp)}</span>
        </div>
        <p class="tax">Incl. of all taxes · ${status}</p>
        <div class="card-foot"><button class="add-btn block" data-add="${p.id}@${sku.g}">Add ${qtyLabel(sku.g)} +</button></div>
        <details class="facts">
          <summary>Product details</summary>
          <dl>
            <dt>Ingredients</dt><dd>${p.ingredients}</dd>
            ${p.allergen ? `<dt>Allergen</dt><dd>${p.allergen}</dd>` : ""}
            <dt>Net quantity</dt><dd>${qtyLabel(sku.g)} · SKU ${skuCode(p, sku.g)}</dd>
            <dt>Best before</dt><dd>${p.shelf} months from packing</dd>
            <dt>${by}</dt><dd>${MAKER.address}</dd>
            <dt>Country of origin</dt><dd>${p.country || "India"}</dd>
            <dt>Customer care</dt><dd>WhatsApp +91 78999 29779 · 1acrefarmsindia@gmail.com</dd>
          </dl>
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
        total += sku.mrp * q; priced += q;
        media = p.pack
          ? `<div class="cart-line-media pack" style="background-image:url('${p.pack}')"></div>`
          : `<div class="cart-line-media pack-mini">${p.te}</div>`;
        unit = `${qtyLabel(sku.g)} · ${sku.live ? "first batch" : "pre-order"}`;
        price = `<div class="cart-line-price">${inr(sku.mrp * q)}</div>`;
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
    tot.innerHTML = `<span>Packs total (MRP)</span><strong>${inr(total)}</strong>`;
  }
  const note = document.getElementById("cartNote");
  if (note) note.textContent = enquiry
    ? "We'll confirm prices for made-to-order items, and any delivery charge, on WhatsApp. Pay on delivery."
    : "We'll confirm your order and any delivery charge on WhatsApp. Pay on delivery.";
  document.getElementById("checkoutBtn").disabled = !keys.length;
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
      total += sku.mrp * q;
      lines.push(`• ${q} × ${p.name} ${qtyLabel(sku.g)} @ ${inr(sku.mrp)} = ${inr(sku.mrp * q)}${sku.live ? "" : " (pre-order)"} [${skuCode(p, sku.g)}]`);
    } else {
      enquiry = true;
      lines.push(`• ${q} × ${p.name}${p.unit ? " (" + p.unit + ")" : ""} — price on request`);
    }
  });
  if (total) lines.push("", `Packs total (MRP): ${inr(total)}`);
  lines.push("", enquiry ? "Please confirm prices for the made-to-order items, availability and delivery." : "Please confirm availability and delivery.",
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
