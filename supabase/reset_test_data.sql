-- =========================================================================
-- reset_test_data.sql — ONE-TIME test-data wipe before go-live.
--
-- Run this ONCE in the Supabase SQL editor when you are done testing.
-- It HARD-DELETES all transactional data (complaints, work orders, time logs)
-- and resets the complaint/work-order code counters so real data starts fresh
-- at CMP-yyyymm-00001 and WO-yyyymm-00001.
--
-- It does NOT touch master data — trucks, drivers, mechanics, vendors,
-- specialties and their mappings all remain.
--
-- This is destructive and irreversible. Make sure you actually want a clean
-- slate before running it.
-- =========================================================================

begin;

delete from time_logs;
delete from work_orders;
delete from complaints;

-- reset the monthly counters so the first real records are -00001
delete from code_counters where prefix in ('CMP', 'WO');

commit;
