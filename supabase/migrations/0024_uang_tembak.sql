-- =========================================================================
-- 0024_uang_tembak.sql — per-trip performance bonus (uang tembak). Each
-- delivery can carry one tembak: outstanding until released (paid). Released
-- only once the realized muatan/bongkar are in. Run AFTER 0023. Additive.
-- =========================================================================

alter table fleet_deliveries add column if not exists tembak_amount        numeric;
alter table fleet_deliveries add column if not exists tembak_released       boolean not null default false;
alter table fleet_deliveries add column if not exists tembak_released_date  date;
