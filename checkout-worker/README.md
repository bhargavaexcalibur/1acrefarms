# 1acrefarms checkout Worker (option b): TEST build

A small Cloudflare Worker for the website checkout. Razorpay is the main gateway, Cashfree the first backup and
PhonePe the second backup (owner 11-11: "we will have two backups"). The order is one setting, `GATEWAY_ORDER`, so
any gateway can be switched off or moved up without a code change. Paid orders are sent to Shiprocket. It is plain
JavaScript (fetch + Web Crypto) with **no dependencies**, and stores orders in Cloudflare D1.

**The customer pays the MRP and nothing else.** Delivery is free on every order, anywhere in India (owner 11-11:
"lets never charge our customers other than MRP"). The total is the sum of MRP x qty; that exact amount is what the
Worker asks Razorpay, Cashfree or PhonePe for. The PIN is still checked (valid Indian PIN, Army Postal 9xxxxx
refused, PIN vs state) so Shiprocket gets a deliverable address.

**Live mode is hard-disabled.** `MODE` defaults to `test`. With `MODE = "live"`, every new order is refused
unless ALL of these hold (each missing piece has its own refusal code, shown by `/health` as `reason`):

| Gate | Refusal code when missing |
|---|---|
| secret `LIVE_ENABLED` is exactly `yes-owner-approved` (Bhargava's go) | `live_not_approved` |
| var `FSSAI_ECOM_LIC` is the granted FSSAI Central licence number: exactly 14 digits, not our Reg. No. | `no_fssai_ecom_licence` |
| var `FSSAI_ECOM_KOB_ENDORSED` is exactly `yes`: set by hand only when that licence shows the **E-commerce** kind of business (a licence can be granted first without it and gain it later by a Form C modification) | `fssai_ecom_kob_not_endorsed` |
| `RAZORPAY_KEY_ID` is a live key (`rzp_live_...`) | `test_key_in_live_mode` |

A live Razorpay key in test mode is refused too (`live_key_in_test_mode`). Do not set any of these until Shiva
confirms the licence/legal check and Bhargava says go. Never put a placeholder or a number that is not yet granted in
`FSSAI_ECOM_LIC`: when it holds a valid number, the checkout page and the order e-mail show it as "FSSAI Lic. No.".

**What the buyer sees before paying** (all from one file, `src/seller.js`, shared with the order e-mail): each pack
as "540 g · MRP ₹396 (incl. of all taxes) · ₹0.73 per g · Pack details" (link to the product page); the GST inside
the MRP (CGST 2.5% + SGST 2.5% for Andhra Pradesh, IGST 5% elsewhere, the rate only until a state is chosen); "Delivery
₹0 (free across India)"; the total; the delivery and returns terms; and the seller block (legal name, shop and
packing-unit addresses, GSTIN, FSSAI Reg. No., customer care and grievance officer, link to policies.html), again in
the page footer. After paying: the expected delivery window, and a confirmation e-mail.

**What can be ordered** is one flag per pack, `sellable` in `src/pricing.js` `CATALOGUE`. Today: turmeric, hill
turmeric, cane jaggery, palm jaggery. Sannam and Teja are held (stock count and real pack photos first) and cashew is
parked. Switching a pack on = changing that one flag; the page, the Worker and the Meta link all follow.

```
browser (/checkout-test/)            Worker (workers.dev)                         outside
  cart + address  --POST /create-order-->  validate, price = sum of MRPs          --> 1. Razorpay Orders API
                                           (src/pricing.js), D1 row                   2. Cashfree Create Order
                                           GATEWAY_ORDER, next on 4xx/5xx/            3. PhonePe token + /checkout/v2/pay
                                           network error/6 s timeout
  Razorpay Checkout / Cashfree SDK / <---  order id + key / session id / PhonePe redirectUrl
  redirect to PhonePe, back to /checkout-test/?order_id=...
  --POST /verify------------------------>  HMAC check (Razorpay) / Get Order (Cashfree) / Order Status (PhonePe)
                    Razorpay ---POST /razorpay-webhook--> signed raw body, dedupe by event id, reply < 5 s
                    Cashfree ---POST /cashfree-webhook--> signed (timestamp + body)
                    PhonePe  ---POST /phonepe-webhook---> Authorization = sha256(user:pass); dedupe; Order Status decides
                                           markPaid (once) --waitUntil--> Shiprocket orders/create/adhoc
  every 15 min: scheduled()  ------------> Shiprocket retries, reconcile unpaid orders --> owner mail (Resend)
```

