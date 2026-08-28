-- =========================================================================
-- 0001_init.sql — Truck Repair Management System, v1 schema
--
-- Design notes:
--   * Every master entity has a stable business code (D-01, M-01, plate, V-01,
--     SP-01) plus a surrogate uuid used for foreign keys. Codes are never
--     reused; rows are never deleted — you retire them via the status column.
--   * "Lifecycle status" (Active / Resigned / Sold / Scrapped ...) is stored
--     on each entity and governs whether it shows up in dropdowns. A truck's
--     "operational status" (in_repair / awaiting_outsource / operational) is a
--     SEPARATE, DERIVED value — see the truck_operational_status view.
--   * Spare parts are intentionally out of scope for v1; add a parts table and
--     a work_order_parts join later without touching anything here.
--   * No auth in v1. RLS is enabled with permissive policies so you can tighten
--     access later by replacing the policies, not the tables.
-- =========================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- -------------------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------------------
create type entity_status_person as enum ('Active','Resigned','Dismissed','On leave');
create type entity_status_truck  as enum ('Active','Sold','Scrapped','Off-road');
create type entity_status_vendor as enum ('Active','Inactive','Blacklisted');

create type employment_type   as enum ('in_house','outsourced');
create type proficiency       as enum ('primary','backup');

create type complaint_priority as enum ('urgent','normal');
create type duration_class     as enum ('same_day','multi_day','outsourced_wait');
create type complaint_status   as enum ('open','in_progress','done','cancelled');

create type work_order_status  as enum
  ('unassigned','assigned','in_progress','paused','awaiting_parts','awaiting_outsource','done');

-- -------------------------------------------------------------------------
-- Human-readable code generation (CMP-2026-0001, WO-2026-0001, ...)
-- -------------------------------------------------------------------------
create table code_counters (
  prefix  text    not null,
  year    int     not null,
  last_no int     not null default 0,
  primary key (prefix, year)
);

create or replace function next_code(p_prefix text)
returns text language plpgsql as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into code_counters (prefix, year, last_no)
       values (p_prefix, y, 1)
  on conflict (prefix, year)
       do update set last_no = code_counters.last_no + 1
    returning last_no into n;
  return p_prefix || '-' || y::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- -------------------------------------------------------------------------
-- Master data
-- -------------------------------------------------------------------------
create table drivers (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,                 -- D-01
  name       text not null,
  phone      text,
  status     entity_status_person not null default 'Active',
  date_added date,
  date_ended date,
  note       text,
  created_at timestamptz not null default now()
);

create table mechanics (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,             -- M-01
  name            text not null,
  phone           text,
  employment_type employment_type not null default 'in_house',
  can_lift        boolean not null default false,   -- capability tag, not a specialty
  status          entity_status_person not null default 'Active',
  date_added      date,
  date_ended      date,
  note            text,
  created_at      timestamptz not null default now()
);

create table trucks (
  id             uuid primary key default gen_random_uuid(),
  plate          text unique not null,              -- BK 8359 DY  (the working handle)
  model          text,
  fleet_division text,                              -- Tangki / Gerobak / Kantor
  status         entity_status_truck not null default 'Active',  -- lifecycle, NOT repair state
  date_added     date,
  date_ended     date,
  note           text,
  created_at     timestamptz not null default now()
);

create table vendors (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,                  -- V-01
  name       text unique not null,
  contact    text,
  phone      text,
  status     entity_status_vendor not null default 'Active',
  date_added date,
  date_ended date,
  note       text,
  created_at timestamptz not null default now()
);

create table specialties (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique not null,        -- SP-01
  name                  text unique not null,        -- machine name: las, mesin, ...
  label                 text,                        -- display: "Tukang Las"
  is_outsourced_default boolean not null default false,
  created_at            timestamptz not null default now()
);

create table mechanic_specialties (
  mechanic_id  uuid not null references mechanics(id)   on delete cascade,
  specialty_id uuid not null references specialties(id) on delete cascade,
  proficiency  proficiency not null default 'primary',
  primary key (mechanic_id, specialty_id)
);
create index on mechanic_specialties (specialty_id);

