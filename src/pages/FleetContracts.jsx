import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'

const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString() + ' kg'
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function FleetContracts() {
  const { show, node } = useToast()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [c, t] = await Promise.all([
      supabase.from('fleet_contracts').select('*').order('contract_date', { ascending: false, nullsFirst: false }),
      supabase.from('fleet_contract_totals').select('*'),
    ])
    setRows(c.data || [])
    const map = {}; (t.data || []).forEach(r => { map[r.contract_id] = r })
    setTotals(map)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(c => `${c.control_no} ${c.client} ${c.origin} ${c.destination} ${c.contract_no} ${c.commodity}`.toLowerCase().includes(s))
  }, [rows, q])

  // group by month of contract_date
  const groups = useMemo(() => {
    const m = new Map()
    for (const c of visible) {
      const key = c.contract_date ? new Date(c.contract_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'No date'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(c)
    }
    return [...m.entries()]
  }, [visible])

  async function createContract(payload) {
    const { error } = await supabase.from('fleet_contracts').insert(payload)
    if (error) return show(error.message, true)
    show(`Contract ${payload.control_no} added.`)
    setAdding(false); load()
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Contracts</h1></div></div>
      <div className="content"><Spinner label="Loading contracts…" /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Contracts</h1>
          <div className="sub">Master list of client hauling contracts</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ New contract'}</button>
      </div>
      <div className="content" style={{ maxWidth: 1080 }}>
        {adding && <ContractForm onCreate={createContract} onCancel={() => setAdding(false)} />}

        <div className="controls" style={{ marginTop: adding ? 20 : 0 }}>
          <div className="field grow">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by control no, client, origin, destination…" />
          </div>
        </div>

        {groups.length === 0 ? (
          <Empty title="No contracts">{q ? 'No matches.' : 'Add the first contract above.'}</Empty>
        ) : groups.map(([month, list]) => (
          <div className="lane" key={month}>
            <div className="lane-head"><h2>{month}</h2><span className="count">{list.length}</span><span className="rule" /></div>
            <div className="clist">
              {list.map(c => {
                const t = totals[c.id] || {}
                const overTol = c.quantity_kg && t.total_muatan > 0 && c.susut_tolerance != null &&
                  (t.total_susut / t.total_muatan) > Number(c.susut_tolerance)
                const isOpen = expanded === c.id
                return (
                  <div className={'crow' + (isOpen ? ' open' : '')} key={c.id}>
                    <div className="crow-head" onClick={() => setExpanded(isOpen ? null : c.id)}>
                      <span className="fc-ctrl">{c.control_no}</span>
                      <div className="crow-desc">
                        <div className="d">{c.client || '—'}</div>
                        <div className="m">{c.origin || '—'} → {c.destination || '—'} · {c.commodity || '—'} · {fmtDate(c.contract_date)}</div>
                      </div>
                      <div className="crow-meta">
                        {overTol && <Badge tone="urgent">Over susut</Badge>}
                        <span className="fc-out" title="Outstanding (real)">{kg(t.outstanding)} left</span>
                      </div>
                      <span className="crow-caret">▶</span>
                    </div>
                    {isOpen && (
                      <div className="crow-detail">
                        <div className="metrics" style={{ marginBottom: 12 }}>
                          <div className="metric"><div className="k">Contracted</div><div className="v" style={{ fontSize: 17 }}>{kg(c.quantity_kg)}</div></div>
                          <div className="metric"><div className="k">Loaded (real)</div><div className="v" style={{ fontSize: 17 }}>{kg(t.total_muatan)}</div></div>
                          <div className="metric"><div className="k">Outstanding</div><div className="v" style={{ fontSize: 17 }}>{kg(t.outstanding)}</div></div>
                          <div className="metric"><div className="k">Deliveries</div><div className="v" style={{ fontSize: 17 }}>{t.deliveries || 0}</div></div>
                          <div className="metric"><div className="k">Susut</div><div className="v" style={{ fontSize: 17, color: overTol ? 'var(--urgent)' : undefined }}>{kg(t.total_susut)}</div></div>
                        </div>
                        <div className="fc-info">
                          <span><b>Contract no:</b> {c.contract_no || '—'}</span>
                          <span><b>DO contract:</b> {c.do_contract_no || '—'}</span>
                          <span><b>Toleransi susut:</b> {c.susut_tolerance != null ? (Number(c.susut_tolerance) * 100).toFixed(2) + '%' : '—'}</span>
                          <span><b>DK:</b> {c.dk || '—'}</span>
                        </div>
                        {c.note && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8 }}>{c.note}</div>}
                        <div className="btn-group" style={{ marginTop: 14 }}>
                          <button className="btn primary sm" onClick={() => nav('/fleet/contracts/' + c.id)}>Open deliveries & slips</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {node}
    </>
  )
}

function ContractForm({ onCreate, onCancel }) {
  const [f, setF] = useState({
    control_no: '', contract_date: '', contract_no: '', do_contract_no: '',
    client: '', origin: '', destination: '', commodity: 'CPO', quantity_kg: '',
    susut_tolerance: '0.002', dk: '', note: '',
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr('')
    if (!f.control_no.trim()) return setErr('Control number is required.')
    setBusy(true)
    await onCreate({
      control_no: f.control_no.trim(),
      contract_date: f.contract_date || null,
      contract_no: f.contract_no.trim() || null,
      do_contract_no: f.do_contract_no.trim() || null,
      client: f.client.trim() || null,
      origin: f.origin.trim() || null,
      destination: f.destination.trim() || null,
      commodity: f.commodity.trim() || null,
      quantity_kg: f.quantity_kg === '' ? null : Number(f.quantity_kg),
      susut_tolerance: f.susut_tolerance === '' ? null : Number(f.susut_tolerance),
      dk: f.dk.trim() || null,
      note: f.note.trim() || null,
    })
    setBusy(false)
  }

  return (
    <div className="form" style={{ maxWidth: 820 }}>
      <div className="row2">
        <div className="field"><label>Control no (NOMOR KONTROL) *</label><input value={f.control_no} onChange={e => set('control_no', e.target.value)} placeholder="e.g. 7263" /></div>
        <div className="field"><label>Contract date</label><input type="date" value={f.contract_date} onChange={e => set('contract_date', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Contract no</label><input value={f.contract_no} onChange={e => set('contract_no', e.target.value)} placeholder="2024/UMW-CPO/01" /></div>
        <div className="field"><label>DO contract no</label><input value={f.do_contract_no} onChange={e => set('do_contract_no', e.target.value)} placeholder="2024/UMW-CPO/DO/06" /></div>
      </div>
      <div className="field"><label>Client / supplier</label><input value={f.client} onChange={e => set('client', e.target.value)} placeholder="PT. …" /></div>
      <div className="row2">
        <div className="field"><label>Origin (asal / kebun)</label><input value={f.origin} onChange={e => set('origin', e.target.value)} /></div>
        <div className="field"><label>Destination (tujuan)</label><input value={f.destination} onChange={e => set('destination', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Commodity</label><input value={f.commodity} onChange={e => set('commodity', e.target.value)} /></div>
        <div className="field"><label>Quantity (kg)</label><input type="number" value={f.quantity_kg} onChange={e => set('quantity_kg', e.target.value)} placeholder="250000" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Toleransi susut<span className="hint">e.g. 0.002 = 0.2%</span></label><input type="number" step="0.0001" value={f.susut_tolerance} onChange={e => set('susut_tolerance', e.target.value)} /></div>
        <div className="field"><label>DK</label><input value={f.dk} onChange={e => set('dk', e.target.value)} /></div>
      </div>
      <div className="field"><label>Note</label><input value={f.note} onChange={e => set('note', e.target.value)} /></div>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="btn-group">
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save contract'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
