-- =========================================================================
-- 0021_warehouse.sql — warehouse spare-parts master. Run AFTER 0020. Additive.
-- Seed the 829 parts afterwards with seed_warehouse.sql (optional).
-- =========================================================================

create table if not exists warehouse_items (
  id             uuid primary key default gen_random_uuid(),
  sku            text unique not null,
  name           text not null,
  oem_no         text,
  system         text,
  part_type      text,
  behaviour      text,
  unit_cost      numeric,
  old_part_return text,
  scrap_category text,
  status         text not null default 'Active',   -- Active | Inactive
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists warehouse_items_system on warehouse_items (system);

do $$
begin
  execute 'alter table warehouse_items enable row level security';
  execute $p$create policy warehouse_items_all on warehouse_items for all using (true) with check (true)$p$;
exception when duplicate_object then null;
end $$;
