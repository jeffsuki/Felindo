-- =========================================================================
-- 0039_retur_and_slips_without_contract.sql
--
-- 1. RETUR — uang jalan returned by the driver (the trip did not happen).
--    A retur slip stays a slip: it keeps its date and money and still shows on
--    the laporan borongan harian, with a retur note.
--      • retur_date / retur_amount record the money coming back (the slip's
--        sisa); the Laporan Kas shows it as cash in on retur_date.
--      • it is no delivery: no DO number, left out of the contract's list
--        (daftar kontrol) and its totals.
--    is_retur (0032, "Slip untuk retur") is the flag; the Retur button sets all three.
--
-- 2. SLIPS WITHOUT A CONTRACT — uang jalan is often paid before the DO is known.
--    contract_id may now be empty on a slip; the slip then has no DO number and
--    keeps its route as written on the uang jalan in `rute`. Linking the contract
--    later (Slip Uang Jalan page) gives it the next DO number on that contract.
--    A second-contract part (parent_id set) still needs its contract.
--
-- 3. PERLU DICEK — cek_note: a note for staff when a slip differs from the laporan borongan harian
--    (set by the 2026 import, cleared on the Slip Uang Jalan page with "Sudah dicek").
--
-- Run AFTER 0038. Additive; existing retur slips lose their DO number.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists retur_date   date,      -- day the uang jalan came back
  add column if not exists retur_amount numeric,   -- amount that came back (the slip's sisa)
  add column if not exists rute         text,      -- route as written on the uang jalan, while the slip has no contract
  add column if not exists cek_note     text;      -- "perlu dicek": what to check on this slip (null = nothing to check)

comment on column fleet_deliveries.retur_date is 'Retur: day the driver returned the uang jalan (Laporan Kas, cash in). Null = no retur.';
comment on column fleet_deliveries.retur_amount is 'Retur: amount returned (the slip''s sisa at the time).';
comment on column fleet_deliveries.cek_note is 'Perlu dicek: why staff should review this slip (e.g. it differs from the laporan borongan). Cleared with "Sudah dicek".';
comment on column fleet_deliveries.rute is 'Route as written on the uang jalan (e.g. "ANS - SDS"), used while the slip has no contract yet.';

-- A slip may wait for its contract; a contract part may not.
alter table fleet_deliveries alter column contract_id drop not null;
alter table fleet_deliveries drop constraint if exists fleet_deliveries_part_needs_contract;
alter table fleet_deliveries add constraint fleet_deliveries_part_needs_contract
  check (parent_id is null or contract_id is not null);
-- no contract, no DO number
update fleet_deliveries set do_no = null where contract_id is null and do_no is not null;

-- A retur slip is not a delivery on its contract.
create or replace view fleet_contract_totals as
select c.id as contract_id,
       count(d.id)                        as deliveries,
       coalesce(sum(d.estimasi_muat), 0)  as total_estimasi,
       coalesce(sum(d.muatan), 0)         as total_muatan,
       coalesce(sum(d.bongkar), 0)        as total_bongkar,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null
                         then d.muatan - d.bongkar else 0 end), 0) as total_susut,
       greatest(coalesce(c.quantity_kg,0)
                - coalesce(sum(coalesce(d.muatan, d.estimasi_muat, 0)), 0), 0) as outstanding,
       count(d.id) filter (
         where d.muatan is null or d.bongkar is null
            or d.tanggal_muat is null or d.tanggal_bongkar is null
       ) as incomplete_deliveries,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null and c.susut_tolerance is not null
                         then greatest((d.muatan - d.bongkar) - c.susut_tolerance * d.muatan, 0)
                         else 0 end), 0) as total_claim
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id and not d.is_retur
group by c.id, c.quantity_kg, c.susut_tolerance;

-- Slips already marked "untuk retur" leave the DO numbering.
update fleet_deliveries set do_no = null where is_retur and do_no is not null;
