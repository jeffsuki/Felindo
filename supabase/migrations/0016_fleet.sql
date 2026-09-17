-- =========================================================================
-- 0016_fleet.sql — Fleet Management (CPO freight hauling): contracts and the
-- deliveries under them. Separate from the workshop; shares the trucks master
-- (for capacity/type). Drivers are free text (not bound to the drivers master).
-- Run AFTER 0001-0015. Additive.
-- =========================================================================

-- Truck load capacity, used to inform borongan (freight) by type + capacity.
alter table trucks add column if not exists capacity_kg numeric;

-- ---- Contracts (Master List) --------------------------------------------
create table if not exists fleet_contracts (
  id              uuid primary key default gen_random_uuid(),
  control_no      text unique not null,        -- NOMOR KONTROL (7263) — entered by you
  contract_date   date,                         -- TANGGAL KONTRAK
  contract_no     text,                         -- NOMOR KONTRAK
  do_contract_no  text,                         -- DO KONTRAK
  client          text,                         -- SUPPLIER / NAMA SUPPLIER
  origin          text,                         -- ASAL / KEBUN
  destination     text,                         -- TUJUAN
  commodity       text,                         -- KOMODITI (CPO)
  quantity_kg     numeric,                       -- KUANTITI / PARTAI (contracted)
  susut_tolerance numeric default 0.002,         -- TOLERANSI SUSUT
  dk              text,                          -- DK flag
  status          text not null default 'open',  -- open | closed
  note            text,
  created_at      timestamptz not null default now()
);

-- ---- Deliveries (Daftar Kontrol + Slip Uang Jalan) ----------------------
create table if not exists fleet_deliveries (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references fleet_contracts(id) on delete cascade,
  do_no           int,                           -- DO number within the contract
  tanggal         date,                          -- dispatch date
  truck_id        uuid references trucks(id),    -- linked (for capacity/type/plate)
  plate           text,                          -- plate snapshot / free-text fallback
  driver_name     text,                          -- free text (not bound to drivers)
  estimasi_muat   numeric,                       -- ESTIMASI MUAT
  tanggal_muat    date,
  muatan          numeric,                       -- REALISASI MUATAN (loaded at origin)
  tanggal_bongkar date,
  bongkar         numeric,                       -- REALISASI BONGKAR (unloaded at dest)
  -- Slip Uang Jalan (road money):
  borongan        numeric,                       -- freight pay (hand-entered)
  bbm_liter       numeric,
  bbm_rupiah      numeric,
  potongan_susut  numeric,
  potongan_pm     numeric,
  potongan_lain   numeric,
  keterangan      text,
  created_at      timestamptz not null default now()
);
create index if not exists fleet_deliveries_contract on fleet_deliveries (contract_id);

-- ---- Contract totals (derived) ------------------------------------------
-- outstanding uses the REAL loaded total (muatan), not estimates.
create or replace view fleet_contract_totals as
select c.id as contract_id,
       count(d.id)                             as deliveries,
       coalesce(sum(d.estimasi_muat), 0)       as total_estimasi,
       coalesce(sum(d.muatan), 0)              as total_muatan,
       coalesce(sum(d.bongkar), 0)             as total_bongkar,
       coalesce(sum(coalesce(d.muatan,0) - coalesce(d.bongkar,0)), 0) as total_susut,
       greatest(coalesce(c.quantity_kg,0) - coalesce(sum(d.muatan),0), 0) as outstanding
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id
group by c.id, c.quantity_kg;

-- ---- RLS (v1 open, tighten with auth later) -----------------------------
do $$
declare tname text;
begin
  foreach tname in array array['fleet_contracts','fleet_deliveries'] loop
    execute format('alter table %I enable row level security;', tname);
    execute format($p$create policy %I on %I for all using (true) with check (true);$p$, tname || '_all', tname);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on fleet_contract_totals to anon, authenticated;
  end if;
end $$;
