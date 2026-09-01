-- =========================================================================
-- 0013_void.sql — a "voided" flag so a mistaken complaint or work order can be
-- hidden everywhere while the row is kept (reversible, honours never-delete).
-- Run AFTER 0001–0012. Recreates the reporting views to exclude voided rows.
-- =========================================================================

alter table complaints  add column if not exists voided boolean not null default false;
alter table work_orders add column if not exists voided boolean not null default false;

-- Shop board -------------------------------------------------------------
create or replace view trucks_down as
select t.id as truck_id, t.plate, t.fleet_division,
       c.id as complaint_id, c.code as complaint_code, c.priority, c.duration_class, c.reported_at,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status, w.is_outsourced,
       s.label as specialty, m.name as mechanic_name, v.name as vendor_name,
       w.sent_date, w.expected_back_date, wl.labor_seconds, w.waiting_reason,
       w.description as wo_description, w.external_assignee
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done' and w.voided = false
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress') and c.voided = false;

-- Mechanic queue ---------------------------------------------------------
create or replace view mechanic_queue as
select m.id as mechanic_id, m.code as mechanic_code, m.name as mechanic_name,
       w.id as work_order_id, w.code as wo_code, w.status as wo_status,
       s.label as specialty, t.plate, c.priority, c.duration_class, wl.labor_seconds,
       case when w.status = 'in_progress' then 'active' else 'parked' end as queue_bucket,
       w.waiting_reason, w.description as wo_description
from mechanics m
join work_orders w on w.assigned_mechanic_id = m.id and w.status <> 'done' and w.voided = false
join complaints  c on c.id = w.complaint_id and c.voided = false
join trucks      t on t.id = c.truck_id
left join specialties      s  on s.id = w.required_specialty_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Truck service record ---------------------------------------------------
create or replace view truck_service_record as
select t.id as truck_id, t.plate, t.fleet_division,
       c.id as complaint_id, c.code as complaint_code, c.description as complaint_description,
       c.priority, c.status as complaint_status, c.reported_at, c.closed_at,
       w.id as work_order_id, w.code as wo_code, s.label as specialty, w.is_outsourced,
       m.name as mechanic_name, v.name as vendor_name, w.status as wo_status,
       w.created_at as wo_created_at, w.done_at, coalesce(wl.labor_seconds, 0) as labor_seconds,
       w.description as wo_description
from trucks t
join complaints c            on c.truck_id = t.id and c.voided = false
left join work_orders w      on w.complaint_id = c.id and w.voided = false
left join specialties s      on s.id = w.required_specialty_id
left join mechanics m        on m.id = w.assigned_mechanic_id
left join vendors v          on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Mechanic work log ------------------------------------------------------
create or replace view mechanic_work_log as
select tl.id as session_id, tl.mechanic_id, m.code as mechanic_code, m.name as mechanic_name,
       tl.work_order_id, w.code as wo_code, c.truck_id, t.plate, s.label as specialty,
       tl.started_at, tl.ended_at, (tl.started_at at time zone 'UTC')::date as work_date,
       extract(epoch from (coalesce(tl.ended_at, now()) - tl.started_at))::bigint as session_seconds,
       (tl.ended_at is null) as running, w.description as wo_description
from time_logs tl
join mechanics m   on m.id = tl.mechanic_id
join work_orders w on w.id = tl.work_order_id and w.voided = false
join complaints c  on c.id = w.complaint_id and c.voided = false
join trucks t      on t.id = c.truck_id
left join specialties s on s.id = w.required_specialty_id;

-- Daily shop log ---------------------------------------------------------
create or replace view daily_shop_log as
  select c.reported_at::date as event_date, c.reported_at as event_at,
         'complaint_opened'::text as event_type, t.plate, c.code as ref_code, c.description as detail, null::text as actor
  from complaints c join trucks t on t.id = c.truck_id
  where c.voided = false
union all
  select w.done_at::date, w.done_at, 'work_order_done', t.plate, w.code, s.label, m.name
  from work_orders w
  join complaints c on c.id = w.complaint_id and c.voided = false
  join trucks t     on t.id = c.truck_id
  left join specialties s on s.id = w.required_specialty_id
  left join mechanics m   on m.id = w.assigned_mechanic_id
  where w.done_at is not null and w.voided = false
union all
  select w.sent_date, w.sent_date::timestamptz, 'sent_to_vendor', t.plate, w.code, s.label, v.name
  from work_orders w
  join complaints c on c.id = w.complaint_id and c.voided = false
  join trucks t     on t.id = c.truck_id
  left join specialties s on s.id = w.required_specialty_id
  left join vendors v     on v.id = w.vendor_id
  where w.sent_date is not null and w.voided = false
union all
  select c.closed_at::date, c.closed_at, 'complaint_closed', t.plate, c.code, c.description, null
  from complaints c join trucks t on t.id = c.truck_id
  where c.closed_at is not null and c.voided = false;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on trucks_down, mechanic_queue, truck_service_record, mechanic_work_log, daily_shop_log
      to anon, authenticated;
  end if;
end $$;
