-- =========================================================================
-- 0045_oper_tambahan_waive.sql — three borongan cases:
--
-- 1. OPER MUATAN. A truck breaks down and the load moves to another truck:
--    no SPB, no uang tembak for the rescue leg, the rincian stays ONE row
--    (one contract, one tagihan). The oper_* fields record the second truck,
--    its driver, the date and the sisa uang jalan handed over (counted cash,
--    moves no money from kas). On oper, ALL potongan on the row are removed
--    (done by the app), and the row's susut claim is no longer charged to a
--    driver (excluded from claims below).
--
-- 2. TAMBAHAN UANG JALAN. Extra cash mid-trip: its own dated entry in
--    fleet_extras, attached to a rincian (contract attribution follows).
--    The kas/daily reports book it on ITS date, not the slip date.
--    beban: 'perusahaan' (company cost) or 'supir' (deducted later — shows
--    up in the driver's kasbon).
--
-- 3. WAIVE SUSUT. Susut caused by the client: claim to the client is 0 and
--    the driver's potongan susut is 0, while the kg susut stays recorded.
--    susut_waived + reason; the app zeroes potongan_susut when waiving.
--
-- Run AFTER 0044. Additive + view replace (same column list).
-- =========================================================================

-- 1. oper muatan
alter table fleet_deliveries add column if not exists oper_truck_id uuid references trucks(id);
alter table fleet_deliveries add column if not exists oper_plate text;
alter table fleet_deliveries add column if not exists oper_driver_name text;
alter table fleet_deliveries add column if not exists oper_date date;
alter table fleet_deliveries add column if not exists oper_amount numeric;
comment on column fleet_deliveries.oper_amount is 'Sisa uang jalan dioper ke truk pengganti (counted cash handover, not a kas movement).';

-- 3. waive susut
alter table fleet_deliveries add column if not exists susut_waived boolean not null default false;
alter table fleet_deliveries add column if not exists susut_waived_reason text;
comment on column fleet_deliveries.susut_waived is 'Susut ditanggung klien: claim ke klien 0 dan potongan supir 0; kg susut tetap tercatat.';

-- 2. tambahan uang jalan
create table if not exists fleet_extras (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references fleet_deliveries(id) on delete cascade,
  tanggal      date not null,
  amount       numeric not null,
  keterangan   text,
  beban        text not null default 'perusahaan' check (beban in ('perusahaan', 'supir')),
  driver_name  text,          -- who received the money (defaults to the trip's driver / oper driver)
  created_at   timestamptz not null default now()
);
create index if not exists fleet_extras_delivery on fleet_extras (delivery_id);
create index if not exists fleet_extras_tanggal  on fleet_extras (tanggal);
comment on table fleet_extras is 'Tambahan uang jalan: dated extra cash on a rincian. Kas reports book it on tanggal; beban supir counts into the driver''s kasbon.';

do $$
begin
  execute 'alter table fleet_extras enable row level security';
  if not exists (select 1 from pg_policies where tablename = 'fleet_extras') then
    execute $p$create policy fleet_extras_all on fleet_extras for all using (true) with check (true)$p$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant all on fleet_extras to anon, authenticated;
  end if;
end $$;

-- total_claim: waived rows and oper'd rows are not charged to anyone
create or replace view fleet_contract_totals as
select c.id as contract_id,
       count(d.id) filter (where not d.is_reject)                                  as deliveries,
       coalesce(sum(d.estimasi_muat) filter (where not d.is_reject), 0)             as total_estimasi,
       coalesce(sum(d.muatan) filter (where not d.is_reject), 0)                    as total_muatan,
       coalesce(sum(d.bongkar) filter (where not d.is_reject), 0)                   as total_bongkar,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null
                         then d.muatan - d.bongkar else 0 end) filter (where not d.is_reject), 0) as total_susut,
       greatest(coalesce(c.quantity_kg, 0)
                - coalesce(sum(coalesce(d.muatan, d.estimasi_muat, 0)) filter (where not d.is_reject), 0), 0) as outstanding,
       count(d.id) filter (
         where not d.is_reject and (d.muatan is null or d.bongkar is null
            or d.tanggal_muat is null or d.tanggal_bongkar is null)
       ) as incomplete_deliveries,
       coalesce(sum(case when d.muatan is not null and d.bongkar is not null and c.susut_tolerance is not null
                         then greatest((d.muatan - d.bongkar) - c.susut_tolerance * d.muatan, 0)
                         else 0 end) filter (where not d.is_reject
                                               and not d.susut_waived
                                               and d.oper_truck_id is null), 0) as total_claim,
       count(d.id) filter (where d.is_reject)                                       as rejects,
       case when c.oa_per_kg is null
             and not exists (select 1 from contract_rates r where r.contract_id = c.id)
            then null else
         coalesce(sum(case when d.is_reject then coalesce(d.muatan, 0) * (coalesce(rt.oa, 0) + coalesce(d.reject_oa_per_kg, 0))
                           when c.billing_basis = 'muatan' then coalesce(d.muatan, 0) * coalesce(rt.oa, 0)
                           else coalesce(d.bongkar, 0) * coalesce(rt.oa, 0) end), 0) end as tagihan
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id and not d.is_retur
left join lateral (
  select coalesce(
           (select r.oa_per_kg from contract_rates r
             where r.contract_id = c.id
               and r.effective_from <= coalesce(d.tanggal_muat, d.tanggal_bongkar, d.tanggal)
             order by r.effective_from desc limit 1),
           c.oa_per_kg) as oa
) rt on true
group by c.id, c.quantity_kg, c.susut_tolerance, c.oa_per_kg, c.billing_basis;
