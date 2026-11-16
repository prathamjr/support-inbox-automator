// Loads config.json + .env from the engine folder, fills in defaults, and holds the small
// file helpers every script shares. Every script imports this instead of reading files itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ENGINE_DIR, "data");
export const LOG_DIR = path.join(ENGINE_DIR, "logs");
export const PLAYBOOK_DIR = path.join(ENGINE_DIR, "playbook");

export const FILES = {
  config: path.join(ENGINE_DIR, "config.json"),
  env: path.join(ENGINE_DIR, ".env"),
  people: path.join(ENGINE_DIR, "people.json"),
  sentLog: path.join(DATA_DIR, "sent-log.jsonl"),
  approvals: path.join(DATA_DIR, "guard-approvals.jsonl"),
  approvalsUsed: path.join(DATA_DIR, "guard-approvals-used.jsonl"),
  messageOwners: path.join(DATA_DIR, "message-owner.jsonl"),
  actualSends: path.join(DATA_DIR, "actual-sends.jsonl"),
  backlog: path.join(DATA_DIR, "backlog.json"),
  reships: path.join(DATA_DIR, "reships.json"),
  runIndex: path.join(LOG_DIR, "runs.log"),
  lock: path.join(DATA_DIR, "run.lock"),
  pause: path.join(ENGINE_DIR, "PAUSE.txt"),
};

const DEFAULTS = {
  brandName: "My Store",
  supportEmail: "",
  signOff: "Take care,\nMy Store Support",
  timezone: "Asia/Kolkata",
  runTime: "15:00",
  runDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  mode: "drafts",
  model: "claude-sonnet-5-5",
  claudePath: "claude",
  maxCustomersPerRun: 40,
  maxRunMinutes: 120,
  scanFloorDate: null,
  fullScanEveryDays: 7,
  orderPrefix: "#",
  orderSuffix: "",
  contactFormSenders: ["mailer@shopify.com"],
  ourAddresses: [],
  labels: { ready: { name: "Ready to send", id: "" }, readFirst: { name: "Read first", id: "" } },
  connectors: { gmail: "mcp__claude_ai_Gmail__", shopify: "mcp__claude_ai_Shopify__" },
  shop: { platform: "shopify" },
  fulfillment: {
    mode: "track",
    lookbackDays: 14,
    shipAutomatorDir: "",
    bookReshipsAfterRun: false,
    reshipCases: ["courier_cancelled", "pickup_cancelled", "rto_address_confirmed"],
    neverReshipProducts: [],
    defaultWeightKg: 0.5,
    defaultBoxCm: { length: 10, breadth: 10, height: 10 },
  },
  bannedPhrases: [],
  disabledChecks: [],
  noEmDashes: true,
  notify: { type: "none" },
};

export function loadEnv(extraDirs = []) {
  for (const p of [FILES.env, ...extraDirs.map((d) => path.join(d, ".env"))]) {
    if (!p || !fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

export function expandHome(p) {
  return String(p ?? "").replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
}

export function loadConfig({ allowMissing = false } = {}) {
  if (!fs.existsSync(FILES.config)) {
    if (allowMissing) return structuredClone(DEFAULTS);
    throw new Error(`config.json not found in ${ENGINE_DIR}. Copy config.example.json to config.json first.`);
  }
  const raw = JSON.parse(fs.readFileSync(FILES.config, "utf8").replace(/^﻿/, ""));
  const config = {
    ...DEFAULTS,
    ...raw,
    labels: {
      ready: { ...DEFAULTS.labels.ready, ...(raw.labels?.ready ?? {}) },
      readFirst: { ...DEFAULTS.labels.readFirst, ...(raw.labels?.readFirst ?? {}) },
    },
    connectors: { ...DEFAULTS.connectors, ...(raw.connectors ?? {}) },
    shop: { ...DEFAULTS.shop, ...(raw.shop ?? {}) },
    fulfillment: { ...DEFAULTS.fulfillment, ...(raw.fulfillment ?? {}) },
    notify: { ...DEFAULTS.notify, ...(raw.notify ?? {}) },
  };
  config.fulfillment.shipAutomatorDir = expandHome(config.fulfillment.shipAutomatorDir);
  config.supportEmail = String(config.supportEmail ?? "").trim().toLowerCase();
  return config;
}

/** Shiprocket credentials: this engine's .env first, then the Shiprocket Fulfillment Automator's. */
export function loadShiprocketEnv(config) {
  loadEnv(config.fulfillment.shipAutomatorDir ? [config.fulfillment.shipAutomatorDir] : []);
  return { email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD };
}

export const usesShiprocket = (config) => ["track", "reship", "autoship"].includes(config.fulfillment.mode);
export const reshipsOn = (config) => ["reship", "autoship"].includes(config.fulfillment.mode);

/** "#1234", "1234", "#1234ABC" -> "1234" (the bare order number the store shows customers). */
export function normOrder(config, s) {
  let v = String(s ?? "").trim();
  if (config.orderPrefix) v = v.replace(new RegExp(`^${escapeRe(config.orderPrefix)}`), "");
  v = v.replace(/^#/, "");
  if (config.orderSuffix) v = v.replace(new RegExp(`${escapeRe(config.orderSuffix)}$`, "i"), "");
  return v.trim();
}
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Calendar day (YYYY-MM-DD) of a timestamp in the store's timezone. */
export function dayKey(ts, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

export function readJsonl(f) {
  try {
    return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
export function appendJsonl(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(obj) + "\n");
}
export function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return fallback; }
}
/** Write via temp file + rename so a crash never leaves half a file. */
export function writeJsonAtomic(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
