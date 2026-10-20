import { useState, useRef } from 'react'

// Indonesian formatting: thousands ".", decimal ",". 2202500 -> "2.202.500"
export const fmtId = v =>
  (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '' : Number(v).toLocaleString('id-ID')

export const parseId = raw => {
  if (raw === null || raw === undefined) return ''
  const cleaned = String(raw).replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return ''
  const n = Number(cleaned)
  return isNaN(n) ? '' : n
}

// Shows formatted value when idle; plain digits while focused (easy to edit).
// onChange(num) fires live (numeric or ''); onCommit(num) fires on blur, only when the number changed
// (tabbing or clicking through a field no longer saves it again).
export function NumInput({ value, onChange, onCommit, disabled, style, className, placeholder }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const start = useRef('')
  const display = focused ? text : fmtId(value)
  return (
    <input type="text" inputMode="decimal" disabled={disabled} style={style} className={className} placeholder={placeholder}
      value={display}
      onFocus={() => { setFocused(true); const t = value === null || value === undefined || value === '' ? '' : String(value); setText(t); start.current = parseId(t) }}
      onChange={e => { setText(e.target.value); onChange && onChange(parseId(e.target.value)) }}
      onBlur={() => { setFocused(false); const n = parseId(text); if (onCommit && n !== start.current) onCommit(n) }}
    />
  )
}
