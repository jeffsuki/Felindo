-- =========================================================================
-- 0008_complaint_code_month.sql — new complaint codes as CMP-yyyymm-nnnnn,
-- counter resets each month, 5-digit. Run AFTER 0001–0007. Additive.
--
-- Existing CMP-2026-xxxx codes are left untouched (never reuse / never break);
-- only complaints created from now on use the new month-based format.
-- =========================================================================

-- Month-based code generator: reuses code_counters, keying "year" as yyyymm.
create or replace function next_month_code(p_prefix text)
returns text language plpgsql as $$
declare
  ym int := (extract(year from now()) * 100 + extract(month from now()))::int;
  n  int;
begin
  insert into code_counters (prefix, year, last_no)
       values (p_prefix, ym, 1)
  on conflict (prefix, year)
       do update set last_no = code_counters.last_no + 1
    returning last_no into n;
  return p_prefix || '-' || ym::text || '-' || lpad(n::text, 5, '0');
end $$;

-- Point the complaint-code trigger at the month-based generator.
create or replace function trg_complaint_code()
returns trigger language plpgsql as $$
begin
  if NEW.code is null then NEW.code := next_month_code('CMP'); end if;
  return NEW;
end; $$;
