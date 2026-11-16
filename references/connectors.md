# Connecting Gmail and Shopify

The daily run is Claude Code started by the computer's scheduler, with nobody at the keyboard (`claude -p`). It uses
the **claude.ai connectors** attached to the Claude account Claude Code is logged into. There is no Google Cloud
project, API key or OAuth app to create.

## Gmail
1. claude.ai (website) → profile → **Settings → Connectors** → **Gmail** → Connect.
2. Google asks which account: choose **the mailbox that receives support mail**. If support@ is a Google Group or an
   alias that lands in someone's inbox, connect that person's mailbox and add the support address and any team
   addresses to `ourAddresses` in config.json.
3. Allow the permissions Google shows (read, draft, send, labels). The run uses: `search_threads`, `get_thread`,
   `list_drafts`, `get_draft`, `create_draft`, `delete_draft`, `list_labels`, `label_thread`, `unlabel_thread`, and
   `reply` only when auto-send is on. `send_message` and `update_draft` are always blocked by a hook.
4. `node check.mjs gmail`: it starts a headless Claude, lists the labels and prints their ids.

## Shopify
claude.ai → Settings → Connectors → **Shopify** → Connect → sign in to the store. The run only reads: `list-orders`,
`get-order`, `list-customers`, `graphql_query` (real phone numbers for replacements, orders by phone or name).
`node check.mjs shopify` prints the store name.

## Things that go wrong
- **Check says the connector is missing:** Claude Code on this computer is logged into a different Claude account
  than the one the connector was added to. Run `claude` in a terminal, `/status` shows the account; or log out and in.
- **Claude Code login expired:** the daily message says so. Open Claude Code on this computer once; it refreshes.
- **Connector names differ:** if their account exposes Gmail/Shopify tools under another prefix, set
  `connectors.gmail` / `connectors.shopify` in config.json (the prefix before the tool name, e.g. `mcp__claude_ai_Gmail__`).
- **Two Shopify stores on one account:** the connector works on one store at a time. Connect the support store.
- **Replies bounce (mailer-daemon):** the sending domain has no SPF/DMARC record. Their domain/DNS provider adds an SPF
  TXT record that includes Google, and a DMARC record. Until then some providers reject the replies.
