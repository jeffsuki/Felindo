-- =========================================================================
-- categorize_gerobak.sql — set fleet_division = 'Gerobak' for trucks that have
-- no capacity (Tangki trucks carry a MUATAN/capacity; Gerobak don't). Safe to
-- re-run. Trucks that already have a capacity keep their division.
-- =========================================================================

update trucks set fleet_division = 'Gerobak'
where capacity_kg is null and (fleet_division is distinct from 'Gerobak');
