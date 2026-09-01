-- =========================================================================
-- 0003_master_editable.sql — permanent wide codes, truck codes, nicknames
--
-- Run AFTER 0001_init.sql, 0002_history.sql, and seed.sql.
--
-- What this does:
--   * Widens all master codes to 5 digits (T/D/M/V-00001 … -99999), capacity
--     for ~100k of each. Identity is preserved: D-01 becomes D-00001, the same
--     driver #1, just wider padding.
--   * Gives trucks a permanent code (T-00001…), so a plate change never touches
--     the truck's identity — plate becomes an editable attribute.
--   * Adds an optional nickname to drivers and mechanics (searchable in the UI)
--     to disambiguate similar names.
--   * Auto-assigns the next code on insert when one isn't supplied, so the
--     "Add" forms in the app don't need the operator to know the next number.
-- =========================================================================

begin;

-- 1. New columns ----------------------------------------------------------
alter table trucks    add column if not exists code text;
alter table drivers   add column if not exists nickname text;
alter table mechanics add column if not exists nickname text;

-- 2. Widen existing D / M / V codes to 5 digits (D-01 -> D-00001) ----------
update drivers   set code = 'D-' || lpad(split_part(code,'-',2)::int::text, 5, '0') where code ~ '^D-[0-9]+$';
update mechanics set code = 'M-' || lpad(split_part(code,'-',2)::int::text, 5, '0') where code ~ '^M-[0-9]+$';
update vendors   set code = 'V-' || lpad(split_part(code,'-',2)::int::text, 5, '0') where code ~ '^V-[0-9]+$';

-- 3. Backfill truck codes T-00001… ordered by plate -----------------------
with ordered as (
  select id, row_number() over (order by plate) as rn
  from trucks where code is null
)
update trucks t set code = 'T-' || lpad(o.rn::text, 5, '0')
from ordered o where o.id = t.id;

-- 4. Lock down trucks.code -----------------------------------------------
alter table trucks alter column code set not null;
create unique index if not exists trucks_code_key on trucks(code);

-- 5. Auto-assign the next code on insert when not provided.
--    Single-writer app, so max()+1 is correct and simplest; the code column's
--    unique constraint is the backstop against any race.
create or replace function assign_master_code()
returns trigger language plpgsql as $$
declare pfx text; n int;
begin
  if NEW.code is not null and NEW.code <> '' then return NEW; end if;
  pfx := case TG_TABLE_NAME
           when 'trucks'    then 'T'
           when 'drivers'   then 'D'
           when 'mechanics' then 'M'
           when 'vendors'   then 'V'
         end;
  execute format(
    'select coalesce(max(split_part(code,''-'',2)::int),0)+1 from %I where code like $1',
    TG_TABLE_NAME
  ) into n using pfx || '-%';
  NEW.code := pfx || '-' || lpad(n::text, 5, '0');
  return NEW;
end $$;

drop trigger if exists trucks_code    on trucks;
drop trigger if exists drivers_code   on drivers;
drop trigger if exists mechanics_code on mechanics;
drop trigger if exists vendors_code   on vendors;

create trigger trucks_code    before insert on trucks    for each row execute function assign_master_code();
create trigger drivers_code   before insert on drivers   for each row execute function assign_master_code();
create trigger mechanics_code before insert on mechanics for each row execute function assign_master_code();
create trigger vendors_code   before insert on vendors   for each row execute function assign_master_code();

commit;
