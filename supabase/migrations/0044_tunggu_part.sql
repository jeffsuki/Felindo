-- =========================================================================
-- 0044_tunggu_part.sql — WAITING gets dates, so "nunggu part" is trackable.
--
-- A paused job now carries:
--   * waiting_since    — stamped automatically the moment a job is paused
--   * waiting_expected — optional "kira-kira kembali/beres" date typed by staff
-- The boards show "waiting: <reason> · s/d <date>" and flag it red once the
-- date has passed, so a part that never came back stops hiding.
--
-- Resuming or finishing a job clears all three waiting fields automatically
-- (until now Start left the old reason behind; Floor's Resume cleared only
-- the reason). One BEFORE trigger keeps every screen consistent.
-- Run AFTER 0043. Additive + view replace.
-- =========================================================================

alter table work_orders add column if not exists waiting_since    date;
alter table work_orders add column if not exists waiting_expected date;
comment on column work_orders.waiting_since    is 'Auto-stamped when the job is paused (status -> paused).';
comment on column work_orders.waiting_expected is 'Optional: when the part/outside work is expected back. Overdue once past.';

create or replace function trg_wo_waiting_fields()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'paused' and OLD.status is distinct from 'paused' then
    NEW.waiting_since := coalesce(NEW.waiting_since, current_date);
  elsif OLD.status = 'paused' and NEW.status in ('in_progress', 'done') then
    NEW.waiting_reason := null;
    NEW.waiting_since := null;
    NEW.waiting_expected := null;
  end if;
  return NEW;
end; $$;
drop trigger if exists wo_waiting_fields on work_orders;
create trigger wo_waiting_fields before update on work_orders
  for each row execute function trg_wo_waiting_fields();

-- views: carry the waiting dates. Dropped and recreated (not CREATE OR REPLACE)
-- because the new columns sit mid-view; nothing depends on these views.
drop view if exists trucks_down;
create view trucks_down as
select t.id as truck_id, t.plate, t.fleet_division,
       c.id as complaint_id, c.code as complaint_code, c.priority, c.duration_class, c.reported_at,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status, w.is_outsourced,
       s.label as specialty, m.name as mechanic_name, v.name as vendor_name,
       w.sent_date, w.expected_back_date, wl.labor_seconds, w.waiting_reason,
       w.waiting_since, w.waiting_expected,
       w.description as wo_description, w.external_assignee,
       w.started_at, w.created_at as wo_created_at
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done' and w.voided = false
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress') and c.voided = false and c.backlog = false;

drop view if exists mechanic_queue;
create view mechanic_queue as
select m.id as mechanic_id, m.code as mechanic_code, m.name as mechanic_name,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status,
       s.label as specialty, t.plate, c.priority, c.duration_class, wl.labor_seconds,
       case when w.status = 'in_progress' then 'active' else 'parked' end as queue_bucket,
       w.waiting_reason, w.waiting_since, w.waiting_expected,
       w.description as wo_description,
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
