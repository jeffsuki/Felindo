import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import { NumInput } from '../components/NumInput'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const claimKg = d => { const tol = d.contract?.susut_tolerance; if (tol == null || d.muatan == null || d.bongkar == null) return 0; return Math.max((Number(d.muatan) - Number(d.bongkar)) - Number(tol) * Number(d.muatan), 0) }
const claimRp = d => claimKg(d) * num(d.contract?.price_per_kg)

export default function FleetHutangDriver() {
  const { name } = useParams()
  const driver = decodeURIComponent(name || '')
  const nav = useNavigate()
  const { show, node } = useToast()
  const [dels, setDels] = useState([])
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl] = await Promise.all([
      supabase.from('fleet_deliveries').select('id,tanggal,plate,muatan,bongkar,potongan_susut,potongan_ban,potongan_sparepart,contract:fleet_contracts(origin,destination,susut_tolerance,price_per_kg)').eq('driver_name', driver),
      supabase.from('fleet_driver_claims').select('*').eq('driver_name', driver).order('tanggal', { ascending: false }),
    ])
    setDels(dl.data || []); setClaims(cl.data || []); setLoading(false)
  }
  useEffect(() => { load() }, [driver])

  const acc = useMemo(() => {
    const a = { susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0 }
    for (const d of dels) {
      a.susutC += claimRp(d)
      a.susutP += num(d.potongan_susut); a.banP += num(d.potongan_ban); a.spP += num(d.potongan_sparepart)
    }
    for (const c of claims) { if (c.jenis === 'Ganti Ban') a.banC += num(c.amount); else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount) }
    a.susut = a.susutC - a.susutP; a.ban = a.banC - a.banP; a.sp = a.spC - a.spP
    a.total = a.susut + a.ban + a.sp
    return a
  }, [dels, claims])

  async function addClaim(jenis, amount, tanggal, note) {
    const { error } = await supabase.from('fleet_driver_claims').insert({ driver_name: driver, jenis, amount: num(amount), tanggal: tanggal || null, note: note || null })
    if (error) return show(error.message, true)
    show('Claim added.'); setAdding(null); load()
  }
  async function delClaim(id) { const { error } = await supabase.from('fleet_driver_claims').delete().eq('id', id); if (error) return show(error.message, true); load() }

  if (loading) return (<><div className="topbar"><div><h1>{driver}</h1></div></div><div className="content"><Spinner /></div></>)

  const PAYF = { 'Susut': 'potongan_susut', 'Ganti Ban': 'potongan_ban', 'Ganti Spare Part': 'potongan_sparepart' }
  const payments = j => dels.filter(d => num(d[PAYF[j]]) > 0)
  const susutClaims = dels.filter(d => claimRp(d) > 0)
  const manual = j => claims.filter(c => c.jenis === j)

  return (
    <>
      <div className="topbar">
        <div><h1>{driver}</h1><div className="sub">Hutang supir</div></div>
        <button className="btn ghost" onClick={() => nav('/fleet/hutang')}>← All drivers</button>
      </div>
      <div className="content hutang-pg" style={{ maxWidth: 900 }}>
        <div className="metrics">
          <div className="metric"><div className="k">Susut</div><div className="v" style={{ fontSize: 17, color: acc.susut > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.susut)}</div></div>
          <div className="metric"><div className="k">Spare Part</div><div className="v" style={{ fontSize: 17, color: acc.sp > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.sp)}</div></div>
          <div className="metric"><div className="k">Ban</div><div className="v" style={{ fontSize: 17, color: acc.ban > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.ban)}</div></div>
          <div className="metric"><div className="k">Total Hutang</div><div className="v" style={{ fontSize: 19, color: acc.total > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(acc.total)}</div></div>
        </div>

        <Section title="Susut" balance={acc.susut}>
          <div className="fd-sec">Claims</div>
          {susutClaims.length === 0 ? <div className="pool-hint">No susut claims.</div> : (
            <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Route</th><th className="r">Susut kg</th><th className="r">Rp/kg</th><th className="r">Claim</th></tr></thead>
              <tbody>{susutClaims.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{claimKg(d).toLocaleString('id-ID')}</td><td className="r mono">{rp(d.contract?.price_per_kg)}</td><td className="r mono">{rp(claimRp(d))}</td></tr>)}</tbody></table>
          )}
          <Payments rows={payments('Susut')} field="potongan_susut" />
        </Section>

        <Section title="Spare Part" balance={acc.sp}>
          <ManualClaims rows={manual('Ganti Spare Part')} onAdd={() => setAdding('Ganti Spare Part')} onDel={delClaim} />
          <Payments rows={payments('Ganti Spare Part')} field="potongan_sparepart" />
        </Section>

        <Section title="Ban" balance={acc.ban}>
          <ManualClaims rows={manual('Ganti Ban')} onAdd={() => setAdding('Ganti Ban')} onDel={delClaim} />
          <Payments rows={payments('Ganti Ban')} field="potongan_ban" />
        </Section>
      </div>
      {adding && <ClaimModal jenis={adding} driver={driver} onSave={(a, t, n) => addClaim(adding, a, t, n)} onClose={() => setAdding(null)} />}
      {node}
    </>
  )
}

function Section({ title, balance, children }) {
  return (
    <div className="hd-sec">
      <div className="hd-sec-h"><h3>{title}</h3><span style={{ fontWeight: 700, color: balance > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(balance)}</span></div>
      {children}
    </div>
  )
}
function Payments({ rows, field }) {
  return (<>
    <div className="fd-sec" style={{ marginTop: 12 }}>Payments (potongan)</div>
    {rows.length === 0 ? <div className="pool-hint">No payments.</div> : (
      <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Plate</th><th>Route</th><th className="r">Paid</th></tr></thead>
        <tbody>{rows.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td className="mono">{d.plate || '—'}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{rp(d[field])}</td></tr>)}</tbody></table>
    )}
  </>)
}
function ManualClaims({ rows, onAdd, onDel }) {
  return (<>
    <div className="fd-sec">Claims</div>
    {rows.length === 0 ? <div className="pool-hint">No claims yet.</div> : (
      <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Note</th><th className="r">Amount</th><th></th></tr></thead>
        <tbody>{rows.map(c => <tr key={c.id}><td>{fmtDate(c.tanggal)}</td><td>{c.note || '—'}</td><td className="r mono">{rp(c.amount)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete claim?')) onDel(c.id) }}>✕</button></td></tr>)}</tbody></table>
    )}
    <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={onAdd}>+ Add claim</button>
  </>)
}
function ClaimModal({ jenis, driver, onSave, onClose }) {
  const [amt, setAmt] = useState(''); const [tgl, setTgl] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState('')
  return (
    <div className="slip-scrim">
      <div className="rel-modal" style={{ width: 420 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Add {jenis} claim · {driver}</div>
        <div className="adj-grid" style={{ marginTop: 12 }}>
          <label><span>Amount</span><NumInput value={amt} onChange={setAmt} onCommit={setAmt} /></label>
          <label><span>Date</span><input type="date" value={tgl} onChange={e => setTgl(e.target.value)} /></label>
        </div>
        <label className="nsf-ket" style={{ marginTop: 8 }}><span>Note</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onSave(amt, tgl, note)}>Add</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
