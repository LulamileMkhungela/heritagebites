import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { ContactText, LoadError, SectionLabel, Spinner } from '../components/ui';
import { usePageSeo } from '../lib/seo';
import { asset } from '../lib/assets';

/**
 * Customer policies.
 *
 * The wording here comes from `server/seed.js` `policies`, which holds the text
 * the business approved (privacy/POPIA, website terms, delivery and collection,
 * refunds, cancellations). It is not legal advice and should be reviewed again
 * if the business changes how it trades.
 */
export default function Policies() {
  usePageSeo('/policies');
  const catalog = useCatalog((s) => s.data);
  const { hash } = useLocation();
  const [active, setActive] = useState('');

  const policies = catalog?.policies ?? [];
  const settings = catalog?.settings;

  useEffect(() => {
    if (hash) setActive(hash.replace(/^#/, ''));
  }, [hash]);

  const error = useCatalog((s) => s.error);
  const load = useCatalog((s) => s.load);
  if (error && !catalog) return <LoadError what="our policies" message={error} onRetry={() => void load({ force: true })} />;
  if (!catalog) return <Spinner label="Loading policies…" />;

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/plate-chicken.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>Policies</SectionLabel>
          <h1 className="max-w-3xl font-display text-5xl font-semibold md:text-6xl">Delivery, refunds and privacy, in plain language</h1>
          <p className="mt-4 max-w-2xl text-bone/70">
            Privacy, terms of use, delivery, refunds and cancellations — the policies that apply when you
            order from Heritage Bites.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
          {/*
            The sidebar holds two different things: the list of links (a <nav>)
            and a help note that is not navigation, so the note sits outside the
            nav — a <nav> is a landmark for links, not a coloured column.
          */}
          <div className="lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="Policies">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-accent">On this page</p>
            <ul className="space-y-1">
              {policies.map((p) => (
                <li key={p.id}>
                  <a
                    href={`#${p.id}`}
                    onClick={() => setActive(p.id)}
                    className={`flex min-h-11 items-center rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${active === p.id ? 'bg-ink text-bone' : 'text-theme-soft hover:bg-ink/5'}`}
                  >
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {/* The number and the address are links here too: this note is the one
              place a reader is most likely to act on them. */}
          <p className="mt-4 rounded-xl border border-theme/10 bg-surface p-3 text-xs leading-relaxed text-theme-soft">
            <ContactText>
              {`Questions about any of this? Call or WhatsApp ${settings?.phoneDisplay ?? '+27 67 013 7587'}, or email ${settings?.email ?? 'heritagebitesfood@gmail.com'}.`}
            </ContactText>
          </p>
          </div>

          <div className="space-y-8">
            {policies.map((policy) => (
              <section
                key={policy.id}
                id={policy.id}
                className="scroll-mt-28 rounded-[2rem] border-2 border-theme/10 bg-surface p-6 md:p-9"
                aria-labelledby={`policy-${policy.id}`}
              >
                <h2 id={`policy-${policy.id}`} className="font-display text-3xl font-semibold">{policy.title}</h2>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-theme-muted">
                  Last updated {new Date(policy.updated).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-theme-soft">{policy.intro}</p>
                <div className="mt-5 space-y-4">
                  {policy.sections.map((section) => (
                    <div key={section.heading}>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-theme">{section.heading}</h3>
                      <p className="mt-1 text-[14px] leading-relaxed text-theme-soft">{section.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
