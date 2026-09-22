import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const claimKg = d => { const tol = d.contract?.susut_tolerance; if (tol == null || d.muatan == null || d.bongkar == null) return 0; return Math.max((Number(d.muatan) - Number(d.bongkar)) - Number(tol) * Number(d.muatan), 0) }
const claimRp = d => claimKg(d) * num(d.contract?.price_per_kg)

const TABS = [['ringkasan', 'Hutang Supir'], ['susut', 'Susut'], ['sparepart', 'Spare Part'], ['ban', 'Ban']]

export default function FleetHutang() {
  const { node } = useToast()
  const nav = useNavigate()
  const [dels, setDels] = useState([])
  const [claims, setClaims] = useState([])
  const [drvStatus, setDrvStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ringkasan')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl, dr] = await Promise.all([
      supabase.from('fleet_deliveries').select('driver_name,muatan,bongkar,potongan_susut,potongan_ban,potongan_sparepart,contract:fleet_contracts(susut_tolerance,price_per_kg)').not('driver_name', 'is', null),
      supabase.from('fleet_driver_claims').select('driver_name,jenis,amount'),
      supabase.from('drivers').select('name,status'),
    ])
    setDels(dl.data || []); setClaims(cl.data || [])
    const m = {}; (dr.data || []).forEach(d => { m[d.name] = d.status }); setDrvStatus(m)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const accounts = useMemo(() => {
    const m = {}
    const ensure = n => (m[n] = m[n] || { driver: n, susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0 })
    for (const d of dels) {
      if (!d.driver_name) continue
      const a = ensure(d.driver_name); a.susutC += claimRp(d)
      a.susutP += num(d.potongan_susut); a.banP += num(d.potongan_ban); a.spP += num(d.potongan_sparepart)
    }
    for (const c of claims) { const a = ensure(c.driver_name); if (c.jenis === 'Ganti Ban') a.banC += num(c.amount); else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount) }
    return Object.values(m).map(a => ({ ...a, susut: a.susutC - a.susutP, ban: a.banC - a.banP, sp: a.spC - a.spP, total: (a.susutC - a.susutP) + (a.banC - a.banP) + (a.spC - a.spP) }))
      .sort((x, y) => y.total - x.total || x.driver.localeCompare(y.driver))
  }, [dels, claims])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return accounts.filter(a => {
      if (statusFilter === 'active' && drvStatus[a.driver] !== 'Active') return false
      if (statusFilter === 'inactive' && drvStatus[a.driver] === 'Active') return false
      if (s && !a.driver.toLowerCase().includes(s)) return false
      if (tab === 'susut') return a.susutC || a.susutP
      if (tab === 'ban') return a.banC || a.banP
      if (tab === 'sparepart') return a.spC || a.spP
      return true
    })
  }, [accounts, q, statusFilter, drvStatus, tab])

  function go(driver) { nav('/fleet/hutang/' + encodeURIComponent(driver)) }
  if (loading) return (<><div className="topbar"><div><h1>Hutang Supir</h1></div></div><div className="content"><Spinner /></div></>)

  const colOf = { susut: ['susutC', 'susutP', 'susut'], ban: ['banC', 'banP', 'ban'], sparepart: ['spC', 'spP', 'sp'] }[tab]

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
                <thead><tr><th>Supir</th><th className="r">Susut</th><th className="r">Spare Part</th><th className="r">Ban</th><th className="r">Total Hutang</th><th></th></tr></thead>
                <tbody>{filtered.map(a => (
                  <tr key={a.driver} className="clickrow" onClick={() => go(a.driver)}>
                    <td>{a.driver}</td><td className="r mono">{rp(a.susut)}</td><td className="r mono">{rp(a.sp)}</td><td className="r mono">{rp(a.ban)}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: a.total > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(a.total)}</td><td className="r">▸</td>
                  </tr>
                ))}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Supir</th><th className="r">Claims</th><th className="r">Payments</th><th className="r">Balance</th><th></th></tr></thead>
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
