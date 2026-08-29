import { useEffect, useState } from 'react'

export function Plate({ children, lg }) {
  return <span className={'plate' + (lg ? ' lg' : '')}>{children}</span>
}

export function Badge({ tone = 'muted', children }) {
  return <span className={'badge ' + tone}><span className="tick" />{children}</span>
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="loading">{label}</div>
}

export function Empty({ title, children }) {
  return <div className="empty"><b>{title}</b>{children}</div>
}

// Toast: call show(msg, isError). Auto-dismisses.
export function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])
  const show = (message, err = false) => setToast({ message, err })
  const node = toast
    ? <div className={'toast' + (toast.err ? ' err' : '')}>{toast.message}</div>
    : null
  return { show, node }
}

// A number that ticks up every second, for live labor timers.
export function useNow(active = true) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setN(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  return Date.now()
}
