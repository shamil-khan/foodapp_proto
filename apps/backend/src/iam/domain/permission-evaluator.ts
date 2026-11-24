// FILE: apps/backend/src/iam/domain/permission-evaluator.ts
import { ALL_PERMISSIONS, type Permission, type PermissionEffect } from '@foodapp/db';

const ALLOWED_PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export interface DirectPermissionPolicyRule {
  readonly permission: string;
  readonly effect: PermissionEffect;
  readonly validFrom: string | Date | null;
  readonly expiresAt: string | Date | null;
}

function isRuleActiveAt(rule: DirectPermissionPolicyRule, at: Date): boolean {
  if (rule.validFrom && new Date(rule.validFrom) > at) {
    return false;
  }
  if (rule.expiresAt && new Date(rule.expiresAt) <= at) {
    return false;
  }
  return true;
}

/**
 * Composes role-granted permissions with per-staff ALLOW/DENY policy rules.
 * Explicit DENY rules always take precedence over role or direct ALLOW grants.
 */
export function evaluateEffectivePermissions(params: {
  readonly rolePermissions: readonly Permission[];
  readonly directRules: readonly DirectPermissionPolicyRule[];
  readonly now?: Date;
}): readonly Permission[] {
  const now = params.now ?? new Date();
  const effective = new Set<Permission>(
    params.rolePermissions.filter((perm): perm is Permission => ALLOWED_PERMISSION_SET.has(perm)),
  );
  const denied = new Set<Permission>();

  for (const rule of params.directRules) {
    if (!ALLOWED_PERMISSION_SET.has(rule.permission)) continue;
    if (!isRuleActiveAt(rule, now)) continue;

    const perm = rule.permission as Permission;
    if (rule.effect === 'DENY') {
      denied.add(perm);
    } else if (rule.effect === 'ALLOW') {
      effective.add(perm);
    }
  }

  for (const perm of denied) {
    effective.delete(perm);
  }

  return Array.from(effective);
}
