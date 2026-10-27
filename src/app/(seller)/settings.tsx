import * as React from 'react';

import { Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { SellerGlyph } from '@/modules/seller/seller-ui';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { notificationService } from '@/services/notification-service';
import { sellerService } from '@/services/seller-service';
import { colors, spacing, type } from '@/theme/tokens';

function MenuRow({ label, caption, onPress }: { label: string; caption: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${caption}`}
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]}>{label}</Text>
        <Text style={type.caption}>{caption}</Text>
      </View>
      <Text style={[type.caption, { color: colors.primary, fontWeight: '700' }]}>Open</Text>
    </Pressable>
  );
}

/**
 * Seller settings rows use the Vanta signature color for the option name so the
 * whole seller section reads as branded, while staying on the same row anatomy
 * as the neutral account rows.
 */
function SellerMenuRow({ label, caption, onPress }: { label: string; caption: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${caption}`}
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.primary }]}>{label}</Text>
        <Text style={type.caption}>{caption}</Text>
      </View>
      <Text style={[type.caption, { color: colors.primary, fontWeight: '700' }]}>Open</Text>
    </Pressable>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { status, user, signOut, signOutEverywhere, isSeller } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);
  useFocusRefresh();
  const unread = status === 'signedIn' && user ? notificationService.unreadCount(user.id) : 0;

  const onSignOut = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    setSignOutError(null);
    try {
      await signOut(user.id);
      router.replace('/');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'We could not sign you out. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSignOutEverywhere = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    setSignOutError(null);
    try {
      await signOutEverywhere(user.id);
      router.replace('/');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'We could not sign you out everywhere. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs }}>Settings</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>Seller account and store access</Text>

      {status === 'signedIn' && user ? (
        <>
          {isSeller ? (
            <>
              <Card style={styles.sellerHeroCard}>
                <Pressable
                  onPress={() => router.push('/seller-dashboard')}
                  accessibilityRole="button"
                  accessibilityLabel="Seller dashboard: overview of your store"
                  style={({ pressed }) => [styles.heroRow, pressed && styles.menuRowPressed]}
                >
                  <View style={styles.heroIcon}>
                    <SellerGlyph size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: colors.primary }]}>Seller dashboard</Text>
                    <Text style={type.caption}>Sales, orders and store health at a glance</Text>
                  </View>
                </Pressable>
              </Card>

              <SectionHeader title="Selling" caption="Manage your store" />
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <SellerMenuRow
                    label="Products"
                    caption="Create, edit, restock and lock listings"
                    onPress={() => router.push('/seller-products')}
                  />
                  <SellerMenuRow
                    label="Inventory"
                    caption="Restock products and review stock movements"
                    onPress={() => router.push('/seller-inventory')}
                  />
                  <SellerMenuRow
                    label="Orders"
                    caption="Fulfillment steps and delivery updates"
                    onPress={() => router.push('/seller-orders')}
                  />
                  <SellerMenuRow
                    label="Returns"
                    caption="Approve, reject or complete customer returns"
                    onPress={() => router.push('/seller-returns')}
                  />
                  <SellerMenuRow
                    label="Reviews"
                    caption="Read customer reviews and reply to them"
                    onPress={() => router.push('/seller-reviews')}
                  />
                  <SellerMenuRow
                    label="Vouchers"
                    caption="Discount codes for your store"
                    onPress={() => router.push('/seller-vouchers')}
                  />
                  <SellerMenuRow
                    label="Store settings"
                    caption="Store profile, delivery, payout account and visibility"
                    onPress={() => router.push('/seller-store-settings')}
                  />
                </View>
              </Card>
            </>
          ) : (
            <Card style={styles.sellerHeroCard}>
              <Text style={{ ...type.h3, color: colors.text }}>Sell on Vanta</Text>
              <Text style={{ ...type.caption, marginTop: spacing.sm }}>
                {sellerService.profileForUser(user.id)?.status === 'pending'
                  ? 'Your application is being reviewed.'
                  : sellerService.profileForUser(user.id)?.status === 'rejected'
                    ? 'Your last application was not approved — you can apply again.'
                    : 'Open a store on VANTA and start selling.'}
              </Text>
              <View style={{ height: spacing.md }} />
              <Button
                title={
                  sellerService.profileForUser(user.id)?.status === 'rejected'
                    ? 'Reapply to sell'
                    : 'Apply to sell'
                }
                onPress={() => router.push('/seller-apply')}
                fullWidth
              />
            </Card>
          )}

          <SectionHeader title="Account" caption="Your Vanta account" />
          <Card>
            <Text style={{ ...type.h3, color: colors.text }}>{user.name}</Text>
            <Text style={{ ...type.caption, marginTop: 2 }}>{user.email}</Text>
            <Text style={{ ...type.caption, marginTop: spacing.sm }}>
              {user.roles.map((role) => role.toUpperCase()).join(' · ')}
            </Text>
            <View style={{ height: spacing.lg }} />
            <View style={{ gap: spacing.sm }}>
              <MenuRow
                label="Notifications"
                caption={unread > 0 ? `${unread} unread update(s)` : 'Order, return and selling updates'}
                onPress={() => router.push('/notifications')}
              />
            </View>
            <View style={{ height: spacing.lg }} />
            {signOutError ? (
              <View style={{ marginBottom: spacing.md }}>
                <NoticeCard
                  tone="danger"
                  title="Sign out failed"
                  message={signOutError}
                  onDismiss={() => setSignOutError(null)}
                />
              </View>
            ) : null}

            <Button title="Sign out" variant="secondary" onPress={onSignOut} loading={busy} fullWidth />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Sign out of all devices"
              variant="secondary"
              onPress={onSignOutEverywhere}
              loading={busy}
              fullWidth
            />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Seller account" caption="Sign in to manage your store on VANTA" />
          <Card>
            <Text style={{ ...type.body, color: colors.textMuted }}>
              Seller Center uses the same Vanta account you sign in with.
            </Text>
            <View style={{ height: spacing.lg }} />
            <View style={{ gap: spacing.sm }}>
              <Button title="Sign in" onPress={() => router.push('/login')} fullWidth />
              <Button title="Create an account" variant="secondary" onPress={() => router.push('/register')} fullWidth />
            </View>
          </Card>

          <View style={{ height: spacing.lg }} />
          <SectionHeader title="Sell on Vanta" caption="Apply for a seller account" />
          <View style={{ gap: spacing.sm }}>
            <Button title="Seller sign in" variant="ghost" onPress={() => router.push('/login')} fullWidth />
            <Button title="Register as a seller" variant="ghost" onPress={() => router.push('/register')} fullWidth />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = {
  menuRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  menuRowPressed: { opacity: 0.7 },
  sellerHeroCard: { marginBottom: spacing.md },
  heroRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};
