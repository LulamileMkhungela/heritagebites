# WhatsApp order alerts (Formspree → WhatsApp)

Every order is posted to a Formspree form, and Formspree's WhatsApp plugin turns
that submission into a WhatsApp message on the one number the business verified.
It is the **spare** owner channel: Web Push and the email ticket stay the ones that
must work, because this one shares a metered third-party quota and cannot retry.

## What this is, and what it is not

| | |
| --- | --- |
| **Is** | an alert to the **owner's** phone, in the chat they already check, seconds after an order lands |
| **Is not** | a message to the **customer**. Formspree sends each form to one verified number and cannot reach a customer's number, test whether that number is on WhatsApp, or carry a business-initiated template |
| **Is not** | a receipt. Six lines, a glance. The full ticket is the email and the tracking page |
| **Costs** | R0 on the Free plan, up to 50 submissions a month across the whole Formspree account, then it silently stops |

Customer WhatsApp stays what the rest of the site does: a `wa.me` link with the
message already written, pressed by a person
(`server/lib/notify.js`, `src/lib/whatsapp.ts`). Automated messages *to customers*
need Meta's Cloud API, business verification, approved templates, opt-in and a card
on file — see [Why WhatsApp is free here](#why-whatsapp-is-free-here) in the README.

## 1. Name the form "Heritage Bites"

The grey first line of every WhatsApp message is the **form name**, and it cannot
be edited in the template: it is the form's own name in Formspree.

So open the form → **Settings** → rename it to something that starts with the
business name:

```
Heritage Bites orders
```

The message then opens with `New submission to Heritage Bites orders:` — the name
shows on the lock screen before anything else does. (The first line the business
controls, line 1 of the template, repeats it on purpose: a notification that says
"New submission to My Services Application" is one the kitchen will learn to
ignore.)

## 2. Send one real submission first

Formspree builds its **Insert field** buttons from the *last few submissions of
that form*. A field that has never arrived is not in the list, so the template
cannot use it yet.

```bash
npm run alert:test          # sends the sample order below to the configured form
npm run alert:test -- --print   # shows the exact payload, sends nothing
```

That posts this shape (the same one `/api/orders` posts for a real order):

| Field | Example | What it carries |
| --- | --- | --- |
| `code` | `HB-2041` | the order code the customer was given |
| `when` | `Fri 6 Nov, 13:12` | when it was placed, in Johannesburg time, never server time |
| `type` | `Delivery · Rosebank` | delivery or collection, the area, and `pre-order` outside the window |
| `items` | `3 plates: 2× Beef Stew (Pap, Chakalaka) · 1× Grilled Chicken (Savoury Rice)` | the basket on one line, options kept, clipped at 400 characters |
| `pay` | `Card (Yoco) · paid` | payment method and status |
| `total` | `R330.00` | the order total |
| `name` | `Thandi Mokoena` | customer |
| `phone` | `082 123 4567` | customer |
| `where` | `Deliver: 24 Bath Avenue, Rosebank · Notes: Extra chilli` | address, or the collection point, plus the customer's note |
| `service` | `Friday 6 November, 12:00–13:30` | the window the order is for (not in the message by default) |
| `source` | `heritagebites.co.za/checkout` | where it came from |

Two special fields ride along for the **email** notification on the same form:
`_subject` (`Heritage Bites order HB-2041 — Delivery · Rosebank`) and `_replyto`
(the customer's address, so hitting Reply answers the customer, not Formspree).

## 3. Paste this template

Open the WhatsApp action → **Edit** on the message preview, delete what is there
(especially `{{_remaining_fields}}`), and paste:

```
Heritage Bites — new order {{code}}
{{when}} · {{type}}
{{items}}
{{pay}} · Total {{total}}
{{name}} · {{phone}}
{{where}}
```

Six lines, exact. On the phone it renders as:

> **New submission to Heritage Bites orders:**
> - Heritage Bites — new order HB-2041
> - Fri 6 Nov, 13:12 · Delivery · Rosebank
> - 3 plates: 2× Beef Stew (Pap, Chakalaka) · 1× Grilled Chicken (Savoury Rice)
> - Card (Yoco) · paid · Total R330.00
> - Thandi Mokoena · 082 123 4567
> - Deliver: 24 Bath Avenue, Rosebank · Notes: Extra chilli
>
> *To view the full submission tap the button below…* **[Visit Formspree]**

Why it is ordered this way:

- **Line 1** names the business and the order code, which is what the kitchen
  repeats back to a customer.
- **Line 2** answers "is this now, or a pre-order, and where is it going?" before
  anything else.
- **Line 3** is the food — the only line that can be long, so it gets its own space.
- **Line 4** answers "has it been paid?". A card order that has not been paid yet
  reads `Card (Yoco) · to be paid`, so nobody cooks on a promise.
- **Line 5** is who to phone if something is wrong.
- **Line 6** is where the food goes. Without it the message is an alert, not an
  order.

### Shorter variants

If the phone shows only the first two lines on the lock screen, put the essentials
there instead:

```
Heritage Bites {{code}} · Total {{total}}
{{type}} · {{pay}}
{{items}}
{{name}} · {{phone}}
{{where}}
```

And a bare "something landed" ping for a second phone that only needs to know:

```
New order {{code}} · {{total}}
{{type}} · {{pay}}
```

### If you also use the plugin on the contact form

Enquiries and meal quests post to the business form (`xvkkkwve`) with a different
field set — `name`, `phone`, `email`, `subject`, `message`, `source`. One template
serves both, because both use `subject`, `name`, `phone`, `email` and `message`:

```
Heritage Bites — {{subject}}
{{name}} · {{phone}}
{{email}}
{{message}}
```

An enquiry with no email address arrives as `not supplied` on line 3 rather than as
an empty line, which is deliberate: the customer may have given only a phone
number, and a blank line looks like a broken message.

**Do not use `{{_remaining_fields}}` on either form.** It prints every field the
template did not place — which is how a message ends up listing `favicon.ico`,
`assets`, `css`, `README.md`. Those are spam submissions to the portfolio form, and
the field dumps them into the chat.

## 4. Point it at the right form

| Where | Value |
| --- | --- |
| Test / bring-up form (seeded default) | `https://formspree.io/f/xvkgqalq` |
| Business form (after testing) | `https://formspree.io/f/xvkkkwve` |
| Environment override | `HB_ORDER_WHATSAPP_FORMSPREE_URL` |
| Switch off entirely | `HB_ORDER_WHATSAPP_FORMSPREE_URL=` (empty) |

The seeded value lives in `server/seed.js` as `settings.orderWhatsappFormspreeUrl`.
Changing it there needs `SEED_VERSION` bumped so hosts with an existing store
re-seed; changing it in the environment needs only a restart. **The environment is
the better place for it** — see the next point.

### Why the endpoint is server-side only

Formspree accepts a submission from anyone who has the form ID, and this form
buzzes the owner's phone and spends one of the month's 50. So the endpoint is
stripped out of `/api/catalog` (and therefore out of the built `web/api/catalog.json`)
and is never sent to the browser. `server/integration.test.js` fails if it ever
reappears in the public catalogue. The contact endpoint is the opposite — it is
public on purpose, because the static build posts to it from the browser.

### A dedicated form is better than reusing the contact one

If order alerts go to the same form as enquiries:

- one WhatsApp plugin, one number, one message template for two different kinds of
  message;
- one 50-a-month quota shared by enquiries and orders;
- the "Visit Formspree" button opens a mixed list of enquiries and orders.

A separate form called **Heritage Bites orders**, pointed at the kitchen phone, with
the template above, is the cleaner arrangement. Reusing the contact form works, and
is what the override above does today.

## 5. What happens when it fails

Nothing the customer can see. The order is saved first, then:

1. Web Push to every enrolled kitchen device (instant, no quota);
2. an email ticket through the outbox worker, with retries;
3. this WhatsApp alert, fire-and-forget, one attempt, 8-second timeout.

A rejected submission (quota spent, wrong form ID, Formspree down) is logged as
`[whatsapp-order] …` and reported by `npm run notify:check` as
`whatsapp order alert: configured`, which never makes the site unhealthy — it is a
spare, not the safety net. Failures are not retried: by the time a retry lands, the
order has either been seen in the push or the email, or the window has closed.

It fires when the order is placed, not when a card payment clears, exactly like the
push and the ticket. A card order normally reads `to be paid` in that first
message; the Yoco webhook is what changes the order, and it does not send a second
WhatsApp alert.

## 6. Checking it is alive

```bash
npm run alert:test                      # one sample order through the real endpoint
HB_BASE=https://heritagebites.co.za npm run notify:check
```

The first costs one submission, so it is a setup tool rather than a health check.
The second is free and shows whether the channel is configured at all.
