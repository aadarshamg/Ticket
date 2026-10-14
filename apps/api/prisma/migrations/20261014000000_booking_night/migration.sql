-- A scan of a pass on a night it is not for.
ALTER TYPE "CheckinResult" ADD VALUE 'wrong_night';

-- The night a booking is for, on a multi-night event. Null: valid on any night.
ALTER TABLE "Ticket" ADD COLUMN "night" DATE;
