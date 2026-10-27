import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { SessionProvider } from '@/modules/session/session-context';
import { useBootGate } from '@/infrastructure/bootstrap';
import { Button, Card } from '@/components/ui';
import { GlobalProgressLine } from '@/components/global-progress-line';
import { spacing, colors, type } from '@/theme/tokens';

/**
 * Vanta Seller root layout.
 *
 *  - SessionProvider wraps the router tree BEFORE any route/component can call
 *    `useSession()`. This is the single identity authority; session restore and
 *    the initial `checking` state live inside it.
 *  - The boot gate holds routes back until the persistence layer is loaded and
 *    the server catalogue mirror is installed. While the gate is closed the tree
 *    shows a labelled spinner; a rejected boot renders a retryable failure card.
 *  - Route groups decide navigation: (seller), (auth). The seller group hosts the
 *    workspace dock; the root `index` screen is the app's entry point and forwards
 *    to the group the visitor is allowed to see, so the seller shell is never
 *    mounted for a route the visitor has not earned.
 *  - SafeAreaProvider is the single source of device inset values; screens read
 *    the inset through the shared `Screen` shell in `@/components/ui`.
 */
export default function RootLayout(): React.JSX.Element {
  const boot = useBootGate();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SessionProvider>
          <View style={{ flex: 1, backgroundColor: '#FAFAF9' }}>
            <StatusBar style="dark" />
            {boot.status === 'loading' ? (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.lg,
                }}
              >
                <ActivityIndicator
                  size="large"
                  color={colors.primary}
                  accessibilityLabel="Starting Vanta Seller"
                />
              </View>
            ) : null}
            {boot.status === 'ready' ? <Stack screenOptions={{ headerShown: false }} /> : null}
            <GlobalProgressLine />
            {boot.status === 'failed' ? (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.lg,
                }}
              >
                <Card style={{ width: '100%', maxWidth: 420 }}>
                  <Text style={{ ...type.h3, marginBottom: spacing.sm }}>Vanta Seller could not start</Text>
                  <Text style={{ ...type.bodyMuted, marginBottom: spacing.lg }}>{boot.error.message}</Text>
                  <Button title="Try again" fullWidth onPress={boot.retry} />
                </Card>
              </View>
            ) : null}
          </View>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
