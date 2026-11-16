#!/usr/bin/env node
// Claude Code PreToolUse hook: blocks Gmail actions that have caused real damage.
//  - send_message: starts a NEW email thread; customers lose the history. Always `reply` in their thread.
//  - update_draft: detaches the draft from its thread and drops its label. Delete it and create it again.
//  - forward: customer emails are never forwarded by the automation.
//  --dry: on a dry run, every Gmail action that changes something is blocked.
// Exit 2 = block; stderr is shown to Claude as the reason.
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  let tool = "";
  try { tool = JSON.parse(input).tool_name ?? ""; } catch { /* no input */ }
  let why;
  if (process.argv.includes("--dry")) why = "this is a dry run: nothing in Gmail is changed. Write what you WOULD do into the report.";
  else if (/update_draft/.test(tool)) why = "never use update_draft (it detaches the draft from its thread). Use delete_draft, then create_draft with replyToMessageId, then label the thread again.";
  else if (/send_message/.test(tool)) why = "never use send_message for customers (it starts a new thread). Use reply with messageId = the customer's LATEST message in their own thread.";
  else why = "this Gmail action is not allowed in the support automation.";
  process.stderr.write(`BLOCKED: ${why}\n`);
  process.exit(2);
});
