-- =========================================================================
-- 0005_wo_description.sql — surface each work order's description (what the
-- mechanic actually does) in the reporting views, so the UI can lead with it
-- instead of the WO code. Additive: four views refreshed, one new column each.
-- Run AFTER 0001–0004.
-- =========================================================================

-- Shop board -------------------------------------------------------------
create or replace view trucks_down as
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
       wl.labor_seconds,
       w.waiting_reason,
       w.description as wo_description
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done'
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress');

-- Mechanic queue / board / floor -----------------------------------------
create or replace view mechanic_queue as
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
       case when w.status = 'in_progress' then 'active' else 'parked' end as queue_bucket,
       w.waiting_reason,
       w.description as wo_description
from mechanics m
join work_orders w on w.assigned_mechanic_id = m.id and w.status <> 'done'
join complaints  c on c.id = w.complaint_id
join trucks      t on t.id = c.truck_id
left join specialties      s  on s.id = w.required_specialty_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Truck service record (history) -----------------------------------------
create or replace view truck_service_record as
select t.id            as truck_id,
       t.plate,
       t.fleet_division,
       c.id            as complaint_id,
       c.code          as complaint_code,
       c.description   as complaint_description,
       c.priority,
       c.status        as complaint_status,
       c.reported_at,
       c.closed_at,
       w.id            as work_order_id,
       w.code          as wo_code,
       s.label         as specialty,
       w.is_outsourced,
       m.name          as mechanic_name,
       v.name          as vendor_name,
       w.status        as wo_status,
       w.created_at    as wo_created_at,
       w.done_at,
       coalesce(wl.labor_seconds, 0) as labor_seconds,
       w.description   as wo_description
from trucks t
join complaints c            on c.truck_id = t.id
left join work_orders w      on w.complaint_id = c.id
left join specialties s      on s.id = w.required_specialty_id
left join mechanics m        on m.id = w.assigned_mechanic_id
left join vendors v          on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Mechanic work log / assignment trail (history) -------------------------
create or replace view mechanic_work_log as
select tl.id           as session_id,
       tl.mechanic_id,
       m.code          as mechanic_code,
       m.name          as mechanic_name,
       tl.work_order_id,
       w.code          as wo_code,
       c.truck_id,
       t.plate,
       s.label         as specialty,
       tl.started_at,
       tl.ended_at,
       (tl.started_at at time zone 'UTC')::date as work_date,
       extract(epoch from (coalesce(tl.ended_at, now()) - tl.started_at))::bigint as session_seconds,
       (tl.ended_at is null) as running,
       w.description   as wo_description
from time_logs tl
join mechanics m   on m.id = tl.mechanic_id
join work_orders w on w.id = tl.work_order_id
join complaints c  on c.id = w.complaint_id
join trucks t      on t.id = c.truck_id
left join specialties s on s.id = w.required_specialty_id;

-- Re-grant (views recreated) ---------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on trucks_down, mechanic_queue, truck_service_record, mechanic_work_log
      to anon, authenticated;
  end if;
end $$;
