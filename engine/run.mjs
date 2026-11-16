#!/usr/bin/env node
/**
 * The daily support run. Starts Claude Code headless (claude -p) with the playbook as its instructions,
 * the reply gate hooks loaded, and only the tools the run needs. Then turns its report into one chat message.
 *
 *   node run.mjs                 a real run (respects runDays and PAUSE.txt; this is what the schedule calls)
 *   node run.mjs --now           run right now, even on a non-run day or while paused
 *   node run.mjs --dry-run       reads everything, decides everything, changes NOTHING (no emails, drafts,
 *                                labels or replacements); the report lists the exact text it would have sent
 *   node run.mjs --print-prompt  print the instructions Claude would get, and exit (no Claude, no tokens)
 *   --silent                     no chat message      --extra "<one-off instruction>"   appended to the prompt
 *
 * Every run writes logs/run-<time>.log and data/reports/report-<time>.json, and adds one line to logs/runs.log.
 * Whatever happens (success, crash, expired login, timeout) the owner gets a message, so a day is never silent.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ENGINE_DIR, DATA_DIR, LOG_DIR, PLAYBOOK_DIR, FILES, loadConfig, loadEnv, readJson, readJsonl, usesShiprocket, reshipsOn, dayKey } from "./lib/config.mjs";
import { sendMessage } from "./lib/notify.mjs";
import { summaryText, failureText } from "./lib/summary.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DRY = has("--dry-run");
const NOW = has("--now") || DRY;
const PRINT = has("--print-prompt");
const SILENT = has("--silent");
const extra = (() => { const i = argv.indexOf("--extra"); return i >= 0 ? argv[i + 1] : process.env.SIA_EXTRA_PROMPT; })();

loadEnv();
const config = loadConfig();
const node = process.execPath;
const fwd = (p) => p.replace(/\\/g, "/");
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
fs.mkdirSync(path.join(DATA_DIR, "reports"), { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
const REPORT = path.join(DATA_DIR, "reports", `report-${stamp}${DRY ? "-dry" : ""}.json`);
const LOG = path.join(LOG_DIR, `run-${stamp}${DRY ? "-dry" : ""}.log`);
const index = (msg) => fs.appendFileSync(FILES.runIndex, `${new Date().toISOString()} ${DRY ? "[dry] " : ""}${msg}\n`);

// ---------------------------------------------------------------- the prompt
const RESHIP_CASE_TEXT = {
  courier_cancelled: "   - **Courier cancelled the shipment before pickup**: the original's live status is CANCELED, nothing was ever collected, no replacement exists. `--issue courier_cancelled`.",
  pickup_cancelled: "   - **Pickup cancelled**: the original's tracking shows `pickupCancelled: true` (the courier closed the pickup without collecting it), no replacement exists. `--issue pickup_cancelled` (the tool proves it from the scans and cancels the dead booking in Shiprocket itself, never in the store).",
  rto_address_confirmed: "   - **Came back to us** (Shiprocket shows RTO DELIVERED) **and the customer has replied in the thread with their delivery address**. `--issue rto_address_confirmed`, pass the address.",
};

export function buildPrompt(cfg = config, { dry = DRY } = {}) {
  const floor = cfg.scanFloorDate ? cfg.scanFloorDate : dayKey(Date.now() - 30 * 86400e3, cfg.timezone);
  const vars = {
    BRAND: cfg.brandName, SUPPORT_EMAIL: cfg.supportEmail, ENGINE: fwd(ENGINE_DIR), NODE: `"${fwd(node)}"`,
    GMAIL: cfg.connectors.gmail, SHOPIFY: cfg.connectors.shopify,
    READY_ID: cfg.labels.ready.id || "<ready label id>", READY_NAME: cfg.labels.ready.name,
    READFIRST_ID: cfg.labels.readFirst.id || "<read-first label id>", READFIRST_NAME: cfg.labels.readFirst.name,
    SCAN_FLOOR: floor.replace(/-/g, "/"), MAX_CUSTOMERS: cfg.maxCustomersPerRun, FULL_SCAN_DAYS: cfg.fullScanEveryDays,
    CONTACT_FORM_SENDERS: cfg.contactFormSenders.join(", "), CONTACT_FORM_SENDERS_OR: cfg.contactFormSenders.join(" OR "),
    REPORT_JSON: fwd(REPORT), BACKLOG: fwd(FILES.backlog), SIGN_OFF: cfg.signOff, LOOKBACK: cfg.fulfillment.lookbackDays,
    RESHIP_CASES: (cfg.fulfillment.reshipCases ?? []).map((c) => RESHIP_CASE_TEXT[c]).filter(Boolean).join("\n"),
  };
  const flags = {
    SEND: cfg.mode === "send-routine", DRY: dry, SHIPROCKET: usesShiprocket(cfg), RESHIP: reshipsOn(cfg),
    AUTOSHIP: cfg.fulfillment.mode === "autoship", NOEMDASH: cfg.noEmDashes,
  };
  const render = (s) => {
    let prev;
    do {
      prev = s;
      s = s.replace(/\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/, (_, kind, key, body) => ((kind === "#") === Boolean(flags[key]) ? body : ""));
    } while (s !== prev);
    return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  };
  const read = (f) => fs.readFileSync(path.join(PLAYBOOK_DIR, f), "utf8");
  const policies = fs.existsSync(path.join(PLAYBOOK_DIR, "policies.md")) ? read("policies.md") : null;
  if (!policies) throw new Error("playbook/policies.md is missing. Setup step 6 writes it with the owner.");
  return [
    dry ? "STARTED BY run.mjs (DRY RUN)." : "STARTED BY run.mjs.",
    render(read("runbook.md")),
    "\n---\n", render(policies),
    "\n---\n", render(read("voice.md")),
    "\n---\n", render(read("templates.md")),
    extra ? `\n---\nOne-off instruction from the owner for this run only: ${extra}` : "",
    "\nDo all of this work yourself in this session. Never launch a background agent, sub-agent or background task.",
  ].join("\n");
}

if (PRINT) {
  const p = buildPrompt();
  const left = p.match(/\{\{[#^/]?\w+\}\}/g);
  fs.writeSync(1, p + "\n");
  if (left) { console.error(`\n✗ unrendered placeholders: ${[...new Set(left)].join(", ")}`); process.exit(1); }
  process.exit(0);
}

// ---------------------------------------------------------------- should we run?
const pause = fs.existsSync(FILES.pause) ? fs.readFileSync(FILES.pause, "utf8").split(/\r?\n/)[0].trim() : "";
const today = dayKey(Date.now(), config.timezone);
if (!NOW && (pause === "PERMANENT" || pause === today)) { index(`paused (${pause})`); console.log(`Paused (${pause}). Delete PAUSE.txt or run with --now.`); process.exit(0); }
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, weekday: "short" }).format(new Date());
if (!NOW && !config.runDays.map((d) => d.slice(0, 3)).includes(weekday)) { console.log(`Not a run day (${weekday}).`); process.exit(0); }

const problems = [];
if (!config.supportEmail) problems.push("supportEmail is empty in config.json");
if (!DRY && (!config.labels.ready.id || !config.labels.readFirst.id)) problems.push("Gmail label ids are missing in config.json (setup step 4)");
if (!fs.existsSync(path.join(PLAYBOOK_DIR, "policies.md"))) problems.push("playbook/policies.md is missing (setup step 6)");
if (problems.length) {
  const msg = `🚨 *${config.brandName} support run did not start*\n\n${problems.join("\n")}`;
  console.error(msg); index(`not started: ${problems.join("; ")}`);
  if (!SILENT) await sendMessage(config, msg).catch(() => {});
  process.exit(1);
}

// one run at a time
if (fs.existsSync(FILES.lock)) {
  const age = Date.now() - fs.statSync(FILES.lock).mtimeMs;
  if (age < (config.maxRunMinutes + 10) * 60e3) { index("skipped: another run is going"); console.log("Another run is still going."); process.exit(0); }
}
fs.writeFileSync(FILES.lock, String(process.pid));
const unlock = () => { try { fs.rmSync(FILES.lock); } catch { /* gone */ } };

