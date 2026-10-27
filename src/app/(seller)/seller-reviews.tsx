import * as React from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, SectionHeader } from '@/components/ui';
import { NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { EmptyState, FilterTabs, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { Stars } from '@/modules/reviews/review-form';
import { withSellerCapability, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { reviewService, type SellerReviewFilters, type SellerReviewView } from '@/services/review-service';
import { sellerService } from '@/services/seller-service';
import { formatDate } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'awaiting', label: 'Needs reply' },
  { key: 'replied', label: 'Answered' },
] as const;

const RATINGS = [
  { key: 'all', label: 'All' },
  { key: '5', label: '5★' },
  { key: '4', label: '4★' },
  { key: '3', label: '3★' },
  { key: '2', label: '2★' },
  { key: '1', label: '1★' },
];

const VERIFIED = [
  { key: 'all', label: 'All' },
  { key: 'verified', label: 'Verified' },
  { key: 'unverified', label: 'Unverified' },
];

type ReplyFilter = NonNullable<SellerReviewFilters['reply']>;
type RatingFilter = NonNullable<SellerReviewFilters['rating']>;
type VerifiedFilter = NonNullable<SellerReviewFilters['verified']>;

function ReviewRow({
  entry,
  onSubmit,
  busy,
}: {
  entry: SellerReviewView;
  onSubmit: (reviewId: string, text: string) => void;
  busy: boolean;
}): React.JSX.Element {
  const { review, productName } = entry;
  const [text, setText] = React.useState(review.sellerReply?.text ?? '');
  const [open, setOpen] = React.useState(false);
  const answered = !!review.sellerReply;

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ ...type.label, color: colors.text, flex: 1 }} numberOfLines={1}>
          {productName}
        </Text>
        <Pill
          label={entry.listingStatus}
          tone={entry.listingStatus === 'live' ? 'success' : 'warning'}
        />
        <Stars value={review.rating} />
      </View>
      <Text style={{ ...type.caption, marginTop: 2 }}>
        {`${review.userName} · ${formatDate(review.createdAt)}${review.verifiedPurchase ? ' · Verified purchase' : ''}${
          entry.orderCode ? ` · ${entry.orderCode}` : ''
        }`}
      </Text>
      <Text style={{ ...type.label, color: colors.text, marginTop: spacing.sm }}>{review.title}</Text>
      <Text style={{ ...type.caption, marginTop: 2 }}>{review.text}</Text>

      {answered ? (
        <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: spacing.md, backgroundColor: colors.primarySoft }}>
          <Text style={{ ...type.caption, color: colors.primary }}>Your reply</Text>
          <Text style={{ ...type.body, color: colors.text }}>{review.sellerReply?.text}</Text>
          <Text style={{ ...type.caption }}>{review.sellerReply ? formatDate(review.sellerReply.at) : ''}</Text>
        </View>
      ) : null}

      {open ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label="Reply to this review"
            value={text}
            onChangeText={setText}
            placeholder="Thanks for the feedback…"
            multiline
            minHeight={80}
          />
          <Button
            title={answered ? 'Update reply' : 'Post reply'}
            fullWidth
            loading={busy}
            onPress={() => onSubmit(review.id, text)}
          />
          <Button title="Cancel" variant="ghost" fullWidth onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Button
          title={answered ? 'Edit reply' : 'Reply'}
          variant="secondary"
          fullWidth
          style={{ marginTop: spacing.md }}
          onPress={() => setOpen(true)}
          accessibilityLabel={`${answered ? 'Edit reply to' : 'Reply to'} review by ${review.userName} on ${productName}`}
        />
      )}

      <Button
        title="View product"
        variant="ghost"
        fullWidth
        onPress={() => router.push({ pathname: '/seller-product/[id]', params: { id: review.productId } })}
      />
    </Card>
  );
}

function SellerReviewsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [filter, setFilter] = React.useState<ReplyFilter>('all');
  const [rating, setRating] = React.useState<RatingFilter>('all');
  const [verified, setVerified] = React.useState<VerifiedFilter>('all');
  const [search, setSearch] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const profile = sellerService.profileForUser(session.user?.id ?? '');
  const sellerId = profile?.id;
  const all = sellerId ? reviewService.forSeller(sellerId) : [];
  const entries = sellerId ? reviewService.forSeller(sellerId, { reply: filter, rating, verified, search }) : [];
  const store = sellerService.storeForUser(session.user?.id ?? '');

  const average = all.length ? all.reduce((sum, entry) => sum + entry.review.rating, 0) / all.length : 0;
  const unanswered = all.filter((entry) => !entry.review.sellerReply).length;

  const submit = async (reviewId: string, text: string): Promise<void> => {
    if (!sellerId) return;
    setError(null);
    setBusy(true);
    try {
      await reviewService.reply(sellerId, reviewId, text);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That reply could not be posted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/seller-dashboard" />
      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md }}>Store reviews</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        What customers said about your products, and where you can reply.
      </Text>

      {!sellerId ? (
        <EmptyState
          title="No seller profile"
          message="This account is not linked to a store, so there are no reviews to answer."
          actionLabel="Back to settings"
          onAction={() => router.replace('/settings')}
        />
      ) : (
        <>
          <Card style={{ marginBottom: spacing.lg }}>
            <SummaryRow label="Store" value={store?.name ?? 'Your store'} />
            <SummaryRow label="Average rating" value={all.length ? `${average.toFixed(1)} / 5` : 'No reviews yet'} />
            <SummaryRow label="Total reviews" value={String(all.length)} />
            <SummaryRow label="Waiting for a reply" value={String(unanswered)} tone="total" />
          </Card>

          {unanswered > 0 ? (
            <NoticeCard
              tone="info"
              title="Replies build trust"
              message={`${unanswered} review(s) have no reply yet. Customers see your response on the product page.`}
            />
          ) : null}

          {error ? <NoticeCard tone="danger" title="Could not post reply" message={error} /> : null}

          {all.length ? (
            <>
              <Field
                value={search}
                onChangeText={setSearch}
                placeholder="Search product, order code or text"
                accessibilityLabel="Search reviews"
                returnKeyType="search"
              />
              <Text style={[type.caption, { marginTop: spacing.sm }]}>Reply status</Text>
              <FilterTabs tabs={FILTERS.map((entry) => ({ key: entry.key, label: entry.label }))} active={filter} onChange={(key) => setFilter(key as ReplyFilter)} />
              <Text style={[type.caption, { marginTop: spacing.sm }]}>Rating</Text>
              <FilterTabs tabs={RATINGS} active={String(rating)} onChange={(key) => setRating(key === 'all' ? 'all' : Number(key))} />
              <Text style={[type.caption, { marginTop: spacing.sm }]}>Purchase</Text>
              <FilterTabs tabs={VERIFIED} active={String(verified)} onChange={(key) => setVerified(key as VerifiedFilter)} />
            </>
          ) : null}

          {entries.length === 0 ? (
            <EmptyState
              title={all.length === 0 ? 'No reviews yet' : 'Nothing in this filter'}
              message={
                all.length === 0
                  ? 'When customers review your delivered items, they appear here with the option to reply.'
                  : 'Try another filter, rating or search term to see the rest of the reviews.'
              }
            />
          ) : (
            <>
              <SectionHeader title={`Reviews (${entries.length})`} caption="Replying notifies the customer" />
              {entries.map((entry) => (
                <ReviewRow key={entry.review.id} entry={entry} onSubmit={submit} busy={busy} />
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

export default withSellerCapability(SellerReviewsScreen, '/seller-reviews' satisfies ProtectedRoute);
