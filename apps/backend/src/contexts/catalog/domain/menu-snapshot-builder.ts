import * as crypto from 'node:crypto';
import type { KdsRoutingTarget } from '@foodapp/db';

export interface SnapshotModifierDto {
  id: string;
  name: string;
  extraPrice: number;
}

export interface SnapshotMenuItemDto {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  vatRate: number;
  allergenFlags: string[];
  kdsTarget: KdsRoutingTarget;
  imageUrl: string | null;
  modifiers: SnapshotModifierDto[];
}

export interface SnapshotCategoryDto {
  id: string;
  name: string;
  sortWeight: number;
  items: SnapshotMenuItemDto[];
}

export interface CompiledMenuSnapshot {
  restaurantId: string;
  restaurantName: string;
  postcodeSector: string;
  versionHash: string;
  generatedAt: string;
  categories: SnapshotCategoryDto[];
}

export class MenuSnapshotBuilder {
  private restaurantId = '';
  private restaurantName = '';
  private postcodeSector = '';
  private readonly categories = new Map<string, SnapshotCategoryDto>();

  setRestaurant(id: string, name: string, postcodeSector: string): this {
    this.restaurantId = id;
    this.restaurantName = name;
    this.postcodeSector = postcodeSector;
    return this;
  }

  addCategory(id: string, name: string, sortWeight: number): this {
    if (!this.categories.has(id)) {
      this.categories.set(id, {
        id,
        name,
        sortWeight,
        items: [],
      });
    }
    return this;
  }

  addMenuItem(categoryId: string, item: SnapshotMenuItemDto): this {
    const category = this.categories.get(categoryId);
    if (category) {
      category.items.push(item);
    }
    return this;
  }

  build(): CompiledMenuSnapshot {
    const sortedCategories = Array.from(this.categories.values()).sort(
      (a, b) => a.sortWeight - b.sortWeight,
    );

    const payloadToHash = JSON.stringify({
      restaurantId: this.restaurantId,
      restaurantName: this.restaurantName,
      postcodeSector: this.postcodeSector,
      categories: sortedCategories,
    });

    const versionHash = crypto
      .createHash('sha256')
      .update(payloadToHash)
      .digest('hex')
      .slice(0, 16);

    return {
      restaurantId: this.restaurantId,
      restaurantName: this.restaurantName,
      postcodeSector: this.postcodeSector,
      versionHash,
      generatedAt: new Date().toISOString(),
      categories: sortedCategories,
    };
  }
}
