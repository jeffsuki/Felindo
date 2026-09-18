-- =========================================================================
-- 0022_fleet_claim.sql — add total_claim (susut exceeding tolerance, summed
-- per contract) to the totals view. Run AFTER 0021.
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
       ) as incomplete_deliveries,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null and c.susut_tolerance is not null
                         then greatest((d.muatan - d.bongkar) - c.susut_tolerance * d.muatan, 0)
                         else 0 end), 0) as total_claim
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id
group by c.id, c.quantity_kg, c.susut_tolerance;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on fleet_contract_totals to anon, authenticated;
  end if;
end $$;
