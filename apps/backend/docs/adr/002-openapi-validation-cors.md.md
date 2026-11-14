# Architectural Decision Record (ADR): OpenAPI 3.1, Validation, CORS & Static Exporter

**Target Package:** `apps/backend` (`@foodapp/backend`)  
**Stack:** Hono, `@hono/zod-openapi`, `@scalar/hono-api-reference`, `@inferdi/hono`, Better Auth (`bearer()`), Biome  
**Status:** Approved & Locked In

---

## 1. OpenAPI Schema, Route & Controller Architecture

### Chosen Option: **Option A — Context `*-schemas.ts` + Thin `*-routes.ts` + Typed Controllers + Pure `src/app.ts` Factory**

- **Structure:**
  - Each bounded context (`identity`, `catalog`, `ordering`, `ledger`) owns a `services/*-schemas.ts` file defining strict Zod DTOs and `createRoute(...)` contracts.
  - `services/*-routes.ts` stays minimal (`OpenAPIHono<AppEnv>`), mapping `route` -> `c.var.di.get('...Controller').method(c, c.req.valid(...))`.
  - Controllers receive already-validated, strongly-typed payloads instead of manually casting `c.req.json<...>()` or `Number(c.req.query(...))`.
  - Route mounting is extracted into a pure `src/app.ts` (`createApp()`) factory decoupled from `src/index.ts` (`serve()`, DB/Redis boot), enabling zero-dependency offline OpenAPI generation.
- **Architect's Note & Your Commentary:**
  - You emphasized keeping `*-routes.ts` clean and concise while ensuring runtime request validation actually happens rather than passing raw `Context` into bloated controller methods.

### Alternative Options Considered (For Future Reference)

- **Option B (Keep Controllers Untouched):** Keep `c: Context<AppEnv>` in controllers and only swap `new Hono()` -> `new OpenAPIHono()` in `*-routes.ts`. _Trade-off:_ Avoids touching controller signatures, but leaves manual `c.req.json<...>()` casting inside controllers.
- **Option C (Centralized `src/openapi/` Registry):** Place all Zod schemas and `createRoute(...)` definitions in a single top-level `src/openapi/` folder instead of inside `src/contexts/*`. _Trade-off:_ Easier to extract into a shared workspace package later, but splits HTTP contracts away from their DDD bounded contexts.

---

## 2. Request Validation Error Envelope (`defaultHook`)

### Chosen Option: **Option A — DomainError-Aligned Flat JSON Shape**

- **Format (`400 Bad Request`):**

  ```json
  {
    "code": "VALIDATION_ERROR",
    "error": "Invalid request payload",
    "issues": [
      { "path": "pointsToRedeem", "message": "Number must be greater than 0" }
    ]
  }
  ```
- **Architect's Note & Your Commentary:**
  - Aligns Zod validation failures directly with the `{ code, error }` response envelope already returned by your `Result<T, DomainError>` controller handlers.

### Alternative Options Considered (For Future Reference)

- **Option B (`globalErrorHandler` Nested Envelope):** Return `{ success: false, error: { code, message, issues } }` to match `src/errorHandler.ts`.
- **Option C (`@hono/zod-openapi` Default):** Return Hono's built-in `{ success: false, error: ZodError }` object with no custom `defaultHook`.

---

## 3. Cross-Cloud CORS & Better Auth Bearer Support

### Chosen Option: **Option A — Shared `.env` (`FRONTEND_ORIGINS`) + `bearer()` Plugin + Lazy Redis Init**

