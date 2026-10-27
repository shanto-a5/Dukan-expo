import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { Button, Card, Field, Screen, SectionHeader, taka } from '@/components/ui';
import { NoticeCard, Radio, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { SellerSectionCard } from '@/modules/seller/seller-ui';
import { sellerService } from '@/services/seller-service';
import {
  VoucherValidationError,
  voucherService,
  type SellerVoucherInput,
  type SellerVoucherView,
  type VoucherFieldError,
} from '@/services/voucher-service';
import type { Voucher, VoucherType } from '@/domain/types';
import { colors, spacing, type } from '@/theme/tokens';

type FieldErrors = Partial<Record<VoucherFieldError, string>>;

interface DraftState {
  code: string;
  title: string;
  type: VoucherType;
  discountValue: string;
  minimumOrder: string;
  maximumDiscount: string;
  startAt: string;
  expiry: string;
  usageLimit: string;
  perUserLimit: string;
  active: boolean;
}

const TYPE_LABELS: { key: VoucherType; label: string; caption: string }[] = [
  { key: 'percentage', label: 'Percentage off', caption: 'A percent discount, optionally capped' },
  { key: 'fixed', label: 'Fixed amount off', caption: 'A flat taka discount' },
  { key: 'free_shipping', label: 'Free delivery', caption: 'Delivery fee becomes zero' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function in30Days(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function fromDateInput(value: string, endOfDay: boolean): string {
  return new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}

function emptyDraft(): DraftState {
  return {
    code: '',
    title: '',
    type: 'percentage',
    discountValue: '10',
    minimumOrder: '500',
    maximumDiscount: '',
    startAt: today(),
    expiry: in30Days(),
    usageLimit: '100',
    perUserLimit: '1',
    active: true,
  };
}

function draftFrom(voucher: Voucher): DraftState {
  return {
    code: voucher.code,
    title: voucher.title,
    type: voucher.type,
    discountValue: String(voucher.discountValue),
    minimumOrder: String(voucher.minimumOrder),
    maximumDiscount: voucher.maximumDiscount ? String(voucher.maximumDiscount) : '',
    startAt: toDateInput(voucher.startAt),
    expiry: toDateInput(voucher.expiry),
    usageLimit: voucher.usageLimit ? String(voucher.usageLimit) : '',
    perUserLimit: voucher.perUserLimit ? String(voucher.perUserLimit) : '',
    active: voucher.active,
  };
}

function stateTone(state: SellerVoucherView['state']) {
  if (state === 'live') return 'success' as const;
  if (state === 'expired' || state === 'exhausted') return 'warning' as const;
  return 'neutral' as const;
}

function VoucherRow({
  view,
  sellerId,
  onEdit,
  onChanged,
  onError,
}: {
  view: SellerVoucherView;
  sellerId: string;
  onEdit: (voucher: Voucher) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const { voucher } = view;

  const toggle = async (): Promise<void> => {
    try {
      await voucherService.setActiveForSeller(sellerId, voucher.id, !voucher.active);
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'This voucher could not be updated.');
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await voucherService.removeForSeller(sellerId, voucher.id);
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'This voucher could not be deleted.');
    }
  };

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.text }]}>{voucher.title}</Text>
          <Text style={type.caption}>{`${voucher.code} · ${view.discountLabel}`}</Text>
        </View>
        <Pill label={view.state} tone={stateTone(view.state)} />
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <SummaryRow label="Minimum order" value={taka(voucher.minimumOrder)} />
        <SummaryRow
          label="Window"
          value={`${toDateInput(voucher.startAt)} → ${toDateInput(voucher.expiry)}`}
        />
        <SummaryRow
          label="Used"
          value={
            voucher.usageLimit
              ? `${voucher.usageCount} of ${voucher.usageLimit} (${view.usedByPercent}%)`
              : `${voucher.usageCount} · unlimited`
          }
        />
        <SummaryRow
          label="Per customer"
          value={voucher.perUserLimit ? `Up to ${voucher.perUserLimit}` : 'No cap'}
          tone="muted"
        />
      </View>
      {view.problems.length ? (
        <View style={{ marginTop: spacing.xs }}>
          {view.problems.map((problem) => (
            <Text key={problem} style={[type.caption, { color: colors.danger }]}>
              {problem}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.rowActions}>
        <Button
          title="Edit"
          variant="secondary"
          onPress={() => onEdit(voucher)}
          accessibilityLabel={`Edit voucher ${voucher.code}`}
        />
        <Button
          title={voucher.active ? 'Pause' : 'Activate'}
          variant="ghost"
          onPress={toggle}
          accessibilityLabel={`${voucher.active ? 'Pause' : 'Activate'} voucher ${voucher.code}`}
        />
        <Button
          title="Delete"
          variant="ghost"
          onPress={remove}
          accessibilityLabel={`Delete voucher ${voucher.code}`}
        />
      </View>
    </Card>
  );
}

function SellerVouchersScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const [editing, setEditing] = React.useState<Voucher | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftState>(emptyDraft);
  const [errors, setErrors] = React.useState<FieldErrors | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!sellerId) {
    return (
      <Screen padded>
        <Text style={[type.h1, { color: colors.text }]}>Vouchers</Text>
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there are no vouchers to manage."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      </Screen>
    );
  }

  const views = voucherService.listForSeller(sellerId);
  const live = views.filter((view) => view.state === 'live');

  const patch = (next: Partial<DraftState>): void => setDraft((current) => ({ ...current, ...next }));

  const openCreate = (): void => {
    setEditing(null);
    setDraft(emptyDraft());
    setErrors(null);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (voucher: Voucher): void => {
    setEditing(voucher);
    setDraft(draftFrom(voucher));
    setErrors(null);
    setError(null);
    setFormOpen(true);
  };

  const save = async (): Promise<void> => {
    setError(null);
    setErrors(null);
    const input: SellerVoucherInput = {
      code: draft.code,
      title: draft.title,
      type: draft.type,
      discountValue: draft.type === 'free_shipping' ? 0 : Number(draft.discountValue),
      minimumOrder: Number(draft.minimumOrder || '0'),
      maximumDiscount: draft.maximumDiscount.trim() === '' ? undefined : Number(draft.maximumDiscount),
      startAt: fromDateInput(draft.startAt, false),
      expiry: fromDateInput(draft.expiry, true),
      usageLimit: draft.usageLimit.trim() === '' ? undefined : Number(draft.usageLimit),
      perUserLimit: draft.perUserLimit.trim() === '' ? undefined : Number(draft.perUserLimit),
      active: draft.active,
    };
    setBusy(true);
    try {
      if (editing) {
        await voucherService.updateForSeller(sellerId, editing.id, input);
      } else {
        await voucherService.createForSeller(sellerId, input);
      }
      setFormOpen(false);
      setEditing(null);
      refresh();
    } catch (caught) {
      if (caught instanceof VoucherValidationError) {
        setErrors(caught.errors);
        setError('Some fields need attention before this voucher can be saved.');
      } else {
        setError(caught instanceof Error ? caught.message : 'This voucher could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text }]}>Vouchers</Text>
          <Text style={type.caption}>{`${views.length} voucher(s) · ${live.length} live now`}</Text>
        </View>
        <Button title="New" onPress={openCreate} accessibilityLabel="New voucher" />
      </View>

      {error ? <NoticeCard tone="danger" title="Check the voucher" message={error} onDismiss={() => setError(null)} /> : null}

      {formOpen ? (
        <SellerSectionCard
          title={editing ? `Edit ${editing.code}` : 'New voucher'}
          caption="Codes are matched case-insensitively at checkout"
        >
          <Field
            value={draft.code}
            onChangeText={(code) => patch({ code: code.toUpperCase() })}
            label="Code"
            autoCapitalize="characters"
            placeholder="EID10"
            error={errors?.code}
            hint="3–20 characters: A–Z, 0–9, dash or underscore"
            accessibilityLabel="Voucher code"
          />
          <Field
            value={draft.title}
            onChangeText={(title) => patch({ title })}
            label="Title"
            placeholder="Eid discount"
            error={errors?.title}
            accessibilityLabel="Voucher title"
          />

          <SectionHeader title="Discount" caption="How much the buyer saves" />
          {TYPE_LABELS.map((entry) => (
            <Radio
              key={entry.key}
              selected={draft.type === entry.key}
              label={entry.label}
              caption={entry.caption}
              onPress={() => patch({ type: entry.key })}
              accessibilityLabel={`Voucher type: ${entry.label}`}
            />
          ))}
          {draft.type !== 'free_shipping' ? (
            <Field
              value={draft.discountValue}
              onChangeText={(discountValue) => patch({ discountValue })}
              label={draft.type === 'percentage' ? 'Percent off' : 'Amount off'}
              keyboardType="number-pad"
              placeholder="10"
              error={errors?.discountValue}
              accessibilityLabel="Discount value"
            />
          ) : null}
          {draft.type === 'percentage' ? (
            <Field
              value={draft.maximumDiscount}
              onChangeText={(maximumDiscount) => patch({ maximumDiscount })}
              label="Maximum discount (optional)"
              keyboardType="number-pad"
              placeholder="300"
              error={errors?.maximumDiscount}
              hint="Caps the discount so a big basket cannot cost you too much"
              accessibilityLabel="Maximum discount"
            />
          ) : null}
          <Field
            value={draft.minimumOrder}
            onChangeText={(minimumOrder) => patch({ minimumOrder })}
            label="Minimum order"
            keyboardType="number-pad"
            placeholder="500"
            error={errors?.minimumOrder}
            accessibilityLabel="Minimum order value"
          />

          <SectionHeader title="Window" caption="Format: YYYY-MM-DD" />
          <Field
            value={draft.startAt}
            onChangeText={(startAt) => patch({ startAt })}
            label="Starts"
            placeholder="2026-01-01"
            error={errors?.startAt}
            accessibilityLabel="Voucher start date"
          />
          <Field
            value={draft.expiry}
            onChangeText={(expiry) => patch({ expiry })}
            label="Expires"
            placeholder="2026-01-31"
            error={errors?.expiry}
            accessibilityLabel="Voucher expiry date"
          />

          <SectionHeader title="Limits" caption="Protects you from a single customer draining the code" />
          <Field
            value={draft.usageLimit}
            onChangeText={(usageLimit) => patch({ usageLimit })}
            label="Total uses (optional)"
            keyboardType="number-pad"
            placeholder="100"
            error={errors?.usageLimit}
            hint="Leave empty for unlimited"
            accessibilityLabel="Total usage limit"
          />
          <Field
            value={draft.perUserLimit}
            onChangeText={(perUserLimit) => patch({ perUserLimit })}
            label="Uses per customer (optional)"
            keyboardType="number-pad"
            placeholder="1"
            error={errors?.perUserLimit}
            accessibilityLabel="Per customer limit"
          />
          <Radio
            selected={draft.active}
            label="Active now"
            caption="Customers can apply this code at checkout"
            onPress={() => patch({ active: true })}
            accessibilityLabel="Voucher active: yes"
          />
          <Radio
            selected={!draft.active}
            label="Inactive"
            caption="Hidden from customers, keeps its history"
            onPress={() => patch({ active: false })}
            accessibilityLabel="Voucher active: no"
          />

          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <Button
              title={editing ? 'Save voucher' : 'Create voucher'}
              onPress={save}
              loading={busy}
              disabled={busy}
              accessibilityLabel={editing ? 'Save voucher' : 'Create voucher'}
              fullWidth
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setFormOpen(false);
                setEditing(null);
                setErrors(null);
                setError(null);
              }}
              accessibilityLabel="Cancel voucher editing"
              fullWidth
            />
          </View>
        </SellerSectionCard>
      ) : null}

      {views.length === 0 && !formOpen ? (
        <EmptyState
          title="No vouchers yet"
          message="Create a code to reward repeat buyers. Vouchers can be percentage, fixed amount or free delivery."
          actionLabel="Create voucher"
          onAction={openCreate}
        />
      ) : (
        <SellerSectionCard title="Your vouchers" caption="Tap Edit to change the code, window or limits">
          {views.map((view) => (
            <VoucherRow
              key={view.voucher.id}
              view={view}
              sellerId={sellerId}
              onEdit={openEdit}
              onChanged={refresh}
              onError={setError}
            />
          ))}
        </SellerSectionCard>
      )}

      <Button
        title="Seller dashboard"
        variant="ghost"
        onPress={() => router.navigate('/seller-dashboard')}
        accessibilityLabel="Seller dashboard"
        fullWidth
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
});

export default withSellerCapability(SellerVouchersScreen, '/seller-vouchers' satisfies ProtectedRoute);
