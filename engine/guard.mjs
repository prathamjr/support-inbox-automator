#!/usr/bin/env node
/**
 * The reply guard. MANDATORY before every customer reply or draft. A hook (hooks/reply-gate.mjs) refuses any
 * Gmail reply/draft this guard did not approve for that exact message + recipient in the last 20 minutes,
 * so it cannot be skipped.
 *
 *   node guard.mjs --email <customer email> --to <exact recipient> --message-id <id> --name "Full Name"
 *        --order <n> [--phone <10 digits>] [--customer-last <ISO time of their newest message, any thread>]
 *        (--text "<exact body>" | --text-file <path>) [--manual] [--record]
 *
 * Prints JSON {allowed, blocks[], warnings[]}. Exit 0 = allowed, exit 3 = BLOCKED (send nothing, draft nothing).
 * --record : run again with the same args right AFTER a real send, so duplicates and repeats are caught next time.
 * --manual : only when the owner is in the chat and approved this exact email (allows a 2nd email the same day).
 *            The headless daily run refuses manual approvals.
 *
 * Every check here exists because a real store got it wrong once:
 *  - replies to a contact form went to the form's robot address, so the customer never got them
 *  - a reply was sent with another customer's message id and quoted that customer's details
 *  - "I can't find your order" went to two customers whose orders were under a different email
 *  - the same customer got the same update word for word several times and concluded "this is a bot"
 *  - a reply said the pickup was cancelled AND that the parcel was waiting to be collected
 */
import fs from "node:fs";
import { FILES, loadConfig, normOrder, dayKey, readJsonl, appendJsonl, readJson } from "./lib/config.mjs";
import { DEFAULT_CHECKS, isOurAddress } from "./lib/checks.mjs";

const config = loadConfig();
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : ""; };

const email = val("email").trim().toLowerCase();
const name = val("name").trim().toLowerCase();
const order = normOrder(config, val("order"));
const text = val("text") || (val("text-file") ? fs.readFileSync(val("text-file"), "utf8") : "");
const customerLast = val("customer-last");
const to = val("to").trim().toLowerCase();
const messageId = val("message-id").trim();
const manual = flag("manual");
const record = flag("record");

const sameCustomer = (r) => (email && r.email && r.email.toLowerCase() === email) || (order && r.order && normOrder(config, r.order) === order);

if (record) {
  appendJsonl(FILES.sentLog, { ts: new Date().toISOString(), email, order, name, to, messageId, text });
  fs.writeSync(1, JSON.stringify({ recorded: true, email, order }) + "\n");
  process.exit(0);
}

const blocks = [];
const warnings = [];

// 1) recipient + message id
if (!messageId) blocks.push("pass --message-id: the messageId of the customer's LATEST message in THEIR OWN thread, fetched fresh with get_thread.");
if (!to) blocks.push("pass --to: the exact address this reply goes to. Contact forms: the Email field inside the form, never the form's sender address.");
else if (isOurAddress(config, to)) blocks.push(`${to} is not a customer address (it is ours, a no-reply or a contact-form sender). Set \`to\` to the customer's own address.`);
else if (email && to !== email) blocks.push(`recipient ${to} does not match the customer's email ${email}. Send nothing until they match.`);
if (messageId && email) {
  const other = readJsonl(FILES.messageOwners).find((r) => r.messageId === messageId && r.email && r.email !== email);
  if (other) blocks.push(`message ${messageId} belongs to ${other.email}'s thread, not ${email}'s. Replying there would show another customer's details. Re-open ${email}'s own thread and use its latest message.`);
}

// 2) the owner's ignore / hold list (people.json), matched on any email, order number or full name
const people = readJson(FILES.people, { entries: [] });
for (const e of people.entries ?? []) {
  const hit = (email && (e.emails ?? []).some((x) => x.toLowerCase() === email))
    || (order && (e.orders ?? []).map((o) => normOrder(config, o)).includes(order))
    || (name && (e.names ?? []).some((x) => x.toLowerCase() === name));
  if (hit) blocks.push(`${e.mode ?? "HOLD"}: ${e.name ?? email} (${e.why ?? "on the owner's list"}). No reply, no draft. Mark the thread read${e.mode === "HOLD" ? " and mention it in flags" : ""}.`);
}

// 3) a replacement parcel already exists for this order
const reships = (readJson(FILES.reships, { rows: [] }).rows ?? []).filter((r) => order && normOrder(config, r.order) === order && r.status !== "cancelled");
if (reships.length) {
  warnings.push(`A replacement already exists for #${order}: ${reships.map((r) => `${r.ref} ${r.status}${r.awb ? ` ${r.courier ?? ""} ${r.awb}` : ""}`).join("; ")}. Give the customer its status/tracking.`);
  if (/photo|picture|screenshot|video|confirm (your )?(full )?(delivery )?address|reply with .*address|order number|order id/i.test(text)) {
    blocks.push(`#${order} already has a replacement arranged. Never ask this customer for a photo, address or order number again. Tell them the replacement's status instead.`);
  }
  const withoutPickup = text.replace(/pickup[^.]{0,80}?was cancel(l)?ed/gi, "");
  if (/(original|first|earlier) (shipment|parcel|order)[^.]{0,40}cancel|was cancel(l)?ed/i.test(withoutPickup)) {
    blocks.push("A replacement exists: never tell the customer their original order or shipment was cancelled. Say it has been sent out again.");
  }
}

