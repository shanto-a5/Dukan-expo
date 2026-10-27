import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Card, Screen } from '@/components/ui';
import { EmptyState, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { notificationService } from '@/services/notification-service';
import type { AppNotification } from '@/domain/types';
import { relativeTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

function toneFor(notification: AppNotification): 'info' | 'success' | 'warning' | 'neutral' {
  if (notification.type.startsWith('seller_')) return 'success';
  if (notification.type.startsWith('return_')) return 'warning';
  if (notification.type.startsWith('order_')) return 'info';
  return 'neutral';
}

function groupLabel(notification: AppNotification): string {
  if (notification.type.startsWith('seller_')) return 'Selling';
  if (notification.type.startsWith('return_')) return 'Returns';
  if (notification.type.startsWith('order_')) return 'Orders';
  return 'Activity';
}

function NotificationsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [scope, setScope] = React.useState<'all' | 'unread'>('all');
  const userId = session.user?.id ?? '';
  const all = notificationService.list(userId);
  const notifications = scope === 'unread' ? all.filter((entry) => !entry.read) : all;
  const unread = all.filter((entry) => !entry.read).length;

  const open = (notification: AppNotification): void => {
    notificationService.markRead(userId, notification.id);
    const sellerOrderId = notification.data?.sellerOrderId;
    const productId = notification.data?.productId;
    if (typeof sellerOrderId === 'string') {
      refresh();
      router.push({ pathname: '/seller-order/[id]', params: { id: sellerOrderId } });
      return;
    }
    if (typeof productId === 'string') {
      refresh();
      router.push({ pathname: '/seller-product/[id]', params: { id: productId } });
      return;
    }
    if (notification.type === 'seller_low_stock') {
      refresh();
      router.push('/seller-inventory');
      return;
    }
    if (notification.type.startsWith('return_')) {
      refresh();
      router.push('/seller-returns');
      return;
    }
    if (notification.type === 'seller_account_status') {
      refresh();
      router.push('/settings');
      return;
    }
    refresh();
    router.push('/seller-orders');
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text }]}>Notifications</Text>
          <Text style={type.caption}>{unread > 0 ? `${unread} unread update(s)` : 'You are all caught up'}</Text>
        </View>
        {unread > 0 ? (
          <Pressable
            onPress={() => {
              notificationService.markAllRead(userId);
              refresh();
            }}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
            style={styles.tab}
          >
            <Text style={[type.label, { color: colors.primary }]}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {all.length > 0 ? (
        <View style={styles.scopeRow}>
          <Pressable
            onPress={() => setScope('all')}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === 'all' }}
            accessibilityLabel="Notifications filter: all"
            style={[styles.tab, scope === 'all' ? styles.tabOn : null]}
          >
            <Text style={[type.label, { color: scope === 'all' ? colors.primary : colors.textMuted }]}>All</Text>
          </Pressable>
          <Pressable
            onPress={() => setScope('unread')}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === 'unread' }}
            accessibilityLabel="Notifications filter: unread"
            style={[styles.tab, scope === 'unread' ? styles.tabOn : null]}
          >
            <Text style={[type.label, { color: scope === 'unread' ? colors.primary : colors.textMuted }]}>Unread</Text>
          </Pressable>
        </View>
      ) : null}

      {notifications.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No notifications' : 'Nothing unread'}
          message={
            all.length === 0
              ? 'Order updates, return decisions and seller activity will appear here.'
              : 'Every notification has been read.'
          }
          actionLabel={all.length === 0 ? 'Open orders' : undefined}
          onAction={all.length === 0 ? () => router.push('/seller-orders') : undefined}
        />
      ) : (
        notifications.map((notification) => (
          <Card key={notification.id} padded={false} style={styles.rowCard}>
            <View style={styles.row}>
              <Pressable
                onPress={() => open(notification)}
                accessibilityRole="button"
                accessibilityLabel={`${notification.read ? 'Read' : 'Unread'}: ${notification.title}`}
                style={styles.rowMain}
              >
                <View style={styles.rowHeader}>
                  {!notification.read ? <View style={styles.unreadDot} /> : null}
                  <Text style={[type.label, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {notification.title}
                  </Text>
                  <Pill label={groupLabel(notification)} tone={toneFor(notification)} />
                </View>
                <Text style={type.body} numberOfLines={2}>
                  {notification.body}
                </Text>
                <Text style={type.caption}>{relativeTime(notification.createdAt)}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  notificationService.markRead(userId, notification.id);
                  refresh();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${notification.title} as read`}
                style={styles.rowMark}
                disabled={notification.read}
              >
                <Text style={[type.caption, notification.read ? { color: colors.textMuted } : { color: colors.primary }]}>
                  {notification.read ? 'Read' : 'Mark read'}
                </Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = {
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  scopeRow: { flexDirection: 'row' as const, gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  rowCard: { marginBottom: spacing.md },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  rowMain: { flex: 1, padding: spacing.lg, gap: 4 },
  rowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  rowMark: { padding: spacing.lg },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
};

export default withSession(NotificationsScreen, '/notifications' satisfies ProtectedRoute);
