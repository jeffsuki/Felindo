-- =========================================================================
-- 0043_backlog.sql — BACKLOG for deferred findings.
--
-- Mechanics often find other broken parts mid-job. If the fix is deferred
-- (waiting for a part, truck has to keep running), the finding is filed as
-- its own complaint and flagged backlog = true:
--   * it does NOT count as "truck down": it leaves the shop board's lanes and
--     the truck's operational status, and sits in a collapsed Backlog list;
--   * the moment any of its work orders is assigned or started, the flag
--     clears automatically and the truck is back on the board.
--
-- Also fixes a gap while replacing truck_operational_status: voided
-- complaints/work orders no longer keep a truck "in repair".
-- Run AFTER 0042. Additive + view replace.
-- =========================================================================

alter table complaints add column if not exists backlog boolean not null default false;
comment on column complaints.backlog is 'Deferred finding (temuan): not being worked yet, truck not counted as down. Cleared automatically when a work order is assigned or started.';

-- assigning or starting any work order pulls its complaint out of the backlog
create or replace function trg_wo_clears_backlog()
returns trigger language plpgsql as $$
begin
  if NEW.assigned_mechanic_id is not null or NEW.status <> 'unassigned' then
    update complaints set backlog = false where id = NEW.complaint_id and backlog;
  end if;
  return NEW;
end; $$;
drop trigger if exists wo_clears_backlog_upd on work_orders;
create trigger wo_clears_backlog_upd after update on work_orders
  for each row execute function trg_wo_clears_backlog();
drop trigger if exists wo_clears_backlog_ins on work_orders;
create trigger wo_clears_backlog_ins after insert on work_orders
  for each row execute function trg_wo_clears_backlog();

-- Shop board: backlog complaints are not "down"
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
where c.status in ('open','in_progress') and c.voided = false and c.backlog = false;

-- Operational status: backlog and voided rows no longer hold a truck "in repair"
create or replace view truck_operational_status as
select t.id as truck_id,
       t.plate,
       case
         when exists (
           select 1 from work_orders w
             join complaints c on c.id = w.complaint_id
           where c.truck_id = t.id
             and c.status in ('open','in_progress')
             and c.voided = false and c.backlog = false
             and w.voided = false
             and w.status <> 'done'
         ) then
           case
             when not exists (
               select 1 from work_orders w
                 join complaints c on c.id = w.complaint_id
               where c.truck_id = t.id
                 and c.status in ('open','in_progress')
                 and c.voided = false and c.backlog = false
                 and w.voided = false
                 and w.status not in ('done','awaiting_outsource')
             ) then 'awaiting_outsource'
             else 'in_repair'
           end
         else 'operational'
       end as operational_status
from trucks t;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on trucks_down, truck_operational_status to anon, authenticated;
  end if;
end $$;
