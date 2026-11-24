// FILE: apps/backend/src/brand/domain/brand-events.ts
import type { KitchenType, MenuSelectionMode } from '@foodapp/db';
import type { DomainEvent } from '@/core/domain/domain-event';

export interface BrandRegisteredPayload {
  readonly restaurantId: string;
  readonly brandName: string;
  readonly brandHandle: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly postcodeSector: string;
  readonly kitchenType: KitchenType;
  readonly isMultiBranchEnterprise: boolean;
  readonly ownerStaffId: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPasswordHash: string;
}

export interface BrandOwnerBootstrappedPayload {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly ownerStaffId: string;
  readonly ownerRoleId: string;
}

export interface BrandCatalogInitializedPayload {
  readonly restaurantId: string;
  readonly branchId: string;
}

export interface BrandOnboardingStepFailedPayload {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly ownerStaffId: string;
  readonly failedStep: 'IAM_BOOTSTRAP' | 'CATALOG_INITIALIZATION';
  readonly reason: string;
}

export interface BrandOnboardingCompensationPayload {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly ownerStaffId: string;
  readonly reason: string;
}

export interface BranchCreatedPayload {
  readonly restaurantId: string;
  readonly brandName: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly postcodeSector: string;
  readonly menuSelectionMode: MenuSelectionMode;
}

export interface BranchSettingsUpdatedPayload {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly menuSelectionMode?: MenuSelectionMode;
}

export type BrandRegisteredEvent = DomainEvent<BrandRegisteredPayload>;
export type BrandOwnerBootstrappedEvent = DomainEvent<BrandOwnerBootstrappedPayload>;
export type BrandCatalogInitializedEvent = DomainEvent<BrandCatalogInitializedPayload>;
export type BrandOnboardingStepFailedEvent = DomainEvent<BrandOnboardingStepFailedPayload>;
export type BrandOnboardingCompensationEvent = DomainEvent<BrandOnboardingCompensationPayload>;
export type BranchCreatedEvent = DomainEvent<BranchCreatedPayload>;
export type BranchSettingsUpdatedEvent = DomainEvent<BranchSettingsUpdatedPayload>;