| File | What it does |
|---|---|
| `src/index.js` | Routes, failover chain, the single "paid" hand-off, `scheduled()` |
| `src/config.js` | MODE / LIVE_ENABLED guard, `GATEWAY_ORDER`, all settings |
| `src/pricing.js` | **The only price list** (MRPs; `DELIVERY_FEE_RUPEES = 0`), what is `sellable`, product-page slugs, GST rate, unit price per g, PIN table, parcel sizes (also used by the page) |
| `src/gst.js` | GST inside the MRP, for display: per unit CGST = SGST = MRP/42 (Andhra Pradesh) or IGST = MRP/21, then x qty (our invoice method) |
| `src/seller.js` | Legal name, both addresses (labels in one place), GSTIN, FSSAI Reg. No., customer care / grievance officer, Amazon.in store link, short delivery / returns / privacy terms (page + e-mail) |
| `src/delivery.js` | Expected delivery window: dispatch 1–2 working days + 1–3 / 3–5 / 4–10 days by area (Sundays not counted, IST) |
| `src/confirmation.js` | The customer's order-confirmation e-mail (Resend), once per paid order |
| `src/cart-link.js` | Meta catalogue link `?products=SKU%3Aqty,...` -> cart (used by the page) |
| `src/validate.js` | Address-form rules (also used by the page) |
| `src/gateways/razorpay.js`, `cashfree.js`, `phonepe.js` | Create order, look up payment, signature checks (PhonePe: OAuth token cache too) |
| `src/shiprocket.js` | Token cache (9 days), adhoc order, retry rules |
| `src/storage/d1.js`, `memory.js` | Same interface: D1 in production, memory in tests |
| `src/alerts.js`, `src/log.js` | Owner e-mails and the shared Resend call; logs that cannot carry phones, addresses, e-mails or secrets |
| `schema.sql` | D1 tables: `orders` (with `gateway` + `gw_failover`: who took the order and who failed first), `webhook_events`, `kv`, `stock` |

## Run the tests and the smoke run (no accounts needed)

```
cd checkout-worker
node --test                  # all tests (Node 22+; uses node:test, node:sqlite, global webcrypto)
node scripts/smoke.mjs       # end-to-end with mocked Razorpay / Cashfree / PhonePe / Shiprocket / Resend
```

To click through the page with mocked gateways: `node scripts/dev-server.mjs` (API on 127.0.0.1:8787), then
from the repo root `python3 -m http.server 4321` and open http://localhost:4321/checkout-test/.
`MOCK_RAZORPAY=down node scripts/dev-server.mjs` shows the Cashfree path, and
`MOCK_RAZORPAY=down MOCK_CASHFREE=down node scripts/dev-server.mjs` the PhonePe path: the page goes to a MOCK
PhonePe pay page on 127.0.0.1:8787 (Pay / Fail / Back) and comes back to /checkout-test/?order_id=... for /verify.
The mocks cannot open a real Razorpay, Cashfree or PhonePe window, so use `wrangler dev` with real TEST / SANDBOX /
UAT keys for that (step 9).

## Owner setup (Bhargava; we never create accounts or type secrets)

1. **Cloudflare account** (free): sign up at dash.cloudflare.com with 1acrefarmsindia@gmail.com. No DNS change is
   needed: the Worker runs on `*.workers.dev`, and GoDaddy stays as it is.
2. On the Mac, in `checkout-worker/`: `npx wrangler login`. This downloads Cloudflare's own CLI, wrangler.
3. `cp wrangler.toml.example wrangler.toml`.
4. Database: `npx wrangler d1 create 1acrefarms-checkout`, then paste the printed `database_id` into
   `wrangler.toml`. Create the tables with `npx wrangler d1 execute 1acrefarms-checkout --remote --file=./schema.sql`.
