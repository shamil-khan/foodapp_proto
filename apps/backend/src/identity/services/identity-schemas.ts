import { ALL_PERMISSIONS, TENANT_PERMISSIONS } from '@foodapp/db';
import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const TenantPermissionSchema = z.enum(TENANT_PERMISSIONS).openapi('TenantPermission');
export const PermissionSchema = z.enum(ALL_PERMISSIONS).openapi('Permission');

export const PosLoginBodySchema = z
  .object({
    brandHandle: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/i, 'Brand handle must contain only letters, numbers, and hyphens')
      .openapi({
        example: 'pizza-hut',
      }),
    email: z.email().openapi({
      example: 'owner@://example.com',
    }),
    password: z.string().min(1).openapi({
      example: 'Password123!',
    }),
    branchId: z.uuid().optional(),
  })
  .openapi('PosLoginBody');

export const SwitchBranchBodySchema = z
  .object({
    targetBranchId: z.uuid(),
  })
  .openapi('SwitchBranchBody');

export const StaffAssignedBranchSchema = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  branchKey: z.string(),
  city: z.string(),
  cityKey: z.string(),
  roleId: z.string(),
  roleName: z.string(),
  isPrimary: z.boolean(),
});

export const PosStaffClaimsSchema = z
  .object({
    staffId: z.uuid(),
    restaurantId: z.uuid(),
    brandHandle: z.string(),
    activeBranchId: z.string(),
    activeBranchKey: z.string(),
    roleId: z.string(),
    role: z.enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'ORDER_TAKER',
    ]),
    name: z.string(),
    email: z.email(),
    permissions: z.array(PermissionSchema),
    assignedBranches: z.array(StaffAssignedBranchSchema),
  })
  .openapi('PosStaffClaims');

export const PosLoginResponseSchema = z
  .object({
    success: z.literal(true),
    token: z.string(),
    staff: PosStaffClaimsSchema,
  })
  .openapi('PosLoginResponse');

export const ActiveActorProfileSchema = z
  .object({
    id: z.uuid(),
    source: z.enum([
      'GLOBAL_USER',
      'POS_STAFF',
      'SYSTEM',
    ]),
    name: z.string(),
    email: z.email(),
    role: z.string(),
    restaurantId: z.uuid().optional(),
    branchId: z.string().optional(),
    roleId: z.string().optional(),
    permissions: z.array(PermissionSchema),
  })
  .openapi('ActiveActorProfile');

export const StaffRoleItemSchema = z
  .object({
    id: z.uuid(),
    restaurantId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    isSystemRole: z.boolean(),
    permissions: z.array(TenantPermissionSchema),
  })
  .openapi('StaffRoleItem');

export const ListRolesQuerySchema = z.object({
  restaurantId: z
    .uuid()
    .optional()
    .openapi({
      param: {
        name: 'restaurantId',
        in: 'query',
      },
    }),
});

export const RoleIdParamSchema = z.object({
  roleId: z.uuid().openapi({
    param: {
      name: 'roleId',
      in: 'path',
    },
  }),
});

export const StaffIdParamSchema = z.object({
  staffId: z.uuid().openapi({
    param: {
      name: 'staffId',
      in: 'path',
    },
  }),
});

export const CreateStaffRoleBodySchema = z
  .object({
    restaurantId: z.uuid().optional(),
    name: z.string().min(2).max(50).openapi({
      example: 'EVENING_FLOOR_LEAD',
    }),
    description: z.string().max(255).optional(),
    permissions: z.array(TenantPermissionSchema).min(1),
  })
  .openapi('CreateStaffRoleBody');

export const UpdateStaffRoleBodySchema = z
  .object({
    name: z.string().min(2).max(50).optional(),
    description: z.string().max(255).nullable().optional(),
    permissions: z.array(TenantPermissionSchema).min(1),
  })
  .openapi('UpdateStaffRoleBody');

