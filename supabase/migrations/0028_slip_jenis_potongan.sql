-- =========================================================================
-- 0028_slip_jenis_potongan.sql — jenis potongan (type) on the slip, same
-- options as uang tembak. Run AFTER 0027. Additive.
-- =========================================================================

alter table fleet_deliveries add column if not exists jenis_potongan text;  -- Susut | Ganti Ban | Ganti Spare Part | Lainnya
