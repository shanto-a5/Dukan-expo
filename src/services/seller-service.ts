import { getContainer } from '@/infrastructure/container';
import type { SellerProfile, SellerType, Store } from '@/domain/types';
import { authService } from './auth-gateway';
import { newId } from '@/utils/id';
import { vantaApi } from '@/api/vanta-api';
import { hydrateSellerWorkspace, upsertStore } from '@/api/remote-seller';
import { mirrorFollowState } from '@/api/remote-social';

/** The editable store columns the server accepts on `PATCH /seller/store`. */
const STORE_PATCH_KEYS: (keyof Store)[] = [
  'name',
  'description',
  'logo',
  'banner',
  'shippingFee',
  'freeShippingThreshold',
  'deliveryEstimateDays',
  'location',
];

export interface BecomeSellerInput {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  sellerType: SellerType;
  entityName?: string;
  storeName: string;
  storeDescription: string;
  storeLogo: string;
  storeBanner: string;
  pickupDivision: string;
  pickupDistrict: string;
  pickupArea: string;
  pickupAddressLine: string;
  returnDivision: string;
  returnDistrict: string;
  returnArea: string;
  returnAddressLine: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
  agreement: { marketplaceTerms: boolean; sellerPolicies: boolean; productAuthenticity: boolean; fulfillmentResponsibility: boolean };
}

export interface SellerApplication {
  profile: SellerProfile | null;
  store: Store | null;
  canUseSellerArea: boolean;
}

export class SellerService {
  profileForUser(userId: string): SellerProfile | undefined {
    return getContainer().repositories.sellers.getByUserId(userId);
  }

  storeForUser(userId: string): Store | undefined {
    const profile = this.profileForUser(userId);
    if (!profile) return undefined;
    return getContainer().repositories.stores.getBySellerId(profile.id) ?? getContainer().repositories.stores.getById(profile.storeId);
  }

  profileById(id: string): SellerProfile | undefined {
    return getContainer().repositories.sellers.getById(id);
  }

  storeBySellerId(sellerId: string): Store | undefined {
    return getContainer().repositories.stores.getBySellerId(sellerId);
  }

  storeById(id: string): Store | undefined {
    return getContainer().repositories.stores.getById(id);
  }

  isSeller(userId: string): boolean {
    return !!this.profileForUser(userId);
  }

  /**
   * M8: whether a submitted application waits for a human.
   *
   * True in remote mode, where the server creates the profile as `pending` and an
   * operator with `seller_approver` decides. False in local mode, which has no
   * operator and no admin surface to review from — so it opens the store
   * immediately rather than stranding every local applicant as permanently pending.
   *
   * The onboarding screen reads this to describe what will actually happen instead
   * of promising a review that local mode never performs.
   */
  get approvalIsReviewed(): boolean {
    return true;
  }

  /**
   * Seller onboarding.
   *
   * Local mode writes the profile, store and `seller` role to the device database,
   * active immediately (see `approvalIsReviewed`). Remote mode delegates to
   * `POST /seller/register`, which records the profile as `pending` and grants the
   * role only once an operator approves it — a client that set the role on its own
   * record would grant nothing, because every `/seller/*` route authorises from the
   * token's user.
   */
  async becomeSeller(userId: string, input: BecomeSellerInput): Promise<SellerProfile> {
    void userId;
    const created = await vantaApi.registerSeller({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        nationalId: input.nationalId,
        sellerType: input.sellerType,
        entityName: input.entityName,
        storeName: input.storeName,
        storeDescription: input.storeDescription,
        storeLogo: input.storeLogo,
        storeBanner: input.storeBanner,
        pickupDivision: input.pickupDivision,
        pickupDistrict: input.pickupDistrict,
        pickupArea: input.pickupArea,
        pickupAddressLine: input.pickupAddressLine,
        returnDivision: input.returnDivision,
        returnDistrict: input.returnDistrict,
        returnArea: input.returnArea,
        returnAddressLine: input.returnAddressLine,
        bankName: input.bankName,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        branch: input.branch,
        agreement: input.agreement,
      });
      // The role was just granted server-side; pull the fresh user so the UI
      // unlocks the seller routes without a manual sign-in.
      await authService.getCurrentUser();
      // Mirror the freshly-created (pending) profile and store so Settings can
      // describe the application state without another round trip. Return the
      // mapped local record (a real domain object) rather than the raw DTO.
      const profile = await hydrateSellerWorkspace().catch(() => null);
      return profile ?? created.profile;
  }

