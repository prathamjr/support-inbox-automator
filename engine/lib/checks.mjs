// Built-in wording checks for every customer email. Each one caused a real incident at the store this was built on.
// An owner whose policy is different (e.g. they DO offer callbacks) can switch one off by id in
// config.json "disabledChecks", and add their own in "bannedPhrases". Explain the trade-off before switching one off.
export const DEFAULT_CHECKS = [
  {
    id: "refund-promise",
    re: /refund (has been|will be|is being) (processed|issued|initiated|credited)|we will refund|i will refund|i('ve| have) (processed|issued|initiated) (a|your) refund/i,
    why: "never promise or confirm a refund in an automated email. Refunds are the owner's decision, by hand. Draft it for the owner instead.",
  },
  {
    id: "store-credit",
    re: /store credit|credit note|wallet credit|gift card (worth|of|for)/i,
    why: "never offer store credit or a gift card in an automated email. That is the owner's decision.",
  },
  {
    id: "phone-call",
    re: /\b(call you|give you a call|phone call|we will call|i will call|i'll call|call back|callback|our team will call)\b/i,
    why: "never offer, promise or mention a phone call (customers wait by the phone and it never comes).",
  },
  {
    id: "time-frames",
    re: /within (the next )?(\d+|a few|one|two|three|24|48|72)\s*(hours?|hrs?|days?|working days|business days)|by tomorrow|by (the )?end of (the )?(day|week)|\bthis week\b|in (\d+|two|three|a few) (business |working )?days?|\btoday itself\b/i,
    why: "no time frames you don't control (couriers and warehouses miss them, and then the email becomes a broken promise).",
  },
  {
    id: "someone-will-follow-up",
    re: /someone (from our team )?will (follow|reach|get back|contact)|will follow up with you directly|a (team )?lead will|our (senior|escalations?) team will (contact|reach)/i,
    why: "never promise that someone else will follow up. The customer waits for an email that nobody owns.",
  },
  {
    id: "cant-find-order",
    re: /(unable|not able|can.?t|cannot|couldn.?t|could not) (to )?(find|locate|trace) (any |an |your )?(order|record|purchase)|no order (was )?found/i,
    why: "never tell a customer you can't find their order (twice it existed under a different email). Make a Read-first draft for the owner listing the searches you ran.",
  },
  {
    id: "self-contradiction",
    re: /pickup[^.]{0,80}?cancel(l)?ed[\s\S]*(booked and waiting for (the )?pickup|waiting for the courier to collect|moment it'?s collected|once it'?s collected|when it'?s collected)|(booked and waiting for (the )?pickup|waiting for the courier to collect|moment it'?s collected)[\s\S]*pickup[^.]{0,80}?cancel(l)?ed/i,
    why: "the text says the pickup was CANCELLED and also that the parcel is waiting to be collected. A cancelled pickup means nothing will collect it.",
  },
  {
    id: "stagey",
    re: /\b(i('m| am) (so |truly )?shocked|this never happens|first time this has (ever )?happened|we value your (business|patience)|we apologi[sz]e for any inconvenience|rest assured|your satisfaction is our (top )?priority|please do not hesitate)\b/i,
    why: "stock customer-service phrasing that makes the email sound automated. Say the specific thing instead.",
  },
  {
    id: "time-bound-copy",
    re: /\b(tomorrow|next week|before you travel|when you travel|you('re| are| were) travelling)\b/i,
    why: "time-bound wording: keep it only if it is still TRUE today, never copied from an old message.",
    warnOnly: true,
  },
];

export function isOurAddress(config, addr) {
  const a = String(addr ?? "").trim().toLowerCase();
  if (!a) return true;
  if (/no-?reply|mailer-daemon|postmaster/.test(a)) return true;
  const ours = [config.supportEmail, ...(config.ourAddresses ?? []), ...(config.contactFormSenders ?? [])].filter(Boolean).map((x) => x.toLowerCase());
  if (ours.includes(a)) return true;
  const domain = (config.supportEmail.split("@")[1] ?? "").toLowerCase();
  const consumer = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|rediffmail|live|aol|proton|protonmail)\./;
  return Boolean(domain && !consumer.test(domain) && a.endsWith(`@${domain}`));
}
