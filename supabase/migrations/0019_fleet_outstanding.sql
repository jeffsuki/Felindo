-- =========================================================================
-- 0019_fleet_outstanding.sql — outstanding = quantity − sum(muatan OR estimasi):
-- the estimate reserves against the contract until the real load overwrites it.
-- Also: total_susut only counts deliveries where BOTH muatan and bongkar are
-- filled (an unfilled bongkar no longer inflates susut). Run AFTER 0018.
-- =========================================================================

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
       ) as incomplete_deliveries
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id
group by c.id, c.quantity_kg;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on fleet_contract_totals to anon, authenticated;
  end if;
end $$;
