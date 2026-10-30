import { Link } from 'react-router-dom';
import { LinkButton } from '../components/ui';
import { usePageSeo } from '../lib/seo';

export default function NotFound() {
  /* A wrong address is not a page, so it is kept out of the index. */
  usePageSeo('/404', { title: 'Page not found', index: false });
  return (
    <section className="mx-auto grid max-w-3xl place-items-center px-4 py-28 text-center">
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-ochre-deep">Error 404</p>
      <h1 className="mt-4 font-display text-5xl font-semibold md:text-6xl">This plate came back empty</h1>
      <p className="mt-4 max-w-md text-ink/60">
        The page you were looking for has moved or never existed. The menu, on the other hand, is very real.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton to="/">Back home</LinkButton>
        <LinkButton to="/menu" variant="outline">See the menu</LinkButton>
        <Link to="/contact" className="inline-flex min-h-11 items-center self-center text-sm font-semibold text-ochre-deep underline">
          Tell us what broke
        </Link>
      </div>
    </section>
  );
}
