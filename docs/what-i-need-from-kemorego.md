# What I still need from Heritage Bites

*Heritage Bites website · outstanding items after the 27 October 2026 answers*

Your answers are in and the site has been updated to match them. The full response — what changed, why, and how production card payments work — is in [`regomoditswe-answers-2026-10.md`](regomoditswe-answers-2026-10.md). This page is only the short list of what is still open.

## From you (content)

1. **Photos for Tlhakwana and Smiley.** Both plates currently show a "photo coming soon" panel. Please send one photo each, in the same tray-and-plate style as the others. Do not send a photo of a different dish to fill the gap.
2. **Drinks, if you sell them online.** Names and prices. They are not on the site at the moment because no drinks were signed off.
3. **Add-ons, if they exist.** For example an extra starch or an extra side, with the price. The old R18–R65 add-ons were invented, so they were removed rather than guessed.
4. **The exact collection point** at Standard Bank, Rosebank and Sandton. Until then the site says the point is confirmed by WhatsApp.
5. **Uber Eats / Mr D store links**, if you use those platforms. Direct "share store" URLs only — the buttons stay disabled until then.
6. **Confirm the contact-form inbox.** Your Formspree endpoint is wired in; please confirm it delivers to `heritagebitesfood@gmail.com` and who is responsible for replying.

## From the account owner (secrets — never send them to me)

7. **Gmail App Password** for `heritagebitesfood@gmail.com`, entered directly in the host's secret settings as `HB_SMTP_PASS`. This is what makes order emails start sending.
8. **Yoco live keys** (`sk_live_…` and `pk_live_…`), entered directly in the host's secret settings. This is what turns the test card form into real card payments.
9. **Hosting decision.** Tell me the host/account (for example Afrihost Cloud/VPS) once it is chosen. I need Node.js 20+, HTTPS and a persistent data folder; there is no database to buy at this stage.

## What I will do once those are in place

- Load the two photos and publish them.
- Add drinks and any confirmed add-ons to the menu with their prices.
- Switch order emails and live card payments on, and run a real R100 test order plus a refund.
- Publish the exact collection point.
- Enable the delivery-partner buttons when real store links exist.
