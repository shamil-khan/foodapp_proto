// FILE: apps/backend/tests/unit/brand.location-privacy.spec.ts
import { describe, expect, it } from 'vitest';
import {
  type BranchPrivacyInput,
  projectBranchLocationForViewer,
} from '@/brand/domain/location-privacy';

const baseHomeKitchen: BranchPrivacyInput = {
  kitchenType: 'HOME_KITCHEN',
  postcodeSector: 'E1',
  streetAddress: 'Flat 4, 118 Brick Lane, Whitechapel, London E1 6RL',
  areaLocality: 'Whitechapel',
  latitude: '51.521500',
  longitude: '-0.071800',
  contactPersonName: 'Zara',
  contactPersonPhone: '+44-20-7946-0101',
  contactPersonEmail: 'zara@example.com',
  supportsTakeaway: true,
  homePickupPrivacyMode: 'WHITELIST',
  dropPointConfig: null,
  approvedTakeawayUserIds: [
    {
      userId: 'user-approved-1',
      status: 'APPROVED',
    },
  ],
};

describe('brand.location-privacy — Home Kitchen Residential Address Redaction', () => {
  it('redacts exact residential streetAddress and coordinates for unapproved customers', () => {
    const view = projectBranchLocationForViewer(baseHomeKitchen, {
      userId: 'user-stranger-2',
    });

    expect(view.isAddressRedacted).toBe(true);
    expect(view.streetAddress).toBeNull();
    expect(view.latitude).toBeNull();
    expect(view.postcodeSector).toBe('E1');
    expect(view.canOrderTakeawayDirectly).toBe(false);
    expect(view.takeawayWhitelistStatus).toBe('NONE');
  });

  it('reveals full residential address to privileged branch staff or riders', () => {
    const staffView = projectBranchLocationForViewer(baseHomeKitchen, {
      isPrivilegedStaffOrRider: true,
    });

    expect(staffView.isAddressRedacted).toBe(false);
    expect(staffView.streetAddress).toBe(baseHomeKitchen.streetAddress);
    expect(staffView.latitude).toBe(51.5215);
    expect(staffView.canOrderTakeawayDirectly).toBe(true);
  });
});
