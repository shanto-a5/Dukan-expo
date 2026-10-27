import * as React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, taka } from '@/components/ui';
import { EmptyState, FilterTabs, OrderItemRow, Pill, StatusPill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { orderService, statusLabel, type SellerOrderSummary } from '@/services/order-service';
import { notificationService } from '@/services/notification-service';
import { sellerService } from '@/services/seller-service';
import type { OrderStatus } from '@/domain/types';
import { formatDate, relativeTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

const FILTERS = [
  { key: 'open', label: 'Needs action' },
  { key: 'all', label: 'All' },
  { key: 'returns', label: 'Returns' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const RETURN_STATUSES: OrderStatus[] = [
  'return_requested',
  'return_approved',
  'partially_returned',
  'returned',
  'refunded',
];

function bucketFor(status: OrderStatus, canAdvance: boolean): string {
  if (status === 'cancelled') return 'cancelled';
  if (RETURN_STATUSES.includes(status)) return 'returns';
  if (canAdvance) return 'open';
  return 'all';
}

function SellerOrderCard({ entry }: { entry: SellerOrderSummary }): React.JSX.Element {
  const { sellerOrder, order, lineCount, itemCount, canAdvance, nextStatus } = entry;
  const topItems = sellerOrder.items.slice(0, 2);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/seller-order/[id]', params: { id: sellerOrder.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderCode}, ${statusLabel(sellerOrder.status)}, ${taka(sellerOrder.total)}`}
    >
      <Card style={{ marginBottom: spacing.md }}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[type.h3, { color: colors.text }]}>{order.orderCode}</Text>
            <Text style={type.caption}>
              {`${formatDate(order.placedAt)} · ${relativeTime(order.placedAt)}`}
            </Text>
          </View>
          <StatusPill status={sellerOrder.status} />
        </View>
        <Text style={[type.caption, { marginBottom: spacing.sm }]}>
          {`${itemCount} item(s) in ${lineCount} line(s) · ships to ${order.shippingAddress.district}`}
        </Text>
        {topItems.map((item) => (
          <OrderItemRow key={item.id} item={item} />
        ))}
        {sellerOrder.items.length > topItems.length ? (
          <Text style={type.caption}>{`+${sellerOrder.items.length - topItems.length} more line(s)`}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          <Text style={type.label}>{`Payout ${taka(sellerOrder.total)}`}</Text>
          {canAdvance && nextStatus ? (
            <Pill label={`Next: ${statusLabel(nextStatus)}`} tone="info" />
          ) : (
            <Text style={styles.link}>Open order</Text>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function SellerOrdersScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  useFocusRefresh();
  const [filter, setFilter] = React.useState<string>('open');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<'newest' | 'oldest'>('newest');
  const userId = session.user?.id ?? '';
  const listing = useListingCache(session.user?.id, 'orders');
  const profile = sellerService.profileForUser(userId);
  const store = sellerService.storeForUser(userId);
  const entries = profile ? orderService.sellerOrderList(profile.id) : [];
  const unread = notificationService.unreadCount(userId);
  const query = search.trim().toLowerCase();
  const searched = query
    ? entries.filter((entry) => {
        const haystack = [
          entry.order.orderCode,
          entry.sellerOrder.shippingAddress.recipientName,
          entry.sellerOrder.shippingAddress.district,
          ...entry.sellerOrder.items.map((item) => item.productName),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
    : entries;
  const visible = searched
    .filter((entry) => filter === 'all' || bucketFor(entry.sellerOrder.status, entry.canAdvance) === filter)
    .sort((a, b) => {
      const delta = new Date(b.order.placedAt).getTime() - new Date(a.order.placedAt).getTime();
      return sort === 'newest' ? delta : -delta;
    });
  const needsAction = entries.filter((entry) => entry.canAdvance).length;
  const pendingReturns = entries.filter((entry) => entry.sellerOrder.status === 'return_requested').length;

  return (
    <Screen
      padded
      refreshControl={
        <RefreshControl
          refreshing={listing.refreshing}
          onRefresh={listing.refresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <BackButton fallbackHref="/seller-dashboard" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Seller orders</Text>
          <Text style={type.caption}>
            {store ? `${store.name} · ${entries.length} order(s)` : 'No store linked to this account'}
          </Text>
        </View>
        <Button
          title={unread > 0 ? `Alerts (${unread})` : 'Alerts'}
          variant="secondary"
          onPress={() => router.push('/notifications')}
        />
      </View>

      {profile ? (
        <View style={styles.quickRow}>
          <Pressable
            onPress={() => router.push('/seller-returns')}
            accessibilityRole="button"
            accessibilityLabel="Open return requests"
            style={styles.quickCard}
          >
            <Text style={[type.h2, { color: colors.text }]}>{String(pendingReturns)}</Text>
            <Text style={type.caption}>Return requests waiting</Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('open')}
            accessibilityRole="button"
            accessibilityLabel="Filter to orders needing action"
            style={styles.quickCard}
          >
            <Text style={[type.h2, { color: colors.text }]}>{String(needsAction)}</Text>
            <Text style={type.caption}>Fulfillment steps pending</Text>
          </Pressable>
        </View>
      ) : null}

      {entries.length > 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search by order code, customer, district or product"
            accessibilityLabel="Search seller orders"
            returnKeyType="search"
          />
          <View style={styles.sortRow}>
            <Text style={[type.caption, { flex: 1 }]}>
              {`${visible.length} order(s) shown${query ? ` for “${search.trim()}”` : ''}`}
            </Text>
            <Pressable
              onPress={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${sort}`}
              hitSlop={8}
            >
              <Text style={styles.link}>{sort === 'newest' ? 'Newest first' : 'Oldest first'}</Text>
            </Pressable>
          </View>
          <FilterTabs tabs={FILTERS.map((entry) => ({ key: entry.key, label: entry.label }))} active={filter} onChange={setFilter} />
        </View>
      ) : null}

      {listing.error ? (
        <View style={styles.refreshNotice}>
          <Text style={styles.refreshNoticeText} numberOfLines={2}>
            {`Couldn't refresh — showing saved orders.${listing.error ? ` ${listing.error}` : ''}`}
          </Text>
          <Pressable onPress={listing.retry} accessibilityRole="button" accessibilityLabel="Retry refreshing orders" hitSlop={8}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!profile ? (
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there is nothing to fulfil yet."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      ) : !listing.loaded && !listing.error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={type.caption}>Loading your orders…</Text>
        </View>
      ) : visible.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'No orders yet' : 'Nothing in this filter'}
          message={
            entries.length === 0
              ? 'Orders placed for your store appear here with fulfillment and return actions.'
              : query
                ? 'No order matches that search in this filter. Clear the search or pick another filter.'
                : 'Try another filter to see the rest of your orders.'
          }
        />
      ) : (
        visible.map((entry) => <SellerOrderCard key={entry.sellerOrder.id} entry={entry} />)
      )}

      {profile ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Button
            title="Seller Center"
            variant="secondary"
            onPress={() => router.push('/seller-dashboard')}
            accessibilityLabel="Seller Center"
            fullWidth
          />
          <Button
            title="Inventory"
            variant="ghost"
            onPress={() => router.push('/seller-inventory')}
            accessibilityLabel="Inventory"
            fullWidth
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  quickRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  quickCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  refreshNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  refreshNoticeText: { flex: 1, color: colors.textMuted, fontSize: 13 },
});

export default withSellerCapability(SellerOrdersScreen, '/seller-orders' satisfies ProtectedRoute);
