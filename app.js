/* =========================================================
   1acrefarms — storefront logic
   EDIT ME: change the WhatsApp number and products below.
   ========================================================= */

// ---- 1. Your WhatsApp number (international format, no + or spaces) ----
// Example for India: country code 91 + 10-digit number => "919876543210"
const WHATSAPP_NUMBER = "917899929779"; // 91 (India) + 7899929779 — WhatsApp Business number

// ---- 2. Your products ----
// price/was are in rupees. Set "stock": false to mark sold out.
// "media" is the background colour of the card image, "emoji" the icon.
// Swap emoji for a real photo later by giving an "img" URL (see note at bottom).
const SECTIONS = [
  {
    id: "produce",
    eyebrow: "Fresh produce",
    title: "Picked this morning",
    blurb: "Seasonal vegetables and fruit, harvested the day we deliver. Prices are per pack/kg as noted.",
    products: [
      { id: "tomato",   name: "Vine Tomatoes",     unit: "1 kg",        price: 60,  was: 80, emoji: "🍅", media: "#f3ddd6", tag: "Sale" },
      { id: "spinach",  name: "Palak (Spinach)",   unit: "250 g bunch", price: 30,           emoji: "🥬", media: "#e7efd9" },
      { id: "carrot",   name: "Red Carrots",       unit: "500 g",       price: 45,           emoji: "🥕", media: "#f6e3cf" },
      { id: "okra",     name: "Bhindi (Okra)",     unit: "500 g",       price: 40,           emoji: "🫛", media: "#e7efd9" },
      { id: "banana",   name: "Desi Bananas",      unit: "1 dozen",     price: 50,           emoji: "🍌", media: "#fdf3da", tag: "Popular" },
      { id: "mango",    name: "Alphonso Mangoes",  unit: "1 kg",        price: 280,          emoji: "🥭", media: "#fdf0d2", tag: "Seasonal" },
      { id: "chilli",   name: "Green Chillies",    unit: "100 g",       price: 15,           emoji: "🌶️", media: "#f3ddd6" },
      { id: "potato",   name: "New Potatoes",      unit: "2 kg",        price: 70,           emoji: "🥔", media: "#f1e8d6" },
    ],
  },
  {
    id: "dairy",
    eyebrow: "Dairy, eggs & meat",
    title: "From our cows & coop",
    blurb: "Free-range eggs, fresh A2 milk and farm dairy. Delivered chilled in the morning round.",
    products: [
      { id: "milk",    name: "A2 Cow Milk",        unit: "1 litre",   price: 70,            emoji: "🥛", media: "#f4f4ee", tag: "Daily" },
      { id: "eggs",    name: "Free-range Eggs",    unit: "Tray of 12", price: 120, was: 140, emoji: "🥚", media: "#fdf3da", tag: "Sale" },
      { id: "paneer",  name: "Fresh Paneer",       unit: "200 g",     price: 90,            emoji: "🧀", media: "#fbf6e8" },
      { id: "curd",    name: "Set Curd",           unit: "400 g",     price: 50,            emoji: "🍦", media: "#f4f4ee" },
      { id: "butter",  name: "White Butter",       unit: "250 g",     price: 160,           emoji: "🧈", media: "#fdf0d2" },
      { id: "chicken", name: "Country Chicken",    unit: "1 kg",      price: 320,           emoji: "🍗", media: "#f3ddd6", stock: false },
    ],
  },
  {
    id: "pantry",
    eyebrow: "Pantry & homemade",
    title: "Made in our kitchen",
    blurb: "Surplus from the farm, turned into things that keep — slow-made in small batches.",
    products: [
      { id: "honey",   name: "Raw Wildflower Honey", unit: "500 g jar", price: 350,           emoji: "🍯", media: "#f6e7cf", tag: "Bestseller" },
      { id: "ghee",    name: "Bilona Cow Ghee",      unit: "500 ml",    price: 650, was: 720, emoji: "🫙", media: "#fdf0d2", tag: "Sale" },
      { id: "pickle",  name: "Mango Pickle",         unit: "400 g",     price: 180,           emoji: "🥫", media: "#f3ddd6" },
      { id: "jaggery", name: "Sugarcane Jaggery",    unit: "1 kg",      price: 90,            emoji: "🟫", media: "#f1e3cf" },
    ],
  },
  {
    id: "soil",
    eyebrow: "Soil & natural inputs",
    title: "Feed your soil",
    blurb: "Vermicompost and natural fertilisers made on our farm — the same living inputs we grow everything here with. No chemicals, ever.",
    products: [
      { id: "vermi5",     name: "Vermicompost",          unit: "5 kg bag",   price: 150,           emoji: "🪱", media: "#e9e2d2", tag: "Bestseller" },
      { id: "vermi25",    name: "Vermicompost — Bulk",   unit: "25 kg bag",  price: 600, was: 700, emoji: "🪱", media: "#e9e2d2", tag: "Sale" },
      { id: "vermiwash",  name: "Vermiwash",             unit: "1 litre",    price: 120,           emoji: "🧴", media: "#e7efd9" },
      { id: "compost",    name: "Farmyard Compost",      unit: "10 kg bag",  price: 130,           emoji: "🌱", media: "#eef2e6" },
      { id: "neemcake",   name: "Neem Khali (Cake)",     unit: "1 kg",       price: 90,            emoji: "🌿", media: "#e7efd9" },
      { id: "jeevamrut",  name: "Jeevamrutham",          unit: "5 litres",   price: 100,           emoji: "🪣", media: "#f1e3cf" },
      { id: "cowdung",    name: "Dried Cow-dung Cakes",  unit: "Pack of 12", price: 80,            emoji: "🟤", media: "#f1e8d6" },
      { id: "panchagavya",name: "Panchagavya",           unit: "1 litre",    price: 140,           emoji: "🍶", media: "#fdf3da" },
    ],
  },
];

