/**
 * Session context: the single source of truth for "who is signed in and their
 * capabilities". Screens subscribe to this instead of talking to storage or
 * repositories directly. All data flows through the auth service.
 */
import * as React from 'react';

import type { User } from '@/domain/types';
import { ensureBooted } from '@/infrastructure/bootstrap';
import { authService } from '@/services/auth-gateway';
import { notificationService } from '@/services/notification-service';
import { unregisterAllPushDevices, unregisterPushDevice } from '@/services/push-notifications';
import { listingCache } from '@/services/listing-cache';
import { hydrateSellerIdentity, hydrateSellerWorkspace } from '@/api/remote-seller';
import { getContainer } from '@/infrastructure/container';

export type SessionStatus = 'checking' | 'signedIn' | 'signedOut';

export interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  isSeller: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: { name: string; email: string; phone: string; password: string }) => Promise<User>;
  signOut: (userId?: string) => Promise<void>;
  signOutEverywhere: (userId?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const SESSION_CACHE_ID = 'active-authenticated-user';

interface SessionCacheRecord {
  id: string;
  tokenFingerprint: string;
  user: User;
}

// This fingerprint only binds the cached identity to the token stored on this
// device; it is not used as an authentication credential.
function tokenFingerprint(token: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}:${token.length}`;
}

async function persistSessionCache(user: User, expectedToken?: string | null): Promise<void> {
  const container = getContainer();
  const token = await container.sessionStorage.getToken();
  if (token && (expectedToken === undefined || token === expectedToken)) {
    container.db.upsert('sessions', { id: SESSION_CACHE_ID, tokenFingerprint: tokenFingerprint(token), user });
  }
}

function readSessionCache(token: string | null): User | null {
  if (!token) return null;
  const cached = getContainer().db.getById<SessionCacheRecord>('sessions', SESSION_CACHE_ID);
  return cached?.tokenFingerprint === tokenFingerprint(token) ? cached.user : null;
}

function clearSessionCache(): void {
  getContainer().db.remove('sessions', SESSION_CACHE_ID);
}

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<SessionStatus>('checking');
  const [user, setUser] = React.useState<User | null>(null);
  // Bumped when a server mirror is applied. Changing it re-renders consumers
  // without a remount.
  const [, setRevision] = React.useState(0);

  // Pulls the seller workspace mirror, then stamps the listing cache fresh for
  // this account so the first Products/Orders open renders the just-fetched data
  // immediately instead of triggering a duplicate request.
  const hydrateWorkspace = React.useCallback(async (accountId?: string | null): Promise<void> => {
    try {
      await hydrateSellerWorkspace();
      if (accountId) listingCache.markHydrated(accountId);
    } catch {
      // Keep any cached listings; the next page focus retries in the background.
    }
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await ensureBooted();
        const restoreToken = await getContainer().sessionStorage.getToken();
        const cached = readSessionCache(restoreToken);
        if (cached && mounted) {
          setUser(cached);
          setStatus('signedIn');
        }

        const current = await authService.getCurrentUser();
        if ((await getContainer().sessionStorage.getToken()) !== restoreToken) return;
        if (!mounted) return;
        if (current) {
          setUser(current);
          setStatus('signedIn');
          void persistSessionCache(current, restoreToken);
          void hydrateSellerIdentity()
            .then(() => {
              if (!mounted) return;
              setRevision((value) => value + 1);
              listingCache.ensure(current.id, 'products');
              listingCache.ensure(current.id, 'orders');
            })
            .catch(() => undefined);
          notificationService.unreadCount(current.id);
        } else {
          clearSessionCache();
          setUser(null);
          setStatus('signedOut');
        }
      } catch (error) {
        // A network failure cannot establish that a stored session is invalid.
        // Keep a token-matched cached identity signed in; otherwise remain in the
        // checking state instead of briefly presenting a guest account.
        if (mounted) console.warn('[vanta-seller] session restore is waiting for the API', error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hydrateWorkspace]);

  // The notification inbox mirror lives in NotificationService; the same hook
  // keeps the inbox and any unread badge in step with a server answer.
  React.useEffect(() => notificationService.subscribe(() => setRevision((n) => n + 1)), []);

  const signIn = React.useCallback(async (email: string, password: string): Promise<User> => {
    const loggedIn = await authService.login(email, password);
    await authService.createSession(loggedIn.id);
    const current = await authService.getCurrentUser();
    await hydrateWorkspace(current?.id);
    if (current) await notificationService.hydrate(current.id).catch(() => undefined);
    await persistSessionCache(current ?? loggedIn);
    setUser(current);
    setStatus(current ? 'signedIn' : 'signedOut');
    return current ?? loggedIn;
  }, [hydrateWorkspace]);

  const signUp = React.useCallback(async (input: { name: string; email: string; phone: string; password: string }): Promise<User> => {
    const registered = await authService.register(input);
    await authService.createSession(registered.id);
    await hydrateWorkspace(registered.id);
    await notificationService.hydrate(registered.id).catch(() => undefined);
    await persistSessionCache(registered);
    setUser(registered);
    setStatus('signedIn');
    return registered;
  }, [hydrateWorkspace]);

  const signOut = React.useCallback(async (userId?: string): Promise<void> => {
    await unregisterPushDevice();
    const accountId = userId ?? user?.id;
    await authService.logout(userId);
    clearSessionCache();
    // Purge the signed-out account's private listings so nothing from this
    // account can surface to another account used later on the same device.
    if (accountId) listingCache.clearAccount(accountId);
    setUser(null);
    setStatus('signedOut');
  }, [user?.id]);

  const signOutEverywhere = React.useCallback(async (userId?: string): Promise<void> => {
    await unregisterAllPushDevices();
    const accountId = userId ?? user?.id;
    await authService.logoutEverywhere(userId);
    clearSessionCache();
    if (accountId) listingCache.clearAccount(accountId);
    setUser(null);
    setStatus('signedOut');
  }, [user?.id]);

  const refresh = React.useCallback(async (): Promise<void> => {
    const current = await authService.getCurrentUser();
    await hydrateWorkspace(current?.id);
    if (current) await notificationService.hydrate(current.id).catch(() => undefined);
    if (current) await persistSessionCache(current);
    else clearSessionCache();
    setUser(current);
    setStatus(current ? 'signedIn' : 'signedOut');
  }, [hydrateWorkspace]);

  const value: SessionContextValue = {
    status,
    user,
    isSeller: Boolean(user?.roles.includes('seller')),
    signIn,
    signUp,
    signOut,
    signOutEverywhere,
    refresh,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}
