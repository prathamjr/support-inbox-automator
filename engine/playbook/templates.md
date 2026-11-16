# Reply templates

Start every reply from the matching template, then adapt it to this customer (case review). Keep each template's facts, promises and limits; change the wording so it answers what this person actually asked. Fill every {placeholder} with real values (the guard blocks leftover placeholders). Every email ends with the sign-off exactly as written.

## Template guide
`auto` = may be {{#SEND}}sent automatically{{/SEND}}{{^SEND}}a "{{READY_NAME}}" draft{{/SEND}} when the case review raises nothing. `owner` = always a "{{READFIRST_NAME}}" draft.

| Code | What it tells the customer | When | Action |
|---|---|---|---|
| `not_shipped_yet` | "It hasn't left us yet, that's our delay; it's in the next dispatch and you'll get tracking." | Paid, never booked{{#AUTOSHIP}}, created within the last {{LOOKBACK}} days (the shipping automator books it){{/AUTOSHIP}} | {{#AUTOSHIP}}auto{{/AUTOSHIP}}{{^AUTOSHIP}}owner (only the owner knows when it ships){{/AUTOSHIP}} |
| `waiting_pickup` | "It's booked (tracking X) but the courier hasn't collected it yet; I'm chasing it and I'll email when it moves." | Booked, pickup still open | auto (3rd+ contact with nothing new: owner) |
| `pickup_cancelled_resend` | "The courier's pickup was cancelled without collecting it, so I've arranged a new parcel; tracking as soon as it's booked." | Last scan says pickup cancelled{{#RESHIP}}, replacement arranged (step 6){{/RESHIP}} | {{#RESHIP}}auto{{/RESHIP}}{{^RESHIP}}owner{{/RESHIP}} |
| `reship_arranged` | "I've arranged for it to be sent out again; tracking as soon as it's booked." | Replacement arranged, no tracking yet | {{#RESHIP}}auto{{/RESHIP}}{{^RESHIP}}owner{{/RESHIP}} |
| `reship_booked` | "I've sent it out again with {courier}, tracking {awb}." | Replacement has a tracking number | auto |
| `in_transit` | "It's moving: last scanned at {place} on {date}; here's the tracking link." | Picked up and moving | auto |
| `delivered_checkin` | "It was delivered on {date}; hope you're enjoying it, reply if anything's off." | Delivered, general question | auto |
| `delivered_not_received` | "The courier marked it delivered on {date}; could a neighbour or security have it? I'm flagging it internally." | Customer says it never arrived | owner |
| `cancel_request` | Per the cancellation policy in policies.md. | Cancel request before delivery | per policy |
| `photo_request` | "Sorry it arrived short / wrong / broken. Could you send a photo (and the outer label)?" | Wrong, short or broken, no photo yet | auto |
| `photo_received` | "Thanks for sending that, I've passed it on." | Photo or video received (you can't open it) | owner |
| `rto_address_request` | "Your parcel came back to us; please confirm your full address, landmark and pincode." | Parcel returned, no address yet | auto |
| `presale` | Answers the question from the product facts in policies.md. | Question before buying | auto (unsure about a fact: owner) |
| `crossref` | "Sorry for the slow reply here. As I mentioned in my other email, ..." | Already answered in another thread | auto |
| `custom` | Written from the case review when nothing fits (all rules still apply). | Rare; say why in `what` | owner |

There is no separate "broken promise" template: whichever template applies opens with an honest acknowledgement ("I'm sorry, I said on {date} that ... and that hasn't happened"), and it is always an owner draft.

## Templates

**not_shipped_yet**
Hi {first_name},

I checked your order #{order} myself, and I'm sorry: it hasn't left us yet. That's our delay, not anything on your side. It's lined up in our next dispatch, and I'll send you the tracking number as soon as the courier has it.

{{SIGN_OFF}}

**waiting_pickup** (only when today's live check shows the pickup is still open)
Hi {first_name},

I'm sorry for the wait on order #{order}. I checked it just now: the pickup was booked on {booked_date}, but the courier hasn't collected the parcel yet, which is why the tracking ({awb}) hasn't moved. I'm taking this up with the dispatch team, and I'll email you the moment it's collected.

{{SIGN_OFF}}

If we already wrote about this, open by acknowledging that email's date and say honestly what has or hasn't changed since, in different words. Never mention a replacement, rebooking or "a different courier" while the pickup is still open: the original may still be collected and they'd get two parcels.

**pickup_cancelled_resend**
Hi {first_name},

I'm sorry for how long this has taken{, and that my earlier emails didn't give you a real fix}. I checked order #{order} again: the courier's pickup booked on {booked_date} was cancelled on {cancelled_date} without the parcel ever being collected, so that booking was never going to reach you. I've arranged for a new parcel to be sent out to you, and I'll email you the new tracking number as soon as it's booked.

{{SIGN_OFF}}

(Keep the bracketed clause only if we wrote to them about this before. Never guess who cancelled.)

**reship_arranged**
Hi {first_name},

I checked order #{order} myself, and I'm sorry it's taken this long to reach you. I've arranged for it to be sent out to you again, and I'll email you the new tracking number as soon as it's booked.

{{SIGN_OFF}}

**reship_booked**
Hi {first_name},

I checked order #{order} myself, and I'm sorry it's taken this long to reach you. I've sent it out to you again: it's with {courier}, tracking number {awb}. The tracking page can take up to a day to show its first update.

{{SIGN_OFF}}

**in_transit**
Hi {first_name},

Good news on order #{order}: it's on its way. It was last scanned at {place} on {date}, and you can follow it here: {tracking_url}

{{SIGN_OFF}}

(Never give a delivery date. Couriers miss them and then the email becomes a broken promise.)

**delivered_not_received**
Hi {first_name},

The courier has marked order #{order} as delivered on {delivered_date}, and I'm sorry it hasn't reached you. Could you check whether a neighbour, a family member or your building security collected it for you? Meanwhile, I'm flagging this internally so we can look into the delivery.

{{SIGN_OFF}}

**photo_request** (short / wrong / broken, no photo yet)
Hi {first_name},

I'm sorry {your order #{order} arrived short / it sounds like you received the wrong product for order #{order} / the {product} from order #{order} isn't working as it should}. Could you reply with {a quick photo of what came in the box, and the outer label if you still have it / a short video or photo showing the problem}? As soon as I have it, I'll get this sorted.

{{SIGN_OFF}}

**photo_received** (always an owner draft)
Hi {first_name},

Thanks for sending that, it's really helpful. I've passed it on so {the missing units / the correct product / a replacement} can be sent to you, and I'll email you the tracking number as soon as it's on its way.

{{SIGN_OFF}}

**rto_address_request**
Hi {first_name},

Your order #{order} came back to us without reaching you, and I'm sorry about that. So the next one gets through, could you confirm your full delivery address, including a landmark and the pincode, and your phone number? As soon as you reply, I'll {{#RESHIP}}send it out again{{/RESHIP}}{{^RESHIP}}pass it on so it can be sent out again{{/RESHIP}} and share the tracking number.

{{SIGN_OFF}}

**crossref**
Hi {first_name},

Sorry for the slow reply here. As I mentioned in my other email, {repeat the key facts: order number, courier and tracking, what was arranged}.

{{SIGN_OFF}}
