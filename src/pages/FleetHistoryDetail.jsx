import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured, fetchAll } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import { groupTrips, legsOf, tripSum, tripSusut, tripRoute, tripControls } from '../lib/trips'

const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const nf = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('id-ID')
// Round trip on the longest contract route of the load (a two-contract load is one trip).
const kmOf = t => {
  const d = legsOf(t).map(r => r.contract?.distance_km).filter(v => v != null).map(Number)
  return d.length ? Math.max(...d) * 2 : null
}

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
    fetchAll(() => supabase.from('fleet_deliveries')
      .select('id,parent_id,tanggal,tanggal_bongkar,plate,driver_name,muatan,bongkar,rute,contract:fleet_contracts(control_no,origin,destination,distance_km)')
      .eq(col, who).eq('is_retur', false))
      .then(({ data }) => {
        // One row per trip (contract parts fold into their slip).
        // Trip date = slip date, or the unload date for historical trips that have no slip.
        const rows = groupTrips(data || []).map(d => ({ ...d, tgl: d.tanggal || d.tanggal_bongkar || null }))
        rows.sort((a, b) => (b.tgl || '').localeCompare(a.tgl || ''))
        setRows(rows); setLoading(false)
      })
  }, [mode, who])

  const trips = useMemo(() => rows.filter(d => {
    if (from && (!d.tgl || d.tgl < from)) return false
    if (to && (!d.tgl || d.tgl > to)) return false
    return true
  }), [rows, from, to])

  const totalKm = trips.reduce((a, d) => a + (kmOf(d) || 0), 0)
  const routeCounts = useMemo(() => {
    const m = new Map()
    for (const d of trips) {
      const r = tripRoute(d)
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
          <div className="metric"><div className="k">Total Km travelled</div><div className="v" style={{ fontSize: 20 }}>{totalKm.toLocaleString('id-ID')} km</div></div>
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
                    const s = tripSusut(d); const km = kmOf(d); const kg = tripSum(d, 'muatan')
                    return (
                      <tr key={d.id}>
                        <td>{fmtDate(d.tgl)}</td>
                        <td>{tripRoute(d)}</td>
                        <td className="mono">{tripControls(d)}</td>
                        <td className={isTruck ? '' : 'mono'}>{isTruck ? (d.driver_name || '—') : (d.plate || '—')}</td>
                        <td className="r mono">{nf(kg)}</td>
                        <td className="r mono">{s != null ? Number(s).toLocaleString('id-ID') : '—'}</td>
                        <td className="r mono">{km != null ? km.toLocaleString('id-ID') : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr className="lb-total"><td colSpan={6} className="r">Total Km</td><td className="r mono">{totalKm.toLocaleString('id-ID')}</td></tr>
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
