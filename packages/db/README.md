# `@foodapp/db` — Database Schema, Migrations & Seeds

PostgreSQL schema, sequential SQL migrations, deterministic development/test seeds, and generated TypeScript types (`Kysely` / `pg`).

## Common Commands

| Command           | Description                                                           |
| :---------------- | :-------------------------------------------------------------------- |
| `pnpm db:migrate` | Apply pending migrations from `migrations/`                           |
| `pnpm db:seed`    | Run ordered seed files from `seeds/`                                  |
| `pnpm db:reset`   | Drop, recreate, migrate, seed, and regenerate types                   |
| `pnpm db:codegen` | Regenerate `generated/schema.generated.ts` from live DB               |
| `pnpm db:bundle`  | Build `generated/bundles/migrations.bundle.sql` and `seed.bundle.sql` |

---

## Migrations (`packages/db/migrations/`)

| File                                        | Description                                                                                                      |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------- |
| `001_foundational_auth.sql`                 | Core `User`, `Session`, `Account`, `Verification` tables and `PlatformRole` enum                                 |
| `002_geo_and_drivers.sql`                   | `UserAddress` and `DriverProfile` with active postcode sector routing                                            |
| `003_tenants_and_pos_tables.sql`            | Initial `Restaurant`, `RestaurantLayout`, `PaymentConfig`, `RestaurantStaff`, `DiningTable`                      |
| `004_menus_allergens_snapshots.sql`         | `Category`, `MenuItem` (VAT, allergens, KDS routing), `ItemModifier`, `MenuSnapshot`                             |
| `005_pos_orders_promos_ledgers.sql`         | `Order`, `OrderLineItem`, `OrderMilestoneLog`, `OrderOffer`, `Promotion`, `LoyaltyLedger`, `FinancialLedger`     |
| `006_audit_and_versioning.sql`              | Adds `rowVersion`, `createdBy`, `updatedBy`, `deletedAt`, `deletedBy` across core tables                         |
| `007_phone_and_admin_auth.sql`              | Adds phone verification (`phoneNumber`, `phoneNumberVerified`), ban controls, and impersonation                  |
| `008_event_sourcing_and_sagas.sql`          | Append-only `DomainEventStore`, `AggregateMemento` snapshots, and `_Saga_State` orchestration                    |
| `009_tenant_subdomain_roles_and_rights.sql` | Normalized PBAC tables (`StaffRole`, `StaffRolePermission`) and `RestaurantStaff.roleId`                         |
| `010_multi_branch_restaurants.sql`          | Multi-branch `RestaurantBranch`, `PricingPolicy`, `BranchMenuOverride`, `StaffBranchAssignment`, ingredient tags |
| `011_orders_billing_loyalty.sql`            | Order state machines, POS offline sync, `MerchantSettlement`, `ProcessedEvent`, `LoyaltyProgramPolicy`           |

---

## Seeds (`packages/db/seeds/`)

| File                      | Description                                                                                                 |
| :------------------------ | :---------------------------------------------------------------------------------------------------------- |
| `00_functions.sql`        | Helper `pg_temp.seed_actor()` UUID function for audit columns                                               |
| `01_identity.sql`         | 10 global platform `User` accounts (`PLATFORM_ADMIN`, `CUSTOMER`, `DRIVER`) + 3 `DriverProfile` rows        |
| `02_catalog_brands.sql`   | 5 archetype `Restaurant` brands, `RestaurantLayout`, `PaymentConfig`, and brand `PricingPolicy` rows        |
| `03_catalog_branches.sql` | 8 physical `RestaurantBranch` locations (`HOME_KITCHEN`, `RESTAURANT_BRANCH`, `CLOUD_KITCHEN`)              |
| `04_pbac_roles_staff.sql` | 4 system `StaffRole` presets (17 PBAC rights), 10 `RestaurantStaff` users, and `StaffBranchAssignment` rows |
| `05_catalog_menus.sql`    | 5 `Category` rows, 6 `MenuItem` entries with `#ingredient` hashtags, and 2 `BranchMenuOverride` rules       |
| `06_loyalty_promos.sql`   | Platform + merchant `LoyaltyProgramPolicy` configs and `UKLAUNCH20` promotion                               |

---

## Quick Test Fixture Reference

### Global Platform Users (`01_identity.sql`)

| Name     | Email              | Role             | UUID                                   |
| :------- | :----------------- | :--------------- | :------------------------------------- |
| **John** | `john@example.com` | `PLATFORM_ADMIN` | `00000000-0000-4000-8000-000000000001` |
| **Tom**  | `tom@example.com`  | `PLATFORM_ADMIN` | `00000000-0000-4000-8000-000000000002` |
| **Zara** | `zara@example.com` | `CUSTOMER`       | `11111111-1111-4111-8111-111111111111` |
| **Amy**  | `amy@example.com`  | `CUSTOMER`       | `11111111-1111-4111-8111-111111111112` |
| **Sam**  | `sam@example.com`  | `DRIVER`         | `22222222-2222-4222-8222-222222222221` |