- **Implementation:**
  - Centralize origin parsing in `src/config/cors.ts` reading `FRONTEND_ORIGINS` (defaulting to `http://localhost:5173,http://localhost:4173,capacitor://localhost,http://localhost`).
  - Apply Hono's `cors()` middleware to `/api/*` with `allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']`, `exposeHeaders: ['set-auth-token']`, and `credentials: true`.
  - Pass the same `FRONTEND_ORIGINS` into Better Auth's `trustedOrigins`, enable Better Auth's `bearer()` plugin, and defer `redisClient.connect()` lazily so importing `better-auth.ts` during offline OpenAPI export never opens a Redis socket.
- **Architect's Note & Your Commentary:**
  - You explicitly requested `.env`-driven CORS configuration (`FRONTEND_ORIGINS`) alongside Better Auth `bearer()` support for decoupled cross-cloud clients (Cloudflare Pages + Capacitor iOS/Android).

### Alternative Options Considered (For Future Reference)

- **Option B (Wildcard `*` in Dev, Strict in Prod):** Use `origin: '*'` when `NODE_ENV !== 'production'` and enforce `FRONTEND_ORIGINS` only in production.
- **Option C (Split CORS Middlewares):** Configure separate `cors()` middlewares for `/api/auth/*` and `/api/*`.

---

## 4. OpenAPI 3.1 Spec (`/api/doc`) & Interactive Docs (`/api/reference`)

### Chosen Option: **Option A — `@scalar/hono-api-reference` + Unified `bearerAuth` Security Scheme**

- **Implementation:**
  - Expose OpenAPI 3.1 JSON at `GET /api/doc` and Scalar UI at `GET /api/reference`.
  - Register `bearerAuth` (`type: 'http'`, `scheme: 'bearer'`, `bearerFormat: 'JWT'`) in OpenAPI components and attach `security: [{ bearerAuth: [] }]` per-route on authenticated endpoints (leaving `/api/health`, `/api/pos/auth/login`, `/api/restaurants`, and `/api/restaurants/:restaurantId/menu` public).
- **Your Commentary:**
  - You noted that **Option C** (splitting `posBearerAuth` vs `customerBearerAuth`) is also architecturally valid because POS staff shift JWTs (`pos_staff_token`, 12-hour shift longevity) and Better Auth customer bearer tokens serve different purposes and lifecycles.
  - **Migration Note if switching to Option C later:** Register two schemes (`posBearerAuth` and `customerBearerAuth`) in `app.openAPIRegistry.registerComponent(...)` and assign `security: [{ posBearerAuth: [] }]` to `/api/pos/*`, `/api/restaurants/items/*`, and `/api/ledger/restaurant`, while assigning `security: [{ customerBearerAuth: [] }]` to `/api/ledger/loyalty/*` (and both to `/api/me`).

### Alternative Options Considered (For Future Reference)

- **Option B (`@hono/swagger-ui` + Global Auth):** Use Swagger UI instead of Scalar and apply `bearerAuth` globally across all routes.
- **Option C (`@scalar/hono-api-reference` + Dual Security Schemes):** Separate `posBearerAuth` and `customerBearerAuth` in Scalar to visually distinguish POS staff shift tokens from long-lived customer session tokens.

---

## 5. Offline OpenAPI Contract Exporter (`scripts/export-openapi.ts`)

### Chosen Option: **Combination of Option B (Single Source of Truth) + Option C (Minimal Config Footprint)**

- **Implementation:**
  - `apps/backend/scripts/export-openapi.ts` instantiates `createApp()` and dispatches an in-memory `await app.request('/api/doc')`—guaranteeing `contracts/openapi.json` is 100% identical to `GET /api/doc` without duplicating OpenAPI metadata or connecting to Postgres/Redis.
  - Writes formatted JSON to `<monorepo-root>/contracts/openapi.json` (`path.resolve(currentDir, '../../../contracts/openapi.json')`) using `fs.mkdirSync(..., { recursive: true })`.
  - Adds `"openapi:export": "tsx scripts/export-openapi.ts"` to `apps/backend/package.json` while leaving `tsconfig.json` (`include`) and existing Biome `"format"`/`"lint"` scripts untouched.
- **Your Commentary:**
  - You specifically wanted Option B's single-source-of-truth in-memory `/api/doc` resolution and output path behavior combined with Option C's clean `package.json`-only script addition (without modifying `tsconfig.json` or Biome script targets).

### Alternative Options Considered (For Future Reference)

- **Option A (Direct `getOpenAPI31Document` + `tsconfig.json`/Biome expansion):** Call `app.getOpenAPI31Document(...)` directly in the script and add `"scripts/**/*"` to `tsconfig.json` and Biome scripts.

