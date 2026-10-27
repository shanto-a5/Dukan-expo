import * as React from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, SectionHeader, taka } from '@/components/ui';
import { NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { SellerSectionCard } from '@/modules/seller/seller-ui';
import { ChecklistCard, FindingList } from '@/modules/seller/analytics-ui';
import { catalogService } from '@/services/catalog-service';
import { diagnosticsService } from '@/services/diagnostics-service';
import { sellerService } from '@/services/seller-service';
import type { Store } from '@/domain/types';
import { colors, spacing, type } from '@/theme/tokens';

interface StoreFormState {
  name: string;
  description: string;
  location: string;
  shippingFee: string;
  freeShippingThreshold: string;
  minDays: string;
  maxDays: string;
}

function initialStoreState(store: Store): StoreFormState {
  return {
    name: store.name,
    description: store.description,
    location: store.location,
    shippingFee: String(store.shippingFee),
    freeShippingThreshold: String(store.freeShippingThreshold),
    minDays: String(store.deliveryEstimateDays.min),
    maxDays: String(store.deliveryEstimateDays.max),
  };
}

function SellerStoreSettingsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const userId = session.user?.id ?? '';
  const store = profile ? sellerService.storeBySellerId(profile.id) : undefined;
  const [state, setState] = React.useState<StoreFormState | null>(store ? initialStoreState(store) : null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!profile || !store || !state) {
    return (
      <Screen padded>
        <Text style={[type.h1, { color: colors.text }]}>Store settings</Text>
        <EmptyState
          title="No store found"
          message="This account is not linked to a store, so there are no store settings to change."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      </Screen>
    );
  }

  const patch = (next: Partial<StoreFormState>): void => setState((current) => (current ? { ...current, ...next } : current));
  const summary = catalogService.catalogSummary(profile.id);
  const diagnostics = diagnosticsService.forSeller(profile.id);
  const paused = store.status === 'paused';

  const saveStore = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy('store');
    try {
      const shippingFee = Number(state.shippingFee);
      const freeShippingThreshold = Number(state.freeShippingThreshold);
      const minDays = Number(state.minDays);
      const maxDays = Number(state.maxDays);
      if (state.name.trim().length < 2) throw new Error('Enter a store name of at least 2 characters.');
      if (state.description.trim().length < 10) throw new Error('Describe your store in at least 10 characters.');
      if (!Number.isFinite(shippingFee) || shippingFee < 0) throw new Error('Enter a delivery fee of 0 or more.');
      if (!Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0) {
        throw new Error('Enter a free-delivery threshold of 0 or more.');
      }
      if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays) {
        throw new Error('Delivery days must be whole numbers, with the maximum at least the minimum.');
      }
      await sellerService.updateStore(userId, {
        name: state.name.trim(),
        description: state.description.trim(),
        location: state.location.trim(),
        shippingFee,
        freeShippingThreshold,
        deliveryEstimateDays: { min: minDays, max: maxDays },
      });
      setMessage('Store details saved.');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Store details could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const saveBank = async (bank: { bankName: string; accountName: string; accountNumber: string; branch?: string }): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy('bank');
    try {
      if (bank.bankName.trim().length < 2) throw new Error('Enter the bank name.');
      if (bank.accountName.trim().length < 2) throw new Error('Enter the account holder name.');
      if (!/^\d{6,20}$/.test(bank.accountNumber.trim())) throw new Error('Enter an account number of 6 to 20 digits.');
      await sellerService.updateSellerProfile(userId, { bank: { ...bank, branch: bank.branch?.trim() || undefined } });
      setMessage('Payout details saved.');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payout details could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const saveAddresses = async (patchValue: Partial<typeof profile>): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy('address');
    try {
      const required: [keyof typeof patchValue, string][] = [
        ['pickupArea', 'Pickup area'],
        ['pickupAddressLine', 'Pickup address'],
        ['returnArea', 'Return area'],
        ['returnAddressLine', 'Return address'],
      ];
      for (const [key, label] of required) {
        if (!String(patchValue[key] ?? '').trim()) throw new Error(`${label} is required.`);
      }
      await sellerService.updateSellerProfile(userId, patchValue);
      setMessage('Addresses saved.');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Addresses could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const toggleVisibility = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy('visibility');
    try {
      const updated = await sellerService.toggleStoreStatus(userId);
      setMessage(updated.status === 'paused' ? 'Store paused. Buyers cannot see your products.' : 'Store is live again.');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Store visibility could not be changed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-dashboard" />
      <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Store settings</Text>
      <Text style={[type.caption, { marginBottom: spacing.lg }]}>
        {`${store.name} · ${summary.active} live product(s) · ${store.followerCount} follower(s)`}
      </Text>

      {error ? <NoticeCard tone="danger" title="Check the details" message={error} onDismiss={() => setError(null)} /> : null}
      {message ? <NoticeCard tone="success" title="Saved" message={message} onDismiss={() => setMessage(null)} /> : null}

      <SellerSectionCard
        title="Store visibility"
        caption="A paused store disappears from search, stores and recommendations"
      >
        <Card style={{ marginBottom: spacing.lg, gap: spacing.md }}>
          <SummaryRow label="Store status" value={paused ? 'Paused' : 'Live'} />
          <SummaryRow label="Rating" value={store.ratingCount ? `${store.ratingAvg.toFixed(1)} (${store.ratingCount})` : 'No reviews yet'} />
          <SummaryRow label="Response rate" value={`${store.responseRate}%`} />
          <SummaryRow label="Response time" value={`${store.responseTimeMinutes} min`} />
          <SummaryRow
            label="Trust badge"
            value={store.verified ? 'Verified seller' : 'Not verified'}
            tone="muted"
          />
          <Button
            title={paused ? 'Resume store' : 'Pause store'}
            variant={paused ? 'primary' : 'danger'}
            onPress={toggleVisibility}
            loading={busy === 'visibility'}
            disabled={busy !== null}
            accessibilityLabel={paused ? 'Resume store' : 'Pause store'}
            fullWidth
          />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard
        title="Readiness"
        caption={`${diagnostics.readyScore}% ready · ${diagnostics.errors} blocking issue(s)`}
      >
        <ChecklistCard
          items={diagnostics.checklist}
          title="Before you get more orders"
          caption="Each row links to the screen that fixes it"
        />
        <FindingList findings={diagnostics.findings} />
      </SellerSectionCard>

      <SellerSectionCard title="Store profile" caption="Shown on every listing and in search">
        <Card style={{ marginBottom: spacing.lg }}>
          <Field
            value={state.name}
            onChangeText={(name) => patch({ name })}
            label="Store name"
            accessibilityLabel="Store name"
          />
          <Field
            value={state.description}
            onChangeText={(description) => patch({ description })}
            label="Store description"
            multiline
            minHeight={90}
            accessibilityLabel="Store description"
          />
          <Field
            value={state.location}
            onChangeText={(location) => patch({ location })}
            label="Location"
            placeholder="Dhaka, Dhaka"
            accessibilityLabel="Store location"
          />
          <Button
            title="Save store details"
            onPress={saveStore}
            loading={busy === 'store'}
            disabled={busy !== null}
            accessibilityLabel="Save store details"
            fullWidth
          />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard title="Delivery" caption="Charged at checkout for every order">
        <Card style={{ marginBottom: spacing.lg }}>
          <Field
            value={state.shippingFee}
            onChangeText={(shippingFee) => patch({ shippingFee })}
            label="Delivery fee"
            keyboardType="number-pad"
            accessibilityLabel="Delivery fee"
          />
          <Field
            value={state.freeShippingThreshold}
            onChangeText={(freeShippingThreshold) => patch({ freeShippingThreshold })}
            label="Free delivery above"
            keyboardType="number-pad"
            accessibilityLabel="Free delivery threshold"
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field
                value={state.minDays}
                onChangeText={(minDays) => patch({ minDays })}
                label="Min days"
                keyboardType="number-pad"
                accessibilityLabel="Minimum delivery days"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                value={state.maxDays}
                onChangeText={(maxDays) => patch({ maxDays })}
                label="Max days"
                keyboardType="number-pad"
                accessibilityLabel="Maximum delivery days"
              />
            </View>
          </View>
          <Text style={type.caption}>
            {`Buyers see ${state.minDays || 0}-${state.maxDays || 0} day delivery · free above ${taka(Number(state.freeShippingThreshold) || 0)}`}
          </Text>
          <View style={{ height: spacing.md }} />
          <Button
            title="Save delivery settings"
            variant="secondary"
            onPress={saveStore}
            loading={busy === 'store'}
            disabled={busy !== null}
            accessibilityLabel="Save delivery settings"
            fullWidth
          />
        </Card>
      </SellerSectionCard>

      <SellerSectionCard title="Payout account" caption="Where settled sales are sent">
        <BankForm profile={profile} busy={busy === 'bank'} onSave={saveBank} />
      </SellerSectionCard>

      <SellerSectionCard title="Pickup point" caption="Where your parcels start their journey">
        <AddressForm
          kind="pickup"
          profile={profile}
          busy={busy === 'address'}
          onSave={(next) => saveAddresses(next)}
        />
      </SellerSectionCard>

      <SellerSectionCard title="Return address" caption="Where customers send returns back">
        <AddressForm
          kind="return"
          profile={profile}
          busy={busy === 'address'}
          onSave={(next) => saveAddresses(next)}
        />
      </SellerSectionCard>

      <SectionHeader title="Account" caption="Registered seller identity" />
      <Card style={{ marginBottom: spacing.lg }}>
        <SummaryRow label="Owner" value={profile.fullName} />
        <SummaryRow label="Phone" value={profile.phone} />
        <SummaryRow label="Email" value={profile.email} />
        <SummaryRow label="Seller type" value={profile.sellerType === 'business' ? 'Business' : 'Individual'} />
        {profile.entityName ? <SummaryRow label="Entity" value={profile.entityName} /> : null}
        <SummaryRow label="Account status" value={profile.status === 'active' ? 'Verified' : profile.status} />
      </Card>

      <Button
        title="Back to seller dashboard"
        variant="secondary"
        onPress={() => router.navigate('/seller-dashboard')}
        accessibilityLabel="Back to seller dashboard"
        fullWidth
      />
    </Screen>
  );
}

function BankForm({
  profile,
  busy,
  onSave,
}: {
  profile: NonNullable<ReturnType<typeof sellerService.profileForUser>>;
  busy: boolean;
  onSave: (bank: { bankName: string; accountName: string; accountNumber: string; branch?: string }) => void;
}): React.JSX.Element {
  const [bankName, setBankName] = React.useState(profile.bank.bankName);
  const [accountName, setAccountName] = React.useState(profile.bank.accountName);
  const [accountNumber, setAccountNumber] = React.useState(profile.bank.accountNumber);
  const [branch, setBranch] = React.useState(profile.bank.branch ?? '');

  return (
    <Card>
      <Field value={bankName} onChangeText={setBankName} label="Bank name" accessibilityLabel="Bank name" />
      <Field value={accountName} onChangeText={setAccountName} label="Account holder" accessibilityLabel="Account holder" />
      <Field
        value={accountNumber}
        onChangeText={setAccountNumber}
        label="Account number"
        keyboardType="number-pad"
        accessibilityLabel="Account number"
      />
      <Field value={branch} onChangeText={setBranch} label="Branch (optional)" accessibilityLabel="Bank branch" />
      <Button
        title="Save payout details"
        onPress={() => onSave({ bankName, accountName, accountNumber, branch })}
        loading={busy}
        accessibilityLabel="Save payout details"
        fullWidth
      />
    </Card>
  );
}

function AddressForm({
  kind,
  profile,
  busy,
  onSave,
}: {
  kind: 'pickup' | 'return';
  profile: NonNullable<ReturnType<typeof sellerService.profileForUser>>;
  busy: boolean;
  onSave: (patch: Partial<typeof profile>) => void;
}): React.JSX.Element {
  const prefix = kind === 'pickup' ? 'Pickup' : 'Return';
  const [division, setDivision] = React.useState(kind === 'pickup' ? profile.pickupDivision : profile.returnDivision);
  const [district, setDistrict] = React.useState(kind === 'pickup' ? profile.pickupDistrict : profile.returnDistrict);
  const [area, setArea] = React.useState(kind === 'pickup' ? profile.pickupArea : profile.returnArea);
  const [addressLine, setAddressLine] = React.useState(
    kind === 'pickup' ? profile.pickupAddressLine : profile.returnAddressLine,
  );

  return (
    <Card>
      <Field value={division} onChangeText={setDivision} label={`${prefix} division`} accessibilityLabel={`${prefix} division`} />
      <Field value={district} onChangeText={setDistrict} label={`${prefix} district`} accessibilityLabel={`${prefix} district`} />
      <Field value={area} onChangeText={setArea} label={`${prefix} area`} accessibilityLabel={`${prefix} area`} />
      <Field
        value={addressLine}
        onChangeText={setAddressLine}
        label={`${prefix} address`}
        multiline
        minHeight={70}
        accessibilityLabel={`${prefix} address`}
      />
      <Button
        title={`Save ${kind} address`}
        variant="secondary"
        onPress={() =>
          onSave(
            kind === 'pickup'
              ? { pickupDivision: division, pickupDistrict: district, pickupArea: area, pickupAddressLine: addressLine }
              : { returnDivision: division, returnDistrict: district, returnArea: area, returnAddressLine: addressLine },
          )
        }
        loading={busy}
        accessibilityLabel={`Save ${prefix.toLowerCase()} address`}
        fullWidth
      />
    </Card>
  );
}

export default withSellerCapability(SellerStoreSettingsScreen, '/seller-store-settings' satisfies ProtectedRoute);