5. **Secrets.** Run each command, then paste the value when asked. Values are hidden after they are set.
   ```
   npx wrangler secret put RAZORPAY_KEY_ID          # Razorpay TEST key id (rzp_test_...)
   npx wrangler secret put RAZORPAY_KEY_SECRET      # Razorpay TEST key secret
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET  # a long random string you make up; same one in step 7
   npx wrangler secret put CASHFREE_APP_ID          # Cashfree SANDBOX app id
   npx wrangler secret put CASHFREE_SECRET_KEY      # Cashfree SANDBOX secret key (also signs its webhooks)
   npx wrangler secret put PHONEPE_CLIENT_ID        # PhonePe UAT client id (PhonePe Business dashboard, Test Mode, Developer Settings > API Keys)
   npx wrangler secret put PHONEPE_CLIENT_SECRET    # PhonePe UAT client secret
   npx wrangler secret put PHONEPE_CLIENT_VERSION   # PhonePe UAT client version (a number shown with the keys, often 1)
   npx wrangler secret put PHONEPE_WEBHOOK_USERNAME # the webhook username you choose in step 7 (5-20 letters, digits, _)
   npx wrangler secret put PHONEPE_WEBHOOK_PASSWORD # the webhook password you choose in step 7 (8-20, letters AND digits)
   npx wrangler secret put SHIPROCKET_API_EMAIL     # the API user's email (not the main login)
   npx wrangler secret put SHIPROCKET_API_PASSWORD  # the API user's password (shown once by Shiprocket)
   npx wrangler secret put RESEND_API_KEY           # resend.com > API Keys (sending access)
   ```
   Optional: `TURNSTILE_SECRET_KEY` (with `TURNSTILE_REQUIRED = "true"`). Set `LIVE_ENABLED` only at go-live
   (see "Go-live gates" below).
