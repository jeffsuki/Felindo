import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const nf = n => (n === null || n === undefined || n === '' || Number(n) === 0) ? '' : Number(n).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' }) : ''
const ujNet = d => num(d.borongan) - num(d.bbm_rupiah) - num(d.potongan_susut) - num(d.potongan_pm)
const tbNet = d => num(d.tembak_amount) - num(d.tembak_potongan)
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

export default function FleetReports() {
  const { node } = useToast()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [uj, setUj] = useState([])
  const [tb, setTb] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    const sel = 'id,plate,driver_name,muatan,borongan,bbm_liter,price_per_liter,bbm_rupiah,potongan_susut,potongan_pm,potongan_lain,jenis_potongan,keterangan,tembak_amount,tembak_potongan,tembak_jenis_potongan,contract:fleet_contracts(control_no,origin,destination)'
    Promise.all([
      supabase.from('fleet_deliveries').select(sel).eq('tanggal', date).not('borongan', 'is', null),
      supabase.from('fleet_deliveries').select(sel).eq('tembak_released_date', date),
    ]).then(([a, b]) => { setUj(a.data || []); setTb(b.data || []); setLoading(false) })
  }, [date])

  const route = d => `${d.contract?.origin || '—'} - ${d.contract?.destination || '—'}`
  const ujGroups = useMemo(() => groupBy(uj, route), [uj])
  const tbGroups = useMemo(() => groupBy(tb, route), [tb])

  const T = uj.reduce((a, d) => ({
    tonase: a.tonase + num(d.muatan), borongan: a.borongan + num(d.borongan), ltr: a.ltr + num(d.bbm_liter),
    bbm: a.bbm + num(d.bbm_rupiah), susut: a.susut + num(d.potongan_susut), pm: a.pm + num(d.potongan_pm),
    lain: a.lain + num(d.potongan_lain), sisa: a.sisa + ujNet(d),
  }), { tonase: 0, borongan: 0, ltr: 0, bbm: 0, susut: 0, pm: 0, lain: 0, sisa: 0 })
  const totalTb = tb.reduce((a, d) => a + tbNet(d), 0)

  return (
    <>
      <div className="topbar">
        <div><h1>Daily report</h1><div className="sub">Laporan Borongan & Uang Tembak</div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn ghost no-print" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1200 }}>
        {loading ? <Spinner /> : (uj.length === 0 && tb.length === 0) ? (
          <Empty title="Nothing on this day">No borongan or uang tembak for {fmtDay(date)}.</Empty>
        ) : (
          <div className="report-print">
            <div className="rep-head"><div className="rep-title">LAPORAN BORONGAN</div><div className="rep-date">Tgl: {fmtDay(date)}</div></div>

            <div className="dk-wrap"><table className="lb-tbl">
              <thead>
                <tr>
                  <th rowSpan={2}>No</th><th rowSpan={2}>BK</th><th rowSpan={2}>Nama Supir</th><th rowSpan={2} className="r">Tonase</th>
                  <th rowSpan={2} className="r">Borongan</th><th colSpan={3} className="c">BBM</th>
                  <th colSpan={3} className="c">Potongan</th><th rowSpan={2} className="r">Sisa</th><th rowSpan={2}>Keterangan</th>
                </tr>
                <tr><th className="r">Ltr</th><th className="r">BBM/L</th><th className="r">Total BBM</th><th className="r">Susut</th><th className="r">PM</th><th>Jenis Potongan</th></tr>
              </thead>
              <tbody>
                {ujGroups.map(([r, list]) => (
                  <>
                    <tr className="lb-group"><td colSpan={12}>{r}{list[0].contract?.control_no ? ` · ${list[0].contract.control_no}` : ''}</td></tr>
                    {list.map((d, i) => (
                      <tr key={d.id}>
                        <td>{i + 1}</td><td className="mono">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td>
                        <td className="r mono">{nf(d.muatan)}</td><td className="r mono">{nf(d.borongan)}</td>
                        <td className="r mono">{nf(d.bbm_liter)}</td><td className="r mono">{nf(d.price_per_liter)}</td><td className="r mono">{nf(d.bbm_rupiah)}</td>
                        <td className="r mono">{nf(d.potongan_susut)}</td><td className="r mono">{nf(d.potongan_pm)}</td><td>{d.jenis_potongan || ''}</td>
                        <td className="r mono">{nf(ujNet(d))}</td><td>{d.keterangan || ''}</td>
                      </tr>
                    ))}
                  </>
                ))}
                <tr className="lb-total">
                  <td colSpan={3}>Total</td><td className="r mono">{nf(T.tonase)}</td><td className="r mono">{nf(T.borongan)}</td>
                  <td className="r mono">{nf(T.ltr)}</td><td></td><td className="r mono">{nf(T.bbm)}</td>
                  <td className="r mono">{nf(T.susut)}</td><td className="r mono">{nf(T.pm)}</td><td></td>
                  <td className="r mono">{nf(T.sisa)}</td><td></td>
                </tr>
              </tbody>
            </table></div>

            <div className="lb-sign">
              <div>Dibuat Oleh<br /><br /><br />(_______________)</div>
              <div>Diketahui oleh<br /><br /><br />(_______________)</div>
              <div>Diperiksa Oleh<br /><br /><br />(_______________)</div>
            </div>

            {tb.length > 0 && (
              <div style={{ marginTop: 30 }}>
                <div className="rep-head"><div className="rep-title">UANG TEMBAK</div></div>
                <div className="dk-wrap"><table className="lb-tbl">
                  <thead><tr><th>No</th><th>BK</th><th>Nama Supir</th><th className="r">Uang Tembak</th><th className="r">Potongan</th><th>Jenis</th><th className="r">Sisa</th></tr></thead>
                  <tbody>
                    {tbGroups.map(([r, list]) => (
                      <>
                        <tr className="lb-group" key={r}><td colSpan={7}>{r}</td></tr>
                        {list.map((d, i) => (
                          <tr key={d.id}><td>{i + 1}</td><td className="mono">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td>
                            <td className="r mono">{nf(d.tembak_amount)}</td><td className="r mono">{nf(d.tembak_potongan)}</td><td>{d.tembak_jenis_potongan || ''}</td>
                            <td className="r mono">{nf(tbNet(d))}</td></tr>
                        ))}
                      </>
                    ))}
                    <tr className="lb-total"><td colSpan={6}>Total Uang Tembak</td><td className="r mono">{nf(totalTb)}</td></tr>
                  </tbody>
                </table></div>
              </div>
            )}

            <div className="rep-total" style={{ marginTop: 24 }}>
              <div><span>Total Borongan (Sisa)</span><b>{rp(T.sisa)}</b></div>
              <div><span>Total Uang Tembak</span><b>{rp(totalTb)}</b></div>
              <div className="grand"><span>Grand Total</span><b>{rp(T.sisa + totalTb)}</b></div>
            </div>
          </div>
        )}
      </div>
      {node}
    </>
  )
}

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const d of arr) { const k = keyFn(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}
