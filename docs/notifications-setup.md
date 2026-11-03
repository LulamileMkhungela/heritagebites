# Turning notifications on — the owner's checklist

Everything the shop needs to hear about an order, and what the customer gets,
is switched on by one file: **`notifications.env.example`**, filled in and saved
as **`.env`** next to `package.json`.

Nothing here costs money. There is no SMS bundle, no messaging app, no card.

| Who | What they get | Which part of the file turns it on |
| --- | --- | --- |
| Kitchen | An email per order, with every plate, the total and the customer's details | Part 1 |
| Kitchen | A push notification on the phone/tablet within seconds, even with the site closed | Part 3 |
| Customer | An email receipt with a private link to their order page | Part 1 (on by default) |
| Customer | Optional push updates, after they tap "Alert me" on their order | Part 3 |
| Either | A one-tap "send this order on WhatsApp" link | already on; no setup |

---

## The five-minute version

```bash
cp notifications.env.example .env      # then open .env and fill in the blanks
npm run push:keys                      # prints the four push values; paste three of them
npm run check:notifications            # logs in, sends you a test, lists what is missing
npm run start                          # restart the site
```

Then open **`/alerts`** on the kitchen phone, paste `HB_OWNER_PUSH_KEY`, and
press the button. Repeat on a second device if you want a backup.

If `npm run check:notifications` says **"✓ The details work"**, the kitchen will
be told about the next order. That is the sentence to wait for — not "it saved".

---

## The one setting that must not be guessed

`HB_PUBLIC_URL` is the address of this website. The customer's receipt contains a
private link to their own order page, built from it.

If it is left blank the code falls back to `https://heritagebites.co.za`, and
**that address serves a different restaurant in Pretoria.** A customer clicking
the link in their receipt would arrive on somebody else's website, where their
private token means nothing.

So the site says so out loud at startup, `npm run check:notifications` refuses to
pass, and `/api/health` reports `originIsPlaceholder: true`:

```
[notifications] HB_PUBLIC_URL is not set, so tracking links in customer receipts
fall back to https://heritagebites.co.za — that address serves a DIFFERENT
restaurant...
```

---

## Why there are two ways to check

| Command | What it proves |
| --- | --- |
| `npm run check:notifications` | The **settings** are right: it logs in to the mail account, sends a test ticket, and can send a test receipt. Run this after editing `.env`, before starting the site. |
| `npm run notify:check` | The **running site** is healthy: it reads `GET /api/health` for the live view — configured channels, enrolled devices, and any job stuck or failed. Run this on a schedule. |

A health endpoint can only report what the process *read*. It will say "owner
email: configured" while the App Password was revoked last Tuesday, because
nothing has tried to log in. The setup check closes that gap by making the login
the test.

```bash
npm run check:notifications                    # kitchen only
npm run check:notifications -- --to me@x.com   # also prove customer receipts
npm run check:notifications -- --dry-run       # report, send nothing
HB_BASE=https://<the site> npm run notify:check # the live site's own view
```

Exit codes for both: `0` good, `1` something must be fixed, `2` (setup check) the
mail account refused the login. That makes either one safe to wire to an uptime
monitor.

---

## What each failure looks like, and what it means

The point of this page is that **nothing crashes when notifications are wrong**.
Orders are still saved; the kitchen simply never hears about them. So each failure
has a sentence that names the cause:

| What you see | What it means | Fix |
| --- | --- | --- |
| `535 Username and Password not accepted` | Gmail App Password revoked, 2-Step Verification off, or a normal password pasted | Create a fresh App Password |
| `The kitchen cannot be told about an order` | No SMTP account **and** no push keys | Fill in Part 1, or Part 3 |
| `HB_VAPID_* are set but HB_OWNER_PUSH_KEY is missing` | Keys generated, but nothing can enrol a phone | Generate an owner key with `npm run push:keys` |
| `no kitchen device has enrolled` | Push works, but no phone has been set up | Open `/alerts` on the phone and enrol |
| `Push is configured but no kitchen device has enrolled` (from `notify:check`) | Same, seen from the live site | Same |
| `HB_PUBLIC_URL ... DIFFERENT restaurant` | Receipt links point at another business | Set your own address |
| `HB_PUSH_DRY_RUN=true` | Pushes are logged, not delivered | Remove it from the live `.env` |
| `N notification job(s) gave up after five attempts` | The provider rejected the mail repeatedly | Check the account, then re-run a check |

---

## Gmail, exactly

1. Sign in as the shop's Gmail address.
2. Google Account → Security → **2-Step Verification: on**.
3. Security → **App passwords** → create one named "Heritage Bites website".
4. Google shows 16 letters in four groups. Paste them into `HB_SMTP_PASS`;
   spaces are removed automatically, but pasting them clean avoids doubt.

A normal account password will never work, and a changed Google password cancels
App Passwords — that is the single most common cause of a silent kitchen.

---

## Spam, honestly

Customer receipts sent from the shop's own Gmail account, with links pointing at
the shop's own domain, look like spoofed mail to a spam filter. Some will be
filtered. That is why Part 4 exists: a free transactional provider with the
sending domain verified (Brevo's free plan is 300 emails a day and needs no card)
sends the receipts instead, while kitchen tickets keep using Gmail. The setup
check reports which of the two modes is in use, so this is never a mystery.

---

## What is not automatic, and never claimed to be

- **WhatsApp.** The saved order carries a pre-filled `wa.me` link, so a person
  presses send. Automated WhatsApp needs Meta's Cloud API, business verification
  and per-message charges, which this build does not use.
- **iPhone push.** Safari delivers push only after the site is added to the Home
  Screen (iOS 16.4+). Android and desktop work immediately. The pages say this
  rather than failing silently.
- **Customer push.** Nobody is pushed to without tapping "Alert me"; a customer
  who ignores it still gets the email receipt.
- **Order status changes.** There is no staff console, so nothing advances an
  order automatically beyond cancellation. The tracking page is the live state.
