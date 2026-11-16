# Support Inbox Automator

**Your support inbox, answered every afternoon. In your voice, not a bot's.**

Every day at the time you pick, it opens your support inbox, finds every customer still waiting (even the ones hiding in
Promotions, even the ones someone opened and forgot), works out who they are and what they ordered, checks where their
parcel really is right now, and writes the reply a good support person would write after actually checking:

```
Hi Priya,

I'm really sorry you've had to write in again about order #4821. I checked it just now: the courier's
pickup booked on 12 Nov was cancelled without the parcel ever being collected, so that booking was never
going to reach you. I've arranged for a new parcel to be sent out to you, and I'll email you the new
tracking number as soon as it's booked.

Take care,
My Store Support
```

Easy ones are answered for you. Hard ones (angry customers, legal threats, damaged items with photos, refund fights)
wait as drafts for you. Then your team gets one message:

```
📬 My Store support: Mon 16 Nov

14 replied · 6 drafts (4 need you) · 20 customers were waiting
🔁 2 replacement parcels arranged

Need you (drafts labelled "Read first")
• #4790 Anil K.: consumer court threat
• #4802 Meera S.: sent a photo of a damaged product
• #4811 Rohan P.: 4th email, still stuck at pickup, needs a decision
• #4830 Kavya D.: wants a refund

Replied (14)
• #4821 Priya S.: courier cancelled the pickup; told her a new parcel is arranged, tracking to follow
• #4833 Arjun M.: where is my order; it was scanned in Pune this morning, sent the tracking link
…
```

It's a skill for **Claude Code**. Claude sets it up with you step by step, in plain English, no coding. Then it keeps
learning your rules: tell it *"never mention exchanges"* or *"always ask for a photo of the label"* and that's how
every reply works from the next run.

---

## Why the replies don't sound automated

- **It checks before it writes.** Live courier tracking, the customer's whole email history, every order under every
  email they've used. Replies quote real dates, real tracking, real scans.
- **First person, specific, short.** "I checked your order myself", their name, their order, what they actually asked.
- **The apology grows when they've had to chase**, but the facts never bend: no made-up dates, no promises you can't keep.
- **It never repeats itself.** An email that's mostly the same as one the customer already got is blocked. Something
  new to say, or it goes to you.
- **No stock phrases, no em dashes.** "We apologise for any inconvenience", "rest assured" and friends are blocked.

## What it will never do

- **Promise what you don't allow.** Refunds, store credit, phone calls, delivery dates: blocked unless your policy says so.
- **Email the wrong person.** Every email passes a guard (right customer, right thread, right recipient) and a hook
  physically stops Gmail if the guard didn't approve that exact email.
- **Email the same customer twice in a day**, or reply to a contact form's robot address instead of the customer.
- **Tell a customer "we can't find your order".** Twice that turned out to be an order under another email. It
  searches everything, and if it still finds nothing, it asks you.
- **Answer legal notices** or people you've put on hold.
- **Go live untested.** Setup ends with a dry run (nothing changes), then drafts only. Auto-send is switched on only
  when you say so.

## Optional: replacement parcels and automatic shipping

Using Shiprocket? When a courier cancels a pickup or a parcel comes back, it can arrange the replacement for you.
Pair it with the free [**Shiprocket Fulfillment Automator**](https://github.com/prathamjr/shiprocket-fulfillment-automator)
and those replacements, and every new order, get booked automatically too. Prefer to decide when you ship? Keep
replacements manual, or off. You choose during setup.

## What you need

- A support inbox on **Gmail or Google Workspace**
- A **Shopify** store (Shiprocket optional)
- **Claude Code** on a Pro or Max plan ([get it here](https://claude.com/claude-code)). Runs use your plan's usage;
  you set a cap.
- A Mac or Windows computer that's on at the time you choose (it runs on your computer; your data stays with you)
- 30-60 minutes for setup

## Install (one line)

Open Claude Code and paste:

```
Install the skill from https://github.com/prathamjr/support-inbox-automator into ~/.claude/skills and set up my Support Inbox Automator
```

Or in a terminal:

```bash
git clone https://github.com/prathamjr/support-inbox-automator ~/.claude/skills/support-inbox-automator
```

then open Claude Code and say **"set up my Support Inbox Automator"**.

## How setup goes

1. Install the engine on your computer
2. Make sure Claude Code can run on its own (for the daily schedule)
3. Connect Gmail and Shopify to Claude (two clicks each, no API keys)
4. Two Gmail labels: **Ready to send** and **Read first**
5. Shipping: tracking only, replacements, or fully automatic with the Fulfillment Automator
6. **Your policies**, in your words: refunds, cancellations, damaged items, what it may and may not promise
7. **Your voice**: sign-off, words you hate, a few replies you were proud of
8. People to never reply to, contact forms, how far back to look
9. Your daily message: Slack, Google Chat, Discord or Telegram
10. **Dry run:** read exactly what it *would* have sent. Nothing changes.
11. First real run, drafts only: you hit send on the ones you like
12. Schedule it

## Built from a real store

This came out of a D2C brand's support inbox during a courier crisis: hundreds of "where is my order" emails, couriers
not collecting parcels, customers writing from three different addresses. Every rule in it exists because something
went wrong once: replies to contact forms that never reached the customer, the same update sent four times, a
customer told "we can't find your order" who had ordered with another email, a reply promising to email "the moment
it's collected" about a parcel nothing was ever going to collect. You get the version with those lessons built in.

## Files

```
SKILL.md                     the onboarding Claude follows
engine/run.mjs               the daily run (--dry-run to preview, --now to run now)
engine/guard.mjs             checks every email before it can go out
engine/hooks/                stop Gmail unless the guard approved that exact email
engine/playbook/             the run's instructions, your policies, voice and templates
engine/tools/                live Shiprocket lookups and replacement parcels
engine/check.mjs             setup checks (Claude, Gmail, Shopify, Shiprocket, config, guard)
engine/scripts/scheduler.mjs turns the daily run on/off (Mac, Windows, Linux)
references/                  connectors, settings, shipping add-on, notifications, troubleshooting
```

Not affiliated with Google, Shopify, Shiprocket or Anthropic. It sends real emails to real customers: start with the
dry run and drafts.

MIT licensed. Built by Pratham Junius ([@prathamjr](https://github.com/prathamjr)).
