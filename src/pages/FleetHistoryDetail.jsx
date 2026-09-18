import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const susutOf = d => (d.muatan != null && d.bongkar != null) ? Number(d.muatan) - Number(d.bongkar) : null
const nf = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString()
const kmOf = d => d.contract?.distance_km != null ? Number(d.contract.distance_km) * 2 : null   // round trip

export default function FleetHistoryDetail() {
  const { mode, key } = useParams()
  const who = decodeURIComponent(key || '')
  const isTruck = mode === 'truck'
  const nav = useNavigate()
  const { node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const col = isTruck ? 'plate' : 'driver_name'
    supabase.from('fleet_deliveries')
      .select('id,tanggal,plate,driver_name,muatan,bongkar,contract:fleet_contracts(control_no,origin,destination,distance_km)')
      .eq(col, who).order('tanggal', { ascending: false, nullsFirst: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [mode, who])

  const trips = useMemo(() => rows.filter(d => {
    if (from && (!d.tanggal || d.tanggal < from)) return false
    if (to && (!d.tanggal || d.tanggal > to)) return false
    return true
  }), [rows, from, to])

  const totalKm = trips.reduce((a, d) => a + (kmOf(d) || 0), 0)
  const routeCounts = useMemo(() => {
    const m = new Map()
    for (const d of trips) {
      const r = `${d.contract?.origin || '—'} → ${d.contract?.destination || '—'}`
      m.set(r, (m.get(r) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [trips])

  if (loading) return (<><div className="topbar"><div><h1>{who}</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>{who}</h1><div className="sub">Route history {isTruck ? '(truck)' : '(driver)'}</div></div>
        <button className="btn ghost" onClick={() => nav('/fleet/history')}>← All {isTruck ? 'trucks' : 'drivers'}</button>
      </div>
      <div className="content" style={{ maxWidth: 1000 }}>
        <div className="controls">
          <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          {(from || to) && <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={() => { setFrom(''); setTo('') }}>Clear</button>}
        </div>

        <div className="metrics">
          <div className="metric"><div className="k">Total routes</div><div className="v" style={{ fontSize: 20 }}>{trips.length}</div></div>
          <div className="metric"><div className="k">Distinct routes</div><div className="v" style={{ fontSize: 20 }}>{routeCounts.length}</div></div>
          <div className="metric"><div className="k">Total Km travelled</div><div className="v" style={{ fontSize: 20 }}>{totalKm.toLocaleString()} km</div></div>
        </div>

        {trips.length === 0 ? <Empty title="No trips">Nothing in this range.</Empty> : (
          <>
            {routeCounts.length > 0 && (
              <div className="rh-routes">{routeCounts.map(([r, n]) => <span className="rh-chip" key={r}>{r} <b>×{n}</b></span>)}</div>
            )}
            <div className="dk-wrap">
              <table className="dk-tbl ct-tbl">
                <thead><tr>
                  <th>Date</th><th>Route</th><th>Contract</th><th>{isTruck ? 'Driver' : 'Plate'}</th>
                  <th className="r">Muatan</th><th className="r">Susut</th><th className="r">Km (×2)</th>
                </tr></thead>
                <tbody>
                  {trips.map(d => {
                    const s = susutOf(d); const km = kmOf(d)
                    return (
                      <tr key={d.id}>
                        <td>{fmtDate(d.tanggal)}</td>
                        <td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td>
                        <td className="mono">{d.contract?.control_no || '—'}</td>
                        <td className={isTruck ? '' : 'mono'}>{isTruck ? (d.driver_name || '—') : (d.plate || '—')}</td>
                        <td className="r mono">{nf(d.muatan)}</td>
                        <td className="r mono">{s != null ? s.toLocaleString() : '—'}</td>
                        <td className="r mono">{km != null ? km.toLocaleString() : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr className="lb-total"><td colSpan={6} className="r">Total Km</td><td className="r mono">{totalKm.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {node}
    </>
  )
}
