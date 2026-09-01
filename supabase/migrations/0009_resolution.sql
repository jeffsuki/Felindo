-- =========================================================================
-- 0009_resolution.sql — a free-text resolution summary on complaints
-- ("what was actually wrong / done", e.g. "ternyata gerdang, sudah diganti").
-- Run AFTER 0001–0008. Additive.
-- =========================================================================

alter table complaints add column if not exists resolution text;
