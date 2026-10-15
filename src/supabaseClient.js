import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// If the keys are missing, the app renders a config banner instead of crashing.
export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured
  ? createClient(url, anonKey)
  : null

// Supabase returns at most 1,000 rows per request. fetchAll() pages through a query
// until every row is loaded. Pass a function that builds a fresh query each time.
// Rows are additionally ordered by id so pages never overlap or skip rows.
export async function fetchAll(build, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + pageSize - 1)
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < pageSize) return { data: all, error: null }
  }
}