// ---------------------------------------------------------------- settings: hooks + tools
const hook = (script, ...args) => ({ type: "command", command: [`"${fwd(node)}"`, `"${fwd(path.join(ENGINE_DIR, "hooks", script))}"`, ...args].join(" "), timeout: 15 });
const G = config.connectors.gmail;
const S = config.connectors.shopify;
const settingsPath = path.join(DATA_DIR, "run-settings.json");
const unsafe = [`${G}send_message`, `${G}update_draft`, `${G}forward`];
const mutating = [`${G}reply`, `${G}create_draft`, `${G}delete_draft`, `${G}label_thread`, `${G}unlabel_thread`, `${G}label_message`, `${G}unlabel_message`];
fs.writeFileSync(settingsPath, JSON.stringify({
  hooks: {
    PreToolUse: [
      { matcher: [`${G}reply`, `${G}create_draft`].join("|"), hooks: [hook("reply-gate.mjs")] },
      { matcher: unsafe.join("|"), hooks: [hook("block-unsafe.mjs")] },
      ...(DRY ? [{ matcher: mutating.join("|"), hooks: [hook("block-unsafe.mjs", "--dry")] }] : []),
    ],
    PostToolUse: [{ matcher: [`${G}reply`, `${G}create_draft`].join("|"), hooks: [hook("reply-gate.mjs", "--post")] }],
  },
}, null, 1));

