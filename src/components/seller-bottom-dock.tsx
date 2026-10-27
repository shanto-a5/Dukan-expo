/**
 * Seller bottom navigation dock.
 *
 * One floating glass surface with four destinations — Products, Orders,
 * Dashboard, Settings — mapped onto the routes that exist in the `(seller)`
 * shell. The active tab is derived from the current pathname and navigation goes
 * through Expo Router.
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router, usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import * as React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, makeShadow, radius, spacing } from '@/theme/tokens';
import { CUSTOMER_DOCK_BOTTOM_GAP, CUSTOMER_DOCK_HEIGHT } from './customer-dock-inset';

/** Comfortable margins on phones, capped so the dock stays readable on desktop. */
const DOCK_MAX_WIDTH = 560;
const ICON_SIZE = 22;
const MIN_TOUCH_TARGET = 44;

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

type DockHref = '/seller-dashboard' | '/seller-orders' | '/seller-products' | '/settings';

type DockTab = {
  key: 'dashboard' | 'orders' | 'products' | 'settings';
  label: string;
  href: DockHref;
  match: (pathname: string) => boolean;
  icon: {
    ios: 'chart.bar.fill' | 'shippingbox.fill' | 'tag.fill' | 'gearshape.fill';
    android: 'dashboard' | 'receipt_long' | 'sell' | 'settings';
    web: 'dashboard' | 'receipt_long' | 'sell' | 'settings';
  };
};

const TABS: readonly DockTab[] = [
  {
    key: 'products',
    label: 'Products',
    href: '/seller-products',
    match: (p) => p === '/seller-products' || p.startsWith('/seller-product/') || p.startsWith('/seller-product-edit/') || p === '/seller-inventory',
    icon: { ios: 'tag.fill', android: 'sell', web: 'sell' },
  },
  {
    key: 'orders',
    label: 'Orders',
    href: '/seller-orders',
    match: (p) => p === '/seller-orders' || p.startsWith('/seller-order/'),
    icon: { ios: 'shippingbox.fill', android: 'receipt_long', web: 'receipt_long' },
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/seller-dashboard',
    match: (p) => p === '/seller-dashboard',
    icon: { ios: 'chart.bar.fill', android: 'dashboard', web: 'dashboard' },
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    match: (p) => p === '/settings',
    icon: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
  },
];

type BlurStyle = ViewStyle & { backdropFilter?: string; WebkitBackdropFilter?: string };

const NATIVE_GLASS_AVAILABLE = isLiquidGlassAvailable();

const WEB_BACKDROP_BLUR: BlurStyle | null =
  Platform.OS === 'web'
    ? {
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }
    : null;

export function SellerBottomDock(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const items = (
    <View style={styles.row}>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!active) router.navigate(tab.href);
            }}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityHint={active ? undefined : `Opens ${tab.label.toLowerCase()}`}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <View style={[styles.itemInner, active && styles.itemInnerActive]}>
              <View style={styles.iconSlot}>
                <SymbolView
                  name={tab.icon}
                  size={ICON_SIZE}
                  weight={ICON_WEIGHT}
                  tintColor={active ? colors.primary : colors.textMuted}
                />
              </View>
              <Text numberOfLines={1} style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const surfaceStyle = [
    styles.surface,
    NATIVE_GLASS_AVAILABLE ? null : styles.surfaceFallback,
    WEB_BACKDROP_BLUR,
    makeShadow(3),
  ];

  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: insets.bottom + CUSTOMER_DOCK_BOTTOM_GAP }]}>
      {NATIVE_GLASS_AVAILABLE ? (
        <GlassView glassEffectStyle="regular" isInteractive tintColor="rgba(255,255,255,0.55)" style={surfaceStyle}>
          {items}
        </GlassView>
      ) : (
        <View style={surfaceStyle}>{items}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  surface: {
    maxWidth: DOCK_MAX_WIDTH,
    width: '100%',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  surfaceFallback: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CUSTOMER_DOCK_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
  },
  itemPressed: { opacity: 0.6 },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  itemInnerActive: { backgroundColor: colors.primarySoft },
  iconSlot: { width: ICON_SIZE, height: ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  labelActive: { color: colors.primary },
  labelIdle: { color: colors.textMuted },
});
