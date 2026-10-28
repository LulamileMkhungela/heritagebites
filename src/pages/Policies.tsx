import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { SectionLabel, Spinner } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
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
  useDocumentTitle('Policies & Terms');
  const catalog = useCatalog((s) => s.data);
  const { hash } = useLocation();
  const [active, setActive] = useState('');

  const policies = catalog?.policies ?? [];

  useEffect(() => {
    if (hash) setActive(hash.replace(/^#/, ''));
  }, [hash]);

  if (!catalog) return <Spinner label="Loading policies…" />;

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/plate-chicken.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>Policies</SectionLabel>
          <h1 className="max-w-3xl font-display text-5xl font-semibold md:text-6xl">The fine print, in plain language</h1>
          <p className="mt-4 max-w-2xl text-bone/70">
            Privacy, terms of use, delivery and collection, refunds and cancellations — the policies that apply when you
            order from Heritage Bites.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Policies" className="lg:sticky lg:top-28 lg:self-start">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-ochre-deep">On this page</p>
            <ul className="space-y-1">
              {policies.map((p) => (
                <li key={p.id}>
                  <a
                    href={`#${p.id}`}
                    onClick={() => setActive(p.id)}
                    className={`block rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${active === p.id ? 'bg-ink text-bone' : 'text-ink/65 hover:bg-ink/5'}`}
                  >
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-xl border border-ink/10 bg-white p-3 text-[11px] leading-relaxed text-ink/50">
              Questions about any of this? Call or WhatsApp +27 67 013 7587, or email heritagebitesfood@gmail.com.
            </p>
          </nav>

          <div className="space-y-8">
            {policies.map((policy) => (
              <section
                key={policy.id}
                id={policy.id}
                className="scroll-mt-28 rounded-[2rem] border-2 border-ink/10 bg-white p-6 md:p-9"
                aria-labelledby={`policy-${policy.id}`}
              >
                <h2 id={`policy-${policy.id}`} className="font-display text-3xl font-semibold">{policy.title}</h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink/40">
                  Last updated {new Date(policy.updated).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-ink/75">{policy.intro}</p>
                <div className="mt-5 space-y-4">
                  {policy.sections.map((section) => (
                    <div key={section.heading}>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-ink">{section.heading}</h3>
                      <p className="mt-1 text-[14px] leading-relaxed text-ink/70">{section.body}</p>
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