### Brands & Branches (`02_catalog_brands.sql` & `03_catalog_branches.sql`)

| Brand (`handle`)                        | Branch (`cityKey` / `branchKey`)   | Kitchen Type                                | Branch UUID                            |
| :-------------------------------------- | :--------------------------------- | :------------------------------------------ | :------------------------------------- |
| **Zara's Kitchen** (`zaras-kitchen`)    | Whitechapel (`london/whitechapel`) | `HOME_KITCHEN`                              | `b0000000-0000-4000-8000-000000000001` |
| **BiteIn** (`bitein`)                   | Westminster (`london/westminster`) | `RESTAURANT_BRANCH`                         | `b0000000-0000-4000-8000-000000000002` |
| **BurgerLab Cloud** (`burgerlab-cloud`) | Shoreditch (`london/shoreditch`)   | `CLOUD_KITCHEN`                             | `b0000000-0000-4000-8000-000000000003` |
| **PizzaIn** (`pizzain`)                 | Deansgate (`manchester/deansgate`) | `RESTAURANT_BRANCH`                         | `b0000000-0000-4000-8000-000000000004` |
| **PizzaIn** (`pizzain`)                 | Didsbury (`manchester/didsbury`)   | `RESTAURANT_BRANCH` (`SELECTED_ITEMS_ONLY`) | `b0000000-0000-4000-8000-000000000005` |
| **Pizza Hut** (`pizza-hut`)             | Clifton (`bristol/clifton`)        | `RESTAURANT_BRANCH`                         | `b0000000-0000-4000-8000-000000000006` |
| **Pizza Hut** (`pizza-hut`)             | Edgbaston (`birmingham/edgbaston`) | `RESTAURANT_BRANCH`                         | `b0000000-0000-4000-8000-000000000007` |
| **Pizza Hut** (`pizza-hut`)             | Solihull (`birmingham/solihull`)   | `RESTAURANT_BRANCH` (`SELECTED_ITEMS_ONLY`) | `b0000000-0000-4000-8000-000000000008` |

### POS Staff Logins (`04_pbac_roles_staff.sql`)

_(Dev password check accepts any non-empty password string such as `Password123!`.)_

| Name     | Email                     | `brandHandle`     | PBAC Role             | Assigned Branches            |
| :------- | :------------------------ | :---------------- | :-------------------- | :--------------------------- |
| **Zara** | `zara@zaras-kitchen.com`  | `zaras-kitchen`   | `BRAND_OWNER`         | Whitechapel                  |
| **John** | `john@bitein.com`         | `bitein`          | `BRAND_OWNER`         | Westminster                  |
| **Leo**  | `leo@burgerlab-cloud.com` | `burgerlab-cloud` | `BRAND_OWNER`         | Shoreditch                   |
| **Sam**  | `sam@pizzain.com`         | `pizzain`         | `BRAND_OWNER`         | Deansgate, Didsbury          |
| **Mia**  | `mia@pizzain.com`         | `pizzain`         | `BRANCH_MANAGER`      | Deansgate                    |
| **Ella** | `ella@pizzain.com`        | `pizzain`         | `CASHIER`             | Didsbury                     |
| **Tom**  | `tom@pizza-hut.com`       | `pizza-hut`       | `BRAND_OWNER`         | Clifton, Edgbaston, Solihull |
| **Max**  | `max@pizza-hut.com`       | `pizza-hut`       | `OPERATIONAL_MANAGER` | Clifton, Edgbaston           |
| **Ben**  | `ben@pizza-hut.com`       | `pizza-hut`       | `BRANCH_MANAGER`      | Edgbaston                    |
| **Amy**  | `amy@pizza-hut.com`       | `pizza-hut`       | `CASHIER`             | Clifton                      |

### Sample Menu Items & Promo (`05_catalog_menus.sql` & `06_loyalty_promos.sql`)

- **Chicken Tikka Feast Pizza (Large):** `e0000000-0000-4000-8000-000000000004` (`pizzain`, £14.99 base / £15.99 Didsbury override)
- **Super Supreme Stuffed Crust:** `e0000000-0000-4000-8000-000000000006` (`pizza-hut`, £17.49 base, category `d0000000-0000-4000-8000-000000000005`)
- **Platform Promo Code:** `UKLAUNCH20` (20% off, min subtotal £15.00, max discount £10.00)
