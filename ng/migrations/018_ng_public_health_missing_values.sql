-- Preserve the difference between a measured zero and unavailable source data.
-- Existing rows are retained; future report generation may store NULL when a
-- required source table/column is not deployed or a metric cannot be observed.
ALTER TABLE public_health_report_values
  ALTER COLUMN value DROP NOT NULL,
  ALTER COLUMN value DROP DEFAULT;
