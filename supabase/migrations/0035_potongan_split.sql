-- =========================================================================
-- 0035_potongan_split.sql — fixed potongan fields per slip: Susut, Ban, Spare
-- Part, Lain, PM (susut/lain/pm already exist). Each feeds its Hutang account;
-- jenis_potongan is no longer used. Run AFTER 0034. Additive.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists potongan_ban       numeric,
  add column if not exists potongan_sparepart numeric;
