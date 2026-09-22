import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const claimKg = d => { const tol = d.contract?.susut_tolerance; if (tol == null || d.muatan == null || d.bongkar == null) return 0; return Math.max((Number(d.muatan) - Number(d.bongkar)) - Number(tol) * Number(d.muatan), 0) }
const claimRp = d => claimKg(d) * num(d.contract?.price_per_kg)

const TABS = [['ringkasan', 'Hutang Supir'], ['susut', 'Susut'], ['sparepart', 'Spare Part'], ['ban', 'Ban'], ['kasbon', 'Kasbon'], ['bbm', 'BBM (L)']]

export default function FleetHutang() {
  const { node } = useToast()
  const nav = useNavigate()
  const [dels, setDels] = useState([])
  const [claims, setClaims] = useState([])
  const [loans, setLoans] = useState([])
  const [repays, setRepays] = useState([])
  const [drvStatus, setDrvStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ringkasan')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl, dr, ln, rp2] = await Promise.all([
      supabase.from('fleet_deliveries').select('driver_name,muatan,bongkar,potongan_susut,potongan_ban,potongan_sparepart,potongan_kasbon,bbm_loan_liter,contract:fleet_contracts(susut_tolerance,price_per_kg)').not('driver_name', 'is', null),
      supabase.from('fleet_driver_claims').select('driver_name,jenis,amount'),
      supabase.from('drivers').select('name,status'),
      supabase.from('fleet_driver_loans').select('driver_name,jenis,amount,liter'),
      supabase.from('fleet_driver_loan_repayments').select('driver_name,amount'),
    ])
    setDels(dl.data || []); setClaims(cl.data || []); setLoans(ln.data || []); setRepays(rp2.data || [])
    const m = {}; (dr.data || []).forEach(d => { m[d.name] = d.status }); setDrvStatus(m)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const accounts = useMemo(() => {
    const m = {}
    const ensure = n => (m[n] = m[n] || { driver: n, susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0, kasbonC: 0, kasbonP: 0, bbmC: 0, bbmP: 0 })
    for (const d of dels) {
      if (!d.driver_name) continue
      const a = ensure(d.driver_name); a.susutC += claimRp(d)
      a.susutP += num(d.potongan_susut); a.banP += num(d.potongan_ban); a.spP += num(d.potongan_sparepart)
      a.kasbonP += num(d.potongan_kasbon); a.bbmP += num(d.bbm_loan_liter)
    }
    for (const c of claims) { const a = ensure(c.driver_name); if (c.jenis === 'Ganti Ban') a.banC += num(c.amount); else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount) }
    for (const l of loans) { const a = ensure(l.driver_name); if (l.jenis === 'Cash') a.kasbonC += num(l.amount); else if (l.jenis === 'BBM') a.bbmC += num(l.liter) }
    for (const r of repays) { const a = ensure(r.driver_name); a.kasbonP += num(r.amount) }
    return Object.values(m).map(a => ({
      ...a, susut: a.susutC - a.susutP, ban: a.banC - a.banP, sp: a.spC - a.spP, kasbon: a.kasbonC - a.kasbonP, bbm: a.bbmC - a.bbmP,
      total: (a.susutC - a.susutP) + (a.banC - a.banP) + (a.spC - a.spP) + (a.kasbonC - a.kasbonP),
    })).sort((x, y) => y.total - x.total || x.driver.localeCompare(y.driver))
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
      {node}
    </>
  )
}
