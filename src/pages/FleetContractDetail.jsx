import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import { NumInput, fmtId } from '../components/NumInput'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('id-ID') + ' kg'
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)

const NUMF = ['estimasi_muat', 'muatan', 'bongkar', 'borongan', 'bbm_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_pm', 'potongan_lain', 'do_no', 'reject_oa_per_kg']

const qtyKnown = c => !!c && c.quantity_kg !== null && c.quantity_kg !== undefined && c.quantity_kg !== ''
// Tagihan of one row: billed kg × ongkos angkut; a reject is billed out and back on its muatan (OA + the return-leg rate).
function tagihanOf(c, d) {
  const oa = Number(c?.oa_per_kg || 0)
  if (!oa) return 0
  if (d.is_reject) return Number(d.muatan || 0) * (oa + Number(d.reject_oa_per_kg || 0))
  return Number((c.billing_basis === 'muatan' ? d.muatan : d.bongkar) || 0) * oa
}

export default function FleetContractDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { show, node } = useToast()
  const [c, setC] = useState(null)
  const [rows, setRows] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  // Daftar kontrol order: by DO number or by date. The order is fixed when the list loads or the sort changes,
  // so a row does not jump while its date or DO number is being edited.
  const [sortBy, setSortBy] = useState('do')       // 'do' | 'date'
  const [sortDir, setSortDir] = useState('asc')
  const [order, setOrder] = useState([])
  const [tick, setTick] = useState(0)
  function sort(col) { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('asc') } }
  const arrow = col => sortBy === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [ct, dl, tr, dr] = await Promise.all([
      supabase.from('fleet_contracts').select('*').eq('id', id).single(),
      // A load can carry two contracts: the slip row (main) and a part row on the other contract
      // (parent_id = main). Embed the other side of each link for the badges.
      supabase.from('fleet_deliveries')
        .select('*, parent:parent_id(do_no,contract:fleet_contracts(control_no)), parts:fleet_deliveries!parent_id(id,do_no,contract:fleet_contracts(control_no))')
        .eq('contract_id', id).eq('is_retur', false).order('do_no', { ascending: true }),   // a retur slip is not a delivery
      supabase.from('trucks').select('id,plate,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('name,nickname,status').eq('status', 'Active').order('name'),
    ])
    setC(ct.data || null); setRows(dl.data || []); setTrucks(tr.data || []); setDrivers(dr.data || []); setTick(t => t + 1)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])
  useEffect(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const n = v => (v === null || v === undefined || v === '') ? null : Number(v)
    const cmpDo = (a, b) => (n(a.do_no) === null) - (n(b.do_no) === null) || dir * ((n(a.do_no) ?? 0) - (n(b.do_no) ?? 0))
    const cmpDate = (a, b) => (!a.tanggal) - (!b.tanggal) || dir * String(a.tanggal || '').localeCompare(String(b.tanggal || ''))
    setOrder([...rows].sort((a, b) => sortBy === 'date' ? (cmpDate(a, b) || cmpDo(a, b)) : (cmpDo(a, b) || cmpDate(a, b))).map(d => d.id))
  }, [tick, sortBy, sortDir])   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const pos = new Map(order.map((rid, i) => [rid, i]))
    return [...rows].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9))
  }, [rows, order])

  const totals = useMemo(() => {
    const t = { muatan: 0, bongkar: 0, susut: 0, committed: 0, claim: 0 }
    const tol = Number(c?.susut_tolerance ?? 0)
    t.tagihan = 0; t.rejects = 0
    for (const d of rows) {
      t.tagihan += tagihanOf(c, d)
      if (d.is_reject) { t.rejects++; continue }      // a reject is billed but is no delivery for the contract
      t.muatan += Number(d.muatan || 0); t.bongkar += Number(d.bongkar || 0)
      if (d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') {
        const s = Number(d.muatan) - Number(d.bongkar)
        t.susut += s
        if (tol > 0) t.claim += Math.max(s - tol * Number(d.muatan), 0)
      }
      t.committed += Number(d.muatan ?? d.estimasi_muat ?? 0)
    }
    t.outstanding = Math.max(Number(c?.quantity_kg || 0) - t.committed, 0)
    t.over = qtyKnown(c) ? Math.max(t.muatan - Number(c.quantity_kg), 0) : 0
    t.noLoad = rows.filter(d => !d.is_reject && (d.muatan === null || d.muatan === undefined || d.muatan === '')).length
    return t
  }, [rows, c])
  async function setReject(d, on) {
    const msg = on ? 'Tandai muatan ini sebagai REJECT (ditolak, kembali ke asal)? Tidak dihitung sebagai muatan kontrak; ditagih pergi dan pulang.'
                   : 'Batalkan reject? Muatan ini dihitung lagi sebagai muatan kontrak.'
    if (!confirm(msg)) return
    const patch = on ? { is_reject: true } : { is_reject: false, reject_oa_per_kg: null }
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', d.id)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, ...patch } : r))
  }
  const [closing, setClosing] = useState(null)   // final quantity being entered for an open-ended contract
  async function closeContract() {
    const q = num(closing)
    if (!q || q <= 0) return show('Isi kuantitas akhir kontrak.', true)
    const { error } = await supabase.from('fleet_contracts').update({ quantity_kg: q }).eq('id', id)
    if (error) return show(error.message, true)
    setC(x => ({ ...x, quantity_kg: q })); setClosing(null); show('Kuantitas kontrak disimpan.')
  }
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
          <div className="metric"><div className="k">Contracted</div><div className="v" style={{ fontSize: 18 }}>{qtyKnown(c) ? kg(c.quantity_kg) : 'Terbuka'}</div></div>
          <div className="metric"><div className="k">Loaded (real)</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.muatan)}</div></div>
          {totals.over > 0
            ? <div className="metric"><div className="k">Lebih dari kontrak</div><div className="v" style={{ fontSize: 18, color: 'var(--urgent)' }}>{kg(totals.over)}</div></div>
            : <div className="metric"><div className="k">Outstanding</div><div className="v" style={{ fontSize: 18 }}>{qtyKnown(c) ? kg(totals.outstanding) : '—'}</div></div>}
          <div className="metric"><div className="k">Deliveries</div><div className="v" style={{ fontSize: 18 }}>{rows.length - totals.rejects}{totals.rejects > 0 && <span className="ct-rej-n"> + {totals.rejects} reject</span>}</div></div>
          <div className="metric"><div className="k">Tagihan OA{c.oa_per_kg ? ` · Rp ${Number(c.oa_per_kg).toLocaleString('id-ID')}/kg ${c.billing_basis === 'muatan' ? 'muatan' : 'bongkar'}` : ''}</div>
            <div className="v" style={{ fontSize: 18 }}>{c.oa_per_kg ? rp(Math.round(totals.tagihan)) : <span className="ct-open">Isi ongkos angkut (Edit)</span>}</div></div>
          <div className="metric"><div className="k">Total Claim Susut</div><div className="v" style={{ fontSize: 18, color: totals.claim > 0 ? 'var(--urgent)' : undefined }}>{kg(totals.claim)}</div></div>
        </div>

        {!qtyKnown(c) && (
          <div className="banner ct-open-banner">
            <b>Kontrak terbuka</b> — kuantitas belum diketahui. Setelah kontrak selesai, isi kuantitas akhirnya sesuai tagihan.
            {closing === null
              ? <button className="btn primary sm" onClick={() => setClosing(String(totals.muatan || ''))}>Tutup kontrak</button>
              : (<span className="ct-close">
                  <NumInput value={closing} onChange={setClosing} onCommit={setClosing} placeholder="kuantitas akhir (kg)" />
                  <button className="btn primary sm" onClick={closeContract}>Simpan</button>
                  <button className="btn ghost sm" onClick={() => setClosing(null)}>Batal</button>
                  {totals.noLoad > 0 && <span className="ct-close-warn">{totals.noLoad} baris belum ada muatan</span>}
                </span>)}
          </div>
        )}

        <div className="dk-wrap">
          <table className="dk-tbl">
            <thead>
              <tr>
                <th style={{ width: 44 }} className="sortable" onClick={() => sort('do')} title="Urutkan menurut nomor DO">DO{arrow('do')}</th>
                <th style={{ width: 120 }} className="sortable" onClick={() => sort('date')} title="Urutkan menurut tanggal">Tanggal{arrow('date')}</th>
                <th style={{ width: 130 }}>Plat</th>
                <th style={{ width: 150 }}>Supir</th>
                <th style={{ width: 100 }}>Est. muat</th>
                <th style={{ width: 120 }}>Tgl muat</th>
                <th style={{ width: 100 }}>Muatan</th>
                <th style={{ width: 120 }}>Tgl bongkar</th>
                <th style={{ width: 100 }}>Bongkar</th>
                <th style={{ width: 90 }}>Susut</th>
                <th style={{ width: 100 }}>Claim susut</th>
                <th style={{ width: 120 }}>Tagihan</th>
                <th style={{ width: 280 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No deliveries yet — add a row below.</td></tr>
              )}
              {shown.map(d => {
                const s = (!d.is_reject && d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') ? Number(d.muatan) - Number(d.bongkar) : null
                const rowOver = c.susut_tolerance != null && d.muatan > 0 && s != null && (s / Number(d.muatan)) > Number(c.susut_tolerance)
                // A part shares date / truck / driver with its slip; those are edited on the slip.
                const isPart = !!d.parent_id
                const main = isPart ? d.parent : null
                const others = d.parts || []
                const lockTip = isPart ? `Ikut slip utama${main?.contract?.control_no ? ` (kontrak ${main.contract.control_no})` : ''}` : undefined
                return (
                  <tr key={d.id} className={[isPart ? 'slip-part' : '', d.is_reject ? 'row-reject' : ''].join(' ').trim()}>
                    <td><input value={d.do_no ?? ''} onChange={e => setCell(d.id, 'do_no', e.target.value)} onBlur={e => saveField(d.id, 'do_no', e.target.value)} /></td>
                    <td><input type="date" disabled={isPart} title={lockTip} value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                    <td>
                      <select disabled={isPart} title={lockTip} value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)}>
                        <option value="">{d.plate || '—'}</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
                      </select>
                    </td>
                    <td>
                      <select disabled={isPart} title={lockTip} value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }}>
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
                    <td className="dk-susut" title={d.is_reject ? `Reject: ${fmtId(d.muatan || 0)} kg × (OA ${fmtId(c.oa_per_kg || 0)} + kembali ${fmtId(d.reject_oa_per_kg || 0)})` : undefined}>{c.oa_per_kg ? fmtId(Math.round(tagihanOf(c, d))) : '—'}</td>
                    <td className="dk-actions">
                      {!isPart && (d.is_reject
                        ? (<span className="rej-box">
                            <span className="rej-badge" title="Ditolak dan kembali ke asal: tidak dihitung sebagai muatan kontrak">Reject</span>
                            <NumInput className="rej-oa" value={d.reject_oa_per_kg} placeholder="OA kembali" onChange={n => setCell(d.id, 'reject_oa_per_kg', n)} onCommit={n => saveField(d.id, 'reject_oa_per_kg', n)} />
                            <button className="btn ghost sm" title="Batalkan reject" onClick={() => setReject(d, false)}>Batal</button>
                          </span>)
                        : <button className="btn ghost sm rej-btn" title="Muatan ditolak dan kembali ke asal" onClick={() => setReject(d, true)}>Reject</button>)}
                      <button className="btn ghost sm void-btn" onClick={() => {
                        const msg = isPart ? 'Remove this contract part from its slip?'
                          : others.length ? `Remove this delivery? It is a slip that also carries ${others.map(o => o.contract?.control_no || '—').join(', ')} — that part and its recorded muatan/bongkar are removed too.`
                          : 'Remove this delivery?'
                        if (confirm(msg)) delRow(d.id)
                      }}>✕</button>
                      {isPart && <span className="part-badge" title={lockTip}>Slip {main?.contract?.control_no || '—'}{main?.do_no != null ? ` DO ${main.do_no}` : ''}</span>}
                      {others.map(o => <span key={o.id} className="part-badge" title="Same load also carries this contract">+ {o.contract?.control_no || '—'}</span>)}
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
