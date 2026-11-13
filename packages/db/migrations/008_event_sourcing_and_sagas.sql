CREATE TABLE IF NOT EXISTS "DomainEventStore" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "aggregateId" UUID NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "version" INT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID
);


ALTER TABLE "DomainEventStore"
DROP CONSTRAINT IF EXISTS uq_event_aggregate_version;


ALTER TABLE "DomainEventStore"
ADD CONSTRAINT uq_event_aggregate_version UNIQUE ("aggregateId", "version");


CREATE INDEX IF NOT EXISTS idx_eventstore_aggregate ON "DomainEventStore" ("aggregateId", "version");


CREATE INDEX IF NOT EXISTS idx_eventstore_type ON "DomainEventStore" ("aggregateType", "occurredAt");


CREATE TABLE IF NOT EXISTS "AggregateMemento" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "aggregateId" UUID NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "version" INT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID
);


ALTER TABLE "AggregateMemento"
DROP CONSTRAINT IF EXISTS uq_memento_aggregate_version;


ALTER TABLE "AggregateMemento"
ADD CONSTRAINT uq_memento_aggregate_version UNIQUE ("aggregateId", "version");


CREATE INDEX IF NOT EXISTS idx_memento_latest ON "AggregateMemento" ("aggregateId", "version" DESC);


CREATE TABLE IF NOT EXISTS "_Saga_State" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "sagaType" TEXT NOT NULL,
  "correlationId" UUID NOT NULL,
  "currentStep" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "statePayload" JSONB NOT NULL DEFAULT '{}',
  "lastError" TEXT,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID
);


ALTER TABLE "_Saga_State"
DROP CONSTRAINT IF EXISTS uq_saga_correlation;


ALTER TABLE "_Saga_State"
ADD CONSTRAINT uq_saga_correlation UNIQUE ("sagaType", "correlationId");


CREATE INDEX IF NOT EXISTS idx_saga_status ON "_Saga_State" ("status", "updatedAt");
