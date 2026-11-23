// End-to-end check of tools/sr.py against the real Worker code with MOCKED Shiprocket on 127.0.0.1 (no network,
// no real token: the CLI talks plain http to localhost only). Needs python3. From checkout-worker/:
//   node scripts/sr_cli_e2e.mjs [work-dir]        (default: a fresh temp folder)
// Exit 0 when every step gave its expected exit code, exactly one AWB was bought, and no token / phone / address
// appeared in any output.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../src/index.js";
import { createMemoryStore } from "../src/storage/memory.js";
import { createMockGateways } from "../test/helpers/mock-gateways.js";
import { TEST_ENV } from "../test/helpers/harness.js";

const W = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SR_PY = resolve(W, "..", "tools", "sr.py");
const DIR = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "sr-cli-e2e-"));

const mocks = createMockGateways();
const worker = createWorker({ store: createMemoryStore(), fetch: mocks.fetch, log: () => {} });
const env = { ...TEST_ENV, SHIPROCKET_TIMEOUT_MS: "300" };
const ctx = { waitUntil: (p) => p.catch(() => {}) };
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const out = await worker.fetch(request, env, ctx);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
mocks.state.shiprocket.labelBase = "https://example.invalid/mock"; // https but not Shiprocket storage: the CLI must refuse to download

mkdirSync(DIR, { recursive: true });
const tokFile = join(DIR, "tok");
writeFileSync(tokFile, TEST_ENV.ADMIN_TOKEN);
chmodSync(tokFile, 0o600);
const ORDER = {
  id: "402-9649273-4891501", payment: "prepaid", name: "Ravi Kumar", phone: "98480 12345", address: "H.No 4-56, Temple Street, Ramnagar", city: "Raipur",
  state: "CHHATTISGARH", pin: "490023", items: [{ sku: "1AF-KPAS-0540", name: "Araku Hill Turmeric Powder 540g", qty: 1, price: 495 }],
};
writeFileSync(join(DIR, "order.json"), JSON.stringify(ORDER));
writeFileSync(join(DIR, "order2.json"), JSON.stringify({ ...ORDER, id: "402-9649273-4891502" }));
writeFileSync(join(DIR, "order3.json"), JSON.stringify({ ...ORDER, id: "402-9649273-4891503" }));
writeFileSync(join(DIR, "order4.json"), JSON.stringify({ ...ORDER, id: "402-9649273-4891504" }));
writeFileSync(join(DIR, "nophone.json"), JSON.stringify({ id: "402-0000000-1111111", payment: "prepaid", name: "X Y", address: "abcdefghijk", city: "Raipur", state: "Chhattisgarh", pin: "490023", items: [] }));
writeFileSync(join(DIR, "cod.json"), JSON.stringify({ ...ORDER, id: "402-0000000-2222222", payment: "Pay on Delivery" }));
writeFileSync(join(DIR, "nopayment.json"), JSON.stringify({ ...ORDER, id: "402-0000000-3333333", payment: undefined }));

