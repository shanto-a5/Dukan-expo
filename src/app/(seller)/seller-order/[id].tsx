import * as React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader, taka } from '@/components/ui';
import { AddressBlock, NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import {
  MoneySummaryCard,
  OrderItemRow,
  OrderTimeline,
  ReturnReasonCard,
  StatusPill,
  returnStatusLabel,
} from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { orderService, statusLabel } from '@/services/order-service';
import { sellerService } from '@/services/seller-service';
import type { OrderStatus } from '@/domain/types';
import { formatDate, formatDateTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

function SellerOrderDetailScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const detail = profile && rawId ? orderService.sellerOrderDetail(profile.id, rawId) : null;
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copiedCoords, setCopiedCoords] = React.useState(false);

  const copyCoordinates = async (coordsText: string) => {
    await Clipboard.setStringAsync(coordsText);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const openGoogleMaps = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  };

  if (!profile || !detail) {
    return (
      <Screen padded>
        <BackButton fallbackHref="/seller-orders" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Seller order</Text>
        <NoticeCard
          tone="danger"
          title="Order not available"
          message="This order does not belong to your store, or it no longer exists."
        />
      </Screen>
    );
  }

  const { sellerOrder, order, returns, canAdvance, nextStatus } = detail;
  const money = orderService.sellerOrderMoneySummary(sellerOrder, order);

  const run = async (key: string, action: () => unknown): Promise<void> => {
    setError(null);
    setBusy(key);
    try {
      await action();
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action is not possible right now.');
    } finally {
      setBusy(null);
    }
  };

  const pending = returns.filter((entry) => entry.status === 'pending');
  const approved = returns.filter((entry) => entry.status === 'approved');
  const lastEvent = sellerOrder.timeline[sellerOrder.timeline.length - 1];
  const timelineEvents = sellerOrder.timeline
    .filter((entry) => entry.status !== 'new')
    .map((entry) => ({
      status: entry.status as OrderStatus,
      label: statusLabel(entry.status as OrderStatus),
      at: entry.at,
    }));

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-orders" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Fulfil {order.orderCode}</Text>
          <Text style={type.caption}>{`${sellerOrder.storeName} · ordered ${formatDate(order.placedAt)}`}</Text>
        </View>
        <StatusPill status={sellerOrder.status} />
      </View>

      {error ? <NoticeCard tone="danger" title="Action blocked" message={error} onDismiss={() => setError(null)} /> : null}

      <Card style={{ marginBottom: spacing.lg }}>
        <SummaryRow label="Order status" value={statusLabel(order.status)} />
        <SummaryRow label="Your status" value={statusLabel(sellerOrder.status)} />
        <SummaryRow label="Last update" value={lastEvent ? `${statusLabel(lastEvent.status === 'new' ? 'placed' : lastEvent.status)} · ${formatDateTime(lastEvent.at)}` : 'No updates yet'} />
        <SummaryRow label="Payment" value={`${order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} · ${order.paymentStatus}`} />
        {canAdvance && nextStatus ? (
          <>
            <View style={{ height: spacing.md }} />
            <Button
              title={`Mark as ${statusLabel(nextStatus)}`}
              onPress={() => run('advance', () => orderService.advanceSellerOrder(profile.id, sellerOrder.id))}
              loading={busy === 'advance'}
              fullWidth
            />
          </>
        ) : (
          <Text style={[type.caption, { marginTop: spacing.sm }]}>
            {sellerOrder.status === 'cancelled'
              ? 'The customer cancelled this order. Reserved stock was released.'
              : 'No fulfillment step is pending on this order.'}
          </Text>
        )}
      </Card>

      <SectionHeader title="Items" caption={`${sellerOrder.items.length} line(s) to ship`} />
      <Card style={{ marginBottom: spacing.lg }}>
        {sellerOrder.items.map((item) => {
          const request = item.returnRequestId
            ? returns.find((entry) => entry.id === item.returnRequestId)
            : undefined;
          return (
            <OrderItemRow
              key={item.id}
              item={item}
              caption={
                request
                  ? returnStatusLabel(request.status)
                  : item.status === 'cancelled'
                    ? 'Cancelled'
                    : item.status === 'partially_returned'
                      ? `Partly returned · ${orderService.remainingReturnableQuantity(item)} of ${item.quantity} kept`
                      : undefined
              }
            />
          );
        })}
        <SummaryRow label="Shipping" value={sellerOrder.shippingFee === 0 ? 'Free' : taka(sellerOrder.shippingFee)} />
        {sellerOrder.vouchersDiscount > 0 ? (
          <SummaryRow label="Voucher discount" value={`−${taka(sellerOrder.vouchersDiscount)}`} tone="discount" />
        ) : null}
        <SummaryRow label="Order total" value={taka(sellerOrder.total)} tone="total" />
      </Card>

      <SectionHeader title="Your money" caption="Only what this app actually records" />
      <MoneySummaryCard summary={money} title="Your money" />

      {returns.length > 0 ? (
        <>
          <SectionHeader
            title="Returns"
            caption="Decide each request, then record the item when it is back"
            actionLabel="Open queue"
            onAction={() => router.push('/seller-returns')}
          />
          {returns.map((request) => {
            const item = sellerOrder.items.find((entry) => entry.id === request.orderItemId);
            if (!item) return null;
            return (
              <ReturnReasonCard
                key={request.id}
                request={request}
                quantity={orderService.returnQuantity(request, item)}
                amount={orderService.returnRefundAmount(request, item)}
                footer={
                  <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                    {request.status === 'pending' ? (
                      <>
                        <Button
                          title="Approve return"
                          onPress={() => run(`approve-${request.id}`, () => orderService.decideReturn(profile.id, request.id, true))}
                          loading={busy === `approve-${request.id}`}
                          fullWidth
                        />
                        <Button
                          title="Reject return"
                          variant="secondary"
                          onPress={() => run(`reject-${request.id}`, () => orderService.decideReturn(profile.id, request.id, false))}
                          loading={busy === `reject-${request.id}`}
                          fullWidth
                        />
                      </>
                    ) : null}
                    {request.status === 'approved' ? (
                      <Button
                        title="Mark item as returned"
                        variant="secondary"
                        onPress={() => run(`returned-${request.id}`, () => orderService.markReturned(profile.id, request.id))}
                        loading={busy === `returned-${request.id}`}
                        fullWidth
                      />
                    ) : null}
                    {request.status === 'rejected' || request.status === 'returned' || request.status === 'refunded' ? (
                      <Text style={type.caption}>
                        {request.status === 'refunded'
                          ? 'Refund recorded and stock was restored.'
                          : 'This request is closed.'}
                      </Text>
                    ) : null}
                  </View>
                }
              />
            );
          })}
        </>
      ) : null}

      {pending.length > 0 ? (
        <Button title="Review all return requests" variant="secondary" onPress={() => router.push('/seller-returns')} fullWidth />
      ) : null}
      {approved.length > 0 ? (
        <Button title="Track approved returns" onPress={() => router.push('/seller-returns')} fullWidth />
      ) : null}

      <SectionHeader title="Ship to" />
      <Card style={{ marginBottom: spacing.lg }}>
        <AddressBlock address={sellerOrder.shippingAddress} />
        {sellerOrder.trackingNumber ? (
          <Text style={[type.caption, { marginTop: spacing.sm }]}>
            {`${sellerOrder.carrier ?? 'Carrier'} · ${sellerOrder.trackingNumber}`}
          </Text>
        ) : null}
      </Card>

      <SectionHeader title="Customer GPS Coordinates" />
      <Card style={{ marginBottom: spacing.lg }}>
        {typeof sellerOrder.shippingAddress?.latitude === 'number' &&
        typeof sellerOrder.shippingAddress?.longitude === 'number' &&
        Number.isFinite(sellerOrder.shippingAddress.latitude) &&
        Number.isFinite(sellerOrder.shippingAddress.longitude) ? (
          <View style={{ gap: spacing.sm }}>
            <SummaryRow label="Latitude" value={String(sellerOrder.shippingAddress.latitude)} />
            <SummaryRow label="Longitude" value={String(sellerOrder.shippingAddress.longitude)} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={copiedCoords ? 'Copied!' : 'Copy Coordinates'}
                  variant="secondary"
                  onPress={() =>
                    void copyCoordinates(
                      `${sellerOrder.shippingAddress.latitude}, ${sellerOrder.shippingAddress.longitude}`
                    )
                  }
                  fullWidth
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Open in Google Maps"
                  variant="secondary"
                  onPress={() =>
                    openGoogleMaps(
                      sellerOrder.shippingAddress.latitude as number,
                      sellerOrder.shippingAddress.longitude as number
                    )
                  }
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : (
          <Text style={[type.body, { color: colors.textMuted }]}>
            GPS coordinates are not available for this order.
          </Text>
        )}
      </Card>

      <SectionHeader title="Store timeline" />
      <Card style={{ marginBottom: spacing.lg }}>
        <OrderTimeline events={timelineEvents} />
      </Card>

      <Button title="Back to seller orders" variant="secondary" onPress={() => router.replace('/seller-orders')} fullWidth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
});

export default withSellerCapability(SellerOrderDetailScreen, '/seller-orders' satisfies ProtectedRoute);