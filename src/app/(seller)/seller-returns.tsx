import * as React from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader, taka } from '@/components/ui';
import { NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState, FilterTabs, ReturnReasonCard } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { orderService, type SellerReturnEntry } from '@/services/order-service';
import { sellerService } from '@/services/seller-service';
import { formatDate } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

const FILTERS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const;

function ReturnRow({
  entry,
  sellerId,
  onAction,
  busyKey,
}: {
  entry: SellerReturnEntry;
  sellerId: string;
  onAction: (key: string, action: () => void) => void;
  busyKey: string | null;
}): React.JSX.Element {
  const { request, sellerOrder } = entry;
  const item = sellerOrder?.items.find((candidate) => candidate.id === request.orderItemId);
  const quantity = orderService.returnQuantity(request, item);
  const amount = item ? orderService.returnRefundAmount(request, item) : 0;

  return (
    <>
      <ReturnReasonCard
        request={request}
        quantity={quantity}
        amount={amount}
        footer={
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {entry.order ? (
              <Text style={type.caption}>
                {`${entry.order.orderCode} · requested ${formatDate(request.createdAt)}`}
              </Text>
            ) : null}
            {request.status === 'pending' ? (
              <>
                <Button
                  title="Approve return"
                  onPress={() => onAction(`approve-${request.id}`, () => orderService.decideReturn(sellerId, request.id, true))}
                  loading={busyKey === `approve-${request.id}`}
                  fullWidth
                />
                <Button
                  title="Reject return"
                  variant="secondary"
                  onPress={() => onAction(`reject-${request.id}`, () => orderService.decideReturn(sellerId, request.id, false))}
                  loading={busyKey === `reject-${request.id}`}
                  fullWidth
                />
              </>
            ) : null}
            {request.status === 'approved' ? (
              <Button
                title="Mark item as returned"
                onPress={() => onAction(`returned-${request.id}`, () => orderService.markReturned(sellerId, request.id))}
                loading={busyKey === `returned-${request.id}`}
                fullWidth
              />
            ) : null}
            {request.status === 'returned' || request.status === 'refunded' ? (
              <Text style={type.caption}>
                {request.status === 'refunded'
                  ? `Refund of ${taka(amount)} recorded (simulated) and stock restored.`
                  : 'Item marked as returned. Stock was restored.'}
              </Text>
            ) : null}
            {request.status === 'rejected' ? <Text style={type.caption}>Rejected. The customer was notified.</Text> : null}
            {sellerOrder ? (
              <Button
                title="Open order"
                variant="ghost"
                onPress={() => router.push({ pathname: '/seller-order/[id]', params: { id: sellerOrder.id } })}
                fullWidth
              />
            ) : null}
          </View>
        }
      />
    </>
  );
}

function SellerReturnsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [filter, setFilter] = React.useState<string>('pending');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const entries = sellerId ? orderService.sellerReturnList(sellerId) : [];

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

  const matches = (entry: SellerReturnEntry): boolean => {
    if (filter === 'all') return true;
    if (filter === 'closed') return ['rejected', 'returned', 'refunded'].includes(entry.request.status);
    return entry.request.status === filter;
  };
  const visible = entries.filter(matches);
  const waiting = entries.filter((entry) => entry.request.status === 'pending').length;
  const approved = entries.filter((entry) => entry.request.status === 'approved').length;
  const refundFor = (entry: SellerReturnEntry): number => {
    const item = entry.sellerOrder?.items.find((candidate) => candidate.id === entry.request.orderItemId);
    return item ? orderService.returnRefundAmount(entry.request, item) : 0;
  };
  const pendingRefund = entries
    .filter((entry) => entry.request.status === 'pending' || entry.request.status === 'approved')
    .reduce((sum, entry) => sum + refundFor(entry), 0);
  const refundedTotal = entries
    .filter((entry) => entry.request.status === 'refunded')
    .reduce((sum, entry) => sum + refundFor(entry), 0);

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-orders" />
      <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Return requests</Text>
      <Text style={[type.caption, { marginBottom: spacing.lg }]}>
        {waiting > 0 ? `${waiting} request(s) waiting for a decision` : 'No requests are waiting for a decision'}
      </Text>

      {error ? <NoticeCard tone="danger" title="Action blocked" message={error} onDismiss={() => setError(null)} /> : null}

      {entries.length > 0 ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SummaryRow label="Waiting for your decision" value={String(waiting)} />
          <SummaryRow label="Approved, item on the way back" value={String(approved)} />
          <SummaryRow label="Refund committed if approved" value={taka(pendingRefund)} tone="total" />
          <SummaryRow label="Already refunded" value={taka(refundedTotal)} tone="muted" />
        </Card>
      ) : null}

      {approved > 0 ? (
        <NoticeCard
          tone="info"
          title="Record arrived items"
          message={`${approved} approved return(s) are waiting for you to mark the item as returned, which restores stock and records the refund.`}
        />
      ) : null}

      {entries.length > 0 ? (
        <FilterTabs tabs={FILTERS.map((entry) => ({ key: entry.key, label: entry.label }))} active={filter} onChange={setFilter} />
      ) : null}

      {!sellerId ? (
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there are no return requests to review."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'No return requests' : 'Nothing in this filter'}
          message={
            entries.length === 0
              ? 'When a customer requests a return on a delivered item, the request lands here for a decision.'
              : 'Try another filter to see the rest of the requests.'
          }
        />
      ) : (
        <>
          <SectionHeader title="Requests" caption="Approving or rejecting notifies the customer" />
          {visible.map((entry) => (
            <ReturnRow
              key={entry.request.id}
              entry={entry}
              sellerId={sellerId}
              onAction={run}
              busyKey={busy}
            />
          ))}
        </>
      )}

      <Button
        title="Seller Center"
        variant="secondary"
        onPress={() => router.push('/seller-dashboard')}
        accessibilityLabel="Seller Center"
        fullWidth
      />
    </Screen>
  );
}

export default withSellerCapability(SellerReturnsScreen, '/seller-returns' satisfies ProtectedRoute);
