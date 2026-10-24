-- =========================================================================
-- 0046_bruto_tarra.sql — weighbridge figures on the rincian.
--
-- Each rincian now records Bruto / Tarra / Netto at BOTH ends:
--   * muat    : muat_bruto,    muat_tarra    → netto = existing MUATAN
--   * bongkar : bongkar_bruto, bongkar_tarra → netto = existing BONGKAR
-- Netto stays in the existing muatan/bongkar columns, so susut, claim,
-- tagihan and every report keep working unchanged. The app fills netto
-- automatically (bruto − tarra) when both weights are typed; netto alone
-- can still be typed for old rows or missing weighbridge slips.
--
-- Run AFTER 0045. Additive only.
-- =========================================================================

alter table fleet_deliveries add column if not exists muat_bruto    numeric;
alter table fleet_deliveries add column if not exists muat_tarra    numeric;
alter table fleet_deliveries add column if not exists bongkar_bruto numeric;
alter table fleet_deliveries add column if not exists bongkar_tarra numeric;
comment on column fleet_deliveries.muat_bruto is 'Timbangan muat: bruto. Netto (bruto − tarra) tersimpan di kolom muatan.';
comment on column fleet_deliveries.bongkar_bruto is 'Timbangan bongkar: bruto. Netto (bruto − tarra) tersimpan di kolom bongkar.';
