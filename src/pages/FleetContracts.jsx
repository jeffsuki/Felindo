import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { NumInput } from '../components/NumInput'

const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function contractStatus(c, t) {
  const qty = Number(c.quantity_kg || 0)
  const outstanding = Number(t?.outstanding ?? qty)
  if (!qty || outstanding > 0) return 'open'
  return (t?.incomplete_deliveries || 0) > 0 ? 'delivered' : 'closed'
}
// The quantity of some contracts is only known when they end (from the invoice): left empty, the contract stays open.
function outstandingCell(c, t) {
  if (c.quantity_kg === null || c.quantity_kg === undefined || c.quantity_kg === '') {
    return <span className="ct-open" title="Kuantitas belum diketahui — isi saat kontrak selesai">Terbuka · {kg(t?.total_muatan || 0)} dimuat</span>
  }
  const over = Number(t?.total_muatan || 0) - Number(c.quantity_kg)
  if (over > 0) return <span className="ct-over" title="Muatan melebihi kuantitas kontrak">Lebih {kg(over)}</span>
  return kg(t?.outstanding)
}
const STATUS_LABEL = { open: 'Open', delivered: 'Delivered', closed: 'Closed' }
const STATUS_TONE = { open: 'warn', delivered: 'accent', closed: 'ok' }
const FILTERS = [['all', 'All'], ['open', 'Open'], ['delivered', 'Delivered'], ['closed', 'Closed']]

