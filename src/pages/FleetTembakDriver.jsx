import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'

const JENIS = ['Susut', 'Ganti Ban', 'Ganti Spare Part', 'Lainnya']
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const susutOf = d => (d.muatan != null && d.bongkar != null) ? Number(d.muatan) - Number(d.bongkar) : null
const isReady = d => d.muatan != null && d.bongkar != null
const sisaOf = d => num(d.tembak_amount) - num(d.tembak_potongan)
const qualifies = d => {
  const s = susutOf(d); const tol = d.contract?.susut_tolerance
  if (s == null || tol == null) return null
  return s <= Number(tol) * Number(d.muatan)
}

export default function FleetTembakDriver() {
  const { name } = useParams()
  const driver = decodeURIComponent(name || '')
  const nav = useNavigate()
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('outstanding')
  const [sel, setSel] = useState(new Set())
  const [releasing, setReleasing] = useState(null)
  const [printBatch, setPrintBatch] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, rl] = await Promise.all([
      supabase.from('fleet_deliveries')
        .select('id,do_no,tanggal,plate,driver_name,muatan,bongkar,tembak_amount,tembak_potongan,tembak_jenis_potongan,tembak_released,tembak_released_date,tembak_release_id,contract:fleet_contracts(control_no,origin,destination,susut_tolerance)')
        .eq('driver_name', driver).order('tanggal', { ascending: false, nullsFirst: false }),
      supabase.from('tembak_releases').select('*').eq('driver_name', driver).order('release_no', { ascending: false }),
    ])
    setRows(dl.data || []); setBatches(rl.data || []); setLoading(false)
  }
  useEffect(() => { load() }, [driver])

  const outstanding = rows.filter(d => !d.tembak_released)
  const ready = outstanding.filter(isReady).length
  const outTrips = useMemo(() => rows.filter(d => !d.tembak_released), [rows])
  const releaseGroups = useMemo(() => batches.map(b => ({
    ...b, trips: rows.filter(d => d.tembak_release_id === b.id),
  })).filter(b => b.trips.length > 0), [batches, rows])

  function toggleSel(id) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function openRelease() {
    const chosen = outTrips.filter(d => sel.has(d.id) && isReady(d))
    if (!chosen.length) return show('Select at least one ready trip.', true)
    setReleasing(chosen)
  }
  async function confirmRelease(fills) {
    const today = new Date().toISOString().slice(0, 10)
    const { data: batch, error } = await supabase.from('tembak_releases').insert({ driver_name: driver, released_date: today }).select('id,release_no,code').single()
    if (error) return show(error.message, true)
    for (const f of fills) {
      const { error: e2 } = await supabase.from('fleet_deliveries').update({
        tembak_released: true, tembak_released_date: today, tembak_release_id: batch.id,
        tembak_amount: num(f.uang), tembak_potongan: num(f.potongan), tembak_jenis_potongan: f.jenis || null,
      }).eq('id', f.id)
      if (e2) return show(e2.message, true)
    }
    show(`Released ${fills.length} uang tembak (${batch.code || '#' + batch.release_no}).`); setReleasing(null); setSel(new Set()); load()
  }
  async function undo(id) {
    const { error } = await supabase.from('fleet_deliveries').update({ tembak_released: false, tembak_released_date: null, tembak_release_id: null }).eq('id', id)
    if (error) return show(error.message, true)
    show('Moved back to outstanding.'); load()
  }

  if (loading) return (<><div className="topbar"><div><h1>{driver}</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>{driver}</h1><div className="sub">Uang tembak · {outstanding.length} outstanding · {ready} ready</div></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={() => nav('/fleet/tembak')}>← All drivers</button>
          <div className="seg-lens">
            {[['outstanding', 'Outstanding'], ['releases', 'Releases']].map(([v, l]) => (<button key={v} className={view === v ? 'on' : ''} onClick={() => { setView(v); setSel(new Set()) }}>{l}</button>))}
          </div>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1060 }}>
        {view === 'outstanding' ? (
          outTrips.length === 0 ? <Empty title="Nothing outstanding">All caught up.</Empty> : (
            <>
              <div className="dk-wrap">
                <table className="dk-tbl ct-tbl">
                  <thead><tr>
                    <th style={{ width: 34 }}></th><th>Date</th><th>Plate</th><th>Route</th><th className="r">Muatan</th><th className="r">Susut</th><th>Qualifies</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    {outTrips.map(d => {
                      const s = susutOf(d); const q = qualifies(d); const r1 = isReady(d)
                      return (
                        <tr key={d.id}>
                          <td>{r1 && <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleSel(d.id)} />}</td>
                          <td>{fmtDate(d.tanggal)}</td><td className="mono">{d.plate || '—'}</td>
                          <td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td>
                          <td className="r mono">{d.muatan != null ? Number(d.muatan).toLocaleString() : '—'}</td>
                          <td className="r mono">{s != null ? s.toLocaleString() : '—'}</td>
                          <td>{q == null ? '—' : q ? <Badge tone="ok">Yes</Badge> : <Badge tone="urgent">No</Badge>}</td>
                          <td>{r1 ? <Badge tone="accent">Ready</Badge> : <Badge tone="muted">Pending</Badge>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="btn-group" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={openRelease}>Release selected ({outTrips.filter(d => sel.has(d.id)).length})</button>
                <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>Only “ready” trips can be released.</span>
              </div>
            </>
          )
        ) : (
          releaseGroups.length === 0 ? <Empty title="No releases yet">Released payouts show here, each reprintable.</Empty> : (
            <div className="clist">
              {releaseGroups.map(b => {
                const total = b.trips.reduce((a, d) => a + sisaOf(d), 0)
                return (
                  <div className="crow open" key={b.id}>
                    <div className="crow-head" style={{ cursor: 'default' }}>
                      <span className="fc-ctrl" style={{ fontSize: 12 }}>{b.code || '#' + b.release_no}</span>
                      <div className="crow-desc"><div className="d">{fmtDate(b.released_date)}</div><div className="m">{b.trips.length} trip{b.trips.length === 1 ? '' : 's'} · total sisa {rp(total)}</div></div>
                      <button className="btn ghost sm" onClick={() => setPrintBatch(b)}>Print</button>
                    </div>
                    <div className="crow-detail">
                      <div className="dk-wrap">
                        <table className="dk-tbl ct-tbl">
                          <thead><tr><th>Date</th><th>Route</th><th className="r">Uang Tembak</th><th className="r">Potongan</th><th>Jenis</th><th className="r">Sisa</th><th></th></tr></thead>
                          <tbody>
                            {b.trips.map(d => (
                              <tr key={d.id}>
                                <td>{fmtDate(d.tanggal)}</td>
                                <td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td>
                                <td className="r mono">{rp(d.tembak_amount)}</td>
                                <td className="r mono">{rp(d.tembak_potongan)}</td>
                                <td>{d.tembak_jenis_potongan || '—'}</td>
                                <td className="r mono" style={{ fontWeight: 700 }}>{rp(sisaOf(d))}</td>
                                <td><button className="btn ghost sm" onClick={() => undo(d.id)}>Undo</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
      {releasing && <ReleaseTable trips={releasing} onConfirm={confirmRelease} onCancel={() => setReleasing(null)} />}
      {printBatch && <PayoutSlip driver={driver} batch={printBatch} trips={printBatch.trips} onClose={() => setPrintBatch(null)} />}
      {node}
    </>
  )
}

function ReleaseTable({ trips, onConfirm, onCancel }) {
  const [f, setF] = useState(() => Object.fromEntries(trips.map(d => [d.id, { uang: d.tembak_amount ?? '', potongan: d.tembak_potongan ?? '', jenis: d.tembak_jenis_potongan || '' }])))
  const set = (id, k, v) => setF(s => ({ ...s, [id]: { ...s[id], [k]: v } }))
  const totalSisa = trips.reduce((a, d) => a + (num(f[d.id]?.uang) - num(f[d.id]?.potongan)), 0)
  return (
    <div className="slip-scrim">
      <div className="rel-modal">
        <div className="slip-h" style={{ fontSize: 18 }}>Release uang tembak · {trips.length} trip{trips.length === 1 ? '' : 's'}</div>
        <div className="dk-wrap" style={{ marginTop: 12, maxHeight: '55vh', overflowY: 'auto' }}>
          <table className="dk-tbl ct-tbl">
            <thead><tr><th>Date</th><th>Route</th><th className="r">Uang Tembak</th><th className="r">Potongan</th><th>Jenis Potongan</th><th className="r">Sisa</th></tr></thead>
            <tbody>
              {trips.map(d => {
                const sisa = num(f[d.id]?.uang) - num(f[d.id]?.potongan)
                return (
                  <tr key={d.id}>
                    <td>{fmtDate(d.tanggal)}</td>
                    <td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td>
                    <td><input type="number" style={{ width: 120, textAlign: 'right' }} value={f[d.id].uang} onChange={e => set(d.id, 'uang', e.target.value)} /></td>
                    <td><input type="number" style={{ width: 120, textAlign: 'right' }} value={f[d.id].potongan} onChange={e => set(d.id, 'potongan', e.target.value)} /></td>
                    <td><select value={f[d.id].jenis} onChange={e => set(d.id, 'jenis', e.target.value)}><option value="">—</option>{JENIS.map(j => <option key={j} value={j}>{j}</option>)}</select></td>
                    <td className="r mono" style={{ fontWeight: 700 }}>{rp(sisa)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <span style={{ fontWeight: 700 }}>Total Sisa: {rp(totalSisa)}</span>
          <div className="btn-group" style={{ marginLeft: 'auto' }}>
            <button className="btn primary" onClick={() => onConfirm(trips.map(d => ({ id: d.id, ...f[d.id] })))}>Confirm release</button>
            <button className="btn ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PayoutSlip({ driver, batch, trips, onClose }) {
  const total = trips.reduce((a, d) => a + sisaOf(d), 0)
  return (
    <div className="slip-scrim">
      <div className="slip-hp">
        <div className="slip-h">TANDA TERIMA UANG TEMBAK</div>
        <div className="slip-hp-meta">
          <div><b>Supir:</b> {driver}</div>
          <div><b>Tanggal:</b> {fmtDate(batch.released_date)}</div>
          <div><b>No. Release:</b> {batch.code || '#' + batch.release_no}</div>
          <div><b>Jumlah trip:</b> {trips.length}</div>
        </div>
        <table className="slip-hp-tbl">
          <thead><tr><th>TANGGAL</th><th>RUTE</th><th>UANG TEMBAK</th><th>POTONGAN</th><th>JENIS</th><th>SISA</th></tr></thead>
          <tbody>
            {trips.map(d => (
              <tr key={d.id}>
                <td>{fmtDate(d.tanggal)}</td>
                <td>{(d.contract?.origin || '—') + ' → ' + (d.contract?.destination || '—')}</td>
                <td className="r">{rp(d.tembak_amount)}</td>
                <td className="r">{rp(d.tembak_potongan)}</td>
                <td>{d.tembak_jenis_potongan || '—'}</td>
                <td className="r" style={{ fontWeight: 700 }}>{rp(sisaOf(d))}</td>
              </tr>
            ))}
            <tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 800 }}>TOTAL</td><td className="r" style={{ fontWeight: 800 }}>{rp(total)}</td></tr>
          </tbody>
        </table>
        <div className="slip-sign" style={{ marginTop: 40 }}><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
