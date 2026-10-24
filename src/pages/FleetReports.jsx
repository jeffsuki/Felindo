import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const nf = n => (n === null || n === undefined || n === '' || Number(n) === 0) ? '' : Number(n).toLocaleString('id-ID')
const nm = n => (n === null || n === undefined || n === '' || Math.round(Number(n)) === 0) ? '' : Math.round(Number(n)).toLocaleString('id-ID')   // money: whole rupiah
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtShort = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
const fmtDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' }) : ''
const ujNet = d => num(d.borongan) - num(d.selisih_bbm) - num(d.potongan_pihak) - num(d.bbm_rupiah) - (num(d.potongan_susut) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_lain) + num(d.potongan_pm) + num(d.potongan_kasbon)) + num(d.tambahan_cuci) + num(d.tambahan_steam) + num(d.tambahan_tol) + num(d.tambahan_bantuan)
const potOf = d => num(d.potongan_susut) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_pm) + num(d.potongan_kasbon)
const lainOf = d => num(d.potongan_lain)
const penyOf = d => num(d.tambahan_cuci) + num(d.tambahan_steam) + num(d.tambahan_tol) + num(d.tambahan_bantuan) - num(d.selisih_bbm) - num(d.potongan_pihak)
const legTonase = d => num(d.estimasi_muat) || num(d.muatan)
// Whole load: the slip plus any other contract carried on it (parts).
const tonaseOf = d => legTonase(d) + (d.parts || []).reduce((a, p) => a + legTonase(p), 0)
const detailLines = d => {
  const out = []
  if (num(d.potongan_susut)) out.push(['Pot Susut', -num(d.potongan_susut), 'pot'])
  if (num(d.potongan_ban)) out.push(['Pot Ban', -num(d.potongan_ban), 'pot'])
  if (num(d.potongan_sparepart)) out.push(['Pot Spare Part', -num(d.potongan_sparepart), 'pot'])
  if (num(d.potongan_pm)) out.push(['PM', -num(d.potongan_pm), 'pot'])
  if (num(d.potongan_kasbon)) out.push(['Pot Kasbon', -num(d.potongan_kasbon), 'pot'])
  if (num(d.potongan_lain)) out.push(['Pot Lain', -num(d.potongan_lain), 'lain'])
  if (num(d.selisih_bbm)) out.push([`Selisih BBM${d.selisih_bbm_liter ? ` (${nf(d.selisih_bbm_liter)}L × ${nm(d.selisih_bbm_price)})` : ''}`, -num(d.selisih_bbm), 'peny'])
  if (num(d.potongan_pihak)) out.push([`Potongan ${d.potongan_pihak_nama || 'pihak'}`, -num(d.potongan_pihak), 'peny'])
  if (num(d.tambahan_cuci)) out.push(['Cuci tangki', num(d.tambahan_cuci), 'peny'])
  if (num(d.tambahan_steam)) out.push(['Double steam', num(d.tambahan_steam), 'peny'])
  if (num(d.tambahan_tol)) out.push(['Uang jembatan / tol', num(d.tambahan_tol), 'peny'])
  if (num(d.tambahan_bantuan)) out.push([`Bantuan${d.tambahan_bantuan_ket ? ' — ' + d.tambahan_bantuan_ket : ''}`, num(d.tambahan_bantuan), 'peny'])
  return out
}
const sgn = a => (a < 0 ? '−' : '+') + ' ' + nm(Math.abs(a))
const adjLines = d => {
  const out = []
  if (num(d.potongan_susut)) out.push({ label: 'Potongan Susut', amt: -num(d.potongan_susut) })
  if (num(d.potongan_ban)) out.push({ label: 'Potongan Ban', amt: -num(d.potongan_ban) })
  if (num(d.potongan_sparepart)) out.push({ label: 'Potongan Spare Part', amt: -num(d.potongan_sparepart) })
  if (num(d.potongan_lain)) out.push({ label: 'Potongan Lain', amt: -num(d.potongan_lain) })
  if (num(d.potongan_pm)) out.push({ label: 'PM', amt: -num(d.potongan_pm) })
  if (num(d.selisih_bbm)) out.push({ label: `Selisih BBM${d.selisih_bbm_liter ? ` (${nf(d.selisih_bbm_liter)}L × ${nm(d.selisih_bbm_price)})` : ''}`, amt: -num(d.selisih_bbm) })
  if (num(d.potongan_pihak)) out.push({ label: `Potongan ${d.potongan_pihak_nama || 'pihak'}`, amt: -num(d.potongan_pihak) })
  if (num(d.tambahan_cuci)) out.push({ label: 'Cuci tangki', amt: num(d.tambahan_cuci) })
  if (num(d.tambahan_steam)) out.push({ label: 'Double steam', amt: num(d.tambahan_steam) })
  if (num(d.tambahan_tol)) out.push({ label: 'Uang jembatan / tol', amt: num(d.tambahan_tol) })
  if (num(d.tambahan_bantuan)) out.push({ label: `Bantuan${d.tambahan_bantuan_ket ? ' — ' + d.tambahan_bantuan_ket : ''}`, amt: num(d.tambahan_bantuan) })
  return out
}
const tbNet = d => num(d.tembak_amount) - num(d.tembak_potongan)
const rp = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID')
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
// dates as 'YYYY-MM-DD' in local time (toISOString alone gives the UTC date, a day behind before 07:00 WIB)
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoOf(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const daysIn = (y, m) => new Date(y, m, 0).getDate()      // m = 1..12
// tanggal / bulan / tahun with arrows for the previous and next day
function DayPicker({ value, onChange }) {
  const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10))
  const set = (yy, mm, dd) => onChange(`${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dd, daysIn(yy, mm))).padStart(2, '0')}`)
  const cy = new Date().getFullYear(); const years = []
  for (let k = Math.max(y, cy); k >= Math.min(y, 2025); k--) years.push(k)
  return (
    <div className="btn-group no-print day-picker">
      <button className="btn ghost sm" title="Hari sebelumnya" onClick={() => onChange(addDays(value, -1))}>‹</button>
      <select value={d} onChange={e => set(y, m, Number(e.target.value))} aria-label="Tanggal" style={{ width: 'auto' }}>
        {Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <select value={m} onChange={e => set(y, Number(e.target.value), d)} aria-label="Bulan" style={{ width: 'auto' }}>
        {BULAN.map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
      </select>
      <select value={y} onChange={e => set(Number(e.target.value), m, d)} aria-label="Tahun" style={{ width: 'auto' }}>
        {years.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <button className="btn ghost sm" title="Hari berikutnya" onClick={() => onChange(addDays(value, 1))}>›</button>
      {value !== todayIso() && <button className="btn ghost sm" onClick={() => onChange(todayIso())}>Hari ini</button>}
    </div>
  )
}

export default function FleetReports() {
  const { node } = useToast()
  const [date, setDate] = useState(todayIso)
  const [uj, setUj] = useState([])
  const [tb, setTb] = useState([])
  const [ex, setEx] = useState([])   // tambahan uang jalan, booked on their own date
  const [loading, setLoading] = useState(false)
  const [openRows, setOpenRows] = useState(() => new Set())
  const toggleRow = id => setOpenRows(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    const sel = 'id,plate,driver_name,muatan,estimasi_muat,borongan,bbm_liter,price_per_liter,bbm_rupiah,potongan_susut,potongan_ban,potongan_sparepart,potongan_pm,potongan_lain,potongan_kasbon,jenis_potongan,selisih_bbm,selisih_bbm_liter,selisih_bbm_price,potongan_pihak,potongan_pihak_nama,tambahan_cuci,tambahan_steam,tambahan_tol,tambahan_bantuan,tambahan_bantuan_ket,is_retur,retur_date,retur_amount,keterangan,tembak_amount,tembak_potongan,tembak_jenis_potongan,rute,contract:fleet_contracts(control_no,origin,destination)'
    Promise.all([
      supabase.from('fleet_deliveries').select(sel).eq('tanggal', date).not('borongan', 'is', null),
      supabase.from('fleet_deliveries').select(sel).eq('tembak_released_date', date),
      // other contracts carried on the same slips (no money of their own)
      supabase.from('fleet_deliveries').select('id,parent_id,estimasi_muat,muatan,contract:fleet_contracts(control_no,origin,destination)').eq('tanggal', date).not('parent_id', 'is', null),
      supabase.from('fleet_extras').select('id,tanggal,amount,keterangan,beban,driver_name,delivery:fleet_deliveries(plate,driver_name,contract:fleet_contracts(control_no,origin,destination))').eq('tanggal', date).order('created_at'),
    ]).then(([a, b, c, x]) => {
      const parts = {}; (c.data || []).forEach(p => { (parts[p.parent_id] = parts[p.parent_id] || []).push(p) })
      setUj((a.data || []).map(d => ({ ...d, parts: parts[d.id] || [] }))); setTb(b.data || []); setEx(x.data || []); setLoading(false)
    })
  }, [date])

  // a slip without its contract yet is grouped by the route written on the uang jalan
  const route = d => d.contract ? `${d.contract.origin || '—'} - ${d.contract.destination || '—'}` : `${d.rute || '—'} · belum ada kontrak`
  const ujGroups = useMemo(() => groupBy(uj, route), [uj])
  const tbGroups = useMemo(() => groupBy(tb, route), [tb])

  const T = uj.reduce((a, d) => ({
    tonase: a.tonase + tonaseOf(d), borongan: a.borongan + num(d.borongan), peny: a.peny + penyOf(d),
    ltr: a.ltr + num(d.bbm_liter), bbm: a.bbm + num(d.bbm_rupiah),
    pot: a.pot + potOf(d), lain: a.lain + lainOf(d), sisa: a.sisa + ujNet(d),
  }), { tonase: 0, borongan: 0, peny: 0, ltr: 0, bbm: 0, pot: 0, lain: 0, sisa: 0 })
  const totalTb = tb.reduce((a, d) => a + tbNet(d), 0)
  const totalEx = ex.reduce((a, x) => a + num(x.amount), 0)

  return (
    <>
      <div className="topbar">
        <div><h1>Daily report</h1><div className="sub">Laporan Borongan & Uang Tembak</div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(() => { const ids = uj.filter(d => detailLines(d).length).map(d => d.id); const allOpen = ids.length > 0 && ids.every(id => openRows.has(id));
            return ids.length > 0 ? <button className="btn ghost no-print" onClick={() => setOpenRows(allOpen ? new Set() : new Set(ids))}>{allOpen ? 'Collapse all' : 'Expand all'}</button> : null })()}
          <DayPicker value={date} onChange={setDate} />
          <button className="btn ghost no-print" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1200 }}>
        {loading ? <Spinner /> : (uj.length === 0 && tb.length === 0 && ex.length === 0) ? (
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
                            <td>{i + 1}</td><td className="mono nowrap">{d.plate || '—'}</td><td>{d.driver_name || '—'}</td>
                            <td className="r mono">{nf(tonaseOf(d))}</td><td className="r mono">{nm(d.borongan)}</td><td className="r mono">{penyOf(d) ? nm(penyOf(d)) : ''}</td>
                            <td className="r mono">{nf(d.bbm_liter)}</td><td className="r mono">{nm(d.price_per_liter)}</td><td className="r mono">{nm(d.bbm_rupiah)}</td>
                            <td className="r mono">{nm(potOf(d))}</td><td className="r mono">{nm(lainOf(d))}</td>
                            <td className="r mono">{nm(ujNet(d))}</td><td>{d.is_retur ? <span className="lb-retur">RETUR{d.retur_date ? ` ${fmtShort(d.retur_date)}` : ' (belum kembali)'}{d.retur_amount != null ? ` · Rp ${nm(d.retur_amount)}` : ''} </span> : null}{d.parts?.length ? <span className="part-badge" style={{ marginLeft: 0, marginRight: 6 }}>+ {d.parts.map(p => `${p.contract?.control_no || '—'} ${p.contract?.origin || '—'}-${p.contract?.destination || '—'}`).join(', ')}</span> : null}{d.keterangan || ''}{det.length ? <span className="lb-caret">{open ? ' ▾' : ' ▸'}</span> : ''}</td>
                          </tr>
                          {open && det.map(([label, amt, grp], k) => (
                            <tr className="lb-detail" key={d.id + 'd' + k}>
                              <td></td><td></td><td colSpan={3}>↳ {label}</td>
                              <td className="r mono">{grp === 'peny' ? sgn(amt) : ''}</td>
                              <td></td><td></td><td></td>
                              <td className="r mono">{grp === 'pot' ? sgn(amt) : ''}</td>
                              <td className="r mono">{grp === 'lain' ? sgn(amt) : ''}</td>
                              <td></td><td></td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                ))}
                <tr className="lb-total">
                  <td colSpan={3}>Total</td><td className="r mono">{nf(T.tonase)}</td><td className="r mono">{nm(T.borongan)}</td><td className="r mono">{nm(T.peny)}</td>
                  <td className="r mono">{nf(T.ltr)}</td><td></td><td className="r mono">{nm(T.bbm)}</td>
                  <td className="r mono">{nm(T.pot)}</td><td className="r mono">{nm(T.lain)}</td><td className="r mono">{nm(T.sisa)}</td><td></td>
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
                            <td className="r mono">{nm(d.tembak_amount)}</td><td className="r mono">{nm(d.tembak_potongan)}</td><td>{d.tembak_jenis_potongan || ''}</td>
                            <td className="r mono">{nm(tbNet(d))}</td></tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="lb-total"><td colSpan={6}>Total Uang Tembak</td><td className="r mono">{nm(totalTb)}</td></tr>
                  </tbody>
                </table></div>
              </div>
            )}

            {ex.length > 0 && (
              <div style={{ marginTop: 30 }}>
                <div className="rep-head"><div className="rep-title">TAMBAHAN UANG JALAN</div></div>
                <div className="dk-wrap"><table className="lb-tbl">
                  <thead><tr><th>No</th><th>BK</th><th>Penerima</th><th>Rute / Kontrak</th><th className="r">Jumlah</th><th>Beban</th><th>Keterangan</th></tr></thead>
                  <tbody>
                    {ex.map((x, i) => (
                      <tr key={x.id}><td>{i + 1}</td><td className="mono">{x.delivery?.plate || '—'}</td><td>{x.driver_name || x.delivery?.driver_name || '—'}</td>
                        <td>{x.delivery?.contract ? `${x.delivery.contract.origin || '—'} - ${x.delivery.contract.destination || '—'} · ${x.delivery.contract.control_no || ''}` : '—'}</td>
                        <td className="r mono">{nm(x.amount)}</td><td>{x.beban === 'supir' ? 'Potong supir' : 'Perusahaan'}</td><td>{x.keterangan || ''}</td></tr>
                    ))}
                    <tr className="lb-total"><td colSpan={4}>Total Tambahan</td><td className="r mono">{nm(totalEx)}</td><td colSpan={2}></td></tr>
                  </tbody>
                </table></div>
              </div>
            )}

            <div className="rep-total" style={{ marginTop: 24 }}>
              <div><span>Total Borongan (Sisa)</span><b>{rp(T.sisa)}</b></div>
              <div><span>Total Uang Tembak</span><b>{rp(totalTb)}</b></div>
              {totalEx > 0 && <div><span>Total Tambahan Uang Jalan</span><b>{rp(totalEx)}</b></div>}
              <div className="grand"><span>Grand Total</span><b>{rp(T.sisa + totalTb + totalEx)}</b></div>
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
