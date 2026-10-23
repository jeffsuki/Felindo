-- =========================================================================
-- 0040_oa_tagihan_reject.sql
--
-- 1. ONGKOS ANGKUT per contract — the freight rate is set per contract (it changes
--    over time), with what it is billed on:
--      • oa_per_kg      Rp per kg
--      • billing_basis  'bongkar' (netto at the mill, e.g. UMW "TERANGKUT") or 'muatan' (as loaded)
--    The contract's tagihan = billed kg × oa_per_kg over its deliveries.
--
-- 2. REJECT — a load the buyer refused and that went back to the origin.
--    It stays on the same daftar kontrol (keeps its DO number), but:
--      • it does not count as delivered: left out of the contract's muatan /
--        bongkar / susut / outstanding (the DO still needs that tonnage);
--      • it is billed out and back: muatan × (oa_per_kg + reject_oa_per_kg),
--        where the return-leg rate depends on the client and is typed per reject.
--
-- Run AFTER 0039. Additive.
-- =========================================================================

alter table fleet_contracts
  add column if not exists oa_per_kg     numeric,
  add column if not exists billing_basis text not null default 'bongkar';
alter table fleet_contracts drop constraint if exists fleet_contracts_billing_basis_check;
alter table fleet_contracts add constraint fleet_contracts_billing_basis_check check (billing_basis in ('bongkar', 'muatan'));
comment on column fleet_contracts.oa_per_kg is 'Ongkos angkut (Rp/kg) billed to the client for this contract.';
comment on column fleet_contracts.billing_basis is 'What the ongkos angkut is billed on: bongkar (netto at destination) or muatan (as loaded).';

alter table fleet_deliveries
  add column if not exists is_reject        boolean not null default false,
  add column if not exists reject_oa_per_kg numeric;
comment on column fleet_deliveries.is_reject is 'Reject: the buyer refused the load and it went back. Not a delivery for the contract totals; billed out and back.';
comment on column fleet_deliveries.reject_oa_per_kg is 'Reject: rate (Rp/kg) for the return leg, on top of the contract''s ongkos angkut. Depends on the client.';

-- Totals per contract: rejects out of the delivered figures; tagihan (Rp) added at the end.
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
                         else 0 end) filter (where not d.is_reject), 0) as total_claim,
       count(d.id) filter (where d.is_reject)                                       as rejects,
       case when c.oa_per_kg is null then null else
         coalesce(sum(case when d.is_reject then coalesce(d.muatan, 0) * (c.oa_per_kg + coalesce(d.reject_oa_per_kg, 0))
                           when c.billing_basis = 'muatan' then coalesce(d.muatan, 0) * c.oa_per_kg
                           else coalesce(d.bongkar, 0) * c.oa_per_kg end), 0) end as tagihan
from fleet_contracts c
left join fleet_deliveries d on d.contract_id = c.id and not d.is_retur
group by c.id, c.quantity_kg, c.susut_tolerance, c.oa_per_kg, c.billing_basis;
