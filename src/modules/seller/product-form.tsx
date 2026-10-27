import * as React from 'react';
import { Text, View } from 'react-native';



import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, SectionHeader } from '@/components/ui';
import { NoticeCard, Radio } from '@/modules/checkout/checkout-ui';
import {
  CategoryPicker,
  HighlightEditor,
  ProductImageField,
  VariantEditor,
  type VariantDraftRow,
} from '@/modules/seller/seller-ui';
import { catalogService, ProductValidationError, type ProductDraftInput, type ProductFieldErrors } from '@/services/catalog-service';
import { sellerService } from '@/services/seller-service';
import type { Product } from '@/domain/types';
import { colors, spacing, type } from '@/theme/tokens';

interface FormState {
  name: string;
  brand: string;
  description: string;
  regularPrice: string;
  salePrice: string;
  costPrice: string;
  sku: string;
  stock: string;
  lowStockThreshold: string;
  categoryId: string;
  subcategoryId: string | null;
  images: string[];
  highlights: string[];
  hasVariants: boolean;
  variants: VariantDraftRow[];
  attributeKeys: string[];
}

function toNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  return Number(trimmed);
}

function initialState(product: Product | null): FormState {
  if (product) {
    const keys = [...new Set(product.variants.flatMap((variant) => Object.keys(variant.attributes)))];
    return {
      name: product.name,
      brand: product.brand,
      description: product.description,
      regularPrice: String(product.regularPrice),
      salePrice: product.salePrice === undefined ? '' : String(product.salePrice),
      costPrice: product.costPrice === undefined ? '' : String(product.costPrice),
      sku: product.sku,
      stock: String(product.stock),
      lowStockThreshold: String(product.lowStockThreshold),
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      images: [...product.images],
      highlights: [...product.highlights],
      hasVariants: product.hasVariants,
      variants: product.variants.map((variant) => ({
        key: variant.id,
        sku: variant.sku,
        attributes: { ...variant.attributes },
        price: String(variant.price),
        stock: String(variant.stock),
      })),
      attributeKeys: keys.length ? keys : ['Option'],
    };
  }
  return {
    name: '',
    brand: '',
    description: '',
    regularPrice: '',
    salePrice: '',
    costPrice: '',
    sku: '',
    stock: '0',
    lowStockThreshold: '5',
    categoryId: '',
    subcategoryId: null,
    images: [],
    highlights: [],
    hasVariants: false,
    variants: [],
    attributeKeys: ['Option'],
  };
}

function toInput(state: FormState, video: Product['video']): ProductDraftInput {
  return {
    name: state.name,
    brand: state.brand,
    categoryId: state.categoryId,
    subcategoryId: state.subcategoryId,
    description: state.description,
    highlights: state.highlights.map((entry) => entry.trim()).filter(Boolean),
    images: state.images,
    video,
    regularPrice: toNumber(state.regularPrice),
    salePrice: state.salePrice.trim() === '' ? undefined : toNumber(state.salePrice),
    costPrice: state.costPrice.trim() === '' ? undefined : toNumber(state.costPrice),
    sku: state.sku,
    stock: toNumber(state.stock === '' ? '0' : state.stock),
    lowStockThreshold: toNumber(state.lowStockThreshold === '' ? '0' : state.lowStockThreshold),
    variants: state.hasVariants
      ? state.variants.map((row) => ({
          sku: row.sku,
          attributes: Object.fromEntries(
            state.attributeKeys.map((key) => [key, row.attributes[key] ?? '']),
          ),
          price: toNumber(row.price),
          stock: toNumber(row.stock === '' ? '0' : row.stock),
        }))
      : [],
    hasVariants: state.hasVariants,
  };
}

