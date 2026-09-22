import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { NumInput, fmtId } from '../components/NumInput'
import { checkPassword, gateEnabled } from '../components/Gate'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const JENIS_POT = ['Susut', 'Ganti Ban', 'Ganti Spare Part', 'Lainnya']
const rp = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const potTotal = d => Number(d.potongan_susut || 0) + Number(d.potongan_ban || 0) + Number(d.potongan_sparepart || 0) + Number(d.potongan_lain || 0) + Number(d.potongan_pm || 0) + Number(d.potongan_kasbon || 0) + Number(d.bbm_loan_liter || 0) * Number(d.price_per_liter || 0)
const netOf = d => Number(d.borongan || 0) - Number(d.selisih_bbm || 0) - Number(d.potongan_pihak || 0) - Number(d.bbm_rupiah || 0) - potTotal(d)
  + Number(d.tambahan_cuci || 0) + Number(d.tambahan_steam || 0) + Number(d.tambahan_tol || 0)
const hasAdj = d => [d.selisih_bbm, d.potongan_pihak, d.tambahan_cuci, d.tambahan_steam, d.tambahan_tol].some(v => v) || d.is_retur
const tambahanOf = d => Number(d.tambahan_cuci || 0) + Number(d.tambahan_steam || 0) + Number(d.tambahan_tol || 0)
const potLainOf = d => Number(d.selisih_bbm || 0) + Number(d.potongan_pihak || 0)
const penyOf = d => tambahanOf(d) - Number(d.selisih_bbm || 0) - Number(d.potongan_pihak || 0)
const totalBbm = d => (Number(d.bbm_liter || 0) * Number(d.price_per_liter || 0))
const isFilled = d => d.borongan != null
const todayStr = () => new Date().toISOString().slice(0, 10)
const NUMF = ['do_no', 'borongan', 'bbm_liter', 'price_per_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_ban', 'potongan_sparepart', 'potongan_lain', 'potongan_pm', 'potongan_kasbon', 'bbm_loan_liter']

