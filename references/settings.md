# Every setting in config.json

Change a setting, add a dated line to RULES.md, then `node check.mjs config`.

| Setting | Default | What it does |
|---|---|---|
| `brandName` | "My Store" | Used in the daily message and the instructions. |
| `supportEmail` | | The support address. Never treated as a customer. |
| `signOff` | "Take care,\nMy Store Support" | Exact sign-off on every email (`\n` = new line). |
| `timezone` | Asia/Kolkata | For run days, "one email per customer per day", dates in the message. |
| `runTime` / `runDays` | 15:00, every day | When the schedule runs (re-run `scheduler.mjs install` after changing). |
| `mode` | "drafts" | `"drafts"`: everything is a draft (routine ones labelled Ready to send). `"send-routine"`: routine cases are sent, the rest are drafts. Only on the owner's explicit yes. |
| `model` | claude-sonnet-5-5 | The Claude model for the run. Sonnet keeps plan usage reasonable on long inboxes. |
| `claudePath` | "claude" | Full path to Claude Code, saved by `check.mjs claude`. |
| `maxCustomersPerRun` | 40 | Cap per run, oldest waiting first; the rest carry over to the next run. Lower it if runs use too much of the plan. |
| `maxRunMinutes` | 120 | A run taking longer is stopped (and the owner is told). |
| `scanFloorDate` | 30 days ago | Never look at mail before this date (YYYY-MM-DD). Older threads only get handled if high priority. |
| `fullScanEveryDays` | 7 | How often the whole inbox is rescanned instead of only new mail plus the carried-over list. |
| `orderPrefix` / `orderSuffix` | "#" / "" | How store order numbers map to Shiprocket ids: customer sees "#1234", Shiprocket stores "1234ABC" → suffix "ABC". |
| `contactFormSenders` | ["mailer@shopify.com"] | Contact-form robot addresses. Replies go to the Email field in the form. |
| `ourAddresses` | [] | Team addresses that reply to customers. Never treated as a customer. |
| `labels.ready` / `labels.readFirst` | names + ids | The two Gmail labels. Ids from `check.mjs gmail`. |
| `connectors.gmail` / `.shopify` | claude.ai prefixes | Only change if their account names the tools differently. |
| `fulfillment.mode` | "track" | `none` / `track` / `reship` / `autoship`: see SKILL.md Step 5 and `autoship.md`. |
| `fulfillment.lookbackDays` | 14 | Same as the Fulfillment Automator's: orders older than this are never booked automatically. |
| `fulfillment.shipAutomatorDir` | "" | The Fulfillment Automator's engine folder (autoship). |
| `fulfillment.bookReshipsAfterRun` | false | autoship only: run a shipping pass right after the support run if replacements were arranged. Spends wallet money. |
| `fulfillment.reshipCases` | all three | Which cases may get an automatic replacement: `courier_cancelled`, `pickup_cancelled`, `rto_address_confirmed`. |
| `fulfillment.neverReshipProducts` | [] | Product name parts that are never replaced automatically. |
| `fulfillment.defaultWeightKg` / `defaultBoxCm` | 0.5 / 10×10×10 | Used for a partial replacement (some items only). |
| `bannedPhrases` | [] | Their own banned wording: `{"pattern": "regex", "why": "..."}`. The guard blocks any email that matches. |
| `disabledChecks` | [] | Switch off a built-in guard check by id (`refund-promise`, `store-credit`, `phone-call`, `time-frames`, `someone-will-follow-up`, `cant-find-order`, `self-contradiction`, `stagey`, `time-bound-copy`). Only when their policy really allows it (e.g. they DO offer callbacks); explain the risk first. |
| `noEmDashes` | true | Block em dashes in emails. |
| `notify.type` | "none" | slack / googlechat / discord / telegram / none (pop-up on a Mac). |

## Files the owner may edit (with Claude)
- `playbook/policies.md`: their policies and product facts. The run never offers anything this doesn't allow.
- `playbook/voice.md`: how emails sound, the apology ladder, before/after examples, their own examples.
- `playbook/templates.md`: the reply templates and which ones may be sent automatically (`auto`) vs owner drafts.
- `playbook/runbook.md`: the run's step-by-step instructions. Change with care; keep the hard rules and step order.
- `people.json`: IGNORE / HOLD people.
- `PAUSE.txt`: first line is a date (YYYY-MM-DD, skip that day) or PERMANENT. Use `scheduler.mjs pause/resume`.