---

# Installation, Setup & Implementation Guide (`apps/backend`)

- **Package:** `@foodapp/backend` (`apps/backend`)
- **Stack:** Hono `^4.13.16`, `@hono/zod-openapi` `^1.6.3`, `@scalar/hono-api-reference` `^0.12.20`, `zod` `^4.6.7`, `@inferdi/hono` `^6.1.1`, Better Auth `^1.7.20` (`bearer()`), Biome

---

## 1. Package Installation

Run from the **monorepo root**:

```bash
pnpm --filter @foodapp/backend add @hono/zod-openapi @scalar/hono-api-reference zod
```

### Installed Dependencies (`apps/backend/package.json`)

- `@hono/zod-openapi` (`^1.6.3`) — OpenAPI 3.1 route contracts, Zod v4 request/response validation, and `app.doc31()`
- `@scalar/hono-api-reference` (`^0.12.20`) — Interactive Scalar API reference UI at `/api/reference`
- `zod` (`^4.6.7`) — Runtime schema validation using Zod v4 top-level formats (`z.uuid()`, `z.email()`, `z.coerce.number()`)

---

## 2. Directory & File Setup

Run from the **monorepo root** to scaffold all folders and files:

```bash
mkdir -p \
  apps/backend/docs/adr \
  apps/backend/src/config \
  apps/backend/src/core/services

touch \
  apps/backend/docs/adr/001-openapi-validation-cors.md \
  apps/backend/docs/adr/test.md \
  apps/backend/src/app.ts \
  apps/backend/src/config/cors.ts \
  apps/backend/src/core/services/openapi-shared.ts \
  apps/backend/src/contexts/catalog/services/catalog-schemas.ts \
  apps/backend/src/contexts/identity/services/identity-schemas.ts \
  apps/backend/src/contexts/ledger/services/ledger-schemas.ts \
  apps/backend/src/contexts/ordering/services/order-schemas.ts
```

### Final Structure

```text
apps/backend/
├── .env
├── .env.example
├── package.json
├── docs/
│   └── adr/
│       ├── 001-openapi-validation-cors.md
│       └── test.md
└── src/
    ├── app.ts
    ├── index.ts
    ├── config/
    │   └── cors.ts
    ├── core/
    │   └── services/
    │       └── openapi-shared.ts
    └── contexts/
        ├── catalog/services/
        │   ├── catalog-schemas.ts
        │   ├── catalog-controller.ts
        │   └── catalog-routes.ts
        ├── identity/
        │   ├── infrastructure/better-auth.ts
        │   └── services/
        │       ├── identity-schemas.ts
        │       ├── identity-controller.ts
        │       └── identity-routes.ts
        ├── ledger/services/
        │   ├── ledger-schemas.ts
        │   ├── ledger-controller.ts
        │   └── ledger-routes.ts
        └── ordering/services/
            ├── order-schemas.ts
            ├── order-controller.ts
            └── order-routes.ts
```

---

## 3. Environment Configuration

Add `FRONTEND_ORIGINS` to `apps/backend/.env` and `apps/backend/.env.example`:

```env
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:4173,capacitor://localhost,http://localhost
```

---

## 4. Coding Summary (Implemented Modules)

### 4.1 CORS & Better Auth Configuration

1. **`apps/backend/src/config/cors.ts`**
   - Parses `FRONTEND_ORIGINS` via `getAllowedOrigins()` and configures `apiCorsMiddleware` (`allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']`, `exposeHeaders: ['set-auth-token', 'X-Request-Id']`, `credentials: true`).
2. **`apps/backend/src/contexts/identity/infrastructure/better-auth.ts`**
   - Enables `bearer()` plugin for cross-cloud `Authorization: Bearer <token>` sessions.
   - Shares `trustedOrigins: getAllowedOrigins` with Hono CORS.
   - Connects Redis lazily via `ensureRedisConnected()` instead of top-level `await redisClient.connect()`.

### 4.2 Shared OpenAPI & Validation Utilities

