import type { OperationalStatus, redisClient } from '@foodapp/db';

type RedisClientType = typeof redisClient;

export interface CachedBranchStatus {
  readonly branchId: string;
  readonly operationalStatus: OperationalStatus;
  readonly statusLockedUntil: string | null;
  readonly statusReason: string | null;
}

/**
 * Redis Cache-Aside for daily branch operational status & 1-hour BUSY_PAUSED cooldown lock.
 */
export class BranchStatusCache {
  private static readonly TTL_SECONDS = 3600;
  private readonly redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  private keyForBranch(branchId: string): string {
    return `branch:status:${branchId}`;
  }

  async getStatus(branchId: string): Promise<CachedBranchStatus | null> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
    const raw = await this.redis.get(this.keyForBranch(branchId));
    return raw ? (JSON.parse(raw) as CachedBranchStatus) : null;
  }

  async setStatus(entry: CachedBranchStatus): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
    await this.redis.set(this.keyForBranch(entry.branchId), JSON.stringify(entry), {
      EX: BranchStatusCache.TTL_SECONDS,
    });
  }

  async invalidate(branchId: string): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
    await this.redis.del(this.keyForBranch(branchId));
  }
}
