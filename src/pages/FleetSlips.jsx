import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { checkPassword, gateEnabled } from '../components/Gate'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const rp = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)
const isFilled = d => d.borongan != null
const todayStr = () => new Date().toISOString().slice(0, 10)
const NUMF = ['do_no', 'borongan', 'bbm_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_pm', 'potongan_lain']

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
  const [unlocked, setUnlocked] = useState(new Set())
  const [unlockFor, setUnlockFor] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, ct, tr, dr] = await Promise.all([
      supabase.from('fleet_deliveries').select('*, contract:fleet_contracts(control_no,client,origin,destination)').order('tanggal', { ascending: false, nullsFirst: false }),
      supabase.from('fleet_contracts').select('id,control_no,client,origin,destination').order('control_no'),
      supabase.from('trucks').select('id,plate,status').eq('status', 'Active').order('plate'),
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
  async function saveTruck(did, truckId) {
    const t = trucks.find(x => x.id === truckId)
    setCell(did, 'truck_id', truckId || null); setCell(did, 'plate', t?.plate || null)
    await supabase.from('fleet_deliveries').update({ truck_id: truckId || null, plate: t?.plate || null }).eq('id', did)
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
  async function createSlip({ contract_id, truck_id, driver_name, tanggal }) {
    const existing = rows.filter(r => r.contract_id === contract_id)
    const nextNo = existing.reduce((m, d) => Math.max(m, d.do_no || 0), 0) + 1
    const t = trucks.find(x => x.id === truck_id)
    const { error } = await supabase.from('fleet_deliveries').insert({
      contract_id, do_no: nextNo, truck_id: truck_id || null, plate: t?.plate || null,
      driver_name: driver_name || null, tanggal: tanggal || null,
    })
    if (error) return show(error.message, true)
    show('Slip created.'); setAdding(false); load()
  }
  function tryUnlock(pw) {
    if (checkPassword(pw)) { setUnlocked(s => new Set(s).add(unlockFor)); setUnlockFor(null) }
    else show('Wrong password.', true)
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
                    <th>Tanggal</th><th>Plat</th><th>Supir</th><th>No. Kontrol</th><th>Asal</th><th>Tujuan</th>
                    <th className="r">Borongan</th><th className="r">BBM L</th><th className="r">BBM Rp</th>
                    <th className="r">Pot Susut</th><th className="r">Pot PM</th><th className="r">Pot Lain</th>
                    <th className="r">Sisa</th><th>Keterangan</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(d => {
                    const locked = isLocked(d)
                    return (
                      <tr key={d.id} className={locked ? 'row-locked' : ''}>
                        <td><input type="date" disabled={locked} value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                        <td><select disabled={locked} value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)}><option value="">{d.plate || '—'}</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}</select></td>
                        <td><select disabled={locked} value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }}><option value="">—</option>{drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}</option>)}{d.driver_name && !drivers.some(x => x.name === d.driver_name) && <option value={d.driver_name}>{d.driver_name}</option>}</select></td>
                        <td><select disabled={locked} value={d.contract_id || ''} onChange={e => saveContractLink(d.id, e.target.value)}>{contracts.map(c => <option key={c.id} value={c.id}>{c.control_no}</option>)}</select></td>
                        <td className="ro">{d.contract?.origin || '—'}</td>
                        <td className="ro">{d.contract?.destination || '—'}</td>
                        <td><input type="number" disabled={locked} value={d.borongan ?? ''} onChange={e => setCell(d.id, 'borongan', e.target.value)} onBlur={e => saveField(d.id, 'borongan', e.target.value)} /></td>
                        <td><input type="number" disabled={locked} value={d.bbm_liter ?? ''} onChange={e => setCell(d.id, 'bbm_liter', e.target.value)} onBlur={e => saveField(d.id, 'bbm_liter', e.target.value)} /></td>
                        <td><input type="number" disabled={locked} value={d.bbm_rupiah ?? ''} onChange={e => setCell(d.id, 'bbm_rupiah', e.target.value)} onBlur={e => saveField(d.id, 'bbm_rupiah', e.target.value)} /></td>
                        <td><input type="number" disabled={locked} value={d.potongan_susut ?? ''} onChange={e => setCell(d.id, 'potongan_susut', e.target.value)} onBlur={e => saveField(d.id, 'potongan_susut', e.target.value)} /></td>
                        <td><input type="number" disabled={locked} value={d.potongan_pm ?? ''} onChange={e => setCell(d.id, 'potongan_pm', e.target.value)} onBlur={e => saveField(d.id, 'potongan_pm', e.target.value)} /></td>
                        <td><input type="number" disabled={locked} value={d.potongan_lain ?? ''} onChange={e => setCell(d.id, 'potongan_lain', e.target.value)} onBlur={e => saveField(d.id, 'potongan_lain', e.target.value)} /></td>
                        <td className="mono ro r" style={{ fontWeight: 700 }}>{isFilled(d) ? rp(netOf(d)) : '—'}</td>
                        <td><input disabled={locked} value={d.keterangan || ''} onChange={e => setCell(d.id, 'keterangan', e.target.value)} onBlur={e => saveField(d.id, 'keterangan', e.target.value)} /></td>
                        <td className="dk-actions">
                          <button className="btn ghost sm" onClick={() => setPrintId(d.id)}>Print</button>
                          {locked
                            ? <button className="btn ghost sm" title="Past-dated — unlock to edit" onClick={() => setUnlockFor(d.id)}>🔒</button>
                            : <button className="btn ghost sm void-btn" onClick={() => { if (confirm('Remove this slip/delivery?')) delRow(d.id) }}>✕</button>}
                        </td>
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

