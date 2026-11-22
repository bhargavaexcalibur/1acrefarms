#!/usr/bin/env python3
"""Shiprocket from the terminal, through the checkout Worker's admin API (no Shiprocket web login, no 24 h sign-out).

The Worker logs in as the Shiprocket API user and keeps its ~9-day token; this CLI only talks to the Worker
(checkout-worker/src/admin.js), with the admin token from ~/.config/1acrefarms/sr_admin_token.

    python3 tools/sr.py pickups                        # pickup addresses: is "home" there with PIN 522601?
    python3 tools/sr.py wallet                         # wallet balance (LOW below Rs 300)
    python3 tools/sr.py quote 490023 [--qty 2] [--kg 0.6] [--dims 26x18x5] [--value 495] [--all] [--json]
    python3 tools/sr.py quote --shipment 800001        # quote an order already in Shiprocket (its own weight)
    python3 tools/sr.py quote --order 1AF-W-261122-K7Q2XD
    python3 tools/sr.py create order.json              # adhoc order, NO AWB (free); prints the shipment id
    python3 tools/sr.py book 800001 --courier 54 --bhargava-said-ship 402-9649273-4891501            # DRY RUN
    python3 tools/sr.py book 800001 --courier 54 --bhargava-said-ship 402-9649273-4891501 --max-rupees 145 --go
    python3 tools/sr.py track 7D141319206 | track --shipment 800001 | track --ref 402-9649273-4891501
    python3 tools/sr.py label 800001 [--out DIR]       python3 tools/sr.py pickup 800001 [--date 2026-11-23] [--retry]
    python3 tools/sr.py find 402-9649273-4891501       python3 tools/sr.py unlock 800001 --confirm "unlock 800001"
    python3 tools/sr.py cancel 700001 --confirm "cancel 700001"      # before an AWB only (also by our/Amazon ref)
    python3 tools/sr.py init-token                     # makes the token file (chmod 600); prints the wrangler step

THE SHIP RULE: `book` spends Shiprocket wallet money. Run it with --go ONLY after Bhargava has typed "ship <ID>"
for that order, and pass that ID exactly as he typed it with --bhargava-said-ship. One shipment per call ("ship all"
is refused). --max-rupees = the price he saw + Rs 10; the Worker re-quotes live and refuses above it, above Rs 500,
or when the wallet is short. Couriers: DTDC, Blue Dart, India Post only; Delhivery is never booked (or shown).

create's JSON file (one order, typed from Seller Central; phone REQUIRED, e-mail optional):
    {"id": "402-9649273-4891501", "name": "...", "phone": "98xxxxxxxx", "address": "...", "city": "...",
     "state": "Andhra Pradesh", "pin": "522002", "items": [{"sku": "1AF-KPAS-0540", "name": "...", "qty": 1, "price": 495}],
     "weight": 0.6, "dims": "30x25x5"}            (weight/dims optional: default = the Worker's parcel table)

What it never does: print, log or pass the admin token on the command line or in the environment; follow a redirect;
send the token anywhere but --base; book without --go and --bhargava-said-ship; cancel after an AWB; set the Worker
secret or deploy (init-token only PRINTS the `wrangler secret put` command, which needs Bhargava's OK).
Exit codes: 0 ok, 2 usage, 3 refused by the Worker (4xx), 4 Worker / Shiprocket / network trouble.
"""
import argparse
import datetime as dt
import json
import os
import re
import secrets
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://1acrefarms-checkout.1acrefarms-checkout-worker.workers.dev"
TOKEN_FILE = Path.home() / ".config" / "1acrefarms" / "sr_admin_token"
UA = "1acrefarms-sr-cli/1"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
LOW_WALLET = 300
PICKUP_CUTOFF = (12, 30)  # after 12:30 IST "auto" asks for tomorrow's pickup
LABEL_HOSTS = (".amazonaws.com", ".shiprocket.in", ".shiprocket.co")

SR_ID = re.compile(r"^\d{1,12}$")
AWB = re.compile(r"^[A-Za-z0-9]{6,25}$")
REF = re.compile(r"^[A-Za-z0-9-]{4,40}$")


class Refused(Exception):
    """The Worker answered 4xx (exit 3)."""


