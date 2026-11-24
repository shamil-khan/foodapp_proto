import type { HomePickupPrivacyMode, KitchenType } from '@foodapp/db';

export interface DropPointConfig {
  readonly label: string;
  readonly areaLocality?: string;
  readonly instructions?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface TakeawayWhitelistEntry {
  readonly userId: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface BranchPrivacyInput {
  readonly kitchenType: KitchenType;
  readonly postcodeSector: string;
  readonly streetAddress: string;
  readonly areaLocality: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly contactPersonName: string;
  readonly contactPersonPhone: string;
  readonly contactPersonEmail: string | null;
  readonly supportsTakeaway: boolean;
  readonly homePickupPrivacyMode: HomePickupPrivacyMode;
  readonly dropPointConfig: DropPointConfig | null;
  readonly approvedTakeawayUserIds: readonly TakeawayWhitelistEntry[];
}

export interface ProjectedBranchLocation {
  readonly isAddressRedacted: boolean;
  readonly privacyNotice: string | null;
  readonly postcodeSector: string;
  readonly areaLocality: string | null;
  readonly streetAddress: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly dropPoint: DropPointConfig | null;
  readonly contactPersonName: string;
  readonly contactPersonPhone: string | null;
  readonly contactPersonEmail: string | null;
  readonly canOrderTakeawayDirectly: boolean;
  readonly takeawayWhitelistStatus: 'NOT_REQUIRED' | 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export function projectBranchLocationForViewer(
  branch: BranchPrivacyInput,
  viewer: {
    readonly userId?: string;
    readonly isPrivilegedStaffOrRider?: boolean;
  } = {},
): ProjectedBranchLocation {
  const fullLat = branch.latitude !== null ? Number.parseFloat(branch.latitude) : null;
  const fullLng = branch.longitude !== null ? Number.parseFloat(branch.longitude) : null;

  if (branch.kitchenType !== 'HOME_KITCHEN' || viewer.isPrivilegedStaffOrRider) {
    return {
      isAddressRedacted: false,
      privacyNotice: null,
      postcodeSector: branch.postcodeSector,
      areaLocality: branch.areaLocality,
      streetAddress: branch.streetAddress,
      latitude: fullLat,
      longitude: fullLng,
      dropPoint: branch.dropPointConfig,
      contactPersonName: branch.contactPersonName,
      contactPersonPhone: branch.contactPersonPhone,
      contactPersonEmail: branch.contactPersonEmail,
      canOrderTakeawayDirectly: branch.supportsTakeaway,
      takeawayWhitelistStatus: 'NOT_REQUIRED',
    };
  }

  if (branch.dropPointConfig) {
    return {
      isAddressRedacted: true,
      privacyNotice: 'Home kitchen address is private. Collect takeaway at the public drop point.',
      postcodeSector: branch.postcodeSector,
      areaLocality: branch.dropPointConfig.areaLocality ?? branch.areaLocality,
      streetAddress: null,
      latitude: branch.dropPointConfig.latitude ?? null,
      longitude: branch.dropPointConfig.longitude ?? null,
      dropPoint: branch.dropPointConfig,
      contactPersonName: branch.contactPersonName,
      contactPersonPhone: null,
      contactPersonEmail: null,
      canOrderTakeawayDirectly: branch.supportsTakeaway,
      takeawayWhitelistStatus: 'NOT_REQUIRED',
    };
  }

  const entry = viewer.userId
    ? branch.approvedTakeawayUserIds.find((e) => e.userId === viewer.userId)
    : undefined;
  const whitelistStatus =
    branch.homePickupPrivacyMode === 'WHITELIST' ? (entry?.status ?? 'NONE') : 'NOT_REQUIRED';
  const isApproved =
    branch.homePickupPrivacyMode === 'ORDER_ACCEPTANCE' || whitelistStatus === 'APPROVED';

  return {
    isAddressRedacted: true,
    privacyNotice:
      branch.homePickupPrivacyMode === 'WHITELIST'
        ? 'Host whitelist approval required before viewing collection address.'
        : 'Exact residential address is shared after the host accepts your order.',
    postcodeSector: branch.postcodeSector,
    areaLocality: branch.areaLocality,
    streetAddress: null,
    latitude: null,
    longitude: null,
    dropPoint: null,
    contactPersonName: branch.contactPersonName,
    contactPersonPhone: null,
    contactPersonEmail: null,
    canOrderTakeawayDirectly: branch.supportsTakeaway && isApproved,
    takeawayWhitelistStatus: whitelistStatus,
  };
}
