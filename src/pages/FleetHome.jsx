import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const STAGES = ['Menuju Muat', 'Muat', 'Dalam Perjalanan', 'Bongkar', 'Gantung', 'Perbaikan', 'Rusak di Jalan']
const ORDER = ['Perbaikan', 'Rusak di Jalan', 'Muat', 'Bongkar', 'Gantung', 'Dalam Perjalanan', 'Menuju Muat', 'Kosong']

// Fleet Overview: manually set where each truck is. Fully manual, no override.
export default function FleetHome() {
  const { show, node } = useToast()
  const [trucks, setTrucks] = useState([])
  const [byPlate, setByPlate] = useState({})   // plate -> { driver, route }
  const [loading, setLoading] = useState(true)
  const [onlyDriver, setOnlyDriver] = useState(false)
  const [q, setQ] = useState('')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [tr, dl] = await Promise.all([
      supabase.from('trucks').select('id,plate,stage,status').eq('status', 'Active').order('plate'),
      supabase.from('fleet_deliveries').select('plate,driver_name,contract:fleet_contracts(origin,destination)')
        .not('driver_name', 'is', null).is('tanggal_bongkar', null),
    ])
    setTrucks(tr.data || [])
    const m = {}; (dl.data || []).forEach(d => { if (d.plate && !m[d.plate]) m[d.plate] = { driver: d.driver_name, route: `${d.contract?.origin || '—'} → ${d.contract?.destination || '—'}` } })
    setByPlate(m); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStage(id, stage) {
    setTrucks(ts => ts.map(t => t.id === id ? { ...t, stage } : t))
    const { error } = await supabase.from('trucks').update({ stage: stage || null }).eq('id', id)
    if (error) show(error.message, true)
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return trucks.filter(t => {
      if (onlyDriver && !byPlate[t.plate]) return false
      if (s && !(`${t.plate} ${byPlate[t.plate]?.driver || ''}`.toLowerCase().includes(s))) return false
      return true
    })
  }, [trucks, byPlate, onlyDriver, q])

  const buckets = useMemo(() => {
    const m = {}
    for (const t of filtered) { const c = t.stage || 'Kosong'; (m[c] = m[c] || []).push(t) }
    return m
  }, [filtered])
  const cats = ORDER.filter(c => buckets[c]?.length)

  if (loading) return (<><div className="topbar"><div><h1>Fleet Overview</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Fleet Overview</h1><div className="sub">Set where each truck is · {filtered.length} shown</div></div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search plate / driver…" /></div>
          <button className="btn ghost" onClick={() => setOnlyDriver(v => !v)}>{onlyDriver ? 'Show all trucks' : 'Only with driver'}</button>
        </div>
        {filtered.length === 0 ? <Empty title="No trucks">Nothing to show.</Empty> : (
          <div className="fo-cols">
            {cats.map(cat => (
              <div className="fo-cat" key={cat}>
                <div className="fo-cat-h">{cat}<span>{buckets[cat].length}</span></div>
                <table className="fo-tbl">
                  <tbody>
                    {buckets[cat].map(t => {
                      const info = byPlate[t.plate]
                      return (
                        <tr key={t.id}>
                          <td className="fo-plate">{t.plate}</td>
                          <td className="fo-driver">{info?.driver || ''}</td>
                          <td className="fo-route">{info?.route || ''}</td>
                          <td className="fo-stage">
                            <select value={t.stage || ''} onChange={e => setStage(t.id, e.target.value)}>
                              <option value="">— Kosong</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
      {node}
    </>
  )
}