- **`apps/backend/src/core/services/openapi-shared.ts`**
  - Exports `ValidationIssueSchema`, `ValidationErrorResponseSchema`, `DomainErrorResponseSchema`, `SuccessFlagResponseSchema`, `PaginationQuerySchema`, and `openApiValidationHook` (returns `400` with `{ code: 'VALIDATION_ERROR', error, issues }`).

### 4.3 Bounded Context OpenAPI Schemas, Typed Controllers & Routes

1. **Identity (`src/contexts/identity/services/`)**
   - `identity-schemas.ts` — `POST /pos/auth/login`, `POST /pos/auth/logout`, `GET /me`
   - `identity-controller.ts` & `identity-routes.ts` (`OpenAPIHono<AppEnv>`)
2. **Catalog (`src/contexts/catalog/services/`)**
   - `catalog-schemas.ts` — `GET /`, `GET /{restaurantId}/menu`, `PATCH /items/{itemId}/price`
   - `catalog-controller.ts` & `catalog-routes.ts` (`OpenAPIHono<AppEnv>`)
3. **Ordering (`src/contexts/ordering/services/`)**
   - `order-schemas.ts` — `GET /`, `POST /`, `POST /{id}/settle`
   - `order-controller.ts` & `order-routes.ts` (`OpenAPIHono<AppEnv>`)
4. **Ledger & Loyalty (`src/contexts/ledger/services/`)**
   - `ledger-schemas.ts` — `GET /restaurant`, `GET /loyalty/me`, `POST /loyalty/redeem`
   - `ledger-controller.ts` & `ledger-routes.ts` (`OpenAPIHono<AppEnv>`)

### 4.4 Application Factory & Server Entrypoint

1. **`apps/backend/src/app.ts`**
   - Exports `createApp()` mounting `apiCorsMiddleware`, `initDiScope`, context `OpenAPIHono` routers, `GET /api/health`, `bearerAuth` security scheme, `GET /api/doc` (OpenAPI 3.1 JSON), and `GET /api/reference` (Scalar UI).
2. **`apps/backend/src/index.ts`**
   - Mounts `createApp({ enableRuntimeMiddleware: true })` under `requestId()`, LogTape context (`withContext`), HTTP request logger, and `globalErrorHandler`.

---

## 5. Run & Format Commands

```bash
# Format and lint with Biome
pn fixed

# Typecheck
pnpm --filter @foodapp/backend exec tsc --noEmit

# Start development server (http://localhost:3000)
pnpm --filter @foodapp/backend dev
```

---

# Backend API Verification & Testing Guide (`apps/backend`)

**Base URL:** `http://localhost:3000`  
**OpenAPI 3.1 Spec:** `http://localhost:3000/api/doc`  
**Interactive Scalar UI:** `http://localhost:3000/api/reference`

---

## 1. Pre-Flight Quality Checks

Run from the monorepo root before testing endpoints:

```bash
# Biome formatting & linting
pn fixed

# TypeScript strict typecheck
pnpm --filter @foodapp/backend exec tsc --noEmit

# Start backend server
pnpm --filter @foodapp/backend dev
```

---

## 2. OpenAPI 3.1 & Documentation Endpoints

### 2.1 OpenAPI 3.1 JSON Specification

```bash
curl -i http://localhost:3000/api/doc
```
**Expected:** `200 OK` with `"openapi": "3.1.0"`, `components.securitySchemes.bearerAuth`, and all 13 routes.

### 2.2 Scalar Interactive API Reference

Open in browser:

```text
http://localhost:3000/api/reference
```

### 2.3 Platform Health Check

```bash
curl -i http://localhost:3000/api/health
```
**Expected:** `200 OK` with `{"status":"ok","service":"foodapp-backend","datetime":"..."}`.

---

## 3. Cross-Cloud CORS Verification (`FRONTEND_ORIGINS`)

### 3.1 Allowed Origin Preflight (`http://localhost:5173`)

```bash
curl -i -X OPTIONS http://localhost:3000/api/me \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type"
```
**Expected Headers:**

