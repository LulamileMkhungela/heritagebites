# Heritage Bites website — what changed after your answers

*Response to Regomoditswe Moremedi · 27 October 2026*

Thank you — the menu, prices, hours, delivery rules and policies are now in the site. Everything below was applied to the storefront and the ordering API, and is covered by automated tests.

---

## 1. Order email alert

Noted: **Heritage Bites owner/staff** will monitor and process new order emails, and the inbox is `heritagebitesfood@gmail.com`.

Nothing for you to send now. At handover, the Google account owner does this **in the Google account itself** (never by email, WhatsApp, chat or PDF):

1. Sign in to `heritagebitesfood@gmail.com`.
2. Turn on 2-step verification.
3. Create an App Password (Security → App passwords) and keep it.
4. Paste it into the host's secret setting `HB_SMTP_PASS` (the rest of the values are in `.env.example`).

Until that step happens, every order is still saved and its alert sits queued as `waiting_config`; no email is lost, and checkout still works.

**WhatsApp notifications:** no. We are keeping the free email route. WhatsApp Business API notifications need a paid Meta Business account and approved message templates, so they are deliberately not enabled. Customers still reach you on 067 013 7587, and every receipt carries a pre-filled WhatsApp link.

## 2. Contact form → inbox

Your Formspree endpoint `https://formspree.io/f/xvkkkwve` is now wired in:

- Each submission is **sent to Formspree** (straight to the inbox that endpoint points at) and also **saved on the server** as a fallback record.
- If Formspree is unreachable, the message is still saved and the customer still sees a confirmation — an enquiry is never lost.
- The Contact page no longer says "no one is notified".

**Please confirm which address the Formspree form delivers to** — I have assumed the business inbox, `heritagebitesfood@gmail.com`, with the owner/staff responsible for replies.


### Two fixes after your review (27 October, later the same day)

- **Contact form success panel.** "Open WhatsApp" and "Send another" were sitting inline inside the panel with no gap between them, so they touched and read as one smeared control. They are now a proper centred action row with spacing, and they stack cleanly on a phone. The panel also tells the truth about what happened: **"Message sent"** only when the enquiry really reached the inbox, **"Message received"** (with a call/WhatsApp prompt) if only the local copy was kept.
- **Rest-day message.** Previously anyone visiting outside a service window saw the same line, "We are closed right now". That reads like a temporary glitch on a Wednesday. There are now four distinct states, and the site shows the right one on every page in a slim status strip under the header:
  - **Serving now** — "Serving now until 13:30."
  - **Serving day, before the window** — "Pots go on at 12:00 today — order now and you are first in the queue."
  - **Serving day, after the window** — "Today's window has closed — next up Friday."
  - **Rest day (Monday–Wednesday, weekends)** — "*Tuesday is a rest day*", with the short strip line "Rest day — we cook Thursdays and Fridays, 12:00–13:30. Your order goes in first on Thursday." The fuller wording, on the home, specials and checkout pages, is: "The pots are resting today — and honestly, so are we. We cook on Thursdays and Fridays, 12:00–13:30, and we are working towards being open every day. Your order will go in first for Thursday 12:00–13:30."

  It is deliberately warm but professional, it names the actual day, it commits to nothing more than what you told us ("working towards being open every day"), and ordering is never blocked — the order is simply queued for the next window.
- **The strip on a phone.** All three pieces on one line squeezed the sentence into a ten-character column on a 390px screen, so the strip now stacks on a phone: day and the WhatsApp link share the first row, and the message runs the full width underneath. On a laptop it is still one tidy line.

## 2b. Customer quest — a new way for customers to ask for a dish

You asked for a **Customer quest** button under the loyalty card. It is live now, in three places: directly under **View my loyalty card** on the home page, on the loyalty-card page itself, and in the footer under Order. It opens `/quest`, which runs in a fixed order:

1. **What the kitchen cooks — reference only.** Both plate menus are listed with everything already available inside them (proteins, starches, vegetable sides), read from the live catalogue so it can never drift from the real menu. It is **view only on purpose**: the cards are not links, they contain no buttons, no dish photos and no descriptions, and nothing in that block opens a dish page. It is there so a customer knows what we already cook before asking for something else.
2. **Send your quest.** The form asks for a name, a cell number we can reply to, what they would like us to cook, which day suits them (Thursday, Friday or either), how many plates, and an optional note. Submitting it says plainly that **a quest is a request, not an order** — nothing is charged, nothing is booked, and no stock or price is created.

How it reaches you: quests are saved on the server and forwarded to the same monitored inbox as the contact form, clearly labelled **"Heritage Bites meal quest — <name>"**, with the dish, the day, the plate count, the notes and the reply number in the body. A quest never looks like an order or a complaint in the inbox.

