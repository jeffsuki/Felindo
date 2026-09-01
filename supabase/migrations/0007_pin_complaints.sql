-- =========================================================================
-- 0007_pin_complaints.sql — a pin flag so specific complaints can float to the
-- top of the list. Run AFTER 0001–0006. Additive.
-- =========================================================================

alter table complaints add column if not exists pinned boolean not null default false;
