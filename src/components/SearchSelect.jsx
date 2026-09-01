import { useState, useRef, useEffect, useMemo } from 'react'

// options: [{ value, label, sub?, search? }]
// search: extra text to match against (e.g. nickname, plate, code)
export default function SearchSelect({ options, value, onChange, placeholder = 'Search…', allowClear = true }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)

  const selected = options.find(o => o.value === value)

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options.slice(0, 50)
    return options.filter(o =>
      (o.label + ' ' + (o.sub || '') + ' ' + (o.search || '')).toLowerCase().includes(t)
    ).slice(0, 50)
  }, [q, options])

  return (
    <div className="ss" ref={boxRef}>
      <div className="ss-control" onClick={() => { setOpen(true); setQ('') }}>
        {open ? (
          <input autoFocus className="ss-input" value={q} placeholder={placeholder}
            onChange={e => setQ(e.target.value)} />
        ) : (
          <span className={'ss-value' + (selected ? '' : ' ph')}>
            {selected ? selected.label + (selected.sub ? ` · ${selected.sub}` : '') : placeholder}
          </span>
        )}
        {allowClear && selected && !open && (
          <button type="button" className="ss-clear" onClick={e => { e.stopPropagation(); onChange('') }}>×</button>
        )}
      </div>
      {open && (
        <div className="ss-menu">
          {filtered.length === 0 && <div className="ss-empty">No matches</div>}
          {filtered.map(o => (
            <div key={o.value}
              className={'ss-opt' + (o.value === value ? ' on' : '')}
              onClick={() => { onChange(o.value); setOpen(false) }}>
              <span>{o.label}</span>
              {o.sub && <span className="ss-sub">{o.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
