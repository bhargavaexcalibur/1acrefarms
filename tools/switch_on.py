#!/usr/bin/env python3
"""Switch on direct orders on 1acrefarms.co.in: ONE step, on the day the FSSAI Central licence is granted.

    python3 tools/switch_on.py             # DRY RUN (the default): checks every gate, prints what is missing, changes nothing
    python3 tools/switch_on.py --apply     # only when every gate passes: CHECKOUT_LIVE = True in tools/build_pages.py,
                                           # policies.html "Last updated", the full site build, one commit on this branch;
                                           # then it PRINTS the deploy / merge / push commands for a human to run
    python3 tools/switch_on.py --offline   # skip the two network checks (wrangler secret names, the Worker's /health)
    python3 tools/switch_on.py --set-licence=<14 digits>
                                           # GRANT DAY step 1: writes the granted number into tools/build_pages.py, the
                                           # wrangler.toml [vars] line, the index.html footer and policies.html (row +
                                           # footer). It never sets FSSAI_ECOM_KOB_ENDORSED (a deliberate hand edit).

What it never does: push, deploy, set or print a secret, or touch wrangler.toml beyond that one FSSAI_ECOM_LIC line. Cloudflare is asked for
secret NAMES only (`npx wrangler@4 secret list`), and the Worker's public /health for its mode.
The owner's steps around it, and the rollback: docs/marketing/checkout-plan/switch-on-runbook.md (local, not in git).

Gates (each line prints PASS, FAIL or CHECK; --apply refuses while any FAIL is left):
  site     FSSAI_ECOM_LIC in tools/build_pages.py = the granted 14-digit licence; index.html and policies.html carry it
           (their GRANT DAY comments); catalogue.json sells at least one pack and matches the pack pages
  worker   wrangler.toml [vars]: MODE = "live", FSSAI_ECOM_LIC = the same number, FSSAI_ECOM_KOB_ENDORSED = "yes",
           SHIPROCKET_PUSH not "off", a usable GATEWAY_ORDER, PUBLIC_URL / SITE_URL set
  secrets  LIVE_ENABLED, Razorpay (key id, key secret, webhook secret), Shiprocket API user (email, password), Resend key,
           and the keys of every other gateway named in GATEWAY_ORDER
  razorpay a LIVE key (rzp_live_...): read from the deployed Worker's /health, which refuses orders with
           live_key_in_test_mode while a live key sits in a test-mode Worker (and test_key_in_live_mode the other way)
  resend   reminder only: the sending domain of CUSTOMER_MAIL_FROM is Verified in Resend (tracking off)
  code     the Worker's tests and smoke run pass; this branch, clean working tree
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "checkout-worker"
BUILD_PAGES = ROOT / "tools" / "build_pages.py"
BRANCH = "checkout-b-build"
SITE = "https://1acrefarms.co.in"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

RESULTS = []  # (status, gate, detail)


def gate(status, name, detail=""):
    RESULTS.append((status, name, detail))


def run(cmd, cwd=ROOT, timeout=300, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env, stdin=subprocess.DEVNULL)


def py_const(src, name):
    m = re.search(rf'^{name} = (.+?)(?:\s+#.*)?$', src, re.M)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------------------------------------------------
def check_site():
    src = BUILD_PAGES.read_text(encoding="utf-8")
    flag = py_const(src, "CHECKOUT_LIVE")
    if flag not in ("False", "True"):
        gate("FAIL", "CHECKOUT_LIVE line", "tools/build_pages.py must have exactly 'CHECKOUT_LIVE = False' on its own line")
    elif flag == "True":
        gate("PASS", "CHECKOUT_LIVE", "already True: direct orders are already switched on in this branch")
    else:
        gate("PASS", "CHECKOUT_LIVE", "False now (the --apply step flips it)")
    lic = (py_const(src, "FSSAI_ECOM_LIC") or "").strip('"\'')
    reg = (py_const(src, "FSSAI_REG") or "").strip('"\'')
    if not re.fullmatch(r"\d{14}", lic) or lic == reg:
        gate("FAIL", "FSSAI licence (site)", 'set FSSAI_ECOM_LIC = "<the 14-digit FSSAI Central licence number>" in '
             "tools/build_pages.py, only once FoSCoS shows it GRANTED (not the Reg. No., never a placeholder)")
        lic = ""
    else:
        gate("PASS", "FSSAI licence (site)", f"FSSAI_ECOM_LIC = {lic}")
    if lic:
        stale = [f for f in ("index.html", "policies.html") if lic not in (ROOT / f).read_text(encoding="utf-8")]
        if stale:
            gate("FAIL", "licence on hand-written pages", f"add {lic} by hand to {', '.join(stale)} as their GRANT DAY "
                 "comments say (the build stops without it)")
        else:
            gate("PASS", "licence on hand-written pages", "index.html and policies.html carry it")
    # catalogue: well formed, matches the pack pages, sells something
    probe = run([sys.executable, "-c", "import sys; sys.dont_write_bytecode = True; sys.path.insert(0, 'tools'); "
                 "import build_pages as bp; bp.check_catalogue(); "
                 "print(','.join(c for c, r in bp.CATALOGUE.items() if r['sellable']))"])
    sold = probe.stdout.strip()
    if probe.returncode != 0:
        gate("FAIL", "catalogue.json", (probe.stderr or probe.stdout).strip().splitlines()[-1][:200])
    elif not sold:
        gate("FAIL", "catalogue.json", 'no pack has "sellable": true in checkout-worker/src/catalogue.json')
    else:
        gate("PASS", "catalogue.json", f"sold here: {sold.replace(',', ', ')}")
    return lic


def check_worker_vars(lic):
    f = WORKER / "wrangler.toml"
    if not f.exists():
        gate("FAIL", "wrangler.toml", "checkout-worker/wrangler.toml is missing (README Owner setup step 3)")
        return {}
    try:
        v = tomllib.loads(f.read_text(encoding="utf-8")).get("vars", {})
    except tomllib.TOMLDecodeError as e:
        gate("FAIL", "wrangler.toml", f"cannot read it: {e}")
        return {}
    s = lambda k: str(v.get(k, "")).strip()  # noqa: E731
    gate("PASS" if s("MODE") == "live" else "FAIL", "MODE", 'live' if s("MODE") == "live" else
         f'wrangler.toml [vars] MODE = "live" (now "{s("MODE") or "unset"}")')
    if not lic:
        gate("FAIL", "FSSAI licence (Worker)", "set the site's FSSAI_ECOM_LIC first, then the same number here")
    elif s("FSSAI_ECOM_LIC") != lic:
        gate("FAIL", "FSSAI licence (Worker)", f'wrangler.toml [vars] FSSAI_ECOM_LIC = "{lic}" (the same number as the site)')
    else:
        gate("PASS", "FSSAI licence (Worker)", "same number as the site")
    gate("PASS" if s("FSSAI_ECOM_KOB_ENDORSED") == "yes" else "FAIL", "E-commerce kind of business",
         "endorsed" if s("FSSAI_ECOM_KOB_ENDORSED") == "yes" else
         'FSSAI_ECOM_KOB_ENDORSED = "yes" in wrangler.toml, ONLY when the granted licence lists the E-commerce kind of business')
    push = s("SHIPROCKET_PUSH")
    gate("FAIL" if push == "off" else "PASS", "Shiprocket push",
         'remove SHIPROCKET_PUSH = "off" from wrangler.toml (or set "on"): paid orders must reach Shiprocket'
         if push == "off" else f'on (SHIPROCKET_PUSH = "{push or "unset"}"; live mode pushes unless "off")')
    order = [g.strip().lower() for g in (s("GATEWAY_ORDER") or "razorpay,cashfree,phonepe").split(",")]
    order = [g for i, g in enumerate(order) if g in ("razorpay", "cashfree", "phonepe") and g not in order[:i]]
    if not order:
        gate("FAIL", "GATEWAY_ORDER", 'no gateway (e.g. "none"): set GATEWAY_ORDER = "razorpay" (add the backups once live)')
    else:
        gate("PASS" if order[0] == "razorpay" else "CHECK", "GATEWAY_ORDER", " -> ".join(order) +
             ("" if order[0] == "razorpay" else ": Razorpay is the main gateway; is this order meant?"))
    url = s("PUBLIC_URL")
    if not url.startswith("https://") or "REPLACE" in url:
        gate("FAIL", "PUBLIC_URL", "wrangler.toml PUBLIC_URL = the Worker's https://...workers.dev address")
    else:
        gate("PASS", "PUBLIC_URL", url)
    site = s("SITE_URL").rstrip("/")
    gate("PASS" if site in ("", SITE) else "FAIL", "SITE_URL", SITE if site in ("", SITE) else f'SITE_URL = "{SITE}"')
    if s("CUSTOMER_MAIL_FROM"):
        gate("PASS", "order e-mail sender", s("CUSTOMER_MAIL_FROM"))
    else:
        gate("CHECK", "order e-mail sender", "CUSTOMER_MAIL_FROM is not set: buyers get no confirmation e-mail "
             "(README step 10). Not a blocker, but set it before the first real order if you can.")
    if s("TURNSTILE_REQUIRED") == "true":
        gate("CHECK", "Turnstile", 'TURNSTILE_REQUIRED = "true" but the page has no Turnstile widget yet: every order '
             'would be refused. Set it to "false" unless the widget was added.')
    return {"order": order, "url": url, "turnstile": s("TURNSTILE_REQUIRED") == "true"}


def required_secrets(order, turnstile):
    need = {"LIVE_ENABLED": "value: yes-owner-approved; only on the day, it is Bhargava's go",
            "RAZORPAY_KEY_ID": "the LIVE key id (rzp_live_...)", "RAZORPAY_KEY_SECRET": "the LIVE key secret",
            "RAZORPAY_WEBHOOK_SECRET": "the secret of the LIVE webhook (Razorpay > Webhooks, Live mode)",
            "SHIPROCKET_API_EMAIL": "the Shiprocket API user's email", "SHIPROCKET_API_PASSWORD": "its password",
            "RESEND_API_KEY": "resend.com > API Keys"}
    if "cashfree" in order:
        need.update({"CASHFREE_APP_ID": "Cashfree PRODUCTION app id", "CASHFREE_SECRET_KEY": "Cashfree PRODUCTION secret key"})
    if "phonepe" in order:
        need.update({"PHONEPE_CLIENT_ID": "PhonePe production client id", "PHONEPE_CLIENT_SECRET": "its client secret",
                     "PHONEPE_CLIENT_VERSION": "its client version"})
    if turnstile:
        need["TURNSTILE_SECRET_KEY"] = "Cloudflare Turnstile secret"
    return need


def check_secrets(order, turnstile):
    """Secret NAMES from Cloudflare (never values)."""
    env = {**os.environ, "CI": "true", "WRANGLER_SEND_METRICS": "false"}  # CI: wrangler never opens a browser login
    try:
        r = run(["npx", "--yes", "wrangler@4", "secret", "list", "--format", "json"], cwd=WORKER, timeout=180, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        gate("CHECK", "Worker secrets", f"could not ask Cloudflare ({type(e).__name__}); run again, or check by hand: "
             "cd checkout-worker && npx wrangler@4 secret list")
        return
    names = None
    if r.returncode == 0:
        i = r.stdout.find("[")
        try:
            rows = json.loads(r.stdout[i:]) if i >= 0 else None
            names = {row["name"] for row in rows if isinstance(row, dict) and isinstance(row.get("name"), str)}
        except (ValueError, TypeError, KeyError):
            names = None
    if names is None:  # never echo wrangler's output: print only what kind of failure it was
        why = "not logged in: run `npx wrangler login` in checkout-worker/ first" if re.search(
            r"login|auth|not authenticated|CLOUDFLARE_API_TOKEN", r.stderr + r.stdout, re.I) else "unexpected answer"
        gate("CHECK", "Worker secrets", f"wrangler secret list failed ({why})")
        return
    for name, how in required_secrets(order, turnstile).items():
        if name in names:
            gate("PASS", f"secret {name}", "present (value not read)")
        else:
            gate("FAIL", f"secret {name}", f"missing: cd checkout-worker && npx wrangler@4 secret put {name}   ({how})")
    if "phonepe" in order:
        for name in ("PHONEPE_WEBHOOK_USERNAME", "PHONEPE_WEBHOOK_PASSWORD"):
            if name not in names:
                gate("CHECK", f"secret {name}", "missing: PhonePe webhooks will be refused (orders still settle via /verify)")


def check_health(url):
    """The deployed Worker's own view: live key or not, and (after the live deploy) whether it takes orders."""
    if not url:
        gate("CHECK", "Razorpay live key", "PUBLIC_URL unknown: cannot ask the Worker")
        return
    try:
        req = urllib.request.Request(url.rstrip("/") + "/health", headers={"Origin": SITE, "User-Agent": "1acrefarms-switch-on"})
        with urllib.request.urlopen(req, timeout=20) as res:
            h = json.loads(res.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        gate("CHECK", "Razorpay live key", f"/health did not answer ({type(e).__name__}): check by hand that RAZORPAY_KEY_ID "
             "holds the rzp_live_ key id")
        return
    mode, state, reason = h.get("mode"), h.get("checkout"), h.get("reason")
    if mode == "live" and state == "enabled":
        gate("PASS", "Razorpay live key", "the Worker is already LIVE and taking orders")
    elif mode == "test" and reason == "live_key_in_test_mode":
        gate("PASS", "Razorpay live key", "a live rzp_live_ key is set (the test-mode Worker now refuses orders until the "
             "live deploy, as designed)")
    elif mode == "test" and state == "enabled":
        gate("FAIL", "Razorpay live key", "RAZORPAY_KEY_ID is still a TEST key: npx wrangler@4 secret put RAZORPAY_KEY_ID "
             "(the rzp_live_ key id), then RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET for live mode")
    elif mode == "live" and reason == "test_key_in_live_mode":
        gate("FAIL", "Razorpay live key", "the Worker is live but RAZORPAY_KEY_ID is a test key: put the rzp_live_ key id")
    elif mode == "live":
        gate("FAIL", "Worker live gates", f"the deployed Worker refuses orders: {reason} (README Go-live gates)")
    else:
        gate("CHECK", "Razorpay live key", f"/health says mode={mode}, checkout={state}, reason={reason}: check by hand")


def check_code():
    br = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    gate("PASS" if br == BRANCH else "FAIL", "branch", br if br == BRANCH else
         f"on '{br}': run this in the {BRANCH} worktree (the script commits there, never on main)")
    dirty = [line for line in run(["git", "status", "--porcelain"]).stdout.splitlines() if line.strip()]
    gate("PASS" if not dirty else "FAIL", "clean working tree", "clean" if not dirty else
         f"{len(dirty)} uncommitted change(s), e.g. {dirty[0][3:]}: commit or stash them first")
    t = run(["node", "--test"], cwd=WORKER, timeout=600)
    m = re.search(r"ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)", t.stdout)
    if t.returncode == 0 and m and m.group(2) == "0":
        gate("PASS", "Worker tests", f"{m.group(1)} pass, 0 fail")
    else:
        gate("FAIL", "Worker tests", f"node --test failed in checkout-worker ({m.group(2) if m else '?'} failing): fix first")
    s = run(["node", "scripts/smoke.mjs"], cwd=WORKER, timeout=600)
    m = re.search(r"smoke: (\d+) checks passed", s.stdout)
    gate("PASS" if s.returncode == 0 and m else "FAIL", "Worker smoke run",
         f"{m.group(1)} checks passed" if s.returncode == 0 and m else "node scripts/smoke.mjs failed: fix first")


def report():
    width = max(len(n) for _, n, _ in RESULTS)
    for status, name, detail in RESULTS:
        print(f"  {status:5} {name.ljust(width)}  {detail}")
    fails = [n for s, n, _ in RESULTS if s == "FAIL"]
    checks = [n for s, n, _ in RESULTS if s == "CHECK"]
    print()
    print(f"  {len(RESULTS)} gates: {len(RESULTS) - len(fails) - len(checks)} PASS, {len(fails)} FAIL, {len(checks)} CHECK")
    print("  Reminder: Resend > Domains must show the CUSTOMER_MAIL_FROM domain as Verified, open and click tracking OFF.")
    return fails, checks


# ---------------------------------------------------------------------------------------------------------------------
def set_licence(lic):
    """Grant day, step 1: write the granted licence number everywhere it must appear, in one go:
    tools/build_pages.py FSSAI_ECOM_LIC, checkout-worker/wrangler.toml [vars] FSSAI_ECOM_LIC, and the hand-written
    index.html footer and policies.html (seller table row + footer), exactly as their GRANT DAY comments say.
    It does NOT set FSSAI_ECOM_KOB_ENDORSED: that stays a deliberate hand edit after reading the licence itself."""
    if not re.fullmatch(r"\d{14}", lic):
        sys.exit(f"--set-licence: {lic!r} is not 14 digits")
    src = BUILD_PAGES.read_text(encoding="utf-8")
    reg = (py_const(src, "FSSAI_REG") or "20126161000590").strip('"\'')
    if lic == reg:
        sys.exit("--set-licence: that is the packing unit's Registration No., not the Central licence")
    label = (py_const(src, "FSSAI_ECOM_LIC_LABEL") or "FSSAI Lic. No.").strip('"\'')
    new, n = re.subn(r'^FSSAI_ECOM_LIC = "[^"]*"', f'FSSAI_ECOM_LIC = "{lic}"', src, count=1, flags=re.M)
    if n != 1:
        sys.exit("--set-licence: no 'FSSAI_ECOM_LIC = \"...\"' line in tools/build_pages.py")
    changed = ["tools/build_pages.py"]
    BUILD_PAGES.write_text(new, encoding="utf-8")

    toml = WORKER / "wrangler.toml"
    if toml.exists():
        t = toml.read_text(encoding="utf-8")
        t2, n = re.subn(r'^#?\s*FSSAI_ECOM_LIC\s*=\s*"[^"]*"', f'FSSAI_ECOM_LIC = "{lic}"', t, count=1, flags=re.M)
        if n == 0:
            t2 = re.sub(r"^\[vars\]\s*$", f'[vars]\nFSSAI_ECOM_LIC = "{lic}"', t, count=1, flags=re.M)
        if t2 != t:
            toml.write_text(t2, encoding="utf-8")
            changed.append("checkout-worker/wrangler.toml (not in git)")

    idx = ROOT / "index.html"
    t = idx.read_text(encoding="utf-8")
    if lic not in t:
        old = f"FSSAI Reg. No. {reg} &middot; Made in India</p>"
        if t.count(old) != 1:
            sys.exit("--set-licence: index.html footer line not found as expected; edit it by hand (GRANT DAY comment)")
        t = t.replace(old, f"FSSAI Reg. No. (packing unit) {reg} &middot; {label} {lic} &middot; Made in India</p>")
        idx.write_text(t, encoding="utf-8")
        changed.append("index.html")

    pol = ROOT / "policies.html"
    t = pol.read_text(encoding="utf-8")
    if lic not in t:
        row = f'<tr><th scope="row">FSSAI</th><td>Registration No. {reg}</td></tr>'
        foot = f"FSSAI Reg. No. {reg} · Made in India</p>"
        if t.count(row) != 1 or t.count(foot) != 1:
            sys.exit("--set-licence: policies.html seller row or footer not found as expected; edit by hand (GRANT DAY comments)")
        t = t.replace(row, row.replace(f"Registration No. {reg}", f"Registration No. {reg} (packing unit)")
                      + f'\n        <tr><th scope="row">{label}</th><td>{lic} (FSSAI Central licence, Shop No. 7)</td></tr>')
        t = t.replace(foot, f"FSSAI Reg. No. (packing unit) {reg} · {label} {lic} · Made in India</p>")
        pol.write_text(t, encoding="utf-8")
        changed.append("policies.html")
    print("Licence written to: " + ", ".join(changed) + ".\nNext: read the licence; only if it lists E-commerce, set "
          'FSSAI_ECOM_KOB_ENDORSED = "yes" in checkout-worker/wrangler.toml [vars]. Then run tools/switch_on.py (dry run).')

# ---------------------------------------------------------------------------------------------------------------------
def apply(url):
    src = BUILD_PAGES.read_text(encoding="utf-8")
    new, n = re.subn(r"^CHECKOUT_LIVE = False$", "CHECKOUT_LIVE = True", src, count=1, flags=re.M)
    if n != 1:
        sys.exit("--apply: 'CHECKOUT_LIVE = False' not found in tools/build_pages.py (already on?)")
    BUILD_PAGES.write_text(new, encoding="utf-8")
    today = dt.datetime.now(IST).date()
    pol = ROOT / "policies.html"
    text = pol.read_text(encoding="utf-8")
    text, n = re.subn(r'<p class="updated">Last updated: [^<]*</p>',
                      f'<p class="updated">Last updated: {today.day} {today.strftime("%B %Y")}</p>', text, count=1)
    if n:
        pol.write_text(text, encoding="utf-8")
    print("\nCHECKOUT_LIVE = True; running the full site build (python3 tools/build_pages.py) ...")
    b = run([sys.executable, "tools/build_pages.py"], timeout=1200)
    if b.returncode != 0:
        run(["git", "checkout", "--", "."])
        sys.exit("The build stopped, so nothing was committed and every tracked file is back as it was:\n"
                 + (b.stderr or b.stdout)[-1500:])
    problems = []
    if "noindex" in (ROOT / "checkout" / "index.html").read_text(encoding="utf-8"):
        problems.append("checkout/index.html is still noindex")
    if f"{SITE}/checkout/" not in (ROOT / "sitemap.xml").read_text(encoding="utf-8"):
        problems.append("sitemap.xml has no /checkout/")
    for row in json.loads((WORKER / "src" / "catalogue.json").read_text(encoding="utf-8"))["packs"]:
        page = ROOT / row["slug"] / "index.html"
        if row["sellable"] and page.exists() and f'data-cart-add="{row["code"]}"' not in page.read_text(encoding="utf-8"):
            problems.append(f"/{row['slug']}/ has no Add to cart")
    if problems:
        run(["git", "checkout", "--", "."])
        sys.exit("After the build: " + "; ".join(problems) + ". Nothing was committed; tracked files are back as they were.")
    lic = (py_const(BUILD_PAGES.read_text(encoding="utf-8"), "FSSAI_ECOM_LIC") or "").strip('"')
    run(["git", "add", "-A"])
    c = run(["git", "commit", "-q", "-m", f"Direct orders on the website: CHECKOUT_LIVE = True (FSSAI Central licence {lic})\n\n"
             "Written by tools/switch_on.py --apply after every gate passed: Add to cart / Buy now beside Amazon.in on the "
             "packs sold here, header cart link, home cards, policies.html How to order, /checkout/ indexable and in "
             "sitemap.xml."])
    if c.returncode != 0:
        sys.exit("git commit failed: " + (c.stderr or c.stdout)[-500:])
    sha = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
    main_repo = Path(run(["git", "rev-parse", "--git-common-dir"]).stdout.strip()).resolve().parent
    print(f"""
Committed {sha} on {BRANCH}. Nothing is live yet. A HUMAN now runs, in this order:

  1. Deploy the Worker in live mode (wrangler.toml already says MODE = "live"):
       cd {WORKER} && npx wrangler@4 deploy

  2. Check that it takes orders (must show "mode":"live","checkout":"enabled"):
       curl -s -H "Origin: {SITE}" {url.rstrip('/')}/health

  3. Publish the website (GitHub Pages deploys main):
       cd {main_repo}
       git checkout main && git pull --ff-only origin main
       git merge --no-ff {BRANCH} -m "Direct orders on the website: switch on"
         (a conflict in generated pages: keep either side, then the build below rewrites them; git add -u; git commit)
       python3 tools/build_pages.py && git status --short -uno
         (if that lists files: git commit -am "Rebuild after merge"; never git add -A here: your own untracked
          files in that folder must stay out)
       git push origin main

  4. One real order at MRP to your own address (1 cane jaggery, Rs 234), then cancel it in Shiprocket and refund it
     in Razorpay: runbook step 8.

Rollback (any time): CHECKOUT_LIVE = False in tools/build_pages.py, python3 tools/build_pages.py, commit, push;
and in checkout-worker/wrangler.toml GATEWAY_ORDER = "none", then npx wrangler@4 deploy.""")


def main():
    sets = [a for a in sys.argv[1:] if a.startswith("--set-licence=")]
    if sets:
        set_licence(sets[0].split("=", 1)[1].strip())
        return
    args = set(sys.argv[1:])
    unknown = args - {"--apply", "--offline"}
    if unknown:
        sys.exit(f"unknown option(s): {', '.join(sorted(unknown))}\n\n{__doc__}")
    print(f"Switch-on gates for direct orders ({'APPLY' if '--apply' in args else 'dry run: nothing is changed'})\n")
    lic = check_site()
    w = check_worker_vars(lic)
    if "--offline" in args:
        gate("CHECK", "Worker secrets", "skipped (--offline)")
        gate("CHECK", "Razorpay live key", "skipped (--offline)")
    else:
        check_secrets(w.get("order", []), w.get("turnstile", False))
        check_health(w.get("url", ""))
    check_code()
    fails, checks = report()
    already = py_const(BUILD_PAGES.read_text(encoding="utf-8"), "CHECKOUT_LIVE") == "True"
    if "--apply" not in args:
        print("\nDry run: nothing was changed." + ("" if fails else " Every gate passes: run again with --apply."))
        sys.exit(1 if fails else 0)
    if already:
        sys.exit("\nCHECKOUT_LIVE is already True: nothing to apply.")
    if fails or "--offline" in args:
        sys.exit("\nNot switched on: fix every FAIL line above (and run without --offline)." if fails else
                 "\nNot switched on: --apply needs the network checks (run without --offline).")
    if checks:
        print(f"\nCHECK lines left ({', '.join(checks)}): read them; they do not block.")
    apply(w.get("url", ""))


if __name__ == "__main__":
    main()
