#!/usr/bin/env node
/**
 * Read-only. Shiprocket facts for many store orders in ONE call, plus live tracking for every AWB found.
 *   node tools/orders.mjs 1234 1240 1302         (order numbers as the customer sees them, with or without #)
 * Prints one JSON object: { "<order>": { records:[{status, createdAt, ageDays, awb, courier, pickup, products}], tracking:{<awb>:{...}} } }
 * Tracking per AWB: status, pickedUp, delivered, lastScan {date, activity, location}, pickupCancelled, trackingUrl.
 * "pickupCancelled": true means the courier closed the pickup without ever collecting the parcel: nothing will collect it.
 */
import { loadConfig, normOrder } from "../lib/config.mjs";
import { shiprocket, findOrder, trackAwbs } from "../lib/orders.mjs";

const config = loadConfig();
const orders = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((o) => normOrder(config, o));
if (!orders.length) { console.error("usage: node tools/orders.mjs <order> [<order> ...]"); process.exit(2); }

try {
  const sr = await shiprocket(config);
  const out = {};
  const awbs = [];
  for (const o of orders) {
    const recs = await findOrder(sr, config, o);
    out[o] = {
      records: recs.map(({ raw, ...r }) => ({ ...r, ageDays: r.createdAt ? Math.floor((Date.now() - Date.parse(String(r.createdAt).replace(",", ""))) / 86400e3) : null })),
      tracking: {},
    };
    if (!recs.length) out[o].note = "not in Shiprocket (check the store: maybe not synced, cancelled, or under another number)";
    for (const r of recs) if (r.awb) awbs.push([o, r.awb]);
  }
  const tr = await trackAwbs(sr, awbs.map((a) => a[1]));
  for (const [o, awb] of awbs) out[o].tracking[awb] = tr[awb] ?? { awb, error: "no tracking data" };
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}
