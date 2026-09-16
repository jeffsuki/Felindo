-- =========================================================================
-- 0014_by_driver.sql — a simple "done by driver" flag on work orders.
-- A note that a driver (not a mechanic, not a specific named person) did the
-- job. Run AFTER 0001-0013. Additive.
-- =========================================================================

alter table work_orders add column if not exists by_driver boolean not null default false;