export default function FleetContracts() {
  const { show, node } = useToast()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState({})
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [formFor, setFormFor] = useState(null)   // 'new' | contract object | null
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date')     // 'date' (contract date) | 'no' (control number)
  const [sortDir, setSortDir] = useState('desc')
  function sort(col) { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir(col === 'date' ? 'desc' : 'asc') } }
  const arrow = col => sortBy === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [c, t, cl, lo] = await Promise.all([
      supabase.from('fleet_contracts').select('*').order('contract_date', { ascending: false, nullsFirst: false }),
      supabase.from('fleet_contract_totals').select('*'),
      supabase.from('fleet_clients').select('name').order('name'),
      supabase.from('fleet_locations').select('name,kind').order('name'),
    ])
    setRows(c.data || [])
    const map = {}; (t.data || []).forEach(r => { map[r.contract_id] = r })
    setTotals(map); setClients(cl.data || []); setLocations(lo.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    const dir = sortDir === 'asc' ? 1 : -1
    const byNo = (a, b) => String(a.control_no || '').localeCompare(String(b.control_no || ''), undefined, { numeric: true })
    return rows.filter(c => {
      if (statusFilter !== 'all' && contractStatus(c, totals[c.id]) !== statusFilter) return false
      if (!s) return true
      return `${c.control_no} ${c.contract_no} ${c.client} ${c.origin} ${c.destination} ${c.commodity}`.toLowerCase().includes(s)
    }).sort((a, b) => {
      if (sortBy === 'no') return dir * byNo(a, b)
      if (!a.contract_date !== !b.contract_date) return a.contract_date ? -1 : 1     // no date: always last
      return dir * (String(a.contract_date || '').localeCompare(String(b.contract_date || '')) || byNo(a, b))
    })
  }, [rows, q, statusFilter, totals, sortBy, sortDir])

  async function saveContract(payload, id) {
    if (id) {
      const { error } = await supabase.from('fleet_contracts').update(payload).eq('id', id)
      if (error) return show(error.message, true)
      show('Contract updated.')
    } else {
      const { error } = await supabase.from('fleet_contracts').insert(payload)
      if (error) return show(error.message, true)
      show(`Contract ${payload.control_no} added.`)
    }
    setFormFor(null); load()
  }

  if (loading) return (<><div className="topbar"><div><h1>Contracts</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Contracts</h1><div className="sub">Master list of client hauling contracts</div></div>
        <button className="btn primary" onClick={() => setFormFor(formFor === 'new' ? null : 'new')}>{formFor === 'new' ? 'Cancel' : '+ New contract'}</button>
      </div>
      <div className="content">
        {formFor && <ContractForm clients={clients} locations={locations} initial={formFor === 'new' ? null : formFor}
          onSave={(p) => saveContract(p, formFor === 'new' ? null : formFor.id)} onCancel={() => setFormFor(null)} />}

        <div className="controls" style={{ marginTop: formFor ? 20 : 0 }}>
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by contract no, client, origin, destination…" /></div>
          <div className="seg-lens">
            {FILTERS.map(([v, l]) => (<button key={v} className={statusFilter === v ? 'on' : ''} onClick={() => setStatusFilter(v)}>{l}</button>))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Empty title="No contracts">{q ? 'No matches.' : 'Add the first contract above.'}</Empty>
        ) : (
          <div className="dk-wrap">
            <table className="dk-tbl ct-tbl">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => sort('no')} title="Urutkan menurut nomor kontrol">Contract Number{arrow('no')}</th>
                  <th className="sortable" onClick={() => sort('date')} title="Urutkan menurut tanggal kontrak">Date{arrow('date')}</th><th>Client</th><th>Origin</th><th>Destination</th>
                  <th className="r">Outstanding</th><th className="r">Tagihan OA</th><th className="r">Total Claim Susut</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => {
                  const t = totals[c.id] || {}
                  const st = contractStatus(c, t)
                  const claim = Number(t.total_claim || 0)
                  return (
                    <tr key={c.id}>
                      <td><div className="ct-no">{c.control_no}</div>{c.contract_no && <div className="ct-sub">{c.contract_no}</div>}</td>
                      <td>{fmtDate(c.contract_date)}</td>
                      <td>{c.client || '—'}</td>
                      <td>{c.origin || '—'}</td>
                      <td>{c.destination || '—'}</td>
                      <td className="r mono">{outstandingCell(c, t)}</td>
                      <td className="r mono">{t.tagihan === null || t.tagihan === undefined ? '—' : 'Rp ' + Math.round(Number(t.tagihan)).toLocaleString('id-ID')}{Number(t.rejects || 0) > 0 && <div className="ct-sub">{t.rejects} reject</div>}</td>
                      <td className="r mono" style={claim > 0 ? { color: 'var(--urgent)', fontWeight: 700 } : {}}>{kg(t.total_claim)}</td>
                      <td><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></td>
                      <td className="dk-actions">
                        <button className="btn ghost sm" onClick={() => setFormFor(c)}>Edit</button>
                        <button className="btn primary sm" onClick={() => nav('/fleet/contracts/' + c.id)}>Open</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {node}
    </>
  )
}

function ContractForm({ clients, locations, initial, onSave, onCancel }) {
  const [f, setF] = useState({
    control_no: initial?.control_no || '', contract_date: initial?.contract_date || '',
    contract_no: initial?.contract_no || '', do_contract_no: initial?.do_contract_no || '',
    client: initial?.client || '', origin: initial?.origin || '', destination: initial?.destination || '',
    commodity: initial?.commodity || 'CPO', quantity_kg: initial?.quantity_kg ?? '',
    qty_open: initial ? (initial.quantity_kg === null || initial.quantity_kg === undefined) : false,
    distance_km: initial?.distance_km ?? '', price_per_kg: initial?.price_per_kg ?? '',
    oa_per_kg: initial?.oa_per_kg ?? '', billing_basis: initial?.billing_basis || 'bongkar',
    susut_pct: initial?.susut_tolerance != null ? String(Number(initial.susut_tolerance) * 100) : '0.2',
    jenis_truk: initial?.jenis_truk || 'Tangki', note: initial?.note || '',
  })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const clientOpts = clients.map(c => ({ value: c.name, label: c.name }))
  const originOpts = locations.filter(l => l.kind === 'Origin' || l.kind === 'Both').map(l => ({ value: l.name, label: l.name }))
  const destOpts = locations.filter(l => l.kind === 'Destination' || l.kind === 'Both').map(l => ({ value: l.name, label: l.name }))

  async function submit() {
    setErr('')
    if (!f.control_no.trim()) return setErr('Control number is required.')
    setBusy(true)
    await onSave({
      control_no: f.control_no.trim(), contract_date: f.contract_date || null,
      contract_no: f.contract_no.trim() || null, do_contract_no: f.do_contract_no.trim() || null,
      client: f.client || null, origin: f.origin || null, destination: f.destination || null,
      commodity: f.commodity.trim() || null, quantity_kg: (f.qty_open || f.quantity_kg === '') ? null : Number(f.quantity_kg),
      distance_km: f.distance_km === '' ? null : Number(f.distance_km),
      price_per_kg: f.price_per_kg === '' ? null : Number(f.price_per_kg),
      oa_per_kg: f.oa_per_kg === '' ? null : Number(f.oa_per_kg), billing_basis: f.billing_basis,
      susut_tolerance: f.susut_pct === '' ? null : Number(f.susut_pct) / 100,
      jenis_truk: f.jenis_truk || null, note: f.note.trim() || null,
    })
    setBusy(false)
  }
  const noLists = clients.length === 0 || locations.length === 0

  return (
    <div className="form" style={{ maxWidth: 820 }}>
      {noLists && <div className="banner" style={{ marginBottom: 16 }}>Register clients and places first in <b>Clients &amp; Places</b>.</div>}
      <div className="row2">
        <div className="field"><label>Control no (NOMOR KONTROL) *</label><input value={f.control_no} onChange={e => set('control_no', e.target.value)} placeholder="e.g. 7263" /></div>
        <div className="field"><label>Contract date</label><input type="date" value={f.contract_date} onChange={e => set('contract_date', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Contract no</label><input value={f.contract_no} onChange={e => set('contract_no', e.target.value)} placeholder="2024/UMW-CPO/01" /></div>
        <div className="field"><label>DO contract no</label><input value={f.do_contract_no} onChange={e => set('do_contract_no', e.target.value)} placeholder="2024/UMW-CPO/DO/06" /></div>
      </div>
      <div className="field"><label>Client / supplier</label>
        <SearchSelect value={f.client} onChange={v => set('client', v)} placeholder="Select client…" options={clientOpts} />
      </div>
      <div className="row2">
        <div className="field"><label>Origin (asal / kebun)</label><SearchSelect value={f.origin} onChange={v => set('origin', v)} placeholder="Select origin…" options={originOpts} /></div>
        <div className="field"><label>Destination (tujuan)</label><SearchSelect value={f.destination} onChange={v => set('destination', v)} placeholder="Select destination…" options={destOpts} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Commodity</label><input value={f.commodity} onChange={e => set('commodity', e.target.value)} /></div>
        <div className="field"><label>Quantity (kg)</label>
          {f.qty_open
            ? <input value="Belum diketahui (kontrak terbuka)" disabled />
            : <NumInput value={f.quantity_kg} onChange={n => set('quantity_kg', n)} onCommit={n => set('quantity_kg', n)} placeholder="250.000" />}
          <label className="ct-qty-open"><input type="checkbox" checked={f.qty_open} onChange={e => set('qty_open', e.target.checked)} /> Belum diketahui — isi saat kontrak selesai (sesuai tagihan)</label>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Est. distance — one-way (km)<span className="hint">actual travelled = ×2 (round trip)</span></label><NumInput value={f.distance_km} onChange={n => set('distance_km', n)} onCommit={n => set('distance_km', n)} /></div>
        <div className="field"><label>Ongkos angkut (Rp/kg)<span className="hint">harga awal — perubahan harga diatur di halaman kontrak</span></label><NumInput value={f.oa_per_kg} onChange={n => set('oa_per_kg', n)} onCommit={n => set('oa_per_kg', n)} placeholder="600" /></div>
      </div>
      <div className="row2">
        <div className="field"></div>
        <div className="field"><label>Tagihan dihitung dari</label>
          <div className="seg">{[['bongkar', 'Bongkar (netto pabrik)'], ['muatan', 'Muatan (kebun)']].map(([k, l]) => (<button type="button" key={k} className={f.billing_basis === k ? 'on' : ''} onClick={() => set('billing_basis', k)}>{l}</button>))}</div>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Toleransi susut (%)<span className="hint">e.g. 0.2 for 0.2%</span></label><input type="number" step="0.01" value={f.susut_pct} onChange={e => set('susut_pct', e.target.value)} /></div>
        <div className="field"><label>Jenis Truk</label>
          <div className="seg">{['Tangki', 'Gerobak'].map(k => (<button type="button" key={k} className={f.jenis_truk === k ? 'on' : ''} onClick={() => set('jenis_truk', k)}>{k}</button>))}</div>
        </div>
      </div>
      <div className="field"><label>Note</label><input value={f.note} onChange={e => set('note', e.target.value)} /></div>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="btn-group">
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : (initial ? 'Save changes' : 'Save contract')}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
