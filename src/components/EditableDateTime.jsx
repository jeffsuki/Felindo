import { useState } from 'react'

// ISO timestamp <-> value for <input type="datetime-local"> (local time)
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(val) {
  if (!val) return null
  return new Date(val).toISOString()
}

// Small labelled datetime field that saves on blur when the value changed.
export default function EditableDateTime({ label, value, onSave, disabled }) {
  const [v, setV] = useState(toLocalInput(value))
  const original = toLocalInput(value)

  function commit() {
    if (v === original) return
    onSave(fromLocalInput(v))
  }

  return (
    <label className="edt">
      <span className="edt-label">{label}</span>
      <input type="datetime-local" value={v} disabled={disabled}
        onChange={e => setV(e.target.value)} onBlur={commit} />
    </label>
  )
}