const run = (args, tok = tokFile) => new Promise((done) => {
  const p = spawn("python3", ["-I", SR_PY, "--base", base, "--token-file", tok, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => done({ code, out }));
});

let all = "";
let bad = 0;
async function step(label, args, expectCode, { tok, expect } = {}) {
  const r = await run(args, tok);
  all += r.out;
  const textOk = !expect || expect.test(r.out);
  const okay = r.code === expectCode && textOk;
  if (!okay) bad++;
  console.log(`\n[${okay ? "ok " : "BAD"}] $ sr.py ${args.join(" ")}   (exit ${r.code}, want ${expectCode}${textOk ? "" : `, output !~ ${expect}`})  -- ${label}\n${r.out.trimEnd()}`);
  return r;
}
const assigns = () => mocks.calls.filter((x) => x.path.endsWith("/courier/assign/awb")).length;
const said = ["--bhargava-said-ship", ORDER.id];

await step("pickups", ["pickups"], 0, { expect: /PASS {2}pickup "home"/ });
await step("wallet", ["wallet"], 0);
await step("quote by PIN", ["quote", "490023"], 0, { expect: /Cheapest allowed: DTDC Surface/ });
await step("quote 2 pouches, --all", ["quote", "490023", "--qty", "2", "--all"], 0);
mocks.state.shiprocket.couriers.find((c) => c.courier_company_id === 99).blocked = 1;
await step("a blocked allowed courier is 'unusable now', not 'not on allow-list'", ["quote", "110001", "--kg", "0.56", "--dims", "26.5x17x4"], 0,
  { expect: /Allowed but unusable now: Blue Dart Air \(blocked_by_shiprocket\)/ });
mocks.state.shiprocket.couriers.find((c) => c.courier_company_id === 99).blocked = 0;
await step("bad PIN", ["quote", "99"], 3);
await step("create without phone refused locally", ["create", join(DIR, "nophone.json")], 2);
await step("create Pay-on-Delivery refused locally", ["create", join(DIR, "cod.json")], 2, { expect: /must be "prepaid"/ });
await step("create without payment refused locally", ["create", join(DIR, "nopayment.json")], 2);
const c = await step("create from file", ["create", join(DIR, "order.json")], 0);
const sid = /shipment (\d+)/.exec(c.out)?.[1];
await step("create again -> 409", ["create", join(DIR, "order.json")], 3);
await step("quote the shipment: the book line has a placeholder, never the ref", ["quote", "--shipment", sid], 0,
  { expect: /--bhargava-said-ship '<ID exactly as Bhargava typed it>' --go/ });
await step("book DRY RUN", ["book", sid, "--courier", "54", ...said], 0, { expect: /DRY RUN: nothing booked/ });
const dry = await step("book DRY RUN --json", ["book", sid, "--courier", "54", ...said, "--json"], 0);
try { const j = JSON.parse(dry.out); if (!(j.dryRun === true && j.courierId === 54 && j.suggestedMaxRupees === 145)) throw new Error("shape"); } catch (e) { bad++; console.log(`BAD dry-run --json is not the plan JSON (${e.message})`); }
await step("book with the placeholder pasted refused", ["book", sid, "--courier", "54", "--bhargava-said-ship", "<ID>", "--max-rupees", "150", "--go"], 2);
await step("book Delhivery id refused", ["book", sid, "--courier", "10", ...said, "--max-rupees", "150", "--go"], 3);
await step("book 'ship all' refused", ["book", sid, "--courier", "54", "--bhargava-said-ship", "all", "--go"], 2);
await step("book wrong said refused", ["book", sid, "--courier", "54", "--bhargava-said-ship", "402-0000000-0000000", "--max-rupees", "150", "--go"], 3);
await step("book --go without --max-rupees", ["book", sid, "--courier", "54", ...said, "--go"], 2);
await step("book price above max refused by the worker", ["book", sid, "--courier", "54", "--bhargava-said-ship", `ship ${ORDER.id}`, "--max-rupees", "120", "--go", "--pickup", "today"], 3);
if (assigns() !== 0) { bad++; console.log(`BAD assign calls before the real booking: ${assigns()}`); }
const booked = await step("book --go --json (label saved or its error reported, also in JSON mode)", ["book", sid, "--courier", "54", ...said, "--max-rupees", "145", "--go", "--pickup", "today", "--out", join(DIR, "labels"), "--json"], 0);
try { const j = JSON.parse(booked.out); if (!(j.awb && "labelPath" in j && j.labelSaveError)) throw new Error("no labelPath / labelSaveError"); } catch (e) { bad++; console.log(`BAD book --json (${e.message})`); }
await step("book again -> refused", ["book", sid, "--courier", "54", ...said, "--max-rupees", "145", "--go"], 3);
const awb = mocks.state.shiprocket.shipments.get(sid)?.awb;
await step("track (no activity)", ["track", awb], 0);
mocks.state.shiprocket.tracking.set(awb, {
  track_status: 1, shipment_status: 42, track_url: `https://shiprocket.co/tracking/${awb}`, etd: "2026-11-25 18:00:00",
  shipment_track: [{ awb_code: awb, courier_name: "DTDC Surface", current_status: "PICKED UP", pickup_date: "2026-11-22 15:10:00", delivered_date: null, edd: "2026-11-25" }],
  shipment_track_activities: [{ date: "2026-11-22 15:10:00", activity: "Picked up by agent 98480 12345", location: "NARASARAOPET", "sr-status": "42", "sr-status-label": "PICKED UP" }],
});
await step("track --ref picked up", ["track", "--ref", ORDER.id], 0, { expect: /picked up: YES/ });
mocks.state.shiprocket.tracking.set(awb, {
  track_status: 1, shipment_status: 20, shipment_track: [{ awb_code: awb, courier_name: "Delhivery Surface", current_status: "PICKUP EXCEPTION" }],
  shipment_track_activities: [{ date: "2026-11-22 15:10:00", activity: "Shipment not picked up - seller not available", "sr-status": "20", "sr-status-label": "PICKUP EXCEPTION" }],
});
await step("track: a missed pickup is 'no'; a fallback to Delhivery is a FAIL line", ["track", awb], 0, { expect: /picked up: no[\s\S]*FAIL {2}courier Delhivery Surface/ });
await step("find", ["find", ORDER.id], 0);
await step("cancel needs exact confirm", ["cancel", "700001", "--confirm", "cancel 7"], 2);
await step("cancel after AWB refused", ["cancel", "700001", "--confirm", "cancel 700001"], 3);
await step("label (unexpected host: not downloaded)", ["label", sid, "--out", join(DIR, "labels")], 4);
await step("json output", ["wallet", "--json"], 0);

// what happens when the booking answer never comes back (timeout after the request left) / a wrong courier is booked
const c2 = await step("create 2", ["create", join(DIR, "order2.json")], 0);
const sid2 = /shipment (\d+)/.exec(c2.out)?.[1];
mocks.state.shiprocket.assign = ["timeout_booked"];
await step("book whose answer never arrives: BOOKING STATE UNKNOWN, exit 4", ["book", sid2, "--courier", "54", "--bhargava-said-ship", "402-9649273-4891502", "--max-rupees", "145", "--go", "--pickup", "none"], 4,
  { expect: /BOOKING STATE UNKNOWN: wallet money may have been spent/ });
await step("unlock refused: Shiprocket shows the AWB", ["unlock", sid2, "--confirm", `unlock ${sid2}`], 3);
const c3 = await step("create 3", ["create", join(DIR, "order3.json")], 0);
const sid3 = /shipment (\d+)/.exec(c3.out)?.[1];
mocks.state.shiprocket.assign = [{ awb_assign_status: 1, response: { data: { awb_code: "1490810000099", courier_company_id: 10, courier_name: "Delhivery Surface" } } }];
await step("Shiprocket books Delhivery anyway: BOOKED ON THE WRONG COURIER, exit 4", ["book", sid3, "--courier", "54", "--bhargava-said-ship", "402-9649273-4891503", "--max-rupees", "145", "--go", "--pickup", "none"], 4,
  { expect: /BOOKED ON THE WRONG COURIER/ });
mocks.state.shiprocket.createExtra = { awb_code: "1490810000100", courier_company_id: 10, courier_name: "Delhivery Surface" };
await step("create that Shiprocket auto-assigns: FAIL, exit 3", ["create", join(DIR, "order4.json")], 3, { expect: /AUTO-ASSIGNED AWB 1490810000100[\s\S]*NOT DTDC/ });
mocks.state.shiprocket.createExtra = null;

// token file checks
const loose = join(DIR, "loose");
writeFileSync(loose, TEST_ENV.ADMIN_TOKEN);
chmodSync(loose, 0o644);
await step("token file readable by others -> refused", ["wallet"], 2, { tok: loose });
await step("missing token file", ["wallet"], 2, { tok: join(DIR, "nope") });
const wrong = join(DIR, "wrong");
writeFileSync(wrong, "w".repeat(64));
chmodSync(wrong, 0o600);
await step("wrong token -> 401", ["wallet"], 3, { tok: wrong });

// init-token: never chmods a folder it did not create (other than the default one)
const shared = join(DIR, "shared");
mkdirSync(shared, { recursive: true });
chmodSync(shared, 0o755);
await step("init-token into an existing folder", ["init-token"], 0, { tok: join(shared, "tok") });
const sharedMode = statSync(shared).mode & 0o777;
const tokMode = statSync(join(shared, "tok")).mode & 0o777;
if (sharedMode !== 0o755 || tokMode !== 0o600) { bad++; console.log(`BAD init-token modes: folder ${sharedMode.toString(8)} (want 755), file ${tokMode.toString(8)} (want 600)`); }
await step("init-token into a new folder", ["init-token"], 0, { tok: join(DIR, "fresh", "tok") });
if ((statSync(join(DIR, "fresh")).mode & 0o777) !== 0o700) { bad++; console.log("BAD init-token did not make its new folder 0700"); }
await step("init-token never overwrites", ["init-token"], 2, { tok: join(shared, "tok") });
const minted = existsSync(join(shared, "tok")) ? readFileSync(join(shared, "tok"), "utf8") : "";

const leaks = { token: all.includes(TEST_ENV.ADMIN_TOKEN) || (minted && all.includes(minted)), phone: /98480|9848012345/.test(all), address: all.includes("Temple Street") };
console.log(`\ntoken printed anywhere: ${leaks.token}  phone printed: ${leaks.phone}  address printed: ${leaks.address}`);
console.log(`assign calls total: ${assigns()} (want 3: one real booking, one whose answer was lost, one Shiprocket put on the wrong courier)`);
if (leaks.token || leaks.phone || leaks.address || assigns() !== 3) bad++;
server.close();
console.log(bad ? `\nsr_cli_e2e: ${bad} BAD` : "\nsr_cli_e2e: all steps ok");
process.exitCode = bad ? 1 : 0;
