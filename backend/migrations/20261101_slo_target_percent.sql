
-- ===== Per-monitor SLO target =====
-- The column was only inside CREATE TABLE monitors, so databases created
-- before it existed never received it and monitor creation failed with
-- 'column "slo_target_percent" of relation "monitors" does not exist'.
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS slo_target_percent NUMERIC(5,2) NOT NULL DEFAULT 99.90
  CHECK (slo_target_percent >= 90.00 AND slo_target_percent <= 100.00);