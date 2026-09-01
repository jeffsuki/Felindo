-- =========================================================================
-- 0012_wo_code_month.sql — new work order codes as WO-yyyymm-nnnnn, 5-digit,
-- counter resets each month. Run AFTER 0001–0011. Additive.
--
-- Uses next_month_code() (from 0008). Existing WO-2026-xxxx codes are left
-- untouched; only work orders created from now on use the new format.
-- =========================================================================

create or replace function trg_work_order_code()
returns trigger language plpgsql as $$
begin
  if NEW.code is null then NEW.code := next_month_code('WO'); end if;
  return NEW;
end; $$;
