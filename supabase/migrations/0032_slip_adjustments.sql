-- =========================================================================
-- 0032_slip_adjustments.sql — situational slip adjustments. Deductions reduce,
-- tambahan add. Sisa = borongan − selisih_bbm − potongan_pihak − total BBM
-- − pot susut − pot pm + cuci + steam + tol. Run AFTER 0031. Additive.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists selisih_bbm         numeric,   -- Potongan Selisih BBM (modify borongan)
  add column if not exists potongan_pihak      numeric,   -- Potongan dari ANS/MNA (modify borongan)
  add column if not exists potongan_pihak_nama text,      -- ANS | MNA | other
  add column if not exists tambahan_cuci       numeric,   -- Tambahan cuci tangki
  add column if not exists tambahan_steam      numeric,   -- Tambahan tangki double steam
  add column if not exists tambahan_tol        numeric,   -- Tambahan bantuan uang tol
  add column if not exists is_retur            boolean not null default false;  -- Slip utk retur
