/**
 * Account-isolated listing cache.
 *
 * The seller listing pages (`Products`, `Orders`) read the on-device mirror
 * synchronously. This service adds the missing half of the remote pattern:
 *
 *   - On page open, `ensure` shows whatever the mirror already holds and then
 *     refreshes it from the server in the background (stale-while-revalidate).
 *   - The last successful read is stamped per account in the `listCache`
 *     collection, so a relaunch shows cached data immediately instead of a
 *     blank screen, and the freshness TTL survives app restarts.
 *   - A manual `refresh` (pull-to-refresh) is deduplicated against an in-flight
 *     request and rate-limited by a per-account, per-resource cooldown.
 *   - State is keyed by authenticated account id, and `clearAccount` wipes an
 *     account's cache and its private mirror rows on sign-out, so one account
 *     can never surface another's listings.
 *
 * The store itself is the existing `LocalDatabase` mirror (persisted to
 * AsyncStorage); a cache record only records *when* the account last read a
 * resource, never a second copy of the rows.
 */
import { getContainer } from '@/infrastructure/container';
import { refreshSellerProducts } from '@/api/remote-seller';
import { orderService } from './order-service';
import { sellerService } from './seller-service';

export type ListingResource = 'products' | 'orders';

export const LISTING_RESOURCES: readonly ListingResource[] = ['products', 'orders'];

/** Metadata collection (rows live in their own collections; this is freshness only). */
const CACHE_COLLECTION = 'listCache' as const;
const KEY_SEPARATOR = ':';

/** Background refreshes within this window are considered fresh. */
const BACKGROUND_TTL_MS = 15_000;
/** A manual pull is ignored for this long after the previous one settled. */
export const MANUAL_COOLDOWN_MS = 4_000;

/** What a screen needs to render its data state. */
export interface ListingState {
  /** The account has completed at least one read for this resource. */
  loaded: boolean;
  /** A request (background or manual) is currently in flight. */
  inflight: boolean;
  /** A manual pull-to-refresh is in flight. */
  refreshing: boolean;
  /** Last refresh failure, cleared when a new attempt starts. */
  error: string | null;
}

interface ListCacheRecord {
  id: string;
  updatedAt: number;
}

interface ResourceState {
  loaded: boolean;
  inflight: boolean;
  manualInflight: boolean;
  lastSuccessAt: number;
  lastCompletedAt: number;
  error: string | null;
}

const EMPTY_STATE: ListingState = { loaded: false, inflight: false, refreshing: false, error: null };

class ListingCache {
  private states = new Map<string, ResourceState>();
  private listeners = new Set<() => void>();
  private progressListeners = new Set<() => void>();
  private pending = 0;

  // ---------------------------------------------------------------- keying

  private key(accountId: string, resource: ListingResource): string {
    return `${accountId}${KEY_SEPARATOR}${resource}`;
  }

  private readRecord(accountId: string, resource: ListingResource): ListCacheRecord | undefined {
    try {
      return getContainer().db.getById<ListCacheRecord>(CACHE_COLLECTION, this.key(accountId, resource));
    } catch {
      // The database is not loaded yet (screen rendered before boot finished).
      return undefined;
    }
  }

  private state(accountId: string, resource: ListingResource): ResourceState {
    const key = this.key(accountId, resource);
    let state = this.states.get(key);
    if (!state) {
      // Seed from the persisted stamp so a relaunch reports `loaded` before the
      // first network round-trip, giving an immediate cached render.
      const record = this.readRecord(accountId, resource);
      state = {
        loaded: Boolean(record),
        inflight: false,
        manualInflight: false,
        lastSuccessAt: record?.updatedAt ?? 0,
        lastCompletedAt: 0,
        error: null,
      };
      this.states.set(key, state);
    }
    return state;
  }

  // ---------------------------------------------------------------- reads

  getState(accountId: string, resource: ListingResource): ListingState {
    if (!accountId) return EMPTY_STATE;
    const state = this.state(accountId, resource);
    return {
      loaded: state.loaded,
      inflight: state.inflight,
      refreshing: state.inflight && state.manualInflight,
      error: state.error,
    };
  }