- `access-control-allow-origin: http://localhost:5173`
- `access-control-allow-credentials: true`
- `access-control-expose-headers: set-auth-token,X-Request-Id`

### 3.2 Blocked Unlisted Origin Preflight

```bash
curl -i -X OPTIONS http://localhost:3000/api/me \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization"
```
**Expected:** `access-control-allow-origin` header is omitted.

---

## 4. Runtime Zod Validation (`defaultHook` -> `400 VALIDATION_ERROR`)

```bash
curl -i -X POST http://localhost:3000/api/pos/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":""}'
```
**Expected (`400 Bad Request`):**

```json
{
  "code": "VALIDATION_ERROR",
  "error": "Invalid request payload or parameters",
  "issues": [
    { "path": "email", "message": "Invalid email address" },
    { "path": "password", "message": "Too small: expected string to have >=1 characters" }
  ]
}
```

---

## 5. Authentication & Bearer Token Flows

> **Auth Architecture Note:**
> - **POS Tenant Staff (`OWNER`, `ADMIN`, `MANAGER`, `ORDER_TAKER`):** Authenticate with `restaurantId` + `email` + `password` at `POST /api/pos/auth/login` to receive an HS256 shift JWT (`12h` TTL).
> - **Global Users / Customers (`CUSTOMER`):** Passwordless authentication via Better Auth **Phone OTP** (`/api/auth/phone-number/send-otp` -> `/api/auth/phone-number/verify`), returning a session bearer token in the `set-auth-token` response header.

### 5.1 POS Staff Login (`POST /api/pos/auth/login`)

```bash
curl -i -X POST http://localhost:3000/api/pos/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"a0000000-0000-0000-0000-000000000002","email":"staff1.0002@pos-tenant.co.uk","password":"Password123!"}'
```
**Expected (`200 OK`):**

```json
{
  "success": true,
  "token": "<HS256_JWT>",
  "staff": {
    "staffId": "548cf55d-aad8-4c16-b9a2-41622d71fb90",
    "restaurantId": "a0000000-0000-0000-0000-000000000002",
    "role": "OWNER",
    "name": "Staff 1 (Westminster Patty Co)",
    "email": "staff1.0002@pos-tenant.co.uk"
  }
}
```

### 5.2 Authenticated Actor Check from Capacitor Origin (`GET /api/me`)

```bash
curl -i http://localhost:3000/api/me \
  -H "Origin: capacitor://localhost" \
  -H "Authorization: Bearer <HS256_JWT>"
```
**Expected (`200 OK`):**

```json
{
  "actor": {
    "id": "548cf55d-aad8-4c16-b9a2-41622d71fb90",
    "source": "POS_STAFF",
    "name": "Staff 1 (Westminster Patty Co)",
    "email": "staff1.0002@pos-tenant.co.uk",
    "role": "OWNER",
    "restaurantId": "a0000000-0000-0000-0000-000000000002"
  }
}
```

### 5.3 Invalid / Missing Bearer Token (`401 Unauthorized`)

```bash
curl -i http://localhost:3000/api/me \
  -H "Origin: capacitor://localhost" \
  -H "Authorization: Bearer invalid-token"
```
**Expected (`401 Unauthorized`):** `{"error":"Not authenticated"}`.

---

## 6. Bounded Context Endpoint Smoke Tests

### 6.1 Storefront Catalog (Public)

```bash
# List restaurants (optional ?postcodeSector=SW1A&skip=0&take=20)
curl -i "http://localhost:3000/api/restaurants?take=5"

# Fetch compiled menu snapshot
curl -i "http://localhost:3000/api/restaurants/a0000000-0000-0000-0000-000000000002/menu"
```

### 6.2 POS Ordering & Financial Ledger (POS Staff Bearer Token Required)

```bash
# List POS orders for active staff restaurant
curl -i http://localhost:3000/api/pos/orders \
  -H "Authorization: Bearer <HS256_JWT>"

# Get double-entry restaurant ledger (OWNER & ADMIN only)
curl -i http://localhost:3000/api/ledger/restaurant \
  -H "Authorization: Bearer <HS256_JWT>"
```
