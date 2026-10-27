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
import { listingCache } from '@/services/listing-cache';
import { hydrateSellerWorkspace } from '@/api/remote-seller';

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
    ensureBooted()
      .then(() => authService.getCurrentUser())
      .then(async (current) => {
        // Pull the seller workspace into the device mirror before the UI unlocks,
        // so the synchronous seller reads see real data instead of an empty store.
        if (current) await hydrateWorkspace(current.id);
        if (current) await notificationService.hydrate(current.id).catch(() => undefined);
        if (mounted) {
          setUser(current);
          setStatus(current ? 'signedIn' : 'signedOut');
        }
      })
      .catch(() => {
        if (mounted) {
          setUser(null);
          setStatus('signedOut');
        }
      });
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
    setUser(current);
    setStatus(current ? 'signedIn' : 'signedOut');
    return current ?? loggedIn;
  }, [hydrateWorkspace]);

  const signUp = React.useCallback(async (input: { name: string; email: string; phone: string; password: string }): Promise<User> => {
    const registered = await authService.register(input);
    await authService.createSession(registered.id);
    await hydrateWorkspace(registered.id);
    await notificationService.hydrate(registered.id).catch(() => undefined);
    setUser(registered);
    setStatus('signedIn');
    return registered;
  }, [hydrateWorkspace]);

  const signOut = React.useCallback(async (userId?: string): Promise<void> => {
    const accountId = userId ?? user?.id;
    await authService.logout(userId);
    // Purge the signed-out account's private listings so nothing from this
    // account can surface to another account used later on the same device.
    if (accountId) listingCache.clearAccount(accountId);
    setUser(null);
    setStatus('signedOut');
  }, [user?.id]);

  const signOutEverywhere = React.useCallback(async (userId?: string): Promise<void> => {
    const accountId = userId ?? user?.id;
    await authService.logoutEverywhere(userId);
    if (accountId) listingCache.clearAccount(accountId);
    setUser(null);
    setStatus('signedOut');
  }, [user?.id]);

  const refresh = React.useCallback(async (): Promise<void> => {
    const current = await authService.getCurrentUser();
    await hydrateWorkspace(current?.id);
    if (current) await notificationService.hydrate(current.id).catch(() => undefined);
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
