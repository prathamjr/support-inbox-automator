# Troubleshooting: what each problem means and what fixes it

Every row comes from a real store running this daily. Read the matching row before improvising.

| What they see | What it means | Fix |
|---|---|---|
| "Claude Code's login on this computer expired" | The scheduled run couldn't refresh Claude Code's login. | Open Claude Code on this computer once (it refreshes), then "run support now". |
| "wrote no report" / "incomplete" | The run stopped early: a tool it needed was denied, a connector was down, or it hit the plan's usage limit. | Read the end of the run's log (`logs/run-*.log`). Usage limit: lower `maxCustomersPerRun` or move `runTime`. Denied tool: see "tool missing" below. |
| Nothing arrived at all | The computer was off, asleep or logged out, it wasn't a run day, or it's paused. | `node scripts/scheduler.mjs status`. Run now with `node run.mjs --now`. |
| A tool is "missing" or "denied" in the log | The run only allows the tools in `run.mjs`. A new connector tool name, or the connector was disconnected. | `check.mjs gmail` / `shopify`. If the account names tools differently, set `connectors.*` in config.json. |
| Drafts piling up in the same thread | An old draft wasn't detected. | The run checks `list_drafts` first and replaces its own drafts. If a draft was made by hand, the run leaves it. Delete stale drafts in Gmail. |
| Drafts without a label | Gmail refuses to label a draft MESSAGE; the run labels the THREAD. | Re-run; if it persists, check the label ids with `check.mjs gmail`. |
| A reply went to the contact form's robot address | `to` wasn't set. | Can't happen with the gate on (it blocks any reply to a contact-form sender). If it happened in a chat reply, resend to the Email field in the form. |
| Customer got almost the same email twice | Two runs (or a run and a person) replied, or the customer has two email addresses. | The guard blocks a 2nd email the same day and near-copies; check `data/sent-log.jsonl`. Add the 2nd address to the customer's next guard call (the run's identity search finds it). |
| "guard blocked #1234: …" in the message | The guard stopped an email: a banned phrase, a repeat, a held customer, a placeholder. | Usually correct. If the rule is wrong for this store, change the policy or `disabledChecks` (with the owner). Never reword to sneak past it. |
| "Can't find your order" situations | Customer ordered with another email, phone or name spelling. | The run searches by every identifier; if it still finds nothing it makes a Read-first draft listing the searches. The owner checks Shopify by hand. |
| Shiprocket shows "out for pickup" for weeks | The courier closed the pickup without collecting it. | `tools/track.mjs <awb> --scans`: last scan says pickup cancelled. With `reship`/`autoship` the run replaces it; otherwise it's an owner draft. |
| Replacement "refused" in the message | `reship.mjs` safety checks (original still live, already replaced, two warehouses, no phone…). | Read the reason. Owner decides; a manual replacement in chat needs `--owner-approved`. |
| Replacement created but never booked | `reship` mode (owner books), or the Fulfillment Automator isn't scheduled / wallet empty / product not mapped there. | `check.mjs ship-automator`; the Fulfillment Automator's own message says why an order was blocked. |
| Replies bounce (mailer-daemon) | The sending domain has no SPF/DMARC. | Add SPF (include Google) and DMARC TXT records at the domain's DNS. Flagged in the message until fixed. |
| Old angry threads suddenly answered | `scanFloorDate` was moved back. | Keep it recent; old threads are only handled when high priority. |
| Hindi/Hinglish emails ignored | Shouldn't happen: the run translates and answers them. | Check the run log for that thread; tell Claude. |

## Gmail and Shiprocket quirks worth knowing
- Gmail search results show at most 5 messages per thread. "Who wrote last" must always come from opening the thread.
- Customer emails land in Promotions and Updates too, and "read" doesn't mean "answered": the run scans all tabs.
- `update_draft` detaches a draft from its thread (blocked); `send_message` starts a new thread (blocked).
- Shiprocket masks phone numbers in API reads. Real phones come from the Shopify order's shipping address.
- Shiprocket's `?search=` needs the full order id as Shiprocket stores it (set `orderPrefix`/`orderSuffix`).
- Cancelling in Shiprocket is not instant and never touches the store order (`cancel_on_channel: false`).
- If a scheduled run dies instantly with an empty log, run `node run.mjs --now` in a terminal to see the error. The
  usual causes: Claude Code not on the saved `claudePath` any more (re-run `check.mjs claude`), or not logged in.
