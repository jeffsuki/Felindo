import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'

const rp = n => (n === null || n === undefined || n === '') ? '—' : 'Rp ' + Number(n).toLocaleString()

export default function WarehouseItems() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sys, setSys] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('warehouse_items').select('*').order('sku')
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const systems = useMemo(() => [...new Set(rows.map(r => r.system).filter(Boolean))].sort(), [rows])
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (!showInactive && r.status !== 'Active') return false
      if (sys && r.system !== sys) return false
      if (!s) return true
      return `${r.sku} ${r.name} ${r.oem_no || ''} ${r.system || ''} ${r.part_type || ''}`.toLowerCase().includes(s)
    })
  }, [rows, q, sys, showInactive])

  async function save(id, patch) {
    if (id === 'new') {
      const { error } = await supabase.from('warehouse_items').insert(patch)
      if (error) return show(error.message, true)
      show('Item added.')
    } else {
      const { error } = await supabase.from('warehouse_items').update(patch).eq('id', id)
      if (error) return show(error.message, true)
      show('Saved.')
    }
    setEditing(null); load()
  }
  async function toggleActive(r) {
    const { error } = await supabase.from('warehouse_items').update({ status: r.status === 'Active' ? 'Inactive' : 'Active' }).eq('id', r.id)
    if (error) return show(error.message, true)
    load()
  }

  if (loading) return (<><div className="topbar"><div><h1>Warehouse items</h1></div></div><div className="content"><Spinner label="Loading items…" /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Warehouse items</h1><div className="sub">Spare-parts master · {rows.length} SKUs</div></div>
        <button className="btn primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'Cancel' : '+ Add item'}</button>
      </div>
      <div className="content" style={{ maxWidth: 1080 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by SKU, name, OEM, type…" /></div>
          <div className="field"><select value={sys} onChange={e => setSys(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All systems</option>{systems.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
          <button className="btn ghost" onClick={() => setShowInactive(v => !v)}>{showInactive ? 'Hide inactive' : 'Show inactive'}</button>
        </div>

        {editing === 'new' && <ItemForm row={{ status: 'Active' }} isNew onSave={p => save('new', p)} onCancel={() => setEditing(null)} />}

        <div className="hist-count">{visible.length} item{visible.length === 1 ? '' : 's'}</div>
        {visible.length === 0 ? <Empty title="No items">{q || sys ? 'No matches.' : 'Add items or run the seed.'}</Empty> : (
          <div className="dk-wrap">
            <table className="dk-tbl ct-tbl">
              <thead><tr><th style={{ width: 100 }}>SKU</th><th>Name</th><th>System</th><th>Type</th><th className="r">Unit cost</th><th>Status</th><th style={{ width: 150 }}></th></tr></thead>
              <tbody>
                {visible.map(r => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="mono">{r.sku}</td>
                      <td>{r.name}</td>
                      <td>{r.system || '—'}</td>
                      <td>{r.part_type || '—'}</td>
                      <td className="r mono">{rp(r.unit_cost)}</td>
                      <td><button className={'md-toggle' + (r.status === 'Active' ? ' on' : '')} onClick={() => toggleActive(r)} title={r.status === 'Active' ? 'Set inactive' : 'Set active'}><span className="knob" /></button></td>
                      <td className="dk-actions"><button className="btn ghost sm" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? 'Close' : 'Edit'}</button></td>
                    </tr>
                    {editing === r.id && <tr><td colSpan={7} style={{ background: '#FAFBFC' }}><ItemForm row={r} onSave={p => save(r.id, p)} onCancel={() => setEditing(null)} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {node}
    </>
  )
}

function ItemForm({ row, isNew, onSave, onCancel }) {
  const [f, setF] = useState({
    sku: row.sku || '', name: row.name || '', oem_no: row.oem_no || '', system: row.system || '',
    part_type: row.part_type || '', behaviour: row.behaviour || '', unit_cost: row.unit_cost ?? '',
    old_part_return: row.old_part_return || '', scrap_category: row.scrap_category || '', note: row.note || '',
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  function submit() {
    if (!f.sku.trim()) return setErr('SKU is required.')
    if (!f.name.trim()) return setErr('Name is required.')
    onSave({
      sku: f.sku.trim(), name: f.name.trim(), oem_no: f.oem_no.trim() || null, system: f.system.trim() || null,
      part_type: f.part_type.trim() || null, behaviour: f.behaviour.trim() || null,
      unit_cost: f.unit_cost === '' ? null : Number(f.unit_cost),
      old_part_return: f.old_part_return.trim() || null, scrap_category: f.scrap_category.trim() || null,
      note: f.note.trim() || null,
    })
  }
  return (
    <div className="form" style={{ maxWidth: 760, padding: isNew ? undefined : 12 }}>
      <div className="row2">
        <div className="field"><label>SKU *</label><input value={f.sku} onChange={e => set('sku', e.target.value)} placeholder="TIR-0001" /></div>
        <div className="field"><label>Name *</label><input value={f.name} onChange={e => set('name', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>System</label><input value={f.system} onChange={e => set('system', e.target.value)} /></div>
        <div className="field"><label>Part type</label><input value={f.part_type} onChange={e => set('part_type', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>OEM / Part no</label><input value={f.oem_no} onChange={e => set('oem_no', e.target.value)} /></div>
        <div className="field"><label>Unit cost (Rp)</label><input type="number" value={f.unit_cost} onChange={e => set('unit_cost', e.target.value)} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Behaviour</label><input value={f.behaviour} onChange={e => set('behaviour', e.target.value)} /></div>
        <div className="field"><label>Scrap category</label><input value={f.scrap_category} onChange={e => set('scrap_category', e.target.value)} /></div>
      </div>
      <div className="field"><label>Note</label><input value={f.note} onChange={e => set('note', e.target.value)} /></div>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="btn-group">
        <button className="btn primary" onClick={submit}>{isNew ? 'Add item' : 'Save'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
