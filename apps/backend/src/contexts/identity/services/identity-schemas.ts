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
    subdomain: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/i, 'Subdomain must contain only letters, numbers, and hyphens')
      .openapi({
        example: 'westminster-patty',
        description: 'Unique restaurant URL subdomain (e.g. subway from ://fapp.com)',
      }),
    email: z.email().openapi({
      example: 'staff1.0002@pos-tenant.co.uk',
    }),
    password: z.string().min(1).openapi({
      example: 'Password123!',
    }),
  })
  .openapi('PosLoginBody');

export const PosStaffClaimsSchema = z
  .object({
    staffId: z.uuid(),
    restaurantId: z.uuid(),
    subdomain: z.string(),
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
  })
  .openapi('PosStaffClaims');

export const PosLoginResponseSchema = z
  .object({
    success: z.literal(true),
    token: z.string().openapi({
      description: 'HS256 POS shift JWT (12h TTL)',
    }),
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
    roleId: z.string().optional(),
    permissions: z.array(PermissionSchema),
  })
  .openapi('ActiveActorProfile');

export const GetCurrentActorResponseSchema = z
  .object({
    actor: ActiveActorProfileSchema,
  })
  .openapi('GetCurrentActorResponse');

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
      description: 'Optional target restaurantId (allowed only for PLATFORM_ADMIN)',
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
      example: 'SHIFT_SUPERVISOR',
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

export const AssignStaffRoleBodySchema = z
  .object({
    roleId: z.uuid(),
  })
  .openapi('AssignStaffRoleBody');

export const loginPosStaffRoute = createRoute({
  method: 'post',
  path: '/pos/auth/login',
  tags: [
    'Identity',
  ],
  summary: 'Authenticate POS tenant staff by restaurant subdomain and issue 12-hour shift JWT',
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
      description: 'Authenticated POS staff session with resolved permissions',
      content: {
        'application/json': {
          schema: PosLoginResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid POS staff credentials',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Restaurant account suspended',
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
  summary: 'Get currently authenticated actor and effective permissions',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Active actor profile with permissions',
      content: {
        'application/json': {
          schema: GetCurrentActorResponseSchema,
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
  summary: 'List all system-defined tenant rights assignable to restaurant roles',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Available tenant permissions',
      content: {
        'application/json': {
          schema: z.object({
            rights: z.array(TenantPermissionSchema),
          }),
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
  },
});

export const listStaffRolesRoute = createRoute({
  method: 'get',
  path: '/pos/roles',
  tags: [
    'Identity & Roles',
  ],
  summary: 'List dynamic roles and assigned rights for a restaurant',
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
      description: 'Restaurant roles with rights',
      content: {
        'application/json': {
          schema: z.object({
            roles: z.array(StaffRoleItemSchema),
          }),
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
      description: 'Tenant or right forbidden',
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
  summary: 'Create a custom restaurant role with specific rights',
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
      description: 'Role created',
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
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Tenant or right forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Role name already exists',
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
  summary: 'Update role name/description and replace assigned rights (invalidates Redis cache)',
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
    403: {
      description: 'Forbidden or OWNER role locked',
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
  },
});

export const deleteStaffRoleRoute = createRoute({
  method: 'delete',
  path: '/pos/roles/{roleId}',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Soft-delete a custom restaurant role',
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
    403: {
      description: 'Forbidden or system role locked',
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
      description: 'Role currently assigned to active staff',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const assignStaffRoleRoute = createRoute({
  method: 'patch',
  path: '/pos/staff/{staffId}/role',
  tags: [
    'Identity & Roles',
  ],
  summary: 'Assign a restaurant role to a staff member',
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
          schema: AssignStaffRoleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Staff role updated',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    403: {
      description: 'Tenant or right forbidden',
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
  },
});
