-- =========================================================================
-- 0017_fleet_registers.sql — controlled lists for contracts: clients and
-- locations (origins/destinations), plus jenis_truk on contracts. Run AFTER
-- 0016. Additive. (These registers can move under Master Data later.)
-- =========================================================================

create table if not exists fleet_clients (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists fleet_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  kind       text not null default 'Both',   -- Origin | Destination | Both
  note       text,
  created_at timestamptz not null default now()
);

-- Truck type on the contract (replaces the old free-text DK flag).
alter table fleet_contracts add column if not exists jenis_truk text;   -- Tangki | Gerobak

do $$
declare tname text;
begin
  foreach tname in array array['fleet_clients','fleet_locations'] loop
    execute format('alter table %I enable row level security;', tname);
    execute format($p$create policy %I on %I for all using (true) with check (true);$p$, tname || '_all', tname);
  end loop;
end $$;
