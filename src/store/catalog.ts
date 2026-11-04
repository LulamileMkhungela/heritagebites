import { create } from 'zustand';
import { api, STATIC_PREVIEW } from '../lib/api';
import { serviceStatus } from '../../shared/service.js';
import { withAssetBase } from '../lib/assets';
import type { Catalog, MenuItem, ServiceStatus } from '../lib/types';

interface CatalogState {
  data: Catalog | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  item: (id: string) => MenuItem | undefined;
}

/** Fetched once at startup and cached for the session. */
export const useCatalog = create<CatalogState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    if (get().data || get().loading) return;
    set({ loading: true, error: null });
    try {
      // Image paths in the catalogue are root-relative; apply the site base.
      const data = withAssetBase(await api.catalog());
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
      set({ error: e instanceof Error ? e.message : 'Could not load the menu.', loading: false });
    }
  },

  item: (id) => get().data?.menu.find((m) => m.id === id),
}));
