-- =========================================================================
-- add_generic_vendors.sql — add common one-time trades as generic outsource
-- vendors. Codes auto-generate; safe to re-run (skips ones that already exist).
-- Edit / add / retire these in Master Data > Vendors afterwards.
-- =========================================================================

insert into vendors (name, for_outsource, status) values
  ('Tukang Cabin',     true, 'Active'),
  ('Tukang Chassis',   true, 'Active'),
  ('Tukang Wayar',     true, 'Active'),
  ('Tukang Posneleng', true, 'Active'),
  ('Tukang Pom',       true, 'Active'),
  ('Tukang Dinamo',    true, 'Active')
on conflict (name) do nothing;

-- If you already ran the earlier version, remove the two place-vendors that
-- shouldn't be generic trades (only if no work order references them):
delete from vendors
where name in ('Tukang Bubut', 'Pres Karet Tingtong')
  and not exists (select 1 from work_orders w where w.vendor_id = vendors.id);