-- -------------------------------------------------------------------------
-- Operational data
-- -------------------------------------------------------------------------
-- A complaint is the intake form. Reporter is flexible and never required:
-- a driver, a mechanic (inspection), or a free-text name — or none.
create table complaints (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                -- CMP-2026-0001 (auto)
  truck_id               uuid not null references trucks(id),
  reported_by_driver_id  uuid references drivers(id),
  reported_by_mechanic_id uuid references mechanics(id),
  reporter_name          text,                       -- free-text fallback
  description            text not null,
  priority               complaint_priority not null default 'normal',
  duration_class         duration_class,
  status                 complaint_status not null default 'open',
  reported_at            timestamptz not null default now(),
  closed_at              timestamptz,
  note                   text,
  created_at             timestamptz not null default now()
);
create index on complaints (truck_id);
create index on complaints (status);

-- A work order is one task under a complaint, tied to a required specialty and
-- either an in-house mechanic or an outsourced vendor.
create table work_orders (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                   -- WO-2026-0001 (auto)
  complaint_id        uuid not null references complaints(id) on delete cascade,
  required_specialty_id uuid references specialties(id),
  is_outsourced       boolean not null default false, -- overrides specialty default per WO
  assigned_mechanic_id uuid references mechanics(id),
  vendor_id           uuid references vendors(id),
  sent_date           date,                          -- outsource turnaround (optional)
  expected_back_date  date,
  returned_date       date,
  status              work_order_status not null default 'unassigned',
  description         text,
  note                text,
  created_at          timestamptz not null default now(),
  done_at             timestamptz
);
create index on work_orders (complaint_id);
create index on work_orders (assigned_mechanic_id);
create index on work_orders (vendor_id);
create index on work_orders (status);

-- One row per work session. Doubles as the time clock AND the swap/audit trail:
-- a reassignment closes the current session and opens a new one. An open row
-- (ended_at is null) means the clock is currently running.
create table time_logs (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  mechanic_id   uuid not null references mechanics(id),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);
create index on time_logs (work_order_id);
create index on time_logs (mechanic_id);
-- at most one running session per work order
create unique index one_open_log_per_wo
  on time_logs (work_order_id) where (ended_at is null);

-- -------------------------------------------------------------------------
-- Auto-generate codes on insert
-- -------------------------------------------------------------------------
create or replace function trg_complaint_code()
returns trigger language plpgsql as $$
begin
  if NEW.code is null then NEW.code := next_code('CMP'); end if;
  return NEW;
end; $$;
create trigger complaint_code before insert on complaints
  for each row execute function trg_complaint_code();

create or replace function trg_work_order_code()
returns trigger language plpgsql as $$
begin
  if NEW.code is null then NEW.code := next_code('WO'); end if;
  return NEW;
end; $$;
create trigger work_order_code before insert on work_orders
  for each row execute function trg_work_order_code();

-- -------------------------------------------------------------------------
-- Time tracking: the clock runs ONLY while a work order is in_progress.
-- Parked states (paused / awaiting_parts / awaiting_outsource) stop the clock;
-- elapsed calendar time is still visible, but it is not counted as labor.
-- -------------------------------------------------------------------------

-- BEFORE: validation + stamp done_at
create or replace function trg_wo_before_update()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'in_progress' and OLD.status <> 'in_progress'
     and NEW.assigned_mechanic_id is null then
    raise exception 'Cannot start %: no mechanic assigned', coalesce(NEW.code, NEW.id::text);
  end if;

  if NEW.status = 'done' and OLD.status <> 'done' then
    NEW.done_at := now();
  elsif NEW.status <> 'done' then
    NEW.done_at := null;
  end if;

  return NEW;
end; $$;
create trigger wo_before_update before update on work_orders
  for each row execute function trg_wo_before_update();

-- AFTER: open/close time_logs
create or replace function trg_wo_after_update()
returns trigger language plpgsql as $$
begin
  -- leaving in_progress -> close the running session
  if OLD.status = 'in_progress' and NEW.status <> 'in_progress' then
    update time_logs set ended_at = now()
      where work_order_id = NEW.id and ended_at is null;
  end if;

  -- entering in_progress -> start a session for the assigned mechanic
  if NEW.status = 'in_progress' and OLD.status <> 'in_progress' then
    update time_logs set ended_at = now()
      where work_order_id = NEW.id and ended_at is null;   -- safety
    insert into time_logs (work_order_id, mechanic_id)
      values (NEW.id, NEW.assigned_mechanic_id);
  end if;

  -- swap while still in_progress -> close old mechanic's session, open new one
  if NEW.status = 'in_progress' and OLD.status = 'in_progress'
     and NEW.assigned_mechanic_id is distinct from OLD.assigned_mechanic_id then
    update time_logs set ended_at = now()
      where work_order_id = NEW.id and ended_at is null;
    if NEW.assigned_mechanic_id is not null then
      insert into time_logs (work_order_id, mechanic_id)
        values (NEW.id, NEW.assigned_mechanic_id);
    end if;
  end if;

  return NEW;
