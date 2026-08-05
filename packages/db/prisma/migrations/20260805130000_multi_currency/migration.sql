-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('FETCHED', 'MANUAL');

-- AlterTable
ALTER TABLE "appSetting" ADD COLUMN     "reportingCurrency" TEXT,
ADD COLUMN     "ratesRefreshedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "baseAmount" DECIMAL(18,4),
ADD COLUMN     "fxRate" DECIMAL(20,10),
ADD COLUMN     "fxRateAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "exchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "source" "RateSource" NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchangeRate_baseCurrency_quoteCurrency_source_key" ON "exchangeRate"("baseCurrency", "quoteCurrency", "source");

-- CreateIndex
CREATE INDEX "exchangeRate_baseCurrency_quoteCurrency_idx" ON "exchangeRate"("baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE INDEX "deal_baseAmount_idx" ON "deal"("baseAmount");

-- CreateIndex
CREATE INDEX "deal_currency_idx" ON "deal"("currency");

-- Backfill: every deal already recorded is in the reporting currency, because
-- until now there was only one. Skipping this would drop every existing deal
-- out of every total the moment this migration lands.
UPDATE "deal"
SET "baseAmount" = "amount",
    "fxRate" = 1,
    "fxRateAt" = CURRENT_TIMESTAMP
WHERE "amount" IS NOT NULL
  AND upper(btrim("currency")) = COALESCE(
    (
      SELECT upper(btrim("reportingCurrency"))
      FROM "appSetting"
      WHERE "id" = 'app' AND btrim(COALESCE("reportingCurrency", '')) <> ''
    ),
    'USD'
  );
