// FILE: apps/backend/src/iam/infrastructure/better-auth.ts (Part 1 of 2)
import { pgPool, redisClient } from '@foodapp/db';
import { betterAuth } from 'better-auth';
import { admin, bearer, phoneNumber } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import { getAllowedOrigins } from '@/config/cors';
import { AppLogger } from '@/logger';

const bootstrapLog = new AppLogger('better-auth');

async function ensureRedisConnected() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
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
  trustedOrigins: getAllowedOrigins,

  secondaryStorage: {
    get: async (key) => {
      const client = await ensureRedisConnected();
      return await client.get(`auth:${key}`);
    },
    set: async (key, value, ttl) => {
      const client = await ensureRedisConnected();
      if (ttl) {
        await client.set(`auth:${key}`, value, {
          EX: ttl,
        });
      } else {
        await client.set(`auth:${key}`, value);
      }
    },
    delete: async (key) => {
      const client = await ensureRedisConnected();
      await client.del(`auth:${key}`);
    },
    getAndDelete: async (key) => {
      const client = await ensureRedisConnected();
      return await client.getDel(`auth:${key}`);
    },
    increment: async (key, value = 1) => {
      const client = await ensureRedisConnected();
      return await client.incrBy(`auth:${key}`, value);
    },
  },
  // FILE: apps/backend/src/iam/infrastructure/better-auth.ts (Part 2 of 2)
  emailAndPassword: {
    enabled: true,
  },

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
    bearer(),
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
