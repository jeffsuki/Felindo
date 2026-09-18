-- =========================================================================
-- 0029_contract_distance.sql — estimated one-way distance (km) per contract,
-- between origin and destination. Actual distance travelled per trip = ×2
-- (round trip). Run AFTER 0028. Additive.
-- =========================================================================

alter table fleet_contracts add column if not exists distance_km numeric;
