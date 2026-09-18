-- =========================================================================
-- 0023_bbm_price.sql — price per liter for BBM on slips. Total BBM (bbm_rupiah)
-- is computed as bbm_liter × price_per_liter. Run AFTER 0022. Additive.
-- =========================================================================

alter table fleet_deliveries add column if not exists price_per_liter numeric;
