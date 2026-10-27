import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors, radius, spacing } from '@/theme/tokens';

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };
const ACTION_WIDTH = 108;

type SymbolName = React.ComponentProps<typeof SymbolView>['name'];

export interface SwipeAction {
  label: string;
  accessibilityLabel: string;
  icon: SymbolName;
  tone: 'danger' | 'primary';
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
}

/**
 * A single swipe-to-act row built on `ReanimatedSwipeable`.
 *
 * Swiping left reveals one full-height action. Pressing it runs `action.onPress`
 * and closes the row once the promise resolves; if it rejects the row stays open
 * so the parent can surface the server error. Vertical scrolling is never stolen
 * because the pan gesture only activates past a horizontal offset.
 */
export function SwipeActionRow({
  children,
  action,
  enabled = true,
  actionWidth = ACTION_WIDTH,
  onOpen,
  onClose,
}: {
  children: React.ReactNode;
  action: SwipeAction;
  enabled?: boolean;
  actionWidth?: number;
  onOpen?: (methods: SwipeableMethods) => void;
  onClose?: (methods: SwipeableMethods) => void;
}): React.JSX.Element {
  const ref = React.useRef<SwipeableMethods | null>(null);

  const run = React.useCallback(async (): Promise<void> => {
    if (action.disabled || action.busy) return;
    try {
      await action.onPress();
      ref.current?.close();
    } catch {
      // Keep the row open; the parent renders the failure.
    }
  }, [action]);

  const renderRightActions = (): React.ReactNode => {
    const backgroundColor = action.tone === 'danger' ? colors.danger : colors.primary;
    return (
      <Pressable
        onPress={(): void => void run()}
        disabled={action.disabled || action.busy}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel}
        accessibilityState={{ busy: !!action.busy, disabled: !!action.disabled }}
        style={({ pressed }) => [
          styles.action,
          { width: actionWidth, backgroundColor },
          pressed ? styles.actionPressed : null,
        ]}
      >
        {action.busy ? (
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          <>
            <SymbolView name={action.icon} size={22} weight={ICON_WEIGHT} tintColor={colors.textInverse} />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </>
        )}
      </Pressable>
    );
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      enabled={enabled}
      friction={2}
      rightThreshold={actionWidth * 0.5}
      overshootRight={false}
      containerStyle={styles.container}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={(): void => {
        if (ref.current) onOpen?.(ref.current);
      }}
      onSwipeableClose={(): void => {
        if (ref.current) onClose?.(ref.current);
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  actionPressed: { opacity: 0.86 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: colors.textInverse },
});