When the form is submitted, the customer sees either **"Quest sent"** (the email forward worked) or **"Quest received"** (saved locally, email did not go through), with the number to call or WhatsApp in the second case — the same honest wording as the contact form. Nothing promises a reply time.

Nothing to action from you yet. If you would rather quests land in a different inbox than contact enquiries, say so and it is a one-line change.

## 3. Live card payments (Yoco)

Yes — the account is confirmed, so the production setup is prepared. The full step-by-step is in [`docs/production-payments-yoco.md`](production-payments-yoco.md). In short:

1. In the Yoco dashboard (live account), open **Settings → Developer / API keys** and copy the **secret key** (`sk_live_…`) and the **public key** (`pk_live_…`).
2. Put both into the production host's secret settings as `YOCO_SECRET_KEY` and `YOCO_PUBLIC_KEY`. Do **not** send them to me by email, WhatsApp or in a document.
3. Redeploy/restart. Checkout then replaces the test-card form with Yoco's own secure payment window.

Why it works this way: the customer enters their card **inside Yoco's window**, not on our site. The browser hands the server only a Yoco reference, and the server confirms the amount with Yoco before an order is created. Heritage Bites never receives or stores a card number, which keeps you in the simplest PCI-DSS category. It also means a "paid" flag can never be faked in the browser.

**Cash:** cash on collection stays, as you confirmed. Cash on delivery has been removed — you confirmed collection only, and a shadow kitchen has no counter for a rider to collect cash against. Delivery orders are card only. If you later want cash on delivery, say so and it is a small change.

## 4. Delivery, collection and hours — now enforced

| Rule | Applied in the site |
| --- | --- |
| Service days | Thursdays and Fridays only |
| Service window | 12:00–13:30 for delivery **and** collection |
| Delivery areas | Rosebank and Sandton only — the API refuses an address outside them with a clear message |
| Minimum order | R100 for plated meals |
| Delivery fee | None — delivery is included in the plate price |
| Ordering outside the window | Accepted, but clearly labelled a **pre-order** for the next service window (site, receipt and order email all state the window) |
| Preparation | About 20 minutes, cooked to order |
| Delivery time | About 30 minutes inside the window |
| Collection | Standard Bank, Rosebank and Sandton — **exact point still to be confirmed** |

Still open: **the exact collection point**. Until you send it, the site says "Standard Bank, Rosebank and Sandton — exact collection point to be confirmed" and the order email reminds staff to confirm it with the customer. No street address is published.

## 5. Content sign-off — applied exactly as you sent it

Both menus are now the site's catalogue. There are no invented dishes, prices or extras.

**Traditional — R100 a plate (delivery included)**
- Starches: Pap, Mabele (sorghum), Samp, Dumpling
- Protein: Mogodu (beef tripe), Tshotlo (pounded beef), Chicken hardbody, Tlhakwana (beef trotters), Smiley (sheep head)
- Vegetable side: Braised cabbage, Spinach, Morogo, Salsa

**Contemporary — R130 a plate (delivery included)**
- Starches: Potato mash, Savoury rice, Baby potatoes, Cous cous, Garlic bread
- Protein: Chicken wings (honey soy glazed basted / chilli sriracha basted), BBQ beef short rib, Lamb stew
- Vegetable side: Braised cabbage, Spinach, Salsa, Green salad, Corn ribs, Glazed carrots

**Contact:** WhatsApp / phone 067 013 7587 · heritagebitesfood@gmail.com

**Removed**, because they were never signed off and would misrepresent the business:
- Kota, russians, magwinya, breakfast items, the invented side dishes and all drinks (drinks can be added the moment you send names and prices)
- The R18–R65 "add-ons" and portion upcharges
- Seven day-of-week promotions (Mogodu Monday … Sunday Pot) — the business trades on two days, so the "Weekly Specials" page now shows the real service week and says specials are announced on WhatsApp
- Discount codes (`HERITAGE10`, `KOTA20`, `FIRSTBITE`) and the invented customer testimonials
- Cash on delivery
- The old build-your-own-plate discount (8% off) — plates are fixed-price menus now, not a discount game

**Photos:** your six new photos are live — mogodu, tshotlo, chicken hardbody, chicken wings, BBQ short rib and lamb stew. Tlhakwana and Smiley have no photo yet, so they show a tasteful "photo coming soon" panel rather than a photo of the wrong dish. **Please send one photo each of Tlhakwana and Smiley**, ideally the same tray-and-plate style, and I will drop them in.

### Things I still need confirmed
- Drinks: names and prices (if you want them sold online).
- Any add-ons you actually sell (extra starch, extra side) and their prices.
- Whether you ever want to publish a weekly special in the site itself, as well as on WhatsApp.

