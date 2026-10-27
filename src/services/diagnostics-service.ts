import { getContainer } from '@/infrastructure/container';
import { catalogService } from './catalog-service';
import { reviewService } from './review-service';
import { voucherService } from './voucher-service';
import { roundMoney } from '@/utils/money';

/**
 * Seller-facing store health and marketplace data integrity (M6-O/P/R).
 *
 * Everything here is read-only and derived from the local repositories, so a
 * finding is always traceable to a real record. Findings never mutate data: the
 * screens link the seller to the place where the fix belongs.
 */
export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingScope = 'account' | 'catalog' | 'orders' | 'returns' | 'reviews' | 'vouchers' | 'marketplace';

export interface IntegrityFinding {
  code: string;
  severity: FindingSeverity;
  scope: FindingScope;
  message: string;
  fix: string;
  route?: string;
  entityId?: string;
  sellerId?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  route?: string;
}

export interface SellerDiagnostics {
  sellerId: string;
  storeId: string | null;
  storeName: string | null;
  checklist: ChecklistItem[];
  findings: IntegrityFinding[];
  errors: number;
  warnings: number;
  infos: number;
  readyScore: number;
  checkedAt: string;
}

export interface MarketplaceIntegrity {
  findings: IntegrityFinding[];
  checked: number;
  errors: number;
  warnings: number;
  checkedAt: string;
}

const DAY_MS = 86_400_000;

