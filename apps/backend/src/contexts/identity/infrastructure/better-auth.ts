import { pgPool, redisClient } from '@foodapp/db';
import { betterAuth } from 'better-auth';
import { admin, phoneNumber } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import { AppLogger } from '@/logger';

const bootstrapLog = new AppLogger('better-auth');

if (!redisClient.isOpen) {
  await redisClient.connect();
}

const ac = createAccessControl(defaultStatements);

const platformAdminRole = ac.newRole({
  ...adminAc.statements,
});

const customerRole = ac.newRole({
  user: [],
  session: [],
});

export const auth = betterAuth({
  database: pgPool,

  // 1. Hybrid PostgreSQL + Redis Secondary Storage (Microservice-ready)
  secondaryStorage: {
    get: async (key) => {
      return await redisClient.get(`auth:${key}`);
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await redisClient.set(`auth:${key}`, value, {
          EX: ttl,
        });
      } else {
        await redisClient.set(`auth:${key}`, value);
      }
    },
    delete: async (key) => {
      await redisClient.del(`auth:${key}`);
    },
  },

  // 2. Desktop Login for Platform Admins
  emailAndPassword: {
    enabled: true,
  },

  // 3. Map custom RBAC role onto global User table
  user: {
    modelName: 'User',
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'CUSTOMER',
      },
    },
  },
  session: {
    modelName: 'Session',
  },
  account: {
    modelName: 'Account',
  },
  verification: {
    modelName: 'Verification',
  },
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: mobile, code }) => {
        bootstrapLog.info`[SMS OTP Showcase] Sending code ${code} to ${mobile}`;
      },
      signUpOnVerification: {
        getTempEmail: (mobile) => `${mobile.replace(/[^0-9]/g, '')}@phone.ukfoodpos.co.uk`,
        getTempName: (mobile) => `User ${mobile.slice(-4)}`,
      },
    }),
    admin({
      ac,
      roles: {
        PLATFORM_ADMIN: platformAdminRole,
        CUSTOMER: customerRole,
      },
      defaultRole: 'CUSTOMER',
      adminRoles: [
        'PLATFORM_ADMIN',
      ],
    }),
  ],
});
