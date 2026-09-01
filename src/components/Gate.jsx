import { useState } from 'react'

// The single shared site password comes from .env (VITE_APP_PASSWORD).
// If it's not set, the gate is disabled (open app).
const PASSWORD = import.meta.env.VITE_APP_PASSWORD || ''
export const gateEnabled = Boolean(PASSWORD)

export function checkPassword(input) {
  return gateEnabled && input === PASSWORD
}

const KEY = 'trs_authed'

export default function Gate({ children }) {
  const [authed, setAuthed] = useState(() => !gateEnabled || sessionStorage.getItem(KEY) === '1')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  if (authed) return children

  function submit(e) {
    e.preventDefault()
    if (checkPassword(pw)) {
      sessionStorage.setItem(KEY, '1')
      setAuthed(true)
    } else {
      setErr(true); setPw('')
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-brand">Bengkel</div>
        <div className="gate-sub">Enter the shop password to continue</div>
        <input type="password" autoFocus value={pw} placeholder="Password"
          onChange={e => { setPw(e.target.value); setErr(false) }} />
        {err && <div className="gate-err">Wrong password.</div>}
        <button className="btn primary wide" type="submit">Unlock</button>
      </form>
    </div>
  )
}
