-- =========================================================================
-- 0034_driver_debt.sql — driver debt ledger foundations:
--   • fleet_contracts.price_per_kg — estimated CPO price per kg (susut claim
--     = claim susut kg × price_per_kg, automated).
--   • fleet_driver_claims — manual claims (Ban / Spare Part) per driver.
-- Payments are the slip potongan, credited to the account named by its jenis.
-- Run AFTER 0033. Additive.
-- =========================================================================

alter table fleet_contracts add column if not exists price_per_kg numeric;

create table if not exists fleet_driver_claims (
  id          uuid primary key default gen_random_uuid(),
  driver_name text not null,
  jenis       text not null,          -- 'Ganti Ban' | 'Ganti Spare Part'
  amount      numeric not null,
  tanggal     date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists fleet_driver_claims_driver on fleet_driver_claims (driver_name);

do $$
begin
  execute 'alter table fleet_driver_claims enable row level security';
  execute $p$create policy fleet_driver_claims_all on fleet_driver_claims for all using (true) with check (true)$p$;
exception when duplicate_object then null;
end $$;
