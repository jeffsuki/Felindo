-- =========================================================================
-- 0027_tembak_code.sql — TMB-yyyymm-nnnnn code for tembak releases, using the
-- same monthly counter as CMP/WO (next_month_code). release_no stays as the
-- internal id. Run AFTER 0026. Additive.
-- =========================================================================

alter table tembak_releases add column if not exists code text;

create or replace function trg_tembak_release_code()
returns trigger language plpgsql as $$
begin
  if NEW.code is null then NEW.code := next_month_code('TMB'); end if;
  return NEW;
end; $$;

drop trigger if exists tembak_release_code on tembak_releases;
create trigger tembak_release_code before insert on tembak_releases
  for each row execute function trg_tembak_release_code();
