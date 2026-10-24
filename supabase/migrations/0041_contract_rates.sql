-- =========================================================================
-- 0041_contract_rates.sql
--
-- ONGKOS ANGKUT THAT CHANGES MID-CONTRACT. The price of a contract can go up
-- or down partway through, and some clients still require one invoice. So the
-- contract is NOT split: it keeps one daftar kontrol and one tagihan, and the
-- price becomes date-based inside it:
--   * fleet_contracts.oa_per_kg stays the HARGA AWAL (the rate from the start)
--   * contract_rates holds each change: "mulai <date>, <rate> Rp/kg"
--   * a delivery is billed at the rate in force on its TANGGAL MUAT
--     (falling back to tanggal bongkar, then the slip date, when muat is empty)
--   * a reject is billed muatan x (rate on its date + reject_oa_per_kg)
--
-- Run AFTER 0040. Additive.
-- =========================================================================

create table if not exists contract_rates (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references fleet_contracts(id) on delete cascade,
  effective_from date not null,            -- first day the new rate applies (by tanggal muat)
  oa_per_kg      numeric not null,
  created_at     timestamptz not null default now(),
  unique (contract_id, effective_from)
);
create index if not exists contract_rates_contract on contract_rates (contract_id, effective_from);
comment on table contract_rates is 'Ongkos angkut changes within a contract: from effective_from (by tanggal muat) the contract bills at oa_per_kg. The contract''s own oa_per_kg is the harga awal.';

do $$
begin
  execute 'alter table contract_rates enable row level security';
  if not exists (select 1 from pg_policies where tablename = 'contract_rates') then
    execute $p$create policy contract_rates_all on contract_rates for all using (true) with check (true)$p$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant all on contract_rates to anon, authenticated;
  end if;
end $$;

-- Totals per contract: tagihan now prices each delivery by the rate on its
-- tanggal muat. Everything else as in 0040.
create or replace view fleet_contract_totals as
select c.id as contract_id,
       count(d.id) filter (where not d.is_reject)                                  as deliveries,
       coalesce(sum(d.estimasi_muat) filter (where not d.is_reject), 0)             as total_estimasi,
       coalesce(sum(d.muatan) filter (where not d.is_reject), 0)                    as total_muatan,
       coalesce(sum(d.bongkar) filter (where not d.is_reject), 0)                   as total_bongkar,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null
                         then d.muatan - d.bongkar else 0 end) filter (where not d.is_reject), 0) as total_susut,
       greatest(coalesce(c.quantity_kg, 0)
                - coalesce(sum(coalesce(d.muatan, d.estimasi_muat, 0)) filter (where not d.is_reject), 0), 0) as outstanding,
       count(d.id) filter (
         where not d.is_reject and (d.muatan is null or d.bongkar is null
            or d.tanggal_muat is null or d.tanggal_bongkar is null)
       ) as incomplete_deliveries,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null and c.susut_tolerance is not null
                         then greatest((d.muatan - d.bongkar) - c.susut_tolerance * d.muatan, 0)
                         else 0 end) filter (where not d.is_reject), 0) as total_claim,
       count(d.id) filter (where d.is_reject)                                       as rejects,
       case when c.oa_per_kg is null
             and not exists (select 1 from contract_rates r where r.contract_id = c.id)
            then null else
         coalesce(sum(case when d.is_reject then coalesce(d.muatan, 0) * (coalesce(rt.oa, 0) + coalesce(d.reject_oa_per_kg, 0))
                           when c.billing_basis = 'muatan' then coalesce(d.muatan, 0) * coalesce(rt.oa, 0)
                           else coalesce(d.bongkar, 0) * coalesce(rt.oa, 0) end), 0) end as tagihan
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id and not d.is_retur
left join lateral (
  -- the rate in force on the delivery's tanggal muat (bongkar / slip date as fallback)
  select coalesce(
           (select r.oa_per_kg from contract_rates r
             where r.contract_id = c.id
               and r.effective_from <= coalesce(d.tanggal_muat, d.tanggal_bongkar, d.tanggal)
             order by r.effective_from desc limit 1),
           c.oa_per_kg) as oa
) rt on true
group by c.id, c.quantity_kg, c.susut_tolerance, c.oa_per_kg, c.billing_basis;
