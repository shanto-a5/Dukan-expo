import * as React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Field, ProductImage, SectionHeader, taka } from '@/components/ui';
import { Radio } from '@/modules/checkout/checkout-ui';
import { Pill } from '@/modules/orders/order-ui';
import type { Product, ProductStatus } from '@/domain/types';
import { catalogService, effectivePrice, type SellerAdjustmentEntry } from '@/services/catalog-service';
import { mediaService } from '@/services/media-service';
import { makePaletteImage } from '@/utils/image';
import { formatDateTime } from '@/utils/time';
import { colors, radius, spacing, type } from '@/theme/tokens';

type Tone = 'info' | 'success' | 'warning' | 'neutral';

const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  pending: 'Pending review',
  active: 'Live',
  paused: 'Paused',
  out_of_stock: 'Out of stock',
  archived: 'Locked',
};

const PRODUCT_STATUS_TONES: Record<ProductStatus, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  active: 'success',
  paused: 'warning',
  out_of_stock: 'warning',
  archived: 'neutral',
};

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  sale: 'Sold on Vanta',
  restock: 'Restocked',
  manual: 'Manual correction',
  cancellation: 'Order cancelled',
  return: 'Customer return',
};

const SELLER_ICON = { ios: 'storefront', android: 'storefront', web: 'storefront' } as const;
const LOCKED_ICON = { ios: 'lock.fill', android: 'lock', web: 'lock' } as const;
const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

/**
 * The single Vanta "store" glyph used wherever the seller experience is
 * branded (Settings entry and the Seller mode marker).
 */
export function SellerGlyph({
  size = 16,
  tintColor = colors.primary,
}: {
  size?: number;
  tintColor?: string;
}): React.JSX.Element {
  return <SymbolView name={SELLER_ICON} size={size} weight={ICON_WEIGHT} tintColor={tintColor} />;
}

/**
 * Persistent "Seller mode" marker rendered by the seller workspace shell.
 *
 * Purely presentational context, never interactive. It sits in the exact band
 * that `Screen` reserves as top padding (`insets.top + spacing.lg`), so it is
 * pinned near the top of the screen without ever overlapping titles, back
 * controls, touch targets or scrolling content, and it stays visible while
 * navigating between seller screens.
 */
export function SellerModeBadge(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Currently in Seller mode"
      style={[styles.modeBadgeWrap, { height: insets.top + spacing.lg }]}
    >
      <View style={styles.modeBadge}>
        <SellerGlyph size={12} />
        <Text style={styles.modeBadgeText}>SELLER</Text>
      </View>
    </View>
  );
}

export function productStatusLabel(status: ProductStatus): string {
  return PRODUCT_STATUS_LABELS[status];
}

export function ProductStatusPill({ status }: { status: ProductStatus }): React.JSX.Element {
  return <Pill label={PRODUCT_STATUS_LABELS[status]} tone={PRODUCT_STATUS_TONES[status]} />;
}

export function StockPill({ stock, threshold }: { stock: number; threshold: number }): React.JSX.Element {
  if (stock <= 0) return <Pill label="Out of stock" tone="warning" />;
  if (stock <= threshold) return <Pill label={`Low · ${stock} left`} tone="warning" />;
  return <Pill label={`${stock} in stock`} tone="success" />;
}

