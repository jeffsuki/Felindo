-- =========================================================================
-- 0033_selisih_bbm_detail.sql — Selisih BBM as liter × price (selisih_bbm is
-- the computed amount that reduces borongan). Run AFTER 0032. Additive.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists selisih_bbm_liter numeric,
  add column if not exists selisih_bbm_price numeric;
