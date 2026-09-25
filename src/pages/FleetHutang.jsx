import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import { NumInput } from '../components/NumInput'
import SearchSelect from '../components/SearchSelect'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const claimKg = d => { const tol = d.contract?.susut_tolerance; if (tol == null || d.muatan == null || d.bongkar == null) return 0; return Math.max((Number(d.muatan) - Number(d.bongkar)) - Number(tol) * Number(d.muatan), 0) }
const claimRp = d => claimKg(d) * num(d.contract?.price_per_kg)

const TABS = [['ringkasan', 'Hutang Supir'], ['susut', 'Susut'], ['sparepart', 'Spare Part'], ['ban', 'Ban'], ['kasbon', 'Kasbon'], ['bbm', 'BBM (L)']]

export default function FleetHutang() {
  const { node, show } = useToast()
  const nav = useNavigate()
  const [dels, setDels] = useState([])
  const [claims, setClaims] = useState([])
  const [loans, setLoans] = useState([])
  const [repays, setRepays] = useState([])
  const [drvStatus, setDrvStatus] = useState({})
  const [activeDrivers, setActiveDrivers] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ringkasan')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl, dr, ln, rp2] = await Promise.all([
      supabase.from('fleet_deliveries').select('driver_name,tanggal,muatan,bongkar,bbm_liter,potongan_susut,potongan_ban,potongan_sparepart,potongan_kasbon,contract:fleet_contracts(susut_tolerance,price_per_kg)').not('driver_name', 'is', null),
      supabase.from('fleet_driver_claims').select('driver_name,jenis,amount'),
      supabase.from('drivers').select('name,nickname,status'),
      supabase.from('fleet_driver_loans').select('driver_name,jenis,amount,liter,tanggal'),
      supabase.from('fleet_driver_loan_repayments').select('driver_name,amount'),
    ])
    setDels(dl.data || []); setClaims(cl.data || []); setLoans(ln.data || []); setRepays(rp2.data || [])
    const m = {}; (dr.data || []).forEach(d => { m[d.name] = d.status }); setDrvStatus(m)
    setActiveDrivers((dr.data || []).filter(d => d.status === 'Active'))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const accounts = useMemo(() => {
    const m = {}
    const ensure = n => (m[n] = m[n] || { driver: n, susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0, kasbonC: 0, kasbonP: 0, bbmEv: [] })
    for (const d of dels) {
      if (!d.driver_name) continue
      const a = ensure(d.driver_name); a.susutC += claimRp(d)
      a.susutP += num(d.potongan_susut); a.banP += num(d.potongan_ban); a.spP += num(d.potongan_sparepart)
      a.kasbonP += num(d.potongan_kasbon)
      if (num(d.bbm_liter) > 0) a.bbmEv.push([d.tanggal || '', -num(d.bbm_liter)])
    }
    for (const c of claims) { const a = ensure(c.driver_name); if (c.jenis === 'Ganti Ban') a.banC += num(c.amount); else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount) }
    for (const l of loans) { const a = ensure(l.driver_name); if (l.jenis === 'Cash') a.kasbonC += num(l.amount); else if (l.jenis === 'BBM') a.bbmEv.push([l.tanggal || '', num(l.liter)]) }
    for (const r of repays) { const a = ensure(r.driver_name); a.kasbonP += num(r.amount) }
    return Object.values(m).map(a => {
      const bbmC = a.bbmEv.filter(e => e[1] > 0).reduce((s, e) => s + e[1], 0)
      const ev = [...a.bbmEv].sort((x, y) => x[0].localeCompare(y[0]))
      let bal = 0; for (const [, amt] of ev) { bal += amt; if (bal < 0) bal = 0 }
      return {
        ...a, susut: a.susutC - a.susutP, ban: a.banC - a.banP, sp: a.spC - a.spP, kasbon: a.kasbonC - a.kasbonP,
        bbmC, bbmP: bbmC - bal, bbm: bal,
        total: (a.susutC - a.susutP) + (a.banC - a.banP) + (a.spC - a.spP) + (a.kasbonC - a.kasbonP),
      }
    }).sort((x, y) => y.total - x.total || x.driver.localeCompare(y.driver))
  }, [dels, claims, loans, repays])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return accounts.filter(a => {
      if (statusFilter === 'active' && drvStatus[a.driver] !== 'Active') return false
      if (statusFilter === 'inactive' && drvStatus[a.driver] === 'Active') return false
      if (s && !a.driver.toLowerCase().includes(s)) return false
      if (tab === 'susut') return a.susutC || a.susutP
      if (tab === 'ban') return a.banC || a.banP
      if (tab === 'sparepart') return a.spC || a.spP
      if (tab === 'kasbon') return a.kasbonC || a.kasbonP
      if (tab === 'bbm') return a.bbmC || a.bbmP
      return true
    })
  }, [accounts, q, statusFilter, drvStatus, tab])

  async function addEntry({ driver, type, amount, tanggal, note }) {
    if (!driver) return show('Pick a driver.', true)
    const amt = num(amount)
    let error
    if (type === 'kasbon') ({ error } = await supabase.from('fleet_driver_loans').insert({ driver_name: driver, jenis: 'Cash', amount: amt, tanggal: tanggal || null, note: note || null }))
    else if (type === 'bbm') ({ error } = await supabase.from('fleet_driver_loans').insert({ driver_name: driver, jenis: 'BBM', liter: amt, tanggal: tanggal || null, note: note || null }))
    else if (type === 'ban') ({ error } = await supabase.from('fleet_driver_claims').insert({ driver_name: driver, jenis: 'Ganti Ban', amount: amt, tanggal: tanggal || null, note: note || null }))
    else if (type === 'sparepart') ({ error } = await supabase.from('fleet_driver_claims').insert({ driver_name: driver, jenis: 'Ganti Spare Part', amount: amt, tanggal: tanggal || null, note: note || null }))
    if (error) return show(error.message, true)
    show('Added.'); setAddOpen(false); load()
  }

  function go(driver) { nav('/fleet/hutang/' + encodeURIComponent(driver)) }
  if (loading) return (<><div className="topbar"><div><h1>Hutang Supir</h1></div></div><div className="content"><Spinner /></div></>)

  const colOf = { susut: ['susutC', 'susutP', 'susut'], ban: ['banC', 'banP', 'ban'], sparepart: ['spC', 'spP', 'sp'], kasbon: ['kasbonC', 'kasbonP', 'kasbon'] }[tab]

  return (
    <>
      <div className="topbar">
        <div><h1>Hutang Supir</h1><div className="sub">Open a driver to see the account</div></div>
        <div className="seg-lens">{TABS.map(([v, l]) => <button key={v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>
      </div>
      <div className="content hutang-pg" style={{ maxWidth: 980 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search driver…" /></div>
          <div className="seg-lens">{[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([v, l]) => (<button key={v} className={statusFilter === v ? 'on' : ''} onClick={() => setStatusFilter(v)}>{l}</button>))}</div>
          <button className="btn primary" onClick={() => setAddOpen(true)}>+ Add entry</button>
        </div>
        {filtered.length === 0 ? <Empty title="Nothing here">No drivers to show.</Empty> : (
          <div className="dk-wrap"><table className="dk-tbl ct-tbl">
            {tab === 'ringkasan' ? (
              <>
                <thead><tr><th>Supir</th><th className="r">Susut</th><th className="r">Spare Part</th><th className="r">Ban</th><th className="r">Kasbon</th><th className="r">BBM (L)</th><th className="r">Total Hutang</th><th></th></tr></thead>
                <tbody>{filtered.map(a => (
                  <tr key={a.driver} className="clickrow" onClick={() => go(a.driver)}>
                    <td>{a.driver}</td><td className="r mono">{rp(a.susut)}</td><td className="r mono">{rp(a.sp)}</td><td className="r mono">{rp(a.ban)}</td>
                    <td className="r mono">{rp(a.kasbon)}</td><td className="r mono">{a.bbm.toLocaleString('id-ID')} L</td>
                    <td className="r mono" style={{ fontWeight: 700, color: a.total > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(a.total)}</td><td className="r">▸</td>
                  </tr>
                ))}</tbody>
              </>
            ) : tab === 'bbm' ? (
              <>
                <thead><tr><th>Supir</th><th className="r">Diambil (L)</th><th className="r">Dibayar (L)</th><th className="r">Sisa (L)</th><th></th></tr></thead>
                <tbody>{filtered.map(a => (
                  <tr key={a.driver} className="clickrow" onClick={() => go(a.driver)}>
                    <td>{a.driver}</td><td className="r mono">{a.bbmC.toLocaleString('id-ID')}</td><td className="r mono">{a.bbmP.toLocaleString('id-ID')}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: a.bbm > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{a.bbm.toLocaleString('id-ID')} L</td><td className="r">▸</td>
                  </tr>
                ))}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Supir</th><th className="r">{tab === 'kasbon' ? 'Dipinjam' : 'Claims'}</th><th className="r">{tab === 'kasbon' ? 'Dibayar' : 'Payments'}</th><th className="r">Balance</th><th></th></tr></thead>
                <tbody>{filtered.map(a => (
                  <tr key={a.driver} className="clickrow" onClick={() => go(a.driver)}>
                    <td>{a.driver}</td><td className="r mono">{rp(a[colOf[0]])}</td><td className="r mono">{rp(a[colOf[1]])}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: a[colOf[2]] > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(a[colOf[2]])}</td><td className="r">▸</td>
                  </tr>
                ))}</tbody>
              </>
            )}
          </table></div>
        )}
      </div>
      {addOpen && <AddEntryModal drivers={activeDrivers} onSave={addEntry} onClose={() => setAddOpen(false)} />}
      {node}
    </>
  )
}

function AddEntryModal({ drivers, onSave, onClose }) {
  const [driver, setDriver] = useState('')
  const [type, setType] = useState('kasbon')
  const [amount, setAmount] = useState('')
  const [tanggal, setTanggal] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const isBbm = type === 'bbm'
  return (
    <div className="slip-scrim">
      <div className="rel-modal" style={{ width: 440 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Add entry</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted)' }}>Driver</span>
          <SearchSelect value={driver} onChange={setDriver} placeholder="Pick driver…" options={drivers.map(d => ({ value: d.name, label: d.nickname ? `${d.name} (${d.nickname})` : d.name }))} />
        </div>
        <div className="adj-grid" style={{ marginTop: 10 }}>
          <label><span>Type</span><select value={type} onChange={e => setType(e.target.value)}>
            <option value="kasbon">Kasbon (cash loan)</option>
            <option value="bbm">BBM Pinjaman (liter)</option>
            <option value="ban">Claim Ban</option>
            <option value="sparepart">Claim Spare Part</option>
          </select></label>
          <label><span>{isBbm ? 'Liter' : 'Amount'}</span><NumInput value={amount} onChange={setAmount} onCommit={setAmount} /></label>
        </div>
        <div className="adj-grid" style={{ marginTop: 8 }}>
          <label><span>Date</span><input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} /></label>
          <label><span>Note</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
        </div>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onSave({ driver, type, amount, tanggal, note })}>Save</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
