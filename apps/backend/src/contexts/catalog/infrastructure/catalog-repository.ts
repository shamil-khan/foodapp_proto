import {
  CategoryTable,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  MenuSnapshotTable,
  RestaurantTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type { Pool } from 'pg';
import {
  type CompiledMenuSnapshot,
  MenuSnapshotBuilder,
  type SnapshotModifierDto,
} from '@/contexts/catalog/domain/menu-snapshot-builder';

export class CatalogRepository {
  constructor(private readonly pool: Pool) {}

  async updateItemPrice(params: {
    menuItemId: string;
    newBasePrice: number;
    expectedRowVersion: number;
    actorId: string;
  }): Promise<{
    updated: boolean;
    restaurantId?: string;
  }> {
    const mCols = MenuItemTable.cols;

    const itemLookup = sqlSelect(MenuItemTable)
      .select([
        mCols.categoryId,
      ])
      .whereEq(mCols.id, params.menuItemId)
      .activeOnly()
      .compile();

    const itemRes = await this.pool.query<typeof itemLookup._result>(
      itemLookup.text,
      itemLookup.params,
    );
    const itemRow = itemRes.rows[0];
    if (!itemRow) {
      return {
        updated: false,
      };
    }

    const cCols = CategoryTable.cols;
    const catLookup = sqlSelect(CategoryTable)
      .select([
        cCols.restaurantId,
      ])
      .whereEq(cCols.id, itemRow.categoryId)
      .activeOnly()
      .compile();

    const catRes = await this.pool.query<typeof catLookup._result>(
      catLookup.text,
      catLookup.params,
    );
    const restaurantId = catRes.rows[0]?.restaurantId;

    const updateCmd = sqlUpdate(MenuItemTable)
      .set({
        basePrice: params.newBasePrice.toFixed(2),
      })
      .withAuditBump(params.actorId)
      .whereEq(mCols.id, params.menuItemId)
      .whereEq(mCols.rowVersion, params.expectedRowVersion)
      .whereNull(mCols.deletedAt)
      .compile();

    const res = await this.pool.query(updateCmd.text, updateCmd.params);
    return {
      updated: (res.rowCount ?? 0) === 1,
      restaurantId,
    };
  }

  async rebuildAndPersistSnapshot(
    restaurantId: string,
    actorId: string,
  ): Promise<CompiledMenuSnapshot | null> {
    const rCols = RestaurantTable.cols;
    const restQuery = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
        rCols.name,
        rCols.postcodeSector,
      ])
      .whereEq(rCols.id, restaurantId)
      .activeOnly()
      .compile();

    const restRes = await this.pool.query<typeof restQuery._result>(
      restQuery.text,
      restQuery.params,
    );
    const restaurant = restRes.rows[0];
    if (!restaurant) return null;

    const builder = new MenuSnapshotBuilder().setRestaurant(
      restaurant.id,
      restaurant.name,
      restaurant.postcodeSector,
    );

    const cCols = CategoryTable.cols;
    const catQuery = sqlSelect(CategoryTable)
      .select([
        cCols.id,
        cCols.name,
        cCols.sortWeight,
      ])
      .whereEq(cCols.restaurantId, restaurantId)
      .activeOnly()
      .orderBy(cCols.sortWeight, 'ASC')
      .compile();

    const { rows: categories } = await this.pool.query<typeof catQuery._result>(
      catQuery.text,
      catQuery.params,
    );

    if (categories.length > 0) {
      for (const cat of categories) {
        builder.addCategory(cat.id, cat.name, cat.sortWeight);
      }

      const mCols = MenuItemTable.cols;
      const itemQuery = sqlSelect(MenuItemTable)
        .select([
          mCols.id,
          mCols.categoryId,
          mCols.name,
          mCols.description,
          mCols.basePrice,
          mCols.vatRate,
          mCols.allergenFlags,
          mCols.kdsTarget,
          mCols.imageUrl,
        ])
        .whereIn(
          mCols.categoryId,
          categories.map((c) => c.id),
        )
        .whereEq(mCols.isActive, true)
        .activeOnly()
        .compile();

      const { rows: items } = await this.pool.query<typeof itemQuery._result>(
        itemQuery.text,
        itemQuery.params,
      );

      const modsByItem = new Map<string, SnapshotModifierDto[]>();
      if (items.length > 0) {
        const modCols = ItemModifierTable.cols;
        const modQuery = sqlSelect(ItemModifierTable)
          .select([
            modCols.id,
            modCols.menuItemId,
            modCols.name,
            modCols.extraPrice,
          ])
          .whereIn(
            modCols.menuItemId,
            items.map((i) => i.id),
          )
          .activeOnly()
          .compile();

        const { rows: modifiers } = await this.pool.query<typeof modQuery._result>(
          modQuery.text,
          modQuery.params,
        );

        for (const mod of modifiers) {
          const list = modsByItem.get(mod.menuItemId) ?? [];
          list.push({
            id: mod.id,
            name: mod.name,
            extraPrice: Number.parseFloat(mod.extraPrice),
          });
          modsByItem.set(mod.menuItemId, list);
        }
      }

      for (const item of items) {
        builder.addMenuItem(item.categoryId, {
          id: item.id,
          name: item.name,
          description: item.description,
          basePrice: Number.parseFloat(item.basePrice),
          vatRate: Number.parseFloat(item.vatRate),
          allergenFlags: item.allergenFlags ?? [],
          kdsTarget: item.kdsTarget as KdsRoutingTarget,
          imageUrl: item.imageUrl,
          modifiers: modsByItem.get(item.id) ?? [],
        });
      }
    }

    const compiled = builder.build();

    const sCols = MenuSnapshotTable.cols;
    const existingSnap = sqlSelect(MenuSnapshotTable)
      .select([
        sCols.id,
      ])
      .whereEq(sCols.restaurantId, restaurantId)
      .compile();

    const snapRes = await this.pool.query<typeof existingSnap._result>(
      existingSnap.text,
      existingSnap.params,
    );

    if (snapRes.rows[0]) {
      const updateSnap = sqlUpdate(MenuSnapshotTable)
        .set({
          versionHash: compiled.versionHash,
          serializedMenu: compiled as unknown as Record<string, unknown>,
        })
        .withAuditBump(actorId)
        .whereEq(sCols.restaurantId, restaurantId)
        .compile();

      await this.pool.query(updateSnap.text, updateSnap.params);
    } else {
      const insertSnap = sqlInsert(MenuSnapshotTable)
        .values({
          restaurantId,
          versionHash: compiled.versionHash,
          serializedMenu: compiled as unknown as Record<string, unknown>,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .compile();

      await this.pool.query(insertSnap.text, insertSnap.params);
    }

    return compiled;
  }

  async getPersistedSnapshot(restaurantId: string): Promise<CompiledMenuSnapshot | null> {
    const sCols = MenuSnapshotTable.cols;
    const q = sqlSelect(MenuSnapshotTable)
      .select([
        sCols.serializedMenu,
      ])
      .whereEq(sCols.restaurantId, restaurantId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    return (rows[0]?.serializedMenu as unknown as CompiledMenuSnapshot) ?? null;
  }
}
