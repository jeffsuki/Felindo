import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString() + ' kg'
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const susutOf = d => (d.muatan != null && d.bongkar != null) ? Number(d.muatan) - Number(d.bongkar) : null
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)

export default function FleetContractDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { show, node } = useToast()
  const [c, setC] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [slip, setSlip] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [ct, dl, tr, dr] = await Promise.all([
      supabase.from('fleet_contracts').select('*').eq('id', id).single(),
      supabase.from('fleet_deliveries').select('*').eq('contract_id', id).order('do_no', { ascending: true }),
      supabase.from('trucks').select('id,plate,fleet_division,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('fleet_drivers').select('name').order('name'),
    ])
    setC(ct.data || null)
    setDeliveries(dl.data || [])
    setTrucks(tr.data || [])
    setDrivers(dr.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  const totals = useMemo(() => {
    const t = { muatan: 0, bongkar: 0, susut: 0 }
    for (const d of deliveries) {
      t.muatan += Number(d.muatan || 0)
      t.bongkar += Number(d.bongkar || 0)
      const s = susutOf(d); if (s != null) t.susut += s
    }
    t.outstanding = Math.max(Number(c?.quantity_kg || 0) - t.muatan, 0)
    return t
  }, [deliveries, c])

  const overTol = c && c.susut_tolerance != null && totals.muatan > 0 && (totals.susut / totals.muatan) > Number(c.susut_tolerance)

  async function addDelivery(payload) {
    const nextNo = deliveries.reduce((m, d) => Math.max(m, d.do_no || 0), 0) + 1
    const { error } = await supabase.from('fleet_deliveries').insert({ contract_id: id, do_no: nextNo, ...payload })
    if (error) return show(error.message, true)
    show(`Delivery #${nextNo} added.`); setAdding(false); load()
  }
  async function patchDelivery(did, patch, msg) {
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
    if (error) return show(error.message, true)
    if (msg) show(msg); load()
  }
  async function delDelivery(did) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', did)
    if (error) return show(error.message, true)
    show('Delivery removed.'); load()
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
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={() => nav('/fleet/contracts')}>← Contracts</button>
          <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add delivery'}</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1160 }}>
        <div className="metrics">
          <div className="metric"><div className="k">Contracted</div><div className="v" style={{ fontSize: 18 }}>{kg(c.quantity_kg)}</div></div>
          <div className="metric"><div className="k">Loaded (real)</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.muatan)}</div></div>
          <div className="metric"><div className="k">Outstanding</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.outstanding)}</div></div>
          <div className="metric"><div className="k">Deliveries</div><div className="v" style={{ fontSize: 18 }}>{deliveries.length}</div></div>
          <div className="metric"><div className="k">Susut</div><div className="v" style={{ fontSize: 18, color: overTol ? 'var(--urgent)' : undefined }}>{kg(totals.susut)}{overTol && ' ⚠'}</div></div>
        </div>

        {adding && <AddDelivery trucks={trucks} drivers={drivers} onAdd={addDelivery} onCancel={() => setAdding(false)} />}

        {deliveries.length === 0 ? (
          <Empty title="No deliveries yet">Assign a driver and truck with “+ Add delivery”.</Empty>
        ) : (
          <div className="clist" style={{ marginTop: 16 }}>
            {deliveries.map(d => (
              <DeliveryRow key={d.id} d={d} trucks={trucks} drivers={drivers} tol={c.susut_tolerance}
                onSave={(patch, msg) => patchDelivery(d.id, patch, msg)}
                onDelete={() => delDelivery(d.id)} onSlip={() => setSlip(d)} />
            ))}
          </div>
        )}
      </div>

      {slip && <SlipOverlay c={c} d={slip} onClose={() => setSlip(null)} />}
      {node}
    </>
  )
}

