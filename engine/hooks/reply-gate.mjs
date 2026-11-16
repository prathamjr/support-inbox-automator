#!/usr/bin/env node
// Claude Code hook loaded by run.mjs for the scheduled run (and optionally for chats, with --chat).
// The guard alone is only an instruction; this hook makes it mechanical.
//
//   PreToolUse on Gmail reply | create_draft:
//     blocks unless `to` is exactly ONE customer address (never ours, a no-reply or a contact-form sender),
//     there is no cc/bcc/reply-all, and guard.mjs approved THIS message id + THIS recipient in the last
//     20 minutes (each approval works once). In "drafts" mode a real reply is always blocked.
//   PostToolUse (--post): appends what Gmail actually accepted to data/actual-sends.jsonl (the truth for reports).
//   --chat: same gate for an interactive chat with the owner; accepts guard --manual approvals.
// Exit 2 = block; stderr is shown to Claude as the reason.
import { FILES, loadConfig, readJsonl, appendJsonl } from "../lib/config.mjs";
import { isOurAddress } from "../lib/checks.mjs";

const CHAT = process.argv.includes("--chat");
const POST = process.argv.includes("--post");
const block = (why) => { process.stderr.write(`BLOCKED by the support reply gate: ${why}\n`); process.exit(2); };

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch { block("could not read the tool call"); }
  const config = loadConfig();
  const tool = String(ev.tool_name ?? "");
  const inp = ev.tool_input ?? {};
  const isDraft = /create_draft/.test(tool);
  const messageId = String((isDraft ? inp.replyToMessageId : inp.messageId) ?? "");
  const to = (Array.isArray(inp.to) ? inp.to : inp.to ? [inp.to] : []).map((x) => String(x).trim().toLowerCase());

  if (POST) {
    const resp = ev.tool_response ?? {};
    appendJsonl(FILES.actualSends, {
      ts: new Date().toISOString(), tool: tool.replace(config.connectors.gmail, ""), to, messageId,
      source: CHAT ? "chat" : "scheduled", response: (typeof resp === "string" ? resp : JSON.stringify(resp)).slice(0, 300),
    });
    process.exit(0);
  }

  if (!CHAT && !isDraft && config.mode === "drafts") block('mode is "drafts": nothing is sent automatically. Create a draft instead.');
  if (process.env.SIA_DRY === "1") block("this is a dry run: nothing is sent or drafted. Put the text in the report instead.");
  if (!messageId) block(isDraft ? "drafts must sit in the customer's thread: set replyToMessageId to their latest message." : "messageId is required.");
  if (to.length !== 1) block("set `to` to exactly ONE address, the customer's own (contact forms: the Email field inside the form). An empty `to` replies to the form's robot address.");
  if (isOurAddress(config, to[0])) block(`${to[0]} is not a customer address.`);
  if ((inp.cc ?? []).length || (inp.bcc ?? []).length || inp.replyAll) block("no cc, bcc or reply-all on customer emails.");

  const used = new Set(readJsonl(FILES.approvalsUsed).map((u) => u.key));
  const now = Date.now();
  const ok = readJsonl(FILES.approvals).reverse().find((a) =>
    a.messageId === messageId && a.to === to[0] && (CHAT || !a.manual) && now - Date.parse(a.ts) < 20 * 60e3 && !used.has(`${a.ts}|${a.messageId}`));
  if (!ok) block(`guard.mjs has not approved message ${messageId} -> ${to[0]} in the last 20 minutes. Run guard.mjs with this exact message id, recipient and text, and only continue if it says "allowed": true.`);
  appendJsonl(FILES.approvalsUsed, { key: `${ok.ts}|${ok.messageId}`, ts: new Date().toISOString() });
  process.exit(0);
});
