#!/usr/bin/env python3
"""Which of our Amazon.in listings a shopper can buy right now, saved to tools/amazon.json.

The site shows "Buy on Amazon" only for a pack whose Amazon page has our title and no "Currently
unavailable", so nobody lands on a dead listing. A pack whose page Amazon says does not exist
(new listing not yet public) is marked not buyable. Anything else (robot check, network drop)
keeps the last known answer, so one bad fetch never removes a button.

Run from the repo root, then rebuild:
  python3 tools/amazon_check.py && python3 tools/build_pages.py

Amazon often answers curl with its robot check (every curl check from 02-11 to 06-11-2026 got it, so
"unknown, kept"). Never try to get around that page. Read the pack's state yourself instead, from our
Seller Central inventory or the public listing open in a real browser ("In stock" + Add to Cart =
buyable; "Currently unavailable" = unavailable). Then record it:
  python3 tools/amazon_check.py --set TURM=buyable SANN=unavailable
"""
import json
import re
import sys
import subprocess
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "tools" / "amazon.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def fetch(url):
    # curl, not urllib: Amazon answers urllib with a robot check
    for attempt in range(3):  # this Mac's Wi-Fi drops for ~30 s now and then
        r = subprocess.run(["curl", "-s", "-L", "--max-time", "30", "-A", UA, "-H", "Accept-Language: en-IN,en;q=0.9", url],
                           capture_output=True, text=True, errors="replace")
        if r.returncode == 0 and r.stdout:
            return r.stdout
        print(f"  retry {attempt + 1}: curl exit {r.returncode}")
        time.sleep(10)
    return None


def state(page):
    """True (buyable), False (unavailable / not public) or None (can't tell)."""
    if page is None:
        return None
    if "<title>Page Not Found</title>" in page:
        return False
    title = re.search(r'<span id="productTitle"[^>]*>([^<]*)', page)
    if not title or "1acrefarms" not in title.group(1):
        return None  # robot check or a page we don't recognise
    if "Currently unavailable" in page:
        return False
    return "add-to-cart-button" in page


def set_from_browser(doc, args):
    """--set CODE=buyable|unavailable: a reading made in a real browser or in Seller Central."""
    changed = False
    for arg in args:
        code, _, val = arg.partition("=")
        if code not in doc["packs"] or val not in ("buyable", "unavailable"):
            raise SystemExit(f"bad --set value {arg!r}: use CODE=buyable or CODE=unavailable, CODE one of {', '.join(doc['packs'])}")
        row, now = doc["packs"][code], val == "buyable"
        changed |= row.get("buyable") != now
        row.update(buyable=now, checked=date.today().isoformat(), source="browser")
        print(f"{code} {row['asin']}: {val} (browser reading)")
    return changed


def main():
    doc = json.loads(FILE.read_text(encoding="utf-8"))
    if sys.argv[1:2] == ["--set"]:
        if not sys.argv[2:]:
            raise SystemExit("--set needs at least one CODE=buyable|unavailable")
        changed = set_from_browser(doc, sys.argv[2:])
        FILE.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
        print("changed" if changed else "no change")
        return 0
    changed = False
    for code, row in doc["packs"].items():
        now = state(fetch(f"https://www.amazon.in/dp/{row['asin']}"))
        word = {True: "buyable", False: "not buyable", None: "unknown, kept"}[now]
        print(f"{code} {row['asin']}: {word}")
        if now is not None:
            changed |= row.get("buyable") != now
            row["buyable"] = now
            row["checked"] = date.today().isoformat()
            row["source"] = "curl"
    FILE.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print("changed" if changed else "no change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
