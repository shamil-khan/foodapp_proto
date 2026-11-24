import type { redisClient } from '@foodapp/db';
import type { OrderChannel } from '@/orders/domain/order-events';

type RedisClientType = typeof redisClient;

export interface CartLineInput {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly modifierIds?: readonly string[];
}

export interface StoredCustomerCart {
  readonly userId: string;
  readonly branchId: string;
  readonly orderSource: OrderChannel;
  readonly promoCode?: string;
  readonly lines: readonly CartLineInput[];
  readonly updatedAt: string;
}

export interface CartStorePort {
  getCart(userId: string, branchId: string): Promise<StoredCustomerCart | null>;
  saveCart(cart: StoredCustomerCart): Promise<void>;
  mergeGuestCart(params: {
    readonly userId: string;
    readonly branchId: string;
    readonly orderSource: OrderChannel;
    readonly promoCode?: string;
    readonly guestLines: readonly CartLineInput[];
  }): Promise<StoredCustomerCart>;
  clearCart(userId: string, branchId: string): Promise<void>;
}

function lineSignature(line: CartLineInput): string {
  const mods = [
    ...(line.modifierIds ?? []),
  ]
    .sort()
    .join(',');
  return `${line.menuItemId}::${mods}`;
}

export class RedisCartService implements CartStorePort {
  private static readonly TTL_SECONDS = 86_400;
  private readonly redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  private keyFor(userId: string, branchId: string): string {
    return `cart:${userId}:${branchId}`;
  }

  private async ensureOpen(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  async getCart(userId: string, branchId: string): Promise<StoredCustomerCart | null> {
    await this.ensureOpen();
    const raw = await this.redis.get(this.keyFor(userId, branchId));
    return raw ? (JSON.parse(raw) as StoredCustomerCart) : null;
  }

  async saveCart(cart: StoredCustomerCart): Promise<void> {
    await this.ensureOpen();
    await this.redis.set(this.keyFor(cart.userId, cart.branchId), JSON.stringify(cart), {
      EX: RedisCartService.TTL_SECONDS,
    });
  }

  async mergeGuestCart(params: {
    readonly userId: string;
    readonly branchId: string;
    readonly orderSource: OrderChannel;
    readonly promoCode?: string;
    readonly guestLines: readonly CartLineInput[];
  }): Promise<StoredCustomerCart> {
    const existing = await this.getCart(params.userId, params.branchId);
    const mergedMap = new Map<string, CartLineInput>();

    for (const line of existing?.lines ?? []) {
      mergedMap.set(lineSignature(line), line);
    }
    for (const line of params.guestLines) {
      const sig = lineSignature(line);
      const prev = mergedMap.get(sig);
      mergedMap.set(sig, {
        menuItemId: line.menuItemId,
        quantity: (prev?.quantity ?? 0) + line.quantity,
        modifierIds: line.modifierIds,
      });
    }

    const nextCart: StoredCustomerCart = {
      userId: params.userId,
      branchId: params.branchId,
      orderSource: params.orderSource,
      promoCode: params.promoCode ?? existing?.promoCode,
      lines: [
        ...mergedMap.values(),
      ],
      updatedAt: new Date().toISOString(),
    };
    await this.saveCart(nextCart);
    return nextCart;
  }

  async clearCart(userId: string, branchId: string): Promise<void> {
    await this.ensureOpen();
    await this.redis.del(this.keyFor(userId, branchId));
  }
}
