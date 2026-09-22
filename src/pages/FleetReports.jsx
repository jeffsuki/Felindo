import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const nf = n => (n === null || n === undefined || n === '' || Number(n) === 0) ? '' : Number(n).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' }) : ''
const ujNet = d => num(d.borongan) - num(d.selisih_bbm) - num(d.potongan_pihak) - num(d.bbm_rupiah) - (num(d.potongan_susut) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_lain) + num(d.potongan_pm)) + num(d.tambahan_cuci) + num(d.tambahan_steam) + num(d.tambahan_tol)
const potOf = d => num(d.potongan_susut) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_pm)
const lainOf = d => num(d.potongan_lain)
const penyOf = d => num(d.tambahan_cuci) + num(d.tambahan_steam) + num(d.tambahan_tol) - num(d.selisih_bbm) - num(d.potongan_pihak)
const tonaseOf = d => num(d.estimasi_muat) || num(d.muatan)
const detailLines = d => {
  const out = []
  if (num(d.potongan_susut)) out.push(['Pot Susut', -num(d.potongan_susut)])
  if (num(d.potongan_ban)) out.push(['Pot Ban', -num(d.potongan_ban)])
  if (num(d.potongan_sparepart)) out.push(['Pot Spare Part', -num(d.potongan_sparepart)])
  if (num(d.potongan_pm)) out.push(['PM', -num(d.potongan_pm)])
  if (num(d.potongan_lain)) out.push(['Pot Lain', -num(d.potongan_lain)])
  if (num(d.selisih_bbm)) out.push([`Selisih BBM${d.selisih_bbm_liter ? ` (${nf(d.selisih_bbm_liter)}L × ${nf(d.selisih_bbm_price)})` : ''}`, -num(d.selisih_bbm)])
  if (num(d.potongan_pihak)) out.push([`Potongan ${d.potongan_pihak_nama || 'pihak'}`, -num(d.potongan_pihak)])
  if (num(d.tambahan_cuci)) out.push(['Cuci tangki', num(d.tambahan_cuci)])
  if (num(d.tambahan_steam)) out.push(['Double steam', num(d.tambahan_steam)])
  if (num(d.tambahan_tol)) out.push(['Bantuan uang tol', num(d.tambahan_tol)])
  return out
}
const adjLines = d => {
  const out = []
  if (num(d.potongan_susut)) out.push({ label: 'Potongan Susut', amt: -num(d.potongan_susut) })
  if (num(d.potongan_ban)) out.push({ label: 'Potongan Ban', amt: -num(d.potongan_ban) })
  if (num(d.potongan_sparepart)) out.push({ label: 'Potongan Spare Part', amt: -num(d.potongan_sparepart) })
  if (num(d.potongan_lain)) out.push({ label: 'Potongan Lain', amt: -num(d.potongan_lain) })
  if (num(d.potongan_pm)) out.push({ label: 'PM', amt: -num(d.potongan_pm) })
  if (num(d.selisih_bbm)) out.push({ label: `Selisih BBM${d.selisih_bbm_liter ? ` (${nf(d.selisih_bbm_liter)}L × ${nf(d.selisih_bbm_price)})` : ''}`, amt: -num(d.selisih_bbm) })
  if (num(d.potongan_pihak)) out.push({ label: `Potongan ${d.potongan_pihak_nama || 'pihak'}`, amt: -num(d.potongan_pihak) })
  if (num(d.tambahan_cuci)) out.push({ label: 'Cuci tangki', amt: num(d.tambahan_cuci) })
  if (num(d.tambahan_steam)) out.push({ label: 'Double steam', amt: num(d.tambahan_steam) })
  if (num(d.tambahan_tol)) out.push({ label: 'Bantuan uang tol', amt: num(d.tambahan_tol) })
  return out
}
const tbNet = d => num(d.tembak_amount) - num(d.tembak_potongan)
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

