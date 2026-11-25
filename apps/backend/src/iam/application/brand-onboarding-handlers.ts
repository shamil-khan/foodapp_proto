import * as crypto from 'node:crypto';
import {
  type DbExecutor,
  ProcessedEventTable,
  RestaurantStaffTable,
  StaffBranchAssignmentTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  SYSTEM_ROLE_DEFINITIONS,
  type SystemRoleName,
  sqlInsert,
  type UnitOfWork,
} from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import { AppLogger } from '@/logger';

interface BrandRegisteredEventPayload {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly isMultiBranchEnterprise: boolean;
  readonly ownerStaffId: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPasswordHash: string;
}

interface CompensationEventPayload {
  readonly restaurantId: string;
  readonly ownerStaffId: string;
}

export class BrandIamOnboardingHandler {
  private readonly log = new AppLogger('iam-brand-onboarding');
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;

  constructor(uow: UnitOfWork, eventBus: EventBus) {
    this.uow = uow;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string, tx: DbExecutor): Promise<boolean> {
    const pCols = ProcessedEventTable.cols;
    const ins = sqlInsert(ProcessedEventTable)
      .values({
        eventId,
        consumerName: 'BrandIamOnboardingHandler',
      })
      .onConflictDoNothing([
        pCols.eventId,
      ])
      .returning([
        pCols.eventId,
      ])
      .compile();

    const row = await tx.queryOne(ins);
    return Boolean(row);
  }

  private async purgeIamRecords(restaurantId: string, ownerStaffId: string): Promise<void> {
    await this.uow.transaction(async (tx) => {
      await tx.executeRaw(`DELETE FROM "StaffBranchAssignment" WHERE "staffId" = $1`, [
        ownerStaffId,
      ]);
      await tx.executeRaw(`DELETE FROM "RestaurantStaff" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await tx.executeRaw(
        `DELETE FROM "StaffRolePermission" WHERE "staffRoleId" IN (SELECT "id" FROM "StaffRole" WHERE "restaurantId" = $1)`,
        [
          restaurantId,
        ],
      );
      await tx.executeRaw(`DELETE FROM "StaffRole" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
    });
  }

  private async seedBrandRolesAndOwner(
    eventId: string,
    p: BrandRegisteredEventPayload,
    actorId: string,
  ): Promise<string | null> {
    const rolesToSeed: readonly SystemRoleName[] = p.isMultiBranchEnterprise
      ? [
          'BRAND_OWNER',
          'OPERATIONAL_MANAGER',
          'BRANCH_MANAGER',
          'SHIFT_SUPERVISOR',
          'CASHIER',
          'KITCHEN_STAFF',
        ]
      : [
          'OWNER',
          'STAFF',
        ];
    const ownerRoleName: SystemRoleName = p.isMultiBranchEnterprise ? 'BRAND_OWNER' : 'OWNER';

    return await this.uow.transaction(async (tx) => {
      if (!(await this.claimEventOnce(eventId, tx))) return null;

      let ownerRoleId = '';
      const srCols = StaffRoleTable.cols;
      for (const roleName of rolesToSeed) {
        const def = SYSTEM_ROLE_DEFINITIONS[roleName];
        const roleIns = sqlInsert(StaffRoleTable)
          .values({
            restaurantId: p.restaurantId,
            name: roleName,
            description: def.description,
            isSystemRole: true,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning([
            srCols.id,
          ])
          .compile();
        const roleRow = await tx.queryOne(roleIns);
        const createdRoleId = roleRow?.id;
        if (!createdRoleId) throw new Error(`Failed to seed role ${roleName}`);
        if (roleName === ownerRoleName) ownerRoleId = createdRoleId;

        for (const perm of def.permissions) {
          const permIns = sqlInsert(StaffRolePermissionTable)
            .values({
              staffRoleId: createdRoleId,
              permission: perm,
              createdBy: actorId,
              updatedBy: actorId,
            })
            .compile();
          await tx.execute(permIns);
        }
      }

      const staffIns = sqlInsert(RestaurantStaffTable)
        .values({
          id: p.ownerStaffId,
          restaurantId: p.restaurantId,
          email: p.ownerEmail,
          passwordHash: p.ownerPasswordHash,
          name: p.ownerName,
          role: 'OWNER',
          roleId: ownerRoleId,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .compile();
      await tx.execute(staffIns);

      const assignIns = sqlInsert(StaffBranchAssignmentTable)
        .values({
          staffId: p.ownerStaffId,
          branchId: p.branchId,
          staffRoleId: ownerRoleId,
          isPrimary: true,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .compile();
      await tx.execute(assignIns);

      return ownerRoleId;
    });
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BrandRegistered', async (event) => {
      const p = event.payload as unknown as BrandRegisteredEventPayload;

      let ownerRoleId: string | null = null;
      try {
        ownerRoleId = await this.seedBrandRolesAndOwner(event.eventId, p, event.metadata.actorId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'IAM onboarding failed';
        await this.eventBus.publish([
          {
            eventId: crypto.randomUUID(),
            aggregateId: p.restaurantId,
            aggregateType: 'IamOnboarding',
            eventType: 'BrandOnboardingStepFailed',
            version: 1,
            occurredAt: new Date(),
            payload: {
              restaurantId: p.restaurantId,
              branchId: p.branchId,
              ownerStaffId: p.ownerStaffId,
              failedStep: 'IAM_BOOTSTRAP',
              reason,
            },
            metadata: event.metadata,
          },
        ]);
        return;
      }

      if (!ownerRoleId) return;

      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: p.restaurantId,
          aggregateType: 'IamOnboarding',
          eventType: 'BrandOwnerBootstrapped',
          version: 1,
          occurredAt: new Date(),
          payload: {
            restaurantId: p.restaurantId,
            branchId: p.branchId,
            ownerStaffId: p.ownerStaffId,
            ownerRoleId,
          },
          metadata: event.metadata,
        },
      ]);
      this.log.info`Bootstrapped IAM roles & owner ${p.ownerStaffId} for brand ${p.restaurantId}`;
    });

    eventBus.subscribe('BrandOnboardingCompensationRequested', async (event) => {
      const p = event.payload as unknown as CompensationEventPayload;
      await this.purgeIamRecords(p.restaurantId, p.ownerStaffId);
      this.log.info`Purged uncommitted IAM records for failed brand ${p.restaurantId}`;
    });
  }
}