function NewSlip({ contracts, trucks, drivers, onCreate, onCancel }) {
  const [contractId, setContractId] = useState('')
  const [truckId, setTruckId] = useState('')
  const [driver, setDriver] = useState('')
  const [tanggal, setTanggal] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')
  return (
    <div className="form" style={{ maxWidth: 640 }}>
      <div className="field"><label>Contract *</label>
        <SearchSelect value={contractId} onChange={setContractId} placeholder="Pick contract…"
          options={contracts.map(c => ({ value: c.id, label: c.control_no, sub: c.client || '', search: c.client || '' }))} />
      </div>
      <div className="row2">
        <div className="field"><label>Truck</label><SearchSelect value={truckId} onChange={setTruckId} placeholder="Pick truck…" options={trucks.map(t => ({ value: t.id, label: t.plate }))} /></div>
        <div className="field"><label>Driver</label><SearchSelect value={driver} onChange={setDriver} placeholder="Pick driver…" options={drivers.map(d => ({ value: d.name, label: d.nickname ? `${d.name} (${d.nickname})` : d.name }))} /></div>
      </div>
      <div className="field"><label>Date</label><input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} /></div>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="btn-group">
        <button className="btn primary" onClick={() => { if (!contractId) return setErr('Pick a contract.'); onCreate({ contract_id: contractId, truck_id: truckId, driver_name: driver, tanggal }) }}>Create slip</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function SlipPrintH({ d, c, onClose }) {
  return (
    <div className="slip-scrim">
      <div className="slip-hp">
        <div className="slip-h">SLIP UANG JALAN</div>
        <div className="slip-hp-meta">
          <div><b>Plat BK:</b> {d.plate || '—'}</div>
          <div><b>Tanggal DO:</b> {fmtDate(d.tanggal)}</div>
          <div><b>Nama Supir:</b> {d.driver_name || '—'}</div>
          <div><b>Nomor DO:</b> {d.do_no}</div>
        </div>
        <table className="slip-hp-tbl">
          <thead><tr>
            <th>NO</th><th>NOMOR KONTROL</th><th>ASAL</th><th>TUJUAN</th><th>JUMLAH BORONGAN</th>
            <th>BBM LITER</th><th>BBM RUPIAH</th><th>POT. SUSUT</th><th>POT. PM</th><th>POT. LAIN</th><th>SISA BORONGAN</th><th>KETERANGAN</th>
          </tr></thead>
          <tbody><tr>
            <td>{d.do_no}</td><td>{c.control_no || '—'}</td><td>{c.origin || '—'}</td><td>{c.destination || '—'}</td>
            <td className="r">{rp(d.borongan)}</td><td className="r">{d.bbm_liter || ''}</td><td className="r">{rp(d.bbm_rupiah)}</td>
            <td className="r">{rp(d.potongan_susut)}</td><td className="r">{rp(d.potongan_pm)}</td><td className="r">{rp(d.potongan_lain)}</td>
            <td className="r" style={{ fontWeight: 800 }}>{rp(netOf(d))}</td><td>{d.keterangan || ''}</td>
          </tr></tbody>
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
