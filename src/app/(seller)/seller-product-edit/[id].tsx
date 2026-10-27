import * as React from 'react';
import { Text } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Screen } from '@/components/ui';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { ProductForm } from '@/modules/seller/product-form';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { catalogService } from '@/services/catalog-service';
import { sellerService } from '@/services/seller-service';
import { colors, spacing, type } from '@/theme/tokens';

function EditSellerProductScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const product = profile && rawId ? catalogService.sellerProduct(profile.id, rawId) : null;

  if (!profile || !product) {
    return (
      <Screen padded>
        <BackButton fallbackHref="/seller-products" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Edit product</Text>
        <NoticeCard
          tone="danger"
          title="Product not available"
          message="This product does not belong to your store, or it no longer exists."
        />
      </Screen>
    );
  }

  return (
    <ProductForm
      sellerId={profile.id}
      product={product}
      onDone={(saved) => router.replace({ pathname: '/seller-product/[id]', params: { id: saved.id } })}
    />
  );
}

export default withSellerCapability(EditSellerProductScreen, '/seller-products' satisfies ProtectedRoute);