export class DiagnosticsService {
  /** Store health for one seller: what is blocking sales and where to fix it. */
  forSeller(sellerId: string): SellerDiagnostics {
    const { repositories } = getContainer();
    const seller = repositories.sellers.getById(sellerId);
    const store = seller ? repositories.stores.getById(seller.storeId) : undefined;
    const products = seller ? catalogService.productsForSeller(sellerId) : [];
    const sellerOrders = repositories.sellerOrders.listForSeller(sellerId);
    const returns = repositories.returnRequests.listForSeller(sellerId);
    const reviews = reviewService.forSeller(sellerId);
    const findings: IntegrityFinding[] = [];

    if (!seller || seller.status !== 'active') {
      findings.push({
        code: 'account.not_active',
        severity: 'error',
        scope: 'account',
        message: 'Your seller account is not active, so listings stay hidden from customers.',
        fix: 'Finish verification in account settings.',
        route: '/seller-store-settings',
        sellerId,
      });
    }
    if (store && store.status !== 'active') {
      findings.push({
        code: 'store.paused',
        severity: 'error',
        scope: 'account',
        message: `${store.name} is paused, so customers cannot order from it.`,
        fix: 'Resume the store from store settings.',
        route: '/seller-store-settings',
        sellerId,
      });
    }

    for (const product of products) {
      if (product.status === 'active' && productStockIsZero(product)) {
        findings.push({
          code: 'catalog.active_without_stock',
          severity: 'error',
          scope: 'catalog',
          message: `"${product.name}" is live but has no stock, so customers see an unbuyable listing.`,
          fix: 'Restock the listing or pause it.',
          route: '/seller-products',
          entityId: product.id,
          sellerId,
        });
      }
      if (product.status === 'active' && product.images.length === 0) {
        findings.push({
          code: 'catalog.missing_media',
          severity: 'warning',
          scope: 'catalog',
          message: `"${product.name}" has no photos, which lowers trust and CTR.`,
          fix: 'Add at least one clear product photo.',
          route: '/seller-products',
          entityId: product.id,
          sellerId,
        });
      }
      if (product.status === 'active' && product.description.trim().length < 40) {
        findings.push({
          code: 'catalog.thin_description',
          severity: 'info',
          scope: 'catalog',
          message: `"${product.name}" has a very short description.`,
          fix: 'Describe materials, fit and care in a sentence or two.',
          route: '/seller-products',
          entityId: product.id,
          sellerId,
        });
      }
      if (product.status === 'active' && isBelowCost(product)) {
        findings.push({
          code: 'catalog.below_cost',
          severity: 'warning',
          scope: 'catalog',
          message: `"${product.name}" is priced under your recorded cost price.`,
          fix: 'Check the price before it eats your margin.',
          route: '/seller-products',
          entityId: product.id,
          sellerId,
        });
      }
    }

    const pendingReturns = returns.filter((request) => request.status === 'pending');
    if (pendingReturns.length) {
      const oldest = pendingReturns
        .map((request) => new Date(request.createdAt).getTime())
        .sort((a, b) => a - b)[0];
      const days = Math.floor((Date.now() - oldest) / DAY_MS);
      findings.push({
        code: 'returns.waiting',
        severity: days >= 2 ? 'error' : 'warning',
        scope: 'returns',
        message: `${pendingReturns.length} return request(s) are waiting on your decision${
          days >= 1 ? ` (oldest is ${days} day(s) old)` : ''
        }.`,
        fix: 'Approve or reject the pending requests.',
        route: '/seller-returns',
        sellerId,
      });
    }

    const unanswered = reviews.filter((view) => !view.hasReply && view.rating <= 3);
    if (unanswered.length) {
      findings.push({
        code: 'reviews.needs_reply',
        severity: 'warning',
        scope: 'reviews',
        message: `${unanswered.length} low rating(s) have no reply from you yet.`,
        fix: 'A short, calm reply builds more trust than silence.',
        route: '/seller-reviews',
        sellerId,
      });
    }

    const stuck = sellerOrders.filter(
      (entry) => entry.status === 'new' && Date.now() - new Date(entry.createdAt).getTime() > 2 * DAY_MS,
    );
    if (stuck.length) {
      findings.push({
        code: 'orders.unconfirmed',
        severity: 'error',
        scope: 'orders',
        message: `${stuck.length} order(s) have been waiting for confirmation for over 2 days.`,
        fix: 'Confirm or decline them from your orders.',
        route: '/seller-orders',
        sellerId,
      });
    }

    const liveVouchers = seller
      ? voucherService.listForSeller(sellerId).filter((view) => view.voucher.active)
      : [];
    const checklist: ChecklistItem[] = [
      {
        id: 'account.active',
        label: 'Seller account active',
        ok: seller?.status === 'active',
        detail: seller?.status === 'active' ? 'Verified and able to sell.' : 'Verification is incomplete.',
        route: '/seller-store-settings',
      },
      {
        id: 'store.live',
        label: 'Store visible to customers',
        ok: store?.status === 'active',
        detail: store?.status === 'active' ? 'Customers can find and order.' : 'The store is paused.',
        route: '/seller-store-settings',
      },
      {
        id: 'catalog.stock',
        label: 'No live listing without stock',
        ok: !findings.some((finding) => finding.code === 'catalog.active_without_stock'),
        detail: 'Every live listing can actually be bought.',
        route: '/seller-products',
      },
      {
        id: 'catalog.media',
        label: 'Photos on live listings',
        ok: !findings.some((finding) => finding.code === 'catalog.missing_media'),
        detail: 'Listings with photos convert better.',
        route: '/seller-products',
      },
      {
        id: 'orders.confirmed',
        label: 'Orders confirmed within 48h',
        ok: !findings.some((finding) => finding.code === 'orders.unconfirmed'),
        detail: 'Fast confirmation keeps your response rate up.',
        route: '/seller-orders',
      },
      {
        id: 'returns.decided',
        label: 'Return requests decided',
        ok: !findings.some((finding) => finding.code === 'returns.waiting'),
        detail: 'Customers wait on your decision.',
        route: '/seller-returns',
      },
      {
        id: 'reviews.replied',
        label: 'Low ratings answered',
        ok: !findings.some((finding) => finding.code === 'reviews.needs_reply'),
        detail: 'Replies show buyers you stand behind your work.',
        route: '/seller-reviews',
      },
      {
        id: 'vouchers.active',
        label: 'A voucher is live',
        ok: liveVouchers.length > 0,
        detail: liveVouchers.length
          ? `${liveVouchers.length} active voucher(s).`
          : 'Optional: a voucher can lift repeat orders.',
        route: '/seller-vouchers',
      },
    ];

    const passed = checklist.filter((item) => item.ok).length;
    return {
      sellerId,
      storeId: store?.id ?? null,
      storeName: store?.name ?? null,
      checklist,
      findings: findings.sort(bySeverity),
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      infos: findings.filter((finding) => finding.severity === 'info').length,
      readyScore: checklist.length ? Math.round((passed / checklist.length) * 100) : 0,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Cross-entity integrity sweep for the whole local database. Used by the M6
   * seed/ownership audits; it never writes.
   */
  systemIntegrity(): MarketplaceIntegrity {
    const { repositories } = getContainer();
    const findings: IntegrityFinding[] = [];
    let checked = 0;
    const allOrders = repositories.users
      .list()
      .flatMap((user) => repositories.orders.listForCustomer(user.id));

    for (const order of allOrders) {
      checked += 1;
      const sellerOrders = repositories.sellerOrders.listForOrder(order.id);
      if (order.status !== 'cancelled' && sellerOrders.length === 0) {
        findings.push({
          code: 'order.no_fulfillment',
          severity: 'error',
          scope: 'marketplace',
          message: `Order ${order.orderCode} has no seller fulfillment records.`,
          fix: 'Recreate the seller order or cancel the order.',
          entityId: order.id,
        });
      }
      if (sellerOrders.length) {
        const summed = roundMoney(sellerOrders.reduce((total, entry) => total + entry.total, 0));
        // The seller splits already carry their own share of the voucher discount
        // subtracted, so they must re-sum to the order total the customer was
        // charged. Comparing against `order.total + order.vouchersDiscount` treated
        // the un-subtracted discount as expected and would have failed a correct set
        // of splits.
        const expected = roundMoney(order.total);
        if (Math.abs(summed - expected) > 1) {
          findings.push({
            code: 'order.total_mismatch',
            severity: 'error',
            scope: 'marketplace',
            message: `Order ${order.orderCode} totals disagree with its seller orders.`,
            fix: 'Reconcile the order total with the seller splits.',
            entityId: order.id,
          });
        }
      }
      for (const transaction of repositories.payments.getByOrderId(order.id)) {
        if (transaction.status === 'paid' && !transaction.paidAt) {
          findings.push({
            code: 'payment.paid_without_date',
            severity: 'warning',
            scope: 'marketplace',
            message: `A payment on ${order.orderCode} is settled without a paid date.`,
            fix: 'Backfill the paid date so receipts stay accurate.',
            entityId: transaction.id,
          });
        }
      }
    }

    for (const sellerOrder of repositories.sellerOrders.list()) {
      checked += 1;
      const order = repositories.orders.getById(sellerOrder.orderId);
      if (!order) {
        findings.push({
          code: 'seller_order.orphan',
          severity: 'error',
          scope: 'marketplace',
          message: `A seller order for ${sellerOrder.storeName} has no parent order.`,
          fix: 'Remove the orphan record.',
          entityId: sellerOrder.id,
          sellerId: sellerOrder.sellerId,
        });
        continue;
      }
      if (sellerOrder.status === 'delivered' && !sellerOrder.fulfilledAt) {
        findings.push({
          code: 'seller_order.delivered_without_date',
          severity: 'warning',
          scope: 'marketplace',
          message: `A delivered order from ${sellerOrder.storeName} has no delivery date.`,
          fix: 'Backfill the delivery date.',
          entityId: sellerOrder.id,
          sellerId: sellerOrder.sellerId,
        });
      }
      for (const item of sellerOrder.items) {
        if (!repositories.products.getById(item.productId)) {
          findings.push({
            code: 'order_item.missing_product',
            severity: 'warning',
            scope: 'marketplace',
            message: `"${item.productName}" was ordered but the listing is gone.`,
            fix: 'Keep the order record; it is the legal copy of the sale.',
            entityId: sellerOrder.id,
            sellerId: sellerOrder.sellerId,
          });
        }
      }
    }

    for (const review of repositories.reviews.list()) {
      checked += 1;
      const product = repositories.products.getById(review.productId);
      const item = repositories.sellerOrders
        .listForSeller(review.sellerId)
        .flatMap((entry) => entry.items)
        .find((entry) => entry.id === review.orderItemId);
      if (!item) {
        findings.push({
          code: 'review.missing_item',
          severity: 'error',
          scope: 'marketplace',
          message: `A review on ${product?.name ?? 'a removed listing'} no longer matches any order line.`,
          fix: 'Remove the review or restore the order line.',
          entityId: review.id,
          sellerId: review.sellerId,
        });
      } else if (item.status !== 'delivered') {
        findings.push({
          code: 'review.undelivered_item',
          severity: 'error',
          scope: 'marketplace',
          message: `A review was left on an item that is not delivered.`,
          fix: 'Remove the review: only delivered items can be reviewed.',
          entityId: review.id,
          sellerId: review.sellerId,
        });
      }
      if (!repositories.users.getById(review.userId)) {
        findings.push({
          code: 'review.missing_user',
          severity: 'warning',
          scope: 'marketplace',
          message: `A review by ${review.userName} has no matching account.`,
          fix: 'Keep the author name on the review and drop the link.',
          entityId: review.id,
        });
      }
    }

    for (const voucher of repositories.vouchers.list()) {
      checked += 1;
      const owner = voucher.sellerId;
      const seller = owner ? repositories.sellers.getById(owner) : undefined;
      if (owner && owner !== 'system' && !seller) {
        findings.push({
          code: 'voucher.missing_seller',
          severity: 'error',
          scope: 'marketplace',
          message: `Voucher ${voucher.code} belongs to a seller that no longer exists.`,
          fix: 'Deactivate the voucher.',
          entityId: voucher.id,
        });
      }
    }

    for (const promotion of repositories.promotions.list()) {
      checked += 1;
      const missing = promotion.productIds.filter((id) => !repositories.products.getById(id));
      if (missing.length === promotion.productIds.length) {
        findings.push({
          code: 'promotion.no_products',
          severity: 'warning',
          scope: 'marketplace',
          message: `Promotion ${promotion.title} has no live products left.`,
          fix: 'End the promotion or add products.',
          entityId: promotion.id,
        });
      }
    }

    for (const user of repositories.users.list()) {
      const cart = repositories.carts.getByUserId(user.id);
      for (const item of cart?.items ?? []) {
        checked += 1;
        if (!repositories.products.getById(item.productId)) {
          findings.push({
            code: 'cart.missing_product',
            severity: 'info',
            scope: 'marketplace',
            message: 'A saved cart still points at a removed listing.',
            fix: 'The cart screen can drop dead lines automatically.',
            entityId: cart?.id,
          });
        }
      }
    }

    for (const store of repositories.stores.list()) {
      checked += 1;
      const products = repositories.products.list({ sellerId: store.sellerId });
      if (store.productCount !== products.filter((product) => product.status === 'active').length) {
        findings.push({
          code: 'store.product_count_drift',
          severity: 'info',
          scope: 'marketplace',
          message: `${store.name} shows a stale product count.`,
          fix: 'Recalculate the store counters from live listings.',
          entityId: store.id,
          sellerId: store.sellerId,
        });
      }
    }

    return {
      findings: findings.sort(bySeverity),
      checked,
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      checkedAt: new Date().toISOString(),
    };
  }
}

function bySeverity(a: IntegrityFinding, b: IntegrityFinding): number {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code);
}

function productStockIsZero(product: { stock: number; variants: { stock: number }[] }): boolean {
  if (product.variants.length) return product.variants.every((variant) => variant.stock <= 0);
  return product.stock <= 0;
}

/** Only checked when the seller actually recorded a cost price. */
function isBelowCost(product: { salePrice?: number; regularPrice: number; costPrice?: number }): boolean {
  if (product.costPrice === undefined) return false;
  const price = product.salePrice ?? product.regularPrice;
  return price < product.costPrice;
}

export const diagnosticsService = new DiagnosticsService();