end; $$;
create trigger wo_after_update after update on work_orders
  for each row execute function trg_wo_after_update();

-- handle a work order inserted directly as in_progress (uncommon)
create or replace function trg_wo_after_insert()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'in_progress' and NEW.assigned_mechanic_id is not null then
    insert into time_logs (work_order_id, mechanic_id)
      values (NEW.id, NEW.assigned_mechanic_id);
  end if;
  return NEW;
end; $$;
create trigger wo_after_insert after insert on work_orders
  for each row execute function trg_wo_after_insert();

-- -------------------------------------------------------------------------
-- Views (dashboards read from these)
-- -------------------------------------------------------------------------

-- Total labor time per work order = sum of session lengths; running sessions
-- count up to now(). This is LABOR time, not calendar time.
create view work_order_labor as
select w.id as work_order_id,
       w.code,
       coalesce(sum(extract(epoch from (coalesce(tl.ended_at, now()) - tl.started_at))), 0)::bigint
         as labor_seconds
from work_orders w
left join time_logs tl on tl.work_order_id = w.id
group by w.id, w.code;

-- Derived operational status per truck.
--   awaiting_outsource : has open work, and every open work order is out at a vendor
--   in_repair          : has open work being handled in-house / not all outsourced
--   operational        : no open work orders
create view truck_operational_status as
select t.id as truck_id,
       t.plate,
       case
         when exists (
           select 1 from work_orders w
             join complaints c on c.id = w.complaint_id
           where c.truck_id = t.id
             and c.status in ('open','in_progress')
             and w.status <> 'done'
         ) then
           case
             when not exists (
               select 1 from work_orders w
                 join complaints c on c.id = w.complaint_id
               where c.truck_id = t.id
                 and c.status in ('open','in_progress')
                 and w.status not in ('done','awaiting_outsource')
             ) then 'awaiting_outsource'
             else 'in_repair'
           end
         else 'operational'
       end as operational_status
from trucks t;

-- Mechanic queue board: everything currently on each mechanic's plate, split
-- into what they are ACTIVELY working vs PARKED (waiting). Feeds planning.
create view mechanic_queue as
select m.id     as mechanic_id,
       m.code   as mechanic_code,
       m.name   as mechanic_name,
       w.id     as work_order_id,
       w.code   as wo_code,
       w.status as wo_status,
       s.label  as specialty,
       t.plate,
       c.priority,
       c.duration_class,
       wl.labor_seconds,
       case when w.status = 'in_progress' then 'active' else 'parked' end as queue_bucket
from mechanics m
join work_orders w on w.assigned_mechanic_id = m.id and w.status <> 'done'
join complaints  c on c.id = w.complaint_id
join trucks      t on t.id = c.truck_id
left join specialties      s  on s.id = w.required_specialty_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Trucks currently down, with their open work orders, assignee, and labor time.
create view trucks_down as
select t.id      as truck_id,
       t.plate,
       t.fleet_division,
       c.id       as complaint_id,
       c.code     as complaint_code,
       c.priority,
       c.duration_class,
       c.reported_at,
       w.id       as work_order_id,
       w.code     as wo_code,
       w.status   as wo_status,
       w.is_outsourced,
       s.label    as specialty,
       m.name     as mechanic_name,
       v.name     as vendor_name,
       w.sent_date,
       w.expected_back_date,
       wl.labor_seconds
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done'
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress');

-- -------------------------------------------------------------------------
-- RLS — v1 is single-user and open. Replace these policies when you add auth.
-- -------------------------------------------------------------------------
do $$
declare tname text;
begin
  foreach tname in array array[
    'drivers','mechanics','trucks','vendors','specialties','mechanic_specialties',
    'complaints','work_orders','time_logs','code_counters'
  ] loop
    execute format('alter table %I enable row level security;', tname);
    execute format($p$create policy %I on %I for all using (true) with check (true);$p$,
                   tname || '_all', tname);
  end loop;
end $$;
