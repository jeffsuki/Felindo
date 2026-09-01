-- =========================================================================
-- 0004_waiting_reason.sql — a single "Waiting" state carries a free-text reason
--
-- Run AFTER 0001–0003. Additive: one column, two views refreshed.
--
-- The app collapses the old parts/outsource-waiting split into one "Waiting"
-- status (stored as work_orders.status = 'paused') plus a free-text
-- waiting_reason the operator types ("nunggu part dari Medan", "di-bubut
-- Saudara Bubut", …). The reason is surfaced on the board and shop board so a
-- glance tells you why a job is parked. Resuming clears it.
-- =========================================================================

alter table work_orders add column if not exists waiting_reason text;

-- Surface the reason on the mechanic queue (board) ------------------------
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
       w.waiting_reason
from mechanics m
join work_orders w on w.assigned_mechanic_id = m.id and w.status <> 'done'
join complaints  c on c.id = w.complaint_id
join trucks      t on t.id = c.truck_id
left join specialties      s  on s.id = w.required_specialty_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- Surface the reason on the shop board ------------------------------------
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
       w.waiting_reason
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done'
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress');

-- Re-grant (views were recreated) ----------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on mechanic_queue, trucks_down to anon, authenticated;
  end if;
end $$;
