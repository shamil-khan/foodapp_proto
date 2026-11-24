import type {
  CachedIdempotencyRecord,
  IdempotencyStorePort,
} from '@/core/services/idempotency-middleware';

export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly locks = new Set<string>();
  private readonly records = new Map<string, CachedIdempotencyRecord>();

  async acquireLock(key: string, _ttlSeconds: number): Promise<boolean> {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }

  async getRecord(key: string): Promise<CachedIdempotencyRecord | null> {
    return this.records.get(key) ?? null;
  }

  async saveRecord(
    key: string,
    record: CachedIdempotencyRecord,
    _ttlSeconds: number,
  ): Promise<void> {
    this.records.set(key, record);
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}
