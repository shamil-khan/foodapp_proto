import {
  BranchMenuOverrideTable,
  CatalogBranchProjectionTable,
  CategoryTable,
  type DbExecutor,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  type MenuSelectionMode,
  MenuSnapshotTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import {
  type CompiledMenuSnapshot,
  MenuSnapshotBuilder,
  type SnapshotModifierDto,
} from '@/catalog/domain/menu-snapshot-builder';

export class CatalogRepository {
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork) {
    this.uow = uow;
  }

  async getMenuItemRestaurantId(menuItemId: string): Promise<string | null> {
    const mCols = MenuItemTable.cols;
    const itemLookup = sqlSelect(MenuItemTable)
      .select([
        mCols.categoryId,
      ])
      .whereEq(mCols.id, menuItemId)
      .activeOnly()
      .compile();

    const itemRow = await this.uow.queryOne(itemLookup);
    if (!itemRow) return null;

    const cCols = CategoryTable.cols;
    const catLookup = sqlSelect(CategoryTable)
      .select([
        cCols.restaurantId,
      ])
      .whereEq(cCols.id, itemRow.categoryId)
      .activeOnly()
      .compile();

    const catRow = await this.uow.queryOne(catLookup);
    return catRow?.restaurantId ?? null;
  }

  async updateItemPrice(params: {
    menuItemId: string;
    newBasePrice: number;
    expectedRowVersion: number;
    actorId: string;
  }): Promise<{
    updated: boolean;
    restaurantId?: string;
  }> {
    const restaurantId = await this.getMenuItemRestaurantId(params.menuItemId);
    if (!restaurantId) {
      return {
        updated: false,
      };
    }

    const mCols = MenuItemTable.cols;
    const updateCmd = sqlUpdate(MenuItemTable)
      .set({
        basePrice: params.newBasePrice.toFixed(2),
      })
      .withAuditBump(params.actorId)
      .whereEq(mCols.id, params.menuItemId)
      .whereEq(mCols.rowVersion, params.expectedRowVersion)
      .whereNull(mCols.deletedAt)
      .compile();

    const rowCount = await this.uow.execute(updateCmd);
    return {
      updated: rowCount === 1,
      restaurantId,
    };
  }

  private async fetchModifiersByItem(
    itemIds: readonly string[],
    tx: DbExecutor = this.uow,
  ): Promise<Map<string, SnapshotModifierDto[]>> {
    const modsByItem = new Map<string, SnapshotModifierDto[]>();
    if (itemIds.length === 0) return modsByItem;

    const modCols = ItemModifierTable.cols;
    const modQuery = sqlSelect(ItemModifierTable)
      .select([
        modCols.id,
        modCols.menuItemId,
        modCols.name,
        modCols.extraPrice,
      ])
      .whereIn(modCols.menuItemId, itemIds)
      .activeOnly()
      .compile();

    const modifiers = await tx.queryMany(modQuery);

    for (const mod of modifiers) {
      const list = modsByItem.get(mod.menuItemId) ?? [];
      list.push({
        id: mod.id,
        name: mod.name,
        extraPrice: Number.parseFloat(mod.extraPrice),
      });
      modsByItem.set(mod.menuItemId, list);
    }

    return modsByItem;
  }

  private async populateBranchMenuGraph(params: {
    builder: MenuSnapshotBuilder;
    restaurantId: string;
    branchId: string;
    menuSelectionMode: MenuSelectionMode;
    tx?: DbExecutor;
  }): Promise<void> {
    const exec = params.tx ?? this.uow;

    const cCols = CategoryTable.cols;
    const catQuery = sqlSelect(CategoryTable)
      .select([
        cCols.id,
        cCols.name,
        cCols.sortWeight,
      ])
      .whereEq(cCols.restaurantId, params.restaurantId)
      .activeOnly()
      .orderBy(cCols.sortWeight, 'ASC')
      .compile();

    const categories = await exec.queryMany(catQuery);
    if (categories.length === 0) return;

    for (const cat of categories) {
      params.builder.addCategory(cat.id, cat.name, cat.sortWeight);
    }

    const mCols = MenuItemTable.cols;
    const itemQuery = sqlSelect(MenuItemTable)
      .select([
        mCols.id,
        mCols.categoryId,
        mCols.branchId,
        mCols.name,
        mCols.description,
        mCols.basePrice,
        mCols.vatRate,
        mCols.allergenFlags,
        mCols.ingredientTags,
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

    const allItems = await exec.queryMany(itemQuery);
    const oCols = BranchMenuOverrideTable.cols;
    const overrideQuery = sqlSelect(BranchMenuOverrideTable)
      .select([
        oCols.menuItemId,
        oCols.isIncluded,
        oCols.isAvailable,
        oCols.priceOverride,
      ])
      .whereEq(oCols.branchId, params.branchId)
      .activeOnly()
      .compile();

    const overrides = await exec.queryMany(overrideQuery);
    const overrideMap = new Map(
      overrides.map((o) => [
        o.menuItemId,
        o,
      ]),
    );

    const visibleItems = allItems.filter((item) => {
      if (item.branchId !== null && item.branchId !== params.branchId) return false;
      const ov = overrideMap.get(item.id);
      if (ov && !ov.isAvailable) return false;
      if (params.menuSelectionMode === 'SELECTED_ITEMS_ONLY') {
        if (item.branchId === params.branchId) return true;
        return Boolean(ov?.isIncluded);
      }
      return ov ? ov.isIncluded : true;
    });

    const modsByItem = await this.fetchModifiersByItem(
      visibleItems.map((i) => i.id),
      exec,
    );

    for (const item of visibleItems) {
      const ov = overrideMap.get(item.id);
      const basePrice = Number.parseFloat(item.basePrice);
      const effectivePrice =
        ov && ov.priceOverride !== null ? Number.parseFloat(ov.priceOverride) : basePrice;

      params.builder.addMenuItem(item.categoryId, {
        id: item.id,
        name: item.name,
        description: item.description,
        basePrice,
        effectivePrice,
        vatRate: Number.parseFloat(item.vatRate),
        allergenFlags: item.allergenFlags ?? [],
        ingredientTags: item.ingredientTags ?? [],
        kdsTarget: item.kdsTarget as KdsRoutingTarget,
        imageUrl: item.imageUrl,
        isBranchLocal: item.branchId === params.branchId,
        modifiers: modsByItem.get(item.id) ?? [],
      });
    }
  }

  private async persistCompiledSnapshot(
    branchId: string,
    compiled: CompiledMenuSnapshot,
    actorId: string,
    tx: DbExecutor = this.uow,
  ): Promise<void> {
    const sCols = MenuSnapshotTable.cols;
    const existingSnap = sqlSelect(MenuSnapshotTable)
      .select([
        sCols.id,
      ])
      .whereEq(sCols.branchId, branchId)
      .compile();

    if (await tx.exists(existingSnap)) {
      const updateSnap = sqlUpdate(MenuSnapshotTable)
        .set({
          versionHash: compiled.versionHash,
          serializedMenu: compiled as unknown as Record<string, unknown>,
        })
        .withAuditBump(actorId)
        .whereEq(sCols.branchId, branchId)
        .compile();

      await tx.execute(updateSnap);
      return;
    }

    const insertSnap = sqlInsert(MenuSnapshotTable)
      .values({
        branchId,
        versionHash: compiled.versionHash,
        serializedMenu: compiled as unknown as Record<string, unknown>,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await tx.execute(insertSnap);
  }

  /**
   * Compiles the branch menu snapshot strictly from `CatalogBranchProjectionTable`
   * without querying `Restaurant` or `RestaurantBranch` tables in `brand`.
   */
  // In `apps/backend/src/catalog/infrastructure/catalog-repository.ts`:
  // 1. Add `type DbExecutor` to `@foodapp/db` import.
  // 2. Pass `tx: DbExecutor = this.uow` to `fetchModifiersByItem`, `populateBranchMenuGraph`, `persistCompiledSnapshot`, and `rebuildAndPersistSnapshot`:
  async rebuildAndPersistSnapshot(
    branchId: string,
    actorId: string,
    tx: DbExecutor = this.uow,
  ): Promise<CompiledMenuSnapshot | null> {
    const pCols = CatalogBranchProjectionTable.cols;
    const projQuery = sqlSelect(CatalogBranchProjectionTable)
      .select([
        pCols.branchId,
        pCols.restaurantId,
        pCols.brandName,
        pCols.branchName,
        pCols.postcodeSector,
        pCols.menuSelectionMode,
      ])
      .whereEq(pCols.branchId, branchId)
      .activeOnly()
      .compile();

    const branch = await tx.queryOne(projQuery);
    if (!branch) return null;

    const builder = new MenuSnapshotBuilder().setBranchContext({
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      brandName: branch.brandName,
      branchName: branch.branchName,
      postcodeSector: branch.postcodeSector,
    });

    await this.populateBranchMenuGraph({
      builder,
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      menuSelectionMode: branch.menuSelectionMode as MenuSelectionMode,
      tx,
    });
    const compiled = builder.build();
    await this.persistCompiledSnapshot(branchId, compiled, actorId, tx);

    return compiled;
  }

  async getPersistedSnapshot(branchId: string): Promise<CompiledMenuSnapshot | null> {
    const sCols = MenuSnapshotTable.cols;
    const q = sqlSelect(MenuSnapshotTable)
      .select([
        sCols.serializedMenu,
      ])
      .whereEq(sCols.branchId, branchId)
      .activeOnly()
      .compile();

    const row = await this.uow.queryOne(q);
    return (row?.serializedMenu as unknown as CompiledMenuSnapshot) ?? null;
  }
}
