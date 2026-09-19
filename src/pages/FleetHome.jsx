import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const STAGES = ['Menuju Muat', 'Muat', 'Dalam Perjalanan', 'Bongkar', 'Gantung']
// display order of buckets
const ORDER = ['Perbaikan', 'Muat', 'Bongkar', 'Gantung', 'Dalam Perjalanan', 'Menuju Muat', 'Belum di-set']

// Fleet Overview: where every deployed truck is right now. Only trucks with a
// driver on an unfinished trip. Repair is auto-detected from open work orders.
export default function FleetHome() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [repair, setRepair] = useState({})   // plate -> open job count
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, td] = await Promise.all([
      supabase.from('fleet_deliveries')
        .select('id,plate,driver_name,stage,contract:fleet_contracts(origin,destination)')
        .not('driver_name', 'is', null).is('tanggal_bongkar', null),
      supabase.from('trucks_down').select('plate'),
    ])
    setRows(dl.data || [])
    const rc = {}; (td.data || []).forEach(r => { if (r.plate) rc[r.plate] = (rc[r.plate] || 0) + 1 })
    setRepair(rc)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStage(id, stage) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, stage } : r))
    const { error } = await supabase.from('fleet_deliveries').update({ stage: stage || null }).eq('id', id)
    if (error) show(error.message, true)
  }

  const buckets = useMemo(() => {
    const m = {}
    for (const d of rows) {
      const cat = repair[d.plate] ? 'Perbaikan' : (d.stage || 'Belum di-set')
      if (!m[cat]) m[cat] = []
      m[cat].push(d)
    }
    for (const k in m) m[k].sort((a, b) => (a.plate || '').localeCompare(b.plate || ''))
    return m
  }, [rows, repair])

  if (loading) return (<><div className="topbar"><div><h1>Fleet Overview</h1></div></div><div className="content"><Spinner /></div></>)

  const cats = ORDER.filter(c => buckets[c]?.length)

  return (
    <>
      <div className="topbar">
        <div><h1>Fleet Overview</h1><div className="sub">Where the trucks are · {rows.length} on trip</div></div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 1100 }}>
        {rows.length === 0 ? <Empty title="No trucks on trip">Trucks appear here once a delivery with a driver is active.</Empty> : (
          <div className="fo-cols">
            {cats.map(cat => (
              <div className="fo-cat" key={cat}>
                <div className="fo-cat-h">{cat}<span>{buckets[cat].length}</span></div>
                <table className="fo-tbl">
                  <tbody>
                    {buckets[cat].map(d => (
                      <tr key={d.id}>
                        <td className="fo-plate">{d.plate || '—'}</td>
                        <td className="fo-driver">{d.driver_name || '—'}</td>
                        <td className="fo-route">{(d.contract?.origin || '—')} → {(d.contract?.destination || '—')}</td>
                        <td className="fo-stage">
                          {cat === 'Perbaikan'
                            ? <span className="fo-rep">{repair[d.plate]} job</span>
                            : <select value={d.stage || ''} onChange={e => setStage(d.id, e.target.value)}>
                                <option value="">—</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>}
                        </td>
                      </tr>
                    ))}
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
