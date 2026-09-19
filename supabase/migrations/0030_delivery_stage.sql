-- =========================================================================
-- 0030_delivery_stage.sql — manual operational stage for a truck's active
-- trip, shown on the Fleet Overview. Perbaikan is auto (open work order), not
-- a stored stage. Run AFTER 0029. Additive.
-- =========================================================================

alter table fleet_deliveries add column if not exists stage text;  -- Menuju Muat | Muat | Dalam Perjalanan | Bongkar | Gantung
