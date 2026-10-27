/**
 * Seller application (M8).
 *
 * The screen that was missing: `sellerService.becomeSeller` existed and was
 * mode-correct, but nothing could reach it, so the whole onboarding path was
 * unreachable from the app.
 *
 * Two states in one route, because they answer the same question — "can I sell
 * yet?" — and the applicant should not have to find a different page to check:
 *
 *   - no application on file → the form;
 *   - pending / active / rejected / suspended → what actually happened, read from
 *     `sellerService.applicationFor` rather than from a local guess. Only the
 *     server knows the outcome, so asking it is the difference between a status
 *     and a rumour.
 *
 * `withSession`, not `withSellerCapability`: an applicant is not a seller yet, and
 * the seller guard would bounce them straight back out.
 */
import { router } from 'expo-router';
import * as React from 'react';

import { Pressable, Text, View } from 'react-native';

import { Button, Card, Field, Screen, SectionHeader } from '@/components/ui';
import { TrustChip } from '@/modules/seller/analytics-ui';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { sellerService, type BecomeSellerInput } from '@/services/seller-service';
import { SignInGate, withSession } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { colors, radius, spacing, type } from '@/theme/tokens';
import type { SellerStatus } from '@/domain/types';

type Form = Omit<BecomeSellerInput, 'agreement'> & { agreement: Record<keyof BecomeSellerInput['agreement'], boolean> };

const EMPTY: Form = {
  fullName: '',
  phone: '',
  email: '',
  nationalId: '',
  sellerType: 'individual',
  entityName: '',
  storeName: '',
  storeDescription: '',
  storeLogo: '',
  storeBanner: '',
  pickupDivision: '',
  pickupDistrict: '',
  pickupArea: '',
  pickupAddressLine: '',
  returnDivision: '',
  returnDistrict: '',
  returnArea: '',
  returnAddressLine: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  branch: '',
  agreement: { marketplaceTerms: false, sellerPolicies: false, productAuthenticity: false, fulfillmentResponsibility: false },
};

const AGREEMENT_LABELS: { key: keyof Form['agreement']; label: string }[] = [
  { key: 'marketplaceTerms', label: 'I accept the marketplace terms.' },
  { key: 'sellerPolicies', label: 'I accept the seller policies.' },
  { key: 'productAuthenticity', label: 'Everything I list is genuine.' },
  { key: 'fulfillmentResponsibility', label: 'I am responsible for fulfilling orders.' },
];

/** The server's four states, in the words a person would use. */
const STATUS_COPY: Record<SellerStatus, { label: string; tone: 'neutral' | 'success' | 'warning'; body: string }> = {
  pending: {
    label: 'Under review',
    tone: 'warning',
    body: 'An operations reviewer is checking your details. You will hear back by email, and this page will update on its own once a decision is made.',
  },
  active: {
    label: 'Approved',
    tone: 'success',
    body: 'Your seller account is live. Everything in the Seller Center is available to you.',
  },
  rejected: {
    label: 'Not approved',
    tone: 'warning',
    body: 'This application was turned down. You can correct the details below and apply again.',
  },
  suspended: {
    label: 'Suspended',
    tone: 'warning',
    body: 'This seller account is suspended. Contact support before trading again.',
  },
};

function SellerApplyScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const { user } = session;
  // Derived during the first render, not in an effect: `withSession` guarantees a
  // user before this ever mounts, so there is nothing to wait for and no cascading
  // re-render to pay for. Retyping an email the app already knows is the most
  // common way a form like this gets abandoned.
  const [form, setForm] = React.useState<Form>(() => ({
    ...EMPTY,
    fullName: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [status, setStatus] = React.useState<SellerStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [statusAttempt, setStatusAttempt] = React.useState(0);

  const set = <K extends keyof Form>(key: K, value: Form[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  React.useEffect(() => {
    let live = true;
    if (!user) return undefined;
    sellerService
      .applicationFor(user.id)
      .then((application) => {
        if (!live) return;
        setStatus(application.profile?.status ?? null);
        setStatusError(null);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        // Showing the fresh-application form here would misrepresent a pending or
        // rejected application as "never applied", so the read failure is surfaced.
        setStatus(null);
        setStatusError(
          caught instanceof Error
            ? caught.message
            : 'We could not load your application status. Please try again.',
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user, statusAttempt]);

  const submit = React.useCallback(async () => {
    setError(null);
    const next: Record<string, string> = {};
    if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.phone.trim().length < 6) next.phone = 'Enter a contact number.';
    if (form.nationalId.trim().length < 4) next.nationalId = 'Enter your national ID.';
    if (form.storeName.trim().length < 2) next.storeName = 'Enter a store name.';
    if (form.storeDescription.trim().length < 10) next.storeDescription = 'Describe your store in a sentence or two.';
    if (form.sellerType === 'business' && !form.entityName?.trim()) next.entityName = 'Enter the registered entity name.';
    if (form.bankName.trim().length < 2) next.bankName = 'Enter your bank name.';
    if (form.accountName.trim().length < 2) next.accountName = 'Enter the account holder name.';
    if (form.accountNumber.trim().length < 4) next.accountNumber = 'Enter your account number.';
    for (const { key, label } of AGREEMENT_LABELS) {
      if (!form.agreement[key]) next[key] = label;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (!user) return;

    setSubmitting(true);
    try {
      const profile = await sellerService.becomeSeller(user.id, form as BecomeSellerInput);
      setStatus(profile.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit your application.');
    } finally {
      setSubmitting(false);
    }
  }, [form, user]);

  // The only protected route that rendered nothing at all when signed out; every
  // sibling uses the shared gate.
  if (!user) {
    return (
      <SignInGate
        title="Sign in to apply"
        message="Create an account or sign in to apply to sell on Vanta."
      />
    );
  }

  if (loading) {
    return (
      <Screen padded>
        <Text style={type.h2}>Seller application</Text>
        <Text style={{ ...type.h3, color: colors.textMuted }}>Checking your application status…</Text>
      </Screen>
    );
  }

  // Approved sellers have nothing to apply for; the Seller Center is the useful
  // next stop, so this screen says so rather than showing a dead form.
  if (status === 'active') {
    return (
      <Screen padded>
        <Card>
          <SectionHeader title={STATUS_COPY.active.label} />
          <Text style={{ ...type.h3, color: colors.textMuted }}>{STATUS_COPY.active.body}</Text>
        </Card>
        <View style={{ height: spacing.md }} />
        <Button title="Open Seller Center" onPress={() => router.push('/seller-dashboard')} fullWidth />
      </Screen>
    );
  }

  if (status === 'suspended') {
    return (
      <Screen padded>
        <Card>
          <SectionHeader title={STATUS_COPY.suspended.label} />
          <Text style={{ ...type.h3, color: colors.textMuted }}>{STATUS_COPY.suspended.body}</Text>
        </Card>
      </Screen>
    );
  }

  const readonly = status === 'pending';

  return (
    <Screen padded>
      {statusError ? (
        <>
          <NoticeCard
            tone="warning"
            title="We could not load your application"
            message={`${statusError} If you have already applied, check again before submitting a second application.`}
            actionLabel="Check again"
            onAction={() => {
              setLoading(true);
              setStatusAttempt((value) => value + 1);
            }}
            onDismiss={() => setStatusError(null)}
          />
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
      <SectionHeader
        title="Become a seller"
        caption={sellerService.approvalIsReviewed
          ? 'Tell us who you are and where you ship from. An operations reviewer approves every application.'
          : 'Tell us who you are and where you ship from. This build keeps everything on your device, so your store opens as soon as you submit.'}
      />
      {readonly ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <TrustChip label={STATUS_COPY.pending.label} tone={STATUS_COPY.pending.tone} />
          </View>
          <Text style={{ ...type.caption, color: colors.textMuted }}>{STATUS_COPY.pending.body}</Text>
        </Card>
      ) : null}
      {status === 'rejected' ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <TrustChip label={STATUS_COPY.rejected.label} tone={STATUS_COPY.rejected.tone} />
          </View>
          <Text style={{ ...type.caption, color: colors.textMuted }}>{STATUS_COPY.rejected.body}</Text>
        </Card>
      ) : null}

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Your details</Text>
        <Field label="Full name" value={form.fullName} onChangeText={(v) => set('fullName', v)} error={errors.fullName} />
        <Field
          label="Email"
          keyboardType="email-address"
          value={form.email}
          onChangeText={(v) => set('email', v)}
          error={errors.email}
        />
        <Field
          label="Phone"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => set('phone', v)}
          error={errors.phone}
        />
        <Field
          label="National ID"
          value={form.nationalId}
          onChangeText={(v) => set('nationalId', v)}
          error={errors.nationalId}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            title="Individual"
            variant={form.sellerType === 'individual' ? 'primary' : 'secondary'}
            onPress={() => set('sellerType', 'individual')}
            style={{ flex: 1 }}
          />
          <Button
            title="Business"
            variant={form.sellerType === 'business' ? 'primary' : 'secondary'}
            onPress={() => set('sellerType', 'business')}
            style={{ flex: 1 }}
          />
        </View>
        {form.sellerType === 'business' ? (
          <Field
            label="Registered entity name"
            value={form.entityName ?? ''}
            onChangeText={(v) => set('entityName', v)}
            error={errors.entityName}
          />
        ) : null}
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Your store</Text>
        <Field
          label="Store name"
          value={form.storeName}
          onChangeText={(v) => set('storeName', v)}
          error={errors.storeName}
        />
        <Field
          label="Store description"
          multiline
          value={form.storeDescription}
          onChangeText={(v) => set('storeDescription', v)}
          error={errors.storeDescription}
        />
        <Field
          label="Store logo (image URL)"
          value={form.storeLogo}
          onChangeText={(v) => set('storeLogo', v)}
          hint="Optional. A generated placeholder is used when this is empty."
        />
        <Field
          label="Store banner (image URL)"
          value={form.storeBanner}
          onChangeText={(v) => set('storeBanner', v)}
          hint="Optional."
        />
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Pickup address</Text>
        <Field label="Division" value={form.pickupDivision} onChangeText={(v) => set('pickupDivision', v)} />
        <Field label="District" value={form.pickupDistrict} onChangeText={(v) => set('pickupDistrict', v)} />
        <Field label="Area" value={form.pickupArea} onChangeText={(v) => set('pickupArea', v)} />
        <Field
          label="Address line"
          value={form.pickupAddressLine}
          onChangeText={(v) => set('pickupAddressLine', v)}
        />
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Return address</Text>
        <Field label="Division" value={form.returnDivision} onChangeText={(v) => set('returnDivision', v)} />
        <Field label="District" value={form.returnDistrict} onChangeText={(v) => set('returnDistrict', v)} />
        <Field label="Area" value={form.returnArea} onChangeText={(v) => set('returnArea', v)} />
        <Field
          label="Address line"
          value={form.returnAddressLine}
          onChangeText={(v) => set('returnAddressLine', v)}
        />
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Bank details</Text>
        <Field label="Bank name" value={form.bankName} onChangeText={(v) => set('bankName', v)} error={errors.bankName} />
        <Field
          label="Account holder"
          value={form.accountName}
          onChangeText={(v) => set('accountName', v)}
          error={errors.accountName}
        />
        <Field
          label="Account number"
          value={form.accountNumber}
          onChangeText={(v) => set('accountNumber', v)}
          error={errors.accountNumber}
        />
        <Field label="Branch" value={form.branch ?? ''} onChangeText={(v) => set('branch', v)} />
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Agreements</Text>
        {AGREEMENT_LABELS.map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.agreement[key] }}
            accessibilityLabel={label}
            onPress={() => set('agreement', { ...form.agreement, [key]: !form.agreement[key] })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: errors[key] ? colors.danger : colors.border,
                backgroundColor: form.agreement[key] ? colors.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {form.agreement[key] ? (
                <Text style={{ color: colors.textInverse, fontSize: 14, fontWeight: '700' }}>✓</Text>
              ) : null}
            </View>
            <Text style={{ ...type.caption, color: colors.text, flex: 1 }}>{label}</Text>
          </Pressable>
        ))}
        {Object.keys(errors).some((key) => key in form.agreement) ? (
          <Text style={{ ...type.caption, color: colors.danger }}>Please accept all four agreements.</Text>
        ) : null}
      </Card>

      {error ? <Text style={{ ...type.caption, color: colors.danger, marginTop: spacing.md }}>{error}</Text> : null}

      <View style={{ height: spacing.md }} />
      <Button
        title={readonly ? 'Application pending' : 'Submit application'}
        onPress={submit}
        loading={submitting}
        disabled={readonly}
        fullWidth
      />
    </Screen>
  );
}

export default withSession(SellerApplyScreen);
