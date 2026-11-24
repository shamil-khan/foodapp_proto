// FILE: apps/backend/src/iam/application/brand-onboarding-handlers.ts (Part 1 of 2)
import * as crypto from 'node:crypto';
import {
  type Pool,
  ProcessedEventTable,
  RestaurantStaffTable,
  StaffBranchAssignmentTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  SYSTEM_ROLE_DEFINITIONS,
  type SystemRoleName,
  sqlInsert,
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

/**
 * Listens to `BrandRegistered` to bootstrap initial system roles, permissions, owner staff,
 * and primary branch assignment inside `iam`, and executes hard-delete compensation if
 * downstream onboarding fails.
 */
export class BrandIamOnboardingHandler {
  private readonly log = new AppLogger('iam-brand-onboarding');
  private readonly pool: Pool;
  private readonly eventBus: EventBus;

  constructor(pool: Pool, eventBus: EventBus) {
    this.pool = pool;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string): Promise<boolean> {
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

    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    return (res.rowCount ?? 0) === 1;
  }
  // FILE: apps/backend/src/iam/application/brand-onboarding-handlers.ts (Part 2 of 2)
  // FILE: apps/backend/src/iam/application/brand-onboarding-handlers.ts (Part 2 of 2)
  private async purgeIamRecords(restaurantId: string, ownerStaffId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM "StaffBranchAssignment" WHERE "staffId" = $1`, [
        ownerStaffId,
      ]);
      await client.query(`DELETE FROM "RestaurantStaff" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await client.query(
        `DELETE FROM "StaffRolePermission" WHERE "staffRoleId" IN (SELECT "id" FROM "StaffRole" WHERE "restaurantId" = $1)`,
        [
          restaurantId,
        ],
      );
      await client.query(`DELETE FROM "StaffRole" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async seedBrandRolesAndOwner(
    p: BrandRegisteredEventPayload,
    actorId: string,
  ): Promise<string> {
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

    const client = await this.pool.connect();
    let ownerRoleId = '';
    try {
      await client.query('BEGIN');
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
        const roleRes = await client.query<typeof roleIns._result>(roleIns.text, roleIns.params);
        const createdRoleId = roleRes.rows[0]?.id;
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
          await client.query(permIns.text, permIns.params);
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
      await client.query(staffIns.text, staffIns.params);

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
      await client.query(assignIns.text, assignIns.params);

      await client.query('COMMIT');
      return ownerRoleId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BrandRegistered', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;
      const p = event.payload as unknown as BrandRegisteredEventPayload;

      try {
        const ownerRoleId = await this.seedBrandRolesAndOwner(p, event.metadata.actorId);
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
      }
    });

    eventBus.subscribe('BrandOnboardingCompensationRequested', async (event) => {
      const p = event.payload as unknown as CompensationEventPayload;
      await this.purgeIamRecords(p.restaurantId, p.ownerStaffId);
      this.log.info`Purged uncommitted IAM records for failed brand ${p.restaurantId}`;
    });
  }
}
