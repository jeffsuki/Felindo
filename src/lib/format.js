// Labor seconds -> compact "2h 05m" / "12m 30s"
export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateShort(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

// Work-order status -> label + color token (labels in the shop's terms)
export const WO_STATUS = {
  unassigned:        { label: 'Unassigned',  tone: 'muted' },
  assigned:          { label: 'In queue',    tone: 'accent' },
  in_progress:       { label: 'In process',  tone: 'warn' },
  paused:            { label: 'Waiting',     tone: 'wait' },
  awaiting_parts:    { label: 'Waiting',     tone: 'wait' },
  awaiting_outsource:{ label: 'At vendor',   tone: 'out' },
  done:              { label: 'Done',        tone: 'ok' },
}

export const OPERATIONAL = {
  operational:        { label: 'Operational',   tone: 'ok' },
  in_repair:          { label: 'In repair',     tone: 'warn' },
  awaiting_outsource: { label: 'At vendor',     tone: 'out' },
}

export const PRIORITY = {
  urgent: { label: 'Urgent', tone: 'urgent' },
  normal: { label: 'Normal', tone: 'muted' },
}

export const DURATION = {
  same_day:        'Same day',
  multi_day:       'Multi-day',
  outsourced_wait: 'Outsourced wait',
}

// What a work order is "called" on screen: prefer what they actually do
// (the description), fall back to the specialty, then the code.
export function woTitle(w) {
  return (w.wo_description || w.description || '').trim()
    || (w.specialty || w.specialty_label || '')
    || w.wo_code || w.code || 'Work order'
}

// Daily shop log event types -> label + tone + icon-ish marker
export const EVENT_TYPES = {
  complaint_opened: { label: 'Complaint opened', tone: 'accent' },
  work_order_done:  { label: 'Work order done',  tone: 'ok' },
  sent_to_vendor:   { label: 'Sent to vendor',   tone: 'out' },
  complaint_closed: { label: 'Complaint closed', tone: 'ok' },
}

// Which work-order actions are available from a given status
export function nextActions(status) {
  switch (status) {
    case 'unassigned':        return ['assign', 'outsource']
    case 'assigned':          return ['start', 'outsource', 'reassign', 'unassign']
    case 'in_progress':       return ['wait', 'complete', 'reassign', 'unassign', 'outsource']
    case 'paused':            return ['resume', 'complete', 'reassign', 'unassign', 'outsource']
    case 'awaiting_parts':    return ['resume', 'unassign']
    case 'awaiting_outsource':return ['return_from_vendor']
    default:                  return []
  }
}