6. `npx wrangler deploy`. Copy the printed URL (https://1acrefarms-checkout.<name>.workers.dev) into
   `PUBLIC_URL` in `wrangler.toml` and into `<meta name="checkout-api">` in `checkout-test/index.html`, then deploy again.
   Check that `https://<url>/health` returns `{"ok":true,"mode":"test","checkout":"enabled","gateways":["razorpay","cashfree","phonepe"]}`
   (plus `"fssaiLic"` only once `FSSAI_ECOM_LIC` holds the granted number).
7. **Webhook URLs**:
   - **Razorpay** (Test Mode on), Account & Settings > Webhooks > Add new webhook:
     - URL: `https://<url>/razorpay-webhook`
     - Secret: the same value as RAZORPAY_WEBHOOK_SECRET
     - Events: `order.paid`, `payment.captured`, `payment.failed`
     - Also set payment capture to **automatic**.
   - **Cashfree** (Sandbox), Developers > Webhooks > Add endpoint:
     - URL: `https://<url>/cashfree-webhook`
     - Events: payment success, payment failed, user dropped
     - The Worker also sends this URL as `notify_url` on each order.
   - **PhonePe** (PhonePe Business dashboard, Test Mode ON), Developer Settings > Webhook > Create Webhook:
     - Authentication type: **SHA** (username + password). Not HMAC: PhonePe's docs do not yet say what HMAC signs.
     - URL: `https://<url>/phonepe-webhook`; username and password = the two PHONEPE_WEBHOOK_* secrets of step 5
     - Events: `checkout.order.completed`, `checkout.order.failed`
     - If the Test Mode dashboard has no webhook option, PhonePe's older docs say UAT webhooks are set up by their
       integration team. The checkout still works without it: /verify and the 15-min reconcile ask Order Status.
   - Shiprocket needs no webhook for this build.
8. **Shiprocket**:
   - Confirm that the Business plan is active.
   - Create the API user: Settings > API > Add New API User, with a new email.
   - Check that the pickup nickname matches `SHIPROCKET_PICKUP_LOCATION`.
   - Keep `SHIPROCKET_PUSH = "off"` until test-checklist step 6.
9. Optional, for local work with real TEST keys: put the same names in `checkout-worker/.dev.vars` (gitignored)
   with `DEV_ORIGINS="http://localhost:4321"` and `SITE_URL="http://localhost:4321"` (so PhonePe and Cashfree send the
   customer back to the local page), run `npx wrangler dev`, and open the page from `python3 -m http.server 4321`.
10. **Customer order-confirmation e-mail** (sent once per paid order, to the e-mail the buyer typed):
    - In Resend > Domains, add a sending domain (e.g. a subdomain of 1acrefarms.co.in) and add the DNS records Resend
      shows at GoDaddy. Resend's `onboarding@resend.dev` sender can only reach the Resend account owner, so buyers get
      nothing until a domain is verified.
    - In that domain's settings keep **open tracking and click tracking OFF** (the e-mail must carry no tracking).
    - In `wrangler.toml` [vars] set `CUSTOMER_MAIL_FROM` to an address on that domain (e.g.
      `"1acrefarms <orders@your-verified-domain>"`) and, if wanted, `CUSTOMER_MAIL_REPLY_TO` (default
      1acrefarmsindia@gmail.com). Deploy. Until `CUSTOMER_MAIL_FROM` is set, no customer e-mail is sent and each
      "New paid order" owner alert says so.
    - The same `RESEND_API_KEY` (step 5) is used. Owner alerts keep `ALERT_FROM`.

## Go-live gates (set on the day, by hand; never before)

In `wrangler.toml` [vars] (plain values, not secrets; see `wrangler.toml.example`):

| Var | Set it when | Value |
|---|---|---|
| `FSSAI_ECOM_LIC` | FoSCoS shows the FSSAI Central licence **granted** | the 14-digit licence number, nothing else. Empty / unset until then. |
| `FSSAI_ECOM_KOB_ENDORSED` | the granted licence lists the **E-commerce** kind of business (check the licence copy; if it was granted without it, wait for the Form C modification) | `yes` |
| `MODE` | everything below is true and Bhargava says go | `live` |

Then `npx wrangler secret put LIVE_ENABLED` with `yes-owner-approved`, a live `RAZORPAY_KEY_ID`, and deploy.
`/health` must show `"checkout":"enabled"`; any other answer names the missing gate in `reason`.

## Test-mode checklist (all in TEST / SANDBOX; no real money)

1. `/health` shows mode test and checkout enabled.
2. Open `https://1acrefarms.co.in/checkout-test/` (hidden, noindex). The yellow TEST MODE banner shows.
3. No delivery fee anywhere: one cane jaggery shows Rs 234 to 522601 and Rs 234 to 110001; two turmeric + one cane
   shows Rs 1,026. The summary shows "Delivery ₹0 (free across India)" and the total stays the sum of the MRPs. In D1,
   `delivery_paise = 0` and `total_paise` = the sum of the MRPs.
   - GST line: no state chosen = "GST included in the MRP (5%)"; Andhra Pradesh, 2 turmeric + 1 cane = "₹48.86 (CGST
     2.5% ₹24.43 + SGST 2.5% ₹24.43)"; Delhi, the same cart = "₹48.86 (IGST 5%)". The total does not change.
   - Each pack line has "₹… per g" and a "Pack details" link that opens the product page. Sannam, Teja and cashew are
     not listed.
   - Before the Pay button and in the footer: legal name, both addresses, GSTIN, FSSAI Reg. No. (no licence line until
     `FSSAI_ECOM_LIC` is set), customer care and grievance officer, delivery and returns terms, policies link. Under
     the address form: the privacy note with its link.
   - Meta link: open `/checkout-test/?products=1AF-TURM-0540%3A2,1AF-SANN-0540%3A1`: the cart is 2 turmeric, and a
     note says 1AF-SANN-0540 was not added.
