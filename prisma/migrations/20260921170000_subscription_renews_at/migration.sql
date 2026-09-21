-- Renewal date for subscriptions nothing can be asked automatically.
ALTER TABLE "Subscription" ADD COLUMN "renewsAt" DATETIME;