class Trouble(Exception):
    """Worker 5xx, Shiprocket trouble, network, or not JSON (exit 4)."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # never carry the token to another URL
        raise Trouble(f"the Worker answered a redirect ({code}); refusing to follow it")


OPENER = urllib.request.build_opener(NoRedirect)


# ---------------------------------------------------------------------------------------------------------------------
def read_token(path):
    try:
        st = path.stat()
    except FileNotFoundError:
        sys.exit(f"FAIL  no admin token file at {path}: run `python3 tools/sr.py init-token` (then the wrangler step it prints)")
    if st.st_mode & 0o077:
        sys.exit(f"FAIL  {path} is readable by others: chmod 600 {path}")
    if hasattr(os, "getuid") and st.st_uid != os.getuid():
        sys.exit(f"FAIL  {path} is not owned by you")
    tok = path.read_text(encoding="utf-8").strip()
    if len(tok) < 43:
        sys.exit(f"FAIL  {path} does not hold a usable token (too short)")
    return tok


def check_base(base):
    u = urllib.parse.urlparse(base)
    local = u.hostname in ("127.0.0.1", "localhost", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        sys.exit("FAIL  --base must be https:// (plain http only for localhost)")
    return base.rstrip("/")


def api(args, method, path, body=None, query=None, timeout=60):
    url = args.base + path + (("?" + urllib.parse.urlencode(query)) if query else "")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_unredirected_header("Authorization", f"Bearer {args.token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", UA)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with OPENER.open(req, timeout=timeout) as res:
            status, ctype, raw = res.status, res.headers.get("content-type", ""), res.read()
    except urllib.error.HTTPError as e:
        status, ctype, raw = e.code, e.headers.get("content-type", ""), e.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Trouble(f"network: {getattr(e, 'reason', e)}") from None
    if "json" not in ctype:
        raise Trouble(f"HTTP {status}: the Worker sent {ctype or 'no content type'}, not JSON (a Cloudflare challenge page?)")
    try:
        out = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise Trouble(f"HTTP {status}: unreadable JSON") from None
    if status >= 400 or not out.get("ok"):
        out["_status"] = status
        raise (Refused if 400 <= status < 500 else Trouble)(out)
    return out


def explain(err):
    """One or two lines for a refusal / error body (codes and numbers only)."""
    if not isinstance(err, dict):
        return str(err)
    keep = {k: v for k, v in err.items() if k not in ("ok", "error", "_status") and v not in (None, "", [])}
    extra = "  " + json.dumps(keep, ensure_ascii=False) if keep else ""
    return f"HTTP {err.get('_status')} {err.get('error')}{extra}"


def dump(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def rs(v):
    return "-" if v is None else f"{v:,.2f}"


def ist_now():
    return dt.datetime.now(IST)


# ---------------------------------------------------------------------------------------------------------------------
def cmd_init_token(args):
    path = args.token_file
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        sys.exit(f"FAIL  {path} already exists; not overwritten (delete it by hand to rotate, then set the secret again)")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(secrets.token_urlsafe(48))
    print(f"PASS  token written to {path} (chmod 600, never printed)")
    print("NEXT  (changes the LIVE Worker: only with Bhargava's OK), from checkout-worker/:")
    print(f"        npx wrangler@4 secret put ADMIN_TOKEN --name 1acrefarms-checkout < {path}")


def cmd_pickups(args):
    r = api(args, "GET", "/admin/sr/pickups")
    if args.json:
        return dump(r)
    print(f"{'nickname':<16} {'PIN':<7} {'city':<18} {'status':<7} primary  phone-verified")
    for loc in r["locations"]:
        print(f"{loc['nickname'][:16]:<16} {loc['pin']:<7} {str(loc['city'] or '-')[:18]:<18} {str(loc['status']):<7} "
              f"{'yes' if loc['primary'] else 'no':<8} {'yes' if loc['phoneVerified'] else 'no'}")
    h = r["home"]
    if h["ok"]:
        print(f"PASS  pickup \"{h['nickname']}\" is there with PIN {h['pin']}")
    else:
        print(f"FAIL  pickup \"{h['nickname']}\" with PIN {h['expectedPin']}: "
              + (f"found with PIN {h['pin']}" if h["found"] else "not found (nicknames are case-sensitive)"))


def cmd_wallet(args):
    r = api(args, "GET", "/admin/sr/wallet")
    if args.json:
        return dump(r)
    print(f"Wallet Rs {rs(r['balanceRupees'])}" + (f"  LOW (below Rs {LOW_WALLET}): tell Bhargava to top up" if r["low"] else ""))


def parse_dims(text):
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)\s*", str(text))
    if not m:
        raise SystemExit(f"--dims {text!r}: use LxBxH in cm, e.g. 26x18x5")
    return [float(g) for g in m.groups()]


def print_quote(r, show_all):
    to = r.get("to") or "?"
    what = f"shipment {r['shipmentId']} ({r.get('ref') or '-'})" if r.get("shipmentId") else (r.get("orderId") or "")
    size = f"{r['weightKg']} kg" if r.get("weightKg") is not None else "order's own weight"
    if r.get("dims"):
        size += f" {r['dims']} cm" + (" (ESTIMATE: check the box)" if r.get("parcelEstimated") else "")
    print("  ".join(x for x in (f"Quote {r['from']} ({r['pickup']}) -> {to}", what, size, "prepaid (cod=0)") if x))
    if r.get("awb"):
        print(f"NOTE  already booked: AWB {r['awb']}")
    if r.get("refusal"):
        print(f"NOTE  the Worker would refuse to book this order: {r['refusal']}")
    if not r.get("serviceable"):
        print(f"FAIL  not serviceable: {r.get('srMessage') or 'no courier offered'}")
        return
    rows = r["options"]
    print(f"{'#':>2}  {'courier':<44} {'id':>5} {'Rs':>8} {'days':>4}  {'ETD':<13} cut-off")
    for i, o in enumerate(rows, 1):
        print(f"{i:>2}  {o['courier'][:44]:<44} {o['courierId']:>5} {rs(o['rate']):>8} {str(o['days'] if o['days'] is not None else '-'):>4}  "
              f"{str(o['etd'] or '-')[:13]:<13} {o['cutoff'] or '-'}")
    if show_all:
        for n in r["notAllowed"]:
            print(f" -  {n['courier'][:44]:<44} {str(n['courierId']):>5} {rs(n['rate']):>8}       NOT ALLOWED ({n['reason']})")
    if r["delhivery"]["hidden"]:
        print(f"Hidden: Delhivery x{r['delhivery']['hidden']} (never booked)")
    if r["notAllowed"] and not show_all:
        print("Not on allow-list: " + ", ".join(n["courier"] for n in r["notAllowed"]) + "   (--all lists them)")
    if r.get("blocked"):
        print("Blocked by Shiprocket: " + ", ".join(f"{b['courier']} ({b['reason'] or '-'})" for b in r["blocked"]))
    c = r.get("cheapest")
    if not c:
        print("FAIL  no allowed courier (DTDC / Blue Dart / India Post) serves this PIN")
        return
    print(f"Cheapest allowed: {c['courier']} Rs {rs(c['rate'])} ({c['days'] if c['days'] is not None else '?'} d)")
    if r.get("shipmentId") and not r.get("awb"):
        ref = r.get("ref") or r["shipmentId"]
        print(f"After Bhargava types \"ship {ref}\":")
        print(f"  python3 tools/sr.py book {r['shipmentId']} --courier {c['courierId']} --max-rupees {c['rate'] + 10:.0f} "
              f"--bhargava-said-ship {ref} --go")


def cmd_quote(args):
    if sum(x is not None for x in (args.pin, args.shipment, args.order)) != 1:
        raise SystemExit("quote: give a PIN, or --shipment N, or --order 1AF-W-...")
    body = {}
    if args.shipment is not None:
        body["shipmentId"] = args.shipment
    elif args.order is not None:
        body["orderId"] = args.order
    else:
        body["pin"] = args.pin
        body["packs"] = args.qty
        if args.kg is not None:
            body["weightKg"] = args.kg
        if args.dims:
            body["lengthCm"], body["breadthCm"], body["heightCm"] = parse_dims(args.dims)
    if args.value is not None:
        body["declaredRupees"] = args.value
    r = api(args, "POST", "/admin/sr/quote", body)
    return dump(r) if args.json else print_quote(r, args.all)


def order_body(doc):
    """create's JSON file -> the Worker's /admin/sr/create body (flat file or the Worker's own nested shape)."""
    if not isinstance(doc, dict):
        raise SystemExit("create: the file must hold one JSON object")
    oid = str(doc.get("orderId") or doc.get("id") or "").strip()
    cust = doc.get("customer") if isinstance(doc.get("customer"), dict) else {
        k: doc.get(k) for k in ("name", "phone", "email", "address", "city", "state", "pin") if doc.get(k) not in (None, "")}
    if not str(cust.get("phone") or "").strip():
        raise SystemExit("create: no phone number. The runbook rule: no buyer phone shown on Amazon -> stop and ask Bhargava")
    items = []
    for it in doc.get("items") or []:
        row = {"qty": it.get("qty")}
        if it.get("code"):
            row["code"] = it["code"]
        if it.get("sku"):
            row["sku"] = it["sku"]
        price = it.get("price", it.get("unitRupees"))
        if price is not None:
            row["price"] = price
        items.append(row)
    body = {"orderId": oid, "customer": cust, "items": items}
    parcel = dict(doc["parcel"]) if isinstance(doc.get("parcel"), dict) else {}
    if doc.get("weight") is not None:
        parcel["weightKg"] = float(doc["weight"])
    dims = doc.get("dims")
    if dims:
        parcel["lengthCm"], parcel["breadthCm"], parcel["heightCm"] = parse_dims(dims)
    for k_in, k_out in (("length", "lengthCm"), ("breadth", "breadthCm"), ("height", "heightCm")):
        if doc.get(k_in) is not None:
            parcel[k_out] = float(doc[k_in])
    if parcel:
        body["parcel"] = parcel
    if doc.get("orderDate"):
        body["orderDate"] = doc["orderDate"]
    return body


def cmd_create(args):
    try:
        doc = json.loads(Path(args.file).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"create: cannot read {args.file}: {e}")
    r = api(args, "POST", "/admin/sr/create", order_body(doc))
    if args.json:
        return dump(r)
    print(f"PASS  Shiprocket order {r['srOrderId']}, shipment {r['srShipmentId']} for {r['orderId']} "
          f"(no AWB yet; pickup {r['pickup']}; {r['weightKg']} kg {r['dims']} cm{' ESTIMATE' if r.get('parcelEstimated') else ''})")
    if r.get("srShipmentId"):
        print(f"NEXT  python3 tools/sr.py quote --shipment {r['srShipmentId']}")


def pickup_value(text):
    if text in ("today", "none"):
        return text
    if text == "auto":
        now = ist_now()
        if (now.hour, now.minute) < PICKUP_CUTOFF:
            return "today"
        return (now + dt.timedelta(days=1)).strftime("%Y-%m-%d")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    raise SystemExit("--pickup: auto | today | none | YYYY-MM-DD")


def save_label(url, out_dir, awb):
    host = urllib.parse.urlparse(url).hostname or ""
    if not url.startswith("https://") or not any(host.endswith(h) for h in LABEL_HOSTS):
        return None, f"label link is not https on Shiprocket storage ({host}); not downloaded"
    req = urllib.request.Request(url, headers={"User-Agent": UA})  # no token: it goes to Shiprocket's storage
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return None, f"label download failed: {getattr(e, 'reason', e)}"
    if not data.startswith(b"%PDF-"):
        return None, "the label download is not a PDF"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"shiprocket_label_{awb}.pdf"
    path.write_bytes(data)
    return path, None


def label_dir(args, ref):
    if args.out:
        return Path(args.out).expanduser()
    safe = re.sub(r"[^A-Za-z0-9-]", "_", ref or "label")[:40]
    return ROOT / "print" / "orders" / f"{ist_now():%Y-%m-%d}_{safe}"


def cmd_book(args):
    sid = args.shipment_id
    if not SR_ID.match(sid):
        raise SystemExit("book: the shipment id is digits only (from `create` or `find`)")
    said = args.bhargava_said_ship.strip()
    if said.lower().startswith("ship "):
        said = said[5:].strip()
    if not said or said.lower() == "all" or " " in said:
        raise SystemExit("book: --bhargava-said-ship takes ONE id exactly as Bhargava typed it after 'ship' (no 'ship all')")
    pickup = pickup_value(args.pickup)
    # fresh quote for this shipment, so the plan shows today's price for that courier
    q = api(args, "POST", "/admin/sr/quote", {"shipmentId": sid})
    opt = next((o for o in q["options"] if o["courierId"] == args.courier), None)
    bad = next((n for n in q["notAllowed"] if n["courierId"] == args.courier), None)
    print(f"Shipment {sid}  ref {q.get('ref') or '-'}  -> PIN {q.get('to') or '?'}  Bhargava said: \"ship {said}\"")
    if q.get("awb"):
        raise Refused({"_status": 409, "error": "already_booked", "awb": q["awb"]})
    if q.get("refusal"):
        raise Refused({"_status": 409, "error": q["refusal"]})
    if said not in (q.get("ref"), sid):
        raise Refused({"_status": 400, "error": "said_mismatch", "ref": q.get("ref")})
    if not opt:
        reason = bad["reason"] if bad else "not offered for this shipment (or a Delhivery id: never booked)"
        raise Refused({"_status": 409, "error": "courier_not_usable", "courierId": args.courier, "reason": reason})
    print(f"Plan  {opt['courier']} (id {opt['courierId']}) Rs {rs(opt['rate'])}, {opt['days']} d, ETD {opt['etd'] or '-'}; "
          f"pickup {pickup}{'; manifest' if args.manifest else ''}")
    cheaper = [o for o in q["options"] if o["rate"] < opt["rate"]]
    if cheaper:
        print(f"NOTE  cheaper allowed: {cheaper[0]['courier']} Rs {rs(cheaper[0]['rate'])} (id {cheaper[0]['courierId']})")
    if not args.go:
        print("DRY RUN: nothing booked. To book (spends wallet money), add:"
              f" --max-rupees {opt['rate'] + 10:.0f} --go")
        return
    if args.max_rupees is None:
        raise SystemExit("book --go: pass --max-rupees (the price Bhargava saw + Rs 10); the Worker refuses above it")
    body = {"shipmentId": sid, "courierId": args.courier, "maxRupees": args.max_rupees, "said": f"ship {said}",
            "confirm": f"ship {sid}", "pickup": pickup, "manifest": bool(args.manifest)}
    r = api(args, "POST", "/admin/sr/book", body, timeout=150)
    if args.json:
        return dump(r)
    print(f"PASS  BOOKED {r['ref']}: {r['courier']} AWB {r['awb']}  Rs {rs(r['rate'])}")
    p = r.get("pickup") or {}
    if not p.get("requested"):
        print("      pickup: none requested (counter drop)")
    elif p.get("ok"):
        print(f"      pickup: scheduled {p.get('scheduledDate') or '-'}  {p.get('token') or ''}".rstrip())
    else:
        print(f"FAIL  pickup NOT scheduled ({p.get('reason')}): python3 tools/sr.py pickup {sid} [--retry]")
    if r.get("labelUrl"):
        path, err = save_label(r["labelUrl"], label_dir(args, r["ref"]), r["awb"])
        print(f"      label: {path}" if path else f"FAIL  {err}; try: python3 tools/sr.py label {sid}")
    else:
        print(f"FAIL  label not made ({r.get('labelError')}): python3 tools/sr.py label {sid}")
    if r.get("manifestUrl"):
        print("      manifest: made (open it in Shiprocket > Manifests)")
    w = r.get("walletAfterRupees")
    print(f"      wallet after: Rs {rs(w)}" + (f"  LOW (below Rs {LOW_WALLET}): tell Bhargava" if r.get("walletLow") else ""))


def cmd_label(args):
    if not SR_ID.match(args.shipment_id):
        raise SystemExit("label: shipment id is digits only")
    r = api(args, "POST", "/admin/sr/label", {"shipmentId": args.shipment_id})
    if args.json:
        return dump(r)
    ref = args.ref or r["shipmentId"]
    path, err = save_label(r["labelUrl"], label_dir(args, ref), r["awb"])
    if path:
        print(f"PASS  label for AWB {r['awb']}: {path}")
    else:
        raise Trouble(err)


def cmd_pickup(args):
    if not SR_ID.match(args.shipment_id):
        raise SystemExit("pickup: shipment id is digits only")
    body = {"shipmentId": args.shipment_id, "retry": bool(args.retry)}
    if args.date:
        body["date"] = args.date
    r = api(args, "POST", "/admin/sr/pickup", body)
    if args.json:
        return dump(r)
    print(f"PASS  pickup scheduled {r.get('scheduledDate') or '-'}  {r.get('token') or ''}".rstrip())


def cmd_track(args):
    given = [(k, v) for k, v in (("awb", args.awb), ("shipment", args.shipment), ("ref", args.ref)) if v]
    if len(given) != 1:
        raise SystemExit("track: give an AWB, or --shipment N, or --ref ID")
    k, v = given[0]
    if (k == "awb" and not AWB.match(v)) or (k == "shipment" and not SR_ID.match(v)) or (k == "ref" and not REF.match(v)):
        raise SystemExit(f"track: {v!r} is not a valid {k}")
    r = api(args, "GET", "/admin/sr/track", query={k: v})
    if args.json:
        return dump(r)
    if r.get("noActivity"):
        print(f"{v}: no tracking activity yet (not picked up){'  ' + r['message'] if r.get('message') else ''}")
        return
    print(f"AWB {r.get('awb') or '-'}  {r.get('courier') or '-'}  status {r.get('currentStatus') or '-'}  "
          f"picked up: {'YES' + (' ' + r['pickupDate'] if r.get('pickupDate') else '') if r.get('pickedUp') else 'no'}")
    if r.get("deliveredDate"):
        print(f"delivered {r['deliveredDate']}")
    print(f"EDD {r.get('edd') or r.get('etd') or '-'}   {r.get('trackUrl') or ''}".rstrip())
    for a in (r.get("activities") or [])[: args.last]:
        print(f"  {str(a.get('date') or '')[:16]:<16}  {str(a.get('label') or '')[:22]:<22}  {str(a.get('location') or '')[:22]:<22}  {a.get('activity') or ''}")


def cmd_find(args):
    if not REF.match(args.ref):
        raise SystemExit("find: an order id (ours or Amazon's) or an AWB")
    r = api(args, "GET", "/admin/sr/find", query={"ref": args.ref})
    if args.json:
        return dump(r)
    if not r["matches"]:
        print(f"{args.ref}: not found in Shiprocket")
    for m in r["matches"]:
        print(f"Shiprocket order {m['srOrderId']}  ref {m['channelOrderId']}  {m.get('status') or '-'}  "
              f"shipment {m.get('shipmentId') or '-'}  AWB {m.get('awb') or '-'}  {m.get('courier') or ''}".rstrip())


def cmd_cancel(args):
    oid = args.order_id.strip()
    expected = f"cancel {oid}"
    if args.confirm != expected:
        raise SystemExit(f"cancel is irreversible: pass --confirm \"{expected}\" exactly (only for an order with NO AWB)")
    body = {"srOrderId": oid} if SR_ID.match(oid) else {"ref": oid}
    if "ref" in body and not REF.match(oid):
        raise SystemExit("cancel: a Shiprocket order id (digits) or our / Amazon order id")
    body["confirm"] = expected
    r = api(args, "POST", "/admin/sr/cancel", body)
    if args.json:
        return dump(r)
    print(f"PASS  cancelled Shiprocket order {r['cancelled']} ({r.get('ref') or '-'})")


def cmd_unlock(args):
    sid = args.shipment_id
    expected = f"unlock {sid}"
    if args.confirm != expected:
        raise SystemExit(f"unlock: first check `python3 tools/sr.py track --shipment {sid}` shows NO AWB, then pass --confirm \"{expected}\"")
    r = api(args, "POST", "/admin/sr/unlock", {"shipmentId": sid, "confirm": expected})
    if args.json:
        return dump(r)
    print(f"PASS  booking lock for shipment {r['unlocked']} released (Shiprocket shows no AWB)")


# ---------------------------------------------------------------------------------------------------------------------
def build_parser():
    p = argparse.ArgumentParser(prog="sr.py", description="Shiprocket through the checkout Worker's admin API.",
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    p.add_argument("--base", default=BASE, help="Worker URL (default: the live checkout Worker)")
    p.add_argument("--token-file", type=Path, default=TOKEN_FILE, help=f"admin token file (default {TOKEN_FILE})")
    p.add_argument("--json", action="store_true", help="print the Worker's JSON reply")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="print the Worker's JSON reply")
    sub = p.add_subparsers(dest="cmd", required=True)

    def command(name, **kw):
        return sub.add_parser(name, parents=[common], **kw)

    command("init-token", help="create the admin token file (chmod 600)").set_defaults(fn=cmd_init_token, no_token=True)
    command("pickups", help="pickup addresses; checks 'home' / 522601").set_defaults(fn=cmd_pickups)
    command("wallet", help="wallet balance").set_defaults(fn=cmd_wallet)

    q = command("quote", help="courier rates (allowed couriers only, cheapest first)")
    q.add_argument("pin", nargs="?", help="delivery PIN")
    q.add_argument("--qty", type=int, default=1, help="pouches in the parcel (default 1)")
    q.add_argument("--kg", type=float, help="weight override in kg (default: the Worker's parcel table)")
    q.add_argument("--dims", help="size override LxBxH cm, e.g. 26x18x5")
    q.add_argument("--value", type=float, help="declared value Rs")
    q.add_argument("--shipment", help="quote a shipment already in Shiprocket")
    q.add_argument("--order", help="quote one of our website orders (1AF-W-...)")
    q.add_argument("--all", action="store_true", help="also list couriers that are not allowed (never Delhivery)")
    q.set_defaults(fn=cmd_quote)

    c = command("create", help="create a Shiprocket order from a JSON file (no AWB, free)")
    c.add_argument("file")
    c.set_defaults(fn=cmd_create)

    b = command("book", help="assign the AWB (SPENDS MONEY; dry run unless --go)")
    b.add_argument("shipment_id")
    b.add_argument("--courier", type=int, required=True, help="courier id from `quote`")
    b.add_argument("--bhargava-said-ship", required=True, metavar="ID", help="the ID Bhargava typed after 'ship' (exactly)")
    b.add_argument("--max-rupees", type=float, help="refuse above this (the price he saw + Rs 10); needed with --go")
    b.add_argument("--pickup", default="auto", help="auto (today before 12:30 IST, else tomorrow) | today | none (counter drop) | YYYY-MM-DD")
    b.add_argument("--manifest", action="store_true", help="also generate the manifest (scheduled pickups only)")
    b.add_argument("--out", help="folder for the label PDF (default print/orders/<date>_<ref>/)")
    b.add_argument("--go", action="store_true", help="really book (without it: dry run)")
    b.set_defaults(fn=cmd_book)

    t = command("track", help="tracking: picked up yet?")
    t.add_argument("awb", nargs="?")
    t.add_argument("--shipment")
    t.add_argument("--ref", help="our or Amazon order id")
    t.add_argument("--last", type=int, default=6, help="activities to show (default 6)")
    t.set_defaults(fn=cmd_track)

    lb = command("label", help="download the label PDF")
    lb.add_argument("shipment_id")
    lb.add_argument("--out", help="folder (default print/orders/<date>_<ref>/)")
    lb.add_argument("--ref", help="name the default folder after this order id")
    lb.set_defaults(fn=cmd_label)

    pk = command("pickup", help="request a pickup for a booked shipment")
    pk.add_argument("shipment_id")
    pk.add_argument("--date", help="YYYY-MM-DD (default: next slot)")
    pk.add_argument("--retry", action="store_true", help="retry after a failed pickup request")
    pk.set_defaults(fn=cmd_pickup)

    f = command("find", help="find a Shiprocket order by our/Amazon id or AWB")
    f.add_argument("ref")
    f.set_defaults(fn=cmd_find)

    cx = command("cancel", help="cancel an order that has NO AWB (irreversible)")
    cx.add_argument("order_id", help="Shiprocket order id, or our / Amazon order id")
    cx.add_argument("--confirm", required=True, help='exactly "cancel <order_id>"')
    cx.set_defaults(fn=cmd_cancel)

    u = command("unlock", help="release a booking lock after a timed-out booking (only while there is no AWB)")
    u.add_argument("shipment_id")
    u.add_argument("--confirm", required=True, help='exactly "unlock <shipment_id>"')
    u.set_defaults(fn=cmd_unlock)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.token_file = args.token_file.expanduser()
    if not getattr(args, "no_token", False):
        args.base = check_base(args.base)
        args.token = read_token(args.token_file)
    try:
        args.fn(args)
    except Refused as e:
        sys.stdout.flush()
        print(f"REFUSED  {explain(e.args[0])}", file=sys.stderr)
        return 3
    except Trouble as e:
        sys.stdout.flush()
        print(f"ERROR  {explain(e.args[0])}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
