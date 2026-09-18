import { useState } from 'react'

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
// onChange(num) fires live (numeric or ''); onCommit(num) fires on blur.
export function NumInput({ value, onChange, onCommit, disabled, style, className, placeholder }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const display = focused ? text : fmtId(value)
  return (
    <input type="text" inputMode="decimal" disabled={disabled} style={style} className={className} placeholder={placeholder}
      value={display}
      onFocus={() => { setFocused(true); setText(value === null || value === undefined || value === '' ? '' : String(value)) }}
      onChange={e => { setText(e.target.value); onChange && onChange(parseId(e.target.value)) }}
      onBlur={() => { setFocused(false); onCommit && onCommit(parseId(text)) }}
    />
  )
}