export function ProductForm({
  sellerId,
  product,
  onDone,
}: {
  sellerId: string;
  product: Product | null;
  onDone: (product: Product, savedAsDraft: boolean) => void;
}): React.JSX.Element {
  const [state, setState] = React.useState<FormState>(() => initialState(product));
  const [errors, setErrors] = React.useState<ProductFieldErrors | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'publish' | 'draft' | null>(null);

  const patch = (next: Partial<FormState>): void => {
    setState((current) => ({ ...current, ...next }));
  };

  const save = async (saveAsDraft: boolean): Promise<void> => {
    setError(null);
    setErrors(null);
    setBusy(saveAsDraft ? 'draft' : 'publish');
    try {
      const input = toInput(state, product?.video ?? null);
      const saved = product
        ? await catalogService.updateProduct(sellerId, product.id, input)
        : await catalogService.createProduct(sellerId, sellerService.storeBySellerId(sellerId)?.id ?? '', {
            ...input,
            saveAsDraft,
          });
      onDone(saved, saveAsDraft);
    } catch (caught) {
      if (caught instanceof ProductValidationError) {
        setErrors(caught.errors);
        setError('Some fields need attention before this listing can be saved.');
      } else {
        setError(caught instanceof Error ? caught.message : 'This listing could not be saved.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-products" />
      <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>
        {product ? `Edit ${product.name}` : 'New product'}
      </Text>

      {error ? <NoticeCard tone="danger" title="Check the listing" message={error} onDismiss={() => setError(null)} /> : null}

      <SectionHeader title="Basics" caption="What customers see first" />
      <Field
        value={state.name}
        onChangeText={(name) => patch({ name })}
        label="Product name"
        placeholder="Wireless earbuds"
        error={errors?.name}
        accessibilityLabel="Product name"
      />
      <Field
        value={state.brand}
        onChangeText={(brand) => patch({ brand })}
        label="Brand"
        placeholder="Vanta Select"
        error={errors?.brand}
        accessibilityLabel="Brand"
      />
      <Field
        value={state.description}
        onChangeText={(description) => patch({ description })}
        label="Description"
        placeholder="What it is, what it does, and what arrives in the box"
        multiline
        minHeight={110}
        error={errors?.description}
        accessibilityLabel="Description"
      />
      <HighlightEditor values={state.highlights} onChange={(highlights) => patch({ highlights })} />
      <ProductImageField images={state.images} onChange={(images) => patch({ images })} />

      <SectionHeader title="Category" caption="Used for search and browsing" />
      <CategoryPicker
        categoryId={state.categoryId}
        subcategoryId={state.subcategoryId}
        onChange={(categoryId, subcategoryId) => patch({ categoryId, subcategoryId })}
        error={errors?.categoryId ?? errors?.subcategoryId}
      />

      <SectionHeader title="Pricing" caption="Regular price is what buyers pay without a sale" />
      <Field
        value={state.regularPrice}
        onChangeText={(regularPrice) => patch({ regularPrice })}
        label="Regular price"
        keyboardType="number-pad"
        placeholder="2490"
        error={errors?.regularPrice}
        accessibilityLabel="Regular price"
      />
      <Field
        value={state.salePrice}
        onChangeText={(salePrice) => patch({ salePrice })}
        label="Sale price (optional)"
        keyboardType="number-pad"
        placeholder="1990"
        error={errors?.salePrice}
        hint="Must be lower than the regular price"
        accessibilityLabel="Sale price"
      />
      <Field
        value={state.costPrice}
        onChangeText={(costPrice) => patch({ costPrice })}
        label="Cost price (optional)"
        keyboardType="number-pad"
        placeholder="1500"
        error={errors?.costPrice}
        hint="Only used for your own margin"
        accessibilityLabel="Cost price"
      />

      <SectionHeader title="Identity" caption="Your internal SKU" />
      <Field
        value={state.sku}
        onChangeText={(sku) => patch({ sku })}
        label="SKU"
        autoCapitalize="characters"
        placeholder="VNT-EAR-01"
        error={errors?.sku}
        accessibilityLabel="SKU"
      />

      <SectionHeader title="Variants" caption="Sell sizes, colours or packs separately" />
      <Radio
        selected={!state.hasVariants}
        label="Single product"
        caption="One SKU and one stock count"
        onPress={() => patch({ hasVariants: false })}
        accessibilityLabel="Product type: single"
      />
      <Radio
        selected={state.hasVariants}
        label="Has variants"
        caption="Each variant keeps its own price and stock"
        onPress={() =>
          patch({
            hasVariants: true,
            variants: state.variants.length
              ? state.variants
              : [
                  {
                    key: `v1-${Math.random().toString(36).slice(2, 7)}`,
                    sku: state.sku.trim() ? `${state.sku.trim()}-1` : '',
                    attributes: Object.fromEntries(state.attributeKeys.map((key) => [key, ''])),
                    price: state.regularPrice,
                    stock: state.stock === '' ? '0' : state.stock,
                  },
                ],
          })
        }
        accessibilityLabel="Product type: variants"
      />

      {state.hasVariants ? (
        <View style={{ marginTop: spacing.md }}>
          <VariantEditor
            rows={state.variants}
            attributeKeys={state.attributeKeys}
            baseSku={state.sku.trim()}
            onChange={(variants) => patch({ variants })}
            onAttributeKeysChange={(attributeKeys) => patch({ attributeKeys })}
            error={errors?.variants}
          />
        </View>
      ) : (
        <>
          <Field
            value={state.stock}
            onChangeText={(stock) => patch({ stock })}
            label="Stock"
            keyboardType="number-pad"
            placeholder="25"
            error={errors?.stock}
            accessibilityLabel="Stock"
          />
          <Field
            value={state.lowStockThreshold}
            onChangeText={(lowStockThreshold) => patch({ lowStockThreshold })}
            label="Low-stock alert level"
            keyboardType="number-pad"
            placeholder="5"
            error={errors?.lowStockThreshold}
            hint="You are alerted when stock reaches this number"
            accessibilityLabel="Low stock alert level"
          />
        </>
      )}
      {state.hasVariants ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Field
            value={state.lowStockThreshold}
            onChangeText={(lowStockThreshold) => patch({ lowStockThreshold })}
            label="Low-stock alert level"
            keyboardType="number-pad"
            placeholder="5"
            error={errors?.lowStockThreshold}
            hint="Total stock across all variants is compared with this level"
            accessibilityLabel="Low stock alert level"
          />
        </Card>
      ) : null}

      <View style={{ gap: spacing.md }}>
        {product ? (
          <Button
            title="Save changes"
            onPress={() => save(false)}
            loading={busy === 'publish'}
            disabled={busy !== null}
            accessibilityLabel="Save changes"
            fullWidth
          />
        ) : (
          <>
            <Button
              title="Publish product"
              onPress={() => save(false)}
              loading={busy === 'publish'}
              disabled={busy !== null}
              accessibilityLabel="Publish product"
              fullWidth
            />
            <Button
              title="Save as draft"
              variant="secondary"
              onPress={() => save(true)}
              loading={busy === 'draft'}
              disabled={busy !== null}
              accessibilityLabel="Save as draft"
              fullWidth
            />
          </>
        )}
        <BackButton title="Cancel" fallbackHref="/seller-products" />
      </View>
    </Screen>
  );
}
