-- =========================================================================
-- 0036_driver_loans.sql — driver loans (Pinjaman):
--   • Kasbon (cash, Rp): loaned to driver, repaid via slip Pot Kasbon OR cash.
--   • BBM (liters): fuel taken from company, repaid only via slip, priced at
--     the slip's Price/L, deducted over several slips.
-- Slip fields: potongan_kasbon (Rp), bbm_loan_liter (L).
-- fleet_driver_loans      = loans given (Cash amount Rp / BBM liter).
-- fleet_driver_loan_repayments = manual cash repayments (Cash only).
-- Balances: Kasbon Rp = Cash loans − slip potongan_kasbon − cash repayments.
--           BBM L      = BBM liters given − slip bbm_loan_liter.
-- Run AFTER 0035. Additive.
-- =========================================================================

alter table fleet_deliveries
  add column if not exists potongan_kasbon numeric,   -- Rp, cash loan repaid on this slip
  add column if not exists bbm_loan_liter  numeric;   -- liters, BBM loan repaid on this slip (× price_per_liter)

create table if not exists fleet_driver_loans (
  id          uuid primary key default gen_random_uuid(),
  driver_name text not null,
  jenis       text not null,           -- 'Cash' | 'BBM'
  amount      numeric,                 -- Rp (Cash loans)
  liter       numeric,                 -- liters (BBM loans)
  tanggal     date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists fleet_driver_loans_driver on fleet_driver_loans (driver_name);

create table if not exists fleet_driver_loan_repayments (
  id          uuid primary key default gen_random_uuid(),
  driver_name text not null,
  amount      numeric not null,        -- Rp cash repayment (Kasbon only)
  tanggal     date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists fleet_driver_loan_repay_driver on fleet_driver_loan_repayments (driver_name);

do $$
begin
  execute 'alter table fleet_driver_loans enable row level security';
  execute $p$create policy fleet_driver_loans_all on fleet_driver_loans for all using (true) with check (true)$p$;
exception when duplicate_object then null; end $$;
do $$
begin
  execute 'alter table fleet_driver_loan_repayments enable row level security';
  execute $p$create policy fleet_driver_loan_repay_all on fleet_driver_loan_repayments for all using (true) with check (true)$p$;
exception when duplicate_object then null; end $$;
