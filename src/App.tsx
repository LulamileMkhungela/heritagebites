import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useCatalog } from './store/catalog';
import Layout from './components/Layout';
import Home from './pages/Home';
import MenuPage from './pages/Menu';
import Specials from './pages/Specials';
import About from './pages/About';
import Contact from './pages/Contact';
import Policies from './pages/Policies';
import Checkout from './pages/Checkout';
import OrderStatus from './pages/OrderStatus';
import Passport from './pages/Passport';
import Quest from './pages/Quest';
import NotFound from './pages/NotFound';

/**
 * Scroll management.
 *
 * A plain "scroll to top on every navigation" breaks anchor links: clicking
 * Vision in the nav pushes /about#vision, the browser does not scroll on
 * pushState, and the top-scroll wins — so the link silently lands at the top of
 * About. Hash targets are scrolled to instead, and because the catalogue loads
 * asynchronously the target may not exist yet on a cold load, so this retries
 * briefly rather than giving up on the first frame.
 */
function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      return;
    }

    const id = hash.replace(/^#/, '');
    let tries = 0;
    let raf = 0;

    const attempt = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      if (tries++ < 40) raf = requestAnimationFrame(attempt);
      else window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };

    attempt();
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash]);

  return null;
}

export default function App() {
  const load = useCatalog((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <ScrollManager />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/specials" element={<Specials />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/policies" element={<Policies />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:code" element={<OrderStatus />} />
          <Route path="/passport" element={<Passport />} />
          <Route path="/quest" element={<Quest />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
