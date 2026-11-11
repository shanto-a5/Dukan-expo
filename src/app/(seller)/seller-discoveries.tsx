import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { EmptyState } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability } from '@/modules/session/route-guard';
import { vantaApi, type AreaDiscoveryDto } from '@/api/vanta-api';
import { colors, radius, spacing, type } from '@/theme/tokens';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatRequestedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isRecentDiscovery(iso: string): boolean {
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= SEVEN_DAYS_MS;
}

function SellerDiscoveriesScreen(): React.JSX.Element {
  const refreshTick = useFocusRefresh();
  const [discoveries, setDiscoveries] = React.useState<AreaDiscoveryDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError(null);
      try {
        const result = await vantaApi.sellerDiscoveries();
        if (active) setDiscoveries(result.discoveries);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load area demands.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  return (
    <Screen padded>
      <BackButton fallbackHref="/settings" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs }}>
        New Area Demands
      </Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        Villages and areas searched by shoppers where more local sellers are needed
      </Text>

      {error ? (
        <View style={{ marginBottom: spacing.md }}>
          <NoticeCard tone="danger" title="Could not load discoveries" message={error} onDismiss={() => setError(null)} />
        </View>
      ) : null}

      {loading ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm }}>
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading area discoveries" />
            <Text style={type.caption}>Loading requested areas…</Text>
          </View>
        </Card>
      ) : discoveries.length === 0 ? (
        <EmptyState
          title="No area demands yet"
          message="When shoppers search for a village or area with no shops, their requests will appear here."
          actionLabel="Open Store Settings"
          onAction={() => router.push('/seller-store-settings')}
        />
      ) : (
        <>
          <SectionHeader
            title={`Requested areas (${discoveries.length})`}
            caption="Add an area in Store Settings to start serving waiting customers"
          />
          <View style={{ gap: spacing.sm }}>
            {discoveries.map((item) => {
              const recent = isRecentDiscovery(item.requestedAt);
              return (
                <Card key={item.id || item.slug}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={[type.h3, { color: colors.text }]}>{item.requestedName}</Text>
                        {recent ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: colors.danger,
                            }}
                          />
                        ) : null}
                      </View>
                      <Text style={[type.caption, { marginTop: 2 }]}>
                        Requested on {formatRequestedDate(item.requestedAt)}
                      </Text>
                    </View>
                    {recent ? (
                      <View
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 4,
                          borderRadius: radius.pill,
                          backgroundColor: colors.dangerSoft,
                        }}
                      >
                        <Text style={[type.caption, { color: colors.danger, fontWeight: '700' }]}>Recent</Text>
                      </View>
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
          <View style={{ height: spacing.lg }} />
          <Button
            title="Update service areas in Store Settings"
            variant="secondary"
            onPress={() => router.push('/seller-store-settings')}
            fullWidth
          />
        </>
      )}
    </Screen>
  );
}

const ProtectedSellerDiscoveriesScreen: (props: Record<string, unknown>) => React.JSX.Element =
  withSellerCapability(SellerDiscoveriesScreen, '/seller-discoveries');

export default ProtectedSellerDiscoveriesScreen;
