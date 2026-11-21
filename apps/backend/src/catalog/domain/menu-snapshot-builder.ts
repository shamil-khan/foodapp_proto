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
  effectivePrice: number;
  vatRate: number;
  allergenFlags: string[];
  ingredientTags: string[];
  kdsTarget: KdsRoutingTarget;
  imageUrl: string | null;
  isBranchLocal: boolean;
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
  branchId: string;
  brandName: string;
  branchName: string;
  postcodeSector: string;
  versionHash: string;
  generatedAt: string;
  categories: SnapshotCategoryDto[];
}

/**
 * GoF Builder Pattern: Assembles branch-compiled menu snapshots with branch overrides & tags.
 */
export class MenuSnapshotBuilder {
  private restaurantId = '';
  private branchId = '';
  private brandName = '';
  private branchName = '';
  private postcodeSector = '';
  private readonly categories = new Map<string, SnapshotCategoryDto>();

  setBranchContext(params: {
    restaurantId: string;
    branchId: string;
    brandName: string;
    branchName: string;
    postcodeSector: string;
  }): this {
    this.restaurantId = params.restaurantId;
    this.branchId = params.branchId;
    this.brandName = params.brandName;
    this.branchName = params.branchName;
    this.postcodeSector = params.postcodeSector;
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
    const sortedCategories = Array.from(this.categories.values())
      .filter((c) => c.items.length > 0)
      .sort((a, b) => a.sortWeight - b.sortWeight);

    const payloadToHash = JSON.stringify({
      restaurantId: this.restaurantId,
      branchId: this.branchId,
      categories: sortedCategories,
    });

    const versionHash = crypto
      .createHash('sha256')
      .update(payloadToHash)
      .digest('hex')
      .slice(0, 16);

    return {
      restaurantId: this.restaurantId,
      branchId: this.branchId,
      brandName: this.brandName,
      branchName: this.branchName,
      postcodeSector: this.postcodeSector,
      versionHash,
      generatedAt: new Date().toISOString(),
      categories: sortedCategories,
    };
  }
}
