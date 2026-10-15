-- =========================================================================
-- 0037_delivery_parts.sql — one slip (truck load) carrying several contracts.
--
-- A delivery row stays "one contract's share of one load". When a load
-- carries a second contract, that share is its own row under its own
-- contract (own do_no, muatan, bongkar, dates) linked to the main slip row
-- by parent_id:
--   • main row  (parent_id is null) = the slip: borongan, BBM, potongan,
--     penyesuaian, uang tembak, stage. One per truck load / trip.
--   • part row  (parent_id = main row id) = the extra contract's kg only.
--     Money, tembak and stage columns stay empty on a part.
-- Contract totals (fleet_contract_totals) need no change: each contract still
-- sums its own rows. Trip counts, uang tembak and km use main rows only.
--
-- Parts mirror the main row's tanggal / truck_id / plate / driver_name; the
-- triggers below keep them in sync. Deleting a main row deletes its parts.
-- Run AFTER 0036. Additive — existing rows are untouched (parent_id null).
-- =========================================================================

alter table fleet_deliveries
  add column if not exists parent_id uuid references fleet_deliveries(id) on delete cascade;

create index if not exists fleet_deliveries_parent on fleet_deliveries (parent_id);

-- A slip carries each extra contract once.
create unique index if not exists fleet_deliveries_parent_contract
  on fleet_deliveries (parent_id, contract_id) where parent_id is not null;

-- Slip money and uang tembak belong on the main row, never on a part.
do $$
begin
  alter table fleet_deliveries add constraint fleet_deliveries_part_no_money check (
    parent_id is null or (
      borongan is null and bbm_liter is null and bbm_rupiah is null
      and tembak_amount is null and not tembak_released));
exception when duplicate_object then null;
end $$;

comment on column fleet_deliveries.parent_id is
  'Main slip row this contract part belongs to (null = main row / single-contract slip). Parts hold kg only; slip money stays on the main row.';

-- Parts: one level only, copy the shared trip fields from the main row.
create or replace function fleet_delivery_part_sync() returns trigger
language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then
    if tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id
       and exists (select 1 from fleet_deliveries c
                    where c.parent_id = new.id and c.contract_id = new.contract_id) then
      raise exception 'This slip already carries that contract as its second part';
    end if;
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A delivery cannot be its own parent';
  end if;
  select parent_id, contract_id, tanggal, truck_id, plate, driver_name
    into p from fleet_deliveries where id = new.parent_id;
  if not found then
    raise exception 'Parent delivery % not found', new.parent_id;
  end if;
  if p.parent_id is not null then
    raise exception 'A contract part cannot hang under another part (one level only)';
  end if;
  if exists (select 1 from fleet_deliveries c where c.parent_id = new.id) then
    raise exception 'This delivery already has parts of its own and cannot become a part';
  end if;
  if p.contract_id = new.contract_id then
    raise exception 'A contract part must be on a different contract than its slip';
  end if;
  new.tanggal     := p.tanggal;
  new.truck_id    := p.truck_id;
  new.plate       := p.plate;
  new.driver_name := p.driver_name;
  return new;
end $$;

drop trigger if exists fleet_delivery_part_sync on fleet_deliveries;
create trigger fleet_delivery_part_sync
  before insert or update on fleet_deliveries
  for each row execute function fleet_delivery_part_sync();

-- Main row edited: push the shared trip fields down to its parts.
create or replace function fleet_delivery_parts_follow() returns trigger
language plpgsql as $$
begin
  update fleet_deliveries
     set tanggal = new.tanggal, truck_id = new.truck_id,
         plate = new.plate, driver_name = new.driver_name
   where parent_id = new.id;
  return null;
end $$;

drop trigger if exists fleet_delivery_parts_follow on fleet_deliveries;
create trigger fleet_delivery_parts_follow
  after update of tanggal, truck_id, plate, driver_name on fleet_deliveries
  for each row
  when (new.parent_id is null and (
        old.tanggal     is distinct from new.tanggal  or
        old.truck_id    is distinct from new.truck_id or
        old.plate       is distinct from new.plate    or
        old.driver_name is distinct from new.driver_name))
  execute function fleet_delivery_parts_follow();
