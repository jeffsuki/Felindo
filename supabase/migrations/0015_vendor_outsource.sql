-- =========================================================================
-- 0015_vendor_outsource.sql — mark which vendors are for outsourcing repair
-- work (bubut, dinamo, etc.) vs parts/other suppliers. Only outsource vendors
-- appear in the "send to vendor" pickers. Run AFTER 0001-0014. Additive.
--
-- Defaults to true so existing vendors keep showing in the outsource pickers;
-- untick the parts-only ones in Master Data.
-- =========================================================================

alter table vendors add column if not exists for_outsource boolean not null default true;
