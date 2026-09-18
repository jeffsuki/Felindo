import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString()
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : ''
const ujNet = d => num(d.borongan) - num(d.bbm_rupiah) - num(d.potongan_susut) - num(d.potongan_pm)
const tbNet = d => num(d.tembak_amount) - num(d.tembak_potongan)

export default function FleetReports() {
  const { node } = useToast()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [uj, setUj] = useState([])
  const [tb, setTb] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    const sel = 'id,plate,driver_name,borongan,bbm_rupiah,potongan_susut,potongan_pm,tembak_amount,tembak_potongan,contract:fleet_contracts(control_no,origin,destination)'
    Promise.all([
      supabase.from('fleet_deliveries').select(sel).eq('tanggal', date).not('borongan', 'is', null),
      supabase.from('fleet_deliveries').select(sel).eq('tembak_released_date', date),
    ]).then(([a, b]) => { setUj(a.data || []); setTb(b.data || []); setLoading(false) })
  }, [date])

  const groups = useMemo(() => {
    const m = new Map()
    const key = d => d.contract?.control_no || '—'
    const ensure = d => {
      const k = key(d)
      if (!m.has(k)) m.set(k, { control_no: k, origin: d.contract?.origin || '—', destination: d.contract?.destination || '—', uj: [], tb: [] })
      return m.get(k)
    }
    for (const d of uj) ensure(d).uj.push(d)
    for (const d of tb) ensure(d).tb.push(d)
    return [...m.values()].sort((a, b) => a.control_no.localeCompare(b.control_no))
  }, [uj, tb])

  const totalUj = uj.reduce((a, d) => a + ujNet(d), 0)
  const totalTb = tb.reduce((a, d) => a + tbNet(d), 0)

  return (
    <>
      <div className="topbar">
        <div><h1>Daily report</h1><div className="sub">Uang Jalan & Uang Tembak, grouped by contract</div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn ghost no-print" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 900 }}>
        {loading ? <Spinner /> : (
          <div className="report-print">
            <div className="rep-head">
              <div className="rep-title">Laporan Harian — Uang Jalan & Uang Tembak</div>
              <div className="rep-date">{fmtDay(date)}</div>
            </div>
            {groups.length === 0 ? <Empty title="Nothing on this day">No uang jalan or uang tembak for {fmtDay(date)}.</Empty> : (
              <>
                {groups.map(g => {
                  const gUj = g.uj.reduce((a, d) => a + ujNet(d), 0)
                  const gTb = g.tb.reduce((a, d) => a + tbNet(d), 0)
                  return (
                    <div className="rep-group" key={g.control_no}>
                      <div className="rep-gh"><span className="rep-cn">{g.control_no}</span><span className="rep-route">{g.origin} → {g.destination}</span></div>
                      <table className="rep-tbl">
                        <thead><tr><th>Plat</th><th>Supir</th><th>Jenis</th><th className="r">Jumlah</th></tr></thead>
                        <tbody>
                          {g.uj.map(d => <tr key={'uj' + d.id}><td className="mono">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td><td>Uang Jalan</td><td className="r mono">{rp(ujNet(d))}</td></tr>)}
                          {g.tb.map(d => <tr key={'tb' + d.id}><td className="mono">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td><td>Uang Tembak</td><td className="r mono">{rp(tbNet(d))}</td></tr>)}
                          <tr className="rep-sub"><td colSpan={3} className="r">Subtotal (UJ {rp(gUj)} · UT {rp(gTb)})</td><td className="r mono">{rp(gUj + gTb)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )
                })}
                <div className="rep-total">
                  <div><span>Total Uang Jalan</span><b>{rp(totalUj)}</b></div>
                  <div><span>Total Uang Tembak</span><b>{rp(totalTb)}</b></div>
                  <div className="grand"><span>Grand Total</span><b>{rp(totalUj + totalTb)}</b></div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {node}
    </>
  )
}
