// AUTO-GENERATED FILE — DO NOT EDIT MANUALLY
// Run `pnpm db:codegen` after applying new SQL migrations.

export interface TableMeta<TCols extends Record<string, string>, TRow, TInsert = Partial<TRow>> {
  readonly table: string;
  readonly cols: TCols;
  readonly _row?: TRow;
  readonly _insert?: TInsert;
}

export interface AccountRow {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountInsert {
  id?: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scope?: string | null;
  password?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AccountTable: TableMeta<
  {
    id: '"id"';
    userId: '"userId"';
    accountId: '"accountId"';
    providerId: '"providerId"';
    accessToken: '"accessToken"';
    refreshToken: '"refreshToken"';
    idToken: '"idToken"';
    accessTokenExpiresAt: '"accessTokenExpiresAt"';
    refreshTokenExpiresAt: '"refreshTokenExpiresAt"';
    scope: '"scope"';
    password: '"password"';
    createdAt: '"createdAt"';
    updatedAt: '"updatedAt"';
  },
  AccountRow,
  AccountInsert
> = {
  table: '"Account"',
  cols: {
    id: '"id"',
    userId: '"userId"',
    accountId: '"accountId"',
    providerId: '"providerId"',
    accessToken: '"accessToken"',
    refreshToken: '"refreshToken"',
    idToken: '"idToken"',
    accessTokenExpiresAt: '"accessTokenExpiresAt"',
    refreshTokenExpiresAt: '"refreshTokenExpiresAt"',
    scope: '"scope"',
    password: '"password"',
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
  },
} as const;

export interface AggregateMementoRow {
  id: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  snapshot: Record<string, unknown>;
  createdAt: Date;
  createdBy: string | null;
}

export interface AggregateMementoInsert {
  id?: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  snapshot: Record<string, unknown>;
  createdAt?: Date;
  createdBy?: string | null;
}

export const AggregateMementoTable: TableMeta<
  {
    id: '"id"';
    aggregateId: '"aggregateId"';
    aggregateType: '"aggregateType"';
    version: '"version"';
    snapshot: '"snapshot"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
  },
  AggregateMementoRow,
  AggregateMementoInsert
> = {
  table: '"AggregateMemento"',
  cols: {
    id: '"id"',
    aggregateId: '"aggregateId"',
    aggregateType: '"aggregateType"',
    version: '"version"',
    snapshot: '"snapshot"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
  },
} as const;

export interface BranchMenuOverrideRow {
  id: string;
  branchId: string;
  menuItemId: string;
  isIncluded: boolean;
  isAvailable: boolean;
  priceOverride: string | null;
  pendingPriceOverride: string | null;
  approvalStatus: string;
  requestedByStaffId: string | null;
  reviewedByStaffId: string | null;
  reviewNote: string | null;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface BranchMenuOverrideInsert {
  id?: string;
  branchId: string;
  menuItemId: string;
  isIncluded?: boolean;
  isAvailable?: boolean;
  priceOverride?: string | null;
  pendingPriceOverride?: string | null;
  approvalStatus?: string;
  requestedByStaffId?: string | null;
  reviewedByStaffId?: string | null;
  reviewNote?: string | null;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const BranchMenuOverrideTable: TableMeta<
  {
    id: '"id"';
    branchId: '"branchId"';
    menuItemId: '"menuItemId"';
    isIncluded: '"isIncluded"';
    isAvailable: '"isAvailable"';
    priceOverride: '"priceOverride"';
    pendingPriceOverride: '"pendingPriceOverride"';
    approvalStatus: '"approvalStatus"';
    requestedByStaffId: '"requestedByStaffId"';
    reviewedByStaffId: '"reviewedByStaffId"';
    reviewNote: '"reviewNote"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  BranchMenuOverrideRow,
  BranchMenuOverrideInsert
> = {
  table: '"BranchMenuOverride"',
  cols: {
    id: '"id"',
    branchId: '"branchId"',
    menuItemId: '"menuItemId"',
    isIncluded: '"isIncluded"',
    isAvailable: '"isAvailable"',
    priceOverride: '"priceOverride"',
    pendingPriceOverride: '"pendingPriceOverride"',
    approvalStatus: '"approvalStatus"',
    requestedByStaffId: '"requestedByStaffId"',
    reviewedByStaffId: '"reviewedByStaffId"',
    reviewNote: '"reviewNote"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface CategoryRow {
  id: string;
  restaurantId: string;
  name: string;
  sortWeight: number;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface CategoryInsert {
  id?: string;
  restaurantId: string;
  name: string;
  sortWeight?: number;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const CategoryTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    name: '"name"';
    sortWeight: '"sortWeight"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  CategoryRow,
  CategoryInsert
> = {
  table: '"Category"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    name: '"name"',
    sortWeight: '"sortWeight"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface DiningTableRow {
  id: string;
  tableNumber: string;
  zoneName: string;
  seatCapacity: number;
  activeQrSessionToken: string | null;
  isOccupied: boolean;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  branchId: string;
}

export interface DiningTableInsert {
  id?: string;
  tableNumber: string;
  zoneName?: string;
  seatCapacity?: number;
  activeQrSessionToken?: string | null;
  isOccupied?: boolean;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  branchId: string;
}

export const DiningTableTable: TableMeta<
  {
    id: '"id"';
    tableNumber: '"tableNumber"';
    zoneName: '"zoneName"';
    seatCapacity: '"seatCapacity"';
    activeQrSessionToken: '"activeQrSessionToken"';
    isOccupied: '"isOccupied"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    branchId: '"branchId"';
  },
  DiningTableRow,
  DiningTableInsert
> = {
  table: '"DiningTable"',
  cols: {
    id: '"id"',
    tableNumber: '"tableNumber"',
    zoneName: '"zoneName"',
    seatCapacity: '"seatCapacity"',
    activeQrSessionToken: '"activeQrSessionToken"',
    isOccupied: '"isOccupied"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    branchId: '"branchId"',
  },
} as const;

export interface DomainEventStoreRow {
  id: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  eventType: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  createdBy: string | null;
}

export interface DomainEventStoreInsert {
  id?: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  eventType: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  createdBy?: string | null;
}

export const DomainEventStoreTable: TableMeta<
  {
    id: '"id"';
    aggregateId: '"aggregateId"';
    aggregateType: '"aggregateType"';
    version: '"version"';
    eventType: '"eventType"';
    payload: '"payload"';
    metadata: '"metadata"';
    occurredAt: '"occurredAt"';
    createdBy: '"createdBy"';
  },
  DomainEventStoreRow,
  DomainEventStoreInsert
> = {
  table: '"DomainEventStore"',
  cols: {
    id: '"id"',
    aggregateId: '"aggregateId"',
    aggregateType: '"aggregateType"',
    version: '"version"',
    eventType: '"eventType"',
    payload: '"payload"',
    metadata: '"metadata"',
    occurredAt: '"occurredAt"',
    createdBy: '"createdBy"',
  },
} as const;

export interface DriverProfileRow {
  id: string;
  userId: string;
  licenseNo: string;
  vehicleType: string;
  isAvailable: boolean;
  activePostcodeSectors: string[] | null;
  currentLat: string | null;
  currentLng: string | null;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface DriverProfileInsert {
  id?: string;
  userId: string;
  licenseNo: string;
  vehicleType: string;
  isAvailable?: boolean;
  activePostcodeSectors?: string[] | null;
  currentLat?: string | null;
  currentLng?: string | null;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const DriverProfileTable: TableMeta<
  {
    id: '"id"';
    userId: '"userId"';
    licenseNo: '"licenseNo"';
    vehicleType: '"vehicleType"';
    isAvailable: '"isAvailable"';
    activePostcodeSectors: '"activePostcodeSectors"';
    currentLat: '"currentLat"';
    currentLng: '"currentLng"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  DriverProfileRow,
  DriverProfileInsert
> = {
  table: '"DriverProfile"',
  cols: {
    id: '"id"',
    userId: '"userId"',
    licenseNo: '"licenseNo"',
    vehicleType: '"vehicleType"',
    isAvailable: '"isAvailable"',
    activePostcodeSectors: '"activePostcodeSectors"',
    currentLat: '"currentLat"',
    currentLng: '"currentLng"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface FinancialLedgerRow {
  id: string;
  orderId: string;
  entityName: string;
  creditAmount: string;
  debitAmount: string;
  description: string | null;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface FinancialLedgerInsert {
  id?: string;
  orderId: string;
  entityName: string;
  creditAmount?: string;
  debitAmount?: string;
  description?: string | null;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const FinancialLedgerTable: TableMeta<
  {
    id: '"id"';
    orderId: '"orderId"';
    entityName: '"entityName"';
    creditAmount: '"creditAmount"';
    debitAmount: '"debitAmount"';
    description: '"description"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  FinancialLedgerRow,
  FinancialLedgerInsert
> = {
  table: '"FinancialLedger"',
  cols: {
    id: '"id"',
    orderId: '"orderId"',
    entityName: '"entityName"',
    creditAmount: '"creditAmount"',
    debitAmount: '"debitAmount"',
    description: '"description"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface ItemModifierRow {
  id: string;
  menuItemId: string;
  name: string;
  extraPrice: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface ItemModifierInsert {
  id?: string;
  menuItemId: string;
  name: string;
  extraPrice?: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const ItemModifierTable: TableMeta<
  {
    id: '"id"';
    menuItemId: '"menuItemId"';
    name: '"name"';
    extraPrice: '"extraPrice"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  ItemModifierRow,
  ItemModifierInsert
> = {
  table: '"ItemModifier"',
  cols: {
    id: '"id"',
    menuItemId: '"menuItemId"',
    name: '"name"',
    extraPrice: '"extraPrice"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface LoyaltyLedgerRow {
  id: string;
  userId: string;
  orderId: string | null;
  txType: string;
  pointsDelta: number;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  branchId: string | null;
}

export interface LoyaltyLedgerInsert {
  id?: string;
  userId: string;
  orderId?: string | null;
  txType: string;
  pointsDelta: number;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  branchId?: string | null;
}

export const LoyaltyLedgerTable: TableMeta<
  {
    id: '"id"';
    userId: '"userId"';
    orderId: '"orderId"';
    txType: '"txType"';
    pointsDelta: '"pointsDelta"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    branchId: '"branchId"';
  },
  LoyaltyLedgerRow,
  LoyaltyLedgerInsert
> = {
  table: '"LoyaltyLedger"',
  cols: {
    id: '"id"',
    userId: '"userId"',
    orderId: '"orderId"',
    txType: '"txType"',
    pointsDelta: '"pointsDelta"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    branchId: '"branchId"',
  },
} as const;

export interface MenuItemRow {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  basePrice: string;
  vatRate: string;
  allergenFlags: string[] | null;
  kdsTarget: string;
  imageUrl: string | null;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  branchId: string | null;
  ingredientTags: string[];
}

export interface MenuItemInsert {
  id?: string;
  categoryId: string;
  name: string;
  description?: string | null;
  basePrice?: string;
  vatRate?: string;
  allergenFlags?: string[] | null;
  kdsTarget?: string;
  imageUrl?: string | null;
  isActive?: boolean;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  branchId?: string | null;
  ingredientTags?: string[];
}

export const MenuItemTable: TableMeta<
  {
    id: '"id"';
    categoryId: '"categoryId"';
    name: '"name"';
    description: '"description"';
    basePrice: '"basePrice"';
    vatRate: '"vatRate"';
    allergenFlags: '"allergenFlags"';
    kdsTarget: '"kdsTarget"';
    imageUrl: '"imageUrl"';
    isActive: '"isActive"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    branchId: '"branchId"';
    ingredientTags: '"ingredientTags"';
  },
  MenuItemRow,
  MenuItemInsert
> = {
  table: '"MenuItem"',
  cols: {
    id: '"id"',
    categoryId: '"categoryId"',
    name: '"name"',
    description: '"description"',
    basePrice: '"basePrice"',
    vatRate: '"vatRate"',
    allergenFlags: '"allergenFlags"',
    kdsTarget: '"kdsTarget"',
    imageUrl: '"imageUrl"',
    isActive: '"isActive"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    branchId: '"branchId"',
    ingredientTags: '"ingredientTags"',
  },
} as const;

export interface MenuSnapshotRow {
  id: string;
  versionHash: string;
  serializedMenu: Record<string, unknown>;
  updatedAt: Date;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  branchId: string;
}

export interface MenuSnapshotInsert {
  id?: string;
  versionHash: string;
  serializedMenu: Record<string, unknown>;
  updatedAt?: Date;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  branchId: string;
}

export const MenuSnapshotTable: TableMeta<
  {
    id: '"id"';
    versionHash: '"versionHash"';
    serializedMenu: '"serializedMenu"';
    updatedAt: '"updatedAt"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    branchId: '"branchId"';
  },
  MenuSnapshotRow,
  MenuSnapshotInsert
> = {
  table: '"MenuSnapshot"',
  cols: {
    id: '"id"',
    versionHash: '"versionHash"',
    serializedMenu: '"serializedMenu"',
    updatedAt: '"updatedAt"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    branchId: '"branchId"',
  },
} as const;

export interface OrderRow {
  id: string;
  customerId: string | null;
  diningTableId: string | null;
  driverId: string | null;
  orderSource: string;
  paymentMethod: string;
  subtotal: string;
  vatTotal: string;
  deliveryFee: string;
  tipAmount: string;
  totalAmount: string;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  branchId: string;
}

export interface OrderInsert {
  id?: string;
  customerId?: string | null;
  diningTableId?: string | null;
  driverId?: string | null;
  orderSource?: string;
  paymentMethod?: string;
  subtotal: string;
  vatTotal?: string;
  deliveryFee?: string;
  tipAmount?: string;
  totalAmount: string;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  branchId: string;
}

export const OrderTable: TableMeta<
  {
    id: '"id"';
    customerId: '"customerId"';
    diningTableId: '"diningTableId"';
    driverId: '"driverId"';
    orderSource: '"orderSource"';
    paymentMethod: '"paymentMethod"';
    subtotal: '"subtotal"';
    vatTotal: '"vatTotal"';
    deliveryFee: '"deliveryFee"';
    tipAmount: '"tipAmount"';
    totalAmount: '"totalAmount"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    branchId: '"branchId"';
  },
  OrderRow,
  OrderInsert
> = {
  table: '"Order"',
  cols: {
    id: '"id"',
    customerId: '"customerId"',
    diningTableId: '"diningTableId"',
    driverId: '"driverId"',
    orderSource: '"orderSource"',
    paymentMethod: '"paymentMethod"',
    subtotal: '"subtotal"',
    vatTotal: '"vatTotal"',
    deliveryFee: '"deliveryFee"',
    tipAmount: '"tipAmount"',
    totalAmount: '"totalAmount"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    branchId: '"branchId"',
  },
} as const;

export interface OrderLineItemRow {
  id: string;
  orderId: string;
  itemName: string;
  frozenPrice: string;
  quantity: number;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface OrderLineItemInsert {
  id?: string;
  orderId: string;
  itemName: string;
  frozenPrice: string;
  quantity: number;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const OrderLineItemTable: TableMeta<
  {
    id: '"id"';
    orderId: '"orderId"';
    itemName: '"itemName"';
    frozenPrice: '"frozenPrice"';
    quantity: '"quantity"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  OrderLineItemRow,
  OrderLineItemInsert
> = {
  table: '"OrderLineItem"',
  cols: {
    id: '"id"',
    orderId: '"orderId"',
    itemName: '"itemName"',
    frozenPrice: '"frozenPrice"',
    quantity: '"quantity"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface OrderLineModifierRow {
  id: string;
  orderLineItemId: string;
  modifierName: string;
  frozenPrice: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface OrderLineModifierInsert {
  id?: string;
  orderLineItemId: string;
  modifierName: string;
  frozenPrice: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const OrderLineModifierTable: TableMeta<
  {
    id: '"id"';
    orderLineItemId: '"orderLineItemId"';
    modifierName: '"modifierName"';
    frozenPrice: '"frozenPrice"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  OrderLineModifierRow,
  OrderLineModifierInsert
> = {
  table: '"OrderLineModifier"',
  cols: {
    id: '"id"',
    orderLineItemId: '"orderLineItemId"',
    modifierName: '"modifierName"',
    frozenPrice: '"frozenPrice"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface OrderMilestoneLogRow {
  id: string;
  orderId: string;
  milestone: string;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface OrderMilestoneLogInsert {
  id?: string;
  orderId: string;
  milestone: string;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const OrderMilestoneLogTable: TableMeta<
  {
    id: '"id"';
    orderId: '"orderId"';
    milestone: '"milestone"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  OrderMilestoneLogRow,
  OrderMilestoneLogInsert
> = {
  table: '"OrderMilestoneLog"',
  cols: {
    id: '"id"',
    orderId: '"orderId"',
    milestone: '"milestone"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface OrderOfferRow {
  id: string;
  orderId: string;
  driverId: string;
  status: string;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface OrderOfferInsert {
  id?: string;
  orderId: string;
  driverId: string;
  status?: string;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const OrderOfferTable: TableMeta<
  {
    id: '"id"';
    orderId: '"orderId"';
    driverId: '"driverId"';
    status: '"status"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  OrderOfferRow,
  OrderOfferInsert
> = {
  table: '"OrderOffer"',
  cols: {
    id: '"id"',
    orderId: '"orderId"',
    driverId: '"driverId"',
    status: '"status"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface PaymentConfigRow {
  id: string;
  restaurantId: string;
  routingPolicy: string;
  merchantToken: string | null;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface PaymentConfigInsert {
  id?: string;
  restaurantId: string;
  routingPolicy?: string;
  merchantToken?: string | null;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const PaymentConfigTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    routingPolicy: '"routingPolicy"';
    merchantToken: '"merchantToken"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  PaymentConfigRow,
  PaymentConfigInsert
> = {
  table: '"PaymentConfig"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    routingPolicy: '"routingPolicy"',
    merchantToken: '"merchantToken"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface PricingPolicyRow {
  id: string;
  restaurantId: string;
  branchId: string | null;
  menuPricingMode: string;
  maxDirectPriceDeltaPercent: string;
  allowBranchLocalItems: boolean;
  maxDirectOrderDiscountPercent: string;
  allowFullCompWaiveOff: boolean;
  requireReasonForCompOrDiscount: boolean;
  maxDirectRefundAmount: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface PricingPolicyInsert {
  id?: string;
  restaurantId: string;
  branchId?: string | null;
  menuPricingMode?: string;
  maxDirectPriceDeltaPercent?: string;
  allowBranchLocalItems?: boolean;
  maxDirectOrderDiscountPercent?: string;
  allowFullCompWaiveOff?: boolean;
  requireReasonForCompOrDiscount?: boolean;
  maxDirectRefundAmount?: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const PricingPolicyTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    branchId: '"branchId"';
    menuPricingMode: '"menuPricingMode"';
    maxDirectPriceDeltaPercent: '"maxDirectPriceDeltaPercent"';
    allowBranchLocalItems: '"allowBranchLocalItems"';
    maxDirectOrderDiscountPercent: '"maxDirectOrderDiscountPercent"';
    allowFullCompWaiveOff: '"allowFullCompWaiveOff"';
    requireReasonForCompOrDiscount: '"requireReasonForCompOrDiscount"';
    maxDirectRefundAmount: '"maxDirectRefundAmount"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  PricingPolicyRow,
  PricingPolicyInsert
> = {
  table: '"PricingPolicy"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    branchId: '"branchId"',
    menuPricingMode: '"menuPricingMode"',
    maxDirectPriceDeltaPercent: '"maxDirectPriceDeltaPercent"',
    allowBranchLocalItems: '"allowBranchLocalItems"',
    maxDirectOrderDiscountPercent: '"maxDirectOrderDiscountPercent"',
    allowFullCompWaiveOff: '"allowFullCompWaiveOff"',
    requireReasonForCompOrDiscount: '"requireReasonForCompOrDiscount"',
    maxDirectRefundAmount: '"maxDirectRefundAmount"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface PromotionRow {
  id: string;
  restaurantId: string | null;
  promoCode: string;
  discountType: string;
  discountValue: string;
  fundingSource: string;
  minSubtotal: string;
  maxDiscount: string | null;
  startDate: Date;
  endDate: Date;
  userUsageLimit: number;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface PromotionInsert {
  id?: string;
  restaurantId?: string | null;
  promoCode: string;
  discountType: string;
  discountValue: string;
  fundingSource: string;
  minSubtotal?: string;
  maxDiscount?: string | null;
  startDate: Date;
  endDate: Date;
  userUsageLimit?: number;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const PromotionTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    promoCode: '"promoCode"';
    discountType: '"discountType"';
    discountValue: '"discountValue"';
    fundingSource: '"fundingSource"';
    minSubtotal: '"minSubtotal"';
    maxDiscount: '"maxDiscount"';
    startDate: '"startDate"';
    endDate: '"endDate"';
    userUsageLimit: '"userUsageLimit"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  PromotionRow,
  PromotionInsert
> = {
  table: '"Promotion"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    promoCode: '"promoCode"',
    discountType: '"discountType"',
    discountValue: '"discountValue"',
    fundingSource: '"fundingSource"',
    minSubtotal: '"minSubtotal"',
    maxDiscount: '"maxDiscount"',
    startDate: '"startDate"',
    endDate: '"endDate"',
    userUsageLimit: '"userUsageLimit"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface PromotionApplicationRow {
  id: string;
  promotionId: string;
  orderId: string;
  userId: string;
  amountSaved: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface PromotionApplicationInsert {
  id?: string;
  promotionId: string;
  orderId: string;
  userId: string;
  amountSaved: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const PromotionApplicationTable: TableMeta<
  {
    id: '"id"';
    promotionId: '"promotionId"';
    orderId: '"orderId"';
    userId: '"userId"';
    amountSaved: '"amountSaved"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  PromotionApplicationRow,
  PromotionApplicationInsert
> = {
  table: '"PromotionApplication"',
  cols: {
    id: '"id"',
    promotionId: '"promotionId"',
    orderId: '"orderId"',
    userId: '"userId"',
    amountSaved: '"amountSaved"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface RestaurantRow {
  id: string;
  name: string;
  vatNumber: string | null;
  companyHouseNumber: string | null;
  foodHygieneRating: number | null;
  postcodeSector: string;
  averagePrepTimeMinutes: number;
  payoutFrequency: string;
  isActiveOverride: boolean;
  platformFeeRate: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  handle: string;
  logoUrl: string | null;
  description: string | null;
}

export interface RestaurantInsert {
  id?: string;
  name: string;
  vatNumber?: string | null;
  companyHouseNumber?: string | null;
  foodHygieneRating?: number | null;
  postcodeSector?: string;
  averagePrepTimeMinutes?: number;
  payoutFrequency?: string;
  isActiveOverride?: boolean;
  platformFeeRate?: string;
  createdAt?: Date;
  updatedAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  handle: string;
  logoUrl?: string | null;
  description?: string | null;
}

export const RestaurantTable: TableMeta<
  {
    id: '"id"';
    name: '"name"';
    vatNumber: '"vatNumber"';
    companyHouseNumber: '"companyHouseNumber"';
    foodHygieneRating: '"foodHygieneRating"';
    postcodeSector: '"postcodeSector"';
    averagePrepTimeMinutes: '"averagePrepTimeMinutes"';
    payoutFrequency: '"payoutFrequency"';
    isActiveOverride: '"isActiveOverride"';
    platformFeeRate: '"platformFeeRate"';
    createdAt: '"createdAt"';
    updatedAt: '"updatedAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    handle: '"handle"';
    logoUrl: '"logoUrl"';
    description: '"description"';
  },
  RestaurantRow,
  RestaurantInsert
> = {
  table: '"Restaurant"',
  cols: {
    id: '"id"',
    name: '"name"',
    vatNumber: '"vatNumber"',
    companyHouseNumber: '"companyHouseNumber"',
    foodHygieneRating: '"foodHygieneRating"',
    postcodeSector: '"postcodeSector"',
    averagePrepTimeMinutes: '"averagePrepTimeMinutes"',
    payoutFrequency: '"payoutFrequency"',
    isActiveOverride: '"isActiveOverride"',
    platformFeeRate: '"platformFeeRate"',
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    handle: '"handle"',
    logoUrl: '"logoUrl"',
    description: '"description"',
  },
} as const;

export interface RestaurantBranchRow {
  id: string;
  restaurantId: string;
  name: string;
  branchKey: string;
  city: string;
  cityKey: string;
  kitchenType: string;
  postcodeSector: string;
  streetAddress: string;
  areaLocality: string | null;
  latitude: string | null;
  longitude: string | null;
  contactPersonName: string;
  contactPersonPhone: string;
  contactPersonEmail: string | null;
  supportsDineIn: boolean;
  supportsTakeaway: boolean;
  supportsPlatformDelivery: boolean;
  operationalStatus: string;
  statusLockedUntil: Date | null;
  statusReason: string | null;
  scheduleConfig: Record<string, unknown>;
  homePickupPrivacyMode: string;
  dropPointConfig: Record<string, unknown> | null;
  approvedTakeawayUserIds: Record<string, unknown>;
  menuSelectionMode: string;
  averagePrepTimeMinutes: number;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface RestaurantBranchInsert {
  id?: string;
  restaurantId: string;
  name: string;
  branchKey: string;
  city: string;
  cityKey: string;
  kitchenType?: string;
  postcodeSector?: string;
  streetAddress: string;
  areaLocality?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  contactPersonName: string;
  contactPersonPhone: string;
  contactPersonEmail?: string | null;
  supportsDineIn?: boolean;
  supportsTakeaway?: boolean;
  supportsPlatformDelivery?: boolean;
  operationalStatus?: string;
  statusLockedUntil?: Date | null;
  statusReason?: string | null;
  scheduleConfig?: Record<string, unknown>;
  homePickupPrivacyMode?: string;
  dropPointConfig?: Record<string, unknown> | null;
  approvedTakeawayUserIds?: Record<string, unknown>;
  menuSelectionMode?: string;
  averagePrepTimeMinutes?: number;
  isActive?: boolean;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const RestaurantBranchTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    name: '"name"';
    branchKey: '"branchKey"';
    city: '"city"';
    cityKey: '"cityKey"';
    kitchenType: '"kitchenType"';
    postcodeSector: '"postcodeSector"';
    streetAddress: '"streetAddress"';
    areaLocality: '"areaLocality"';
    latitude: '"latitude"';
    longitude: '"longitude"';
    contactPersonName: '"contactPersonName"';
    contactPersonPhone: '"contactPersonPhone"';
    contactPersonEmail: '"contactPersonEmail"';
    supportsDineIn: '"supportsDineIn"';
    supportsTakeaway: '"supportsTakeaway"';
    supportsPlatformDelivery: '"supportsPlatformDelivery"';
    operationalStatus: '"operationalStatus"';
    statusLockedUntil: '"statusLockedUntil"';
    statusReason: '"statusReason"';
    scheduleConfig: '"scheduleConfig"';
    homePickupPrivacyMode: '"homePickupPrivacyMode"';
    dropPointConfig: '"dropPointConfig"';
    approvedTakeawayUserIds: '"approvedTakeawayUserIds"';
    menuSelectionMode: '"menuSelectionMode"';
    averagePrepTimeMinutes: '"averagePrepTimeMinutes"';
    isActive: '"isActive"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  RestaurantBranchRow,
  RestaurantBranchInsert
> = {
  table: '"RestaurantBranch"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    name: '"name"',
    branchKey: '"branchKey"',
    city: '"city"',
    cityKey: '"cityKey"',
    kitchenType: '"kitchenType"',
    postcodeSector: '"postcodeSector"',
    streetAddress: '"streetAddress"',
    areaLocality: '"areaLocality"',
    latitude: '"latitude"',
    longitude: '"longitude"',
    contactPersonName: '"contactPersonName"',
    contactPersonPhone: '"contactPersonPhone"',
    contactPersonEmail: '"contactPersonEmail"',
    supportsDineIn: '"supportsDineIn"',
    supportsTakeaway: '"supportsTakeaway"',
    supportsPlatformDelivery: '"supportsPlatformDelivery"',
    operationalStatus: '"operationalStatus"',
    statusLockedUntil: '"statusLockedUntil"',
    statusReason: '"statusReason"',
    scheduleConfig: '"scheduleConfig"',
    homePickupPrivacyMode: '"homePickupPrivacyMode"',
    dropPointConfig: '"dropPointConfig"',
    approvedTakeawayUserIds: '"approvedTakeawayUserIds"',
    menuSelectionMode: '"menuSelectionMode"',
    averagePrepTimeMinutes: '"averagePrepTimeMinutes"',
    isActive: '"isActive"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface RestaurantLayoutRow {
  id: string;
  restaurantId: string;
  templateId: string;
  primaryColor: string;
  bannerUrl: string | null;
  customConfig: Record<string, unknown>;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  galleryImages: Record<string, unknown>;
}

export interface RestaurantLayoutInsert {
  id?: string;
  restaurantId: string;
  templateId: string;
  primaryColor?: string;
  bannerUrl?: string | null;
  customConfig?: Record<string, unknown>;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  galleryImages?: Record<string, unknown>;
}

export const RestaurantLayoutTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    templateId: '"templateId"';
    primaryColor: '"primaryColor"';
    bannerUrl: '"bannerUrl"';
    customConfig: '"customConfig"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    galleryImages: '"galleryImages"';
  },
  RestaurantLayoutRow,
  RestaurantLayoutInsert
> = {
  table: '"RestaurantLayout"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    templateId: '"templateId"',
    primaryColor: '"primaryColor"',
    bannerUrl: '"bannerUrl"',
    customConfig: '"customConfig"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    galleryImages: '"galleryImages"',
  },
} as const;

export interface RestaurantStaffRow {
  id: string;
  restaurantId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  createdAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  roleId: string | null;
}

export interface RestaurantStaffInsert {
  id?: string;
  restaurantId: string;
  email: string;
  passwordHash: string;
  name: string;
  role?: string;
  createdAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  roleId?: string | null;
}

export const RestaurantStaffTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    email: '"email"';
    passwordHash: '"passwordHash"';
    name: '"name"';
    role: '"role"';
    createdAt: '"createdAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    roleId: '"roleId"';
  },
  RestaurantStaffRow,
  RestaurantStaffInsert
> = {
  table: '"RestaurantStaff"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    email: '"email"',
    passwordHash: '"passwordHash"',
    name: '"name"',
    role: '"role"',
    createdAt: '"createdAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    roleId: '"roleId"',
  },
} as const;

export interface SessionRow {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  impersonatedBy: string | null;
}

export interface SessionInsert {
  id?: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  impersonatedBy?: string | null;
}

export const SessionTable: TableMeta<
  {
    id: '"id"';
    userId: '"userId"';
    token: '"token"';
    expiresAt: '"expiresAt"';
    ipAddress: '"ipAddress"';
    userAgent: '"userAgent"';
    createdAt: '"createdAt"';
    updatedAt: '"updatedAt"';
    impersonatedBy: '"impersonatedBy"';
  },
  SessionRow,
  SessionInsert
> = {
  table: '"Session"',
  cols: {
    id: '"id"',
    userId: '"userId"',
    token: '"token"',
    expiresAt: '"expiresAt"',
    ipAddress: '"ipAddress"',
    userAgent: '"userAgent"',
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
    impersonatedBy: '"impersonatedBy"',
  },
} as const;

export interface StaffBranchAssignmentRow {
  id: string;
  staffId: string;
  branchId: string;
  staffRoleId: string;
  directPermissions: string[];
  isPrimary: boolean;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface StaffBranchAssignmentInsert {
  id?: string;
  staffId: string;
  branchId: string;
  staffRoleId: string;
  directPermissions?: string[];
  isPrimary?: boolean;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const StaffBranchAssignmentTable: TableMeta<
  {
    id: '"id"';
    staffId: '"staffId"';
    branchId: '"branchId"';
    staffRoleId: '"staffRoleId"';
    directPermissions: '"directPermissions"';
    isPrimary: '"isPrimary"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  StaffBranchAssignmentRow,
  StaffBranchAssignmentInsert
> = {
  table: '"StaffBranchAssignment"',
  cols: {
    id: '"id"',
    staffId: '"staffId"',
    branchId: '"branchId"',
    staffRoleId: '"staffRoleId"',
    directPermissions: '"directPermissions"',
    isPrimary: '"isPrimary"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface StaffRoleRow {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface StaffRoleInsert {
  id?: string;
  restaurantId: string;
  name: string;
  description?: string | null;
  isSystemRole?: boolean;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const StaffRoleTable: TableMeta<
  {
    id: '"id"';
    restaurantId: '"restaurantId"';
    name: '"name"';
    description: '"description"';
    isSystemRole: '"isSystemRole"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  StaffRoleRow,
  StaffRoleInsert
> = {
  table: '"StaffRole"',
  cols: {
    id: '"id"',
    restaurantId: '"restaurantId"',
    name: '"name"',
    description: '"description"',
    isSystemRole: '"isSystemRole"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface StaffRolePermissionRow {
  id: string;
  staffRoleId: string;
  permission: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface StaffRolePermissionInsert {
  id?: string;
  staffRoleId: string;
  permission: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const StaffRolePermissionTable: TableMeta<
  {
    id: '"id"';
    staffRoleId: '"staffRoleId"';
    permission: '"permission"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  StaffRolePermissionRow,
  StaffRolePermissionInsert
> = {
  table: '"StaffRolePermission"',
  cols: {
    id: '"id"',
    staffRoleId: '"staffRoleId"',
    permission: '"permission"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  banned: boolean | null;
  banReason: string | null;
  banExpires: Date | null;
}

export interface UserInsert {
  id?: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: string;
  createdAt?: Date;
  updatedAt?: Date;
  rowVersion?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
}

export const UserTable: TableMeta<
  {
    id: '"id"';
    email: '"email"';
    name: '"name"';
    emailVerified: '"emailVerified"';
    image: '"image"';
    role: '"role"';
    createdAt: '"createdAt"';
    updatedAt: '"updatedAt"';
    rowVersion: '"rowVersion"';
    createdBy: '"createdBy"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
    phoneNumber: '"phoneNumber"';
    phoneNumberVerified: '"phoneNumberVerified"';
    banned: '"banned"';
    banReason: '"banReason"';
    banExpires: '"banExpires"';
  },
  UserRow,
  UserInsert
> = {
  table: '"User"',
  cols: {
    id: '"id"',
    email: '"email"',
    name: '"name"',
    emailVerified: '"emailVerified"',
    image: '"image"',
    role: '"role"',
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
    rowVersion: '"rowVersion"',
    createdBy: '"createdBy"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
    phoneNumber: '"phoneNumber"',
    phoneNumberVerified: '"phoneNumberVerified"',
    banned: '"banned"',
    banReason: '"banReason"',
    banExpires: '"banExpires"',
  },
} as const;

export interface UserAddressRow {
  id: string;
  userId: string;
  label: string;
  address: string;
  postcodeSector: string;
  latitude: string;
  longitude: string;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface UserAddressInsert {
  id?: string;
  userId: string;
  label: string;
  address: string;
  postcodeSector?: string;
  latitude: string;
  longitude: string;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export const UserAddressTable: TableMeta<
  {
    id: '"id"';
    userId: '"userId"';
    label: '"label"';
    address: '"address"';
    postcodeSector: '"postcodeSector"';
    latitude: '"latitude"';
    longitude: '"longitude"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
    deletedAt: '"deletedAt"';
    deletedBy: '"deletedBy"';
  },
  UserAddressRow,
  UserAddressInsert
> = {
  table: '"UserAddress"',
  cols: {
    id: '"id"',
    userId: '"userId"',
    label: '"label"',
    address: '"address"',
    postcodeSector: '"postcodeSector"',
    latitude: '"latitude"',
    longitude: '"longitude"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
    deletedAt: '"deletedAt"',
    deletedBy: '"deletedBy"',
  },
} as const;

export interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface VerificationInsert {
  id?: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export const VerificationTable: TableMeta<
  {
    id: '"id"';
    identifier: '"identifier"';
    value: '"value"';
    expiresAt: '"expiresAt"';
    createdAt: '"createdAt"';
    updatedAt: '"updatedAt"';
  },
  VerificationRow,
  VerificationInsert
> = {
  table: '"Verification"',
  cols: {
    id: '"id"',
    identifier: '"identifier"',
    value: '"value"',
    expiresAt: '"expiresAt"',
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
  },
} as const;

export interface SagaStateRow {
  id: string;
  sagaType: string;
  correlationId: string;
  currentStep: string;
  status: string;
  statePayload: Record<string, unknown>;
  lastError: string | null;
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SagaStateInsert {
  id?: string;
  sagaType: string;
  correlationId: string;
  currentStep: string;
  status?: string;
  statePayload?: Record<string, unknown>;
  lastError?: string | null;
  rowVersion?: number;
  createdAt?: Date;
  createdBy?: string | null;
  updatedAt?: Date;
  updatedBy?: string | null;
}

export const SagaStateTable: TableMeta<
  {
    id: '"id"';
    sagaType: '"sagaType"';
    correlationId: '"correlationId"';
    currentStep: '"currentStep"';
    status: '"status"';
    statePayload: '"statePayload"';
    lastError: '"lastError"';
    rowVersion: '"rowVersion"';
    createdAt: '"createdAt"';
    createdBy: '"createdBy"';
    updatedAt: '"updatedAt"';
    updatedBy: '"updatedBy"';
  },
  SagaStateRow,
  SagaStateInsert
> = {
  table: '"_Saga_State"',
  cols: {
    id: '"id"',
    sagaType: '"sagaType"',
    correlationId: '"correlationId"',
    currentStep: '"currentStep"',
    status: '"status"',
    statePayload: '"statePayload"',
    lastError: '"lastError"',
    rowVersion: '"rowVersion"',
    createdAt: '"createdAt"',
    createdBy: '"createdBy"',
    updatedAt: '"updatedAt"',
    updatedBy: '"updatedBy"',
  },
} as const;
