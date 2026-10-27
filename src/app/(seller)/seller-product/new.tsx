import * as React from 'react';

import { router } from 'expo-router';

import { EmptyState } from '@/modules/orders/order-ui';
import { ProductForm } from '@/modules/seller/product-form';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { sellerService } from '@/services/seller-service';

function NewSellerProductScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  if (!profile) {
    return (
      <EmptyState
        title="No seller profile"
        message="Only accounts with a store can publish products."
        actionLabel="Back to settings"
        onAction={() => router.replace('/settings')}
      />
    );
  }
  return (
    <ProductForm
      sellerId={profile.id}
      product={null}
      onDone={(product) => router.replace({ pathname: '/seller-product/[id]', params: { id: product.id } })}
    />
  );
}

export default withSellerCapability(NewSellerProductScreen, '/seller-dashboard' satisfies ProtectedRoute);
