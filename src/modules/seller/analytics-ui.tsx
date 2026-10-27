import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { Card } from '@/components/ui';
import { Pill } from '@/modules/orders/order-ui';
import type { ChecklistItem, IntegrityFinding } from '@/services/diagnostics-service';
import { colors, spacing, type } from '@/theme/tokens';

/**
 * M6 presentation primitives.
 *
 * Every visual here is driven by a service read model, so a chart bar, a rating
 * bar or a trust chip always corresponds to a record in the local database.
 * All of them carry accessibility labels because the numbers must be readable
 * without seeing the graphic.
 */

export interface SeriesPoint {
  date: string;
  revenue: number;
  orders: number;
}

export function RevenueBars({
  series,
  formatValue,
  accessibilityLabel,
  height = 96,
}: {
  series: SeriesPoint[];
  formatValue: (value: number) => string;
  accessibilityLabel: string;
  height?: number;
}): React.JSX.Element {
  const peak = Math.max(1, ...series.map((point) => point.revenue));
  const total = series.reduce((sum, point) => sum + point.revenue, 0);

  if (series.length === 0) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={type.caption}>No sales in this period yet.</Text>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${accessibilityLabel}. ${series.length} day(s), ${formatValue(total)} in total, best day ${formatValue(
        peak,
      )}.`}
    >
      <View style={[styles.chart, { height }]}>
        {series.map((point) => {
          const ratio = point.revenue / peak;
          return (
            <View
              key={point.date}
              accessible={false}
              style={[
                styles.barTrack,
                {
                  height: Math.max(3, Math.round(ratio * (height - 12))),
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.chartFooter}>
        <Text style={type.caption}>{series[0]?.date}</Text>
        <Text style={type.caption}>{series[series.length - 1]?.date}</Text>
      </View>
    </View>
  );
}

export function RatingBars({
  distribution,
}: {
  distribution: { rating: number; count: number }[];
}): React.JSX.Element {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <View>
      {distribution.map((entry) => {
        const share = total ? Math.round((entry.count / total) * 100) : 0;
        return (
          <View
            key={entry.rating}
            style={styles.ratingRow}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${entry.rating} star: ${entry.count} review(s), ${share}%`}
          >
            <Text style={[type.caption, styles.ratingLabel]}>{`${entry.rating}★`}</Text>
            <View style={styles.ratingTrack}>
              <View style={[styles.ratingFill, { width: `${share}%` }]} />
            </View>
            <Text style={type.caption}>{entry.count}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function TrustChip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' }): React.JSX.Element {
  return (
    <View style={styles.chipWrap}>
      <Pill label={label} tone={tone} />
    </View>
  );
}

export function TrustChipRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.chipRow}>{children}</View>;
}

export function ChecklistCard({
  items,
  title,
  caption,
}: {
  items: ChecklistItem[];
  title: string;
  caption: string;
}): React.JSX.Element {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.label, { color: colors.text }]}>{title}</Text>
      <Text style={[type.caption, { marginBottom: spacing.sm }]}>{caption}</Text>
      <Card>
        {items.map((item, index) => (
          <ChecklistRow key={item.id} item={item} last={index === items.length - 1} />
        ))}
      </Card>
    </View>
  );
}

function ChecklistRow({ item, last }: { item: ChecklistItem; last: boolean }): React.JSX.Element {
  return (
    <Pressable
      onPress={item.route ? () => router.push(item.route as never) : undefined}
      disabled={!item.route}
      accessibilityRole={item.route ? 'button' : 'text'}
      accessibilityLabel={`${item.label}: ${item.ok ? 'done' : 'needs work'}. ${item.detail}`}
      style={[styles.checkRow, last ? null : styles.checkRowBorder]}
    >
      <View style={[styles.checkMark, item.ok ? styles.checkOk : styles.checkPending]}>
        <Text style={[styles.checkGlyph, { color: item.ok ? colors.success : colors.accent }]}>
          {item.ok ? '✓' : '!'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]}>{item.label}</Text>
        <Text style={type.caption}>{item.detail}</Text>
      </View>
      {item.route ? <Text style={type.caption}>Fix</Text> : null}
    </Pressable>
  );
}

export function FindingList({ findings }: { findings: IntegrityFinding[] }): React.JSX.Element | null {
  if (findings.length === 0) return null;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {findings.map((finding) => (
        <Pressable
          key={`${finding.code}-${finding.entityId ?? finding.sellerId ?? 'store'}`}
          onPress={finding.route ? () => router.push(finding.route as never) : undefined}
          disabled={!finding.route}
          accessibilityRole={finding.route ? 'button' : 'text'}
          accessibilityLabel={`${finding.severity}: ${finding.message} Fix: ${finding.fix}`}
          style={styles.finding}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.text }]}>{finding.message}</Text>
            <Text style={type.caption}>{finding.fix}</Text>
          </View>
          <Pill
            label={finding.severity}
            tone={finding.severity === 'error' ? 'warning' : finding.severity === 'info' ? 'neutral' : 'info'}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barTrack: { flex: 1, backgroundColor: colors.primary, borderRadius: 3, minHeight: 3 },
  chartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  chartEmpty: { paddingVertical: spacing.lg, alignItems: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  ratingLabel: { width: 26 },
  ratingTrack: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  ratingFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  chipWrap: { marginRight: spacing.xs, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  checkRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  checkMark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkOk: { backgroundColor: colors.successSoft },
  checkPending: { backgroundColor: colors.accent },
  checkGlyph: { fontSize: 13, fontWeight: '700' },
  finding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
