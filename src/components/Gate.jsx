import { useState } from 'react'
import { NavLink } from 'react-router-dom'

// Single shared password for now (VITE_APP_PASSWORD). Structured so per-section
// passwords can be added later (e.g. VITE_PASSWORD_MASTER) without changing callers.
const PASSWORD = import.meta.env.VITE_APP_PASSWORD || ''
export const gateEnabled = Boolean(PASSWORD)
export function checkPassword(input) { return gateEnabled && input === PASSWORD }

// Per-section gate: prompts for the password on entering a section, remembers
// the unlock for that section for the rest of the browser session.
export default function SectionGate({ section, label, children }) {
  const key = 'trs_authed_' + section
  const [authed, setAuthed] = useState(() => !gateEnabled || sessionStorage.getItem(key) === '1')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  if (authed) return children

  function submit(e) {
    e.preventDefault()
    if (checkPassword(pw)) { sessionStorage.setItem(key, '1'); setAuthed(true) }
    else { setErr(true); setPw('') }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-brand">{label || 'Locked'}</div>
        <div className="gate-sub">Enter the password to continue</div>
        <input type="password" autoFocus value={pw} placeholder="Password"
          onChange={e => { setPw(e.target.value); setErr(false) }} />
        {err && <div className="gate-err">Wrong password.</div>}
        <button className="btn primary wide" type="submit">Unlock</button>
        <NavLink to="/" className="gate-home">{'\u2190'} Back to home</NavLink>
      </form>
    </div>
  )
}
