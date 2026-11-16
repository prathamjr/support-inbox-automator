#!/usr/bin/env node
/**
 * Replacement parcels ("reships"). Only active when config.json fulfillment.mode is "reship" or "autoship".
 *
 *   node tools/reship.mjs stage --order <n> --issue <courier_cancelled|pickup_cancelled|rto_address_confirmed>
 *        --phone <10 digits from the STORE order, never from Shiprocket>
 *        [--address "..." --address2 "..." --city X --state Y --pincode 123456]   (new address, e.g. after an RTO)
 *        [--items "name part:qty,..."]   only some items        [--problem "one line"]   [--dry]
 *        [--owner-approved "<what the owner said>"]   for a case outside the automatic list (chat only)
 *        [--again "<reason>"]   a second replacement after an earlier one was delivered (owner only)
 *   node tools/reship.mjs check <order or name>   is there a replacement for this order? (read-only)
 *   node tools/reship.mjs sync                    refresh status/AWB of open replacements from Shiprocket
 *   node tools/reship.mjs report                  open replacements as JSON (for the run report)
 *
 * Staging creates a NEW Shiprocket order (Prepaid, same items, same warehouse) and records it in data/reships.json.
 * It does NOT book a courier. In "autoship" mode the Shiprocket Fulfillment Automator books it on its next run;
 * in "reship" mode the owner books it (or their own system does).
 *
 * Refuses (prints {ok:false, reason}, exit 2) when:
 *  - a replacement for this order is already open, or an earlier one was delivered (unless --again),
 *  - the original parcel is still live (waiting for pickup / in transit): it may still arrive and the customer would
 *    get two. EXCEPTION: --issue pickup_cancelled when the live scans PROVE the courier closed the pickup without
 *    collecting it; that dead booking is cancelled in Shiprocket first (never in the store),
 *  - the original is still NEW (not shipped yet): it just needs booking, a replacement would double it. In "autoship"
 *    mode a NEW original older than lookbackDays is never picked up by the automator, so it is cancelled and replaced,
 *  - the items ship from two warehouses, a product is on neverReshipProducts, or there is no real phone number.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FILES, loadConfig, normOrder, readJson, writeJsonAtomic, reshipsOn } from "../lib/config.mjs";
import { SR } from "../lib/shiprocket.mjs";
import { shiprocket, findOrder, trackAwbs, LIVE_STATUS } from "../lib/orders.mjs";

const config = loadConfig();
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const has = (k) => rest.includes(`--${k}`);
const DRY = has("dry") || process.env.SIA_DRY === "1";
const out = (o, code = 0) => { fs.writeSync(1, JSON.stringify(o) + "\n"); process.exit(code); };
const FINAL = new Set(["delivered", "cancelled"]);
const load = () => readJson(FILES.reships, { rows: [] });

if (cmd === "check") {
  const q = String(rest.join(" ")).trim().toLowerCase();
  const n = normOrder(config, q);
  const rows = load().rows.filter((r) => normOrder(config, r.order) === n || String(r.customer ?? "").toLowerCase().includes(q));
  out({ found: rows.length, rows });
}
if (cmd === "report") out(load().rows.filter((r) => !FINAL.has(r.status)));

if (cmd === "sync") {
  if (!reshipsOn(config)) out({ ok: true, note: "replacements are turned off" });
  const led = load();
  const open = led.rows.filter((r) => !FINAL.has(r.status) && r.srOrderId);
  if (!open.length) out({ ok: true, updated: 0 });
  const sr = await shiprocket(config);
  let updated = 0;
  for (const r of open) {
    try {
      const d = (await sr.api("GET", `${SR}/v1/external/orders/show/${r.srOrderId}`))?.data ?? {};
      const awb = d.awb_data?.awb || d.shipments?.awb || (Array.isArray(d.shipments) ? d.shipments[0]?.awb : null) || r.awb || null;
      const st = String(d.status ?? "");
      const next = /RTO/i.test(st) ? "rto" : /CANCEL/i.test(st) ? "cancelled" : /DELIVERED/i.test(st) ? "delivered" : awb ? (/TRANSIT|SHIPPED|OUT FOR/i.test(st) ? "in_transit" : "booked") : "waiting";
      if (next !== r.status || awb !== r.awb) { r.status = next; r.awb = awb; r.courier = d.awb_data?.courier_name ?? d.shipments?.courier ?? r.courier ?? null; r.shiprocketStatus = st; updated++; }
    } catch (e) { r.syncError = e.message.slice(0, 120); }
  }
  if (!DRY) writeJsonAtomic(FILES.reships, led);
  out({ ok: true, updated, open: led.rows.filter((r) => !FINAL.has(r.status)).length });
}

if (cmd !== "stage") { console.error("usage: node tools/reship.mjs stage|check|sync|report (see the top of this file)"); process.exit(2); }

// ---------------------------------------------------------------- stage
if (!reshipsOn(config)) out({ ok: false, reason: 'replacements are turned off (config.json fulfillment.mode is not "reship" or "autoship"). Draft it for the owner instead.' }, 2);
const order = normOrder(config, arg("order"));
const issue = String(arg("issue") ?? "");
const phone = String(arg("phone") ?? "").replace(/\D/g, "").slice(-10);
const ownerApproved = arg("owner-approved");
if (!order || !issue) out({ ok: false, reason: "usage: stage --order <n> --issue <courier_cancelled|pickup_cancelled|rto_address_confirmed> --phone <10 digits>" }, 2);
if (!ownerApproved && !(config.fulfillment.reshipCases ?? []).includes(issue)) out({ ok: false, reason: `"${issue}" is not an automatic replacement case (allowed: ${config.fulfillment.reshipCases.join(", ")}). Draft it for the owner.` }, 2);
if (ownerApproved && process.env.SIA_HEADLESS === "1") out({ ok: false, reason: "--owner-approved only works in a chat with the owner, not in the scheduled run" }, 2);
if (!/^\d{10}$/.test(phone)) out({ ok: false, reason: "no real 10-digit phone (take it from the store order's shipping address; Shiprocket hides phone numbers)" }, 2);

const led = load();
const mine = led.rows.filter((r) => normOrder(config, r.order) === order);
const open = mine.filter((r) => !FINAL.has(r.status) && r.status !== "rto");
if (open.length) out({ ok: false, reason: `a replacement is already arranged: ${open.map((r) => `${r.ref} (${r.status})`).join(", ")}` }, 2);
const deliveredBefore = mine.filter((r) => r.status === "delivered");
if (deliveredBefore.length && !arg("again")) out({ ok: false, reason: `an earlier replacement for #${order} was already DELIVERED (${deliveredBefore.map((r) => `${r.ref} ${r.awb ?? ""}`).join(", ")}). Tell the customer it was delivered; only the owner can approve another (--again).` }, 2);

const sr = await shiprocket(config);
const originals = await findOrder(sr, config, order);
if (!originals.length) out({ ok: false, reason: `order ${order} not found in Shiprocket` }, 2);

// 1. the original must be finished, never still on its way
const live = originals.filter((x) => LIVE_STATUS.test(String(x.status)) && !/RTO/i.test(String(x.status)));
let deadBookings = [];
if (live.length) {
  if (issue !== "pickup_cancelled") out({ ok: false, reason: `original is still live (${live.map((x) => x.status).join(", ")}): it may still arrive. If its last scan says the pickup was cancelled, use --issue pickup_cancelled.` }, 2);
  if (live.some((x) => !x.awb)) out({ ok: false, reason: "original is live without a tracking number, so the cancelled pickup can't be proven" }, 2);
  const tr = await trackAwbs(sr, live.map((x) => x.awb));
  const notDead = live.filter((x) => !tr[x.awb]?.pickupCancelled);
  if (notDead.length) out({ ok: false, reason: `not a cancelled pickup: ${notDead.map((x) => `${x.awb} last scan "${tr[x.awb]?.lastScan?.activity ?? "?"}"${tr[x.awb]?.pickedUp ? `, picked up ${tr[x.awb].pickedUp}` : ""}`).join("; ")}` }, 2);
  deadBookings = live;
}
if (issue === "rto_address_confirmed" && !originals.some((x) => /RTO/i.test(String(x.status)) && /DELIVER/i.test(String(x.status)))) {
  out({ ok: false, reason: `the original is not back with you yet (${originals.map((x) => x.status).join(", ")}). Replace it once Shiprocket shows RTO DELIVERED.` }, 2);
}
const fresh = originals.filter((x) => String(x.status).toUpperCase() === "NEW");
const ageDays = (x) => (Date.now() - Date.parse(String(x.createdAt ?? "").replace(",", ""))) / 86400e3;
const staleNew = config.fulfillment.mode === "autoship" ? fresh.filter((x) => ageDays(x) > config.fulfillment.lookbackDays) : [];
const finished = originals.some((x) => /CANCEL|RTO|DELIVERED|LOST/i.test(String(x.status)));
if (fresh.length && !finished && staleNew.length !== fresh.length) {
  out({ ok: false, reason: config.fulfillment.mode === "autoship"
    ? "the original is still NEW and inside the automator's window: it gets booked on the next shipping run, no replacement needed"
    : "the original is still NEW (never booked): it needs booking, not a replacement. Flag it for the owner." }, 2);
}

// 2. items, warehouse, weight
const src = (await sr.api("GET", `${SR}/v1/external/orders/show/${originals[0].srId}`))?.data ?? {};
let items = (src.products ?? originals[0].raw.products ?? []).map((p) => ({ name: String(p.name), sku: p.sku || p.channel_sku || "NA", units: Number(p.quantity) || 1, selling_price: Number(p.selling_price ?? p.price) || 0 }));
const partial = Boolean(arg("items"));
if (partial) {
  const want = arg("items").split(",").map((s) => { const [n, q] = s.split(":"); return { n: n.trim().toLowerCase(), q: Number(q) || 1 }; });
  items = want.map((w) => { const m = items.find((i) => i.name.toLowerCase().includes(w.n)); return m ? { ...m, units: w.q } : null; });
  if (items.some((i) => !i)) out({ ok: false, reason: `--items: not all found on the order (${(src.products ?? []).map((p) => p.name).join("; ")})` }, 2);
}
if (!items.length) out({ ok: false, reason: "no items on the original order" }, 2);
const banned = items.filter((i) => (config.fulfillment.neverReshipProducts ?? []).some((b) => i.name.toLowerCase().includes(String(b).toLowerCase())));
if (banned.length) out({ ok: false, reason: `never replaced automatically: ${banned.map((i) => i.name).join(", ")}. Draft it for the owner.` }, 2);

let pickups = [];
const shipDir = config.fulfillment.shipAutomatorDir;
if (shipDir && fs.existsSync(path.join(shipDir, "config.json")) && fs.existsSync(path.join(shipDir, "lib", "pickup.mjs"))) {
  const { pickupForItem } = await import(pathToFileURL(path.join(shipDir, "lib", "pickup.mjs")).href);
  const shipConfig = JSON.parse(fs.readFileSync(path.join(shipDir, "config.json"), "utf8"));
  pickups = [...new Set(items.map((i) => pickupForItem({ name: i.name, sku: i.sku }, shipConfig)))];
} else {
  pickups = [...new Set(originals.map((x) => x.pickup ?? src.pickup_location ?? src.pickup_address?.pickup_code ?? null))];
}
if (pickups.length !== 1 || !pickups[0]) out({ ok: false, reason: `can't tell one warehouse for these items (${pickups.map(String).join(", ")}): split it or set it up by hand` }, 2);
const origWeight = Number(originals[0].raw.shipments?.[0]?.weight ?? src.shipments?.weight) || 0;
const weight = Math.max(partial || !origWeight ? config.fulfillment.defaultWeightKg : origWeight, 0.1);
const box = config.fulfillment.defaultBoxCm;

// 3. create it
const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, day: "2-digit", month: "2-digit" }).format(new Date()).replace("/", "");
const ref = `R-${order}-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
const fullName = String(src.customer_name ?? "").trim();
const payload = {
  order_id: ref,
  order_date: new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date()),
  pickup_location: pickups[0],
  billing_customer_name: fullName.split(" ")[0] || "Customer",
  billing_last_name: fullName.split(" ").slice(1).join(" "),
  billing_address: arg("address") ?? src.customer_address,
  billing_address_2: arg("address2") ?? src.customer_address_2 ?? "",
  billing_city: arg("city") ?? src.customer_city,
  billing_state: arg("state") ?? src.customer_state,
  billing_pincode: Number(arg("pincode") ?? src.customer_pincode),
  billing_country: "India",
  billing_email: src.customer_email,
  billing_phone: Number(phone),
  shipping_is_billing: true,
  order_items: items,
  payment_method: "Prepaid",
  sub_total: items.reduce((a, i) => a + i.selling_price * i.units, 0),
  length: box.length, breadth: box.breadth, height: box.height, weight,
};
const preview = { ref, pickup: pickups[0], weight, items: items.map((i) => `${i.name} x${i.units}`), to: `${payload.billing_city} ${payload.billing_pincode}`,
  wouldCancel: [...deadBookings.map((x) => `${x.channelOrderId} (pickup never collected)`), ...staleNew.map((x) => `${x.channelOrderId} (NEW, ${Math.floor(ageDays(x))} days old)`)] };
if (DRY) out({ ok: true, dry: true, ...preview });

const toCancel = [...deadBookings, ...staleNew];
if (toCancel.length) {
  const c = await sr.api("POST", `${SR}/v1/external/orders/cancel`, { ids: toCancel.map((x) => x.srId), cancel_on_channel: false });
  const again = await findOrder(sr, config, order);
  const still = again.filter((x) => toCancel.some((d) => d.srId === x.srId) && !/CANCEL/i.test(String(x.status)));
  if (still.length) out({ ok: false, reason: `could not cancel ${still.map((x) => `${x.channelOrderId} (${x.status})`).join(", ")} in Shiprocket: ${JSON.stringify(c).slice(0, 150)}. Nothing created.` }, 1);
}
const created = await sr.api("POST", `${SR}/v1/external/orders/create/adhoc`, payload);
if (!created?.order_id) out({ ok: false, reason: `Shiprocket refused the new order: ${JSON.stringify(created).slice(0, 200)}` }, 1);

led.rows.push({
  ref, srOrderId: created.order_id, order, issue, problem: arg("problem") ?? "", ownerApproved: ownerApproved ?? null,
  customer: fullName, email: src.customer_email ?? "", city: `${payload.billing_city}, ${payload.billing_state}`,
  items: items.map((i) => `${i.name} x${i.units}`).join(", "), pickup: pickups[0], status: "waiting", awb: null, courier: null,
  stagedAt: new Date().toISOString(), originalAwbs: originals.map((x) => x.awb).filter(Boolean),
  cancelledInShiprocket: toCancel.map((x) => x.channelOrderId),
});
writeJsonAtomic(FILES.reships, led);
out({ ok: true, ...preview, cancelled: preview.wouldCancel, note: config.fulfillment.mode === "autoship" ? "created; the Shiprocket Fulfillment Automator books it on its next run" : "created in Shiprocket as NEW; book it when you ship your next batch" });
