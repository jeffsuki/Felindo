-- =========================================================================
-- 0038_tambahan_bantuan.sql — "Bantuan" as its own slip adjustment, with a
-- description (e.g. BANTUAN TOL). Adds to the sisa like cuci, steam and
-- jembatan/tol. Run AFTER 0037. Additive.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists tambahan_bantuan     numeric,   -- Rp, added to the sisa
  add column if not exists tambahan_bantuan_ket text;      -- what the bantuan is for

-- Bantuan is slip money: never on a contract part (see 0037).
do $$
begin
  alter table fleet_deliveries add constraint fleet_deliveries_part_no_bantuan
    check (parent_id is null or tambahan_bantuan is null);
exception when duplicate_object then null;
end $$;