function AddDelivery({ trucks, drivers, onAdd, onCancel }) {
  const [truckId, setTruckId] = useState('')
  const [driver, setDriver] = useState('')
  const [tanggal, setTanggal] = useState(new Date().toISOString().slice(0, 10))
  const [est, setEst] = useState('')
  const truck = trucks.find(t => t.id === truckId)

  function pickTruck(tid) {
    setTruckId(tid)
    const t = trucks.find(x => x.id === tid)
    if (t && t.capacity_kg && !est) setEst(String(t.capacity_kg))
  }
  function submit() {
    onAdd({
      truck_id: truckId || null,
      plate: truck?.plate || null,
      driver_name: driver || null,
      tanggal: tanggal || null,
      estimasi_muat: num(est),
    })
  }

  return (
    <div className="form" style={{ maxWidth: 640, marginBottom: 16 }}>
      <div className="row2">
        <div className="field">
          <label>Truck<span className="hint">active only · capacity shown</span></label>
          <SearchSelect value={truckId} onChange={pickTruck} placeholder="Search truck…"
            options={trucks.map(t => ({ value: t.id, label: t.plate, sub: t.capacity_kg ? `${Number(t.capacity_kg).toLocaleString()} kg` : (t.fleet_division || ''), search: t.fleet_division || '' }))} />
        </div>
        <div className="field">
          <label>Driver</label>
          <SearchSelect value={driver} onChange={setDriver} placeholder="Select driver…"
            options={drivers.map(d => ({ value: d.name, label: d.name }))} />
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Date</label><input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} /></div>
        <div className="field"><label>Estimasi muat (kg)<span className="hint">suggested from capacity</span></label><input type="number" value={est} onChange={e => setEst(e.target.value)} placeholder={truck?.capacity_kg ? String(truck.capacity_kg) : ''} /></div>
      </div>
      {drivers.length === 0 && <div className="pool-hint" style={{ marginBottom: 8 }}>No drivers registered — add them in Clients &amp; Places → Drivers.</div>}
      <div className="btn-group">
        <button className="btn primary" onClick={submit}>Add delivery</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function DeliveryRow({ d, trucks, drivers, tol, onSave, onDelete, onSlip }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({})
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  function openEdit() {
    setF({
      tanggal: d.tanggal || '', driver_name: d.driver_name || '',
      tanggal_muat: d.tanggal_muat || '', muatan: d.muatan ?? '',
      tanggal_bongkar: d.tanggal_bongkar || '', bongkar: d.bongkar ?? '',
      estimasi_muat: d.estimasi_muat ?? '',
      borongan: d.borongan ?? '', bbm_liter: d.bbm_liter ?? '', bbm_rupiah: d.bbm_rupiah ?? '',
      potongan_susut: d.potongan_susut ?? '', potongan_pm: d.potongan_pm ?? '', potongan_lain: d.potongan_lain ?? '',
      keterangan: d.keterangan || '',
    })
    setOpen(true)
  }
  function save() {
    onSave({
      tanggal: f.tanggal || null, driver_name: f.driver_name.trim() || null,
      estimasi_muat: num(f.estimasi_muat),
      tanggal_muat: f.tanggal_muat || null, muatan: num(f.muatan),
      tanggal_bongkar: f.tanggal_bongkar || null, bongkar: num(f.bongkar),
      borongan: num(f.borongan), bbm_liter: num(f.bbm_liter), bbm_rupiah: num(f.bbm_rupiah),
      potongan_susut: num(f.potongan_susut), potongan_pm: num(f.potongan_pm), potongan_lain: num(f.potongan_lain),
      keterangan: f.keterangan.trim() || null,
    }, 'Delivery saved.')
    setOpen(false)
  }
  const s = susutOf(d)
  const rowOver = tol != null && d.muatan > 0 && s != null && (s / Number(d.muatan)) > Number(tol)

  return (
    <div className={'crow' + (open ? ' open' : '')}>
      <div className="crow-head" onClick={() => (open ? setOpen(false) : openEdit())}>
        <span className="fc-ctrl" style={{ fontSize: 13 }}>#{d.do_no}</span>
        <div className="crow-desc">
          <div className="d">{d.plate || '—'} · {d.driver_name || '—'}</div>
          <div className="m">{fmtDate(d.tanggal)} · muat {kg(d.muatan)} · bongkar {kg(d.bongkar)}{s != null ? ` · susut ${s.toLocaleString()}` : ''}</div>
        </div>
        <div className="crow-meta">
          {rowOver && <Badge tone="urgent">Over susut</Badge>}
          <span className="fc-out">{rp(netOf(d))}</span>
        </div>
        <span className="crow-caret">▶</span>
      </div>
      {open && (
        <div className="crow-detail">
          <div className="fd-grid">
            <label className="fd-f"><span>Date</span><input type="date" value={f.tanggal} onChange={e => set('tanggal', e.target.value)} /></label>
            <div className="fd-f"><span>Driver</span>
              <SearchSelect value={f.driver_name} onChange={v => set('driver_name', v)} placeholder="Select driver…"
                options={(drivers || []).map(dr => ({ value: dr.name, label: dr.name }))} />
            </div>
            <label className="fd-f"><span>Estimasi muat</span><input type="number" value={f.estimasi_muat} onChange={e => set('estimasi_muat', e.target.value)} /></label>
          </div>
          <div className="fd-sec">Realisasi</div>
          <div className="fd-grid">
            <label className="fd-f"><span>Tgl muat</span><input type="date" value={f.tanggal_muat} onChange={e => set('tanggal_muat', e.target.value)} /></label>
            <label className="fd-f"><span>Muatan (kg)</span><input type="number" value={f.muatan} onChange={e => set('muatan', e.target.value)} /></label>
            <label className="fd-f"><span>Tgl bongkar</span><input type="date" value={f.tanggal_bongkar} onChange={e => set('tanggal_bongkar', e.target.value)} /></label>
            <label className="fd-f"><span>Bongkar (kg)</span><input type="number" value={f.bongkar} onChange={e => set('bongkar', e.target.value)} /></label>
            <div className="fd-f"><span>Susut</span><div className="fd-calc">{(num(f.muatan) != null && num(f.bongkar) != null) ? (num(f.muatan) - num(f.bongkar)).toLocaleString() + ' kg' : '—'}</div></div>
          </div>
          <div className="fd-sec">Slip Uang Jalan</div>
          <div className="fd-grid">
            <label className="fd-f"><span>Borongan</span><input type="number" value={f.borongan} onChange={e => set('borongan', e.target.value)} /></label>
            <label className="fd-f"><span>BBM liter</span><input type="number" value={f.bbm_liter} onChange={e => set('bbm_liter', e.target.value)} /></label>
            <label className="fd-f"><span>BBM rupiah</span><input type="number" value={f.bbm_rupiah} onChange={e => set('bbm_rupiah', e.target.value)} /></label>
            <label className="fd-f"><span>Pot. susut</span><input type="number" value={f.potongan_susut} onChange={e => set('potongan_susut', e.target.value)} /></label>
            <label className="fd-f"><span>Pot. PM</span><input type="number" value={f.potongan_pm} onChange={e => set('potongan_pm', e.target.value)} /></label>
            <label className="fd-f"><span>Pot. lain</span><input type="number" value={f.potongan_lain} onChange={e => set('potongan_lain', e.target.value)} /></label>
            <div className="fd-f"><span>Sisa borongan</span><div className="fd-calc" style={{ fontWeight: 700 }}>{rp(Number(f.borongan || 0) - Number(f.bbm_rupiah || 0) - Number(f.potongan_susut || 0) - Number(f.potongan_pm || 0) - Number(f.potongan_lain || 0))}</div></div>
          </div>
          <label className="fd-f" style={{ marginTop: 8 }}><span>Keterangan</span><input value={f.keterangan} onChange={e => set('keterangan', e.target.value)} /></label>
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button className="btn primary sm" onClick={save}>Save</button>
            <button className="btn ghost sm" onClick={() => onSlip()}>Print slip</button>
            <button className="btn ghost sm void-btn" onClick={() => { if (confirm('Remove this delivery?')) onDelete() }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SlipOverlay({ c, d, onClose }) {
  const net = netOf(d)
  return (
    <div className="slip-scrim">
      <div className="slip-print">
        <div className="slip-h">SLIP UANG JALAN</div>
        <div className="slip-meta">
          <div><b>Plat BK:</b> {d.plate || '—'}</div>
          <div><b>Tanggal DO:</b> {fmtDate(d.tanggal)}</div>
          <div><b>Nama Supir:</b> {d.driver_name || '—'}</div>
          <div><b>Nomor DO:</b> {d.do_no}</div>
        </div>
        <table className="slip-tbl">
          <tbody>
            <tr><td>Nomor Kontrol</td><td>{c.control_no}</td></tr>
            <tr><td>Asal</td><td>{c.origin || '—'}</td></tr>
            <tr><td>Tujuan</td><td>{c.destination || '—'}</td></tr>
            <tr><td>Borongan</td><td>{rp(d.borongan)}</td></tr>
            <tr><td>BBM ({d.bbm_liter || 0} L)</td><td>− {rp(d.bbm_rupiah)}</td></tr>
            <tr><td>Potongan Susut</td><td>− {rp(d.potongan_susut)}</td></tr>
            <tr><td>Potongan PM</td><td>− {rp(d.potongan_pm)}</td></tr>
            <tr><td>Potongan Lain-lain</td><td>− {rp(d.potongan_lain)}</td></tr>
            <tr className="slip-total"><td>Sisa Borongan</td><td>{rp(net)}</td></tr>
          </tbody>
        </table>
        {d.keterangan && <div className="slip-note">Keterangan: {d.keterangan}</div>}
        <div className="slip-sign"><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