// ---------------------------------------------------------
// Below this line is the engine — usually no need to edit.
// ---------------------------------------------------------

const fmt = (n) => "₹" + n.toLocaleString("en-IN");
const PRODUCTS = {};
SECTIONS.forEach((s) => s.products.forEach((p) => (PRODUCTS[p.id] = p)));

// ---- Cart state (persisted to localStorage) ----
let cart = {};
try { cart = JSON.parse(localStorage.getItem("oneacre_cart") || "{}"); } catch (e) { cart = {}; }
const saveCart = () => localStorage.setItem("oneacre_cart", JSON.stringify(cart));

// ---- Render catalog ----
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
        <div class="grid">
          ${s.products.map(card).join("")}
        </div>
      </div>
    </section>
  `).join("");
}

function card(p) {
  const out = p.stock === false;
  const media = p.img
    ? `<div class="card-media has-photo" style="background-image:url('${p.img}');"></div>`
    : `<div class="card-media"><span class="card-emoji">${p.emoji}</span></div>`;
  const tag = out ? `<span class="card-tag out">Sold out</span>` : (p.tag ? `<span class="card-tag">${p.tag}</span>` : "");
  const price = p.was
    ? `<span class="card-price"><span class="was">${fmt(p.was)}</span>${fmt(p.price)}</span>`
    : `<span class="card-price">${fmt(p.price)}</span>`;
  const btn = out
    ? `<button class="add-btn" disabled>Sold out</button>`
    : `<button class="add-btn" data-add="${p.id}">Add +</button>`;
  return `
    <article class="card">
      <div class="card-media-wrap" style="position:relative">${media}${tag}</div>
      <div class="card-body">
        <h3 class="card-name">${p.name}</h3>
        <p class="card-unit">${p.unit}</p>
        <div class="card-foot">${price}${btn}</div>
      </div>
    </article>`;
}

// ---- Cart operations ----
function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart(); renderCart(); bump();
}
function setQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart(); renderCart();
}
function cartCount() { return Object.values(cart).reduce((a, b) => a + b, 0); }
function cartTotal() { return Object.entries(cart).reduce((sum, [id, q]) => sum + (PRODUCTS[id]?.price || 0) * q, 0); }

function renderCart() {
  document.getElementById("cartCount").textContent = cartCount();
  const items = document.getElementById("cartItems");
  const ids = Object.keys(cart);
  if (!ids.length) {
    items.innerHTML = `<div class="cart-empty">Your basket is empty.<br>Add something fresh 🌱</div>`;
  } else {
    items.innerHTML = ids.map((id) => {
      const p = PRODUCTS[id]; const q = cart[id];
      const media = p.img
        ? `<div class="cart-line-media" style="background:${p.media};background-image:url('${p.img}');background-size:cover;background-position:center;"></div>`
        : `<div class="cart-line-media" style="background:${p.media}">${p.emoji}</div>`;
      return `
        <div class="cart-line">
          ${media}
          <div class="cart-line-info">
            <div class="cart-line-name">${p.name}</div>
            <div class="cart-line-unit">${p.unit} · ${fmt(p.price)}</div>
            <div class="qty">
              <button data-dec="${id}">−</button>
              <span>${q}</span>
              <button data-inc="${id}">+</button>
            </div>
          </div>
          <div class="cart-line-price">${fmt(p.price * q)}</div>
        </div>`;
    }).join("");
  }
  document.getElementById("cartTotal").textContent = fmt(cartTotal());
  document.getElementById("checkoutBtn").disabled = !ids.length;
}

function bump() {
  const c = document.getElementById("cartCount");
  c.animate([{ transform: "scale(1)" }, { transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 280 });
  openCart();
}

// ---- Drawer ----
const drawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("cartOverlay");
function openCart() { drawer.classList.add("open"); overlay.classList.add("open"); }
function closeCart() { drawer.classList.remove("open"); overlay.classList.remove("open"); }

// ---- WhatsApp checkout ----
function checkout() {
  const ids = Object.keys(cart);
  if (!ids.length) return;
  let msg = "Hi 1acrefarms! 🌾 I'd like to order:%0A%0A";
  ids.forEach((id) => {
    const p = PRODUCTS[id]; const q = cart[id];
    msg += `• ${q} × ${p.name} (${p.unit}) — ${fmt(p.price * q)}%0A`;
  });
  msg += `%0A*Total: ${fmt(cartTotal())}*%0A%0AName:%0AAddress:%0APreferred delivery time:`;
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank");
}

// ---- Wire up ----
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

// Footer WhatsApp link + year
document.getElementById("footerWhatsapp").href = `https://wa.me/${WHATSAPP_NUMBER}`;
document.getElementById("year").textContent = new Date().getFullYear();

renderCatalog();
renderCart();

/* ---------------------------------------------------------
   USING REAL PHOTOS INSTEAD OF EMOJI:
   Add an "img" field to any product, e.g.
     { id:"tomato", name:"Vine Tomatoes", ..., img:"assets/tomato.jpg" }
   Put the image file in the /assets folder. It will fill the card.
   --------------------------------------------------------- */
