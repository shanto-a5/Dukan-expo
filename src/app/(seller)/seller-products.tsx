import * as React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';

import { Button, Card, Field, Screen, SectionHeader } from '@/components/ui';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { EmptyState, FilterTabs } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { MetricCard, SellerProductRow } from '@/modules/seller/seller-ui';
import { SwipeActionRow } from '@/modules/seller/swipe-action-row';
import {
  catalogService,
  productStock,
  type BulkResult,
  type SellerProductListOptions,
} from '@/services/catalog-service';
import { sellerService } from '@/services/seller-service';
import type { Product, ProductStatus } from '@/domain/types';
import { colors, radius, spacing, type } from '@/theme/tokens';

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

type ToolbarIcon = {
  ios: 'line.3.horizontal.decrease' | 'checklist';
  android: 'filter_list' | 'checklist';
  web: 'filter_list' | 'checklist';
};

/** Compact icon-only control matching the shared `Button` box and hit area. */
function ToolbarIconButton({
  label,
  accessibilityHint,
  icon,
  active,
  onPress,
}: {
  label: string;
  accessibilityHint: string;
  icon: ToolbarIcon;
  active?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!active }}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, pressed && styles.iconButtonPressed]}
    >
      <SymbolView name={icon} size={20} weight={ICON_WEIGHT} tintColor={active ? colors.primary : colors.textMuted} />
    </Pressable>
  );
}

type FilterKey = NonNullable<SellerProductListOptions['status']>;
type SortKey = NonNullable<SellerProductListOptions['sort']>;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Live' },
  { key: 'draft', label: 'Drafts' },
  { key: 'paused', label: 'Paused' },
  { key: 'low', label: 'Low' },
  { key: 'out', label: 'Out' },
  { key: 'archived', label: 'Lock 🔒' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: 'Recent' },
  { key: 'name', label: 'A–Z' },
  { key: 'price_asc', label: 'Price ↑' },
  { key: 'price_desc', label: 'Price ↓' },
  { key: 'stock', label: 'Stock' },
];

/** Media problems a seller can fix without opening the listing (M6-D). */
function mediaWarning(images: string[], hasVariants: boolean, variantCount: number): string | undefined {
  if (images.length === 0) return 'No photo — add one before publishing';
  if (images.length === 1) return 'Only one photo — add another angle';
  if (hasVariants && images.length < variantCount) return 'Fewer photos than variants';
  return undefined;
}

function SellerProductsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [sort, setSort] = React.useState<SortKey>('updated');
  const [search, setSearch] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<string>('all');
  const [minPrice, setMinPrice] = React.useState('');
  const [maxPrice, setMaxPrice] = React.useState('');
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [stockDelta, setStockDelta] = React.useState('5');
  const [bulkResult, setBulkResult] = React.useState<BulkResult | null>(null);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const rowOpenRef = React.useRef<{ close: () => void } | null>(null);
  const listing = useListingCache(session.user?.id, 'products');

  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const summary = sellerId ? catalogService.catalogSummary(sellerId) : null;
  const categories = sellerId ? catalogService.categoryOptionsForSeller(sellerId) : [];
  const products = sellerId
    ? catalogService.sellerProductList(sellerId, {
        status: filter,
        search,
        sort,
        categoryId: categoryId === 'all' ? undefined : categoryId,
        minPrice: minPrice.trim() === '' ? undefined : Number(minPrice),
        maxPrice: maxPrice.trim() === '' ? undefined : Number(maxPrice),
      })
    : [];

  if (!sellerId) {
    return (
      <Screen padded>
        <Text style={[type.h1, { color: colors.text }]}>Products</Text>
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there are no listings to manage."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      </Screen>
    );
  }

  const counts: Record<FilterKey, number> = {
    all: summary?.total ?? 0,
    active: summary?.active ?? 0,
    draft: summary?.draft ?? 0,
    paused: summary?.paused ?? 0,
    pending: 0,
    low: summary?.lowStock ?? 0,
    out: summary?.outOfStock ?? 0,
    out_of_stock: summary?.outOfStock ?? 0,
    archived: summary?.archived ?? 0,
  };

  const filtersActive =
    search.trim() !== '' || categoryId !== 'all' || minPrice.trim() !== '' || maxPrice.trim() !== '';

  const clearFilters = (): void => {
    setSearch('');
    setCategoryId('all');
    setMinPrice('');
    setMaxPrice('');
  };

  const toggle = (id: string): void => {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };

  const runBulk = async (action: () => Promise<BulkResult>): Promise<void> => {
    try {
      setBulkResult(await action());
      setSelected([]);
      refresh();
    } catch (caught) {
      setBulkResult({
        succeeded: [],
        failed: [{ id: '-', name: 'Bulk action', ok: false, reason: caught instanceof Error ? caught.message : 'Failed' }],
        summary: 'Nothing changed',
      });
    }
  };

  const runBulkStatus = (status: ProductStatus): void => {
    void runBulk(() => catalogService.bulkSetStatus(sellerId, selected, status));
  };

  const runBulkStock = (delta: number, reason: 'restock' | 'manual'): void => {
    void runBulk(() => catalogService.bulkAdjustStock(sellerId, selected, delta, reason));
  };

  const handleRowOpen = (methods: { close: () => void }): void => {
    if (rowOpenRef.current && rowOpenRef.current !== methods) rowOpenRef.current.close();
    rowOpenRef.current = methods;
  };

  const handleRowClose = (methods: { close: () => void }): void => {
    if (rowOpenRef.current === methods) rowOpenRef.current = null;
  };

  const toggleLock = async (product: Product): Promise<void> => {
    const next: ProductStatus = product.status === 'archived' ? 'active' : 'archived';
    setRowError(null);
    setRowBusy(product.id);
    try {
      await catalogService.setStatus(sellerId, product.id, next);
      refresh();
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : 'That action is not possible right now.');
      throw caught;
    } finally {
      setRowBusy(null);
    }
  };

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
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text }]}>Products</Text>
          <Text style={type.caption}>{`${summary?.total ?? 0} listing(s) · ${summary?.unitsInStock ?? 0} unit(s) in stock`}</Text>
        </View>
        <Button
          title="New product"
          onPress={() => router.push('/seller-product/new')}
          accessibilityLabel="New product"
        />
      </View>

      <View style={styles.metricRow}>
        <MetricCard label="Live" value={String(counts.active)} tone="success" />
        <MetricCard label="Low stock" value={String(counts.low)} tone={counts.low > 0 ? 'warning' : 'default'} />
        <MetricCard label="Out of stock" value={String(counts.out)} tone={counts.out > 0 ? 'warning' : 'default'} />
      </View>

      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, brand or SKU"
            accessibilityLabel="Search products"
            returnKeyType="search"
            style={styles.searchField}
          />
        </View>
        <ToolbarIconButton
          label={showAdvanced ? 'Hide filters and sort' : 'Show filters and sort'}
          accessibilityHint="Opens the category, sort and price controls"
          icon={{ ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' }}
          active={showAdvanced}
          onPress={() => setShowAdvanced((current) => !current)}
        />
        <ToolbarIconButton
          label={selectionMode ? 'Exit bulk selection' : 'Select listings'}
          accessibilityHint={
            selectionMode
              ? 'Leaves bulk selection mode and clears the selection'
              : 'Enables bulk selection of listings'
          }
          icon={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
          active={selectionMode}
          onPress={() => {
            setSelectionMode((current) => !current);
            setSelected([]);
          }}
        />
      </View>

      {showAdvanced ? (
        <View style={{ marginBottom: spacing.md }}>
          {categories.length ? (
            <>
              <Text style={[type.caption, { marginBottom: spacing.xs }]}>Category</Text>
              <FilterTabs
                tabs={[
                  { key: 'all', label: 'All' },
                  ...categories.map((entry) => ({ key: entry.id, label: `${entry.label} ${entry.count}` })),
                ]}
                active={categoryId}
                onChange={setCategoryId}
              />
            </>
          ) : null}
          <Text style={[type.caption, { marginBottom: spacing.xs }]}>Sort</Text>
          <FilterTabs tabs={SORTS} active={sort} onChange={(key) => setSort(key as SortKey)} />
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <Field
                value={minPrice}
                onChangeText={setMinPrice}
                label="Min price"
                keyboardType="number-pad"
                placeholder="0"
                accessibilityLabel="Minimum price"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                value={maxPrice}
                onChangeText={setMaxPrice}
                label="Max price"
                keyboardType="number-pad"
                placeholder="50000"
                accessibilityLabel="Maximum price"
              />
            </View>
          </View>
          {filtersActive ? (
            <Button
              title="Clear filters"
              variant="ghost"
              onPress={clearFilters}
              accessibilityLabel="Clear all filters"
              fullWidth
            />
          ) : null}
        </View>
      ) : null}

      <FilterTabs
        scrollable
        tabs={FILTERS.map((entry) => ({ key: entry.key, label: `${entry.label} ${counts[entry.key]}` }))}
        active={filter}
        onChange={(key) => {
          setFilter(key as FilterKey);
          setSelected([]);
        }}
      />

      {bulkResult ? (
        <View style={{ marginBottom: spacing.md }}>
          <NoticeCard
            tone={bulkResult.failed.length ? 'warning' : 'success'}
            title={bulkResult.summary}
            message={
              bulkResult.failed.length
                ? bulkResult.failed.map((entry) => `${entry.name}: ${entry.reason}`).join('\n')
                : 'Every selected listing was updated.'
            }
            onDismiss={() => setBulkResult(null)}
          />
        </View>
      ) : null}

      {selectionMode ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={styles.bulkHead}>
            <Text style={[type.label, { color: colors.text }]}>
              {selected.length ? `${selected.length} selected` : 'Select listings'}
            </Text>
            <Button
              title={selectionMode ? 'Done' : 'Select'}
              variant="ghost"
              onPress={() => {
                setSelectionMode(false);
                setSelected([]);
              }}
              accessibilityLabel="Exit bulk selection"
            />
          </View>
          <View style={styles.bulkActions}>
            <Button
              title="Publish"
              variant="secondary"
              disabled={selected.length === 0}
              onPress={() => runBulkStatus('active')}
              accessibilityLabel="Bulk publish selected listings"
            />
            <Button
              title="Pause"
              variant="secondary"
              disabled={selected.length === 0}
              onPress={() => runBulkStatus('paused')}
              accessibilityLabel="Bulk pause selected listings"
            />
            <Button
              title="Lock"
              variant="secondary"
              disabled={selected.length === 0}
              onPress={() => runBulkStatus('archived')}
              accessibilityLabel="Bulk lock selected listings"
            />
            <Button
              title="Restore"
              variant="secondary"
              disabled={selected.length === 0}
              onPress={() => runBulkStatus('draft')}
              accessibilityLabel="Bulk restore selected listings as draft"
            />
          </View>
          <View style={styles.bulkActions}>
            <View style={{ flex: 1 }}>
              <Field
                value={stockDelta}
                onChangeText={setStockDelta}
                label="Stock change"
                keyboardType="number-pad"
                placeholder="5"
                hint="Use a minus number to remove stock"
                accessibilityLabel="Stock change amount"
              />
            </View>
            <View style={styles.stockButtons}>
              <Button
                title="Add"
                variant="secondary"
                disabled={selected.length === 0}
                onPress={() => runBulkStock(Math.abs(Number(stockDelta) || 0), 'restock')}
                accessibilityLabel="Add stock to selected listings"
              />
              <Button
                title="Remove"
                variant="secondary"
                disabled={selected.length === 0}
                onPress={() => runBulkStock(-Math.abs(Number(stockDelta) || 0), 'manual')}
                accessibilityLabel="Remove stock from selected listings"
              />
            </View>
          </View>
        </Card>
      ) : null}

      {rowError ? (
        <View style={{ marginBottom: spacing.md }}>
          <NoticeCard tone="danger" title="Action blocked" message={rowError} onDismiss={() => setRowError(null)} />
        </View>
      ) : null}

      {listing.error ? (
        <View style={styles.refreshNotice}>
          <Text style={styles.refreshNoticeText} numberOfLines={2}>
            {`Couldn't refresh — showing saved products.${listing.error ? ` ${listing.error}` : ''}`}
          </Text>
          <Pressable onPress={listing.retry} accessibilityRole="button" accessibilityLabel="Retry refreshing products" hitSlop={8}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!listing.loaded && !listing.error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={type.caption}>Loading your listings…</Text>
        </View>
      ) : products.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No listing matches these filters' : 'Nothing in this filter'}
          message={
            filtersActive
              ? 'Try widening the price range, another category, or clear the filters.'
              : search
                ? 'Try a shorter search, or clear it to see every listing.'
                : filter === 'all'
                  ? 'Publish your first product to start selling on Vanta.'
                  : 'Switch to another filter to see the rest of your listings.'
          }
          actionLabel={filtersActive ? 'Clear filters' : filter === 'all' && !search ? 'Add product' : undefined}
          onAction={
            filtersActive
              ? clearFilters
              : filter === 'all' && !search
                ? () => router.push('/seller-product/new')
                : undefined
          }
        />
      ) : (
        <>
          <SectionHeader
            title={`Listings${selectionMode ? '' : ` (${products.length})`}`}
            caption={selectionMode ? 'Tap a row to select it, then apply a bulk action' : 'Tap a row to edit stock, pricing or visibility'}
          />
          {products.map((product) => {
            const locked = product.status === 'archived';
            const row = (
              <SellerProductRow
                product={product}
                stock={productStock(product)}
                footnote={product.hasVariants ? `${product.variants.length} variant(s)` : undefined}
                mediaWarning={mediaWarning(product.images, product.hasVariants, product.variants.length)}
                selectionMode={selectionMode}
                selected={selected.includes(product.id)}
                onToggle={() => toggle(product.id)}
                style={selectionMode ? undefined : styles.rowInSwipe}
                onPress={() => router.push({ pathname: '/seller-product/[id]', params: { id: product.id } })}
              />
            );
            if (selectionMode) {
              return <React.Fragment key={product.id}>{row}</React.Fragment>;
            }
            return (
              <SwipeActionRow
                key={product.id}
                action={{
                  label: locked ? 'Unlock' : 'Lock',
                  accessibilityLabel: `${locked ? 'Unlock' : 'Lock'} ${product.name}`,
                  icon: locked
                    ? { ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' }
                    : { ios: 'lock.fill', android: 'lock', web: 'lock' },
                  tone: locked ? 'primary' : 'danger',
                  busy: rowBusy === product.id,
                  disabled: rowBusy !== null && rowBusy !== product.id,
                  onPress: () => toggleLock(product),
                }}
                onOpen={handleRowOpen}
                onClose={handleRowClose}
              >
                {row}
              </SwipeActionRow>
            );
          })}
        </>
      )}

      <Button
        title="Seller dashboard"
        variant="ghost"
        onPress={() => router.navigate('/seller-dashboard')}
        accessibilityLabel="Seller dashboard"
        fullWidth
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
  metricRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  searchWrap: { flex: 1 },
  searchField: { marginBottom: 0 },
  rowInSwipe: { marginBottom: 0 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  iconButtonPressed: { opacity: 0.86 },
  priceRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  bulkHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  bulkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  stockButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingTop: spacing.lg },
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  refreshNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  refreshNoticeText: { flex: 1, color: colors.textMuted, fontSize: 13 },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700' },
});

export default withSellerCapability(SellerProductsScreen, '/seller-products' satisfies ProtectedRoute);
