# 🌾 1acrefarms

A simple, custom-coded online store for the farm. Customers browse fresh produce,
dairy & eggs, and homemade pantry goods, build a basket, and place the order
straight to your **WhatsApp** (no payment gateway, pay on delivery).

It's a **static site** — just three files, no build step, no server, free to host.

```
1acrefarms/
├── index.html     ← page structure & copy
├── styles.css     ← all the styling
├── app.js         ← products + cart + WhatsApp checkout   (edit this most)
├── assets/        ← put product photos here
└── README.md
```

## ✏️ How to edit it (the common stuff)

Open **`app.js`** — everything you'll change day-to-day is at the top:

1. **Your WhatsApp number** — line near the top:
   ```js
   const WHATSAPP_NUMBER = "919999999999"; // 91 = India, then your 10-digit number
   ```
   Change `9999999999` to your real number. Keep the `91` country code, no `+` or spaces.

2. **Products** — in the `SECTIONS` list. Each item looks like:
   ```js
   { id: "tomato", name: "Vine Tomatoes", unit: "1 kg", price: 60, was: 80, emoji: "🍅", media: "#f3ddd6", tag: "Sale" },
   ```
   - `price` — current price in ₹
   - `was` — optional old price (shows a strikethrough + "Sale" look). Delete it for no discount.
   - `tag` — small badge ("Popular", "Seasonal"…). Delete the field for no badge.
   - `stock: false` — marks an item **Sold out**.
   - `id` — must be unique (used by the cart). Don't reuse the same id twice.

   To **add** a product, copy a line and change the values. To **remove** one, delete its line.

3. **Using real photos instead of emoji** — drop a photo into `assets/` and add `img`:
   ```js
   { id: "tomato", name: "Vine Tomatoes", unit: "1 kg", price: 60, img: "assets/tomato.jpg", media: "#f3ddd6" },
   ```

Farm name, tagline, story text, and the announcement bar live in **`index.html`**.

## 👀 Preview locally

From this folder:
```bash
python3 -m http.server 4321 --directory .
```
Then open <http://localhost:4321> in your browser. (Or just double-click `index.html`.)

## 🚀 Deploy (free)

Any static host works. Easiest options:

- **Netlify / Cloudflare Pages / Render (Static Site):** drag-and-drop this folder,
  or connect the git repo. No build command, publish directory = the folder root.
- **GitHub Pages:** push to a repo, enable Pages on the `main` branch root.

Because it's static, there's nothing to configure — it just serves the files.

---
Built as a personal project. Swap the emoji for real farm photos when you're ready and
it'll look like a proper store.
