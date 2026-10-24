-- =========================================================================
-- 0042_workshop_hygiene.sql — workshop status plumbing moved into the DB,
-- so every screen behaves the same:
--
--   1. COMPLAINT STATUS FOLLOWS ITS WORK. The first work order that starts
--      puts its complaint on in_progress (until now only the Sorting screen's
--      Start button did this; starts from Floor / Mechanic Management didn't).
--   2. VOIDING CLOSES THE CLOCK. Voiding a work order (or a whole complaint)
--      closes any running time_logs session, so a voided job can no longer
--      accumulate "labor" forever.
--   3. DATE-LEVEL DURATIONS. trucks_down and mechanic_queue now carry
--      w.started_at and w.created_at: the boards show "masuk <date> · N hari"
--      instead of the per-second labor timers, which nobody operates (jobs
--      ran "26 days"; most are marked done without ever being started).
--
-- awaiting_parts is retired from the UI in the same batch (0 rows have it;
-- the enum value stays, harmless, since Postgres cannot drop enum values).
-- Run AFTER 0041. Additive + view replace.
-- =========================================================================

-- 1. first start bumps the complaint to in_progress
create or replace function trg_wo_bump_complaint()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'in_progress' and OLD.status is distinct from 'in_progress' then
    update complaints set status = 'in_progress'
      where id = NEW.complaint_id and status = 'open';
  end if;
  return NEW;
end; $$;
drop trigger if exists wo_bump_complaint on work_orders;
create trigger wo_bump_complaint after update on work_orders
  for each row execute function trg_wo_bump_complaint();

-- 2a. voiding a work order closes its running session
create or replace function trg_wo_void_closes_logs()
returns trigger language plpgsql as $$
begin
  if NEW.voided and not OLD.voided then
    update time_logs set ended_at = now()
      where work_order_id = NEW.id and ended_at is null;
  end if;
  return NEW;
end; $$;
drop trigger if exists wo_void_closes_logs on work_orders;
create trigger wo_void_closes_logs after update on work_orders
  for each row execute function trg_wo_void_closes_logs();

-- 2b. voiding a complaint closes every running session underneath it
create or replace function trg_complaint_void_closes_logs()
returns trigger language plpgsql as $$
begin
  if NEW.voided and not OLD.voided then
    update time_logs set ended_at = now()
      where ended_at is null
        and work_order_id in (select id from work_orders where complaint_id = NEW.id);
  end if;
  return NEW;
end; $$;
drop trigger if exists complaint_void_closes_logs on complaints;
create trigger complaint_void_closes_logs after update on complaints
  for each row execute function trg_complaint_void_closes_logs();

-- 3. boards get the dates; labor_seconds stays in the views for compatibility
create or replace view trucks_down as
select t.id as truck_id, t.plate, t.fleet_division,
       c.id as complaint_id, c.code as complaint_code, c.priority, c.duration_class, c.reported_at,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status, w.is_outsourced,
       s.label as specialty, m.name as mechanic_name, v.name as vendor_name,
       w.sent_date, w.expected_back_date, wl.labor_seconds, w.waiting_reason,
       w.description as wo_description, w.external_assignee,
       w.started_at, w.created_at as wo_created_at
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done' and w.voided = false
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress') and c.voided = false;

create or replace view mechanic_queue as
select m.id as mechanic_id, m.code as mechanic_code, m.name as mechanic_name,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status,
       s.label as specialty, t.plate, c.priority, c.duration_class, wl.labor_seconds,
       case when w.status = 'in_progress' then 'active' else 'parked' end as queue_bucket,
       w.waiting_reason, w.description as wo_description,
       w.started_at, w.created_at as wo_created_at
from mechanics m
join work_orders w on w.assigned_mechanic_id = m.id and w.status <> 'done' and w.voided = false
join complaints  c on c.id = w.complaint_id and c.voided = false
join trucks      t on t.id = c.truck_id
left join specialties      s  on s.id = w.required_specialty_id
left join work_order_labor wl on wl.work_order_id = w.id;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on trucks_down, mechanic_queue to anon, authenticated;
  end if;
end $$;
