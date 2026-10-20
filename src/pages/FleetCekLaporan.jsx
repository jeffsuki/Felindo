import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, isConfigured, fetchAll } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

// Cek Laporan (sementara) — the app's uang jalan AND uang tembak laid out like the Excel
// "LAPORAN BORONGAN HARIAN": route groups, the lines under each slip (selisih BBM, potongan ANS/MNA,
// tambahan), the uang tembak paid that day under TAMBAHAN, and one Total row. Its Total Sisa is the
// number to compare with the Total row of the Excel sheet of the same day.
// Temporary: for checking the imported data against the Excel. The Daily Report stays the real report.
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const nf = n => (n === null || n === undefined || n === '' || Number(n) === 0) ? '' : Number(n).toLocaleString('id-ID')
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const addMonths = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}` }
const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })
const fmtTgl = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''
const fmtDm = iso => iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}` : '—'
const SLIP = 'id,tanggal,plate,driver_name,estimasi_muat,muatan,borongan,bbm_liter,price_per_liter,bbm_rupiah,potongan_susut,potongan_ban,potongan_sparepart,potongan_lain,potongan_pm,potongan_kasbon,'
  + 'selisih_bbm,selisih_bbm_price,potongan_pihak,potongan_pihak_nama,tambahan_cuci,tambahan_steam,tambahan_tol,tambahan_bantuan,tambahan_bantuan_ket,'
  + 'is_retur,retur_date,keterangan,rute,cek_note,contract:fleet_contracts(control_no,origin,destination)'
const TB = 'id,tanggal,plate,driver_name,tembak_amount,tembak_potongan,tembak_jenis_potongan,tembak_released_date,rute,contract:fleet_contracts(control_no,origin,destination)'
const routeOf = d => d.contract ? `${d.contract.origin || '—'} - ${d.contract.destination || '—'}` : `${d.rute || '—'} (belum ada kontrak)`
const COLS = ['tonase', 'borongan', 'ltr', 'bbml', 'tbbm', 'susut', 'pm', 'lain', 'sisa']

// One slip as the Excel writes it: the slip row, then a line for each adjustment under it.
function slipLines(d, tonase) {
  const sel = num(d.selisih_bbm)
  const lain = num(d.potongan_lain) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_kasbon)
  const tbbm = num(d.bbm_rupiah) + sel                       // the sheet's Total BBM is liters × the full price
  const ret = d.is_retur ? `RETUR${d.retur_date ? ' ' + fmtDm(d.retur_date) : ' (belum kembali)'}` : ''
  const head = {
    kind: 'slip', id: d.id, plate: d.plate, driver: d.driver_name, tonase, borongan: num(d.borongan),
    ltr: num(d.bbm_liter), bbml: sel ? num(d.price_per_liter) + num(d.selisih_bbm_price) : num(d.price_per_liter), tbbm,
    susut: num(d.potongan_susut), pm: num(d.potongan_pm), lain,
    sisa: num(d.borongan) - tbbm - num(d.potongan_susut) - num(d.potongan_pm) - lain,
    ket: [ret, d.keterangan].filter(Boolean).join(' · '), cek: d.cek_note,
  }
  const out = [head]
  const sub = (key, label, amt, extra = {}) => out.push({ kind: 'sub', id: d.id + '/' + key, driver: label, borongan: amt, sisa: amt, ...extra })
  if (sel) sub('sel', 'SELISIH BBM', -sel, { bbml: num(d.price_per_liter), tbbm: -sel, sisa: 0 })
  if (num(d.potongan_pihak)) sub('pihak', `POTONGAN DARI ${d.potongan_pihak_nama || 'PIHAK'}`, -num(d.potongan_pihak))
  if (num(d.tambahan_cuci)) sub('cuci', 'TAMBAHAN', num(d.tambahan_cuci), { ket: 'CUCI TANGKI' })
  if (num(d.tambahan_steam)) sub('steam', 'TAMBAHAN', num(d.tambahan_steam), { ket: 'DOUBLE STEAM' })
  if (num(d.tambahan_tol)) sub('tol', 'TAMBAHAN', num(d.tambahan_tol), { ket: 'UANG JEMBATAN / TOL' })
  if (num(d.tambahan_bantuan)) sub('bantuan', 'TAMBAHAN', num(d.tambahan_bantuan), { ket: d.tambahan_bantuan_ket || 'BANTUAN' })
  return out
}
const tembakLine = d => ({
  kind: 'tembak', id: 't' + d.id, plate: d.plate, driver: d.driver_name,
  borongan: num(d.tembak_amount), susut: num(d.tembak_potongan), sisa: num(d.tembak_amount) - num(d.tembak_potongan),
  ket: `TEMBAK · ${d.contract ? `${d.contract.origin || '—'} - ${d.contract.destination || '—'}` : (d.rute || '—')} · uang jalan ${fmtDm(d.tanggal)}${d.tembak_jenis_potongan ? ' · pot ' + d.tembak_jenis_potongan : ''}`,
})
const sumLines = lines => COLS.reduce((t, k) => ({ ...t, [k]: lines.reduce((a, l) => a + (k === 'bbml' ? 0 : num(l[k])), 0) }), {})

