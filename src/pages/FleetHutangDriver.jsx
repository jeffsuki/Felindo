import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, useToast } from '../components/ui'
import { NumInput } from '../components/NumInput'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const L = n => Number(n || 0).toLocaleString('id-ID') + ' L'
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
  const [loans, setLoans] = useState([])
  const [repays, setRepays] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(null)      // claim: {jenis}
  const [loanAdd, setLoanAdd] = useState(null)    // loan: {jenis:'Cash'|'BBM'}
  const [repayAdd, setRepayAdd] = useState(false)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl, ln, rpm] = await Promise.all([
      supabase.from('fleet_deliveries').select('id,tanggal,plate,muatan,bongkar,potongan_susut,potongan_ban,potongan_sparepart,potongan_kasbon,bbm_liter,price_per_liter,contract:fleet_contracts(origin,destination,susut_tolerance,price_per_kg)').eq('driver_name', driver),
      supabase.from('fleet_driver_claims').select('*').eq('driver_name', driver).order('tanggal', { ascending: false }),
      supabase.from('fleet_driver_loans').select('*').eq('driver_name', driver).order('tanggal', { ascending: false }),
      supabase.from('fleet_driver_loan_repayments').select('*').eq('driver_name', driver).order('tanggal', { ascending: false }),
    ])
    setDels(dl.data || []); setClaims(cl.data || []); setLoans(ln.data || []); setRepays(rpm.data || []); setLoading(false)
  }
  useEffect(() => { load() }, [driver])

  const acc = useMemo(() => {
    const a = { susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0, kasbonC: 0, kasbonP: 0, bbmC: 0, bbmP: 0 }
    for (const d of dels) {
      a.susutC += claimRp(d); a.susutP += num(d.potongan_susut); a.banP += num(d.potongan_ban); a.spP += num(d.potongan_sparepart)
      a.kasbonP += num(d.potongan_kasbon)
    }
    for (const c of claims) { if (c.jenis === 'Ganti Ban') a.banC += num(c.amount); else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount) }
    for (const l of loans) { if (l.jenis === 'Cash') a.kasbonC += num(l.amount); else if (l.jenis === 'BBM') a.bbmC += num(l.liter) }
    for (const r of repays) a.kasbonP += num(r.amount)
    // date-aware BBM outstanding: chronological running balance, floored at 0
    const ev = []
    loans.forEach(l => { if (l.jenis === 'BBM') ev.push([l.tanggal || '', num(l.liter)]) })
    dels.forEach(d => { if (num(d.bbm_liter) > 0) ev.push([d.tanggal || '', -num(d.bbm_liter)]) })
    ev.sort((x, y) => x[0].localeCompare(y[0]))
    let bbal = 0; for (const [, amt] of ev) { bbal += amt; if (bbal < 0) bbal = 0 }
    a.susut = a.susutC - a.susutP; a.ban = a.banC - a.banP; a.sp = a.spC - a.spP; a.kasbon = a.kasbonC - a.kasbonP; a.bbm = bbal
    a.total = a.susut + a.ban + a.sp + a.kasbon
    return a
  }, [dels, claims, loans, repays])

  async function addClaim(jenis, amount, tanggal, note) {
    const { error } = await supabase.from('fleet_driver_claims').insert({ driver_name: driver, jenis, amount: num(amount), tanggal: tanggal || null, note: note || null })
    if (error) return show(error.message, true); show('Claim added.'); setAdding(null); load()
  }
  async function addLoan(jenis, amount, liter, tanggal, note) {
    const row = { driver_name: driver, jenis, tanggal: tanggal || null, note: note || null }
    if (jenis === 'Cash') row.amount = num(amount); else row.liter = num(liter)
    const { error } = await supabase.from('fleet_driver_loans').insert(row)
    if (error) return show(error.message, true); show('Loan recorded.'); setLoanAdd(null); load()
  }
  async function addRepay(amount, tanggal, note) {
    const { error } = await supabase.from('fleet_driver_loan_repayments').insert({ driver_name: driver, amount: num(amount), tanggal: tanggal || null, note: note || null })
    if (error) return show(error.message, true); show('Repayment recorded.'); setRepayAdd(false); load()
  }
  async function delRow(table, id) { const { error } = await supabase.from(table).delete().eq('id', id); if (error) return show(error.message, true); load() }

  if (loading) return (<><div className="topbar"><div><h1>{driver}</h1></div></div><div className="content"><Spinner /></div></>)

  const susutClaims = dels.filter(d => claimRp(d) > 0)
  const manual = j => claims.filter(c => c.jenis === j)
  const pay = f => dels.filter(d => num(d[f]) > 0)
  const cashLoans = loans.filter(l => l.jenis === 'Cash')
  const bbmLoans = loans.filter(l => l.jenis === 'BBM')

  return (
    <>
      <div className="topbar">
        <div><h1>{driver}</h1><div className="sub">Hutang supir</div></div>
        <button className="btn ghost" onClick={() => nav('/fleet/hutang')}>← All drivers</button>
      </div>
      <div className="content hutang-pg" style={{ maxWidth: 900 }}>
        <div className="metrics">
          <div className="metric"><div className="k">Susut</div><div className="v" style={{ fontSize: 16, color: acc.susut > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.susut)}</div></div>
          <div className="metric"><div className="k">Spare Part</div><div className="v" style={{ fontSize: 16, color: acc.sp > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.sp)}</div></div>
          <div className="metric"><div className="k">Ban</div><div className="v" style={{ fontSize: 16, color: acc.ban > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.ban)}</div></div>
          <div className="metric"><div className="k">Kasbon</div><div className="v" style={{ fontSize: 16, color: acc.kasbon > 0 ? 'var(--urgent)' : undefined }}>{rp(acc.kasbon)}</div></div>
          <div className="metric"><div className="k">Total Hutang</div><div className="v" style={{ fontSize: 18, color: acc.total > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(acc.total)}</div></div>
          <div className="metric"><div className="k">BBM Pinjaman</div><div className="v" style={{ fontSize: 16, color: acc.bbm > 0 ? 'var(--urgent)' : undefined }}>{L(acc.bbm)}</div></div>
        </div>

        <Section title="Susut" balance={rp(acc.susut)} pos={acc.susut > 0}>
          <div className="fd-sec">Claims</div>
          {susutClaims.length === 0 ? <div className="pool-hint">No susut claims.</div> : (
            <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Route</th><th className="r">Susut kg</th><th className="r">Rp/kg</th><th className="r">Claim</th></tr></thead>
              <tbody>{susutClaims.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{claimKg(d).toLocaleString('id-ID')}</td><td className="r mono">{rp(d.contract?.price_per_kg)}</td><td className="r mono">{rp(claimRp(d))}</td></tr>)}</tbody></table>
          )}
          <Pay rows={pay('potongan_susut')} field="potongan_susut" />
        </Section>

        <Section title="Spare Part" balance={rp(acc.sp)} pos={acc.sp > 0}>
          <Manual rows={manual('Ganti Spare Part')} onAdd={() => setAdding('Ganti Spare Part')} onDel={id => delRow('fleet_driver_claims', id)} />
          <Pay rows={pay('potongan_sparepart')} field="potongan_sparepart" />
        </Section>

        <Section title="Ban" balance={rp(acc.ban)} pos={acc.ban > 0}>
          <Manual rows={manual('Ganti Ban')} onAdd={() => setAdding('Ganti Ban')} onDel={id => delRow('fleet_driver_claims', id)} />
          <Pay rows={pay('potongan_ban')} field="potongan_ban" />
        </Section>

        <Section title="Kasbon (Cash)" balance={rp(acc.kasbon)} pos={acc.kasbon > 0}>
          <div className="fd-sec">Dipinjam</div>
          {cashLoans.length === 0 ? <div className="pool-hint">No loans.</div> : (
            <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Note</th><th className="r">Amount</th><th></th></tr></thead>
              <tbody>{cashLoans.map(l => <tr key={l.id}><td>{fmtDate(l.tanggal)}</td><td>{l.note || '—'}</td><td className="r mono">{rp(l.amount)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete loan?')) delRow('fleet_driver_loans', l.id) }}>✕</button></td></tr>)}</tbody></table>
          )}
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLoanAdd({ jenis: 'Cash' })}>+ Add loan</button>
          <div className="fd-sec" style={{ marginTop: 12 }}>Dibayar</div>
          <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Via</th><th className="r">Amount</th><th></th></tr></thead>
            <tbody>
              {pay('potongan_kasbon').map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td>Slip {d.plate || ''}</td><td className="r mono">{rp(d.potongan_kasbon)}</td><td></td></tr>)}
              {repays.map(r => <tr key={r.id}><td>{fmtDate(r.tanggal)}</td><td>Cash{r.note ? ` · ${r.note}` : ''}</td><td className="r mono">{rp(r.amount)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete repayment?')) delRow('fleet_driver_loan_repayments', r.id) }}>✕</button></td></tr>)}
              {pay('potongan_kasbon').length === 0 && repays.length === 0 && <tr><td colSpan={4} className="pool-hint">No repayments.</td></tr>}
            </tbody></table>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setRepayAdd(true)}>+ Cash repayment</button>
        </Section>

        <Section title="BBM Pinjaman" balance={L(acc.bbm)} pos={acc.bbm > 0}>
          <div className="fd-sec">Diambil (liter)</div>
          {bbmLoans.length === 0 ? <div className="pool-hint">No BBM loans.</div> : (
            <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Note</th><th className="r">Liter</th><th></th></tr></thead>
              <tbody>{bbmLoans.map(l => <tr key={l.id}><td>{fmtDate(l.tanggal)}</td><td>{l.note || '—'}</td><td className="r mono">{L(l.liter)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete BBM loan?')) delRow('fleet_driver_loans', l.id) }}>✕</button></td></tr>)}</tbody></table>
          )}
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLoanAdd({ jenis: 'BBM' })}>+ Add BBM loan</button>
          <div className="fd-sec" style={{ marginTop: 12 }}>BBM digunakan (menyicil, liter)</div>
          {pay('bbm_liter').length === 0 ? <div className="pool-hint">No BBM usage.</div> : (
            <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Plate</th><th className="r">Liter</th><th className="r">@ Price/L</th></tr></thead>
              <tbody>{pay('bbm_liter').map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td className="mono">{d.plate || '—'}</td><td className="r mono">{L(d.bbm_liter)}</td><td className="r mono">{rp(d.price_per_liter)}</td></tr>)}</tbody></table>
          )}
        </Section>
      </div>
      {adding && <ClaimModal title={`Add ${adding} claim`} driver={driver} unit="rp" onSave={(a, t, n) => addClaim(adding, a, t, n)} onClose={() => setAdding(null)} />}
      {loanAdd && <ClaimModal title={`Add ${loanAdd.jenis === 'BBM' ? 'BBM loan (liter)' : 'cash loan'}`} driver={driver} unit={loanAdd.jenis === 'BBM' ? 'liter' : 'rp'} onSave={(a, t, n) => addLoan(loanAdd.jenis, loanAdd.jenis === 'Cash' ? a : null, loanAdd.jenis === 'BBM' ? a : null, t, n)} onClose={() => setLoanAdd(null)} />}
      {repayAdd && <ClaimModal title="Cash repayment" driver={driver} unit="rp" onSave={(a, t, n) => addRepay(a, t, n)} onClose={() => setRepayAdd(false)} />}
      {node}
    </>
  )
}

function Section({ title, balance, pos, children }) {
  return (
    <div className="hd-sec">
      <div className="hd-sec-h"><h3>{title}</h3><span style={{ fontWeight: 700, color: pos ? 'var(--urgent)' : 'var(--ok)' }}>{balance}</span></div>
      {children}
    </div>
  )
}
function Pay({ rows, field }) {
  return (<>
    <div className="fd-sec" style={{ marginTop: 12 }}>Payments (potongan)</div>
    {rows.length === 0 ? <div className="pool-hint">No payments.</div> : (
      <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Plate</th><th>Route</th><th className="r">Paid</th></tr></thead>
        <tbody>{rows.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td className="mono">{d.plate || '—'}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{rp(d[field])}</td></tr>)}</tbody></table>
    )}
  </>)
}
function Manual({ rows, onAdd, onDel }) {
  return (<>
    <div className="fd-sec">Claims</div>
    {rows.length === 0 ? <div className="pool-hint">No claims yet.</div> : (
      <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Note</th><th className="r">Amount</th><th></th></tr></thead>
        <tbody>{rows.map(c => <tr key={c.id}><td>{fmtDate(c.tanggal)}</td><td>{c.note || '—'}</td><td className="r mono">{rp(c.amount)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete claim?')) onDel(c.id) }}>✕</button></td></tr>)}</tbody></table>
    )}
    <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={onAdd}>+ Add claim</button>
  </>)
}
function ClaimModal({ title, driver, unit, onSave, onClose }) {
  const [amt, setAmt] = useState(''); const [tgl, setTgl] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState('')
  return (
    <div className="slip-scrim">
      <div className="rel-modal" style={{ width: 420 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>{title} · {driver}</div>
        <div className="adj-grid" style={{ marginTop: 12 }}>
          <label><span>{unit === 'liter' ? 'Liter' : 'Amount'}</span><NumInput value={amt} onChange={setAmt} onCommit={setAmt} /></label>
          <label><span>Date</span><input type="date" value={tgl} onChange={e => setTgl(e.target.value)} /></label>
        </div>
        <label className="nsf-ket" style={{ marginTop: 8 }}><span>Note</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onSave(amt, tgl, note)}>Save</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
