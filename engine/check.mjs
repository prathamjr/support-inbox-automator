#!/usr/bin/env node
/**
 * Checks used during setup and whenever something looks off. Nothing here sends, drafts or books anything.
 *
 *   node check.mjs claude          is Claude Code installed and logged in for scheduled (headless) runs?
 *   node check.mjs gmail           can a headless run see the Gmail connector? prints the mailbox's labels + ids
 *   node check.mjs shopify         can a headless run see the Shopify connector? prints the store name
 *   node check.mjs shiprocket      Shiprocket login + orders in the last 7 days
 *   node check.mjs ship-automator  is the Shiprocket Fulfillment Automator installed and scheduled?
 *   node check.mjs config          config.json, policies.md, people.json and the prompt all valid?
 *   node check.mjs guard-test      runs sample emails through the guard (shows what it blocks)
 *   node check.mjs notify-test     sends a test message to the configured chat
 *   node check.mjs all             config + claude + shiprocket (if used) + ship-automator (if used)
 * The gmail and shopify checks use a few cents' worth of Claude usage each.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ENGINE_DIR, FILES, PLAYBOOK_DIR, loadConfig, loadEnv, readJson, usesShiprocket } from "./lib/config.mjs";
import { sendMessage } from "./lib/notify.mjs";
import { shiprocket } from "./lib/orders.mjs";
import { SR } from "./lib/shiprocket.mjs";

const cmd = process.argv[2] ?? "all";
loadEnv();
const config = loadConfig({ allowMissing: ["claude", "gmail", "shopify"].includes(cmd) });
let failed = false;
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m) => { failed = true; console.log(`✗ ${m}`); };
const warn = (m) => console.log(`⚠ ${m}`);

function findClaude() {
  if (config.claudePath && config.claudePath !== "claude" && fs.existsSync(config.claudePath)) return config.claudePath;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", shell: process.platform === "win32" });
  return (r.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
}

function claudeP(prompt, allowedTools = []) {
  const bin = findClaude();
  if (!bin) return { error: "Claude Code (the `claude` command) is not installed or not on PATH" };
  const args = ["-p", "--output-format", "text", ...(allowedTools.length ? ["--allowedTools", allowedTools.join(" ")] : [])];
  const r = spawnSync(bin, args, { input: prompt, encoding: "utf8", cwd: ENGINE_DIR, timeout: 240e3, shell: process.platform === "win32" && !/\.exe$/i.test(bin) });
  return { bin, code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

async function checkClaude() {
  const r = claudeP("Reply with exactly the word OK and nothing else.");
  if (r.error) return bad(`${r.error}. Install: npm install -g @anthropic-ai/claude-code`);
  if (r.code === 0 && /\bOK\b/.test(r.out)) {
    ok(`Claude Code works headless (${r.bin})`);
    if (config.claudePath !== r.bin && fs.existsSync(FILES.config)) {
      const raw = JSON.parse(fs.readFileSync(FILES.config, "utf8"));
      raw.claudePath = r.bin;
      fs.writeFileSync(FILES.config, JSON.stringify(raw, null, 2));
      ok(`saved claudePath in config.json (scheduled runs don't see your terminal's PATH)`);
    }
  } else if (/login|OAuth|authenticate|API key/i.test(r.out)) bad(`Claude Code is installed but not logged in. Run \`claude\` once in a terminal and log in. (${r.out.slice(0, 160)})`);
  else bad(`claude -p failed (exit ${r.code}): ${r.out.slice(0, 300)}`);
}

async function checkGmail() {
  const tool = `${config.connectors.gmail}list_labels`;
  const r = claudeP(`Call the tool ${tool} (load it with ToolSearch first if needed). Print every label as one line "<id> | <name>" and nothing else. If the tool does not exist, print exactly NO_GMAIL_CONNECTOR.`, [tool, "ToolSearch"]);
  if (r.error) return bad(r.error);
  if (/NO_GMAIL_CONNECTOR/.test(r.out) || r.code !== 0) return bad(`the scheduled run can't see Gmail. Connect Gmail at claude.ai → Settings → Connectors (same Claude account as this computer's Claude Code). Output: ${r.out.slice(0, 200)}`);
  ok("Gmail connector works in headless runs. Labels in the mailbox:");
  console.log(r.out.split(/\r?\n/).filter((l) => l.includes("|")).map((l) => `   ${l}`).join("\n"));
  for (const k of ["ready", "readFirst"]) {
    const l = config.labels[k];
    const line = r.out.split(/\r?\n/).find((x) => x.split("|")[1]?.trim().toLowerCase() === l.name.toLowerCase());
    if (!line) warn(`label "${l.name}" not found in this mailbox yet: create it in Gmail, then run this again`);
    else if (line.split("|")[0].trim() !== l.id) warn(`label "${l.name}" has id ${line.split("|")[0].trim()}; config.json says "${l.id}". Put the id in config.json labels.${k}.id`);
    else ok(`label "${l.name}" = ${l.id}`);
  }
}

async function checkShopify() {
  const tool = `${config.connectors.shopify}graphql_query`;
  const r = claudeP(`Call the tool ${tool} (load it with ToolSearch first if needed) with the query "{ shop { name myshopifyDomain } }". Print only "<name> | <domain>". If the tool does not exist, print exactly NO_SHOPIFY_CONNECTOR.`, [tool, "ToolSearch"]);
  if (r.error) return bad(r.error);
  if (/NO_SHOPIFY_CONNECTOR/.test(r.out) || r.code !== 0) return bad(`the scheduled run can't see Shopify. Connect Shopify at claude.ai → Settings → Connectors. Output: ${r.out.slice(0, 200)}`);
  ok(`Shopify connector works in headless runs: ${r.out.split(/\r?\n/).find((l) => l.includes("|")) ?? r.out.slice(0, 120)}`);
}

async function checkShiprocket() {
  try {
    const sr = await shiprocket(config);
    ok("Shiprocket login works");
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const list = (await sr.api("GET", `${SR}/v1/external/orders?per_page=50&page=1&from=${from}&to=${to}`))?.data ?? [];
    const store = list.filter((o) => !/CUSTOM/i.test(String(o.channel_name ?? "")));
    const examples = [...new Set((store.length ? store : list).slice(0, 5).map((o) => o.channel_order_id))];
    ok(`${list.length}${list.length === 50 ? "+" : ""} Shiprocket orders in the last 7 days; store order ids look like: ${examples.join(", ") || "none"}`);
    if (config.orderSuffix && list.length && !list.some((o) => String(o.channel_order_id).endsWith(config.orderSuffix))) warn(`orderSuffix is "${config.orderSuffix}" but no recent Shiprocket id ends with it`);
  } catch (e) { bad(`Shiprocket: ${e.message}`); }
}

async function checkShipAutomator() {
  const dir = config.fulfillment.shipAutomatorDir;
  if (config.fulfillment.mode !== "autoship") return ok(`fulfillment.mode is "${config.fulfillment.mode}" (the Shiprocket Fulfillment Automator is not needed)`);
  if (!dir || !fs.existsSync(path.join(dir, "fulfill.mjs"))) return bad(`fulfillment.mode is "autoship" but the Shiprocket Fulfillment Automator engine isn't at "${dir}". Install it first: https://github.com/prathamjr/shiprocket-fulfillment-automator`);
  if (!fs.existsSync(path.join(dir, "config.json"))) return bad("the Shiprocket Fulfillment Automator is installed but not set up yet (no config.json). Finish its setup first.");
  ok(`Shiprocket Fulfillment Automator found at ${dir}`);
  const shipCfg = readJson(path.join(dir, "config.json"), {});
  if (shipCfg.lookbackDays && shipCfg.lookbackDays !== config.fulfillment.lookbackDays) warn(`its lookbackDays is ${shipCfg.lookbackDays}, this config says ${config.fulfillment.lookbackDays}: set them the same`);
  const s = spawnSync(process.execPath, [path.join(dir, "scripts", "scheduler.mjs"), "status"], { cwd: dir, encoding: "utf8" });
  const st = `${s.stdout ?? ""}`.trim();
  if (/✓ Scheduled/.test(st)) ok(`its daily shipping run is scheduled: ${st.split("\n")[0]}`);
  else warn("its daily shipping run is NOT scheduled: replacements and new orders won't be booked until it is");
}

async function checkConfig() {
  if (!config.supportEmail) bad("supportEmail is empty");
  if (!["drafts", "send-routine"].includes(config.mode)) bad(`mode must be "drafts" or "send-routine" (is "${config.mode}")`);
  if (!["none", "track", "reship", "autoship"].includes(config.fulfillment.mode)) bad(`fulfillment.mode must be none, track, reship or autoship`);
  if (!config.labels.ready.id || !config.labels.readFirst.id) bad("Gmail label ids missing (run: node check.mjs gmail)");
  if (!config.scanFloorDate) warn("scanFloorDate not set: the first full scan looks back 30 days");
  if (!config.signOff.includes("\n")) warn("signOff is one line; most read better as two (e.g. \"Take care,\\nMy Store Support\")");
  const pol = path.join(PLAYBOOK_DIR, "policies.md");
  if (!fs.existsSync(pol)) bad("playbook/policies.md missing (setup step 6)");
  else if (/^Example:/m.test(fs.readFileSync(pol, "utf8"))) bad("playbook/policies.md still has \"Example:\" lines: replace them with the owner's real policies");
  if (fs.existsSync(FILES.people)) {
    const p = readJson(FILES.people, null);
    if (!p || !Array.isArray(p.entries)) bad("people.json is not valid ({\"entries\":[...]})");
  }
  for (const b of config.bannedPhrases ?? []) { try { new RegExp(b.pattern, "i"); } catch { bad(`bannedPhrases pattern is invalid: ${b.pattern}`); } }
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, "run.mjs"), "--print-prompt"], { encoding: "utf8" });
  if (r.status !== 0) bad(`the prompt does not render: ${(r.stderr || r.stdout).slice(-300)}`);
  else ok(`prompt renders (${Math.round(r.stdout.length / 1000)}k characters)`);
  if (!failed) ok("config looks good");
}

async function guardTest() {
  const cases = [
    ["a normal, specific reply", "Hi Priya,\n\nI checked order #1234 myself: it was picked up on 12 Nov and was last scanned in Pune this morning. You can follow it here: https://example.com/track\n\nTake care,\nSupport"],
    ["a refund promise", "Hi Priya,\n\nYour refund will be processed shortly.\n\nTake care,\nSupport"],
    ["a time frame", "Hi Priya,\n\nIt will reach you within 2 days.\n\nTake care,\nSupport"],
    ["\"can't find your order\"", "Hi Priya,\n\nI couldn't find any order under this email.\n\nTake care,\nSupport"],
    ["stock phrasing", "Hi Priya,\n\nWe apologize for any inconvenience. Rest assured, it is on its way.\n\nTake care,\nSupport"],
  ];
  for (const [label, text] of cases) {
    const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, "guard.mjs"), "--email", "guard-test@example.com", "--to", "guard-test@example.com", "--message-id", `guard-test-${Date.now()}`, "--name", "Guard Test", "--order", "000000", "--text", text], { encoding: "utf8" });
    let j = {}; try { j = JSON.parse(r.stdout); } catch { /* */ }
    console.log(`${j.allowed ? "✓ allowed" : "✗ blocked"}  ${label}${j.blocks?.length ? `: ${j.blocks[0]}` : ""}`);
  }
}

try {
  if (cmd === "claude") await checkClaude();
  else if (cmd === "gmail") await checkGmail();
  else if (cmd === "shopify") await checkShopify();
  else if (cmd === "shiprocket") await checkShiprocket();
  else if (cmd === "ship-automator") await checkShipAutomator();
  else if (cmd === "config") await checkConfig();
  else if (cmd === "guard-test") await guardTest();
  else if (cmd === "notify-test") { await sendMessage(config, `✅ *${config.brandName}*: Support Inbox Automator is connected. The daily summary will arrive here.`); ok(`test message sent via ${config.notify.type}`); }
  else if (cmd === "all") {
    await checkConfig();
    await checkClaude();
    if (usesShiprocket(config)) await checkShiprocket();
    await checkShipAutomator();
  } else { console.error(`unknown check "${cmd}"`); process.exit(2); }
} catch (e) { bad(e.message); }
process.exit(failed ? 1 : 0);
