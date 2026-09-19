import { useState } from 'react'
import { checkPassword, gateEnabled } from './Gate'

// Password-gated confirm dialog. Calls onConfirm only when the password matches
// (or when no site password is configured). onCancel closes it.
export default function PasswordConfirm({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  function submit(e) {
    e.preventDefault()
    if (!gateEnabled || checkPassword(pw)) onConfirm()
    else { setErr(true); setPw('') }
  }
  return (
    <div className="slip-scrim">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-brand" style={{ fontSize: 18 }}>{title || 'Confirm'}</div>
        <div className="gate-sub">{message || (gateEnabled ? 'Enter the password to confirm.' : 'This cannot be undone.')}</div>
        {gateEnabled && (
          <input type="password" autoFocus value={pw} placeholder="Password"
            onChange={e => { setPw(e.target.value); setErr(false) }} />
        )}
        {err && <div className="gate-err">Wrong password.</div>}
        <button className="btn primary wide void-btn" type="submit">{confirmLabel}</button>
        <button type="button" className="gate-home" onClick={onCancel}>Cancel</button>
      </form>
    </div>
  )
}