## 5b. The kitchen archive — your old categories, back where they were

The categories the site carried before we narrowed the menu are back on the **Offering / Meals** page, in the same place they used to live: as **category buttons in the sticky bar, right next to Traditional Plates and Contemporary Plates** — Heritage Pots, Modern Favourites, Kasi Fast Food, Morning Heritage and Sides & Relishes. Scroll down and the matching button lights up; tap a button and the page jumps to that section.

What is different is what sits inside those sections. They are **view only**, exactly as asked:

- Each button carries a small **"soon"** marker and each section is headed **"Coming soon · view only"**.
- Every card is a **name, a photo and a "Coming soon" tag on the image**.
- There are **no prices** anywhere in them, **no dish detail pages**, and **nothing can be clicked** — the cards are not links or buttons, so a customer cannot add an archive dish to a basket even by accident; only the category button itself is clickable, and it just scrolls.
- The archive is stored separately from the sellable menu, so the API cannot price it, search it or check it out. Tests enforce that.
- Where a dish only ever had a photo of a *different* dish behind it, the card is left out rather than shown with the wrong picture. Those are commented out in `server/seed.js` with the reason beside them: Tlhakwana, Chicken Hardbody Quarter, Slap Chips, Heritage Breakfast Plate, Braised Cabbage.
- **Cold & Warm (mageu, amasi, rooibos, ginger beer) is left out entirely** — drinks were never signed off, and all four reused the same borrowed photograph. It is commented out in the code and can be switched back on the day you approve both the drinks and their photos.

At the end of the archive there is one line only — "Want one of these back on the menu? Send a customer quest." There is no explanatory paragraph: the "Coming soon · view only" heading and the tags on the photos already say it.

**What I need from you:** a yes or no on each of those five categories staying on the page as "coming soon". If you would rather keep the site to what is sellable today, say so and removing them is a one-line change.

## 6. Policies

Your Privacy Policy, Website Terms of Use, Refund Policy and Order Cancellation Policy are published **word for word** at `/policies`, together with a Delivery & Collection policy that states the confirmed rules above. All five are linked from the footer, the contact page and the checkout.

They are dated 27 October 2026 and are presented as business policy, not legal advice. A lawyer or accountant should still glance at them before you rely on them in a dispute.

## 7. Uber Eats and Mr D

Still disabled. Please send the **direct store URLs** (the link you get from "Share store" inside each app). I will not use search-result links, because they go stale and can land a customer on a competitor's listing.

---

## Storage, database and hosting — your question

Right now there is **no database and no Afrihost account** in this project. Orders, contact messages, loyalty stamps and the order-email outbox are stored as JSON files on the server, in `HB_DATA_DIR` (default `./data/runtime`, git-ignored). That is deliberate for launch: one process, no monthly database bill, and the whole dataset is readable and backup-able.

What that means in practice:

- **It needs a host with Node.js 20+ and a persistent disk.** A shared "cPanel/PHP" Afrihost package cannot run this. If you go with Afrihost, use their **Cloud/VPS** product (Node is installed on it), not shared hosting.
- **The data folder must survive redeploys.** Point `HB_DATA_DIR` at a persistent volume and take a weekly copy of it. If the folder is wiped, orders and loyalty stamps are gone.
- **One instance only.** The JSON store is not safe for several servers writing at once. At real volume (roughly more than a few hundred orders a week, or a second server for uptime) we move to a transactional database — Postgres or MySQL on the same host is fine — and I would do that work then.
- **Backups, monitoring and rate limiting** are still launch tasks; they are listed in [`docs/what-is-needed.md`](what-is-needed.md).

To hand over hosting I need: the host or account name, the domain's DNS access, a Node 20 runtime, a persistent data path, HTTPS enabled, and the ability to set the secret values from `.env.example` in the host's secret settings. I never need the Yoco keys, the Gmail App Password or any customer data sent by message — set them directly on the host.

---

## Where the site stands

Implemented and tested: menu and plate builder, basket, collection/delivery with the delivery boundary, service-window pre-orders, card (sandbox until keys are set) and cash on collection, secure receipts, loyalty lookup, customer quests, contact form to your inbox, and the five policies.

Still outstanding before you take live orders:

1. Gmail App Password set on the host (activates order emails).
2. Yoco live keys set on the host (activates real card payments).
3. Confirm the Formspree delivery address and who replies.
4. The exact collection point for Rosebank/Sandton.
5. Photos for Tlhakwana and Smiley; drinks/add-ons if you want them sold online.
6. Uber Eats / Mr D store URLs, if you use them.
7. The hosting and backup decision above.

There is still no staff console: the order email is a summary, not a queue. Whoever is on the phone should watch that inbox during the 12:00–13:30 window and confirm collection or delivery with the customer.
