-- =========================================================================
-- 0011_shopboard_external.sql — show the external/other assignee (drivers or
-- unregistered people) on the shop board. Run AFTER 0001–0010. Additive.
-- =========================================================================

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
       w.description       as wo_description,
       w.external_assignee
from complaints c
join trucks      t on t.id = c.truck_id
join work_orders w on w.complaint_id = c.id and w.status <> 'done'
left join specialties      s  on s.id = w.required_specialty_id
left join mechanics        m  on m.id = w.assigned_mechanic_id
left join vendors          v  on v.id = w.vendor_id
left join work_order_labor wl on wl.work_order_id = w.id
where c.status in ('open','in_progress');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on trucks_down to anon, authenticated;
  end if;
end $$;
