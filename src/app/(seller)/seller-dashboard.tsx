import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';

import { Button, Card, ProductImage, Screen, taka } from '@/components/ui';
import { NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState, FilterTabs, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { MetricCard, SellerGlyph, SellerProductRow, SellerSectionCard, productStatusLabel } from '@/modules/seller/seller-ui';
import { ChecklistCard, FindingList, RatingBars, RevenueBars } from '@/modules/seller/analytics-ui';
import { ANALYTICS_WINDOWS, analyticsService, type AnalyticsWindow } from '@/services/analytics-service';
import { catalogService } from '@/services/catalog-service';
import { diagnosticsService } from '@/services/diagnostics-service';
import { notificationService } from '@/services/notification-service';
import { orderService, statusLabel } from '@/services/order-service';
import { sellerService } from '@/services/seller-service';
import type { OrderStatus } from '@/domain/types';
import { colors, radius, spacing, type } from '@/theme/tokens';

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

function IconGlyph({ name, size, color }: { name: SymbolViewProps['name']; size: number; color: string }): React.JSX.Element {
  return <SymbolView name={name} size={size} weight={ICON_WEIGHT} tintColor={color} />;
}

/**
 * A single Quick Action fills the whole available row width — a Vanta
 * decision: one clear tap target per row, never two actions sharing one row.
 */
function QuickActionRow({
  label,
  caption,
  icon,
  iconBackground,
  iconColor,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  caption: string;
  icon: SymbolViewProps['name'];
  iconBackground: string;
  iconColor: string;
  onPress: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.qaRow, pressed && styles.pressed]}
    >
      <View style={[styles.qaTile, { backgroundColor: iconBackground }]}>
        <IconGlyph name={icon} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <IconGlyph
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={18}
        color={colors.textFaint}
      />
    </Pressable>
  );
}

/** Compact round control for the Seller Center hero (notifications/settings). */
function HeroIconButton({
  icon,
  accessibilityLabel,
  onPress,
  dot,
}: {
  icon: SymbolViewProps['name'];
  accessibilityLabel: string;
  onPress: () => void;
  dot?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.heroIconButton, pressed && styles.heroIconButtonPressed]}
    >
      <IconGlyph name={icon} size={20} color={colors.textInverse} />
      {dot ? <View style={styles.heroDotBadge} /> : null}
    </Pressable>
  );
}

function SellerDashboardScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [window, setWindow] = React.useState<AnalyticsWindow>('30d');
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const store = profile ? sellerService.storeBySellerId(profile.id) : undefined;

  if (!sellerId) {
    return (
      <Screen padded>
        <Text style={[type.h1, { color: colors.text }]}>Seller Center</Text>
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so the Seller Center has nothing to show yet."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      </Screen>
    );
  }

  const snapshot = analyticsService.snapshot(sellerId);
  const analytics = analyticsService.analytics(sellerId, window, session.user?.id);
  const metrics = analytics.windows.find((entry) => entry.window === window) ?? analytics.windows[0];
  const diagnostics = diagnosticsService.forSeller(sellerId);
  const summary = catalogService.catalogSummary(sellerId);
  const orders = orderService.sellerOrderList(sellerId);
  const returns = orderService.sellerReturnList(sellerId);
  const notifications = notificationService.list(session.user?.id ?? '');

  const needsAction = orders.filter((entry) => entry.canAdvance);
  const pendingReturns = returns.filter((entry) => entry.request.status === 'pending');
  const unread = notifications.filter((entry) => !entry.read);
  const lowStock = catalogService.inventoryForSeller(sellerId, 'low');
  const outOfStock = catalogService.inventoryForSeller(sellerId, 'out');
  const storePaused = store?.status === 'paused';
  const attentionTotal = needsAction.length + pendingReturns.length + lowStock.length + outOfStock.length + unread.length + summary.draft;

  return (
    <Screen padded>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIdentity}>
            <View style={styles.heroAvatar}>
              <SellerGlyph size={30} tintColor={colors.primary} />
              <View style={[styles.heroLiveDot, { backgroundColor: storePaused ? colors.accent : colors.success }]} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.heroTitleRow}>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {store?.name ?? 'Your store'}
                </Text>
                <View style={styles.heroRolePill}>
                  <Text style={styles.heroRolePillText}>SELLER</Text>
                </View>
              </View>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {`${storePaused ? 'Store paused' : 'Store live'} · ${snapshot.totalOrders} completed order(s)`}
              </Text>
            </View>
          </View>
          <View style={styles.heroActions}>
            <HeroIconButton
              icon={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
              accessibilityLabel="Seller notifications"
              onPress={() => router.push('/notifications')}
              dot={unread.length > 0}
            />
            <HeroIconButton
              icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              accessibilityLabel="Store settings"
              onPress={() => router.push('/seller-store-settings')}
            />
          </View>
        </View>
        <View style={styles.heroRibbon}>
          <View style={styles.ribbonChip}>
            <Text style={styles.ribbonChipText}>{`${diagnostics.readyScore}% Ready`}</Text>
          </View>
          <Text style={styles.ribbonText} numberOfLines={1}>
            {`Readiness ${diagnostics.readyScore}% · ${diagnostics.errors} issue(s) need you`}
          </Text>
        </View>
      </View>

      {storePaused ? (
        <NoticeCard
          tone="warning"
          title="Your store is paused"
          message="Customers cannot see your products until you resume the store from Store settings."
          actionLabel="Open store settings"
          onAction={() => router.push('/seller-store-settings')}
        />
      ) : null}

      <Card style={{ marginBottom: spacing.lg }}>
        <View style={styles.sectionHeadRow}>
          <View style={styles.sectionTitleRow}>
            <IconGlyph
              name={{ ios: 'bolt.fill', android: 'bolt', web: 'bolt' }}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.sectionCardTitle}>Quick Actions</Text>
          </View>
          <Text style={type.caption}>8 seller tools</Text>
        </View>
        <View style={styles.qaList}>
          <QuickActionRow
            label="Add product"
            caption="Create a listing"
            icon={{ ios: 'plus.square.on.square', android: 'add_box', web: 'add_box' }}
            iconBackground={colors.primary}
            iconColor={colors.textInverse}
            accessibilityLabel="Quick action: add product"
            onPress={() => router.push('/seller-product/new')}
          />
          <QuickActionRow
            label="Manage products"
            caption={`${summary.total} listing(s)`}
            icon={{ ios: 'square.stack.3d.up', android: 'inventory_2', web: 'inventory_2' }}
            iconBackground={colors.primarySoft}
            iconColor={colors.primary}
            accessibilityLabel="Quick action: manage products"
            onPress={() => router.push('/seller-products')}
          />
          <QuickActionRow
            label="Inventory"
            caption={`${summary.lowStock + summary.outOfStock} need(s) attention`}
            icon={{ ios: 'archivebox', android: 'warehouse', web: 'warehouse' }}
            iconBackground={colors.successSoft}
            iconColor={colors.success}
            accessibilityLabel="Quick action: inventory"
            onPress={() => router.push('/seller-inventory')}
          />
          <QuickActionRow
            label="Orders"
            caption={`${needsAction.length} to progress`}
            icon={{ ios: 'shippingbox', android: 'local_shipping', web: 'local_shipping' }}
            iconBackground={colors.surfaceMuted}
            iconColor={colors.primaryDark}
            accessibilityLabel="Quick action: orders"
            onPress={() => router.push('/seller-orders')}
          />
          <QuickActionRow
            label="Returns"
            caption={`${pendingReturns.length} waiting`}
            icon={{ ios: 'arrow.uturn.backward.circle', android: 'assignment_return', web: 'assignment_return' }}
            iconBackground={colors.dangerSoft}
            iconColor={colors.danger}
            accessibilityLabel="Quick action: returns"
            onPress={() => router.push('/seller-returns')}
          />
          <QuickActionRow
            label="Vouchers"
            caption="Create a promo code"
            icon={{ ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' }}
            iconBackground={colors.surfaceMuted}
            iconColor={colors.accent}
            accessibilityLabel="Quick action: vouchers"
            onPress={() => router.push('/seller-vouchers')}
          />
          <QuickActionRow
            label="Reviews"
            caption={`${analytics.reviews.awaitingReply} to answer`}
            icon={{ ios: 'star', android: 'star_rate', web: 'star_rate' }}
            iconBackground={colors.primarySoft}
            iconColor={colors.primary}
            accessibilityLabel="Quick action: reviews"
            onPress={() => router.push('/seller-reviews')}
          />
          <QuickActionRow
            label="Store settings"
            caption="Profile, delivery, bank"
            icon={{ ios: 'gearshape', android: 'tune', web: 'tune' }}
            iconBackground={colors.surfaceMuted}
            iconColor={colors.textMuted}
            accessibilityLabel="Quick action: store settings"
            onPress={() => router.push('/seller-store-settings')}
          />
        </View>
      </Card>

      <View style={styles.needsHead}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h3, { color: colors.text }]}>Needs attention</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>Queues that move your store forward</Text>
        </View>
        {attentionTotal === 0 ? (
          <Pill label="All clear" tone="success" />
        ) : (
          <Pill label={`${attentionTotal} need you`} tone="warning" />
        )}
      </View>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Orders to progress"
          value={String(needsAction.length)}
          tone={needsAction.length > 0 ? 'warning' : 'default'}
          onPress={() => router.push('/seller-orders')}
          accessibilityLabel={`Orders to progress: ${needsAction.length}`}
        />
        <MetricCard
          label="Returns waiting"
          value={String(pendingReturns.length)}
          tone={pendingReturns.length > 0 ? 'warning' : 'default'}
          onPress={() => router.push('/seller-returns')}
          accessibilityLabel={`Returns waiting: ${pendingReturns.length}`}
        />
      </View>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Low stock"
          value={String(summary.lowStock)}
          onPress={() => router.push('/seller-inventory')}
          accessibilityLabel={`Low stock products: ${summary.lowStock}`}
        />
        <MetricCard
          label="Out of stock"
          value={String(summary.outOfStock)}
          tone={summary.outOfStock > 0 ? 'warning' : 'default'}
          onPress={() => router.push('/seller-inventory')}
          accessibilityLabel={`Out of stock products: ${summary.outOfStock}`}
        />
      </View>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Unread alerts"
          value={String(unread.length)}
          onPress={() => router.push('/notifications')}
          accessibilityLabel={`Unread alerts: ${unread.length}`}
        />
        <MetricCard
          label="Drafts to publish"
          value={String(summary.draft)}
          onPress={() => router.push('/seller-products')}
          accessibilityLabel={`Draft products: ${summary.draft}`}
        />
      </View>

      <SellerSectionCard
        title="Performance"
        caption="Every figure comes from your own order history"
        actionLabel="Refresh"
        onAction={refresh}
      >
        <FilterTabs
          tabs={ANALYTICS_WINDOWS.map((entry) => ({ key: entry.id, label: entry.label }))}
          active={window}
          onChange={(key) => setWindow(key as AnalyticsWindow)}
        />
        <View style={styles.metricGrid}>
          <MetricCard
            label="Gross sales"
            value={taka(metrics.grossSales)}
            caption={`${metrics.grossOrders} order(s) placed`}
            accessibilityLabel={`Gross sales ${metrics.label}: ${taka(metrics.grossSales)} from ${metrics.grossOrders} orders`}
          />
          <MetricCard
            label="Realized sales"
            value={taka(metrics.realizedSales)}
            caption={`${metrics.realizedOrders} delivered`}
            tone="success"
            accessibilityLabel={`Realized sales ${metrics.label}: ${taka(metrics.realizedSales)} from ${metrics.realizedOrders} delivered orders`}
          />
        </View>
        <View style={styles.metricGrid}>
          <MetricCard
            label="Units sold"
            value={String(metrics.unitsSold)}
            caption={`Avg ${taka(metrics.averageOrderValue)}`}
            accessibilityLabel={`Units sold ${metrics.label}: ${metrics.unitsSold}, average order ${taka(
              metrics.averageOrderValue,
            )}`}
          />
          <MetricCard
            label="Refunded"
            value={taka(metrics.refundedAmount)}
            caption={`${metrics.returnCount} return(s)`}
            tone={metrics.refundedAmount > 0 ? 'warning' : 'default'}
            accessibilityLabel={`Refunded ${metrics.label}: ${taka(metrics.refundedAmount)} across ${metrics.returnCount} returns`}
          />
        </View>
        <View style={styles.metricGrid}>
          <MetricCard
            label="Cancelled"
            value={taka(metrics.cancelledAmount)}
            caption={`${metrics.cancelledOrders} order(s)`}
            tone={metrics.cancelledOrders > 0 ? 'warning' : 'default'}
            accessibilityLabel={`Cancelled ${metrics.label}: ${taka(metrics.cancelledAmount)} across ${metrics.cancelledOrders} orders`}
          />
          <MetricCard
            label="Needs action"
            value={String(metrics.actionOrders)}
            caption="waiting on you"
            tone={metrics.actionOrders > 0 ? 'warning' : 'default'}
            onPress={() => router.push('/seller-orders')}
            accessibilityLabel={`Orders needing action ${metrics.label}: ${metrics.actionOrders}`}
          />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <RevenueBars
            series={analytics.series}
            formatValue={taka}
            accessibilityLabel={`Placed order value per day, ${metrics.label}`}
          />
        </View>
      </SellerSectionCard>

      <SellerSectionCard
        title="Store health"
        caption={`Readiness ${diagnostics.readyScore}% · ${diagnostics.errors} issue(s) need you`}
      >
        <ChecklistCard
          items={diagnostics.checklist}
          title="Readiness checklist"
          caption="Tap any item to jump to the screen that fixes it"
        />
        <FindingList findings={diagnostics.findings.slice(0, 5)} />
        <Card style={{ marginBottom: spacing.lg }}>
          <SummaryRow label="Units in stock" value={String(analytics.catalog.unitsInStock)} />
          <SummaryRow label="Products live" value={String(analytics.catalog.activeListings)} />
          <SummaryRow label="Products paused" value={String(analytics.catalog.pausedListings)} />
          <SummaryRow label="Units sold" value={String(snapshot.productsSold)} />
          <SummaryRow label="Delivered rate" value={`${snapshot.deliveredRate.toFixed(0)}%`} />
          <SummaryRow
            label="Rating"
            value={
              analytics.reviews.count
                ? `${analytics.reviews.average.toFixed(1)} from ${analytics.reviews.count} review(s)`
                : 'No reviews yet'
            }
          />
          <SummaryRow
            label="Awaiting reply"
            value={String(analytics.reviews.awaitingReply)}
            tone={analytics.reviews.awaitingReply > 0 ? 'discount' : 'muted'}
          />
          <SummaryRow label="Followers" value={String(analytics.followers)} />
        </Card>
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={[type.label, { color: colors.text, marginBottom: spacing.xs }]}>Rating spread</Text>
          <RatingBars distribution={analytics.reviews.distribution} />
        </View>
      </SellerSectionCard>

      <SellerSectionCard
        title="Next orders to progress"
        caption="Oldest first — open one to advance its fulfilment"
        actionLabel="All orders"
        onAction={() => router.push('/seller-orders')}
      >
        {needsAction.length === 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={type.body}>Every order is either delivered or cancelled. Nothing is waiting on you.</Text>
          </Card>
        ) : (
          needsAction
            .slice()
            .sort((a, b) => new Date(a.sellerOrder.createdAt).getTime() - new Date(b.sellerOrder.createdAt).getTime())
            .slice(0, 3)
            .map((entry) => (
              <PressableOrder
                key={entry.sellerOrder.id}
                code={entry.order.orderCode}
                status={entry.sellerOrder.status}
                next={entry.nextStatus}
                total={entry.sellerOrder.total}
                onPress={() => router.push({ pathname: '/seller-order/[id]', params: { id: entry.sellerOrder.id } })}
              />
            ))
        )}
      </SellerSectionCard>

      <SellerSectionCard
        title="Low stock"
        caption="At or below your alert level"
        actionLabel="Open inventory"
        onAction={() => router.push('/seller-inventory')}
      >
        {lowStock.length === 0 && outOfStock.length === 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={type.body}>No product is running low. Restock before your alert level is reached.</Text>
          </Card>
        ) : (
          [...outOfStock, ...lowStock].slice(0, 3).map((row) => (
            <SellerProductRow
              key={row.product.id}
              product={row.product}
              stock={row.stock}
              footnote={`Alert level ${row.threshold} · ${productStatusLabel(row.product.status)}`}
              onPress={() => router.push({ pathname: '/seller-product/[id]', params: { id: row.product.id } })}
            />
          ))
        )}
      </SellerSectionCard>

      <SellerSectionCard title="Top sellers" caption="Best-selling products by units delivered">
        {snapshot.topProducts.length === 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={type.body}>No delivered sales yet. Your best sellers will appear here.</Text>
          </Card>
        ) : (
          snapshot.topProducts.slice(0, 3).map((entry) => (
            <Card key={entry.id} style={styles.topRow}>
              <ProductImage uri={entry.image} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={type.caption}>{`${entry.quantity} unit(s) sold`}</Text>
              </View>
              <Text style={type.label}>{taka(entry.revenue)}</Text>
            </Card>
          ))
        )}
      </SellerSectionCard>

      <Button
        title="Refresh dashboard"
        variant="secondary"
        onPress={refresh}
        accessibilityLabel="Refresh dashboard"
        fullWidth
      />
    </Screen>
  );
}