4. Pay with Razorpay test UPI or card (e.g. Visa 4100 2800 0000 1007, any CVV, a future date) and get the success
   state, with "Expected delivery between … and …". In D1, `status = paid` and `paid_source = webhook` or `verify`.
   With step 10 done, one "[TEST] Your 1acrefarms order …" e-mail reaches the address typed in the form (use your
   own), with the packs, GST, total, delivery window, cancel/returns, grievance contact and seller details. **This also proves the Razorpay webhook
   reaches workers.dev** (Cloudflare's Browser Integrity Check is the known risk). If only `verify` or `reconcile`
   ever appears, the webhook is being blocked: look at Razorpay > Webhooks > the delivery log.
5. Failure path: use Razorpay's failure test option. The page shows "Payment did not go through" with "Try again",
   "Our Amazon.in store" and "Help on WhatsApp" (help only: no order message), and D1 shows `failed`.
6. **One real Shiprocket test order:**
   - Set `SHIPROCKET_PUSH = "on"`, deploy, and pay once.
   - The order appears in Shiprocket with our order id, Prepaid, the right weight and pickup.
   - **Cancel it in Shiprocket** (do not assign an AWB), then set `SHIPROCKET_PUSH` back to `"off"`.
7. Failover (each backup once, then put the order back):
   - Cashfree: set `GATEWAY_ORDER = "cashfree,razorpay,phonepe"`, deploy, and pay with Cashfree's sandbox test UPI or
     card. You should get the success state. Cashfree's webhook should be delivered. Before trusting the signature
     format, check it once with Cashfree's Dev Studio "Webhook verification" tool: we sign `timestamp + raw body`
     with no separator.
   - PhonePe: set `GATEWAY_ORDER = "phonepe,razorpay,cashfree"`, deploy, and pay a basket **under Rs 1,000** (PhonePe
     UAT allows Rs 1 to Rs 1,000; e.g. one cane jaggery, Rs 234). The page goes to PhonePe's UAT page; pay with the
     test card or the PhonePe Test (simulator) app from https://developer.phonepe.com/payment-gateway/uat-testing-go-live/uat-sandbox
     (the "Paypage" success template). You come back to /checkout-test/?order_id=... and see the success state.
     In D1: `gateway = phonepe`, `status = paid`. Then repeat with the failure template: "Payment did not go through"
     and `status = failed`.
   - Prove the PhonePe webhook once (see "Prove once in UAT" below): `paid_source = webhook` on an order where you
     closed the tab right after paying, or the `webhook_checked` line in the Worker logs.
   - The chain: `GATEWAY_ORDER = "razorpay,cashfree,phonepe"` with a wrong `RAZORPAY_KEY_SECRET` and a wrong
     `CASHFREE_SECRET_KEY` (both then answer 401) must land on PhonePe, and D1 shows
     `gw_failover = razorpay:rejected:401,cashfree:rejected:401`. Put both secrets back.
   - Set `GATEWAY_ORDER` back to `"razorpay,cashfree,phonepe"`.
8. Owner e-mails arrive for a paid order, and for a failover once per hour.

## Look up an order (phone and address live only in D1)

```
npx wrangler d1 execute 1acrefarms-checkout --remote --command \
  "SELECT id, status, gateway, gw_failover, total_paise, ship_status, ship_error, customer_json FROM orders WHERE id = '1AF-T-261112-XXXXXX'"
```

## What each state means

| Field | Values |
|---|---|
| `status` | `new`, then `created` (gateway order made), then `verified` (Razorpay checkout signature OK), then `paid` (capture confirmed). Other values: `failed` (can still turn `paid`), `expired` (unpaid after 24 h; a late payment still counts), `gateway_error` (every gateway in `GATEWAY_ORDER` failed; the buyer saw "try again in a minute, or order from our Amazon.in store"; it can never turn paid), `amount_mismatch` (needs a human; never shipped). |
| `gateway` | `razorpay`, `cashfree` or `phonepe`: the gateway that took the order |
| `gw_failover` | empty when the first gateway took it; else the ones that failed first, e.g. `razorpay:server_error:503,cashfree:timeout:0` |
| `ship_status` | `skipped` (push off), `pending`, `pushing` (2-minute lease), `retry` (after 15 min, 30 min, 1 h ... up to 8 attempts), `pushed`, `failed` (e-mail: "book by hand") |

The money is captured before Shiprocket is called, so a Shiprocket failure only delays dispatch. The manual fallback is
Shiprocket > Orders > Add Order with the same order id. A repeated order id gets a 422 from Shiprocket, so a retry
can never book twice.

## Prove once in UAT / sandbox (the docs leave these open; the code follows the documented sample)

- **Cashfree webhook signature**: base64 HMAC-SHA256 of `x-webhook-timestamp + raw body`, no separator (Cashfree's
  Node sample). Check with Cashfree's Dev Studio "Webhook verification" tool.
- **PhonePe webhook Authorization header**: PhonePe's page says only "SHA256(username:password)". We follow PhonePe's
  own Node SDK (pg-sdk-node 2.0.2, `CommonUtils.isCallbackValid`): the whole header must equal the lowercase hex
  SHA-256 of `username:password`. If UAT sends a prefix (e.g. `SHA256 ...`), the webhook answers 401 and the
  `webhook_bad_signature` log line shows it; orders still settle through /verify and reconcile.
- **PhonePe sandbox webhooks**: the current dashboard has a Test Mode webhook form; older PhonePe docs say UAT
  webhooks are set up by their integration team. Either way, not needed for an order to be marked paid.
- **PhonePe return URL**: we send `SITE_URL/checkout-test/?order_id=<ours>&gw=phonepe`. The docs do not say whether
  PhonePe adds query parameters; the page only reads `order_id`. Check the customer lands back on that URL.
- **PhonePe redirect mode**: the page loads `https://mercury.phonepe.com/web/bundle/checkout.js` and calls
  `PhonePeCheckout.transact({ tokenUrl })` (redirect mode), falling back to a plain redirect. Check once that UAT
  opens the PhonePe page, not an iframe.
- **PhonePe token**: `expires_at` is read as epoch seconds (the docs' sample; the SDK does the same). The token is
  cached in D1 `kv` until 10 minutes before it expires.

## Known limits

- `workers.dev` is meant for hobby projects, and it always runs Browser Integrity Check, so the Razorpay webhook must be
  proven in test step 4. If webhooks are blocked, the 15-minute reconcile still marks the order paid.
- The `stock` table is read at checkout (a row with qty 0 blocks a pack), but nothing fills it yet. The nightly sync
  from the Stock tab is not built.
- English only. Every visible string is in `STRINGS.en` in `checkout-test/checkout.js`, ready for the 22 languages
  (the delivery / returns / privacy / grievance texts come from `src/seller.js` `TERMS`; the address labels are in
  `src/seller.js` `ADDRESS_LABELS`). The order e-mail is English only.
- Expected delivery dates skip Sundays but do not know public holidays (policies.html already says festival rush and
  remote areas can add days). PIN 522xxx covers Guntur and Palnadu but also part of Bapatla district, so it gets the
  wider 1–5 days, never a 1–3 promise. A state that contradicts the PIN gets the wider of the two areas.
- GST break-up: CGST/SGST follows invoices 0001-0003; the IGST rounding (MRP/21 per unit, then x qty) has no invoice
  yet and is to be confirmed by ChittaGupta before the first inter-state invoice.
- The packing-unit address label ("Packing unit (as printed on the pack)") is provisional, to be settled after the
  12-11 FSSAI filing: change `ADDRESS_LABELS` in `src/seller.js`.
- The customer e-mail is tried twice (Resend 429/5xx/network) at the moment of payment; if it still fails, the owner
  alert says "send the customer the order details by hand". There is no later retry.
- Meta catalogue link: the products in the link replace the saved cart (only when at least one can be ordered).
- PhonePe is a full-page redirect: after a failed or abandoned PhonePe payment the cart and PIN are still there,
  but name, phone and address must be typed again (the page never stores them on the device).
- The PhonePe and Cashfree return URLs point at `/checkout-test/`. At go-live they must point at the real checkout
  page (one line each in `src/gateways/phonepe.js` and `cashfree.js`).
- `policies.html` on main (11-11) has free delivery on every order and names Razorpay, Cashfree and PhonePe, but its
  "How to order" line still says "pay online through Razorpay", and it says direct orders are not open yet. Its
  "delivery date we gave you" now has a date: the success page and the order e-mail give the expected window. The
  worktree's own `policies.html` is stale (fee table); never copy it to main.
- Data retention: customer rows stay in D1 until a retention job is added. GST needs 72 months of invoices, not addresses.