export function MetricCard({
  label,
  value,
  caption,
  tone = 'default',
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning';
  onPress?: () => void;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const valueColor =
    tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : tone === 'warning' ? colors.danger : colors.text;
  const body = (
    <Card
      style={{
        flex: 1,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        ...(onPress ? { borderColor: colors.primary } : null),
      }}
    >
      <Text style={type.caption}>{label}</Text>
      <Text style={[type.h2, { color: valueColor, marginTop: spacing.xs }]}>{value}</Text>
      {caption ? <Text style={[type.caption, { marginTop: 2 }]}>{caption}</Text> : null}
    </Card>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
      style={({ pressed }) => [styles.metricWrap, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

export function SellerProductRow({
  product,
  stock,
  onPress,
  footnote,
  selectionMode,
  selected,
  onToggle,
  mediaWarning,
  style,
}: {
  product: Product;
  stock: number;
  onPress: () => void;
  footnote?: string;
  /** Bulk-selection mode (M6-C): the row becomes a checkbox target. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  /** Media quality note (M6-D), derived from the listing itself. */
  mediaWarning?: string;
  /** Extra spacing/layout from the caller (e.g. a swipe wrapper owns the gap). */
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const locked = product.status === 'archived';
  return (
    <Pressable
      onPress={selectionMode && onToggle ? onToggle : onPress}
      accessibilityRole="button"
      accessibilityState={selectionMode ? { selected: Boolean(selected) } : undefined}
      accessibilityLabel={
        selectionMode
          ? `${selected ? 'Deselect' : 'Select'} ${product.name}, ${productStatusLabel(product.status)}, ${stock} in stock`
          : `Open ${product.name}, ${productStatusLabel(product.status)}`
      }
      style={({ pressed }) => [
        styles.productRow,
        locked ? styles.productRowLocked : null,
        selected ? styles.productRowSelected : null,
        style,
        pressed ? styles.pressed : null,
      ]}
    >
      {selectionMode ? (
        <View style={[styles.checkbox, selected ? styles.checkboxOn : null]}>
          <Text style={styles.checkboxGlyph}>{selected ? '✓' : ''}</Text>
        </View>
      ) : (
        <ProductImage uri={product.images[0]} size={64} />
      )}
      <View style={styles.productRowBody}>
        <Text style={[type.label, { color: colors.text }]} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {`${product.brand} � ${product.sku}`}
        </Text>
        {footnote ? (
          <Text style={type.caption} numberOfLines={1}>
            {footnote}
          </Text>
        ) : null}
        {mediaWarning ? (
          <Text style={[type.caption, { color: colors.danger }]} numberOfLines={1}>
            {mediaWarning}
          </Text>
        ) : null}
        <View style={styles.pillRow}>
          {locked ? (
            <View style={styles.lockBadge}>
              <SymbolView name={LOCKED_ICON} size={11} weight={ICON_WEIGHT} tintColor={colors.textInverse} />
              <Text style={styles.lockBadgeText}>Locked</Text>
            </View>
          ) : (
            <ProductStatusPill status={product.status} />
          )}
          <StockPill stock={stock} threshold={product.lowStockThreshold} />
        </View>
      </View>
      <Text style={[type.label, { color: colors.primary }]}>{taka(effectivePrice(product))}</Text>
    </Pressable>
  );
}


export function AdjustmentRow({ entry }: { entry: SellerAdjustmentEntry }): React.JSX.Element {
  const { adjustment, productName } = entry;
  const added = adjustment.quantity > 0;
  return (
    <View style={styles.adjustmentRow}>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
          {productName}
        </Text>
        <Text style={type.caption}>
          {`${ADJUSTMENT_REASON_LABELS[adjustment.reason] ?? adjustment.reason} · ${formatDateTime(adjustment.createdAt)}`}
        </Text>
      </View>
      <Text style={[type.label, { color: added ? colors.success : colors.danger }]}>
        {`${added ? '+' : '−'}${Math.abs(adjustment.quantity)}`}
      </Text>
    </View>
  );
}

export function StockAdjustPanel({
  amount,
  onAmountChange,
  onAdd,
  onRemove,
  busyKey,
  caption,
  targetLabel,
}: {
  amount: string;
  onAmountChange: (value: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  busyKey: string | null;
  caption: string;
  targetLabel: string;
}): React.JSX.Element {
  return (
    <View>
      <Text style={[type.caption, { marginBottom: spacing.sm }]}>{caption}</Text>
      <Field
        value={amount}
        onChangeText={onAmountChange}
        label={`Units to adjust (${targetLabel})`}
        keyboardType="number-pad"
        placeholder="5"
      />
      <View style={styles.actionRow}>
        <View style={styles.actionSlot}>
          <Button title="Add units" onPress={onAdd} loading={busyKey === 'add'} disabled={busyKey !== null} />
        </View>
        <View style={styles.actionSlot}>
          <Button
            title="Remove units"
            variant="secondary"
            onPress={onRemove}
            loading={busyKey === 'remove'}
            disabled={busyKey !== null}
          />
        </View>
      </View>
    </View>
  );
}

export function ProductImageField({
  images,
  onChange,
  error,
}: {
  images: string[];
  onChange: (next: string[]) => void;
  error?: string | null;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const pick = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await mediaService.pickImage();
      if (result.status === 'cancelled') return;
      if (result.status === 'unavailable') {
        setMessage(result.message);
        return;
      }
      // The picked file lives on this device only. Uploading it first is what
      // lets customers see the photo: the product must store the hosted URL, not
      // the local `file://` URI, which no other device can read.
      const url = await mediaService.uploadImage(result.uri);
      onChange([...images, url].slice(0, 4));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `The photo could not be uploaded: ${error.message}`
          : 'The photo could not be uploaded. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Photos</Text>
      <View style={styles.imageRow}>
        {images.length === 0 ? (
          <View style={[styles.imageEmpty, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={type.caption}>No photo yet</Text>
          </View>
        ) : (
          images.map((uri, index) => (
            <View key={`${uri}-${index}`} style={styles.imageSlot}>
              <ProductImage uri={uri} size={72} />
              <Pressable
                onPress={() => onChange(images.filter((_, position) => position !== index))}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                hitSlop={6}
                style={styles.imageRemove}
              >
                <Text style={styles.imageRemoveText}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
      <View style={styles.actionRow}>
        <View style={styles.actionSlot}>
          <Button title="Choose photo" variant="secondary" onPress={pick} loading={busy} />
        </View>
        <View style={styles.actionSlot}>
          <Button
            title="Add placeholder"
            variant="ghost"
            onPress={() => onChange([...images, makePaletteImage('🛍️', `listing-${images.length + 1}`)].slice(0, 4))}
          />
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
    </View>
  );
}

export function CategoryPicker({
  categoryId,
  subcategoryId,
  onChange,
  error,
}: {
  categoryId: string;
  subcategoryId: string | null;
  onChange: (categoryId: string, subcategoryId: string | null) => void;
  error?: string | null;
}): React.JSX.Element {
  const categories = catalogService.getTree();
  const subcategories = categoryId ? catalogService.childrenOf(categoryId) : [];

  return (
    <View>
      <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Category</Text>
      {categories.map((category) => (
        <Radio
          key={category.id}
          selected={categoryId === category.id}
          label={`${category.icon} ${category.name}`}
          onPress={() => onChange(category.id, null)}
          accessibilityLabel={`Category: ${category.name}`}
        />
      ))}
      {subcategories.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Subcategory (optional)</Text>
          {subcategories.map((subcategory) => (
            <Radio
              key={subcategory.id}
              selected={subcategoryId === subcategory.id}
              label={subcategory.name}
              onPress={() => onChange(categoryId, subcategory.id)}
              accessibilityLabel={`Subcategory: ${subcategory.name}`}
            />
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export interface VariantDraftRow {
  key: string;
  sku: string;
  attributes: Record<string, string>;
  price: string;
  stock: string;
}

export function VariantEditor({
  rows,
  attributeKeys,
  baseSku,
  onChange,
  onAttributeKeysChange,
  error,
}: {
  rows: VariantDraftRow[];
  attributeKeys: string[];
  baseSku: string;
  onChange: (rows: VariantDraftRow[]) => void;
  onAttributeKeysChange: (keys: string[]) => void;
  error?: string | null;
}): React.JSX.Element {
  const update = (key: string, patch: Partial<VariantDraftRow>): void => {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = (): void => {
    onChange([
      ...rows,
      {
        key: `v${rows.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
        sku: baseSku ? `${baseSku}-${rows.length + 1}` : '',
        attributes: Object.fromEntries(attributeKeys.map((keyName) => [keyName, ''])),
        price: '',
        stock: '0',
      },
    ]);
  };

  const addAttribute = (): void => {
    const next = `Option ${attributeKeys.length + 1}`;
    onAttributeKeysChange([...attributeKeys, next]);
    onChange(
      rows.map((row) => ({ ...row, attributes: { ...row.attributes, [next]: '' } })),
    );
  };

  return (
    <View>
      <View style={styles.variantHeader}>
        <Text style={type.label}>Variants</Text>
        <Pressable onPress={addAttribute} accessibilityRole="button" accessibilityLabel="Add variant option" hitSlop={8}>
          <Text style={styles.linkText}>Add option</Text>
        </Pressable>
      </View>
      {rows.map((row, index) => (
        <Card key={row.key} style={styles.variantCard}>
          <View style={styles.variantHeader}>
            <Text style={type.label}>{`Variant ${index + 1}`}</Text>
            {rows.length > 1 ? (
              <Pressable
                onPress={() => onChange(rows.filter((entry) => entry.key !== row.key))}
                accessibilityRole="button"
                accessibilityLabel={`Remove variant ${index + 1}`}
                hitSlop={8}
              >
                <Text style={styles.dangerText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          {attributeKeys.map((keyName) => (
            <Field
              key={keyName}
              value={row.attributes[keyName] ?? ''}
              onChangeText={(value) => update(row.key, { attributes: { ...row.attributes, [keyName]: value } })}
              label={keyName}
              placeholder="Red"
            />
          ))}
          <Field
            value={row.price}
            onChangeText={(value) => update(row.key, { price: value })}
            label="Variant price"
            keyboardType="number-pad"
            placeholder="1200"
          />
          <Field
            value={row.stock}
            onChangeText={(value) => update(row.key, { stock: value })}
            label="Variant stock"
            keyboardType="number-pad"
            placeholder="10"
          />
          <Field
            value={row.sku}
            onChangeText={(value) => update(row.key, { sku: value })}
            label="Variant SKU"
            autoCapitalize="characters"
            placeholder={`${baseSku || 'SKU'}-1`}
          />
        </Card>
      ))}
      <Button title="Add variant" variant="secondary" onPress={addRow} fullWidth />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function HighlightEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  return (
    <View>
      <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>Highlights</Text>
      {values.map((value, index) => (
        <View key={`highlight-${index}`} style={styles.highlightRow}>
          <View style={{ flex: 1 }}>
            <Field
              value={value}
              onChangeText={(text) => onChange(values.map((entry, position) => (position === index ? text : entry)))}
              placeholder="What makes this product worth buying?"
            />
          </View>
          <Pressable
            onPress={() => onChange(values.filter((_, position) => position !== index))}
            accessibilityRole="button"
            accessibilityLabel={`Remove highlight ${index + 1}`}
            hitSlop={8}
            style={styles.highlightRemove}
          >
            <Text style={styles.dangerText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {values.length < 5 ? (
        <Button
          title="Add highlight"
          variant="ghost"
          onPress={() => onChange([...values, ''])}
          fullWidth
        />
      ) : null}
    </View>
  );
}

export function SellerSectionCard({
  title,
  caption,
  children,
  actionLabel,
  onAction,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionHeader title={title} caption={caption} actionLabel={actionLabel} onAction={onAction} />
      {children}
    </View>
  );
}

export function categoryNameOf(categoryId: string, subcategoryId: string | null): string {
  const category = catalogService.getCategory(categoryId);
  const subcategory = subcategoryId ? catalogService.getCategory(subcategoryId) : undefined;
  if (category && subcategory) return `${category.name} · ${subcategory.name}`;
  return category?.name ?? 'Uncategorised';
}

const styles = StyleSheet.create({
  modeBadgeWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.primary,
  },
  metricWrap: { flex: 1 },
  pressed: { opacity: 0.85 },
  productRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxGlyph: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  productRowLocked: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  productRowBody: { flex: 1, gap: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  lockBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textInverse },
  adjustmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionSlot: { flex: 1 },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  imageSlot: { alignItems: 'center', gap: 2 },
  imageEmpty: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRemove: { paddingHorizontal: spacing.xs },
  imageRemoveText: { ...type.caption, color: colors.danger, fontWeight: '700' },
  errorText: { ...type.caption, color: colors.danger, marginTop: spacing.xs },
  variantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  variantCard: { marginBottom: spacing.md, backgroundColor: colors.surfaceMuted },
  linkText: { ...type.caption, color: colors.primary, fontWeight: '700' },
  dangerText: { ...type.caption, color: colors.danger, fontWeight: '700' },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  highlightRemove: { paddingHorizontal: spacing.xs, paddingBottom: spacing.lg },
});
