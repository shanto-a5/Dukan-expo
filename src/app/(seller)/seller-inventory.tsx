import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, ProductImage, Screen, SectionHeader, taka } from '@/components/ui';
import { NoticeCard, Radio, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState, FilterTabs } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { AdjustmentRow, ProductStatusPill, SellerSectionCard, StockAdjustPanel, StockPill } from '@/modules/seller/seller-ui';
import { catalogService } from '@/services/catalog-service';
import { sellerService } from '@/services/seller-service';
import type { ProductStatus } from '@/domain/types';
import { colors, spacing, type } from '@/theme/tokens';

type Scope = 'all' | 'low' | 'out';

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
];

function SellerInventoryScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [scope, setScope] = React.useState<Scope>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [variantId, setVariantId] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState('5');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const rows = sellerId ? catalogService.inventoryForSeller(sellerId, scope) : [];
  const selected = rows.find((row) => row.product.id === selectedId) ?? null;
  const recent = sellerId ? catalogService.recentAdjustments(sellerId, 12) : [];

  if (!sellerId) {
    return (
      <Screen padded>
        <Text style={[type.h1, { color: colors.text }]}>Inventory</Text>
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there is no inventory to manage."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      </Screen>
    );
  }

  const low = catalogService.inventoryForSeller(sellerId, 'low');
  const out = catalogService.inventoryForSeller(sellerId, 'out');
  const units = rows.reduce((sum, row) => sum + row.stock, 0);
  const selectedVariant = selected?.variants.find((variant) => variant.id === variantId) ?? null;
  const targetLabel = selectedVariant ? selectedVariant.label : selected?.product.name ?? '';

  const run = async (key: string, action: () => unknown, successMessage: string): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy(key);
    try {
      await action();
      setMessage(successMessage);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That stock change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const adjust = (direction: 1 | -1): void => {
    if (!selected) return;
    const unitsToAdd = Number(amount);
    void run(
      direction === 1 ? 'add' : 'remove',
      () =>
        catalogService.adjustStock(
          sellerId,
          selected.product.id,
          direction * unitsToAdd,
          direction === 1 ? 'restock' : 'manual',
          selectedVariant?.id ?? null,
        ),
      direction === 1
        ? `Added ${unitsToAdd} unit(s) to ${targetLabel}.`
        : `Removed ${unitsToAdd} unit(s) from ${targetLabel}.`,
    );
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-dashboard" />
      <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Inventory</Text>
      <Text style={[type.caption, { marginBottom: spacing.lg }]}>
        {`${units} unit(s) in this view · ${low.length} low · ${out.length} out of stock`}
      </Text>

      {error ? <NoticeCard tone="danger" title="Action blocked" message={error} onDismiss={() => setError(null)} /> : null}
      {message ? <NoticeCard tone="success" title="Stock updated" message={message} onDismiss={() => setMessage(null)} /> : null}

      {low.length + out.length > 0 ? (
        <NoticeCard
          tone="warning"
          title="Restock before you sell out"
          message={`${low.length} product(s) are at their alert level and ${out.length} cannot be bought right now.`}
        />
      ) : null}

      <FilterTabs tabs={SCOPES.map((entry) => ({ key: entry.key, label: entry.label }))} active={scope} onChange={(key) => setScope(key as Scope)} />

      {rows.length === 0 ? (
        <EmptyState
          title={scope === 'all' ? 'No products yet' : 'Nothing in this filter'}
          message={
            scope === 'all'
              ? 'Publish a product and it will show up here with its stock count.'
              : 'Everything is above its alert level. Check the All tab for the full picture.'
          }
          actionLabel={scope === 'all' ? 'Add product' : undefined}
          onAction={scope === 'all' ? () => router.push('/seller-product/new') : undefined}
        />
      ) : (
        <>
          <SectionHeader title="Stock levels" caption="Tap a product to adjust its count" />
          {rows.map((row) => (
            <PressableRow
              key={row.product.id}
              name={row.product.name}
              image={row.product.images[0]}
              stock={row.stock}
              threshold={row.threshold}
              statusLabel={row.product.status}
              selected={row.product.id === selectedId}
              variants={row.variants.length}
              onPress={() => {
                setSelectedId(row.product.id);
                setVariantId(null);
              }}
            />
          ))}
        </>
      )}

      {selected ? (
        <SellerSectionCard title="Adjust stock" caption={selected.product.name}>
          <Card style={{ marginBottom: spacing.lg }}>
            <SummaryRow label="Current count" value={`${selected.stock} unit(s)`} />
            <SummaryRow label="Alert level" value={String(selected.threshold)} />
            {selected.variants.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Variant</Text>
                <Radio
                  selected={variantId === null}
                  label="Choose a variant first"
                  onPress={() => setVariantId(null)}
                  accessibilityLabel="Inventory variant: choose first"
                />
                {selected.variants.map((variant) => (
                  <Radio
                    key={variant.id}
                    selected={variantId === variant.id}
                    label={variant.label}
                    caption={`${variant.stock} in stock · ${taka(variant.price)}`}
                    onPress={() => setVariantId(variant.id)}
                    accessibilityLabel={`Inventory variant: ${variant.label}`}
                  />
                ))}
              </View>
            ) : null}
            <View style={{ height: spacing.md }} />
            <StockAdjustPanel
              amount={amount}
              onAmountChange={setAmount}
              onAdd={() => adjust(1)}
              onRemove={() => adjust(-1)}
              busyKey={busy}
              targetLabel={targetLabel}
              caption={
                selected.variants.length > 0 && !selectedVariant
                  ? 'Pick the variant that received the units.'
                  : 'Counts never drop below zero, and every change is recorded.'
              }
            />
          </Card>
        </SellerSectionCard>
      ) : null}

      <SellerSectionCard
        title="Recent adjustments"
        caption="Restocks, corrections and marketplace movements"
        actionLabel="All products"
        onAction={() => router.push('/seller-products')}
      >
        {recent.length === 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={type.body}>No stock movement recorded yet.</Text>
          </Card>
        ) : (
          <Card style={{ marginBottom: spacing.lg }}>
            {recent.map((entry) => (
              <AdjustmentRow key={entry.adjustment.id} entry={entry} />
            ))}
          </Card>
        )}
      </SellerSectionCard>
    </Screen>
  );
}

function PressableRow({
  name,
  image,
  stock,
  threshold,
  statusLabel,
  selected,
  variants,
  onPress,
}: {
  name: string;
  image?: string;
  stock: number;
  threshold: number;
  statusLabel: ProductStatus;
  selected: boolean;
  variants: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Card style={{ marginBottom: spacing.md, ...(selected ? { borderColor: colors.primary } : null) }}>
      <Text style={[type.label, { color: colors.text }]}>{name}</Text>
      <View style={styles.rowBody}>
        <ProductImage uri={image} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={type.caption}>{`Alert level ${threshold}${variants > 0 ? ` · ${variants} variant(s)` : ''}`}</Text>
          <View style={styles.pillRow}>
            <ProductStatusPill status={statusLabel} />
            <StockPill stock={stock} threshold={threshold} />
          </View>
        </View>
        <Button
          title={selected ? 'Selected' : 'Adjust'}
          variant={selected ? 'primary' : 'secondary'}
          onPress={onPress}
          accessibilityLabel={`Adjust stock for ${name}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});

export default withSellerCapability(SellerInventoryScreen, '/seller-inventory' satisfies ProtectedRoute);
