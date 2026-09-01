-- =========================================================================
-- 0006_started_and_helper.sql — editable start time + a "helped by" note on
-- work orders. Run AFTER 0001–0005. Additive.
--
--   * work_orders.started_at  — when the job actually started. Auto-stamped the
--     first time it goes In process, but editable by hand afterwards.
--   * work_orders.helper_note — free text, e.g. "driver opened the tires".
--
-- (complaints.reported_at and complaints.closed_at already exist and are now
--  editable from the Complaints screen; work_orders.done_at already exists.)
-- =========================================================================

alter table work_orders add column if not exists started_at timestamptz;
alter table work_orders add column if not exists helper_note text;

-- Backfill started_at from the earliest work session, where we have one.
update work_orders w
set started_at = sub.first_start
from (select work_order_id, min(started_at) as first_start from time_logs group by work_order_id) sub
where sub.work_order_id = w.id and w.started_at is null;

-- Auto-stamp started_at on the first transition into In process (editable after).
create or replace function trg_wo_before_update()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'in_progress' and OLD.status <> 'in_progress'
     and NEW.assigned_mechanic_id is null then
    raise exception 'Cannot start %: no mechanic assigned', coalesce(NEW.code, NEW.id::text);
  end if;

  if NEW.status = 'in_progress' and OLD.status <> 'in_progress' and NEW.started_at is null then
    NEW.started_at := now();
  end if;

  if NEW.status = 'done' and OLD.status <> 'done' then
    NEW.done_at := now();
  elsif NEW.status <> 'done' then
    NEW.done_at := null;
  end if;

  return NEW;
end; $$;