  /**
   * M8: where an application stands.
   *
   * Asymmetric on purpose. Remote mode asks the server, because the approval
   * decision lives there and a device that cached its own guess could keep showing
   * "pending" after an operator had already approved it. Local mode reads the
   * device record and derives the same answer.
   *
   * `canUseSellerArea` is deliberately not `Boolean(profile)`: an applicant who is
   * pending or rejected has a profile and still must not reach the seller routes.
   */
  async applicationFor(userId: string): Promise<SellerApplication> {
    void userId;
    const result = await vantaApi.sellerApplication();
    return {
      profile: result.profile ?? null,
      store: result.store ?? null,
      canUseSellerArea: result.canUseSellerArea,
    };
  }

  /**
   * M14-remote: mirror the caller's seller profile, store and workspace from the
   * API into the device database.
   *
   * The seller screens read the local database synchronously, so this has to run
   * before the session reports `signedIn` — otherwise the app knows the user has
   * the `seller` role but has no profile to show, and the Seller Center looks
   * broken. A no-op in local mode.
   */
  async refreshSellerWorkspace(): Promise<SellerProfile | null> {
    return hydrateSellerWorkspace();
  }

  updateSellerProfile(_userId: string, _patch: Partial<SellerProfile>): Promise<SellerProfile> {
    // There is deliberately no `PATCH /seller/profile`: the server owns the
    // application and its payout/pickup details are a review-time record, not a
    // seller-editable one. Writing only the local mirror would show an edit that
    // vanishes on the next boot, so we refuse loudly instead.
    return Promise.reject(
      new Error('Payout and pickup details cannot be changed from the app. Contact support to update them.'),
    );
  }

  async updateStore(userId: string, patch: Partial<Store>): Promise<Store> {
    const body: Record<string, unknown> = {};
    for (const key of STORE_PATCH_KEYS) {
      if (patch[key] !== undefined) body[key] = patch[key];
    }
    void userId;
    if (Object.keys(body).length === 0) throw new Error('No store changes to save.');
    const { store } = await vantaApi.patchSellerStore(body);
    return upsertStore(store);
  }

  async toggleStoreStatus(userId: string): Promise<Store> {
    const store = this.storeForUser(userId);
    if (!store) throw new Error('Not a seller.');
    const { store: updated } = await vantaApi.toggleSellerStoreStatus(store.status === 'active' ? 'paused' : 'active');
    return upsertStore(updated);
  }

  followStore(userId: string, storeId: string): boolean {
    return this.remoteFollow(userId, storeId, true);
  }

  unfollowStore(userId: string, storeId: string): boolean {
    return this.remoteFollow(userId, storeId, false);
  }

  /**
   * Remote follow/unfollow: mirror the desired state synchronously (so the
   * toggle reads correctly this render), then let the server decide and
   * reconcile the mirrored follower row + count from its response.
   */
  private remoteFollow(userId: string, storeId: string, follow: boolean): boolean {
    const hasLocal = !!getContainer().repositories.stores.getById(storeId);
    const optimistic = hasLocal ? this.setFollow(userId, storeId, follow) : follow;
    const call = follow ? vantaApi.followStore(storeId) : vantaApi.unfollowStore(storeId);
    void call
      .then((state) => mirrorFollowState(userId, storeId, state))
      .catch(() => undefined);
    return optimistic;
  }

  private setFollow(userId: string, storeId: string, follow: boolean): boolean {
    const { repositories } = getContainer();
    const store = repositories.stores.getById(storeId);
    if (!store) throw new Error('Store not found.');
    const existing = repositories.storeFollowers.get(storeId, userId);
    if (follow && !existing) {
      const now = new Date().toISOString();
      repositories.storeFollowers.create({ id: newId('fol'), userId, storeId, createdAt: now, updatedAt: now });
      repositories.stores.update(storeId, { followerCount: store.followerCount + 1, updatedAt: now });
      return true;
    }
    if (!follow && existing) {
      repositories.storeFollowers.remove(existing.id);
      repositories.stores.update(storeId, { followerCount: Math.max(0, store.followerCount - 1), updatedAt: new Date().toISOString() });
      return false;
    }
    return follow;
  }

  isFollowing(userId: string, storeId: string): boolean {
    return !!getContainer().repositories.storeFollowers.get(storeId, userId);
  }

  followedStores(userId: string): Store[] {
    const { repositories } = getContainer();
    return repositories.storeFollowers
      .listForUser(userId)
      .map((f) => repositories.stores.getById(f.storeId))
      .filter((s): s is Store => !!s);
  }

  newestStores(limit = 10): Store[] {
    return getContainer()
      .repositories.stores.list()
      .filter((s) => s.status === 'active')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  sellerForStore(storeId: string): SellerProfile | undefined {
    const { repositories } = getContainer();
    const store = repositories.stores.getById(storeId);
    if (!store) return undefined;
    return repositories.sellers.getById(store.sellerId);
  }

  sellerIdForStore(storeId: string): string | undefined {
    return this.sellerForStore(storeId)?.id;
  }
}

export const sellerService = new SellerService();
