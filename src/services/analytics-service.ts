import { getContainer } from '@/infrastructure/container';
import type { OrderStatus, SellerOrder, Store } from '@/domain/types';
import { catalogService, productStock, stockLevelOf } from './catalog-service';
import { notificationService } from './notification-service';
import { orderService } from './order-service';

export type AnalyticsWindow = 'today' | '7d' | '30d' | 'all';

export const ANALYTICS_WINDOWS: { id: AnalyticsWindow; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

export interface AnalyticsSnapshot {
  todaySales: number;
  todayOrders: number;
  yesterdaySales: number;
  yesterdayOrders: number;
  weekSales: number;
  weekOrders: number;
  monthSales: number;
  monthOrders: number;
  totalRevenue: number;
  totalOrders: number;
  productsSold: number;
  topProducts: { id: string; name: string; image: string; quantity: number; revenue: number }[];
  lowInventory: { id: string; name: string; image: string; stock: number; threshold: number }[];
  ratingAvg: number;
  ratingCount: number;
  pendingOrders: number;
  statusCounts: Partial<Record<OrderStatus, number>>;
  dailySeries: { date: string; revenue: number; orders: number }[];
  deliveredRate: number;
}

/** One time window of real order/product data for a single seller. */
export interface SellerWindowMetrics {
  window: AnalyticsWindow;
  label: string;
  grossSales: number;
  grossOrders: number;
  realizedSales: number;
  realizedOrders: number;
  unitsSold: number;
  averageOrderValue: number;
  cancelledOrders: number;
  cancelledAmount: number;
  refundedAmount: number;
  returnedAmount: number;
  returnCount: number;
  /** Seller orders the seller can still act on. */
  actionOrders: number;
  /** Seller orders already placed but not yet confirmed. */
  pendingOrders: number;
}

export interface SellerCatalogHealth {
  totalListings: number;
  activeListings: number;
  draftListings: number;
  pausedListings: number;
  archivedListings: number;
  outOfStockListings: number;
  lowStockListings: number;
  unitsInStock: number;
}

export interface SellerRatingSummary {
  average: number;
  count: number;
  verifiedCount: number;
  repliedCount: number;
  awaitingReply: number;
  distribution: { rating: number; count: number }[];
}

export interface SellerAnalytics {
  sellerId: string;
  window: AnalyticsWindow;
  windows: SellerWindowMetrics[];
  series: { date: string; revenue: number; orders: number }[];
  topProducts: { id: string; name: string; image: string; quantity: number; revenue: number }[];
  lowInventory: { id: string; name: string; image: string; stock: number; threshold: number }[];
  statusCounts: Partial<Record<OrderStatus, number>>;
  deliveredRate: number;
  catalog: SellerCatalogHealth;
  reviews: SellerRatingSummary;
  unreadNotifications: number;
  followers: number;
  storeStatus: Store['status'];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameDay(a: string, b: number): boolean {
  const da = new Date(a);
  da.setHours(0, 0, 0, 0);
  return da.getTime() === b;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function windowRange(window: AnalyticsWindow, todayStart: number): { from: number; to: number } | null {
  if (window === 'all') return null;
  if (window === 'today') return { from: todayStart, to: todayStart + DAY_MS };
  const days = window === '7d' ? 7 : 30;
  return { from: todayStart - (days - 1) * DAY_MS, to: todayStart + DAY_MS };
}

function inRange(at: string, range: { from: number; to: number } | null): boolean {
  if (!range) return true;
  const t = new Date(at).getTime();
  return t >= range.from && t <= range.to;
}

export class AnalyticsService {
  snapshot(sellerId: string): AnalyticsSnapshot {
    const { repositories } = getContainer();
    const sellerOrders = repositories.sellerOrders.listForSeller(sellerId);
    const todayStart = startOfToday();

    const revenueOf = (orders: SellerOrder[]) => orders.reduce((sum, o) => sum + o.total, 0);
    const createdWithin = (ms: number) =>
      sellerOrders.filter((o) => {
        const t = new Date(o.createdAt).getTime();
        return t >= todayStart - ms && t <= todayStart + DAY_MS;
      });
    const todayOrders = createdWithin(0);
    const yesterdayOrders = createdWithin(DAY_MS);
    const weekOrders = createdWithin(7 * DAY_MS);
    const monthOrders = createdWithin(30 * DAY_MS);

    const allDelivered = sellerOrders.filter((o) => o.status === 'delivered');
    const totalRevenue = revenueOf(allDelivered);
    const productsSold = allDelivered.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    const topProducts = this.topProducts(sellerId, sellerOrders.filter((o) => o.status === 'delivered'), 5);

    const products = catalogService.productsForSeller(sellerId);
    const lowInventory = products
      .filter((p) => p.status !== 'archived' && p.status !== 'draft')
      .filter((p) => {
        const stock = productStock(p);
        return stock > 0 && stock <= p.lowStockThreshold;
      })
      .map((p) => ({ id: p.id, name: p.name, image: p.images[0] ?? '', stock: productStock(p), threshold: p.lowStockThreshold }));

    const reviews = getContainer().repositories.reviews.listForSeller(sellerId);
    const ratingAvg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

    const statusCounts: Partial<Record<OrderStatus, number>> = {};
    for (const o of sellerOrders) {
      statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    }
    const pendingOrders = sellerOrders.filter((o) => ['new', 'confirmed', 'packed', 'ready_to_ship'].includes(o.status)).length;

    const dailySeries: { date: string; revenue: number; orders: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const orders = sellerOrders.filter((o) => isSameDay(o.createdAt, dayStart));
      const date = new Date(dayStart).toISOString().slice(5, 10);
      dailySeries.push({ date, revenue: roundMoney(orders.reduce((s, o) => s + o.total, 0)), orders: orders.length });
    }

    const deliveredRate = sellerOrders.length ? (allDelivered.length / sellerOrders.length) * 100 : 0;

    return {
      todaySales: roundMoney(revenueOf(todayOrders)),
      todayOrders: todayOrders.length,
      yesterdaySales: roundMoney(revenueOf(yesterdayOrders)),
      yesterdayOrders: yesterdayOrders.length,
      weekSales: roundMoney(revenueOf(weekOrders)),
      weekOrders: weekOrders.length,
      monthSales: roundMoney(revenueOf(monthOrders)),
      monthOrders: monthOrders.length,
      totalRevenue: roundMoney(totalRevenue),
      totalOrders: allDelivered.length,
      productsSold,
      topProducts,
      lowInventory,
      ratingAvg,
      ratingCount: reviews.length,
      pendingOrders,
      statusCounts,
      dailySeries,
      deliveredRate,
    };
  }

  /** Windowed seller metrics computed from the seller's real records (M6-A). */
  windowMetrics(sellerId: string, window: AnalyticsWindow): SellerWindowMetrics {
    const { repositories } = getContainer();
    const sellerOrders = repositories.sellerOrders.listForSeller(sellerId);
    const todayStart = startOfToday();
    const range = windowRange(window, todayStart);
    const label = ANALYTICS_WINDOWS.find((entry) => entry.id === window)?.label ?? 'All time';

    const gross = sellerOrders.filter((o) => inRange(o.createdAt, range));
    const realized = sellerOrders.filter(
      (o) => o.status === 'delivered' && inRange(o.fulfilledAt ?? o.updatedAt, range),
    );
    const cancelled = sellerOrders.filter((o) => o.status === 'cancelled' && inRange(o.updatedAt, range));
    const refunds = orderService.sellerRefundEvents(sellerId).filter((event) => inRange(event.at, range));
    const returns = refunds.filter((event) => event.kind === 'return');

    const grossSales = gross.reduce((sum, o) => sum + o.total, 0);
    const realizedSales = realized.reduce((sum, o) => sum + o.total, 0);
    const unitsSold = realized.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    return {
      window,
      label,
      grossSales: roundMoney(grossSales),
      grossOrders: gross.length,
      realizedSales: roundMoney(realizedSales),
      realizedOrders: realized.length,
      unitsSold,
      averageOrderValue: realized.length ? roundMoney(realizedSales / realized.length) : 0,
      cancelledOrders: cancelled.length,
      cancelledAmount: roundMoney(cancelled.reduce((sum, o) => sum + o.total, 0)),
      refundedAmount: roundMoney(refunds.reduce((sum, event) => sum + event.amount, 0)),
      returnedAmount: roundMoney(returns.reduce((sum, event) => sum + event.amount, 0)),
      returnCount: returns.length,
      actionOrders: sellerOrders.filter((o) => orderService.sellerOrderCanAdvance(o) && inRange(o.updatedAt, range)).length,
      pendingOrders: sellerOrders.filter(
        (o) => ['new', 'placed'].includes(o.status) && inRange(o.createdAt, range),
      ).length,
    };
  }

  catalogHealth(sellerId: string): SellerCatalogHealth {
    const products = catalogService.productsForSeller(sellerId);
    return {
      totalListings: products.length,
      activeListings: products.filter((product) => product.status === 'active').length,
      draftListings: products.filter((product) => product.status === 'draft').length,
      pausedListings: products.filter((product) => product.status === 'paused').length,
      archivedListings: products.filter((product) => product.status === 'archived').length,
      outOfStockListings: products.filter((product) => stockLevelOf(product) === 'out').length,
      lowStockListings: products.filter((product) => stockLevelOf(product) === 'low').length,
      unitsInStock: products
        .filter((product) => product.status !== 'archived' && product.status !== 'draft')
        .reduce((sum, product) => sum + productStock(product), 0),
    };
  }

  ratingSummary(sellerId: string): SellerRatingSummary {
    const reviews = getContainer().repositories.reviews.listForSeller(sellerId);
    const distribution = [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: reviews.filter((entry) => entry.rating === rating).length,
    }));
    return {
      average: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
      count: reviews.length,
      verifiedCount: reviews.filter((entry) => entry.verifiedPurchase).length,
      repliedCount: reviews.filter((entry) => Boolean(entry.sellerReply?.text)).length,
      awaitingReply: reviews.filter((entry) => !entry.sellerReply?.text).length,
      distribution,
    };
  }

  /**
   * Full seller analytics bundle for the Seller Center. `userId` is optional and
   * only used to count that seller's own unread notifications.
   */
  analytics(sellerId: string, window: AnalyticsWindow = '30d', userId?: string): SellerAnalytics {
    const { repositories } = getContainer();
    const sellerOrders = repositories.sellerOrders.listForSeller(sellerId);
    const store = repositories.stores.getBySellerId(sellerId);
    const todayStart = startOfToday();
    const range = windowRange(window, todayStart);
    const days = window === 'today' ? 1 : window === '7d' ? 7 : 30;
    const delivered = sellerOrders.filter((o) => o.status === 'delivered');

    const series: { date: string; revenue: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const orders = sellerOrders.filter((o) => isSameDay(o.createdAt, dayStart));
      series.push({
        date: new Date(dayStart).toISOString().slice(5, 10),
        revenue: roundMoney(orders.reduce((s, o) => s + o.total, 0)),
        orders: orders.length,
      });
    }

    const statusCounts: Partial<Record<OrderStatus, number>> = {};
    for (const o of sellerOrders) {
      statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    }

    const products = catalogService.productsForSeller(sellerId);
    const lowInventory = products
      .filter((p) => p.status !== 'archived' && p.status !== 'draft')
      .filter((p) => {
        const stock = productStock(p);
        return stock > 0 && stock <= p.lowStockThreshold;
      })
      .map((p) => ({ id: p.id, name: p.name, image: p.images[0] ?? '', stock: productStock(p), threshold: p.lowStockThreshold }));

    return {
      sellerId,
      window,
      windows: ANALYTICS_WINDOWS.map((entry) => this.windowMetrics(sellerId, entry.id)),
      series: window === 'all' ? series.slice(-14) : series,
      topProducts: this.topProducts(sellerId, delivered, 5, range),
      lowInventory,
      statusCounts,
      deliveredRate: sellerOrders.length ? (delivered.length / sellerOrders.length) * 100 : 0,
      catalog: this.catalogHealth(sellerId),
      reviews: this.ratingSummary(sellerId),
      unreadNotifications: userId ? notificationService.unreadCount(userId) : 0,
      followers: store?.followerCount ?? 0,
      storeStatus: store?.status ?? 'active',
    };
  }

  private topProducts(
    sellerId: string,
    delivered: SellerOrder[],
    limit: number,
    range: { from: number; to: number } | null = null,
  ): { id: string; name: string; image: string; quantity: number; revenue: number }[] {
    const { repositories } = getContainer();
    const scoped = delivered.filter((order) => inRange(order.fulfilledAt ?? order.updatedAt, range));
    const productQty = new Map<string, number>();
    for (const o of scoped) {
      for (const item of o.items) {
        productQty.set(item.productId, (productQty.get(item.productId) ?? 0) + item.quantity);
      }
    }
    return [...productQty.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([id, quantity]) => {
        const product = repositories.products.getById(id);
        const revenue = scoped
          .filter((o) => o.items.some((i) => i.productId === id))
          .reduce(
            (sum, o) => sum + o.items.filter((i) => i.productId === id).reduce((s, i) => s + i.unitPrice * i.quantity, 0),
            0,
          );
        return {
          id,
          name: product?.name ?? 'Unknown',
          image: product?.images[0] ?? '',
          quantity,
          revenue: roundMoney(revenue),
        };
      });
  }
}

export const analyticsService = new AnalyticsService();