function PressableOrder({
  code,
  status,
  next,
  total,
  onPress,
}: {
  code: string;
  status: OrderStatus;
  next: OrderStatus | null;
  total: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open order ${code}, ${statusLabel(status)}`}
      style={({ pressed }) => [styles.orderRow, pressed ? styles.pressed : null]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]}>{code}</Text>
        <Text style={type.caption}>{next ? `Next: ${statusLabel(next)}` : statusLabel(status)}</Text>
      </View>
      <Pill label={statusLabel(status)} tone="info" />
      <Text style={type.label}>{taka(total)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroAvatar: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLiveDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroTitle: { ...type.h1, color: colors.textInverse },
  heroRolePill: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  heroRolePillText: { color: colors.textInverse, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  heroMeta: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  heroActions: { flexDirection: 'row', gap: spacing.sm },
  heroIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconButtonPressed: { backgroundColor: 'rgba(255,255,255,0.26)' },
  heroDotBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  heroRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginTop: spacing.lg,
  },
  ribbonChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  ribbonChipText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  ribbonText: { ...type.caption, color: 'rgba(255,255,255,0.92)', flex: 1 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionCardTitle: { ...type.h3, color: colors.text },
  qaList: { gap: spacing.xs },
  qaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    paddingVertical: spacing.sm,
  },
  qaTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needsHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md, marginTop: spacing.sm },
  metricGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  pressed: { opacity: 0.85 },
});

export default withSellerCapability(SellerDashboardScreen, '/seller-dashboard' satisfies ProtectedRoute);
