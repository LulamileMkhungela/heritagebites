# What I still need from Heritage Bites

*Heritage Bites website · outstanding items after the 27 October 2026 answers, updated 19 November 2026 with the extra-portion price*

Your answers are in and the site has been updated to match them. The full response — what changed, why, and how production card payments work — is in [`regomoditswe-answers-2026-10.md`](regomoditswe-answers-2026-10.md). This page is only the short list of what is still open.

## From you (content)

1. **Photos for Tlhakwana and Smiley.** Both plates currently show a "photo
   coming soon" panel. I have sourced representative photographs of both dishes
   and they are ready to drop in — but they are stock images of the *dish*, not of
   your plate. Yours will always be better: send one each, in the same
   tray-and-plate style as the others, and I will swap them. Do not send a photo
   of a different dish to fill the gap.
2. **Drinks, if you sell them online.** Names and prices. They are not on the site at the moment because no drinks were signed off.
3. **The price of a second portion of pap — a number only you have.**
   A customer can now ask for two pap, or two chakalaka, the same way they ask
   for two ginger beers: tap **+** on the row. The *first* portion of each is
   already inside the R100 / R130 plate, so it costs nothing extra; each portion
   after that is charged.

   That charge is currently **R30**, which is a **placeholder, not your price**.
   R30 is what a bowl costs on its own in Sides & Relishes, so it is at least a
   price the menu does not contradict — but if a second helping of pap costs you
   less than a whole bowl, tell me the real number and I will change it in one
   place. Say it however you like: "R20 for an extra starch", "R30 for any extra
   portion", or a different price for starch than for vegetables.

   (This replaces the old note about add-ons in general. That one was a guess at
   a whole add-on menu; this is one price, on a feature you asked for.)
4. ~~The exact collection point at Standard Bank, Rosebank and Sandton.~~ **No
   longer needed.** Collection was removed on 14 November 2026 — the kitchen is
   delivery-only — so there is no collection point to publish. The policies, the
   menu and the tracking page now all say so.
5. **Uber Eats / Mr D store links**, if you use those platforms. Direct "share store" URLs only — the buttons stay disabled until then.
6. **Confirm the contact-form inbox.** Your Formspree endpoint is wired in; please confirm it delivers to `heritagebitesfood@gmail.com` and who is responsible for replying.

## From the account owner (secrets — never send them to me)

7. *(Removed.)* A Gmail App Password is no longer needed: order email alerts were dropped, because making them work meant setting an SMTP host, a port and an app password on the server. The kitchen is alerted by Web Push instead, which needs no email account at all.
8. **Yoco live keys** (`sk_live_…` and `pk_live_…`), entered directly in the host's secret settings. This is what turns the test card form into real card payments.
9. **Hosting decision.** Tell me the host/account (for example Afrihost Cloud/VPS) once it is chosen. I need Node.js 20+, HTTPS and a persistent data folder; there is no database to buy at this stage.

## To prove the notifications actually arrive (not just "configured")

The code is finished and tested, but a notification is only real when a person
sees it. Four links in the chain need you, because they live on your accounts,
your phone and your domain — I have no way to test them from here.

1. **A place for the site to run, with HTTPS.** This is the first blocker and
   most things wait on it. The GitHub Pages link is a static preview: it can show
   the menu, but it cannot take an order or wake a phone. Anything
   with Node.js 20+, HTTPS and a persistent folder works — Render, Railway and
   Fly all have free tiers, and Afrihost Cloud/VPS is fine too. Tell me which one
   you want and I will prepare the exact settings for it.

2. **A phone or tablet in the kitchen.** No email password is needed any more —
   that channel was removed. Instead, open `/alerts` on the kitchen device, paste
   the owner key once, and allow notifications: every order then buzzes that
   device. Tell me **who holds that device during the Thursday/Friday window**, and
   whether a second device (the counter tablet) should be enrolled too.

3. **Push keys, created on the host.** Run `npm run push:keys` there once and put
   the two values in as `HB_VAPID_PUBLIC_KEY` and `HB_VAPID_PRIVATE_KEY`. Then
   choose a long password for `HB_OWNER_PUSH_KEY` — that is what stops a stranger
   enrolling their own phone. I need to be told they are set, never what they are.

4. **Your phones.** Which phone(s) should buzz, and who holds them. For each:
   open `/alerts` on the site, paste the owner key, tap allow. On **iPhone** this
   only works on iOS 16.4 or newer, in Safari, and only **after** Share → **Add
   to Home Screen** — without that step Safari will never deliver a push, and it
   gives no error to say so. Android and desktop work directly.

Then I will place a real R100 test order and you confirm three things with your
own eyes:

- the **kitchen ticket** email is in the inbox;
- the **alert pops up on the phone** with the site closed;
- the **customer receipt** arrives at a second address you control (use your own
  Gmail as the customer — do not use a real customer's address for a test).

Two decisions while you are there:

5. **Where customer receipts are sent from.** Simplest: the same Gmail account,
   free, no setup — but mail sent from `gmail.com` whose links point at
   `heritagebites.co.za` looks like spoofing, so some receipts will land in spam.
   Better: Brevo's free plan (300 emails a day, no card) with
   `heritagebites.co.za` verified, which needs someone with access to the domain's
   DNS to add SPF and DKIM records once. Tell me who controls that DNS.

6. **What should trigger an alert.** Today it is one alert per order, at the
   moment it is placed. Nobody is told when an order is accepted, ready, or
   cancelled — there is no staff screen to change a status, so there is nothing
   to notify about yet. If you want "your food is ready" messages, that is a small
   feature to commission, not a setting to switch on.

What I have already proven without you: orders queue when email is missing and do
not block checkout, retries back off and give up after five attempts, broken push
keys are reported loudly instead of pretending to work, and the health check exits
with an error when any channel is broken. What it cannot prove is delivery — only
your inbox and your phone can.

## What I will do once those are in place

- Load the two photos and publish them.
- Add drinks and any confirmed add-ons to the menu with their prices.
- Switch live card payments on, and run a real R100 test order plus a refund.
- Enrol your phone for order alerts, place a live test order, and confirm with you
  that the push and the WhatsApp order both arrived.
- ~~Publish the exact collection point.~~ Done differently: collection is gone.
- Enable the delivery-partner buttons when real store links exist.
