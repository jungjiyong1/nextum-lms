-- Migration: add_pin_to_profiles
-- Kept for compatibility with older setup notes. New installs get these
-- columns from 0001_lms_schema.sql.

alter table lms.profiles
add column if not exists pin_hash text default null,
add column if not exists idle_timeout integer default 10;

-- idle_timeout: minutes (5, 10, 15, 30)
-- pin_hash: SHA-256 hashed PIN, NULL if not set
