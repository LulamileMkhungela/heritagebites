import { create } from 'zustand';
import { api, STATIC_PREVIEW } from '../lib/api';
import { serviceStatus } from '../../shared/service.js';
import { withAssetBase } from '../lib/assets';
import type { Catalog, MenuItem, ServiceStatus } from '../lib/types';

interface CatalogState {
  data: Catalog | null;
  loading: boolean;
  error: string | null;
  load: (options?: { force?: boolean }) => Promise<void>;
  item: (id: string) => MenuItem | undefined;
}

/** Fetched once at startup and cached for the session. */
export const useCatalog = create<CatalogState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,

  /**
   * `force` is the "Try again" button re-opening a load that already failed.
   *
   * Without it the error state was a dead end: the guard below returns early
   * once `data` is set, and nothing ever cleared `error`, so a page that had
   * given up stayed given up until the tab was reloaded.
   */
  load: async ({ force = false } = {}) => {
    if (get().loading) return;
    if (get().data && !force) return;
    set({ loading: true, error: null });
    try {
      /*
       * A fetch that never settles is not a catchable failure — the request has
       * no timeout of its own, so a connection that opens and then stalls leaves
       * `loading` true forever, which is the same endless spinner by another
       * route. Twelve seconds is long for a catalogue that is a few kilobytes
       * of JSON, and the retry is one tap away when it gives up.
       */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      let data: Catalog;
      try {
        // Image paths in the catalogue are root-relative; apply the site base.
        data = withAssetBase(await api.catalog(controller.signal));
      } finally {
        clearTimeout(timer);
      }
      /*
       * A static build ships one snapshot of the catalogue, which would freeze
       * "today is a rest day" for as long as the file is old. The service rules
       * are shared with the API, so the browser recomputes the live status from
       * the same settings the server uses.
       */
      if (STATIC_PREVIEW && data?.settings) {
        data.service = serviceStatus(data.settings) as ServiceStatus;
      }
      set({ data, loading: false });
    } catch (e) {
      /*
       * Duck-typed, not `instanceof Error`: the error can come from another
       * realm — a worker, an iframe, an aborted fetch created elsewhere — where
       * `instanceof` is false for an object that is still an error.
       */
      const err = e as { name?: string; message?: string } | null;
      const aborted = err?.name === 'AbortError' || /abort/i.test(err?.message ?? '');
      set({
        error: aborted
          ? 'The kitchen’s menu took too long to answer.'
          : e instanceof Error
            ? e.message
            : 'Could not load the menu.',
        loading: false,
      });
    }
  },

  item: (id) =>
    get().data?.menu.find((m) => m.id === id) ?? get().data?.sides?.find((m) => m.id === id),
}));
