import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Badge, Spinner, Empty, useToast } from '../components/ui'

// Per-entity config: table, fields, status options, how to render a row
const STATUS = {
  person: ['Active', 'Resigned', 'Dismissed', 'On leave'],
  truck:  ['Active', 'Sold', 'Scrapped', 'Off-road'],
  vendor: ['Active', 'Inactive', 'Blacklisted'],
}

const ENTITIES = {
  trucks: {
    label: 'Trucks', table: 'trucks', order: 'code',
    columns: 'id,code,plate,model,fleet_division,status',
    statusSet: STATUS.truck,
    name: r => r.plate, sub: r => [r.fleet_division, r.model].filter(Boolean).join(' · '),
    search: r => `${r.code} ${r.plate} ${r.model || ''} ${r.fleet_division || ''}`,
    fields: [
      { key: 'plate', label: 'Plate', type: 'text', required: true },
      { key: 'fleet_division', label: 'Fleet division', type: 'select', options: ['Tangki', 'Gerobak', 'Kantor'] },
      { key: 'model', label: 'Model', type: 'text' },
    ],
    blank: { plate: '', fleet_division: 'Tangki', model: '', status: 'Active' },
  },
  drivers: {
    label: 'Drivers', table: 'drivers', order: 'code',
    columns: 'id,code,name,nickname,phone,status',
    statusSet: STATUS.person,
    name: r => r.name, sub: r => r.phone || '',
    search: r => `${r.code} ${r.name} ${r.nickname || ''} ${r.phone || ''}`,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'nickname', label: 'Nickname', type: 'text', hint: 'to tell similar names apart' },
      { key: 'phone', label: 'Phone', type: 'text' },
    ],
    blank: { name: '', nickname: '', phone: '', status: 'Active' },
  },
  mechanics: {
    label: 'Mechanics', table: 'mechanics', order: 'code',
    columns: 'id,code,name,nickname,phone,employment_type,can_lift,status',
    statusSet: STATUS.person,
    name: r => r.name, sub: r => [r.employment_type, r.can_lift ? 'can lift' : ''].filter(Boolean).join(' · '),
    search: r => `${r.code} ${r.name} ${r.nickname || ''} ${r.phone || ''}`,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'nickname', label: 'Nickname', type: 'text', hint: 'to tell similar names apart' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'employment_type', label: 'Employment', type: 'select', options: ['in_house', 'outsourced'] },
      { key: 'can_lift', label: 'Heavy lifting', type: 'bool' },
    ],
    blank: { name: '', nickname: '', phone: '', employment_type: 'in_house', can_lift: false, status: 'Active' },
  },
  vendors: {
    label: 'Vendors', table: 'vendors', order: 'code',
    columns: 'id,code,name,contact,phone,status',
    statusSet: STATUS.vendor,
    name: r => r.name, sub: r => [r.contact, r.phone].filter(Boolean).join(' · '),
    search: r => `${r.code} ${r.name} ${r.contact || ''} ${r.phone || ''}`,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'contact', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
    ],
    blank: { name: '', contact: '', phone: '', status: 'Active' },
  },
}

const TABS = Object.keys(ENTITIES)

export default function MasterData() {
  const [tab, setTab] = useState('trucks')
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Master data</h1>
          <div className="sub">Add, edit, and retire trucks, drivers, mechanics, and vendors</div>
        </div>
      </div>
      <div className="content">
        <div className="md-tabs">
          {TABS.map(t => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{ENTITIES[t].label}</button>
          ))}
        </div>
        <EntityManager key={tab} cfg={ENTITIES[tab]} />
      </div>
    </>
  )
}

