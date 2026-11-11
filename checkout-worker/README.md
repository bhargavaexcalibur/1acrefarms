# 1acrefarms checkout Worker (option b): TEST build

A small Cloudflare Worker for the website checkout. Razorpay is the main gateway, Cashfree is the automatic
backup, and paid orders are sent to Shiprocket. It is plain JavaScript (fetch + Web Crypto) with **no
dependencies**, and stores orders in Cloudflare D1.

**Live mode is hard-disabled.** `MODE` defaults to `test`. With `MODE = "live"`, every new order is refused
unless the secret `LIVE_ENABLED` is exactly `yes-owner-approved`. A live Razorpay key in test mode is refused
too. Do not flip either until Shiva confirms the licence/legal check and Bhargava says go.

```
browser (/checkout-test/)            Worker (workers.dev)                         outside
  cart + address  --POST /create-order-->  validate, price from src/pricing.js,  --> Razorpay Orders API
                                           delivery fee, D1 row                     (Cashfree on failure/timeout)
  Razorpay Checkout / Cashfree SDK   <---  order id + key / session id
  --POST /verify------------------------>  HMAC check (Razorpay) / Get Order (Cashfree)
                    Razorpay ---POST /razorpay-webhook--> signed raw body, dedupe by event id, reply < 5 s
                    Cashfree ---POST /cashfree-webhook--> signed (timestamp + body)
                                           markPaid (once) --waitUntil--> Shiprocket orders/create/adhoc
  every 15 min: scheduled()  ------------> Shiprocket retries, reconcile unpaid orders --> owner mail (Resend)
```

| File | What it does |
|---|---|
| `src/index.js` | Routes, failover, the single "paid" hand-off, `scheduled()` |
| `src/config.js` | MODE / LIVE_ENABLED guard, all settings |
| `src/pricing.js` | **The only price list**, delivery rule, PIN table, parcel sizes (also used by the page) |
| `src/validate.js` | Address-form rules (also used by the page) |
| `src/gateways/razorpay.js`, `cashfree.js` | Create order, look up payment, signature checks |
| `src/shiprocket.js` | Token cache (9 days), adhoc order, retry rules |
| `src/storage/d1.js`, `memory.js` | Same interface: D1 in production, memory in tests |
| `src/alerts.js`, `src/log.js` | Owner e-mails (Resend); logs that cannot carry phones, addresses or secrets |
| `schema.sql` | D1 tables: `orders`, `webhook_events`, `kv`, `stock` |

## Run the tests and the smoke run (no accounts needed)

```
cd checkout-worker
node --test                  # all tests (Node 22+; uses node:test, node:sqlite, global webcrypto)
node scripts/smoke.mjs       # end-to-end with mocked Razorpay / Cashfree / Shiprocket / Resend
```

To click through the page with mocked gateways: `node scripts/dev-server.mjs` (API on 127.0.0.1:8787), then
from the repo root `python3 -m http.server 4321` and open http://localhost:4321/checkout-test/.
`MOCK_RAZORPAY=down node scripts/dev-server.mjs` shows the Cashfree path. The mock cannot open a real
Razorpay window, so use `wrangler dev` with real TEST keys for that (step 9).

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
   npx wrangler secret put SHIPROCKET_API_EMAIL     # the API user's email (not the main login)
   npx wrangler secret put SHIPROCKET_API_PASSWORD  # the API user's password (shown once by Shiprocket)
   npx wrangler secret put RESEND_API_KEY           # resend.com > API Keys (sending access)
   ```
   Optional: `TURNSTILE_SECRET_KEY` (with `TURNSTILE_REQUIRED = "true"`). Set `LIVE_ENABLED` only at go-live.
6. `npx wrangler deploy`. Copy the printed URL (https://1acrefarms-checkout.<name>.workers.dev) into
   `PUBLIC_URL` in `wrangler.toml` and into `<meta name="checkout-api">` in `checkout-test/index.html`, then deploy again.
   Check that `https://<url>/health` returns `{"ok":true,"mode":"test","checkout":"enabled"}`.
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
   - Shiprocket needs no webhook for this build.
