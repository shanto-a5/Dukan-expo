/**
 * Seller workspace shell.
 *
 * The workspace floats the seller bottom dock — a Liquid Glass surface with the
 * four ways around the seller app (Dashboard, Orders, Products, Settings). The
 * dock is an overlay, so the shell publishes its clearance through
 * `CustomerDockClearanceProvider`; every screen renders through the shared
 * `Screen` shell, which reads the clearance and keeps content above the dock.
 */
import { Stack } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

import { SellerBottomDock } from '@/components/seller-bottom-dock';
import { CustomerDockClearanceProvider } from '@/components/customer-dock-inset';
import { ROUTE_GROUP_ANCHORS, vantaStackScreenOptions } from '@/modules/navigation/stack-options';

export const unstable_settings = { anchor: ROUTE_GROUP_ANCHORS.seller };

export default function SellerLayout(): React.JSX.Element {
  return (
    <CustomerDockClearanceProvider>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={vantaStackScreenOptions}>
          <Stack.Screen name="seller-dashboard" />
          <Stack.Screen name="seller-apply" />
          <Stack.Screen name="seller-orders" />
          <Stack.Screen name="seller-order/[id]" />
          <Stack.Screen name="seller-returns" />
          <Stack.Screen name="seller-products" />
          <Stack.Screen name="seller-product/new" />
          <Stack.Screen name="seller-product/[id]" />
          <Stack.Screen name="seller-product-edit/[id]" />
          <Stack.Screen name="seller-inventory" />
          <Stack.Screen name="seller-reviews" />
          <Stack.Screen name="seller-store-settings" />
          <Stack.Screen name="seller-vouchers" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="notifications" />
        </Stack>
        <SellerBottomDock />
      </View>
    </CustomerDockClearanceProvider>
  );
}
