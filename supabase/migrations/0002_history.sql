-- =========================================================================
-- 0002_history.sql — read-only history views + a mechanic notes column
--
-- Purely additive. No existing table or view changes. Everything here reads
-- from data already captured (complaints, work_orders, time_logs) — history
-- was always in the data; these views just read it back three ways.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Truck service record — one row per work order (all statuses), for grouping
-- by complaint in the UI. A truck's full medical chart.
-- -------------------------------------------------------------------------
create view truck_service_record as
select
  t.id            as truck_id,
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
  coalesce(wl.labor_seconds, 0) as labor_seconds
from trucks t
join complaints c            on c.truck_id = t.id
left join work_orders w      on w.complaint_id = c.id
left join specialties s      on s.id = w.required_specialty_id
left join mechanics m        on m.id = w.assigned_mechanic_id
left join vendors v          on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id;

-- -------------------------------------------------------------------------
-- Mechanic work log — one row per work session (from time_logs). The
-- payroll / productivity lens; group by work_date in the UI for a daily view.
-- session_seconds counts an open session up to now().
-- -------------------------------------------------------------------------
create view mechanic_work_log as
select
  tl.id           as session_id,
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
  (tl.ended_at is null) as running
from time_logs tl
join mechanics m   on m.id = tl.mechanic_id
join work_orders w on w.id = tl.work_order_id
join complaints c  on c.id = w.complaint_id
join trucks t      on t.id = c.truck_id
left join specialties s on s.id = w.required_specialty_id;

-- -------------------------------------------------------------------------
-- Daily shop log — a per-day activity feed across all trucks: complaints
-- opened, work orders completed, work sent to a vendor, complaints closed.
-- -------------------------------------------------------------------------
create view daily_shop_log as
  select c.reported_at::date as event_date, c.reported_at as event_at,
         'complaint_opened'::text as event_type,
         t.plate, c.code as ref_code, c.description as detail, null::text as actor
  from complaints c join trucks t on t.id = c.truck_id
union all
  select w.done_at::date, w.done_at, 'work_order_done',
         t.plate, w.code, s.label, m.name
  from work_orders w
  join complaints c on c.id = w.complaint_id
  join trucks t     on t.id = c.truck_id
  left join specialties s on s.id = w.required_specialty_id
  left join mechanics m   on m.id = w.assigned_mechanic_id
  where w.done_at is not null
union all
  select w.sent_date, w.sent_date::timestamptz, 'sent_to_vendor',
         t.plate, w.code, s.label, v.name
  from work_orders w
  join complaints c on c.id = w.complaint_id
  join trucks t     on t.id = c.truck_id
  left join specialties s on s.id = w.required_specialty_id
  left join vendors v     on v.id = w.vendor_id
  where w.sent_date is not null
union all
  select c.closed_at::date, c.closed_at, 'complaint_closed',
         t.plate, c.code, c.description, null
  from complaints c join trucks t on t.id = c.truck_id
  where c.closed_at is not null;

-- -------------------------------------------------------------------------
-- Grants — Supabase exposes public views to the API roles, but a view created
-- after setup needs an explicit grant. Guarded so it's a no-op on a plain
-- Postgres (where these roles don't exist).
-- -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on truck_service_record, mechanic_work_log, daily_shop_log
      to anon, authenticated;
    -- backfill grants for the v1 views too, in case they were missed
    grant select on trucks_down, mechanic_queue, truck_operational_status, work_order_labor
      to anon, authenticated;
  end if;
end $$;
