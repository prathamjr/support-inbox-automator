// Read helpers on top of the Shiprocket client: find a store order's Shiprocket records, live tracking.
import { SR, createClient } from "./shiprocket.mjs";
import { loadShiprocketEnv, normOrder } from "./config.mjs";

export async function shiprocket(config) {
  const sr = createClient(loadShiprocketEnv(config));
  await sr.login();
  return sr;
}

const awbOf = (x) => (x.shipments ?? []).map((s) => s.awb).find(Boolean) ?? x.awb_code ?? null;

/** Every Shiprocket record for one store order number (originals and their clones). */
export async function findOrder(sr, config, order) {
  const n = normOrder(config, order);
  const ids = [...new Set([`${n}${config.orderSuffix ?? ""}`, n, `#${n}${config.orderSuffix ?? ""}`])];
  const seen = new Map();
  for (const q of ids) {
    let data = [];
    try { data = (await sr.api("GET", `${SR}/v1/external/orders?search=${encodeURIComponent(q)}`))?.data ?? []; } catch { /* try next form */ }
    for (const x of data) {
      if (normOrder(config, x.channel_order_id).startsWith(n)) seen.set(x.id, x);
    }
    if (seen.size) break;
  }
  return [...seen.values()].map((x) => ({
    srId: x.id,
    channelOrderId: x.channel_order_id,
    status: x.status,
    createdAt: x.created_at,
    awb: awbOf(x),
    courier: (x.shipments ?? [])[0]?.courier ?? null,
    pickup: x.pickup_location ?? (x.shipments ?? [])[0]?.pickup_location ?? null,
    payment: x.payment_method,
    products: (x.products ?? []).map((p) => ({ name: p.name, qty: Number(p.quantity) || 1, sku: p.channel_sku ?? p.sku ?? "" })),
    raw: x,
  }));
}

/** Live status + last scan for many AWBs in one call. */
export async function trackAwbs(sr, awbs, { scans = false } = {}) {
  const list = [...new Set(awbs.filter(Boolean).map(String))];
  if (!list.length) return {};
  const r = await sr.api("POST", `${SR}/v1/external/courier/track/awbs`, { awbs: list });
  const out = {};
  for (const awb of list) {
    const td = r?.[awb]?.tracking_data ?? {};
    const st = td.shipment_track?.[0] ?? {};
    const acts = td.shipment_track_activities ?? [];
    const last = acts[0] ?? {};
    out[awb] = {
      awb,
      status: st.current_status ?? null,
      courier: st.courier_name ?? null,
      pickedUp: st.pickup_date || null,
      delivered: st.delivered_date || null,
      lastScan: last.activity ? { date: String(last.date ?? "").slice(0, 16), activity: last.activity, location: last.location ?? "" } : null,
      pickupCancelled: /pickup\s*cancel/i.test(String(last.activity ?? "")) && !st.pickup_date,
      trackingUrl: td.track_url ?? null,
      ...(scans ? { scans: acts.slice().reverse().map((a) => ({ date: String(a.date ?? "").slice(0, 16), activity: a.activity, location: a.location ?? "" })) } : {}),
      ...(td.error ? { error: td.error } : {}),
    };
  }
  return out;
}

export const LIVE_STATUS = /PICKUP|TRANSIT|MANIFEST|READY TO SHIP|AWB ASSIGNED|OUT FOR DELIVERY|SHIPPED|REACHED|UNDELIVERED|IN TRANSIT/i;