export const AssignStaffBranchAccessBodySchema = z
  .object({
    branchId: z.uuid().optional(),
    roleId: z.uuid(),
    directPermissions: z.array(TenantPermissionSchema).optional(),
    isPrimary: z.boolean().optional(),
  })
  .openapi('AssignStaffBranchAccessBody');

export const loginPosStaffRoute = createRoute({
  method: 'post',
  path: '/pos/auth/login',
  tags: [
    'Identity',
  ],
  summary: 'Authenticate POS staff by brand handle and issue 12h shift JWT + assigned branches',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: PosLoginBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authenticated POS staff session',
      content: {
        'application/json': {
          schema: PosLoginResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Invalid credentials',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Tenant suspended or no branch assigned',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const switchPosBranchRoute = createRoute({
  method: 'post',
  path: '/pos/auth/switch-branch',
  tags: [
    'Identity',
  ],
  summary: 'Switch active branch on the single POS shift cookie and refresh branch permissions',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SwitchBranchBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Switched branch session',
      content: {
        'application/json': {
          schema: PosLoginResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Target branch not assigned',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Branch not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const logoutPosStaffRoute = createRoute({
  method: 'post',
  path: '/pos/auth/logout',
  tags: [
    'Identity',
  ],
  summary: 'Clear POS staff shift cookie session',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Shift session cleared',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
  },
});

export const getCurrentActorRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: [
    'Identity',
  ],
  summary: 'Get currently authenticated actor, active branchId, and effective permissions',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Active actor profile',
      content: {
        'application/json': {
          schema: z.object({
            actor: ActiveActorProfileSchema,
          }),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const listAssignablePermissionsRoute = createRoute({
  method: 'get',
  path: '/pos/roles/rights',
  tags: [
    'Identity & Roles',
  ],
  summary: 'List all system-defined tenant rights and grouped catalog metadata',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Available tenant rights and catalog',
      content: {
        'application/json': {
          schema: z.object({
            rights: z.array(TenantPermissionSchema),
            catalog: z.array(z.record(z.string(), z.unknown())),
          }),
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Missing staff:roles:manage right',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const listStaffRolesRoute = createRoute({
  method: 'get',
  path: '/pos/roles',
  tags: [
    'Identity & Roles',
  ],
  summary: 'List predefined and custom roles for a brand',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: ListRolesQuerySchema,
  },
  responses: {
    200: {
      description: 'Brand roles with rights',
      content: {
        'application/json': {
          schema: z.object({
            roles: z.array(StaffRoleItemSchema),
          }),
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const createStaffRoleRoute = createRoute({
  method: 'post',
  path: '/pos/roles',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Create a custom role (rights cannot exceed actor permissions)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateStaffRoleBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Custom role created',
      content: {
        'application/json': {
          schema: z.object({
            roleId: z.uuid(),
            name: z.string(),
            permissions: z.array(TenantPermissionSchema),
          }),
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden or privilege escalation denied',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Role exists',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const updateStaffRoleRoute = createRoute({
  method: 'patch',
  path: '/pos/roles/{roleId}',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Update custom role (predefined system roles are immutable)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: RoleIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateStaffRoleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Role updated',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'System role locked or privilege escalation denied',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Role not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const deleteStaffRoleRoute = createRoute({
  method: 'delete',
  path: '/pos/roles/{roleId}',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Soft-delete a custom role (predefined system roles are immutable)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: RoleIdParamSchema,
  },
  responses: {
    200: {
      description: 'Role deleted',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },

    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'System role locked',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Role not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Role in use',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const assignStaffBranchAccessRoute = createRoute({
  method: 'patch',
  path: '/pos/staff/{staffId}/branch-access',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Assign a role and optional direct individual permissions to a staff member on a branch',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: StaffIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: AssignStaffBranchAccessBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Staff branch access updated',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden or privilege escalation denied',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Staff or role not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
