import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, isConfigured, fetchAll } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

// Laporan Kas — cash per day from the fleet: uang jalan given (sisa of the slips of that day), uang tembak paid,
// and retur (uang jalan a driver brought back because the trip did not happen, on the day it came back).
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const nf = n => (n === null || n === undefined || Math.round(Number(n)) === 0) ? '' : Math.round(Number(n)).toLocaleString('id-ID')   // money: whole rupiah
const rp = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID')
const ujNet = d => num(d.borongan) - num(d.selisih_bbm) - num(d.potongan_pihak) - num(d.bbm_rupiah) - (num(d.potongan_susut) + num(d.potongan_ban) + num(d.potongan_sparepart) + num(d.potongan_lain) + num(d.potongan_pm) + num(d.potongan_kasbon)) + num(d.tambahan_cuci) + num(d.tambahan_steam) + num(d.tambahan_tol) + num(d.tambahan_bantuan)
const tbNet = d => num(d.tembak_amount) - num(d.tembak_potongan)
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const addMonths = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}` }
const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
const fmtShort = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'
const SLIP = 'id,tanggal,plate,driver_name,borongan,bbm_rupiah,selisih_bbm,potongan_pihak,potongan_susut,potongan_ban,potongan_sparepart,potongan_lain,potongan_pm,potongan_kasbon,tambahan_cuci,tambahan_steam,tambahan_tol,tambahan_bantuan,is_retur,retur_date,rute,contract:fleet_contracts(control_no,origin,destination)'

export default function FleetKas() {
  const { show, node } = useToast()
  const [month, setMonth] = useState(thisMonth)
  const [loading, setLoading] = useState(true)
  const [uj, setUj] = useState([]), [tb, setTb] = useState([]), [rt, setRt] = useState([])
  const [open, setOpen] = useState(() => new Set())

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    let live = true
    setLoading(true)
    const a = `${month}-01`, z = `${addMonths(month, 1)}-01`
    Promise.all([
      fetchAll(() => supabase.from('fleet_deliveries').select(SLIP).is('parent_id', null).not('borongan', 'is', null).gte('tanggal', a).lt('tanggal', z)),
      fetchAll(() => supabase.from('fleet_deliveries').select('id,tanggal,plate,driver_name,tembak_amount,tembak_potongan,tembak_released_date,rute,contract:fleet_contracts(control_no,origin,destination)')
        .eq('tembak_released', true).gte('tembak_released_date', a).lt('tembak_released_date', z)),
      fetchAll(() => supabase.from('fleet_deliveries').select('id,tanggal,plate,driver_name,retur_date,retur_amount,rute,contract:fleet_contracts(control_no,origin,destination)')
        .eq('is_retur', true).gte('retur_date', a).lt('retur_date', z)),
    ]).then(([x, y, w]) => {
      if (!live) return
      const err = x.error || y.error || w.error
      if (err) show(err.message, true)
      setUj(x.data || []); setTb(y.data || []); setRt(w.data || []); setLoading(false); setOpen(new Set())
    })
    return () => { live = false }
  }, [month])

  const days = useMemo(() => {
    const m = new Map()
    const day = d => { if (!m.has(d)) m.set(d, { d, uj: [], tb: [], rt: [] }); return m.get(d) }
    uj.forEach(r => day(r.tanggal).uj.push(r))
    tb.forEach(r => day(r.tembak_released_date).tb.push(r))
    rt.forEach(r => day(r.retur_date).rt.push(r))
    return [...m.values()].sort((p, q) => p.d.localeCompare(q.d)).map(x => ({
      ...x, ujSum: x.uj.reduce((s, r) => s + ujNet(r), 0), tbSum: x.tb.reduce((s, r) => s + tbNet(r), 0), rtSum: x.rt.reduce((s, r) => s + num(r.retur_amount), 0),
    }))
  }, [uj, tb, rt])
  const T = days.reduce((s, x) => ({ uj: s.uj + x.ujSum, tb: s.tb + x.tbSum, rt: s.rt + x.rtSum, nuj: s.nuj + x.uj.length, ntb: s.ntb + x.tb.length, nrt: s.nrt + x.rt.length }),
    { uj: 0, tb: 0, rt: 0, nuj: 0, ntb: 0, nrt: 0 })
  const toggle = d => setOpen(s => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n })
  const route = r => r.contract ? `${r.contract.origin || '—'} → ${r.contract.destination || '—'}` : `${r.rute || '—'} (belum ada kontrak)`
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

  return (
    <>
      <div className="topbar">
        <div><h1>Laporan Kas</h1><div className="sub">Uang jalan dan uang tembak keluar, retur masuk — per hari</div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost sm" onClick={() => setMonth(m => addMonths(m, -1))}>‹</button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn ghost sm" onClick={() => setMonth(m => addMonths(m, 1))}>›</button>
          <button className="btn ghost no-print" onClick={() => setOpen(open.size ? new Set() : new Set(days.map(x => x.d)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
          <button className="btn ghost no-print" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1100 }}>
        {loading ? <Spinner /> : days.length === 0 ? (
          <Empty title={`Tidak ada kas di ${label}`}>No uang jalan, uang tembak or retur in this month.</Empty>
        ) : (
          <div className="report-print">
            <div className="rep-head"><div className="rep-title">LAPORAN KAS · ARMADA</div><div className="rep-date">{label}</div></div>
            <div className="dk-wrap"><table className="lb-tbl kas-tbl">
              <thead><tr>
                <th>Tanggal</th><th className="r">Uang jalan keluar</th><th className="r">Uang tembak keluar</th><th className="r">Retur masuk</th><th className="r">Kas keluar bersih</th>
              </tr></thead>
              <tbody>
                {days.map(x => (
                  <Fragment key={x.d}>
                    <tr className="kas-day" onClick={() => toggle(x.d)}>
                      <td>{fmtDay(x.d)} <span className="lb-caret">{open.has(x.d) ? '▾' : '▸'}</span></td>
                      <td className="r mono">{x.uj.length ? `${nf(x.ujSum)} (${x.uj.length})` : ''}</td>
                      <td className="r mono">{x.tb.length ? `${nf(x.tbSum)} (${x.tb.length})` : ''}</td>
                      <td className="r mono kas-in">{x.rt.length ? `${nf(x.rtSum)} (${x.rt.length})` : ''}</td>
                      <td className="r mono" style={{ fontWeight: 700 }}>{nf(x.ujSum + x.tbSum - x.rtSum) || '0'}</td>
                    </tr>
                    {open.has(x.d) && <>
                      {x.uj.map(r => (
                        <tr className="kas-detail" key={'u' + r.id}>
                          <td>↳ Uang jalan · {r.plate || '—'} · {r.driver_name || '—'}</td>
                          <td className="r mono">{nf(ujNet(r))}</td><td></td><td></td>
                          <td>{route(r)}{r.contract?.control_no ? ` · ${r.contract.control_no}` : ''}{r.is_retur ? <span className="lb-retur"> · RETUR {fmtShort(r.retur_date)}</span> : ''}</td>
                        </tr>
                      ))}
                      {x.tb.map(r => (
                        <tr className="kas-detail" key={'t' + r.id}>
                          <td>↳ Uang tembak · {r.plate || '—'} · {r.driver_name || '—'}</td>
                          <td></td><td className="r mono">{nf(tbNet(r))}</td><td></td>
                          <td>{route(r)} · uang jalan {fmtShort(r.tanggal)}</td>
                        </tr>
                      ))}
                      {x.rt.map(r => (
                        <tr className="kas-detail" key={'r' + r.id}>
                          <td>↳ Retur · {r.plate || '—'} · {r.driver_name || '—'}</td>
                          <td></td><td></td><td className="r mono kas-in">{nf(r.retur_amount)}</td>
                          <td>{route(r)} · uang jalan {fmtShort(r.tanggal)}</td>
                        </tr>
                      ))}
                    </>}
                  </Fragment>
                ))}
                <tr className="lb-total">
                  <td>Total {label}</td>
                  <td className="r mono">{nf(T.uj)} ({T.nuj})</td>
                  <td className="r mono">{nf(T.tb)} ({T.ntb})</td>
                  <td className="r mono">{nf(T.rt)} ({T.nrt})</td>
                  <td className="r mono">{nf(T.uj + T.tb - T.rt)}</td>
                </tr>
              </tbody>
            </table></div>
            <div className="rep-total" style={{ marginTop: 24 }}>
              <div><span>Uang jalan keluar</span><b>{rp(T.uj)}</b></div>
              <div><span>Uang tembak keluar</span><b>{rp(T.tb)}</b></div>
              <div><span>Retur masuk</span><b>− {rp(T.rt)}</b></div>
              <div className="grand"><span>Kas keluar bersih</span><b>{rp(T.uj + T.tb - T.rt)}</b></div>
            </div>
          </div>
        )}
      </div>
      {node}
    </>
  )
}