// A day's sheet: route groups of slips, then the TAMBAHAN section with the uang tembak paid that day.
function sheetOf(slips, tembaks, partsKg) {
  const groups = new Map()
  for (const d of [...slips].sort((a, b) => routeOf(a).localeCompare(routeOf(b)) || String(a.plate || '').localeCompare(String(b.plate || '')))) {
    const k = routeOf(d)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(...slipLines(d, (num(d.estimasi_muat) || num(d.muatan)) + (partsKg[d.id] || 0)))
  }
  const tb = [...tembaks].sort((a, b) => String(a.driver_name || '').localeCompare(String(b.driver_name || '')) || String(a.tanggal || '').localeCompare(String(b.tanggal || ''))).map(tembakLine)
  const all = [...[...groups.values()].flat(), ...tb]
  return {
    groups: [...groups.entries()], tembak: tb, total: sumLines(all),
    ujSisa: slips.reduce((a, d) => a + sumLines(slipLines(d, 0)).sisa, 0), tbSisa: tb.reduce((a, l) => a + l.sisa, 0),
  }
}

export default function FleetCekLaporan() {
  const { show, node } = useToast()
  const [month, setMonth] = useState(thisMonth)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ slips: [], parts: [], tembak: [] })
  const [day, setDay] = useState(null)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    let live = true
    setLoading(true)
    const a = `${month}-01`, z = `${addMonths(month, 1)}-01`
    Promise.all([
      fetchAll(() => supabase.from('fleet_deliveries').select(SLIP).is('parent_id', null).not('borongan', 'is', null).gte('tanggal', a).lt('tanggal', z)),
      fetchAll(() => supabase.from('fleet_deliveries').select('parent_id,estimasi_muat,muatan').not('parent_id', 'is', null).gte('tanggal', a).lt('tanggal', z)),
      fetchAll(() => supabase.from('fleet_deliveries').select(TB).is('parent_id', null).eq('tembak_released', true).gte('tembak_released_date', a).lt('tembak_released_date', z)),
    ]).then(([x, p, y]) => {
      if (!live) return
      const err = x.error || p.error || y.error
      if (err) show(err.message, true)
      setData({ slips: x.data || [], parts: p.data || [], tembak: y.data || [] }); setLoading(false)
    })
    return () => { live = false }
  }, [month])

  const days = useMemo(() => {
    const partsKg = {}
    data.parts.forEach(p => { partsKg[p.parent_id] = (partsKg[p.parent_id] || 0) + (num(p.estimasi_muat) || num(p.muatan)) })
    const m = new Map()
    const at = d => { if (!m.has(d)) m.set(d, { slips: [], tembak: [] }); return m.get(d) }
    data.slips.forEach(d => at(d.tanggal).slips.push(d))
    data.tembak.forEach(d => at(d.tembak_released_date).tembak.push(d))
    return [...m.entries()].sort((p, q) => p[0].localeCompare(q[0])).map(([d, v]) => ({ d, n: v.slips.length, nt: v.tembak.length, ...sheetOf(v.slips, v.tembak, partsKg) }))
  }, [data])
  // open the latest day of the month that has something
  useEffect(() => { setDay(d => (d && days.some(x => x.d === d)) ? d : (days.length ? days[days.length - 1].d : null)) }, [days])

  const sel = days.find(x => x.d === day)
  const idx = days.findIndex(x => x.d === day)
  const M = days.reduce((t, x) => ({ n: t.n + x.n, nt: t.nt + x.nt, bor: t.bor + x.total.borongan, sisa: t.sisa + x.total.sisa, uj: t.uj + x.ujSisa, tb: t.tb + x.tbSisa }), { n: 0, nt: 0, bor: 0, sisa: 0, uj: 0, tb: 0 })
  const years = []; for (let y = Math.max(Number(month.slice(0, 4)), new Date().getFullYear()); y >= Math.min(Number(month.slice(0, 4)), 2025); y--) years.push(y)
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

  return (
    <>
      <div className="topbar">
        <div><h1>Cek Laporan <span className="ck-temp">sementara</span></h1><div className="sub">Borongan + uang tembak dalam satu laporan, seperti Excel Laporan Borongan Harian — cocokkan Total Sisa per hari</div></div>
        <div className="btn-group no-print">
          <button className="btn ghost sm" onClick={() => setMonth(m => addMonths(m, -1))}>‹</button>
          <select value={month.slice(5, 7)} onChange={e => setMonth(`${month.slice(0, 4)}-${e.target.value}`)} style={{ width: 'auto' }} aria-label="Bulan">
            {MONTHS.map((l, i) => <option key={l} value={String(i + 1).padStart(2, '0')}>{l}</option>)}
          </select>
          <select value={month.slice(0, 4)} onChange={e => setMonth(`${e.target.value}-${month.slice(5, 7)}`)} style={{ width: 'auto' }} aria-label="Tahun">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn ghost sm" onClick={() => setMonth(m => addMonths(m, 1))}>›</button>
          <button className="btn ghost" onClick={() => window.print()} disabled={!sel}>Print hari ini</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1250 }}>
        {loading ? <Spinner /> : days.length === 0 ? (
          <Empty title={`Tidak ada data di ${label}`}>No uang jalan or uang tembak in this month.</Empty>
        ) : (
          <>
            <div className="ck-ov no-print">
              <div className="dk-wrap"><table className="lb-tbl">
                <thead><tr>
                  <th>Tanggal</th><th className="r">Uang jalan</th><th className="r">Uang tembak</th>
                  <th className="r">Total Borongan</th><th className="r">Total Sisa</th><th className="r">dari uang jalan</th><th className="r">dari uang tembak</th>
                </tr></thead>
                <tbody>
                  {days.map(x => (
                    <tr key={x.d} className={'clickrow' + (x.d === day ? ' ck-on' : '')} onClick={() => setDay(x.d)}>
                      <td>{fmtDay(x.d)}</td><td className="r mono">{x.n || ''}</td><td className="r mono">{x.nt || ''}</td>
                      <td className="r mono">{nf(x.total.borongan)}</td><td className="r mono" style={{ fontWeight: 700 }}>{nf(x.total.sisa) || '0'}</td>
                      <td className="r mono muted">{nf(x.ujSisa)}</td><td className="r mono muted">{nf(x.tbSisa)}</td>
                    </tr>
                  ))}
                  <tr className="lb-total">
                    <td>Total {label}</td><td className="r mono">{M.n}</td><td className="r mono">{M.nt}</td>
                    <td className="r mono">{nf(M.bor)}</td><td className="r mono">{nf(M.sisa)}</td><td className="r mono">{nf(M.uj)}</td><td className="r mono">{nf(M.tb)}</td>
                  </tr>
                </tbody>
              </table></div>
              <div className="ck-note">Total Sisa = baris <b>Total</b> kolom <b>Sisa</b> di lembar Excel hari itu. Kalau berbeda, biasanya karena uang tembak untuk trip 2025 (belum ada di aplikasi), atau tambahan yang dibayar di hari lain (di aplikasi ikut tanggal slip-nya).</div>
            </div>

            {sel && (
              <div className="report-print" style={{ marginTop: 22 }}>
                <div className="rep-head">
                  <div className="rep-title">LAPORAN BORONGAN HARIAN <span className="ck-temp">cek</span></div>
                  <div className="rep-date" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn ghost sm no-print" disabled={idx <= 0} onClick={() => setDay(days[idx - 1].d)}>‹</button>
                    Tgl: {fmtTgl(sel.d)}
                    <button className="btn ghost sm no-print" disabled={idx >= days.length - 1} onClick={() => setDay(days[idx + 1].d)}>›</button>
                  </div>
                </div>
                <div className="dk-wrap"><table className="lb-tbl ck-tbl">
                  <thead>
                    <tr>
                      <th rowSpan={2}>No</th><th rowSpan={2}>BK</th><th rowSpan={2}>Nama Supir</th><th rowSpan={2} className="r">Tonase</th><th rowSpan={2} className="r">Borongan</th>
                      <th colSpan={3} className="c">BBM</th><th colSpan={3} className="c">Potongan</th><th rowSpan={2} className="r">Sisa</th><th rowSpan={2}>Keterangan</th>
                    </tr>
                    <tr><th className="r">LTR</th><th className="r">BBM/L</th><th className="r">Total BBM</th><th className="r">Susut</th><th className="r">pm</th><th className="r">Lain-lain</th></tr>
                  </thead>
                  <tbody>
                    {sel.groups.map(([route, lines]) => {
                      let no = 0
                      return (
                        <Fragment key={route}>
                          <tr className="lb-group"><td colSpan={13}>{route}</td></tr>
                          {lines.map(l => <Line key={l.id} l={l} no={l.kind === 'slip' ? ++no : null} />)}
                        </Fragment>
                      )
                    })}
                    {sel.tembak.length > 0 && <>
                      <tr className="lb-group"><td colSpan={13}>TAMBAHAN · uang tembak dibayar hari ini</td></tr>
                      {sel.tembak.map((l, i) => <Line key={l.id} l={l} no={i + 1} />)}
                    </>}
                    <tr className="lb-total">
                      <td colSpan={3}>Total</td><td className="r mono">{nf(sel.total.tonase)}</td><td className="r mono">{nf(sel.total.borongan)}</td>
                      <td className="r mono">{nf(sel.total.ltr)}</td><td></td><td className="r mono">{nf(sel.total.tbbm)}</td>
                      <td className="r mono">{nf(sel.total.susut)}</td><td className="r mono">{nf(sel.total.pm)}</td><td className="r mono">{nf(sel.total.lain)}</td>
                      <td className="r mono">{nf(sel.total.sisa) || '0'}</td><td></td>
                    </tr>
                  </tbody>
                </table></div>
                <div className="rep-total" style={{ marginTop: 18 }}>
                  <div><span>Uang jalan (sisa) · {sel.n} slip</span><b>Rp {Number(sel.ujSisa).toLocaleString('id-ID')}</b></div>
                  <div><span>Uang tembak · {sel.nt}</span><b>Rp {Number(sel.tbSisa).toLocaleString('id-ID')}</b></div>
                  <div className="grand"><span>Total Sisa (cocokkan dengan Excel)</span><b>Rp {Number(sel.total.sisa).toLocaleString('id-ID')}</b></div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {node}
    </>
  )
}

function Line({ l, no }) {
  const sub = l.kind === 'sub'
  return (
    <tr className={sub ? 'ck-sub' : l.kind === 'tembak' ? 'ck-tembak' : ''}>
      <td>{no ?? ''}</td><td className="mono nowrap">{sub ? '' : (l.plate || '—')}</td><td>{sub ? l.driver : (l.driver || '—')}</td>
      <td className="r mono">{nf(l.tonase)}</td><td className="r mono">{nf(l.borongan)}</td>
      <td className="r mono">{nf(l.ltr)}</td><td className="r mono">{nf(l.bbml)}</td><td className="r mono">{nf(l.tbbm)}</td>
      <td className="r mono">{nf(l.susut)}</td><td className="r mono">{nf(l.pm)}</td><td className="r mono">{nf(l.lain)}</td>
      <td className="r mono">{l.kind === 'sub' && l.sisa === 0 ? '0' : nf(l.sisa)}</td><td>{l.ket || ''}{l.cek ? <span className="ck-cek" title={l.cek}> ⚠ perlu dicek</span> : null}</td>
    </tr>
  )
}
