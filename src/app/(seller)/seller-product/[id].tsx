import * as React from 'react';
import { Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, ProductImage, Screen, taka } from '@/components/ui';
import { NoticeCard, Radio, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import {
  ADJUSTMENT_REASON_LABELS,
  ProductStatusPill,
  SellerSectionCard,
  StockAdjustPanel,
  StockPill,
  categoryNameOf,
  productStatusLabel,
} from '@/modules/seller/seller-ui';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { sellerService } from '@/services/seller-service';
import { formatDateTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

function SellerProductDetailScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const product = profile && rawId ? catalogService.sellerProduct(profile.id, rawId) : null;
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState('5');
  const [variantId, setVariantId] = React.useState<string | null>(null);

  if (!profile || !product) {
    return (
      <Screen padded>
        <BackButton fallbackHref="/seller-products" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Product</Text>
        <NoticeCard
          tone="danger"
          title="Product not available"
          message="This product does not belong to your store, or it no longer exists."
        />
      </Screen>
    );
  }

  const history = catalogService.adjustmentHistory(profile.id, product.id);
  const stock = catalogService.inventoryForSeller(profile.id).find((row) => row.product.id === product.id)?.stock ?? product.stock;
  const live = product.status === 'active';
  const paused = product.status === 'paused';
  const archived = product.status === 'archived';
  const selectedVariant = product.variants.find((variant) => variant.id === variantId) ?? null;
  const targetLabel = selectedVariant
    ? `${Object.values(selectedVariant.attributes).join(' / ') || selectedVariant.sku}`
    : product.name;

  const run = async (key: string, action: () => unknown, successMessage?: string): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy(key);
    try {
      await action();
      if (successMessage) setMessage(successMessage);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action is not possible right now.');
    } finally {
      setBusy(null);
    }
  };

  const adjust = (direction: 1 | -1): void => {
    const units = Number(amount);
    void run(
      direction === 1 ? 'add' : 'remove',
      () =>
        catalogService.adjustStock(
          profile.id,
          product.id,
          direction * units,
          direction === 1 ? 'restock' : 'manual',
          selectedVariant?.id ?? null,
        ),
      direction === 1 ? `Added ${units} unit(s) to ${targetLabel}.` : `Removed ${units} unit(s) from ${targetLabel}.`,
    );
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-products" />

      <View style={styles.header}>
        <ProductImage uri={product.images[0]} size={96} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[type.h1, { color: colors.text }]} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={type.caption}>{`${product.brand} · ${product.sku}`}</Text>
          <View style={styles.pillRow}>
            <ProductStatusPill status={product.status} />
            <StockPill stock={stock} threshold={product.lowStockThreshold} />
          </View>
        </View>
      </View>

      {error ? <NoticeCard tone="danger" title="Action blocked" message={error} onDismiss={() => setError(null)} /> : null}
      {message ? <NoticeCard tone="success" title="Saved" message={message} onDismiss={() => setMessage(null)} /> : null}

      <SellerSectionCard title="Pricing" caption="What customers pay right now">
        <Card style={{ marginBottom: spacing.lg }}>
          <SummaryRow label="Regular price" value={taka(product.regularPrice)} />
          {product.salePrice ? (
            <SummaryRow label="Sale price" value={taka(product.salePrice)} tone="discount" />
          ) : null}
          {product.costPrice ? <SummaryRow label="Cost price" value={taka(product.costPrice)} tone="muted" /> : null}
          <SummaryRow label="Buyer pays" value={taka(effectivePrice(product))} tone="total" />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard title="Listing" caption="Where this product sits in the catalog">
        <Card style={{ marginBottom: spacing.lg }}>
          <SummaryRow label="Category" value={categoryNameOf(product.categoryId, product.subcategoryId)} />
          <SummaryRow label="Status" value={productStatusLabel(product.status)} />
          <SummaryRow label="Published" value={product.publishedAt ? formatDateTime(product.publishedAt) : 'Not published yet'} />
          <SummaryRow label="Units sold" value={String(product.soldCount)} />
          <SummaryRow label="Views" value={String(product.viewCount)} />
          <SummaryRow
            label="Rating"
            value={product.ratingCount ? `${product.ratingAvg.toFixed(1)} from ${product.ratingCount} review(s)` : 'No reviews yet'}
          />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard title="Actions" caption="Publishing changes are effective immediately">
        <View style={styles.actionGrid}>
          <View style={styles.actionSlot}>
            <Button
              title="Edit listing"
              onPress={() => router.push({ pathname: '/seller-product-edit/[id]', params: { id: product.id } })}
              accessibilityLabel="Edit listing"
              fullWidth
            />
          </View>
          <View style={styles.actionSlot}>
            <Button
              title="Duplicate"
              variant="secondary"
              onPress={() =>
                run(
                  'duplicate',
                  async () => {
                    const copy = await catalogService.duplicateProduct(profile.id, product.id);
                    router.push({ pathname: '/seller-product/[id]', params: { id: copy.id } });
                  },
                  'A draft copy was created.',
                )
              }
              loading={busy === 'duplicate'}
              disabled={busy !== null}
              accessibilityLabel="Duplicate listing"
              fullWidth
            />
          </View>
          {live || product.status === 'out_of_stock' ? (
            <View style={styles.actionSlot}>
              <Button
                title="Pause listing"
                variant="secondary"
                onPress={() => run('pause', () => catalogService.setStatus(profile.id, product.id, 'paused'), 'Listing paused.')}
                loading={busy === 'pause'}
                disabled={busy !== null}
                accessibilityLabel="Pause listing"
                fullWidth
              />
            </View>
          ) : null}
          {paused ? (
            <View style={styles.actionSlot}>
              <Button
                title="Resume listing"
                onPress={() => run('resume', () => catalogService.setStatus(profile.id, product.id, 'active'), 'Listing is live again.')}
                loading={busy === 'resume'}
                disabled={busy !== null}
                accessibilityLabel="Resume listing"
                fullWidth
              />
            </View>
          ) : null}
          {!archived ? (
            <View style={styles.actionSlot}>
              <Button
                title="Lock listing"
                variant="danger"
                onPress={() => run('archive', () => catalogService.archiveProduct(profile.id, product.id), 'Listing locked.')}
                loading={busy === 'archive'}
                disabled={busy !== null}
                accessibilityLabel="Lock listing"
                fullWidth
              />
            </View>
          ) : (
            <View style={styles.actionSlot}>
              <Button
                title="Unlock"
                onPress={() =>
                  run('unlock', () => catalogService.setStatus(profile.id, product.id, 'active'), 'Listing is live again.')
                }
                loading={busy === 'unlock'}
                disabled={busy !== null}
                accessibilityLabel="Unlock listing"
                fullWidth
              />
            </View>
          )}
        </View>
      </SellerSectionCard>

      {archived ? (
        <NoticeCard
          tone="info"
          title="Locked listing"
          message="Locked products stay out of search and recommendations. Unlock to put it back on sale."
        />
      ) : null}

      <SellerSectionCard
        title="Stock"
        caption={product.hasVariants ? 'Each variant keeps its own count' : 'Adjust the count customers can buy'}
      >
        <Card style={{ marginBottom: spacing.lg }}>
          {product.hasVariants ? (
            <>
              {product.variants.map((variant) => (
                <SummaryRow
                  key={variant.id}
                  label={Object.values(variant.attributes).join(' / ') || variant.sku}
                  value={`${variant.stock} · ${taka(variant.price)}`}
                />
              ))}
              <View style={{ marginTop: spacing.md }}>
                <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Variant to adjust</Text>
                <Radio
                  selected={variantId === null}
                  label="All variants combined"
                  onPress={() => setVariantId(null)}
                  accessibilityLabel="Adjust target: all variants"
                />
                {product.variants.map((variant, index) => (
                  <Radio
                    key={variant.id}
                    selected={variantId === variant.id}
                    label={`Variant ${index + 1} · ${Object.values(variant.attributes).join(' / ') || variant.sku}`}
                    caption={`${variant.stock} in stock`}
                    onPress={() => setVariantId(variant.id)}
                    accessibilityLabel={`Adjust target: variant ${index + 1}`}
                  />
                ))}
              </View>
            </>
          ) : (
            <SummaryRow label="Available units" value={String(stock)} />
          )}
          <SummaryRow label="Alert level" value={String(product.lowStockThreshold)} />
          <View style={{ height: spacing.md }} />
          <StockAdjustPanel
            amount={amount}
            onAmountChange={setAmount}
            onAdd={() => adjust(1)}
            onRemove={() => adjust(-1)}
            busyKey={busy}
            targetLabel={targetLabel}
            caption={
              product.hasVariants && !selectedVariant
                ? 'Pick a variant above so the units land on the right option.'
                : 'Use a negative-free whole number; the count never drops below zero.'
            }
          />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard title="Stock history" caption="Every change recorded">
        {history.length === 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={type.body}>No stock movement recorded for this product yet.</Text>
          </Card>
        ) : (
          <Card style={{ marginBottom: spacing.lg }}>
            {history.map((adjustment) => (
              <View key={adjustment.id} style={styles.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.text }]}>
                    {ADJUSTMENT_REASON_LABELS[adjustment.reason] ?? adjustment.reason}
                  </Text>
                  <Text style={type.caption}>
                    {`${adjustment.variantId ? 'Variant' : 'Product'} · ${formatDateTime(adjustment.createdAt)}`}
                  </Text>
                </View>
                <Text style={[type.label, { color: adjustment.quantity > 0 ? colors.success : colors.danger }]}>
                  {`${adjustment.quantity > 0 ? '+' : '−'}${Math.abs(adjustment.quantity)}`}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </SellerSectionCard>

      <EmptyState
        title="Looking for something else?"
        message="Manage every listing from the products screen, or restock in bulk from inventory."
        actionLabel="Open products"
        onAction={() => router.replace('/seller-products')}
      />
    </Screen>
  );
}

const styles = {
  header: { flexDirection: 'row' as const, gap: spacing.lg, marginTop: spacing.md, marginBottom: spacing.lg },
  pillRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.xs, marginTop: spacing.xs },
  actionGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, marginBottom: spacing.lg },
  actionSlot: { flexGrow: 1, flexBasis: 150 },
  historyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
};

export default withSellerCapability(SellerProductDetailScreen, '/seller-products' satisfies ProtectedRoute);