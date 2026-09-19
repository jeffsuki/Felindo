-- =========================================================================
-- 0031_truck_stage.sql — manual operational stage per truck for the Fleet
-- Overview (set by hand, no auto-override). Run AFTER 0030. Additive.
-- =========================================================================

alter table trucks add column if not exists stage text;  -- Menuju Muat | Muat | Dalam Perjalanan | Bongkar | Gantung | Perbaikan | Rusak di Jalan
