-- generate_series(date, date, interval) is classified as STABLE by Postgres,
-- so the wrapper must not claim a stronger volatility guarantee.
alter function private.schedule_rules_overlap_v1(
  integer,
  date,
  date,
  integer,
  integer,
  date,
  date,
  integer
) stable;
