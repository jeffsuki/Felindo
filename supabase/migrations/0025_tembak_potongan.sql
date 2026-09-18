-- =========================================================================
-- 0025_tembak_potongan.sql — deduction on a released uang tembak. Sisa (net
-- paid) = tembak_amount − tembak_potongan. Run AFTER 0024. Additive.
-- =========================================================================

alter table fleet_deliveries add column if not exists tembak_potongan        numeric;
alter table fleet_deliveries add column if not exists tembak_jenis_potongan  text;   -- Susut | Ganti Ban | Ganti Spare Part | Lainnya