export default function FleetSlips() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [contracts, setContracts] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [printId, setPrintId] = useState(null)
  const [adjFor, setAdjFor] = useState(null)
  const [unlocked, setUnlocked] = useState(new Set())
  const [unlockFor, setUnlockFor] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, ct, tr, dr] = await Promise.all([
      supabase.from('fleet_deliveries').select('*, contract:fleet_contracts(control_no,client,origin,destination)').order('tanggal', { ascending: false, nullsFirst: false }),
      supabase.from('fleet_contracts').select('id,control_no,client,origin,destination').order('control_no'),
      supabase.from('trucks').select('id,plate,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('name,nickname,status').eq('status', 'Active').order('name'),
    ])
    setRows(dl.data || []); setContracts(ct.data || []); setTrucks(tr.data || []); setDrivers(dr.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(d => {
      if (filter === 'filled' && !isFilled(d)) return false
      if (filter === 'blank' && isFilled(d)) return false
      if (!s) return true
      return `${d.plate} ${d.driver_name} ${d.contract?.control_no} ${d.contract?.client}`.toLowerCase().includes(s)
    })
  }, [rows, q, filter])
  const total = useMemo(() => visible.reduce((a, d) => a + netOf(d), 0), [visible])

  // locked = there is a password, the slip's date is before today, and not unlocked this session
  const isLocked = d => gateEnabled && d.tanggal && d.tanggal < todayStr() && !unlocked.has(d.id)

  function setCell(did, field, value) { setRows(rs => rs.map(r => r.id === did ? { ...r, [field]: value } : r)) }
  async function saveField(did, field, raw) {
    const value = NUMF.includes(field) ? num(raw) : (raw === '' ? null : raw)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: value }).eq('id', did)
    if (error) show(error.message, true)
  }
  // BBM total (bbm_rupiah) = liter × price/L; recompute and persist on either edit
  async function saveBbm(did, field, raw) {
    const row = rows.find(r => r.id === did) || {}
    const L = field === 'bbm_liter' ? num(raw) : (row.bbm_liter == null ? null : Number(row.bbm_liter))
    const P = field === 'price_per_liter' ? num(raw) : (row.price_per_liter == null ? null : Number(row.price_per_liter))
    const total = Number(L || 0) * Number(P || 0)
    setCell(did, 'bbm_rupiah', total)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: num(raw), bbm_rupiah: total }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function saveTruck(did, truckId) {
    const t = trucks.find(x => x.id === truckId)
    const patch = { truck_id: truckId || null, plate: t?.plate || null }
    if (t && t.capacity_kg != null) patch.estimasi_muat = Number(t.capacity_kg)
    setRows(rs => rs.map(r => r.id === did ? { ...r, ...patch } : r))
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
    if (error) show(error.message, true)
  }
  async function saveContractLink(did, cid) {
    const c = contracts.find(x => x.id === cid)
    setRows(rs => rs.map(r => r.id === did ? { ...r, contract_id: cid, contract: c ? { control_no: c.control_no, origin: c.origin, destination: c.destination, client: c.client } : r.contract } : r))
    const { error } = await supabase.from('fleet_deliveries').update({ contract_id: cid }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function delRow(did) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== did))
  }
  async function createSlip(fields) {
    const existing = rows.filter(r => r.contract_id === fields.contract_id)
    const nextNo = existing.reduce((m, d) => Math.max(m, d.do_no || 0), 0) + 1
    const { error } = await supabase.from('fleet_deliveries').insert({ do_no: nextNo, ...fields })
    if (error) return show(error.message, true)
    show('Slip created.'); setAdding(false); load()
  }
  function tryUnlock(pw) {
    if (checkPassword(pw)) { setUnlocked(s => new Set(s).add(unlockFor)); setUnlockFor(null) }
    else show('Wrong password.', true)
  }
  async function saveAdj(id, patch) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', id)
    if (error) return show(error.message, true)
    show('Adjustments saved.'); setAdjFor(null)
  }

  if (loading) return (<><div className="topbar"><div><h1>Slip Uang Jalan</h1></div></div><div className="content"><Spinner /></div></>)
  const active = rows.find(r => r.id === printId)

  return (
    <>
      <div className="topbar">
        <div><h1>Slip Uang Jalan</h1><div className="sub">Fill inline, print each slip{gateEnabled ? ' · past-dated slips need the password to edit' : ''}</div></div>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ New slip'}</button>
      </div>
      <div className="content">
        {adding && <NewSlip contracts={contracts} trucks={trucks} drivers={drivers} onCreate={createSlip} onCancel={() => setAdding(false)} />}

        <div className="controls" style={{ marginTop: adding ? 20 : 0 }}>
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by plate, driver, control no, client…" /></div>
          <div className="seg-lens">
            {[['all', 'All'], ['blank', 'Not filled'], ['filled', 'Filled']].map(([v, l]) => (<button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Empty title="No slips">{q ? 'No matches.' : 'Create a slip with “+ New slip”, or add a delivery in a contract.'}</Empty>
        ) : (
          <>
            <div className="hist-count">{visible.length} slip{visible.length === 1 ? '' : 's'} · total net Rp {total.toLocaleString()}</div>
            <div className="dk-wrap">
              <table className="dk-tbl slip-grid">
                <thead>
                  <tr>
                    <th></th><th>Tanggal</th><th>Plat</th><th>Supir</th><th>No. Kontrol</th><th>Asal</th><th>Tujuan</th>
                    <th className="r">Borongan</th><th className="r">BBM L</th><th className="r">Price/L</th><th className="r">Total BBM</th>
                    <th className="r">Susut</th><th className="r">Ban</th><th className="r">S.Part</th><th className="r">Lain</th><th className="r">PM</th><th className="r">Kasbon</th><th className="r">BBM Pinj (L)</th><th className="r">Penyesuaian</th>
                    <th className="r">Sisa</th><th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(d => {
                    const locked = isLocked(d)
                    return (
                      <tr key={d.id} className={locked ? 'row-locked' : ''}>
                        <td className="dk-actions">
                          <button className="btn ghost sm" onClick={() => setPrintId(d.id)}>Print</button>
                          <button className={'btn ghost sm' + (hasAdj(d) ? ' driver-on' : '')} disabled={locked} onClick={() => setAdjFor(d.id)}>Adj{hasAdj(d) ? ' ✓' : ''}</button>
                          {locked
                            ? <button className="btn ghost sm" title="Past-dated — unlock to edit" onClick={() => setUnlockFor(d.id)}>🔒</button>
                            : <button className="btn ghost sm void-btn" onClick={() => { if (confirm('Remove this slip/delivery?')) delRow(d.id) }}>✕</button>}
                        </td>
                        <td><input type="date" disabled={locked} value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                        <td><select disabled={locked} value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)}><option value="">{d.plate || '—'}</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}</select></td>
                        <td><select disabled={locked} value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }}><option value="">—</option>{drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}</option>)}{d.driver_name && !drivers.some(x => x.name === d.driver_name) && <option value={d.driver_name}>{d.driver_name}</option>}</select></td>
                        <td><select disabled={locked} value={d.contract_id || ''} onChange={e => saveContractLink(d.id, e.target.value)}>{contracts.map(c => <option key={c.id} value={c.id}>{c.control_no}</option>)}</select></td>
                        <td className="ro">{d.contract?.origin || '—'}</td>
                        <td className="ro">{d.contract?.destination || '—'}</td>
                        <td><NumInput disabled={locked} value={d.borongan} onChange={n => setCell(d.id, 'borongan', n)} onCommit={n => saveField(d.id, 'borongan', n)} /></td>
                        <td><NumInput disabled={locked} value={d.bbm_liter} onChange={n => setCell(d.id, 'bbm_liter', n)} onCommit={n => saveBbm(d.id, 'bbm_liter', n)} /></td>
                        <td><NumInput disabled={locked} value={d.price_per_liter} onChange={n => setCell(d.id, 'price_per_liter', n)} onCommit={n => saveBbm(d.id, 'price_per_liter', n)} /></td>
                        <td className="mono ro r">{totalBbm(d) ? fmtId(totalBbm(d)) : '—'}</td>
                        <td><NumInput disabled={locked} value={d.potongan_susut} onChange={n => setCell(d.id, 'potongan_susut', n)} onCommit={n => saveField(d.id, 'potongan_susut', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_ban} onChange={n => setCell(d.id, 'potongan_ban', n)} onCommit={n => saveField(d.id, 'potongan_ban', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_sparepart} onChange={n => setCell(d.id, 'potongan_sparepart', n)} onCommit={n => saveField(d.id, 'potongan_sparepart', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_lain} onChange={n => setCell(d.id, 'potongan_lain', n)} onCommit={n => saveField(d.id, 'potongan_lain', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_pm} onChange={n => setCell(d.id, 'potongan_pm', n)} onCommit={n => saveField(d.id, 'potongan_pm', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_kasbon} onChange={n => setCell(d.id, 'potongan_kasbon', n)} onCommit={n => saveField(d.id, 'potongan_kasbon', n)} /></td>
                        <td><NumInput disabled={locked} value={d.bbm_loan_liter} onChange={n => setCell(d.id, 'bbm_loan_liter', n)} onCommit={n => saveField(d.id, 'bbm_loan_liter', n)} /></td>
                        <td className="mono ro r" title="Tambahan − Selisih BBM − ANS/MNA (set in Adj)">{penyOf(d) ? rp(penyOf(d)) : '—'}</td>
                        <td className="mono ro r" style={{ fontWeight: 700 }}>{isFilled(d) ? rp(netOf(d)) : '—'}</td>
                        <td><input disabled={locked} value={d.keterangan || ''} onChange={e => setCell(d.id, 'keterangan', e.target.value)} onBlur={e => saveField(d.id, 'keterangan', e.target.value)} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {active && <SlipPrintH d={active} c={active.contract || {}} onClose={() => setPrintId(null)} />}
      {adjFor && <AdjustModal d={rows.find(r => r.id === adjFor)} onSave={p => saveAdj(adjFor, p)} onClose={() => setAdjFor(null)} />}
      {unlockFor && <UnlockModal onOk={tryUnlock} onCancel={() => setUnlockFor(null)} />}
      {node}
    </>
  )
}

function UnlockModal({ onOk, onCancel }) {
  const [pw, setPw] = useState('')
  return (
    <div className="slip-scrim">
      <form className="gate-card" onSubmit={e => { e.preventDefault(); onOk(pw) }}>
        <div className="gate-brand" style={{ fontSize: 18 }}>Unlock past-dated slip</div>
        <div className="gate-sub">Editing a slip after its date has passed needs the password.</div>
        <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" />
        <button className="btn primary wide" type="submit">Unlock</button>
        <button type="button" className="gate-home" onClick={onCancel}>Cancel</button>
      </form>
    </div>
  )
}

function AdjustModal({ d, onSave, onClose }) {
  const [f, setF] = useState({
    selisih_liter: d.selisih_bbm_liter ?? '', selisih_price: d.selisih_bbm_price ?? '',
    potongan_pihak: d.potongan_pihak ?? '', potongan_pihak_nama: d.potongan_pihak_nama || '',
    tambahan_cuci: d.tambahan_cuci ?? '', tambahan_steam: d.tambahan_steam ?? '', tambahan_tol: d.tambahan_tol ?? '',
    is_retur: !!d.is_retur,
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const nz = v => (v === '' || v === null || v === undefined) ? 0 : Number(v)
  const orNull = v => (v === '' || v === null || v === undefined) ? null : Number(v)
  const selisih = nz(f.selisih_liter) * nz(f.selisih_price)
  const preview = Number(d.borongan || 0) - selisih - nz(f.potongan_pihak)
    - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0)
    + nz(f.tambahan_cuci) + nz(f.tambahan_steam) + nz(f.tambahan_tol)
  function save() {
    onSave({
      selisih_bbm_liter: orNull(f.selisih_liter), selisih_bbm_price: orNull(f.selisih_price), selisih_bbm: selisih || null,
      potongan_pihak: orNull(f.potongan_pihak), potongan_pihak_nama: f.potongan_pihak_nama.trim() || null,
      tambahan_cuci: orNull(f.tambahan_cuci), tambahan_steam: orNull(f.tambahan_steam), tambahan_tol: orNull(f.tambahan_tol),
      is_retur: f.is_retur,
    })
  }
  return (
    <div className="slip-scrim">
      <div className="rel-modal nsf" style={{ width: 480 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Penyesuaian slip · {d.plate || '—'}</div>
        <div className="fd-sec">Potongan (kurangi sisa)</div>
        <div className="nsf-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label><span>Selisih BBM Liter</span><NumInput value={f.selisih_liter} onChange={v => set('selisih_liter', v)} onCommit={v => set('selisih_liter', v)} /></label>
          <label><span>Selisih BBM Price/L</span><NumInput value={f.selisih_price} onChange={v => set('selisih_price', v)} onCommit={v => set('selisih_price', v)} /></label>
          <div className="nsf-f" style={{ justifyContent: 'flex-end' }}><span>= Selisih</span><div className="fd-calc">{rp(selisih)}</div></div>
          <label><span>Potongan ANS/MNA</span><NumInput value={f.potongan_pihak} onChange={v => set('potongan_pihak', v)} onCommit={v => set('potongan_pihak', v)} /></label>
          <label><span>Dari pihak</span><select value={f.potongan_pihak_nama} onChange={e => set('potongan_pihak_nama', e.target.value)}><option value="">—</option><option value="ANS">ANS</option><option value="MNA">MNA</option><option value="Lainnya">Lainnya</option></select></label>
          <div></div>
        </div>
        <div className="fd-sec">Tambahan (tambah sisa)</div>
        <div className="nsf-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label><span>Cuci tangki</span><NumInput value={f.tambahan_cuci} onChange={v => set('tambahan_cuci', v)} onCommit={v => set('tambahan_cuci', v)} /></label>
          <label><span>Double steam</span><NumInput value={f.tambahan_steam} onChange={v => set('tambahan_steam', v)} onCommit={v => set('tambahan_steam', v)} /></label>
          <label><span>Bantuan uang tol</span><NumInput value={f.tambahan_tol} onChange={v => set('tambahan_tol', v)} onCommit={v => set('tambahan_tol', v)} /></label>
        </div>
        <label className="adj-retur"><input type="checkbox" checked={f.is_retur} onChange={e => set('is_retur', e.target.checked)} /> Slip untuk retur</label>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontWeight: 700 }}>Sisa: {rp(preview)}</span>
          <div className="btn-group" style={{ marginLeft: 'auto' }}>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewSlip({ contracts, trucks, drivers, onCreate, onCancel }) {
  const [f, setF] = useState({
    contract_id: '', truck_id: '', driver_name: '', tanggal: new Date().toISOString().slice(0, 10),
    borongan: '', bbm_liter: '', price_per_liter: '', potongan_susut: '', potongan_ban: '', potongan_sparepart: '', potongan_lain: '', potongan_pm: '40000', potongan_kasbon: '', bbm_loan_liter: '',
    selisih_liter: '', selisih_price: '', potongan_pihak: '', potongan_pihak_nama: '',
    tambahan_cuci: '', tambahan_steam: '', tambahan_tol: '', is_retur: false, keterangan: '',
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const [err, setErr] = useState('')
  const [showAdj, setShowAdj] = useState(false)
  const [outstanding, setOutstanding] = useState({ kasbon: 0, bbm: 0 })
  const nz = v => (v === '' || v === null || v === undefined) ? 0 : Number(v)
  const orNull = v => (v === '' || v === null || v === undefined) ? null : Number(v)
  const truck = trucks.find(t => t.id === f.truck_id)

  useEffect(() => {
    if (!f.driver_name) { setOutstanding({ kasbon: 0, bbm: 0 }); return }
    let alive = true
    ;(async () => {
      const [ln, rpm, dl] = await Promise.all([
        supabase.from('fleet_driver_loans').select('jenis,amount,liter').eq('driver_name', f.driver_name),
        supabase.from('fleet_driver_loan_repayments').select('amount').eq('driver_name', f.driver_name),
        supabase.from('fleet_deliveries').select('potongan_kasbon,bbm_loan_liter').eq('driver_name', f.driver_name),
      ])
      if (!alive) return
      let kC = 0, bC = 0; (ln.data || []).forEach(l => { if (l.jenis === 'Cash') kC += nz(l.amount); else if (l.jenis === 'BBM') bC += nz(l.liter) })
      let kP = 0, bP = 0; (dl.data || []).forEach(d => { kP += nz(d.potongan_kasbon); bP += nz(d.bbm_loan_liter) }); (rpm.data || []).forEach(r => { kP += nz(r.amount) })
      setOutstanding({ kasbon: kC - kP, bbm: bC - bP })
    })()
    return () => { alive = false }
  }, [f.driver_name])

  const totalBbm = nz(f.bbm_liter) * nz(f.price_per_liter)
  const selisih = nz(f.selisih_liter) * nz(f.selisih_price)
  const potTot = nz(f.potongan_susut) + nz(f.potongan_ban) + nz(f.potongan_sparepart) + nz(f.potongan_lain) + nz(f.potongan_pm) + nz(f.potongan_kasbon) + nz(f.bbm_loan_liter) * nz(f.price_per_liter)
  const sisa = nz(f.borongan) - selisih - nz(f.potongan_pihak) - totalBbm - potTot
    + nz(f.tambahan_cuci) + nz(f.tambahan_steam) + nz(f.tambahan_tol)

  function submit() {
    if (!f.contract_id) return setErr('Pick a contract.')
    if (nz(f.borongan) <= 0) return setErr('Borongan is required.')
    if (f.potongan_pm === '' || f.potongan_pm === null) return setErr('PM is required.')
    if (nz(f.potongan_kasbon) > outstanding.kasbon) return setErr(`Pot Kasbon melebihi sisa kasbon (${rp(outstanding.kasbon)}).`)
    if (nz(f.bbm_loan_liter) > outstanding.bbm) return setErr(`BBM Pinjaman melebihi sisa BBM (${outstanding.bbm.toLocaleString('id-ID')} L).`)
    onCreate({
      contract_id: f.contract_id, truck_id: f.truck_id || null, plate: truck?.plate || null,
      driver_name: f.driver_name || null, tanggal: f.tanggal || null,
      estimasi_muat: truck?.capacity_kg != null ? Number(truck.capacity_kg) : null,
      borongan: orNull(f.borongan), bbm_liter: orNull(f.bbm_liter), price_per_liter: orNull(f.price_per_liter), bbm_rupiah: totalBbm || null,
      potongan_susut: orNull(f.potongan_susut), potongan_ban: orNull(f.potongan_ban), potongan_sparepart: orNull(f.potongan_sparepart), potongan_lain: orNull(f.potongan_lain), potongan_pm: orNull(f.potongan_pm),
      potongan_kasbon: orNull(f.potongan_kasbon), bbm_loan_liter: orNull(f.bbm_loan_liter),
      selisih_bbm_liter: orNull(f.selisih_liter), selisih_bbm_price: orNull(f.selisih_price), selisih_bbm: selisih || null,
      potongan_pihak: orNull(f.potongan_pihak), potongan_pihak_nama: f.potongan_pihak_nama || null,
      tambahan_cuci: orNull(f.tambahan_cuci), tambahan_steam: orNull(f.tambahan_steam), tambahan_tol: orNull(f.tambahan_tol),
      is_retur: f.is_retur, keterangan: f.keterangan.trim() || null,
    })
  }

  return (
    <div className="form nsf" style={{ maxWidth: 680 }}>
      <div className="nsf-grid">
        <div className="nsf-f"><span>Contract *</span><SearchSelect value={f.contract_id} onChange={v => set('contract_id', v)} placeholder="Pick…" options={contracts.map(c => ({ value: c.id, label: c.control_no, sub: c.client || '', search: c.client || '' }))} /></div>
        <label><span>Date</span><input type="date" value={f.tanggal} onChange={e => set('tanggal', e.target.value)} /></label>
        <div className="nsf-f"><span>Truck</span><SearchSelect value={f.truck_id} onChange={v => set('truck_id', v)} placeholder="Pick…" options={trucks.map(t => ({ value: t.id, label: t.plate }))} /></div>
        <div className="nsf-f"><span>Driver</span><SearchSelect value={f.driver_name} onChange={v => set('driver_name', v)} placeholder="Pick…" options={drivers.map(d => ({ value: d.name, label: d.nickname ? `${d.name} (${d.nickname})` : d.name }))} /></div>
        <label><span>Borongan *</span><NumInput value={f.borongan} onChange={v => set('borongan', v)} onCommit={v => set('borongan', v)} /></label>
        <label><span>BBM Liter</span><NumInput value={f.bbm_liter} onChange={v => set('bbm_liter', v)} onCommit={v => set('bbm_liter', v)} /></label>
        <label><span>BBM Price/L</span><NumInput value={f.price_per_liter} onChange={v => set('price_per_liter', v)} onCommit={v => set('price_per_liter', v)} /></label>
        <label><span>Pot Susut</span><NumInput value={f.potongan_susut} onChange={v => set('potongan_susut', v)} onCommit={v => set('potongan_susut', v)} /></label>
        <label><span>Pot Ban</span><NumInput value={f.potongan_ban} onChange={v => set('potongan_ban', v)} onCommit={v => set('potongan_ban', v)} /></label>
        <label><span>Pot Spare Part</span><NumInput value={f.potongan_sparepart} onChange={v => set('potongan_sparepart', v)} onCommit={v => set('potongan_sparepart', v)} /></label>
        <label><span>Pot Lain</span><NumInput value={f.potongan_lain} onChange={v => set('potongan_lain', v)} onCommit={v => set('potongan_lain', v)} /></label>
        <label><span>PM *</span><NumInput value={f.potongan_pm} onChange={v => set('potongan_pm', v)} onCommit={v => set('potongan_pm', v)} /></label>
        <label><span>Pot Kasbon</span><NumInput value={f.potongan_kasbon} onChange={v => set('potongan_kasbon', v)} onCommit={v => set('potongan_kasbon', v)} />
          {f.driver_name ? <span className="nsf-out">Sisa: {rp(outstanding.kasbon)}{outstanding.kasbon > 0 ? <button type="button" className="nsf-deduct" onClick={() => set('potongan_kasbon', String(outstanding.kasbon))}>Deduct</button> : null}</span> : null}</label>
        <label><span>BBM Pinjaman (L)</span><NumInput value={f.bbm_loan_liter} onChange={v => set('bbm_loan_liter', v)} onCommit={v => set('bbm_loan_liter', v)} />
          {f.driver_name ? <span className="nsf-out">Sisa: {outstanding.bbm.toLocaleString('id-ID')} L{outstanding.bbm > 0 ? <button type="button" className="nsf-deduct" onClick={() => set('bbm_loan_liter', String(outstanding.bbm))}>Deduct</button> : null}</span> : null}</label>
      </div>
      <div className="nsf-note">Total BBM: {rp(totalBbm)}</div>

      <button type="button" className="btn ghost nsf-toggle" onClick={() => setShowAdj(v => !v)}>{showAdj ? '\u25be Sembunyikan' : '\u25b8 Tampilkan'} Penyesuaian — Selisih BBM, Potongan ANS/MNA, Cuci, Steam, Tol, Retur</button>
      {showAdj && (
        <div className="nsf-adj"><div className="nsf-grid">
          <label><span>Selisih BBM Liter</span><NumInput value={f.selisih_liter} onChange={v => set('selisih_liter', v)} onCommit={v => set('selisih_liter', v)} /></label>
          <label><span>Selisih BBM Price/L</span><NumInput value={f.selisih_price} onChange={v => set('selisih_price', v)} onCommit={v => set('selisih_price', v)} /></label>
          <label><span>Potongan ANS/MNA</span><NumInput value={f.potongan_pihak} onChange={v => set('potongan_pihak', v)} onCommit={v => set('potongan_pihak', v)} /></label>
          <label><span>Dari pihak</span><select value={f.potongan_pihak_nama} onChange={e => set('potongan_pihak_nama', e.target.value)}><option value="">—</option><option value="ANS">ANS</option><option value="MNA">MNA</option><option value="Lainnya">Lainnya</option></select></label>
          <label><span>Cuci tangki</span><NumInput value={f.tambahan_cuci} onChange={v => set('tambahan_cuci', v)} onCommit={v => set('tambahan_cuci', v)} /></label>
          <label><span>Double steam</span><NumInput value={f.tambahan_steam} onChange={v => set('tambahan_steam', v)} onCommit={v => set('tambahan_steam', v)} /></label>
          <label><span>Bantuan uang tol</span><NumInput value={f.tambahan_tol} onChange={v => set('tambahan_tol', v)} onCommit={v => set('tambahan_tol', v)} /></label>
          <label className="adj-retur" style={{ gridColumn: '1 / -1', marginTop: 0 }}><input type="checkbox" checked={f.is_retur} onChange={e => set('is_retur', e.target.checked)} /> Slip untuk retur</label>
        </div></div>
      )}

      <label className="nsf-ket"><span>Keterangan</span><input value={f.keterangan} onChange={e => set('keterangan', e.target.value)} /></label>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 12, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
        <span style={{ fontWeight: 700 }}>Sisa: {rp(sisa)}</span>
        <div className="btn-group" style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={submit}>Create slip</button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SlipPrintH({ d, c, onClose }) {
  return (
    <div className="slip-scrim">
      <div className="slip-hp">
        <div className="slip-h">SLIP UANG JALAN{d.is_retur ? ' (RETUR)' : ''}</div>
        <div className="slip-hp-meta">
          <div><b>Plat BK:</b> {d.plate || '—'}</div>
          <div><b>Tanggal DO:</b> {fmtDate(d.tanggal)}</div>
          <div><b>Nama Supir:</b> {d.driver_name || '—'}</div>
          <div><b>Nomor DO:</b> {d.do_no}</div>
        </div>
        <table className="slip-hp-tbl">
          <thead><tr>
            <th>NO</th><th>NOMOR KONTROL</th><th>ASAL</th><th>TUJUAN</th><th>JUMLAH BORONGAN</th>
            <th>BBM LITER</th><th>PRICE/L</th><th>TOTAL BBM</th><th>SUSUT</th><th>BAN</th><th>S.PART</th><th>LAIN</th><th>PM</th><th>KASBON</th><th>BBM PINJ</th><th>SISA BORONGAN</th><th>KETERANGAN</th>
          </tr></thead>
          <tbody><tr>
            <td>{d.do_no}</td><td>{c.control_no || '—'}</td><td>{c.origin || '—'}</td><td>{c.destination || '—'}</td>
            <td className="r">{rp(d.borongan)}</td><td className="r">{d.bbm_liter || ''}</td><td className="r">{rp(d.price_per_liter)}</td><td className="r">{rp(totalBbm(d))}</td>
            <td className="r">{rp(d.potongan_susut)}</td><td className="r">{rp(d.potongan_ban)}</td><td className="r">{rp(d.potongan_sparepart)}</td><td className="r">{rp(d.potongan_lain)}</td><td className="r">{rp(d.potongan_pm)}</td><td className="r">{rp(d.potongan_kasbon)}</td><td className="r">{d.bbm_loan_liter ? `${fmtId(d.bbm_loan_liter)}L` : ''}</td>
            <td className="r" style={{ fontWeight: 800 }}>{rp(netOf(d))}</td><td>{d.keterangan || ''}</td>
          </tr></tbody>
        </table>
        {hasAdj(d) && (
          <table className="slip-hp-tbl" style={{ marginTop: 8 }}>
            <thead><tr><th colSpan={2}>PENYESUAIAN</th></tr></thead>
            <tbody>
              {d.selisih_bbm ? <tr><td>Potongan Selisih BBM{d.selisih_bbm_liter ? ` (${fmtId(d.selisih_bbm_liter)} L × ${rp(d.selisih_bbm_price)})` : ''}</td><td className="r">− {rp(d.selisih_bbm)}</td></tr> : null}
              {d.potongan_pihak ? <tr><td>Potongan {d.potongan_pihak_nama || 'pihak'}</td><td className="r">− {rp(d.potongan_pihak)}</td></tr> : null}
              {d.tambahan_cuci ? <tr><td>Tambahan Cuci Tangki</td><td className="r">+ {rp(d.tambahan_cuci)}</td></tr> : null}
              {d.tambahan_steam ? <tr><td>Tambahan Double Steam</td><td className="r">+ {rp(d.tambahan_steam)}</td></tr> : null}
              {d.tambahan_tol ? <tr><td>Tambahan Bantuan Uang Tol</td><td className="r">+ {rp(d.tambahan_tol)}</td></tr> : null}
            </tbody>
          </table>
        )}
        <div className="slip-sign" style={{ marginTop: 40 }}><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
