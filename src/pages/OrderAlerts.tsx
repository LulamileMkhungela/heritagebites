import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Button, Field, SectionLabel, inputCls } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import {
  checkPush,
  hasLocalSubscription,
  subscribeAsOwner,
  unsubscribeThisDevice,
  type PushState,
} from '../lib/push';

/**
 * Owner device enrolment — `/alerts`.
 *
 * This is not an admin console and holds no order data. Its only job is to turn a
 * browser into a device that buzzes when an order lands, which needs the key set
 * in `HB_OWNER_PUSH_KEY` on the host. Anyone with that key can enrol a device, so
 * the page says so plainly instead of pretending to be a login.
 *
 * It is deliberately not in the public navigation. Reach it by typing the URL on
 * the phone or tablet that should receive alerts.
 */
export default function OrderAlerts() {
  useDocumentTitle('Order alerts');
  const [params] = useSearchParams();
  const [key, setKey] = useState(params.get('key') ?? '');
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const initial = await checkPush();
      if (!alive) return;
      const already = await hasLocalSubscription();
      if (!alive) return;
      setEnrolled(already);
      setState(initial);
    })();
    return () => { alive = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await subscribeAsOwner(key.trim());
      setState(result);
      setEnrolled(result.status === 'subscribed');
    } catch (error) {
      setState({
        status: 'blocked',
        message: error instanceof Error ? error.message : 'That did not work. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await unsubscribeThisDevice();
      setEnrolled(false);
      setState({ status: 'idle', message: 'This device will no longer receive order alerts.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-xl px-4 py-14">
      <SectionLabel>Kitchen alerts</SectionLabel>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Enrol this device</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/65">
        Each new order is pushed to every enrolled device — free, with no app and no message fees.
        Enrol the phone or tablet that stays in the kitchen. Do this on each device you want alerted.
      </p>

      {state && (
        <p
          className={`mt-5 rounded-2xl border-2 p-4 text-[13px] leading-relaxed ${
            state.status === 'subscribed'
              ? 'border-ochre bg-ochre/15 text-ink'
              : state.status === 'blocked' || state.status === 'unconfigured'
                ? 'border-chili/60 bg-chili/10 text-ink'
                : 'border-ink/15 bg-white text-ink/70'
          }`}
          role="status"
        >
          {state.message}
        </p>
      )}

      {enrolled ? (
        <div className="mt-6 rounded-3xl border-2 border-ink/10 bg-white p-6">
          <p className="font-display text-xl font-semibold">This device is enrolled</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink/65">
            Leave a tab open here, or simply keep the browser installed — a push notification still
            arrives when the site is closed. Test it by placing an order from another device.
          </p>
          <Button variant="outline" block className="mt-4" onClick={remove} disabled={busy}>
            {busy ? 'Removing…' : 'Stop alerts on this device'}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 rounded-3xl border-2 border-ink/10 bg-white p-6">
          <Field
            label="Owner key"
            hint="the HB_OWNER_PUSH_KEY value set on the host"
          >
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              placeholder="Paste the owner key"
            />
          </Field>
          <Button type="submit" block className="mt-4" disabled={busy || key.trim().length < 16}>
            {busy ? 'Enrolling…' : 'Turn on kitchen alerts for this device'}
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-ink/50">
            This page is protected by that key, not by a login: anyone who has it can enrol a device,
            and every enrolled device receives every order. Rotate the key on the host to revoke access,
            then remove the old devices from here.
          </p>
        </form>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-ink/50">
        On an iPhone, alerts only work after this site is added to the Home Screen
        (Share → Add to Home Screen), then enrolled. On Android and on desktop they work straight away.
      </p>

      <p className="mt-4 text-[12px] text-ink/50">
        <Link to="/" className="font-semibold text-ochre-deep hover:underline">Back to the site</Link>
      </p>
    </section>
  );
}
