-- =========================================================================
-- 0010_external_assignee.sql — allow assigning a work order to an unregistered
-- mechanic (free-text name) who isn't in the master list. Run AFTER 0001–0009.
--
-- An external assignee has no time-tracking (that needs a registered mechanic),
-- so the triggers are relaxed: a job with an external name may go In process
-- without tripping the "no mechanic" guard, and no time log is opened for it.
-- =========================================================================

alter table work_orders add column if not exists external_assignee text;

-- Relax the start guard: allow In process if either a registered mechanic OR an
-- external assignee is set. Also keeps the start/done stamping from 0006.
create or replace function trg_wo_before_update()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'in_progress' and OLD.status <> 'in_progress'
     and NEW.assigned_mechanic_id is null
     and (NEW.external_assignee is null or NEW.external_assignee = '') then
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

-- Only open a time log when there's a registered mechanic (external has none).
create or replace function trg_wo_after_update()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'in_progress' and NEW.status <> 'in_progress' then
    update time_logs set ended_at = now() where work_order_id = NEW.id and ended_at is null;
  end if;

  if NEW.status = 'in_progress' and OLD.status <> 'in_progress' then
    update time_logs set ended_at = now() where work_order_id = NEW.id and ended_at is null;
    if NEW.assigned_mechanic_id is not null then
      insert into time_logs (work_order_id, mechanic_id) values (NEW.id, NEW.assigned_mechanic_id);
    end if;
  end if;

  if NEW.status = 'in_progress' and OLD.status = 'in_progress'
     and NEW.assigned_mechanic_id is distinct from OLD.assigned_mechanic_id then
    update time_logs set ended_at = now() where work_order_id = NEW.id and ended_at is null;
    if NEW.assigned_mechanic_id is not null then
      insert into time_logs (work_order_id, mechanic_id) values (NEW.id, NEW.assigned_mechanic_id);
    end if;
  end if;

  return NEW;
end; $$;