export default function FleetReports() {
  const { node } = useToast()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [uj, setUj] = useState([])
  const [tb, setTb] = useState([])
  const [loading, setLoading] = useState(false)
  const [openRows, setOpenRows] = useState(() => new Set())
  const toggleRow = id => setOpenRows(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    const sel = 'id,plate,driver_name,muatan,estimasi_muat,borongan,bbm_liter,price_per_liter,bbm_rupiah,potongan_susut,potongan_ban,potongan_sparepart,potongan_pm,potongan_lain,jenis_potongan,selisih_bbm,selisih_bbm_liter,selisih_bbm_price,potongan_pihak,potongan_pihak_nama,tambahan_cuci,tambahan_steam,tambahan_tol,is_retur,keterangan,tembak_amount,tembak_potongan,tembak_jenis_potongan,contract:fleet_contracts(control_no,origin,destination)'
    Promise.all([
      supabase.from('fleet_deliveries').select(sel).eq('tanggal', date).not('borongan', 'is', null),
      supabase.from('fleet_deliveries').select(sel).eq('tembak_released_date', date),
    ]).then(([a, b]) => { setUj(a.data || []); setTb(b.data || []); setLoading(false) })
  }, [date])

  const route = d => `${d.contract?.origin || '—'} - ${d.contract?.destination || '—'}`
  const ujGroups = useMemo(() => groupBy(uj, route), [uj])
  const tbGroups = useMemo(() => groupBy(tb, route), [tb])

  const T = uj.reduce((a, d) => ({
    tonase: a.tonase + tonaseOf(d), borongan: a.borongan + num(d.borongan), peny: a.peny + penyOf(d),
    ltr: a.ltr + num(d.bbm_liter), bbm: a.bbm + num(d.bbm_rupiah),
    pot: a.pot + potOf(d), lain: a.lain + lainOf(d), sisa: a.sisa + ujNet(d),
  }), { tonase: 0, borongan: 0, peny: 0, ltr: 0, bbm: 0, pot: 0, lain: 0, sisa: 0 })
  const totalTb = tb.reduce((a, d) => a + tbNet(d), 0)

  return (
    <>
      <div className="topbar">
        <div><h1>Daily report</h1><div className="sub">Laporan Borongan & Uang Tembak</div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(() => { const ids = uj.filter(d => detailLines(d).length).map(d => d.id); const allOpen = ids.length > 0 && ids.every(id => openRows.has(id));
            return ids.length > 0 ? <button className="btn ghost no-print" onClick={() => setOpenRows(allOpen ? new Set() : new Set(ids))}>{allOpen ? 'Collapse all' : 'Expand all'}</button> : null })()}
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
                  <th rowSpan={2} className="r">Borongan</th><th rowSpan={2} className="r">Penyesuaian</th><th colSpan={3} className="c">BBM</th>
                  <th rowSpan={2} className="r">Potongan</th><th rowSpan={2} className="r">Lainnya</th><th rowSpan={2} className="r">Sisa</th><th rowSpan={2}>Keterangan</th>
                </tr>
                <tr><th className="r">Ltr</th><th className="r">BBM/L</th><th className="r">Total BBM</th></tr>
              </thead>
              <tbody>
                {ujGroups.map(([r, list]) => (
                  <Fragment key={r}>
                    <tr className="lb-group"><td colSpan={13}>{r}{list[0].contract?.control_no ? ` · ${list[0].contract.control_no}` : ''}</td></tr>
                    {list.map((d, i) => {
                      const det = detailLines(d)
                      const open = openRows.has(d.id)
                      return (
                        <Fragment key={d.id}>
                          <tr className={det.length ? 'clickrow' : ''} onClick={() => det.length && toggleRow(d.id)}>
                            <td>{i + 1}</td><td className="mono nowrap">{d.plate || '—'}</td><td>{d.driver_name || '—'}{d.is_retur ? ' (Retur)' : ''}</td>
                            <td className="r mono">{nf(tonaseOf(d))}</td><td className="r mono">{nf(d.borongan)}</td><td className="r mono">{penyOf(d) ? nf(penyOf(d)) : ''}</td>
                            <td className="r mono">{nf(d.bbm_liter)}</td><td className="r mono">{nf(d.price_per_liter)}</td><td className="r mono">{nf(d.bbm_rupiah)}</td>
                            <td className="r mono">{nf(potOf(d))}</td><td className="r mono">{nf(lainOf(d))}</td>
                            <td className="r mono">{nf(ujNet(d))}</td><td>{d.keterangan || ''}{det.length ? <span className="lb-caret">{open ? ' ▾' : ' ▸'}</span> : ''}</td>
                          </tr>
                          {open && (
                            <tr className="lb-detail"><td colSpan={13}>
                              <div className="lb-detail-grid">
                                {det.map(([label, amt], k) => (
                                  <div key={k}><span>↳ {label}</span><span className="mono">{amt < 0 ? '−' : '+'} {nf(Math.abs(amt))}</span></div>
                                ))}
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                ))}
                <tr className="lb-total">
                  <td colSpan={3}>Total</td><td className="r mono">{nf(T.tonase)}</td><td className="r mono">{nf(T.borongan)}</td><td className="r mono">{nf(T.peny)}</td>
                  <td className="r mono">{nf(T.ltr)}</td><td></td><td className="r mono">{nf(T.bbm)}</td>
                  <td className="r mono">{nf(T.pot)}</td><td className="r mono">{nf(T.lain)}</td><td className="r mono">{nf(T.sisa)}</td><td></td>
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
                      <Fragment key={r}>
                        <tr className="lb-group"><td colSpan={7}>{r}</td></tr>
                        {list.map((d, i) => (
                          <tr key={d.id}><td>{i + 1}</td><td className="mono">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td>
                            <td className="r mono">{nf(d.tembak_amount)}</td><td className="r mono">{nf(d.tembak_potongan)}</td><td>{d.tembak_jenis_potongan || ''}</td>
                            <td className="r mono">{nf(tbNet(d))}</td></tr>
                        ))}
                      </Fragment>
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
