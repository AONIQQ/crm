-- The anonymous install identity, in Postgres rather than on disk.
--
-- All three processes deploy to Vercel, where the filesystem is ephemeral, so
-- the usual ~/.app/telemetry-id file would mint a new UUID on every cold start
-- and we would be counting containers instead of installs.
--
-- One row, id pinned to 'install' by `@crm/telemetry`, the same singleton
-- shape as "appSetting". The row is written here rather than on first boot so
-- that the ID exists from the moment the schema does — "createdAt" is then a
-- real install date, and the first funnel step is stamped by the statement
-- that created the install rather than by whichever process happened to start.
--
-- "version" is upserted from the root package.json on every boot, so an
-- upgrade is visible without redeploying telemetry code. 'unknown' only
-- survives until the API or the agent next starts.
CREATE TABLE "install" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "lastRollupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "install_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "install_uuid_key" ON "install"("uuid");

INSERT INTO "install" ("id", "uuid", "version")
VALUES ('install', gen_random_uuid()::text, 'unknown');

-- The setup funnel is one-shot: each step fires once per install, ever. A
-- boolean column read and then written races between the API and the agent;
-- an insert that reports whether it was the one to land does not.
CREATE TABLE "telemetryMilestone" (
    "step" TEXT NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetryMilestone_pkey" PRIMARY KEY ("step")
);

-- Counters for the two things the daily rollup wants that leave no other row:
-- a session that stopped because its research budget ran out, and a tool that
-- returned an error. Everything else the rollup reports is already in the
-- schema and is counted there.
--
-- Drained with UPDATE … SET count = 0 … RETURNING, so an increment landing
-- mid-drain is counted tomorrow rather than lost.
CREATE TABLE "telemetryCounter" (
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetryCounter_pkey" PRIMARY KEY ("name")
);