const allowed = [
  ...["search_threads", "get_thread", "list_drafts", "get_draft", "list_labels"].map((t) => G + t),
  ...(DRY ? [] : ["create_draft", "delete_draft", "label_thread", "unlabel_thread"].map((t) => G + t)),
  ...(!DRY && config.mode === "send-routine" ? [`${G}reply`] : []),
  ...["list-orders", "get-order", "list-customers", "graphql_query"].map((t) => S + t),
  "Read", "Write", "Edit", "Bash(node:*)", "ToolSearch",
];

// ---------------------------------------------------------------- run Claude
if (reshipsOn(config)) spawnSync(node, [path.join(ENGINE_DIR, "tools", "reship.mjs"), "sync"], { cwd: ENGINE_DIR, stdio: "ignore", timeout: 120e3, env: { ...process.env, ...(DRY ? { SIA_DRY: "1" } : {}) } });

const prompt = buildPrompt();
const started = Date.now();
const claudeArgs = ["-p", "--model", config.model, "--settings", settingsPath, "--allowedTools", allowed.join(" "), "--disallowedTools", "Agent Task", "--output-format", "text"];
const logStream = fs.createWriteStream(LOG);
const child = spawn(config.claudePath, claudeArgs, {
  cwd: ENGINE_DIR,
  shell: process.platform === "win32" && !/\.exe$/i.test(config.claudePath),
  env: { ...process.env, SIA_HEADLESS: "1", ...(DRY ? { SIA_DRY: "1" } : {}), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0" },
});
let output = "";
child.stdout.on("data", (d) => { output += d; logStream.write(d); });
child.stderr.on("data", (d) => { output += d; logStream.write(d); });
child.stdin.end(prompt);
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, config.maxRunMinutes * 60e3);
const code = await new Promise((resolve) => {
  child.on("error", (e) => { output += `\n${e.message}`; resolve(-1); });
  child.on("close", resolve);
});
clearTimeout(timer);
logStream.end();
unlock();
const minutes = ((Date.now() - started) / 60e3).toFixed(1);

// ---------------------------------------------------------------- report → message
const report = readJson(REPORT, null);
let text;
if (/OAuth|session expired|could not be refreshed|Failed to authenticate|Invalid API key|Please run \/login|not logged in/i.test(output) && !report) {
  index(`AUTH_EXPIRED exit=${code} ${minutes}m`);
  text = failureText(config, "auth");
} else if (timedOut && !report) {
  index(`TIMEOUT ${minutes}m`);
  text = failureText(config, "timeout");
} else if (!report) {
  index(`NO_REPORT exit=${code} ${minutes}m`);
  text = failureText(config, code === -1 ? "crash" : "noreport", output.trim());
} else {
  // the report must not claim more sends than Gmail actually accepted
  const real = readJsonl(FILES.actualSends).filter((r) => Date.parse(r.ts) >= started && r.tool === "reply").length;
  if (!DRY && (report.sent ?? []).length !== real) (report.flags ??= []).unshift(`report lists ${(report.sent ?? []).length} sent but Gmail accepted ${real}: check Gmail → Sent`);
  if (!DRY && config.fulfillment.mode === "autoship" && config.fulfillment.bookReshipsAfterRun && (report.counts?.autoStaged ?? 0) > 0) {
    const shipDir = config.fulfillment.shipAutomatorDir;
    const r = spawnSync(node, [path.join(shipDir, "fulfill.mjs"), "--force"], { cwd: shipDir, encoding: "utf8", timeout: 20 * 60e3 });
    (report.flags ??= []).push(r.status === 0 ? "shipping run started for the new replacement parcel(s): see the shipping message" : `shipping run for replacements failed (exit ${r.status}); they go out in the next scheduled shipping run`);
  }
  index(`ok exit=${code} ${minutes}m sent=${report.counts?.sent ?? 0} drafts=${report.counts?.drafts ?? 0} readFirst=${report.counts?.readFirst ?? 0} backlog=${report.counts?.backlogRemaining ?? 0}`);
  text = summaryText(config, report, { dry: DRY });
}
console.log(text);
console.log(`\nReport: ${report ? REPORT : "(none)"}\nLog: ${LOG}`);
if (!SILENT) {
  try { await sendMessage(config, text); } catch (e) { index(`notify failed: ${e.message}`); console.error(`✗ chat message failed: ${e.message}`); }
}
process.exit(report ? 0 : 1);
