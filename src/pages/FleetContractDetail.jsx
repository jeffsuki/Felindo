import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import { NumInput, fmtId } from '../components/NumInput'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('id-ID') + ' kg'
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)

const NUMF = ['estimasi_muat', 'muatan', 'bongkar', 'borongan', 'bbm_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_pm', 'potongan_lain', 'do_no']

export default function FleetContractDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { show, node } = useToast()
  const [c, setC] = useState(null)
  const [rows, setRows] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [ct, dl, tr, dr] = await Promise.all([
      supabase.from('fleet_contracts').select('*').eq('id', id).single(),
      supabase.from('fleet_deliveries').select('*').eq('contract_id', id).order('do_no', { ascending: true }),
      supabase.from('trucks').select('id,plate,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('name,nickname,status').eq('status', 'Active').order('name'),
    ])
    setC(ct.data || null); setRows(dl.data || []); setTrucks(tr.data || []); setDrivers(dr.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  const totals = useMemo(() => {
    const t = { muatan: 0, bongkar: 0, susut: 0, committed: 0, claim: 0 }
    const tol = Number(c?.susut_tolerance ?? 0)
    for (const d of rows) {
      t.muatan += Number(d.muatan || 0); t.bongkar += Number(d.bongkar || 0)
      if (d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') {
        const s = Number(d.muatan) - Number(d.bongkar)
        t.susut += s
        if (tol > 0) t.claim += Math.max(s - tol * Number(d.muatan), 0)
      }
      t.committed += Number(d.muatan ?? d.estimasi_muat ?? 0)
    }
    t.outstanding = Math.max(Number(c?.quantity_kg || 0) - t.committed, 0)
    return t
  }, [rows, c])
  const overTol = c && c.susut_tolerance != null && totals.muatan > 0 && (totals.susut / totals.muatan) > Number(c.susut_tolerance)

  function setCell(did, field, value) {
    setRows(rs => rs.map(r => r.id === did ? { ...r, [field]: value } : r))
  }
  async function saveField(did, field, raw) {
    const value = NUMF.includes(field) ? num(raw) : (raw === '' ? null : raw)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: value }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function saveTruck(did, truckId) {
    const t = trucks.find(x => x.id === truckId)
    setCell(did, 'truck_id', truckId || null); setCell(did, 'plate', t?.plate || null)
    const { error } = await supabase.from('fleet_deliveries').update({ truck_id: truckId || null, plate: t?.plate || null }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function addRow() {
    const nextNo = rows.reduce((m, d) => Math.max(m, d.do_no || 0), 0) + 1
    const { data, error } = await supabase.from('fleet_deliveries')
      .insert({ contract_id: id, do_no: nextNo, tanggal: new Date().toISOString().slice(0, 10) }).select('*').single()
    if (error) return show(error.message, true)
    setRows(rs => [...rs, data])
  }
  async function delRow(did) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== did))
  }

  if (loading) return (<><div className="topbar"><div><h1>Contract</h1></div></div><div className="content"><Spinner /></div></>)
  if (!c) return (<><div className="topbar"><div><h1>Contract</h1></div></div><div className="content"><Empty title="Not found">This contract doesn't exist.</Empty></div></>)

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Contract {c.control_no}</h1>
          <div className="sub">{c.client || '—'} · {c.origin || '—'} → {c.destination || '—'} · {c.commodity || '—'}</div>
        </div>
        <button className="btn ghost" onClick={() => nav('/fleet/contracts')}>← Contracts</button>
      </div>
      <div className="content">
        <div className="metrics">
          <div className="metric"><div className="k">Contracted</div><div className="v" style={{ fontSize: 18 }}>{kg(c.quantity_kg)}</div></div>
          <div className="metric"><div className="k">Loaded (real)</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.muatan)}</div></div>
          <div className="metric"><div className="k">Outstanding</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.outstanding)}</div></div>
          <div className="metric"><div className="k">Deliveries</div><div className="v" style={{ fontSize: 18 }}>{rows.length}</div></div>
          <div className="metric"><div className="k">Total Claim Susut</div><div className="v" style={{ fontSize: 18, color: totals.claim > 0 ? 'var(--urgent)' : undefined }}>{kg(totals.claim)}</div></div>
        </div>

        <div className="dk-wrap">
          <table className="dk-tbl">
            <thead>
              <tr>
                <th style={{ width: 44 }}>DO</th>
                <th style={{ width: 120 }}>Tanggal</th>
                <th style={{ width: 130 }}>Plat</th>
                <th style={{ width: 150 }}>Supir</th>
                <th style={{ width: 100 }}>Est. muat</th>
                <th style={{ width: 120 }}>Tgl muat</th>
                <th style={{ width: 100 }}>Muatan</th>
                <th style={{ width: 120 }}>Tgl bongkar</th>
                <th style={{ width: 100 }}>Bongkar</th>
                <th style={{ width: 90 }}>Susut</th>
                <th style={{ width: 100 }}>Claim susut</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No deliveries yet — add a row below.</td></tr>
              )}
              {rows.map(d => {
                const s = (d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') ? Number(d.muatan) - Number(d.bongkar) : null
                const rowOver = c.susut_tolerance != null && d.muatan > 0 && s != null && (s / Number(d.muatan)) > Number(c.susut_tolerance)
                return (
                  <tr key={d.id}>
                    <td><input value={d.do_no ?? ''} onChange={e => setCell(d.id, 'do_no', e.target.value)} onBlur={e => saveField(d.id, 'do_no', e.target.value)} /></td>
                    <td><input type="date" value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                    <td>
                      <select value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)}>
                        <option value="">{d.plate || '—'}</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }}>
                        <option value="">—</option>
                        {drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}{dr.nickname ? ` (${dr.nickname})` : ''}</option>)}
                        {d.driver_name && !drivers.some(x => x.name === d.driver_name) && <option value={d.driver_name}>{d.driver_name}</option>}
                      </select>
                    </td>
                    <td><NumInput value={d.estimasi_muat} onChange={n => setCell(d.id, 'estimasi_muat', n)} onCommit={n => saveField(d.id, 'estimasi_muat', n)} /></td>
                    <td><input type="date" value={d.tanggal_muat || ''} onChange={e => setCell(d.id, 'tanggal_muat', e.target.value)} onBlur={e => saveField(d.id, 'tanggal_muat', e.target.value)} /></td>
                    <td><NumInput value={d.muatan} onChange={n => setCell(d.id, 'muatan', n)} onCommit={n => saveField(d.id, 'muatan', n)} /></td>
                    <td><input type="date" value={d.tanggal_bongkar || ''} onChange={e => setCell(d.id, 'tanggal_bongkar', e.target.value)} onBlur={e => saveField(d.id, 'tanggal_bongkar', e.target.value)} /></td>
                    <td><NumInput value={d.bongkar} onChange={n => setCell(d.id, 'bongkar', n)} onCommit={n => saveField(d.id, 'bongkar', n)} /></td>
                    <td className="dk-susut" style={rowOver ? { color: 'var(--urgent)', fontWeight: 700 } : {}}>{s != null ? fmtId(s) : '—'}</td>
                    <td className="dk-susut" style={rowOver ? { color: 'var(--urgent)', fontWeight: 700 } : {}}>{(() => {
                      const tol = Number(c.susut_tolerance ?? 0)
                      if (s == null || !(tol > 0)) return '—'
                      const claim = Math.max(s - tol * Number(d.muatan), 0)
                      return claim > 0 ? fmtId(claim) : '0'
                    })()}</td>
                    <td className="dk-actions">
                      <button className="btn ghost sm void-btn" onClick={() => { if (confirm('Remove this delivery?')) delRow(d.id) }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={addRow}>+ Add delivery row</button>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Road-money slips are filled in the <b>Slip Uang Jalan</b> tab.</div>
      </div>

      {node}
    </>
  )
}