  getProgressPending(): number {
    return this.pending;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeProgress(listener: () => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- writes

  /**
   * Called on page open. Cached data is already visible; this only kicks off a
   * background refresh when the account has never loaded or the copy is stale.
   * De-duplicates against any matching in-flight request.
   */
  ensure(accountId: string, resource: ListingResource): void {
    if (!accountId) return;
    const state = this.state(accountId, resource);
    if (state.inflight) return;
    const fresh = state.loaded && Date.now() - state.lastSuccessAt < BACKGROUND_TTL_MS;
    if (fresh) return;
    this.start(accountId, resource, false);
  }

  /**
   * Manual pull-to-refresh. Returns false when the pull is ignored because a
   * request is already in flight or the per-page cooldown has not elapsed; a
   * pull is never queued, it is simply dropped.
   */
  refresh(accountId: string, resource: ListingResource): boolean {
    if (!accountId) return false;
    const state = this.state(accountId, resource);
    if (state.inflight) return false;
    if (state.lastCompletedAt > 0 && Date.now() - state.lastCompletedAt < MANUAL_COOLDOWN_MS) return false;
    this.start(accountId, resource, true);
    return true;
  }

  /** Retry after a failure, ignoring the manual cooldown (used by an error CTA). */
  retry(accountId: string, resource: ListingResource): void {
    if (!accountId) return;
    const state = this.state(accountId, resource);
    if (state.inflight) return;
    this.start(accountId, resource, false);
  }

  /**
   * Marks both listings as freshly hydrated without a network call. The session
   * provider calls this right after the boot `hydrateSellerWorkspace`, which
   * already fetched products and orders — so a page open does not refetch them.
   */
  markHydrated(accountId: string): void {
    if (!accountId) return;
    const now = Date.now();
    for (const resource of LISTING_RESOURCES) {
      const state = this.state(accountId, resource);
      state.loaded = true;
      state.lastSuccessAt = now;
      state.error = null;
      this.persist(accountId, resource, now);
    }
    this.emit();
  }

  /**
   * Drops every trace of one account: its freshness stamps, its in-memory
   * listing state, and the seller-scoped rows it mirrored — so a later account
   * on the same device can never read the previous account's products, orders
   * or returns. Called on sign-out / sign-out-everywhere.
   */
  clearAccount(accountId: string): void {
    if (!accountId) return;
    const db = getContainer().db;

    for (const resource of LISTING_RESOURCES) {
      this.states.delete(this.key(accountId, resource));
      try {
        db.remove(CACHE_COLLECTION, this.key(accountId, resource));
      } catch {
        /* database not loaded: nothing persisted to remove */
      }
    }

    const sellerId = sellerService.profileForUser(accountId)?.id;
    if (sellerId) {
      this.purgeSellerRows('products', sellerId);
      this.purgeSellerRows('sellerOrders', sellerId);
      this.purgeSellerRows('returnRequests', sellerId);
      orderService.resetRemoteState(sellerId);
    }

    this.emit();
  }

  private purgeSellerRows(collection: 'products' | 'sellerOrders' | 'returnRequests', sellerId: string): void {
    const db = getContainer().db;
    for (const row of [...db.getCollection<{ id: string; sellerId?: string }>(collection)]) {
      if (row.sellerId === sellerId) db.remove(collection, row.id);
    }
  }

  // ---------------------------------------------------------------- internals

  private start(accountId: string, resource: ListingResource, manual: boolean): void {
    const state = this.state(accountId, resource);
    state.inflight = true;
    state.manualInflight = manual;
    state.error = null;
    this.emit();
    this.pending += 1;
    this.emitProgress();
    void this.run(accountId, resource, state);
  }

  private async run(accountId: string, resource: ListingResource, state: ResourceState): Promise<void> {
    try {
      const sellerId = sellerService.profileForUser(accountId)?.id;
      if (!sellerId) {
        // No seller workspace to read (not a seller, or profile not resolved).
        // Settle as loaded so a screen never hangs on a spinner.
        state.loaded = true;
        return;
      }
      if (resource === 'products') {
        await refreshSellerProducts(sellerId);
      } else {
        await orderService.refreshSellerOrders(sellerId);
      }
      state.loaded = true;
      state.lastSuccessAt = Date.now();
      this.persist(accountId, resource, state.lastSuccessAt);
    } catch (error) {
      // Keep the cached copy on screen; surface a discreet message only.
      state.error = error instanceof Error ? error.message : 'Could not refresh right now.';
    } finally {
      state.inflight = false;
      state.manualInflight = false;
      state.lastCompletedAt = Date.now();
      this.pending = Math.max(0, this.pending - 1);
      this.emitProgress();
      this.emit();
    }
  }

  private persist(accountId: string, resource: ListingResource, updatedAt: number): void {
    try {
      getContainer().db.upsert(CACHE_COLLECTION, { id: this.key(accountId, resource), updatedAt });
    } catch {
      // The in-memory stamp still serves the current session.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private emitProgress(): void {
    for (const listener of this.progressListeners) listener();
  }
}

export const listingCache = new ListingCache();
