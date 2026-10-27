import { Redirect } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/modules/session/session-context';
import { colors } from '@/theme/tokens';

/**
 * App entry.
 *
 * This lives at the root — outside every route group — so the seller workspace
 * shell (and its dock) is never mounted for a route the visitor has not earned
 * yet. It sends a signed-out visitor to sign in, an approved seller straight to
 * the products workspace (the seller group's root), and a signed-in non-seller
 * to the seller application flow.
 */
export default function AppEntryScreen(): React.JSX.Element {
  const { status, isSeller } = useSession();

  if (status === 'checking') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Starting Vanta Seller" />
      </View>
    );
  }

  if (status === 'signedOut') return <Redirect href="/login" />;
  return <Redirect href={isSeller ? '/seller-products' : '/seller-apply'} />;
}
