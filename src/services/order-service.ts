import { getContainer } from '@/infrastructure/container';
import type {
  Order,
  OrderItemSnapshot,
  OrderStatus,
  PaymentMethod,
  PaymentTransaction,
  ReturnRequest,
  SellerOrder,
} from '@/domain/types';
import { formatMoney, roundMoney } from '@/utils/money';
import { deriveOrderStatus as sharedDeriveOrderStatus, SELLER_FULFILLMENT_FLOW } from '@shared/order-status';
import { vantaApi } from '@/api/vanta-api';
import { refreshSellerOrdersAndReturns, upsertReturn, upsertSellerOrderView } from '@/api/remote-seller';

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export interface OrderMoneyLine {
  label: string;
  amount: number;
  kind: 'paid' | 'refunded' | 'due' | 'discount';
}

export interface OrderMoneySummary {
  orderId: string;
  orderCode: string;
  paymentMethod: PaymentMethod;
  total: number;
  paid: number;
  refunded: number;
  due: number;
  settled: boolean;
  headline: string;
  lines: OrderMoneyLine[];
  note?: string;
}

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface SellerOrderSummary {
  sellerOrder: SellerOrder;
  order: Order;
  lineCount: number;
  itemCount: number;
  canAdvance: boolean;
  nextStatus: OrderStatus | null;
}

export interface SellerOrderDetail {
  sellerOrder: SellerOrder;
  order: Order;
  returns: ReturnRequest[];
  canAdvance: boolean;
  nextStatus: OrderStatus | null;
}

export interface SellerReturnEntry {
  request: ReturnRequest;
  sellerOrder?: SellerOrder;
  order?: Order;
}

export interface SellerRefundEvent {
  kind: 'cancellation' | 'return';
  at: string;
  amount: number;
  orderId: string;
  sellerOrderId: string;
}

