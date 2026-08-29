import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, useToast } from '../components/ui'
import { DURATION } from '../lib/format'

export default function NewComplaint() {
  const nav = useNavigate()
  const { show, node } = useToast()
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [truckId, setTruckId] = useState('')
  const [reporterType, setReporterType] = useState('driver') // driver | mechanic | other | none
  const [driverId, setDriverId] = useState('')
  const [mechanicId, setMechanicId] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('normal')
  const [durationClass, setDurationClass] = useState('same_day')

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    ;(async () => {
      const [t, d, m] = await Promise.all([
        supabase.from('trucks').select('id,plate,fleet_division,status').eq('status', 'Active').order('plate'),
        supabase.from('drivers').select('id,code,name,status').eq('status', 'Active').order('name'),
        supabase.from('mechanics').select('id,code,name,status').eq('status', 'Active').order('code'),
      ])
      setTrucks(t.data || []); setDrivers(d.data || []); setMechanics(m.data || [])
      setLoading(false)
    })()
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!truckId) return show('Pick a truck first.', true)
    if (!description.trim()) return show('Describe the problem.', true)
    setSaving(true)
    const payload = {
      truck_id: truckId,
      description: description.trim(),
      priority, duration_class: durationClass,
      reported_by_driver_id: reporterType === 'driver' ? (driverId || null) : null,
      reported_by_mechanic_id: reporterType === 'mechanic' ? (mechanicId || null) : null,
      reporter_name: reporterType === 'other' ? (reporterName.trim() || null) : null,
    }
    const { data, error } = await supabase.from('complaints').insert(payload).select('code').single()
    setSaving(false)
    if (error) return show(error.message, true)
    show(`Complaint ${data.code} filed.`)
    setTimeout(() => nav('/triage'), 700)
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>New complaint</h1></div></div>
      <div className="content"><Spinner /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>New complaint</h1>
          <div className="sub">Log a truck problem. A driver, a mechanic, or nobody can be the reporter.</div>
        </div>
      </div>
      <div className="content">
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label>Truck</label>
            <select value={truckId} onChange={e => setTruckId(e.target.value)}>
              <option value="">Select a truck…</option>
              {trucks.map(t => (
                <option key={t.id} value={t.id}>{t.plate} — {t.fleet_division || 'Truck'}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Reported by</label>
            <div className="seg" style={{ marginBottom: 10 }}>
              {[['driver', 'Driver'], ['mechanic', 'Mechanic'], ['other', 'Other'], ['none', 'No one']].map(([v, l]) => (
                <button type="button" key={v} className={reporterType === v ? 'on' : ''}
                  onClick={() => setReporterType(v)}>{l}</button>
              ))}
            </div>
            {reporterType === 'driver' && (
              <select value={driverId} onChange={e => setDriverId(e.target.value)}>
                <option value="">Select driver (optional)…</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {reporterType === 'mechanic' && (
              <select value={mechanicId} onChange={e => setMechanicId(e.target.value)}>
                <option value="">Select mechanic (optional)…</option>
                {mechanics.map(m => <option key={m.id} value={m.id}>{title(m.name)} ({m.code})</option>)}
              </select>
            )}
            {reporterType === 'other' && (
              <input value={reporterName} onChange={e => setReporterName(e.target.value)}
                placeholder="Name of whoever reported it" />
            )}
          </div>

          <div className="field">
            <label>What's wrong<span className="hint">what the driver or mechanic observed</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Engine knocking at high load; needs kolong check too" />
          </div>

          <div className="row2">
            <div className="field">
              <label>Priority</label>
              <div className="seg">
                {[['urgent', 'Urgent'], ['normal', 'Normal']].map(([v, l]) => (
                  <button type="button" key={v} className={priority === v ? 'on' : ''}
                    onClick={() => setPriority(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Expected duration</label>
              <select value={durationClass} onChange={e => setDurationClass(e.target.value)}>
                {Object.entries(DURATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <button className="btn primary wide" disabled={saving}>
            {saving ? 'Filing…' : 'File complaint'}
          </button>
        </form>
      </div>
      {node}
    </>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
