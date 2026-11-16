# Replacements and automatic shipping

## The idea
Most "where is my order" emails at a growing D2C brand are about parcels that are stuck, cancelled by the courier, or
came back. Replying is half the job; the other half is getting a new parcel out. This automator can do both, at the
level the owner is comfortable with:

- `track`: it tells the customer the truth from live tracking; new parcels are the owner's job.
- `reship`: it also creates the replacement order in Shiprocket (same items, same warehouse, Prepaid, new order id
  `R-<order>-<ddmm>-<n>`), and the owner books it with their next batch. Good for brands that want to decide when
  they ship (slow or unreliable vendors, wallet top-ups, batching).
- `autoship`: replacements AND every new order are booked automatically by the **Shiprocket Fulfillment Automator**
  (https://github.com/prathamjr/shiprocket-fulfillment-automator) on its own schedule. Replies can honestly promise
  "it's lined up in our next dispatch", because something is actually going to dispatch it.

The two automators stay separate on purpose: the support run never books a courier or spends wallet money itself.
The Fulfillment Automator does that, with its own rules (warehouses, couriers, pickup days, wallet checks, labels).
The only link is that a replacement is a normal NEW Shiprocket order, which the Fulfillment Automator picks up like any
other.

## When a replacement is created automatically
Only these cases (`fulfillment.reshipCases`), and only after `tools/reship.mjs` re-checks everything itself:
1. **courier_cancelled**: the original shipment was cancelled before it was ever collected.
2. **pickup_cancelled**: the courier closed the pickup without collecting the parcel. Shiprocket can still show these
   as "out for pickup", but nothing will ever collect them. The tool proves it from the live scans (last scan says
   pickup cancelled, no pickup date), cancels that dead booking in Shiprocket (never in the store), then creates the
   replacement.
3. **rto_address_confirmed**: the parcel came back to the warehouse (RTO DELIVERED) and the customer replied with their
   address.

## When it refuses (and the case becomes an owner draft)
- A replacement for this order is already open, or an earlier one was delivered.
- The original is still waiting for pickup or moving: it may still arrive and the customer would get two parcels.
  (At the store this was built on, originals sometimes moved AFTER their replacement did.)
- The original is still NEW (never booked): it needs booking, not a replacement. In `autoship`, a NEW order older than
  `lookbackDays` is never picked up by the Fulfillment Automator, so it is cancelled and replaced instead.
- The items ship from two warehouses, a product is on `neverReshipProducts`, or there's no real phone number.
- Wrong, short or broken items: the owner checks the photo first, always.

## What the customer is told
- Created, not booked yet: "I've arranged for it to be sent out to you again, and I'll email you the new tracking number
  as soon as it's booked."
- Booked (it has a tracking number): courier + tracking number.
- Never "your original order was cancelled" (the guard blocks it), and never another request for a photo, address or
  order number once a replacement exists.

## Setting up autoship
1. Install and fully set up the Shiprocket Fulfillment Automator first (its own onboarding: warehouses, product
   mapping, weights, dry run, schedule). Its `.env` Shiprocket login is reused.
2. In this config: `fulfillment.mode: "autoship"`, `fulfillment.shipAutomatorDir` = its engine folder,
   `fulfillment.lookbackDays` = its `lookbackDays`.
3. `node check.mjs ship-automator` must show it installed and scheduled.
4. Product → warehouse mapping for replacements comes from the Fulfillment Automator's config, so a product it can't
   ship is never replaced either.
5. Optional `bookReshipsAfterRun: true`: one shipping pass right after the support run, so replacements go out the
   same day. It books ALL new orders, like a normal shipping run.

## Ledger
`data/reships.json` lists every replacement: order, items, warehouse, status (waiting → booked → in_transit →
delivered / rto / cancelled), tracking number. `node tools/reship.mjs sync` refreshes it (every run does this first),
`check <order>` looks one up, `report` lists the open ones.