// 4) wording checks (built in, plus the owner's own bannedPhrases from config.json)
const disabled = new Set(config.disabledChecks ?? []);
for (const c of DEFAULT_CHECKS) {
  if (disabled.has(c.id)) continue;
  if (c.re.test(text)) (c.warnOnly ? warnings : blocks).push(`${c.warnOnly ? "check" : "banned wording"}: ${c.why}`);
}
for (const b of config.bannedPhrases ?? []) {
  try { if (new RegExp(b.pattern, "i").test(text)) blocks.push(`banned wording (your rule): ${b.why ?? b.pattern}`); } catch { warnings.push(`bannedPhrases pattern is invalid: ${b.pattern}`); }
}
if (config.noEmDashes && /—/.test(text)) blocks.push("em dash (—) in the text: it reads as machine-written. Use a comma, colon or full stop.");
if (/\{[a-z_]+\}/i.test(text)) blocks.push(`unfilled template placeholder ${text.match(/\{[a-z_]+\}/i)[0]}: fill it with the real value or drop the sentence.`);

// 5) one email per customer per day; no second email unless they wrote since
const sentRows = readJsonl(FILES.sentLog);
const now = Date.now();
if (!manual) {
  const today = sentRows.filter((r) => sameCustomer(r) && dayKey(Date.parse(r.ts), config.timezone) === dayKey(now, config.timezone));
  if (today.length) blocks.push(`already emailed this customer/order today (${today.map((r) => r.ts.slice(11, 16) + " UTC").join(", ")}). One email per customer per day: send nothing; if they wrote again, list them in readFirst ("wrote again after today's reply").`);
  const recent = sentRows.filter((r) => sameCustomer(r) && now - Date.parse(r.ts) < 48 * 3600e3);
  if (recent.length) {
    const lastSent = Math.max(...recent.map((r) => Date.parse(r.ts)));
    if (!customerLast) blocks.push(`emailed this customer at ${new Date(lastSent).toISOString()}. Pass --customer-last <ISO time of their newest message in any thread>; if they have not written since, send nothing.`);
    else if (Date.parse(customerLast) <= lastSent) blocks.push(`emailed this customer at ${new Date(lastSent).toISOString()} and they have not written since (${customerLast}). Send nothing.`);
  }
}

// 6) no near-copies of an earlier email to the same customer (3-word phrase overlap, greeting and sign-off ignored)
if (!manual && text) {
  const signFirst = String(config.signOff ?? "").split("\n")[0].trim().toLowerCase();
  const words = (t) => {
    let s = String(t ?? "").replace(/^\s*(hi|hello|hey|dear)[^\n]*\n/i, "");
    const i = signFirst ? s.toLowerCase().lastIndexOf(signFirst) : -1;
    if (i > 0) s = s.slice(0, i);
    return s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim().split(" ").filter(Boolean);
  };
  const grams = (w) => new Set(w.slice(0, -2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`));
  const overlap = (a, b) => { const A = grams(words(a)), B = grams(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const g of A) if (B.has(g)) n++; return n / Math.min(A.size, B.size); };
  const prev = sentRows.filter((r) => r.text && sameCustomer(r));
  const worst = prev.map((r) => ({ ts: r.ts, o: overlap(text, r.text) })).sort((a, b) => b.o - a.o)[0];
  if (worst && worst.o >= 0.6) blocks.push(`this is ${Math.round(worst.o * 100)}% the same wording as our email of ${worst.ts.slice(0, 10)}. Don't send the same answer twice: either there is something new to say or do, or it is a "${config.labels.readFirst.name}" draft for the owner saying what decision is needed.`);
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 40);
  for (const s of sentences) {
    const uses = prev.filter((r) => r.text.includes(s)).length;
    if (uses >= 2) { blocks.push(`this customer has already had the sentence "${s.slice(0, 80)}…" ${uses} times. Say what is actually happening now, or draft it for the owner.`); break; }
  }
}

const allowed = blocks.length === 0;
if (allowed) {
  appendJsonl(FILES.approvals, { ts: new Date().toISOString(), messageId, to, email, order, manual });
  if (!readJsonl(FILES.messageOwners).some((r) => r.messageId === messageId)) appendJsonl(FILES.messageOwners, { messageId, email, ts: new Date().toISOString() });
}
fs.writeSync(1, JSON.stringify({ allowed, blocks, warnings }, null, 1) + "\n");
process.exit(allowed ? 0 : 3);
