/* =========================================================
   1acrefarms — storefront logic
   EDIT ME: WhatsApp number + products below.
   Ordering is ENQUIRY-based: customers build an order and send it
   on WhatsApp; price & availability are confirmed in chat.
   (To show fixed prices later, add "price" to each product and
    set ENQUIRY_MODE = false.)
   ========================================================= */

const WHATSAPP_NUMBER = "917899929779"; // 91 (India) + 7899929779 — WhatsApp Business number
const ENQUIRY_MODE = true;

// soft "kraft" tile colours, cycled across products
const MEDIA = ["#e9e2d2","#e7efd9","#f6e3cf","#fdf3da","#f3ddd6","#eef2e6","#f1e8d6","#f6e7cf"];

const SECTIONS = [
  {
    id: "grains",
    eyebrow: "Grains & millets",
    title: "Unpolished grains & forgotten millets",
    blurb: "Rice the way it used to be — unpolished and hand-processed — and the millets (siridhanyalu) our grandparents grew.",
    products: [
      { name: "Sona Masuri Rice",            unit: "1 kg / 5 kg",  emoji: "🍚" },
      { name: "Brown Rice",                  unit: "1 kg",         emoji: "🍚" },
      { name: "Hand-pounded Red Rice",       unit: "1 kg",         emoji: "🍚", tag: "Traditional" },
      { name: "Foxtail Millet (Korralu)",    unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Little Millet (Samalu)",      unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Barnyard Millet (Udalu)",     unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Kodo Millet (Arikelu)",       unit: "500 g / 1 kg", emoji: "🌾" },
      { name: "Finger Millet / Ragi",        unit: "1 kg",         emoji: "🟤" },
      { name: "Pearl Millet (Sajjalu)",      unit: "1 kg",         emoji: "🌾" },
      { name: "Poha (Atukulu)",              unit: "500 g",        emoji: "🥣" },
      { name: "Whole Wheat",                 unit: "1 kg / 5 kg",  emoji: "🌾" },
    ],
  },
  {
    id: "pulses",
    eyebrow: "Pulses & legumes",
    title: "Everyday dals, grown clean",
    blurb: "The dals and traditional legumes your kitchen runs on — no polish, no chemicals.",
    products: [
      { name: "Toor Dal (Kandi Pappu)",   unit: "500 g / 1 kg", emoji: "🟡" },
      { name: "Moong Dal (Pesara Pappu)", unit: "500 g / 1 kg", emoji: "🟢" },
      { name: "Urad Dal (Minapa Pappu)",  unit: "500 g / 1 kg", emoji: "⚪" },
      { name: "Chana Dal",                unit: "500 g / 1 kg", emoji: "🟡" },
      { name: "Masoor Dal",               unit: "500 g / 1 kg", emoji: "🟠" },
      { name: "Horse Gram (Ulavalu)",     unit: "500 g / 1 kg", emoji: "🟤", tag: "Traditional" },
      { name: "Cowpea (Bobbarlu)",        unit: "500 g / 1 kg", emoji: "🫘" },
      { name: "Rajma",                    unit: "500 g / 1 kg", emoji: "🔴" },
    ],
  },
  {
    id: "spices",
    eyebrow: "Spices & podis",
    title: "Hand-pounded &amp; unadulterated",
    blurb: "Real spices — including our Guntur chillies — plus the Andhra podis, ground the traditional way.",
    products: [
      { name: "Turmeric (Pasupu)",       unit: "250 g",  emoji: "🟡" },
      { name: "Guntur Red Chilli",       unit: "250 g",  emoji: "🌶️", tag: "Guntur" },
      { name: "Red Chilli Powder",       unit: "250 g",  emoji: "🌶️" },
      { name: "Coriander (Dhania)",      unit: "250 g",  emoji: "🌿" },
      { name: "Cumin (Jeera)",           unit: "200 g",  emoji: "🟤" },
      { name: "Black Pepper",            unit: "100 g",  emoji: "⚫" },
      { name: "Mustard Seeds",           unit: "200 g",  emoji: "🟡" },
      { name: "Dry Ginger (Sonti)",      unit: "100 g",  emoji: "🫚" },
      { name: "Tamarind",                unit: "500 g",  emoji: "🟤" },
      { name: "Idli Karam Podi",         unit: "200 g",  emoji: "🥣", tag: "House-made" },
      { name: "Curry-leaf Podi",         unit: "200 g",  emoji: "🥣" },
      { name: "Flaxseed Podi",           unit: "200 g",  emoji: "🥣" },
    ],
  },
  {
    id: "oils",
    eyebrow: "Cold-pressed oils",
    title: "Wood-pressed, nothing refined",
    blurb: "Chekku / ganuga oils — cold-pressed in small batches, never refined or heat-stripped.",
    products: [
      { name: "Groundnut Oil",                unit: "1 litre", emoji: "🫗" },
      { name: "Sesame / Gingelly Oil",        unit: "1 litre", emoji: "🫗", tag: "Nuvvula nune" },
      { name: "Coconut Oil",                  unit: "1 litre", emoji: "🥥" },
      { name: "Sunflower Oil",                unit: "1 litre", emoji: "🌻" },
    ],
  },
  {
    id: "sweeteners",
    eyebrow: "Sweeteners, honey &amp; ghee",
    title: "Jaggery, forest honey &amp; ghee",
    blurb: "Unrefined jaggery instead of white sugar, wild forest honey, and slow bilona ghee.",
    products: [
      { name: "Cane Jaggery (Achu Bellam)", unit: "1 kg",   emoji: "🟫" },
      { name: "Palm Jaggery (Thati Bellam)",unit: "500 g",  emoji: "🟤", tag: "Traditional" },
      { name: "Jaggery Powder",             unit: "500 g",  emoji: "🟫" },
      { name: "Wild Forest Honey",          unit: "500 g",  emoji: "🍯", tag: "Wild-harvested" },
      { name: "Bilona Cow Ghee",            unit: "500 ml", emoji: "🧈", tag: "Bestseller" },
    ],
  },
  {
    id: "dried",
    eyebrow: "Dried fruit, nuts &amp; seeds",
    title: "Sun-dried &amp; nothing added",
    blurb: "Naturally dried fruit and edible seeds — no sugar, no preservatives, no colour.",
    products: [
      { name: "Dried Fig",            unit: "200 g", emoji: "🫐" },
      { name: "Dried Mango",          unit: "200 g", emoji: "🥭" },
      { name: "Dried Lemon Slices",   unit: "100 g", emoji: "🍋" },
      { name: "Dates",                unit: "500 g", emoji: "🌴" },
      { name: "Cashew",               unit: "250 g", emoji: "🥜" },
      { name: "Pumpkin Seeds",        unit: "200 g", emoji: "🎃" },
      { name: "Chia Seeds",           unit: "200 g", emoji: "⚫" },
      { name: "Sunflower Seeds",      unit: "200 g", emoji: "🌻" },
      { name: "Flax Seeds (Avise)",   unit: "200 g", emoji: "🟤" },
      { name: "Sesame Seeds (Nuvvulu)",unit: "200 g",emoji: "⚪" },
    ],
  },
  {
    id: "teas",
    eyebrow: "Herbal teas &amp; botanicals",
    title: "Caffeine-free, flower &amp; leaf",
    blurb: "Edible flowers and leaves, dried gently for teas and infusions — the traditional way.",
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
    eyebrow: "Natural home &amp; care",
    title: "Chemical-free, beyond the kitchen",
    blurb: "The traditional way to wash and bathe — no synthetic foaming agents, just plants.",
    products: [
      { name: "Soap Nuts (Kunkudukayalu)",  unit: "250 g", emoji: "🟤", tag: "Natural detergent" },
      { name: "Karakkaya",                  unit: "250 g", emoji: "🌰" },
      { name: "Shikakai (Seekakaya)",       unit: "200 g", emoji: "🌿" },
      { name: "Hibiscus Hair Powder",       unit: "100 g", emoji: "🌺" },
      { name: "Sunnipindi (Bath Powder)",   unit: "200 g", emoji: "🛁", tag: "Traditional" },
      { name: "Neem Powder",                unit: "100 g", emoji: "🌿" },
    ],
  },
  {
    id: "soil",
    eyebrow: "For your soil",
    title: "Feed your soil like we feed ours",
    blurb: "Our own vermicompost and natural inputs — the same ones behind everything we grow.",
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
const PRODUCTS = {};
let _mi = 0;
SECTIONS.forEach((s) => s.products.forEach((p) => {
  p.id = p.id || (s.id + "-" + slug(p.name));
  p.media = p.media || MEDIA[_mi++ % MEDIA.length];
  PRODUCTS[p.id] = p;
}));

// ---- Order state (persisted) ----
let cart = {};
try { cart = JSON.parse(localStorage.getItem("oneacre_cart") || "{}"); } catch (e) { cart = {}; }
const saveCart = () => localStorage.setItem("oneacre_cart", JSON.stringify(cart));

function renderCatalog() {
  const root = document.getElementById("catalog");
  root.innerHTML = SECTIONS.map((s) => `
    <section class="section" id="${s.id}">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow">${s.eyebrow}</p>
            <h2>${s.title}</h2>
          </div>
          <p>${s.blurb}</p>
        </div>
        <div class="grid">${s.products.map(card).join("")}</div>
      </div>
    </section>`).join("");
}

function card(p) {
  const tag = p.tag ? `<span class="card-tag">${p.tag}</span>` : "";
  return `
    <article class="card">
      <div class="card-media-wrap" style="position:relative">
        <div class="card-media" style="background:${p.media}"><span class="card-emoji">${p.emoji}</span></div>${tag}
      </div>
      <div class="card-body">
        <h3 class="card-name">${p.name}</h3>
        <p class="card-unit">${p.unit || ""}</p>
        <div class="card-foot"><button class="add-btn block" data-add="${p.id}">Add to order +</button></div>
      </div>
    </article>`;
}

function addToCart(id) { cart[id] = (cart[id] || 0) + 1; saveCart(); renderCart(); bump(); }
function setQty(id, d) { cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id]; saveCart(); renderCart(); }
function cartCount() { return Object.values(cart).reduce((a, b) => a + b, 0); }

function renderCart() {
  document.getElementById("cartCount").textContent = cartCount();
  const items = document.getElementById("cartItems");
  const ids = Object.keys(cart);
  if (!ids.length) {
    items.innerHTML = `<div class="cart-empty">Your order is empty.<br>Add something natural 🌿</div>`;
  } else {
    items.innerHTML = ids.map((id) => {
      const p = PRODUCTS[id]; if (!p) return "";
      const q = cart[id];
      return `
        <div class="cart-line">
          <div class="cart-line-media" style="background:${p.media}">${p.emoji}</div>
          <div class="cart-line-info">
            <div class="cart-line-name">${p.name}</div>
            <div class="cart-line-unit">${p.unit || ""}</div>
            <div class="qty">
              <button data-dec="${id}">−</button><span>${q}</span><button data-inc="${id}">+</button>
            </div>
          </div>
        </div>`;
    }).join("");
  }
  document.getElementById("checkoutBtn").disabled = !ids.length;
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
  const ids = Object.keys(cart);
  if (!ids.length) return;
  let msg = "Hi 1acrefarms! 🌿 I'd like to order:%0A%0A";
  ids.forEach((id) => { const p = PRODUCTS[id]; msg += `• ${cart[id]} × ${p.name}${p.unit ? " (" + p.unit + ")" : ""}%0A`; });
  msg += `%0APlease confirm price &amp; availability.%0A%0AName:%0AAddress:%0APreferred pack sizes / notes:`;
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank");
}

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  if (add) addToCart(add.dataset.add);
  if (inc) setQty(inc.dataset.inc, +1);
  if (dec) setQty(dec.dataset.dec, -1);
});
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("cartClose").addEventListener("click", closeCart);
document.getElementById("checkoutBtn").addEventListener("click", checkout);
overlay.addEventListener("click", closeCart);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });

document.getElementById("footerWhatsapp").href = `https://wa.me/${WHATSAPP_NUMBER}`;
document.getElementById("year").textContent = new Date().getFullYear();

renderCatalog();
renderCart();

/* ---------------------------------------------------------
   REAL PHOTOS: add an "img" field to any product, e.g.
     { name:"Wild Forest Honey", ..., img:"assets/honey.jpg" }
   Put the file in /assets. (Card render uses emoji today.)
   PRICES: add "price" to each product + set ENQUIRY_MODE=false
   to show fixed prices and a live total instead of enquiry.
   --------------------------------------------------------- */
