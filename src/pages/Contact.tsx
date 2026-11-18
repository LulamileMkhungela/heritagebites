import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { api, ApiError, DEFAULT_INBOX_ENDPOINT, STATIC_PREVIEW } from '../lib/api';
import { isValidCellNumber, isValidEmail } from '../lib/format';
import { Button, Field, HeritageBand, Reveal, SectionLabel, inputCls } from '../components/ui';
import { usePageSeo } from '../lib/seo';
import { waHref, GENERAL_ENQUIRY } from '../lib/whatsapp';
import { asset } from '../lib/assets';
import { DELIVERY_ZONES } from '../../shared/address.js';

const SUBJECTS = ['General enquiry', 'Catering quote', 'Feedback', 'Something went wrong with my order', 'Work with us'];

export default function Contact() {
  usePageSeo('/contact');
  const catalog = useCatalog((s) => s.data);
  const s = catalog?.settings;
  /* "Open chat" used to open an empty WhatsApp box. It now opens with the first
     line already typed, so the customer knows what to say next. */
  const waLink = waHref(s?.whatsapp, GENERAL_ENQUIRY);
  /*
   * Can this build actually deliver an enquiry?
   *
   * On the live site the server forwards to the inbox and reports
   * `contact.inboxConfigured`. On the static build there is no server, so the
   * browser posts to the same Formspree endpoint directly — which means the
   * answer is the endpoint being present, not the server's flag (the exported
   * snapshot always reports false there).
   */
  /*
   * The static build always has somewhere to send an enquiry: the endpoint is
   * either declared by the catalogue or compiled into the bundle. Only the live
   * server can genuinely lack an inbox, and it says so itself.
   */
  const inboxReady = STATIC_PREVIEW
    ? Boolean(s?.contactFormspreeUrl) || Boolean(DEFAULT_INBOX_ENDPOINT)
    : Boolean(catalog?.contact?.inboxConfigured);

  const [form, setForm] = useState({ name: '', phone: '', email: '', subject: SUBJECTS[0], message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [delivered, setDelivered] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: '' }));
  };

  /**
   * Everything that has to be true before an enquiry is allowed out.
   *
   * The owner's rule: a name, a message, and one way to reply — an email
   * address or a cell number. Nothing is sent (and nothing is posted to the
   * inbox) until all three are there and the contact details look real; an
   * enquiry the kitchen cannot answer is worse than no enquiry at all.
   */
  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Please tell us your name.';
    if (!form.message.trim()) next.message = 'Please add a message.';

    const email = form.email.trim();
    const phone = form.phone.trim();
    if (!email && !phone) {
      next.email = 'Add an email address or a cell number so we can reply.';
      next.phone = 'Add an email address or a cell number so we can reply.';
    } else {
      if (email && !isValidEmail(email)) next.email = 'That email does not look right.';
      if (phone && !isValidCellNumber(phone)) next.phone = 'Use a South African cell number, e.g. 082 123 4567.';
    }
    return next;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;

    setState('sending');
    try {
      const result = await api.contact(form, s?.contactFormspreeUrl);
      setDelivered(result.delivered);
      setState('sent');
      setForm({ name: '', phone: '', email: '', subject: SUBJECTS[0], message: '' });
    } catch (err) {
      setState('idle');
      setErrors({ message: err instanceof ApiError ? err.errors[0] : 'Something went wrong. Please try again.' });
    }
  };

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/mabele.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>Contact</SectionLabel>
          <h1 className="font-display text-5xl font-semibold md:text-6xl">Talk to a human about your order</h1>
          <p className="mt-4 max-w-2xl text-bone/70">
            Questions about the menu, catering for an event, or an order that went sideways — phone is fastest, WhatsApp is
            close behind. Enquiries sent here reach our monitored inbox.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          {/* Business info */}
          <div className="space-y-4">
            {/*
              One card per way to reach the kitchen, each with the mark a
              customer already associates with it. The owner's report was
              literally "i dont see social icons" — the page listed three ways
              to get in touch as plain bordered rectangles, which read as a
              price list rather than as three buttons.
            */}
            {[
              {
                t: 'WhatsApp',
                v: 'Fastest way to order or ask a question',
                href: waLink,
                cta: 'Open chat',
                external: true,
                path: 'M12 2a9.6 9.6 0 0 0-8.2 14.6L2 22l5.5-1.7A9.6 9.6 0 1 0 12 2Zm0 1.9a7.7 7.7 0 1 1-3.9 14.4l-.5-.3-3 .9.9-2.9-.3-.5A7.7 7.7 0 0 1 12 3.9Z',
              },
              {
                t: 'Phone',
                v: s?.phoneDisplay ?? '+27 67 013 7587',
                href: `tel:${s?.phone ?? '+27670137587'}`,
                cta: 'Call now',
                external: false,
                path: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
              },
              {
                t: 'Email',
                v: s?.email ?? 'heritagebitesfood@gmail.com',
                href: `mailto:${s?.email ?? 'heritagebitesfood@gmail.com'}`,
                cta: 'Write to us',
                external: false,
                path: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm.6 2 7.4 5.4L19.4 7',
              },
            ].map((row) => (
              <a
                key={row.t}
                href={row.href}
                target={row.external ? '_blank' : undefined}
                rel={row.external ? 'noreferrer' : undefined}
                className="group flex items-start gap-4 rounded-3xl border-2 border-theme/10 bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-theme/30"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ochre/20 text-accent">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={row.path} />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs uppercase tracking-[0.2em] text-accent">{row.t}</span>
                  <span className="mt-1 block break-words text-[15px] font-semibold">{row.v}</span>
                  <span className="mt-1 block text-[12px] text-theme-soft">{row.cta}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-1 h-5 w-5 shrink-0 text-theme/25 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            ))}

            {/* The same three profiles the footer carries, on the page a
                customer opens when they want to find us somewhere. */}
            <div className="rounded-3xl border-2 border-theme/10 bg-surface p-5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Follow us</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  {
                    label: 'Instagram',
                    path: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM17.5 6.5h.01',
                  },
                  {
                    label: 'Facebook',
                    path: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z',
                  },
                  {
                    label: 'TikTok',
                    path: 'M15 3v10a4.5 4.5 0 1 1-4.5-4.5M15 3c.3 2.7 2 4.4 5 4.8',
                  },
                ].map((social) => (
                  <a
                    key={social.label}
                    href="#"
                    aria-label={social.label}
                    className="grid h-11 w-11 place-items-center rounded-full border-2 border-theme/15 text-theme-soft transition-colors hover:border-ochre hover:text-accent"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={social.path} />
                    </svg>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-theme-muted">
                Profiles are being set up — the accounts above open as soon as they are live.
              </p>
            </div>

            <div className="rounded-3xl border-2 border-theme/10 bg-surface p-5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Opening hours</p>
              {/*
                Only the days the kitchen actually cooks. Five greyed "Closed"
                rows pushed the two real windows off the card and made a
                two-day service look like a business that is mostly shut. The
                footer has always done it this way, so the two now agree.
              */}
              <ul className="mt-3 space-y-1.5 text-sm">
                {(s?.hours ?? []).filter((h) => !h.closed).map((h) => {
                  const isToday = h.day === new Date().getDay();
                  return (
                    <li key={h.day} className={`flex justify-between gap-4 ${isToday ? 'font-bold' : 'text-theme-soft'}`}>
                      <span>{h.label}{isToday && <span className="ml-2 rounded-full bg-ochre px-2 py-0.5 text-xs uppercase text-[#001938]">Today</span>}</span>
                      <span className="font-mono text-xs">{h.open} – {h.close}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 border-t border-theme/10 pt-3 text-xs leading-relaxed text-theme-soft">
                Every order is delivered. The kitchen confirms the time on WhatsApp when your order is placed.
              </p>
            </div>

            <div className="rounded-3xl border-2 border-theme/10 bg-surface p-5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Delivery</p>
              <p className="mt-2 text-sm text-theme-soft">
                Thursdays and Fridays, and you can book any cooking day ahead. Delivery is included in{' '}
                {s?.deliveryAreas?.join(' and ') ?? 'Sandton and Rosebank'}; elsewhere a fee applies, and we deliver up to{' '}
                {s?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm} km from the kitchen. The minimum order is R{Number(s?.minDeliveryOrder ?? 100)}.
              </p>
              <Link to="/policies" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">
                Delivery, refund and cancellation policies
              </Link>
            </div>
          </div>

          {/* Form */}
          <Reveal>
            <div className="rounded-[2rem] border-2 border-theme/10 bg-surface p-6 md:p-8">
              <h2 className="font-display text-3xl font-semibold">Send us a message</h2>
              <p className="mt-2 text-sm text-theme-soft">
                {inboxReady
                  ? 'Your message goes straight to the Heritage Bites inbox, and we reply by phone, WhatsApp or email.'
                  : 'This form saves your message. If you need an answer today, call or WhatsApp us directly.'}
              </p>

              {state === 'sent' ? (
                <div className="mt-8 rounded-3xl border-2 border-ochre bg-ochre/10 p-8 text-center">
                  <p className="text-3xl">✓</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold">
                    {delivered ? 'Message sent' : 'Message received'}
                  </h3>
                  <p className="mt-2 text-sm text-theme-soft">
                    {delivered
                      ? 'Thank you — it is in our inbox and we will come back to you. If it is about an order in the next service window, please call or WhatsApp us as well.'
                      : STATIC_PREVIEW
                        ? 'Your message reached the site, but it could not be delivered to our inbox. Please call or WhatsApp us so it is not missed.'
                        : 'Your message is saved with us, but our email notification did not go through just now. Please call or WhatsApp us if you need an answer today.'}
                  </p>
                  {/*
                    These two actions used to sit inline next to each other — an
                    inline-block link and an inline-flex button on one line, with
                    no gap, so "Open WhatsApp" and "Send another" touched and
                    read as one smeared control. A wrapping flex row with an
                    explicit gap keeps them apart, centred, and still stacks
                    cleanly on a narrow phone.
                  */}
                  <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-full border-2 border-theme bg-surface px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-theme transition-colors hover:bg-ink hover:text-bone"
                    >
                      Open WhatsApp
                    </a>
                    <Button variant="outline" onClick={() => setState('idle')}>
                      Send another
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Your name" required error={errors.name}>
                      <input
                        className={inputCls}
                        value={form.name}
                        onChange={set('name')}
                        placeholder="Thabo Mahlangu"
                        autoComplete="name"
                        required
                        aria-required="true"
                        aria-invalid={Boolean(errors.name)}
                      />
                    </Field>
                    <Field label="Contact number (required if no email)" error={errors.phone}>
                      <input
                        className={inputCls}
                        value={form.phone}
                        onChange={set('phone')}
                        placeholder="+27 82 000 0000"
                        autoComplete="tel"
                        inputMode="tel"
                        aria-invalid={Boolean(errors.phone)}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Email (required if no number)" error={errors.email}>
                      <input
                        className={inputCls}
                        value={form.email}
                        onChange={set('email')}
                        placeholder="you@example.co.za"
                        autoComplete="email"
                        type="email"
                        aria-invalid={Boolean(errors.email)}
                      />
                    </Field>
                    <Field label="What is it about?">
                      <select className={inputCls} value={form.subject} onChange={set('subject')}>
                        {SUBJECTS.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Message" required error={errors.message}>
                    <textarea
                      className={`${inputCls} min-h-36 resize-y`}
                      value={form.message}
                      onChange={set('message')}
                      placeholder="Tell us what you need…"
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors.message)}
                    />
                  </Field>
                  <Button type="submit" size="lg" disabled={state === 'sending'}>
                    {state === 'sending' ? 'Sending…' : 'Send message'}
                  </Button>
                  <p className="text-xs leading-relaxed text-theme-muted">
                    We only use these details to reply to your enquiry. No marketing list, no sharing. See our{' '}
                    <Link to="/policies" className="font-semibold text-theme-soft underline">privacy policy</Link>.
                  </p>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <HeritageBand className="h-5 w-full" width={1440} />
    </>
  );
}