function EntityManager({ cfg }) {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)   // row id, or 'new', or null
  const [showRetired, setShowRetired] = useState(false)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from(cfg.table).select(cfg.columns).order(cfg.order)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [cfg.table])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (!showRetired && r.status !== 'Active') return false
      if (!t) return true
      return cfg.search(r).toLowerCase().includes(t)
    })
  }, [rows, q, showRetired, cfg])

  async function save(id, patch) {
    if (id === 'new') {
      const { error } = await supabase.from(cfg.table).insert(patch)
      if (error) return show(error.message, true)
      show(`${cfg.label.slice(0, -1)} added.`)
    } else {
      const { error } = await supabase.from(cfg.table).update(patch).eq('id', id)
      if (error) return show(error.message, true)
      show('Saved.')
    }
    setEditing(null)
    load()
  }

  if (loading) return <Spinner label={`Loading ${cfg.label.toLowerCase()}…`} />

  return (
    <>
      <div className="controls">
        <div className="field grow">
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={`Search ${cfg.label.toLowerCase()} by name, code${cfg.table !== 'vendors' ? ', nickname' : ''}…`} />
        </div>
        <button className="btn ghost" onClick={() => setShowRetired(s => !s)}>
          {showRetired ? 'Hide retired' : 'Show retired'}
        </button>
        <button className="btn primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          + Add {cfg.label.slice(0, -1).toLowerCase()}
        </button>
      </div>

      {editing === 'new' && (
        <div className="md-list" style={{ marginBottom: 16 }}>
          <EditForm cfg={cfg} row={{ ...cfg.blank }} isNew onSave={p => save('new', p)} onCancel={() => setEditing(null)} />
        </div>
      )}

      {visible.length === 0 ? (
        <Empty title="Nothing here">{q ? 'No matches for your search.' : `No ${cfg.label.toLowerCase()} yet.`}</Empty>
      ) : (
        <div className="md-list">
          {visible.map(r => (
            <div key={r.id}>
              <div className="md-row">
                <span className="md-code">{r.code}</span>
                <div>
                  <div className="md-name">
                    {cfg.name(r)}
                    {r.nickname && <span className="nick"> ({r.nickname})</span>}
                  </div>
                  {cfg.sub(r) && <div className="md-sub">{cfg.sub(r)}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Badge tone={r.status === 'Active' ? 'ok' : 'muted'}>{r.status}</Badge>
                  <button className="btn ghost sm" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                    {editing === r.id ? 'Close' : 'Edit'}
                  </button>
                </div>
              </div>
              {editing === r.id && (
                <EditForm cfg={cfg} row={r} onSave={p => save(r.id, p)} onCancel={() => setEditing(null)} />
              )}
            </div>
          ))}
        </div>
      )}
      {node}
    </>
  )
}

function EditForm({ cfg, row, isNew, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    const f = {}
    cfg.fields.forEach(fl => { f[fl.key] = row[fl.key] ?? (fl.type === 'bool' ? false : '') })
    f.status = row.status || 'Active'
    return f
  })
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))

  function submit() {
    for (const fl of cfg.fields) {
      if (fl.required && !String(form[fl.key] || '').trim()) return
    }
    // trim strings, null out empties
    const patch = {}
    cfg.fields.forEach(fl => {
      let v = form[fl.key]
      if (typeof v === 'string') { v = v.trim(); if (v === '') v = null }
      patch[fl.key] = v
    })
    patch.status = form.status
    onSave(patch)
  }

  return (
    <div className="md-edit">
      {!isNew && <div className="md-code" style={{ marginBottom: 10 }}>{row.code} — code is permanent</div>}
      <div className="row2">
        {cfg.fields.map(fl => (
          <div className="field" key={fl.key}>
            <label>{fl.label}{fl.required && ' *'}{fl.hint && <span className="hint">{fl.hint}</span>}</label>
            {fl.type === 'text' && (
              <input value={form[fl.key] || ''} onChange={e => set(fl.key, e.target.value)} />
            )}
            {fl.type === 'select' && (
              <select value={form[fl.key] || ''} onChange={e => set(fl.key, e.target.value)}>
                {fl.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {fl.type === 'bool' && (
              <div className="seg">
                <button type="button" className={form[fl.key] ? 'on' : ''} onClick={() => set(fl.key, true)}>Yes</button>
                <button type="button" className={!form[fl.key] ? 'on' : ''} onClick={() => set(fl.key, false)}>No</button>
              </div>
            )}
          </div>
        ))}
        <div className="field">
          <label>Status<span className="hint">retire by changing this</span></label>
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {cfg.statusSet.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="btn-group">
        <button className="btn primary" onClick={submit}>{isNew ? 'Add' : 'Save changes'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
