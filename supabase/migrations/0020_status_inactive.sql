-- =========================================================================
-- 0020_status_inactive.sql — add 'Inactive' to the person and truck status
-- enums so trucks, drivers, and mechanics support a simple Active/Inactive
-- toggle (vendors already have 'Inactive'). Run AFTER 0019. Additive.
-- =========================================================================

alter type entity_status_person add value if not exists 'Inactive';
alter type entity_status_truck  add value if not exists 'Inactive';