8. **Shiprocket**:
   - Confirm that the Business plan is active.
   - Create the API user: Settings > API > Add New API User, with a new email.
   - Check that the pickup nickname matches `SHIPROCKET_PICKUP_LOCATION`.
   - Keep `SHIPROCKET_PUSH = "off"` until test-checklist step 6.
9. Optional, for local work with real TEST keys: put the same names in `checkout-worker/.dev.vars` (gitignored)
   with `DEV_ORIGINS="http://localhost:4321"`, run `npx wrangler dev`, and open the page from `python3 -m http.server 4321`.

## Test-mode checklist (all in TEST / SANDBOX; no real money)

1. `/health` shows mode test and checkout enabled.
2. Open `https://1acrefarms.co.in/checkout-test/` (hidden, noindex). The yellow TEST MODE banner shows.
3. One cane jaggery to 522601 shows Rs 234 + Rs 99. Two packs worth Rs 990 to 110001 show + Rs 189. Two turmeric
   + one cane (Rs 1,026) shows free delivery.
4. Pay with Razorpay test UPI or card (e.g. Visa 4100 2800 0000 1007, any CVV, a future date) and get the success
   state. In D1, `status = paid` and `paid_source = webhook` or `verify`. **This also proves the Razorpay webhook
   reaches workers.dev** (Cloudflare's Browser Integrity Check is the known risk). If only `verify` or `reconcile`
   ever appears, the webhook is being blocked: look at Razorpay > Webhooks > the delivery log.
5. Failure path: use Razorpay's failure test option. The page shows "Payment did not go through", and D1 shows `failed`.
6. **One real Shiprocket test order:**
   - Set `SHIPROCKET_PUSH = "on"`, deploy, and pay once.
   - The order appears in Shiprocket with our order id, Prepaid, the right weight and pickup.
   - **Cancel it in Shiprocket** (do not assign an AWB), then set `SHIPROCKET_PUSH` back to `"off"`.
7. Failover:
   - Set `PRIMARY_GATEWAY = "cashfree"`, deploy, and pay with Cashfree's sandbox test UPI or card. You should get the success state.
   - Cashfree's webhook should be delivered. Before trusting the signature format, check it once with Cashfree's
     Dev Studio "Webhook verification" tool: we sign `timestamp + raw body` with no separator.
   - Set `PRIMARY_GATEWAY` back to `"razorpay"`.
8. Owner e-mails arrive for a paid order, and for a failover once per hour.

## Look up an order (phone and address live only in D1)

```
npx wrangler d1 execute 1acrefarms-checkout --remote --command \
  "SELECT id, status, gateway, total_paise, ship_status, ship_error, customer_json FROM orders WHERE id = '1AF-T-261112-XXXXXX'"
```

## What each state means

| Field | Values |
|---|---|
| `status` | `new`, then `created` (gateway order made), then `verified` (Razorpay checkout signature OK), then `paid` (capture confirmed). Other values: `failed` (can still turn `paid`), `expired` (unpaid after 24 h; a late payment still counts), `gateway_error` (both gateways down), `amount_mismatch` (needs a human; never shipped). |
| `ship_status` | `skipped` (push off), `pending`, `pushing` (2-minute lease), `retry` (after 15 min, 30 min, 1 h ... up to 8 attempts), `pushed`, `failed` (e-mail: "book by hand") |

The money is captured before Shiprocket is called, so a Shiprocket failure only delays dispatch. The manual fallback is
Shiprocket > Orders > Add Order with the same order id. A repeated order id gets a 422 from Shiprocket, so a retry
can never book twice.

## Known limits

- `workers.dev` is meant for hobby projects, and it always runs Browser Integrity Check, so the Razorpay webhook must be
  proven in test step 4. If webhooks are blocked, the 15-minute reconcile still marks the order paid.
- The `stock` table is read at checkout (a row with qty 0 blocks a pack), but nothing fills it yet. The nightly sync
  from the Stock tab is not built.
- English only. Every visible string is in `STRINGS.en` in `checkout-test/checkout.js`, ready for the 22 languages.
- No customer confirmation e-mail yet (Resend needs a verified sending domain at GoDaddy first). Owner alerts only.
- Data retention: customer rows stay in D1 until a retention job is added. GST needs 72 months of invoices, not addresses.