export const ORDER_FLOW_LABELS: { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Order Placed' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'processing', label: 'Processing' },
  { status: 'packed', label: 'Packed' },
  { status: 'ready_to_ship', label: 'Ready to Ship' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out_for_delivery', label: 'Out for Delivery' },
  { status: 'delivered', label: 'Delivered' },
];

export function deriveOrderStatus(sellerOrders: SellerOrder[]): OrderStatus {
  return sharedDeriveOrderStatus(sellerOrders);
}

export function statusLabel(status: OrderStatus): string {
  const found = ORDER_FLOW_LABELS.find((o) => o.status === status);
  if (found) return found.label;
  const map: Record<string, string> = {
    new: 'New',
    processing: 'Processing',
    ready_to_ship: 'Ready to Ship',
    cancelled: 'Cancelled',
    return_requested: 'Return Requested',
    return_approved: 'Return Approved',
    partially_returned: 'Partially Returned',
    returned: 'Returned',
    refunded: 'Refunded',
  };
  return map[status] ?? status;
}

function stepLabel(status: OrderStatus): string {
  return statusLabel(status);
}

const ADVANCE_FLOW: OrderStatus[] = [...SELLER_FULFILLMENT_FLOW];

interface RemoteSellerState {
  loaded: boolean;
  updatedAt: number;
  inflight: boolean;
  promise: Promise<void> | null;
}

export class OrderService {
  // Remote seller mirror. The seller surfaces read orders and returns
  // synchronously from the device, but in remote mode the server owns them. The
  // seller reads prime this once per seller (and again after the TTL), and each
  // hydrate reconciles the return set so a stale local id is never actioned.
  private static readonly REMOTE_SELLER_TTL_MS = 15_000;
  private remoteSeller = new Map<string, RemoteSellerState>();

  private remoteSellerState(sellerId: string): RemoteSellerState {
    let state = this.remoteSeller.get(sellerId);
    if (!state) {
      state = { loaded: false, updatedAt: 0, inflight: false, promise: null };
      this.remoteSeller.set(sellerId, state);
    }
    return state;
  }

  /**
   * Runs the seller orders/returns refresh once per in-flight batch.
   *
   * Both the synchronous `sellerOrderList` read path and the listing cache's
   * background refresh call this, and every caller inside the same window awaits
   * the SAME promise — so opening the orders page never fires two identical
   * requests.
   */
  refreshSellerOrders(sellerId: string): Promise<void> {
    if (!sellerId) return Promise.resolve();
    const state = this.remoteSellerState(sellerId);
    if (state.promise) return state.promise;
    state.inflight = true;
    state.promise = refreshSellerOrdersAndReturns(sellerId)
      .then(() => {
        state.loaded = true;
        state.updatedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => {
        state.inflight = false;
        state.promise = null;
      });
    return state.promise;
  }

  private ensureSellerOrdersAndReturns(sellerId: string): void {
    if (!sellerId) return;
    const state = this.remoteSellerState(sellerId);
    const stale = !state.loaded || Date.now() - state.updatedAt > OrderService.REMOTE_SELLER_TTL_MS;
    if (stale && !state.inflight) {
      void this.refreshSellerOrders(sellerId);
    }
  }

  /**
   * Forgets the cached freshness for one seller. Used on sign-out so a later
   * session that happens to reuse the same seller id re-fetches instead of
   * trusting a stamp from a previous account's session.
   */
  resetRemoteState(sellerId: string): void {
    if (!sellerId) return;
    this.remoteSeller.delete(sellerId);
  }

  getOrder(orderId: string): Order | undefined {
    return getContainer().repositories.orders.getById(orderId);
  }

  sellerOrdersFor(orderId: string): SellerOrder[] {
    return getContainer().repositories.sellerOrders.listForOrder(orderId);
  }

  timeLineFor(order: Order, sellerOrders: SellerOrder[]) {
    const events: { status: OrderStatus; label: string; at: string }[] = [];
    events.push({ status: 'placed', label: 'Order Placed', at: order.placedAt });
    for (const so of sellerOrders) {
      for (const entry of so.timeline) {
        if (['new', 'placed'].includes(entry.status)) continue;
        const label = stepLabel(entry.status as OrderStatus);
        events.push({ status: entry.status as OrderStatus, label, at: entry.at });
      }
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return events;
  }

  transactionsFor(orderId: string): PaymentTransaction[] {
    return getContainer().repositories.payments.getByOrderId(orderId);
  }

  /**
   * Money view for one order. It only sums the payment transactions and refunds
   * the local payment/return flows actually recorded, so a screen never has to
   * guess what was paid or is still owed (M6-J).
   */
  orderMoneySummary(order: Order): OrderMoneySummary {
    const transactions = this.transactionsFor(order.id);
    // "Paid" is money that was actually received, so it keys off `paidAt` rather
    // than the transaction status.
    const paid = sum(transactions.filter((t) => t.paidAt).map((t) => t.amount));
    const refunded = sum(
      transactions
        .filter((t) => t.status === 'refunded' || (t.refundedAmount ?? 0) > 0)
        .map((t) => t.refundedAmount ?? t.amount),
    );
    const cancelled = order.status === 'cancelled';
    const due = cancelled ? 0 : roundMoney(Math.max(0, order.total - paid));
    const lines: OrderMoneyLine[] = [
      { label: 'Order total', amount: order.total, kind: 'paid' },
    ];
    if (order.vouchersDiscount > 0) {
      lines.push({ label: 'Voucher discount', amount: -order.vouchersDiscount, kind: 'discount' });
    }
    if (paid > 0) lines.push({ label: 'Paid', amount: paid, kind: 'paid' });
    if (refunded > 0) lines.push({ label: 'Refunded', amount: -refunded, kind: 'refunded' });
    if (due > 0) {
      lines.push({
        label: order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Still to pay',
        amount: due,
        kind: 'due',
      });
    }

    const settled = cancelled || due === 0;
    return {
      orderId: order.id,
      orderCode: order.orderCode,
      paymentMethod: order.paymentMethod,
      total: order.total,
      paid,
      refunded,
      due,
      settled,
      headline: cancelled
        ? refunded > 0
          ? `Cancelled · ${formatMoney(refunded)} refunded`
          : 'Cancelled · nothing was charged'
        : due === 0
          ? refunded > 0
            ? refunded >= order.total
              ? `Fully refunded ${formatMoney(refunded)}`
              : `${formatMoney(refunded)} refunded · nothing left to pay`
            : 'Paid in full'
          : order.paymentMethod === 'cod'
            ? `${formatMoney(due)} due on delivery`
            : `${formatMoney(due)} still to pay`,
      lines,
    };
  }

  /** Money view for the seller's share of one seller order (M6-J). */
  sellerOrderMoneySummary(sellerOrder: SellerOrder, order: Order): OrderMoneySummary {
    const ownRefunds = sum(
      this.sellerRefundEvents(sellerOrder.sellerId)
        .filter((event) => event.sellerOrderId === sellerOrder.id)
        .map((event) => event.amount),
    );
    const net = roundMoney(Math.max(0, sellerOrder.total - ownRefunds));
    const cancelled = sellerOrder.status === 'cancelled';
    // Nothing is ever transferred to the seller inside this build, so the app
    // only reports what is left to collect: cash on delivery is still due,
    // an online capture is already held by the app.
    const dueToCollect = cancelled || order.paymentMethod !== 'cod' ? 0 : net;
    return {
      ...this.orderMoneySummary(order),
      total: sellerOrder.total,
      paid: 0,
      refunded: ownRefunds,
      due: dueToCollect,
      settled: cancelled || sellerOrder.status === 'refunded' || dueToCollect === 0,
      headline: cancelled
        ? ownRefunds > 0
          ? `Cancelled · ${formatMoney(ownRefunds)} returned to you`
          : 'Cancelled · nothing to collect'
        : ownRefunds > 0
          ? `${formatMoney(net)} left after ${formatMoney(ownRefunds)} refunded`
          : `${formatMoney(net)} to collect ${sellerOrder.status === 'delivered' ? 'now' : 'on delivery'}`,
      note:
        order.paymentMethod === 'cod'
          ? 'Collected in cash on delivery. This build records orders and returns only, it does not move money.'
          : 'Paid online, so the buyer already settled. This build does not track payouts to your account.',
      lines: [
        { label: 'Your items', amount: sellerOrder.subtotal, kind: 'paid' },
        ...(sellerOrder.shippingFee > 0
          ? [{ label: 'Delivery fee', amount: sellerOrder.shippingFee, kind: 'paid' as const }]
          : []),
        ...(sellerOrder.vouchersDiscount > 0
          ? [{ label: 'Voucher discount', amount: -sellerOrder.vouchersDiscount, kind: 'discount' as const }]
          : []),
        ...(ownRefunds > 0
          ? [{ label: 'Refunded to customer', amount: -ownRefunds, kind: 'refunded' as const }]
          : []),
        ...(cancelled ? [] : [{ label: 'Net to you', amount: net, kind: 'paid' as const }]),
      ],
    };
  }

  // ---------- Seller views ----------

  sellerOrderList(sellerId: string): SellerOrderSummary[] {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    return repositories.sellerOrders
      .listForSeller(sellerId)
      .map((sellerOrder) => {
        const order = repositories.orders.getById(sellerOrder.orderId);
        return {
          sellerOrder,
          order,
          lineCount: sellerOrder.items.length,
          itemCount: sellerOrder.items.reduce((sum, item) => sum + item.quantity, 0),
          canAdvance: this.sellerOrderCanAdvance(sellerOrder),
          nextStatus: this.nextSellerStatus(sellerOrder),
        };
      })
      .filter((entry): entry is SellerOrderSummary & { order: Order } => !!entry.order);
  }

  sellerOrderDetail(sellerId: string, sellerOrderId: string): SellerOrderDetail | null {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    const sellerOrder = repositories.sellerOrders.getById(sellerOrderId);
    if (!sellerOrder || sellerOrder.sellerId !== sellerId) return null;
    const order = repositories.orders.getById(sellerOrder.orderId);
    if (!order) return null;
    return {
      sellerOrder,
      order,
      returns: repositories.returnRequests.listForSeller(sellerId).filter((r) => r.sellerOrderId === sellerOrder.id),
      canAdvance: this.sellerOrderCanAdvance(sellerOrder),
      nextStatus: this.nextSellerStatus(sellerOrder),
    };
  }

  nextSellerStatus(sellerOrder: SellerOrder): OrderStatus | null {
    if (!this.sellerOrderCanAdvance(sellerOrder)) return null;
    const idx = ADVANCE_FLOW.indexOf(sellerOrder.status);
    if (idx === -1 || idx >= ADVANCE_FLOW.length - 1) return null;
    return ADVANCE_FLOW[idx + 1];
  }

  sellerOrderCanAdvance(sellerOrder: SellerOrder): boolean {
    const idx = ADVANCE_FLOW.indexOf(sellerOrder.status);
    return idx > -1 && idx < ADVANCE_FLOW.length - 1;
  }

  returnRequestsForOrder(orderId: string): ReturnRequest[] {
    return getContainer()
      .repositories.returnRequests.list()
      .filter((request) => request.orderId === orderId);
  }

  sellerReturnList(sellerId: string): SellerReturnEntry[] {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    return this.returnRequestsForSeller(sellerId).map((request) => ({
      request,
      sellerOrder: repositories.sellerOrders.getById(request.sellerOrderId),
      order: repositories.orders.getById(request.orderId),
    }));
  }

  private returnRequestsForSeller(sellerId: string): ReturnRequest[] {
    return getContainer().repositories.returnRequests.listForSeller(sellerId);
  }

  /**
   * Units of a line the customer still holds.
   *
   * `returnedQuantity` is cumulative, so this is the honest denominator for
   * "how many can I still send back". Clamped to 0 because a snapshot written by an
   * older build, or a double-processed return, must never yield a negative count.
   */
  remainingReturnableQuantity(item: OrderItemSnapshot): number {
    const returned = Math.max(0, item.returnedQuantity ?? 0);
    return Math.max(0, item.quantity - returned);
  }

  /**
   * The quantity a return request covers.
   *
   * Defaults to whatever is still returnable rather than the full ordered
   * quantity: a line already partly returned cannot hand back the same unit twice.
   */
  returnQuantity(request: ReturnRequest, item?: OrderItemSnapshot): number {
    if (request.quantity !== undefined) return request.quantity;
    if (item) return this.remainingReturnableQuantity(item);
    return 1;
  }

  refundEstimateForItem(item: OrderItemSnapshot, quantity: number): number {
    const safeQuantity = Math.max(0, Math.min(Math.floor(quantity), item.quantity));
    return roundMoney(item.unitPrice * safeQuantity);
  }

  returnRefundAmount(request: ReturnRequest, item: OrderItemSnapshot): number {
    return this.refundEstimateForItem(item, this.returnQuantity(request, item));
  }

  /**
   * Money events that reduce a seller's realised revenue, in the exact amounts
   * the refund flow recorded (M6-A). `order-service` owns refund maths, so
   * analytics aggregates these events instead of recomputing them.
   */
  sellerRefundEvents(sellerId: string): SellerRefundEvent[] {
    const { repositories } = getContainer();
    const events: SellerRefundEvent[] = [];

    for (const sellerOrder of repositories.sellerOrders.listForSeller(sellerId)) {
      if (sellerOrder.status !== 'cancelled') continue;
      const order = repositories.orders.getById(sellerOrder.orderId);
      if (!order) continue;
      const transaction = repositories.payments.getByOrderId(order.id)[0];
      const refunded = transaction?.status === 'refunded';
      if (!refunded) continue;
      events.push({
        kind: 'cancellation',
        at: order.cancelledAt ?? sellerOrder.updatedAt,
        amount: sellerOrder.total,
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
      });
    }

    for (const request of this.returnRequestsForSeller(sellerId)) {
      if (request.status !== 'refunded') continue;
      const sellerOrder = repositories.sellerOrders.getById(request.sellerOrderId);
      const item = sellerOrder?.items.find((entry) => entry.id === request.orderItemId);
      if (!sellerOrder || !item) continue;
      const at = [...request.timeline].reverse().find((entry) => entry.status === 'refunded')?.at ?? request.updatedAt;
      events.push({
        kind: 'return',
        at,
        amount: this.returnRefundAmount(request, item),
        orderId: request.orderId,
        sellerOrderId: sellerOrder.id,
      });
    }

    return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  // ---------- Seller fulfillment ----------

  async advanceSellerOrder(sellerId: string, sellerOrderId: string): Promise<SellerOrder> {
    void sellerId;
    const view = await vantaApi.advanceSellerOrder(sellerOrderId);
    return upsertSellerOrderView(view);
  }

  // ---------- Returns ----------

  async decideReturn(sellerId: string, returnId: string, approve: boolean): Promise<void> {
    const dto = approve
      ? await vantaApi.approveSellerReturn(returnId)
      : await vantaApi.rejectSellerReturn(returnId);
    upsertReturn(dto);
    await refreshSellerOrdersAndReturns(sellerId).catch(() => undefined);
  }

  async markReturned(sellerId: string, returnId: string): Promise<void> {
    const dto = await vantaApi.markSellerReturnReturned(returnId);
    upsertReturn(dto);
    await refreshSellerOrdersAndReturns(sellerId).catch(() => undefined);
  }
}

export const orderService = new OrderService();
