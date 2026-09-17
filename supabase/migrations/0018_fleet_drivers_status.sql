-- =========================================================================
-- 0018_fleet_drivers_status.sql — a drivers register for the delivery dropdown,
-- and an "incomplete deliveries" count so contracts can be classed
-- Open / Delivered / Closed. Run AFTER 0017. Additive.
-- =========================================================================

create table if not exists fleet_drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  note       text,
  created_at timestamptz not null default now()
);

do $$
begin
  execute 'alter table fleet_drivers enable row level security';
  execute $p$create policy fleet_drivers_all on fleet_drivers for all using (true) with check (true)$p$;
exception when duplicate_object then null;
end $$;

-- Totals view: add incomplete_deliveries at the end (a delivery is incomplete
-- if any realized column — muatan, bongkar, or their dates — is blank).
create or replace view fleet_contract_totals as
select c.id as contract_id,
       count(d.id)                             as deliveries,
       coalesce(sum(d.estimasi_muat), 0)       as total_estimasi,
       coalesce(sum(d.muatan), 0)              as total_muatan,
       coalesce(sum(d.bongkar), 0)             as total_bongkar,
       coalesce(sum(coalesce(d.muatan,0) - coalesce(d.bongkar,0)), 0) as total_susut,
       greatest(coalesce(c.quantity_kg,0) - coalesce(sum(d.muatan),0), 0) as outstanding,
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
