import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'

export default function FleetRegisters() {
  const { show, node } = useToast()
  const [tab, setTab] = useState('clients')
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Clients & Places</h1>
          <div className="sub">Registered lists used when creating contracts</div>
        </div>
        <div className="md-tabs">
          <button className={tab === 'clients' ? 'on' : ''} onClick={() => setTab('clients')}>Clients</button>
          <button className={tab === 'locations' ? 'on' : ''} onClick={() => setTab('locations')}>Origins & Destinations</button>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 760 }}>
        {tab === 'clients' ? <Clients show={show} /> : <Locations show={show} />}
      </div>
      {node}
    </>
  )
}

function Clients({ show }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [note, setNote] = useState('')
  async function load() {
    if (!isConfigured) { setLoading(false); return }
    const { data } = await supabase.from('fleet_clients').select('*').order('name')
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  async function add() {
    if (!name.trim()) return
    const { error } = await supabase.from('fleet_clients').insert({ name: name.trim(), note: note.trim() || null })
    if (error) return show(error.message, true)
    setName(''); setNote(''); load()
  }
  async function del(id) {
    const { error } = await supabase.from('fleet_clients').delete().eq('id', id)
    if (error) return show('Cannot delete — this client may be in use.', true)
    load()
  }
  if (loading) return <Spinner />
  return (
    <>
      <div className="form" style={{ marginBottom: 16 }}>
        <div className="row2">
          <div className="field"><label>Client name *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="PT. …" onKeyDown={e => e.key === 'Enter' && add()} /></div>
          <div className="field"><label>Note</label><input value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <button className="btn primary" onClick={add}>+ Add client</button>
      </div>
      {rows.length === 0 ? <Empty title="No clients yet">Add the first client above.</Empty> : (
        <div className="md-list">
          {rows.map(r => (
            <div className="md-row" key={r.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div className="md-name">{r.name}</div>{r.note && <div className="md-sub">{r.note}</div>}</div>
              <button className="btn ghost sm void-btn" onClick={() => { if (confirm(`Delete ${r.name}?`)) del(r.id) }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Locations({ show }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [kind, setKind] = useState('Both'); const [note, setNote] = useState('')
  async function load() {
    if (!isConfigured) { setLoading(false); return }
    const { data } = await supabase.from('fleet_locations').select('*').order('name')
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  async function add() {
    if (!name.trim()) return
    const { error } = await supabase.from('fleet_locations').insert({ name: name.trim(), kind, note: note.trim() || null })
    if (error) return show(error.message, true)
    setName(''); setNote(''); load()
  }
  async function del(id) {
    const { error } = await supabase.from('fleet_locations').delete().eq('id', id)
    if (error) return show('Cannot delete — this place may be in use.', true)
    load()
  }
  if (loading) return <Spinner />
  return (
    <>
      <div className="form" style={{ marginBottom: 16 }}>
        <div className="row2">
          <div className="field"><label>Place name *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="PERLABIAN / PT SDS …" onKeyDown={e => e.key === 'Enter' && add()} /></div>
          <div className="field"><label>Used as</label>
            <div className="seg">
              {['Origin', 'Destination', 'Both'].map(k => (
                <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="field"><label>Note</label><input value={note} onChange={e => setNote(e.target.value)} /></div>
        <button className="btn primary" onClick={add}>+ Add place</button>
      </div>
      {rows.length === 0 ? <Empty title="No places yet">Add origins and destinations above.</Empty> : (
        <div className="md-list">
          {rows.map(r => (
            <div className="md-row" key={r.id} style={{ gridTemplateColumns: '1fr auto auto' }}>
              <div><div className="md-name">{r.name}</div>{r.note && <div className="md-sub">{r.note}</div>}</div>
              <Badge tone="muted">{r.kind}</Badge>
              <button className="btn ghost sm void-btn" onClick={() => { if (confirm(`Delete ${r.name}?`)) del(r.id) }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Drivers({ show }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [note, setNote] = useState('')
  async function load() {
    if (!isConfigured) { setLoading(false); return }
    const { data } = await supabase.from('fleet_drivers').select('*').order('name')
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  async function add() {
    if (!name.trim()) return
    const { error } = await supabase.from('fleet_drivers').insert({ name: name.trim(), note: note.trim() || null })
    if (error) return show(error.message, true)
    setName(''); setNote(''); load()
  }
  async function del(id) {
    const { error } = await supabase.from('fleet_drivers').delete().eq('id', id)
    if (error) return show('Cannot delete — this driver may be in use.', true)
    load()
  }
  if (loading) return <Spinner />
  return (
    <>
      <div className="form" style={{ marginBottom: 16 }}>
        <div className="row2">
          <div className="field"><label>Driver name *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Nama supir" onKeyDown={e => e.key === 'Enter' && add()} /></div>
          <div className="field"><label>Note</label><input value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <button className="btn primary" onClick={add}>+ Add driver</button>
      </div>
      {rows.length === 0 ? <Empty title="No drivers yet">Add hauling drivers above.</Empty> : (
        <div className="md-list">
          {rows.map(r => (
            <div className="md-row" key={r.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div className="md-name">{r.name}</div>{r.note && <div className="md-sub">{r.note}</div>}</div>
              <button className="btn ghost sm void-btn" onClick={() => { if (confirm(`Delete ${r.name}?`)) del(r.id) }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
